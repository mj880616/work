import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('calendar hotfix removes stale local calendar UI and returns OAuth to Web2',async()=>{
  const index=readFileSync('app/index.html','utf8');
  const plus=readFileSync('app/calendar-plus.js','utf8');
  const interactions=readFileSync('app/calendar-interactions-v2.js','utf8');
  const callback=readFileSync('supabase/functions/public-policy-drive/index.ts','utf8');
  const bridge=readFileSync('app/calendar-return-bridge.js','utf8');
  const loader=readFileSync('app/loader-v2.js','utf8');
  const views=readFileSync('app/view-loader.js','utf8');
  const persistence=readFileSync('app/calendar-persistence.js','utf8');
  const calendarEdge=readFileSync('supabase/functions/google-calendar/index.ts','utf8');
  expect(index).not.toContain('팀 캘린더');
  expect(index).not.toContain('개인 캘린더');
  expect(plus).not.toContain('eventCalendarScope');
  expect(interactions).toContain('ciCreateAt');
  expect(interactions).toContain('window.__KPTU_GOOGLE_EVENTS__');
  expect(callback).toContain("const CALENDAR_APP_URL = 'https://desk.bokdoong.com/work/app/';");
  expect(callback).toContain("u.searchParams.set('view', 'calendar')");
  expect(callback).toContain("u.searchParams.set('google', result)");
  expect(callback).toContain("if (state?.split('.').includes('android')) u.searchParams.set('native', 'android')");
  expect(bridge).toContain("params.get('native')==='android'");
  expect(bridge).not.toContain("/Android/i.test(navigator.userAgent)");
  expect(index).toContain('./loader-v2.js?v=224');
  expect(index).toContain('./app.js?v=112');
  expect(views).toContain("module('./calendar-persistence.js?v=12'");
  expect(views).not.toContain("calendar-persistence.js?v=10");
  expect(persistence).not.toContain('showGoogleCalendar');
  expect(persistence).toContain("addEventListener('kptu:session-changed'");
  expect(calendarEdge).toContain("ids=Array.isArray(c.calendar_ids)?c.calendar_ids:['primary']");
  expect(calendarEdge).toContain("singleEvents:'true'");
  expect(calendarEdge).toContain("orderBy:'startTime'");

});
