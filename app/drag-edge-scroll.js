// UI-끌기가장자리스크롤(S69-15, 사용자 11/24 08:19 "자료를 클릭해서 드래그할 때 스크롤이 가능해야 함."): 끄는 동안 저절로 굴리기 — 모든 끌기의 공용 부품.
// - 포인터(손가락) 아래에서 가장 안쪽의 세로로 굴러가는 칸(두 칸 보기의 각 칸 목록·폴더 나무·목록 상자·화면)을 찾아,
//   그 칸의 위·아래 가장자리 EDGE px 안이면 그쪽으로 굴린다(가장자리에 가까울수록 빠르게). 그 칸이 그 방향 끝까지 굴렀으면 바깥 칸(끝은 화면)으로 넘긴다.
// - 손을 멈춰도 가장자리에 있는 동안 계속 굴린다(requestAnimationFrame). 굴린 뒤에는 onScroll(x, y)로 알려 받는 화면이 놓을 곳 표시를 다시 본다.
// - HTML 끌기(PC 마우스): installDragEdgeScroll()이 문서 전체 dragover 하나로 맡는다(앱 안에서 시작한 끌기만, 끝나면 drop·dragend로 멈춤). 화면마다 따로 계산하지 않는다.
//   원인(사실): 전에는 자료실이 목록 상자의 바깥 칸(#documentList의 부모)만 굴려서, 두 칸 보기처럼 칸마다 따로 굴러가는 목록(.lu-pane-list)은 끄는 동안 움직이지 않았다.
//   [파일]·프로젝트 순서·빠른 링크 등 다른 HTML 끌기는 저절로 굴리기가 아예 없었다.
// - 휠: Windows의 크롬·엣지는 HTML 끌기 중 운영체제가 끌기를 맡아 휠 신호를 화면에 보내지 않는다(화면 코드로 받을 수 없음). 휠 신호가 오는 브라우저는
//   기본 굴리기가 그대로 되고, 막는 코드는 두지 않는다. 대신 가장자리 굴리기가 같은 일을 한다.
// - 손가락·포인터로 끄는 부품(touch-drag.js·reorder-drag.js·자료실 길게 눌러 끌기·달력 일정 끌기·조직 묶음 끌기)은 createEdgeScroll()로 같은 계산을 쓴다. 기기 저장 없음.
// - 옆으로 넘치는 칸(보드·표·넓힌 달력)은 왼쪽·오른쪽 가장자리에서 옆으로도 굴린다(S70-75, 아래 pickScrollX).
// - PC HTML 끌기 문서 하나는 이 부품을 처음 부를 때 붙는다(맨 아래). 앱 바탕(topbar-actions.js → reorder-drag.js)이 시작 때 부르므로 어느 화면에서 끌어도 같다(S70-75).
export const EDGE = 48, EDGE_MAX = 20;

// 끝에 가까울수록 빠르게(1~max px/프레임). 위쪽은 음수, 아래쪽은 양수, 그 밖은 0. 칸이 너무 작으면(가장자리 둘이 겹침) 0. 화면 없이 시험한다.
export function edgeSpeed(y, top, bottom, edge = EDGE, max = EDGE_MAX) {
  const Y = Number(y), T = Number(top), B = Number(bottom);
  if (![Y, T, B].every(Number.isFinite) || B - T < edge * 2) return 0;
  if (Y < T + edge) return -Math.max(1, Math.round(max * Math.min(1, (T + edge - Y) / edge)));
  if (Y > B - edge) return Math.max(1, Math.round(max * Math.min(1, (Y - (B - edge)) / edge)));
  return 0;
}

// 칸 하나({top, bottom, scrollTop, scrollHeight, clientHeight})가 v 방향으로 더 굴러갈 수 있나. 화면 없이 시험한다.
export const canScroll = (box, v) => v < 0 ? box.scrollTop > 0 : v > 0 ? box.scrollTop + box.clientHeight < box.scrollHeight - 1 : false;

// 칸 목록(안쪽 → 바깥)에서 y에 맞는 첫 칸과 속도. 가장자리 안이지만 끝까지 구른 칸은 건너뛴다. 화면 없이 시험한다.
export function pickScroll(boxes, y, edge = EDGE, max = EDGE_MAX) {
  for (const box of boxes || []) {
    const v = edgeSpeed(y, box.top, box.bottom, edge, max);
    if (v && canScroll(box, v)) return {box, v};
  }
  return null;
}

// S70-75: 화면 위·아래에 늘 떠 있는 줄(폰 아래 메뉴 막대·앱 머리줄처럼 fixed·sticky, 화면 1/3보다 낮은 줄)은 굴러가는 칸이 아니다 — 그 줄 바로 안쪽이 화면 끝이다.
// 원인(사실): 화면 끝을 창 끝으로 재서, 폰에서는 아래 가장자리(48px)가 모두 아래 막대(56px) 밑이라 목록 맨 아래 줄 위에 대고 있어도 굴러가지 않았다.
// 그 줄 위에 손가락이 있으면 가장 빠르게 굴린다(가장자리 밖 = 가장 가까움).
export function viewBand(doc) {
  const win = doc.defaultView || window, H = win.innerHeight, W = win.innerWidth;
  const bar = y => {
    for (let n = doc.elementFromPoint?.(W / 2, y); n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) {
      const pos = win.getComputedStyle(n).position;
      if (pos === 'fixed' || pos === 'sticky') { const r = n.getBoundingClientRect(); return r.height < H / 3 ? r : null; }
    }
    return null;
  };
  const t = bar(1), b = bar(H - 1);
  return {top: t && t.top <= 1 ? Math.max(0, t.bottom) : 0, bottom: b && b.bottom >= H - 1 ? Math.min(H, b.top) : H};
}

const scrollsY = (el, win) => {
  if (!el || el.nodeType !== 1) return false;
  const o = win.getComputedStyle(el).overflowY;
  return (o === 'auto' || o === 'scroll' || o === 'overlay') && el.scrollHeight > el.clientHeight + 1;
};
// el부터 바깥으로 세로로 굴러가는 칸들, 끝은 화면(문서). prefer(먼저 볼 칸)가 있으면 맨 앞.
export function scrollBoxesAt(el, {prefer = null, fallback = null, doc = el?.ownerDocument || document} = {}) {
  const win = doc.defaultView || window, out = [], page = doc.scrollingElement || doc.documentElement, band = viewBand(doc);
  const add = (node, rect) => { if (node && !out.some(b => b.node === node)) out.push({node, ...rect}); };
  const boxOf = node => {
    if (node === page) return {top: band.top, bottom: band.bottom, get scrollTop() { return page.scrollTop; }, scrollHeight: page.scrollHeight, clientHeight: win.innerHeight};
    const r = node.getBoundingClientRect();
    return {top: Math.max(band.top, r.top), bottom: Math.min(band.bottom, r.bottom), get scrollTop() { return node.scrollTop; }, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight};
  };
  // 요소가 아닌 칸({getBoundingClientRect, scrollBy} — 예: 화면 전체를 대신하는 칸)은 끝을 알 수 없어 늘 굴릴 수 있다고 본다(그 칸이 알아서 멈춘다).
  if (prefer && prefer.nodeType !== 1 && typeof prefer.scrollBy === 'function' && typeof prefer.getBoundingClientRect === 'function') { const r = prefer.getBoundingClientRect(); add(prefer, {top: r.top, bottom: r.bottom, scrollTop: 1, scrollHeight: Infinity, clientHeight: 0}); }
  else if (prefer && prefer !== page && scrollsY(prefer, win)) add(prefer, boxOf(prefer));
  for (let n = el?.nodeType === 1 ? el : el?.parentElement; n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) if (scrollsY(n, win)) add(n, boxOf(n));
  // fallback: 포인터가 굴러가는 칸 밖(예: 폰 아래 막대 위)이어도 굴릴 목록 칸. 화면 바로 앞.
  //   준 요소가 굴러가지 않으면 그 바깥 첫 굴러가는 칸.
  for (let n = fallback?.nodeType === 1 ? fallback : null; n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) if (scrollsY(n, win)) { add(n, boxOf(n)); break; }
  add(page, boxOf(page));
  return out;
}

// S70-75 STD-끌기자동스크롤(사용자 11/26 08:55 "어디서든 파일이든 노트든 뭐든 드래그하면서 스크롤 되어야한다고 모든화면에서"): 가로로 넘치는 칸(보드·표·넓힌 달력)은 좌우도.
// 원인(사실): 위 계산은 세로만 봐서, 옆으로 넘치는 칸은 끄는 동안 왼쪽·오른쪽 끝에 가도 움직이지 않았다.
// 세로와 같은 규칙(가장자리 EDGE px 안, 가까울수록 빠르게, 가장 안쪽 칸부터, 끝이면 바깥 칸)을 가로 축에 그대로 쓴다.
// 몇 px만 넘치는 칸(테두리·그림자 때문에 생긴 넘침)은 옆으로 굴러가는 칸으로 보지 않는다(X_MIN) — 끄는 동안 목록이 옆으로 밀리지 않게.
export const X_MIN = 16;
export const canScrollX = (box, v) => v < 0 ? box.scrollLeft > 0 : v > 0 ? box.scrollLeft + box.clientWidth < box.scrollWidth - 1 : false;
// 칸 목록({left, right, scrollLeft, scrollWidth, clientWidth}, 안쪽 → 바깥)에서 x에 맞는 첫 칸과 속도. 화면 없이 시험한다.
export function pickScrollX(boxes, x, edge = EDGE, max = EDGE_MAX) {
  for (const box of boxes || []) {
    const v = edgeSpeed(x, box.left, box.right, edge, max);
    if (v && canScrollX(box, v)) return {box, v};
  }
  return null;
}
const scrollsX = (el, win) => {
  if (!el || el.nodeType !== 1) return false;
  const o = win.getComputedStyle(el).overflowX;
  return (o === 'auto' || o === 'scroll' || o === 'overlay') && el.scrollWidth > el.clientWidth + X_MIN;
};
// el부터 바깥으로 옆으로 굴러가는 칸들, 끝은 화면(문서). prefer(먼저 볼 칸, 요소)가 옆으로 굴러가면 맨 앞.
export function scrollBoxesXAt(el, {prefer = null, doc = el?.ownerDocument || document} = {}) {
  const win = doc.defaultView || window, out = [], page = doc.scrollingElement || doc.documentElement;
  const add = node => {
    if (!node || out.some(b => b.node === node)) return;
    if (node === page) { out.push({node, left: 0, right: win.innerWidth, get scrollLeft() { return page.scrollLeft; }, scrollWidth: page.scrollWidth > win.innerWidth + X_MIN ? page.scrollWidth : win.innerWidth, clientWidth: win.innerWidth}); return; }
    const r = node.getBoundingClientRect();
    out.push({node, left: Math.max(0, r.left), right: Math.min(win.innerWidth, r.right), get scrollLeft() { return node.scrollLeft; }, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth});
  };
  if (prefer?.nodeType === 1 && prefer !== page && scrollsX(prefer, win)) add(prefer);
  for (let n = el?.nodeType === 1 ? el : el?.parentElement; n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) if (scrollsX(n, win)) add(n);
  add(page);
  return out;
}

// S70-10 UI-끌기자동스크롤(사용자 11/25 09:43 "이렇게 드래그할 때 스크롤 되어야 해"): 'n개 더 보기'로 접힌 목록은 끝까지 굴러도 아래 줄이 없다.
// 원인(사실): 자료실 한 칸 폴더 보기는 처음 20개 + '20개 더 보기'라, 화면이 끝까지 구르면 굴릴 칸이 없어 더 내려가지 않았다.
// 그래서 아래 가장자리에 MORE_DWELL 동안 머물면 그 칸 안 '더 보기' 단추(공용 줄 .ft-more-row, 화면마다 붙인 [data-drag-more])를 누른다 — 화면의 '더 보기' 동작 그대로.
export const MORE_DWELL = 600, MORE_SEL = '.ft-more-row, [data-drag-more]';
// 단추 칸(rect)이 칸(box) 안에 보이고, 포인터 x가 그 줄의 부모 폭 안인가. 화면 없이 시험한다.
export const moreVisible = (r, box, x, lane = r) => r.height > 0 && r.top < box.bottom && r.bottom > box.top && x >= lane.left && x <= lane.right;
// 아래 가장자리(edgeSpeed > 0)인 칸 중 안쪽부터, 그 칸 안에 보이는 '더 보기' 단추 하나.
export function moreAtEdge(boxes, x, y, doc, edge = EDGE) {
  const page = doc?.scrollingElement || doc?.documentElement;
  for (const box of boxes || []) {
    if (!(edgeSpeed(y, box.top, box.bottom, edge) > 0)) continue;
    const root = box.node === page || box.node?.nodeType !== 1 ? doc : box.node;
    for (const b of root?.querySelectorAll?.(MORE_SEL) || []) {
      if (b.disabled || b.hidden) continue;
      const lane = (b.parentElement || b).getBoundingClientRect();
      if (moreVisible(b.getBoundingClientRect(), box, x, lane)) return b;
    }
  }
  return null;
}

// S70-10: 손가락 끌기 도중 목록이 다시 그려져(가장자리에서 '더 보기'가 열림) 처음 누른 칸이 화면에서 빠지면, 브라우저는 그 뒤 손가락 신호를
// 빠진 칸에만 보내 끌기 부품(목록 상자에 붙은 받는 곳)까지 오지 않는다. 빠진 동안만 그 칸에서 같은 처리로 받는다(붙어 있으면 받는 곳이 받으니 두 번 처리하지 않음).
// 잡을 때 부르고, 끝나면 돌려받은 함수로 뗀다. 모든 손가락 끌기 부품(touch-drag.js·reorder-drag.js·자료실)이 이 하나를 쓴다.
export function followTouch(target, {move = () => {}, end = () => {}, cancel = () => {}} = {}) {
  if (!target?.addEventListener) return () => {};
  const lone = f => e => { if (!target.isConnected) f(e); }, m = lone(move), en = lone(end), cc = lone(cancel);
  target.addEventListener('touchmove', m, {passive: false}); target.addEventListener('touchend', en, {passive: false}); target.addEventListener('touchcancel', cc);
  return () => { target.removeEventListener('touchmove', m); target.removeEventListener('touchend', en); target.removeEventListener('touchcancel', cc); };
}

// 끄는 동안 굴리기 하나. update(x, y, target?)를 움직일 때마다 부르고, 끝나면 stop(). prefer(target) → 먼저 굴릴 칸(없으면 포인터 아래), fallback(target) → 포인터 아래 칸들 다음(화면 앞)에 볼 칸.
// onScroll(x, y): 굴린 직후(손가락 아래 놓을 곳을 다시 볼 때). target을 안 주면 그 점의 요소(elementFromPoint).
// stale(ms): 그동안 update가 없으면 멈춘다(0 = 끝 신호까지 계속, 손가락·포인터 끌기는 끝 신호를 늘 받는다).
export function createEdgeScroll({win = typeof window === 'undefined' ? null : window, prefer = () => null, fallback = () => null, onScroll = () => {}, edge = EDGE, max = EDGE_MAX, stale = 0, moreDwell = MORE_DWELL} = {}) {
  let at = null, raf = 0;
  const doc = win?.document;
  const tick = () => {
    raf = 0;
    if (!at || !doc) return;
    if (stale && Date.now() - at.t > stale) { at = null; return; } // 소식이 끊긴 끌기(끝 신호를 못 받음)는 멈춘다
    const el = at.target?.isConnected ? at.target : doc.elementFromPoint(at.x, at.y);
    const first = prefer(el);
    const boxes = scrollBoxesAt(el, {prefer: first, fallback: fallback(el), doc});
    const hit = pickScroll(boxes, at.y, edge, max), side = pickScrollX(scrollBoxesXAt(el, {prefer: first, doc}), at.x, edge, max);
    if (side) { side.box.node.scrollBy(side.v, 0); at.target = null; } // 옆으로 넘치는 칸: 왼쪽·오른쪽 가장자리면 그쪽으로(세로와 함께 굴 수 있다)
    if (!hit && side) { onScroll(at.x, at.y); if (at) raf = win.requestAnimationFrame(tick); return; }
    if (!hit) {
      // S70-10: 아래 가장자리인데 더 굴러갈 칸이 없고 그 칸 안에 'n개 더 보기'가 보이면, 머물러 있는 동안(MORE_DWELL) 그 단추를 눌러 다음 묶음을 연다.
      const more = moreAtEdge(boxes, at.x, at.y, doc, edge);
      if (!more) { at.more = null; return; } // 가장자리 밖: 다음 update까지 쉰다
      if (at.more?.el !== more) at.more = {el: more, t: Date.now()};
      else if (Date.now() - at.more.t >= moreDwell) { at.more = null; more.click(); at.target = null; onScroll(at.x, at.y); }
      if (at) raf = win.requestAnimationFrame(tick); // 손가락이 멈춰 있어도 머문 시간을 잰다
      return;
    }
    hit.box.node.scrollBy(0, hit.v);
    at.target = null; // 굴렀으니 포인터 아래가 바뀌었을 수 있다
    onScroll(at.x, at.y);
    if (at) raf = win.requestAnimationFrame(tick);
  };
  return {
    update(x, y, target = null) {
      if (!win || !Number.isFinite(x) || !Number.isFinite(y)) return;
      at = {x, y, target, t: Date.now(), more: at?.more || null};
      if (!raf) raf = win.requestAnimationFrame(tick);
    },
    stop() { at = null; if (raf) win.cancelAnimationFrame(raf); raf = 0; },
    active: () => !!at,
  };
}

// PC HTML 끌기 전체(앱 안에서 시작한 끌기): 문서 dragover 하나로 가장자리 굴리기. 여러 화면이 불러도 한 번만 붙는다.
// 바깥(바탕화면) 파일 끌기는 앱 안 dragstart가 없으므로 건드리지 않는다(지금 동작 그대로).
const INSTALLED = Symbol.for('kptu.dragEdgeScroll'), STALE_MS = 1500;
export function installDragEdgeScroll(win = typeof window === 'undefined' ? null : window) {
  if (!win || win[INSTALLED]) return win?.[INSTALLED] || null;
  const edgeScroll = createEdgeScroll({win, stale: STALE_MS});
  let inApp = false;
  const end = () => { inApp = false; edgeScroll.stop(); };
  win.addEventListener('dragstart', () => { inApp = true; }, true);
  win.addEventListener('dragover', e => { if (inApp) edgeScroll.update(e.clientX, e.clientY, e.target); }, true);
  win.addEventListener('drop', end, true);
  win.addEventListener('dragend', end, true);
  win.addEventListener('blur', end);
  // 끈 줄이 그사이 다시 그려져 dragend가 문서까지 오지 않아도 멈춘다: 끌기가 끝난 뒤 첫 누름, 또는 dragover가 STALE_MS 동안 없으면(아래 stale).
  win.addEventListener('pointerdown', end, true);
  win[INSTALLED] = edgeScroll;
  return edgeScroll;
}
// S70-75: 이 부품을 부르는 순간 문서 하나에 붙인다 — 앱 바탕(topbar-actions.js → reorder-drag.js)이 시작 때 부르므로 모든 화면의 HTML 끌기가 같다.
// 화면마다 installDragEdgeScroll()을 따로 부르던 곳은 그대로 둬도 한 번만 붙는다. 화면 없는 시험(node)에서는 붙이지 않는다.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') installDragEdgeScroll(window);
