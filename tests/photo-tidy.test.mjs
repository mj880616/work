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
  t.toggle('place:phone');
  const html = t.html({canHide:true, canTrash:true});
  assert.match(html, /data-photos-place="phone" aria-pressed="true"/);
  // S47-19: 어디에 있나 칩도 그 줄 아래 펼친 칸(합계·정렬 칩, 기본 찍은 날 최신).
  assert.match(html, /<\/div><p class="photos-tidy-line">[^<]+<\/p><div class="photos-tidy-pane" data-photos-tidy-pane="place:phone"><div class="photos-tidy-pane-head"><span class="photos-tidy-num">6장 · 합계 1KB<\/span>/);
  assert.match(html, /data-photos-tidy-sort="place:phone\|new" aria-pressed="true"/);
  assert.deepEqual(t.paneList('place:phone').map(x => x.id), ['ph:8', 'ph:3', 'ph:6', 'ph:5', 'ph:4', 'ph:7']);
  t.toggle('place:phone');
  assert.ok(!t.opened('place:phone'));
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

// ---- S46-20 ②: 공간 비우기·같은 사진 묶음 ----
import {spacePlan, dupGroups, dupTrashList, defaultKeep, scanFresh, FRESH_MS} from '../app/photo-tidy-model.mjs';

test('공간 비우기: 원드라이브에 확인된 것만, 1년 지난 사진·한 달 지난 큰 동영상, 별표 뺌', () => {
  const vid = ph(9, 'VID_1.mp4', 80e6, '2026-09-01T01:00:00.000Z', 'DCIM/Camera/', {video:true});
  const oldOd = od('D', 'IMG_0.jpg', 1000, '2024-05-01T01:00:00.000Z'), vOd = {...od('E', 'VID_1.mp4', 80e6, '2026-09-01T01:00:00.000Z'), video:true};
  const oldPh = ph(10, 'IMG_0.jpg', 1000, '2024-05-01T01:00:00.000Z', 'DCIM/Camera/');
  const starOld = ph(11, 'IMG_S.jpg', 500, '2024-05-02T01:00:00.000Z', 'DCIM/Camera/');
  const odItems = [...ODS, oldOd, vOd, od('F', 'IMG_S.jpg', 500, '2024-05-02T01:00:00.000Z')], phItems = [...PHS, vid, oldPh, starOld];
  const plan = spacePlan(phItems, matchIndex(odItems, phItems), {now:NOW, isStarred:p => p.id === 'ph:11'});
  assert.deepEqual(plan.items.map(x => x.id).sort(), ['ph:10', 'ph:9']);
  assert.equal(plan.bytes, 80e6 + 1000); assert.equal(plan.videos, 1); assert.equal(plan.photos, 1);
  // 원드라이브에 없는 오래된 스크린샷(ph:7)은 후보가 아니다.
  assert.ok(!plan.items.some(x => x.id === 'ph:7'));
  assert.ok(scanFresh(NOW - 1000, NOW) && !scanFresh(NOW - FRESH_MS - 1, NOW) && !scanFresh(0, NaN));
});

test('같은 사진 묶음: 여러 번 저장(같은 크기·가로세로)·연사(카메라 폴더, 첫 장과 1초 안), 남길 것 고르기', () => {
  const list = [
    ph(20, 'a.jpg', 300e3, '2026-10-01T01:00:00.000Z', 'Pictures/KakaoTalk/', {width:100, height:80}),
    ph(21, 'IMG_a.jpg', 300e3, '2026-09-30T01:00:00.000Z', 'DCIM/Camera/', {width:100, height:80}),
    ph(22, 'b.jpg', 300e3, '2026-10-01T01:00:00.000Z', 'Pictures/X/', {width:80, height:100}), // 가로세로 다르면 다른 사진
    ph(30, 'B1.jpg', 2e6, '2026-10-05T01:00:00.000Z', 'DCIM/Camera/'),
    ph(31, 'B2.jpg', 3e6, '2026-10-05T01:00:00.600Z', 'DCIM/Camera/'),
    ph(32, 'B3.jpg', 2e6, '2026-10-05T01:00:01.400Z', 'DCIM/Camera/'),
    ph(33, 'B4.jpg', 2e6, '2026-10-05T01:00:05.000Z', 'DCIM/Camera/'),
    ph(34, 'S.png', 10e3, '2026-10-05T01:00:00.100Z', 'DCIM/Camera/', {screenshot:true}),
  ];
  const g = dupGroups(list);
  const burst = g.find(x => x.kind === 'burst'), copy = g.find(x => x.kind === 'copy');
  // S47-19B: 첫 장과 1초 안만(예전엔 0.6초 간격으로 줄줄이 엮어 ph:32까지 묶었다).
  assert.deepEqual(burst.items.map(x => x.id), ['ph:30', 'ph:31']);
  assert.equal(burst.keep, 'ph:31', '연사는 가장 큰 파일');
  assert.deepEqual(copy.items.map(x => x.id), ['ph:21', 'ph:20']);
  assert.equal(copy.keep, 'ph:21', '같은 사진은 카메라 폴더 것');
  assert.equal(g.length, 2);
  assert.deepEqual(dupTrashList(g).map(x => x.id).sort(), ['ph:20', 'ph:30']);
  assert.deepEqual(dupTrashList([burst], new Map([[burst.id, 'ph:30']])).map(x => x.id), ['ph:31'], '명진이 고른 것이 남는다');
  assert.deepEqual(dupTrashList([burst], new Map([[burst.id, 'ph:99']])).map(x => x.id), ['ph:30'], '묶음 밖 id는 무시');
  assert.equal(defaultKeep([list[0]], 'copy'), 'ph:20');
});

test('정리 칸 ②: 공간 비우기 줄·묶음 그림 줄·지우기는 누를 때만', async () => {
  const vid = ph(9, 'VID_1.mp4', 80e6, '2026-09-01T01:00:00.000Z', 'DCIM/Camera/', {video:true});
  const vOd = {...od('E', 'VID_1.mp4', 80e6, '2026-09-01T01:00:00.000Z'), video:true};
  const b1 = ph(30, 'B1.jpg', 2e6, '2026-10-05T01:00:00.000Z', 'DCIM/Camera/'), b2 = ph(31, 'B2.jpg', 3e6, '2026-10-05T01:00:00.600Z', 'DCIM/Camera/');
  let clock = NOW;
  const t = createPhotoTidy({phone:{page:async () => ({items:[...PHS, vid, b1, b2], next:null})}, odReady:() => true, readOd:async () => ({items:[...ODS, vOd], next:null}),
    odError:() => '', phoneError:() => '', phoneOff:() => new Set(), now:() => clock});
  await t.rescan();
  const html = t.html({canTrash:true});
  assert.match(html, /폰에서만 지우면 <b>80MB<\/b> 비워져요/);
  assert.match(html, /data-photos-tidy-trash="space"/);
  assert.match(html, /같은 사진·연사 <b>묶음 1개<\/b> · 지울 수 있는 1장 · 2MB/);
  assert.match(html, /data-photos-tidy-keep="ph:30\|ph:31" aria-pressed="true"/);
  assert.match(html, /data-photos-tidy-keep="ph:30\|ph:30" aria-pressed="false"/);
  assert.deepEqual(t.group('dups').items.map(x => x.id), ['ph:30']);
  t.keep('ph:30', 'ph:30');
  assert.deepEqual(t.group('dup|ph:30').items.map(x => x.id), ['ph:31']);
  assert.deepEqual(t.list('space').map(x => x.id), ['ph:9']);
  // S47-19: 공간 비우기는 [보기] 단추 없이 그 줄 안(<details>)에 펼친 칸(기본 용량 큰 순).
  assert.match(html, /<div class="photos-tidy-pane" data-photos-tidy-pane="space">.*data-photos-tidy-sort="space\|size" aria-pressed="true"/);
  assert.doesNotMatch(html, /data-photos-tidy-see="space"/);
  assert.ok(t.fresh()); clock += 11 * 60 * 1000; assert.ok(!t.fresh(), '10분 지나면 지우기 전에 다시 확인');
  assert.doesNotMatch(t.html({canTrash:false}), /data-photos-tidy-trash/);
  const src = read('app/photos.js');
  assert.match(src, /if \(needCopy && !tidy\.fresh\(\)\)/);
});

// ---- S47-16 PHOTO-폰지우기안전장치 ----
import {copyPairs, keptText, goneText, TIDY_HELP} from '../app/photo-tidy-model.mjs';
test('지우기 전 사본 짝: 같은 크기 + (같은 이름 또는 찍은 시각)만, 크기를 모르면 짝 없음', () => {
  const noSize = ph(40, 'IMG_1.jpg', null, '2026-10-01T01:00:00.000Z', 'DCIM/Camera/');
  const otherSize = ph(41, 'IMG_2.jpg', 201, '2026-10-02T01:00:00.000Z', 'DCIM/Camera/');
  const {pairs, noCopy} = copyPairs([PHS[0], PHS[1], PHS[2], noSize, otherSize], ODS);
  assert.deepEqual(pairs.map(x => [x.item.id, x.copy.id]), [['ph:1', 'A'], ['ph:2', 'B']]);
  assert.deepEqual(noCopy.map(x => x.id), ['ph:3', 'ph:40', 'ph:41']);
  assert.deepEqual(copyPairs(PHS, []).pairs, []);
  assert.equal(keptText(2, 0), '원드라이브에 없음 2장은 남겼어요');
  assert.equal(keptText(0, 3), '원드라이브 확인 못 한 3장은 남겼어요');
  assert.equal(keptText(0, 0), '');
  assert.match(goneText(4), /^폰에서 지운 4장이 원드라이브에서도 지워졌어요\. 원드라이브 휴지통\(30일\)에서 되살리세요\. 동기화 앱이 양방향이면 업로드만으로 바꾸세요$/);
});
test('다음 사진 확인 때 사본 사라짐 경고 한 줄·[알았어요], 원드라이브를 못 읽으면 검사·[나머지 지우기] 없음', async () => {
  const vid = ph(9, 'VID_1.mp4', 80e6, '2026-09-01T01:00:00.000Z', 'DCIM/Camera/', {video:true});
  const vOd = {...od('E', 'VID_1.mp4', 80e6, '2026-09-01T01:00:00.000Z'), video:true};
  const b1 = ph(30, 'B1.jpg', 2e6, '2026-10-05T01:00:00.000Z', 'DCIM/Camera/'), b2 = ph(31, 'B2.jpg', 3e6, '2026-10-05T01:00:00.600Z', 'DCIM/Camera/');
  let watched = 0, seen = 0, gone = 3;
  const t = createPhotoTidy({phone:{page:async () => ({items:[...PHS, vid, b1, b2], next:null})}, odReady:() => true, readOd:async () => ({items:[...ODS, vOd], next:null}),
    odError:() => '', phoneError:() => '', phoneOff:() => new Set(), now:() => NOW,
    watchTrash:async () => { watched++; return gone; }, seenTrash:async () => { seen++; }});
  await t.rescan(); await new Promise(r => setTimeout(r, 0));
  assert.equal(watched, 1);
  let html = t.html({canTrash:true});
  assert.match(html, /class="photos-tidy-line photos-tidy-warn" role="alert">폰에서 지운 3장이 원드라이브에서도 지워졌어요\..*<button type="button" class="mini" data-photos-tidy-gone-ok>알았어요<\/button>/);
  assert.ok(html.includes(`<span class="photos-tidy-help">${TIDY_HELP.space}</span>`), '공간 비우기 설명 한 줄(접혀도 보임)');
  assert.match(html, /data-photos-tidy-trash="dups"/);
  assert.deepEqual(t.copyPairs(t.group('space').items).pairs.map(x => x.copy.id), ['E']);
  t.goneSeen();
  assert.equal(seen, 1);
  assert.doesNotMatch(t.html({canTrash:true}), /photos-tidy-warn/);
  gone = 0; await t.rescan(); await new Promise(r => setTimeout(r, 0));
  assert.equal(watched, 2); assert.doesNotMatch(t.html({canTrash:true}), /photos-tidy-warn/);
  // 원드라이브 없음: 사본 검사 안 함, 짝 없음(null), 묶음 [나머지 지우기] 없음(잡동사니 지우기는 그대로).
  let w2 = 0;
  const t2 = createPhotoTidy({phone:{page:async () => ({items:[...PHS, b1, b2], next:null})}, odReady:() => false, readOd:async () => ({items:[], next:null}),
    odError:() => '', phoneError:() => '', phoneOff:() => new Set(), now:() => NOW, watchTrash:async () => { w2++; return 5; }});
  await t2.rescan(); await new Promise(r => setTimeout(r, 0));
  assert.equal(w2, 0); assert.equal(t2.copyPairs(PHS), null);
  const h2 = t2.html({canTrash:true});
  assert.doesNotMatch(h2, /data-photos-tidy-trash="dup/); assert.match(h2, /data-photos-tidy-trash="kakao"/);
});
test('사진 메뉴 지우기 연결: 사본 확인된 것만 폰 휴지통, 지운 뒤 서버 기록, 경고 [알았어요]', () => {
  const src = read('app/photos.js'), od = read('app/diary-onedrive.js');
  assert.match(src, /const needCopy = kind === 'space' \|\| kind\.startsWith\('dup'\);/);
  assert.match(src, /odCopyCheck\(rt, part\.map\(x => \(\{id:x\.copy\.id, size:x\.item\.size_bytes\}\)\)\)/);
  assert.match(src, /list = g\.items\.filter\(x => copyOf\.has\(x\.id\)\);/);
  // 확인 실패(네트워크)는 지우지 않음(확인 못 함).
  assert.match(src, /catch \{ res = \{ok:\[\], missing:\[\], unsure:part\.map\(x => x\.copy\.id\)\}; \}/);
  assert.match(src, /phone_id:x\.phoneId, copy_id:copyOf\.get\(x\.id\)/);
  assert.match(src, /if \(b\.matches\('\[data-photos-tidy-gone-ok\]'\)\) \{ tidy\.goneSeen\(\); return true; \}/);
  assert.match(src, /watchTrash:\(\) => odTrashWatch\(rt\), seenTrash:\(\) => odTrashSeen\(rt\)/);
  for (const a of ['copy-check', 'trash-log', 'trash-watch', 'trash-seen']) assert.ok(od.includes(`action: '${a}'`), a);
});

// ---- S47-19 정리 [보기] 그 줄 안 펼침·용량·정렬 ----
import {sortTidy, sortDupGroups, totalBytes, paneSortDefault, TIDY_SORTS, DUP_SORTS} from '../app/photo-tidy-model.mjs';
test('정리 펼친 칸 정렬: 용량 큰 순·찍은 날 최신·오래된(시각 모르면 뒤), 합계, 묶음 정렬', () => {
  const a = ph(1, 'a', 300, '2026-01-01T00:00:00.000Z', 'X/'), b = ph(2, 'b', 900, '2025-01-01T00:00:00.000Z', 'X/'), c = ph(3, 'c', 100, '2027-01-01T00:00:00.000Z', 'X/'), d = {...ph(4, 'd', 500, '2026-01-01T00:00:00.000Z', 'X/'), taken_at:''};
  const list = [a, b, c, d];
  assert.deepEqual(sortTidy(list, 'size').map(x => x.id), ['ph:2', 'ph:4', 'ph:1', 'ph:3']);
  assert.deepEqual(sortTidy(list, 'new').map(x => x.id), ['ph:3', 'ph:1', 'ph:2', 'ph:4']);
  assert.deepEqual(sortTidy(list, 'old').map(x => x.id), ['ph:2', 'ph:1', 'ph:3', 'ph:4']);
  assert.deepEqual(list.map(x => x.id), ['ph:1', 'ph:2', 'ph:3', 'ph:4'], '원래 목록은 그대로');
  assert.equal(totalBytes(list), 1800);
  assert.equal(paneSortDefault('space'), 'size'); assert.equal(paneSortDefault('place:phone'), 'new');
  assert.deepEqual(Object.keys(TIDY_SORTS), ['size', 'new', 'old']); assert.deepEqual(Object.keys(DUP_SORTS), ['save', 'new', 'old']);
  const g1 = {id:'g1', bytes:10, items:[a]}, g2 = {id:'g2', bytes:30, items:[b]}, g3 = {id:'g3', bytes:20, items:[c]};
  assert.deepEqual(sortDupGroups([g1, g2, g3], 'save').map(g => g.id), ['g2', 'g3', 'g1']);
  assert.deepEqual(sortDupGroups([g1, g2, g3], 'new').map(g => g.id), ['g3', 'g1', 'g2']);
  assert.deepEqual(sortDupGroups([g1, g2, g3], 'old').map(g => g.id), ['g2', 'g1', 'g3']);
  assert.equal(sizeText(3.2e6), '3.2MB'); assert.equal(sizeText(3e6), '3MB'); assert.equal(sizeText(12.4e6), '12MB');
});
test('정리 [보기] 펼치기: 잡동사니·백업 안 됨 폴더 줄 아래에 칸, 정렬 바꾸기', async () => {
  const t = createPhotoTidy({phone:{page:async () => ({items:PHS, next:null})}, odReady:() => true, readOd:async () => ({items:ODS, next:null}),
    odError:() => '', phoneError:() => '', phoneOff:() => new Set(), now:() => NOW});
  await t.rescan();
  t.toggle('junk:kakao');
  let html = t.html({canTrash:true});
  assert.match(html, /data-photos-tidy-see="junk:kakao" aria-expanded="true">보기<\/button>.*?<\/div><div class="photos-tidy-pane" data-photos-tidy-pane="junk:kakao">/);
  assert.match(html, /data-photos-tidy-pane="junk:kakao"><div class="photos-tidy-pane-head"><span class="photos-tidy-num">2장 · 합계 1KB<\/span>/);
  assert.deepEqual(t.paneList('junk:kakao').map(x => x.id), ['ph:5', 'ph:4'], '기본 용량 큰 순');
  t.sortSet('junk:kakao', 'old');
  assert.deepEqual(t.paneList('junk:kakao').map(x => x.id), ['ph:4', 'ph:5']);
  t.sortSet('junk:kakao', 'nope');
  assert.match(t.html(), /data-photos-tidy-sort="junk:kakao\|old" aria-pressed="true"/);
  t.toggle('unbacked:Pictures/Telegram/');
  assert.deepEqual(t.paneList('unbacked:Pictures/Telegram/').map(x => x.id), ['ph:6']);
  assert.match(t.html(), /data-photos-tidy-pane="unbacked:Pictures\/Telegram\/"/);
  t.toggle('junk:kakao');
  assert.doesNotMatch(t.html(), /data-photos-tidy-pane="junk:kakao"/);
  assert.equal(t.paneList('unbacked:DCIM/Camera/'), null, '백업되는 폴더는 칸 없음');
  t.toggle('junk:nope');
  assert.ok(!t.opened('junk:nope'));
});
test('사진 메뉴: 정리 목록이 아래 [사진] 목록을 바꾸던 길은 없고, 펼친 칸은 이어 그리기·크게 보기', () => {
  const src = read('app/photos.js'), css = read('app/photos.css');
  for (const gone of ['setTidyView', 'tidyFill', 'tidyView', 'tidyLayer', 'data-photos-tidy-top', 'data-photos-tidy-end', "'photos-tidy'"]) assert.ok(!src.includes(gone), gone);
  assert.match(src, /const TIDY_STEP = 60;/);
  assert.match(src, /tidyIo\.unobserve\(foot\); tidyIo\.observe\(foot\);/);
  assert.match(src, /openTidyViewer\(\(\) => tidyPaneList\(p\.dataset\.photosTidyPane\), Number\(b\.dataset\.photosTidyOpen\)\)/);
  assert.match(src, /function openTidyViewer\(list, index\) \{\n  openViewer\(index, \{\n    list,/);
  assert.match(css, /\.photos-tidy-size\{ position:absolute;/);
});

// ---- S47-20 줄마다 쉬운 설명 + 대안 · 찾은 결과 남겨 두기 ----
import {partlyBackedFolders, partlyText, foundText, JUNK_HELP} from '../app/photo-tidy-model.mjs';
test('일부만 있음: 원드라이브에서 찾은 장수/전체, 못 찾은 장수 많은 순 · 찾은 지 글', () => {
  const ix = matchIndex(ODS, PHS);
  const partly = partlyBackedFolders(PHS, ix);
  for (const f of partly) assert.ok(f.backed > 0 && f.backed < f.count, f.id);
  const a = ph(50, 'a.jpg', 111, '2026-01-01T00:00:00.000Z', 'P/'), b = ph(51, 'b.jpg', 222, '2026-01-02T00:00:00.000Z', 'P/'), c = ph(52, 'c.jpg', 333, '2026-01-03T00:00:00.000Z', 'P/');
  const q = ph(53, 'q.jpg', 444, '2026-01-01T00:00:00.000Z', 'Q/'), r = ph(54, 'r.jpg', 555, '2026-01-02T00:00:00.000Z', 'Q/');
  const odx = [od('A1', 'a.jpg', 111, '2026-01-01T00:00:00.000Z'), od('Q1', 'q.jpg', 444, '2026-01-01T00:00:00.000Z')];
  const list = partlyBackedFolders([a, b, c, q, r], matchIndex(odx, [a, b, c, q, r]));
  assert.deepEqual(list.map(f => [f.id, f.backed, f.count]), [['P/', 1, 3], ['Q/', 1, 2]]);
  assert.equal(partlyText(list[0]), '원드라이브에 일부만 있음 1/3장');
  assert.equal(foundText(NOW - 20e3, NOW), '방금 찾음');
  assert.equal(foundText(NOW - 7 * 60e3, NOW), '7분 전에 찾음');
  assert.equal(foundText(NOW - 3 * 3600e3, NOW), '3시간 전에 찾음');
  assert.equal(foundText(0, NOW), '');
});
test('정리 줄마다 설명(접혀도 보임)·대안 줄·[폴더 끄기]·일부만 있음 칸·[다시 찾기] 하나', async () => {
  const a = ph(50, 'a.jpg', 111, '2026-01-01T00:00:00.000Z', 'P/'), b = ph(51, 'b.jpg', 222, '2026-01-02T00:00:00.000Z', 'P/');
  const b1 = ph(30, 'B1.jpg', 2e6, '2026-10-05T01:00:00.000Z', 'DCIM/Camera/'), b2 = ph(31, 'B2.jpg', 3e6, '2026-10-05T01:00:00.600Z', 'DCIM/Camera/');
  let off = new Set(), clock = NOW;
  const oldPh = ph(55, 'old.jpg', 300, '2020-01-01T01:00:00.000Z', 'DCIM/Camera/');
  const t = createPhotoTidy({phone:{page:async () => ({items:[...PHS, a, b, b1, b2, oldPh], next:null})}, odReady:() => true,
    readOd:async () => ({items:[...ODS, od('A1', 'a.jpg', 111, '2026-01-01T00:00:00.000Z')], next:null}),
    odError:() => '', phoneError:() => '', phoneOff:() => off, now:() => clock});
  await t.rescan();
  let html = t.html({canHide:true, canTrash:true});
  assert.equal((html.match(/data-photos-tidy-rescan/g) || []).length, 1, '[다시 찾기] 하나');
  assert.match(html, /^<p class="photos-tidy-at">방금 찾음 · 폰 13장 · 원드라이브 4장 확인 <button type="button" class="mini" data-photos-tidy-rescan>다시 찾기<\/button><\/p>/);
  assert.doesNotMatch(html, /photos-tidy-foot|>다시 확인</);
  for (const k of ['all', 'unbacked', 'space', 'dups', 'junk']) assert.ok(html.includes(TIDY_HELP[k]), k);
  for (const k of ['unbackedDo', 'partly', 'dupsDo', 'junkDo']) assert.ok(html.includes(TIDY_HELP[k].replace(/'/g, '&#39;')), k);
  assert.ok(html.includes(JUNK_HELP.kakao) && html.includes(JUNK_HELP.telegram));
  // 설명은 summary 안(접혀도 보임).
  assert.match(html, /<summary><span>백업 안 됨 <b>3개 폴더<\/b> · 5장 · 일부만 2개<span class="photos-tidy-help">이 폴더 사진은 원드라이브에서 한 장도 못 찾았어요\./);
  assert.match(html, /📁 P <span class="photos-tidy-num">원드라이브에 일부만 있음 1\/2장/);
  assert.match(html, /data-photos-tidy-off="Pictures\/Telegram\/">폴더 끄기<\/button>/);
  assert.doesNotMatch(t.html({canHide:false}), /data-photos-tidy-off/, '폴더 스위치 없는 앱이면 단추 없음');
  // 어디에 있나 칩마다 설명이 바뀐다.
  t.toggle('place:onedrive');
  assert.ok(t.html().includes(TIDY_HELP.onedrive));
  // 일부만 있음 [보기] = 못 찾은 사진만.
  assert.deepEqual(t.paneList('partly:P/').map(x => x.id), ['ph:51']);
  // [폴더 끄기]: 셈에서 빼고 [다시 켜기], 다시 찾지 않는다.
  const scanned = t.state;
  off = new Set(['Pictures/Telegram/']); t.offChanged();
  html = t.html({canHide:true});
  assert.match(html, /백업 안 됨 <b>2개 폴더<\/b> · 4장 · 꺼 둔 1개/);
  assert.match(html, /data-photos-tidy-off="Pictures\/Telegram\/">다시 켜기<\/button>/);
  assert.equal(t.state, scanned);
  off = new Set(['Pictures/Telegram/', 'Pictures/KakaoTalk/', 'Pictures/Screenshots/']);
  assert.equal(t.count() >= 1, true);
  // 시간이 지나면 'n분 전에 찾음'.
  clock = NOW + 12 * 60e3;
  assert.match(t.html(), /^<p class="photos-tidy-at">12분 전에 찾음 /);
});
test('찾은 결과 남겨 두기: 다시 열기·stale·forget·폴더 바꿈은 다시 찾지 않고 [다시 찾기](rescan)만 새로, reset(계정 바뀜)은 지움', async () => {
  let reads = 0;
  const t = createPhotoTidy({phone:{page:async () => { reads++; return {items:PHS, next:null}; }}, odReady:() => true, readOd:async () => ({items:ODS, next:null}),
    odError:() => '', phoneError:() => '', phoneOff:() => new Set(), now:() => NOW});
  t.open(); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.equal(reads, 1); assert.ok(t.ready());
  t.open(); t.open();
  assert.equal(reads, 1, '다시 열어도 지난 결과');
  t.stale();
  assert.equal(reads, 1); assert.ok(t.ready());
  assert.match(t.html(), /확인 · 그 뒤 폰이 바뀌었어요 <button type="button" class="mini" data-photos-tidy-rescan>다시 찾기/);
  t.forget(['ph:4']);
  assert.equal(reads, 1); assert.ok(!t.state.ph.some(p => p.id === 'ph:4'));
  await t.rescan();
  assert.equal(reads, 2); assert.ok(!t.state.stale, '새로 찾으면 알림 지움');
  t.reset();
  assert.equal(t.state, null);
  t.open(); await new Promise(r => setTimeout(r, 0));
  assert.equal(reads, 3);
});
test('사진 메뉴 연결: 폰 상태 알림·폴더 바꿈은 정리 결과를 지우지 않고, 계정이 바뀔 때만 지운다', () => {
  const src = read('app/photos.js');
  const onChange = src.slice(src.indexOf('phone.onChange(s => {'), src.indexOf('async function enter()'));
  assert.ok(onChange.length > 20);
  assert.doesNotMatch(onChange, /tidy\.reset\(\)/);
  assert.match(onChange, /if \(tidyAccess && s\?\.access !== tidyAccess\) tidy\.stale\(\);/);
  assert.match(src, /if \(res\.ok\) \{ pFolders = null; pFor = null; pItems = \[\]; tidy\.stale\(\); resetList\(\);/);
  assert.equal((src.match(/tidy\.reset\(\)/g) || []).length, 1, '계정 바뀜(session-changed) 한 곳만');
  assert.match(src, /tidy\.reset\(\); tidyOpen = false; tidyShown\.clear\(\); tidyGone\.clear\(\);/);
  assert.match(src, /if \(b\.matches\('\[data-photos-tidy-off\]'\)\) \{ tidyFolderOff\(b\.dataset\.photosTidyOff\); return true; \}/);
  // 지우기 직전 10분 확인(안전장치)은 그대로.
  assert.match(src, /if \(needCopy && !tidy\.fresh\(\)\)/);
});

// ---- S47-19B 같은 사진·연사 묶음 바로잡기 ----
import {cameraFolder, dupStats, dupStatText, whereLines, copiesFinder, phonePath, BURST_MAX, DUP_HOW} from '../app/photo-tidy-model.mjs';
test('연사 좁히기: 카메라 폴더·정확한 시각만, 받은 사진·스크린샷·approx 제외, 첫 장과 1초 안, 최대 장수', () => {
  const t0 = Date.parse('2026-10-05T01:00:00.000Z'), at = ms => new Date(t0 + ms).toISOString();
  const cam = (n, ms, extra = {}) => ph(n, `C${n}.jpg`, 1e6 + n, at(ms), 'DCIM/Camera/', extra);
  // 받은 사진(같은 저장 시각) — 예전엔 수백 장이 한 묶음이 되던 것.
  const got = [1, 2, 3].map(k => ph(100 + k, `k${k}.jpg`, 1e6 + k, at(0), 'Pictures/KakaoTalk/'));
  const dl = [1, 2].map(k => ph(110 + k, `d${k}.jpg`, 1e6 + 10 + k, at(0), 'Download/'));
  const tg = [1, 2].map(k => ph(120 + k, `t${k}.jpg`, 1e6 + 20 + k, at(0), 'DCIM/Telegram/'));
  const approx = [cam(130, 0, {approx:true}), cam(131, 100, {approx:true})];
  const chain = [0, 600, 1200, 1800].map((ms, i) => cam(140 + i, 10_000 + ms));
  const many = Array.from({length:BURST_MAX + 5}, (_, i) => cam(200 + i, 100_000 + i * 10));
  const g = dupGroups([...got, ...dl, ...tg, ...approx, ...chain, ...many]);
  assert.ok(g.every(x => x.kind === 'burst'));
  assert.ok(!g.some(x => x.items.some(p => !/^DCIM\/Camera\//.test(p.folder) || p.approx)), '받은 사진·approx는 연사가 아니다');
  const ch = g.filter(x => x.items.some(p => p.id.startsWith('ph:14')));
  assert.deepEqual(ch.map(x => x.items.map(p => p.id)).sort(), [['ph:140', 'ph:141'], ['ph:142', 'ph:143']], '사슬로 엮지 않고 첫 장과 1초 안');
  const big = g.filter(x => x.items.some(p => p.id.startsWith('ph:2')));
  assert.deepEqual(big.map(x => x.items.length).sort((a, b) => b - a), [BURST_MAX, 5], '한 묶음 최대 장수');
  assert.ok(cameraFolder('DCIM/Camera/') && cameraFolder('DCIM/100ANDRO/') && !cameraFolder('DCIM/Screenshots/') && !cameraFolder('Pictures/') && !cameraFolder(''));
  // 같은 사진 묶음에 든 사진은 연사로 다시 묶지 않는다.
  const a = ph(300, 'A.jpg', 2e6, at(500_000), 'DCIM/Camera/', {width:10, height:10}), b = ph(301, 'A copy.jpg', 2e6, at(500_200), 'DCIM/Camera/', {width:10, height:10});
  const g2 = dupGroups([a, b]);
  assert.deepEqual(g2.map(x => [x.kind, x.items.length]), [['copy', 2]]);
  assert.deepEqual(dupStats(g), {groups:g.length, extra:g.reduce((n, x) => n + x.items.length - 1, 0), bytes:g.reduce((n, x) => n + x.bytes, 0)});
  assert.equal(dupStatText({groups:3, extra:7, bytes:12.5e6}), '묶음 3개 · 지울 수 있는 사진 7장 · 아낄 용량 13MB');
  assert.equal(dupStatText({groups:1, extra:1, bytes:0}), '묶음 1개 · 지울 수 있는 사진 1장');
  assert.ok(DUP_HOW.copy && DUP_HOW.burst);
});
test('묶음 사진이 있는 곳: 폰 폴더 + 원드라이브 사본마다 한 줄(경로 모르면 폴더 모름)', () => {
  const p = ph(1, 'IMG_1.jpg', 100, '2026-10-01T01:00:00.000Z', 'DCIM/Camera/');
  const find = copiesFinder([...ODS, {...ODS[0], id:'A2'}]);
  assert.deepEqual(find(p).map(o => o.id), ['A', 'A2']);
  assert.deepEqual(whereLines(p, find(p)), ['폰 · DCIM/Camera', '원드라이브 · 폴더 모름', '원드라이브 · 폴더 모름']);
  assert.deepEqual(whereLines(p, find(p), o => (o.id === 'A' ? '사진/2026' : '')), ['폰 · DCIM/Camera', '원드라이브 · 사진/2026', '원드라이브 · 폴더 모름']);
  assert.deepEqual(whereLines(ODS[2], []), ['원드라이브 · 폴더 모름']);
  assert.equal(phonePath(''), '폴더 모름');
  assert.deepEqual(copiesFinder(ODS)({...p, size_bytes:null}), []);
});
test('묶음 칸: 종류 칩(같은 사진·연사)·뜻이 보이는 숫자·비교 칸(두 장 나란히, 넘기기, 이것 남기기)', async () => {
  const t0 = Date.parse('2026-10-05T01:00:00.000Z'), at = ms => new Date(t0 + ms).toISOString();
  const c1 = ph(50, 'IMG_1.jpg', 100e3, '2026-10-01T01:00:00.000Z', 'DCIM/Camera/', {width:10, height:10});
  const c2 = ph(51, 'IMG_1(1).jpg', 100e3, '2026-10-02T01:00:00.000Z', 'Pictures/KakaoTalk/', {width:10, height:10});
  const big = n => ph(n, `B${n}.jpg`, 1e6, at(0), 'X/');
  const cpy = [70, 71].map(n => ({...big(n), size_bytes:60e3, width:4, height:3}));
  const b = [0, 300, 600].map((ms, i) => ph(60 + i, `S${i}.jpg`, (i + 1) * 1e6, at(ms), 'DCIM/Camera/'));
  const t = createPhotoTidy({phone:{page:async () => ({items:[c1, c2, ...cpy, ...b], next:null})}, odReady:() => true, readOd:async () => ({items:[od('A', 'IMG_1.jpg', 100e3, '2026-10-01T01:00:00.000Z')], next:null}),
    odError:() => '', phoneError:() => '', phoneOff:() => new Set(), now:() => NOW});
  await t.rescan();
  let html = t.html({canTrash:true});
  assert.match(html, /data-photos-tidy-dupkind="copy" aria-pressed="true">같은 사진 2<\/button>/);
  assert.match(html, /data-photos-tidy-dupkind="burst" aria-pressed="false">연사 1<\/button>/);
  assert.match(html, /파일 크기·가로세로가 똑같은 사진 · 묶음 2개 · 지울 수 있는 사진 2장 · 아낄 용량 160KB/);
  assert.doesNotMatch(html, /data-photos-tidy-dup="ph:60"/, '다른 종류 묶음은 칩을 바꿔야 보인다');
  t.dupKind('burst');
  html = t.html({canTrash:true});
  assert.match(html, /data-photos-tidy-dup="ph:60"><span class="photos-tidy-num">연사 3장 · 아낄 3MB<\/span><button type="button" class="mini" data-photos-tidy-see="dup:ph:60" aria-expanded="false">비교<\/button>/);
  assert.deepEqual(t.group('dups').items.map(x => x.id), ['ph:60', 'ph:61'], '[나머지 모두 지우기]는 보이는 종류만');
  assert.match(html, /보이는 연사 묶음에서 남길 사진만 두고/);
  // 비교: 왼쪽 = 남길 사진(가장 큰 ph:62), 오른쪽 = 나머지 1/2, ‹ ›로 넘김, [이것 남기기].
  t.toggle('dup:ph:60');
  html = t.html({canTrash:true});
  const cmp = html.match(/<div class="photos-tidy-cmp" data-photos-tidy-cmp="ph:60">.*?<\/div><\/div><div class="photos-tidy-cmp-nav">.*?<\/div><\/div>/)?.[0] || '';
  assert.ok(cmp, '비교 칸');
  const slots = [...cmp.matchAll(/data-photos-tidy-cmp-open="ph:60\|(ph:\d+)"/g)].map(m => m[1]);
  assert.deepEqual(slots, ['ph:62', 'ph:60']);
  assert.match(cmp, /<span class="photos-tidy-where">폰 · DCIM\/Camera<\/span><span class="photos-tidy-num">3MB · 2026\.10\.05 10:00:00<\/span><button type="button" class="mini" data-photos-tidy-keep="ph:60\|ph:62" aria-pressed="true">남길 사진<\/button>/);
  assert.match(cmp, /data-photos-tidy-keep="ph:60\|ph:60" aria-pressed="false">이것 남기기/);
  assert.match(cmp, /<span class="photos-tidy-num">1 \/ 2<\/span>/);
  assert.match(cmp, /data-size="large"/);
  t.cmpStep('ph:60', 1);
  assert.deepEqual([...t.html().matchAll(/data-photos-tidy-cmp-open="ph:60\|(ph:\d+)"/g)].map(m => m[1]), ['ph:62', 'ph:61']);
  t.cmpStep('ph:60', 1);
  assert.deepEqual([...t.html().matchAll(/data-photos-tidy-cmp-open="ph:60\|(ph:\d+)"/g)].map(m => m[1]), ['ph:62', 'ph:60'], '끝에서 처음으로');
  t.keep('ph:60', 'ph:60');
  assert.deepEqual([...t.html().matchAll(/data-photos-tidy-cmp-open="ph:60\|(ph:\d+)"/g)].map(m => m[1]), ['ph:60', 'ph:61']);
  assert.deepEqual(t.groupItems('ph:60').map(x => x.id), ['ph:60', 'ph:61', 'ph:62']);
  // 같은 사진 묶음 비교: 원드라이브 사본 줄.
  t.dupKind('copy'); t.toggle('dup:ph:50');
  assert.match(t.html(), /<span class="photos-tidy-where">폰 · DCIM\/Camera<\/span><span class="photos-tidy-where">원드라이브 · 폴더 모름<\/span>/);
  assert.match(t.html(), /<span class="photos-tidy-where">폰 · Pictures\/KakaoTalk<\/span><span class="photos-tidy-num">/);
  t.dupKind('nope'); assert.match(t.html(), /data-photos-tidy-dupkind="copy" aria-pressed="true"/);
  const src = read('app/photos.js');
  assert.match(src, /if \(b\.matches\('\[data-photos-tidy-dupkind\]'\)\)/);
  assert.match(src, /el\.dataset\.size === 'large' \? 'large' : 'small'/);
});
