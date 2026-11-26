import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const calendar = readFileSync(new URL('../../supabase/functions/google-calendar/index.ts', import.meta.url), 'utf8');
const tasks = readFileSync(new URL('../../supabase/functions/google-tasks/index.ts', import.meta.url), 'utf8');
const callback = readFileSync(new URL('../../supabase/functions/public-policy-drive/index.ts', import.meta.url), 'utf8');

test('calendar OAuth state is namespaced independently from Tasks and keeps the web platform', () => {
  assert.match(calendar, /const raw='calendar\.'\+platform\+'/);
  assert.match(tasks, /const raw='tasks\.'\+platform\+'/);
  // S71-01: 동의 화면 주소는 공용 도우미(reviewAuthUrl)가 만든다. 돌아올 주소는 그대로 CALLBACK.
  assert.match(calendar, /reviewAuthUrl\(\{cfg,redirectUri:CALLBACK,/);
});

test('calendar event creation targets the calendar id supplied by the client', () => {
  assert.match(calendar, /const calendarId=String\(body\.calendar_id\|\|'primary'\)/);
  assert.match(calendar, /calendars\/\$\{encodeURIComponent\(calendarId\)\}\/events/);
});

test('calendar callback preserves the canonical calendar view for success and failure', () => {
  assert.match(callback, /function calendarRedirect\(result: 'connected' \| 'error'/);
  assert.match(callback, /u\.searchParams\.set\('view', 'calendar'\)/);
  assert.match(callback, /u\.searchParams\.set\('google', result\)/);
  assert.match(callback, /calendarRedirect\('connected', state\)/);
  assert.match(callback, /calendarRedirect\('error', state\)/);
});

test('callback keeps the same redirect_uri for Google authorization and token exchange', () => {
  // S71-01: 동의 화면 주소(심사용·명진 전용 창구 두 갈래)는 공용 도우미에 redirectUri로, 토큰 교환은 redirect_uri로. 모두 같은 CALLBACK_URL.
  assert.equal((callback.match(/redirect_uri: CALLBACK_URL/g) || []).length, 1);
  assert.equal((callback.match(/redirectUri: CALLBACK_URL/g) || []).length, 2);
  assert.doesNotMatch(callback, /redirect_uri: (?!CALLBACK_URL)|redirectUri: (?!CALLBACK_URL)/);
});
