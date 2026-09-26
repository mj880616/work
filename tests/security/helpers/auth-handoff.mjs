// Execute the actual Edge handler in independent JS contexts. Only outbound
// Auth/REST transports are replaced; integration tests route REST into Postgres.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';
export const SUBJECT = '00000000-0000-4000-8000-000000000001';
export const OTHER = '00000000-0000-4000-8000-000000000002';
export const ORIGIN = 'https://desk.bokdoong.com';
export const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const raw = readFileSync(new URL('../../../supabase/functions/auth-handoff/index.ts', import.meta.url), 'utf8');
const source = stripTypeScriptTypes(raw.replace(/^import .*\r?\n/gm, ''), { mode: 'strip' });
export function harness({ consume = async () => true, refreshUser = SUBJECT, refreshError = false, invalidAccess = false, refreshThrows = false } = {}) {
  let handler, offset = 0, refreshes = 0, claims = 0;
  class Clock extends Date { static now() { return Date.now() + offset; } }
  const Deno = {
    env: { get: key => ({ SUPABASE_URL: 'https://auth.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-test-only', SUPABASE_ANON_KEY: 'synthetic-public' })[key] },
    serve: fn => { handler = fn; }
  };
  const fetch = async (url, init) => {
    if (url === 'https://auth.example.invalid/auth/v1/user') return json({ id: SUBJECT }, invalidAccess ? 401 : 200);
    if (url === 'https://auth.example.invalid/rest/v1/rpc/app_consume_auth_handoff') {
      claims++;
      assert.equal(init.headers.Authorization, 'Bearer synthetic-test-only');
      assert.equal(init.headers.apikey, 'synthetic-test-only');
      return consume(JSON.parse(init.body), init.signal);
    }
    assert.equal(url, 'https://auth.example.invalid/auth/v1/token?grant_type=refresh_token');
    assert.equal(JSON.parse(init.body).refresh_token, 'synthetic-refresh');
    refreshes++;
    if (refreshThrows) throw new Error('synthetic-private-network-detail');
    return refreshError ? json({ error_description: 'synthetic-private-upstream-detail' }, 400) : json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, user: { id: refreshUser } });
  };
  new Function('Deno', 'fetch', 'crypto', 'Date', source)(Deno, fetch, webcrypto, Clock);
  const send = (body, { origin = ORIGIN, method = 'POST', auth = false } = {}) => handler(new Request('https://edge.example.invalid/auth-handoff', {
    method,
    headers: { ...(origin === null ? {} : { Origin: origin }), 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer synthetic-access' } : {}) },
    ...(['OPTIONS', 'GET'].includes(method) ? {} : { body: JSON.stringify(body) })
  }));
  return { send, advance: ms => { offset += ms; }, refreshes: () => refreshes, claims: () => claims };
}
export async function issue(h) {
  const r = await h.send({ action: 'seal', refresh_token: 'synthetic-refresh' }, { auth: true });
  assert.equal(r.status, 200);
  return (await r.json()).token;
}
// Independent encrypted fixtures exercise the real decrypt/validate path.
export async function sealedFixture(payload) {
  const seed = new TextEncoder().encode('kptu-auth-handoff-v1:synthetic-test-only');
  const digest = await webcrypto.subtle.digest('SHA-256', seed);
  const key = await webcrypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const cipher = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return Buffer.concat([iv, Buffer.from(cipher)]).toString('base64url');
}
