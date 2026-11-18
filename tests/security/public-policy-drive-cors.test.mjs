import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../../supabase/functions/public-policy-drive/index.ts', import.meta.url),'utf8');

test('Drive reconnect CORS explicitly allows every production Web2 origin',()=>{
  for(const origin of [
    'https://mj880616.github.io',
    'https://work.bokdoong.com',
    'https://desk.bokdoong.com',
    'https://bokdoong.com',
    'https://nojoplus.com'
  ]) assert.equal(source.includes(`'${origin}'`),true,origin);
  assert.equal(source.includes("ALLOWED_ORIGINS.has(origin) ? origin : 'https://mj880616.github.io'"),true);
  assert.match(source,/const ALLOWED_ORIGINS = new Set\(\[/);
});

test('Drive CORS allowlist is an exact set of five origins (no prefix or suffix match)',()=>{
  const block=source.match(/const ALLOWED_ORIGINS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(block);
  const origins=[...block[1].matchAll(/'([^']+)'/g)].map(m=>m[1]).sort();
  assert.deepEqual(origins,[
    'https://bokdoong.com',
    'https://desk.bokdoong.com',
    'https://mj880616.github.io',
    'https://nojoplus.com',
    'https://work.bokdoong.com'
  ].sort());
  const uses=[...source.matchAll(/\borigin\b[^\n]*/g)].map(m=>m[0]);
  assert.equal(uses.some(line=>/origin\.(startsWith|endsWith|includes|indexOf|match)\(|\.(includes|indexOf)\(origin\)/.test(line)),false);
});


test('Drive OAuth returns to the canonical Web2 library',()=>{
  assert.equal(source.includes("const DRIVE_APP_URL = 'https://bokdoong.com/work/app/?view=library';"),true);
  assert.equal(source.includes("const CALENDAR_APP_URL = 'https://bokdoong.com/work/app/';"),true);
  // DOMAIN-주소이전 ①-D1: 돌아갈 화면에 옛 주소(desk)가 남지 않는다. 허용 주소에는 남는다(위 시험).
  assert.equal(/_APP_URL = 'https:\/\/desk\.bokdoong\.com/.test(source),false);
  assert.equal(source.includes("const DRIVE_APP_URL = 'https://work.bokdoong.com/?view=library';"),false);
});

// DOMAIN-nojoplus 1단계: nojoplus.com에서 시작한 Google 연결은 nojoplus.com으로 돌아온다(그 밖은 bokdoong.com 그대로).
test('Google OAuth returns to nojoplus.com only when it was started there (exact Origin, state marker)', () => {
  assert.equal(source.includes("const NEW_APP_ORIGIN = 'https://nojoplus.com';"), true);
  assert.equal(source.includes("return req.headers.get('Origin') === NEW_APP_ORIGIN;"), true);
  assert.equal(source.includes("const raw = 'drive.' + (startedOnNewHost(req) ? 'nojo.' : '') + crypto.randomUUID() + crypto.randomUUID();"), true);
  assert.equal(source.includes("return state?.split('.').includes('nojo') ? NEW_APP_ORIGIN : null;"), true);
  // 모든 Drive 돌려보내기가 state를 넘긴다(돌아갈 주소를 고르는 유일한 값).
  const calls = [...source.matchAll(/driveRedirect\(([^\n]*?)\), 302\)/g)].map(m => m[1]);
  assert.ok(calls.length >= 8);
  for (const call of calls) assert.match(call, /, state$/, call);
  for (const name of ['google-calendar', 'google-tasks']) {
    const fn = readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
    assert.equal(fn.includes("const platform=url.searchParams.get('platform')==='android'?'android':req.headers.get('Origin')==='https://nojoplus.com'?'nojo':'web';"), true, name);
  }
});

test('the OAuth return address is one of two fixed Web2 addresses', async () => {
  const { stripTypeScriptTypes } = await import('node:module');
  const pick = (name) => source.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0];
  const js = stripTypeScriptTypes([
    "const DRIVE_APP_URL = 'https://bokdoong.com/work/app/?view=library';",
    "const CALENDAR_APP_URL = 'https://bokdoong.com/work/app/';",
    "const NEW_APP_ORIGIN = 'https://nojoplus.com';",
    pick('returnOrigin'), pick('driveRedirect'), pick('calendarRedirect'),
    'globalThis.out = { driveRedirect, calendarRedirect };'
  ].join('\n'));
  const vm = await import('node:vm');
  const ctx = vm.createContext({ URL });
  vm.runInContext(js, ctx);
  const { driveRedirect, calendarRedirect } = ctx.out;
  assert.equal(driveRedirect('connected', undefined, undefined, 'drive.nojo.abc'), 'https://nojoplus.com/work/app/?view=library&drive=connected');
  assert.equal(driveRedirect('connected', undefined, undefined, 'drive.abc'), 'https://bokdoong.com/work/app/?view=library&drive=connected');
  assert.equal(driveRedirect('error', 'invalid_state', undefined, null), 'https://bokdoong.com/work/app/?view=library&drive=error&reason=invalid_state');
  assert.equal(calendarRedirect('connected', 'calendar.nojo.abc'), 'https://nojoplus.com/work/app/?view=calendar&google=connected');
  assert.equal(calendarRedirect('connected', 'tasks.web.abc'), 'https://bokdoong.com/work/app/?view=calendar&google=connected');
  assert.equal(calendarRedirect('connected', 'calendar.android.abc'), 'https://bokdoong.com/work/app/?view=calendar&google=connected&native=android');
  // 다른 값은 주소를 바꾸지 못한다.
  assert.equal(calendarRedirect('error', 'calendar.evil.example.abc'), 'https://bokdoong.com/work/app/?view=calendar&google=error');
});
