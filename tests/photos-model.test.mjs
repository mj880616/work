// PHOTO-사진메뉴 1차: '사진' 메뉴의 순수 규칙(최신순 목록·날짜 머리줄·달력 대표 사진·여러 장 별표·지우기 되돌리기)과 화면 연결.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EMPTY_STOP, validTab, monthKey, prevMonth, nextMonth, parseMonth, monthItems, groupByDay, dayHead, applyFilter, calendarMonth, starPlan, takePhoto, putPhoto} from '../app/photos-model.mjs';
import {ITEMS, defaultLayout} from '../app/menu-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const month = () => ({days: {
  '2026-10-03': [{id: 'a', name: 'a.jpg', taken_at: '2026-10-03T01:00:00Z'}, {id: 'b', name: 'b.jpg', taken_at: '2026-10-03T05:00:00Z', approx: true}],
  '2026-10-27': [{id: 'c', name: 'c.jpg', taken_at: '2026-10-27T02:00:00Z'}],
  'bad-day': [{id: 'x'}],
}});

test('달 목록은 최신순 한 줄 목록이 되고, 날짜 머리줄로 묶인다', () => {
  const items = monthItems(month());
  assert.deepEqual(items.map(i => i.id), ['c', 'b', 'a']);
  assert.deepEqual(items[1], {kind: 'od', source: 'onedrive', key: 'b', id: 'b', day: '2026-10-03', name: 'b.jpg', taken_at: '2026-10-03T05:00:00Z', approx: true});
  assert.deepEqual(groupByDay(items).map(g => [g.day, g.items.length]), [['2026-10-27', 1], ['2026-10-03', 2]]);
  assert.deepEqual(monthItems(null), []);
  assert.equal(dayHead('2026-10-27'), '10월 27일 (화)');
  assert.equal(dayHead('nope'), '');
});

test('달 계산과 칩 이름', () => {
  assert.deepEqual(prevMonth({year: 2026, month: 0}), {year: 2025, month: 11});
  assert.deepEqual(nextMonth({year: 2026, month: 11}), {year: 2027, month: 0});
  assert.equal(monthKey(2026, 9), '2026-10');
  assert.deepEqual(parseMonth('2026-10'), {year: 2026, month: 9});
  assert.equal(parseMonth('2026-13'), null);
  assert.equal(validTab('calendar'), 'calendar');
  for (const t of ['folders', 'map', '', null]) assert.equal(validTab(t), 'all', String(t));
  assert.equal(EMPTY_STOP, 24);
});

test('★ 거르기·달력 대표 사진(별표 있는 첫 장, 없으면 첫 장)', () => {
  const items = monthItems(month());
  const star = new Set(['b']), isStarred = i => star.has(i.id);
  assert.deepEqual(applyFilter(items, 'star', isStarred).map(i => i.id), ['b']);
  assert.equal(applyFilter(items, 'all', isStarred).length, 3);
  const cal = calendarMonth({year: 2026, month: 9}, month(), isStarred);
  assert.equal(cal.lead, 4, '2026-10-01은 목요일');
  assert.equal(cal.cells.length, 31);
  const d3 = cal.cells[2], d27 = cal.cells[26];
  assert.equal(d3.count, 2); assert.equal(d3.rep.id, 'b');
  assert.equal(calendarMonth({year: 2026, month: 9}, month()).cells[2].rep.id, 'a', '별표가 없으면 찍은 차례 첫 장');
  assert.equal(d27.count, 1); assert.equal(cal.cells[0].count, 0); assert.equal(cal.cells[0].rep, null);
});

test('여러 장 별표: 모두 별표면 모두 풀고, 아니면 안 된 것만 별표', () => {
  const items = monthItems(month()), on = new Set(['a']), isStarred = i => on.has(i.id);
  assert.deepEqual(starPlan(items, isStarred), {on: true, items: items.filter(i => i.id !== 'a')});
  const all = new Set(['a', 'b', 'c']);
  assert.deepEqual(starPlan(items, i => all.has(i.id)).on, false);
  assert.deepEqual(starPlan([], isStarred).on, true);
});

test('지우기는 달 목록에서 빼고 되돌리면 같은 자리로', () => {
  const data = month(), item = monthItems(data).find(i => i.id === 'a');
  const t = takePhoto(data, item);
  assert.deepEqual(data.days['2026-10-03'].map(p => p.id), ['b']);
  putPhoto(t); putPhoto(t);
  assert.deepEqual(data.days['2026-10-03'].map(p => p.id), ['a', 'b']);
  const only = takePhoto(data, monthItems(data).find(i => i.id === 'c'));
  assert.equal(data.days['2026-10-27'], undefined, '빈 날은 지운다');
  putPhoto(only); assert.deepEqual(data.days['2026-10-27'].map(p => p.id), ['c']);
  assert.equal(takePhoto(data, {id: 'zz', day: '2026-10-03'}), null);
  assert.equal(takePhoto(undefined, item), null);
});

test('메뉴 한 줄·화면 연결: [사진]은 [메뉴] 창 안, 크게 보기·선택 모드·아이콘·[－][＋]는 공용 부품, 기기 저장 없음', () => {
  assert.ok(ITEMS.some(i => i.id === 'photos' && i.view === 'photos' && i.label === '사진'));
  assert.ok(defaultLayout().rest.includes('photos') && !defaultLayout().bar.includes('photos'));
  const screen = read('app/photos.js'), diary = read('app/diary.js'), strip = read('app/photo-strip.js');
  for (const part of ["from './photo-strip.js'", "from './select-mode.js'", "from './od-link.js'", "from './photo-grid-size.js'", "from './small-notice.js'"]) assert.ok(screen.includes(part), part);
  assert.ok(diary.includes("from './photo-strip.js'"), '일기도 같은 크게 보기');
  assert.doesNotMatch(diary, /class="diary-viewer-actions"/, '크게 보기 그리기는 photo-strip.js 한 곳');
  assert.match(strip, /\[data-diary-star\][^`]*\[data-diary-share\][^`]*\[data-od-delete\][^`]*\[data-diary-info\]|data-diary-star[\s\S]*data-diary-share[\s\S]*data-od-delete[\s\S]*data-diary-info/);
  const deviceStores = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'caches' + '\\.'].join('|'));
  for (const f of ['app/photos.js', 'app/photos-model.mjs', 'app/photo-strip.js']) assert.doesNotMatch(read(f), deviceStores, f);
  assert.match(read('app/view-loader.js'), /photos:\['\.\/diary\.css','\.\/od-link\.css','\.\/photos\.css'/);
  assert.match(read('app/app-router.js'), /photos:\['tab'\]/);
  assert.match(read('app/index.html'), /data-view="photos" type="button">사진<\/button>/);
});
