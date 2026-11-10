// UI-PC손맛묶음 ② 키보드(요청 11/10 11:23 "전체 검색 단축키, 메뉴 건너 본문으로 가기, 목록 ↑↓·Enter"). 앱 전체에 한 번만 붙는 키보드 규칙의 유일한 곳.
// - 전체 검색: Ctrl+K(⌘K)는 어디서나, '/'는 글을 쓰는 칸 밖에서. 상단 줄 검색칸(global-search.js #gsTopInput)에 커서를 둔다.
//   칸이 아직 없으면(검색 모듈을 받기 전·폰) 검색 화면(?view=search)을 열고 그 칸에 둔다. 검색 결과·여는 길은 global-search.js 그대로.
// - 본문으로 가기: index.html 맨 앞 링크([data-skip-main]). Tab을 처음 누르면 보이고, 누르면 지금 화면(.view-panel)으로 커서를 옮긴다.
// - 목록 ↑↓: 커서가 목록 줄(같은 모양의 형제 줄이 있는 단추·링크·누를 수 있는 줄)에 있으면 위·아래 줄의 같은 자리로 옮긴다.
//   화면이 스스로 화살표를 쓰는 곳(메뉴·고르기 목록·표·탭·입력칸, 이미 preventDefault한 화면)은 건드리지 않는다.
// - Enter: role="button" 줄(진짜 <button>이 아닌 줄)에서 화면이 Enter를 받지 않았으면 그 줄을 누른 것과 같게 한다.
// 두 규칙(↑↓·Enter)은 window의 버블 단계에서 맨 나중에 본다: 화면의 자기 키 처리가 먼저이고, 처리했으면(defaultPrevented) 손대지 않는다.
// 저장하는 것 없음.
(() => {
'use strict';
if (window.__KPTU_KEYBOARD_KEYS__) return;
window.__KPTU_KEYBOARD_KEYS__ = true;

const EDITABLE = 'input,textarea,select,[contenteditable=""],[contenteditable="true"]';
const OWN_ARROWS = '[role="menu"],[role="menubar"],[role="listbox"],[role="grid"],[role="treegrid"],[role="tree"],[role="tablist"],[role="radiogroup"],[role="toolbar"],[role="slider"],[role="spinbutton"],[role="combobox"]';
const editing = el => !!el?.closest?.(EDITABLE) || !!el?.isContentEditable;
const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[inert],[aria-hidden="true"]');

// ---------- 전체 검색 단축키 ----------
const SEARCH_KEYS = 'Control+K Meta+K /';
function searchInput() {
  return [document.getElementById('gsTopInput'), document.getElementById('gsViewInput')].find(shown) || null;
}
function focusSearch(input) {
  input.setAttribute('aria-keyshortcuts', SEARCH_KEYS);
  input.focus({preventScroll: false});
  input.select?.();
}
function openSearch() {
  const input = searchInput();
  if (input) { focusSearch(input); return; }
  const router = window.KPTURouter;
  if (!router?.go) return;
  let done = false;
  const land = () => { if (done) return; const found = searchInput(); if (found) { done = true; focusSearch(found); } };
  window.addEventListener('kptu:view-changed', () => requestAnimationFrame(land), {once: true});
  router.go('search', {source: 'keyboard'});
  // 검색 모듈을 처음 받는 동안: 칸이 생기면 한 번 둔다(최대 3초).
  let tries = 0;
  const timer = setInterval(() => { land(); if (done || ++tries > 30) clearInterval(timer); }, 100);
}
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.isComposing || e.repeat) return;
  const key = e.key?.toLowerCase();
  const chord = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && key === 'k';
  const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !editing(e.target);
  if (!chord && !slash) return;
  if (!document.getElementById('appView')?.classList.contains('kptu-ui-ready')) return;
  // 작은 창(대화 상자)이 떠 있으면 그 창이 키를 가진다.
  if (!chord && e.target.closest?.('[role="dialog"],dialog')) return;
  e.preventDefault();
  openSearch();
});

// ---------- 본문으로 가기 ----------
document.addEventListener('click', e => {
  const skip = e.target.closest?.('[data-skip-main]');
  if (!skip) return;
  e.preventDefault();
  const panel = [...document.querySelectorAll('#appView > .view-panel')].find(p => !p.classList.contains('hidden'));
  if (!panel) return;
  if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
  panel.focus({preventScroll: true});
  panel.scrollIntoView({block: 'start', behavior: 'instant'});
});

// ---------- 목록 ↑↓ ----------
// 줄의 모양: 태그 + 클래스(정렬) + role. 같은 모양의 형제가 있는 가장 가까운 조상(자기 자신 포함, 4단계까지)이 '줄'이다.
const shape = el => `${el.tagName}|${[...el.classList].sort().join('.')}|${el.getAttribute('role') || ''}`;
function rowOf(start) {
  let el = start;
  for (let depth = 0; el && depth < 5; depth++, el = el.parentElement) {
    if (el.matches('.view-panel,#appView,body,[role="dialog"],.modal')) return null;
    const parent = el.parentElement;
    if (!parent) return null;
    const s = shape(el);
    const peers = [...parent.children].filter(child => shape(child) === s);
    if (peers.length > 1) return {row: el, peers};
  }
  return null;
}
// 다음 줄 안에서 지금 커서 자리와 같은 것: 줄 자신이면 그 줄, 아니면 같은 모양의 첫 자손(보이는 것), 없으면 줄 안 첫 누를 것.
const FOCUSABLE = 'a[href],button:not([disabled]),[role="button"],[tabindex]:not([tabindex="-1"])';
function sameSpot(row, from, target) {
  if (from === row) return target;
  const s = shape(from);
  const same = [...target.querySelectorAll(from.tagName)].find(el => shape(el) === s && shown(el));
  return same || [...target.querySelectorAll(FOCUSABLE)].find(shown) || null;
}
function moveInList(e) {
  const from = e.target;
  if (!(from instanceof HTMLElement) || from === document.body || editing(from) || from.closest(OWN_ARROWS)) return false;
  if (!from.matches(FOCUSABLE)) return false;
  const found = rowOf(from);
  if (!found) return false;
  const {row, peers} = found;
  const step = e.key === 'ArrowDown' ? 1 : -1, top = row.getBoundingClientRect().top;
  for (let i = peers.indexOf(row) + step; i >= 0 && i < peers.length; i += step) {
    if (!shown(peers[i])) continue;
    // 위·아래로 쌓인 줄만 목록이다(옆으로 놓인 단추들은 ↑↓로 옮기지 않고, 페이지 스크롤을 그대로 둔다).
    const nextTop = peers[i].getBoundingClientRect().top;
    if (step > 0 ? nextTop <= top + 1 : nextTop >= top - 1) continue;
    const next = sameSpot(row, from, peers[i]);
    if (!next) continue;
    next.focus({preventScroll: true});
    next.scrollIntoView({block: 'nearest'});
    return true;
  }
  return false;
}
window.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (moveInList(e)) e.preventDefault();
    return;
  }
  if (e.key === 'Enter') {
    const row = e.target;
    if (!(row instanceof HTMLElement) || row.matches('button,a,summary,input,textarea,select') || row.getAttribute('role') !== 'button' || editing(row)) return;
    if (row.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();
    row.click();
  }
});
})();
