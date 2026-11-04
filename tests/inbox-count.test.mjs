import test from 'node:test';
import assert from 'node:assert/strict';

// BASKET-정리함이름: "정리 안 된 것" = 업데이트 미분류 + 챙길 것 처리 전. Synthetic data only.
const count = await import('../app/inbox-count.js');
const radar = await import('../app/todo-radar-data.js');
const id = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cand = (n, over = {}) => ({id: id(n), kind: 'request', summary: `A 사업장 자료 회신 ${n}`, due: null, source_kind: 'basket', source_id: id(100 + n), source_day: '2026-10-21', evidence: '근거', project_id: null, organization_id: null, status: 'open', task_id: null, created_at: '2026-10-21T01:00:00Z', decided_at: null, ...over});
const note = (n, over = {}) => ({id: `n${n}`, raw_text: `메모 ${n}`, attachments: [], metadata: {}, archived_at: null, ...over});

test('update count: unclassified only (classified and 보류 are not counted)', () => {
  const notes = [note(1), note(2), note(3, {archived_at: '2026-10-20T00:00:00Z'}), note(4)];
  const links = [{note_id: 'n2', status: 'confirmed', organization_id: 'o1'}];
  assert.equal(count.unsortedUpdates(notes, links), 2);
  // 보류로 보내면 바로 줄어든다.
  assert.equal(count.unsortedUpdates(notes.map(n => n.id === 'n1' ? {...n, archived_at: 'x'} : n), links), 1);
  assert.equal(count.unsortedUpdates(), 0);
});

test('todo count: open only, and what is already a task by title is left out', () => {
  const rows = [cand(1), cand(2, {status: 'tasked'}), cand(3, {status: 'dismissed'}), cand(4, {summary: '이미 있는 할 일'})];
  assert.equal(count.openTodos(rows), 2);
  assert.equal(count.openTodos(rows, ['이미  있는 할 일!']), 1);
});

test('TG-요청강조: asks = open telegram candidates only (same read, already-a-task by title left out)', () => {
  const rows = [cand(1, {source_kind: 'telegram'}), cand(2, {source_kind: 'telegram', status: 'dismissed'}), cand(3), cand(4, {source_kind: 'telegram', summary: '이미 있는 할 일'})];
  assert.equal(count.openAsks(rows), 2);
  assert.equal(count.openAsks(rows, ['이미 있는 할 일']), 1);
  assert.equal(count.inboxCount({notes: [], links: [], candidates: rows}).asks, 2);
  assert.equal(count.openAsks(), 0);
});

test('inboxCount adds the two; readInboxCount reads both and treats a missing table as 0', async () => {
  assert.deepEqual(count.inboxCount({notes: [note(1)], links: [], docs: [], candidates: [cand(1), cand(2)]}), {update: 1, todo: 2, total: 3, asks: 0});
  const rtWith = api => ({context: {read: () => ({user: {id: 'u'}, workspace: {id: 'w'}})}, session: {ensure: async () => true, read: () => ({access_token: 't'}), epoch: () => 1}, api: async (path, opts) => api(path, opts)});
  const ok = rtWith(async path => path.includes('app_todo_candidates') ? [cand(1)] : []);
  assert.deepEqual(await count.readInboxCount(ok), {ok: true, update: 0, todo: 1, total: 1, asks: 0});
  const gone = rtWith(async path => { if (path.includes('app_todo_candidates')) throw Object.assign(new Error('x'), {status: 404}); return []; });
  assert.deepEqual(await count.readInboxCount(gone), {ok: true, update: 0, todo: 0, total: 0, asks: 0});
  const down = rtWith(async path => { if (path.includes('app_todo_candidates')) throw Object.assign(new Error('x'), {status: 500}); return []; });
  assert.deepEqual(await count.readInboxCount(down), {ok: false});
});

test('PERF 요청 합치기(S48-59): 미리 시작한 읽기(parts)로 세면 다시 읽지 않고, 할 일 제목은 나중에 빼도 된다', async () => {
  const calls = [];
  const rt = {context: {read: () => ({user: {id: 'u'}, workspace: {id: 'w'}})}, api: async path => { calls.push(path); return path.includes('app_todo_candidates') ? [cand(1), cand(2, {summary: '이미 있는 할 일'})] : []; }};
  const parts = count.readInboxParts(rt);
  assert.ok(calls.length > 0, '부르는 즉시 읽기를 시작한다');
  await parts;
  const read = calls.length;
  assert.deepEqual(await count.readInboxCount(rt, {taskTitles: ['이미 있는 할 일'], parts}), {ok: true, update: 0, todo: 1, total: 1, asks: 0});
  assert.equal(calls.length, read, 'parts를 넘기면 readInboxCount가 따로 읽지 않는다');
  const again = calls.length;
  await count.readInboxCount(rt, {parts});
  assert.equal(calls.length, again, '같은 parts는 다시 읽지 않는다');
  const failed = Promise.reject(new Error('x')); failed.catch(() => {});
  assert.deepEqual(await count.readInboxCount(rt, {parts: failed}), {ok: false});
});

test('PERF 요청 합치기(S48-59): 홈 요약은 들어올 때 숫자 재료 읽기를 할 일 읽기보다 먼저 시작하고, 업무일지 읽기보다 먼저 부른다', async () => {
  const {readFileSync} = await import('node:fs');
  const src = readFileSync(new URL('../app/home-summary.js', import.meta.url), 'utf8');
  const enter = src.slice(src.indexOf('enter() {'), src.indexOf('refresh,', src.indexOf('enter() {')));
  assert.ok(enter.indexOf('readInboxParts(rt)') > 0 && enter.indexOf('readInboxParts(rt)') < enter.indexOf('listTasks'), enter);
  assert.match(enter, /refresh\(\{parts, promises\}\)/);
  const journal = readFileSync(new URL('../app/journal.js', import.meta.url), 'utf8');
  const jEnter = journal.slice(journal.indexOf('function enter(detail)'));
  assert.ok(jEnter.indexOf('homeTop?.enter()') < jEnter.indexOf('loadWeek('), '홈 요약 enter가 loadWeek보다 먼저(같은 주소 읽기가 함께 나가 한 번으로 합쳐짐)');
});

test('readInboxCandidates: open rows and handled rows in two reads, malformed rows skipped', async () => {
  const calls = [];
  const rt = {context: {read: () => ({user: {id: 'u'}, workspace: {id: 'w'}})}, api: async path => { calls.push(path); return path.includes('status=eq.open') ? [cand(1), {...cand(2), id: 'x'}] : [cand(3, {status: 'tasked'}), cand(4, {status: 'dismissed'})]; }};
  const result = await radar.readInboxCandidates(rt);
  assert.deepEqual(result.rows.map(r => r.status), ['open', 'tasked', 'dismissed']);
  // TODO-이미함·환류: 처리한 줄의 결과(무시/내 일 아님)를 결과 기록에서 한 번 더 읽는다.
  assert.equal(calls.length, 3);
  assert.match(calls[0], /workspace_id=eq\.w&status=eq\.open/);
  assert.match(calls[1], /status=in\.\(tasked,dismissed,done\)/);
  assert.match(calls[2], /app_todo_feedback\?workspace_id=eq\.w&candidate_id=in\./);
});
