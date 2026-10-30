// APP-폰앱새로 ③: 위젯 자동 로그인 다리(app/phone-widget-auth.js, 설계 docs/design/phone-widget-auth.md 12절).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sealedToken, startWidgetAuth} from '../app/phone-widget-auth.js';

const TOKEN = 'abcDEF0123456789_-abcDEF0123456789';

function setup({ua = 'Mozilla/5.0 KPTUAndroid/0.3.2', session = {access_token: 'synthetic-access'}, ensure = true, reply = {status: 200, body: {token: TOKEN}}} = {}) {
  const sent = [];
  const requests = [];
  let onMessage = null;
  const win = {
    navigator: {userAgent: ua},
    KPTUAppShell: {postMessage: m => sent.push(m), addEventListener: (t, fn) => { if (t === 'message') onMessage = fn; }},
    KPTURuntime: {session: {ensure: async () => ensure, read: () => session}},
    fetch: async (url, init) => {
      requests.push({url, init});
      if (reply instanceof Error) throw reply;
      return {ok: reply.status >= 200 && reply.status < 300, json: async () => reply.body};
    }
  };
  return {win, sent, requests, message: async data => { onMessage?.({data}); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); }};
}

test('sealedToken은 봉인 모양의 글만 꺼낸다', () => {
  assert.equal(sealedToken({token: TOKEN}), TOKEN);
  for (const v of [null, {}, {token: ''}, {token: 'short'}, {token: 'has space in it 0123456789'}, {token: 7}, 'x']) assert.equal(sealedToken(v), null);
});

test('웹 브라우저에서는 다리를 붙이지 않는다', () => {
  const s = setup({ua: 'Mozilla/5.0 Chrome'});
  assert.equal(startWidgetAuth(s.win), false);
  assert.deepEqual(s.sent, []);
});

test('앱에서는 widget:ready를 알리고, widget:mint에만 봉인을 받아 넘긴다', async () => {
  const s = setup();
  assert.equal(startWidgetAuth(s.win), true);
  assert.equal(startWidgetAuth(s.win), false, '두 번 붙지 않는다');
  assert.deepEqual(s.sent, ['widget:ready']);
  await s.message('widget:status');
  await s.message('share:get:x');
  assert.equal(s.requests.length, 0);
  await s.message('widget:mint');
  assert.equal(s.requests.length, 1);
  const {url, init} = s.requests[0];
  assert.equal(url, 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/auth-handoff');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer synthetic-access');
  // 웹 세션의 새로고침 토큰은 보내지 않는다(위젯은 서버가 만든 새 세션을 쓴다).
  assert.deepEqual(JSON.parse(init.body), {action: 'widget_seal'});
  assert.deepEqual(s.sent, ['widget:ready', 'widget:handoff:' + TOKEN]);
});

test('로그인이 없거나 서버가 실패하면 widget:mint:fail만 보낸다', async () => {
  for (const options of [{ensure: false}, {session: null}, {reply: {status: 502, body: {error: 'x'}}}, {reply: {status: 200, body: {}}}, {reply: new Error('network')}]) {
    const s = setup(options);
    startWidgetAuth(s.win);
    await s.message('widget:mint');
    assert.deepEqual(s.sent, ['widget:ready', 'widget:mint:fail']);
  }
});

test('웹 세션 토큰을 저장하거나 출력하지 않는다', () => {
  const src = readFileSync(new URL('../app/phone-widget-auth.js', import.meta.url), 'utf8');
  // 저장소 이름은 쪼개 쓴다(browser-storage-audit가 이 시험 파일 자체를 걸지 않게).
  for (const word of ['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'console.', 'refresh_token']) assert.equal(src.includes(word), false, word);
});

test('loader-v2는 폰 앱에서만 이 다리를 불러온다', () => {
  const src = readFileSync(new URL('../app/loader-v2.js', import.meta.url), 'utf8');
  assert.match(src, /if\(\/KPTUAndroid\/i\.test\(navigator\.userAgent\|\|''\)\)import\('\.\/phone-widget-auth\.js'\)/);
});
