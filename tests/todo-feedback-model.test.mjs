import test from 'node:test';
import assert from 'node:assert/strict';

// TODO-이미함·환류: [이미 함]·결과 기록(app/todo-radar-data.js)과 주간 비율 한 줄(app/todo-feedback-model.mjs). 가상 문장만.
const radar = await import('../app/todo-radar-data.js');
const model = await import('../app/todo-feedback-model.mjs');
const id = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cand = (over = {}) => ({id: id(1), kind: 'request', summary: '가상 자료 회신.', source_kind: 'note', source_id: id(2), source_day: '2026-11-01', status: 'open', ...over});
function fakeRt(api) {
  const calls = [];
  return {calls, rt: {context: {read: () => ({user: {id: 'u'}, workspace: {id: 'w'}})}, api: async (path, opts = {}) => { calls.push({path, opts}); return api(path, opts); }}};
}

test('done is a valid candidate status; other words are not', () => {
  assert.equal(radar.validCandidate(cand({status: 'done'})), true);
  assert.equal(radar.validCandidate(cand({status: 'finished'})), false);
});

test('markDone: guarded open -> done with a decided time; reopen from done', async () => {
  const {rt, calls} = fakeRt(async (path, opts) => [{id: id(1), status: opts.body.status}]);
  assert.equal(await radar.markDone(id(1), rt, new Date('2026-11-01T09:00:00Z')), true);
  assert.match(calls[0].path, /app_todo_candidates\?id=eq\.[^&]+&workspace_id=eq\.w&status=eq\.open/);
  assert.deepEqual(calls[0].opts.body, {status: 'done', decided_at: '2026-11-01T09:00:00.000Z'});
  assert.equal(await radar.reopenCandidate(id(1), rt, 'done'), true);
  assert.match(calls[1].path, /status=eq\.done/);
  assert.deepEqual(calls[1].opts.body, {status: 'open', decided_at: null});
});

test('feedbackBody: owner workspace, outcome, proposal text; edited only for tasked and only when different', () => {
  assert.deepEqual(radar.feedbackBody(cand(), 'done', '', 'w'), {workspace_id: 'w', candidate_id: id(1), outcome: 'done', kind: 'request', source_kind: 'note', summary: '가상 자료 회신.', edited: null});
  assert.equal(radar.feedbackBody(cand(), 'tasked', '가상 자료 회신', 'w').edited, null);
  assert.equal(radar.feedbackBody(cand(), 'tasked', '가상 자료 금요일까지 회신', 'w').edited, '가상 자료 금요일까지 회신');
  assert.equal(radar.feedbackBody(cand(), 'done', '고친 것', 'w').edited, null);
  assert.equal(radar.feedbackBody(cand(), 'maybe', '', 'w'), null);
  assert.equal(radar.feedbackBody(cand({kind: 'promise'}), 'done', '', 'w'), null);
  assert.equal(radar.feedbackBody(cand({summary: '가'.repeat(101)}), 'done', '', 'w'), null);
});

test('logFeedback posts one row and returns its id; a failure only returns null; dropFeedback deletes by id in my workspace', async () => {
  const ok = fakeRt(async () => [{id: id(7)}]);
  assert.equal(await radar.logFeedback(cand(), 'dismissed', {rt: ok.rt}), id(7));
  assert.equal(ok.calls[0].path, '/rest/v1/app_todo_feedback?select=id');
  assert.equal(ok.calls[0].opts.method, 'POST');
  const down = fakeRt(async () => { throw Object.assign(new Error('x'), {status: 404}); });
  assert.equal(await radar.logFeedback(cand(), 'done', {rt: down.rt}), null);
  assert.equal(await radar.dropFeedback(id(7), ok.rt), true);
  assert.match(ok.calls[1].path, /app_todo_feedback\?id=eq\.[^&]+&workspace_id=eq\.w/);
  assert.equal(ok.calls[1].opts.method, 'DELETE');
  assert.equal(await radar.dropFeedback('bad', ok.rt), false);
});

test('markNotMine also keeps a not_mine result; undo removes it', async () => {
  const {rt, calls} = fakeRt(async (path, opts) => path.includes('app_todo_candidates') ? [{id: id(1), status: opts.body.status}] : [{id: path.includes('feedback') ? id(8) : id(9)}]);
  const r = await radar.markNotMine(cand(), rt);
  assert.deepEqual(r, {ok: true, saved: true, exampleId: id(9), feedbackId: id(8)});
  assert.equal(calls.find(c => c.path.includes('app_todo_feedback')).opts.body.outcome, 'not_mine');
  assert.equal(await radar.undoNotMine(id(1), r.exampleId, rt, r.feedbackId), true);
  assert.ok(calls.some(c => c.opts.method === 'DELETE' && c.path.includes('app_todo_feedback')));
});

test('handled rows get their outcome label from the result log; a missing log leaves them plain', async () => {
  const {rt} = fakeRt(async path => path.includes('status=eq.open') ? [] : path.includes('app_todo_feedback') ? [{candidate_id: id(3), outcome: 'not_mine'}] : [cand({id: id(3), status: 'dismissed'}), cand({id: id(4), status: 'done'})]);
  const r = await radar.readInboxCandidates(rt);
  assert.deepEqual(r.rows.map(x => [x.status, x.outcome]), [['dismissed', 'not_mine'], ['done', undefined]]);
  const gone = fakeRt(async path => { if (path.includes('app_todo_feedback')) throw Object.assign(new Error('x'), {status: 404}); return path.includes('status=eq.open') ? [] : [cand({id: id(3), status: 'dismissed'})]; });
  assert.equal((await radar.readInboxCandidates(gone.rt)).rows[0].outcome, undefined);
});

test('weekBounds: Monday 00:00 in Korea, also late Sunday night and early Monday', () => {
  assert.deepEqual(model.weekBounds(new Date('2026-11-04T03:00:00Z')), {prev: '2026-10-18T15:00:00.000Z', last: '2026-10-25T15:00:00.000Z', current: '2026-11-01T15:00:00.000Z'});
  // 11/01(일) 23:30 한국 = 아직 지난주가 10/19 주
  assert.equal(model.weekBounds(new Date('2026-11-01T14:30:00Z')).current, '2026-10-25T15:00:00.000Z');
  // 11/02(월) 00:10 한국 = 새 주
  assert.equal(model.weekBounds(new Date('2026-11-01T15:10:00Z')).current, '2026-11-01T15:00:00.000Z');
});

test('weeklySummary: last week ratios and the biggest change; nothing when both weeks are empty', () => {
  const now = new Date('2026-11-04T03:00:00Z');
  const at = (day, outcome, n = 1) => Array.from({length: n}, () => ({outcome, summary: '가상', created_at: `${day}T03:00:00Z`}));
  const rows = [...at('2026-10-27', 'tasked', 4), ...at('2026-10-28', 'done', 2), ...at('2026-10-29', 'dismissed', 3), ...at('2026-10-30', 'not_mine', 1),
    ...at('2026-10-20', 'tasked', 3), ...at('2026-10-21', 'dismissed', 7)];
  const s = model.weeklySummary(rows, now);
  assert.equal(s.text, '지난주 챙길 것 10건 · 할 일로 40% · 이미 함 20% · 무시 30% · 내 일 아님 10% · 그 전 주보다 무시 −40%p');
  assert.equal(model.weeklySummary([], now), null);
  assert.equal(model.weeklySummary(at('2026-10-20', 'done', 2), now).text, '지난주 챙길 것 처리 0건');
  assert.match(model.weeklySummary([...at('2026-10-27', 'tasked', 10), ...at('2026-10-20', 'tasked', 10)], now).text, /그 전 주와 비슷$/);
  assert.doesNotMatch(model.weeklySummary(at('2026-10-27', 'done', 1), now).text, /그 전 주/);
});

test('recentByOutcome: last week only, newest first, at most n per outcome, edited shown as suggestion → final', () => {
  const now = new Date('2026-11-04T03:00:00Z');
  const rows = [{outcome: 'tasked', summary: '가상 제안', edited: '가상 고친 것', created_at: '2026-10-27T01:00:00Z'},
    {outcome: 'done', summary: '가상 한 일', created_at: '2026-10-20T01:00:00Z'}];
  assert.deepEqual(model.recentByOutcome(rows, now), [{outcome: 'tasked', label: '할 일로', lines: ['가상 제안 → 가상 고친 것']}]);
});

// TODO-이미할일있음: 결과 말과 비슷한 할 일 고르기(가상 문장).
test('already_tasked is an accepted outcome and similarTasks ranks open tasks', async () => {
  assert.ok(radar.FEEDBACK_OUTCOMES.includes('already_tasked'));
  const {similarTasks} = await import('../app/todo-link-model.mjs');
  const tasks = [{id: 'a', title: '가상 자료 회신 보내기', status: 'needsAction'}, {id: 'b', title: '전혀 다른 일', status: 'needsAction'}, {id: 'c', title: '가상 자료 회신', status: 'completed'}];
  const got = similarTasks('가상 자료 회신.', tasks);
  assert.deepEqual(got.map(t => t.id), ['a']);
  assert.deepEqual(similarTasks('가상 자료 회신.', null), []);
});
