// S70 LIB-묶음삭제: document-actions 'delete-many'(여러 자료 한 요청) — 같은 owner 검사·같은 지우기 순서,
// 드라이브에서 가져온(연결만 한) 원본은 Drive를 건드리지 않음, 다른 작업공간 자료 거절, Drive 연결 문제면 남은 것 멈춤.
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../fixtures/document-actions-harness.mjs';

const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const made = (n, ws = 'ws-1') => ({ id: uid(n), workspace_id: ws, file_id: `file-${n}`, classification_note: '파일명 기반 자동분류' });
const linked = (n, note = '드라이브에서 가져옴 · 파일명 기반 자동분류') => ({ id: uid(n), workspace_id: 'ws-1', file_id: `file-${n}`, classification_note: note });
const byId = docs => Object.fromEntries(docs.map(d => [d.id, d]));
const drivePatches = calls => calls.filter(c => c.path.includes('googleapis.com/drive/v3/files/') && c.method === 'PATCH');
const docDeletes = calls => calls.filter(c => c.method === 'DELETE' && c.path.includes('/rest/v1/app_documents'));
const send = (h, ids) => h.send({ action: 'delete-many', document_id: undefined, document_ids: ids });

test('delete-many removes every listed own document in one request and trashes only app-made Drive files', async () => {
  const docs = [made(1), made(2), linked(3), linked(4, '드라이브 정리 대기에서 등록 · 파일명 기반 자동분류'), made(5)];
  const h = harness({ docsById: byId(docs), fileIds: docs.map(d => d.file_id) });
  const r = await send(h, docs.map(d => d.id));
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.stopped, false);
  assert.deepEqual(r.body.results.map(x => x.ok), [true, true, true, true, true]);
  assert.deepEqual(r.body.results.filter(x => x.reason === 'linked_original').map(x => x.id), [uid(3), uid(4)]);
  for (const x of r.body.results.filter(x => x.reason === 'linked_original')) { assert.equal(x.drive_result, 'preserved'); assert.equal(x.drive_preserved, true); }
  // 연결만 한 원본(file-3·file-4)에는 Drive 요청이 하나도 없다. 앱이 만든 파일만 휴지통.
  const touched = h.calls.filter(c => c.path.includes('googleapis.com/drive/v3/files/')).map(c => decodeURIComponent(new URL(c.path).pathname.split('/').at(-1)));
  assert.ok(!touched.includes('file-3') && !touched.includes('file-4'));
  assert.deepEqual(drivePatches(h.calls).map(c => new URL(c.path).pathname.split('/').at(-1)).sort(), ['file-1', 'file-2', 'file-5']);
  assert.equal(docDeletes(h.calls).length, 5);
  // Drive 토큰은 한 요청에서 한 번만 받는다.
  assert.equal(h.calls.filter(c => new URL(c.path).pathname === '/token').length, 1);
});

test('delete-many refuses another workspace document without touching it', async () => {
  const docs = [made(1), made(2, 'ws-other')];
  const h = harness({ docsById: byId(docs), fileIds: docs.map(d => d.file_id) });
  const r = await send(h, docs.map(d => d.id));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results.map(x => [x.id, x.ok, x.code || null]), [[uid(1), true, null], [uid(2), false, 'FORBIDDEN']]);
  assert.ok(!docDeletes(h.calls).some(c => c.path.includes(uid(2))));
  assert.ok(!drivePatches(h.calls).some(c => c.path.includes('file-2')));
});

test('delete-many needs an owner workspace and a clean id list', async () => {
  const docs = [made(1)];
  const none = harness({ docsById: byId(docs), owned: [] });
  const r = await send(none, [uid(1)]);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'FORBIDDEN');
  assert.equal(docDeletes(none.calls).length, 0);
  for (const bad of [[], 'x', [uid(1), uid(1)], ['../x'], Array.from({ length: 51 }, (_, i) => uid(i + 1))]) {
    const h = harness({ docsById: byId(docs) });
    const res = await send(h, bad);
    assert.equal(res.status, 400, JSON.stringify(bad).slice(0, 40));
    assert.equal(res.body.code, 'INVALID_REQUEST');
    assert.equal(docDeletes(h.calls).length, 0);
  }
});

test('delete-many stops the rest when the Drive connection is gone, but still drops linked originals that need no Drive', async () => {
  const docs = [made(1), made(2), made(3)];
  const h = harness({ docsById: byId(docs), fileIds: docs.map(d => d.file_id), driveConnections: {} });
  const r = await send(h, docs.map(d => d.id));
  assert.equal(r.status, 200);
  assert.equal(r.body.stopped, true);
  assert.ok(r.body.results.every(x => !x.ok && ['DRIVE_AUTH', 'SKIPPED'].includes(x.code)));
  assert.equal(docDeletes(h.calls).length, 0);
  const keep = harness({ docsById: byId([linked(7)]), driveConnections: {} });
  const k = await send(keep, [uid(7)]);
  assert.deepEqual(k.body.results.map(x => [x.ok, x.reason]), [[true, 'linked_original']]);
  assert.equal(keep.calls.filter(c => c.path.includes('googleapis.com')).length, 0);
});

test('single delete keeps a Drive-imported original in Drive too', async () => {
  const h = harness({ docsById: byId([linked(9)]), fileIds: ['file-9'] });
  const r = await h.send({ document_id: uid(9) });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.drive_result, r.body.drive_preserved, r.body.reason], ['preserved', true, 'linked_original']);
  assert.equal(drivePatches(h.calls).length, 0);
});
