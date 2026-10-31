import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {albumCards, albumForSources} from '../app/photos-model.mjs';
import {createPhonePhotos} from '../app/phone-photos.js';

// PHOTO-출처모든칩(요청함 10/31 00:01): 출처 켜기/끄기가 [폴더]·[휴지통]·[앨범]에도. 폰 폴더 보기(보기 전용).
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('앨범: 켜진 출처 사진만 세고 대표 사진도 켜진 출처에서(앨범 자체는 그대로)', () => {
  const tags = [{id:'t1', name:'여행', cover_key:'O2'}];
  const links = [
    {tag_id:'t1', item_key:'O1', source:'onedrive', taken_day:'2026-10-30'},
    {tag_id:'t1', item_key:'O2', source:'onedrive', taken_day:'2026-10-20'},
    {tag_id:'t1', item_key:'ms:5', source:'phone', taken_day:'2026-10-31'},
  ];
  const [card] = albumCards(tags, links);
  assert.equal(card.count, 3);
  const both = albumForSources(card, {onedrive:true, phone:true});
  assert.deepEqual([both.count, both.cover, both.phoneCover], [3, 'O2', null]);
  const odOnly = albumForSources(card, {onedrive:true, phone:false});
  assert.deepEqual([odOnly.count, odOnly.cover, odOnly.phoneKeys], [2, 'O2', []]);
  const phoneOnly = albumForSources(card, {onedrive:false, phone:true});
  assert.deepEqual([phoneOnly.count, phoneOnly.cover, phoneOnly.phoneCover, phoneOnly.keys], [1, null, 'ms:5', []]);
  const none = albumForSources(card, {});
  assert.deepEqual([none.count, none.cover, none.phoneCover, none.name, none.id], [0, null, null, '여행', 't1']);
});

function fakeWin(respond) {
  let onMessage = null;
  const bridge = {postMessage: t => { if (t === 'photos:hello') queueMicrotask(() => onMessage?.({data:'photos:state:{"access":"full","key":"abcdefghijklmnopqrstuvwxyzABCDEF","trash":true}'})); },
    addEventListener: (_, fn) => { onMessage = fn; }};
  const urls = [];
  return {urls, win:{navigator:{userAgent:'KPTUAndroid'}, KPTUAppShell:bridge, document:{baseURI:'https://bokdoong.com/work/app/'}, location:{href:''}, fetch: async u => { urls.push(u); return respond(u); }}};
}
const res = (status, body) => ({ok:status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body)});
const cover = {id:'7', name:'IMG_7.jpg', taken_at:'2026-10-30T03:00:00.000Z', day:'2026-10-30', kind:'photo'};

test('폰 폴더 읽기: 목록 해석, 폴더 사진 쪽 읽기, 옛 앱은 null(폰 묶음만 안 보임)', async () => {
  const {win, urls} = fakeWin(u => (u.includes('/folders') ? res(200, JSON.stringify({folders:[
    {id:'DCIM/Camera/', name:'Camera', count:3, cover},
    {id:'bad', name:'x', count:0, cover},
    {id:'Pictures/Screenshots/', name:'Screenshots', count:1, cover:{id:'x'}},
  ]})) : res(200, '{"items":[],"next":null}')));
  const api = createPhonePhotos(win);
  await api.hello();
  const list = await api.folders();
  assert.deepEqual(list.map(f => [f.id, f.name, f.count, f.cover.phoneId]), [['DCIM/Camera/', 'Camera', 3, '7']]);
  await api.page({folder:'DCIM/Camera/'});
  assert.match(urls.at(-1), /\/__phone\/abcdefghijklmnopqrstuvwxyzABCDEF\/page\?.*folder=DCIM%2FCamera%2F/);
  await api.page();
  assert.doesNotMatch(urls.at(-1), /folder=/);
  for (const old of [res(404, ''), res(400, '{"error":"bad_request","detail":""}')]) {
    const o = createPhonePhotos(fakeWin(() => old).win);
    await o.hello();
    assert.equal(await o.folders(), null);
  }
  const broken = createPhonePhotos(fakeWin(() => res(500, '{"error":"query","detail":"SecurityException"}')).win);
  await broken.hello();
  await assert.rejects(broken.folders(), err => err.phone?.error === 'query');
});

test('사진 메뉴: [폴더]·[휴지통]·[앨범]이 출처 켜기를 따른다', () => {
  const s = read('app/photos.js');
  assert.match(s, /const NO_SOURCE_HTML = '<p class="photos-muted" data-photos-no-source>위 출처 아이콘을 켜 주세요\.<\/p>'/);
  assert.doesNotMatch(s, /켜진 사진 출처가 없어요/);
  // [휴지통]: 원드라이브가 꺼지면 원드라이브 휴지통을 읽지 않고, 폰이 켜졌으면 안내 한 줄.
  const trash = s.slice(s.indexOf('async function renderTrash'), s.indexOf('function render()'));
  assert.ok(trash.indexOf('if (!sources.onedrive)') < trash.indexOf('odTrashList'));
  assert.match(trash, /폰 휴지통은 갤러리 앱에서/);
  assert.match(trash, /if \(noSource\(\)\) \{ body\.innerHTML = NO_SOURCE_HTML; return; \}/);
  // [폴더]: 출처 문 + 원드라이브가 꺼지면 폰 묶음만, 둘 다면 '원드라이브'·'폰' 묶음.
  const folders = s.slice(s.indexOf('function renderFolders()'), s.indexOf('function paintPhoneFolderGrid()'));
  assert.match(folders, /const g = listGate\(\);/);
  assert.ok(folders.indexOf('if (!u.onedrive)') < folders.indexOf('loadTree()'), '원드라이브가 꺼지면 원드라이브 나무를 읽지 않음');
  assert.match(folders, /data-photos-fx-group="onedrive">원드라이브/);
  assert.match(s, /data-photos-fx-group="phone">폰/);
  // 폰 폴더 줄: 끌기 없음, 원드라이브 ⋯·스위치와 섞이지 않음. ⋯·새 폴더는 앱 0.4.1+(phoneOps)만(PHOTO-폴더스위치).
  const row = s.slice(s.indexOf('function phoneFolderRowHtml'), s.indexOf('// 폰 묶음 줄들'));
  assert.doesNotMatch(row, /data-photos-fx-more|draggable/);
  assert.match(row, /phoneOps\(\) \? `<button type="button" class="nx-more photos-fx-more" data-photos-pf-more=/);
  const grid = s.slice(s.indexOf('function paintPhoneFolderGrid()'), s.indexOf('function goPhoneFolder'));
  assert.doesNotMatch(grid, /draggable/);
  // [앨범]: 켜진 출처로 줄인 카드.
  assert.match(s, /const cards = \(\) => albumCards\(tags \|\| \[\], links\)\.map\(c => albumForSources\(c, useSrc\(\)\)\);/);
  assert.match(s.slice(s.indexOf('function renderAlbums()'), s.indexOf('function syncAlbumLayer')), /const g = listGate\(\);/);
  // 출처를 바꾸면 모든 칩이 바로 따라 바뀐다(앨범 사진·폰 폴더 위치도 버림).
  assert.match(s, /function sourcesChanged\(\) \{ select\.stop\(\); resetList\(\); calData\.clear\(\); phStarItems = null; aFor = null; pAt = null; gdAt = null; gdTrail = \[\]; paintSources\(\); render\(\); \}/);
  // 크게 보기·고르기는 지금 보이는 목록(폰 폴더 안이면 그 폴더 사진).
  assert.match(s, /t === 'folders' \? \(gdAt !== null \? gdFItems : pAt !== null \? pItems : fItems\)/);
});

test('앱(0.4.0+): 폰 폴더 읽기 하나 추가(서버로 보내지 않음)', () => {
  const rules = read('android-app/app/src/main/java/kr/or/kptu/work/PhoneMediaRules.kt');
  assert.match(rules, /\(page\|ids\|months\|days\|folders\|thumb/);
  assert.match(rules, /fun foldersJson\(/);
  assert.match(read('android-app/app/src/main/java/kr/or/kptu/work/PhoneMedia.kt'), /PhoneMediaRules\.Request\.Folders -> json\(PhoneMediaRules\.foldersJson\(all\(context\)\)\)/);
  assert.match(read('android-app/app/build.gradle'), /versionName '0\.4\.[1-9]'/);
});
