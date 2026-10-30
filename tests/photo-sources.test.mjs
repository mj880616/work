import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSources, sourcesValue, toggleSource, sourceButtons, activeSources, phoneToItem, phoneIdOfKey, sameMedia, dupFinder, mergeSources, mergeDays, mergeMonths, daysFromItems, SOURCE_DEFAULT} from '../app/photo-sources-model.mjs';
import {validValue} from '../app/view-prefs.js';
import {albumCards, calendarFromDays} from '../app/photos-model.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
// PHOTO-출처 ①: 사진 메뉴 출처(원드라이브·구글 드라이브·폰 사진) 켜기/끄기, 섞기, 중복 판정.
const od = (id, t, extra = {}) => ({kind:'od', source:'onedrive', key:id, id, day:t.slice(0, 10), name:`${id}.jpg`, taken_at:t, video:false, size_bytes:100, ...extra});
const ph = (n, t, extra = {}) => phoneToItem({id:String(n), name:`IMG_${n}.jpg`, taken_at:t, day:t.slice(0, 10), kind:'photo', size_bytes:n * 7, approx:false, uploaded_at:t, ...extra});

test('출처 상태: 없으면 원드라이브·폰 켜짐, 구글 꺼짐 / 켜고 끄기 / 저장 값은 DB 검사가 받는 모양', () => {
  assert.deepEqual(parseSources(null), {onedrive:true, gdrive:false, phone:true});
  assert.deepEqual(parseSources({phone:false, onedrive:'x', icloud:true}), {onedrive:true, gdrive:false, phone:false});
  const off = toggleSource(SOURCE_DEFAULT, 'onedrive');
  assert.equal(off.onedrive, false);
  assert.equal(toggleSource(off, 'onedrive').onedrive, true);
  assert.deepEqual(toggleSource(off, 'nope'), off);
  for (const v of [sourcesValue(null), sourcesValue(off)]) assert.ok(validValue('photo_sources', v), JSON.stringify(v));
  // DB 검사가 같은 세 이름만 받는다.
  const sql = read('supabase/migrations/20261030230000_photo_sources.sql');
  for (const name of ['onedrive', 'gdrive', 'phone']) assert.match(sql, new RegExp(`"${name}"`));
});

test('아이콘 줄: 폰 사진은 앱에서만, 구글 드라이브는 준비 중(켜지지 않음)', () => {
  assert.deepEqual(sourceButtons(null).map(b => b.name), ['onedrive', 'gdrive']);
  const app = sourceButtons({gdrive:true}, {phone:true});
  assert.deepEqual(app.map(b => b.name), ['onedrive', 'gdrive', 'phone']);
  assert.equal(app[1].on, false); assert.equal(app[1].ready, false); assert.match(app[1].label, /준비 중/);
  assert.deepEqual(activeSources({phone:true}, {onedrive:true, phone:false}), {onedrive:true, phone:false, gdrive:false});
  assert.deepEqual(activeSources({onedrive:false}, {onedrive:true, phone:true}), {onedrive:false, phone:true, gdrive:false});
});

test('폰 사진 칸: 앱 JSON → 칸(열쇠 ms:번호, id ph:번호), 모양이 틀리면 버림', () => {
  const it = ph(5, '2026-10-30T01:02:03.000Z');
  assert.equal(it.key, 'ms:5'); assert.equal(it.id, 'ph:5'); assert.equal(it.source, 'phone'); assert.equal(it.phoneId, '5');
  assert.equal(phoneIdOfKey('ms:5'), '5'); assert.equal(phoneIdOfKey('5'), null);
  assert.equal(phoneToItem({id:'x', taken_at:'2026-10-30T00:00:00Z', day:'2026-10-30'}), null);
  assert.equal(phoneToItem({id:'1', taken_at:'nope', day:'2026-10-30'}), null);
  assert.equal(phoneToItem({id:'1', taken_at:'2026-10-30T00:00:00Z', day:'2026-10-30', kind:'video', duration_ms:4200}).video, true);
});

test('중복 판정: 이름+크기, 이름+시각(2초), 크기+시각 / 다른 사진은 남김', () => {
  const a = od('A', '2026-10-30T01:00:00.000Z', {name:'IMG_1.jpg', size_bytes:500});
  assert.ok(sameMedia(ph(1, '2026-10-30T05:00:00.000Z', {name:'img_1.JPG', size_bytes:500}), a), '이름+크기');
  assert.ok(sameMedia(ph(1, '2026-10-30T01:00:01.500Z', {name:'IMG_1.jpg', size_bytes:1}), a), '이름+시각');
  assert.ok(sameMedia(ph(1, '2026-10-30T00:59:59.000Z', {name:'20261030_010000.jpg', size_bytes:500}), a), '크기+시각');
  assert.equal(sameMedia(ph(1, '2026-10-30T01:00:03.000Z', {name:'other.jpg', size_bytes:500}), a), false, '크기만');
  assert.equal(sameMedia(ph(1, '2026-10-30T01:00:00.000Z', {name:'other.jpg', size_bytes:9}), a), false, '시각만');
  assert.equal(sameMedia(ph(1, '2026-10-30T01:00:00.000Z', {name:'IMG_1.jpg', size_bytes:500, kind:'video'}), a), false, '사진과 동영상');
  const find = dupFinder([a]);
  assert.ok(find(ph(1, '2026-10-30T09:00:00.000Z', {name:'IMG_1.jpg', size_bytes:500})));
  assert.equal(find(ph(2, '2026-10-30T09:00:00.000Z')), false);
});

test('섞기: 찍은 날 순서로 한 목록, 폰 쪽 중복은 빼고, 끝나지 않은 출처의 마지막보다 뒤는 아직 안 보임', () => {
  const odItems = [od('A', '2026-10-30T09:00:00.000Z'), od('B', '2026-10-28T09:00:00.000Z', {name:'IMG_2.jpg', size_bytes:14})];
  const phItems = [ph(1, '2026-10-31T09:00:00.000Z'), ph(2, '2026-10-28T09:00:00.000Z'), ph(3, '2026-10-27T09:00:00.000Z')];
  const both = mergeSources([{source:'onedrive', items:odItems, ended:true}, {source:'phone', items:phItems, ended:true}], 'taken_desc');
  assert.deepEqual(both.items.map(x => x.id), ['ph:1', 'A', 'B', 'ph:3']);
  assert.equal(both.ended, true);
  // 원드라이브가 아직 더 있다: 원드라이브 마지막(10/28)보다 뒤인 폰 10/27은 기다린다.
  const wait = mergeSources([{source:'onedrive', items:odItems, ended:false}, {source:'phone', items:phItems, ended:true}], 'taken_desc');
  assert.deepEqual(wait.items.map(x => x.id), ['ph:1', 'A', 'B']);
  assert.deepEqual(wait.waiting, [0]);
  // 아직 아무것도 못 받은 출처가 있으면 아무것도 보이지 않고 그 출처를 먼저 받는다.
  const none = mergeSources([{source:'onedrive', items:odItems, ended:false}, {source:'phone', items:[], ended:false}], 'taken_desc');
  assert.deepEqual(none.items, []); assert.deepEqual(none.waiting, [1, 0]);
  // 한 출처만: 그대로(오래된 먼저도 정렬을 따른다).
  const one = mergeSources([{source:'phone', items:phItems.slice().reverse(), ended:true}], 'taken_asc');
  assert.deepEqual(one.items.map(x => x.id), ['ph:3', 'ph:2', 'ph:1']);
  assert.deepEqual(mergeSources([], 'taken_desc'), {items:[], waiting:[], ended:true});
});

test('달력·막대 합치기: 장수는 더하고 대표는 원드라이브 먼저, 폰만 있는 날은 폰 사진 칸', () => {
  const days = mergeDays({'2026-10-02':{count:2, cover:{id:'A', kind:'photo'}}}, {'2026-10-02':{count:1, cover:{id:'9', taken_at:'2026-10-02T01:00:00.000Z', day:'2026-10-02', kind:'photo'}}, '2026-10-03':{count:3, cover:{id:'8', taken_at:'2026-10-03T01:00:00.000Z', day:'2026-10-03', kind:'photo'}}});
  assert.equal(days['2026-10-02'].count, 3);
  const cal = calendarFromDays({year:2026, month:9}, days);
  assert.equal(cal.cells[1].rep.source, 'onedrive'); assert.equal(cal.cells[1].rep.id, 'A');
  assert.equal(cal.cells[2].rep.source, 'phone'); assert.equal(cal.cells[2].rep.id, 'ph:8'); assert.equal(cal.cells[2].count, 3);
  assert.deepEqual(mergeMonths({'2026-10':2}, {'2026-10':1, '2026-09':4}, {x:-1}), {'2026-10':3, '2026-09':4});
  const fromStars = daysFromItems([ph(1, '2026-10-02T01:00:00.000Z'), ph(2, '2026-10-02T02:00:00.000Z'), ph(3, '2026-09-30T02:00:00.000Z')], '2026-10');
  assert.deepEqual(Object.keys(fromStars), ['2026-10-02']); assert.equal(fromStars['2026-10-02'].count, 2);
});

test('앨범 카드: 원드라이브 열쇠와 폰 열쇠를 나눠 담고 장수는 더함, 대표는 원드라이브 먼저', () => {
  const [c] = albumCards([{id:'t', name:'여행'}], [{tag_id:'t', source:'phone', item_key:'ms:4', taken_day:'2026-10-30'}, {tag_id:'t', item_key:'OD1', taken_day:'2026-10-01'}]);
  assert.equal(c.count, 2); assert.deepEqual(c.keys, ['OD1']); assert.deepEqual(c.phoneKeys, ['ms:4']); assert.equal(c.cover, 'OD1'); assert.equal(c.phoneCover, null);
  const [p] = albumCards([{id:'t', name:'폰'}], [{tag_id:'t', source:'phone', item_key:'ms:4', taken_day:'2026-10-30'}]);
  assert.equal(p.cover, null); assert.equal(p.phoneCover, 'ms:4');
});

test('폰 사진 다리: 폰 앱(KPTUAndroid + 다리)에서만, 옛 앱(답 없음)은 아이콘 없음, 열쇠 없이는 주소를 만들지 않음', async () => {
  const {createPhonePhotos} = await import('../app/phone-photos.js');
  assert.equal(createPhonePhotos({navigator:{userAgent:'Mozilla/5.0 Chrome'}}).usable, false);
  const listeners = [], sent = [];
  const win = {navigator:{userAgent:'Mozilla/5.0 KPTUAndroid/0.3.9'}, document:{baseURI:'https://bokdoong.com/work/app/'},
    KPTUAppShell:{postMessage(m) { sent.push(m); if (m === 'photos:hello') setTimeout(() => listeners.forEach(fn => fn({data:'photos:state:{"access":"full","key":"abcdefghijklmnopqrstuvwxyzAB","trash":true}'})), 0); },
      addEventListener(t, fn) { if (t === 'message') listeners.push(fn); }}};
  const p = createPhonePhotos(win);
  assert.equal(p.available(), false);
  const s = await p.hello();
  assert.equal(s.access, 'full'); assert.equal(p.available(), true);
  assert.equal(p.thumbUrl({phoneId:'7'}, 'large'), 'https://bokdoong.com/work/app/__phone/abcdefghijklmnopqrstuvwxyzAB/thumb/7?s=large');
  // 앱이 '허용 없음'을 알리면 열쇠를 버린다.
  listeners.forEach(fn => fn({data:'photos:state:{"access":"none","trash":true}'}));
  assert.equal(p.thumbUrl({phoneId:'7'}), '');
  await assert.rejects(p.page(), /phone_no_access/);
  // 옛 앱: hello에 답이 없으면 아이콘 없음.
  const old = createPhonePhotos({navigator:{userAgent:'KPTUAndroid/0.3.8'}, KPTUAppShell:{postMessage() {}, addEventListener() {}}});
  await old.hello();
  assert.equal(old.available(), false);
});
