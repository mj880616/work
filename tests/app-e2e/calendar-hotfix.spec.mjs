import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('calendar hotfix removes stale local calendar UI and returns OAuth to Web2',async()=>{
  const index=readFileSync('app/index.html','utf8');
  const plus=readFileSync('app/calendar-plus.js','utf8');
  const interactions=readFileSync('app/calendar-interactions-v2.js','utf8');
  const callback=readFileSync('supabase/functions/public-policy-drive/index.ts','utf8');
  const bridge=readFileSync('app/calendar-return-bridge.js','utf8');
  expect(index).not.toContain('팀 캘린더');
  expect(index).not.toContain('개인 캘린더');
  expect(plus).not.toContain('eventCalendarScope');
  expect(interactions).toContain('ciCreateAt');
  expect(interactions).toContain('window.__KPTU_GOOGLE_EVENTS__');
  expect(callback).toContain("const CALENDAR_APP_URL = 'https://desk.bokdoong.com/work/app/';");
  expect(callback).toContain("u.searchParams.set('view', 'calendar')");
  expect(callback).toContain("u.searchParams.set('google', result)");
  expect(callback).toContain("if (state?.startsWith('android.')) u.searchParams.set('native', 'android')");
  expect(bridge).toContain("params.get('native')==='android'");
  expect(bridge).not.toContain("/Android/i.test(navigator.userAgent)");

});
