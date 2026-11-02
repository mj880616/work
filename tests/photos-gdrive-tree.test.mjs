// PHOTO-드라이브폴더통일(요청함 11/01 23:16): 구글 드라이브 폴더 보기를 원드라이브와 같은 폴더 나무 부품으로.
// 순수 규칙(gdriveFolderTree·photoFolderRows·folderCountText)과 화면 연결(같은 줄 함수 하나·장수는 색인에서만·새 Edge 호출 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gdriveFolderTree, photoFolderRows, photoFolderTrail, folderCountText, GDRIVE_TOP} from '../app/photos-model.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const levels = () => new Map([
  ['root', {folders: [{id: 'A', name: '카메라', enabled: true, count: 3}, {id: 'B', name: '업무', enabled: false, count: 9}]}],
  ['A', {folders: [{id: 'A1', name: '2026', enabled: true, count: 0}]}],
]);

test('구글 드라이브 층 → 원드라이브와 같은 나무 모양: 맨 위 \'구글 드라이브 n\', 켠 폴더만 장수, 안 읽은 층은 ▸', () => {
  const t = gdriveFolderTree(levels(), {total: 3});
  assert.deepEqual(t.top, {id: GDRIVE_TOP, name: '구글 드라이브', count: null, total: 3, enabled: true});
  assert.equal(t.whole, true);
  const rows = photoFolderRows(t, id => id === 'A');
  assert.deepEqual(rows.map(r => [r.id, r.indent, r.total, r.enabled, r.kids, r.open, r.top]), [
    ['root', 0, 3, true, true, true, true],
    ['B', 1, null, false, true, false, false], // 꺼진 폴더 장수는 모름(서버가 9를 줘도 쓰지 않음). 이름 가나다순.
    ['A', 1, 3, true, true, true, false],
    ['A1', 2, 0, true, true, false, false], // A1 층은 아직 안 읽음 → ▸
  ]);
  assert.deepEqual(photoFolderTrail(t, 'A1').map(f => f.id), ['root', 'A', 'A1']);
});

test('읽어 보니 하위 폴더가 없으면 ▸가 사라지고, 고리·이상한 값은 버린다', () => {
  const L = levels(); L.set('A1', {folders: []}); L.set('B', {folders: [{id: 'A', name: '고리', enabled: true}, {id: 7}]});
  const rows = photoFolderRows(gdriveFolderTree(L), () => true);
  assert.equal(rows.find(r => r.id === 'A1').kids, false);
  assert.equal(rows.filter(r => r.id === 'A').length, 1);
  assert.equal(rows[0].total, null, '전체 장수를 모르면 null');
});

test('장수 글자: 모르면 —', () => {
  assert.equal(folderCountText(0), '0');
  assert.equal(folderCountText(12), '12');
  assert.equal(folderCountText(null), '—');
  assert.equal(folderCountText(-1), '—');
});

test('화면: 원드라이브·구글 드라이브 폴더 줄은 같은 함수 하나, 장수는 폴더 목록 응답에서만(새 Edge 동작 없음)', () => {
  const s = read('app/photos.js');
  assert.equal((s.match(/class="nx-row nx-folder photos-fx-row/g) || []).length, 2, '원드라이브·구글 드라이브 공용 줄 1 + 폰 줄 1');
  assert.match(s, /const gdRowHtml = \(r, \{wide\}\) => folderRowHtml\(r, \{wide, a:GD_ATTR/);
  assert.match(s, /const rows = photoFolderRows\(tree, id => openSet\.has\(id\)\);/);
  assert.match(s, /rows = photoFolderRows\(gdTree\(\), id => gdOpen\.has\(id\)\)/);
  // 장수 표시는 원드라이브·폰·구글 드라이브 모두 countHtml(0·모름은 흐림).
  assert.equal((s.match(/countHtml\(/g) || []).length, 2);
  // 구글 드라이브 함수 길은 그대로(folders만 장수를 더 줌).
  const g = read('app/gdrive-photos.js');
  assert.doesNotMatch(g, /action:'(count|counts|folder-count)'/);
  // 서버: 장수는 색인 표만 센다.
  const h = read('supabase/functions/gdrive-photos/handler.ts');
  assert.match(h, /app_gdrive_photos\?workspace_id=eq\.\$\{workspaceId\}&parent_id=\$\{parentFilter\}&select=item_id&limit=1/);
});

test('빈 곳 핀치: 본문 칸 하나에 붙이고, 격자 위는 격자 핀치에 맡기며 달력은 제외', () => {
  const s = read('app/photos.js');
  assert.match(s, /const bodyPinch = \(\) => \(albumSizing\(\) \? 'album' : tab !== 'calendar' \? 'grid' : ''\);/);
  assert.match(s, /when: event => !!bodyPinch\(\) && !event\.target\?\.closest\?\.\('\[data-diary-grid\]'\)/);
  assert.doesNotMatch(s, /closest\?\.\('\[data-photos-albums\]'\)/, '앨범 목록 위만 받던 옛 규칙 없음');
  const css = read('app/photos.css');
  assert.match(css, /\.photos-body\[data-photos-pinch\]\{ touch-action:pan-y; \}/);
});
