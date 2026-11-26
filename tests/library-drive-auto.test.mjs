import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveAuto, addedLine, changedLine, GAP_MS, PATH } from '../app/library-drive-auto.mjs';

// S70-73 LIB-드라이브자동등록: 자료실을 열 때 서버에 한 번 부탁, 새로 들어온 게 있을 때만 목록 다시 읽기·한 줄.
function harness(answers) {
  const calls = [], added = [];
  let t = 1000;
  const api = async (path, opts) => { calls.push({ path, body: opts.body }); const a = answers.shift(); if (a instanceof Error) throw a; return a; };
  const auto = createDriveAuto({ api, onAdded: (n, m) => { added.push(m ? [n, m] : n); }, now: () => t });
  return { auto, calls, added, tick: ms => { t += ms; } };
}

test('새 자료가 있으면 onAdded(n), 없으면 조용히', async () => {
  const h = harness([{ ok: true, added: 3 }, { ok: true, added: 0 }]);
  assert.equal(await h.auto.start('k'), 3);
  assert.deepEqual(h.calls, [{ path: PATH, body: { action: 'drive-auto' } }]);
  assert.deepEqual(h.added, [3]);
  h.tick(GAP_MS + 1);
  assert.equal(await h.auto.start('k'), 0);
  assert.deepEqual(h.added, [3]);
});

test('같은 로그인에서 GAP_MS 안에는 다시 부르지 않음, 다른 로그인은 부름', async () => {
  const h = harness([{ ok: true, added: 0 }, { ok: true, added: 0 }]);
  await h.auto.start('k');
  assert.equal(h.auto.start('k'), null);
  await h.auto.start('k2');
  assert.equal(h.calls.length, 2);
});

test('실패는 조용히, 권한·자료실 폴더 없음이면 이 로그인 동안 다시 부르지 않음', async () => {
  const h = harness([new Error('net'), { ok: true, added: 0, code: 'scope_missing' }]);
  assert.equal(await h.auto.start('a'), 0);
  assert.equal(await h.auto.start('b'), 0);
  h.tick(GAP_MS * 10);
  assert.equal(h.auto.start('b'), null);
  assert.equal(h.calls.length, 2);
});

test('화면을 떠났으면 목록을 다시 읽지 않음', async () => {
  const h = harness([{ ok: true, added: 2 }]);
  assert.equal(await h.auto.start('k', () => false), 2);
  assert.deepEqual(h.added, []);
});

test('한 줄 글', () => {
  assert.equal(addedLine(2), '드라이브 자료실 폴더에서 새 자료 2개가 들어왔어요');
});

test('S70-73c 드라이브 따라 옮긴 자료만 있어도 목록 다시 읽기·한 줄(돌려주는 값은 새로 들어온 수)', async () => {
  const h = harness([{ ok: true, added: 0, followed: 2 }, { ok: true, added: 1, followed: 3 }]);
  assert.equal(await h.auto.start('k'), 0);
  h.tick(GAP_MS + 1);
  assert.equal(await h.auto.start('k'), 1);
  assert.deepEqual(h.added, [[0, 2], [1, 3]]);
  assert.equal(changedLine(0, 2), '드라이브에서 옮긴 자료 2개를 자료실에서도 같은 폴더로 옮겼어요');
  assert.equal(changedLine(1, 0), addedLine(1));
  assert.equal(changedLine(1, 3), addedLine(1) + ' · 드라이브에서 옮긴 자료 3개를 자료실에서도 같은 폴더로 옮겼어요');
});
