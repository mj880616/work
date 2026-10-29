import test from 'node:test';
import assert from 'node:assert/strict';

// TG-요청강조: 텔레그램 소식 목록의 나한테 온 요청·담당조직·일정 꼬리표와 칸 거르기(app/tg-mark-model.mjs),
// 그리고 그 재료 읽기(todo-radar-data.js readTelegramAsks, feed-data.js readLineMarks). 이름·방·내용은 모두 지어낸 것이다.
const m = await import('../app/tg-mark-model.mjs');
const radar = await import('../app/todo-radar-data.js');
const feed = await import('../app/feed-data.js');
const id = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = n => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cand = (n, over = {}) => ({id: id(n), kind: 'request', summary: `가상 회신 ${n}`, due: null, source_kind: 'telegram', source_id: item(n), source_day: '2026-10-06', evidence: '근거', project_id: null, organization_id: null, status: 'open', task_id: null, created_at: '2026-10-06T01:00:00Z', decided_at: null, tg: {room_key: 'room-a', room_label: '가상방'}, ...over});
const line = (room, day) => ({room_key: room, day, archived_at: null, day_hidden_at: null});

test('askIndex: open telegram candidates with a known room only, grouped by room|day and by item id', () => {
  const {byLine, byItem} = m.askIndex([
    cand(1), cand(2, {summary: '면담 가능 시간 회신'}), cand(3, {status: 'dismissed'}), cand(4, {source_kind: 'basket'}),
    cand(5, {tg: undefined}), cand(6, {source_day: '2026-10-05', tg: {room_key: 'room-b'}}), cand(7, {summary: '  '}),
  ]);
  assert.deepEqual([...byLine.keys()], ['room-a|2026-10-06', 'room-b|2026-10-05']);
  assert.equal(byLine.get('room-a|2026-10-06').length, 2);
  assert.equal(byItem.get(item(2)), '면담 가능 시간 회신');
  assert.equal(byItem.has(item(3)), false);
  assert.deepEqual(m.askIndex(null).byLine.size, 0);
});

test('askTagText: first request and "외 n"', () => {
  assert.equal(m.askTagText([{summary: '면담 가능 시간 회신'}]), '나한테 요청 · 면담 가능 시간 회신');
  assert.equal(m.askTagText([{summary: '자료 회신'}, {summary: '참석 여부'}, {summary: '명단'}]), '나한테 요청 · 자료 회신 외 2');
  assert.equal(m.askTagText([]), '');
  assert.equal(m.askTagText(undefined), '');
});

test('isScheduleText: dates, times, weekdays and schedule words; plain notices are not', () => {
  for (const t of ['교섭 다음 주 화요일로 미뤄짐', '원고 금요일 18시 마감', '기자회견 10. 8. 11시 확정', '10월 30일 집회', '오후 2시 회의', '14:00 시작', '옛 일정 확인', '회신 기한 확인'])
    assert.equal(m.isScheduleText(t), true, t);
  for (const t of ['가상 공지 한 건', '자료집 초안 공유 요청', '', null, '3명 참석 확정']) assert.equal(m.isScheduleText(t), false, String(t));
});

test('markIndex + markTagText: 담당조직 only for my organizations, 일정 by title or summary', () => {
  const marks = m.markIndex([
    {room_key: 'room-a', day: '2026-10-06', organization_id: 'o-mine', title: '공지', summary: '가상 공지'},
    {room_key: 'room-a', day: '2026-10-06', organization_id: null, title: '마감', summary: '원고 금요일 18시'},
    {room_key: 'room-b', day: '2026-10-06', organization_id: 'o-other', title: '공지', summary: '가상 공지'},
    {room_key: 'room-c', day: '2026-10-06', organization_id: 'o-mine', title: '공지', summary: '가상 공지'},
    {room_key: '', day: '2026-10-06', organization_id: 'o-mine'},
  ], new Set(['o-mine']));
  assert.equal(m.markTagText(marks.get('room-a|2026-10-06')), '담당조직 · 일정');
  assert.equal(m.markTagText(marks.get('room-b|2026-10-06')), '');
  assert.equal(m.markTagText(marks.get('room-c|2026-10-06')), '담당조직');
  assert.equal(m.markTagText({schedule: true}), '일정');
  assert.equal(m.markTagText(undefined), '');
  assert.equal(m.markIndex(null, null).size, 0);
});

test('askCount and filterLines: the [나한테 온 요청 n] chip counts requests on the listed lines and keeps only those lines', () => {
  const {byLine} = m.askIndex([cand(1), cand(2), cand(3, {tg: {room_key: 'room-b'}}), cand(4, {tg: {room_key: 'gone'}})]);
  const lines = [line('room-a', '2026-10-06'), line('room-b', '2026-10-06'), line('room-c', '2026-10-06')];
  assert.equal(m.askCount(lines, byLine), 3);
  assert.deepEqual(m.filterLines(lines, 'ask', {byLine}).map(l => l.room_key), ['room-a', 'room-b']);
  assert.deepEqual(m.filterLines(lines, '', {byLine}).map(l => l.room_key), ['room-a', 'room-b', 'room-c']);
  assert.deepEqual(m.filterLines(lines, 'ask', {}), []);
  assert.equal(m.askCount(null, byLine), 0);
});

const rtWith = api => ({context: {read: () => ({user: {id: 'u'}, workspace: {id: 'w'}})}, api: async (path, opts) => api(path, opts)});

test('readTelegramAsks: one read of open telegram candidates + the room lookup; missing table and failures are reported', async () => {
  const paths = [];
  const ok = rtWith(async path => {
    paths.push(path);
    if (path.includes('app_todo_candidates')) return [cand(1, {tg: undefined}), {id: 'bad'}];
    if (path.includes('app_feed_items')) return [{id: item(1), room_key: 'room-a', room_label: '가상방'}];
    return [];
  });
  const got = await radar.readTelegramAsks(ok);
  assert.equal(got.ok, true);
  assert.equal(got.rows.length, 1);
  assert.deepEqual(got.rows[0].tg, {room_key: 'room-a', room_label: '가상방'});
  assert.match(paths[0], /^\/rest\/v1\/app_todo_candidates\?workspace_id=eq\.w&source_kind=eq\.telegram&status=eq\.open&/);
  assert.equal(paths.length, 2);
  const gone = rtWith(async () => { throw Object.assign(new Error('x'), {status: 404}); });
  assert.deepEqual(await radar.readTelegramAsks(gone), {missing: true});
  const down = rtWith(async () => { throw Object.assign(new Error('x'), {status: 500}); });
  assert.deepEqual(await radar.readTelegramAsks(down), {ok: false});
});

test('readLineMarks: no raw text, only shown telegram rows in the day range, paged', async () => {
  const paths = [];
  const rt = rtWith(async path => { paths.push(path); return path.includes('offset=0') ? Array.from({length: 100}, (_, i) => ({room_key: 'r', day: '2026-10-06', organization_id: null, title: 't' + i, summary: null})) : [{room_key: 'r', day: '2026-10-05'}]; });
  const rows = await feed.readLineMarks('2026-09-23', '2026-10-06', rt);
  assert.equal(rows.length, 101);
  assert.equal(paths.length, 2);
  for (const p of paths) {
    assert.match(p, /source=eq\.telegram&hidden_at=is\.null&day=gte\.2026-09-23&day=lte\.2026-10-06&select=room_key,day,organization_id,title,summary&/);
    assert.doesNotMatch(p, /raw_text/);
  }
});

// TG-안본것 3/3: '봤음' 시각(app_feed_room_days.seen_at)으로 점·흐림·[안 본 것 n].
test('seenIndex / isUnseen: never opened, opened, and new messages after opening (new summary batch or later message)', () => {
  const seen = m.seenIndex([
    {room_key: 'room-a', day: '2026-10-06', seen_at: '2026-10-06T05:00:00Z', updated_at: '2026-10-06T04:00:00Z'},
    {room_key: 'room-b', day: '2026-10-06', seen_at: '2026-10-06T05:00:00Z', updated_at: '2026-10-06T06:00:00Z'},
    {room_key: 'room-c', day: '2026-10-06', seen_at: 'bad'}, {room_key: '', day: '2026-10-06', seen_at: '2026-10-06T05:00:00Z'},
  ]);
  assert.deepEqual([...seen.keys()], ['room-a|2026-10-06', 'room-b|2026-10-06']);
  const l = (room, last) => ({room_key: room, day: '2026-10-06', last_at: last});
  assert.equal(m.isUnseen(l('room-a', '2026-10-06T04:30:00Z'), seen), false);
  assert.equal(m.isUnseen(l('room-a', '2026-10-06T05:30:00Z'), seen), true, 'a later message');
  assert.equal(m.isUnseen(l('room-b', '2026-10-06T04:30:00Z'), seen), true, 'a new summary batch after opening');
  assert.equal(m.isUnseen(l('room-c', '2026-10-06T04:30:00Z'), seen), true, 'never opened');
  assert.equal(m.isUnseen(l('room-c', '2026-10-06T04:30:00Z'), null), false, 'no seen data: nothing is marked');
  assert.equal(m.unseenCount([l('room-a', '2026-10-06T04:30:00Z'), l('room-b', 'x'), l('room-c', 'x')], seen), 2);
  assert.equal(m.unseenCount([l('room-c', 'x')], null), 0);
});

test('withSeen marks one room·day at once without touching the others; filterLines("unseen") keeps the open row', () => {
  const seen = m.seenIndex([{room_key: 'room-a', day: '2026-10-06', seen_at: '2026-10-06T05:00:00Z', updated_at: '2026-10-06T04:00:00Z'}]);
  const lines = [{room_key: 'room-a', day: '2026-10-06', last_at: '2026-10-06T04:00:00Z'}, {room_key: 'room-b', day: '2026-10-06', last_at: '2026-10-06T04:00:00Z'}];
  assert.deepEqual(m.filterLines(lines, 'unseen', {seen}).map(x => x.room_key), ['room-b']);
  const next = m.withSeen(seen, 'room-b', '2026-10-06', Date.parse('2026-10-06T06:00:00Z'));
  assert.notEqual(next, seen);
  assert.equal(seen.has('room-b|2026-10-06'), false);
  assert.deepEqual(m.filterLines(lines, 'unseen', {seen: next}), []);
  assert.deepEqual(m.filterLines(lines, 'unseen', {seen: next, keep: 'room-b|2026-10-06'}).map(x => x.room_key), ['room-b']);
  assert.equal(m.filterLines(lines, 'unseen', {seen: null}).length, 2);
});

test('readSeenDays and markRoomDaySeen: owner reads with seen_at only; one DB function call to mark', async () => {
  const paths = [];
  const rt = rtWith(async (path, opts) => {
    paths.push([path, opts?.body]);
    if (path.includes('/rpc/')) return {ok: true, room_key: 'room-a', day: '2026-10-06', seen_at: '2026-10-06T05:00:00Z'};
    return [{room_key: 'room-a', day: '2026-10-06', seen_at: '2026-10-06T05:00:00Z', updated_at: '2026-10-06T04:00:00Z'}];
  });
  assert.equal((await feed.readSeenDays('2026-09-23', '2026-10-06', rt)).length, 1);
  assert.match(paths[0][0], /^\/rest\/v1\/app_feed_room_days\?workspace_id=eq\.w&day=gte\.2026-09-23&day=lte\.2026-10-06&seen_at=not\.is\.null&select=room_key,day,seen_at,updated_at&/);
  assert.equal((await feed.markRoomDaySeen('room-a', '2026-10-06', rt)).ok, true);
  assert.deepEqual(paths[1], ['/rest/v1/rpc/app_feed_room_day_seen', {p_room_key: 'room-a', p_day: '2026-10-06'}]);
  const gone = rtWith(async () => { throw Object.assign(new Error('Could not find the function'), {status: 404}); });
  assert.deepEqual(await feed.markRoomDaySeen('room-a', '2026-10-06', gone), {ok: false, error: 'UNAVAILABLE'});
});
