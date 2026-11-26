import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {destSheetHtml, folderSheetRows, folderSheetPath, folderChain, folderAndBelow, sheetTitle, ROOT} from '../app/folder-dest-sheet.mjs';
// S69-62 폴더 고르기 창 하나(사용자 11/24 18:16·18:18): [파일] '옮길 곳' 창 모양을 자료실·노트·사진·News 별표 폴더가 같이 쓴다.
const DEVICE_STORES = new RegExp([['local', 'Storage'], ['session', 'Storage'], ['indexed', 'DB']].map(p => p.join('')).join('|'));
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const F = [
  {id: 'a', name: '가', parent_id: null, sort_order: 2048},
  {id: 'b', name: '나', parent_id: null, sort_order: 1024},
  {id: 'a1', name: '가-1', parent_id: 'a', sort_order: 1},
  {id: 'a11', name: '가-1-1', parent_id: 'a1'},
  {id: 'x', name: '부모 없음', parent_id: 'gone'},
];

test('창 HTML: 제목·최근 칩·나무·아래 경로·[새 폴더]·[여기에 옮기기], 이름은 글자로만', () => {
  const html = destSheetHtml({title: '2개 옮길 곳', chips: [{key: 'a', name: '<가>', on: true}], tree: '<div>나무</div>', at: '자료실 › 가', canMk: true, canGo: true});
  assert.match(html, /<span id="fxDestTitle">2개 옮길 곳<\/span>/);
  assert.match(html, /최근 보낸 곳<\/div><div class="fx-dest-recent"><button type="button" class="fx-dest-chip on" data-fx-dest-pick="a" data-fx-dest-name="&lt;가&gt;">/);
  assert.match(html, /<nav class="fx-dest-tree nx-tree" aria-label="받을 곳 폴더"><div>나무<\/div><\/nav>/);
  assert.match(html, /<span class="fx-dest-at">자료실 › 가<\/span><button type="button" class="fx-btn" data-fx-dest-mkdir>새 폴더<\/button><button type="button" class="fx-btn fx-pri" data-fx-dest-go>여기에 옮기기<\/button>/);
  const off = destSheetHtml({title: 't', wait: 'W', mk: false, goLabel: '이 폴더로 정하기'});
  assert.match(off, /받을 폴더를 선택하세요/);
  assert.match(off, /aria-label="받을 곳 폴더">W<\/nav>/);
  assert.doesNotMatch(off, /data-fx-dest-mkdir/, 'mkdir 없는 곳은 [새 폴더] 단추가 없다(흐린 단추 없음)');
  assert.match(off, /data-fx-dest-go disabled>이 폴더로 정하기/);
  assert.match(destSheetHtml({title: 't', extra: '새 폴더 제안'}), /<button type="button" class="fx-btn" data-fd-extra>새 폴더 제안<\/button>/);
  assert.equal(sheetTitle(3), '3개 옮길 곳');
  assert.equal(sheetTitle(0, '넣을 폴더'), '넣을 폴더');
});

test('나무 줄: 맨 위 줄 아래 펼친 폴더만, 형제는 sort_order 순, 부모가 없는 폴더는 맨 위로', () => {
  const closed = folderSheetRows({folders: F, open: new Set(), rootName: '자료실'});
  assert.deepEqual(closed.map(r => r.key), [ROOT], '맨 위 줄도 닫혀 있으면 그것만');
  const top = folderSheetRows({folders: F, open: new Set([ROOT]), rootName: '자료실'});
  assert.deepEqual(top.map(r => [r.name, r.depth, r.hasKids]), [['자료실', 0, true], ['나', 1, false], ['가', 1, true], ['부모 없음', 1, false]]);
  const deep = folderSheetRows({folders: F, open: new Set([ROOT, 'a', 'a1']), rootName: '자료실'});
  assert.deepEqual(deep.map(r => [r.name, r.depth]), [['자료실', 0], ['나', 1], ['가', 1], ['가-1', 2], ['가-1-1', 3], ['부모 없음', 1]]);
  // 한 층씩 읽는 나무(구글 드라이브): 아직 안 읽은 층은 펼칠 수 있게.
  const lazy = folderSheetRows({folders: [{id: 'g', name: 'G', parent_id: null}], open: new Set([ROOT]), rootName: '구글 드라이브', maybeKids: id => id === 'g'});
  assert.equal(lazy[1].hasKids, true);
  // 고리(서로 부모)는 한 번만.
  const loop = folderSheetRows({folders: [{id: 'p', name: 'P', parent_id: 'q'}, {id: 'q', name: 'Q', parent_id: 'p'}], open: new Set([ROOT, 'p', 'q']), rootName: 'R'});
  assert.equal(loop.length, 1, '고리 폴더는 맨 위 자리를 못 얻어 그리지 않는다(무한 반복 없음)');
});

test('경로·위 폴더·자기와 그 아래', () => {
  assert.equal(folderSheetPath(F, 'a11', '자료실'), '자료실 › 가 › 가-1 › 가-1-1');
  assert.equal(folderSheetPath(F, ROOT, '노트'), '노트');
  assert.equal(folderSheetPath(F, null, '노트'), '노트');
  const many = Array.from({length: 8}, (_, i) => ({id: 'd' + i, name: 'D' + i, parent_id: i ? 'd' + (i - 1) : null}));
  assert.equal(folderSheetPath(many, 'd7', 'R'), 'R › … › D3 › D4 › D5 › D6 › D7');
  assert.deepEqual(folderChain(F, 'a11').map(f => f.id), ['a', 'a1', 'a11']);
  assert.deepEqual([...folderAndBelow(F, 'a')].sort(), ['a', 'a1', 'a11']);
});

test('쓰는 곳: 폴더 고르기는 모두 이 창 하나(옛 작은 창·옛 폴더 목록 없음), 고르기만으로는 옮기지 않는다', () => {
  const sheet = read('app/folder-dest-sheet.js');
  // 줄 누르기 = 고르기 + 펼치기, 옮기기는 [여기에 옮기기](go)에서만 onGo.
  assert.match(sheet, /function pick\(key\) \{[^}]*s\.pick = key;\n\s*s\.open\.add\(key\);/);
  assert.doesNotMatch(sheet.slice(sheet.indexOf('function pick('), sheet.indexOf('function twist(')), /onGo/);
  assert.match(sheet, /async function go\(\) \{[^]*await s\.onGo\?\.\(id, folder\);/);
  assert.match(sheet, /box\.showModal\(\)/);
  assert.match(sheet, /KPTURouter\?\.layer\?\.open\('folder-sheet'/);
  assert.doesNotMatch(sheet, DEVICE_STORES); // 기기 저장 낱말은 감사(browser-storage-audit)가 세지 않게 조각으로 만든다(files-model.test.mjs와 같음)
  const files = read('app/files.js');
  assert.match(files, /box\.innerHTML = destSheetHtml\(\{title: destTitle\(x\.rows\.length, x\.mode\)/);
  for (const f of ['library-folders.js', 'library-folder-pick.js', 'note-folder-pick.js', 'basket-notes.js', 'news-clipping.js', 'library-sort.js', 'photos.js']) assert.match(read('app/' + f), /openFolderSheet\(/, f);
  // 옛 자료실 작은 창의 '옮길 곳 고르기'(라디오 줄)는 없앴다.
  const lf = read('app/library-folders.js');
  assert.doesNotMatch(lf, /libraryFolderTargets|data-lu-target|askTarget/);
  // 사진 [폴더로 옮기기]는 작은 메뉴 대신 이 창(앨범 넣기만 작은 메뉴).
  const ph = read('app/photos.js');
  assert.doesNotMatch(ph, /data-pick-folder|data-pick-gd|data-pick-phone/);
  assert.match(ph, /function openFolderPick\(trigger, p\)/);
});
