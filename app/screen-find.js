// UI-검색창하나로(S70-54, 명진 11/25 21:29 "검색창 두개인데 걍 맨 위 검색창 활용하면 안되나", 설계 docs/design/one-search-bar.md):
// 맨 위 검색 칸이 지금 화면 안 찾기를 겸한다. 이 모듈은 두 가지의 유일한 주인이다.
//  1) 화면 찾기 등록표: 화면이 registerScreenFind(key, {active, label, value, apply})로 자기 걸러 내기 함수를 넘긴다.
//     맨 위 칸(global-search.js)은 지금 화면에 등록된 찾기가 있으면 그 칸의 안내글·글자를 그 찾기 것으로 바꾸고, 칠 때 apply를 부른다.
//     새 검색을 만들지 않는다 — apply는 그 화면이 원래 쓰던 걸러 내기 함수 그대로다.
//  2) 옮겨 온 단추 상자: 화면 안 검색 줄에 있던 고르기·⋯·만들기 단추가 사는 상자(toolsBox). 상자는 PC 틀(761px~)이면 상단 줄
//     검색 칸 오른쪽([data-screen-tools="top"]), 폰 틀이면 앱 머리 줄 오른쪽([data-screen-tools="head"])에 붙고(S70-53 공용 자리),
//     지금 화면 것만 보인다. 상자 안 단추의 그리기·누르기는 계속 그 화면이 한다(여기서는 자리만).
// 저장하는 것 없음(화면 찾기 글자는 그 화면 메모리).
const scopes = new Map(), listeners = new Set(), boxes = new Map();
const WIDE = window.matchMedia('(min-width:761px)');
let current = null, queued = false;

// spec: {active(): boolean, label: '노트에서 찾기', value(): string, apply(q, {submit}): void}
export function registerScreenFind(key, spec) {
  scopes.set(key, {key, ...spec});
  refreshScreenFind();
}
export function screenFind() { return current; }
export function onScreenFind(fn) { listeners.add(fn); fn(current); return () => listeners.delete(fn); }
// 화면이 '찾기가 지금 쓰이는지'나 찾기 글자를 스스로 바꿨을 때(목록 ↔ 상세, 로그인 바뀜 등) 부른다. 한 번에 모아서 맞춘다.
export function refreshScreenFind() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; sync(); });
}
// 화면의 단추 상자(처음 부를 때 만든다). 화면은 여기에 자기 단추를 넣고, 누르기는 그 화면이 상자에 직접 붙인다.
// view: 라우터 화면 이름(빈 곳 우클릭 context-menu.js가 data-screen-tools-for로 이 화면 ⋯를 찾는다 — screen-tools.js와 같은 표시).
export function toolsBox(key, view) {
  let box = boxes.get(key);
  if (!box) {
    box = document.createElement('div');
    box.className = 'sf-tools'; box.dataset.sfTools = key; box.hidden = true;
    if (view) box.dataset.screenToolsFor = view + 'View';
    boxes.set(key, box);
    place();
  }
  return box;
}

function pick() {
  for (const spec of scopes.values()) {
    try { if (spec.active()) return spec; } catch { /* 화면이 아직 준비 전 */ }
  }
  return null;
}
function hostFor() {
  // 자리 두 칸은 S70-53 공용 자리(index.html [data-screen-tools="top"|"head"], screen-tools.js와 같은 칸)를 같이 쓴다.
  return document.querySelector(WIDE.matches ? '[data-screen-tools="top"]' : '[data-screen-tools="head"]');
}
function place() {
  const host = hostFor();
  for (const [key, box] of boxes) {
    if (host && box.parentElement !== host) host.append(box);
    box.hidden = key !== current?.key;
  }
}
function sync() {
  const next = pick();
  current = next;
  if (next) document.documentElement.dataset.screenFind = next.key; else delete document.documentElement.dataset.screenFind;
  place();
  for (const fn of listeners) { try { fn(current); } catch (e) { console.error('screen find', e?.name || 'Error'); } }
}

// 화면이 바뀌면 그 화면이 자기 칸을 그린 뒤 맞춘다(같은 틱 안의 화면 그리기가 먼저).
window.addEventListener('kptu:view-changed', () => { refreshScreenFind(); requestAnimationFrame(refreshScreenFind); });
WIDE.addEventListener('change', () => { place(); for (const fn of listeners) fn(current); });
