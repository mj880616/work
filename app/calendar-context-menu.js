// UI-우클릭전수: the calendar has no ⋯ on its events, so a right-click on a Google event (week timeline, all-day band, month chip, list row,
// day dialog row) on a PC (761px~) opens a small menu at the pointer. The menu only calls what the edit window behind a click already does
// (calendar-interactions-v2.js KPTUCalendarEvents.act): [수정] opens the window, [담당조직 연결] opens it at the organization boxes,
// [결과 남기기] and [일정 삭제] run the window's own buttons (delete asks first, exactly as in the window). Nothing new is saved here.
// A calendar the account may not write to gets [열기] only (the window's own rule: canDrag / ciPopulateGoogleCalendars).
// The browser's own menu stays with a text selection, with Shift / Ctrl / Alt / Meta, for a touch long-press and on a phone-width window.
import {createAnchoredMenu} from './anchored-menu.js';
import {canDrag} from './calendar-drag-model.js';
(() => {
'use strict';
if (window.__KPTU_CALENDAR_CONTEXT_MENU__) return;
window.__KPTU_CALENDAR_CONTEXT_MENU__ = true;

const WIDE = window.matchMedia('(min-width:761px)');
const EVENT = '.cp-event[data-google-event]';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// A menu opened from a day dialog stays inside that dialog (its focus rule), otherwise it sits in the page.
const dialogOf = el => el?.closest?.('.modal[aria-modal="true"]:not(.hidden)') || document.body;
const addressOf = trigger => ({eventId: trigger.dataset.googleEvent, calendarId: trigger.dataset.googleCalendar || 'primary'});

const menu = createAnchoredMenu({
  id: 'calendarEventMenu', className: 'task-inline-menu', label: '일정 메뉴', historyKey: 'kptuCalendarEventMenu', parent: dialogOf,
  key: trigger => JSON.stringify(addressOf(trigger)),
  render: id => {
    let address; try { address = JSON.parse(id); } catch { return ''; }
    const item = (act, text, danger) => `<button type="button" data-calendar-event-act="${esc(act)}"${danger ? ' class="task-inline-danger"' : ''}>${esc(text)}</button>`;
    if (!canDrag(address.calendarId, window.__KPTU_GOOGLE_STATE__)) return item('edit', '열기');
    return item('edit', '수정') + item('orgs', '담당조직 연결') + item('report', '결과 남기기') + item('delete', '일정 삭제', true);
  },
  onAction: (button, active) => {
    let address; try { address = JSON.parse(active.id); } catch { return; }
    void window.KPTUCalendarEvents?.act?.(address.eventId, address.calendarId, button.dataset.calendarEventAct);
  }
});

document.addEventListener('contextmenu', e => {
  if (e.defaultPrevented || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  if (!WIDE.matches || e.pointerType === 'touch') return;
  const target = e.target instanceof Element ? e.target : null;
  const trigger = target?.closest(EVENT);
  if (!trigger || target.closest('[role="menu"],input,textarea,select')) return;
  const selection = window.getSelection?.();
  if (selection && !selection.isCollapsed && selection.toString().trim() !== '') return;
  if (!window.KPTUCalendarEvents?.act || !window.KPTUContextMenu?.pinAt) return;
  e.preventDefault();
  // The event element reports a box at the pointer while the menu is open (the same way the ⋯ menus follow a right-click).
  window.KPTUContextMenu.pinAt(trigger, e.clientX, e.clientY);
  menu.open(trigger);
}, true);
})();
