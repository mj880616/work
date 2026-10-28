// AI-사용량줄: 홈 수집 칸 바로 아래 'AI 사용량(n월, 추정)' 한 줄(PC·폰 공통). 이 파일이 이 자리의 유일한 상태 소유자이자 렌더러다.
// - 읽기: 수집 칸과 같은 drive-summary GET ?action=status 답의 ai_usage(소유자 JWT). 옛 함수(칸 없음)·표 없음이면 줄을 숨긴다.
// - 평소 한 줄 요약, 누르면 펼침. 경고(월 상한 80%·잔액 1만 원 아래)가 있으면 노란 줄이 되고, 누르면 펼친 칸의 충전 입력이 열린다.
// - 충전·청구 금액은 서버 표 app_ai_cost_entries에만 저장한다(기기 저장 없음). 고치기 대신 지우고 다시 넣는다.
// - 한 탭에서 10분에 한 번만 묻는다(메모리만, 수집 칸과 같은 요청). 넣기·지우기 뒤에는 바로 다시 묻는다.
import {readSummary, monthLabel, warnText, summaryLine, detailRows, entryRows, parseEntry, lastMonth, krw} from './ai-usage-model.mjs';
import {isOwner, readDriveStatus, updateDriveStatus} from './collection-status.js';

const scopeOf = rt => { const c = rt?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
// 처음 읽기는 수집 칸과 같은 drive-summary GET ?action=status 한 번(ai_usage 칸)을 함께 쓴다(탭마다 10분 한 번, 요청을 늘리지 않음).
// 금액을 넣거나 지운 직후에만 GET ?action=ai_usage로 바로 다시 읽고, 함께 쓰는 상태 답도 그 값으로 맞춘다.
export function readAiUsage(rt, {fresh = false} = {}) {
  if (!fresh) return readDriveStatus(rt).then(data => readSummary(data?.ai_usage), () => null);
  return rt.api('/functions/v1/drive-summary?action=ai_usage', {refreshSession:false, singleFlight:false, timeoutMs:30000}).then(data => {
    const s = readSummary(data);
    if (s) updateDriveStatus(rt, status => ({...status, ai_usage:s}));
    return s;
  }, () => null);
}

export function mountAiUsageLine(host, {rt = window.KPTURuntime, now = () => Date.now()} = {}) {
  if (!host) return null;
  host.hidden = true;
  let alive = true, run = 0, shown = null, open = false, form = null, busy = false, message = '';
  const panelId = 'homeAiUsagePanel';
  function paint(s) {
    shown = s;
    if (!s) { host.hidden = true; host.innerHTML = ''; return; }
    const warn = warnText(s);
    const head = `<button type="button" class="aiu-open" data-aiu-toggle aria-expanded="${open}" aria-controls="${panelId}"${warn ? ' data-warn' : ''}>`
      + (warn ? `<svg class="aiu-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 2.5 16.5h15zM10 8.5v3.5M10 14.2v.3"/></svg><span class="aiu-sum">${esc(warn)}</span>`
        : `<span class="aiu-title">AI 사용량(${esc(monthLabel(s.month))}, 추정)</span><span class="aiu-sum">${esc(summaryLine(s))}</span>`)
      + `<span class="aiu-chevron" aria-hidden="true">${open ? '접기 ▴' : '펼치기 ▾'}</span></button>`;
    const formHtml = form ? `<form class="aiu-form" data-aiu-form>
        <select name="provider" aria-label="어느 AI"><option value="openai"${form.provider === 'openai' ? ' selected' : ''}>OpenAI</option><option value="gemini"${form.provider === 'gemini' ? ' selected' : ''}>Gemini</option></select>
        ${form.kind === 'bill' ? `<input type="month" name="month" value="${esc(form.month)}" aria-label="청구 달" required>` : ''}
        <input type="text" name="amount" inputmode="numeric" placeholder="${form.kind === 'bill' ? '실제 청구 금액(원)' : '충전 금액(원)'}" aria-label="${form.kind === 'bill' ? '실제 청구 금액' : '충전 금액'}" value="${esc(form.amount || '')}" autocomplete="off" required>
        <div class="save-row aiu-save"><button type="button" class="aiu-btn" data-aiu-cancel>취소</button><button type="submit" class="aiu-btn aiu-primary"${busy ? ' disabled' : ''}>저장</button></div>
      </form>` : '';
    const entries = entryRows(s);
    const panel = `<div class="aiu-panel" id="${panelId}" role="region" aria-label="AI 사용량 자세히"${open ? '' : ' hidden'}>
      <ul class="aiu-list">${detailRows(s)}</ul>
      <div class="aiu-actions"><button type="button" class="aiu-btn" data-aiu-new="topup">충전 금액 넣기</button><button type="button" class="aiu-btn" data-aiu-new="bill">실제 청구 넣기</button></div>
      ${formHtml}${message ? `<p class="aiu-msg" role="status">${esc(message)}</p>` : ''}
      ${entries ? `<details class="aiu-entries"><summary>넣은 금액 ${s.entries.length}건</summary><ul>${entries}</ul></details>` : ''}
      <p class="aiu-foot">숫자는 AI를 부를 때 돌려받은 사용량으로 셈한 추정임. 실제 청구를 넣으면 다음 달부터 그 비율로 맞춤.</p>
    </div>`;
    host.innerHTML = head + panel;
    host.hidden = false;
  }
  async function refresh({fresh = false} = {}) {
    if (!isOwner(rt)) { paint(null); return; }
    const mine = ++run, scope = scopeOf(rt);
    const s = await readAiUsage(rt, {fresh});
    if (!alive || mine !== run || scope !== scopeOf(rt)) return;
    paint(s);
  }
  async function save(el) {
    const data = Object.fromEntries(new FormData(el));
    const row = parseEntry({...data, kind:form.kind});
    form.amount = data.amount;
    if (!row) { message = '금액을 숫자로 넣어 주세요.'; paint(shown); return; }
    const workspace = rt.context.read()?.workspace?.id;
    if (!workspace) return;
    busy = true; paint(shown);
    try {
      await rt.api('/rest/v1/app_ai_cost_entries', {method:'POST', prefer:'return=minimal', body:{workspace_id:workspace, ...row}});
      message = `${row.kind === 'bill' ? '청구' : '충전'} ${krw(row.amount_krw)} 저장함.`; form = null;
    } catch { message = '저장하지 못했어요. 잠시 뒤 다시 해 주세요.'; }
    busy = false;
    await refresh({fresh:true});
  }
  async function remove(id) {
    const workspace = rt.context.read()?.workspace?.id;
    if (!workspace || !/^[0-9a-f-]{36}$/i.test(id)) return;
    try {
      await rt.api(`/rest/v1/app_ai_cost_entries?workspace_id=eq.${encodeURIComponent(workspace)}&id=eq.${encodeURIComponent(id)}`, {method:'DELETE', prefer:'return=minimal'});
      message = '지움.';
    } catch { message = '지우지 못했어요.'; }
    await refresh({fresh:true});
  }
  function onClick(event) {
    const b = event.target.closest('button');
    if (!b || !host.contains(b) || b.type === 'submit') return;
    if (b.matches('[data-aiu-toggle]')) {
      open = !open;
      // 경고 줄을 눌러 펼치면 충전 입력을 바로 연다(요청 ④).
      if (open && b.hasAttribute('data-warn') && !form) form = {kind:'topup', provider:(shown?.warn || []).includes('gemini_balance') ? 'gemini' : 'openai', month:lastMonth(now())};
      message = ''; paint(shown);
      host.querySelector('[data-aiu-toggle]')?.focus({preventScroll:true});
    } else if (b.dataset.aiuNew) {
      form = {kind:b.dataset.aiuNew, provider:'openai', month:lastMonth(now())}; message = ''; paint(shown);
      host.querySelector('[data-aiu-form] input[name="amount"]')?.focus();
    } else if (b.matches('[data-aiu-cancel]')) { form = null; message = ''; paint(shown); }
    else if (b.dataset.aiuDelete) remove(b.dataset.aiuDelete);
  }
  function onSubmit(event) {
    const el = event.target.closest('[data-aiu-form]');
    if (!el) return;
    event.preventDefault();
    if (!busy) save(el);
  }
  function onChange(event) {
    if (form && event.target.name === 'provider') form.provider = event.target.value;
    if (form && event.target.name === 'month') form.month = event.target.value;
    if (form && event.target.name === 'amount') form.amount = event.target.value;
  }
  host.addEventListener('click', onClick);
  host.addEventListener('submit', onSubmit);
  host.addEventListener('change', onChange);
  return {refresh, destroy() { alive = false; run++; host.removeEventListener('click', onClick); host.removeEventListener('submit', onSubmit); host.removeEventListener('change', onChange); }};
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
