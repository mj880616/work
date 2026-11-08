// UI-줄입력늘어나기: 글만큼 아래로 늘어나는 공용 칸(화면마다 따로 만들지 않는다).
// 쓰는 법(선언만): <textarea rows="1" data-autogrow data-enter-field="single"> — 처음 한 줄, 글이 늘면 줄 수만큼 늘어난다.
//   data-autogrow="5"   많아야 5줄까지(넘으면 칸 안에서 스크롤). 값이 없으면 화면 높이의 절반까지.
//   data-enter-field="single" (enter-save.js 와 같은 표시) 한 줄 칸: 붙여 넣은 줄바꿈은 빈칸 하나로 바꾼다(Enter 는 늘 저장).
// 화면은 칸을 그린 뒤 fitAll(그린 자리)을 한 번 부른다 — 열자마자 글 전체가 보이게. 글을 칠 때·칸 폭이 바뀔 때는 이 모듈이 맞춘다
// (문서에 입력 듣기 하나 + 맞춘 칸만 지켜보는 ResizeObserver 하나. MutationObserver 는 쓰지 않는다).
// 높이 셈은 홈 빠른 입력(home-quick.js size())에서 끌어왔다: CSS 최소 높이(한 줄) ≤ 높이 = 글 높이 + 테두리 ≤ 상한.

export const SCREEN_SHARE = 0.5;

// 순수 셈(시험용): min = CSS 최소 높이(한 줄), line = 줄 높이, edge = 위아래 여백+테두리, scroll = scrollHeight, borders = 위아래 테두리,
// maxLines = 줄 상한(0이면 screen*SCREEN_SHARE), screen = 창 높이. {height, scroll: 상한을 넘었나}.
export function growHeight({min = 0, line = 21, edge = 0, scroll = 0, borders = 0, maxLines = 0, screen = 800} = {}) {
  const cap = maxLines > 0 ? line * maxLines + edge : Math.max(min, Math.round(screen * SCREEN_SHARE));
  const want = scroll + borders;
  return {height: Math.max(min, Math.min(cap, want)), scroll: want > cap};
}

const maxLinesOf = el => { const n = Number.parseInt(el?.getAttribute?.('data-autogrow') || '', 10); return Number.isFinite(n) && n > 0 ? n : 0; };

// 칸 하나를 글에 맞춘다. 숨은 칸(높이 0)은 건드리지 않는다. overflow: false 면 스크롤 표시를 칸 CSS 에 맡긴다(홈 빠른 입력 그대로).
export function fitHeight(el, {maxLines = maxLinesOf(el), overflow = true} = {}) {
  if (!el || el.tagName !== 'TEXTAREA') return;
  if (isAutoGrow(el)) { watchWidth(el); keepOneLine(el); } // 숨은 칸도 지켜보다가 보이면(폭이 생기면) 맞춘다. 한 줄 칸에 넣은 글의 줄바꿈은 한 줄 칸(input)처럼 정리
  el.style.height = '';
  const min = el.offsetHeight;
  if (!min) return;
  const s = getComputedStyle(el), px = v => parseFloat(v) || 0;
  const borders = px(s.borderTopWidth) + px(s.borderBottomWidth);
  const r = growHeight({min, line: px(s.lineHeight) || 21, edge: px(s.paddingTop) + px(s.paddingBottom) + borders, scroll: el.scrollHeight, borders, maxLines, screen: el.ownerDocument?.defaultView?.innerHeight || 800});
  el.style.height = `${r.height}px`;
  if (overflow) el.style.overflowY = r.scroll ? 'auto' : 'hidden';
}

// 폭이 바뀌면(폴드 펼침·칸 폭 끌기·창 크기) 다시 맞춘다. 높이만 바뀐 알림은 넘기고, 화면에서 빠진 칸은 놓아 준다.
const widths = new WeakMap();
let ro = null;
function watchWidth(el) {
  if (widths.has(el)) { widths.set(el, el.clientWidth); return; }
  const RO = el.ownerDocument?.defaultView?.ResizeObserver;
  if (!RO) return;
  ro ||= new RO(entries => {
    for (const {target} of entries) {
      if (!target.isConnected) { ro.unobserve(target); widths.delete(target); continue; }
      if (target.clientWidth !== widths.get(target)) fitHeight(target);
    }
  });
  widths.set(el, el.clientWidth);
  ro.observe(el);
}

// 한 줄 칸을 마디로 만들 때(el('input') 자리): 처음 한 줄, Enter 는 그 화면의 저장 그대로, 줄바꿈은 들어가지 않는다.
export function lineField(doc, {value = '', maxLength = 0, className = ''} = {}) {
  const t = doc.createElement('textarea');
  t.rows = 1; t.dataset.autogrow = ''; t.dataset.enterField = 'single'; t.autocomplete = 'off';
  if (className) t.className = className;
  if (maxLength) t.maxLength = maxLength;
  t.value = oneLine(value);
  return t;
}

export const isAutoGrow = el => !!el && el.tagName === 'TEXTAREA' && el.hasAttribute('data-autogrow');

// 한 줄 칸에 들어온 줄바꿈: 끝의 것은 지우고(한글 조합 중 Enter 가 남긴 것) 가운데 것(붙여 넣기)은 빈칸 하나로. 커서는 같은 자리.
export const oneLine = text => String(text ?? '').replace(/(?:\r\n?|\n)+$/, '').replace(/\r\n?|\n/g, ' ');
function keepOneLine(el) {
  if (el.getAttribute('data-enter-field') !== 'single' || !/[\r\n]/.test(el.value)) return;
  const at = el.selectionStart, end = el.selectionEnd, before = el.value.length;
  el.value = oneLine(el.value);
  const d = el.value.length - before;
  try { el.setSelectionRange(at + d, end + d); } catch { /* 커서를 못 옮기는 칸이면 그대로 */ }
}

export function fitAll(root) {
  const list = root?.querySelectorAll ? root.querySelectorAll('textarea[data-autogrow]') : [];
  if (isAutoGrow(root)) fitHeight(root);
  for (const el of list) fitHeight(el);
}

let installed = false;
export function installAutoGrow(doc = globalThis.document) {
  if (installed || !doc?.addEventListener) return;
  installed = true;
  // input 이 칸 자기 듣기보다 먼저 오도록 capture: 줄바꿈을 먼저 지워 화면 상태에도 한 줄 글이 들어간다.
  doc.addEventListener('input', e => { const t = e.target; if (!isAutoGrow(t)) return; keepOneLine(t); fitHeight(t); }, true);
}
installAutoGrow();
