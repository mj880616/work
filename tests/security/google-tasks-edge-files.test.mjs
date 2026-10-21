import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createTaskFiles, notesWithFiles, fileLine, MAX_TASK_FILES, NOTES_MAX } from '../../supabase/functions/google-tasks/task-files.ts';

// TASK-파일붙이기: runs the real google-tasks handler (index.ts + task-files.ts + _shared/drive-upload.ts) for the file actions
// against a mocked Google Tasks API, a mocked Drive API and a mocked Supabase. The caller-JWT client follows the
// app_task_attachments owner RLS policy and its unique key; the service-role client refuses that table, so file links can only
// be reached through RLS. Drive is modeled as drive.file (only app files are visible). No network calls.
const SOURCE = stripTypeScriptTypes(
  readFileSync(new URL('../../supabase/functions/google-tasks/index.ts', import.meta.url), 'utf8').replace(/^import .*$/gm, ''),
  { mode: 'strip' }
);
const NOW = Date.parse('2026-10-21T14:00:00.000Z');
const LIB = 'library-folder', FOLDER_NAME = '할 일 첨부';
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function harness({ tasks = [{ id: 'task-1', title: '자료 준비', notes: '먼저 할 것\n둘째 줄', status: 'needsAction' }], files = [], folder = 'none',
  library = LIB, tableMissing = false, insertError = null, member = 'owner' } = {}) {
  const google = new Map(tasks.map(t => [t.id, { ...t }]));
  const state = { files: files.map((f, i) => ({ workspace_id: 'ws-a', mime_type: 'text/plain', size_bytes: 3, created_at: '2026-10-21T00:00:0' + i + '.000Z', ...f })) };
  const drive = { files: new Map(), calls: [], uploads: 0, deleted: [] };
  if (folder !== 'none') drive.files.set('task-folder', { id: 'task-folder', name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', ownedByMe: true, trashed: false, parents: [LIB], permissions: folder === 'shared' ? [{ type: 'user', role: 'owner' }, { type: 'anyone', role: 'reader' }] : [{ type: 'user', role: 'owner' }] });
  const googleCalls = [], logs = [], adminTables = [];
  let nextId = 1;
  const single = (rows, data) => { const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data, error: null }), single: async () => ({ data, error: null }) }; return b; };
  const admin = {
    auth: { getUser: async token => token === 'token-a' ? { data: { user: { id: 'user-a' } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT', status: 401 } } },
    from: table => {
      adminTables.push(table);
      if (table === 'app_google_calendar_connections') return single(null, { user_id: 'user-a', access_token: 'google-a', refresh_token: 'r', token_expires_at: new Date(NOW + 86400000).toISOString() });
      if (table === 'app_workspace_members') return single(null, member ? { workspace_id: 'ws-a', role: member } : null);
      if (table === 'public_policy_drive_config') return single(null, { google_client_id: 'cid', google_client_secret: 'secret', google_refresh_token: 'refresh' });
      if (table === 'app_drive_settings') return single(null, { library_folder_id: library });
      throw new Error('service role must not touch ' + table);
    }
  };
  const userDb = authorization => {
    const owned = new Set(authorization === 'Bearer token-a' ? ['ws-a'] : []);
    return {
      from: table => {
        if (table === 'app_record_links') { const b = { select: () => b, delete: () => b, update: () => b, eq: () => b, in: () => b, then: (ok, fail) => Promise.resolve({ data: [], error: null }).then(ok, fail) }; return b; }
        if (table !== 'app_task_attachments') throw new Error('unexpected user table ' + table);
        const q = { op: 'select', filters: [], cols: null, returning: false };
        const match = r => owned.has(r.workspace_id) && q.filters.every(f => f(r));
        const pick = r => q.cols ? Object.fromEntries(q.cols.split(',').map(k => [k, r[k]])) : { ...r };
        const run = () => {
          if (tableMissing) return { data: null, error: { code: 'PGRST205', message: 'relation not found' }, status: 404 };
          if (q.op === 'insert') {
            if (insertError) return { data: null, error: insertError, status: insertError.status || 400 };
            const r = { created_at: new Date(NOW + nextId++).toISOString(), mime_type: 'application/octet-stream', ...q.row };
            if (!owned.has(r.workspace_id)) return { data: null, error: { code: '42501', message: 'rls' }, status: 403 };
            if (state.files.some(x => x.workspace_id === r.workspace_id && x.drive_file_id === r.drive_file_id)) return { data: null, error: { code: '23505', message: 'dup' }, status: 409 };
            state.files.push(r);
            return { data: pick(r), error: null, status: 201 };
          }
          if (q.op === 'delete') {
            const gone = state.files.filter(match);
            state.files = state.files.filter(r => !match(r));
            return { data: q.returning ? gone.map(pick) : null, error: null, status: 200 };
          }
          return { data: state.files.filter(match).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(pick), error: null, status: 200 };
        };
        const b = {
          select: cols => { q.cols = cols; if (q.op !== 'select') q.returning = true; return b; },
          insert: row => { q.op = 'insert'; q.row = row; return b; },
          delete: () => { q.op = 'delete'; return b; },
          eq: (col, v) => { q.filters.push(r => r[col] === v); return b; },
          in: (col, vs) => { q.filters.push(r => vs.includes(r[col])); return b; },
          order: () => b,
          maybeSingle: async () => { const r = run(); return { ...r, data: Array.isArray(r.data) ? r.data[0] || null : r.data }; },
          then: (ok, fail) => Promise.resolve().then(run).then(ok, fail)
        };
        return b;
      }
    };
  };
  const fetchMock = async (url, init = {}) => {
    const u = new URL(String(url)), method = init.method || 'GET';
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/tokeninfo') return json({ scope: 'openid https://www.googleapis.com/auth/tasks' });
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') return json({ access_token: 'drive-token' });
    if (u.hostname === 'www.googleapis.com') {
      drive.calls.push({ method, path: u.pathname, q: u.searchParams.get('q') || '' });
      assert.equal(init.headers?.Authorization || 'Bearer drive-token', 'Bearer drive-token', 'Drive calls use the Drive token');
      if (u.pathname === '/drive/v3/files' && method === 'GET') {
        const q = u.searchParams.get('q');
        const found = [...drive.files.values()].filter(f => f.mimeType === 'application/vnd.google-apps.folder' && q.includes(`name = '${f.name}'`) && q.includes(`'${f.parents[0]}' in parents`) && !f.trashed);
        return json({ files: found });
      }
      if (u.pathname === '/drive/v3/files' && method === 'POST') {
        const body = JSON.parse(init.body); const id = 'new-folder-' + nextId++;
        drive.files.set(id, { id, name: body.name, mimeType: body.mimeType, ownedByMe: true, trashed: false, parents: body.parents, permissions: [{ type: 'user', role: 'owner' }] });
        return json({ id });
      }
      if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
        const meta = JSON.parse(init.body); drive.pendingParent = meta.parents[0]; drive.pendingName = meta.name;
        return new Response(null, { status: 200, headers: { location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=u' + nextId++ } });
      }
      if (u.pathname === '/upload/drive/v3/files' && method === 'PUT') {
        drive.uploads++; const id = 'file' + nextId++;
        drive.files.set(id, { id, name: drive.pendingName, parents: [drive.pendingParent], mimeType: 'text/plain' });
        return json({ id });
      }
      const one = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
      if (one && method === 'GET') { const f = drive.files.get(one[1]); return f ? json(f) : json({ error: { code: 404 } }, 404); }
      if (one && method === 'DELETE') { drive.deleted.push(one[1]); drive.files.delete(one[1]); return new Response(null, { status: 204 }); }
      throw new Error('unexpected Drive call ' + method + ' ' + url);
    }
    googleCalls.push({ method, path: decodeURIComponent(u.pathname), body: init.body ? JSON.parse(init.body) : null });
    const one = u.pathname.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks\/([^/]+)$/);
    if (!one) throw new Error('unexpected fetch ' + url);
    assert.equal(decodeURIComponent(one[1]), '@default');
    const t = google.get(decodeURIComponent(one[2]));
    if (!t) return json({ error: { code: 404, message: 'Task not found.' } }, 404);
    if (method === 'GET') return json(t);
    if (method === 'DELETE') { google.delete(t.id); return new Response(null, { status: 204 }); }
    Object.assign(t, JSON.parse(init.body));
    return json(t);
  };
  let handler = null;
  const Deno = { env: { get: key => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon' }[key]) }, serve: fn => { handler = fn; } };
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
  const consoleMock = { log: (...a) => logs.push(a.join(' ')), error: () => {}, warn: () => {} };
  const createClient = (_url, key, opts) => key === 'service' ? admin : userDb(opts?.global?.headers?.Authorization || '');
  new Function('Deno', 'createClient', 'createTaskFiles', 'fetch', 'Date', 'console', SOURCE)(Deno, createClient, createTaskFiles, fetchMock, FakeDate, consoleMock);
  const send = async (req) => { const r = await handler(req); return { status: r.status, body: await r.json() }; };
  const post = (action, body = {}, token = 'token-a') => send(new Request('https://sb.example/functions/v1/google-tasks?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ action, ...body }) }));
  const get = (action, params = {}, token = 'token-a') => send(new Request('https://sb.example/functions/v1/google-tasks?' + new URLSearchParams({ action, ...params }), { headers: token ? { Authorization: 'Bearer ' + token } : {} }));
  const attach = (taskId = 'task-1', file = new File(['abc'], '회의 자료.txt', { type: 'text/plain' }), token = 'token-a') => {
    const fd = new FormData(); if (taskId !== null) fd.append('task_id', taskId); if (file) fd.append('file', file);
    return send(new Request('https://sb.example/functions/v1/google-tasks?action=attach', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: fd }));
  };
  return { post, get, attach, state, google, drive, googleCalls, logs, adminTables };
}
const lineOf = (id, name) => fileLine({ drive_file_id: id, file_name: name });

test('notes lines: one per file at the end, user text kept, rebuilding is stable, removed files lose their line', () => {
  const files = [{ drive_file_id: 'f1', file_name: 'a.txt' }, { drive_file_id: 'f2', file_name: '두 번째\n이름.pdf' }];
  const once = notesWithFiles('메모\n\n', files);
  assert.equal(once, '메모\n첨부: a.txt https://drive.google.com/file/d/f1/view\n첨부: 두 번째 이름.pdf https://drive.google.com/file/d/f2/view');
  assert.equal(notesWithFiles(once, files), once, 'stable');
  assert.equal(notesWithFiles('', files.slice(0, 1)), lineOf('f1', 'a.txt'));
  assert.equal(notesWithFiles(once, files.slice(1), ['f1']), '메모\n' + lineOf('f2', '두 번째 이름.pdf'), 'a detached file loses its line');
  const moved = lineOf('f1', 'a.txt') + '\n메모 사이\n' + lineOf('f2', 'x');
  assert.equal(notesWithFiles(moved, files), '메모 사이\n' + files.map(fileLine).join('\n'), 'lines written elsewhere are moved to the end');
  assert.equal(notesWithFiles('남의 링크 https://drive.google.com/file/d/other/view', files.slice(0, 1)), '남의 링크 https://drive.google.com/file/d/other/view\n' + lineOf('f1', 'a.txt'), 'other Drive links stay');
});

test('attach: the file goes to Drive "할 일 첨부" under 자료실 (created once), the link row is saved by RLS, the notes keep the user text', async () => {
  const h = harness();
  const r = await h.attach();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.notes_synced, true);
  assert.equal(r.body.files.length, 1);
  const id = r.body.file.drive_file_id;
  const folder = [...h.drive.files.values()].find(f => f.name === FOLDER_NAME);
  assert.deepEqual(h.drive.files.get(id).parents, [folder.id]);
  assert.deepEqual(folder.parents, [LIB]);
  assert.equal(h.google.get('task-1').notes, '먼저 할 것\n둘째 줄\n' + lineOf(id, '회의 자료.txt'));
  assert.equal(r.body.task.notes, h.google.get('task-1').notes);
  assert.equal(r.body.task.taskListId, '@default', 'the task in the answer is normalized like other actions');
  assert.deepEqual(h.state.files.map(f => [f.workspace_id, f.google_task_id, f.file_name, f.size_bytes]), [['ws-a', 'task-1', '회의 자료.txt', 3]]);
  assert.ok(!h.adminTables.includes('app_task_attachments'));
  const again = await h.attach('task-1', new File(['de'], 'b.png', { type: 'image/png' }));
  assert.equal(again.status, 200);
  assert.equal(h.drive.calls.filter(c => c.method === 'POST' && c.path === '/drive/v3/files').length, 1, 'the folder is created once and found again');
  assert.equal(h.google.get('task-1').notes.split('\n').filter(l => l.startsWith('첨부: ')).length, 2);
  assert.deepEqual(h.drive.deleted, []);
});

test('attach: an existing private folder is reused; a shared one stops before any upload', async () => {
  const ok = harness({ folder: 'private' });
  assert.equal((await ok.attach()).status, 200);
  assert.equal(ok.drive.calls.filter(c => c.method === 'POST' && c.path === '/drive/v3/files').length, 0);
  const shared = harness({ folder: 'shared' });
  const r = await shared.attach();
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'drive_folder_not_private');
  assert.equal(shared.drive.uploads, 0);
  assert.deepEqual(shared.state.files, []);
  assert.equal(shared.google.get('task-1').notes, '먼저 할 것\n둘째 줄');
});

test('attach: limits and checks come before Drive (count, size, task, notes room, 자료실 folder, input shape)', async () => {
  const many = harness({ files: Array.from({ length: MAX_TASK_FILES }, (_, i) => ({ google_task_id: 'task-1', drive_file_id: 'old' + i, file_name: 'f' + i })) });
  assert.equal((await many.attach()).body.code, 'too_many_files');
  assert.equal(many.drive.calls.length, 0);
  const gone = harness();
  assert.deepEqual([(await gone.attach('no-such')).status, gone.drive.calls.length], [404, 0]);
  const long = harness({ tasks: [{ id: 'task-1', title: 't', notes: '가'.repeat(NOTES_MAX - 20), status: 'needsAction' }] });
  assert.equal((await long.attach()).body.code, 'notes_too_long');
  assert.equal(long.drive.calls.length, 0);
  const nolib = harness({ library: null });
  assert.equal((await nolib.attach()).body.code, 'library_folder_missing');
  assert.equal(nolib.drive.uploads, 0);
  for (const [taskId, file, code] of [[null, new File(['a'], 'a.txt'), 'task_id_invalid'], ['a/b', new File(['a'], 'a.txt'), 'task_id_invalid'], ['task-1', null, 'file_missing'], ['task-1', new File([], 'e.txt'), 'file_empty'], ['task-1', new File(['a'], 'bad\nname.txt'), 'file_metadata_invalid']]) {
    const h = harness();
    const r = await h.attach(taskId, file);
    assert.deepEqual([r.status, r.body.code], [400, code], code);
    assert.equal(h.drive.calls.length + h.googleCalls.length, 0, code);
  }
  const json = await harness().post('attach', { task_id: 'task-1' });
  assert.deepEqual([json.status, json.body.code], [400, 'invalid_request'], 'attach needs multipart');
  assert.equal((await harness({ member: 'editor' }).attach()).status, 403);
});

test('attach: a refused link row removes only the new Drive file; an unknown outcome keeps it', async () => {
  const refused = harness({ insertError: { code: '42501', message: 'rls', status: 403 } });
  const r = await refused.attach();
  assert.deepEqual([r.status, r.body.code], [500, 'attach_save_failed']);
  assert.equal(refused.drive.deleted.length, 1);
  assert.equal(refused.google.get('task-1').notes, '먼저 할 것\n둘째 줄');
  const unknown = harness({ insertError: { code: '', message: 'gateway', status: 502 } });
  const u = await unknown.attach();
  assert.deepEqual([u.status, u.body.code], [503, 'attach_result_unknown']);
  assert.deepEqual(unknown.drive.deleted, []);
});

test('the app reads the table itself: action=files is not an Edge action; attach and detach answer 503 while the table is missing', async () => {
  const h = harness();
  const r = await h.get('files', { task_ids: 'task-1' });
  assert.notEqual(r.status, 200);
  const missing = harness({ tableMissing: true });
  const a = await missing.attach();
  assert.deepEqual([a.status, a.body.code], [503, 'task_files_unavailable']);
  assert.equal(missing.drive.calls.length, 0, 'no Drive call without the table');
  const d = await missing.post('detach', { task_id: 'task-1', drive_file_id: 'f1' });
  assert.deepEqual([d.status, d.body.code], [503, 'task_files_unavailable']);
  assert.equal((await h.attach('task-1', undefined, null)).status, 401, 'no login, no attach');
});

test('update: an editor opened before the attach does not drop the file line; the user\'s new text is kept', async () => {
  const h = harness();
  const a = await h.attach();
  const line = lineOf(a.body.file.drive_file_id, '회의 자료.txt');
  const r = await h.post('update', { task_id: 'task-1', title: '자료 준비', notes: '고친 메모', due: null });
  assert.equal(r.status, 200);
  assert.equal(h.google.get('task-1').notes, '고친 메모\n' + line);
  await h.post('update', { task_id: 'task-1', title: '자료 준비', notes: h.google.get('task-1').notes + '\n덧붙임', due: null });
  assert.equal(h.google.get('task-1').notes, '고친 메모\n덧붙임\n' + line, 'still one line, at the end');
  const plain = harness({ tableMissing: true });
  await plain.post('update', { task_id: 'task-1', title: 't', notes: '그대로', due: null });
  assert.equal(plain.google.get('task-1').notes, '그대로', 'without the table the notes go as sent');
});

test('detach: the link and its notes line go, the Drive file stays; delete forgets every link of the task', async () => {
  const h = harness();
  const a = await h.attach(); const b = await h.attach('task-1', new File(['x'], 'b.txt'));
  const r = await h.post('detach', { task_id: 'task-1', drive_file_id: a.body.file.drive_file_id });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.files.map(f => f.drive_file_id), [b.body.file.drive_file_id]);
  assert.equal(h.google.get('task-1').notes, '먼저 할 것\n둘째 줄\n' + lineOf(b.body.file.drive_file_id, 'b.txt'));
  assert.deepEqual(h.drive.deleted, []);
  assert.ok(h.drive.files.has(a.body.file.drive_file_id), 'the Drive file stays');
  assert.equal((await h.post('detach', { task_id: 'task-1', drive_file_id: a.body.file.drive_file_id })).status, 404);
  assert.equal((await h.post('detach', { task_id: 'task-1', drive_file_id: '../x' })).status, 400);
  assert.equal((await h.post('detach', { task_id: 'task-1', drive_file_id: b.body.file.drive_file_id }, 'token-b')).status, 401);
  const del = await h.post('delete', { task_id: 'task-1' });
  assert.equal(del.status, 200);
  assert.deepEqual(h.state.files, []);
  assert.deepEqual(h.drive.deleted, [], 'deleting the task keeps the Drive files');
});

test('completing a task keeps its files', async () => {
  const h = harness();
  await h.attach();
  assert.equal((await h.post('toggle', { task_id: 'task-1', completed: true })).status, 200);
  assert.equal(h.state.files.length, 1);
});
