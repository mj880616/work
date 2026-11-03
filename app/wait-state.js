// UI-기다림표시통일(2026-10-29 명진 A안 확정): 앱 전체 '기다림·실패·없음' 표시는 이 부품 하나만 쓴다.
// - 기다림(UI-로딩맨위 2026-11-04 명진 결정): 움직이는 막대는 화면 맨 위 끝 한 곳(position:fixed)에만 뜬다. 칸 안에는 막대가 없고
//   목록 자리에 실제 줄 높이의 회색 빈 줄만 둔다(화면이 출렁이지 않게, '없음'이 번쩍 뜨지 않게).
//   <kptu-wait>(= .wait) 요소가 화면에 붙으면 '시작', 떼어지면(다 읽어서 바뀜·실패·취소·화면 이동) '끝'으로 세어,
//   하나라도 남아 있는 동안 막대 하나가 이어지고 모두 끝나면 사라진다(시작·끝 짝이 요소의 붙음·떼어짐이라 끝 처리가 빠질 수 없다).
//   0.4초 안에 끝나면 아무것도 보이지 않는다(.wait·맨 위 막대 모두 0.4초 늦은 표시).
// - 글줄 안 작은 자리(waitInlineHtml: 건수·상태 줄)는 움직이는 표시 없이 '…' 한 글자(움직이는 표시는 맨 위만).
// - 실패: 빨간 작은 글자 '불러오지 못했습니다'(+ 이유가 있으면 ' · 이유') + 작은 [다시].
// - 없음: 회색 작은 '없음'(필요하면 'n 없음' 같은 짧은 글자).
// 민트(.notice) 상자는 '완료' 알림에만 쓴다. 기다림·빈 화면·안내에 색 상자를 쓰지 않는다.
// 회색 빈 줄 색은 그림 칸(img-slot.js의 받는 중 회색 칸)과 같은 색이다.
// 화면 읽기 프로그램에는 role="status" + aria-label='불러오는 중'으로 알린다(보이는 글자는 없음).
// 기기 저장 없음.
export const WAIT_LABEL = '불러오는 중';
export const FAIL_TEXT = '불러오지 못했습니다';
export const EMPTY_TEXT = '없음';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&quot;'}[c]));
const clampRows = n => Math.max(1, Math.min(8, Number.isFinite(+n) ? Math.round(+n) : 3));
const rowH = h => (Number.isFinite(+h) && +h > 0 ? `${Math.min(120, Math.round(+h))}px` : '');

// 기다림(블록). rows: 회색 빈 줄 수(기본 3), h: 줄 높이 px(그 목록의 실제 줄 높이, 기본 20).
export function waitHtml({rows = 3, h = 0} = {}) {
  const height = rowH(h);
  const style = height ? ` style="--wait-h:${height}"` : '';
  return `<kptu-wait class="wait" data-wait role="status" aria-label="${WAIT_LABEL}"${style}>${'<span class="wait-row" aria-hidden="true"></span>'.repeat(clampRows(rows))}</kptu-wait>`;
}
// 기다림(글줄 안 한 칸: 건수·한 줄 요약 자리). 움직이는 표시 없이 '…' 한 글자.
export function waitInlineHtml() {
  return `<kptu-wait class="wait wait-inline" data-wait role="status" aria-label="${WAIT_LABEL}"><span aria-hidden="true">…</span></kptu-wait>`;
}
// 실패. retry: [다시] 버튼에 붙일 속성 이름(그 화면의 기존 다시 받기 처리기가 받는다, 예 'data-diary-retry'). 없으면 [다시] 없음.
// reason(PHOTO-폰사진못읽음): 그 화면이 만든 실제 이유 글. 있으면 '불러오지 못했습니다 · 이유'로 같은 빨간 작은 글자에 붙인다(200자까지).
export const REASON_MAX = 200;
export function failHtml({retry = '', text = FAIL_TEXT, reason = ''} = {}) {
  const attr = /^data-[a-z0-9-]+$/.test(retry) ? ` ${retry}` : '';
  const button = attr ? ` <button type="button" class="wait-retry"${attr}>다시</button>` : '';
  const why = String(reason ?? '').trim().slice(0, REASON_MAX);
  const reasonHtml = why ? `<span class="wait-reason" data-wait-reason> · ${esc(why)}</span>` : '';
  return `<p class="wait-fail" data-wait-fail role="alert">${esc(text)}${reasonHtml}${button}</p>`;
}
// 없음. text: 기본 '없음'(같은 화면에 빈 칸이 여럿이라 구분이 필요하면 '일정 없음'처럼 짧게).
// attrs: 그 화면이 찾는 표시(예 'data-journal-events-empty', 'data-cf-empty="none" hidden'). data-*·hidden·id 만 받는다.
const EMPTY_ATTRS = /^(?:\s*(?:data-[a-z0-9-]+(?:="[\w\- ]*")?|hidden|id="[\w-]+"))*\s*$/;
export function emptyHtml(text = EMPTY_TEXT, {attrs = ''} = {}) {
  const extra = attrs && EMPTY_ATTRS.test(attrs) ? ` ${attrs.trim()}` : '';
  return `<p class="wait-empty" data-wait-empty${extra}>${esc(text || EMPTY_TEXT)}</p>`;
}

const fromHtml = html => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild; };
export const waitEl = opts => fromHtml(waitHtml(opts));
export const waitInlineEl = () => fromHtml(waitInlineHtml());
// 실패(요소). onRetry 함수를 주면 [다시]를 누를 때 부른다.
export function failEl({onRetry = null, text = FAIL_TEXT, reason = ''} = {}) {
  const node = fromHtml(failHtml({retry: onRetry ? 'data-wait-retry' : '', text, reason}));
  if (onRetry) node.querySelector('button').addEventListener('click', event => { event.preventDefault(); onRetry(); });
  return node;
}
export const emptyEl = (text, opts) => fromHtml(emptyHtml(text, opts));

// 칸 안을 통째로 바꾼다.
export function showWait(host, opts) { host?.replaceChildren(waitEl(opts)); }
export function showFail(host, opts) { host?.replaceChildren(failEl(opts)); }
export function showEmpty(host, text, opts) { host?.replaceChildren(emptyEl(text, opts)); }

// 칸 안에 아무것도 그리지 않고 맨 위 막대에 '시작'만 알린다(보이는 것 없음). 요소가 떼어지면 '끝'. 메뉴 화면 프로그램을 처음 받을 때(loader-v2.js) 등.
export function barHtml() {
  return `<kptu-wait class="wait wait-only-bar" data-wait role="status" aria-label="${WAIT_LABEL}"></kptu-wait>`;
}

// ---- 화면 맨 위 막대 하나(공용 카운터) ----
const active = new Set();      // 지금 화면에 붙어 있는 <kptu-wait>
let topBar = null, offTimer = 0, pollTimer = 0;
// 화면에 실제로 보이는 것(숨긴 칸·가려진 화면에 남은 것은 막대를 잡지 않는다)이 하나라도 있으면 true.
const anyVisible = () => { for (const el of active) { if (el.isConnected && (typeof el.checkVisibility !== 'function' || el.checkVisibility())) return true; } return false; };
function showTop() {
  clearTimeout(offTimer); offTimer = 0;
  if (topBar?.isConnected) return;
  topBar = document.createElement('div');
  topBar.className = 'top-wait';
  topBar.setAttribute('role', 'status');
  topBar.setAttribute('aria-label', WAIT_LABEL);
  topBar.innerHTML = '<span class="top-wait-run" aria-hidden="true"></span>';
  (document.body || document.documentElement).appendChild(topBar);
}
function hideTop() {
  if (offTimer) return;
  // 읽기가 이어서 시작되는 짧은 틈에 막대가 깜빡이지 않게 120ms 뒤에 다시 확인한다.
  offTimer = setTimeout(() => { offTimer = 0; if (anyVisible()) return; topBar?.remove(); topBar = null; }, 120);
}
function sync() {
  if (anyVisible()) { showTop(); if (!pollTimer) pollTimer = setInterval(sync, 1000); }
  else { hideTop(); if (!active.size && pollTimer) { clearInterval(pollTimer); pollTimer = 0; } }
}
// 시험·진단용: 지금 세고 있는 기다림 수.
export const waitCount = () => active.size;

if (typeof customElements !== 'undefined' && !customElements.get('kptu-wait')) {
  customElements.define('kptu-wait', class extends HTMLElement {
    connectedCallback() { active.add(this); sync(); }
    disconnectedCallback() { active.delete(this); sync(); }
  });
}

// 모듈을 쓰지 않는 옛 화면 파일(즉시 실행 함수)도 같은 부품을 쓰게 창에 둔다.
if (typeof window !== 'undefined') {
  window.KPTUWait = Object.freeze({waitHtml, waitInlineHtml, failHtml, emptyHtml, barHtml, waitEl, waitInlineEl, failEl, emptyEl, showWait, showFail, showEmpty, WAIT_LABEL, FAIL_TEXT, EMPTY_TEXT});
}
