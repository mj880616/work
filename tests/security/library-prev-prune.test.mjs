// LIB-이전파일정리: 모델(30일·보관), 서버 정리 규칙, drive-summary 동작, Drive 휴지통 공용 코드, library-files 보관 동작, 스크립트·workflow.
// 가짜 PostgREST·Drive만 쓴다. 네트워크·실제 파일 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileNameTitle, isMeaninglessName } from '../../supabase/functions/_shared/library-file-name.mjs';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import * as model from '../../app/library-prev-model.mjs';
import * as edgeModel from '../../supabase/functions/_shared/library-prev-model.mjs';
import { runLibraryPrevPrune, PREV_PRUNE } from '../../supabase/functions/drive-summary/library-prev-prune.mjs';
import { createHandler } from '../../supabase/functions/drive-summary/core.mjs';
import { inspectDriveFile, moveDriveFileToTrash, trashDriveFile } from '../../supabase/functions/_shared/drive-trash.ts';
import { runPrune, PruneFailure } from '../../scripts/ops/library-prev-prune.mjs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const DAY = 86400000;
const NOW = new Date('2026-11-30T18:47:00Z');
const iso = ms => new Date(ms).toISOString();
const ago = days => iso(NOW.getTime() - days * DAY);
const WS = '11111111-1111-4111-8111-111111111111';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entry = (file, days, extra = {}) => ({ file_id: file, file_name: `비공개 ${file}.pdf`, mime_type: 'application/pdf', file_size: 10, drive_url: `https://drive.example/${file}`, replaced_at: ago(days), ...extra });

test('Edge model is a byte-for-byte deployment copy of the browser model', () => {
  const banner = '// Source of truth: app/library-prev-model.mjs.\n// Deployment-local copy; the regression compares everything below this banner byte for byte.\n';
  const copy = read('../../supabase/functions/_shared/library-prev-model.mjs');
  assert.ok(copy.startsWith(banner));
  assert.equal(copy.slice(banner.length), read('../../app/library-prev-model.mjs'));
  assert.deepEqual(Object.keys(edgeModel).sort(), Object.keys(model).sort());
});

test('model: 30 days from the replace day, label counts down, keep and un-keep restart the clock', () => {
  const now = NOW.getTime();
  assert.equal(model.entryState(entry('a', 12), now).state, 'waiting');
  assert.equal(model.entryState(entry('a', 12), now).daysLeft, 18);
  assert.equal(model.deleteLabel(entry('a', 18), now), '12일 뒤 삭제');
  assert.equal(model.entryState(entry('a', 30), now).state, 'due');
  assert.equal(model.entryState(entry('a', 29.5), now).daysLeft, 1);
  assert.equal(model.deleteLabel(entry('a', 31), now), '곧 삭제');
  assert.equal(model.entryState(entry('a', 99, { replaced_at: 'nonsense' }), now).state, 'unknown');
  const kept = model.setKeep([entry('a', 99)], 'a', true, iso(now));
  assert.equal(kept.changed, true);
  assert.equal(model.entryState(kept.list[0], now).state, 'kept');
  assert.equal(model.deleteLabel(kept.list[0], now), '보관');
  assert.equal(model.setKeep(kept.list, 'a', true, iso(now)).changed, false);
  const released = model.setKeep(kept.list, 'a', false, iso(now));
  assert.equal(released.list[0].keep_at, undefined);
  assert.equal(model.entryState(released.list[0], now).daysLeft, 30, 'a released file gets a fresh 30 days, not an instant trash');
  assert.equal(model.setKeep([entry('a', 1)], 'zz', true, iso(now)).error, 'not_found');
  const pruned = model.markPruned([entry('a', 40)], 'a', 'trashed', iso(now)).list;
  assert.equal(model.setKeep(pruned, 'a', true, iso(now)).error, 'already_pruned');
  assert.equal(model.visibleEntries(pruned).length, 0);
  assert.equal(model.markPruned(kept.list, 'a', 'trashed', iso(now)).changed, false, 'a kept file is never marked');
  assert.equal(model.markPruned([entry('a', 40)], 'a', 'weird', iso(now)).changed, false);
  const src = [entry('a', 40)];
  model.setKeep(src, 'a', true, iso(now));
  assert.equal(src[0].keep_at, undefined, 'pure: input is not mutated');
});

// 가짜 PostgREST(자료·노트·할 일 첨부)와 가짜 Drive.
function world({ docs, notes = [], tasks = [], driveAnswers = {}, failRef = false, racing = false } = {}) {
  const rows = structuredClone(docs), log = { patches: [], gets: [], trashed: [], inspected: [] };
  const matches = (row, params) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      if (v.startsWith('eq.')) { if (String(row[k]) !== v.slice(3)) return false; }
      else if (v.startsWith('neq.') && k === 'id') { if (row.id === v.slice(4)) return false; }
      else if (v === 'neq.[]') { if (JSON.stringify(row[k]) === '[]') return false; }
      else if (v === 'is.null') { if (row[k] != null) return false; }
      else if (v.startsWith('cs.')) {
        const want = JSON.parse(v.slice(3));
        if (!Array.isArray(row[k]) || !want.every(w => row[k].some(x => Object.entries(w).every(([a, b]) => x[a] === b)))) return false;
      } else throw new Error(`unsupported ${k}=${v}`);
    }
    return true;
  };
  const db = {
    async get(path) {
      log.gets.push(path);
      const url = new URL('https://x/' + path), table = url.pathname.slice(1), params = [...url.searchParams];
      if (failRef && table !== 'app_documents') return null;
      const src = table === 'app_documents' ? rows : table === 'app_notes' ? notes : tasks;
      let hit = src.filter(r => matches(r, params));
      const off = Number(url.searchParams.get('offset') || 0), lim = Number(url.searchParams.get('limit') || 1000);
      return hit.slice(off, off + lim).map(r => structuredClone(r));
    },
    async patch(path, body) {
      const url = new URL('https://x/' + path), params = [...url.searchParams];
      assert.equal(url.pathname.slice(1), 'app_documents');
      assert.deepEqual(Object.keys(body), ['previous_files'], 'only previous_files is written (not updated_at, not the current file)');
      assert.ok(params.some(([k, v]) => k === 'workspace_id' && v === `eq.${WS}`));
      log.patches.push({ path, body });
      if (racing && log.patches.length === 1) { rows.forEach(r => { r.updated_at = '2026-11-30T00:00:00.000Z'; }); }
      const hit = rows.filter(r => matches(r, params));
      hit.forEach(r => { r.previous_files = body.previous_files; });
      return hit.map(r => ({ id: r.id }));
    },
  };
  const drive = {
    async inspect(f) { log.inspected.push(f); return driveAnswers[f] === 'trashed' ? 'ready' : driveAnswers[f] || 'ready'; },
    async trash(f) { log.trashed.push(f); return driveAnswers[f] || 'trashed'; },
  };
  return { rows, db, drive, log };
}
const doc = (n, previous, extra = {}) => ({ id: id(n), workspace_id: WS, file_id: `current${n}`, title: `제목 ${n}`, previous_files: previous, updated_at: '2026-11-01T00:00:00.123456+00:00', ...extra });
const run = (w, o = {}) => runLibraryPrevPrune({ db: w.db, drive: w.drive, workspaceId: WS, now: () => NOW, ...o });

test('prune: only expired, not-kept previous files go to the trash; marks are recorded; current file, other files and the document row stay', async () => {
  const w = world({ docs: [
    doc(1, [entry('old1', 40), entry('young1', 5), entry('kept1', 90, { keep_at: ago(3) }), entry('gone1', 90, { pruned_at: ago(10), prune_result: 'trashed' })]),
    doc(2, [entry('old2', 31)]), doc(3, []),
  ] });
  const r = await run(w);
  assert.deepEqual(w.log.trashed.sort(), ['old1', 'old2']);
  assert.equal(r.trashed, 2); assert.equal(r.due, 2); assert.equal(r.kept, 1); assert.equal(r.waiting, 1); assert.equal(r.pruned, 1);
  const d1 = w.rows[0].previous_files, byId = f => d1.find(e => e.file_id === f);
  assert.equal(byId('old1').prune_result, 'trashed'); assert.match(byId('old1').pruned_at, /^2026-11-30T/);
  assert.equal(byId('young1').pruned_at, undefined); assert.equal(byId('kept1').pruned_at, undefined);
  assert.equal(w.rows[0].file_id, 'current1'); assert.equal(w.rows[0].updated_at, '2026-11-01T00:00:00.123456+00:00');
  assert.equal(w.rows.length, 3);
  assert.equal(w.log.patches.length, 2, 'one write per document');
  assert.ok(!JSON.stringify(r).includes('비공개'), 'counts only');
});

test('prune: files outside the library folder are only dropped from the list; temporary errors change nothing', async () => {
  const w = world({ docs: [doc(1, [entry('outside', 40), entry('flaky', 40), entry('unclear', 40), entry('already', 40)])], driveAnswers: { outside: 'not_ours', flaky: 'retry', unclear: 'unknown', already: 'already_trashed' } });
  const r = await run(w);
  assert.equal(r.list_only, 1); assert.equal(r.retry, 1); assert.equal(r.unknown, 1); assert.equal(r.already_trashed, 1);
  const list = w.rows[0].previous_files, byId = f => list.find(e => e.file_id === f);
  assert.equal(byId('outside').prune_result, 'list_only');
  assert.equal(byId('already').prune_result, 'trashed');
  assert.equal(byId('flaky').pruned_at, undefined); assert.equal(byId('unclear').pruned_at, undefined);
});

test('prune: a file another record still uses is left alone; an unreadable reference table stops the job', async () => {
  const w = world({ docs: [doc(1, [entry('sharedNote', 40), entry('sharedDoc', 40), entry('sharedPrev', 40), entry('sharedTask', 40), entry('free', 40)]), doc(2, [entry('sharedPrev', 1)], { file_id: 'sharedDoc' })],
    notes: [{ id: 'n1', attachments: [{ drive_file_id: 'sharedNote' }] }], tasks: [{ id: 't1', drive_file_id: 'sharedTask' }] });
  const r = await run(w);
  assert.deepEqual(w.log.trashed, ['free']); assert.equal(r.referenced, 4);
  const bad = world({ docs: [doc(1, [entry('x', 40)])], failRef: true });
  await assert.rejects(run(bad), /REFERENCE_UNAVAILABLE/);
  assert.deepEqual(bad.log.trashed, []);
});

test('prune: nightly cap, oldest first; the rest waits for the next night', async () => {
  const list = Array.from({ length: 7 }, (_, i) => entry(`f${i}`, 40 + i));
  const w = world({ docs: [doc(1, list)] });
  const r = await run(w, { limits: { ...PREV_PRUNE, maxPerRun: 3 } });
  assert.deepEqual(w.log.trashed, ['f6', 'f5', 'f4']); assert.equal(r.deferred, 4);
});

test('prune: a write that races with another edit is re-read and re-applied, never overwriting the newer list', async () => {
  const w = world({ docs: [doc(1, [entry('old', 40)])], racing: true });
  // first guarded write misses because updated_at changed under it; the retry re-reads and succeeds
  const originalPatch = w.db.patch;
  let first = true;
  w.db.patch = async (p, b) => { if (first) { first = false; w.rows[0].updated_at = '2026-11-30T00:00:00.000Z'; w.rows[0].previous_files = [entry('old', 40), entry('replacedNew', 0)]; } return originalPatch(p, b); };
  const r = await run(w);
  assert.equal(r.conflict, 0);
  assert.deepEqual(w.rows[0].previous_files.map(e => e.file_id), ['old', 'replacedNew']);
  assert.equal(w.rows[0].previous_files[0].prune_result, 'trashed');
  assert.equal(w.rows[0].previous_files[1].pruned_at, undefined);
});

test('dry run: counts only, reads Drive metadata but writes nothing and trashes nothing', async () => {
  const w = world({ docs: [doc(1, [entry('a', 40), entry('b', 40), entry('c', 40), entry('d', 10)])], driveAnswers: { b: 'not_ours', c: 'retry' } });
  const r = await run(w, { dryRun: true });
  assert.equal(r.dry_run, true);
  assert.deepEqual([r.due, r.would_trash, r.would_list_only, r.retry, r.waiting], [3, 1, 1, 1, 1]);
  assert.equal(w.log.patches.length, 0); assert.equal(w.log.trashed.length, 0);
  assert.deepEqual(w.rows[0].previous_files, doc(1, [entry('a', 40), entry('b', 40), entry('c', 40), entry('d', 10)]).previous_files);
});

// drive-summary 처리기: 크론 비밀값만, 자료실 폴더가 없으면 멈춤, 응답은 건수만.
function handlerWorld({ library = 'libFolder', cronOnly = true, trashAnswers = {} } = {}) {
  const w = world({ docs: [doc(1, [entry('old', 40)])] });
  const seen = { drive: [] };
  const fetcher = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'access' });
    if (url.hostname === 'db.test') {
      const table = url.pathname.split('/').at(-1);
      if (table === 'app_workspaces') return Response.json([{ id: WS }]);
      if (table === 'app_drive_settings') return Response.json(library ? [{ library_folder_id: library }] : []);
      if (table === 'public_policy_drive_config') return Response.json([{ google_client_id: 'c', google_client_secret: 's', google_refresh_token: 'r' }]);
      const path = table + url.search.replaceAll('%2C', ',');
      const method = init.method || 'GET';
      if (method === 'GET') return Response.json(await w.db.get(table + url.search));
      if (method === 'PATCH') return Response.json(await w.db.patch(table + url.search, JSON.parse(init.body)));
      void path;
    }
    throw new Error('unexpected ' + input);
  };
  const driveTrash = { inspect: async (f, id2, folder, token) => { seen.drive.push(['inspect', id2, folder, token]); return 'ready'; }, trash: async (f, id2, folder, token) => { seen.drive.push(['trash', id2, folder, token]); return trashAnswers[id2] || 'trashed'; } };
  const handler = createHandler({ env: { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', DRIVE_SUMMARY_CRON_SECRET: 'cron-secret' }, fetcher, now: () => NOW, driveTrash });
  return { w, seen, handler };
}
const post = (h, qs, headers) => h.handler(new Request('https://x/functions/v1/drive-summary?action=library_prev_prune' + qs, { method: 'POST', headers }));

test('drive-summary: library_prev_prune needs the cron secret; a wrong or missing secret does nothing', async () => {
  const h = handlerWorld();
  assert.equal((await post(h, '', {})).status, 401);
  assert.equal((await post(h, '', { Authorization: 'Bearer user-token' })).status, 401);
  assert.equal((await post(h, '', { 'x-drive-summary-cron-secret': 'wrong' })).status, 401);
  assert.equal((await post(h, '&dry_run=2', { 'x-drive-summary-cron-secret': 'cron-secret' })).status, 400);
  assert.equal(h.seen.drive.length, 0); assert.equal(h.w.log.patches.length, 0);
});

test('drive-summary: real run trashes inside the library folder only and answers with counts; dry run writes nothing', async () => {
  const h = handlerWorld();
  const dry = await post(h, '&dry_run=1', { 'x-drive-summary-cron-secret': 'cron-secret' });
  assert.equal(dry.status, 200);
  const dryBody = await dry.json();
  assert.equal(dryBody.dry_run, true); assert.equal(dryBody.would_trash, 1);
  assert.equal(h.w.log.patches.length, 0); assert.deepEqual(h.seen.drive.map(d => d[0]), ['inspect']);
  const real = await post(h, '', { 'x-drive-summary-cron-secret': 'cron-secret' });
  const body = await real.json();
  assert.equal(real.status, 200); assert.equal(body.trashed, 1);
  assert.deepEqual(h.seen.drive.at(-1), ['trash', 'old', 'libFolder', 'access']);
  assert.ok(!JSON.stringify(body).includes('old') && !JSON.stringify(body).includes('비공개'));
  assert.equal(h.w.rows[0].previous_files[0].prune_result, 'trashed');
});

test('drive-summary: without a stored library folder nothing is read or trashed', async () => {
  const h = handlerWorld({ library: null });
  const r = await post(h, '', { 'x-drive-summary-cron-secret': 'cron-secret' });
  assert.equal(r.status, 409); assert.equal((await r.json()).error, 'LIBRARY_FOLDER_MISSING');
  assert.equal(h.seen.drive.length, 0);
});

test('drive-summary: without the Drive trash helper the action refuses (old deployment shape)', async () => {
  const handler = createHandler({ env: { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', DRIVE_SUMMARY_CRON_SECRET: 'cron-secret' }, fetcher: async () => { throw new Error('no network'); } });
  const r = await handler(new Request('https://x/?action=library_prev_prune', { method: 'POST', headers: { 'x-drive-summary-cron-secret': 'cron-secret' } }));
  assert.equal(r.status, 502); assert.equal((await r.json()).error, 'SERVER_CONFIG_MISSING');
});

// Drive 휴지통 공용 코드: PATCH trashed=true만, 영구 삭제 없음, "내 것 아님"과 "일시 오류"를 구분.
function driveFetch(meta, { patch = () => Response.json({ id: 'f', trashed: true }), status = 200, body } = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url)]);
    if (!init.method) return status === 200 ? Response.json(meta) : Response.json(body || {}, { status });
    return patch();
  };
  return { fn, calls };
}
const goodMeta = { id: 'f', mimeType: 'application/pdf', ownedByMe: true, trashed: false, parents: ['lib'] };
test('drive-trash: trashes an owned file directly in the folder with PATCH trashed=true and never DELETE', async () => {
  const d = driveFetch(goodMeta);
  assert.equal(await moveDriveFileToTrash(d.fn, 'f', 'lib', 'tok'), 'trashed');
  assert.deepEqual(d.calls.map(c => c[0]), ['GET', 'PATCH']);
  assert.ok(!d.calls.some(c => c[0] === 'DELETE'));
  assert.equal(await trashDriveFile(driveFetch(goodMeta).fn, 'f', 'lib', 'tok'), 'trashed');
});
test('drive-trash: not-ours cases (other folder, not owned, folder item, 404) vs retry cases (5xx, network)', async () => {
  for (const meta of [{ ...goodMeta, parents: ['other'] }, { ...goodMeta, ownedByMe: false }, { ...goodMeta, parents: ['lib', 'x'] }, { ...goodMeta, mimeType: 'application/vnd.google-apps.folder' }]) {
    const d = driveFetch(meta);
    assert.equal(await moveDriveFileToTrash(d.fn, 'f', 'lib', 'tok'), 'not_ours');
    assert.deepEqual(d.calls.map(c => c[0]), ['GET'], 'nothing written');
    assert.equal(await trashDriveFile(driveFetch(meta).fn, 'f', 'lib', 'tok'), 'failed');
  }
  assert.equal(await inspectDriveFile(driveFetch(null, { status: 404 }).fn, 'f', 'lib', 'tok'), 'not_ours');
  assert.equal(await inspectDriveFile(driveFetch(null, { status: 403, body: { error: { errors: [{ reason: 'appNotAuthorizedToFile' }] } } }).fn, 'f', 'lib', 'tok'), 'not_ours');
  assert.equal(await inspectDriveFile(driveFetch(null, { status: 403, body: { error: { errors: [{ reason: 'userRateLimitExceeded' }] } } }).fn, 'f', 'lib', 'tok'), 'retry');
  assert.equal(await inspectDriveFile(driveFetch(null, { status: 503 }).fn, 'f', 'lib', 'tok'), 'retry');
  assert.equal(await inspectDriveFile(async () => { throw new Error('net'); }, 'f', 'lib', 'tok'), 'retry');
  assert.equal(await inspectDriveFile(driveFetch({ ...goodMeta, trashed: true }).fn, 'f', 'lib', 'tok'), 'already_trashed');
  assert.equal(await moveDriveFileToTrash(driveFetch(goodMeta, { patch: () => new Response('{}', { status: 500 }) }).fn, 'f', 'lib', 'tok'), 'unknown');
  assert.equal(await moveDriveFileToTrash(driveFetch(goodMeta, { patch: () => new Response('{}', { status: 403 }) }).fn, 'f', 'lib', 'tok'), 'retry');
});

// library-files [계속 보관]
const SOURCE = stripTypeScriptTypes(read('../../supabase/functions/library-files/index.ts').replace(/^import .*$/gm, ''), { mode: 'strip' });
function keepHarness({ doc: d, role = 'owner', readError = null, updateError = null, race = false } = {}) {
  const rows = [structuredClone(d)], updates = [];
  const documents = () => {
    const b = { _f: [], _patch: null, select() { return b; }, eq(k, v) { b._f.push([k, v]); return b; }, is(k, v) { b._f.push([k, v === null ? null : v]); return b; }, update(p) { b._patch = p; return b; },
      maybeSingle: async () => readError ? { data: null, error: readError } : { data: structuredClone(rows.find(r => b._f.every(([k, v]) => r[k] === v)) || null), error: null },
      then(res, rej) { return Promise.resolve((() => {
        if (updateError) return { data: null, error: updateError };
        if (race) rows[0].updated_at = 'changed';
        const hit = rows.filter(r => b._f.every(([k, v]) => v === null ? r[k] == null : r[k] === v));
        updates.push(b._patch); hit.forEach(r => Object.assign(r, b._patch));
        return { data: hit.map(r => structuredClone(r)), error: null };
      })()).then(res, rej); } };
    return b;
  };
  const simple = result => { const b = { select: () => b, eq: () => b, maybeSingle: async () => result(), single: async () => result(), then: (res, rej) => Promise.resolve(result()).then(res, rej) }; return b; };
  const tables = { app_workspace_members: () => simple(() => ({ data: role ? { workspace_id: 'workspace-1', role } : null })), app_documents: documents };
  const admin = { auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) }, from: t => tables[t]() };
  let handler = null;
  const Deno = { env: { get: key => ({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', OPENAI_API_KEY: '' }[key]) }, serve: fn => { handler = fn; } };
  new Function('Deno', 'createClient', 'HwpxReader', 'hwpToText', 'readMultipartForm', 'AI_REASONING_TOKEN_HEADROOM', 'DEFAULT_AI_MODEL', 'outputText', 'withReasoning', 'createLibraryPhotoHandler', 'setKeep', 'fetch', 'console', 'fileNameTitle', 'isMeaninglessName', SOURCE)(
    Deno, () => admin, class {}, async () => '', async () => new FormData(), 0, 'm', () => '', b => b, () => async () => new Response('{}'), model.setKeep, async () => { throw new Error('no network'); }, { ...console, error: () => {}, warn: () => {}, log: () => {} }, fileNameTitle, isMeaninglessName);
  return { handler, rows, updates };
}
const DOC = 'e0000000-0000-4000-8000-000000000001';
const keepDoc = () => ({ id: DOC, workspace_id: 'workspace-1', file_id: 'cur', updated_at: 'u1', previous_files: [entry('old', 5), entry('gone', 40, { pruned_at: ago(1), prune_result: 'trashed' })] });
const keepReq = (h, body) => h.handler(new Request('https://sb.example/functions/v1/library-files', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
test('library-files previous-keep: sets and clears keep_at on that entry only, guarded by updated_at', async () => {
  const h = keepHarness({ doc: keepDoc() });
  let r = await keepReq(h, { action: 'previous-keep', document_id: DOC, file_id: 'old', keep: true });
  assert.equal(r.status, 200);
  assert.match(h.rows[0].previous_files[0].keep_at, /^\d{4}-/);
  assert.equal(h.rows[0].file_id, 'cur');
  assert.deepEqual(Object.keys(h.updates[0]).sort(), ['previous_files', 'updated_at']);
  assert.equal(h.rows[0].previous_files[1].keep_at, undefined);
  r = await keepReq(h, { action: 'previous-keep', document_id: DOC, file_id: 'old', keep: false });
  assert.equal(r.status, 200); assert.equal(h.rows[0].previous_files[0].keep_at, undefined); assert.match(h.rows[0].previous_files[0].unkeep_at, /^\d{4}-/);
});
test('library-files previous-keep: refuses a pruned file, an unknown file, other workspaces, bad input and non-owners', async () => {
  for (const [body, status, code] of [
    [{ action: 'previous-keep', document_id: DOC, file_id: 'gone', keep: true }, 409, 'previous_already_pruned'],
    [{ action: 'previous-keep', document_id: DOC, file_id: 'nope', keep: true }, 404, 'previous_not_found'],
    [{ action: 'previous-keep', document_id: 'e0000000-0000-4000-8000-0000000000ff', file_id: 'old', keep: true }, 404, 'document_not_found'],
    [{ action: 'previous-keep', document_id: DOC, file_id: 'old', keep: 'yes' }, 400, 'invalid_request'],
    [{ action: 'previous-keep', document_id: DOC, file_id: 'old', keep: true, extra: 1 }, 400, 'invalid_request'],
    [{ action: 'other' }, 400, 'unsupported_request'],
  ]) {
    const h = keepHarness({ doc: keepDoc() });
    const r = await keepReq(h, body);
    assert.equal(r.status, status, JSON.stringify(body)); assert.equal((await r.json()).code, code); assert.equal(h.updates.length, 0);
  }
  const h = keepHarness({ doc: keepDoc(), role: 'editor' });
  assert.equal((await keepReq(h, { action: 'previous-keep', document_id: DOC, file_id: 'old', keep: true })).status, 403);
  const raced = keepHarness({ doc: keepDoc(), race: true });
  assert.equal((await keepReq(raced, { action: 'previous-keep', document_id: DOC, file_id: 'old', keep: true })).status, 409);
});

// 스크립트·workflow
const rep = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const realBody = { ok: true, dry_run: false, documents: 1, entries: 3, pruned: 0, kept: 1, waiting: 1, due: 1, no_date: 0, trashed: 1, already_trashed: 0, list_only: 0, referenced: 0, retry: 0, unknown: 0, conflict: 0, deferred: 0 };
test('script: cron header only, dry run adds dry_run=1, secret missing fails first, 5xx retried once, 401 not', async () => {
  await assert.rejects(runPrune({ secret: ' ', fetcher: async () => { throw new Error('no'); } }), /비밀값 미등록/);
  const seen = [];
  const t = await runPrune({ secret: 'mock', fetcher: async (u, i) => { seen.push([u, i]); return rep(200, realBody); } });
  assert.equal(t.trashed, 1); assert.match(seen[0][0], /action=library_prev_prune$/); assert.deepEqual(seen[0][1].headers, { 'x-drive-summary-cron-secret': 'mock' });
  const dry = { ...realBody, dry_run: true, would_trash: 1, would_list_only: 0, referenced: 0, retry: 0, not_checked: 0, over_cap: 0 };
  const d2 = await runPrune({ secret: 'mock', dryRun: true, fetcher: async (u) => { seen.push([u]); return rep(200, dry); } });
  assert.match(seen.at(-1)[0], /&dry_run=1$/); assert.equal(d2.would_trash, 1);
  await assert.rejects(runPrune({ secret: 'mock', dryRun: true, fetcher: async () => rep(200, realBody) }), /시험 실행 여부/);
  let n = 0;
  await runPrune({ secret: 'mock', sleep: async () => {}, fetcher: async () => (++n === 1 ? rep(503, { error: 'X' }) : rep(200, realBody)) });
  assert.equal(n, 2);
  n = 0;
  await assert.rejects(runPrune({ secret: 'mock', sleep: async () => {}, fetcher: async () => { n++; return rep(401, { error: 'UNAUTHORIZED' }); } }), PruneFailure);
  assert.equal(n, 1);
  await assert.rejects(runPrune({ secret: 'mock', fetcher: async () => rep(200, { ok: true, dry_run: false }) }), /건수가 없습니다/);
});
test('workflow: scheduled run is off unless the repository variable says true; manual run defaults to dry run; no secret printed', () => {
  const y = read('../../.github/workflows/library-prev-prune.yml');
  assert.match(y, /vars\.LIBRARY_PREV_PRUNE_ENABLED == 'true'/);
  assert.match(y, /workflow_dispatch:\n    inputs:\n      dry_run:[\s\S]*default: true/);
  assert.match(y, /DRY_RUN: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.dry_run && '1' \|\| '0' \}\}/);
  assert.match(y, /DRIVE_SUMMARY_CRON_SECRET: \$\{\{ secrets\.DRIVE_SUMMARY_CRON_SECRET \}\}/);
  assert.doesNotMatch(y, /echo|set -x/);
  assert.match(y, /permissions:\n  contents: read/);
});
