// UI-화면이름줄도구(S70-53 ORG-머리줄한줄, 2026-11-25 사용자 "담당조직+ 랑 ... 맨 첫째줄 우측에 넣어도 되자나?"):
// 한 화면의 만들기·⋯ 묶음(.screen-tools)을 화면 이름 줄 오른쪽 끝에 두는 공용 자리.
//   PC 틀(761px~) = 맨 위 줄(.app-topline) 검색 칸 오른쪽 [data-screen-tools="top"],
//   폰·폴드(~760px) = 앱 머리 줄(.mobile-shell-header) 이름·찾기 오른쪽 [data-screen-tools="head"].
// 이 모듈은 자리만 옮긴다. 단추를 그리는 곳·누름 처리는 그 화면 모듈 그대로(document 위임이라 자리가 바뀌어도 같다).
// 그 화면이 보일 때만 자리에 들어가고, 다른 화면이면 화면 안 원래 자리(home)로 돌아가 숨는다(.screen-tools는 자리에 있을 때만 보임 — topbar-actions.css).
// 빈 곳 우클릭(context-menu.js)은 data-screen-tools-for(화면 칸 id)로 이 화면 ⋯를 찾는다.
// BIZ-머리한줄(S71-23): {wide:false}면 폰·폴드 틀에서만 앱 머리 줄로 가고, PC 틀에서는 화면 안 원래 자리에 그대로 보인다(사업 관리 첫 줄 — PC는 화면 안 한 줄).
// {end}: 자리에 들어갈 때 el과 함께 그 뒤에 따로 놓는 끝 단추 묶음(사업 관리 [+]). 머리 줄 오른쪽 끝 순서 '… · 찾기 · [+]'(SAVED-머리한줄,
//   S71-43)에서 찾기는 el과 [+] 사이에 서야 해서 [+]를 el 밖 자기 칸으로 뺀다(줄 세우기는 ui-standard.css). 원래 자리로 돌아가면 el 맨 끝에 다시 붙는다.
const PC = '(min-width:761px)';
const tools = new Map(); // view → {el, home, wide, end}
let active = null, bound = false;
const panelId = view => view + 'View';
const shown = view => {const p = document.getElementById(panelId(view)); return !!p && !p.classList.contains('hidden')};
const slot = () => document.querySelector(window.matchMedia(PC).matches ? '[data-screen-tools="top"]' : '[data-screen-tools="head"]');
function place() {
  for (const [view, t] of tools) {
    if (!t.el.isConnected && !t.home.isConnected) {tools.delete(view); continue}
    const on = (active ? active === view : shown(view)) && (t.wide || !window.matchMedia(PC).matches), target = on ? slot() : t.home;
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
