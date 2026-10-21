// AI-서버연동 S7-d: drive-summary 원장 내보내기(POST ?action=ledger_export)·상태(GET ?action=ledger_status).
// HTTP는 전부 모의 응답이다. 실제 Supabase·Google·production에 접근하지 않는다. 데이터는 만든 값만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import * as core from '../../supabase/functions/drive-summary/core.mjs';
import * as ledger from '../../supabase/functions/drive-summary/ledger-export.mjs';

const now = new Date('2026-10-25T23:30:00Z'); // 2026-10-26 08:30 KST
const SECRET_SUMMARY = 'S2_SECRET_STRATEGY_TEXT';
const records = [
  { id: 'r1', kind: 'event', ledger_id: 'EVT-0901', title: '가상 노선 운영 전환', summary: '요지 하나', scope: 'work', topic_id: 't1', sensitivity: 'S1', importance: 'high', validity: 'current', date_start: '2026-09-01', date_precision: 'day', date_note: '', event_status: 'tracking' },
  { id: 'r2', kind: 'change', ledger_id: 'CHG-0001', title: '가 지부 협의 진행', summary: '변화 요지', scope: 'work', topic_id: 't1', sensitivity: 'S1', validity: 'current', date_start: '2026-09-10', date_precision: 'day', date_note: '' },
  { id: 'r3', kind: 'decision', ledger_id: 'DEC-0001', title: '교섭 전략 결정', summary: SECRET_SUMMARY, decision_reason: SECRET_SUMMARY, scope: 'work', topic_id: null, sensitivity: 'S2', validity: 'current', date_start: '2026-09-01', date_precision: 'month', date_note: '', decision_type: 'adopted' },
  { id: 'r4', kind: 'commitment', ledger_id: 'COM-0001', title: '자료 회신 약속', summary: '', scope: 'work', topic_id: 't1', sensitivity: 'S1', validity: 'current', date_start: null, date_precision: 'unknown', date_note: '', counterparty: '가상 기관', commitment_status: 'waiting', follow_up_on: '2026-10-20' },
  { id: 'r5', kind: 'event', ledger_id: 'EVT-0902', title: '관심 소식', summary: '업무 밖', scope: 'interest', topic_id: null, sensitivity: 'S0', validity: 'current', date_start: '2026-10-01', date_precision: 'day', date_note: '' },
  { id: 'r6', kind: 'decision', ledger_id: 'DEC-0000', title: '옛 결정', summary: '대체된 요지', scope: 'work', topic_id: 't1', sensitivity: 'S1', validity: 'superseded', superseded_by: 'r3', date_start: '2026-08-01', date_precision: 'day', date_note: '' },
];
const tablesFixture = {
  app_ledger_imports: [{ id: 'i1', label: '시트 이전', source_kind: 'sheet_csv', file_sha256: 'a'.repeat(64), row_counts: {}, status: 'confirmed', created_at: '2026-10-22T00:00:00Z', decided_at: '2026-10-22T01:00:00Z' }],
  app_ledger_id_counters: [{ scope: 'event', prefix: 'EVT', last_number: 902 }],
  app_ledger_topics: [{ id: 't1', ledger_id: 'TOP-0001', name: '가상 주제', aliases: [], sort_order: 1, status: 'active' }],
  app_ledger_organizations: [{ id: 'o1', ledger_id: 'ORG-0001', name: '가 지부', aliases: [], status: 'active' }],
  app_ledger_sources: [{ id: 's1', ledger_id: 'SRC-0001', title: '가상 회의자료', doc_type: 'meeting_material', status: 'active' }],
  app_ledger_records: records,
  app_ledger_record_sources: [{ id: 'rs1', record_id: 'r1', source_id: 's1', locator: '3쪽' }],
  app_ledger_links: [
    { id: 'l1', record_id: 'r2', target_record_id: 'r1', relation: 'belongs_to' },
    { id: 'l2', record_id: 'r1', target_organization_id: 'o1', relation: 'direct' },
  ],
};

function harness(options = {}) {
  const calls = [], uploads = [], patches = [], dbAuth = [];
  const files = new Map([
    ['folder', { id: 'folder', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], appProperties: { kptu_summary: 'folder', kptu_workspace: 'kptu-work', last_success_at: '2026-10-25T21:17:00.000Z', ...options.folderProps } }],
    ...(options.backups || []).map(b => [b.id, { mimeType: 'application/json', parents: ['backup'], ...b, appProperties: { kptu_summary: 'ledger_json', kptu_workspace: 'kptu-work', ...b.appProperties } }]),
  ]);
  if (options.backups) files.set('backup', { id: 'backup', mimeType: 'application/vnd.google-apps.folder', parents: ['folder'], appProperties: { kptu_summary: 'ledger_backup', kptu_workspace: 'kptu-work' } });
  if (options.noFolder) files.delete('folder');
  let next = 0;
  const fetcher = async (input, init = {}) => {
    const url = new URL(input), method = init.method || 'GET', headers = new Headers(init.headers);
    calls.push({ url, method, init });
    const reply = (data, status = 200) => Response.json(data, { status });
    if (url.pathname === '/auth/v1/user') return headers.get('Authorization') === 'Bearer valid-owner' ? reply({ id: 'owner' }) : headers.get('Authorization') === 'Bearer valid-other' ? reply({ id: 'other' }) : reply({}, 401);
    if (url.pathname.startsWith('/rest/v1/')) {
      assert.equal(method, 'GET', 'DB must be read-only');
      const table = url.pathname.split('/').at(-1);
      if (table === 'app_workspaces') return reply([{ id: 'ws' }]);
      if (table === 'app_workspace_members') return reply(url.searchParams.get('user_id') === 'eq.owner' || url.searchParams.get('role') === 'eq.owner' ? [{ user_id: 'owner', role: 'owner' }] : []);
      if (table === 'public_policy_drive_config') return reply([{ id: 1, google_client_id: 'c', google_client_secret: 'x', google_refresh_token: 'r' }]);
      if (table.startsWith('app_ledger_')) {
        dbAuth.push({ table, apikey: headers.get('apikey'), authorization: headers.get('Authorization') });
        // The real tables have no service_role grant.
        if (headers.get('apikey') !== 'test-anon' || headers.get('Authorization') !== 'Bearer valid-owner') return reply({ message: 'permission denied' }, 401);
        if (options.missingTables) return reply({ code: 'PGRST205' }, 404);
        assert.equal(url.searchParams.get('workspace_id'), 'eq.ws');
        assert.ok(!url.searchParams.get('select').includes('*'));
        const rows = options.tables?.[table] ?? tablesFixture[table] ?? [];
        const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'));
        return reply(rows.slice(offset, offset + limit));
      }
      throw new Error(`Unexpected table ${table}`);
    }
    if (url.hostname === 'oauth2.googleapis.com') return reply({ access_token: 'access' });
    if (url.pathname.endsWith('/permissions')) {
      const id = decodeURIComponent(url.pathname.split('/').at(-2));
      const isPublic = options.publicId === id;
      return reply({ permissions: isPublic ? [{ type: 'anyone', role: 'reader' }] : [{ type: 'user', role: 'owner' }] });
    }
    if (url.hostname !== 'www.googleapis.com') throw new Error(`Unexpected request ${url}`);
    if (url.searchParams.has('q')) {
      const q = url.searchParams.get('q');
      const kind = /value='([a-z_]+)' }/.exec(q)[1];
      const parent = /'([^']+)' in parents/.exec(q)[1];
      assert.match(q, /trashed = false/);
      assert.match(q, /kptu_workspace/);
      return reply({ files: [...files.values()].filter(f => !f.trashed && f.appProperties?.kptu_summary === kind && (f.parents || []).includes(parent)).map(f => ({ id: f.id, appProperties: f.appProperties })) });
    }
    if (url.pathname.startsWith('/upload/')) {
      if (options.uploadFail) return reply({ error: { message: 'RAW_UPSTREAM_TEXT' } }, 503);
      const parts = init.body.split('\r\n\r\n');
      const meta = JSON.parse(parts[1].split('\r\n')[0]);
      const content = parts[2].split(/\r\n--/)[0];
      const id = method === 'PATCH' ? decodeURIComponent(url.pathname.split('/').at(-1)) : `new-${meta.appProperties.kptu_summary}-${++next}`;
      const old = files.get(id) || {};
      files.set(id, { ...old, id, ...meta, parents: meta.parents || old.parents, content });
      uploads.push({ method, id, meta, content });
      return reply({ id });
    }
    if (method === 'POST') {
      const meta = JSON.parse(init.body), id = meta.appProperties.kptu_summary === 'folder' ? 'folder' : `new-${meta.appProperties.kptu_summary}-${++next}`;
      files.set(id, { id, parents: ['root'], ...meta });
      return reply(files.get(id));
    }
    if (method === 'PATCH') {
      const id = decodeURIComponent(url.pathname.split('/').at(-1));
      const patch = JSON.parse(init.body);
      patches.push({ id, patch });
      if (options.trashFail && patch.trashed) return reply({}, 503);
      const f = files.get(id);
      if (patch.trashed) f.trashed = true;
      // Drive merges appProperties keys.
      if (patch.appProperties) f.appProperties = { ...f.appProperties, ...patch.appProperties };
      return reply({ id });
    }
    throw new Error(`Unhandled ${method} ${url}`);
  };
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', SUPABASE_ANON_KEY: options.noAnon ? undefined : 'test-anon', DRIVE_SUMMARY_CRON_SECRET: 'right-secret' };
  const handler = core.createHandler({ env, fetcher, now: () => now });
  const exportRequest = (headers = {}) => handler(new Request('https://edge.test/drive-summary?action=ledger_export', { method: 'POST', headers }));
  const statusRequest = (headers = {}) => handler(new Request('https://edge.test/drive-summary?action=ledger_status', { method: 'GET', headers }));
  return { calls, uploads, patches, files, dbAuth, exportRequest, statusRequest };
}
const owner = { Authorization: 'Bearer valid-owner' };

test('export: anonymous, forged, non-owner and any cron header are refused before Drive or ledger reads', async () => {
  for (const [headers, status] of [
    [{}, 401], [{ Authorization: 'Bearer forged' }, 401], [{ Authorization: 'Bearer valid-other' }, 403],
    [{ 'x-drive-summary-cron-secret': 'right-secret' }, 401], [{ 'x-drive-summary-cron-secret': 'wrong' }, 401],
    [{ ...owner, 'x-drive-summary-cron-secret': 'right-secret' }, 401],
  ]) {
    const h = harness();
    const response = await h.exportRequest(headers);
    assert.equal(response.status, status, JSON.stringify(headers));
    assert.equal((await response.json()).ok, false);
    assert.equal(h.calls.some(c => c.url.hostname.endsWith('googleapis.com')), false);
    assert.equal(h.dbAuth.length, 0);
  }
});

test('export: ledger tables are read only with the owner token + anon key, never service_role', async () => {
  const h = harness();
  const response = await h.exportRequest(owner);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.exported_at, now.toISOString());
  assert.deepEqual(Object.keys(body.counts), Object.keys(ledger.LEDGER_TABLES));
  assert.equal(body.counts.app_ledger_records, records.length);
  assert.equal(h.dbAuth.length, Object.keys(ledger.LEDGER_TABLES).length);
  for (const a of h.dbAuth) { assert.equal(a.apikey, 'test-anon'); assert.equal(a.authorization, 'Bearer valid-owner'); }
  assert.ok(!h.calls.some(c => c.url.pathname.includes('app_ledger_audit') || c.url.pathname.includes('app_ledger_candidates')));
  assert.ok(!h.calls.some(c => c.url.pathname.startsWith('/rest/v1/app_ledger_') && new Headers(c.init.headers).get('apikey') === 'test-service'));
  assert.ok(!h.calls.some(c => c.url.pathname.endsWith('/permissions') && c.method !== 'GET'), 'no permission creation');
  assert.ok(!JSON.stringify(body).includes('가상 노선'), 'response carries no ledger content');
});

test('export: JSON backup has all rows (S2 included), counts and per-table sha256; reading copy hides S2 detail', async () => {
  const h = harness();
  await h.exportRequest(owner);
  const json = h.uploads.find(u => u.meta.appProperties.kptu_summary === 'ledger_json');
  const doc = h.uploads.find(u => u.meta.appProperties.kptu_summary === 'ledger');
  assert.equal(json.meta.name, '원장-2026-10-26.json');
  assert.equal(json.meta.mimeType, 'application/json');
  assert.equal(json.meta.appProperties.kptu_export_date, '2026-10-26');
  assert.deepEqual(json.meta.parents, ['new-ledger_backup-1']);
  const parsed = JSON.parse(json.content);
  assert.equal(parsed.format, 'kptu-ledger-export');
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.tables.app_ledger_records, records);
  assert.ok(json.content.includes(SECRET_SUMMARY));
  const { createHash } = await import('node:crypto');
  for (const [table, rows] of Object.entries(parsed.tables)) {
    assert.equal(parsed.counts[table], rows.length);
    assert.equal(parsed.sha256[table], createHash('sha256').update(JSON.stringify(rows)).digest('hex'));
  }
  assert.equal(doc.meta.name, '원장 (읽기용 사본)');
  assert.equal(doc.meta.mimeType, 'application/vnd.google-apps.document');
  assert.deepEqual(doc.meta.parents, ['folder']);
  assert.ok(!doc.content.includes(SECRET_SUMMARY), 'S2 summary/decision reason stay out of the reading copy');
  assert.match(doc.content, /DEC-0001 · 2026-09 · \[S2 교섭·전략: 요지 생략\] · 교섭 전략 결정/);
  assert.match(doc.content, /<h2>가상 주제 \(TOP-0001\)<\/h2>/);
  assert.match(doc.content, /EVT-0901 · 2026-09-01 · 중요 높음 · 가상 노선 운영 전환 · 요지 하나 · 상태 추적중 · 조직 가 지부\(ORG-0001\) · 출처 SRC-0001/);
  assert.match(doc.content, /CHG-0001 .* · 소속 EVT-0901/);
  assert.match(doc.content, /<h2>기한 지난 약속<\/h2>\n<table><tr>.*\n<tr><td>COM-0001<\/td><td>2026-10-20<\/td><td>6일<\/td><td>가상 기관<\/td>/);
  // Interest (L1) is a separate section after the work sections; superseded rows only in the last section.
  const interestAt = doc.content.indexOf('<h2>관심 정보</h2>');
  assert.ok(interestAt > doc.content.indexOf('<h2>기한 지난 약속</h2>'));
  assert.ok(doc.content.indexOf('EVT-0902') > interestAt);
  assert.match(doc.content, /<h2>대체·폐기<\/h2>\n<p>DEC-0000 · 대체 · 옛 결정 · 대체한 기록 DEC-0001<\/p>/);
  assert.ok(!doc.content.includes('대체된 요지'));
});

test('export: status is written with only the ledger keys; copy keys stay', async () => {
  const h = harness();
  await h.exportRequest(owner);
  const folderPatches = h.patches.filter(p => p.id === 'folder');
  assert.deepEqual(folderPatches.map(p => p.patch), [{ appProperties: { ledger_last_success_at: now.toISOString() } }]);
  assert.equal(h.files.get('folder').appProperties.last_success_at, '2026-10-25T21:17:00.000Z');
});

test('export: same date replaces the same JSON; newest 8 are kept, older ones go to trash (not delete)', async () => {
  const backups = Array.from({ length: 9 }, (_, i) => ({ id: `b${i}`, appProperties: { kptu_export_date: `2026-08-${String(10 + i * 2).padStart(2, '0')}` } }));
  backups.push({ id: 'today', appProperties: { kptu_export_date: '2026-10-26' } });
  backups.push({ id: 'odd', appProperties: { kptu_export_date: 'not-a-date' } });
  const h = harness({ backups, folderProps: {} });
  h.files.get('folder').appProperties.kptu_summary = 'folder';
  const body = await (await h.exportRequest(owner)).json();
  assert.equal(body.ok, true, JSON.stringify(body));
  const json = h.uploads.find(u => u.meta.appProperties.kptu_summary === 'ledger_json');
  assert.equal(json.method, 'PATCH');
  assert.equal(json.id, 'today');
  const trashed = h.patches.filter(p => p.patch.trashed).map(p => p.id).sort();
  assert.deepEqual(trashed, ['b0', 'b1']); // 11 files, 10 dated → keep 8 newest, odd one untouched
  assert.ok(!h.calls.some(c => c.method === 'DELETE'));
  assert.equal(h.files.get('odd').trashed, undefined);
});

test('export: duplicate markers for one date fail closed', async () => {
  const h = harness({ backups: [{ id: 'x1', appProperties: { kptu_export_date: '2026-10-26' } }, { id: 'x2', appProperties: { kptu_export_date: '2026-10-26' } }] });
  const response = await h.exportRequest(owner);
  assert.equal((await response.json()).error, 'DRIVE_DUPLICATE_MARKERS');
  assert.equal(h.uploads.length, 0);
});

test('export: trash failure does not fail the export, it is only counted', async () => {
  const backups = Array.from({ length: 9 }, (_, i) => ({ id: `b${i}`, appProperties: { kptu_export_date: `2026-09-${String(10 + i).padStart(2, '0')}` } }));
  const h = harness({ backups, trashFail: true });
  const body = await (await h.exportRequest(owner)).json();
  assert.equal(body.ok, true);
  assert.equal(body.trim_failed, 2);
});

test('export: public sharing anywhere refuses and records only a stage code', async () => {
  for (const publicId of ['folder', 'new-ledger_backup-1', 'new-ledger_json-2', 'new-ledger-3']) {
    const h = harness({ publicId });
    const response = await h.exportRequest(owner);
    const body = await response.json();
    assert.equal(body.ok, false, publicId);
    assert.equal(body.error, 'DRIVE_PUBLIC_SHARING_FOUND', publicId);
    assert.equal(h.files.get('folder').appProperties.ledger_last_failure_summary, 'DRIVE_PUBLIC_SHARING_FOUND');
    assert.equal(h.files.get('folder').appProperties.ledger_last_success_at, undefined);
  }
});

test('export: missing ledger tables, missing anon key, upstream failure → safe codes, no content', async () => {
  let h = harness({ missingTables: true });
  let response = await h.exportRequest(owner), body = await response.json();
  assert.equal(response.status, 409); assert.equal(body.error, 'LEDGER_NOT_READY'); assert.equal(h.uploads.length, 0);
  assert.equal(body.failure_recorded, true);
  h = harness({ noAnon: true });
  response = await h.exportRequest(owner); body = await response.json();
  assert.equal(body.error, 'SERVER_CONFIG_MISSING'); assert.equal(h.calls.length, 0);
  h = harness({ uploadFail: true });
  response = await h.exportRequest(owner); body = await response.json();
  assert.equal(body.error, 'DRIVE_UPLOAD_FAILED');
  assert.ok(!JSON.stringify(body).includes('RAW_UPSTREAM_TEXT'));
});

test('export: oversized reading copy → diagnostic document, backup still uploaded, LEDGER_DOC_LIMIT recorded', async () => {
  const many = Array.from({ length: 9000 }, (_, i) => ({ ...records[0], id: `m${i}`, ledger_id: `EVT-${String(1000 + i).padStart(4, '0')}`, summary: '가'.repeat(600) }));
  const h = harness({ tables: { app_ledger_records: many } });
  const body = await (await h.exportRequest(owner)).json();
  assert.equal(body.error, 'LEDGER_DOC_LIMIT');
  const json = h.uploads.find(u => u.meta.appProperties.kptu_summary === 'ledger_json');
  assert.equal(JSON.parse(json.content).counts.app_ledger_records, 9000);
  const doc = h.uploads.find(u => u.meta.appProperties.kptu_summary === 'ledger');
  assert.match(doc.content, /대상 축소 필요/);
  assert.equal(h.files.get('folder').appProperties.ledger_last_failure_summary, 'LEDGER_DOC_LIMIT');
});

test('export: a table beyond the row limit fails instead of writing a truncated backup', async () => {
  const big = Array.from({ length: ledger.LEDGER_LIMITS.rowsPerTable + 1 }, (_, i) => ({ id: `s${i}` }));
  const h = harness({ tables: { app_ledger_sources: big } });
  const body = await (await h.exportRequest(owner)).json();
  assert.equal(body.error, 'LEDGER_READ_LIMIT');
  assert.equal(h.uploads.length, 0);
});

test('ledger_status: owner or cron secret; times and code only; no writes, no ledger reads', async () => {
  for (const headers of [owner, { 'x-drive-summary-cron-secret': 'right-secret' }]) {
    const h = harness({ folderProps: { ledger_last_success_at: '2026-10-19T00:00:00.000Z', ledger_last_failure_at: '2026-10-20T00:00:00.000Z', ledger_last_failure_summary: 'LEDGER_DOC_LIMIT', other: 'x' } });
    const response = await h.statusRequest(headers);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true, checked_at: now.toISOString(), ledger: { state: 'found', last_success_at: '2026-10-19T00:00:00.000Z', last_failure_at: '2026-10-20T00:00:00.000Z', last_failure_code: 'LEDGER_DOC_LIMIT' } });
    assert.equal(h.dbAuth.length, 0);
    assert.ok(!h.calls.some(c => c.method !== 'GET' && c.url.hostname !== 'oauth2.googleapis.com'));
  }
  for (const [headers, status] of [[{}, 401], [{ 'x-drive-summary-cron-secret': 'wrong' }, 401], [{ Authorization: 'Bearer valid-other' }, 403]]) {
    const h = harness();
    assert.equal((await h.statusRequest(headers)).status, status);
    assert.equal(h.calls.some(c => c.url.hostname.endsWith('googleapis.com')), false);
  }
  const h = harness({ noFolder: true });
  const body = await (await h.statusRequest(owner)).json();
  assert.deepEqual(body.ledger, { state: 'none', last_success_at: null, last_failure_at: null, last_failure_code: null });
  assert.ok(!h.calls.some(c => c.method === 'POST' && c.url.hostname === 'www.googleapis.com'));
});

test('ledgerStatus ignores malformed values', () => {
  assert.deepEqual(ledger.ledgerStatus({ ledger_last_success_at: '<script>', ledger_last_failure_at: '2026-10-20T00:00:00Z', ledger_last_failure_summary: 'bad code!' }),
    { state: 'found', last_success_at: null, last_failure_at: '2026-10-20T00:00:00.000Z', last_failure_code: null });
});

test('existing copy rebuild (POST without action) and status read are unchanged by the new routes', async () => {
  const h = harness();
  const response = await h.statusRequest(owner);
  assert.equal(response.status, 200);
  const handler = core.createHandler({ env: { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k', SUPABASE_ANON_KEY: 'a' }, fetcher: async () => { throw new Error('no I/O'); }, now: () => now });
  const other = await handler(new Request('https://edge.test/drive-summary?action=other', { method: 'GET' }));
  assert.equal(other.status, 405);
});

test('column allow-lists match the ledger migrations (a new column must be added to the export)', () => {
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  const sql = readdirSync(dir).filter(f => f.startsWith('202610') && f.includes('ledger')).map(f => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  for (const [table, columns] of Object.entries(ledger.LEDGER_TABLES)) {
    const block = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
    assert.ok(block, table);
    const declared = block[1].split('\n').map(l => /^\s{2}([a-z_0-9]+)\s+(uuid|text|integer|jsonb|date|timestamptz|boolean|text\[\])/.exec(l)?.[1]).filter(Boolean).filter(c => c !== 'workspace_id');
    const added = [...sql.matchAll(new RegExp(`alter table public\\.${table}\\s+add column (?:if not exists )?([a-z_0-9]+)`, 'g'))].map(m => m[1]);
    assert.deepEqual([...columns].sort(), [...declared, ...added].sort(), table);
  }
});

test('dateText follows the precision rules', () => {
  assert.equal(ledger.dateText({ date_start: '2026-01-01', date_precision: 'year', date_note: '' }), '2026');
  assert.equal(ledger.dateText({ date_start: '2021-01-01', date_end: '2025-12-31', date_precision: 'range', date_note: '2021~2025' }), '2021-01-01~2025-12-31(2021~2025)');
  assert.equal(ledger.dateText({ date_precision: 'unknown', date_note: '' }), '날짜 모름');
});
