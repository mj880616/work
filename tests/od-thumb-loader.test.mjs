import { test } from 'node:test';
import assert from 'node:assert/strict';
// OD-속도: 원드라이브 사진 받기 대기열(app/od-thumb-loader.js). 지어낸 받기 함수와 지어낸 시계만 쓴다(네트워크 없음).
const {createThumbLoader, retryDelay, VISIBLE, NEAR, IDLE, ThumbError, LOADER_DEFAULTS, BATCH_REST_S} = await import('../app/od-thumb-loader.js');

const tick = () => new Promise(r => setTimeout(r, 0));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(); }
// 손으로 푸는 요청: 부른 순서대로 쌓이고, 시험이 하나씩 답한다.
function manual() {
  const calls = [];
  const fn = (...args) => new Promise((resolve, reject) => calls.push({args, resolve, reject}));
  return {calls, fn};
}
function clock() {
  let t = 1000; const timers = [];
  return {now: () => t, setTimer: (f, ms) => { timers.push({at: t + ms, f}); return timers.length; },
    advance(ms) { t += ms; for (const x of timers.splice(0)) { if (x.at <= t) x.f(); else timers.push(x); } }, timers};
}

test('defaults: four at a time, twenty per address batch, three hundred kept in memory', () => {
  assert.deepEqual({...LOADER_DEFAULTS}, {limit: 4, batchMax: 20, memMax: 300, ttlMs: 20 * 60 * 1000});
});

test('bytes path: never more than the limit at once, visible ones first, same photo asked once', async () => {
  const m = manual();
  const l = createThumbLoader({fetchBytes: m.fn, limit: 2});
  const order = [];
  const ps = ['a', 'b', 'c', 'd'].map(id => l.get(id, 'small', NEAR).then(u => order.push(u)));
  const dup = l.get('a', 'small', NEAR);
  const v = l.get('v', 'small', VISIBLE).then(u => order.push(u));
  await settle();
  assert.equal(m.calls.length, 2, 'only two in flight');
  assert.deepEqual(m.calls.map(c => c.args[0]), ['v', 'a'], 'a visible cell goes first');
  const w = l.get('w', 'small', VISIBLE).then(u => order.push(u));
  m.calls[0].resolve('blob:v'); await settle();
  assert.equal(m.calls[2].args[0], 'w', 'a cell that became visible jumps the waiting ones');
  for (const c of m.calls.slice(1)) c.resolve('blob:' + c.args[0]);
  await settle();
  for (const c of m.calls.slice(3)) c.resolve('blob:' + c.args[0]);
  await settle();
  for (const c of m.calls.slice(5)) c.resolve('blob:' + c.args[0]);
  await Promise.all([...ps, v, w]);
  assert.equal(await dup, 'blob:a');
  assert.equal(m.calls.length, 6, 'a was asked once');
  assert.equal(l.stats.maxActive, 2);
  // 이미 받은 것은 다시 묻지 않는다
  assert.equal(await l.get('a', 'small'), 'blob:a'); assert.equal(m.calls.length, 6);
  assert.ok(l.has('a', 'small')); assert.equal(l.has('a', 'large'), false);
});

test('address path: one request carries up to the batch size of the same size; missing and outside photos fail without retry', async () => {
  const m = manual();
  const l = createThumbLoader({fetchUrls: m.fn, fetchBytes: async () => 'blob:x', batchMax: 3});
  const got = ['a', 'b', 'c', 'd'].map(id => l.get(id, 'small'));
  const big = l.get('a', 'large');
  await settle();
  assert.deepEqual(m.calls.map(c => c.args), [[['a', 'b', 'c'], 'small'], [['d'], 'small'], [['a'], 'large']]);
  m.calls[0].resolve({urls: {a: 'https://t.example/a', b: 'https://t.example/b'}, failed: {c: 'outside'}});
  m.calls[1].resolve({urls: new Map(), failed: new Map([['d', 'missing']])});
  m.calls[2].resolve({urls: {a: 'https://t.example/A'}, failed: {}});
  assert.equal(await got[0], 'https://t.example/a'); assert.equal(await got[1], 'https://t.example/b');
  await assert.rejects(got[2], e => e instanceof ThumbError && e.code === 'outside');
  await assert.rejects(got[3], e => e.code === 'missing');
  assert.equal(await big, 'https://t.example/A');
  assert.equal(l.mode, 'urls');
});

test('a server that does not know photo-urls yet: switch to one by one for good, and skip the idle prefetch', async () => {
  const urls = manual(), bytes = manual();
  const l = createThumbLoader({fetchUrls: urls.fn, fetchBytes: bytes.fn});
  const pre = l.get('p', 'small', IDLE);
  const a = l.get('a', 'small', VISIBLE);
  await settle();
  assert.equal(urls.calls.length, 1);
  urls.calls[0].reject(new ThumbError('unsupported'));
  await settle();
  assert.equal(l.mode, 'bytes');
  assert.deepEqual(bytes.calls.map(c => c.args[0]), ['a'], 'the idle prefetch is not turned into a byte download');
  await assert.rejects(pre, e => e.code === 'dropped');
  bytes.calls[0].resolve('blob:a'); assert.equal(await a, 'blob:a');
  l.get('b'); await settle();
  assert.equal(urls.calls.length, 1, 'no more address requests');
});

test('an address the server could not make: that photo alone goes one by one', async () => {
  const urls = manual(), bytes = manual();
  const l = createThumbLoader({fetchUrls: urls.fn, fetchBytes: bytes.fn});
  const a = l.get('a');
  await settle(); urls.calls[0].resolve({urls: {}, failed: {a: 'unavailable'}}); await settle();
  assert.deepEqual(bytes.calls.map(c => c.args), [['a', 'small']]);
  bytes.calls[0].resolve('blob:a'); assert.equal(await a, 'blob:a');
  // 주소로 받은 그림이 안 뜨면(bad) 그 사진은 다음부터 한 장씩
  const b = l.get('b'); await settle(); urls.calls[1].resolve({urls: {b: 'https://t.example/b'}}); assert.equal(await b, 'https://t.example/b');
  l.bad('b', 'small', 'https://t.example/b');
  const again = l.get('b'); await settle();
  assert.equal(urls.calls.length, 2); assert.deepEqual(bytes.calls[1].args, ['b', 'small']);
  bytes.calls[1].resolve('blob:b'); assert.equal(await again, 'blob:b');
});

test('too many requests: the whole queue rests for retry_after, then the same photos are asked again', async () => {
  const c = clock(), urls = manual();
  const l = createThumbLoader({fetchUrls: urls.fn, fetchBytes: async () => 'blob', now: c.now, setTimer: c.setTimer});
  const a = l.get('a'), b = l.get('b');
  await settle();
  urls.calls[0].resolve({urls: {a: 'https://t.example/a'}, failed: {b: 'throttled'}, retryAfter: 7});
  assert.equal(await a, 'https://t.example/a');
  await settle();
  const z = l.get('z'); await settle();
  assert.equal(urls.calls.length, 1, 'nothing goes out while resting');
  c.advance(6000); await settle(); assert.equal(urls.calls.length, 1);
  c.advance(1000); await settle();
  assert.deepEqual(urls.calls[1].args[0].sort(), ['b', 'z']);
  urls.calls[1].resolve({urls: {b: 'https://t.example/b', z: 'https://t.example/z'}});
  assert.equal(await b, 'https://t.example/b'); assert.equal(await z, 'https://t.example/z');
  // 요청 전체가 429여도 같다(retry_after는 1~120초로 묶는다)
  const y = l.get('y'); await settle();
  urls.calls[2].reject(new ThumbError('throttled', {retryAfter: 9999}));
  await settle(); c.advance(119000); await settle(); assert.equal(urls.calls.length, 3);
  c.advance(1000); await settle(); assert.equal(urls.calls.length, 4);
  urls.calls[3].resolve({urls: {y: 'https://t.example/y'}}); assert.equal(await y, 'https://t.example/y');
});

test('a cell that scrolls away before its turn takes its request back, unless another cell still waits for it', async () => {
  const m = manual();
  const l = createThumbLoader({fetchBytes: m.fn, limit: 1});
  l.get('busy'); await settle();
  const a1 = l.get('a', 'small', NEAR), a2 = l.get('a', 'small', NEAR), b = l.get('b', 'small', NEAR);
  l.drop('a'); l.drop('b');
  await assert.rejects(b, e => e.code === 'dropped');
  m.calls[0].resolve('blob:busy'); await settle();
  assert.deepEqual(m.calls.map(c => c.args[0]), ['busy', 'a'], 'a still had one cell waiting; b was taken back');
  m.calls[1].resolve('blob:a'); assert.equal(await a1, 'blob:a'); assert.equal(await a2, 'blob:a');
  // 이미 보낸 요청은 거두지 않는다
  const c = l.get('c'); await settle(); l.drop('c'); m.calls[2].resolve('blob:c'); assert.equal(await c, 'blob:c');
});

test('memory keeps at most memMax pictures, drops the least recently used and lets go of its object URL', async () => {
  const revoked = [];
  const l = createThumbLoader({fetchBytes: async id => 'blob:' + id, memMax: 3, revoke: u => revoked.push(u)});
  for (const id of ['a', 'b', 'c']) await l.get(id);
  await l.get('a'); // a를 최근으로
  await l.get('d');
  assert.equal(l.size, 3);
  assert.deepEqual(revoked, ['blob:b']);
  assert.ok(l.has('a')); assert.equal(l.has('b'), false);
  l.forget('a'); assert.deepEqual(revoked, ['blob:b', 'blob:a']);
  l.clear(); assert.equal(l.size, 0); assert.deepEqual(revoked.sort(), ['blob:a', 'blob:b', 'blob:c', 'blob:d']);
});

test('an address is reused only while it is fresh; failures are not remembered', async () => {
  const c = clock(); let n = 0, fail = true;
  const l = createThumbLoader({fetchUrls: async ids => { n++; if (fail) throw new Error('session'); return {urls: Object.fromEntries(ids.map(id => [id, 'https://t.example/' + id + n]))}; },
    now: c.now, setTimer: c.setTimer, ttlMs: 1000});
  await assert.rejects(l.get('a'));
  fail = false;
  assert.equal(await l.get('a'), 'https://t.example/a2');
  assert.equal(await l.get('a'), 'https://t.example/a2');
  c.advance(1001);
  assert.equal(await l.get('a'), 'https://t.example/a3');
});

test('a batch that fails as a whole (server timeout etc.) does not fail its photos: rest, then those photos one by one', async () => {
  const c = clock(), bytes = [];
  const l = createThumbLoader({fetchUrls: async () => { throw Object.assign(new Error('onedrive_unavailable'), {status: 503}); },
    fetchBytes: async id => { bytes.push(id); return 'blob:' + id; }, now: c.now, setTimer: c.setTimer, limit: 1});
  const got = ['a', 'b'].map(id => l.get(id));
  await settle();
  assert.deepEqual(bytes, [], 'rests first');
  c.advance(BATCH_REST_S * 1000); await settle();
  c.advance(1); await settle();
  assert.deepEqual(await Promise.all(got), ['blob:a', 'blob:b']);
  assert.deepEqual(bytes, ['a', 'b']);
  // 로그인·연결 문제는 그대로 실패로 끝난다.
  const s = createThumbLoader({fetchUrls: async () => { throw new Error('onedrive_auth_expired'); }, fetchBytes: async () => 'blob:x'});
  await assert.rejects(s.get('z'), /onedrive_auth_expired/);
});

test('retry waits: 3s doubling to 60s, then stops after four failures in a row', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(retryDelay), [3000, 6000, 12000, 24000, null, null]);
});
