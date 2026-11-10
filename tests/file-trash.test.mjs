// FILE-첨부삭제: 첨부 ⋯ [삭제]·[되돌리기] — 서버(document-actions/file-trash.ts)와 화면 공용 부품(app/file-trash.js).
// 실제 Supabase·Drive는 부르지 않는다. 로그인 토큰 읽기(RLS: 내 작업공간 행만 보임)와 Drive HTTP 경계만 흉내 낸다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { trashFile, restoreFile, parseTrashRequest } = await import('../supabase/functions/document-actions/file-trash.ts');
const WS = '10000000-0000-4000-8000-000000000001', OTHER_WS = '10000000-0000-4000-8000-000000000009';
const NOTE = '20000000-0000-4000-8000-000000000001', FOREIGN = '20000000-0000-4000-8000-000000000002';
const T1 = '2026-11-10T01:00:00.000Z';
const att = (id, extra = {}) => ({ drive_file_id: id, file_name: id + '.html', mime_type: 'text/html', size_bytes: 33280, ...extra });

function harness({ notes, files, refs = {}, refThrows = false, patchMiss = 0, driveGet = {}, drivePatch = {}, tokenThrows = false } = {}) {
  const state = {
    notes: structuredClone(notes ?? [{ id: NOTE, workspace_id: WS, updated_at: T1, attachments: [att('f1'), att('f2')] }, { id: FOREIGN, workspace_id: OTHER_WS, updated_at: T1, attachments: [att('x1')] }]),
    files: new Map((files ?? [{ id: 'f1', name: 'f1.html', mimeType: 'text/html', size: '33280', ownedByMe: true, trashed: false }, { id: 'f2', name: 'f2.html', mimeType: 'text/html', size: '9', ownedByMe: true, trashed: false }]).map((f) => [f.id, { ...f }])),
  };
  const calls = { user: [], ref: [], drive: [] };
  let misses = patchMiss, clock = Date.parse(T1);
  const param = (path, key) => new URLSearchParams(path.split('?')[1]).get(key);
  const userDb = async (path, opts = {}) => {
    calls.user.push({ path, method: opts.method || 'GET', body: opts.body });
    assert.ok(path.startsWith('app_notes?'), '로그인 토큰으로는 노트만 읽고 쓴다: ' + path);
    // RLS 모형: 내 작업공간(WS) 행만 보인다.
    const id = param(path, 'id')?.replace(/^eq\./, ''), upd = param(path, 'updated_at')?.replace(/^eq\./, '');
    const rows = state.notes.filter((n) => n.workspace_id === WS && n.id === id && (!upd || n.updated_at === upd));
    if ((opts.method || 'GET') === 'GET') return structuredClone(rows);
    assert.equal(opts.method, 'PATCH');
    if (misses > 0) { misses--; return []; }
    for (const n of rows) { n.attachments = structuredClone(opts.body.attachments); n.updated_at = opts.body.updated_at; }
    return structuredClone(rows.map(({ id, updated_at, attachments }) => ({ id, updated_at, attachments })));
  };
  const refDb = async (path) => {
    calls.ref.push(path);
    if (refThrows) throw new Error('db');
    assert.equal(param(path, 'workspace_id'), 'eq.' + WS, '같은 파일 찾기는 RLS로 읽은 행의 작업공간만');
    const table = path.split('?')[0];
    return structuredClone(refs[table] ?? []);
  };
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET', id = decodeURIComponent(u.pathname.split('/').at(-1));
    calls.drive.push({ method, id, body: init.body, auth: init.headers?.Authorization });
    const send = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
    if (method === 'GET') { if (driveGet[id]) return send({}, driveGet[id]); const f = state.files.get(id); return f ? send(f) : send({}, 404); }
    if (drivePatch[id] === 'throw') throw new Error('net');
    if (drivePatch[id]) return send({}, drivePatch[id]);
    const f = state.files.get(id); f.trashed = JSON.parse(init.body).trashed; return send({ id, trashed: f.trashed });
  };
  const deps = { userDb, refDb, fetch, driveToken: async () => { if (tokenThrows) throw Object.assign(new Error('x'), { code: 'DRIVE_NOT_CONNECTED' }); return 'synthetic-token'; }, now: () => (clock += 1000) };
  return { state, calls, deps };
}
const req = (action, extra = {}) => ({ action, target: 'note', id: NOTE, drive_file_id: 'f1', ...extra });
const patches = (calls) => calls.drive.filter((c) => c.method === 'PATCH').map((c) => [c.id, JSON.parse(c.body)]);

test('요청 모양: 정해진 칸만(작업공간 값은 받지 않음), target은 note·task만', () => {
  assert.equal(parseTrashRequest(req('trash-file'), 'trash-file').id, NOTE);
  assert.throws(() => parseTrashRequest({ ...req('trash-file'), workspace_id: WS }, 'trash-file'), /확인할 수 없습니다/);
  assert.throws(() => parseTrashRequest(req('trash-file', { target: 'document' }), 'trash-file'));
  assert.throws(() => parseTrashRequest(req('trash-file', { drive_file_id: '../x' }), 'trash-file'));
  assert.throws(() => parseTrashRequest(req('restore-file'), 'trash-file'));
});

test('[삭제]: 노트에서 떼고(updated_at 맞을 때만) Drive 원본을 휴지통으로(trashed=true, 영구 삭제 없음)', async () => {
  const h = harness();
  const r = await trashFile(req('trash-file'), h.deps);
  assert.equal(r.ok, true); assert.equal(r.detached, true); assert.equal(r.drive, 'trashed');
  assert.deepEqual(h.state.notes[0].attachments.map((a) => a.drive_file_id), ['f2']);
  assert.equal(r.note.updated_at, h.state.notes[0].updated_at);
  assert.deepEqual(patches(h.calls), [['f1', { trashed: true }]]);
  assert.ok(!h.calls.drive.some((c) => c.method === 'DELETE'));
  assert.match(h.calls.user.find((c) => c.method === 'PATCH').path, new RegExp(`updated_at=eq\\.${encodeURIComponent(T1)}`));
  assert.equal(h.state.files.get('f1').trashed, true);
});

test('[삭제]: 남의 작업공간 노트는 RLS가 숨겨 NOT_FOUND, 붙지 않은 파일은 ATTACHMENT_NOT_FOUND — 아무것도 바꾸지 않음', async () => {
  const a = harness();
  await assert.rejects(trashFile(req('trash-file', { id: FOREIGN, drive_file_id: 'x1' }), a.deps), (e) => e.code === 'NOT_FOUND');
  const b = harness();
  await assert.rejects(trashFile(req('trash-file', { drive_file_id: 'zz' }), b.deps), (e) => e.code === 'ATTACHMENT_NOT_FOUND');
  for (const h of [a, b]) { assert.equal(h.calls.drive.length, 0); assert.ok(!h.calls.user.some((c) => c.method === 'PATCH')); }
});

test('[삭제]: 그사이 노트가 바뀌면 NOTE_CHANGED, Drive는 건드리지 않음', async () => {
  const h = harness({ patchMiss: 1 });
  await assert.rejects(trashFile(req('trash-file'), h.deps), (e) => e.code === 'NOTE_CHANGED');
  assert.equal(h.calls.drive.length, 0);
});

test('[삭제]: 다른 줄(휴지통 노트 포함·할 일·자료)이 같은 파일을 쓰거나 확인을 못 하면 Drive는 그대로(kept)', async () => {
  for (const refs of [{ app_notes: [{ id: 'n' }] }, { app_task_attachments: [{ drive_file_id: 'f1' }] }, { app_documents: [{ id: 'd' }] }]) {
    const h = harness({ refs });
    const r = await trashFile(req('trash-file'), h.deps);
    assert.equal(r.drive, 'kept'); assert.equal(h.calls.drive.length, 0);
    assert.deepEqual(h.state.notes[0].attachments.map((a) => a.drive_file_id), ['f2']);
  }
  const h = harness({ refThrows: true });
  assert.equal((await trashFile(req('trash-file'), h.deps)).drive, 'kept');
  assert.equal(h.calls.drive.length, 0);
});

test('[삭제]: 이 앱이 만든 내 파일이 아니면 휴지통에 보내지 않고 빼기만(not_ours), Drive 실패도 떼기는 유지', async () => {
  const notMine = harness({ files: [{ id: 'f1', ownedByMe: false, trashed: false, mimeType: 'text/html' }] });
  assert.equal((await trashFile(req('trash-file'), notMine.deps)).drive, 'not_ours');
  assert.deepEqual(patches(notMine.calls), []);
  const forbidden = harness({ driveGet: { f1: 403 } });
  assert.equal((await trashFile(req('trash-file'), forbidden.deps)).drive, 'not_ours');
  const folder = harness({ files: [{ id: 'f1', ownedByMe: true, trashed: false, mimeType: 'application/vnd.google-apps.folder' }] });
  assert.equal((await trashFile(req('trash-file'), folder.deps)).drive, 'not_ours');
  assert.deepEqual(patches(folder.calls), []);
  const gone = harness({ driveGet: { f1: 404 } });
  assert.equal((await trashFile(req('trash-file'), gone.deps)).drive, 'missing');
  const lost = harness({ drivePatch: { f1: 'throw' } });
  assert.equal((await trashFile(req('trash-file'), lost.deps)).drive, 'unknown');
  const noToken = harness({ tokenThrows: true });
  const r = await trashFile(req('trash-file'), noToken.deps);
  assert.equal(r.drive, 'failed'); assert.equal(r.detached, true);
});

test('[되돌리기]: Drive 휴지통에서 꺼내고 Drive가 알려 준 이름·종류·크기로 다시 붙인다', async () => {
  const h = harness();
  await trashFile(req('trash-file'), h.deps);
  const r = await restoreFile(req('restore-file'), h.deps);
  assert.equal(r.ok, true); assert.equal(r.restored, true);
  assert.equal(h.state.files.get('f1').trashed, false);
  assert.deepEqual(h.state.notes[0].attachments.at(-1), att('f1'));
  assert.deepEqual(patches(h.calls), [['f1', { trashed: true }], ['f1', { trashed: false }]]);
  // 두 번 눌러도 한 번만 붙는다.
  const again = await restoreFile(req('restore-file'), h.deps);
  assert.equal(again.already, true); assert.equal(h.state.notes[0].attachments.filter((a) => a.drive_file_id === 'f1').length, 1);
});

test('[되돌리기]: 남의 파일·없는 파일·남의 노트는 거절, 노트가 그사이 바뀌면 한 번 다시 읽어 붙인다', async () => {
  const notMine = harness({ notes: [{ id: NOTE, workspace_id: WS, updated_at: T1, attachments: [] }], files: [{ id: 'f1', ownedByMe: false, trashed: true }] });
  await assert.rejects(restoreFile(req('restore-file'), notMine.deps), (e) => e.code === 'DRIVE_FORBIDDEN');
  assert.deepEqual(patches(notMine.calls), []);
  const gone = harness({ notes: [{ id: NOTE, workspace_id: WS, updated_at: T1, attachments: [] }], files: [] });
  await assert.rejects(restoreFile(req('restore-file'), gone.deps), (e) => e.code === 'DRIVE_FILE_MISSING');
  const foreign = harness();
  await assert.rejects(restoreFile(req('restore-file', { id: FOREIGN, drive_file_id: 'x1' }), foreign.deps), (e) => e.code === 'NOT_FOUND');
  assert.equal(foreign.calls.drive.length, 0);
  const raced = harness({ notes: [{ id: NOTE, workspace_id: WS, updated_at: T1, attachments: [] }], patchMiss: 1 });
  raced.state.files.get('f1').trashed = true;
  assert.equal((await restoreFile(req('restore-file'), raced.deps)).restored, true);
  assert.deepEqual(raced.state.notes[0].attachments, [att('f1')]);
});

test('index.ts: trash-file·restore-file은 로그인 토큰(userDbFor)과 내 owner 작업공간 Drive 토큰(driveTokenFor)으로만', () => {
  const src = readFileSync(new URL('../supabase/functions/document-actions/index.ts', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf("action === 'trash-file'"), src.indexOf("action === 'dev-inbox'"));
  assert.match(block, /userDb: userDbFor\(token\)/);
  assert.match(block, /driveToken: driveTokenFor\(user\.id\)/);
  assert.doesNotMatch(block, /body\.workspace_id|workspaceId/);
  const lib = readFileSync(new URL('../supabase/functions/document-actions/file-trash.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(lib, /method: 'DELETE'/, 'Drive 영구 삭제는 쓰지 않는다');
});

// ── 화면 공용 부품 ──
const { deleteAttachment, trashResultText, FILE_TRASH_TEXT, confirmDeleteText } = await import('../app/file-trash.js');
function fakeRt(replies) {
  const sent = [];
  return { sent, api: async (path, opts) => { sent.push({ path, ...opts }); const r = replies.shift(); if (r instanceof Error) throw r; return r; } };
}
const spec = { target: 'note', id: NOTE, driveId: 'f1', name: 'f1.html' };

test('화면: 한 번 묻고(파일 이름 + 휴지통 30일 안내), 아니오면 아무 요청도 없음', async () => {
  const rt = fakeRt([]); let asked;
  const r = await deleteAttachment(spec, { rt, anchor: null, ask: async (_a, o) => { asked = o; return false; } });
  assert.equal(r.status, 'cancel'); assert.equal(rt.sent.length, 0);
  assert.equal(asked.text, confirmDeleteText('f1.html')); assert.equal(asked.note, FILE_TRASH_TEXT.ASK_NOTE); assert.equal(asked.ok, '삭제'); assert.equal(asked.danger, true);
});

test('화면: 휴지통에 가면 공용 되돌리기 알림, [되돌리기] = restore-file 후 다시 그리기', async () => {
  const rt = fakeRt([{ ok: true, detached: true, drive: 'trashed', drive_file_id: 'f1', note: { id: NOTE, updated_at: 'u2' } }, { ok: true, restored: true, note: { id: NOTE, updated_at: 'u3' } }]);
  const changed = []; let offered;
  const r = await deleteAttachment(spec, { rt, ask: async () => true, onChanged: (x) => changed.push(x), undo: (o) => { offered = o; } });
  assert.deepEqual(r, { status: 'deleted', drive: 'trashed' });
  assert.deepEqual(rt.sent[0].body, { action: 'trash-file', target: 'note', id: NOTE, drive_file_id: 'f1' });
  assert.equal(rt.sent[0].path, '/functions/v1/document-actions');
  assert.equal(offered.text, '삭제했어요');
  const back = await offered.onUndo();
  assert.equal(back.status, 'restored'); assert.equal(rt.sent[1].body.action, 'restore-file');
  assert.deepEqual(changed.map((c) => c?.note?.updated_at), ['u2', 'u3']);
});

test('화면: Drive에 남기는 경우는 되돌리기 없이 이유 한 줄, 실패는 다시 읽고 이유 글', async () => {
  for (const drive of ['kept', 'not_ours', 'failed', 'unknown', 'missing']) {
    const rt = fakeRt([{ ok: true, detached: true, drive, drive_file_id: 'f1', note: null }]); let said = '', offered = false;
    await deleteAttachment(spec, { rt, ask: async () => true, toast: (t) => { said = t; }, undo: () => { offered = true; } });
    assert.equal(offered, false); assert.equal(said, trashResultText(drive));
  }
  assert.match(trashResultText('not_ours'), /^빼기만 했어요/);
  const rt = fakeRt([Object.assign(new Error('기록이 그사이 바뀌었어요. 다시 불러온 뒤 지워 주세요.'), { status: 409 })]); const changed = [];
  const r = await deleteAttachment(spec, { rt, ask: async () => true, onChanged: (x) => changed.push(x) });
  assert.equal(r.status, 'failed'); assert.match(r.message, /그사이 바뀌었어요/); assert.deepEqual(changed, [null]);
  const rt5 = fakeRt([Object.assign(new Error('Internal secret'), { status: 503 })]);
  assert.equal((await deleteAttachment(spec, { rt: rt5, ask: async () => true })).message, FILE_TRASH_TEXT.FAILED_ALL);
});

// ── FILE-첨부삭제 ②(S56-45): 할 일 첨부(target:'task'). 떼기·다시 붙이기는 google-tasks, 여기는 휴지통만. ──
function taskHarness({ rows, refs = {}, files } = {}) {
  const state = {
    rows: structuredClone(rows ?? [{ workspace_id: WS, google_task_id: 'task-1', drive_file_id: 'f1' }, { workspace_id: OTHER_WS, google_task_id: 'task-9', drive_file_id: 'x1' }]),
    files: new Map((files ?? [{ id: 'f1', name: 'f1.html', mimeType: 'text/html', size: '9', ownedByMe: true, trashed: false }, { id: 'x1', ownedByMe: true, trashed: false }]).map((f) => [f.id, { ...f }])),
  };
  const calls = { user: [], ref: [], drive: [] };
  const param = (path, key) => new URLSearchParams(path.split('?')[1]).get(key)?.replace(/^eq\./, '');
  const userDb = async (path, opts = {}) => {
    calls.user.push({ path, method: opts.method || 'GET' });
    assert.ok(path.startsWith('app_task_attachments?'), '할 일 첨부는 그 표를 읽기만: ' + path);
    assert.equal(opts.method || 'GET', 'GET', '떼기·붙이기는 google-tasks가 한다');
    return structuredClone(state.rows.filter((r) => r.workspace_id === WS && r.google_task_id === param(path, 'google_task_id') && r.drive_file_id === param(path, 'drive_file_id')));
  };
  const refDb = async (path) => { calls.ref.push(path); assert.equal(param(path, 'workspace_id'), WS); return structuredClone(refs[path.split('?')[0]] ?? []); };
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET', id = decodeURIComponent(u.pathname.split('/').at(-1));
    calls.drive.push({ method, id, body: init.body });
    const send = (d, status = 200) => new Response(JSON.stringify(d), { status });
    const f = state.files.get(id); if (!f) return send({}, 404);
    if (method === 'GET') return send(f);
    f.trashed = JSON.parse(init.body).trashed; return send({ id, trashed: f.trashed });
  };
  return { state, calls, deps: { userDb, refDb, fetch, driveToken: async () => 'synthetic-token', now: () => Date.parse(T1) } };
}
const treq = (action, extra = {}) => ({ action, target: 'task', id: 'task-1', drive_file_id: 'f1', ...extra });

test('할 일 요청 모양: id는 Google 할 일 id 모양만, 작업공간 값은 받지 않음', () => {
  assert.deepEqual(parseTrashRequest(treq('trash-file'), 'trash-file'), { target: 'task', id: 'task-1', driveFileId: 'f1' });
  assert.throws(() => parseTrashRequest(treq('trash-file', { id: 'a/b' }), 'trash-file'));
  assert.throws(() => parseTrashRequest({ ...treq('trash-file'), workspace_id: WS }, 'trash-file'));
});

test('할 일 [삭제]: 지금 그 할 일에 붙어 있는지 확인한 뒤 휴지통(떼기는 하지 않음), 그 할 일 줄은 "쓰는 곳"으로 세지 않음', async () => {
  const h = taskHarness();
  const r = await trashFile(treq('trash-file'), h.deps);
  assert.equal(r.ok, true); assert.equal(r.detached, false); assert.equal(r.drive, 'trashed');
  assert.equal(h.state.files.get('f1').trashed, true);
  assert.ok(h.calls.ref.some((p) => p.startsWith('app_task_attachments?') && p.includes('google_task_id=neq.task-1')));
  assert.equal(h.state.rows.length, 2, '줄은 그대로(google-tasks detach가 뗀다)');
});

test('할 일 [삭제]: 남의 할 일·붙지 않은 파일은 ATTACHMENT_NOT_FOUND, 다른 기록이 쓰면 kept — Drive 손대지 않음', async () => {
  const a = taskHarness();
  await assert.rejects(trashFile(treq('trash-file', { id: 'task-9', drive_file_id: 'x1' }), a.deps), (e) => e.code === 'ATTACHMENT_NOT_FOUND');
  await assert.rejects(trashFile(treq('trash-file', { drive_file_id: 'x1' }), a.deps), (e) => e.code === 'ATTACHMENT_NOT_FOUND');
  assert.equal(a.calls.drive.length, 0);
  const b = taskHarness({ refs: { app_notes: [{ id: 'n' }] } });
  assert.equal((await trashFile(treq('trash-file'), b.deps)).drive, 'kept'); assert.equal(b.calls.drive.length, 0);
});

test('할 일 [되돌리기]: 다시 붙은 것을 확인한 뒤에만 휴지통에서 꺼냄, 안 붙어 있으면 거절', async () => {
  const off = taskHarness({ rows: [] }); off.state.files.get('f1').trashed = true;
  await assert.rejects(restoreFile(treq('restore-file'), off.deps), (e) => e.code === 'ATTACHMENT_NOT_FOUND');
  assert.equal(off.calls.drive.length, 0);
  const h = taskHarness(); h.state.files.get('f1').trashed = true;
  assert.equal((await restoreFile(treq('restore-file'), h.deps)).restored, true);
  assert.equal(h.state.files.get('f1').trashed, false);
  assert.equal((await restoreFile(treq('restore-file'), h.deps)).already, true);
  const notMine = taskHarness({ files: [{ id: 'f1', ownedByMe: false, trashed: true }] });
  await assert.rejects(restoreFile(treq('restore-file'), notMine.deps), (e) => e.code === 'DRIVE_FORBIDDEN');
});

const tspec = { target: 'task', id: 'task-1', driveId: 'f1', name: 'f1.html' };
test('화면 할 일: [삭제] = trash-file → google-tasks detach, [되돌리기] = reattach → restore-file', async () => {
  const detached = { ok: true, files: [], task: { id: 'task-1', notes: '' }, notes_synced: true };
  const reattached = { ok: true, files: [{ drive_file_id: 'f1', file_name: 'f1.html' }], task: { id: 'task-1' } };
  const rt = fakeRt([{ ok: true, detached: false, drive: 'trashed', drive_file_id: 'f1' }, detached, reattached, { ok: true, restored: true }]);
  const changed = []; let offered;
  const r = await deleteAttachment(tspec, { rt, ask: async () => true, onChanged: (x) => changed.push(x), undo: (o) => { offered = o; } });
  assert.deepEqual(r, { status: 'deleted', drive: 'trashed' });
  assert.deepEqual(rt.sent.map((s) => [s.path, s.body.action]), [['/functions/v1/document-actions', 'trash-file'], ['/functions/v1/google-tasks?action=detach', 'detach']]);
  assert.deepEqual(rt.sent[1].body, { action: 'detach', task_id: 'task-1', drive_file_id: 'f1' });
  assert.equal((await offered.onUndo()).status, 'restored');
  assert.deepEqual(rt.sent.slice(2).map((s) => [s.path, s.body.action]), [['/functions/v1/google-tasks?action=reattach', 'reattach'], ['/functions/v1/document-actions', 'restore-file']]);
  assert.deepEqual(changed, [{ task: detached }, { task: reattached }]);
});

test('화면 할 일: 떼기가 안 되면 휴지통에 보낸 원본을 꺼내 두고 실패, 이미 빠졌으면(404) 삭제로 봄', async () => {
  const rt = fakeRt([{ ok: true, drive: 'trashed', drive_file_id: 'f1' }, Object.assign(new Error('할 일 파일 정보를 불러오지 못했습니다.'), { status: 503 }), { ok: true, restored: true }]);
  const r = await deleteAttachment(tspec, { rt, ask: async () => true });
  assert.equal(r.status, 'failed'); assert.equal(rt.sent[2].body.action, 'restore-file');
  const gone = fakeRt([{ ok: true, drive: 'kept', drive_file_id: 'f1' }, Object.assign(new Error('이미 빠진 파일입니다.'), { status: 404 })]);
  const changed = []; let said = '';
  const g = await deleteAttachment(tspec, { rt: gone, ask: async () => true, onChanged: (x) => changed.push(x), toast: (t) => { said = t; } });
  assert.equal(g.status, 'deleted'); assert.deepEqual(changed, [{ task: null }]); assert.equal(said, FILE_TRASH_TEXT.KEPT);
});

test('화면 할 일: 다시 붙였지만 꺼내기가 안 되면 붙은 답으로 다시 그리고 실패 알림', async () => {
  const reattached = { ok: true, files: [{ drive_file_id: 'f1', file_name: 'f1.html' }] };
  const rt = fakeRt([{ ok: true, drive: 'trashed', drive_file_id: 'f1' }, { ok: true, files: [] }, reattached, Object.assign(new Error('x'), { status: 503 })]);
  const changed = []; let offered;
  await deleteAttachment(tspec, { rt, ask: async () => true, onChanged: (x) => changed.push(x), undo: (o) => { offered = o; } });
  const back = await offered.onUndo();
  assert.equal(back.status, 'failed'); assert.equal(back.message, FILE_TRASH_TEXT.RESTORE_FAILED);
  assert.deepEqual(changed.at(-1), { task: reattached });
});
