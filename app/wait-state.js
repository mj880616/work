// UI-기다림표시통일(2026-10-29 명진 A안 확정): 앱 전체 '기다림·실패·없음' 표시는 이 부품 하나만 쓴다.
// - 기다림: 글자 없이 위쪽 가는 줄이 흐르고, 목록 자리에 실제 줄 높이의 회색 빈 줄(화면이 출렁이지 않게). 0.4초 안에 끝나면
//   아무것도 보이지 않는다(base-ui.css .wait 의 0.4초 늦은 표시 — 글자 HTML 로 넣어도 같은 규칙).
// - 실패: 빨간 작은 글자 '불러오지 못했습니다' + 작은 [다시].
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
  return `<div class="wait" data-wait role="status" aria-label="${WAIT_LABEL}"${style}><span class="wait-bar" aria-hidden="true"></span>${'<span class="wait-row" aria-hidden="true"></span>'.repeat(clampRows(rows))}</div>`;
}
// 기다림(글줄 안 한 칸: 건수·한 줄 요약 자리).
export function waitInlineHtml() {
  return `<span class="wait wait-inline" data-wait role="status" aria-label="${WAIT_LABEL}"><span class="wait-row" aria-hidden="true"></span></span>`;
}
// 실패. retry: [다시] 버튼에 붙일 속성 이름(그 화면의 기존 다시 받기 처리기가 받는다, 예 'data-diary-retry'). 없으면 [다시] 없음.
export function failHtml({retry = '', text = FAIL_TEXT} = {}) {
  const attr = /^data-[a-z0-9-]+$/.test(retry) ? ` ${retry}` : '';
  const button = attr ? ` <button type="button" class="wait-retry"${attr}>다시</button>` : '';
  return `<p class="wait-fail" data-wait-fail role="alert">${esc(text)}${button}</p>`;
}
// 없음.
export function emptyHtml(text = EMPTY_TEXT) {
  return `<p class="wait-empty" data-wait-empty>${esc(text || EMPTY_TEXT)}</p>`;
}

const fromHtml = html => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild; };
export const waitEl = opts => fromHtml(waitHtml(opts));
export const waitInlineEl = () => fromHtml(waitInlineHtml());
// 실패(요소). onRetry 함수를 주면 [다시]를 누를 때 부른다.
export function failEl({onRetry = null, text = FAIL_TEXT} = {}) {
  const node = fromHtml(failHtml({retry: onRetry ? 'data-wait-retry' : '', text}));
  if (onRetry) node.querySelector('button').addEventListener('click', event => { event.preventDefault(); onRetry(); });
  return node;
}
export const emptyEl = text => fromHtml(emptyHtml(text));

// 칸 안을 통째로 바꾼다.
export function showWait(host, opts) { host?.replaceChildren(waitEl(opts)); }
export function showFail(host, opts) { host?.replaceChildren(failEl(opts)); }
export function showEmpty(host, text) { host?.replaceChildren(emptyEl(text)); }

// 위쪽 가는 줄 하나만(글자·빈 줄 없이). 메뉴 화면 프로그램을 처음 받을 때(loader-v2.js) 쓴다.
export function barHtml() {
  return `<div class="wait wait-only-bar" data-wait role="status" aria-label="${WAIT_LABEL}"><span class="wait-bar" aria-hidden="true"></span></div>`;
}

// 모듈을 쓰지 않는 옛 화면 파일(즉시 실행 함수)도 같은 부품을 쓰게 창에 둔다.
if (typeof window !== 'undefined') {
  window.KPTUWait = Object.freeze({waitHtml, waitInlineHtml, failHtml, emptyHtml, barHtml, waitEl, waitInlineEl, failEl, emptyEl, showWait, showFail, showEmpty, WAIT_LABEL, FAIL_TEXT, EMPTY_TEXT});
}
