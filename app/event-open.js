// HOME-줄누르기: 달력 밖 화면(홈 오늘 일정·내일·D-day 칩)에서 Google 일정 한 줄을 눌렀을 때의 공용 길.
// 새 창·새 메뉴를 만들지 않는다 — 달력 모듈을 불러 그 화면의 수정 창(KPTUCalendarEvents.open, 업무일지 그날 일정과 같은 길)과
// 일정 메뉴(calendar-context-menu.js: 수정·담당조직 연결·결과 남기기·일정 삭제)를 그대로 연다. 고친 결과는 달력 저장 경로가
// 보내는 kptu:calendar-changed로 각 화면이 다시 읽는다(여기서는 아무것도 저장하지 않는다).
let ready = null;
async function calendarReady() {
  if (!ready) ready = (async () => {
    await window.KPTUViewLoader.load('calendar');
    for (let i = 0; i < 300 && !window.__KPTU_CALENDAR_PERSISTENCE_READY__; i++) await new Promise(resolve => requestAnimationFrame(resolve));
    await window.__KPTU_CALENDAR_PERSISTENCE_READY__;
    if (!window.KPTUCalendarEvents?.open) throw new Error('calendar');
  })().catch(error => { ready = null; throw error; });
  return ready;
}
// The calendar's own edit window over this screen. Closing it (✕·Esc·뒤로가기) leaves the screen as it was.
export async function openGoogleEvent(id, calendarId) {
  if (!id) return false;
  await calendarReady();
  window.KPTUCalendarEvents.open(String(id), calendarId || 'primary');
  return true;
}
// The calendar's event menu at a pressed spot (x, y): a long press on a phone, a right-click on a PC. trigger carries
// data-google-event / data-google-calendar (the menu reads them).
export async function openGoogleEventMenu(trigger, x = null, y = null) {
  if (!trigger?.dataset?.googleEvent) return false;
  await calendarReady();
  await import('./calendar-context-menu.js');
  if (!window.KPTUCalendarEventMenu?.open || !trigger.isConnected) return false;
  if (x !== null && y !== null) window.KPTUContextMenu?.pinAt?.(trigger, x, y);
  window.KPTUCalendarEventMenu.open(trigger);
  return true;
}
// Data attributes for a line that stands for a Google event (used by openGoogleEventMenu and the click handler).
const attr = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const eventAttrs = (id, calendarId) => id ? `data-google-event="${attr(id)}" data-google-calendar="${attr(calendarId || 'primary')}"` : '';

// 꾹 누르기(폰, 0.5초) → onHold(line, x, y), PC 우클릭 → 같은 onHold. 손을 뗄 때 따라오는 click은 삼키고, 줄 위에서 폰 기본 메뉴는 열지 않는다.
// (통화·텔레그램의 feed-hold.js와 같은 규칙. 그쪽은 줄 안 ⋯를 누르는 메뉴라 여기서는 줄 자체를 넘긴다.)
const HOLD_MS = 500, MOVE_PX = 10;
export function bindLineHold(root, {selector, onHold, wide = () => window.matchMedia('(min-width:761px)').matches}) {
  let hold = null, swallow = false;
  root.addEventListener('pointerdown', e => {
    swallow = false;
    if (e.pointerType !== 'touch') return;
    const line = e.target.closest?.(selector); if (!line || !root.contains(line)) return;
    const x = e.clientX, y = e.clientY;
    clearTimeout(hold?.timer);
    hold = {x, y, timer:setTimeout(() => { hold = null; swallow = true; try { navigator.vibrate?.(10); } catch {} onHold(line, x, y + 4); }, HOLD_MS)};
  });
  const cancel = e => { if (!hold) return; if (e.type === 'pointermove' && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) < MOVE_PX) return; clearTimeout(hold.timer); hold = null; };
  root.addEventListener('pointermove', cancel); root.addEventListener('pointerup', cancel); root.addEventListener('pointercancel', cancel);
  root.addEventListener('contextmenu', e => {
    const line = e.target.closest?.(selector); if (!line || !root.contains(line)) return;
    if (e.pointerType === 'touch' || !wide()) { e.preventDefault(); return; }
    if (e.defaultPrevented || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const selection = window.getSelection?.();
    if (selection && !selection.isCollapsed && selection.toString().trim() !== '') return;
    e.preventDefault();
    onHold(line, e.clientX, e.clientY);
  });
  window.addEventListener('click', e => { if (swallow && root.contains(e.target)) { swallow = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}
