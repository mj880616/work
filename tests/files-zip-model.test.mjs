// S52-44 ⑤ FILES-관리자마무리: 여러 개 받기(zip) 계획 — 파일만·상한·같은 이름 번호·zip 이름. 화면·네트워크 없음. 파일 이름은 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ZIP_MAX_FILES, ZIP_MAX_BYTES, zipPlan, zipName, zipDoneText} from '../app/files-zip-model.mjs';
import {readZip} from '../app/weekly-hwpx/zip.mjs';
import {writeZip} from '../app/weekly-hwpx/zip.mjs';

const f = (name, size = 10, extra = {}) => ({name, size_bytes: size, is_folder: false, ...extra});
test('파일만 묶고 폴더 수는 따로, 같은 이름은 번호', () => {
  const p = zipPlan([f('가짜.pdf'), f('가짜.pdf'), {name: '폴더', is_folder: true}, f('메모.txt')]);
  assert.equal(p.ok, true);
  assert.deepEqual(p.names, ['가짜.pdf', '가짜 (2).pdf', '메모.txt']);
  assert.equal(p.folders, 1);
  assert.equal(p.total, 30);
  assert.match(zipDoneText(3, 1), /폴더 1개는 뺐어요/);
});
test('상한: 파일 없음·개수·크기', () => {
  assert.equal(zipPlan([{name: 'x', is_folder: true}]).ok, false);
  assert.equal(zipPlan(Array.from({length: ZIP_MAX_FILES + 1}, (_, i) => f(`a${i}.txt`))).ok, false);
  assert.equal(zipPlan(Array.from({length: ZIP_MAX_FILES}, (_, i) => f(`a${i}.txt`))).ok, true);
  assert.equal(zipPlan([f('큰.mp4', ZIP_MAX_BYTES + 1)]).ok, false);
});
test('zip 이름: 폴더 이름 또는 파일 n개 + 날짜, 쓸 수 없는 글자는 빈칸', () => {
  const now = new Date(2026, 10, 8);
  assert.equal(zipName([f('a'), f('b')], '가짜 문서함', now), '가짜 문서함 11-08.zip');
  assert.equal(zipName([f('a'), f('b')], '', now), '파일 2개 11-08.zip');
  assert.equal(zipName([f('a')], 'a/b:c', now), 'a b c 11-08.zip');
});
test('담기(압축 없음)로 만든 zip을 다시 읽으면 같은 이름·바이트', () => {
  const enc = new TextEncoder();
  const out = writeZip([{name: '가짜.txt', data: enc.encode('하나'), store: true}, {name: '가짜 (2).txt', data: enc.encode('둘'), store: true}]);
  const back = readZip(out, {inflateRaw: () => { throw new Error('압축 없음'); }});
  assert.deepEqual(back.map(e => e.name), ['가짜.txt', '가짜 (2).txt']);
  assert.equal(new TextDecoder().decode(back[1].data), '둘');
});
