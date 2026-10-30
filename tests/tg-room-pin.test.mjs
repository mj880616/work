import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// TG-방고정: 고정한 방 칸 규칙(app/tg-day-model.mjs pinnedRooms·withoutPinned·pinsWithoutLine), 고정 읽기·쓰기(feed-data.js readFeedRooms·setRoomPin·
// readRoomLatestLine)와 화면 파일의 정적 규칙. 방·내용은 모두 지어낸 것이다.
const m = await import('../app/tg-day-model.mjs');
const feed = await import('../app/feed-data.js');
const rtWith = api => ({context: {read: () => ({user: {id: 'u'}, workspace: {id: 'w'}})}, api: async (path, opts) => api(path, opts)});
const line = (room, day, o = {}) => m.lineOf({room_key: room, room_label: room + ' 방', day, last_at: day + 'T03:00:00Z', item_count: 1, raw_count: 1, headline: '한 줄', ...o});

test('pinnedRooms: only pinned and not archived, in pin order, latest non-trashed day line attached; folder narrows', () => {
  const rooms = new Map([
    ['room-b', {room_label: '', folder_id: 'f1', archived_at: null, pinned_at: '2026-10-30T01:00:00Z'}],
    ['room-a', {room_label: '', folder_id: null, archived_at: null, pinned_at: '2026-10-30T02:00:00Z'}],
    ['room-c', {room_label: '보관 방', folder_id: null, archived_at: '2026-10-30T00:00:00Z', pinned_at: '2026-10-29T00:00:00Z'}],
    ['room-d', {room_label: '안 고정', folder_id: null, archived_at: null, pinned_at: null}],
    ['room-e', {room_label: '옛 방', folder_id: null, archived_at: null, pinned_at: '2026-10-30T03:00:00Z'}],
  ]);
  const lines = [line('room-a', '2026-10-29'), line('room-a', '2026-10-30', {day_hidden_at: '2026-10-30T05:00:00Z'}), line('room-a', '2026-10-27'),
    line('room-b', '2026-10-28'), line('room-c', '2026-10-30'), line('room-d', '2026-10-30')];
  const pins = m.pinnedRooms(rooms, lines);
  assert.deepEqual(pins.map(p => p.room_key), ['room-b', 'room-a', 'room-e']);
  assert.equal(pins[1].last.day, '2026-10-29');
  assert.equal(pins[1].room_label, 'room-a 방');
  assert.equal(pins[2].last, null);
  assert.equal(pins[2].room_label, '옛 방');
  assert.deepEqual(m.pinnedRooms(rooms, lines, {folder: 'f1'}).map(p => p.room_key), ['room-b']);
  assert.deepEqual(m.pinsWithoutLine(rooms, lines), ['room-e']);
  // 아래 날짜 묶음에는 고정 방이 다시 나오지 않는다.
  assert.deepEqual(m.withoutPinned(lines, pins).map(l => l.room_key), ['room-c', 'room-d']);
  assert.equal(m.withoutPinned(lines, []).length, lines.length);
  assert.deepEqual(m.pinnedRooms(new Map(), lines), []);
});

test('readFeedRooms reads pinned_at; before the DB step it falls back without the column and reports pinReady=false', async () => {
  const paths = [];
  const ok = rtWith(async path => { paths.push(path); return [{room_key: 'room-a', room_label: '방', folder_id: null, archived_at: null, pinned_at: '2026-10-30T01:00:00Z'}]; });
  const got = await feed.readFeedRooms(ok);
  assert.equal(got.pinReady, true);
  assert.equal(got.rooms.get('room-a').pinned_at, '2026-10-30T01:00:00Z');
  assert.match(paths[0], /^\/rest\/v1\/app_feed_rooms\?workspace_id=eq\.w&select=room_key,room_label,folder_id,archived_at,pinned_at&order=room_key\.asc&/);
  const seen = [];
  const before = rtWith(async path => {
    seen.push(path);
    if (path.includes('pinned_at')) throw Object.assign(new Error('column app_feed_rooms.pinned_at does not exist'), {status: 400, code: '42703'});
    return [{room_key: 'room-a', room_label: '방', folder_id: 'f1', archived_at: null}];
  });
  const old = await feed.readFeedRooms(before);
  assert.equal(old.pinReady, false);
  assert.deepEqual(old.rooms.get('room-a'), {room_label: '방', folder_id: 'f1', archived_at: null, pinned_at: null});
  assert.equal(seen.length, 2);
  assert.doesNotMatch(seen[1], /pinned_at/);
});

test('setRoomPin: one DB function call; archived, limit and missing function map to their own errors', async () => {
  const paths = [];
  const rt = rtWith(async (path, opts) => { paths.push([path, opts?.body]); return {ok: true, changed: true, room_key: 'room-a', pinned_at: '2026-10-30T01:00:00Z'}; });
  assert.equal((await feed.setRoomPin('room-a', true, rt)).pinned_at, '2026-10-30T01:00:00Z');
  assert.deepEqual(paths[0], ['/rest/v1/rpc/app_feed_room_pin', {p_room_key: 'room-a', p_pinned: true}]);
  await feed.setRoomPin('room-a', false, rt);
  assert.deepEqual(paths[1][1], {p_room_key: 'room-a', p_pinned: false});
  const fail = message => rtWith(async () => { throw Object.assign(new Error(message), {status: 400}); });
  assert.deepEqual(await feed.setRoomPin('room-a', true, fail('TGPIN_ARCHIVED')), {ok: false, error: 'ARCHIVED'});
  assert.deepEqual(await feed.setRoomPin('room-a', true, fail('TGPIN_LIMIT')), {ok: false, error: 'PIN_LIMIT'});
  assert.deepEqual(await feed.setRoomPin('room-a', true, fail('TGDG_NOT_FOUND')), {ok: false, error: 'GONE'});
  const gone = rtWith(async () => { throw Object.assign(new Error('Could not find the function'), {status: 404}); });
  assert.deepEqual(await feed.setRoomPin('room-a', true, gone), {ok: false, error: 'UNAVAILABLE'});
});

test('readRoomLatestLine: latest non-hidden day of that room, then that one day line', async () => {
  const paths = [];
  const rt = rtWith(async (path, opts) => {
    paths.push([path, opts?.body]);
    if (path.startsWith('/rest/v1/app_feed_items')) return [{day: '2026-09-01'}];
    return [{room_key: 'room-x', day: '2026-09-01', room_label: '옛 방'}, {room_key: 'room-a', day: '2026-09-01'}];
  });
  const got = await feed.readRoomLatestLine('room-a', rt);
  assert.equal(got.room_key, 'room-a');
  assert.match(paths[0][0], /app_feed_items\?workspace_id=eq\.w&source=eq\.telegram&room_key=eq\.room-a&hidden_at=is\.null&select=day&order=day\.desc&limit=1$/);
  assert.deepEqual(paths[1], ['/rest/v1/rpc/app_feed_room_day_lines', {p_from: '2026-09-01', p_to: '2026-09-01'}]);
  assert.equal(await feed.readRoomLatestLine('room-a', rtWith(async () => [])), null);
});

test('screen: [고정]/[고정 풀기] first in the room menu, pin row above the date lines, server only; notes use the same words', () => {
  const screen = readFileSync(new URL('../app/telegram-feed.js', import.meta.url), 'utf8');
  const notes = readFileSync(new URL('../app/basket-notes.js', import.meta.url), 'utf8');
  assert.match(screen, /return `\$\{pin\}<button type="button" data-tg-ract="folder">폴더로<\/button>/);
  assert.match(screen, /isPinned\(k\.room\) \? '고정 풀기' : '고정'/);
  assert.match(screen, /const feed = top \+ \(groups\.length/);
  assert.match(screen, /setRoomPin\(room, on, rt\)/);
  assert.match(screen, /state\.pinReady \?/);
  const BROWSER_STORE = new RegExp(['local', 'session'].map(w => w + 'Stor' + 'age').concat(['indexed' + 'DB', 'document\\.coo' + 'kie']).join('|'));
  assert.doesNotMatch(screen, BROWSER_STORE);
  assert.doesNotMatch(notes, /고정 해제/);
  assert.match(notes, /notePinnedAt\(note\) \? '고정 풀기' : '고정'/);
});
