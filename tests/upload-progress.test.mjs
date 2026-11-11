// UI-올리기진행표시(S52-15): 보낸 양은 XMLHttpRequest upload.onprogress의 실제 값만 쓰고, 다 보내기 전 ✕·끊김은 '받지 못함',
// 다 보낸 뒤 답이 없으면 '결과 불명'(다시 보내지 않음)으로 나눈다. 올리는 중 목록은 끝없이 돌지 않고 '느려요'가 된다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sendUpload, percent, amount} from '../app/upload-send.mjs';
import {trackUpload, uploadJobs, summaryText, uploadTotals, setUploadClock, checkSlow, setUploadRetry, isUploading, announceDock, SLOW_SENDING_MS, SLOW_FINISH_MS} from '../app/upload-progress.js';

// 흉내 XMLHttpRequest: 시험이 보낸 양·끝을 직접 일으킨다.
function fakeXhr() {
  const made = [];
  class X {
    constructor() { this.upload = {}; this.headers = {}; made.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(body) { this.body = body; }
    abort() { this.aborted = true; this.onabort?.(); }
    sent(loaded, total) { this.upload.onprogress?.({lengthComputable: true, loaded, total}); }
    reply(status, text) { this.upload.onload?.(); this.status = status; this.responseText = text; this.onload?.(); }
  }
  return {X, made};
}

test('보낸 양은 upload.onprogress의 실제 값이고, 다 보내면 마무리 중(finishing)이 된다', async () => {
  const {X, made} = fakeXhr(), seen = [];
  const run = sendUpload('https://x/functions/v1/basket-files', {headers: {Authorization: 'Bearer t'}, body: 'b', size: 1000, Xhr: X, onProgress: p => seen.push(p)});
  const x = made[0];
  assert.equal(x.method, 'POST'); assert.equal(x.headers.Authorization, 'Bearer t'); assert.ok(x.timeout >= 90000, '시간 한도는 upload-budget.mjs');
  x.sent(250, 1000); x.sent(600, 1000); x.sent(1000, 1000); x.reply(200, '{"ok":true}');
  const r = await run;
  assert.deepEqual(r, {ok: true, status: 200, text: '{"ok":true}'});
  assert.deepEqual(seen.map(p => [p.loaded, p.phase]), [[0, 'sending'], [250, 'sending'], [600, 'sending'], [1000, 'finishing'], [1000, 'finishing']]);
});

test('다 보내기 전 ✕는 upload_cancelled, 끊김은 upload_not_sent, 다 보낸 뒤 끊김은 결과 불명', async () => {
  let {X, made} = fakeXhr();
  const c = new AbortController();
  const a = sendUpload('u', {body: 'b', size: 100, Xhr: X, signal: c.signal});
  made[0].sent(10, 100); c.abort();
  await assert.rejects(a, e => e.code === 'upload_cancelled' && made[0].aborted);
  ({X, made} = fakeXhr());
  const b = sendUpload('u', {body: 'b', size: 100, Xhr: X});
  made[0].sent(40, 100); made[0].onerror();
  await assert.rejects(b, e => e.code === 'upload_not_sent');
  ({X, made} = fakeXhr());
  const d = sendUpload('u', {body: 'b', size: 100, Xhr: X});
  made[0].sent(100, 100); made[0].onerror();
  await assert.rejects(d, e => e.code === 'note_save_result_unknown', '서버가 이미 받았을 수 있음 — 다시 보내지 않는다');
  ({X, made} = fakeXhr());
  const c2 = new AbortController();
  const f = sendUpload('u', {body: 'b', size: 100, Xhr: X, signal: c2.signal});
  made[0].sent(100, 100); c2.abort();
  assert.ok(!made[0].aborted, '다 보낸 뒤 ✕는 끊지 않는다'); made[0].reply(200, '{}');
  assert.equal((await f).status, 200);
});

test('%는 내림(다 보내기 전 100% 없음), 양은 KB·MB', () => {
  assert.equal(percent(999, 1000), 99); assert.equal(percent(1000, 1000), 100); assert.equal(percent(5, 0), 0);
  assert.equal(amount(3.4 * 1048576), '3.4MB'); assert.equal(amount(2048), '2KB');
});

test('올리는 중 목록: 합계 줄·완료 1초·실패 [다시]·느려요(끝없이 돌지 않음)', async () => {
  let t = 0; setUploadClock(() => t);
  const f1 = {name: 'a.pdf', size: 1000}, f2 = {name: 'b.jpg', size: 3000, type: 'image/jpeg'};
  const j1 = trackUpload({file: f1}), j2 = trackUpload({file: f2});
  j1.progress({loaded: 500, total: 1000}); j2.progress({loaded: 1000, total: 3000});
  assert.equal(summaryText(uploadJobs()), '올리는 중 2개 · 1KB / 4KB · 37%');
  t += SLOW_SENDING_MS + 1; j1.progress({loaded: 600, total: 1000}); checkSlow();
  assert.equal(j1.slow, false); assert.equal(j2.slow, true, '보낸 양이 20초 그대로면 느려요');
  j2.keepWaiting(); assert.equal(j2.slow, false); checkSlow(); assert.equal(j2.slow, false, '계속 기다리기');
  j2.progress({loaded: 3000, total: 3000, phase: 'finishing'});
  t += SLOW_FINISH_MS + 1; checkSlow(); assert.equal(j2.slow, true, '마무리가 45초를 넘으면 느려요');
  j1.cancel(); assert.ok(!isUploading(f1) && j1.signal.aborted, '✕ = 보내기 멈춤 + 목록에서 빠짐');
  j2.fail('연결이 끊겼어요');
  assert.ok(setUploadRetry(f2, () => {}), '실패한 그 파일에 [다시]');
  assert.equal(typeof uploadJobs().find(j => j.file === f2).retry, 'function');
  uploadJobs().find(j => j.file === f2).cancel(); // 실패 표시 닫기
  const j3 = trackUpload({file: {name: 'c', size: 1}}); j3.done();
  assert.equal(j3.phase, 'done');
  await new Promise(r => setTimeout(r, 1100));
  assert.equal(uploadJobs().length, 0, '완료는 1초 뒤 빠진다');
});

// BIZ-저장먼저닫기(S58-1): 뒤 줄에 선 한 묶음은 차례를 기다리는 파일도 처음부터 목록에 있고('대기'), 묶음의 %는 이미 올린 양을 더해 끝까지 한 방향으로 오른다.
test('뒤 줄 한 묶음: 대기 파일도 합계에 들고, 하단 한 줄의 %는 파일이 끝나도 0으로 돌아가지 않는다 · 대기는 느려요가 되지 않는다 · 대기 ✕는 보내지 않음', async () => {
  for (const job of uploadJobs()) job.cancel();
  let t = 0; setUploadClock(() => t);
  const group = {sent: 0};
  const files = [{name: 'p1.jpg', size: 1024, type: 'image/jpeg'}, {name: 'p2.jpg', size: 1024, type: 'image/jpeg'}, {name: 'a.hwp', size: 2048}];
  const [j1, j2, j3] = files.map(file => trackUpload({file, waiting: true, group}));
  assert.deepEqual([j1.phase, j2.phase, j3.phase], ['waiting', 'waiting', 'waiting']);
  assert.equal(summaryText(uploadJobs()), '올리는 중 3개 · 0B / 4KB · 0%');
  t += SLOW_SENDING_MS * 3; checkSlow();
  assert.deepEqual([j1.slow, j2.slow], [false, false], '차례를 기다리는 파일은 느려요가 아니다');
  j1.start(); assert.equal(j1.phase, 'sending');
  j1.progress({loaded: 1024, total: 1024}); j1.done();
  assert.equal(group.sent, 1024);
  // 하단 한 줄의 양: 끝난 파일의 양이 묶음에 남아 %가 이어진다(1024/4096 = 25%). 칸의 합계 줄은 그 칸에 남은 것만 센다.
  const live = () => uploadJobs().filter(job => job.phase !== 'done');
  assert.deepEqual(uploadTotals(live()), {total: 4096, loaded: 1024});
  assert.equal(summaryText(uploadJobs()), '올리는 중 2개 · 0B / 3KB · 0%');
  j2.progress({loaded: 512, total: 1024}); // 첫 progress가 대기를 보내는 중으로 바꾼다
  assert.equal(j2.phase, 'sending');
  assert.deepEqual(uploadTotals(live()), {total: 4096, loaded: 1536});
  assert.equal(summaryText(uploadJobs()), '올리는 중 2개 · 512B / 3KB · 16%');
  j3.cancel();
  assert.ok(j3.cancelled() && !isUploading(files[2]), '대기 ✕ = 보내지 않고 목록에서 빠짐');
  j2.fail('연결이 끊겼어요');
  assert.equal(summaryText(uploadJobs()), '', '살아 있는 것이 없으면 합계 줄이 없다');
  for (const job of uploadJobs()) job.cancel();
  await new Promise(r => setTimeout(r, 1100));
  assert.equal(uploadJobs().length, 0);
});

test('한 줄 끝 알림(announceDock)은 화면이 없으면 아무것도 하지 않고, 글이 없으면 만들지 않는다', () => {
  assert.equal(typeof announceDock({text: ''}).close, 'function');
  const note = announceDock({text: '사진 1장 올렸어요', ms: 0});
  note.close(); note.close();
});

test('올리는 길: basket-files는 공용 보내기(upload-send.mjs)와 표시(upload-progress.js)를 쓰고 fetch로 직접 보내지 않는다', () => {
  const src = readFileSync('app/basket-upload.js', 'utf8');
  assert.match(src, /from '\.\/upload-send\.mjs'/);
  assert.match(src, /sendUpload\(rt\.config\.url \+ '\/functions\/v1\/basket-files'/);
  assert.doesNotMatch(src, /await fetcher\(rt\.config\.url/);
  for (const name of ['ed-editor.js', 'diary.js', 'note-window.js']) assert.match(readFileSync('app/' + name, 'utf8'), /from '\.\/upload-progress\.js'/, name);
  // 기기 저장 없음은 browser-storage-audit(CI)가 본다.
});
