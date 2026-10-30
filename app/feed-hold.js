// 통화·텔레그램 줄 공용: 폰 길게 누르기(0.5초) 메뉴 — 0.5초 눌리면 진동, 움직이지 않고 손을 뗄 때 연다(NOTE-포스트잇끌기 전수: 메뉴는 손 뗄 때만). 손가락을 누른 자리 아래에 anchored-menu를 연다. 줄 안의 숨은 ⋯ 버튼이
// 누른 자리에 있는 상자처럼 보고하므로(context-menu.js의 오른쪽 클릭 고정과 같은 방식) 메뉴는 그 자리 아래에 뜬다.
// 터치만 받고(마우스 오른쪽 클릭은 context-menu.js), 손을 뗄 때 따라오는 click은 삼킨다.
const HOLD_MS = 500, MOVE_PX = 10;

export function createFeedHold({menu, itemSelector, moreSelector, skipSelector = '', busy = () => false, isPhone = () => false}) {
  let pinned = null;
  const unpin = () => { if (pinned) { delete pinned.getBoundingClientRect; pinned = null; } };
  const pin = (trigger, x, y) => {
    unpin();
    trigger.getBoundingClientRect = () => ({x, y, left:x, top:y, right:x + Math.min(200, innerWidth - 24), bottom:y, width:Math.min(200, innerWidth - 24), height:0, toJSON() { return this; }});
    pinned = trigger;
  };
  let hold = null, swallowClick = false;
  function bind(root) {
    root.addEventListener('pointerdown', e => {
      swallowClick = false;
      if (e.pointerType !== 'touch') return;
      const item = e.target.closest(itemSelector); if (!item || busy()) return;
      if (skipSelector && e.target.closest(skipSelector)) return;
      const x = e.clientX, y = e.clientY;
      clearTimeout(hold?.timer);
      hold = {x, y, item, held:false, timer:setTimeout(() => {
        if (!hold) return;
        hold.held = true; swallowClick = true; // 꾹 눌림 = 진동만. 메뉴는 움직이지 않고 손을 뗄 때(밀기·끌기를 끊지 않음)
        try { navigator.vibrate?.(10); } catch { /* 진동 없음 */ }
      }, HOLD_MS)};
    });
    const cancel = e => {
      if (!hold) return;
      if (e.type === 'pointermove' && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) < MOVE_PX) return;
      const h = hold; clearTimeout(h.timer); hold = null;
      if (e.type === 'pointermove' && h.held) swallowClick = false; // 꾹 누른 뒤 밀기 = 메뉴 없음(밀기가 맡는다)
      if (e.type !== 'pointerup' || !h.held) return;
      const trigger = h.item.querySelector(moreSelector); if (!trigger) return;
      pin(trigger, h.x, h.y + 4); menu.open(trigger);
    };
    root.addEventListener('pointermove', cancel); root.addEventListener('pointerup', cancel); root.addEventListener('pointercancel', cancel);
    // The phone's own long-press menu (copy, select) does not open over a list row; text elsewhere keeps it.
    root.addEventListener('contextmenu', e => { if (e.target.closest(itemSelector) && (e.pointerType === 'touch' || isPhone())) e.preventDefault(); });
    // On the window, before the open menu's own outside-press handler (document), so the lift does not close the menu just opened.
    window.addEventListener('click', e => { if (swallowClick && root.contains(e.target)) { swallowClick = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  }
  return {bind, unpin};
}
