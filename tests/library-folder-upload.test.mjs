// S69-23 LIB-폴더째올리기: 놓은·고른 폴더 읽기, 숨김·빈 파일 건너뛰기, 같은 이름 폴더 합치기·새로 만들기, 앱 폴더 만들 순서, 진행 글.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readDroppedEntries, readPickedFiles, planFolderUpload, isBigFolder, skippedText, takenRoots, freeName, buildFolders, folderIdOf, cleanFolderName, isHiddenName, progressLabel, hasDirectory, BIG_FOLDER} from '../app/library-folder-upload.mjs';
import {trackUpload, uploadJobs, summaryText} from '../app/upload-progress.js';

const file = (name, size = 3) => ({name, size});
// 흉내 FileSystemEntry: readEntries는 크롬처럼 나눠 준다(한 번에 2개).
function dir(name, children) {
  return {isDirectory: true, isFile: false, name, createReader() { let i = 0; return {readEntries(ok) { const part = children.slice(i, i + 2); i += part.length; ok(part); }}; }};
}
const ent = (name, size = 3) => ({isDirectory: false, isFile: true, name, file(ok) { ok(file(name, size)); }});

test('놓은 폴더: 하위 폴더 2단·파일 5개·숨김 1개·빈 파일 1개 → 구조 그대로, 숨김·빈 파일은 건너뜀', async () => {
  const tree = dir('교섭', [dir('2026', [dir('회의', [ent('a.hwp'), ent('b.pdf')]), ent('c.txt')]), ent('d.xlsx'), ent('.DS_Store'), ent('빈.txt', 0), ent('e.pdf'), dir('.git', [ent('config')])]);
  assert.equal(hasDirectory([tree]), true);
  const read = await readDroppedEntries([tree, ent('따로.pdf')]);
  const plan = planFolderUpload(read);
  assert.deepEqual(plan.roots, ['교섭']);
  assert.deepEqual(plan.dirs, [['교섭'], ['교섭', '2026'], ['교섭', '2026', '회의']]);
  assert.deepEqual(plan.files.map(x => [x.dir.join('/'), x.file.name]), [['교섭/2026/회의', 'a.hwp'], ['교섭/2026/회의', 'b.pdf'], ['교섭/2026', 'c.txt'], ['교섭', 'd.xlsx'], ['교섭', 'e.pdf'], ['', '따로.pdf']]);
  assert.deepEqual(plan.skipped, {hidden: 1, empty: 1});
  assert.equal(skippedText(plan), '숨김·빈 파일 2개는 건너뛰었어요');
  assert.equal(plan.depth, 3);
  assert.equal(progressLabel(plan, 3), '교섭 · 3/6');
});

test('고른 폴더(webkitRelativePath): 같은 구조, 숨김 폴더 안은 건너뜀', () => {
  const f = (path, size = 2) => ({name: path.split('/').pop(), size, webkitRelativePath: path});
  const plan = planFolderUpload(readPickedFiles([f('교섭/2026/a.hwp'), f('교섭/b.pdf'), f('교섭/Thumbs.db'), f('교섭/desktop.ini'), f('교섭/.git/HEAD')]));
  assert.deepEqual(plan.dirs, [['교섭'], ['교섭', '2026']]);
  assert.deepEqual(plan.files.map(x => x.file.name), ['a.hwp', 'b.pdf']);
  assert.equal(plan.skipped.hidden, 2);
});

test('이름 규칙: 40자·앞뒤 빈칸·제어 문자, 숨김 이름', () => {
  assert.equal(cleanFolderName('  가\u0007나  '), '가 나');
  assert.equal([...cleanFolderName('가'.repeat(50))].length, 40);
  assert.equal(cleanFolderName('   '), '폴더');
  for (const n of ['.DS_Store', 'Thumbs.db', 'DESKTOP.INI', '.hidden']) assert.equal(isHiddenName(n), true);
  assert.equal(isHiddenName('보고서.hwp'), false);
});

test('너무 큰 폴더(500개·2GB 넘음)는 묻는다', () => {
  assert.equal(isBigFolder({count: BIG_FOLDER.files, bytes: 1}), false);
  assert.equal(isBigFolder({count: BIG_FOLDER.files + 1, bytes: 1}), true);
  assert.equal(isBigFolder({count: 2, bytes: BIG_FOLDER.bytes + 1}), true);
});

const plan2 = () => planFolderUpload({dirs: [['교섭'], ['교섭', '2026'], ['교섭', '새']], files: [], hidden: 0});
function maker() {
  const calls = []; let n = 0;
  return {calls, create: async ({parentId, projectId, name}) => { calls.push({parentId, projectId, name}); return {id: 'n' + (++n)}; }};
}

test('합치기: 같은 자리 같은 이름 폴더(안쪽도)는 다시 쓰고 없는 것만 만든다', async () => {
  const folders = [{id: 'k', parent_id: 'p', name: '교섭', project_id: 'area-1'}, {id: 'k6', parent_id: 'k', name: '2026', project_id: 'area-1'}, {id: 'p', parent_id: null, name: '위', project_id: 'area-1'}];
  assert.deepEqual(takenRoots(plan2(), folders, 'p'), ['교섭']);
  assert.deepEqual(takenRoots(plan2(), folders, null), []);
  const m = maker();
  const r = await buildFolders(plan2(), {folders, parentId: 'p', mode: 'merge', create: m.create});
  assert.deepEqual(m.calls, [{parentId: 'k', projectId: 'area-1', name: '새'}]); // 위 폴더의 사업영역을 그대로
  assert.equal(r.made, 1);
  assert.equal(folderIdOf(r.ids, ['교섭', '2026'], 'p'), 'k6');
  assert.equal(folderIdOf(r.ids, [], 'p'), 'p');
});

test('새로 만들기: 맨 위는 겹치지 않는 이름, 안쪽은 모두 새로', async () => {
  const folders = [{id: 'k', parent_id: null, name: '교섭'}, {id: 'k2', parent_id: null, name: '교섭 (2)'}, {id: 'k6', parent_id: 'k', name: '2026'}];
  assert.equal(freeName('교섭', folders.map(f => f.name)), '교섭 (3)');
  assert.equal([...freeName('가'.repeat(40), ['가'.repeat(40)])].length, 40);
  const m = maker();
  const r = await buildFolders(plan2(), {folders, parentId: null, mode: 'new', create: m.create});
  assert.deepEqual(m.calls.map(c => [c.parentId, c.name]), [[null, '교섭 (3)'], ['n1', '2026'], ['n1', '새']]);
  assert.equal(r.made, 3);
});

test('폴더 만들기가 실패하면 그 아래는 만들지 않고 실패로 돌려준다', async () => {
  const r = await buildFolders(plan2(), {folders: [], create: async () => null});
  assert.equal(r.made, 0); assert.equal(r.failed.length, 3);
});

test('진행 글: 같은 묶음 이름이면 합계 줄이 \'교섭 · n/전체 올리는 중\'', () => {
  const a = trackUpload({name: 'a.hwp', size: 100, label: '교섭 · 2/5'});
  const text = summaryText(uploadJobs().filter(j => j === a));
  assert.match(text, /^교섭 · 2\/5 올리는 중 · /);
  const b = trackUpload({name: 'b.pdf', size: 100});
  assert.match(summaryText(uploadJobs().filter(j => j === a || j === b)), /^올리는 중 2개 · /);
  a.done(); b.done();
});
