// STD-메뉴바깥닫기(S70-78, 2026-11-26 명진 "우클릭해서 이 메뉴온 다음에 빈 공간에 좌클릭하면 메뉴 없어져야해"):
// 우클릭 메뉴·⋯ 메뉴·떠 있는 작은 창을 닫는 규칙 한 곳(docs/design/standard-interactions.md 12절 C8). 화면마다 따로 닫기 코드를 두지 않는다.
//   ① 바깥 아무 곳 누름(마우스 왼쪽·오른쪽, 폰 터치) = 닫기만. 그 누름은 다른 동작을 일으키지 않는다(보드 빈 곳 = 새 상자·사각형 고르기 없음,
//      브라우저 메뉴 없음). 예외: 다른 메뉴 단추(⋯·aria-haspopup·data-menu-trigger)를 누르면 앞 메뉴를 닫고 그 단추는 제 일을 한다(④).
//   ② Esc = 맨 위 메뉴 닫기. 폰 뒤로가기 = 닫기(back 이름을 주면 라우터 겹 하나 — 메뉴가 스스로 기록을 다루면 주지 않는다).
//   ③ 바깥 스크롤·휠·창 크기 바뀜·화면 이동(kptu:view-changed) = 닫기.
//   ④ 한 번에 하나: 새 메뉴를 붙이면 앞 메뉴는 닫힌다.
// 창 단계(window) capture에서 먼저 받으므로, 판이 pointerdown을 막아도(노트 보드 캔버스의 preventDefault·stopPropagation·포인터 잡기) 닫힌다.
// 쓰는 법: 열 때 const release = holdMenu(panel, {close(reason) {...}, keep?(target), back?}), 닫을 때(어느 길로든) release() — 겹 뒤로가기 약속을 돌려준다.
// close(reason): 'outside'|'esc'|'scroll'|'resize'|'nav'|'other'|'back' — 'esc'면 메뉴를 연 단추로 초점을 돌려준다(부르는 쪽).
// keep(target): 바깥이 아닌 곳(그 ⋯ 단추 자체 — 다시 누르면 닫히는 토글은 그 단추가 맡는다).
const held = [];
// 닫으며 부른 뒤로가기(메뉴 기록 칸 지우기)가 아직 오지 않은 것들. 새 메뉴의 기록 칸은 그 뒤에 넣는다 — 앞 메뉴의 뒤로가기가 새 칸을 지우지 않게.
const settling = new Set();
const track = r => { if (r && typeof r.then === 'function') { const p = Promise.resolve(r).catch(() => {}); settling.add(p); p.then(() => settling.delete(p)); } };
// 앞 메뉴 닫기가 끝나길 기다릴 것이 있으면 그 약속, 없으면 null(anchored-menu.js open이 기다린다).
export const menusSettling = () => (settling.size ? Promise.all([...settling]) : null);
const now = () => (globalThis.performance?.now?.() ?? Date.now());
const SCROLL_GRACE = 300; // 열면서 생기는 스크롤(초점 옮김·자리 맞춤)은 닫지 않는다
const MORE = new Set(['\u22EF', '\u22EE']); // ⋯ ⋮ 글자 단추(그리는 파일이 아니라 알아보기만 — context-menu-sites 검사 대상 아님)
const NOT_OUTSIDE = '.kptu-ask'; // 메뉴 항목이 띄운 작은 확인창 안은 바깥이 아니다

// 열렸지만 아직 붙지 않은 메뉴 붙이기(S72-REPORT-PHOTO-ESC): <details> ⋯ 메뉴는 열림 알림(toggle)이 따로 늦게 오는 일이라(브라우저가 나중 차례로 보냄),
// 여는 누름 바로 뒤의 Esc·누름이 그 알림보다 먼저 오면 메뉴가 열려 보이는데 지킴이는 모른다 — Esc가 메뉴 대신 그 아래 창(사진 크게 보기 등)을 닫았다.
// 그 메뉴를 쥐는 쪽(details-menu-back.js)이 여기에 확인 하나를 맡기고, Esc·누름을 판정하기 직전에 불러 지금 화면 그대로(열림 속성) 붙인다.
const catchUps = [];
export function catchUpMenus(fn) { if (typeof fn === 'function' && !catchUps.includes(fn)) catchUps.push(fn); }
function catchUp() { for (const fn of catchUps) { try { fn(); } catch (e) { queueMicrotask(() => { throw e; }); } } }

export const menuHeld = () => held.length > 0;
export function isMenuTrigger(target) {
  const b = target instanceof Element ? target.closest('button,summary,[role="button"]') : null;
  if (!b) return false;
  if (b.hasAttribute('data-menu-trigger')) return true;
  // 메뉴를 여는 단추: 펼침 표시(aria-expanded)가 있는 aria-haspopup 단추, 또는 ⋯ 글자 단추. 우클릭으로만 메뉴가 뜨는 칸(보드 이름 칩 등)은
  // 누르면 제 일(보드 바꾸기)을 하므로 메뉴 단추가 아니다 — 바깥 누름으로 삼킨다.
  const pop = b.getAttribute('aria-haspopup');
  if (pop && pop !== 'false' && pop !== 'dialog' && b.hasAttribute('aria-expanded')) return true;
  return MORE.has(b.textContent.trim());
}

// 돌려줌: 겹을 닫으며 부른 뒤로가기의 약속(없으면 null) — 메뉴 항목을 그 뒤에 실행하는 쪽이 기다린다.
function drop(entry) {
  const i = held.indexOf(entry); if (i < 0) return null;
  held.splice(i, 1);
  const layer = entry.layer; entry.layer = null;
  if (!layer || entry.fromBack) return null;
  const r = layer.close?.(); track(r); return r ?? null;
}
function shut(entry, reason) {
  if (!held.includes(entry)) return;
  if (reason === 'back') entry.fromBack = true;
  drop(entry);
  try { track(entry.close(reason)); } catch (e) { queueMicrotask(() => { throw e; }); }
}
function shutAll(reason, keep = null) { for (const e of [...held].reverse()) if (e !== keep) shut(e, reason); }

export function holdMenu(panel, {close, keep = null, back = ''} = {}) {
  if (!panel || typeof close !== 'function') return () => {};
  let entry = held.find(e => e.panel === panel);
  if (entry) { entry.close = close; entry.keep = keep; } // 같은 메뉴를 다시 그려 붙임(목록 다시 그리기) — 겹·열린 때 그대로
  else {
    shutAll('other');
    entry = {panel, close, keep, openedAt: now(), layer: null, fromBack: false};
    held.push(entry);
    if (back) {
      const e = entry;
      const openLayer = () => { if (!held.includes(e) || e.layer) return; e.layer = globalThis.window?.KPTURouter?.layer?.open?.(back, {close: () => { e.layer = null; shut(e, 'back'); return true; }}) || null; };
      const wait = menusSettling(); if (wait) wait.then(openLayer); else openLayer();
    }
  }
  const mine = entry;
  return () => drop(mine);
}
// 열린 메뉴를 모두 닫는다(화면이 스스로 다른 겹을 열 때 등).
export function closeHeldMenus(reason = 'other') { shutAll(reason); }

const inside = (entry, path, target) => path.includes(entry.panel) || !!entry.keep?.(target);

// ① 바깥 누름: 닫고, 그 누름(누름부터 뗀 뒤 클릭·두 번 누름·우클릭 메뉴까지)을 삼킨다.
let swallow = null, prevSwallowed = false, pairSwallowed = false; // {id, until} · 첫 누름을 삼킨 두 번 누르기(dblclick)도 삼킨다
const SWALLOW = ['mousedown', 'mouseup', 'pointerup', 'pointermove', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'click', 'dblclick', 'auxclick', 'contextmenu', 'selectstart'];
function swallowed(e) {
  // 자판으로 낸 누름(Enter·Space의 click은 detail 0, Shift+F10·메뉴 키의 contextmenu는 button 0)은 손짓이 아니다 — 삼키지 않는다.
  if ((e.type === 'click' || e.type === 'dblclick' || e.type === 'auxclick') && e.detail === 0) return false;
  if (e.type === 'contextmenu' && e.button !== 2 && e.pointerType !== 'touch') return false;
  if (e.type === 'dblclick' && pairSwallowed) return true;
  if (!swallow) return false;
  if (now() > swallow.until) { swallow = null; return false; }
  if (e.pointerId !== undefined && e.pointerId !== swallow.id && e.type.startsWith('pointer')) return false;
  if (e.type === 'pointerup' || e.type === 'pointercancel') swallow.until = now() + 450; // 뗀 뒤 오는 click·dblclick·contextmenu까지
  return true;
}
if (typeof window !== 'undefined' && window.addEventListener && !window.__KPTU_MENU_DISMISS__) {
  window.__KPTU_MENU_DISMISS__ = true;
  window.addEventListener('pointerdown', e => {
    swallow = null; // 새 누름 = 새 손짓
    catchUp();
    if (!held.length) return;
    const target = e.target instanceof Element ? e.target : null, path = e.composedPath();
    if (target?.closest?.(NOT_OUTSIDE)) return;
    const out = held.filter(x => !inside(x, path, target));
    if (!out.length) return;
    for (const x of [...out].reverse()) shut(x, 'outside');
    if (isMenuTrigger(target)) return; // ④ 다른 ⋯ = 앞 메뉴 닫고 그 메뉴 열기
    e.preventDefault(); e.stopImmediatePropagation();
    swallow = {id: e.pointerId, until: now() + 5000}; // 뗌(pointerup)이 오면 그 뒤 0.45초까지로 줄인다
  }, {capture: true, passive: false});
  for (const type of SWALLOW) window.addEventListener(type, e => {
    if (type === 'click') { const was = prevSwallowed, hit = swallowed(e); pairSwallowed = !hit && e.detail === 2 && was; prevSwallowed = hit; if (!hit) return; }
    else if (!swallowed(e)) return;
    if (e.cancelable && type !== 'touchstart' && type !== 'touchmove') e.preventDefault();
    e.stopImmediatePropagation();
  }, {capture: true, passive: false});
  // ② Esc = 맨 위 메뉴 닫기(그 화면의 Esc — 고르기 끝·창 닫기 — 는 일어나지 않음).
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.isComposing) return;
    catchUp();
    if (!held.length) return;
    e.preventDefault(); e.stopImmediatePropagation();
    shut(held[held.length - 1], 'esc');
  }, true);
  // ③ 바깥 스크롤·휠·창 크기·화면 이동.
  window.addEventListener('wheel', e => { if (!held.length) return; const path = e.composedPath(), t = e.target instanceof Element ? e.target : null; for (const x of [...held].reverse()) if (!inside(x, path, t)) shut(x, 'scroll'); }, {capture: true, passive: true});
  window.addEventListener('scroll', e => {
    if (!held.length) return;
    const t = e.target instanceof Node ? e.target : null;
    for (const x of [...held].reverse()) if (now() - x.openedAt > SCROLL_GRACE && !(t && t !== document && x.panel.contains(t))) shut(x, 'scroll');
  }, {capture: true, passive: true});
  let size = `${window.innerWidth}x${window.innerHeight}`;
  window.addEventListener('resize', () => {
    const next = `${window.innerWidth}x${window.innerHeight}`, was = size; size = next;
    if (!held.length || next === was) return;
    const a = document.activeElement; if (a?.matches?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])') && !held.some(x => x.panel.contains(a))) return; // 폰 자판이 열리고 닫힘
    shutAll('resize');
  });
  window.addEventListener('kptu:view-changed', () => shutAll('nav'));
}
