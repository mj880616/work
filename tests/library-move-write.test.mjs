import test from 'node:test';
import assert from 'node:assert/strict';
import {writeMoves, undoMoves, MOVE_CHUNK} from '../app/library-move-write.mjs';
// LIB-끌어옮기기저장실패(S69): 여러 개 옮기기 쓰기(1000줄 이어 읽기는 #2979 tests/library-folder-items-paging.test.mjs). 서버는 가짜(폴더 연결 표 하나), 이름은 지어낸 것.

// 가짜 서버: 연결 표(document_id 하나에 한 줄). POST 배열은 전부 또는 전무(겹치면 409·23505).
function fakeServer(items, {failPatchIn = false} = {}) {
  const s = {items: new Map(items.map(x => [x.document_id, x.folder_id])), calls: []};
  const ids = q => (q.get('document_id') || '').replace(/^in\.\(|\)$/g, '').split(',').map(decodeURIComponent);
  s.api = async (path, {method = 'GET', body = null} = {}) => {
    const u = new URL('http://x' + path), q = u.searchParams; s.calls.push(`${method} ${q.get('document_id')?.startsWith('in.') ? 'in' : 'one'}`);
    const guard = q.get('folder_id')?.replace(/^eq\./, '');
    const pick = () => (q.get('document_id').startsWith('in.') ? ids(q) : [q.get('document_id').replace(/^eq\./, '')]).filter(id => s.items.has(id) && (!guard || s.items.get(id) === guard));
    if (method === 'GET') return pick().map(id => ({document_id: id, folder_id: s.items.get(id)}));
    if (method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      if (rows.some(r => s.items.has(r.document_id))) throw Object.assign(new Error('duplicate key value violates unique constraint "app_library_folder_items_pkey"'), {status: 409});
      for (const r of rows) s.items.set(r.document_id, r.folder_id);
      return null;
    }
    if (method === 'PATCH') { if (failPatchIn && q.get('document_id').startsWith('in.')) throw Object.assign(new Error('fail'), {status: 500}); const hit = pick(); for (const id of hit) s.items.set(id, body.folder_id); return hit.map(id => ({document_id: id})); }
    if (method === 'DELETE') { const hit = pick(); for (const id of hit) s.items.delete(id); return hit.map(id => ({document_id: id})); }
    throw new Error('?');
  };
  return s;
}

test('여러 개 옮기기: 100개씩 한 요청, 화면이 몰랐던 연결 줄(잡동사니에 이미 든 자료)도 옮기고 그 자리를 되돌리기용으로 기억', async () => {
  // 559개 중 300개는 화면이 '폴더 밖'으로 알지만 실제로는 잡동사니(junk)에 들어 있다(읽기가 잘렸던 경우).
  const hidden = Array.from({length: 300}, (_, i) => ({document_id: 'h' + i, folder_id: 'junk'}));
  const srv = fakeServer(hidden);
  const prev = [...hidden.map(x => ({id: x.document_id, had: false, folder: null})), ...Array.from({length: 259}, (_, i) => ({id: 'o' + i, had: false, folder: null}))];
  const seen = [];
  const r = await writeMoves({api: srv.api, ws: 'w', prev, folderId: 'f1', onProgress: p => seen.push(p.index)});
  assert.equal(r.done.length, 559);
  assert.equal(r.failed.length, 0);
  assert.ok([...srv.items.values()].every(f => f === 'f1'));
  assert.equal(seen.at(-1), 559);
  // 몰랐던 줄은 지금 폴더(잡동사니)를 기억 → 되돌리면 잡동사니로, 원래 폴더 밖이던 것은 다시 폴더 밖.
  assert.equal(prev.find(p => p.id === 'h0').folder, 'junk');
  const back = await undoMoves({api: srv.api, ws: 'w', moved: prev, folderId: 'f1'});
  assert.equal(back, 559);
  assert.equal(srv.items.get('h0'), 'junk');
  assert.equal(srv.items.has('o0'), false);
});

test('이미 아는 연결 줄은 묶음 PATCH 한 번 · 묶음이 거절되면 그 묶음만 하나씩 · 폴더 밖으로는 DELETE 묶음', async () => {
  const items = Array.from({length: 150}, (_, i) => ({document_id: 'a' + i, folder_id: 'junk'}));
  const srv = fakeServer(items);
  const prev = items.map(x => ({id: x.document_id, had: true, folder: 'junk'}));
  const r = await writeMoves({api: srv.api, ws: 'w', prev, folderId: 'f2'});
  assert.equal(r.done.length, 150);
  assert.deepEqual(srv.calls, ['PATCH in', 'PATCH in']);
  const out = await writeMoves({api: srv.api, ws: 'w', prev: prev.map(p => ({...p, folder: 'f2'})), folderId: null});
  assert.equal(out.done.length, 150);
  assert.equal(srv.items.size, 0);
  // 묶음 PATCH가 거절되면 하나씩 다시 — 하나만 막히면 그것만 실패로 남는다.
  const srv2 = fakeServer(items, {failPatchIn: true});
  const base = srv2.api;
  srv2.api = async (path, o = {}) => { if (o.method === 'PATCH' && path.includes('a7&')) throw Object.assign(new Error('new row violates row-level security policy'), {status: 403}); return base(path, o); };
  const r2 = await writeMoves({api: srv2.api, ws: 'w', prev: items.map(x => ({id: x.document_id, had: true, folder: 'junk'})), folderId: 'f3'});
  assert.equal(r2.failed.length, 1);
  assert.equal(r2.done.length, 149);
  assert.match(r2.firstError.message, /row-level security/);
  assert.equal(MOVE_CHUNK, 100);
});

test('all(사진 묶음): 하나라도 막히면 나머지는 시도하지 않는다', async () => {
  const srv = fakeServer([]);
  const base = srv.api;
  srv.api = async (path, o = {}) => { if (o.method === 'POST') throw Object.assign(new Error('fail'), {status: 500}); return base(path, o); };
  const r = await writeMoves({api: srv.api, ws: 'w', prev: [{id: 'p1', had: false}, {id: 'p2', had: false}], folderId: 'f', all: true});
  assert.equal(r.done.length, 0);
  assert.deepEqual(r.failed.sort(), ['p1', 'p2']);
});

test('겹침인데 읽은 줄에 그 묶음 자료가 없으면 같은 묶음을 되풀이하지 않고 하나씩', async () => {
  const srv = fakeServer([{document_id: 'x0', folder_id: 'junk'}]);
  const base = srv.api;
  let posts = 0;
  srv.api = async (path, o = {}) => {
    if ((o.method || 'GET') === 'GET') return [{document_id: 'other', folder_id: 'junk'}]; // 엉뚱한 줄만 돌려주는 서버
    if (o.method === 'POST') posts++;
    return base(path, o);
  };
  const prev = ['x0', 'x1', 'x2'].map(id => ({id, had: false}));
  const r = await writeMoves({api: srv.api, ws: 'w', prev, folderId: 'f'});
  assert.ok(posts < 10);
  // 하나씩: x1·x2는 넣고, 겹친 x0는 한 줄 읽기 뒤 옮긴다.
  assert.deepEqual(r.done.sort(), ['x0', 'x1', 'x2']);
  assert.deepEqual(r.failed, []);
  assert.equal(srv.items.get('x0'), 'f');
});
