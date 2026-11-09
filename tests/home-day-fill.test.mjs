// HOME-하루채우기(2026-11-09 시안 ④): 오늘 사진 한 줄 규칙·칸 수, 읽을 만한 글·기록 제안 거르기, 화면 연결 자리.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rankDayPhotos, dropBursts, stripFit, eventWindows, isShot, inWindow, BURST_MS} from '../app/home-day-photos-model.mjs';
import {cleanReads, cleanSuggests, suggestTime, readAtLabel, pickedNote, safeUrl, READS_MAX, SUGGEST_MAX} from '../app/home-day-picks-model.mjs';

const at = (hh, mm = 0, ss = 0) => new Date(Date.UTC(2026, 9, 6, hh - 9, mm, ss)).toISOString(); // 2026-10-06 서울 시각
const od = (key, taken, extra = {}) => ({kind:'od', source:'onedrive', key, taken_at:taken, name:`${key}.jpg`, ...extra});
const keys = list => list.map(x => x.key);

test('사진 순서: 별표 → 일정 시간 → 나머지(일기에 넣은 사진 먼저, 찍은 시각 순) → 캡처', () => {
  const items = [
    od('late', at(20)), od('meet', at(10, 30)), od('shot', at(9), {name:'Screenshot_20261006.png'}),
    od('star', at(22)), {kind:'upload', source:'upload', key:'up', file:{file_name:'a.jpg', mime_type:'image/jpeg'}}, od('early', at(8)),
  ];
  const ranked = rankDayPhotos(items, {starred:x => x.key === 'star', windows:[{from:Date.parse(at(10)), to:Date.parse(at(11))}]});
  assert.deepEqual(keys(ranked), ['star', 'meet', 'up', 'early', 'late', 'shot']);
});

test('연속 촬영은 한 장만(별표 → 캡처 아닌 것 → 먼저 찍은 것), 간격이 길면 따로', () => {
  const burst = [od('b1', at(10, 0, 0)), od('b2', at(10, 0, 1)), od('b3', at(10, 0, 3)), od('next', at(10, 0, 3 + BURST_MS / 1000 + 1))];
  assert.deepEqual(keys(dropBursts(burst)), ['b1', 'next']);
  assert.deepEqual(keys(dropBursts(burst, {starred:x => x.key === 'b3'})), ['b3', 'next']);
  const shotFirst = [od('s', at(11, 0, 0), {screenshot:true}), od('p', at(11, 0, 1))];
  assert.deepEqual(keys(dropBursts(shotFirst)), ['p']);
});

test('동영상은 빼고, 캡처는 표시·이름으로만 안다', () => {
  assert.deepEqual(keys(rankDayPhotos([od('v', at(9), {video:true}), od('p', at(9, 30))])), ['p']);
  assert.equal(isShot({name:'스크린샷 2026.png'}), true);
  assert.equal(isShot({screenshot:true}), true);
  assert.equal(isShot({file:{file_name:'캡처.png'}}), true);
  assert.equal(isShot({name:'IMG_0001.jpg'}), false);
});

test('한 줄 칸 수: 다 들어가면 그대로, 넘치면 마지막 칸이 +n', () => {
  // 56px 칸 + 4px 사이: 390 폭 카드 안(약 350px)이면 5칸.
  assert.deepEqual(stripFit(350, 3), {cols:5, shown:3, more:0});
  assert.deepEqual(stripFit(350, 5), {cols:5, shown:5, more:0});
  assert.deepEqual(stripFit(350, 9), {cols:5, shown:4, more:5});
  assert.deepEqual(stripFit(0, 4), {cols:1, shown:0, more:4});
  assert.deepEqual(stripFit(1200, 0), {cols:20, shown:0, more:0});
});

test('일정 시간 칸: 종일 일정은 빼고, 끝이 없으면 1시간', () => {
  const w = eventWindows([{start:'2026-10-06', end:'2026-10-07', allDay:true}, {start:'2026-10-06T10:00:00+09:00', end:'2026-10-06T11:00:00+09:00'}, {start:'2026-10-06T15:00:00+09:00'}]);
  assert.equal(w.length, 2);
  assert.equal(w[1].to - w[1].from, 3600000);
  assert.equal(inWindow(Date.parse(at(10, 59)), w), true);
  assert.equal(inWindow(Date.parse(at(11, 0)), w), false);
  assert.equal(inWindow(null, w), false);
});

test('읽을 만한 글: 세 줄이 다 있는 것만, 같은 글 하나, 최대 3개, 원문은 https만', () => {
  const ok = n => ({id:`n${n}`, title:`○○ 소식 ${n}`, what:'무슨 일 한 줄', why:'담당조직 ○○와 이어짐', source:'○○신문', at:at(8, 10), url:`https://example.org/${n}`});
  const list = cleanReads([ok(1), ok(1), {...ok(2), why:''}, ok(3), {...ok(4), url:'javascript:alert(1)'}, ok(5)]);
  assert.deepEqual(list.map(x => x.id), ['n1', 'n3', 'n4']);
  assert.equal(list.length, READS_MAX);
  assert.equal(list[2].url, '');
  assert.equal(safeUrl('http://example.org'), '');
  assert.deepEqual(cleanReads(null), []);
});

test('기록 제안: 글 있는 것만 최대 2개, 오늘·오후 6시 뒤에만', () => {
  const list = cleanSuggests([{id:'a', text:'○○ 면담 이야기', basis:'15:00 일정'}, {id:'b', text:''}, {id:'c', text:'끝낸 할 일 돌아보기'}, {id:'d', text:'셋째'}]);
  assert.deepEqual(list.map(x => x.id), ['a', 'c']);
  assert.equal(list.length, SUGGEST_MAX);
  assert.equal(suggestTime({day:'2026-10-06', today:'2026-10-06', hour:18}), true);
  assert.equal(suggestTime({day:'2026-10-06', today:'2026-10-06', hour:17}), false);
  assert.equal(suggestTime({day:'2026-10-05', today:'2026-10-06', hour:20}), false);
});

test('시각 글자: 오늘 HH:MM, 어제, 그 앞 월.일 / 고른 때 아침·저녁', () => {
  assert.equal(readAtLabel(at(8, 10), '2026-10-06'), '08:10');
  assert.equal(readAtLabel('2026-10-05T03:00:00Z', '2026-10-06'), '어제');
  assert.equal(readAtLabel('2026-10-01T03:00:00Z', '2026-10-06'), '10.1');
  assert.equal(readAtLabel('', '2026-10-06'), '');
  assert.equal(pickedNote(at(7), '2026-10-06'), '오늘 아침 선택');
  assert.equal(pickedNote(at(19), '2026-10-06'), '오늘 저녁 선택');
  assert.equal(pickedNote('2026-10-05T10:00:00Z', '2026-10-06'), '');
});

test('화면 연결: [하루] 오늘 한 일 아래 한 자리, 공용 부품, 로컬 저장 없음, 일기 저장 함수 안 부름', () => {
  const journal = readFileSync(new URL('../app/journal.js', import.meta.url), 'utf8');
  const fill = readFileSync(new URL('../app/home-day-fill.js', import.meta.url), 'utf8');
  const done = journal.indexOf('data-journal-done-tasks'), slot = journal.indexOf('data-journal-fill'), materials = journal.indexOf('<div class="journal-materials"');
  assert.ok(done > 0 && slot > done && materials > slot, '오늘 한 일 → 세 칸 → 재료 순서');
  assert.match(fill, /act-photo-thumb/);
  assert.match(fill, /class="row-act" data-journal-photos-open/);
  assert.match(fill, /class="secondary" data-journal-suggest-write/);
  assert.doesNotMatch(fill, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(fill, /\b(addStar|removeStar|uploadDiary|removeDiaryPhoto|saveDiaryText|createDiary|odDelete)\b/);
});
