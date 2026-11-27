// S47-18 UI-뒤로가기겹규칙 2차: 작은 ⋯ 메뉴가 열려 있을 때 뒤로가기 = 그 메뉴만 닫기. 메뉴마다 따로 기록을 쓰지 않고 이 한 곳이
// 라우터 겹 하나를 붙인다(이름 'small-menu'). 한 번에 하나만: 다른 메뉴를 열면 앞 메뉴를 닫는다.
// ① <details>로 만든 ⋯ 메뉴(사업영역·담당조직·회의 파일·업무일지·주간 정리·한글 파일 판·공유 페이지·사진 보기·원장)는 열고 닫힘(toggle)을 여기서 본다.
// ② hidden으로 여닫는 메뉴(일기 쓰기 창 ⋯·구글 일정 창 ⋯·노트 ⋯ 등)는 그 화면이 KPTUMenuLayer.opened(메뉴, 닫기)·closed(메뉴)를 부른다.
// 메뉴 안 항목을 누르면 메뉴 겹부터 닫고(뒤로가기 도착 뒤) 그 항목을 실행한다: 항목이 창을 닫거나 다른 화면으로 가도 기록이 두 번 겹치지 않는다.
// STD-메뉴바깥닫기(S70-78): 바깥 누름·Esc·스크롤·창 크기·화면 이동·한 번에 하나·뒤로가기 겹은 공용 지킴이(menu-dismiss.js)가 맡는다.
// 바깥 누름은 닫기만 한다(전의 '닫고 그 누름을 다시 보내기'는 없앴다 — 바깥 누름이 다른 동작을 일으키지 않게, 다른 ⋯ 단추는 바로 열림).
// 제자리 펼침(진행 이력·접는 칸 등 <details> 접기)은 창이 아니므로 대상이 아니다(AGENTS.md 5절, 접기는 그대로).
import { holdMenu, catchUpMenus } from './menu-dismiss.js';
(() => {
  if (window.__KPTU_DETAILS_MENU_BACK__) return;
  window.__KPTU_DETAILS_MENU_BACK__ = true;
  const MENU = 'details:is(.ps3-more,.ps3-line-more,.wd-doc-more,.file-line-more,.journal-item-more,.journal-kind-more,.sp-more,.sp-slot,.basket-photo-more,.lb-kebab)';
  // 항목을 눌러도 열린 채 남는 메뉴(공유 페이지 블록 ⋯: 옮긴 블록 위에서 다음 누름을 기다림)는 항목을 가로채지 않는다(겹만 붙임).
  const STAYS = 'details.sp-more';
  let open = null; // {el, hide, release}
  function shut(entry) { try { entry.hide(); } catch (err) { console.error('menu close', err); } }
  const summaryOf = el => (el?.matches?.('details') ? el.querySelector('summary') : null);
  function opened(el, hide) {
    if (open?.el === el) return;
    closed(open?.el);
    const entry = {el, hide, release:null};
    open = entry;
    entry.release = holdMenu(el, {back:'small-menu', close:reason => {
      if (open !== entry) return;
      open = null; shut(entry);
      if (reason === 'esc') summaryOf(entry.el)?.focus?.({preventScroll:true});
    }});
  }
  // The owner closed its menu itself (item done, toggle): its entry is left. 돌려줌: 겹 뒤로가기 약속.
  function closed(el) {
    if (!el || open?.el !== el) return null;
    const entry = open; open = null;
    return entry.release?.() ?? null;
  }
  // UI-Esc로창닫기 ②: Esc in a window closes the small menu open inside it first (accessibility-dialog.js asks here).
  function dismissIn(root) {
    if (!open || !root?.contains?.(open.el)) return false;
    const entry = open; open = null;
    shut(entry);
    entry.release?.();
    summaryOf(entry.el)?.focus?.({preventScroll:true});
    return true;
  }
  window.KPTUMenuLayer = {opened, closed, dismissIn, isOpen:el => open?.el === el};
  // 열림 알림(toggle)이 아직 안 온, 지금 열려 보이는 ⋯ 메뉴를 바로 붙인다(지킴이가 Esc·누름 판정 직전에 부른다). 알림이 뒤에 오면 opened는 그대로 지나간다.
  catchUpMenus(() => {
    for (const el of document.querySelectorAll(`${MENU}[open]`)) if (open?.el !== el && el.isConnected && el.getClientRects().length) opened(el, () => { el.open = false; });
  });
  document.addEventListener('toggle', event => {
    const el = event.target;
    if (!(el instanceof HTMLDetailsElement) || !el.matches(MENU)) return;
    if (el.open) opened(el, () => { el.open = false; });
    else closed(el);
  }, true);
  let passing = null;
  // 메뉴 안 항목: 메뉴 겹부터 닫고 그 항목을 실행한다.
  document.addEventListener('click', event => {
    if (!open || passing || !open.el.contains(event.target)) return;
    const button = event.target.closest?.('button,a[href],summary');
    if (!button || button.disabled || button.matches('summary') || button.closest('summary') || open.el.matches?.(STAYS)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const entry = open; open = null;
    shut(entry);
    Promise.resolve(entry.release?.()).then(() => {
      if (!button.isConnected) return;
      passing = button;
      try { button.click(); } finally { passing = null; }
    });
  }, true);
})();
