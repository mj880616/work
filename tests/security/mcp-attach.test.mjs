// MCP-Claude쓰기 ③ 파일 첨부(설계 docs/design/mcp-claude-write.md 11절). 모의 응답만(운영·Google·Supabase 접속 없음, 지어낸 자료).
// 지키는 것:
// - mcp-read: 허용되면 첨부 도구 2개가 목록에 더해짐(30개), 첨부 호출은 같은 열쇠를 basket-files?action=mcp-attach 하나에만 넘김(서버 키 없음),
//   몸통 64 KB 상한은 파일 직접 올리기 도구만 12 MB까지, 입력 모양 검사.
// - basket-files mcp-attach: 위임 열쇠만, userinfo 확인, DB 확인(같은 열쇠) 전에는 서버 키·Drive 요청 0건, 거절 코드, 8 MB·100 MB 상한,
//   남의 파일·공유 드라이브·폴더·Google 문서 거절(복사 0건), 성공 시 기존 폴더로 올리기/복사 1번 + commit 1번, commit 거절이면 올린 파일 지움,
//   L3 예외가 다른 basket-files 동작(올리기·OCR·노트 지우기·사진·사진 정리)에 퍼지지 않음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, ATTACH_TOOLS, ATTACH_LIMITS, validateArguments, WRITE_RULE } from '../../supabase/functions/mcp-read/core.mjs';

const SB = 'https://synthetic.supabase.test';
const USER = '50000000-0000-4000-8000-000000000001';
const WS = '10000000-0000-4000-8000-000000000001';
const NOTE = '20000000-0000-4000-8000-000000000001';
const LOG = '60000000-0000-4000-8000-000000000001';
const VERSION = '2026-11-28T01:00:00.123456+00:00';
const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const DELEGATED = `${b64u({ alg: 'none' })}.${b64u({ sub: USER, client_id: 'claude-synthetic', role: 'authenticated' })}.signature-part-xx`;
const LOGIN = `${b64u({ alg: 'none' })}.${b64u({ sub: USER, role: 'authenticated' })}.signature-part-xx`;

// ---------------------------------------------------------------- mcp-read ----
const env = { supabaseUrl: SB, anonKey: 'public-anon', resourceUrl: `${SB}/functions/v1/mcp-read` };
const post = (body, raw) => new Request(env.resourceUrl, { method: 'POST', headers: { Authorization: `Bearer ${DELEGATED}`, 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body) });
function entry(calls, { attach = { status: 200, body: { ok: true, result: { ok: true, kind: 'note', id: NOTE, version: VERSION, action: 'attach' }, file: { file_name: 'a.pdf' } } } } = {}) {
  return async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/oauth/userinfo')) return new Response(JSON.stringify({ sub: USER }), { status: 200 });
    if (url.endsWith('/rpc/app_mcp_write_tools')) return new Response(JSON.stringify({ allowed: true }), { status: 200 });
    if (url.includes('/functions/v1/basket-files')) return new Response(JSON.stringify(attach.body), { status: attach.status });
    return new Response(JSON.stringify({ records: [] }), { status: 200 });
  };
}
const callFile = (args, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'web2_attach_file', arguments: args } });
const fileArgs = (extra = {}) => ({ kind: 'note', id: NOTE, base_version: VERSION, file_name: '회의 자료.pdf', mime_type: 'application/pdf', content_base64: Buffer.from('hello').toString('base64'), ...extra });

test('mcp-read: 첨부 도구 2개는 쓰기 규칙·고정 입력, 허용되면 목록 30개', async () => {
  assert.deepEqual(ATTACH_TOOLS.map((t) => t.name), ['web2_attach_file', 'web2_attach_drive_file']);
  for (const t of ATTACH_TOOLS) {
    assert.ok(t.description.includes(WRITE_RULE));
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.deepEqual(t.inputSchema.properties.kind.enum, ['note', 'update']);
    for (const key of Object.keys(t.inputSchema.properties)) assert.doesNotMatch(key, /workspace|user|url|folder/i);
  }
  const list = await (await createHandler({ env, fetchImpl: entry([]) })(post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))).json();
  assert.equal(list.result.tools.length, 30);
  assert.ok(list.result.tools.some((t) => t.name === 'web2_attach_drive_file'));
});

test('mcp-read: 첨부 호출은 같은 열쇠를 basket-files 첨부 길 하나에만 넘기고, 결과는 서버 칸만', async () => {
  for (const [name, args] of [['web2_attach_file', fileArgs()], ['web2_attach_drive_file', { kind: 'update', id: NOTE, base_version: VERSION, drive_file_id: '1AbCdEfGhIjKlMnOp_-' }]]) {
    const calls = [];
    const res = await createHandler({ env, fetchImpl: entry(calls) })(post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }));
    const { result } = await res.json();
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent.result, { ok: true, kind: 'note', id: NOTE, version: VERSION, action: 'attach' });
    const rest = calls.filter((c) => !c.url.includes('/auth/v1/'));
    assert.equal(rest.length, 1);
    assert.equal(rest[0].url, `${SB}/functions/v1/basket-files?action=mcp-attach`);
    assert.equal(rest[0].init.headers.Authorization, `Bearer ${DELEGATED}`);
    assert.equal(rest[0].init.headers.apikey, 'public-anon');
    assert.deepEqual(JSON.parse(rest[0].init.body), { tool: name, arguments: args });
  }
});

test('mcp-read: basket-files 거절 코드는 일상어 코드로', async () => {
  for (const code of ['NOT_ALLOWED', 'WRITE_OFF', 'LOCKED', 'CHANGED', 'TOO_LARGE', 'TOO_MANY', 'NOT_OWNED', 'BAD_FILE', 'RATE_LIMITED', 'NOT_FOUND']) {
    const res = await createHandler({ env, fetchImpl: entry([], { attach: { status: 403, body: { ok: false, code } } }) })(post(callFile(fileArgs())));
    const { result } = await res.json();
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, new RegExp(`^${code}:`), code);
  }
  const res = await createHandler({ env, fetchImpl: entry([], { attach: { status: 401, body: { ok: false, code: 'NOT_ALLOWED' } } }) })(post(callFile(fileArgs())));
  assert.match((await res.json()).result.content[0].text, /^NOT_ALLOWED:/);
});

test('mcp-read: 몸통 64 KB 넘으면 파일 직접 올리기만 받고(12 MB까지), 다른 도구·목록은 413', async () => {
  const big = Buffer.alloc(300 * 1024, 7).toString('base64');
  const calls = [];
  const ok = await createHandler({ env, fetchImpl: entry(calls) })(post(callFile(fileArgs({ content_base64: big }))));
  assert.equal(ok.status, 200);
  assert.equal(calls.filter((c) => c.url.includes('basket-files')).length, 1);
  const other = await createHandler({ env, fetchImpl: entry([]) })(post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'web2_note_create', arguments: { title: 'x', body: 'a'.repeat(70 * 1024) } } }));
  assert.equal(other.status, 413);
  const list = await createHandler({ env, fetchImpl: entry([]) })(post({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: { pad: 'a'.repeat(70 * 1024) } }));
  assert.equal(list.status, 413);
  const huge = await createHandler({ env, fetchImpl: entry([]) })(post(null, 'x'.repeat(ATTACH_LIMITS.bodyBytes + 1)));
  assert.equal(huge.status, 413);
  // 열쇠가 없으면 몸통을 읽기 전에 401.
  const noKey = await createHandler({ env, fetchImpl: entry([]) })(new Request(env.resourceUrl, { method: 'POST', body: 'x'.repeat(100) }));
  assert.equal(noKey.status, 401);
});

test('mcp-read: 입력 검사(base64 모양·크기, 종류는 노트·업데이트만, Drive id 모양)', () => {
  const [file, drive] = ATTACH_TOOLS;
  assert.equal(validateArguments(file, fileArgs()), null);
  assert.equal(validateArguments(file, fileArgs({ content_base64: 'not base64!' })), 'content_base64 format');
  assert.equal(validateArguments(file, fileArgs({ content_base64: 'A'.repeat(Math.ceil(ATTACH_LIMITS.fileBytes / 3) * 4 + 4) })), 'content_base64 length');
  assert.equal(validateArguments(file, fileArgs({ mime_type: 'pdf' })), 'mime_type format');
  assert.equal(validateArguments(file, fileArgs({ kind: 'family' })), 'kind value');
  assert.equal(validateArguments(file, fileArgs({ workspace_id: WS })), 'unknown argument: workspace_id');
  assert.equal(validateArguments(drive, { kind: 'org_record', id: NOTE, base_version: VERSION, drive_file_id: '1AbCdEfGhIjKlMnOp' }), 'kind value');
  assert.equal(validateArguments(drive, { kind: 'note', id: NOTE, base_version: VERSION, drive_file_id: '../x' }), 'drive_file_id length');
  assert.equal(validateArguments(drive, { kind: 'note', id: NOTE, base_version: VERSION, drive_file_id: '../../../../etc' }), 'drive_file_id format');
});

// ------------------------------------------------------------- basket-files ----
const ROOT = 'basket-root', CHILD = 'note-files-folder';
const FOLDER = 'application/vnd.google-apps.folder';
const owner = [{ type: 'user', role: 'owner' }];
const SRC = '1SourceFileOwnedByMe0';

function harness({ check = { status: 200, body: { log_id: LOG, kind: 'note', note_kind: 'note', id: NOTE, version: VERSION, attachments: 0 } },
  userinfo = USER, source = {}, commit = null, member = { workspace_id: WS, role: 'owner' } } = {}) {
  const files = new Map([
    [ROOT, { id: ROOT, name: 'Web2 바구니', mimeType: FOLDER, ownedByMe: true, trashed: false, parents: ['my-root'], permissions: owner }],
    [CHILD, { id: CHILD, name: '노트 첨부', mimeType: FOLDER, ownedByMe: true, trashed: false, parents: [ROOT], permissions: owner }],
    [SRC, { id: SRC, name: '보고서.pdf', mimeType: 'application/pdf', size: '2048', ownedByMe: true, trashed: false, parents: ['my-root'], ...source }],
  ]);
  const calls = { auth: [], check: [], drive: [], uploads: [], copies: [], deleted: [], admin: [], rpc: [] };
  let n = 0;
  const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET';
    if (u.pathname === '/auth/v1/oauth/userinfo') { calls.auth.push(init.headers.Authorization); return userinfo ? json({ sub: userinfo }) : json({}, 401); }
    if (u.pathname === '/rest/v1/rpc/app_mcp_attach_check') { calls.check.push({ headers: init.headers, body: JSON.parse(init.body) }); return json(check.body, check.status); }
    if (u.hostname.endsWith('supabase.test')) throw new Error('unexpected supabase call ' + u.pathname);
    calls.drive.push(`${method} ${u.pathname}`);
    if (u.hostname === 'oauth2.googleapis.com') return json({ access_token: 'synthetic-drive-token' });
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') || '';
      const name = q.match(/name = '([^']+)'/)?.[1], parent = q.match(/'([^']+)' in parents/)?.[1];
      return json({ files: [...files.values()].filter((f) => f.mimeType === FOLDER && f.name === name && (parent === 'root' ? f.parents.includes('my-root') : f.parents.includes(parent))) });
    }
    if (/^\/drive\/v3\/files\/[^/]+\/copy$/.test(u.pathname) && method === 'POST') {
      const body = JSON.parse(init.body); calls.copies.push({ from: u.pathname.split('/')[4], ...body });
      return json({ id: 'copy-' + (++n) });
    }
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'GET') {
      const f = files.get(decodeURIComponent(u.pathname.split('/').at(-1)));
      return f ? json(structuredClone(f)) : json({ error: 'notFound' }, 404);
    }
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'DELETE') { calls.deleted.push(u.pathname.split('/').at(-1)); return new Response(null, { status: 204 }); }
    if (u.pathname === '/upload/drive/v3/files') {
      calls.uploads.push(JSON.parse(init.body));
      return new Response('{}', { status: 200, headers: { location: `https://www.googleapis.com/upload-session/${calls.uploads.length}` } });
    }
    if (u.pathname.startsWith('/upload-session/')) return json({ id: 'drive-file-' + u.pathname.split('/').at(-1) });
    return json({ error: 'unexpected' }, 500);
  };
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
    rpc: async (fn, args) => { calls.rpc.push({ fn, args }); return commit || { data: { ok: true, kind: 'note', id: NOTE, version: '2026-11-28T01:00:01+00:00', action: 'attach' }, error: null, status: 200 }; },
    from: (table) => {
      calls.admin.push(table);
      const b = { select: () => b, eq: () => b, is: () => b, maybeSingle: () => exec(), single: () => exec(), then: (r, e) => exec().then(r, e) };
      async function exec() {
        if (table === 'app_workspace_members') return { data: member, error: null };
        if (table === 'public_policy_drive_config') return { data: { google_client_id: 'c', google_client_secret: 's' }, error: null };
        if (table === 'app_drive_connections') return { data: { google_refresh_token: 'r' }, error: null };
        if (table === 'app_drive_settings') return { data: { workspace_id: WS, basket_folder_id: ROOT }, error: null };
        if (table === 'app_notes') return { data: null, error: null };
        throw new Error('unexpected table ' + table);
      }
      return b;
    },
  };
  return { admin, fetch, calls, files };
}
async function attach(h, { tool = 'web2_attach_file', args = fileArgs(), token = DELEGATED, raw } = {}) {
  const { createBasketHandler } = await import('../../supabase/functions/basket-files/handler.ts');
  const handler = createBasketHandler(h.admin, { fetch: h.fetch, log: () => {}, env: { supabaseUrl: SB, anonKey: 'public-anon' } });
  const res = await handler(new Request(`${SB}/functions/v1/basket-files?action=mcp-attach`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify({ tool, arguments: args }),
  }));
  return { status: res.status, body: await res.json() };
}
const driveArgs = (extra = {}) => ({ kind: 'note', id: NOTE, base_version: VERSION, drive_file_id: SRC, ...extra });
const untouched = (h) => { assert.deepEqual(h.calls.admin, [], '서버 키 요청 0건'); assert.deepEqual(h.calls.drive, [], 'Drive 요청 0건'); assert.deepEqual(h.calls.rpc, []); };

test('basket-files mcp-attach: 일반 로그인 열쇠·userinfo 불일치는 401, 아무 요청도 더 나가지 않음', async () => {
  const a = harness();
  assert.equal((await attach(a, { token: LOGIN })).status, 401);
  untouched(a); assert.deepEqual(a.calls.check, []); assert.deepEqual(a.calls.auth, []);
  const b = harness({ userinfo: '50000000-0000-4000-8000-000000000099' });
  assert.equal((await attach(b)).status, 401);
  untouched(b); assert.deepEqual(b.calls.check, []);
  const c = harness({ userinfo: null });
  assert.equal((await attach(c)).status, 401);
  untouched(c);
});

test('basket-files mcp-attach: DB 확인이 거절하면(허용 안 됨·쓰기 꺼짐·남의 것·가족/잠금·상한) 서버 키·Drive 요청 0건', async () => {
  for (const [message, code, status] of [['NOT_ALLOWED', 'NOT_ALLOWED', 403], ['WRITE_OFF', 'WRITE_OFF', 403], ['NOT_FOUND', 'NOT_FOUND', 403], ['LOCKED', 'LOCKED', 403],
    ['RATE_LIMITED', 'RATE_LIMITED', 429], ['TOO_MANY', 'TOO_MANY', 403], ['CHANGED', 'CHANGED', 403], ['DISCONNECTED', 'DISCONNECTED', 403]]) {
    const h = harness({ check: { status: message === 'RATE_LIMITED' ? 429 : 403, body: { code: 'PT403', message } } });
    const r = await attach(h);
    assert.equal(r.status, status, message);
    assert.equal(r.body.code, code);
    untouched(h);
    assert.equal(h.calls.check.length, 1);
    assert.equal(h.calls.check[0].headers.Authorization, `Bearer ${DELEGATED}`, 'DB 확인은 같은 위임 열쇠로');
  }
});

test('basket-files mcp-attach: 입력 검사 — 모르는 칸·가족·원장 대상·8 MB 넘는 파일은 DB 확인 전에 거절', async () => {
  for (const args of [fileArgs({ workspace_id: WS }), fileArgs({ kind: 'family' }), fileArgs({ kind: 'ledger' }), fileArgs({ content_base64: '***' }), fileArgs({ mime_type: 'x' })]) {
    const h = harness(); const r = await attach(h, { args });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'BAD_INPUT'); assert.deepEqual(h.calls.check, []); untouched(h);
  }
  const h = harness();
  const big = Buffer.alloc(ATTACH_LIMITS.fileBytes + 1, 1).toString('base64');
  const r = await attach(h, { args: fileArgs({ content_base64: big }) });
  assert.equal(r.status, 413); assert.equal(r.body.code, 'TOO_LARGE'); assert.deepEqual(h.calls.check, []); untouched(h);
  const tooBig = harness();
  assert.equal((await attach(tooBig, { raw: JSON.stringify({ tool: 'web2_attach_file', arguments: fileArgs({ content_base64: 'A'.repeat(13 * 1024 * 1024) }) }) })).status, 413);
  untouched(tooBig);
  // 8 MB 딱 맞으면 받는다(확인 단계까지 간다).
  const edge = harness({ check: { status: 403, body: { message: 'WRITE_OFF' } } });
  const ok = await attach(edge, { args: fileArgs({ content_base64: Buffer.alloc(ATTACH_LIMITS.fileBytes, 1).toString('base64') }) });
  assert.equal(ok.body.code, 'WRITE_OFF');
  assert.equal(edge.calls.check[0].body.p_args.size_bytes, ATTACH_LIMITS.fileBytes);
});

test('basket-files mcp-attach (가): DB 확인 → 기존 폴더로 올리기 1번 → commit 1번(서버 키 전용 함수)', async () => {
  const h = harness();
  const r = await attach(h);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.result, { ok: true, kind: 'note', id: NOTE, version: '2026-11-28T01:00:01+00:00', action: 'attach' });
  assert.deepEqual(h.calls.check[0].body, { p_tool: 'web2_attach_file', p_args: { kind: 'note', id: NOTE, base_version: VERSION, file_name: '회의 자료.pdf', mime_type: 'application/pdf', size_bytes: 5 } });
  assert.deepEqual(h.calls.uploads.map((u) => u.parents), [[CHILD]], '노트는 바구니 안 노트 첨부 폴더(앱과 같은 곳)');
  assert.deepEqual(h.calls.rpc, [{ fn: 'app_mcp_attach_commit', args: { p_log_id: LOG, p_user_id: USER, p_base: VERSION,
    p_file: { drive_file_id: 'drive-file-1', file_name: '회의 자료.pdf', mime_type: 'application/pdf', size_bytes: 5 } } }]);
  assert.deepEqual(h.calls.copies, []); assert.deepEqual(h.calls.deleted, []);
  // 업데이트(basket)는 바구니 폴더 그대로.
  const u = harness({ check: { status: 200, body: { log_id: LOG, kind: 'update', note_kind: 'basket', id: NOTE, version: VERSION, attachments: 0 } } });
  assert.equal((await attach(u, { args: fileArgs({ kind: 'update' }) })).status, 200);
  assert.deepEqual(u.calls.uploads.map((x) => x.parents), [[ROOT]]);
});

test('basket-files mcp-attach (나): 내 소유 Drive 파일만 복사해 붙이고 원본은 읽기만', async () => {
  const h = harness();
  const r = await attach(h, { tool: 'web2_attach_drive_file', args: driveArgs() });
  assert.equal(r.status, 200);
  assert.deepEqual(h.calls.copies, [{ from: SRC, name: '보고서.pdf', parents: [CHILD] }]);
  assert.deepEqual(h.calls.rpc[0].args.p_file, { drive_file_id: 'copy-1', file_name: '보고서.pdf', mime_type: 'application/pdf', size_bytes: 2048 });
  assert.deepEqual(h.calls.check[0].body.p_args, driveArgs());
  // 원본에는 읽기(GET)만: PATCH·DELETE·권한 요청 없음.
  assert.deepEqual(h.calls.drive.filter((c) => c.includes(SRC)), [`GET /drive/v3/files/${SRC}`, `POST /drive/v3/files/${SRC}/copy`]);
  assert.deepEqual(h.calls.deleted, []);
  // (바구니 폴더의 기존 표식 맞추기 PATCH는 앱 올리기와 같은 동작이라 원본과 무관하다.)
  assert.deepEqual(h.calls.drive.filter((c) => c.includes(SRC) && /^(PATCH|PUT|DELETE)/.test(c)), []);
});

test('basket-files mcp-attach (나): 남의 파일·공유 드라이브·폴더·Google 문서·휴지통·100 MB 넘는 파일은 거절, 복사 0건', async () => {
  for (const [source, code] of [[{ ownedByMe: false }, 'NOT_OWNED'], [{ driveId: 'shared-drive-1' }, 'NOT_OWNED'], [{ mimeType: FOLDER, size: undefined }, 'BAD_FILE'],
    [{ mimeType: 'application/vnd.google-apps.document', size: undefined }, 'BAD_FILE'], [{ mimeType: 'application/vnd.google-apps.shortcut' }, 'BAD_FILE'],
    [{ trashed: true }, 'NOT_FOUND'], [{ size: String(100 * 1024 * 1024 + 1) }, 'TOO_LARGE']]) {
    const h = harness({ source });
    const r = await attach(h, { tool: 'web2_attach_drive_file', args: driveArgs() });
    assert.equal(r.body.code, code, JSON.stringify(source));
    assert.deepEqual(h.calls.copies, []); assert.deepEqual(h.calls.rpc, []); assert.deepEqual(h.calls.deleted, []);
  }
  const missing = harness();
  const r = await attach(missing, { tool: 'web2_attach_drive_file', args: driveArgs({ drive_file_id: '1NoSuchFileForThisUser' }) });
  assert.equal(r.body.code, 'NOT_FOUND');
});

test('basket-files mcp-attach: commit이 거절하면(그사이 바뀜 등) 올린 파일·복사본을 지운다', async () => {
  for (const tool of ['web2_attach_file', 'web2_attach_drive_file']) {
    const h = harness({ commit: { data: null, error: { code: '40001', message: 'CHANGED' }, status: 409 } });
    const r = await attach(h, { tool, args: tool === 'web2_attach_file' ? fileArgs() : driveArgs() });
    assert.equal(r.body.code, 'CHANGED');
    assert.deepEqual(h.calls.deleted, [tool === 'web2_attach_file' ? 'drive-file-1' : 'copy-1']);
  }
  // 작업공간 owner가 아니면 Drive에 손대지 않는다.
  const notOwner = harness({ member: { workspace_id: WS, role: 'member' } });
  assert.equal((await attach(notOwner)).body.code, 'NOT_ALLOWED');
  assert.deepEqual(notOwner.calls.drive, []);
});

test('basket-files: L3 예외는 mcp-attach 한 길뿐 — 위임 열쇠로 올리기·OCR·노트 지우기·사진·사진 정리는 401, 다음 요청 0건', async () => {
  const { createBasketHandler } = await import('../../supabase/functions/basket-files/handler.ts');
  const cases = [
    ['POST', '', () => { const f = new FormData(); f.append('file', new File(['x'], 'a.txt', { type: 'text/plain' })); f.append('note_id', NOTE); return f; }],
    ['POST', '?action=note-delete', () => JSON.stringify({ action: 'note-delete', note_id: NOTE, note_updated_at: VERSION })],
    ['POST', '?action=photo-prune', () => '{}'],
    ['POST', '?action=photo-orphans', () => '{}'],
    ['GET', '?action=photo&note_id=' + NOTE, null],
    ['GET', '?action=ocr-status&note_id=' + NOTE, null],
    ['POST', '', () => JSON.stringify({ action: 'ocr-read', note_id: NOTE })],
    ['POST', '?action=mcp-attach-x', () => '{}'],
  ];
  for (const [method, query, body] of cases) {
    const h = harness();
    const payload = body ? body() : undefined;
    const headers = { Authorization: `Bearer ${DELEGATED}` };
    if (typeof payload === 'string') headers['Content-Type'] = 'application/json';
    const res = await createBasketHandler(h.admin, { fetch: h.fetch, log: () => {}, env: { supabaseUrl: SB, anonKey: 'public-anon' } })(
      new Request(`${SB}/functions/v1/basket-files${query}`, { method, headers, body: payload }));
    assert.equal(res.status, 401, `${method} ${query}`);
    assert.deepEqual(h.calls.admin, [], `${method} ${query}`); assert.deepEqual(h.calls.drive, []); assert.deepEqual(h.calls.check, []);
  }
});
