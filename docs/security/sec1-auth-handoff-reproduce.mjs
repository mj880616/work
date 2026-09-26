// Offline investigation probe, not a passing security regression suite.
// Default exit 0 means the probe ran; --enforce exits 1 for unresolved findings.
// No real tokens, network, database, or Android device are used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';

const raw = readFileSync(new URL('../../supabase/functions/auth-handoff/index.ts', import.meta.url), 'utf8');
const source = stripTypeScriptTypes(raw.replace(/^import .*\r?\n/gm, ''), { mode: 'strip' });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const baseline = Date.UTC(2026, 8, 26, 0, 0, 0);
function harness({ invalidAccess = false, refreshUser = 'synthetic-user-a', refreshError = false } = {}) {
  let handler, time = baseline, refreshes = 0;
  class Clock extends Date { static now() { return time; } }
  const Deno = {
    env: { get: key => ({ SUPABASE_URL: 'https://auth.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-test-only', SUPABASE_ANON_KEY: 'synthetic-public' })[key] },
    serve: fn => { handler = fn; }
  };
  const fetch = async url => {
    if (url === 'https://auth.example.invalid/auth/v1/user') return json({ id: 'synthetic-user-a' }, invalidAccess ? 401 : 200);
    assert.equal(url, 'https://auth.example.invalid/auth/v1/token?grant_type=refresh_token');
    refreshes++;
    return refreshError ? json({ error_description: 'synthetic-upstream-detail' }, 400) : json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', user: { id: refreshUser } });
  };
  new Function('Deno', 'fetch', 'crypto', 'Date', source)(Deno, fetch, webcrypto, Clock);
  const send = (body, { origin = 'https://untrusted.example', method = 'POST', auth = false } = {}) => handler(new Request('https://edge.example.invalid/auth-handoff', {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer synthetic-access' } : {}) },
    ...(method === 'OPTIONS' ? {} : { body: JSON.stringify(body) })
  }));
  return { send, advance: ms => { time += ms; }, refreshes: () => refreshes };
}
async function issue(h) {
  const r = await h.send({ action: 'seal', refresh_token: 'synthetic-refresh' }, { auth: true });
  assert.equal(r.status, 200);
  const { token } = await r.json();
  assert.equal(typeof token, 'string');
  return token;
}
const findings = [];
function record(name, observed, unresolved) { findings.push({ name, observed, unresolved }); }
const h = harness();
const token = await issue(h);
const first = await h.send({ action: 'consume', token });
const second = await h.send({ action: 'consume', token });
record('sequential-replay', [first.status, second.status], first.ok && second.ok);
const instances = [harness(), harness()];
const concurrent = await Promise.all(instances.map(x => x.send({ action: 'consume', token })));
record('replay-across-independent-instances', concurrent.map(r => r.status), concurrent.every(r => r.ok));
const preflight = await h.send({}, { method: 'OPTIONS' });
record('arbitrary-origin', { preflight: preflight.status, allowOrigin: preflight.headers.get('Access-Control-Allow-Origin'), post: first.status }, preflight.ok && first.ok && preflight.headers.get('Access-Control-Allow-Origin') === '*');
record('cache-control', first.headers.get('Cache-Control'), !first.headers.get('Cache-Control')?.includes('no-store'));
const mismatch = await harness({ refreshUser: 'synthetic-user-b' }).send({ action: 'consume', token });
const mismatchedData = await mismatch.json();
record('sealed-subject-not-bound-to-returned-session', mismatch.status, mismatch.ok && mismatchedData.session?.user?.id === 'synthetic-user-b');
const upstream = await harness({ refreshError: true }).send({ action: 'consume', token });
record('upstream-error-disclosure', upstream.status, (await upstream.json()).error === 'synthetic-upstream-detail');
const beforeExpiryCheck = h.refreshes();
h.advance(300001);
assert.equal((await h.send({ action: 'consume', token })).status, 401);
assert.equal(h.refreshes(), beforeExpiryCheck);
assert.equal((await harness({ invalidAccess: true }).send({ action: 'seal', refresh_token: 'synthetic-refresh' }, { auth: true })).status, 401);
assert.equal((await harness().send({ action: 'consume', token: 'invalid' })).status, 400);
console.log(JSON.stringify({
  sourceSha256Lf: createHash('sha256').update(raw.replace(/\r\n/g, '\n')).digest('hex'),
  scope: 'actual handler, mocked Auth; replay acceptance does not prove production refresh success for the entire five minutes',
  controls: ['expired token rejected before Auth', 'invalid access rejected', 'malformed token rejected'],
  findings
}, null, 2));
if (process.argv.includes('--enforce') && findings.some(x => x.unresolved)) process.exitCode = 1;
