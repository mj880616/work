// UI-앱안알림 4·5단계(S47-40): 알림 줄·최근 알림 규칙(app/phone-push-model.mjs)과 화면 경계. 서버·화면 없이 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {noticeParam, noticePlace, noticeItems, recentItems, NOTICE_TEXT, RECENT_LABEL} from '../app/phone-push-model.mjs';

test('notice mark in the address: kind.ref only, known kinds, shaped ref', () => {
  assert.deepEqual(noticeParam('?view=home&mode=week&notice=next_week.w2026-11-09'), {kind:'next_week', ref_key:'w2026-11-09'});
  assert.deepEqual(noticeParam('?notice=test.t1762'), {kind:'test', ref_key:'t1762'});
  assert.deepEqual(noticeParam('?notice=task_due.a:b.c'), {kind:'task_due', ref_key:'a:b.c'});
  for (const bad of ['', '?view=home', '?notice=', '?notice=next_week', '?notice=.w1', '?notice=calendar.x', '?notice=next_week.a%20b', `?notice=next_week.${'x'.repeat(81)}`, '?notice=constructor.x'])
    assert.equal(noticeParam(bad), null, bad);
});

test('open place: only /work/app/ addresses, view/pane/mode', () => {
  assert.deepEqual(noticePlace('/work/app/?view=home&mode=week&notice=next_week.w1'), {view:'home', pane:null, mode:'week'});
  assert.deepEqual(noticePlace('/work/app/?view=basket&pane=todo&notice=morning.d'), {view:'basket', pane:'todo', mode:null});
  assert.deepEqual(noticePlace('/work/app/'), {view:'home', pane:null, mode:null});
  for (const bad of ['https://evil.example/work/app/', '//evil.example/work/app/', '/work/app/../x', '/work/app/?view=<x>', 'javascript:alert(1)', null, 1])
    assert.equal(noticePlace(bad), null, String(bad));
  assert.deepEqual(noticePlace('/work/app/?view=Home1'), {view:'home', pane:null, mode:null});
});

test('bar items: known done kinds with a safe place only, at most five', () => {
  const ok = {kind:'next_week', ref_key:'w2026-11-09', open:'/work/app/?view=home&mode=week&notice=next_week.w2026-11-09'};
  assert.deepEqual(noticeItems({items:[ok, {...ok, kind:'test'}, {...ok, open:'https://evil/'}, {...ok, ref_key:'a b'}]}), [ok]);
  assert.equal(noticeItems({items:Array(9).fill(ok)}).length, 5);
  assert.deepEqual(noticeItems(null), []);
  for (const kind of Object.keys(NOTICE_TEXT)) assert.ok(RECENT_LABEL[kind], kind);
});

test("recent list: one line 'MM/DD HH:MM · 무엇' in Seoul time, opened flag, unknown kinds dropped", () => {
  const out = recentItems({items:[
    {kind:'next_week', ref_key:'w2026-11-09', at:'2026-11-06T07:00:00.000Z', opened:false, open:'/work/app/?view=home&mode=week&notice=next_week.w2026-11-09'},
    {kind:'test', ref_key:'t1', at:'2026-11-05T15:30:00.000Z', opened:true, open:'/work/app/?view=profile&notice=test.t1'},
    {kind:'calendar', ref_key:'x', at:'2026-11-05T15:30:00.000Z', open:'/work/app/'},
    {kind:'test', ref_key:'t2', at:'nope', open:'/work/app/'},
  ]});
  assert.deepEqual(out.map(r => [r.line, r.opened]), [['11/06 16:00 · 다음 주 준비 한 장', false], ['11/06 00:30 · 시험 알림', true]]);
});

test('screen boundary: phone-push is called only through phone-push-settings.js; no device storage; no bell or red badge', () => {
  const done = readFileSync(new URL('../app/notice-done.js', import.meta.url), 'utf8');
  assert.doesNotMatch(done, /functions\/v1\/phone-push/);
  assert.match(done, /import \{callPush\} from '\.\/phone-push-settings\.js'/);
  assert.doesNotMatch(done, new RegExp(['local', 'session'].map(w => w + 'Storage').concat(['indexed' + 'DB']).join('|')));
  assert.doesNotMatch(done, /bell|badge|🔔/i);
  const loader = readFileSync(new URL('../app/loader-v2.js', import.meta.url), 'utf8');
  assert.match(loader, /import\('\.\/notice-done\.js'\)\.then\(m=>m\.startDoneNotices\(\)\)/);
});
