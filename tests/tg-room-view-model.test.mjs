// TG-방별보기: 방별 목록·방 상세 날짜 이어 보기의 순수 규칙과 화면 연결. 방 이름·내용은 지어낸 값.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TG_VIEWS, tgViewOf, roomGroups, roomDays, roomPage, roomDayText, ROOM_DAY_PAGE} from '../app/tg-room-view-model.mjs';
import {TG_VIEWS as PREF_TG_VIEWS, validValue} from '../app/view-prefs.js';
import {SWIPE_ACTIONS, allowOf} from '../app/tg-day-model.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const L = (room, day, last_at, o = {}) => ({room_key:room, room_label:'방 ' + room, day, last_at, item_count:1, raw_count:1, headline:'', day_hidden_at:null, archived_at:null, folder_id:null, ...o});

test('보기 이름은 day·room 둘이고 화면 기억 검사와 같다(없거나 틀리면 날짜별)', () => {
  assert.deepEqual([...TG_VIEWS], ['day', 'room']);
  assert.deepEqual([...PREF_TG_VIEWS], [...TG_VIEWS]);
  for (const v of TG_VIEWS) assert.equal(validValue('tg_view', v), true);
  for (const v of [undefined, null, '', 'rooms', 1]) assert.equal(tgViewOf(v), 'day', String(v));
  assert.equal(tgViewOf('room'), 'room');
});

test('방별 목록: 방마다 한 줄, 가장 최근 소식 먼저, 소식 있는 날 수, 최근 날 줄', () => {
  const lines = [L('a', '2026-10-28', '2026-10-28T01:00:00Z'), L('b', '2026-10-30', '2026-10-30T01:00:00Z'), L('a', '2026-10-30', '2026-10-30T03:00:00Z'), L('c', '2026-10-29', '2026-10-29T09:00:00Z'), L('a', '2026-10-29', '2026-10-29T01:00:00Z')];
  const g = roomGroups(lines);
  assert.deepEqual(g.map(x => [x.room_key, x.last.day, x.days]), [['a', '2026-10-30', 3], ['b', '2026-10-30', 1], ['c', '2026-10-29', 1]]);
  assert.deepEqual(g[0].lines.map(l => l.day), ['2026-10-30', '2026-10-29', '2026-10-28']);
  assert.deepEqual(roomGroups([]), []);
});

test('방 상세 날짜: 그 방의 지우지 않은 날만 최근부터, 몇 날씩 이어 그리고 더 옛 기간이 있으면 more', () => {
  const lines = [L('a', '2026-10-30', 'x'), L('a', '2026-10-29', 'x', {day_hidden_at:'2026-10-30T00:00:00Z'}), L('a', '2026-10-27', 'x'), L('b', '2026-10-28', 'x'), L('a', '2026-10-25', 'x'), L('a', '2026-10-21', 'x')];
  const days = roomDays(lines, 'a');
  assert.deepEqual(days, ['2026-10-30', '2026-10-27', '2026-10-25', '2026-10-21']);
  assert.equal(ROOM_DAY_PAGE, 3);
  assert.deepEqual(roomPage(days, ROOM_DAY_PAGE, {end:true}), {days:days.slice(0, 3), more:true});
  assert.deepEqual(roomPage(days, 6, {end:true}), {days, more:false});
  assert.deepEqual(roomPage(days, 6, {end:false}), {days, more:true});
  assert.deepEqual(roomPage([], 3, {end:true}), {days:[], more:false});
});

test('방 줄 날짜는 "10.30 (금)" 모양', () => {
  assert.equal(roomDayText('2026-10-30'), '10.30 (금)');
  assert.equal(roomDayText('2026-11-01'), '11.01 (일)');
  assert.equal(roomDayText('x'), '');
});

test('방별의 방 한 줄 밀기는 폴더로·보관만(이 날 한 줄 삭제 없음)', () => {
  assert.deepEqual(SWIPE_ACTIONS.room, {start:['folder', 'archive'], end:[]});
  assert.deepEqual(allowOf('room'), {start:2, end:0});
});

test('화면 연결: 고른 보기는 서버 화면 기억(tg_view) 하나, 주소는 by·room, 기기 저장 없음', () => {
  const js = read('app/telegram-feed.js'), router = read('app/app-router.js');
  assert.match(js, /viewPrefs\.set\('tg_view', by, \{rejectable:true\}\)/);
  assert.match(router, /telegram:\['by','room'\]/);
  assert.doesNotMatch(js, new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB'].join('|')));
  // 방 상세의 날 읽기는 날짜별과 같은 길(readRoomDay)이고 새 서버 읽기는 없다.
  assert.match(js, /async function loadDay\(room, day\)[\s\S]{0,300}readRoomDay\(room, day, rt\)/);
});
