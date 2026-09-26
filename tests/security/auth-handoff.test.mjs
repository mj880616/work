import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, issue, json, sealedFixture, SUBJECT, OTHER } from './helpers/auth-handoff.mjs';

test('handoff restricts OPTIONS and actual POST to three exact origins', async () => {
  for (const origin of ['https://desk.bokdoong.com', 'https://work.bokdoong.com', 'https://mj880616.github.io']) {
    const h = harness();
    for (const method of ['OPTIONS', 'POST']) {
      const r = await h.send({ action: 'seal', refresh_token: 'synthetic-refresh' }, { origin, method, auth: true });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('Access-Control-Allow-Origin'), origin);
      assert.equal(r.headers.get('Vary'), 'Origin');
      assert.equal(r.headers.get('Cache-Control'), 'no-store');
    }
  }
  for (const origin of ['https://evil.example', 'https://sub.desk.bokdoong.com', 'https://desk.bokdoong.com.evil.example', 'null', null, 'file://', 'capacitor://localhost']) {
    const h = harness();
    for (const method of ['OPTIONS', 'POST']) {
      const r = await h.send({ action: 'seal', refresh_token: 'synthetic-refresh' }, { origin, method, auth: true });
      assert.equal(r.status, 403);
      assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
      assert.equal(r.headers.get('Cache-Control'), 'no-store');
    }
    assert.equal(h.claims() + h.refreshes(), 0);
  }
});

test('only exact DB true permits refresh; denial, error and ambiguous results fail closed', async () => {
  for (const value of [false, null, {}, [true], 'true', 1]) {
    const h = harness({ consume: async () => json(value) });
    const r = await h.send({ action: 'consume', token: await issue(h) });
    assert.equal(r.ok, false);
    assert.equal(h.refreshes(), 0);
  }
  for (const consume of [async () => json({ message: 'synthetic-private-db-detail' }, 500), async () => { throw new Error('synthetic-private-db-detail'); }, async () => new Response('not-json')]) {
    const h = harness({ consume });
    const r = await h.send({ action: 'consume', token: await issue(h) });
    assert.equal(r.ok, false);
    assert.equal(h.refreshes(), 0);
    assert.doesNotMatch(await r.text(), /synthetic-private/);
  }
});

test('DB timeout never calls refresh', async () => {
  const h = harness({ consume: (_, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('synthetic-private-timeout')), { once: true });
  }) });
  const r = await h.send({ action: 'consume', token: await issue(h) });
  assert.equal(r.ok, false);
  assert.equal(h.refreshes(), 0);
});

test('v1, invalid nonce/subject/time, missing refresh and malformed ciphertext are rejected before DB/Auth', async () => {
  const now = Date.now();
  const valid = { version: 2, nonce: randomUUID(), sub: SUBJECT, rt: 'synthetic-refresh', iat: now, exp: now + 300000 };
  const invalid = [
    { ...valid, version: undefined, nonce: undefined }, { ...valid, version: 1 },
    { ...valid, nonce: 'bad' }, { ...valid, nonce: SUBJECT.replace('4000', '1000') },
    { ...valid, sub: 'bad' }, { ...valid, sub: null }, { ...valid, rt: '' },
    { ...valid, exp: now - 1 }, { ...valid, exp: now + 600000 },
    { ...valid, iat: now + 90000 }, { ...valid, iat: '1' }, { ...valid, exp: null }, null
  ];
  const h = harness();
  for (const payload of invalid) assert.equal((await h.send({ action: 'consume', token: await sealedFixture(payload) })).ok, false);
  assert.equal((await h.send({ action: 'consume', token: 'invalid' })).ok, false);
  assert.equal(h.claims(), 0);
  assert.equal(h.refreshes(), 0);
});

test('returned session must belong to sealed subject; upstream details never escape', async () => {
  for (const options of [{ refreshUser: OTHER }, { refreshError: true }, { refreshThrows: true }]) {
    const h = harness({ ...options, consume: async () => json(true) });
    const r = await h.send({ action: 'consume', token: await issue(h) });
    assert.equal(r.ok, false);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    const body = await r.text();
    assert.doesNotMatch(body, /synthetic-|session|access_token|refresh_token/);
    assert.equal(h.refreshes(), 1);
  }
});

test('valid DB claim returns session; invalid access and expired handoff never claim', async () => {
  const h = harness({ consume: async () => json(true) });
  const token = await issue(h);
  const r = await h.send({ action: 'consume', token, user: OTHER, workspace: OTHER });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).session.user.id, SUBJECT);
  assert.equal(h.claims(), 1);
  assert.equal(h.refreshes(), 1);
  h.advance(300001);
  assert.equal((await h.send({ action: 'consume', token })).ok, false);
  assert.equal(h.claims(), 1);
  assert.equal((await harness({ invalidAccess: true }).send({ action: 'seal', refresh_token: 'synthetic-refresh' }, { auth: true })).status, 401);
});
