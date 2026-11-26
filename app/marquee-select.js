// UI-끌어고르기(S69-17, 명진 11/24 08:30 "자료실에서 선택 말고 드래그해서 파일 선택 가능하게"): PC 마우스로 빈 곳에서 끌면 반투명 사각형, 닿은 줄을 고른다(윈도우 탐색기처럼).
// - 공용 부품: 사각형 그리기·닿은 줄 계산·가장자리 저절로 굴리기(drag-edge-scroll.js createEdgeScroll)만 맡는다. 고른 상태의 주인은 부르는 화면의 선택 모드(select-mode.js) 하나이고,
//   이 부품은 onChange(닿은 열쇠들, 더하기인지)로 알리기만 한다(따로 고른 목록을 두지 않음). 기기 저장 없음.
// - 시작은 마우스 왼쪽 단추만(손가락·펜은 그대로 — 폰은 길게 누르기). 빈 곳인지는 부르는 화면이 blank(target, x, y)로 정한다.
//   줄 위에서 누르면 시작하지 않아 줄 끌어 옮기기(HTML 끌기)·글자 고르기·폴더 나무는 지금 그대로다.
//   S71-45: 목록 줄은 아이콘 + 이름 글자 위만 '줄 위'(onGrip), 같은 줄의 나머지는 빈 곳이다.
// - 빈 곳에서 누르면 mousedown 기본 동작을 막아 글자 고르기·HTML 끌기가 시작되지 않는다. 손을 THRESHOLD px 넘게 움직여야 사각형이 시작되고,
//   그 전에 떼면 보통 클릭 그대로(빈 줄 오른쪽을 누르면 그 줄이 열리는 것 등). 사각형을 그린 뒤 떼면 바로 다음 클릭 하나는 먹는다.
// - Ctrl·Shift(맥 Cmd)와 함께 끌면 끌기 전 고른 것에 더한다. 아니면 사각형에 닿은 것만.
// - 사각형은 시작한 칸(굴러가는 칸) 안 좌표로 기억해, 굴러가도(휠·가장자리 굴리기) 시작점이 따라간다.
// - S69(명진 11/24 "창 밖에서도 창 안으로 드래그" · "어느곳에서든 자유롭게"): 사각형은 화면(창) 기준으로 그린다 — 시작한 칸 경계에 갇히지 않고
//   칸 밖에서 시작해 칸 안으로, 칸 안에서 시작해 칸 밖으로 자유롭게 끈다. 어디서 시작할 수 있는지는 부르는 화면의 area·blank가 정한다.
import {createEdgeScroll, scrollBoxesAt} from './drag-edge-scroll.js';
import {partStyles} from './part-styles.js';

await partStyles('marquee-select');

export const THRESHOLD = 4;

// 두 점 → 사각형(왼·위·오른·아래). 화면 없이 시험한다.
export function rectOf(a, b) {
  return {left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y)};
}
// 두 사각형이 넓이 있게 겹치나(모서리만 닿으면 아님, 크기 0인 숨은 줄은 아님). 화면 없이 시험한다.
export function overlaps(r, box) {
  if (!box || !(box.right > box.left) || !(box.bottom > box.top)) return false;
  return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
}
// 사각형에 닿은 열쇠들(차례 그대로, 겹침 없음). items: [{key, box}]. 화면 없이 시험한다.
export function hitKeys(r, items) {
  const out = [];
  for (const it of items || []) if (it && it.key != null && overlaps(r, it.box) && !out.includes(it.key)) out.push(it.key);
  return out;
}
// 끄는 동안 고른 것: 더하기면 처음 고른 것 ∪ 닿은 것, 아니면 닿은 것만. 화면 없이 시험한다.
export function mergePick(base, hit, additive) {
  return new Set([...(additive ? base || [] : []), ...(hit || [])]);
}
// 손이 문턱을 넘었나. 화면 없이 시험한다.
export const passed = (a, b, t = THRESHOLD) => Math.abs(b.x - a.x) > t || Math.abs(b.y - a.y) > t;

// STD-끌기시작(S71-45, 2026-11-26 사용자 결정 "폴더 모양, 폴더명 위에서만 드래그가 안돼 왜냐면 거기서 클릭하면 그 폴더 클릭이니까"):
// 목록 줄의 '잡는 곳' = 아이콘 + 이름 글자 위. 거기서 끌면 줄 옮기기, 같은 줄의 그 밖(이름 오른쪽 빈 곳·바뀐 날·크기·종류 칸·아이콘 왼쪽 띠·줄 오른쪽 여백)은
// 빈 곳 = 사각형 고르기(윈도 탐색기와 같음). 화면마다 따로 재지 않고 이 판정 하나를 쓴다(blank에서 부른다).
// 점이 상자들 중 하나 안인가(pad px 넓혀서). 화면 없이 시험한다.
export function inBoxes(x, y, boxes, pad = 2) {
  return (boxes || []).some(b => b && b.right > b.left && b.bottom > b.top && x >= b.left - pad && x <= b.right + pad && y >= b.top - pad && y <= b.bottom + pad);
}
// 두 상자의 겹친 부분(없으면 null). 화면 없이 시험한다.
export function clipBox(a, b) {
  if (!a || !b) return null;
  const r = {left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom)};
  return r.right > r.left && r.bottom > r.top ? r : null;
}
// 줄의 잡는 곳 상자들: icon(선택자)은 그 칸 전체, name(선택자)은 실제 글자가 그려진 폭만(잘린 이름은 보이는 칸 안까지).
export function gripBoxes(row, {icon = '', name = ''} = {}) {
  const out = [], doc = row?.ownerDocument;
  if (!row || !doc) return out;
  const shown = el => el.getClientRects().length > 0;
  if (icon) for (const el of row.querySelectorAll(icon)) if (shown(el)) out.push(el.getBoundingClientRect());
  if (name) for (const el of row.querySelectorAll(name)) {
    if (!shown(el)) continue;
    const box = el.getBoundingClientRect();
    if (!String(el.textContent || '').trim()) { out.push(box); continue; }
    const range = doc.createRange();
    range.selectNodeContents(el);
    const text = clipBox(range.getBoundingClientRect(), box);
    range.detach?.();
    if (text) out.push(text);
  }
  return out;
}
// (x, y)가 그 줄의 잡는 곳(아이콘 + 이름 글자) 위인가.
export const onGrip = (row, x, y, grip) => inBoxes(x, y, gripBoxes(row, grip));

// area 안에서 끌어 고르기를 켠다.
// enabled(): 지금 켤 수 있나(PC 마우스 화면·바쁘지 않음 등). blank(target, x, y): 그 자리가 빈 곳인가.
// items(start): 고를 수 있는 요소들(start = 누른 요소, 두 칸이면 그 칸만 돌려줄 수 있다). keyOf(el): 요소 → 열쇠.
// live(el): 화면이 다시 그려져 시작 칸이 문서에서 빠졌을 때 같은 자리의 새 칸(없으면 화면). 고르면서 선택 모드가 켜져 목록이 다시 그려질 수 있다.
// anchor(target): 화면(문서)이 굴러가는 경우 시작점을 붙여 둘 요소(그 요소와 함께 움직인다. 없으면 area). 칸이 따로 굴러가면 그 칸에 붙인다.
//   시작점은 이 요소 기준으로 기억해, 선택 막대가 나타나 목록이 밀려 내려가도 처음 누른 줄에 붙어 있다.
// begin(additive): 사각형이 막 시작됨 → 처음 고른 것(Set 또는 배열)을 돌려준다. onChange(Set, additive): 고른 것이 바뀜. end(): 끝남.
export function bindMarquee(area, {enabled = () => true, blank = () => false, items = () => [], keyOf = el => el?.dataset?.key, live = () => null, anchor = () => null, begin = () => [], onChange = () => {}, end = () => {}, win = typeof window === 'undefined' ? null : window} = {}) {
  if (!area || !win) return {stop() {}, get active() { return false; }};
  const doc = win.document;
  let s = null;
  const scrollY = node => node?.scrollTop || 0;
  const page = () => doc.scrollingElement || doc.documentElement;
  const relive = () => {
    if (!s) return;
    const own = s.ref === s.box;
    if (!s.box.isConnected) s.box = live(s.box) || page();
    if (own) s.ref = s.box; else if (!s.ref.isConnected) s.ref = live(s.ref) || area;
  };
  const refAt = () => { const r = s.ref === page() ? {left: 0, top: 0} : s.ref.getBoundingClientRect(); return {x: r.left, y: r.top}; };
  // 지금 화면에서 시작점이 있는 자리: 붙인 요소가 움직인 만큼 + (붙인 요소가 굴러가는 칸 자신이면) 굴러간 만큼.
  const startNow = () => { const r = refAt(); return {x: s.x0 + r.x - s.r0.x, y: s.y0 + r.y - s.r0.y - (s.ref === s.box ? scrollY(s.box) - s.sy0 : 0)}; };
  const draw = () => {
    if (!s?.on) return;
    relive();
    const r = rectOf(startNow(), {x: s.x, y: s.y});
    // 보이는 사각형은 창 안으로만 자른다(굴러서 창 밖으로 나간 부분은 그리지 않음). 닿은 줄 계산은 자르지 않은 사각형으로.
    const c = {left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight};
    const v = {left: Math.max(r.left, c.left), top: Math.max(r.top, c.top), right: Math.min(r.right, c.right), bottom: Math.min(r.bottom, c.bottom)};
    Object.assign(s.el.style, {left: v.left + 'px', top: v.top + 'px', width: Math.max(0, v.right - v.left) + 'px', height: Math.max(0, v.bottom - v.top) + 'px'});
    const hit = hitKeys(r, [...items(s.start)].map(el => ({key: keyOf(el), box: el.getBoundingClientRect()})));
    const sig = hit.join('\n');
    if (sig === s.sig) return;
    s.sig = sig;
    onChange(mergePick(s.base, hit, s.additive), s.additive);
  };
  const finish = (cancel = false) => {
    if (!s) return;
    const was = s;
    s = null;
    win.removeEventListener('mousemove', onMove, true);
    win.removeEventListener('mouseup', onUp, true);
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('blur', onBlur);
    if (!was.on) return;
    was.edge.stop();
    was.el.remove();
    doc.documentElement.classList.remove('marquee-on');
    // 사각형을 그린 뒤 떼면 나오는 클릭 하나는 먹는다(빈 곳 클릭으로 다른 일이 일어나지 않게). 다음 차례에 저절로 풀린다.
    const eat = e => { e.stopPropagation(); e.preventDefault(); };
    win.addEventListener('click', eat, {capture: true, once: true});
    win.setTimeout(() => win.removeEventListener('click', eat, true), 0);
    if (cancel) onChange(new Set(was.base), was.additive);
    end();
  };
  const onMove = e => {
    if (!s) return;
    if (!(e.buttons & 1)) { finish(); return; }
    s.x = e.clientX; s.y = e.clientY;
    if (!s.on) {
      if (!passed({x: s.x0, y: s.y0}, s)) return;
      s.on = true;
      win.getSelection?.()?.removeAllRanges?.();
      doc.documentElement.classList.add('marquee-on');
      s.el = doc.createElement('div');
      s.el.className = 'marquee-box';
      s.el.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(s.el);
      s.base = [...(begin(s.additive) || [])];
      s.edge = createEdgeScroll({win, prefer: () => s?.box || null, onScroll: () => draw()});
    }
    e.preventDefault();
    relive();
    s.edge.update(s.x, s.y, s.box === page() ? null : s.box);
    draw();
  };
  const onUp = () => finish();
  const onKey = e => { if (e.key === 'Escape' && s?.on) { e.preventDefault(); e.stopPropagation(); finish(true); } };
  const onBlur = () => finish();
  const onScrollAny = () => { if (s?.on) draw(); };
  area.addEventListener('mousedown', e => {
    if (s || e.button !== 0 || e.altKey || !enabled()) return;
    const t = e.target;
    if (!(t instanceof win.Element) || !blank(t, e.clientX, e.clientY)) return;
    e.preventDefault(); // 빈 곳: 글자 고르기·HTML 끌기를 시작하지 않는다(클릭은 그대로 온다)
    // 기본 동작을 막으면 글자 칸에서 초점이 빠지지 않는다 — 빈 곳 누르기는 보통처럼 입력칸 초점을 놓는다(바깥 누르기 = 저장 같은 동작이 그대로).
    const focused = doc.activeElement;
    if (focused && focused !== doc.body && !focused.contains(t) && focused.matches?.('input,textarea,select,[contenteditable],[contenteditable] *')) focused.blur();
    const boxes = scrollBoxesAt(t, {doc});
    const box = boxes[0]?.node || page();
    const ref = box === page() ? (anchor(t) || area) : box;
    s = {ref, r0: {x: 0, y: 0},
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, start: t, box, sy0: scrollY(box), on: false, sig: null,
      additive: !!(e.ctrlKey || e.metaKey || e.shiftKey), base: [],
    };
    s.r0 = refAt();
    win.addEventListener('mousemove', onMove, true);
    win.addEventListener('mouseup', onUp, true);
    win.addEventListener('keydown', onKey, true);
    win.addEventListener('blur', onBlur);
  });
  win.addEventListener('scroll', onScrollAny, true);
  return {stop: () => finish(true), get active() { return !!s?.on; }};
}
