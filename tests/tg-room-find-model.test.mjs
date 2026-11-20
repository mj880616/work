// S67-45 TG-방상세요약먼저: 방 상세 찾기의 순수 규칙(찾을 글자 다듬기·서버 거르기 글·찾은 줄 글). 내용은 지어낸 값.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {roomFindNeedle, roomFindFilter, roomFindSnippet, ROOM_FIND_MAX} from '../app/tg-room-view-model.mjs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('찾을 글자: 줄바꿈·제어 문자·*는 띄어쓰기, 앞뒤 공백 제거, 40자까지', () => {
  assert.equal(roomFindNeedle('  교섭\n일정 '), '교섭 일정');
  assert.equal(roomFindNeedle('a*b'), 'a b');
  assert.equal(roomFindNeedle('***'), '');
  assert.equal(roomFindNeedle(null), '');
  assert.equal(roomFindNeedle('가'.repeat(60)).length, ROOM_FIND_MAX);
});

test('서버 거르기: 원문·요약·제목 셋, %·_·\\와 따옴표는 글자 그대로', () => {
  assert.equal(roomFindFilter('두 시'), '(raw_text.ilike."*두 시*",summary.ilike."*두 시*",title.ilike."*두 시*")');
  assert.equal(roomFindFilter('50%'), '(raw_text.ilike."*50\\\\%*",summary.ilike."*50\\\\%*",title.ilike."*50\\\\%*")');
  assert.equal(roomFindFilter('a_b').split(',')[0], '(raw_text.ilike."*a\\\\_b*"');
  assert.equal(roomFindFilter('"x"').split(',')[0], '(raw_text.ilike."*\\"x\\"*"');
  assert.equal(roomFindFilter('a,b)').split('",')[0], '(raw_text.ilike."*a,b)*');
  assert.equal(roomFindFilter('  '), '');
});

test('찾은 줄 글: 원문의 그 줄, 없으면 요약·제목, 길면 찾은 글자 둘레만', () => {
  const r = {raw_text:'09:31 A: 처음 줄\n09:40 B: 다음 주 화요일 두 시로 잡혔어요', summary:'요약 글', title:'제목'};
  assert.equal(roomFindSnippet(r, '두 시'), '09:40 B: 다음 주 화요일 두 시로 잡혔어요');
  assert.equal(roomFindSnippet(r, '요약'), '요약 글');
  assert.equal(roomFindSnippet({title:'제목만'}, '제목'), '제목만');
  const long = {raw_text:'가'.repeat(80) + '찾을말' + '나'.repeat(80)};
  const s = roomFindSnippet(long, '찾을말', 30);
  assert.ok(s.includes('찾을말')); assert.ok(s.startsWith('…') && s.endsWith('…')); assert.equal(s.length, 32);
});

test('화면: 방 상세는 접힌 날(fold) + [소식 n]·[원문 n], 찾기는 서버 읽기 한 길', () => {
  const js = read('app/telegram-feed.js'), data = read('app/feed-data.js');
  assert.match(js, /dayBodyHtml\(room, day, d, sum, dedit, \{fold:true\}\)/);
  assert.match(js, /data-tg-rexp=/); assert.match(js, /data-tg-rraw=/);
  assert.match(js, /rexp:new Set\(\)/);
  assert.match(data, /export async function readRoomFind\(room, filter, from/);
  assert.match(data, /room_key=eq\.\$\{encode\(room\)\}&hidden_at=is\.null/);
});
