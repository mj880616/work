import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// BUG-노트HTML표시: memo and note read views draw .html attachments through one shared painter (html-frame.js).
import {htmlAttachments} from '../app/html-frame.js';

test('only .html/.htm attachments with a Drive file id are shown as frames, in order', () => {
  const files = [
    {drive_file_id: 'a', file_name: 'chatgpt-20261018-0900.html'},
    {drive_file_id: 'b', file_name: '회의록.hwp'},
    {drive_file_id: 'c', file_name: 'OLD.HTM'},
    {drive_file_id: '', file_name: 'empty.html'},
    {file_name: 'missing-id.html'},
    null,
    {drive_file_id: 'd', file_name: 'page.html.txt'},
  ];
  assert.deepEqual(htmlAttachments(files).map(file => file.drive_file_id), ['a', 'c']);
  assert.deepEqual(htmlAttachments(undefined), []);
  assert.deepEqual(htmlAttachments('x'), []);
});

test('memo and note read views share the painter instead of copying it', () => {
  const read = name => readFileSync(new URL(`../app/${name}`, import.meta.url), 'utf8');
  for (const name of ['basket.js', 'basket-notes.js']) {
    const source = read(name);
    assert.match(source, /import \{[^}]*\bpaintHtmlAttachments\b[^}]*\} from '\.\/html-frame\.js';/, name);
    assert.doesNotMatch(source, /openBasketHtml|mountHtmlFrame|frameDocument/, `${name} must not build frames itself`);
  }
  const frame = read('html-frame.js');
  assert.match(frame, /setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.match(frame, /action: 'html-view'/);
});

// PRESS-자료실편입 2단계: 자료실 .html은 같은 html-view에 document_id로 요청하고, 아직 모르는 서버의 거절은 notReady 안내가 된다.
import {openLibraryHtml, HTML_FRAME_TEXT} from '../app/html-frame.js';
const fakeRt = {session: {ensure: async () => true, read: () => ({access_token: 't'})}, config: {url: 'https://sb.example', key: 'k'}};
const answer = (status, data) => async (url, init) => { answer.last = {url, body: JSON.parse(init.body)}; return new Response(JSON.stringify(data), {status}); };

test('library html: asks html-view with document_id only and returns the html', async () => {
  const r = await openLibraryHtml('doc-1', {rt: fakeRt, fetcher: answer(200, {ok: true, file_name: 'a.html', html: '<p>본문</p>'})});
  assert.deepEqual(r, {html: '<p>본문</p>', fileName: 'a.html'});
  assert.equal(answer.last.url, 'https://sb.example/functions/v1/document-actions');
  assert.deepEqual(answer.last.body, {action: 'html-view', document_id: 'doc-1'});
});

test('library html: the server that still allows only basket attachments → notReady (Drive 안내)', async () => {
  for (const [status, data] of [[400, {error: '바구니 메모의 첨부만 화면으로 볼 수 있습니다.', code: 'INVALID_REQUEST'}], [404, {}], [400, {error: 'Unknown action'}]]) {
    await assert.rejects(openLibraryHtml('doc-1', {rt: fakeRt, fetcher: answer(status, data)}), err => err.kind === 'notReady' && err.message === HTML_FRAME_TEXT.notReady);
  }
  await assert.rejects(openLibraryHtml('doc-1', {rt: fakeRt, fetcher: answer(401, {})}), err => err.kind === 'session');
  await assert.rejects(openLibraryHtml('doc-1', {rt: fakeRt, fetcher: answer(400, {code: 'FILE_TOO_LARGE'})}), err => err.kind === 'tooLarge');
  await assert.rejects(openLibraryHtml('doc-1', {rt: fakeRt, fetcher: answer(400, {error: '자료를 찾을 수 없습니다.', code: 'DOCUMENT_NOT_FOUND'})}), err => err.kind === 'failed' && /자료를 찾을 수 없습니다/.test(err.message));
});
