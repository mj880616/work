// UI-모바일메뉴순서: 폰 하단바의 선택 표시를 정하는 곳은 여기 하나다.
// 규칙: 하단바에서 진하게 켜지는 칸은 언제나 하나. [메뉴] 창이 열려 있으면 [메뉴], 닫혀 있으면 지금 보는 화면의 칸.
// 메뉴 창으로 들어가는 화면(사업 보고·자료실 …)과 노트는 하단바에 칸이 없으므로 [메뉴] 칸이 지금 화면이다.
// 진하게 보이는 모양은 CSS가 aria-current="page" 하나만 보고 그린다(aria-expanded는 접근성 표시일 뿐 모양을 켜지 않는다).
export const MENU_SHEET_VIEWS = Object.freeze(['meetings', 'library', 'hwp', 'media', 'pages', 'ledger', 'calls', 'telegram']);
const SCHEDULE_VIEWS = Object.freeze(['calendar', 'tasks', 'journal', 'diary']);
const TAB_VIEWS = Object.freeze(['home', 'basket', 'calendar', 'projects', 'team']);

// view: 라우터가 정한 화면 이름(별칭 적용 뒤). 돌려주는 값: 'menu' | 'schedule' | 'home' | 'basket' | 'projects' | 'team' | null.
export function selectedMobileTab({view = null, noteMode = false, menuOpen = false} = {}) {
  if (menuOpen) return 'menu';
  if (noteMode || MENU_SHEET_VIEWS.includes(view)) return 'menu';
  if (SCHEDULE_VIEWS.includes(view)) return 'schedule';
  return TAB_VIEWS.includes(view) ? view : null;
}

// 하단바 버튼 하나가 어느 칸인지.
export function mobileTabKey(button) {
  if (!button) return null;
  if (button.id === 'mobileMenuTab') return 'menu';
  if ('mobileScheduleTab' in button.dataset) return 'schedule';
  return button.dataset.view || null;
}

// 라우터(화면이 바뀔 때)와 메뉴 창(열고 닫을 때)이 같은 길로 호출한다. 마지막 화면은 여기서 기억해 둔다.
let last = {view: null, noteMode: false};
export function paintMobileTabs(root = document, state = {}) {
  last = {...last, ...state};
  const selected = selectedMobileTab({...last, menuOpen: !!window.KPTUMobileMenu?.isOpen?.()});
  root.querySelectorAll('.mobile-tabs button').forEach(button => {
    const own = mobileTabKey(button) === selected;
    button.classList.toggle('active', own);
    if (own) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  return selected;
}
export const repaintMobileTabs = (root = document) => paintMobileTabs(root, {});
if (typeof window !== 'undefined') {
  window.KPTUMobileTabs = {paint: paintMobileTabs, repaint: repaintMobileTabs, selected: selectedMobileTab};
  // 라우터가 먼저 떠서 이미 한 번 화면을 정했다면, 이 모듈이 뜬 지금 다시 그려 달라고 한다(순서가 어느 쪽이어도 같은 결과).
  window.KPTURouter?.syncNavigation?.();
}
