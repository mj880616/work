// UX-먼저묻고뒤에처리(11/09): 사업 보고 창에 놓은 파일의 뒤처리 줄(app/meeting-drop-queue.mjs).
// 순서 = 올리기 → 본문 읽기 → 결과 칸 더하기, 놓은 사업 보고 값으로 끝까지, 처리 중에 또 놓으면 줄 끝, 실패는 그 단계만 [다시].
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDropQueue} from '../app/meeting-drop-queue.mjs';

const f = name => ({name});
function harness({failUpload = new Set(), failAppend = 0, text = '본문'} = {}) {
  const log = [], events = [];
  let appendFails = failAppend;
  const q = createDropQueue({
    ready: async () => true,
    upload: async (m, file) => { await new Promise(r => setTimeout(r, 2)); log.push(`up:${m.id}:${file.name}`); if (failUpload.has(file.name)) { failUpload.delete(file.name); throw new Error('네트워크'); } },
    read: async files => { log.push(`read:${files.map(x => x.name).join(',')}`); return text; },
    append: async (m, t) => { log.push(`add:${m.id}:${t}`); if (appendFails > 0) { appendFails--; return false; } return true; },
    report: e => events.push(e),
  });
  return {q, log, events};
}

test('순서: 올리기 → 본문 읽기 → 결과 칸 더하기, 놓은 사업 보고 id로', async () => {
  const {q, log, events} = harness();
  q.add({id: 'm1'}, [f('결과.hwp'), f('자료.pdf')], [f('결과.hwp')]);
  await q.idle();
  assert.deepEqual(log, ['up:m1:결과.hwp', 'up:m1:자료.pdf', 'read:결과.hwp', 'add:m1:본문']);
  const done = events.find(e => e.type === 'done');
  assert.equal(done.sent, 2); assert.equal(done.failed, 0); assert.equal(done.text, 'added');
});

test('처리 중에 또 놓으면 줄 끝에 선다(거절 없음), 한 묶음씩 차례로', async () => {
  const {q, log, events} = harness();
  q.add({id: 'm1'}, [f('a.pdf')], []);
  q.add({id: 'm2'}, [f('b.pdf')], [f('b.pdf')]);
  assert.equal(events.filter(e => e.type === 'queued')[1].ahead, 1);
  await q.idle();
  assert.deepEqual(log, ['up:m1:a.pdf', 'up:m2:b.pdf', 'read:b.pdf', 'add:m2:본문']);
});

test('[파일만]이면 읽지도 더하지도 않고, 못 읽은 본문은 파일만 붙음', async () => {
  let h = harness();
  h.q.add({id: 'm1'}, [f('결과.pdf')], []);
  await h.q.idle();
  assert.deepEqual(h.log, ['up:m1:결과.pdf']);
  assert.equal(h.events.find(e => e.type === 'done').text, 'none');
  h = harness({text: ''});
  h.q.add({id: 'm1'}, [f('결과.pdf')], [f('결과.pdf')]);
  await h.q.idle();
  assert.deepEqual(h.log, ['up:m1:결과.pdf', 'read:결과.pdf']);
  assert.equal(h.events.find(e => e.type === 'done').text, 'unread');
});

test('실패는 그 단계만 [다시]: 올린 파일은 다시 올리지 않고, 못 더한 본문은 다시 더함', async () => {
  const {q, log, events} = harness({failUpload: new Set(['b.pdf']), failAppend: 1});
  const job = q.add({id: 'm1'}, [f('a.pdf'), f('b.pdf')], [f('a.pdf')]);
  await q.idle();
  let done = events.filter(e => e.type === 'done').at(-1);
  assert.equal(done.sent, 1); assert.equal(done.failed, 1); assert.equal(done.text, 'failed');
  assert.equal(q.retry(job), true);
  await q.idle();
  done = events.filter(e => e.type === 'done').at(-1);
  assert.equal(done.sent, 2); assert.equal(done.failed, 0); assert.equal(done.text, 'added');
  assert.deepEqual(log, ['up:m1:a.pdf', 'up:m1:b.pdf', 'read:a.pdf', 'add:m1:본문', 'up:m1:b.pdf', 'read:a.pdf', 'add:m1:본문']);
  assert.equal(q.retry(job), false, '다 끝난 묶음은 다시 하지 않음');
});

test('자료실 준비를 못 하면 멈추고 알림, [다시]로 처음부터', async () => {
  let ok = false; const log = [], events = [];
  const q = createDropQueue({ready: async () => ok, upload: async (m, file) => log.push(file.name), read: async () => '', append: async () => true, report: e => events.push(e)});
  const job = q.add({id: 'm1'}, [f('a.pdf')], []);
  await q.idle();
  assert.ok(events.some(e => e.type === 'blocked')); assert.deepEqual(log, []);
  ok = true; assert.equal(q.retry(job), true); await q.idle();
  assert.deepEqual(log, ['a.pdf']);
});
