// LIB-연결줄다읽기(11/24): 서버가 1000줄에서 자르므로 자료·폴더 연결 줄과 자료 목록을 이어 읽는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readLibraryFolderItems} from '../app/library-folder-data.js';
import {readDocuments} from '../app/report-list-read.js';

const pager = (total, field = 'document_id') => {
  const calls = [];
  const api = async url => {
    calls.push(url);
    const q = new URL('http://x' + url).searchParams;
    const limit = Number(q.get('limit')), offset = Number(q.get('offset'));
    return Array.from({length: Math.max(0, Math.min(limit, total - offset))}, (_, i) => ({[field]: 'd' + (offset + i), folder_id: 'f'}));
  };
  return {api, calls};
};

test('readLibraryFolderItems: 2500줄을 1000줄씩 세 번에 모두 읽는다', async () => {
  const {api, calls} = pager(2500);
  const rows = await readLibraryFolderItems(api, 'w1');
  assert.equal(rows.length, 2500);
  assert.equal(calls.length, 3);
  assert.match(calls[0], /order=document_id\.asc&limit=1000&offset=0/);
  assert.match(calls[2], /offset=2000/);
});

test('readLibraryFolderItems: 딱 1000줄이면 한 번 더 물어 빈 줄로 끝낸다', async () => {
  const {api, calls} = pager(1000);
  assert.equal((await readLibraryFolderItems(api, 'w1')).length, 1000);
  assert.equal(calls.length, 2);
});

test('readDocuments: 1000개 넘는 자료도 모두 읽고, 순서는 id로 끊김 없이', async () => {
  const {api, calls} = pager(2363, 'id');
  const rows = await readDocuments(api, 'w1');
  assert.equal(rows.length, 2363);
  assert.equal(new Set(rows.map(r => r.id)).size, 2363);
  assert.match(calls[0], /order=document_date\.desc\.nullslast,created_at\.desc,id\.asc&limit=1000&offset=0/);
});

test('readDocuments: 열이 거절되면 select=*로 바꿔 이어 읽는다', async () => {
  let n = 0;
  const api = async url => { n++; if (n === 1) throw Object.assign(new Error('column'), {status: 400}); assert.match(url, /select=\*/); return []; };
  assert.deepEqual(await readDocuments(api, 'w1'), []);
});
