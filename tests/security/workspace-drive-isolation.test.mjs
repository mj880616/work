// MULTI-노조사용자 ②-2: 사람별(작업공간별) Google Drive 연결. 다른 작업공간 사용자가 부르면 운영자(다른 작업공간)의 Drive 연결을 읽지 않는다.
// 실제 Edge 코드(_shared/workspace-drive-token.ts, basket-files, library-files photo, document-actions)를 그대로 쓰고 DB·Google 경계만 흉내 낸다.
// 값은 모두 가짜(운영 값 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness as actionsHarness } from '../fixtures/document-actions-harness.mjs';

const WS_A = '10000000-0000-4000-8000-00000000000a'; // 운영자 작업공간(연결 있음)
const WS_B = '10000000-0000-4000-8000-00000000000b'; // 다른 사람 작업공간
const A_REFRESH = 'synthetic-refresh-A', B_REFRESH = 'synthetic-refresh-B';
const tokenBodies = calls => calls.filter(c => c.token).map(c => String(c.body));

// supabase-js 관리자 흉내: 표마다 eq 조건을 보고 행을 고른다. id=1에도 A의 갱신 열쇠를 넣어 둔다(읽으면 안 됨).
function admin({ connections, members = [], notes = [] } = {}) {
  const reads = [];
  return {
    reads,
    auth: { getUser: async () => ({ data: { user: { id: 'user-b' } }, error: null }) },
    from(table) {
      const filters = [];
      const b = {
        select: () => b, is: () => b, limit: () => b,
        eq: (k, v) => { filters.push([k, v]); return b; },
        maybeSingle: async () => exec(true), single: async () => exec(true), then: (r, e) => exec(false).then(r, e),
      };
      async function exec(one) {
        reads.push(table);
        const match = rows => rows.filter(r => filters.every(([k, v]) => r[k] === v));
        let rows;
        if (table === 'public_policy_drive_config') rows = [{ id: 1, google_client_id: 'c', google_client_secret: 's', google_refresh_token: A_REFRESH }];
        else if (table === 'app_drive_connections') rows = Object.entries(connections).map(([workspace_id, google_refresh_token]) => ({ workspace_id, google_refresh_token }));
        else if (table === 'app_workspace_members') rows = members;
        else if (table === 'app_notes') rows = notes;
        else throw new Error('unexpected table ' + table);
        const got = match(rows);
        return one ? { data: got[0] ?? null, error: null } : { data: got, error: null };
      }
      return b;
    },
  };
}
function googleFetch(calls) {
  return async (url, init = {}) => {
    const u = new URL(String(url)), method = init.method || 'GET';
    const token = u.hostname === 'oauth2.googleapis.com';
    calls.push({ token, method, path: u.pathname, body: init.body });
    if (token) return Response.json({ access_token: 'synthetic-access' });
    return Response.json({ error: 'notFound' }, { status: 404 });
  };
}

test('helper: B의 토큰은 B 연결로만 받고, A 연결·id=1 갱신 열쇠는 보내지 않는다', async () => {
  const { workspaceDriveToken } = await import('../../supabase/functions/_shared/workspace-drive-token.ts');
  const calls = [];
  const a = admin({ connections: { [WS_A]: A_REFRESH, [WS_B]: B_REFRESH } });
  assert.equal(await workspaceDriveToken(a, WS_B, { fetch: googleFetch(calls), log: () => {} }), 'synthetic-access');
  const bodies = tokenBodies(calls);
  assert.equal(bodies.length, 1);
  assert.match(bodies[0], new RegExp('refresh_token=' + B_REFRESH));
  assert.doesNotMatch(bodies[0], new RegExp(A_REFRESH));
});

test('helper: 진짜 supabase-js처럼 rest 속성(객체)이 있는 관리자 클라이언트도 from으로 읽는다(11/05 drive_token_failed 회귀)', async () => {
  const { workspaceDriveToken, workspaceDriveConnected, callerOwnerWorkspace } = await import('../../supabase/functions/_shared/workspace-drive-token.ts');
  const calls = [];
  const a = admin({ connections: { [WS_B]: B_REFRESH }, members: [{ user_id: 'user-b', workspace_id: WS_B, role: 'owner' }] });
  a.rest = { from() { throw new Error('PostgrestClient는 함수가 아님'); } };
  assert.equal(await workspaceDriveToken(a, WS_B, { fetch: googleFetch(calls), log: () => {} }), 'synthetic-access');
  assert.equal(await workspaceDriveConnected(a, WS_B), true);
  assert.equal(await callerOwnerWorkspace(a, 'user-b'), WS_B);
  assert.match(tokenBodies(calls)[0], new RegExp('refresh_token=' + B_REFRESH));
});

test('helper: B 연결이 없으면 424 drive_not_connected, 토큰 교환 없음(A 연결로 넘어가지 않음)', async () => {
  const { workspaceDriveToken, WorkspaceDriveError } = await import('../../supabase/functions/_shared/workspace-drive-token.ts');
  const calls = [];
  const a = admin({ connections: { [WS_A]: A_REFRESH } });
  await assert.rejects(workspaceDriveToken(a, WS_B, { fetch: googleFetch(calls), log: () => {} }),
    e => e instanceof WorkspaceDriveError && e.status === 424 && e.code === 'drive_not_connected');
  assert.equal(calls.length, 0);
  // 작업공간 값이 없거나 이상하면 아무것도 읽지 않는다.
  for (const bad of [undefined, '', 'a/b', '../x']) {
    await assert.rejects(workspaceDriveToken(a, bad, { fetch: googleFetch(calls), log: () => {} }), e => e.code === 'drive_workspace_missing');
  }
  assert.equal(calls.length, 0);
});

test('helper: 본인 owner 행이 정확히 1개일 때만 그 작업공간(남의 owner 행·두 개·owner 아님은 null)', async () => {
  const { callerOwnerWorkspace } = await import('../../supabase/functions/_shared/workspace-drive-token.ts');
  const rest = rows => ({ rest: async () => rows });
  assert.equal(await callerOwnerWorkspace(rest([{ workspace_id: WS_B, role: 'owner' }]), 'user-b'), WS_B);
  assert.equal(await callerOwnerWorkspace(rest([]), 'user-b'), null);
  assert.equal(await callerOwnerWorkspace(rest([{ workspace_id: WS_A, role: 'owner' }, { workspace_id: WS_B, role: 'owner' }]), 'user-b'), null);
  assert.equal(await callerOwnerWorkspace(rest([{ workspace_id: WS_B, role: 'viewer' }]), 'user-b'), null);
  // 요청한 길에 본인 user_id·owner 조건이 붙는다.
  let asked = '';
  await callerOwnerWorkspace({ rest: async p => { asked = p; return []; } }, 'user-b');
  assert.match(asked, /^app_workspace_members\?user_id=eq\.user-b&role=eq\.owner&/);
});

// basket-files: B 사용자의 바구니 사진 보기. 작업공간은 서버가 B의 owner 행으로 정한다.
async function basketPhoto(connections) {
  const calls = [];
  const NOTE = '20000000-0000-4000-8000-00000000000b';
  const a = admin({ connections, members: [{ user_id: 'user-b', workspace_id: WS_B, role: 'owner' }] });
  const userClient = () => ({ from: () => {
    const b = { select: () => b, eq: () => b, is: () => b, maybeSingle: async () => ({ data: { id: NOTE, workspace_id: WS_B, attachments: [{ drive_file_id: 'p1', file_name: 'p1.jpg', mime_type: 'image/jpeg', size_bytes: 3 }] }, error: null }) };
    return b;
  } });
  const { createBasketHandler } = await import('../../supabase/functions/basket-files/handler.ts');
  const handler = createBasketHandler(a, { fetch: googleFetch(calls), log: () => {}, userClient });
  const params = new URLSearchParams({ action: 'photo', note_id: NOTE, file_id: 'p1', size: 'small' });
  const r = await handler(new Request('https://synthetic.invalid/functions/v1/basket-files?' + params, { headers: { Authorization: 'Bearer synthetic-user-b' } }));
  return { status: r.status, calls, reads: a.reads };
}

test('basket-files: B 사용자 요청은 A(운영자) Drive 연결을 쓰지 않는다 — B 연결 없으면 Drive 호출 없음, 있으면 B 열쇠만', async () => {
  const none = await basketPhoto({ [WS_A]: A_REFRESH });
  assert.notEqual(none.status, 200);
  assert.equal(none.calls.length, 0, 'B 연결이 없으면 Google에 아무 요청도 가지 않는다');
  const both = await basketPhoto({ [WS_A]: A_REFRESH, [WS_B]: B_REFRESH });
  const bodies = tokenBodies(both.calls);
  assert.equal(bodies.length, 1);
  assert.match(bodies[0], new RegExp(B_REFRESH));
  assert.doesNotMatch(bodies[0], new RegExp(A_REFRESH));
});

// library-files 사진 보기: 부르는 쪽(index.ts)이 정한 B 작업공간이 그대로 Drive 연결 선택에 쓰인다.
async function libraryPhoto(connections) {
  const calls = [];
  const DOC = '30000000-0000-4000-8000-00000000000b';
  const a = admin({ connections });
  const userClient = () => ({ from: () => {
    const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: { id: DOC, workspace_id: WS_B, file_id: 'p1', mime_type: 'image/jpeg' }, error: null }) };
    return b;
  } });
  const { createLibraryPhotoHandler } = await import('../../supabase/functions/library-files/photo.ts');
  const handler = createLibraryPhotoHandler(a, { fetch: googleFetch(calls), log: () => {}, userClient });
  const params = new URLSearchParams({ action: 'photo', document_id: DOC, size: 'small' });
  const r = await handler(new Request('https://synthetic.invalid/functions/v1/library-files?' + params), WS_B, 'Bearer synthetic-user-b');
  return { status: r.status, calls };
}

test('library-files: B 작업공간 요청은 B 연결만 — 없으면 Google 요청 없음', async () => {
  const none = await libraryPhoto({ [WS_A]: A_REFRESH });
  assert.notEqual(none.status, 200);
  assert.equal(none.calls.length, 0);
  const both = await libraryPhoto({ [WS_A]: A_REFRESH, [WS_B]: B_REFRESH });
  const bodies = tokenBodies(both.calls);
  assert.equal(bodies.length, 1);
  assert.match(bodies[0], new RegExp(B_REFRESH));
  assert.doesNotMatch(bodies[0], new RegExp(A_REFRESH));
});

test('library-files index: id=1의 갱신 열쇠를 읽지 않고, 업로드·교체 모두 서버가 확인한 작업공간을 넘긴다', () => {
  const src = readFileSync(new URL('../../supabase/functions/library-files/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /google_refresh_token/);
  assert.doesNotMatch(src, /driveToken\(\)/);
  assert.match(src, /const token=await driveToken\(wm\.workspace_id\);/);
  assert.match(src, /const token=await driveToken\(workspaceId\);/);
});

// document-actions: 로그인한 B(owner 행 ws-2)의 자료 삭제. A(ws-1)만 Drive 연결이 있으면 A 열쇠로 Drive를 건드리지 않는다.
test('document-actions: B 자료 삭제는 B 연결로만 — 연결 없으면 거절·기록 그대로, 있으면 B 열쇠만', async () => {
  const doc = { id: 'doc-1', workspace_id: 'ws-2', file_id: 'file-1' };
  const tokenCalls = h => h.calls.filter(c => c.path.includes('/token') && !c.path.includes('/rest/'));
  const none = actionsHarness({ owned: ['ws-2'], documents: [doc], driveConnections: { 'ws-1': A_REFRESH } });
  const refused = await none.send();
  assert.notEqual(refused.status, 200);
  // 바구니 원본 확인 단계에서 토큰을 못 받아 '삭제하지 않음'으로 끝난다(문구는 그 단계의 것).
  assert.match(refused.body.error, /삭제하지 않고|Drive/);
  assert.equal(tokenCalls(none).length, 0);
  assert.equal(none.calls.filter(c => c.method === 'DELETE' && c.path.includes('/rest/v1/')).length, 0, '자료 기록은 지우지 않는다');
  assert.equal(none.calls.filter(c => c.path.includes('/drive/v3/') && c.method !== 'GET').length, 0);

  const both = actionsHarness({ owned: ['ws-2'], documents: [doc], driveConnections: { 'ws-1': A_REFRESH, 'ws-2': B_REFRESH } });
  assert.equal((await both.send()).status, 200);
  const bodies = tokenCalls(both).map(c => String(c.body));
  assert.equal(bodies.length, 1);
  assert.match(bodies[0], new RegExp(B_REFRESH));
  assert.doesNotMatch(bodies[0], new RegExp(A_REFRESH));
  // 연결은 작업공간 ws-2로만 찾았다.
  const asked = both.calls.filter(c => c.path.includes('/rest/v1/app_drive_connections')).map(c => new URL(c.path).searchParams.get('workspace_id'));
  assert.deepEqual([...new Set(asked)], ['eq.ws-2']);
});

test('Drive를 쓰는 Web2 Edge(운영자 전용 제외)는 id=1의 갱신 열쇠를 더 읽지 않는다', () => {
  const files = ['document-actions/index.ts', 'library-files/index.ts', 'meeting-ai-ingest/index.ts', 'document-ai-index/index.ts',
    'meeting-files/index.ts', 'meeting-transcribe/index.ts', 'workspace-drive/index.ts', '_shared/drive-upload.ts'];
  for (const f of files) {
    const src = readFileSync(new URL('../../supabase/functions/' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /public_policy_drive_config/, f + ': id=1 행을 직접 읽지 않고 공용 도우미로만');
    assert.match(src, /workspace-drive-token\.ts/, f);
  }
});
