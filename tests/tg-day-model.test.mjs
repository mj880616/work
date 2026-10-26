// TG-방날짜묶기 4-가: 방·날 한 줄 목록과 방 상세의 순수 규칙(app/tg-day-model.mjs)과 화면 파일의 정적 규칙. 방·아이디·내용은 모두 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lineOf, rdKey, splitRdKey, liveLines, groupLines, roomsOfLines, neighborDays, daysNeedingTitles, titleIndex, lineText, mergeParts, daySummary,
  openTarget, COPY_NOTE, firstWindow, olderWindow, reachedEnd, chunksOf, LIST_WINDOW} from '../app/tg-day-model.mjs';

const L = (room, day, o = {}) => lineOf({room_key:room, room_label:`가상 ${room}`, day, last_at:`${day}T05:00:00Z`, item_count:2, raw_count:5, headline:'', ...o});

test('방·날 열쇠와 줄 정리: 틀린 줄은 버리고 숫자·종류를 다듬는다', () => {
  assert.equal(rdKey('room-a', '2026-10-06'), 'room-a|2026-10-06');
  assert.deepEqual(splitRdKey('room-a|2026-10-06'), {room:'room-a', day:'2026-10-06'});
  assert.equal(splitRdKey('room-a'), null); assert.equal(splitRdKey('|2026-10-06'), null);
  assert.equal(lineOf(null), null); assert.equal(lineOf({room_key:'r', day:'10/06'}), null); assert.equal(lineOf({room_key:'', day:'2026-10-06'}), null);
  const l = lineOf({room_key:'r1', day:'2026-10-06', item_count:'3', raw_count:-4, chat_kind:'x', headline:' 한\n줄 '});
  assert.equal(l.item_count, 3); assert.equal(l.raw_count, 0); assert.equal(l.chat_kind, null); assert.equal(l.headline, '한 줄'); assert.equal(l.room_label, 'r1');
});

test('평소 목록: 보관한 방·지운 날은 빼고, 날짜 내림차순 안에서 늦게 온 방 먼저', () => {
  const lines = [L('a', '2026-10-05'), L('b', '2026-10-06', {last_at:'2026-10-06T01:00:00Z'}), L('c', '2026-10-06', {last_at:'2026-10-06T09:00:00Z'}), L('d', '2026-10-06', {archived_at:'2026-10-01T00:00:00Z'}), L('e', '2026-10-06', {day_hidden_at:'2026-10-07T00:00:00Z'})];
  const live = liveLines(lines);
  assert.deepEqual(live.map(l => l.room_key), ['a', 'b', 'c']);
  assert.deepEqual(groupLines(live).map(g => [g.day, g.rows.map(r => r.room_key)]), [['2026-10-06', ['c', 'b']], ['2026-10-05', ['a']]]);
  assert.deepEqual(liveLines(lines, {room:'b'}).map(l => l.room_key), ['b']);
  assert.deepEqual(roomsOfLines(live).map(r => r.key), ['c', 'b', 'a']);
});

test('‹ ›: 그 방의 앞뒤 날만, 지운 날은 건너뛴다', () => {
  const lines = [L('a', '2026-10-01'), L('a', '2026-10-03', {day_hidden_at:'x'}), L('a', '2026-10-04'), L('a', '2026-10-08'), L('b', '2026-10-05')];
  assert.deepEqual(neighborDays(lines, 'a', '2026-10-04'), {prev:'2026-10-01', next:'2026-10-08'});
  assert.deepEqual(neighborDays(lines, 'a', '2026-10-08'), {prev:'2026-10-04', next:''});
  assert.deepEqual(neighborDays(lines, 'a', '2026-10-01'), {prev:'', next:'2026-10-04'});
  assert.deepEqual(neighborDays(lines, 'a', '2026-10-05'), {prev:'2026-10-04', next:'2026-10-08'}, '그 날 줄이 없어도 앞뒤를 찾는다');
});

test('요약이 없는 날: 제목 모음으로 줄 글을 채운다(AI 한 줄이 있으면 그것)', () => {
  const lines = [L('a', '2026-10-06', {headline:'오늘 한 줄'}), L('a', '2026-10-05'), L('b', '2026-10-05'), L('c', '2026-10-04', {day_hidden_at:'x'})];
  assert.deepEqual(daysNeedingTitles(lines), ['2026-10-05']);
  const idx = titleIndex([{room_key:'a', day:'2026-10-05', title:'제목 하나'}, {room_key:'a', day:'2026-10-05', title:'제목 하나'}, {room_key:'a', day:'2026-10-05', title:'', summary:'요약 둘'}, {room_key:'a', day:'2026-10-05', title:'제목 셋'}, {room_key:'b', day:'2026-10-05', title:' '}]);
  assert.equal(lineText(lines[0], idx), '오늘 한 줄');
  assert.equal(lineText(lines[1], idx), '제목 하나 · 요약 둘', '두 개까지, 같은 제목은 한 번');
  assert.equal(lineText(lines[2], idx), '');
});

test('묶음 요약 합치기: 첫 메시지 시각 순으로 이어 붙이고 headline은 가장 이른 것, 4줄까지 보이고 나머지는 접는다', () => {
  const parts = [
    {batch:'b2', first_at:'2026-10-06T08:00:00Z', headline:'', lines:['넷째', '다섯째']},
    {batch:'b1', first_at:'2026-10-06T01:00:00Z', headline:'이른 한 줄', lines:['첫째', '둘째', '셋째'], open_ref:'123'},
    'x', null, {first_at:'z', lines:[1, 2]},
  ];
  const m = mergeParts(parts);
  assert.equal(m.headline, '이른 한 줄'); assert.deepEqual(m.lines, ['첫째', '둘째', '셋째', '넷째', '다섯째']); assert.equal(m.openRef, '123');
  const s = daySummary(parts, []);
  assert.equal(s.kind, 'ai'); assert.deepEqual(s.shown, ['첫째', '둘째', '셋째', '넷째']); assert.deepEqual(s.rest, ['다섯째']);
  assert.deepEqual(mergeParts(null), {headline:'', lines:[], openRef:''});
});

test('요약이 없는 날(결정 4): 소식 제목 4개까지 모아 보여 주고 "AI 요약 이전 날" 표시, 표를 못 읽으면 표시 없음', () => {
  const items = ['일', '이', '삼', '사', '오', '일'].map(t => ({title:`제목 ${t}`}));
  const s = daySummary([], items);
  assert.equal(s.kind, 'titles'); assert.equal(s.lines.length, 4); assert.equal(s.old, true); assert.deepEqual(s.rest, []);
  assert.equal(daySummary(null, items, {partsKnown:false}).old, false);
  assert.equal(daySummary([], []).kind, 'none');
});

test('[텔레그램에서 열기]: 방 주소 → 번호 링크 → 앱 첫 화면 + 방 이름 복사 순서', () => {
  assert.deepEqual(openTarget({room_key:'-1001', chat_username:'fake_room_a'}), {kind:'link', url:'https://t.me/fake_room_a', how:'name'});
  assert.equal(openTarget({room_key:'55', chat_username:'@fake_user_1'}).url, 'https://t.me/fake_user_1', '1:1도 @아이디가 먼저');
  assert.equal(openTarget({room_key:'-1001234567', open_ref:'42'}).url, 'https://t.me/c/1234567/42');
  assert.equal(openTarget({room_key:'-1001234567'}).url, 'tg://openmessage?chat_id=1234567');
  assert.equal(openTarget({room_key:'-1001234567', open_ref:'4 2/..'}).url, 'tg://openmessage?chat_id=1234567', '모양이 틀린 번호는 쓰지 않는다');
  assert.equal(openTarget({room_key:'-5551'}).url, 'tg://openmessage?chat_id=5551');
  assert.equal(openTarget({room_key:'987654'}).url, 'tg://openmessage?user_id=987654');
  for (const bad of ['ab', 'a_bc', '1abcde', 'abc def', 'abcd"><x', 'a'.repeat(33)]) assert.equal(openTarget({room_key:'room-a', chat_username:bad}).kind, 'copy', bad);
  assert.deepEqual(openTarget({room_key:'room-a'}), {kind:'copy', url:'tg://'});
  assert.deepEqual(openTarget({room_key:'1; drop', chat_username:'bad id'}), {kind:'copy', url:'tg://'});
  assert.match(COPY_NOTE, /방 이름을 복사했어요/);
});

test('읽기 범위: 첫 14일, 이전 창, 120일 한계, 7일씩 나눔', () => {
  assert.deepEqual(firstWindow('2026-10-14'), {from:'2026-10-01', to:'2026-10-14'});
  assert.equal(LIST_WINDOW, 14);
  assert.deepEqual(olderWindow('2026-10-01', '2026-10-14'), {from:'2026-09-17', to:'2026-09-30'});
  assert.equal(olderWindow('2026-06-17', '2026-10-14'), null);
  assert.equal(olderWindow('2026-06-20', '2026-10-14').from, '2026-06-17', '한계(오늘 포함 120일)에서 자른다');
  assert.equal(reachedEnd('2026-10-01', '2026-10-14'), false); assert.equal(reachedEnd('2026-06-17', '2026-10-14'), true);
  assert.deepEqual(chunksOf('2026-10-01', '2026-10-14'), [['2026-10-01', '2026-10-07'], ['2026-10-08', '2026-10-14']]);
  assert.deepEqual(chunksOf('2026-10-01', '2026-10-03'), [['2026-10-01', '2026-10-03']]);
});

test('화면 코드: 브라우저 저장소·옛 덮어쓰기 없음, 요약 읽기는 DB 함수와 읽기 표만', () => {
  const view = readFileSync(new URL('../app/telegram-feed.js', import.meta.url), 'utf8'), data = readFileSync(new URL('../app/feed-data.js', import.meta.url), 'utf8');
  assert.doesNotMatch(view, new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'Mutation' + 'Observer'].join('|')));
  assert.match(data, /app_feed_room_day_lines/);
  assert.doesNotMatch(data, /method:\s*'(PATCH|DELETE|PUT)'[^}]*app_feed_(rooms|folders|room_days)/);
  assert.doesNotMatch(view, /feed-swipe|archived_at/, '옛 카드 밀기·소식 보관 코드는 없다');
});
