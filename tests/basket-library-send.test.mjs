import test from 'node:test';
import assert from 'node:assert/strict';
import { librarySendOutcome, sendAttachmentToLibrary, LIBRARY_SEND_TEXT, requestLibraryDocument, takeLibraryDocumentRequest } from '../app/basket-library-send.js';

test('created and exists need a well-formed server answer', () => {
  assert.deepEqual(librarySendOutcome({ data: { ok: true, result: 'created', document: { id: 'd1', title: 't' } } }), { kind: 'created', message: LIBRARY_SEND_TEXT.created, document: { id: 'd1', title: 't' } });
  assert.equal(librarySendOutcome({ data: { ok: true, result: 'exists', document: { id: 'd1' } } }).kind, 'exists');
  for (const data of [null, {}, { ok: true }, { ok: true, result: 'created' }, { ok: true, result: 'created', document: { id: '' } }, { ok: true, result: 'other', document: { id: 'd' } }, { ok: false, error: 'x' }, []])
    assert.equal(librarySendOutcome({ data }).kind, 'unknown', JSON.stringify(data));
});

test('400 refusals changed nothing; an older server reads as not ready', () => {
  assert.deepEqual(librarySendOutcome({ error: { status: 400, message: 'document_id가 필요합니다.' } }), { kind: 'refused', message: LIBRARY_SEND_TEXT.notReady });
  assert.deepEqual(librarySendOutcome({ error: { status: 400, message: 'Unknown action' } }), { kind: 'refused', message: LIBRARY_SEND_TEXT.notReady });
  assert.equal(librarySendOutcome({ error: { status: 400, message: 'Drive 원본이 휴지통에 있어 보내지 않았습니다.' } }).message, LIBRARY_SEND_TEXT.refused + ' Drive 원본이 휴지통에 있어 보내지 않았습니다.');
  for (const status of [403, 404, 405]) assert.equal(librarySendOutcome({ error: { status } }).kind, 'refused');
  assert.equal(librarySendOutcome({ error: { status: 401 } }).kind, 'session');
  assert.equal(librarySendOutcome({ error: { code: 'session_required' } }).kind, 'session');
});

test('timeouts, lost responses and 5xx are unknown results', () => {
  for (const error of [{ status: 0 }, { status: 503 }, { status: 500 }, { status: 502 }, { status: 504 }, new Error('network'), {}])
    assert.equal(librarySendOutcome({ error }).kind, 'unknown', JSON.stringify(error));
});

test('one POST with only the note and file, no session refresh, no resend', async () => {
  const calls = [];
  const rt = { api: async (path, options) => { calls.push({ path, options }); throw Object.assign(new Error('x'), { status: 503 }); } };
  const r = await sendAttachmentToLibrary('n1', 'f1', { rt, expectedSessionEpoch: 4 });
  assert.equal(r.kind, 'unknown');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/functions/v1/document-actions');
  assert.deepEqual(calls[0].options, { method: 'POST', body: { action: 'register-basket-attachment', note_id: 'n1', drive_file_id: 'f1' }, refreshSession: false, singleFlight: false, expectedSessionEpoch: 4 });
});

test('the library hand-off is one-shot and bound to the same user and workspace', () => {
  const ctx = { user: { id: 'u1' }, workspace: { id: 'w1' } };
  const rt = { context: { read: () => ctx } };
  requestLibraryDocument('d1', rt);
  assert.equal(takeLibraryDocumentRequest(rt), 'd1');
  assert.equal(takeLibraryDocumentRequest(rt), null);
  requestLibraryDocument('d2', rt);
  assert.equal(takeLibraryDocumentRequest({ context: { read: () => ({ user: { id: 'u1' }, workspace: { id: 'w2' } }) } }), null);
  assert.equal(takeLibraryDocumentRequest(rt), null);
  requestLibraryDocument('', rt);
  assert.equal(takeLibraryDocumentRequest(rt), null);
  requestLibraryDocument('d3', { context: { read: () => null } });
  assert.equal(takeLibraryDocumentRequest(rt), null);
});
