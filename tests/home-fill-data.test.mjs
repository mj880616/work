import test from 'node:test';
import assert from 'node:assert/strict';

// HOME-모바일홈채우기: 새 칸의 읽기(원장 경로 재사용, 텔레그램 소식 오늘 수). Synthetic data only.
const data = await import('../app/home-fill-data.js');
const rtWith = api => ({context: {read: () => ({user: {id: 'u'}, workspace: {id: '00000000-0000-4000-8000-000000000001'}})}, api: async (path, opts) => api(path, opts)});
const rec = n => ({id: `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`, ledger_id: `L-${n}`, kind: 'commitment', title: `약속 ${n}`, follow_up_on: '2026-10-01'});

test('readMissedPromises: asks the ledger overdue path and keeps well-formed rows only', async () => {
  const paths = [];
  const rt = rtWith(async path => { paths.push(path); return [rec(1), {id: 'bad'}, rec(2)]; });
  const out = await data.readMissedPromises(rt);
  assert.equal(out.ok, true);
  assert.deepEqual(out.rows.map(r => r.ledger_id), ['L-1', 'L-2']);
  assert.equal(paths.length, 1);
  assert.match(paths[0], /app_ledger_records\?workspace_id=eq\.00000000-0000-4000-8000-000000000001&kind=eq\.commitment&commitment_status=eq\.waiting/);
});

test('readMissedPromises: a failed read is {ok:false}, never "없음"', async () => {
  const out = await data.readMissedPromises(rtWith(async () => { throw Object.assign(new Error('x'), {status: 500}); }));
  assert.deepEqual(out, {ok: false, rows: []});
});

test('readNewsCount: today kept count from app_feed_days; no row or a failed read is null', async () => {
  const today = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Seoul'}).format(new Date());
  assert.equal(await data.readNewsCount(rtWith(async () => [{day: today, source: 'telegram', total_count: 30, kept_count: 12, room_count: 4}])), 12);
  assert.equal(await data.readNewsCount(rtWith(async () => [])), null);
  assert.equal(await data.readNewsCount(rtWith(async () => { throw new Error('404'); })), null);
});
