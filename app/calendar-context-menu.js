// UI-우클릭전수 → S51-27 UI-PC우클릭: PC(761px~) 달력에서 우클릭(또는 Shift+F10·메뉴 키)하면 크롬 기본 메뉴 대신 누른 자리에 작은 메뉴.
// 메뉴 부품은 공용 줄 메뉴 하나(row-menu.js, 나무 줄 ⋯와 같은 부품). 항목 목록은 calendar-row-menu.mjs, 실행은 달력이 이미 가진 길만 부른다.
//   일정(주간 시간표·종일 띠·월간 막대·목록 줄·그날 창 줄) → [수정][보고할 일정][담당조직 연결][결과 남기기] … [삭제] (KPTUCalendarEvents.act: 수정 창의 단추 그대로,
//     삭제는 수정 창처럼 한 번 묻는다). 쓰기 권한 없는 캘린더는 [열기]만.
//   할 일 막대(월간 칸 안) → 그 할 일 줄의 ⋯ 메뉴(task-inline.js, calendar-tasks.js KPTUCalendarTasks.menuAt). 그날 창 안 할 일 줄은 ⋯가 있어 공용 context-menu.js가 연다.
//   날짜 칸(월간 칸·주간 하루 칸, 일정으로 꽉 찬 날도 칸 어디든) → [이날 일정 등록][이날 할 일][이날 하루 보기].
// 브라우저 기본 메뉴 그대로인 때는 row-menu.js appMenuPoint(폰 폭·꾹 누르기·글자 칸·글 고름·Shift 등).
import {openRowMenu, appMenuPoint} from './row-menu.js';
import {canDrag} from './calendar-drag-model.js';
import {dateSlot} from './calendar-create-slot.js';
import {eventMenuItems, DAY_MENU_ITEMS, dayMenuTitle} from './calendar-row-menu.mjs';
(() => {
'use strict';
if (window.__KPTU_CALENDAR_CONTEXT_MENU__) return;
window.__KPTU_CALENDAR_CONTEXT_MENU__ = true;

const EVENT = '.cp-event[data-google-event]';
const TASK = '[data-calendar-task]';
const CELL = '#calendarGrid .cal-cell[data-date], #calendarWeek .cwv-day[data-date]';
const MENUS = '#rowMenu, .task-inline-menu, [role="menu"]';
const events = () => window.KPTUCalendarEvents;
const addressOf = trigger => ({eventId: trigger.dataset.googleEvent, calendarId: trigger.dataset.googleCalendar || 'primary'});
const textOf = el => (el?.querySelector?.('.cmv-event-title, [class*="-title"]')?.textContent || el?.textContent || '').replace(/\s+/g, ' ').trim();

function openEventMenu(trigger, at = null) {
  const address = addressOf(trigger);
  if (!address.eventId || !events()?.act) return false;
  // S57-20 BIZ-보고할일정: 서버에서 읽어 둔 값이 있을 때만 [보고할 일정] 한 줄(켜져 있으면 ✓). 누르면 창을 열지 않고 그 자리에서 켜고 끈다
  // (KPTUCalendarEvents.setPlan — 서버 저장, report-plan-data.js). 읽어 둔 값이 없으면 항목 없이 지금 그대로.
  const plan = events()?.planOf?.(address.eventId, address.calendarId) || null;
  return openRowMenu(trigger, {key: 'event:' + JSON.stringify(address), title: textOf(trigger), at,
    items: eventMenuItems(canDrag(address.calendarId, window.__KPTU_GOOGLE_STATE__), plan),
    run: id => { if (id === 'plan') void events()?.setPlan?.(address.eventId, address.calendarId, !plan?.on); else void events()?.act?.(address.eventId, address.calendarId, id); }});
}
// [이날 일정 등록]: 왼쪽 누름과 같은 값(주간은 누른 시각 15분 칸, 월간은 그날 9~10시, 키보드는 9시).
function createOn(cell, from, task) {
  const api = events(), date = cell.dataset.date;
  if (!api?.createSlot) return;
  api.createSlot(api.slotFor ? api.slotFor(cell, from) : dateSlot(date));
  if (task) document.querySelector('#eventModal [data-event-mode="task"]')?.click();
}
// [이날 하루 보기]: 월간은 날짜 숫자 단추를 누른 것과 같다. 주간은 같은 그날 창(KPTUCalendarDayOverflow)에 그날 줄을 넘긴다.
function showDay(cell) {
  const key = cell.dataset.date, list = cell.querySelector('.cmv-date-list');
  if (list) { list.click(); return; }
  const date = new Date(key + 'T00:00:00+09:00');
  window.KPTUCalendarDayOverflow?.open?.(date, window.KPTUCalendarView?.dayItems?.(date) || []);
}
function openDayMenu(cell, at, e) {
  const key = cell.dataset.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || '')) || !events()?.createSlot) return false;
  // 일정 등록 창이 쓸 누른 자리(주간 시각 계산). 키보드는 detail 0 → 9시.
  const from = {target: e.target, detail: e.button === 2 ? 1 : 0, clientY: e.clientY};
  return openRowMenu(cell, {key: 'day:' + key, title: dayMenuTitle(key), items: DAY_MENU_ITEMS, at,
    run: id => { if (id === 'event' || id === 'task') createOn(cell, from, id === 'task'); else if (id === 'day') showDay(cell); }});
}

// HOME-줄누르기: 다른 화면(홈 오늘 일정·내일·D-day 칩)의 일정 줄도 이 메뉴를 그대로 연다(폰 꾹 누르기·PC 우클릭, event-open.js).
window.KPTUCalendarEventMenu = {open: (trigger, at = null) => openEventMenu(trigger, at)};

document.addEventListener('contextmenu', e => {
  const target = e.target instanceof Element ? e.target : null;
  if (!target || target.closest(MENUS)) return;
  const event = target.closest(EVENT);
  const task = event ? null : target.closest(TASK);
  // 그날 창 안 할 일 줄은 자기 ⋯가 있어 공용 context-menu.js가 그 ⋯를 연다.
  if (task?.closest('#calendarDayTasks')) return;
  const cell = event || task ? null : target.closest(CELL);
  const owner = event || task || cell;
  if (!owner) return;
  const at = appMenuPoint(e, owner);
  if (!at) return;
  let opened = false;
  if (event) opened = openEventMenu(event, at);
  else if (task) opened = !!window.KPTUCalendarTasks?.menuAt?.(task, at);
  else opened = openDayMenu(cell, at, e);
  if (opened) e.preventDefault();
}, true);
})();
