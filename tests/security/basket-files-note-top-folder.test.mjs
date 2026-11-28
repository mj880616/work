import test from 'node:test';
import assert from 'node:assert/strict';

// NOTE-첨부폴더(사용자 결정 2026-11-28 "Work on + 폴더 … 안에 노트 첨부 폴더를 만들고 거기다 모아"):
// 노트(kind=note)에 붙이는 파일은 맨 위 앱 폴더(app_drive_settings.root_folder_id — 서버가 그 작업공간 것만 읽음) 안 '노트 첨부'로 간다.
// 폴더는 서버가 저장된 행의 종류로 정하고(요청 값은 읽지 않음), 찾거나 처음 넣을 때 만든다. 새 자리가 공유돼 있으면 쓰지 않고,
// 맨 위 앱 폴더를 모르거나 못 쓰면 예전 자리(바구니 안 '노트 첨부'). 예전 자리도 공유돼 있으면 올리기 전에 거절.
// 자료실 목록(app_documents)에는 넣지 않는다. 업데이트·일기·새 행은 바구니 맨 위 그대로.
// 실제 handler + 공용 Drive 코드, Supabase SDK 경계와 Google Drive HTTP만 흉내. id·이름은 지어낸 것.
const WS = '10000000-0000-4000-8000-000000000001';
const NOTE = '20000000-0000-4000-8000-000000000001';
const ROOT = 'basket-root', OLD = 'old-note-files-folder', APP_ROOT = 'app-root-folder', TOP = 'top-note-files-folder', OTHER = 'other-workspace-folder';
const FOLDER = 'application/vnd.google-apps.folder';
const owner = [{type: 'user', role: 'owner'}];
const sharedPerms = [...owner, {type: 'anyone', role: 'reader'}];

function harness({kind = 'note', old = 'none', top = 'none', appRoot = 'mine'} = {}) {
  const files = new Map([[ROOT, {id: ROOT, name: 'Web2 바구니', mimeType: FOLDER, ownedByMe: true, trashed: false, parents: ['my-root'], permissions: owner}]]);
  if (old !== 'none') files.set(OLD, {id: OLD, name: '노트 첨부', mimeType: FOLDER, ownedByMe: true, trashed: false, parents: [ROOT], permissions: old === 'shared' ? sharedPerms : owner});
  if (!['none', 'gone'].includes(appRoot)) files.set(APP_ROOT, {id: APP_ROOT, name: 'WORK ON+', mimeType: FOLDER, ownedByMe: appRoot !== 'others', trashed: appRoot === 'trashed', parents: ['my-root'], permissions: owner});
  if (top !== 'none') files.set(TOP, {id: TOP, name: '노트 첨부', mimeType: FOLDER, ownedByMe: true, trashed: false, parents: [APP_ROOT],
    permissions: top === 'shared' ? sharedPerms : top === 'hidden' ? undefined : owner});
  files.set(OTHER, {id: OTHER, name: '노트 첨부', mimeType: FOLDER, ownedByMe: true, trashed: false, parents: ['other-root'], permissions: owner});
  const calls = {uploads: [], created: [], writes: [], tables: [], permissionWrites: []};
  const state = {note: {id: NOTE, workspace_id: WS, kind, raw_text: '', attachments: [], updated_at: 't0'}};
  const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json', ...headers}});
  const meta = (f, fields) => { const d = structuredClone(f); if (!fields?.includes('permissions')) delete d.permissions; return d; };
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET';
    if (u.hostname === 'oauth2.googleapis.com') return json({access_token: 'synthetic-drive-token'});
    if (u.pathname.includes('/permissions')) { calls.permissionWrites.push(method); return json({error: 'unexpected'}, 500); }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') || '', fields = u.searchParams.get('fields') || '';
      const name = q.match(/name = '([^']+)'/)?.[1], parent = q.match(/'([^']+)' in parents/)?.[1];
      const found = [...files.values()].filter(f => f.mimeType === FOLDER && f.name === name && !f.trashed &&
        (parent === 'root' ? f.parents.includes('my-root') : f.parents.includes(parent)));
      return json({files: found.map(f => meta(f, fields))});
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(init.body);
      const id = body.name === '노트 첨부' ? (body.parents?.[0] === APP_ROOT ? TOP : OLD) : 'made-' + calls.created.length;
      calls.created.push(body);
      files.set(id, {id, name: body.name, mimeType: body.mimeType, ownedByMe: true, trashed: false, parents: body.parents, permissions: owner});
      return json({id});
    }
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'GET') {
      const f = files.get(decodeURIComponent(u.pathname.split('/').at(-1)));
      return f ? json(meta(f, u.searchParams.get('fields'))) : json({error: 'notFound'}, 404);
    }
    if (u.pathname === '/upload/drive/v3/files') {
      calls.uploads.push(JSON.parse(init.body));
      return new Response('{}', {status: 200, headers: {location: `https://www.googleapis.com/upload-session/${calls.uploads.length}`}});
    }
    if (u.pathname.startsWith('/upload-session/')) return json({id: 'drive-file-' + u.pathname.split('/').at(-1)});
    return json({error: 'unexpected'}, 500);
  };
  const admin = {auth: {getUser: async () => ({data: {user: {id: 'synthetic-owner'}}, error: null})}, from: table => {
    calls.tables.push(table);
    const filters = []; let mutation = null;
    const b = {select: () => b, eq: (k, v) => { filters.push([k, v]); return b; }, is: (k, v) => { filters.push([k, v, 'is']); return b; },
      update: p => { mutation = {kind: 'update', p}; return b; }, insert: p => { mutation = {kind: 'insert', p}; return b; },
      upsert: () => { mutation = {kind: 'upsert'}; return b; }, maybeSingle: () => exec(), single: () => exec(), then: (r, e) => exec().then(r, e)};
    async function exec() {
      if (table === 'app_workspace_members') return {data: {workspace_id: WS, role: 'owner'}, error: null};
      if (table === 'public_policy_drive_config') return {data: {google_client_id: 'c', google_client_secret: 's'}, error: null};
      if (table === 'app_drive_connections') return {data: {google_refresh_token: 'r'}, error: null};
      if (table === 'app_drive_settings') return {data: {workspace_id: WS, basket_folder_id: ROOT, root_folder_id: appRoot === 'none' ? null : APP_ROOT}, error: null};
      if (table !== 'app_notes') throw new Error('unexpected table ' + table);
      if (mutation) {
        calls.writes.push({...mutation, filters});
        const match = filters.every(([k, v, op]) => op === 'is' ? (state.note[k] ?? null) === v : k === 'attachments' ? JSON.stringify(state.note[k]) === v : state.note[k] === v);
        if (!match) return {data: null, error: null, status: 200};
        state.note = {...state.note, ...mutation.p}; return {data: {id: NOTE}, error: null, status: 200};
      }
      const match = filters.every(([k, v, op]) => op === 'is' ? (state.note[k] ?? null) === v : state.note[k] === v);
      return {data: match ? structuredClone(state.note) : null, error: null};
    }
    return b;
  }};
  return {admin, fetch, calls, state};
}
async function send(h, fields = {}) {
  const {createBasketHandler} = await import('../../supabase/functions/basket-files/handler.ts');
  const form = new FormData(); form.append('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc.pdf', {type: 'application/pdf'}));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await createBasketHandler(h.admin, {fetch: h.fetch, log: () => {}})(new Request('https://synthetic.invalid/functions/v1/basket-files',
    {method: 'POST', headers: {Authorization: 'Bearer synthetic-user-token'}, body: form}));
  return {status: res.status, body: await res.json()};
}

test('새 노트 첨부는 맨 위 앱 폴더 안 "노트 첨부"로: 처음 한 번 만들고 다음에는 찾아 쓴다, 노트에 연결 저장', async () => {
  const h = harness({old: 'private'});
  const first = await send(h, {note_id: NOTE});
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(h.calls.created, [{name: '노트 첨부', mimeType: FOLDER, parents: [APP_ROOT]}]);
  assert.deepEqual(h.calls.uploads.map(u => u.parents), [[TOP]]);
  assert.equal(h.state.note.attachments.length, 1);
  const second = await send(h, {note_id: NOTE});
  assert.equal(second.status, 200);
  assert.equal(h.calls.created.length, 1, '폴더는 두 번 만들지 않는다');
  assert.deepEqual(h.calls.uploads.map(u => u.parents), [[TOP], [TOP]]);
  assert.doesNotMatch(JSON.stringify([first.body, second.body]), new RegExp(`${TOP}|${APP_ROOT}`), '답에 폴더 id를 넣지 않는다');
});

test('자료실 목록에는 넣지 않는다: app_documents·자료실 표를 건드리지 않고 노트 첨부 칸만 쓴다', async () => {
  const h = harness({top: 'private'});
  assert.equal((await send(h, {note_id: NOTE})).status, 200);
  assert.equal(h.calls.tables.some(t => /^app_(documents|library)/.test(t)), false);
  assert.deepEqual(h.calls.writes.map(w => Object.keys(w.p).sort()), [['attachments', 'updated_at']]);
});

test('보안: 요청에 다른 폴더 id를 넣어 보내도 무시하고 서버가 찾은 "노트 첨부"에 올린다', async () => {
  const h = harness({top: 'private'});
  const r = await send(h, {note_id: NOTE, folder_id: OTHER, parent: OTHER, parents: OTHER, root_folder_id: OTHER, workspace_id: 'other'});
  assert.equal(r.status, 200);
  assert.deepEqual(h.calls.uploads.map(u => u.parents), [[TOP]]);
  assert.equal(JSON.stringify(h.calls).includes(OTHER), false, '남의 폴더 id는 어떤 Drive 요청에도 쓰이지 않는다');
});

test('새 자리 "노트 첨부"가 공유돼 있거나 공유 상태를 못 읽으면 거기 올리지 않는다(예전 자리로), 권한은 건드리지 않는다', async () => {
  for (const top of ['shared', 'hidden']) {
    const h = harness({top, old: 'private'});
    assert.equal((await send(h, {note_id: NOTE})).status, 200, top);
    assert.deepEqual(h.calls.uploads.map(u => u.parents), [[OLD]], top);
    assert.deepEqual(h.calls.created, [], top);
    assert.deepEqual(h.calls.permissionWrites, [], top);
  }
});

test('새 자리도 옛 자리도 공유돼 있으면 올리기 전에 거절, 아무것도 올리거나 저장하지 않는다', async () => {
  const h = harness({top: 'shared', old: 'shared'});
  const r = await send(h, {note_id: NOTE});
  assert.equal(r.status, 409); assert.equal(r.body.code, 'drive_folder_not_private');
  assert.equal(h.calls.uploads.length, 0); assert.equal(h.calls.writes.length, 0); assert.deepEqual(h.calls.permissionWrites, []);
});

test('맨 위 앱 폴더를 모르거나 못 쓰면(없음·휴지통·내 것 아님) 예전처럼 바구니 안 "노트 첨부", 맨 위 앱 폴더를 몰래 만들지 않는다', async () => {
  for (const appRoot of ['none', 'gone', 'trashed', 'others']) {
    const h = harness({appRoot, old: 'private'});
    const r = await send(h, {note_id: NOTE});
    assert.equal(r.status, 200, appRoot);
    assert.deepEqual(h.calls.uploads.map(u => u.parents), [[OLD]], appRoot);
    assert.deepEqual(h.calls.created, [], appRoot);
  }
});

test('업데이트(basket)·일기·새 행(note_id 없음)은 지금처럼 바구니 맨 위', async () => {
  for (const kind of ['basket', 'diary']) {
    const h = harness({kind, top: 'private'});
    assert.equal((await send(h, {note_id: NOTE})).status, 200, kind);
    assert.deepEqual(h.calls.uploads.map(u => u.parents), [[ROOT]], kind);
  }
  const fresh = harness({top: 'private'});
  const r = await send(fresh, {raw_text: '새 업데이트'});
  assert.equal(r.status, 200);
  assert.deepEqual(fresh.calls.uploads.map(u => u.parents), [[ROOT]]);
});
