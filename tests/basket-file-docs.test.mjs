import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENT_CATEGORIES, categoryOf, categoryOptions, categoryTag } from '../app/document-categories.js';
import { readAttachmentDocuments, putFilesIntoProject, FILE_DOCS_TEXT } from '../app/basket-file-docs.js';

globalThis.window ??= new EventTarget();
globalThis.CustomEvent ??= class extends Event { constructor(type, init) { super(type); this.detail = init?.detail; } };
const changes = [];
window.addEventListener('kptu:documents-changed', e => changes.push(e.detail));

test('B1: stored categories are shown as one of the seven, without changing the stored value', () => {
  assert.deepEqual(DOCUMENT_CATEGORIES, ['교섭','투쟁','교육','선전','정책','회의','기타']);
  const table = {교섭자료:'교섭',교육자료:'교육',보도자료:'선전',취재요청:'선전','성명·논평':'선전','선전·언론자료':'선전',국회자료:'정책',정부자료:'정책','토론회·발제자료':'정책',회의자료:'회의',회의결과:'회의'};
  for (const [stored, shown] of Object.entries(table)) assert.equal(categoryOf(stored), shown, stored);
  for (const name of DOCUMENT_CATEGORIES) assert.equal(categoryOf(name), name);
  // A typed value that starts with one of the seven names reads as that category; anything else is 기타.
  assert.equal(categoryOf('정책자료'), '정책');
  for (const value of ['현장자료', '', null, undefined, '  ']) assert.equal(categoryOf(value), '기타', String(value));
});

test('the form lists the seven names, preselecting the match of an old value; upload can stay automatic', () => {
  const options = categoryOptions('정부자료');
  assert.equal((options.match(/<option /g) || []).length, 7);
  assert.match(options, /<option value="정책" selected>정책<\/option>/);
  const upload = categoryOptions('', { empty: '자동 분류' });
  assert.match(upload, /^<option value="" selected>자동 분류<\/option>/);
  assert.equal(categoryTag('교섭자료'), '<span class="doc-category-tag" data-doc-category="교섭">교섭</span>');
});

function runtime(handler) {
  const calls = [];
  return { calls, rt: { context: { read: () => ({ user: { id: 'u' }, workspace: { id: 'w' } }) }, api: async (path, options = {}) => { calls.push({ path, options }); return handler(path, options); } } };
}
const files = [{ drive_file_id: 'drive-a', file_name: 'a.hwp' }, { drive_file_id: 'drive-b', file_name: 'b.pdf' }];

test('the library read asks only for these Drive files in this workspace', async () => {
  const { rt, calls } = runtime(() => [{ id: 'd1', file_id: 'drive-a', project_id: 'p0', title: 'a' }, { id: 'd2', file_id: 'drive-a', project_id: null }, { id: 'x', file_id: 'other' }]);
  const found = await readAttachmentDocuments([...files, { drive_file_id: 'bad id/..' }], { rt });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/rest/v1/app_documents?workspace_id=eq.w&file_id=in.(drive-a,drive-b)&select=id,title,project_id,file_id,category&order=created_at.asc');
  assert.deepEqual([...found], [['drive-a', { id: 'd1', title: 'a', project_id: 'p0' }]]);
});

test('a file not yet in the library is registered once, then each document is moved to the project', async () => {
  const { rt, calls } = runtime((path, options) => {
    if (path === '/functions/v1/document-actions') return { ok: true, result: 'created', document: { id: 'd-b', title: 'b' } };
    const id = /id=eq\.([^&]+)/.exec(path)[1];
    return [{ id, project_id: options.body.project_id, file_id: 'x' }];
  });
  const known = new Map([['drive-a', { id: 'd-a', project_id: 'old' }]]);
  const result = await putFilesIntoProject({ noteId: 'n1', files, projectId: 'p1', known, rt, expectedSessionEpoch: 3 });
  assert.equal(result.ok, true); assert.equal(result.placed, 2);
  assert.deepEqual(calls.map(c => [c.options.method, c.path.split('?')[0]]), [['PATCH', '/rest/v1/app_documents'], ['POST', '/functions/v1/document-actions'], ['PATCH', '/rest/v1/app_documents']]);
  assert.deepEqual(calls[0].options.body.project_id, 'p1');
  assert.equal(calls[0].path, '/rest/v1/app_documents?id=eq.d-a&workspace_id=eq.w&select=id,project_id,file_id');
  assert.deepEqual(calls[1].options.body, { action: 'register-basket-attachment', note_id: 'n1', drive_file_id: 'drive-b' });
  assert.deepEqual([...result.docs.keys()], ['drive-a', 'drive-b']);
  // One library change for the new document, one for the project move.
  assert.deepEqual(changes.splice(0), [{ project_id: null, meeting_id: null }, { project_id: 'p1' }]);
});

test('a document already in the project is not written again', async () => {
  const { rt, calls } = runtime(() => { throw new Error('no call expected'); });
  const known = new Map([['drive-a', { id: 'd-a', project_id: 'p1' }], ['drive-b', { id: 'd-b', project_id: 'p1' }]]);
  const result = await putFilesIntoProject({ noteId: 'n1', files, projectId: 'p1', known, rt });
  assert.equal(result.ok, true); assert.equal(calls.length, 0); assert.deepEqual(changes.splice(0), []);
});

test('an unknown send or update stops there and is never retried; a 4xx update is a refusal', async () => {
  let r = await putFilesIntoProject({ noteId: 'n1', files, projectId: 'p1', rt: runtime(() => { throw Object.assign(new Error('x'), { status: 503 }); }).rt });
  assert.deepEqual([r.ok, r.kind, r.message, r.placed], [false, 'unknown', FILE_DOCS_TEXT.unknown, 0]);
  const known = new Map([['drive-a', { id: 'd-a', project_id: null }]]);
  const lost = runtime(() => { throw Object.assign(new Error('x'), { status: 0 }); });
  r = await putFilesIntoProject({ noteId: 'n1', files, projectId: 'p1', known, rt: lost.rt });
  assert.equal(r.kind, 'unknown'); assert.equal(lost.calls.length, 1);
  r = await putFilesIntoProject({ noteId: 'n1', files, projectId: 'p1', known, rt: runtime(() => { throw Object.assign(new Error('x'), { status: 403 }); }).rt });
  assert.deepEqual([r.kind, r.message], ['refused', FILE_DOCS_TEXT.refused]);
  // A write that answers with another project is not trusted.
  r = await putFilesIntoProject({ noteId: 'n1', files, projectId: 'p1', known, rt: runtime(() => [{ id: 'd-a', project_id: 'p2' }]).rt });
  assert.equal(r.kind, 'unknown');
});

test('a result after an account switch is dropped', async () => {
  let current = true;
  const { rt } = runtime(path => { current = false; return path.startsWith('/functions') ? { ok: true, result: 'created', document: { id: 'd' } } : []; });
  const r = await putFilesIntoProject({ noteId: 'n1', files, projectId: 'p1', rt, isCurrent: () => current });
  assert.equal(r.kind, 'stale');
});
