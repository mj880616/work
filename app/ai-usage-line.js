// AI-비용보기(6단계): 내 프로필 '사용 현황' 칸 'AI 비용' 줄(PC·폰 공통). 이 파일이 이 자리의 유일한 상태 소유자이자 렌더러다.
// - 읽기: 수집 칸과 같은 drive-summary GET ?action=status 답의 ai_usage(소유자 JWT). 옛 함수(칸 없음)·표 없음이면 줄을 숨긴다.
// - 평소 한 줄 요약(기간 · OpenAI · Gemini · 월말 약 ○원), 누르면 펼침: 공급자 두 줄 → 접힌 '기능별' 표 → 접힌 '한도·자동 충전'.
// - 쓰기는 한 곳뿐: Gemini 월 한도(kind cap)·OpenAI 자동 충전 금액(kind reload)을 서버 표 app_ai_cost_entries에 넣는다(소유자 RLS).
//   기기 저장 없음. 저장 뒤 서버 답을 새로 받아 다시 그린다(서버가 한도까지 남은 날·충전 횟수를 다시 셈).
// - 상태(state)는 이 파일 안 하나뿐: 답·펼침·접힌 칸 열림·저장 중·알림 글. 그리기는 paint() 하나.
import {readSummary, titleText, warnText, summaryLine, providerRows, featureRows, featureRowsHtml, featureSummary, limitLine,
  savedAmounts, parseAmount, changedEntries, amountText, krw} from './ai-usage-model.mjs';
import {isOperator, readDriveStatus} from './collection-status.js';
import { chevHtml } from './fold-chevron.mjs';

const scopeOf = rt => { const c = rt?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
// 수집 칸과 같은 drive-summary GET ?action=status 한 번(ai_usage 칸)을 함께 쓴다(탭마다 10분 한 번, 요청을 늘리지 않음).
export function readAiUsage(rt, opts) {
  return readDriveStatus(rt, opts).then(data => readSummary(data?.ai_usage), () => null);
}

// onPaint: 그린 뒤마다 부른다(빈 줄이면 숨긴 뒤). 칸 전체 보이기(profile-status.js)가 쓴다.
export function mountAiUsageLine(host, {rt = window.KPTURuntime, now = () => Date.now(), onPaint = () => {}} = {}) {
  if (!host) return null;
  host.hidden = true;
  let alive = true, run = 0;
  const state = {summary:null, open:false, fold:{feat:false, limits:false}, saving:false, msg:''};
  const panelId = 'homeAiUsagePanel';
  function paint() {
    const s = state.summary;
    if (!s) { host.hidden = true; host.innerHTML = ''; onPaint(); return; }
    const at = now(), warn = warnText(s), open = state.open;
    const head = `<button type="button" class="aiu-open" data-aiu-toggle aria-expanded="${open}" aria-controls="${panelId}"${warn ? ' data-warn' : ''}>`
      + (warn ? `<svg class="aiu-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 2.5 16.5h15zM10 8.5v3.5M10 14.2v.3"/></svg><span class="aiu-sum">${esc(warn)}</span>`
        : `<span class="aiu-title">${esc(titleText(s, at))}</span><span class="aiu-sum">${esc(summaryLine(s, at))}</span>`)
      + `<span class="aiu-chevron" aria-hidden="true">${open ? '접기' : '펼치기'} ${chevHtml(open)}</span></button>`;
    // 경고 줄일 때는 펼친 칸 맨 위에 기간·요약을 한 번 보인다.
    const top = warn ? `<p class="aiu-head-line"><span class="aiu-title">${esc(titleText(s, at))}</span> <span>${esc(summaryLine(s, at))}</span></p>` : '';
    const rows = featureRows(s), saved = savedAmounts(s), fg = s.forecast?.gemini, fo = s.forecast?.openai;
    const feat = `<details class="aiu-fold" data-aiu-fold="feat"${state.fold.feat ? ' open' : ''}><summary>${esc(featureSummary(rows))}</summary>`
      + `<ul class="aiu-list aiu-feat">${featureRowsHtml(rows)}</ul><p class="aiu-sub">${esc(limitLine(s))}</p></details>`;
    // 빈 칸 안 흐린 숫자 = 서버 권장 금액(넣지 않으면 저장되지 않음).
    const hint = [amountText(fg?.suggest_cap_krw), amountText(fo?.suggest_reload_krw)];
    const field = (name, label, value, tip) => `<label class="aiu-field"><span>${esc(label)}</span><input name="${name}" inputmode="numeric" autocomplete="off" value="${esc(amountText(value))}" placeholder="${esc(tip || '0')}"${state.saving ? ' disabled' : ''}><span aria-hidden="true">원</span></label>`;
    const limitsSum = `한도·자동 충전 · Gemini ${saved.cap ? krw(saved.cap) : '미입력'} · OpenAI ${saved.reload ? krw(saved.reload) : '미입력'}`;
    const limits = `<details class="aiu-fold" data-aiu-fold="limits"${state.fold.limits ? ' open' : ''}><summary>${esc(limitsSum)}</summary>`
      + `<div class="aiu-inputs">${field('cap', 'Gemini 월 한도', saved.cap, hint[0])}${field('reload', 'OpenAI 자동 충전', saved.reload, hint[1])}`
      + `<button type="button" class="secondary aiu-save" data-aiu-save${state.saving ? ' disabled' : ''}>저장</button></div>`
      + `<p class="aiu-sub" data-aiu-msg role="status">${esc(state.msg)}</p>`
      + `<p class="aiu-sub">월말은 최근 14일 하루 평균으로 셈 · 추정은 토큰 × 단가라 실제 청구와 다를 수 있어요</p></details>`;
    const panel = `<div class="aiu-panel" id="${panelId}" role="region" aria-label="AI 비용 자세히"${open ? '' : ' hidden'}>${top}<ul class="aiu-list">${providerRows(s, at)}</ul>${feat}${limits}</div>`;
    host.innerHTML = `<div class="aiu-top" data-aiu-top>${head}</div>` + panel;
    host.hidden = false;
    onPaint();
  }
  async function refresh(opts) {
    const mine = ++run, scope = scopeOf(rt);
    if (!(await isOperator(rt))) { if (alive && mine === run) { state.summary = null; paint(); } return; }
    const s = await readAiUsage(rt, opts);
    if (!alive || mine !== run || scope !== scopeOf(rt)) return;
    state.summary = s;
    paint();
  }
  async function save() {
    const s = state.summary, workspace = rt?.context?.read?.()?.workspace?.id;
    if (!s || state.saving || !workspace) return;
    const read = name => parseAmount(host.querySelector(`input[name="${name}"]`)?.value);
    const cap = read('cap'), reload = read('reload');
    if (cap === null || reload === null) { state.msg = '금액은 0~1억 원 숫자로 넣어 주세요'; paint(); return; }
    const list = changedEntries(s, {cap, reload});
    if (!list.length) { state.msg = '바뀐 금액이 없어요'; paint(); return; }
    state.saving = true; state.msg = '저장 중…'; paint();
    try {
      for (const e of list) await rt.api('/rest/v1/app_ai_cost_entries', {method:'POST', prefer:'return=minimal', body:{workspace_id:workspace, ...e}});
      state.msg = '저장했어요';
    } catch { state.msg = '저장하지 못했어요'; }
    state.saving = false;
    await refresh({fresh:true});
  }
  function onClick(event) {
    const b = event.target.closest('button');
    if (!b || !host.contains(b)) return;
    if (b.matches('[data-aiu-save]')) { void save(); return; }
    if (!b.matches('[data-aiu-toggle]')) return;
    state.open = !state.open; paint();
    host.querySelector('[data-aiu-toggle]')?.focus({preventScroll:true});
  }
  // <details> 열고 닫기는 브라우저가 하고, 다시 그릴 때 그대로 두려고 상태에만 적는다(toggle은 거품이 없어 capture).
  function onToggle(event) {
    const d = event.target;
    if (!(d instanceof HTMLElement) || !d.matches?.('[data-aiu-fold]') || !host.contains(d)) return;
    state.fold[d.dataset.aiuFold] = d.open;
  }
  function onKey(event) {
    if (event.key === 'Enter' && event.target?.matches?.('.aiu-field input')) { event.preventDefault(); void save(); }
  }
  host.addEventListener('click', onClick);
  host.addEventListener('toggle', onToggle, true);
  host.addEventListener('keydown', onKey);
  return {refresh: () => refresh(), destroy() { alive = false; run++; host.removeEventListener('click', onClick); host.removeEventListener('toggle', onToggle, true); host.removeEventListener('keydown', onKey); }};
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
