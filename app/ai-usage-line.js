// AI-사용량줄: 홈 수집 칸 바로 아래 'AI 사용량 · n월 1일~d일 (이번 달, 추정)' 한 줄(PC·폰 공통). 이 파일이 이 자리의 유일한 상태 소유자이자 렌더러다.
// - 읽기: 수집 칸과 같은 drive-summary GET ?action=status 답의 ai_usage(소유자 JWT). 옛 함수(칸 없음)·표 없음이면 줄을 숨긴다.
// - 평소 한 줄 요약(OpenAI · Gemini · 이 속도면 월말 약 ○원), 누르면 펼침. 월 상한 80%를 넘으면 노란 줄.
// - 보기만 한다(쓰기 없음). 충전·청구 입력은 없앴다(10/28 요청함). 한 탭에서 10분에 한 번만 묻는다(메모리만, 수집 칸과 같은 요청).
import {readSummary, titleText, warnText, summaryLine, detailRows} from './ai-usage-model.mjs';
import {isOwner, readDriveStatus} from './collection-status.js';

const scopeOf = rt => { const c = rt?.context?.read?.(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
// 수집 칸과 같은 drive-summary GET ?action=status 한 번(ai_usage 칸)을 함께 쓴다(탭마다 10분 한 번, 요청을 늘리지 않음).
export function readAiUsage(rt) {
  return readDriveStatus(rt).then(data => readSummary(data?.ai_usage), () => null);
}

export function mountAiUsageLine(host, {rt = window.KPTURuntime, now = () => Date.now()} = {}) {
  if (!host) return null;
  host.hidden = true;
  let alive = true, run = 0, shown = null, open = false;
  const panelId = 'homeAiUsagePanel';
  function paint(s) {
    shown = s;
    if (!s) { host.hidden = true; host.innerHTML = ''; return; }
    const at = now(), warn = warnText(s);
    const head = `<button type="button" class="aiu-open" data-aiu-toggle aria-expanded="${open}" aria-controls="${panelId}"${warn ? ' data-warn' : ''}>`
      + (warn ? `<svg class="aiu-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 2.5 16.5h15zM10 8.5v3.5M10 14.2v.3"/></svg><span class="aiu-sum">${esc(warn)}</span>`
        : `<span class="aiu-title">${esc(titleText(s, at))}</span><span class="aiu-sum">${esc(summaryLine(s, at))}</span>`)
      + `<span class="aiu-chevron" aria-hidden="true">${open ? '접기 ▴' : '펼치기 ▾'}</span></button>`;
    // 경고 줄일 때는 펼친 칸 맨 위에 기간·요약을 한 번 보인다.
    const top = warn ? `<p class="aiu-head-line"><span class="aiu-title">${esc(titleText(s, at))}</span> <span>${esc(summaryLine(s, at))}</span></p>` : '';
    const panel = `<div class="aiu-panel" id="${panelId}" role="region" aria-label="AI 사용량 자세히"${open ? '' : ' hidden'}>${top}<ul class="aiu-list">${detailRows(s)}</ul></div>`;
    host.innerHTML = head + panel;
    host.hidden = false;
  }
  async function refresh() {
    if (!isOwner(rt)) { paint(null); return; }
    const mine = ++run, scope = scopeOf(rt);
    const s = await readAiUsage(rt);
    if (!alive || mine !== run || scope !== scopeOf(rt)) return;
    paint(s);
  }
  function onClick(event) {
    const b = event.target.closest('button');
    if (!b || !host.contains(b) || !b.matches('[data-aiu-toggle]')) return;
    open = !open; paint(shown);
    host.querySelector('[data-aiu-toggle]')?.focus({preventScroll:true});
  }
  host.addEventListener('click', onClick);
  return {refresh, destroy() { alive = false; run++; host.removeEventListener('click', onClick); }};
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
