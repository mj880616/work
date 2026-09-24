import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('active Web2 calendar path is personal and attendee-free',()=>{
  const index=read('app/index.html');
  const team=read('app/team.js');
  const plus=read('app/calendar-plus.js');
  const interactions=read('app/calendar-interactions-v2.js');
  const suborg=read('app/suborganizations.js');
  const projects=read('app/project-system-v3.js');

  expect(index).toContain('<h2>일정</h2>');
  expect(index).not.toContain('<h2>공동 일정</h2>');
  expect(index).not.toContain('일정과 참석자를 함께 관리');
  expect(index).toContain('id="eventTarget"');
  expect(index).toContain('id="eventAllDay"');
  expect(index).toContain('id="eventProject"');
  expect(index).toContain('id="eventGoogleCalendar"');

  expect(team).not.toContain("api('/rest/v1/app_event_attendees");
  expect(team).not.toContain('eventAttendees');
  expect(team).not.toContain('dataset.eventResponse');
  expect(team).toContain("calendar_scope:'personal'");
  expect(team).not.toContain('function paintAppEvents()');
  expect(team).toContain('KPTUCalendarMonthView?.render?.(');
  expect(index).toContain('calendar-toolbar-add');
  expect(index).not.toContain('class="primary" type="button">+ 일정 등록</button>');
  expect(team).toContain('id="googleCalendarPanel"');
  expect(index).not.toContain('calendarUpcoming');
  expect(index).not.toContain('upcomingEvents');
  expect(team).not.toContain('function eventCard(');
  expect(team).not.toContain('upcomingEvents');
  expect(team).toContain('window.__KPTU_RELOAD_APP_EVENTS__=async()=>');

  expect(plus).toContain("target.value||'web2'");
  expect(plus).toContain('saveGoogle:cmSaveGoogle');
  expect(plus).not.toContain('eventCalendarScope');

  expect(interactions).not.toContain('/rest/v1/app_event_attendees');
  expect(interactions).not.toContain('TEAM CALENDAR');
  expect(interactions).not.toContain('PERSONAL CALENDAR');
  expect(interactions).not.toContain('ciAppType');
  expect(interactions).toContain('id="ciAppAllDay"');
  expect(interactions).toContain('id="ciAppProject"');

  expect(suborg).toContain('window.__KPTU_SYNC_EVENT_ORGS__');
  expect(suborg).not.toContain('eventCalendarScope');
  expect(projects).toContain("calendar_scope:'personal'");
});

test('personal calendar keeps legacy data compatibility without schema removal',()=>{
  const team=read('app/team.js');
  const interactions=read('app/calendar-interactions-v2.js');
  expect(interactions).toContain('calendar_scope,color_hex,project_id,created_by');
  expect(team).not.toContain("method:'POST',body:ids.map(user_id=>({event_id:ev.id");
});
