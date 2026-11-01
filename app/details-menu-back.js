// S47-18 UI-뒤로가기겹규칙 2차: 작은 ⋯ 메뉴가 열려 있을 때 뒤로가기 = 그 메뉴만 닫기. 메뉴마다 따로 기록을 쓰지 않고 이 한 곳이
// 라우터 겹 하나를 붙인다(KPTURouter.layer.open, 이름 'small-menu'). 한 번에 하나만: 다른 메뉴를 열면 앞 메뉴를 닫는다.
// ① <details>로 만든 ⋯ 메뉴(사업영역·담당조직·회의 파일·업무일지·주간 정리·한글 파일 판·공유 페이지·사진 보기·원장)는 열고 닫힘(toggle)을 여기서 본다.
// ② hidden으로 여닫는 메뉴(일기 쓰기 창 ⋯·구글 일정 창 ⋯·노트 ⋯ 등)는 그 화면이 KPTUMenuLayer.opened(메뉴, 닫기)·closed(메뉴)를 부른다.
// 메뉴 안 항목을 누르면 메뉴 겹부터 닫고(뒤로가기 도착 뒤) 그 항목을 실행한다: 항목이 창을 닫거나 다른 화면으로 가도 기록이 두 번 겹치지 않는다.
// 제자리 펼침(진행 이력·접는 칸 등 <details> 접기)은 창이 아니므로 대상이 아니다(AGENTS.md 5절, 접기는 그대로).
(() => {
  if (window.__KPTU_DETAILS_MENU_BACK__) return;
  window.__KPTU_DETAILS_MENU_BACK__ = true;
  const MENU = 'details:is(.ps3-more,.ps3-line-more,.wd-doc-more,.file-line-more,.journal-item-more,.journal-kind-more,.sp-more,.sp-slot,.basket-photo-more,.lb-kebab)';
  let open = null; // {el, hide, layer}
  function shut(entry) { try { entry.hide(); } catch (err) { console.error('menu close', err); } }
  function opened(el, hide) {
    if (open?.el === el) return;
    closed(open?.el);
    const entry = {el, hide, layer:null};
    open = entry;
    entry.layer = window.KPTURouter?.layer?.open('small-menu', {close:() => { if (open === entry) { open = null; shut(entry); } return true; }}) || null;
  }
  // The owner closed its menu itself (outside press, Esc, item done): its entry is left.
  function closed(el) {
    if (!el || open?.el !== el) return;
    const entry = open; open = null;
    entry.layer?.close();
  }
  window.KPTUMenuLayer = {opened, closed, isOpen:el => open?.el === el};
  document.addEventListener('toggle', event => {
    const el = event.target;
    if (!(el instanceof HTMLDetailsElement) || !el.matches(MENU)) return;
    if (el.open) opened(el, () => { el.open = false; });
    else closed(el);
  }, true);
  let passing = null;
  document.addEventListener('click', event => {
    if (!open || passing) return;
    const button = event.target.closest?.('button,a[href]');
    if (!button || button.disabled || !open.el.contains(button) || button.closest('summary')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const entry = open; open = null;
    shut(entry);
    Promise.resolve(entry.layer?.close()).then(() => {
      if (!button.isConnected) return;
      passing = button;
      try { button.click(); } finally { passing = null; }
    });
  }, true);
  window.addEventListener('kptu:view-changed', () => { open = null; });
})();
