// S52-44 ④ FILES-관리자마무리: 찾기 거르기(이 폴더/전체 · 종류 · 날짜 · 크기) 계산. 화면·네트워크 없음. 파일 이름·위치는 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {freshFilter, filterSet, filterOn, dimLabel, baseOf, inFolder, findFilter} from '../app/files-find-model.mjs';

const NOW = Date.parse('2026-10-06T01:00:00Z');
const r = (name, o = {}) => ({source: 'od', name, is_folder: false, size_bytes: 1000, modified_at: '2026-10-05T00:00:00Z', folder_path: '', ...o});
const ROWS = [
  r('가짜 문서.pdf', {folder_path: '가짜 문서함'}),
  r('가짜 계획.hwpx', {folder_path: '가짜 문서함 › 가짜 2026', modified_at: '2026-08-01T00:00:00Z'}),
  r('가짜 문서함 사본.txt', {folder_path: '가짜 문서함 사본'}), // 이름만 비슷한 다른 폴더
  r('가짜 현장.jpg', {folder_path: '가짜 사진함', size_bytes: 20 * 1024 * 1024}),
  r('가짜 2026', {folder_path: '가짜 문서함', is_folder: true, size_bytes: null}),
  r('가짜 결과.pdf', {source: 'gd', folder_path: '가짜 문서함'}),
];
test('이 폴더: 그 폴더와 안 폴더만(이름이 비슷한 옆 폴더·다른 저장소는 빠짐), 맨 위면 그 저장소 전체', () => {
  const base = {source: 'od', path: baseOf(['원드라이브', '가짜 문서함'])};
  assert.equal(base.path, '가짜 문서함');
  const names = findFilter(ROWS, filterSet(freshFilter(), 'scope', 'here'), {base, now: NOW}).map(x => x.name);
  assert.deepEqual(names, ['가짜 문서.pdf', '가짜 계획.hwpx', '가짜 2026']);
  assert.equal(findFilter(ROWS, {scope: 'here'}, {base: {source: 'od', path: ''}, now: NOW}).length, 5);
  assert.equal(inFolder(ROWS[0], null), true);
  assert.equal(findFilter(ROWS, freshFilter(), {now: NOW}).length, ROWS.length, '전체는 그대로');
});
test('종류·날짜·크기(폴더는 크기 거르기에서 빠짐), 모르는 값은 그대로', () => {
  const f = (o) => findFilter(ROWS, {...freshFilter(), ...o}, {now: NOW}).map(x => x.name);
  assert.deepEqual(f({kind: 'doc'}), ['가짜 문서.pdf', '가짜 계획.hwpx', '가짜 문서함 사본.txt', '가짜 결과.pdf']);
  assert.deepEqual(f({kind: 'folder'}), ['가짜 2026']);
  assert.deepEqual(f({kind: 'image'}), ['가짜 현장.jpg']);
  assert.equal(f({day: '7'}).includes('가짜 계획.hwpx'), false);
  assert.equal(f({day: '365'}).includes('가짜 계획.hwpx'), true);
  assert.deepEqual(f({size: '10'}), ['가짜 현장.jpg']);
  assert.deepEqual(filterSet(freshFilter(), 'kind', 'zip'), freshFilter());
  assert.deepEqual(filterSet(freshFilter(), 'nope', 'all'), freshFilter());
});
test('칩 글자·켬 표시', () => {
  assert.equal(dimLabel(freshFilter(), 'kind'), '종류');
  assert.equal(dimLabel(filterSet(freshFilter(), 'kind', 'image'), 'kind'), '사진');
  assert.equal(filterOn(freshFilter()), false);
  assert.equal(filterOn(filterSet(freshFilter(), 'size', '1')), true);
  assert.equal(filterOn(filterSet(freshFilter(), 'scope', 'here')), false, '찾을 곳은 거르기 켬이 아님');
});
