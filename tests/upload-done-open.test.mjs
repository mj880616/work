// UX-올림보기그자료(S64-12, 요청함 11/17 09:13·10:16): 홈 › 주간 보고 [확정하고 한글 파일 받기] 뒤 하단 한 줄 '1개 올림 [보기]'를 누르면
// 홈 하루가 아니라 자료실에서 그 자료가 열려야 한다. 자료 id는 서버 답이 와야 알 수 있으므로 끝(done)에서 [보기] 자리를 정한다.
// 시험 데이터는 모두 합성(이름 없음).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const calls = [];
const scope = {user: {id: 'u-1'}, workspace: {id: 'w-1'}};
globalThis.window = {
  KPTURouter: {current: 'home', sub: null, go: async (view, options) => { calls.push([view, options?.source || '']); }},
  KPTULibrary: {reveal: id => calls.push(['reveal', id])},
  addEventListener() {}, dispatchEvent() { return true; },
};
const {trackUpload, uploadJobs} = await import('../app/upload-progress.js');
const {openInLibrary} = await import('../app/upload-done.js');
const {takeLibraryDocumentRequest} = await import('../app/basket-library-send.js');
const drive = await import('../app/hwp-drive.js');

const rt = {
  config: {url: 'https://x.test', key: 'k'},
  session: {ensure: async () => true, read: () => ({access_token: 't'})},
  context: {read: () => scope},
  api: async () => { throw new Error('no categories in this test'); },
};
window.KPTURuntime = rt;
const lastJob = () => uploadJobs().at(-1);
const settle = () => new Promise(r => setTimeout(r, 0));

test('done({back})는 시작한 화면 대신 끝에서 정한 곳으로, 시작할 때 부른 곳이 정한 back은 그대로', async () => {
  calls.length = 0;
  const plain = trackUpload({name: 'a.hwp', size: 1});
  const opened = [];
  plain.done({back: () => opened.push('doc')});
  plain.back();
  assert.deepEqual(opened, ['doc']);
  assert.deepEqual(calls, [], '시작한 화면(홈)으로 가지 않는다');
  const own = trackUpload({name: 'b.hwp', size: 1, back: () => opened.push('report')});
  own.done({back: () => opened.push('doc')});
  own.back();
  assert.deepEqual(opened, ['doc', 'report'], '사업 보고 묶음처럼 시작할 때 정한 곳은 바꾸지 않는다');
  const none = trackUpload({name: 'c.hwp', size: 1});
  none.done();
  none.back();
  assert.deepEqual(calls, [['home', 'upload']], 'back을 주지 않은 끝은 지금처럼 시작한 화면');
});

test('주간 보고 확정(library-files 새 자료): [보기] = 자료실에서 그 자료(홈 하루가 아님)', async () => {
  calls.length = 0;
  globalThis.fetch = async () => ({ok: true, status: 200, text: async () => JSON.stringify({ok: true, document: {id: 'doc-7', title: '합성 주간보고'}})});
  const out = await drive.saveWeeklyReport(new Uint8Array([1, 2]), {fileName: '합성.hwp', title: '합성', documentDate: '2026-11-16'}, {rt});
  assert.equal(out.kind, 'created');
  const job = lastJob();
  assert.equal(job.phase, 'done');
  job.back(); await settle();
  assert.deepEqual(calls, [['library', 'delegated']]);
  assert.equal(takeLibraryDocumentRequest(rt), 'doc-7', '자료실이 목록을 읽은 뒤 그 자료 줄을 보여 준다');
});

test('같은 주 다시 확정(파일 교체)·노조 서식·자료실 덮어쓰기도 그 자료, 바구니 첨부는 시작한 화면', async () => {
  globalThis.fetch = async () => ({ok: true, status: 200, text: async () => JSON.stringify({ok: true, document: {id: 'doc-8', title: '합성'}})});
  calls.length = 0;
  await drive.replaceWeeklyReport(new Uint8Array([1]), {fileName: '합성.hwp', documentId: 'doc-8'}, {rt});
  lastJob().back(); await settle();
  assert.deepEqual(calls, [['library', 'delegated']]); assert.equal(takeLibraryDocumentRequest(rt), 'doc-8');

  calls.length = 0;
  await drive.saveUnionForm(new File([new Uint8Array([1])], '합성 서식.hwp'), {}, {rt});
  lastJob().back(); await settle();
  assert.equal(takeLibraryDocumentRequest(rt), 'doc-8');

  calls.length = 0;
  globalThis.fetch = async () => ({ok: true, status: 200, text: async () => JSON.stringify({ok: true, result: 'overwritten', revision: 'r', md5: 'm', backup: {name: 'b'}})});
  await drive.overwriteHwp({kind: 'library', document: {id: 'doc-9'}}, new Uint8Array([1]), {revision: 'r0', md5: 'm0'}, {rt});
  lastJob().back(); await settle();
  assert.deepEqual(calls, [['library', 'delegated']]); assert.equal(takeLibraryDocumentRequest(rt), 'doc-9');

  calls.length = 0;
  globalThis.fetch = async () => ({ok: true, status: 200, text: async () => JSON.stringify({ok: true, note_id: 'n-1', attachments: []})});
  await drive.saveBasketCopy({noteId: 'n-1', fileName: '합성.hwp'}, new Uint8Array([1]), {rt});
  lastJob().back(); await settle();
  assert.deepEqual(calls, [['home', 'upload']], '바구니 첨부는 자료실 자료가 아니다 — 지금처럼 시작한 화면');
  assert.equal(takeLibraryDocumentRequest(rt), null);
});

test('저장이 거절되면 [보기]는 그대로(새 자료 없음)', async () => {
  calls.length = 0;
  globalThis.fetch = async () => ({ok: false, status: 400, text: async () => JSON.stringify({error: 'bad'})});
  await drive.saveWeeklyReport(new Uint8Array([1]), {fileName: '합성.hwp', title: '합성'}, {rt});
  assert.equal(lastJob().phase, 'failed');
});

test('이미 자료실이면 그 자리에서 보여 주고, 자료실 올리기 끝도 같은 길(openInLibrary)', async () => {
  calls.length = 0;
  window.KPTURouter.current = 'library';
  await openInLibrary('doc-1');
  assert.deepEqual(calls, [['reveal', 'doc-1']]);
  window.KPTURouter.current = 'home';
  const lib = readFileSync(new URL('../app/library-upload.js', import.meta.url), 'utf8');
  assert.match(lib, /shown\.done\(savedId\?\{back:\(\)=>\{void openInLibrary\(savedId\)/);
});
