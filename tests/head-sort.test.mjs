import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextSort, ariaSort, arrowOf, naturalCompare, headCellHtml, sortValue, parseSortValue, sortOptions, cleanSort, firstDir} from '../app/head-sort.mjs';
import {sortRows, SORTS, SORT_KEYS, SORT_DESC_FIRST} from '../app/files-model.mjs';
// UI-머리눌러정렬(사용자 11/24 15:47): 머리 칸 누르기 = 그 칸 정렬, 다시 누르면 반대. 공용 규칙과 [파일] 정렬 계산.

test('누르면 그 칸(처음 방향), 같은 칸을 다시 누르면 반대 방향', () => {
  assert.deepEqual(SORT_DESC_FIRST, [], '[파일]은 모든 칸이 처음엔 오름차순');
  const d = {descFirst: ['modified', 'size']};
  assert.deepEqual(nextSort(null, 'name', d), {key: 'name', dir: 'asc'});
  assert.deepEqual(nextSort({key: 'name', dir: 'asc'}, 'name', d), {key: 'name', dir: 'desc'});
  assert.deepEqual(nextSort({key: 'name', dir: 'desc'}, 'name', d), {key: 'name', dir: 'asc'});
  assert.deepEqual(nextSort({key: 'name', dir: 'asc'}, 'modified', d), {key: 'modified', dir: 'desc'}, '날짜는 최근 먼저로 시작');
  assert.deepEqual(nextSort({key: 'modified', dir: 'desc'}, 'modified', d), {key: 'modified', dir: 'asc'});
  assert.deepEqual(nextSort({key: 'size', dir: 'asc'}, 'kind', d), {key: 'kind', dir: 'asc'});
  assert.equal(firstDir('size', ['size']), 'desc'); assert.equal(firstDir('size', SORT_DESC_FIRST), 'asc');
});

test('머리 칸: 지금 기준 칸만 ▲/▼·aria-sort, 나머지는 none. 손잡이는 버튼 밖', () => {
  const cur = {key: 'size', dir: 'desc'};
  assert.equal(ariaSort(cur, 'size'), 'descending'); assert.equal(ariaSort({key: 'size', dir: 'asc'}, 'size'), 'ascending');
  assert.equal(ariaSort(cur, 'name'), 'none'); assert.equal(ariaSort(null, 'name'), 'none');
  assert.equal(arrowOf('desc'), '▼'); assert.equal(arrowOf('asc'), '▲');
  const on = headCellHtml({key: 'size', label: '크기', cur, extra: '<i data-col-grip="size"></i>'});
  assert.match(on, /role="columnheader" aria-sort="descending"/);
  assert.match(on, /<button type="button" class="row-act hs-btn" data-head-sort="size"[^>]*>크기<i class="hs-arrow" aria-hidden="true">▼<\/i><\/button><i data-col-grip="size"><\/i><\/span>$/);
  const off = headCellHtml({key: 'name', label: '이름', cur});
  assert.match(off, /aria-sort="none"/); assert.match(off, /<i class="hs-arrow" aria-hidden="true"><\/i>/);
  assert.doesNotMatch(headCellHtml({key: 'x', label: '<b>', cur}), /<b>/, '글자는 이스케이프');
});

test('정렬 고르기 값은 칸과 방향을 함께 담아 머리 칸과 같은 값', () => {
  assert.equal(sortValue({key: 'name', dir: 'desc'}), 'name:desc');
  assert.deepEqual(parseSortValue('size:asc', SORTS), {key: 'size', dir: 'asc'});
  for (const v of ['', 'size', 'size:up', 'path:asc', null]) assert.equal(parseSortValue(v, SORTS), null, String(v));
  assert.deepEqual(parseSortValue('path:asc', SORT_KEYS), {key: 'path', dir: 'asc'});
  assert.deepEqual(sortOptions(['name', 'modified'], {name: '이름', modified: '바뀐 날'}, {descFirst: ['modified']}).map(o => o.value + ' ' + o.label),
    ['name:asc 이름 ▲', 'name:desc 이름 ▼', 'modified:desc 바뀐 날 ▼', 'modified:asc 바뀐 날 ▲']);
  assert.deepEqual(cleanSort({key: 'kind', dir: 'desc'}, SORTS), {key: 'kind', dir: 'desc'});
  for (const v of [null, {}, {key: 'path', dir: 'asc'}, {key: 'name', dir: 'asc', x: 1}, 'name']) assert.equal(cleanSort(v, SORTS), null, JSON.stringify(v));
});

test('[파일] 정렬: 폴더는 늘 위, 이름은 한국어·숫자 자연 정렬, 종류·위치도 정렬', () => {
  assert.ok(naturalCompare('가짜 2', '가짜 10') < 0); assert.ok(naturalCompare('가', '나') < 0);
  const rows = [
    {item_id: 'a', name: '가짜 10.pdf', mime: 'application/pdf', size_bytes: 10, modified_at: '2026-10-01T00:00:00Z', source: 'od', folder_path: '나 폴더'},
    {item_id: 'b', name: '가짜 2.txt', mime: 'text/plain', size_bytes: 30, modified_at: '2026-10-03T00:00:00Z', source: 'od', folder_path: '가 폴더'},
    {item_id: 'c', name: '나중 폴더', is_folder: true, size_bytes: null, source: 'od'},
    {item_id: 'd', name: '가짜 사진.jpg', mime: 'image/jpeg', size_bytes: 20, modified_at: '2026-10-02T00:00:00Z', source: 'gd', folder_path: ''},
    {item_id: 'e', name: '가나 폴더', is_folder: true, size_bytes: null, source: 'od'},
  ];
  const ids = (key, dir) => sortRows(rows, key, dir).map(r => r.item_id).join('');
  assert.equal(ids('name', 'asc'), 'ecbad'); assert.equal(ids('name', 'desc'), 'cedab');
  assert.equal(ids('size', 'asc'), 'ecadb'); assert.equal(ids('size', 'desc'), 'ecbda');
  assert.equal(ids('modified', 'desc'), 'ecbda'); assert.equal(ids('modified', 'asc'), 'ecadb');
  // 종류 이름 가나다(문서·사진·PDF… 글자는 files-model KIND) — 오름·내림이 정확히 거꾸로(폴더는 위 그대로).
  const kAsc = ids('kind', 'asc').slice(2), kDesc = ids('kind', 'desc').slice(2);
  assert.equal([...kAsc].reverse().join(''), kDesc); assert.equal(ids('kind', 'asc').slice(0, 2), 'ec');
  // 위치: 원드라이브 › 가 폴더 < 원드라이브 › 나 폴더, 구글 드라이브는 출처 이름 순.
  const pAsc = ids('path', 'asc').slice(2);
  assert.ok(pAsc.indexOf('b') < pAsc.indexOf('a'));
});
