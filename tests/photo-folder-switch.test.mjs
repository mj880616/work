import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// PHOTO-폴더스위치(요청함 10/31 11:04): 사진 [폴더] 폴더 줄 스위치·원드라이브 전체 보기·같은 이름 폴더 위치 이름. 지어낸 값만(네트워크 없음).
const model = await import('../app/photos-model.mjs');
const {odLinkMenuHtml, odLinkLabel} = await import('../app/od-link.js');

test('same-name folders get a dim place name; unique names get none; phone places read in plain words', () => {
  const tree = {top:{id:'R', name:'OneDrive', enabled:false}, folders:[
    {id:'K1', name:'KakaoTalk', parent_id:'P'}, {id:'K2', name:'kakaotalk', parent_id:'R'}, {id:'P', name:'사진', parent_id:'R'}, {id:'T', name:'Telegram', parent_id:'R'}]};
  const places = model.folderPlaceLabels([tree.top, ...tree.folders], f => model.odFolderPlace(tree, f));
  assert.deepEqual([...places], [['K1', '사진'], ['K2', 'OneDrive']]);
  assert.equal(model.phoneFolderPlace('Pictures/KakaoTalk/'), '사진');
  assert.equal(model.phoneFolderPlace('Download/KakaoTalk/'), '다운로드');
  assert.equal(model.phoneFolderPlace('DCIM/Camera/'), '카메라');
  assert.equal(model.phoneFolderPlace('Pictures/Telegram/Sub/'), '사진/Telegram');
  assert.equal(model.phoneFolderPlace('Download/'), '');
  const phone = [{id:'Pictures/KakaoTalk/', name:'KakaoTalk'}, {id:'Download/KakaoTalk/', name:'KakaoTalk'}, {id:'DCIM/Camera/', name:'Camera'}];
  assert.deepEqual([...model.folderPlaceLabels(phone, f => model.phoneFolderPlace(f.id))], [['Pictures/KakaoTalk/', '사진'], ['Download/KakaoTalk/', '다운로드']]);
  // 위치까지 같으면 순번
  assert.deepEqual([...model.folderPlaceLabels([{id:'a', name:'x'}, {id:'b', name:'x'}], () => '사진')], [['a', '사진'], ['b', '사진 2']]);
});

test('whole-drive tree: the top row has its own switch state (off by default), sub-folders keep theirs', () => {
  const tree = {top:{id:'R', name:'OneDrive', count:1, total:3, enabled:false}, folders:[{id:'A', name:'가', parent_id:'R', enabled:true, count:2, total:2}]};
  assert.equal(model.photoFolderById(tree, 'R').enabled, false);
  assert.deepEqual(model.photoFolderRows(tree).map(r => [r.id, r.enabled]), [['R', false], ['A', true]]);
  // 옛 서버(top.enabled 없음)는 예전처럼 늘 켜짐
  assert.equal(model.photoFolderById({top:{id:'R', name:'x'}, folders:[]}, 'R').enabled, true);
});

test('cloud menu: [폴더 바꾸기]·[하위 폴더 켜고 끄기] are gone on the whole drive, kept only while the server is old', () => {
  const whole = odLinkMenuHtml({od:{configured:true, connected:true, folder:{name:'OneDrive'}, whole:true, canDelete:true}});
  assert.doesNotMatch(whole, /data-od-act="folder"|data-od-act="subfolders"/);
  assert.match(whole, /data-od-act="show"/); assert.match(whole, /data-od-act="disconnect"/);
  assert.doesNotMatch(whole, /· OneDrive/, 'no folder name next to the state on the whole drive');
  const old = odLinkMenuHtml({od:{configured:true, connected:true, folder:{name:'카메라'}, canDelete:true}});
  assert.match(old, /data-od-act="folder"/); assert.match(old, /data-od-act="subfolders"/);
  assert.equal(odLinkLabel('ok', {folder:{name:'OneDrive'}, whole:true}), '원드라이브 · 연결됨');
});

test('photos [폴더]: one switch per row (role=switch, server toggle), dim off rows, hint line, place names in rows and the move picker; no device storage', () => {
  const src = readFileSync(new URL('../app/photos.js', import.meta.url), 'utf8');
  assert.match(src, /role="switch" class="diary-od-switch photos-fx-sw" data-photos-fx-sw=/);
  assert.match(src, /odFolderToggle\(rt, id, next\)/);
  assert.match(src, /is-off/);
  assert.match(src, /스위치 켜짐 = 사진에 보임/);
  assert.equal((src.match(/placeHtml\(/g) || []).length >= 3, true, 'od rows, phone rows, head line');
  assert.match(src, /어느 폴더로 옮길까요\?[\s\S]{0,400}photos-fx-place/);
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/);
  const css = readFileSync(new URL('../app/photos.css', import.meta.url), 'utf8');
  assert.match(css, /\.photos-fx-row\.is-off \.nx-main\{ opacity:\.5; \}/);
});
