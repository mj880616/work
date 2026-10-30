// PHOTO-정렬(요청함 10/30): 사진 정렬 기준 고르기의 순수 규칙과 화면 연결.
// 기준 여섯 가지, 서버(view_prefs.photo_view.sort) 저장 모양, 묶음 합치기 비교(서버 onedrive-photos sortCmp와 같은 규칙), 날짜 머리줄은 찍은 날 기준일 때만.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SORTS, DEFAULT_SORT, SORT_TEXT, SORT_SHORT, validSort, sortByDay, sortChoices, sortCompare, parsePhotoView, photoViewValue, toItem} from '../app/photos-model.mjs';
import {validValue, PHOTO_VIEW_SORTS} from '../app/view-prefs.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('기준 여섯 가지·글자·저장 모양(기본은 적지 않음)', () => {
  assert.deepEqual([...SORTS], ['taken_desc', 'taken_asc', 'uploaded_desc', 'name_asc', 'size_desc', 'duration_desc']);
  assert.deepEqual([...PHOTO_VIEW_SORTS], [...SORTS], 'view-prefs 검사와 같은 목록');
  assert.equal(DEFAULT_SORT, 'taken_desc'); assert.equal(SORT_SHORT.taken_desc, '찍은 날 ↓');
  assert.deepEqual(SORTS.map(s => SORT_TEXT[s]), ['찍은 날 최근 먼저', '찍은 날 오래된 먼저', '올린 날 최근 먼저', '파일 이름 가나다', '크기 큰 것 먼저', '동영상 길이 긴 것 먼저']);
  assert.equal(validSort('bad'), 'taken_desc');
  assert.deepEqual(parsePhotoView({filter: 'video', sort: 'size_desc'}), {filter: 'video', cols: null, sort: 'size_desc'});
  assert.equal(parsePhotoView({sort: 'zzz'}).sort, 'taken_desc');
  assert.deepEqual(photoViewValue({filter: 'all', cols: 7, sort: 'taken_desc'}), {filter: 'all', cols: 7});
  assert.deepEqual(photoViewValue({filter: 'star', sort: 'name_asc'}), {filter: 'star', sort: 'name_asc'});
  for (const s of SORTS) assert.equal(validValue('photo_view', {filter: 'all', sort: s}), true, s);
  for (const bad of [{sort: 'newest'}, {sort: 1}, {sort: null}]) assert.equal(validValue('photo_view', bad), false, JSON.stringify(bad));
});

test('날짜 머리줄은 찍은 날 기준일 때만, 동영상 길이는 동영상이 있을 때만', () => {
  assert.deepEqual(SORTS.filter(sortByDay), ['taken_desc', 'taken_asc']);
  assert.deepEqual(sortChoices(false), SORTS.filter(s => s !== 'duration_desc'));
  assert.deepEqual(sortChoices(true), [...SORTS]);
  assert.ok(sortChoices(false, 'duration_desc').includes('duration_desc'), '지금 고른 기준은 늘 보임');
});

test('묶음 합치기 비교: 서버와 같은 규칙(값 없는 크기·길이 맨 뒤, 올린 시각 없으면 찍은 시각, 이름은 숫자 크기로)', () => {
  const p = (id, o) => toItem({id, day: '2026-10-01', taken_at: '2026-10-01T00:00:00Z', name: id + '.jpg', ...o});
  const list = [p('a', {taken_at: '2026-10-03T00:00:00Z', name: 'b10.jpg', size_bytes: 500}), p('b', {taken_at: '2026-10-01T00:00:00Z', name: 'b2.jpg', size_bytes: 9000, uploaded_at: '2026-10-29T00:00:00Z'}),
    p('c', {taken_at: '2026-10-02T00:00:00Z', name: '가.jpg', kind: 'video', duration_ms: 42000}), p('d', {taken_at: '2026-10-02T00:00:00Z', name: 'a.jpg', size_bytes: 500})];
  const order = s => list.slice().sort(sortCompare(s)).map(x => x.id);
  assert.deepEqual(order('taken_desc'), ['a', 'd', 'c', 'b']);
  assert.deepEqual(order('taken_asc'), ['b', 'c', 'd', 'a']);
  assert.deepEqual(order('uploaded_desc'), ['b', 'a', 'd', 'c']);
  assert.deepEqual(order('name_asc'), ['c', 'd', 'b', 'a'], '한글 먼저(한국어 순서), b2 < b10');
  assert.deepEqual(order('size_desc'), ['b', 'd', 'a', 'c']);
  assert.deepEqual(order('duration_desc')[0], 'c');
  assert.equal(list[2].video, true); assert.equal(list[1].uploaded_at, '2026-10-29T00:00:00Z'); assert.equal(list[2].size_bytes, null);
});

test('화면 연결: [정렬 ▾]는 공용 anchored-menu, 고른 기준은 서버에 하나, 서버 쪽 읽기에 sort를 보냄', () => {
  const screen = read('app/photos.js'), od = read('app/diary-onedrive.js');
  assert.match(screen, /data-photos-sort/);
  assert.match(screen, /createAnchoredMenu\(\{id:'photosSortMenu'/);
  assert.match(screen, /viewPrefs\.set\('photo_view', photoViewValue\(/);
  assert.match(screen, /odLibrary\(rt, \{filter, cursor:next \|\| from\?\.cursor \|\| null, limit:PAGE_SIZE, sort:listSort\(\)\}\)/);
  assert.match(screen, /folderId:id, cursor:fNext, limit:PAGE_SIZE, sort\}/);
  assert.match(screen, /\$\('\[data-photos-sort\]'\)\.hidden = tab === 'calendar' \|\| tab === 'trash'/, '달력·휴지통에는 정렬 버튼 없음');
  assert.match(od, /sort && sort !== 'taken_desc' \? \{sort\} : \{\}/);
  assert.ok(!/localStorage|sessionStorage/.test(screen), '기기 저장 없음');
});
