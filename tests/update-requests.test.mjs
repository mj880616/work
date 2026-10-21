import test from 'node:test';
import assert from 'node:assert/strict';

// JOURNAL-요청표시: an update's [임원 요청]·[논의 요청] marks live in its existing metadata jsonb (metadata.requests); no database
// change. UI-요청버튼삭제: the screen no longer writes marks, but marks already saved are still read (tags, weekly draft), and every
// metadata writer keeps and guards them, so no write drops them. Fake content only.
import {UPDATE_REQUESTS, normalizeRequests, noteRequests, requestsGuard, requestPrefix, requestTagsHtml} from '../app/update-requests.js';
import * as basketData from '../app/basket-data.js';
const {createNote, setNoteFolder, setNotePinned} = basketData;
import {noteTaskGuard} from '../app/basket-note-tasks.js';
import {orgNewsOn, projectNewsOn, weeklyDraft, weekRequests} from '../app/journal-data.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function runtime(fresh, {reply} = {}) {
  const calls = [];
  return {calls, context: {read: () => ({workspace: {id: 'w'}})}, api: async (path, options = {}) => {
    calls.push({path, options});
    if (reply) return reply(path, options);
    if (!options.method) return [fresh];
    if (options.method === 'POST') return [{id: 'new', ...options.body}];
    return [{...fresh, metadata: options.body.metadata}];
  }};
}
const query = call => new URL(call.path, 'https://x.invalid').searchParams;

test('two kinds in a fixed order; unknown or repeated keys are ignored when read', () => {
  assert.deepEqual(UPDATE_REQUESTS.map(r => [r.key, r.label, r.short]), [['exec_schedule', '임원 일정 배정 요청', '임원 요청'], ['discussion', '논의 요청', '논의 요청']]);
  assert.deepEqual(normalizeRequests(['discussion', 'x', 'exec_schedule', 'discussion']), ['exec_schedule', 'discussion']);
  assert.deepEqual(normalizeRequests('exec_schedule'), []);
  assert.deepEqual(noteRequests({metadata: {requests: ['discussion']}}), ['discussion']);
  assert.deepEqual(noteRequests({metadata: []}), []);
  assert.deepEqual(noteRequests(null), []);
  assert.equal(requestPrefix(['discussion', 'exec_schedule']), '[임원 요청] [논의 요청] ');
  assert.equal(requestPrefix([]), '');
  assert.equal(requestTagsHtml([], esc), '');
  assert.match(requestTagsHtml(['discussion'], esc), /data-request-tag="discussion">논의 요청</);
});

test('the guard compares the marks as PostgREST shows the jsonb text; no key is is.null; an odd value adds no guard', () => {
  assert.equal(requestsGuard({}), '&metadata->>requests=is.null');
  assert.equal(requestsGuard(null), '&metadata->>requests=is.null');
  assert.equal(requestsGuard({requests: ['exec_schedule', 'discussion']}), '&metadata->>requests=eq.' + encodeURIComponent('["exec_schedule", "discussion"]'));
  assert.equal(requestsGuard({requests: 'odd'}), '');
  assert.equal(requestsGuard({requests: [1]}), '');
});

// UI-요청버튼삭제: the screen no longer sets marks, so a new update never carries them (and the setter is gone).
test('a new update is inserted without any request marks', async () => {
  const rt = runtime(null);
  await createNote({raw_text: '가상 업데이트', requests: ['discussion']}, rt);
  assert.deepEqual(rt.calls[0].options.body, {workspace_id: 'w', raw_text: '가상 업데이트'});
  assert.equal(Object.hasOwn(basketData, 'setUpdateRequests'), false);
});

test('the folder, pin and task writers keep the marks and guard them too', async () => {
  const fresh = {id: 'n1', updated_at: 'u', metadata: {requests: ['exec_schedule']}};
  const rt = runtime(fresh);
  const moved = await setNoteFolder({id: 'n1'}, '가상', rt);
  assert.deepEqual(moved.metadata, {requests: ['exec_schedule'], folder: '가상'});
  assert.deepEqual(Object.keys(rt.calls[1].options.body), ['metadata']);
  assert.equal(query(rt.calls[1]).get('metadata->>requests'), 'eq.["exec_schedule"]');
  assert.equal(query(rt.calls[1]).get('metadata->tasks->0->>task_id'), 'is.null');
  rt.calls.length = 0;
  const pinned = await setNotePinned({id: 'n1'}, true, rt, new Date('2026-10-20T00:00:00Z'));
  assert.deepEqual(pinned.metadata.requests, ['exec_schedule']);
  assert.equal(query(rt.calls[1]).get('metadata->>requests'), 'eq.["exec_schedule"]');
  const guard = new URLSearchParams(noteTaskGuard({updated_at: 'u', metadata: {requests: ['exec_schedule', 'discussion']}}));
  assert.equal(guard.get('metadata->>requests'), '["exec_schedule", "discussion"]'.replace(/^/, 'eq.'));
  assert.equal(new URLSearchParams(noteTaskGuard({updated_at: 'u', metadata: {}})).get('metadata->>requests'), 'is.null');
});

const at = (h, m = 0) => `2026-10-06T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
const basket = () => ({
  notes: [
    {id: 'a', raw_text: '가상 조직 소식\n둘째', occurred_at: at(1), metadata: {requests: ['exec_schedule']}},
    {id: 'b', raw_text: '가상 사업 메모', occurred_at: at(2), metadata: {requests: ['discussion', 'exec_schedule']}},
    {id: 'c', raw_text: '표시 없음', occurred_at: at(3), metadata: {}},
    {id: 'd', raw_text: '미분류 논의', occurred_at: '2026-10-08T02:00:00Z', metadata: {requests: ['discussion']}},
    {id: 'e', raw_text: '지난주', occurred_at: '2026-10-01T02:00:00Z', metadata: {requests: ['discussion']}},
  ],
  links: [
    {note_id: 'a', status: 'confirmed', organization_id: 'o1', organization: {name: '가상 조직'}},
    {note_id: 'b', status: 'confirmed', project_id: 's1', project: {name: '가상 사업'}},
  ],
  docs: [],
});

test('day card: a marked update carries its tags per item; sections without a mark keep their shape', () => {
  assert.deepEqual(orgNewsOn({basket: basket()}, '2026-10-06'), [
    {name: '가상 조직', items: ['가상 조직 소식'], tags: [['exec_schedule']]},
    {name: '미분류', items: ['표시 없음']},
  ]);
  assert.deepEqual(projectNewsOn({basket: basket()}, '2026-10-06'), [{name: '가상 사업', items: ['가상 사업 메모'], tags: [['exec_schedule', 'discussion']]}]);
});

test('weekly draft: the two request lists come first ("(없음)" when none), then the days; a marked item keeps its tag', () => {
  assert.deepEqual(weekRequests(basket(), '2026-10-05'), {
    exec_schedule: ['10월 6일(화) · 가상 조직: 가상 조직 소식', '10월 6일(화) · 가상 사업: 가상 사업 메모'],
    discussion: ['10월 6일(화) · 가상 사업: 가상 사업 메모', '10월 8일(목): 미분류 논의'],
  });
  const ok = items => ({status: 'ok', items});
  const materials = {events: ok([]), tasks: ok([]), basket: ok(basket()), orgUpdates: ok([]), projectUpdates: ok([]), meetings: ok([]), documents: ok([]), sharePages: ok([])};
  const rows = weeklyDraft({start: '2026-10-05', lines: new Map(), materials, today: '2026-10-06'}).split('\n');
  assert.deepEqual(rows.slice(0, 11), ['주간 업무일지 10월 5일(월) ~ 10월 11일(일)', '',
    '[임원 일정 배정 요청]', '- 10월 6일(화) · 가상 조직: 가상 조직 소식', '- 10월 6일(화) · 가상 사업: 가상 사업 메모', '',
    '[논의 요청]', '- 10월 6일(화) · 가상 사업: 가상 사업 메모', '- 10월 8일(목): 미분류 논의', '', '■ 10월 5일(월)']);
  assert.ok(rows.includes('- 조직 소식 · 가상 조직: [임원 요청] 가상 조직 소식'));
  assert.ok(rows.includes('- 프로젝트 소식 · 가상 사업: [임원 요청] [논의 요청] 가상 사업 메모'));
  assert.ok(rows.includes('- 조직 소식 · 미분류: 표시 없음'));
  const empty = weeklyDraft({start: '2026-10-12', lines: new Map(), materials, today: '2026-10-06'}).split('\n');
  assert.deepEqual(empty.slice(2, 8), ['[임원 일정 배정 요청]', '- (없음)', '', '[논의 요청]', '- (없음)', '']);
  const failed = weeklyDraft({start: '2026-10-05', lines: new Map(), materials: {...materials, basket: {status: 'failed'}}, today: '2026-10-06'}).split('\n');
  assert.deepEqual(failed.slice(2, 8), ['[임원 일정 배정 요청]', '- (업데이트를 불러오지 못해 빠졌어요)', '', '[논의 요청]', '- (업데이트를 불러오지 못해 빠졌어요)', '']);
});
