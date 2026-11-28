import test from 'node:test';
import assert from 'node:assert/strict';

// S71-49 NOTE-보드사진(사용자 결정 2026-11-26): 노트 보드에 넣는 사진(place=board)은 그 사람 맨 위 앱 폴더(app_drive_settings.root_folder_id,
// 서버가 그 작업공간 것만 읽음) 안 '보드 사진' 폴더로 간다. 폴더는 서버가 찾거나(같은 이름이 있으면 그것) 처음 넣을 때 만든다.
// 요청에 든 폴더 id는 읽지 않는다. 맨 위 앱 폴더를 모르거나 못 쓰면(없음·휴지통·내 것 아님) 또는 '보드 사진'이 공유돼 있으면 예전 자리('노트 첨부').
// 실제 handler + 공용 Drive 코드, Supabase SDK 경계와 Google Drive HTTP만 흉내. id·이름은 지어낸 것.
const WS = '10000000-0000-4000-8000-000000000001';
const NOTE = '20000000-0000-4000-8000-000000000001';
const ROOT = 'basket-root', CHILD = 'note-files-folder', TOP_NOTE = 'top-note-files-folder', APP_ROOT = 'app-root-folder', BOARD = 'board-photo-folder', OTHER_FOLDER = 'other-workspace-folder';
const FOLDER = 'application/vnd.google-apps.folder';
const owner = [{type: 'user', role: 'owner'}];

function harness({kind = 'note', child = 'none', note = true, attachments = [], appRoot = 'mine', board = 'none'} = {}) {
  const files = new Map([[ROOT, {id: ROOT, name: 'Web2 바구니', mimeType: FOLDER, ownedByMe: true, trashed: false, parents: ['my-root'], permissions: owner}]]);
  if (child !== 'none') files.set(CHILD, {id: CHILD, name: '노트 첨부', mimeType: FOLDER, ownedByMe: true, trashed: false,
    parents: [child === 'elsewhere' ? 'other-parent' : ROOT],
    permissions: child === 'shared' ? [...owner, {type: 'anyone', role: 'reader'}] : child === 'hidden' ? undefined : owner});
  // 맨 위 앱 폴더('WORK ON+'): mine = 내 폴더, trashed·shared-owner(남의 것)·gone(없음)·none(설정에 id 없음).
  if (!['none', 'gone'].includes(appRoot)) files.set(APP_ROOT, {id: APP_ROOT, name: 'WORK ON+', mimeType: FOLDER, ownedByMe: appRoot !== 'others', trashed: appRoot === 'trashed', parents: ['my-root'], permissions: owner});
  // 남의 작업공간 폴더(지어낸 id) — 요청에 넣어 보내도 쓰지 않아야 한다.
  files.set(OTHER_FOLDER, {id: OTHER_FOLDER, name: '보드 사진', mimeType: FOLDER, ownedByMe: true, trashed: false, parents: ['other-root'], permissions: owner});
  if (board !== 'none') files.set(BOARD, {id: BOARD, name: '보드 사진', mimeType: FOLDER, ownedByMe: true, trashed: false, parents: [APP_ROOT],
    permissions: board === 'shared' ? [...owner, {type: 'anyone', role: 'reader'}] : owner});
  const calls = {uploads: [], created: [], writes: [], deleted: [], settings: []};
  const state = {note: note ? {id: NOTE, workspace_id: WS, kind, raw_text: '', attachments, updated_at: 't0'} : null};
  let n = 0;
  const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json', ...headers}});
  const meta = (f, fields) => { const d = structuredClone(f); if (!fields?.includes('permissions')) delete d.permissions; return d; };
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET';
    if (u.hostname === 'oauth2.googleapis.com') return json({access_token: 'synthetic-drive-token'});
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') || '', fields = u.searchParams.get('fields') || '';
      const name = q.match(/name = '([^']+)'/)?.[1], parent = q.match(/'([^']+)' in parents/)?.[1];
      const found = [...files.values()].filter(f => f.mimeType === FOLDER && f.name === name && !f.trashed &&
        (parent === 'root' ? f.parents.includes('my-root') : f.parents.includes(parent)));
      return json({files: found.map(f => meta(f, fields))});
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(init.body); const id = body.name === '노트 첨부' ? (body.parents?.[0] === APP_ROOT ? TOP_NOTE : CHILD) : body.name === '보드 사진' ? BOARD : 'made-' + (++n);
      calls.created.push(body);
      files.set(id, {id, name: body.name, mimeType: body.mimeType, ownedByMe: true, trashed: false, parents: body.parents, permissions: owner});
      return json({id});
    }
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'GET') {
      const f = files.get(decodeURIComponent(u.pathname.split('/').at(-1)));
      return f ? json(meta(f, u.searchParams.get('fields'))) : json({error: 'notFound'}, 404);
    }
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'DELETE') { calls.deleted.push(u.pathname); return new Response(null, {status: 204}); }
    if (u.pathname === '/upload/drive/v3/files') {
      calls.uploads.push(JSON.parse(init.body));
      return new Response('{}', {status: 200, headers: {location: `https://www.googleapis.com/upload-session/${calls.uploads.length}`}});
    }
    if (u.pathname.startsWith('/upload-session/')) return json({id: 'drive-file-' + u.pathname.split('/').at(-1)});
    return json({error: 'unexpected'}, 500);
  };
  const admin = {auth: {getUser: async () => ({data: {user: {id: 'synthetic-owner'}}, error: null})}, from: table => {
    const filters = []; let mutation = null;
    const b = {select: () => b, eq: (k, v) => { filters.push([k, v]); return b; }, is: (k, v) => { filters.push([k, v, 'is']); return b; },
      update: p => { mutation = {kind: 'update', p}; return b; }, insert: p => { mutation = {kind: 'insert', p}; return b; },
      upsert: () => { mutation = {kind: 'upsert'}; return b; }, maybeSingle: () => exec(), single: () => exec(), then: (r, e) => exec().then(r, e)};
    async function exec() {
      if (table === 'app_workspace_members') return {data: {workspace_id: WS, role: 'owner'}, error: null};
      if (table === 'public_policy_drive_config') return {data: {google_client_id: 'c', google_client_secret: 's'}, error: null};
      if (table === 'app_drive_connections') return {data: {google_refresh_token: 'r'}, error: null};
      if (table === 'app_drive_settings') { calls.settings.push(filters.slice()); return {data: {workspace_id: WS, basket_folder_id: ROOT, root_folder_id: appRoot === 'none' ? null : APP_ROOT}, error: null}; }
      if (table !== 'app_notes') throw new Error('unexpected table ' + table);
      if (mutation) {
        calls.writes.push({...mutation, filters});
        if (mutation.kind === 'insert') { state.note = {id: NOTE, updated_at: 't1', ...mutation.p}; return {data: {id: NOTE}, error: null, status: 201}; }
        const match = state.note && filters.every(([k, v, op]) => op === 'is' ? (state.note[k] ?? null) === v : k === 'attachments' ? JSON.stringify(state.note[k]) === v : state.note[k] === v);
        if (!match) return {data: null, error: null, status: 200};
        state.note = {...state.note, ...mutation.p}; return {data: {id: NOTE}, error: null, status: 200};
      }
      const match = state.note && filters.every(([k, v, op]) => op === 'is' ? (state.note[k] ?? null) === v : state.note[k] === v);
      return {data: match ? structuredClone(state.note) : null, error: null};
    }
    return b;
  }};
  return {admin, fetch, calls, state, files};
}
async function send(h, fields = {}) {
  const {createBasketHandler} = await import('../../supabase/functions/basket-files/handler.ts');
  const form = new FormData(); form.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', {type: 'image/png'}));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await createBasketHandler(h.admin, {fetch: h.fetch, log: () => {}})(new Request('https://synthetic.invalid/functions/v1/basket-files',
    {method: 'POST', headers: {Authorization: 'Bearer synthetic-user-token'}, body: form}));
  return {status: res.status, body: await res.json()};
}

test('보드 사진(place=board): 맨 위 앱 폴더 안 "보드 사진"을 처음 한 번 만들고 거기 올린다, 다음에는 찾아 쓴다', async () => {
  const h = harness();
  const first = await send(h, {note_id: NOTE, place: 'board'});
  assert.equal(first.status, 200);
  assert.deepEqual(h.calls.created, [{name: '보드 사진', mimeType: FOLDER, parents: [APP_ROOT]}]);
  assert.deepEqual(h.calls.uploads.map(u => u.parents), [[BOARD]]);
  assert.equal(h.state.note.attachments.length, 1);
  // 맨 위 앱 폴더는 이 작업공간 설정에서만 읽는다(요청 값이 아니라 서버가 확인한 workspace_id).
  assert.ok(h.calls.settings.length && h.calls.settings.every(f => f.some(([k, v]) => k === 'workspace_id' && v === WS)));
  const second = await send(h, {note_id: NOTE, place: 'board'});
  assert.equal(second.status, 200);
  assert.equal(h.calls.created.length, 1, '폴더는 두 번 만들지 않는다');
  assert.deepEqual(h.calls.uploads.map(u => u.parents), [[BOARD], [BOARD]]);
  assert.doesNotMatch(JSON.stringify([first.body, second.body]), new RegExp(`${BOARD}|${APP_ROOT}`), '답에 폴더 id를 넣지 않는다');
});

test('이미 있는 "보드 사진" 폴더를 그대로 쓴다(새로 만들지 않음)', async () => {
  const h = harness({board: 'private'});
  assert.equal((await send(h, {note_id: NOTE, place: 'board'})).status, 200);
  assert.deepEqual(h.calls.created, []);
  assert.deepEqual(h.calls.uploads.map(u => u.parents), [[BOARD]]);
});

test('보안: 요청에 다른 작업공간 폴더 id를 넣어 보내도 무시하고 서버가 찾은 "보드 사진"에 올린다', async () => {
  const h = harness({board: 'private'});
  const r = await send(h, {note_id: NOTE, place: 'board', folder_id: OTHER_FOLDER, parent: OTHER_FOLDER, parents: OTHER_FOLDER, root_folder_id: OTHER_FOLDER, workspace_id: 'other'});
  assert.equal(r.status, 200);
  assert.deepEqual(h.calls.uploads.map(u => u.parents), [[BOARD]]);
  assert.equal(JSON.stringify(h.calls).includes(OTHER_FOLDER), false, '남의 폴더 id는 어떤 Drive 요청에도 쓰이지 않는다');
});

test('맨 위 앱 폴더를 모르거나 못 쓰면(없음·휴지통·내 것 아님) 예전처럼 "노트 첨부"에, 맨 위 앱 폴더를 몰래 만들지 않는다', async () => {
  for (const appRoot of ['none', 'gone', 'trashed', 'others']) {
    const h = harness({appRoot, child: 'private'});
    const r = await send(h, {note_id: NOTE, place: 'board'});
    assert.equal(r.status, 200, appRoot);
    assert.deepEqual(h.calls.uploads.map(u => u.parents), [[CHILD]], appRoot);
    assert.deepEqual(h.calls.created, [], appRoot);
  }
});

test('"보드 사진" 폴더가 공유돼 있으면 거기 올리지 않고 "노트 첨부"(NOTE-첨부폴더: 맨 위 앱 폴더 안)에, 권한은 건드리지 않는다', async () => {
  const h = harness({board: 'shared', child: 'private'});
  assert.equal((await send(h, {note_id: NOTE, place: 'board'})).status, 200);
  assert.deepEqual(h.calls.uploads.map(u => u.parents), [[TOP_NOTE]]);
  assert.deepEqual(h.calls.created, [{name: '노트 첨부', mimeType: FOLDER, parents: [APP_ROOT]}]);
});

test('place가 없으면 "노트 첨부"(NOTE-첨부폴더: 맨 위 앱 폴더 안), 업데이트(basket)·일기는 place=board여도 바구니 맨 위, 모르는 place는 400', async () => {
  const plain = harness({board: 'private', child: 'private'});
  assert.equal((await send(plain, {note_id: NOTE})).status, 200);
  assert.deepEqual(plain.calls.uploads.map(u => u.parents), [[TOP_NOTE]]);
  for (const kind of ['basket', 'diary']) {
    const h = harness({kind, board: 'private'});
    assert.equal((await send(h, {note_id: NOTE, place: 'board'})).status, 200, kind);
    assert.deepEqual(h.calls.uploads.map(u => u.parents), [[ROOT]], kind);
  }
  const bad = harness({board: 'private'});
  const r = await send(bad, {note_id: NOTE, place: OTHER_FOLDER});
  assert.equal(r.status, 400); assert.equal(r.body.code, 'place_invalid');
  assert.equal(bad.calls.uploads.length, 0); assert.equal(bad.calls.writes.length, 0);
});
