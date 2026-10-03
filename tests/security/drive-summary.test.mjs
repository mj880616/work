import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import * as core from '../../supabase/functions/drive-summary/core.mjs';
const now = new Date('2026-10-03T15:30:00Z'); // October 4, 00:30 KST
const fixture = {
  app_workspaces: [{ id: 'ws', slug: 'kptu-work' }],
  app_workspace_members: [{ user_id: 'owner', role: 'owner' }],
  public_policy_drive_config: [{ id: 1, google_client_id: 'client', google_client_secret: 'private', google_refresh_token: 'refresh' }],
  app_suborganizations: [{ id: 'org', name: '가상 조직', recent_month_summary: '현재 요약' }],
  app_suborganization_updates: [{ id: 'ou', organization_id: 'org', raw_text: '경계 기록', occurred_at: '2026-09-05T15:00:00Z' }],
  app_spaces: [{ id: 'p', name: '가상 프로젝트', project_system: 'v2', status: 'active', parent_id: null, sort_order: 1 }, { id: 'child', name: '가상 하위 프로젝트', parent_id: 'p', status: 'active', sort_order: 2 }],
  app_project_workstreams: [{ id: 'w', project_id: 'p', phase: 'consultation', title: '협의 준비', sort_order: 1 }],
  app_project_progress_updates: [{ id: 'pu', project_id: 'p', workstream_id: 'w', effective_on: '2026-09-06', summary: '진행 기록', next_step: '다음 단계', status_label: '확인' }],
  app_project_milestones: [{ id: 'ms', project_id: 'p', title: '다가오는 일정', start_at: '2026-10-05T01:00:00Z' }],
  app_record_links: [{ id: 'link', project_id: 'p', google_task_id: 'task', task_completed: false, status: 'confirmed', body: 'FORBIDDEN_TASK_BODY' }],
  app_documents: [{ id: 'doc', project_id: 'p', body: 'FORBIDDEN_DOCUMENT_BODY' }],
  app_meetings: [{ id: 'meeting', project_id: 'p', series_name: '가상 회의', title: '옛 이름', meeting_at: '2026-10-01T01:00:00Z', round_no: 3, transcript_text: 'FORBIDDEN_TRANSCRIPT', notes: 'FORBIDDEN_NOTES', decisions: 'FORBIDDEN_DECISIONS' }],
};

function harness(options = {}) {
  const calls = [], uploads = [], patches = [];
  const files = new Map(options.existing ? [
    ['folder', { id: 'folder', mimeType: 'application/vnd.google-apps.folder', appProperties: { kptu_summary: 'folder', last_success_at: 'old-success', extra: 'keep' } }],
    ['org-doc', { id: 'org-doc', mimeType: 'application/vnd.google-apps.document', appProperties: { kptu_summary: 'org' } }],
    ['project-doc', { id: 'project-doc', mimeType: 'application/vnd.google-apps.document', appProperties: { kptu_summary: 'project' } }],
  ] : []);
  const fetcher = async (input, init = {}) => {
    const url = new URL(input), method = init.method || 'GET';
    calls.push({ url, method, init });
    const reply = (data, status = 200) => Response.json(data, { status });
    if (url.pathname === '/auth/v1/user') return init.headers.Authorization === 'Bearer valid-owner' ? reply({ id: 'owner' }) : init.headers.Authorization === 'Bearer valid-other' ? reply({ id: 'other' }) : reply({}, 401);
    if (url.pathname.startsWith('/rest/v1/')) {
      assert.equal(method, 'GET', 'DB must be read-only');
      const table = url.pathname.split('/').at(-1);
      if (['app_project_milestones', 'app_project_workstreams', 'app_project_progress_updates'].includes(table)) {
        assert.match(url.searchParams.get('select'), /project:app_spaces!project_id!inner\(workspace_id\)/);
      }
      if (table === 'app_workspace_members') {
        assert.equal(url.searchParams.get('select'), 'user_id,role');
        assert.equal(url.searchParams.get('order'), 'user_id.asc');
      }
      let rows = structuredClone(options.data?.[table] || fixture[table] || []).map(row => ({
        workspace_id: 'ws', project: { workspace_id: 'ws' }, organization: { workspace_id: 'ws' }, ...row,
      }));
      if (table === 'app_workspace_members' && url.searchParams.get('user_id') !== 'eq.owner') rows = [];
      for (const [key, value] of url.searchParams) {
        const field = r => key.split('.').reduce((v, part) => v?.[part], r);
        if (value.startsWith('eq.')) rows = rows.filter(r => String(field(r)) === value.slice(3));
        if (value === 'not.is.null') rows = rows.filter(r => field(r) != null);
        if (value.startsWith('gte.')) rows = rows.filter(r => r[key] >= value.slice(4));
        if (value.startsWith('lte.')) rows = rows.filter(r => r[key] <= value.slice(4));
      }
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000);
      return reply(rows.slice(offset, offset + limit));
    }
    if (url.hostname === 'oauth2.googleapis.com') return options.oauthFail ? reply({ error_description: 'refresh secret raw body' }, 400) : reply({ access_token: 'access' });
    if (url.pathname.endsWith('/permissions')) {
      if (options.permissionFail) return reply({}, 403);
      if (options.permissionPages && !url.searchParams.has('pageToken')) return reply({ permissions: [{ type: 'user', role: 'owner' }], nextPageToken: 'permission-page-2' });
      return reply({ permissions: options.public ? [{ type: options.public === 'domain' ? 'domain' : 'anyone', role: 'reader' }] : [{ type: 'user', role: 'owner' }] });
    }
    if (url.hostname !== 'www.googleapis.com') throw new Error(`Unexpected request ${url}`);
    if (url.searchParams.has('q')) {
      const q = url.searchParams.get('q');
      const kind = ['folder', 'org', 'project'].find(k => q.includes(`value='${k}'`));
      assert.ok(kind, 'appProperties discovery is required');
      assert.match(q, /kptu_workspace/);
      assert.match(q, /trashed = false/);
      if (kind !== 'folder') assert.match(q, /'folder' in parents/);
      if (options.discoveryPages && !url.searchParams.has('pageToken')) return reply({ files: [], nextPageToken: 'discovery-page-2' });
      if (options.duplicate && kind === 'folder') return reply({ files: [{ id: 'folder' }, { id: 'duplicate-folder' }] });
      return reply({ files: [...files.values()].filter(f => f.appProperties.kptu_summary === kind) });
    }
    if (url.pathname.startsWith('/upload/')) {
      uploads.push({ method, body: init.body, url });
      if (options.uploadFail || (options.secondUploadFail && uploads.length === 2)) return reply({ error: { message: 'SECRET_RAW_FAILURE' } }, 503);
      assert.match(init.headers['Content-Type'], /multipart\/related/);
      assert.match(init.body, /application\/vnd.google-apps.document/);
      assert.match(init.body, /text\/html/);
      const meta = JSON.parse(init.body.split('\r\n\r\n')[1].split('\r\n')[0]);
      const id = method === 'PATCH' ? url.pathname.split('/').at(-1) : `${meta.appProperties.kptu_summary}-doc`;
      files.set(id, { id, ...meta });
      return reply({ id });
    }
    if (method === 'POST') {
      const meta = JSON.parse(init.body);
      assert.equal(meta.name, 'Web2 읽기용 사본');
      files.set('folder', { id: 'folder', ...meta });
      return reply(files.get('folder'));
    }
    if (method === 'PATCH') {
      if (options.statusFail) return reply({}, 503);
      const patch = JSON.parse(init.body);
      patches.push(patch);
      Object.assign(files.get('folder'), patch);
      return reply(files.get('folder'));
    }
    throw new Error(`Unhandled ${method} ${url}`);
  };
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', DRIVE_SUMMARY_CRON_SECRET: options.noSecret ? undefined : 'right-secret' };
  const handler = core?.createHandler({ env, fetcher, now: () => now });
  const request = (headers = {}, method = 'POST') => handler(new Request('https://edge.test/drive-summary', { method, headers }));
  return { calls, uploads, patches, files, request };
}

  test('rejects anonymous, invalid JWT, non-owner, wrong/unset cron secret before Google/data reads', async () => {
    for (const [headers, options, status] of [
      [{}, {}, 401], [{ Authorization: 'Bearer forged' }, {}, 401],
      [{ Authorization: 'Bearer valid-other' }, {}, 403],
      [{ 'x-drive-summary-cron-secret': 'wrong' }, {}, 401],
      [{ 'x-drive-summary-cron-secret': 'right-secret' }, { noSecret: true }, 401],
      [{ Authorization: 'Bearer valid-owner', 'x-drive-summary-cron-secret': 'wrong' }, {}, 401],
    ]) {
      const h = harness(options), response = await h.request(headers);
      assert.equal(response.status, status);
      assert.ok(h.calls.every(c => c.url.pathname === '/auth/v1/user' || /app_workspaces|app_workspace_members/.test(c.url.pathname)));
    }
  });
  test('both authorized routes create two Docs without a JWT requirement on cron', async () => {
    for (const headers of [{ Authorization: 'Bearer valid-owner' }, { 'x-drive-summary-cron-secret': 'right-secret' }]) {
      const h = harness(), response = await h.request(headers), result = await response.json();
      assert.equal(response.status, 200); assert.equal(result.ok, true);
      assert.equal(result.updated_at, now.toISOString());
      assert.equal(Object.keys(result.documents).length, 2);
      assert.equal(h.uploads.length, 2); assert.ok(h.uploads.every(u => u.method === 'POST'));
      assert.equal(h.files.get('folder').appProperties.last_success_at, now.toISOString());
      assert.ok(!JSON.stringify(result).includes('진행 기록'));
      assert.equal(h.calls.filter(c => /permissions/.test(c.url.pathname) && c.method !== 'GET').length, 0);
    }
  });
  test('existing marked documents are replaced in place and folder properties preserved', async () => {
    const h = harness({ existing: true }), response = await h.request({ Authorization: 'Bearer valid-owner' });
    assert.equal(response.status, 200);
    assert.equal(h.uploads.length, 2); assert.ok(h.uploads.every(u => u.method === 'PATCH'));
    assert.equal(h.calls.filter(c => c.method === 'POST' && c.url.pathname === '/drive/v3/files').length, 0);
    assert.equal(h.files.get('folder').appProperties.extra, 'keep');
  });
  test('four weeks starts at KST midnight 28 days ago and excludes future records', async () => {
    const window = core.kstWindow(now);
    assert.deepEqual(window, { start: '2026-09-05T15:00:00.000Z', end: now.toISOString(), startDate: '2026-09-06', today: '2026-10-04' });
    const h = harness({ data: {
      app_suborganization_updates: [
        { id: 'old', organization_id: 'org', occurred_at: '2026-09-05T14:59:59.999Z', raw_text: 'OUTSIDE_BOUNDARY' },
        { id: 'edge', organization_id: 'org', occurred_at: window.start, raw_text: 'INSIDE_BOUNDARY' },
        { id: 'future', organization_id: 'org', occurred_at: '2026-10-04T00:00:00Z', raw_text: 'FUTURE_UPDATE' },
      ],
    } });
    assert.equal((await h.request({ Authorization: 'Bearer valid-owner' })).status, 200);
    const body = h.uploads.map(u => u.body).join('');
    assert.match(body, /INSIDE_BOUNDARY/); assert.doesNotMatch(body, /OUTSIDE_BOUNDARY|FUTURE_UPDATE/);
    for (const table of ['app_meetings', 'app_suborganization_updates']) {
      const q = h.calls.find(c => c.url.pathname.endsWith(table)).url.searchParams;
      const time = table === 'app_meetings' ? 'meeting_at' : 'occurred_at';
      assert.equal(q.getAll(time)[0], `gte.${window.start}`);
      assert.equal(q.getAll(time)[1], `lte.${window.end}`);
    }
  });
  test('queries are workspace scoped allowlists, never raw meetings, notes, tasks or document bodies', async () => {
    const h = harness(); await h.request({ Authorization: 'Bearer valid-owner' });
    for (const c of h.calls.filter(c => c.url.pathname.startsWith('/rest/v1/'))) {
      const select = c.url.searchParams.get('select');
      assert.doesNotMatch(select, /\*|transcript_text|notes|decisions|body|detail_text|year_summary/);
      assert.doesNotMatch(c.url.pathname, /app_notes|app_tasks|timeline|comments/);
      if (!/app_workspaces|app_workspace_members|public_policy_drive_config/.test(c.url.pathname)) {
        assert.ok([...c.url.searchParams].some(([key, value]) => key.endsWith('workspace_id') && value === 'eq.ws'));
      }
    }
    const html = h.uploads.map(u => u.body).join('');
    assert.doesNotMatch(html, /FORBIDDEN_/);
    assert.match(html, /가상 회의.*3회차.*가상 프로젝트/);
    assert.match(html, /미완료 연결 할 일: 1 · 자료: 1/);
    assert.match(html, /D-1/); assert.match(html, /가상 하위 프로젝트/);
  });
  test('organization comparator matches app definition for all known and unknown names', () => {
    const ctx = { window: {} };
    vm.runInNewContext(readFileSync(new URL('../../app/organization-order.js', import.meta.url), 'utf8'), ctx);
    const app = ctx.window.KPTUOrganizationOrder;
    assert.equal(JSON.stringify(core.ORGANIZATION_GROUPS), JSON.stringify(app.GROUPS));
    const rows = [...app.GROUPS.flat(), '가상', '나상', '', '궤도협의회'].map(name => ({ name })).reverse();
    assert.deepEqual(rows.slice().sort(core.compareOrganizations).map(r => r.name), Array.from(app.sort(rows), r => r.name));
  });
  test('document top lines carry exact KST refresh notice and HTML escapes input', async () => {
    const h = harness({ data: { app_suborganizations: [{ id: 'org', name: '<script>alert(1)</script>', recent_month_summary: 'a\nb' }] } });
    await h.request({ Authorization: 'Bearer valid-owner' });
    for (const u of h.uploads) {
      assert.match(u.body, /<body>\n<p>마지막 갱신: 2026-10-04 00:30 \(KST\)<\/p>\n<p>이 문서는 Web2가 자동으로 만드는 읽기용 사본입니다\. 직접 고쳐도 다음 갱신 때 덮어써집니다\. 원본은 Web2입니다\.<\/p>/);
      assert.doesNotMatch(u.body, /<script>/);
    }
    assert.match(h.uploads[0].body, /&lt;script&gt;/);
  });
  test('upload failure preserves last success and records a safe failure on folder, without DB writes', async () => {
    const h = harness({ existing: true, uploadFail: true }), response = await h.request({ Authorization: 'Bearer valid-owner' }), result = await response.json();
    assert.equal(response.status, 502); assert.equal(result.ok, false);
    assert.equal(result.updated_at, null);
    assert.equal(h.files.get('folder').appProperties.last_success_at, 'old-success');
    assert.equal(h.files.get('folder').appProperties.last_failure_at, now.toISOString());
    assert.match(h.files.get('folder').appProperties.last_failure_summary, /DRIVE_UPLOAD/);
    assert.doesNotMatch(JSON.stringify(result) + JSON.stringify(h.patches), /SECRET_RAW_FAILURE/);
  });
  test('public permissions fail closed without uploading or changing permissions', async () => {
    for (const options of [{ public: true }, { public: 'domain' }, { permissionFail: true }]) {
      const h = harness({ existing: true, ...options });
      assert.equal((await h.request({ Authorization: 'Bearer valid-owner' })).status, 502);
      assert.equal(h.uploads.length, 0);
      assert.ok(h.calls.filter(c => c.url.pathname.endsWith('/permissions')).every(c => c.method === 'GET'));
    }
  });
  test('OPTIONS only supplies CORS, other methods denied without I/O', async () => {
    const h = harness();
    assert.equal((await h.request({}, 'OPTIONS')).status, 204);
    assert.equal((await h.request({}, 'GET')).status, 405);
    assert.equal(h.calls.length, 0);
  });
  test('partial failure does not mark two documents successful', async () => {
    const h = harness({ existing: true, secondUploadFail: true });
    const result = await (await h.request({ Authorization: 'Bearer valid-owner' })).json();
    assert.equal(result.ok, false); assert.equal(result.updated_at, null);
    assert.deepEqual(Object.keys(result.documents), ['org']);
    assert.equal(result.failure_recorded, true);
    assert.equal(h.files.get('folder').appProperties.last_success_at, 'old-success');
  });
  test('unavailable OAuth or status persistence is reported honestly without upstream detail', async () => {
    for (const options of [{ oauthFail: true }, { existing: true, statusFail: true }]) {
      const h = harness(options), result = await (await h.request({ Authorization: 'Bearer valid-owner' })).json();
      assert.equal(result.ok, false); assert.equal(result.failure_recorded, false);
      assert.doesNotMatch(JSON.stringify(result), /refresh secret/);
    }
  });
  test('all database pages are included, with no writes or silent limit truncation', async () => {
    const h = harness({ data: { app_documents: Array.from({ length: 501 }, (_, i) => ({ id: `d${i}`, project_id: 'p' })) } });
    assert.equal((await h.request({ Authorization: 'Bearer valid-owner' })).status, 200);
    assert.match(h.uploads[1].body, /자료: 501/);
    assert.equal(h.calls.filter(c => c.url.pathname.endsWith('/app_documents')).length, 2);
  });
  test('legacy spaces and unrelated metadata never appear as projects', async () => {
    const h = harness({ data: { app_spaces: [...fixture.app_spaces, { id: 'legacy', name: 'FORBIDDEN_LEGACY_SPACE' }] } });
    assert.equal((await h.request({ Authorization: 'Bearer valid-owner' })).status, 200);
    assert.doesNotMatch(h.uploads[1].body, /FORBIDDEN_LEGACY_SPACE/);
    const select = h.calls.find(c => c.url.pathname.endsWith('/app_spaces')).url.searchParams.get('select');
    assert.match(select, /project_system:metadata->>project_system/);
    assert.doesNotMatch(select, /(?:^|,)metadata(?:,|$)/);
  });
  test('authenticated admin/member roles are denied and cannot read source data', async () => {
    for (const role of ['admin', 'member', 'manager', 'editor']) {
      const h = harness({ data: { app_workspace_members: [{ user_id: 'owner', role }] } });
      assert.equal((await h.request({ Authorization: 'Bearer valid-owner' })).status, 403);
      assert.equal(h.calls.some(c => c.url.hostname === 'www.googleapis.com'), false);
      assert.equal(h.calls.some(c => c.url.pathname.endsWith('/app_spaces')), false);
    }
  });
  test('foreign workspace rows are excluded by direct and explicit embedded filters', async () => {
    const h = harness({ data: {
      app_meetings: [...fixture.app_meetings, { ...fixture.app_meetings[0], id: 'foreign', workspace_id: 'other', series_name: 'FOREIGN_MEETING' }],
      app_project_workstreams: [...fixture.app_project_workstreams, { ...fixture.app_project_workstreams[0], id: 'foreign', project: { workspace_id: 'other' }, title: 'FOREIGN_WORKSTREAM' }],
      app_suborganization_updates: [...fixture.app_suborganization_updates, { ...fixture.app_suborganization_updates[0], id: 'foreign', organization: { workspace_id: 'other' }, raw_text: 'FOREIGN_UPDATE' }],
      app_record_links: [...fixture.app_record_links, { ...fixture.app_record_links[0], id: 'done', task_completed: true }, { ...fixture.app_record_links[0], id: 'unconfirmed', status: 'suggested' }],
    } });
    assert.equal((await h.request({ Authorization: 'Bearer valid-owner' })).status, 200);
    assert.doesNotMatch(h.uploads.map(u => u.body).join(''), /FOREIGN_/);
    assert.match(h.uploads[1].body, /미완료 연결 할 일: 1/);
  });
  test('discovery and permissions follow nextPageToken and reject public sharing on later pages', async () => {
    const h = harness({ existing: true, discoveryPages: true, permissionPages: true });
    assert.equal((await h.request({ Authorization: 'Bearer valid-owner' })).status, 200);
    assert.equal(h.uploads.length, 2); assert.ok(h.uploads.every(u => u.method === 'PATCH'));
    assert.ok(h.calls.some(c => c.url.searchParams.get('pageToken') === 'discovery-page-2'));
    assert.ok(h.calls.some(c => c.url.searchParams.get('pageToken') === 'permission-page-2'));
    const publicLater = harness({ existing: true, permissionPages: true, public: true });
    assert.equal((await publicLater.request({ Authorization: 'Bearer valid-owner' })).status, 502);
    assert.equal(publicLater.uploads.length, 0);
  });
  test('duplicate markers fail closed without arbitrarily replacing a document', async () => {
    const h = harness({ duplicate: true });
    const result = await (await h.request({ Authorization: 'Bearer valid-owner' })).json();
    assert.equal(result.error, 'DRIVE_DUPLICATE_MARKERS'); assert.equal(result.ok, false);
    assert.equal(h.uploads.length, 0);
  });
