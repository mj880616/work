// UI-화면이름줄도구(S70-53 ORG-머리줄한줄, 2026-11-25 명진 "담당조직+ 랑 ... 맨 첫째줄 우측에 넣어도 되자나?"):
// 한 화면의 만들기·⋯ 묶음(.screen-tools)을 그 화면 자리에 두는 공용 자리.
//   폰·폴드(~760px) = 앱 머리 줄(.mobile-shell-header) 이름·찾기 오른쪽 [data-screen-tools="head"].
//   PC 틀(761px~) = 화면 안 첫 줄(보기 탭·고르기 줄) 오른쪽 끝 [data-screen-tools="line"] — lineSlot(view).
// S71-59 UI-화면메뉴안으로(2026-11-26 사용자 "노트 관련 메뉴인데 시스템 전체 메뉴가 있을 법한 위치 … 노트 화면으로 들어와야"):
//   PC 맨 위 줄(.app-topline)은 앱 전체 것(뒤로·앞으로·위치·찾기·+ 추가·계정)만 둔다. 화면 전용 단추·⋯는 사업 관리처럼 화면 안 첫 줄 오른쪽 끝
//   (예외: 찾기 칸 옆 ＋ 하나를 사용자가 따로 정한 저장한 글·업데이트 기록 — 아래 표 top).
//   그 화면의 첫 줄은 아래 LINES 표 한 곳에 적는다(화면마다 자리를 따로 붙이지 않는다). screen-find.js 단추 상자도 PC는 같은 lineSlot을 쓴다.
// 이 모듈은 자리만 옮긴다. 단추를 그리는 곳·누름 처리는 그 화면 모듈 그대로(document 위임이라 자리가 바뀌어도 같다).
// 그 화면이 보일 때만 자리에 들어가고, 다른 화면이면 화면 안 원래 자리(home)로 돌아가 숨는다(.screen-tools는 자리에 있을 때만 보임 — topbar-actions.css).
// 빈 곳 우클릭(context-menu.js)은 data-screen-tools-for(화면 칸 id)로 이 화면 ⋯를 찾는다.
// BIZ-머리한줄(S71-23): {wide:false}면 폰·폴드 틀에서만 앱 머리 줄로 가고, PC 틀에서는 화면 안 원래 자리에 그대로 보인다(사업 관리 첫 줄 — PC는 화면 안 한 줄).
// {end}: 자리에 들어갈 때 el과 함께 그 뒤에 따로 놓는 끝 단추 묶음(사업 관리 [+]). 머리 줄 오른쪽 끝 순서 '… · 찾기 · [+]'(SAVED-머리한줄,
//   S71-43)에서 찾기는 el과 [+] 사이에 서야 해서 [+]를 el 밖 자기 칸으로 뺀다(줄 세우기는 ui-standard.css). 원래 자리로 돌아가면 el 맨 끝에 다시 붙는다.
const PC = '(min-width:761px)';
const panelId = view => view + 'View';
const tools = new Map(); // view → {el, home, wide, end}
let active = null, bound = false;
const shown = view => {const p = document.getElementById(panelId(view)); return !!p && !p.classList.contains('hidden')};
const head = () => document.querySelector('[data-screen-tools="head"]');
const slot = view => (window.matchMedia(PC).matches ? lineSlot(view) : head());
// S71-59: PC 틀 화면 안 첫 줄. line = 줄 하나(가로 줄)면 그 줄 끝에 붙이고, grid = 격자 첫 줄을 가로로 차지하는 탭이면 그 옆(같은 첫 줄 오른쪽 끝),
// 둘 다 없는 화면(첫 줄이 없거나 아직 그리기 전 — 브리핑 룸·사진 등)은 화면 맨 위에 그 자리 한 줄을 둔다(own).
// top = 맨 위 줄 찾기 칸 오른쪽(index.html [data-screen-tools="top"]) — 사용자가 그 자리를 따로 정한 화면만.
// 사업 관리는 첫 줄(#reportTop)이 원래 화면 안이라 표에 없다({wide:false} — 본보기).
const LINES = {
  // 노트·잊지 말기는 한 화면 칸(#basketView)을 같이 쓴다. line이 여럿이면 지금 보이는 첫 줄(없으면 맨 앞 것):
  //   노트 = 보기 탭 줄(폴더·목록·보드·태그·메모·달력), 잊지 말기 = 화면 머리 줄(.basket-head — [처리 전 ▾]·↻, S71-29 둘째 줄 없앤 뒤 첫 줄).
  basket: {line: ['[data-note-list] > .note-list-head', ':scope > .basket-head']},
  library: {line: '.library-filter-toolbar > .lu-search-row'}, // 자료실: 고르기 줄(폴더·분류)
  // 예외 — 찾기 칸 옆 ＋ 하나만 있고 사용자가 그 자리를 정한 화면은 맨 위 줄 찾기 칸 오른쪽 그대로(⋯ 메뉴는 없음):
  reading: {top: true}, // 저장한 글 ＋(S71-26 SAVED-머리한줄 "+ 를 돋보기 우측으로", 2026-11-26 사용자 PC 화면 확인 '위치 좋음')
  updates: {top: true}, // 업데이트 기록(운영자) ＋ 직접 쓰기(S71-31 RELNOTE-머리줄정리 "낱말로 찾기랑 직접 쓰기 한줄로")
  team: {grid: '#soTeamSection > #soTeamTabs'}, // 조직 관리: 목록·전체 표 탭(좌우 격자 첫 줄)
  outside: {grid: '#outsideRoot > .os-tabs'}, // 읽을 거리: 탭 줄(전체·사회운동·언론·밑줄·메모, 두 칸 격자 첫 줄)
};
// 줄 후보 중 지금 보이는 첫 줄. 하나도 안 보이면(화면이 숨었거나 글을 연 동안) 있는 첫 줄 — 자리는 그대로 두고 상자는 그 줄과 같이 숨는다.
const seen = el => (el.checkVisibility ? el.checkVisibility() : !el.closest('[hidden]'));
function firstRow(panel, line) {
  const rows = [].concat(line).map(sel => panel.querySelector(sel)).filter(Boolean);
  return rows.find(seen) || rows[0] || null;
}
const slots = new Map(); // view → 자리 요소(처음 부를 때 만들고 계속 같은 것 — 줄이 다시 그려지면 다시 붙인다)
export function lineSlot(view) {
  const panel = view && document.getElementById(panelId(view));
  if (!panel) return null;
  const spec = LINES[view] || {};
  if (spec.top) return document.querySelector('[data-screen-tools="top"]');
  let s = slots.get(view);
  if (!s) {
    s = document.createElement('div');
    s.className = 'screen-line-slot'; s.dataset.screenTools = 'line'; s.dataset.screenLineView = view;
    slots.set(view, s);
  }
  const row = spec.line ? firstRow(panel, spec.line) : null;
  const anchor = !row && spec.grid ? panel.querySelector(spec.grid) : null;
  if (row) {
    s.dataset.screenLineMode = 'line';
    if (row.lastElementChild !== s) row.append(s);
  } else if (anchor) {
    s.dataset.screenLineMode = 'grid'; anchor.dataset.screenLineAnchor = '';
    if (anchor.nextElementSibling !== s) anchor.after(s);
  } else {
    s.dataset.screenLineMode = 'own';
    if (panel.firstElementChild !== s) panel.prepend(s);
  }
  return s;
}
function place() {
  for (const [view, t] of tools) {
    if (!t.el.isConnected && !t.home.isConnected) {tools.delete(view); continue}
    const on = (active ? active === view : shown(view)) && (t.wide || !window.matchMedia(PC).matches), target = on ? slot(view) : t.home;
    if (!target) continue;
    if (t.el.parentElement !== target) target.append(t.el);
    t.el.toggleAttribute('data-screen-tools-placed', on);
    if (t.end) {
      if (on ? t.el.nextElementSibling !== t.end : t.el.lastElementChild !== t.end) (on ? t.el.after(t.end) : t.el.append(t.end));
      t.end.toggleAttribute('data-screen-tools-placed', on);
    }
  }
}
function bind() {
  if (bound) return; bound = true;
  window.addEventListener('kptu:view-changed', e => {active = e.detail?.view || null; place()});
  window.matchMedia(PC).addEventListener?.('change', place);
}
export function mountScreenTools(view, el, {wide = true, end = null} = {}) {
  if (!view || !el?.parentElement) return;
  if (!tools.has(view)) tools.set(view, {el, home: el.parentElement, wide, end: end && el.contains(end) ? end : null});
  el.dataset.screenToolsFor = panelId(view);
  if (end) end.dataset.screenToolsFor = panelId(view);
  bind(); place();
}
// S71-59: 화면이 첫 줄을 새로 그렸을 때(처음엔 없던 탭 줄 등) 부른다 — PC 틀 단추 자리를 다시 맞춘다. screen-find.js 상자도 같은 신호로 다시 맞춘다.
export function placeScreenTools() {
  place();
  window.dispatchEvent(new CustomEvent('kptu:screen-line'));
}
