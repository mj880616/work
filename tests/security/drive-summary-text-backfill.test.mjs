// LIB-글자채우기야간: drive-summary POST ?action=text_backfill (cron secret only) and ?action=text_backfill_dismiss (owner JWT),
// plus the text_backfill part of GET ?action=status. Synthetic PostgREST and Drive only; no network, no real files.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../supabase/functions/drive-summary/core.mjs';
import { runTextBackfill, textBackfillStatus, TEXT_BACKFILL, TRY_MARK, GAVE_UP } from '../../supabase/functions/drive-summary/text-backfill.mjs';

const now = new Date('2026-10-23T18:23:00Z'); // 03:23 KST
const WS = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const doc = (n, extra = {}) => ({ id: id(n), workspace_id: WS, file_id: `drive-file-${n}`, file_name: `비공개 이름 ${n}.pdf`, mime_type: 'application/pdf', file_size: 1000,
  extraction_status: null, extraction_error: null, extracted_at: null, extracted_text: null, title: `제목 ${n}`, created_at: `2026-10-${String(10 + n).padStart(2, '0')}T00:00:00Z`, ...extra });

// Minimal PostgREST: the filters the nightly path uses, nothing more.
function matches(row, params) {
  for (const [key, value] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    if (key === 'or') {
      assert.equal(value, '(extraction_status.is.null,extraction_status.not.in.(ready,error))');
      if (!(row.extraction_status == null || !['ready', 'error'].includes(row.extraction_status))) return false;
      continue;
    }
    const v = row[key];
    if (value === 'is.null') { if (v != null) return false; }
    else if (value === 'not.is.null') { if (v == null) return false; }
    else if (value.startsWith('eq.')) { if (String(v) !== value.slice(3)) return false; }
    else if (value.startsWith('lt.')) { if (!(v != null && Date.parse(v) < Date.parse(value.slice(3)))) return false; }
    else throw new Error(`unsupported filter ${key}=${value}`);
  }
  return true;
}

function harness(options = {}) {
  const calls = [], docPatches = [], folderPatches = [];
  const rows = options.rows || [];
  const folder = options.noFolder ? null : { id: 'folder', appProperties: { kptu_summary: 'folder', kptu_workspace: 'kptu-work', last_success_at: '2026-10-23T04:17:00.000Z', ...options.folderProps } };
  const fetcher = async (input, init = {}) => {
    const url = new URL(input), method = init.method || 'GET';
    calls.push({ url, method, init });
    const reply = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
    if (url.pathname === '/auth/v1/user') return init.headers.Authorization === 'Bearer valid-owner' ? reply({ id: 'owner' }) : init.headers.Authorization === 'Bearer valid-other' ? reply({ id: 'other' }) : reply({}, 401);
    if (url.hostname === 'oauth2.googleapis.com') return options.oauthFail ? reply({ error: 'x' }, 400) : reply({ access_token: 'access' });
    if (url.hostname === 'db.test') {
      const table = url.pathname.split('/').at(-1);
      if (table === 'app_workspaces') return reply([{ id: WS }]);
      if (table === 'app_workspace_members') return reply(url.searchParams.get('user_id') === 'eq.owner' ? [{ user_id: 'owner', role: 'owner' }] : []);
      if (table === 'public_policy_drive_config') return reply([{ google_client_id: 'c', google_client_secret: 's', google_refresh_token: 'r' }]);
      assert.equal(table, 'app_documents', `unexpected table ${table}`);
      assert.equal(init.headers.Authorization, 'Bearer test-service', 'server-side service role only');
      const params = [...url.searchParams];
      assert.ok(params.some(([k, v]) => k === 'workspace_id' && v === `eq.${WS}`), 'every documents request is workspace-scoped');
      if (options.dbFail === method) return reply({ message: 'PRIVATE_DB_TEXT' }, 503);
      const hit = rows.filter(r => matches(r, params));
      if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Range': `*/${hit.length}` } });
      if (method === 'GET') {
        const sorted = [...hit].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
        const cols = url.searchParams.get('select').split(',');
        return reply(sorted.slice(0, Number(url.searchParams.get('limit'))).map(r => Object.fromEntries(cols.map(c => [c, r[c] ?? null]))));
      }
      if (method === 'PATCH') {
        assert.equal(init.headers.Prefer, 'return=representation');
        const body = JSON.parse(init.body);
        assert.deepEqual(Object.keys(body).filter(k => !['extracted_text', 'extraction_status', 'extraction_error', 'extracted_at'].includes(k)), [], 'only the four text columns');
        const target = options.raceBeforePatch?.(rows, body, hit) ?? hit;
        const changed = target.filter(r => matches(r, params));
        for (const r of changed) Object.assign(r, body);
        docPatches.push({ query: url.search, body, ids: changed.map(r => r.id) });
        return reply(changed.map(r => ({ id: r.id })));
      }
      throw new Error(`unexpected ${method} on documents`);
    }
    if (url.pathname.endsWith('/permissions')) return reply({ permissions: options.public ? [{ type: 'anyone', role: 'reader' }] : [{ type: 'user', role: 'owner' }] });
    if (url.hostname === 'www.googleapis.com' && url.searchParams.has('q')) return reply({ files: folder ? [folder] : [] });
    if (url.hostname === 'www.googleapis.com' && method === 'PATCH') {
      const patch = JSON.parse(init.body);
      folderPatches.push(patch);
      Object.assign(folder.appProperties, patch.appProperties);
      return reply({ id: 'folder' });
    }
    throw new Error(`Unhandled ${method} ${url}`);
  };
  const reads = [];
  const createTextReader = driveToken => ({
    async extract(file) {
      assert.equal(await driveToken(), 'access', 'token obtained once before the loop');
      reads.push(file);
      const result = options.extract?.(file);
      return result || { text: `읽은 글자 ${file.fileId}`, source: 'content', reason: 'ok', cut: false };
    },
  });
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', DRIVE_SUMMARY_CRON_SECRET: 'right-secret', COLLECTOR_HEARTBEAT_SECRET: 'beat-secret' };
  const handler = core.createHandler({ env, fetcher, now: () => now, createTextReader: options.noReader ? null : createTextReader });
  const post = (headers, action = 'text_backfill') => handler(new Request(`https://edge.test/drive-summary?action=${action}`, { method: 'POST', headers }));
  const status = () => handler(new Request('https://edge.test/drive-summary?action=status', { method: 'GET', headers: { Authorization: 'Bearer valid-owner' } }));
  return { calls, docPatches, folderPatches, reads, rows, folder, post, status, fetcher };
}
const cron = { 'x-drive-summary-cron-secret': 'right-secret' };
const docCalls = h => h.calls.filter(c => c.url.pathname === '/rest/v1/app_documents');

test('text_backfill: only the cron secret; JWT, wrong/empty secret, heartbeat secret and a missing reader are refused before documents', async () => {
  for (const [headers, code, status, opts] of [
    [{}, 'UNAUTHORIZED', 401], [{ Authorization: 'Bearer valid-owner' }, 'UNAUTHORIZED', 401],
    [{ 'x-drive-summary-cron-secret': 'wrong' }, 'UNAUTHORIZED', 401], [{ 'x-drive-summary-cron-secret': '' }, 'UNAUTHORIZED', 401],
    [{ ...cron, 'x-collector-heartbeat-secret': 'beat-secret' }, 'UNAUTHORIZED', 401],
    [{ 'x-collector-heartbeat-secret': 'beat-secret' }, 'UNAUTHORIZED', 401],
    [cron, 'SERVER_CONFIG_MISSING', 502, { noReader: true }],
  ]) {
    const h = harness({ rows: [doc(1)], ...opts }), response = await h.post(headers), result = await response.json();
    assert.equal(response.status, status, JSON.stringify(headers));
    assert.equal(result.ok, false); assert.equal(result.error, code);
    assert.equal(docCalls(h).length, 0, 'no documents read or written');
    assert.equal(h.reads.length, 0);
  }
});

test('text_backfill: reads the 5 newest unfinished documents of the workspace, writes only the four text columns, answers counts only', async () => {
  const rows = [
    ...[1, 2, 3, 4, 5, 6, 7].map(n => doc(n)),
    doc(8, { extraction_status: 'ready', extracted_text: '이미 읽음' }), doc(9, { extraction_status: 'error', extraction_error: 'unsupported' }),
    doc(10, { file_id: null }), doc(11, { workspace_id: OTHER }), doc(12, { extraction_status: 'pending' }), // old pending from another reader
  ];
  const h = harness({ rows }), response = await h.post(cron), result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result, { ok: true, asked: 5, ready: 5, error: 0, gave_up: 0, skipped: 0, remaining: 3, stop: null, done_at: null });
  assert.deepEqual(h.reads.map(r => r.fileId), ['drive-file-12', 'drive-file-7', 'drive-file-6', 'drive-file-5', 'drive-file-4']);
  for (const n of [12, 7, 6, 5, 4]) {
    const r = rows.find(x => x.id === id(n));
    assert.equal(r.extraction_status, 'ready'); assert.equal(r.extraction_error, null); assert.equal(r.extracted_text, `읽은 글자 drive-file-${n}`);
    assert.equal(r.extracted_at, now.toISOString()); assert.equal(r.title, `제목 ${n}`, 'other columns untouched');
  }
  assert.equal(rows.find(x => x.id === id(8)).extracted_text, '이미 읽음');
  assert.equal(rows.find(x => x.id === id(11)).extraction_status, null, 'other workspace untouched');
  assert.equal(rows.find(x => x.id === id(10)).extraction_status, null, 'no file, not counted');
  // mark then result, per document
  assert.deepEqual(h.docPatches.slice(1, 3).map(p => p.body.extraction_status), ['pending', 'ready']);
  assert.equal(h.docPatches[1].body.extraction_error, TRY_MARK);
  assert.doesNotMatch(JSON.stringify(result), /비공개|drive-file|읽은 글자/);
  assert.equal(h.folderPatches.length, 0, 'not done yet: nothing recorded on Drive');
});

test('text_backfill: an unreadable file is marked error at once and does not block the next one', async () => {
  const rows = [doc(1), doc(2), doc(3)];
  const h = harness({ rows, extract: f => f.fileId === 'drive-file-3' ? { text: '', source: 'none', reason: 'unsupported', cut: false } : null });
  const result = await (await h.post(cron)).json();
  assert.equal(result.asked, 3); assert.equal(result.ready, 2); assert.equal(result.error, 1); assert.equal(result.remaining, 0);
  const bad = rows.find(r => r.id === id(3));
  assert.equal(bad.extraction_status, 'error'); assert.equal(bad.extraction_error, 'unsupported'); assert.equal(bad.extracted_text, null);
  const again = harness({ rows });
  assert.equal((await (await again.post(cron)).json()).asked, 0, 'error is never read again');
});

test('text_backfill: a run cut off mid-file (marker older than 30 minutes) ends as gave_up; a fresh marker is left alone', async () => {
  const old = new Date(now.getTime() - 31 * 60000).toISOString(), fresh = new Date(now.getTime() - 5 * 60000).toISOString();
  const rows = [doc(1, { extraction_status: 'pending', extraction_error: TRY_MARK, extracted_at: old }),
    doc(2, { extraction_status: 'pending', extraction_error: TRY_MARK, extracted_at: fresh }), doc(3)];
  const h = harness({ rows }), result = await (await h.post(cron)).json();
  assert.equal(result.gave_up, 1); assert.equal(result.asked, 1); assert.equal(result.remaining, 1, 'the fresh marker still counts as not done');
  assert.deepEqual(h.reads.map(r => r.fileId), ['drive-file-3'], 'neither marked row is read');
  const r1 = rows.find(r => r.id === id(1));
  assert.equal(r1.extraction_status, 'error'); assert.equal(r1.extraction_error, GAVE_UP);
  assert.equal(rows.find(r => r.id === id(2)).extraction_error, TRY_MARK);
});

test('text_backfill: a document finished elsewhere meanwhile is skipped and never overwritten', async () => {
  const rows = [doc(1), doc(2)];
  // Before our marker lands on doc 2, the library screen finished it.
  const h = harness({ rows, raceBeforePatch: (all, body, hit) => {
    if (body.extraction_status === 'pending' && hit.some(r => r.id === id(2))) Object.assign(all.find(r => r.id === id(2)), { extraction_status: 'ready', extracted_text: '화면이 읽음' });
    return null;
  } });
  const result = await (await h.post(cron)).json();
  assert.equal(result.skipped, 1); assert.equal(result.asked, 1);
  assert.equal(rows.find(r => r.id === id(2)).extracted_text, '화면이 읽음');
});

test('text_backfill: Drive token or DB failure stops before marking anything; stage code only', async () => {
  for (const [opts, code] of [[{ oauthFail: true }, 'DRIVE_TOKEN_FAILED'], [{ dbFail: 'GET' }, 'DB_READ_FAILED']]) {
    const rows = [doc(1)], h = harness({ rows, ...opts }), response = await h.post(cron), result = await response.json();
    assert.equal(result.ok, false); assert.equal(result.error, code); assert.equal(response.status, 502);
    assert.equal(rows[0].extraction_status, null, 'no marker left');
    assert.equal(h.reads.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_DB_TEXT/);
  }
});

test('runTextBackfill: stops starting new documents after the time budget', async () => {
  const rows = [doc(1), doc(2), doc(3)];
  const h = harness({ rows });
  let t = 0;
  const db = {
    get: async path => (await fetchJson(h, path)), patch: async (path, body) => fetchJson(h, path, 'PATCH', body),
    head: async () => 0,
  };
  const reader = { extract: async () => { t += TEXT_BACKFILL.budgetMs; return { text: 'x', source: 'content', reason: 'ok' }; } };
  const r = await runTextBackfill({ db, reader, workspaceId: WS, now: () => now, clock: () => t });
  assert.equal(r.asked, 2); assert.equal(r.stop, 'budget');
  await assert.rejects(runTextBackfill({ db, reader, workspaceId: 'kptu-work' }), /WORKSPACE_UNAVAILABLE/);
});
// Drives the harness's PostgREST directly (same filters) for the pure-function test.
async function fetchJson(h, path, method = 'GET', body) {
  const res = await h.fetcher(`https://db.test/rest/v1/${path}`, { method, headers: { apikey: 'test-service', Authorization: 'Bearer test-service', Prefer: 'return=representation' }, body: body && JSON.stringify(body) });
  return res.json();
}

test('done: when nothing is left the done time and read count go on the copy folder once (own keys only); status shows it', async () => {
  const rows = [doc(1), doc(2, { extraction_status: 'ready' }), doc(3, { extraction_status: 'error' })];
  const h = harness({ rows }), result = await (await h.post(cron)).json();
  assert.equal(result.remaining, 0); assert.equal(result.done_at, now.toISOString());
  assert.deepEqual(h.folderPatches, [{ appProperties: { text_backfill_done_at: now.toISOString(), text_backfill_count: '2' } }]);
  assert.equal(h.folder.appProperties.last_success_at, '2026-10-23T04:17:00.000Z', 'copy status untouched');
  const again = await (await h.post(cron)).json();
  assert.equal(again.done_at, now.toISOString()); assert.equal(h.folderPatches.length, 1, 'recorded once');
  const status = await (await h.status()).json();
  assert.deepEqual(status.text_backfill, { done_at: now.toISOString(), count: 2, dismissed_at: null });
});

test('done: no copy folder or public sharing keeps ok with a stage code; nothing created', async () => {
  for (const [opts, code] of [[{ noFolder: true }, 'COPY_FOLDER_MISSING'], [{ public: true }, 'DRIVE_PUBLIC_SHARING_FOUND']]) {
    const h = harness({ rows: [], ...opts }), result = await (await h.post(cron)).json();
    assert.equal(result.ok, true); assert.equal(result.done_at, null); assert.equal(result.done_error, code);
    assert.equal(h.folderPatches.length, 0);
    assert.ok(!h.calls.some(c => c.method === 'POST' && c.url.hostname === 'www.googleapis.com'), 'never creates a folder');
  }
});

test('dismiss: owner JWT only; records the dismissed time; refused before done', async () => {
  const done = { text_backfill_done_at: '2026-10-22T18:23:00.000Z', text_backfill_count: '42' };
  for (const [headers, status] of [[{}, 401], [{ Authorization: 'Bearer valid-other' }, 403], [cron, 401], [{ ...cron, Authorization: 'Bearer valid-owner' }, 401]]) {
    const h = harness({ folderProps: done }), r = await h.post(headers, 'text_backfill_dismiss');
    assert.equal(r.status, status); assert.equal(h.folderPatches.length, 0);
  }
  const notDone = harness(), r = await notDone.post({ Authorization: 'Bearer valid-owner' }, 'text_backfill_dismiss');
  assert.equal(r.status, 409); assert.equal((await r.json()).error, 'NOT_DONE');
  const h = harness({ folderProps: done }), ok = await (await h.post({ Authorization: 'Bearer valid-owner' }, 'text_backfill_dismiss')).json();
  assert.deepEqual(ok, { ok: true, dismissed_at: now.toISOString() });
  assert.deepEqual(h.folderPatches, [{ appProperties: { text_backfill_dismissed_at: now.toISOString() } }]);
  assert.equal(docCalls(h).length, 0, 'dismiss never touches documents');
  assert.deepEqual((await (await h.status()).json()).text_backfill, { done_at: '2026-10-22T18:23:00.000Z', count: 42, dismissed_at: now.toISOString() });
});

test('textBackfillStatus: strict shapes only', () => {
  assert.equal(textBackfillStatus(null), null);
  assert.equal(textBackfillStatus({ text_backfill_count: '3' }), null, 'no done time → nothing');
  assert.deepEqual(textBackfillStatus({ text_backfill_done_at: '2026-10-22T18:23:00Z', text_backfill_count: '파일 이름', text_backfill_dismissed_at: 'x' }),
    { done_at: '2026-10-22T18:23:00.000Z', count: null, dismissed_at: null });
});
