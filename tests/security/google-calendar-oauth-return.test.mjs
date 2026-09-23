import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const calendar = readFileSync(new URL('../../supabase/functions/google-calendar/index.ts', import.meta.url), 'utf8');
const tasks = readFileSync(new URL('../../supabase/functions/google-tasks/index.ts', import.meta.url), 'utf8');
const callback = readFileSync(new URL('../../supabase/functions/public-policy-drive/index.ts', import.meta.url), 'utf8');

test('calendar OAuth state is namespaced independently from Tasks and keeps the web platform', () => {
  assert.match(calendar, /const raw='calendar\.'\+platform\+'/);
  assert.match(tasks, /const raw='tasks\.'\+platform\+'/);
  assert.match(calendar, /redirect_uri:CALLBACK/);
});

test('calendar callback preserves the canonical calendar view for success and failure', () => {
  assert.match(callback, /function calendarRedirect\(result: 'connected' \| 'error'/);
  assert.match(callback, /u\.searchParams\.set\('view', 'calendar'\)/);
  assert.match(callback, /u\.searchParams\.set\('google', result\)/);
  assert.match(callback, /calendarRedirect\('connected', state\)/);
  assert.match(callback, /calendarRedirect\('error', state\)/);
});

test('callback keeps the same redirect_uri for Google authorization and token exchange', () => {
  const uses = callback.match(/redirect_uri: CALLBACK_URL/g) || [];
  assert.equal(uses.length, 2);
});
