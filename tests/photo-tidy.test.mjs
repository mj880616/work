// S46-20 사진 정리 제안 ①: 어디에 있는지 거르기·백업 안 됨 폴더·잡동사니(synthetic, 실제 폰·서버 없음).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchIndex, placeItems, placeCounts, unbackedFolders, junkGroups, junkKind, groupHidden, tidyCount, forgetIds, typeFilter, sizeText, validPlace} from '../app/photo-tidy-model.mjs';
import {createPhotoTidy} from '../app/photo-tidy.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-31T03:00:00Z');
const od = (id, name, size, t) => ({kind:'od', source:'onedrive', id, key:id, name, size_bytes:size, taken_at:t, day:t.slice(0, 10), video:false, screenshot:false});
const ph = (n, name, size, t, folder, extra = {}) => ({kind:'phone', source:'phone', id:`ph:${n}`, phoneId:String(n), key:`ms:${n}`, name, size_bytes:size, taken_at:t, day:t.slice(0, 10), video:false, screenshot:false, folder, ...extra});

const ODS = [od('A', 'IMG_1.jpg', 100, '2026-10-01T01:00:00.000Z'), od('B', 'IMG_2.jpg', 200, '2026-10-02T01:00:00.000Z'), od('C', 'old.jpg', 300, '2020-01-01T01:00:00.000Z')];
const PHS = [
  ph(1, 'IMG_1.jpg', 100, '2026-10-01T01:00:00.000Z', 'DCIM/Camera/'),
  ph(2, 'IMG_2.jpg', 200, '2026-10-02T01:00:01.000Z', 'DCIM/Camera/'),
  ph(3, 'IMG_3.jpg', 150, '2026-10-03T01:00:00.000Z', 'DCIM/Camera/'),
  ph(4, 'k1.jpg', 50, '2026-09-01T01:00:00.000Z', 'Pictures/KakaoTalk/'),
  ph(5, 'k2.jpg', 60, '2026-09-02T01:00:00.000Z', 'Pictures/KakaoTalk/'),
  ph(6, 't1.jpg', 70, '2026-09-03T01:00:00.000Z', 'Pictures/Telegram/'),
  ph(7, 'Screenshot_1.png', 10, '2024-01-01T01:00:00.000Z', 'Pictures/Screenshots/', {screenshot:true}),
  ph(8, 'Screenshot_2.png', 10, '2026-10-20T01:00:00.000Z', 'Pictures/Screenshots/', {screenshot:true}),
];

test('같은 사진 짝: 섞어 보기 규칙(이름·크기·찍은 시각 2초) 그대로, 양쪽 방향', () => {
  const ix = matchIndex(ODS, PHS);
  assert.deepEqual([...ix.phoneHas].sort(), ['ph:1', 'ph:2']);
  assert.deepEqual([...ix.odHas].sort(), ['A', 'B']);
  assert.deepEqual([...matchIndex([], PHS).phoneHas], []);
});

test('어디에 있나: 폰에만·원드라이브에만(폰에서 지웠지만 남은 것)·둘 다(한 장)', () => {
  const ctx = {odItems:ODS, phItems:PHS};
  assert.deepEqual(placeItems('phone', ctx).map(x => x.id), ['ph:3', 'ph:4', 'ph:5', 'ph:6', 'ph:7', 'ph:8']);
  assert.deepEqual(placeItems('onedrive', ctx).map(x => x.id), ['C']);
  assert.deepEqual(placeItems('both', ctx).map(x => x.id), ['A', 'B']);
  // 끈 폰 폴더 바로 안 사진은 [폰에만]에서도 빠진다.
  assert.deepEqual(placeItems('phone', {...ctx, off:new Set(['Pictures/KakaoTalk/'])}).map(x => x.id), ['ph:3', 'ph:6', 'ph:7', 'ph:8']);
  assert.deepEqual(placeCounts(ctx), {all:9, phone:6, onedrive:1, both:2});
  assert.equal(validPlace('x'), 'all');
});

test('백업 안 됨: 한 장도 원드라이브에 없는 폰 폴더만, 장수 많은 순', () => {
  const list = unbackedFolders(PHS, matchIndex(ODS, PHS));
  assert.deepEqual(list.map(f => [f.id, f.name, f.count]), [['Pictures/KakaoTalk/', 'KakaoTalk', 2], ['Pictures/Screenshots/', 'Screenshots', 2], ['Pictures/Telegram/', 'Telegram', 1]]);
  assert.equal(list[0].bytes, 110);
  assert.ok(!list.some(f => f.id === 'DCIM/Camera/'), '일부라도 원드라이브에 있으면 백업되는 폴더');
});

test('잡동사니: 1년 지난 스크린샷·카톡·텔레그램 받은 사진, 숨김 상태', () => {
  const g = junkGroups(PHS, NOW);
  assert.deepEqual(g.map(x => [x.kind, x.items.map(i => i.id)]), [['shot', ['ph:7']], ['kakao', ['ph:4', 'ph:5']], ['telegram', ['ph:6']]]);
  assert.deepEqual(g[1].folders, ['Pictures/KakaoTalk/']);
  assert.deepEqual(g[0].folders, [], '스크린샷 폴더는 숨기지 않는다(최근 것도 들어 있어서)');
  assert.equal(junkKind('Download/KakaoTalk/'), 'kakao');
  assert.equal(junkKind('Pictures/Telegram Images/'), 'telegram');
  assert.equal(junkKind('DCIM/Camera/'), '');
  assert.ok(groupHidden(g[1], new Set(['Pictures/KakaoTalk/'])) && !groupHidden(g[0], new Set(['Pictures/Screenshots/'])));
  assert.equal(tidyCount({unbacked:[1], junk:g}, new Set()), 2);
  assert.equal(tidyCount({unbacked:[], junk:[g[1]]}, new Set(['Pictures/KakaoTalk/'])), 0);
});

test('지운 칸 빼기·화면 거르기·크기 글', () => {
  assert.deepEqual(forgetIds(PHS, ['ph:1', 'ph:2']).length, 6);
  assert.deepEqual(typeFilter(PHS, 'shot').map(x => x.id), ['ph:7', 'ph:8']);
  assert.equal(sizeText(1.5e9), '1.5GB'); assert.equal(sizeText(3.4e8), '340MB'); assert.equal(sizeText(0), '');
});

test('정리 읽기: 폰(끈 폴더 포함)·원드라이브를 끝까지 쪽마다 읽고, 다 읽은 뒤에만 목록', async () => {
  const pages = [PHS.slice(0, 5), PHS.slice(5)];
  const calls = [];
  const phone = {page:async q => { calls.push(q); const i = q.offset ? 1 : 0; return {items:pages[i], next:i ? null : 5}; }};
  let paints = 0;
  const t = createPhotoTidy({phone, odReady:() => true, odError:() => 'od', phoneError:() => 'ph', phoneOff:() => new Set(), onChange:() => { paints++; },
    readOd:async cursor => (cursor ? {items:ODS.slice(2), next:null} : {items:ODS.slice(0, 2), next:{t:'x', id:'y'}})});
  assert.equal(t.list('place:phone'), null);
  await t.rescan();
  assert.ok(calls.every(q => q.hide === undefined && q.filter === 'all'), '끈 폴더도 읽는다(제안 재료)');
  assert.equal(t.state.ph.length, 8); assert.equal(t.state.od.length, 3);
  assert.deepEqual(t.list('place:onedrive').map(x => x.id), ['C']);
  assert.deepEqual([...t.unbackedIds()].sort(), ['Pictures/KakaoTalk/', 'Pictures/Screenshots/', 'Pictures/Telegram/']);
  assert.equal(t.count(), 2);
  assert.ok(paints > 2);
  const html = t.html({place:'phone', canHide:true, canTrash:true});
  assert.match(html, /data-photos-place="phone" aria-pressed="true"/);
  assert.match(html, /백업 안 됨 <b>3개 폴더<\/b>/);
  assert.match(html, /data-photos-tidy-hide="kakao"/);
  assert.doesNotMatch(html, /data-photos-tidy-hide="shot"/);
  t.forget(['ph:4', 'ph:5']);
  assert.equal(t.group('kakao'), null);
  // 원드라이브 연결 전: 거르기·백업은 안내 한 줄, 잡동사니는 그대로.
  const t2 = createPhotoTidy({phone:{page:async () => ({items:PHS, next:null})}, odReady:() => false, readOd:async () => { throw new Error('no'); }, odError:() => '', phoneError:() => '', phoneOff:() => new Set()});
  await t2.rescan();
  assert.match(t2.html(), /원드라이브 연결 뒤/);
  assert.equal(t2.list('place:phone'), null);
  assert.match(t2.html({canTrash:false}), /잡동사니 <b>4장<\/b>/);
  assert.doesNotMatch(t2.html({canTrash:false}), /data-photos-tidy-trash/);
});

test('사진 메뉴 연결: [정리] 칩·접힌 칸·누를 때만 지우기·숨기기, 기기 저장 없음', () => {
  const src = read('app/photos.js'), tidy = read('app/photo-tidy.js'), model = read('app/photo-tidy-model.mjs');
  assert.match(src, /data-photos-tidy-chip aria-expanded="false" aria-controls="photosTidy" hidden>정리<\/button>/);
  assert.match(src, /askConfirm\(b, \{text:`\$\{g\.label\} \$\{n\}장을 폰 휴지통으로 옮길까요\?`/);
  assert.match(src, /if \(b\.matches\('\[data-photos-tidy-hide\]'\)\)/);
  assert.match(src, /photos-unbacked/);
  // 기기 저장 낱말은 저장소 검사(browser-storage-audit)가 시험 글에서도 막으므로 조각으로 만든다.
  const deviceStore = new RegExp(['local', 'session'].map(x => x + 'Storage').concat('indexed' + 'DB').join('|'));
  for (const s of [src, tidy, model]) assert.doesNotMatch(s, deviceStore);
  // 정리 읽기는 화면에서 [정리]를 열 때만 시작한다(자동 지우기 없음).
  assert.doesNotMatch(tidy, /phone\.trash|folderOp/);
});
