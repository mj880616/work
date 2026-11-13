import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHandler, TOOLS, validateArguments, envelope, NOTICE } from '../supabase/functions/mcp-read/core.mjs';

const env = { supabaseUrl: 'https://example.supabase.co', anonKey: 'public-anon', resourceUrl: 'https://example.supabase.co/functions/v1/mcp-read' };
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const token = (claims) => `${b64({ alg: 'none' })}.${b64(claims)}.signature-part-xx`;
const oauthToken = token({ sub: 'u1', client_id: 'claude' });
const plainToken = token({ sub: 'u1' });

function fakeFetch(calls, rpcResponse = { status: 200, body: { records: [{ type: 'x', text: 'a' }] } }) {
  return async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1' }), { status: 200 });
    return new Response(JSON.stringify(rpcResponse.body), { status: rpcResponse.status });
  };
}

const post = (body, tok = oauthToken) => new Request(env.resourceUrl, {
  method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('열쇠 없는 POST는 401 + resource_metadata', async () => {
  const res = await createHandler({ env, fetchImpl: fakeFetch([]) })(new Request(env.resourceUrl, { method: 'POST', body: '{}' }));
  assert.equal(res.status, 401);
  assert.match(res.headers.get('WWW-Authenticate'), /^Bearer resource_metadata="https:\/\/example\.supabase\.co\/functions\/v1\/mcp-read\/\.well-known\/oauth-protected-resource"$/);
});

test('일반 로그인 열쇠(client_id 없음)는 401', async () => {
  const res = await createHandler({ env, fetchImpl: fakeFetch([]) })(post({ jsonrpc: '2.0', id: 1, method: 'ping' }, plainToken));
  assert.equal(res.status, 401);
});

test('보호 자원 정보 문서와 OPTIONS', async () => {
  const handle = createHandler({ env, fetchImpl: fakeFetch([]) });
  const meta = await (await handle(new Request(`${env.resourceUrl}/.well-known/oauth-protected-resource`))).json();
  assert.equal(meta.resource, env.resourceUrl);
  assert.deepEqual(meta.authorization_servers, ['https://example.supabase.co/auth/v1']);
  assert.equal((await handle(new Request(env.resourceUrl, { method: 'OPTIONS' }))).status, 204);
});

test('도구 목록은 고정 7개, 모두 읽기 전용', async () => {
  const res = await createHandler({ env, fetchImpl: fakeFetch([]) })(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }));
  const { result } = await res.json();
  assert.equal(result.tools.length, 7);
  for (const tool of result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal('rpc' in tool, false);
  }
});

test('도구 호출은 같은 열쇠로 app_mcp_* RPC 하나만 POST하고 봉투로 감싼다', async () => {
  const calls = [];
  const res = await createHandler({ env, fetchImpl: fakeFetch(calls) })(post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ledger_search', arguments: { query: ' 교섭 ' } } }));
  const { result } = await res.json();
  const rpc = calls.filter((c) => c.url.includes('/rest/v1/'));
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0].url, 'https://example.supabase.co/rest/v1/rpc/app_mcp_ledger_search');
  assert.equal(rpc[0].init.headers.Authorization, `Bearer ${oauthToken}`);
  assert.deepEqual(JSON.parse(rpc[0].init.body), { p_query: '교섭' });
  assert.equal(result.structuredContent.notice, NOTICE);
  assert.equal(result.structuredContent.records.length, 1);
});

test('입력 검사: 모르는 칸·길이·날짜·범위', () => {
  const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
  assert.match(validateArguments(byName.web2_org_status, { workspace_id: 'x' }), /unknown/);
  assert.match(validateArguments(byName.ledger_search, {}), /missing/);
  assert.match(validateArguments(byName.ledger_search, { query: 'a'.repeat(101) }), /length/);
  assert.match(validateArguments(byName.web2_business_reports, { from: '2026-13-40' }), /date/);
  assert.match(validateArguments(byName.web2_notes_search, { query: 'a', limit: 99 }), /range/);
  assert.match(validateArguments(byName.ledger_get, { ledger_id: 'x; drop' }), /format/);
  assert.equal(validateArguments(byName.google_where, undefined), null);
});

test('DB 거절은 원문 없이 코드로만', async () => {
  const res = await createHandler({ env, fetchImpl: fakeFetch([], { status: 400, body: { message: 'RATE_LIMITED secret detail' } }) })(
    post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'google_where' } }));
  const { result } = await res.json();
  assert.equal(result.isError, true);
  assert.doesNotMatch(result.content[0].text, /secret/);
  assert.match(result.content[0].text, /^RATE_LIMITED/);
});

test('응답 크기 상한을 넘으면 잘랐다고 표시', () => {
  const big = { records: Array.from({ length: 200 }, (_, i) => ({ id: i, text: 'x'.repeat(1000) })) };
  const out = envelope(big, '2026-11-13T00:00:00Z');
  assert.equal(out.structuredContent.truncated, true);
  assert.ok(out.content[0].text.length <= 60 * 1024);
});

test('정적 검사: 서버 키·표 직접 접근·쓰기 방법·제외 자료 이름이 없다', () => {
  const dir = new URL('../supabase/functions/mcp-read/', import.meta.url);
  const source = ['core.mjs', 'index.ts'].map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  assert.doesNotMatch(source, /SERVICE_ROLE|service_role/);
  assert.doesNotMatch(source, /\/rest\/v1\/(?!rpc\/)/);
  assert.doesNotMatch(source, /method:\s*'(PATCH|PUT|DELETE)'/);
  assert.doesNotMatch(source, /rtw_|transcript_text|app_call_|app_tg_|kind\s*=\s*'diary'/);
  for (const tool of TOOLS) assert.match(tool.rpc, /^app_mcp_[a-z_]+$/);
});
