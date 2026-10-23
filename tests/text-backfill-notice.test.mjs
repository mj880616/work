import test from 'node:test';
import assert from 'node:assert/strict';

// LIB-글자채우기야간: home "예전 자료 글자 읽기 끝남 (N개)" line (app/text-backfill-notice.js). Synthetic values only.
const status = await import('../app/collection-status.js');
const mod = await import('../app/text-backfill-notice.js');
const done = (extra = {}) => ({ok:true, copy:{state:'found'}, text_backfill:{done_at:'2026-10-23T18:25:00.000Z', count:42, dismissed_at:null, ...extra}});

function fakeRt({answer, dismiss = {ok:true, dismissed_at:'2026-10-24T00:10:00.000Z'}, role = 'owner'} = {}) {
  const calls = [];
  return {calls, rt:{
    context:{read:() => ({user:{id:'u'}, workspace:{id:'w', slug:'kptu-work'}, membership:{role}})},
    session:{read:() => ({access_token:'token-fixture', user:{id:'u'}})},
    api:async (path, opts = {}) => {
      calls.push({path, opts});
      const value = path.includes('text_backfill_dismiss') ? dismiss : answer;
      if (value instanceof Error) throw value;
      return value;
    },
  }};
}
function fakeHost() {
  const listeners = [];
  const host = {hidden:false, innerHTML:'', addEventListener:(t, f) => listeners.push(f), removeEventListener() {},
    contains:() => true, querySelector:() => null};
  host.click = () => { const button = {disabled:false}; for (const f of listeners) f({target:{closest:sel => sel === '[data-text-done-dismiss]' ? button : null}}); return button; };
  return host;
}
const settle = () => new Promise(r => setTimeout(r, 0));

test('noticeFromStatus: only the ok shape with a done time; count and dismissed are strict', () => {
  assert.deepEqual(mod.noticeFromStatus(done()), {doneAt:'2026-10-23T18:25:00.000Z', count:42, dismissed:false});
  assert.equal(mod.noticeFromStatus(done({dismissed_at:'2026-10-24T00:00:00.000Z'})).dismissed, true);
  assert.equal(mod.noticeFromStatus(done({count:'42'})).count, null);
  for (const bad of [null, {}, {ok:false, text_backfill:done().text_backfill}, {ok:true}, {ok:true, text_backfill:null},
    {ok:true, text_backfill:[]}, {ok:true, text_backfill:{done_at:'어제'}}]) assert.equal(mod.noticeFromStatus(bad), null);
  assert.equal(mod.noticeText({count:42}), '예전 자료 글자 읽기 끝남 (42개)');
  assert.equal(mod.noticeText({count:null}), '예전 자료 글자 읽기 끝남');
});

test('mount: shows the line once done, shares the one status request with the collection card, hidden for non-owner', async () => {
  status.resetCollectionCache();
  const {rt, calls} = fakeRt({answer:done()});
  await status.readStatus(rt);
  const host = fakeHost(), m = mod.mountTextBackfillNotice(host, {rt});
  await m.refresh();
  assert.equal(host.hidden, false);
  assert.match(host.innerHTML, /예전 자료 글자 읽기 끝남 \(42개\)/);
  assert.match(host.innerHTML, /data-text-done-dismiss aria-label="알림 닫기"/);
  assert.equal(calls.filter(c => c.path === '/functions/v1/drive-summary?action=status').length, 1, 'one status request for both');

  status.resetCollectionCache();
  const other = fakeRt({answer:done(), role:'admin'}), h2 = fakeHost();
  await mod.mountTextBackfillNotice(h2, {rt:other.rt}).refresh();
  assert.equal(h2.hidden, true); assert.equal(other.calls.length, 0);

  for (const answer of [done({dismissed_at:'2026-10-24T00:00:00.000Z'}), {ok:true, copy:{state:'found'}}, new Error('Failed to fetch'), {ok:false, error:'METHOD_NOT_ALLOWED'}]) {
    status.resetCollectionCache();
    const r = fakeRt({answer}), h = fakeHost();
    await mod.mountTextBackfillNotice(h, {rt:r.rt}).refresh();
    assert.equal(h.hidden, true); assert.equal(h.innerHTML, '');
  }
});

test('✕ saves the dismissal on the server (no browser storage) and the shared answer stays dismissed', async () => {
  status.resetCollectionCache();
  const {rt, calls} = fakeRt({answer:done()}), host = fakeHost(), m = mod.mountTextBackfillNotice(host, {rt});
  await m.refresh();
  host.click(); await settle(); await settle();
  const post = calls.find(c => c.path === mod.DISMISS_PATH);
  assert.equal(post.opts.method, 'POST'); assert.equal(post.opts.refreshSession, false);
  assert.equal(host.hidden, true);
  await m.refresh();
  assert.equal(host.hidden, true, 'the cached status now carries the dismissed time');
  assert.equal(calls.filter(c => c.path.endsWith('action=status')).length, 1);
});

test('✕ failure keeps the line with a short note', async () => {
  status.resetCollectionCache();
  const {rt} = fakeRt({answer:done(), dismiss:new Error('Failed to fetch')}), host = fakeHost(), m = mod.mountTextBackfillNotice(host, {rt});
  await m.refresh();
  host.click(); await settle(); await settle(); await settle();
  assert.equal(host.hidden, false);
  assert.match(host.innerHTML, /닫지 못함/);
});
