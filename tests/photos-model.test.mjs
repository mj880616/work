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
  for (const t of ['folders', 'albums']) assert.equal(validTab(t), t);
  for (const t of ['map', '', null]) assert.equal(validTab(t), 'all', String(t));
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

// ---- PHOTO-사진메뉴 2차: 서버 library·months·days·휴지통과 결정 4~7 ----
import {FILTERS, validFilter, colsFor, stepPhotoCols, parsePhotoView, toItem, appendItems, newestFirst, durationLabel, monthBar, monthAt, monthCursor, dayCursor,
  calendarFromDays, chunks, dragRange, takeItems, putItems, COLS_RANGE} from '../app/photos-model.mjs';
import {odAuthUrlBack} from '../app/diary-onedrive.js';
import {validValue} from '../app/view-prefs.js';
import vm from 'node:vm';

test('거르기 네 가지·칸 수(폰 3~6·PC 5~12)·photo_view 읽기(결정 6)', () => {
  assert.deepEqual([...FILTERS], ['all', 'star', 'video', 'shot']);
  assert.equal(validFilter('video'), 'video'); assert.equal(validFilter('x'), 'all');
  assert.deepEqual(COLS_RANGE, {narrow: [3, 6], wide: [5, 12]});
  assert.equal(colsFor(false, null), 4); assert.equal(colsFor(true, null), 8);
  assert.equal(colsFor(false, 10), 6, 'PC에서 고른 값도 폰 범위로'); assert.equal(colsFor(true, 3), 5);
  assert.equal(stepPhotoCols(false, 3, 1), 3, '끝이면 그대로'); assert.equal(stepPhotoCols(false, 4, -1), 5); assert.equal(stepPhotoCols(true, 12, -1), 12);
  assert.deepEqual(parsePhotoView({filter: 'shot', cols: 7}), {filter: 'shot', cols: 7});
  assert.deepEqual(parsePhotoView({filter: 'bad', cols: 2}), {filter: 'all', cols: null});
  assert.deepEqual(parsePhotoView(null), {filter: 'all', cols: null});
  assert.equal(validValue('photo_view', {filter: 'video', cols: 12}), true);
  for (const bad of [{cols: 13}, {cols: 2}, {filter: 'x'}, {other: 1}, [], 'all', {cols: 4.5}]) assert.equal(validValue('photo_view', bad), false, JSON.stringify(bad));
});

test('서버 쪽 잇기(같은 id 한 번)·최신순·동영상 길이', () => {
  const a = toItem({id: 'a', day: '2026-10-05', taken_at: '2026-10-05T01:00:00Z', kind: 'video', duration_ms: 42000});
  assert.equal(a.video, true); assert.equal(a.key, 'a'); assert.equal(a.source, 'onedrive');
  const b = toItem({id: 'b', day: '2026-10-04', taken_at: '2026-10-04T01:00:00Z'});
  assert.deepEqual(appendItems([a], [a, b]).map(x => x.id), ['a', 'b']);
  assert.deepEqual([b, a].sort(newestFirst).map(x => x.id), ['a', 'b']);
  assert.equal(durationLabel(42000), '0:42'); assert.equal(durationLabel(3723000), '1:02:03'); assert.equal(durationLabel(null), '');
});

test('빠른 이동 막대: 최신 달부터 장수만큼 길이, 놓은 자리의 달, 그 달 끝 cursor(서울)', () => {
  const bar = monthBar({'2026-08': 1, '2026-10': 3, 'bad': 9});
  assert.deepEqual(bar.map(m => [m.key, m.label, m.from, m.to]), [['2026-10', '2026.10', 0, 0.75], ['2026-08', '2026.08', 0.75, 1]]);
  assert.equal(monthAt(bar, 0.1).key, '2026-10'); assert.equal(monthAt(bar, 0.8).key, '2026-08'); assert.equal(monthAt(bar, 2).key, '2026-08'); assert.equal(monthAt([], 0.5), null);
  assert.deepEqual(monthCursor('2026-09'), {t: '2026-09-30T15:00:00.000Z', id: '!'}, '10월 1일 0시(서울) 앞부터');
  assert.deepEqual(monthCursor('2026-12'), {t: '2026-12-31T15:00:00.000Z', id: '!'});
  assert.deepEqual(dayCursor('2026-10-05'), {t: '2026-10-05T15:00:00.000Z', id: '!'});
  assert.equal(monthCursor('x'), null); assert.equal(dayCursor('x'), null);
});

test('달력(서버 days): 장수·대표 1장(동영상 표시)', () => {
  const cal = calendarFromDays({year: 2026, month: 9}, {'2026-10-05': {count: 3, cover: {id: 'v', kind: 'video'}}});
  assert.equal(cal.lead, 4); assert.equal(cal.cells.length, 31);
  assert.equal(cal.cells[4].count, 3); assert.equal(cal.cells[4].rep.id, 'v'); assert.equal(cal.cells[4].rep.video, true);
  assert.equal(cal.cells[0].rep, null);
});

test('여러 장: 50장씩 나누기·끌어 고르기 범위·빼고 같은 자리로 되돌리기', () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(dragRange(['a', 'b', 'c', 'd'], 'c', 'a'), ['a', 'b', 'c']);
  assert.deepEqual(dragRange(['a', 'b'], 'a', 'z'), []);
  const list = ['a', 'b', 'c', 'd'].map(id => ({id}));
  const t = takeItems(list, ['b', 'd']);
  assert.deepEqual(t.rest.map(x => x.id), ['a', 'c']);
  assert.deepEqual(putItems(t.rest, t.taken).map(x => x.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(putItems(putItems(t.rest, t.taken), t.taken).map(x => x.id), ['a', 'b', 'c', 'd'], '두 번 되돌려도 한 번');
});

test('연결 뒤 사진 메뉴로(결정 5): state 꼬리 ~photos를 붙이고, 돌아오는 페이지가 떼어 사진 메뉴로 보낸다', () => {
  const url = 'https://login.microsoftonline.com/x/oauth2/v2.0/authorize?client_id=c&state=abc.def&scope=s';
  assert.equal(new URL(odAuthUrlBack(url, 'photos')).searchParams.get('state'), 'abc.def~photos');
  assert.equal(odAuthUrlBack(url, 'diary'), url, '일기는 그대로');
  assert.equal(odAuthUrlBack('not a url', 'photos'), 'not a url');
  const go = search => { let to = ''; vm.runInNewContext(read('app/onedrive-return.js'), {location: {search, replace: u => { to = u; }}, URLSearchParams}); return to; };
  assert.equal(go('?code=abc12345&state=abc.def~photos'), './?view=photos#onedrive_code=abc12345&onedrive_state=abc.def');
  assert.equal(go('?code=abc12345&state=abc.def'), './?view=diary#onedrive_code=abc12345&onedrive_state=abc.def');
  assert.equal(go('?error=access_denied&state=abc.def~photos'), './?view=photos#onedrive_error=access_denied');
  assert.equal(go('?code=abc12345&state=abc.def~other'), './?view=diary#onedrive_code=abc12345&onedrive_state=abc.def');
});

test('설정 창은 공용 부품 하나(결정 4): 일기·사진 메뉴가 od-settings.js를 함께 쓰고, 일기 안에 창 그리기가 남지 않는다', () => {
  const diary = read('app/diary.js'), screen = read('app/photos.js'), settings = read('app/od-settings.js');
  for (const f of [diary, screen]) assert.ok(f.includes("from './od-settings.js'"));
  assert.doesNotMatch(diary, /class="diary-od-modal"/); assert.match(settings, /class="diary-od-modal" data-od-modal/);
  assert.match(screen, /back:'photos'/);
  assert.doesNotMatch(screen, /KPTURouter\?\.go\?\.\('diary'\)/, '폴더 바꾸기 때문에 일기로 넘어가지 않는다');
  for (const act of ['odLibrary', 'odMonths', 'odDays', 'odMediaUrl', 'odDeleteMany', 'odTrashList', 'odTrashRestore', 'odTrashPurge']) assert.ok(screen.includes(act), act);
  assert.match(screen, /viewPrefs\.set\('photo_view'/);
  const deviceStores = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB', 'caches' + '\\.'].join('|'));
  for (const f of ['app/od-settings.js', 'app/onedrive-return.js']) assert.doesNotMatch(read(f), deviceStores, f);
});

import {photoFolderRows, photoFolderTrail, photoSubfolders, photoMoveTargets, cleanPhotoFolderName, moveUndoGroups, cleanTagName, albumCards, folderErrorText} from '../app/photos-model.mjs';
const TREE = {top: {id: 'T', name: '카메라', count: 2, total: 9}, folders: [
  {id: 'B', name: '여행', parent_id: 'T', enabled: true, count: 3, total: 5}, {id: 'A', name: '2026', parent_id: 'T', enabled: true, count: 1, total: 2},
  {id: 'B1', name: '제주', parent_id: 'B', enabled: true, count: 2, total: 2}, {id: 'A1', name: '10월', parent_id: 'A', enabled: false, count: 1, total: 1},
]};

test('사진 메뉴 ② 폴더 나무: 맨 위 폴더 늘 열림, 열린 폴더만 펼침(이름순), 위치 줄, 옮길 곳(자기·자기 아래 빠짐)', () => {
  assert.deepEqual(photoFolderRows(TREE).map(r => [r.id, r.depth, r.kids, r.open]), [['T', 0, true, true], ['A', 1, true, false], ['B', 1, true, false]]);
  assert.deepEqual(photoFolderRows(TREE, id => id === 'B').map(r => r.id), ['T', 'A', 'B', 'B1']);
  assert.deepEqual(photoFolderRows(TREE, () => true).map(r => [r.id, r.indent]), [['T', 0], ['A', 1], ['A1', 2], ['B', 1], ['B1', 2]]);
  assert.deepEqual(photoFolderTrail(TREE, 'B1').map(f => f.name), ['카메라', '여행', '제주']);
  assert.deepEqual(photoSubfolders(TREE, 'T').map(f => f.id), ['A', 'B']);
  assert.deepEqual(photoMoveTargets(TREE, {moving: 'B'}).map(r => [r.id, r.current]), [['T', true], ['A', false], ['A1', false]]);
  assert.deepEqual(photoMoveTargets(TREE, {here: 'A'}).filter(r => r.current).map(r => r.id), ['A']);
  assert.deepEqual(photoFolderRows(null), []);
});

test('폴더·앨범 이름 규칙(서버와 같음)과 옮기기 되돌리기 묶음', () => {
  assert.equal(cleanPhotoFolderName(' 여행 '), '여행');
  for (const bad of ['', '  ', 'a/b', 'a:b', 'a|b', '끝.', '.Web2 휴지통', 'x'.repeat(201), 'a\u0001', 5]) assert.equal(cleanPhotoFolderName(bad), null, String(bad));
  assert.equal(cleanTagName('#제주'), '제주');
  assert.equal(cleanTagName('  가족  '), '가족');
  for (const bad of ['', '#', '제주 여행', 'a#b', 'x'.repeat(41), null]) assert.equal(cleanTagName(bad), null, String(bad));
  const g = moveUndoGroups([{id: 'p1', from: 'A'}, {id: 'p2', from: 'B'}, {id: 'p3', from: 'A'}, {id: 'p4', from: 'T'}, {id: 'p5', from: null}], 'T');
  assert.deepEqual([...g], [['A', ['p1', 'p3']], ['B', ['p2']]]);
  assert.equal(folderErrorText('onedrive_name_taken'), '같은 이름의 폴더가 이미 있어요.');
  assert.equal(folderErrorText('other'), '');
});

test('앨범 카드: 이름순, 장수, 대표 = 정한 대표(앨범 안일 때) → 가장 최근 날', () => {
  const tags = [{id: 't2', name: '여행', cover_key: 'gone'}, {id: 't1', name: '가족', cover_key: 'k1'}];
  const links = [{tag_id: 't1', item_key: 'k1', taken_day: '2026-01-01'}, {tag_id: 't1', item_key: 'k2', taken_day: '2026-05-01'},
    {tag_id: 't2', item_key: 'k3', taken_day: '2026-03-01'}, {tag_id: 't2', item_key: 'k4', taken_day: '2026-09-01'}];
  assert.deepEqual(albumCards(tags, links).map(c => [c.name, c.count, c.cover]), [['가족', 2, 'k1'], ['여행', 2, 'k4']]);
  assert.deepEqual(albumCards([{id: 'e', name: '빈', cover_key: null}], []), [{id: 'e', name: '빈', count: 0, cover: null, keys: []}]);
});

test('화면 연결: [폴더]·[앨범] 칩, 폴더 나무는 공용 줄 모양(folder-tree.css)·위치 줄(folder-path.mjs)·공용 메뉴(anchored-menu.js), 기기 저장 없음', () => {
  const js = read('app/photos.js'), loader = read('app/view-loader.js');
  assert.match(js, /data-photos-tab="folders"[^>]*>폴더</);
  assert.match(js, /data-photos-tab="albums"[^>]*>앨범</);
  assert.match(js, /from '\.\/folder-path\.mjs'/);
  assert.match(js, /from '\.\/anchored-menu\.js'/);
  assert.match(js, /class="nx-row nx-folder/);
  assert.match(loader, /photos:\[[^\]]*'\.\/folder-tree\.css'/);
  assert.match(loader, /basket:\[[^\]]*'\.\/folder-tree\.css'/);
  assert.match(read('app/folder-tree.css'), /\.nx-row \{/);
  assert.doesNotMatch(read('app/basket.css'), /^\.nx-main \{/m);
  const stores = new RegExp(['local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB'].join('|'));
  for (const f of ['app/photos.js', 'app/photo-tags.js']) assert.doesNotMatch(read(f), stores, f);
});
