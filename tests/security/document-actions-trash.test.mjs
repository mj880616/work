import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness } from '../fixtures/document-actions-harness.mjs';

const drive = calls => calls.filter(c => c.path.includes('googleapis.com/drive/v3/files/'));
const recordDeletes = calls => calls.filter(c => c.method === 'DELETE' && c.path.includes('/rest/v1/'));

test('moves Drive file to trash before removing the library record, with no Drive DELETE', async () => {
  const h = harness();
  assert.equal((await h.send()).status, 200);
  assert.deepEqual(drive(h.calls).map(c => c.method), ['GET', 'PATCH']);
  assert.deepEqual(JSON.parse(drive(h.calls)[1].body), { trashed: true });
  assert.equal(drive(h.calls).filter(c => c.method === 'DELETE').length, 0);
  assert.equal(recordDeletes(h.calls).length, 2);
  assert.ok(h.calls.indexOf(drive(h.calls)[1]) < h.calls.indexOf(recordDeletes(h.calls)[0]));
});

test('failed trash move leaves the library record and returns an error', async () => {
  const h = harness({ patchStatus: 503 });
  const result = await h.send();
  assert.equal(result.status, 400);
  assert.match(result.body.error, /휴지통 이동에 실패/);
  assert.equal(recordDeletes(h.calls).length, 0);
  assert.equal(drive(h.calls).filter(c => c.method === 'DELETE').length, 0);
});

test('already trashed file removes only the library record', async () => {
  const h = harness({ trashed: true });
  assert.equal((await h.send()).status, 200);
  assert.deepEqual(drive(h.calls).map(c => c.method), ['GET']);
  assert.equal(recordDeletes(h.calls).length, 2);
});

test('missing Drive file at lookup removes the library record without Drive DELETE', async () => {
  const h = harness({ getStatus: 404 });
  assert.equal((await h.send()).status, 200);
  assert.deepEqual(drive(h.calls).map(c => c.method), ['GET']);
  assert.equal(drive(h.calls).filter(c => c.method === 'DELETE').length, 0);
  assert.equal(recordDeletes(h.calls).length, 2);
});

test('missing Drive file at trash move removes the library record', async () => {
  const h = harness({ patchStatus: 404 });
  assert.equal((await h.send()).status, 200);
  assert.deepEqual(drive(h.calls).map(c => c.method), ['GET', 'PATCH']);
  assert.equal(recordDeletes(h.calls).length, 2);
});

for (const getStatus of [500, 403]) test(`Drive lookup ${getStatus} leaves the library record`, async () => {
  const h = harness({ getStatus });
  const result = await h.send();
  assert.equal(result.status, 400);
  assert.match(result.body.error, /상태를 확인하지 못했습니다/);
  assert.equal(recordDeletes(h.calls).length, 0);
});

test('non-owner cannot touch Drive or remove a record', async () => {
  const h = harness({ role: 'member' });
  assert.equal((await h.send()).status, 400);
  assert.equal(drive(h.calls).length, 0);
  assert.equal(recordDeletes(h.calls).length, 0);
});

test('active library delete entry point explains the Drive trash retention period', () => {
  const code = readFileSync(new URL('../../app/library-upload.js', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('../../app/document-delete.js', import.meta.url), 'utf8');
  assert.match(code, /import\('\.\/document-delete\.js\?v=\d+'\)/);
  assert.match(code, /await helper\.deleteDocument\(d,/);
  assert.match(shared, /Drive 휴지통으로 이동합니다\. Drive 휴지통에서 30일 안에 복구할 수 있습니다\./);
});
