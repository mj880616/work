import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {within, isLoadTimeout, onResume, LoadTimeout} from '../app/load-deadline.js';
import {slotImg, SLOT_IMG_MS} from '../app/img-slot.js';
// LOAD-끝있는불러오기(S51-29): 모든 불러오기는 끝이 있다(공용 도우미 한 곳).
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('within: 시간 안이면 그 값, 넘으면 LoadTimeout + 요청 끊기', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  assert.equal(await within(Promise.resolve(7), 100), 7);
  let signal = null;
  const p = within(s => { signal = s; return new Promise(() => {}); }, 100);
  t.mock.timers.tick(100);
  await assert.rejects(p, e => e instanceof LoadTimeout && isLoadTimeout(e) && e.ms === 100);
  assert.equal(signal.aborted, true);
  // 실패는 그대로 넘긴다.
  await assert.rejects(within(Promise.reject(new Error('x')), 100), /x/);
});

test('onResume: 다시 보이면 부르고, 1초 안 겹침은 한 번', () => {
  const ls = {};
  const doc = {visibilityState: 'visible', addEventListener: (t, f) => { ls[t] = f; }, removeEventListener: () => {}};
  const win = {addEventListener: (t, f) => { ls[t] = f; }, removeEventListener: () => {}};
  let n = 0;
  onResume(() => n++, {doc, win});
  ls.visibilitychange(); ls.visibilitychange();
  assert.equal(n, 1);
  ls.pageshow({persisted: false});
  assert.equal(n, 1);
});

test('slotImg: 답 없는 그림은 SLOT_IMG_MS 뒤 못 받음(↻), lazy는 재지 않음', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const mk = () => {
    const box = {dataset: {}, children: [], classList: {add() {}}, append(c) { this.children.push(c); }, querySelector: () => null, closest: () => null};
    const img = {removeAttribute() {}, complete: false};
    return {box, img};
  };
  let failed = 0;
  const a = mk();
  slotImg(a.box, a.img, 'x', {onFailed: () => failed++});
  t.mock.timers.tick(SLOT_IMG_MS);
  assert.equal(failed, 1);
  assert.equal(a.box.dataset.imgState, 'failed');
  const b = mk(); b.img.loading = 'lazy';
  slotImg(b.box, b.img, 'x', {onFailed: () => failed++});
  t.mock.timers.tick(SLOT_IMG_MS);
  assert.equal(failed, 1);
  const c = mk();
  slotImg(c.box, c.img, 'x', {onFailed: () => failed++});
  c.img.onload();
  t.mock.timers.tick(SLOT_IMG_MS);
  assert.equal(failed, 1);
});

test('전수: 시간 한도 없던 불러오기가 공용 도우미를 쓴다', () => {
  assert.match(read('app/phone-photos.js'), /within\(job, PHONE_READ_MS\)/);
  assert.match(read('app/phone-files.js'), /within\(signal => win\.fetch\(url\(what, q\)/);
  assert.match(read('app/diary-onedrive.js'), /PHOTO_BYTES_MS\)\.catch/);
  assert.match(read('app/gdrive-photos.js'), /body\.action === 'thumb' \? within\(job, BYTES_MS\)/);
  assert.match(read('app/files.js'), /body\.action === 'thumb' \? within\(job, BYTES_MS\)/);
  assert.match(read('app/team.js'), /await within\(job,API_MS\)/);
  assert.match(read('app/runtime-client.js'), /const data=await dataWithin\(r,timeoutMs\)/);
  // S53-3: 출처마다 따로(함께 받기) 한 걸음 LOAD_STEP_MS 안에 끝난다.
  assert.match(read('app/photos.js'), /return within\(job, LOAD_STEP_MS\)\.then\(/);
  assert.match(read('app/photos.js'), /run:\(\) => loadStream\(name, alive\)/);
  assert.match(read('app/news-clipping.js'), /state\.foldersFailed \? failHtml/);
});
