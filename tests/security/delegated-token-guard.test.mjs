import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isDelegatedToken, rejectDelegatedToken, DelegatedTokenError, DELEGATED_TOKEN_CODE } from '../../supabase/functions/_shared/delegated-token-guard.mjs';

// MCP-Claude읽기 M-2 (설계 docs/design/mcp-claude-read.md 4.3절 L3).
// Supabase OAuth 서버가 바깥 앱에 내주는 위임 열쇠(client_id가 붙은 열쇠)는 Web2 Edge 함수에서 거절하고,
// 일반 로그인 열쇠는 지금과 똑같이 통과해야 한다. 열쇠는 모두 합성 값이다(서명 없음, 실제 열쇠·주소 없음).

const b64url = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = payload => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.synthetic-signature`;
const USER = '00000000-0000-4000-8000-0000000000aa';
const LOGIN = jwt({ sub: USER, role: 'authenticated', aud: 'authenticated', session_id: 's1', aal: 'aal1', amr: [{ method: 'password' }] });
const DELEGATED = jwt({ sub: USER, role: 'authenticated', aud: 'authenticated', client_id: '11111111-2222-4333-8444-555555555555' });

test('guard: 일반 로그인 열쇠는 통과, client_id가 있는 위임 열쇠는 거절', () => {
  assert.equal(isDelegatedToken(LOGIN), false);
  assert.equal(isDelegatedToken(`Bearer ${LOGIN}`), false);
  assert.equal(isDelegatedToken(DELEGATED), true);
  assert.equal(isDelegatedToken(`Bearer ${DELEGATED}`), true);
  assert.equal(isDelegatedToken(`bearer   ${DELEGATED}`), true);
  assert.doesNotThrow(() => rejectDelegatedToken(LOGIN));
  assert.throws(() => rejectDelegatedToken(DELEGATED), e => e instanceof DelegatedTokenError && e.status === 401 && e.code === DELEGATED_TOKEN_CODE);
});

test('guard: client_id 값 모양별 판정(빈 값·null은 일반, 문자열 아닌 값은 거절)', () => {
  assert.equal(isDelegatedToken(jwt({ sub: USER, client_id: '' })), false);
  assert.equal(isDelegatedToken(jwt({ sub: USER, client_id: '   ' })), false);
  assert.equal(isDelegatedToken(jwt({ sub: USER, client_id: null })), false);
  for (const odd of [0, 1, true, false, {}, [], ['x'], { id: 'x' }]) assert.equal(isDelegatedToken(jwt({ sub: USER, client_id: odd })), true, JSON.stringify(odd));
  // base64url 문자(-, _)와 한글이 든 payload도 바르게 읽는다.
  assert.equal(isDelegatedToken(jwt({ sub: USER, name: '사용자?>>~~~', client_id: 'c?>>' })), true);
  assert.equal(isDelegatedToken(jwt({ sub: USER, name: '사용자?>>~~~' })), false);
});

test('guard: JWT 모양이 아닌 값은 Auth 판정에 맡긴다(시험용 가짜 열쇠·빈 값)', () => {
  for (const value of [undefined, null, '', 'owner-token', 'a.b', 'a.b.c.d', 'x.!!!.y', `${b64url({})}.${Buffer.from('not json').toString('base64url')}.s`, `${b64url({})}.${b64url([1, 2])}.s`, 42, {}]) {
    assert.equal(isDelegatedToken(value), false, String(value));
  }
});

// ---- 정적 시험: 사용자 확인을 하는 모든 Web2 Edge 함수가 이 검사를 부르는가 ----
const FUNCTIONS = new URL('../../supabase/functions/', import.meta.url).pathname;
const AUTH_SITE = /\/auth\/v1\/user|\.auth\.getUser\(/g;
const GUARD_IMPORT = /^import \{[^}]*\bisDelegatedToken\b[^}]*\} from ['"]\.\.\/_shared\/delegated-token-guard\.mjs['"];?$/m;
const GUARD_CALL = /\bisDelegatedToken\(/g;
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const sourceFiles = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return sourceFiles(path);
  return /\.(ts|mjs|js)$/.test(name) ? [path] : [];
});
const functionDirs = () => readdirSync(FUNCTIONS).filter(name => !name.startsWith('_') && !name.startsWith('.') && statSync(join(FUNCTIONS, name)).isDirectory());
// 읽생기(rtw_*) 함수는 Web2 작업에서 건드리지 않는다(AGENTS.md 5절). 이 저장소에 생기더라도 검사 대상에서 뺀다.
const isRtw = name => /^rtw[-_]/i.test(name);
// Claude 읽기 입구(mcp-read, 초안 PR #2524)는 반대로 위임 열쇠'만' 받는 함수라 이 검사 대상이 아니다(설계 4.4절: client_id 없는 열쇠를 거절).
const DELEGATED_ENTRY = new Set(['mcp-read']);

function audit() {
  const rows = [];
  for (const name of functionDirs()) {
    if (isRtw(name) || DELEGATED_ENTRY.has(name)) continue;
    let authSites = 0, guardCalls = 0;
    for (const file of sourceFiles(join(FUNCTIONS, name))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const a = (code.match(AUTH_SITE) || []).length, g = (code.match(GUARD_CALL) || []).length;
      authSites += a; guardCalls += g;
      if (a && !GUARD_IMPORT.test(code)) rows.push({ name, file: file.slice(FUNCTIONS.length), problem: '사용자 확인 파일에 검사 import 없음' });
      if (a > g) rows.push({ name, file: file.slice(FUNCTIONS.length), problem: `사용자 확인 ${a}곳, 검사 ${g}곳` });
    }
    rows.push({ name, authSites, guardCalls });
  }
  return rows;
}

test('정적: 사용자 확인(/auth/v1/user·auth.getUser)을 하는 모든 Web2 Edge 함수 파일이 위임 열쇠 검사를 import하고 확인 수만큼 부른다', () => {
  const rows = audit();
  const problems = rows.filter(r => r.problem);
  assert.deepEqual(problems, [], '빠진 함수: 사용자 확인 직후 isDelegatedToken(같은 열쇠)로 401을 돌려주게 하세요(_shared/delegated-token-guard.mjs)');
  const guarded = rows.filter(r => r.authSites > 0).map(r => r.name).sort();
  // 2026-11-18 main 기준 28개(설계 4.3절 27개 + record-backup) + account-delete(S69 계정 삭제). 새 함수가 늘면 이 목록과 PR 배포 표를 함께 고친다.
  assert.deepEqual(guarded, [
    'account-delete', 'ai-assist', 'auth-handoff', 'basket-files', 'cloud-files', 'document-actions', 'document-ai-index', 'drive-summary',
    'event-media', 'gdrive-photos', 'google-calendar', 'google-tasks', 'library-files', 'meeting-ai-draft', 'meeting-ai-ingest',
    'meeting-files', 'meeting-transcribe', 'news-feed', 'note-import', 'onedrive-photos', 'outside-feed', 'page-ai-draft',
    'pc0921-board', 'phone-push', 'public-page-edit', 'public-policy-drive', 'record-backup', 'share-page-media', 'workspace-drive',
  ]);
  // 사용자 확인이 없는 함수(서버 예약 키·공개 읽기·비밀번호 확인)는 검사를 부르지 않아도 된다. 다만 목록이 바뀌면 다시 보게 고정한다.
  assert.deepEqual(rows.filter(r => r.authSites === 0).map(r => r.name).sort(), ['collector-feed', 'csp-report', 'pc0914-checklist', 'push-notifications', 'release-notes-sync', 'share-page-read']);
});

test('정적: 검사 공용 파일은 Deno 전역·서버 키·바깥 주소를 쓰지 않는 순수 함수다', () => {
  const code = stripComments(readFileSync(join(FUNCTIONS, '_shared/delegated-token-guard.mjs'), 'utf8'));
  assert.doesNotMatch(code, /Deno\.|SERVICE_ROLE|fetch\(|https?:\/\//);
  assert.doesNotMatch(code, /^import /m);
});

// ---- 실제 함수 동작: 같은 확인 경로에서 위임 열쇠는 401, 일반 로그인은 지금처럼 다음 단계(작업공간 확인)로 간다 ----
const SB = 'https://synthetic.supabase.test';
const env = key => ({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-only', SUPABASE_ANON_KEY: 'synthetic-anon' })[key];
function fakeFetch() {
  const after = [];
  const fn = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === `${SB}/auth/v1/user`) return new Response(JSON.stringify({ id: USER, email: 'synthetic@example.invalid', role: 'authenticated' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    after.push(url);
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '*/0' } });
  };
  return { fn, after };
}
const req = (token, url, body = {}) => new Request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'https://desk.bokdoong.com' }, body: JSON.stringify(body) });

const HANDLERS = [
  ['account-delete', async f => (await import('../../supabase/functions/account-delete/handler.ts')).createAccountDeleteHandler({ env, fetch: f, log: () => {} }), { action: 'check' }],
  ['ai-assist', async f => (await import('../../supabase/functions/ai-assist/handler.ts')).createAiAssistHandler({ env, fetch: f, log: () => {} }), { kind: 'todo_radar' }],
  ['phone-push', async f => (await import('../../supabase/functions/phone-push/handler.ts')).createPhonePushHandler({ env, fetch: f, log: () => {} }), {}, '?action=devices'],
  ['gdrive-photos', async f => (await import('../../supabase/functions/gdrive-photos/handler.ts')).createGdriveHandler({ env, fetch: f }), { action: 'list' }],
  ['cloud-files', async f => (await import('../../supabase/functions/cloud-files/handler.ts')).createCloudFilesHandler({ env, fetch: f, background: () => {} }), { action: 'list', source: 'gd' }],
];
for (const [name, make, body, query = ''] of HANDLERS) {
  test(`동작(${name}): 위임 열쇠는 401·다음 단계 요청 0건, 일반 로그인 열쇠는 작업공간 확인까지 간다`, async () => {
    const d = fakeFetch(), dh = await make(d.fn);
    const denied = await dh(req(DELEGATED, `${SB}/functions/v1/${name}${query}`, body));
    assert.equal(denied.status, 401);
    assert.deepEqual(d.after, [], '위임 열쇠로 DB·Drive·Google 요청이 나가면 안 된다');
    const n = fakeFetch(), nh = await make(n.fn);
    const normal = await nh(req(LOGIN, `${SB}/functions/v1/${name}${query}`, body));
    assert.notEqual(normal.status, 401, '일반 로그인 열쇠는 이 검사로 거절되면 안 된다');
    assert.ok(n.after.some(u => u.startsWith(`${SB}/rest/v1/`)), '일반 로그인 열쇠는 작업공간 확인(DB 읽기)까지 가야 한다');
  });
}

// auth-handoff: 로그인 넘기기(seal)·폰 위젯 새 세션(widget_seal)은 위임 열쇠로 새 로그인을 만들 수 있는 길이라 특히 막는다.
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';
const handoffSource = stripTypeScriptTypes(readFileSync(new URL('../../supabase/functions/auth-handoff/index.ts', import.meta.url), 'utf8').replace(/^import .*\r?\n/gm, ''), { mode: 'strip' });
function handoff() {
  let handler; const calls = [];
  const Deno = { env: { get: key => ({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-only', SUPABASE_ANON_KEY: 'synthetic-anon' })[key] }, serve: fn => { handler = fn; } };
  const fetch = async url => {
    calls.push(url);
    if (url === `${SB}/auth/v1/user`) return new Response(JSON.stringify({ id: USER, email: 'synthetic@example.invalid' }), { status: 200 });
    return new Response('{}', { status: 500 });
  };
  new Function('Deno', 'fetch', 'crypto', 'Date', 'isDelegatedToken', handoffSource)(Deno, fetch, webcrypto, Date, isDelegatedToken);
  const send = (token, body) => handler(new Request(`${SB}/functions/v1/auth-handoff`, { method: 'POST', headers: { Origin: 'https://desk.bokdoong.com', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
  return { send, calls };
}
test('동작(auth-handoff): 위임 열쇠로는 seal·widget_seal 모두 401, 새 세션 만들기 요청 0건. 일반 로그인 seal은 그대로 200', async () => {
  for (const body of [{ action: 'seal', refresh_token: 'synthetic-refresh' }, { action: 'widget_seal' }]) {
    const h = handoff();
    const r = await h.send(DELEGATED, body);
    assert.equal(r.status, 401, body.action);
    assert.deepEqual(h.calls, [`${SB}/auth/v1/user`], body.action);
  }
  const h = handoff();
  const r = await h.send(LOGIN, { action: 'seal', refresh_token: 'synthetic-refresh' });
  assert.equal(r.status, 200);
  assert.equal(typeof (await r.json()).token, 'string');
});
