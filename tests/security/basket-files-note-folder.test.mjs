import test from 'node:test';
import assert from 'node:assert/strict';

// NOTE-파일붙이기: basket-files puts a note's (kind=note) files into "노트 첨부" inside the private "Web2 바구니" root.
// The folder is chosen from the stored row, never from the request; a shared folder is refused before any upload;
// updates (basket), diary rows and new rows keep using the root folder. Real handler + shared Drive code; only the
// Supabase SDK boundary and Google Drive HTTP are modeled.
const WS = '10000000-0000-4000-8000-000000000001';
const NOTE = '20000000-0000-4000-8000-000000000001';
const ROOT = 'basket-root', CHILD = 'note-files-folder';
const FOLDER = 'application/vnd.google-apps.folder';
const owner = [{type: 'user', role: 'owner'}];

function harness({kind = 'note', child = 'none', note = true, attachments = []} = {}) {
  const files = new Map([[ROOT, {id: ROOT, name: 'Web2 바구니', mimeType: FOLDER, ownedByMe: true, trashed: false, parents: ['my-root'], permissions: owner}]]);
  if (child !== 'none') files.set(CHILD, {id: CHILD, name: '노트 첨부', mimeType: FOLDER, ownedByMe: true, trashed: false,
    parents: [child === 'elsewhere' ? 'other-parent' : ROOT],
    permissions: child === 'shared' ? [...owner, {type: 'anyone', role: 'reader'}] : child === 'hidden' ? undefined : owner});
  const calls = {uploads: [], created: [], writes: [], deleted: []};
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
      const body = JSON.parse(init.body); const id = body.name === '노트 첨부' ? CHILD : 'made-' + (++n);
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
    const b = {select: () => b, eq: (k, v) => { filters.push([k, v]); return b; }, is: (k, v) => { filters.push([k, v]); return b; },
      update: p => { mutation = {kind: 'update', p}; return b; }, insert: p => { mutation = {kind: 'insert', p}; return b; },
      upsert: () => { mutation = {kind: 'upsert'}; return b; }, maybeSingle: () => exec(), single: () => exec(), then: (r, e) => exec().then(r, e)};
    async function exec() {
      if (table === 'app_workspace_members') return {data: {workspace_id: WS, role: 'owner'}, error: null};
      if (table === 'public_policy_drive_config') return {data: {google_client_id: 'c', google_client_secret: 's', google_refresh_token: 'r'}, error: null};
      if (table === 'app_drive_settings') return {data: {workspace_id: WS, basket_folder_id: ROOT}, error: null};
      if (table !== 'app_notes') throw new Error('unexpected table ' + table);
      if (mutation) {
        calls.writes.push({...mutation, filters});
        if (mutation.kind === 'insert') { state.note = {id: NOTE, updated_at: 't1', ...mutation.p}; return {data: {id: NOTE}, error: null, status: 201}; }
        const match = state.note && filters.every(([k, v]) => k === 'attachments' ? JSON.stringify(state.note[k]) === v : state.note[k] === v);
        if (!match) return {data: null, error: null, status: 200};
        state.note = {...state.note, ...mutation.p}; return {data: {id: NOTE}, error: null, status: 200};
      }
      const match = state.note && filters.every(([k, v]) => state.note[k] === v);
      return {data: match ? structuredClone(state.note) : null, error: null};
    }
    return b;
  }};
  return {admin, fetch, calls, state, files};
}
async function send(h, fields = {}) {
  const {createBasketHandler} = await import('../../supabase/functions/basket-files/handler.ts');
  const form = new FormData(); form.append('file', new File(['hello'], '회의 자료.pdf', {type: 'application/pdf'}));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await createBasketHandler(h.admin, {fetch: h.fetch, log: () => {}})(new Request('https://synthetic.invalid/functions/v1/basket-files',
    {method: 'POST', headers: {Authorization: 'Bearer synthetic-user-token'}, body: form}));
  return {status: res.status, body: await res.json()};
}

test('a note (kind=note) gets "노트 첨부" inside the private basket root, created once, and the link is saved on the note', async () => {
  const h = harness();
  const first = await send(h, {note_id: NOTE});
  assert.equal(first.status, 200);
  assert.deepEqual(h.calls.created, [{name: '노트 첨부', mimeType: FOLDER, parents: [ROOT]}]);
  assert.deepEqual(h.calls.uploads.map(u => u.parents), [[CHILD]]);
  assert.deepEqual(h.state.note.attachments, [{drive_file_id: 'drive-file-1', file_name: '회의 자료.pdf', mime_type: 'application/pdf', size_bytes: 5}]);
  // The save is guarded by the version read (updated_at + attachments) and the workspace.
  const save = h.calls.writes.at(-1);
  assert.deepEqual(save.filters.map(([k]) => k).sort(), ['attachments', 'id', 'updated_at', 'workspace_id']);
  const second = await send(h, {note_id: NOTE});
  assert.equal(second.status, 200);
  assert.equal(h.calls.created.length, 1, 'the folder is found again, never made twice');
  assert.deepEqual(h.calls.uploads.map(u => u.parents), [[CHILD], [CHILD]]);
  assert.equal(h.state.note.attachments.length, 2);
  assert.doesNotMatch(JSON.stringify([first.body, second.body]), new RegExp(`${CHILD}|${ROOT}`));
});

test('a shared "노트 첨부" folder (or one whose sharing cannot be read) is refused before any upload; no permission is touched', async () => {
  for (const [child, code] of [['shared', 'drive_folder_not_private'], ['hidden', 'drive_folder_permissions_unavailable']]) {
    const h = harness({child});
    const r = await send(h, {note_id: NOTE});
    assert.equal(r.status, 409, child); assert.equal(r.body.code, code, child);
    assert.equal(h.calls.uploads.length, 0, child); assert.equal(h.calls.writes.length, 0, child);
    assert.equal(h.calls.created.length, 0, child);
    assert.deepEqual(h.state.note.attachments, [], child);
  }
});

test('updates, diary rows and new rows keep the root folder; a request cannot pick the note folder', async () => {
  for (const kind of ['basket', 'diary']) {
    const h = harness({kind, child: 'private'});
    assert.equal((await send(h, {note_id: NOTE, folder: '노트 첨부', kind: 'note', folder_id: CHILD})).status, 200, kind);
    assert.deepEqual(h.calls.uploads.map(u => u.parents), [[ROOT]], kind);
    assert.equal(h.calls.created.length, 0, kind);
  }
  const fresh = harness({note: false});
  assert.equal((await send(fresh, {raw_text: '새 업데이트', kind: 'note', folder: '노트 첨부'})).status, 200);
  assert.deepEqual(fresh.calls.uploads.map(u => u.parents), [[ROOT]]);
  assert.equal(fresh.state.note.kind, undefined, 'a new row is never made a note by the request');
});

test('a note whose kind changed after the read (moved back to the basket) is not saved and its uploaded file is removed', async () => {
  const h = harness({child: 'private'});
  const {createBasketHandler} = await import('../../supabase/functions/basket-files/handler.ts');
  const realFrom = h.admin.from;
  // The first app_notes read sees kind=note; the row then changes (updated_at moves) before the guarded save.
  h.admin.from = table => { if (table === 'app_notes' && !h.moved && h.calls.uploads.length) { h.moved = true; h.state.note = {...h.state.note, kind: 'basket', updated_at: 't9'}; } return realFrom(table); };
  const form = new FormData(); form.append('file', new File(['x'], 'a.txt', {type: 'text/plain'})); form.append('note_id', NOTE);
  const res = await createBasketHandler(h.admin, {fetch: h.fetch, log: () => {}})(new Request('https://synthetic.invalid/functions/v1/basket-files',
    {method: 'POST', headers: {Authorization: 'Bearer synthetic-user-token'}, body: form}));
  assert.equal(res.status, 409); assert.equal((await res.json()).code, 'note_changed');
  assert.deepEqual(h.state.note.attachments, []);
  assert.equal(h.calls.deleted.length, 1, 'the orphan upload is cleaned up');
});

test('a "노트 첨부" folder outside the basket root is not adopted (a new private one is made under the root)', async () => {
  const h = harness({child: 'elsewhere'});
  h.files.delete(CHILD); h.files.set('stray', {id: 'stray', name: '노트 첨부', mimeType: FOLDER, ownedByMe: true, trashed: false, parents: ['other-parent'], permissions: owner});
  assert.equal((await send(h, {note_id: NOTE})).status, 200);
  assert.deepEqual(h.calls.created, [{name: '노트 첨부', mimeType: FOLDER, parents: [ROOT]}]);
  assert.deepEqual(h.calls.uploads.map(u => u.parents), [[CHILD]]);
});
