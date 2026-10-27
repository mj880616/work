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
  let contentReads=0,headerScans=0,linkScans=0;
  const files = new Map(options.existing ? [
    ['folder', { id: 'folder', mimeType: 'application/vnd.google-apps.folder', appProperties: { kptu_summary: 'folder', last_success_at: 'old-success', extra: 'keep', ...options.folderProps } }],
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
        assert.match(url.searchParams.get('select'), /project:app_spaces!project_id!inner\(workspace_id,deleted_at\)/);
      }
      if (table === 'app_workspace_members') {
        assert.equal(url.searchParams.get('select'), 'user_id,role');
        assert.equal(url.searchParams.get('order'), 'user_id.asc');
      }
      let rows = structuredClone(options.data?.[table] || fixture[table] || []).map(row => ({
        workspace_id: 'ws', project: { workspace_id: 'ws' }, organization: { workspace_id: 'ws' }, ...row,
      }));
      if (table === 'app_workspace_members' && url.searchParams.has('user_id') && url.searchParams.get('user_id') !== 'eq.owner') rows = [];
      if (options.failTable === table) return reply({message:'PRIVATE_READ_FAILURE'},503);
      // TRASH-다른삭제 5단계: noTrashColumn = DB 적용 전(app_notes에 deleted_at 칸이 없음). otherColumnError = 그 밖의 400 거절.
      if (table === 'app_notes' && url.searchParams.has('deleted_at') && options.noTrashColumn) return Response.json({code:'42703',details:null,hint:null,message:'column app_notes.deleted_at does not exist'},{status:400});
      if (table === 'app_notes' && url.searchParams.has('deleted_at') && options.otherColumnError) return Response.json({code:'42501',message:'permission denied'},{status:400});
      if (options.failAssignmentPage && table === 'app_suborganization_assignees' && Number(url.searchParams.get('offset')) > 0) return reply({},503);
      for (const [key, value] of url.searchParams) {
        const field = r => key.split('.').reduce((v, part) => v?.[part], r);
        if (value.startsWith('in.(')) rows = rows.filter(r=>value.slice(4,-1).split(',').includes(String(field(r))));
        if (value.startsWith('eq.')) rows = rows.filter(r => String(field(r)) === value.slice(3));
        if (value === 'is.null') rows = rows.filter(r => field(r) == null);
        if (value === 'not.is.null') rows = rows.filter(r => field(r) != null);
        if (value.startsWith('gte.')) rows = rows.filter(r => r[key] >= value.slice(4));
        if (value.startsWith('lte.')) rows = rows.filter(r => r[key] <= value.slice(4));
      }
      const range=new Headers(init.headers).get('Range');
      const notePath=table==='app_notes',linkPath=table==='app_record_links'&&url.searchParams.has('note_id');
      if(notePath||linkPath){
        const content=notePath&&url.searchParams.get('select').split(',').includes('raw_text');
        if(content)contentReads++;
        if(range?.startsWith('0-')&&!content){if(notePath)headerScans++;else linkScans++;}
        rows=options.mutateRows?.({rows,table,content,contentReads,headerScans,linkScans})??rows;
        // PostgREST "alias:metadata->key" returns that one JSON value of metadata under the alias.
        const columns=url.searchParams.get('select').split(',').map(c=>{const [alias,expr]=c.split(':');const m=/^metadata->([a-z_]+)$/.exec(expr||'');return [alias,m?r=>r.metadata?.[m[1]]:r=>r[alias]];});
        rows=rows.map(r=>Object.fromEntries(columns.map(([k,get])=>[k,get(r)??null])));
        if(range){
          const [start,end]=range.split('-').map(Number);
          const page=rows.slice(start,Math.min(end+1,start+(options.notePageCap||500)));
          const value=rows.length?`${start}-${start+page.length-1}/${rows.length}`:'*/0';
          return options.noteResponse?.({rows:page,content,table,value})??Response.json(page,{headers:options.noNoteRange?{}:{'Content-Range':options.noteRange||value}});
        }
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
      // Drive v3 update merges appProperties per key; a null value clears that key.
      const folder = files.get('folder'), { appProperties, ...rest } = patch;
      Object.assign(folder, rest);
      if (appProperties) {
        folder.appProperties = { ...folder.appProperties };
        for (const [key, value] of Object.entries(appProperties)) { if (value === null) delete folder.appProperties[key]; else folder.appProperties[key] = value; }
      }
      return reply(files.get('folder'));
    }
    throw new Error(`Unhandled ${method} ${url}`);
  };
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', DRIVE_SUMMARY_CRON_SECRET: options.noSecret ? undefined : 'right-secret', COLLECTOR_HEARTBEAT_SECRET: options.noHeartbeatSecret ? undefined : 'beat-secret' };
  const handler = core?.createHandler({ env, fetcher, now: () => now });
  const request = (headers = {}, method = 'POST', body) => handler(new Request('https://edge.test/drive-summary', { method, headers, body }));
  const statusRequest = (headers = {}, query = '?action=status') => handler(new Request(`https://edge.test/drive-summary${query}`, { method: 'GET', headers }));
  const heartbeatRequest = (headers = {}, body, query = '?action=heartbeat') => handler(new Request(`https://edge.test/drive-summary${query}`, { method: 'POST', headers, body: typeof body === 'string' || body === undefined ? body : JSON.stringify(body) }));
  return { calls, uploads, patches, files, request, statusRequest, heartbeatRequest };
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
    // S7-d + heartbeat: the copy path sends only its own key, never a stale snapshot of ledger/collector keys.
    assert.deepEqual(h.patches.map(p => Object.keys(p.appProperties || {})), [['last_success_at']]);
  });
  test('copy rebuild does not roll back ledger export or heartbeat keys written while it ran', async () => {
    const h = harness({ existing: true });
    // Another call (ledger export / collector heartbeat) writes after the copy path read the folder.
    const folder = h.files.get('folder');
    const later = { ledger_last_success_at: '2026-10-03T15:29:00.000Z', collector_telegram_at: '2026-10-03T15:00:00.000Z', collector_telegram_count: '3', collector_telegram_reported_at: '2026-10-03T15:29:30.000Z' };
    const response = await h.request({ Authorization: 'Bearer valid-owner' });
    assert.equal(response.status, 200);
    Object.assign(folder.appProperties, later);
    // A second rebuild must keep the other paths' keys exactly (it only sends last_success_at).
    assert.equal((await h.request({ Authorization: 'Bearer valid-owner' })).status, 200);
    for (const [k, v] of Object.entries(later)) assert.equal(h.files.get('folder').appProperties[k], v, k);
    assert.ok(h.patches.every(p => Object.keys(p.appProperties || {}).every(k => k === 'last_success_at')));
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
  test('queries are workspace scoped allowlists, never raw meetings, tasks or document bodies; basket notes use a dedicated allowlist', async () => {
    const h = harness(); await h.request({ Authorization: 'Bearer valid-owner' });
    for (const c of h.calls.filter(c => c.url.pathname.startsWith('/rest/v1/'))) {
      const select = c.url.searchParams.get('select');
      if (c.url.pathname.endsWith('/app_notes')) assert.equal(select,'id,workspace_id,occurred_at,archived_at,ai_export_allowed,journal_at:metadata->journal_at');
      assert.doesNotMatch(select, /\*|transcript_text|notes|decisions|body|detail_text|year_summary/);
      assert.doesNotMatch(c.url.pathname, /app_tasks|timeline|comments/);
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
    // D-담당조직목록 combines only the last two UI groups. The Edge uses these arrays solely for sorting;
    // preserve and verify its deployed structure and the exact relationship to the four UI groups.
    assert.equal(core.ORGANIZATION_GROUPS.length, 5);
    assert.equal(app.GROUPS.length, 4);
    const uiGroups = [...core.ORGANIZATION_GROUPS.slice(0, 3), core.ORGANIZATION_GROUPS.slice(3).flat()];
    assert.equal(JSON.stringify(uiGroups), JSON.stringify(app.GROUPS));
    assert.equal(JSON.stringify(core.ORGANIZATION_GROUPS.flat()), JSON.stringify(app.GROUPS.flat()));
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
  test('휴지통 프로젝트(하위 포함)와 그 진행 자료는 요약에서 빠진다', async () => {
    const trashed = { deleted_at: '2026-10-24T01:00:00Z', deleted_root_id: 'trash' };
    const h = harness({ data: {
      app_spaces: [...fixture.app_spaces, { id: 'trash', name: 'TRASHED_PROJECT_NAME', project_system: 'v2', status: 'active', parent_id: null, sort_order: 3, ...trashed }, { id: 'trash-child', name: 'TRASHED_CHILD_NAME', parent_id: 'trash', status: 'active', sort_order: 4, ...trashed }],
      app_project_workstreams: [...fixture.app_project_workstreams, { id: 'tw', project_id: 'trash', phase: 'consultation', title: 'TRASHED_WORKSTREAM', sort_order: 1, project: { workspace_id: 'ws', ...trashed } }],
      app_project_milestones: [...fixture.app_project_milestones, { id: 'tm', project_id: 'trash', title: 'TRASHED_MILESTONE', start_at: '2026-10-06T01:00:00Z', project: { workspace_id: 'ws', ...trashed } }],
    } });
    assert.equal((await h.request({ Authorization: 'Bearer valid-owner' })).status, 200);
    assert.doesNotMatch(h.uploads[1].body, /TRASHED_/);
    assert.match(h.uploads[1].body, /가상 프로젝트/);
    for (const t of ['app_spaces', 'app_project_workstreams', 'app_project_progress_updates', 'app_project_milestones']) {
      const u = h.calls.find(c => c.url.pathname.endsWith('/' + t)).url.searchParams;
      assert.equal(u.get(t === 'app_spaces' ? 'deleted_at' : 'project.deleted_at'), 'is.null', t);
    }
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

const note = (id, extra = {}) => ({id, kind:'basket', raw_text:`TEXT_${id}`, occurred_at:now.toISOString(), created_at:now.toISOString(), updated_at:now.toISOString(), archived_at:null, ai_export_allowed:true, attachments:[], ...extra});
const ocrPhoto = (state='done',text='  인식 글 <script>\r\n끝  ') => ({drive_file_id:'photo-source',file_name:'원본.jpg',mime_type:'image/jpeg',size_bytes:4,
 ocr:{state,original_file_id:'photo-source',attempt_id:'10000000-0000-4000-8000-000000000001',text,temp_document_id:'photo-temp',cleanup_state:'created'}});
test('Drive copy never carries OCR text, attachment links or memo IDs',async()=>{
 const h=harness({data:{app_notes:[note('ocr-id',{raw_text:'RAW_BODY',attachments:[ocrPhoto('done','OCR_TEXT'),ocrPhoto('failed','OCR_FAILED_TEXT')]})]}});
 assert.equal((await h.request({Authorization:'Bearer valid-owner'})).status,200);
 const html=h.uploads[1].body;
 assert.doesNotMatch(html,/OCR_TEXT|OCR_FAILED_TEXT|RAW_BODY|ocr-id|사진에서 읽은 글|drive\.google\.com\/file|photo-source|원본\.jpg/);
 assert.match(html,/바구니 미분류 메모 1건 \(내용은 Web2 바구니에서 확인\)/);
});
test('basket count line includes only eligible unclassified owner notes with KST boundaries', async () => {
  const window=core.kstWindow(now);
  const h=harness({data:{
    app_notes:[note('inside',{occurred_at:window.start}), note('old',{occurred_at:'2026-09-05T14:59:59.999Z'}), note('future',{occurred_at:'2026-10-04T00:00:00Z'}), note('archived',{archived_at:now.toISOString()}), note('excluded',{ai_export_allowed:false}), note('confirmed'), note('suggested'), note('foreign',{workspace_id:'other'}), note('memo-note',{kind:'note',title:'노트'}), note('diary',{kind:'diary'})],
    app_record_links:[...fixture.app_record_links,{id:'c',note_id:'confirmed',status:'confirmed'},{id:'s',note_id:'suggested',status:'suggested'}],
  }});
  assert.equal((await h.request({Authorization:'Bearer valid-owner'})).status,200);
  const project=h.uploads[1].body, org=h.uploads[0].body;
  assert.match(project,/<h2>바구니<\/h2>\n<p>바구니 미분류 메모 1건 \(내용은 Web2 바구니에서 확인\)<\/p>\n<\/body><\/html>/);
  assert.doesNotMatch(project,/TEXT_|inside|대상 건수|4주 이전|view=basket/);
  assert.doesNotMatch(org,/바구니|TEXT_/); assert.match(org,/현재 요약/); assert.match(project,/진행 기록|최근 4주 회의/);
  const notesQuery=h.calls.find(c=>c.url.pathname.endsWith('/app_notes')).url.searchParams;
  assert.equal(notesQuery.get('archived_at'),'is.null');assert.equal(notesQuery.get('ai_export_allowed'),'eq.true');assert.equal(notesQuery.get('kind'),'eq.basket');
});
test('Drive copy has no memo body, memo ID, Web2 memo link, attachments or classification instructions',async()=>{
 const raw='  첫 줄\n\n\t둘째 <script> & 줄\r\n끝  ';
 const h=harness({data:{app_notes:[note('raw-id',{raw_text:raw,attachments:[{drive_file_id:'fake_file-123',file_name:'사진 <원본>.png',mime_type:'image/png',size_bytes:123}]})]}});
 assert.equal((await h.request({Authorization:'Bearer valid-owner'})).status,200);
 const html=h.uploads[1].body;
 assert.doesNotMatch(html,/첫 줄|둘째|<pre|<script>|raw-id|메모 ID|updated_at|fake_file-123|사진|image\/png|view=basket|note=/);
 assert.doesNotMatch(html,/schema_version|note_updated_at|copied_at|제안만 해 주세요|분류 결과 입력|```|organization ·|project ·|담당조직 목록|프로젝트 목록|제안 출력 안내/);
 assert.equal(html.split('<h2>바구니</h2>')[1].split('</body></html>')[0],'\n<p>바구니 미분류 메모 1건 (내용은 Web2 바구니에서 확인)</p>\n');
});
test('the notes query reads only the columns the count needs (no raw_text, attachments, created_at, updated_at)',async()=>{
 const h=harness({data:{app_notes:[note('one'),note('two')]}});
 assert.equal((await h.request({Authorization:'Bearer valid-owner'})).status,200);
 const selects=h.calls.filter(c=>c.url.pathname.endsWith('/app_notes')).map(c=>c.url.searchParams.get('select'));
 assert.equal(selects.length,2);
 for(const select of selects)assert.equal(select,'id,workspace_id,occurred_at,archived_at,ai_export_allowed,journal_at:metadata->journal_at');
 assert.equal(contentCalls(h).length,0);
 assert.ok(h.calls.every(c=>!c.url.searchParams.get('id')?.startsWith('in.(')||!c.url.pathname.endsWith('/app_notes')),'no per-ID note body reads');
});
test('basket section lists no organization or project destinations',async()=>{
 const h=harness({data:{app_notes:[],app_suborganizations:[{id:'org',name:'가상 조직',contact:'PRIVATE_CONTACT',recent_month_summary:'PRIVATE_SUMMARY'}],app_spaces:[...fixture.app_spaces,{id:'legacy',name:'PRIVATE_LEGACY'}]}});
 await h.request({Authorization:'Bearer valid-owner'});
 const section=h.uploads[1].body.split('<h2>바구니</h2>')[1].split('</body></html>')[0];
 assert.equal(section,'\n<p>바구니 미분류 메모 0건 (내용은 Web2 바구니에서 확인)</p>\n');
});
test('more than 100 unclassified memos no longer fail: only the count grows',async()=>{
 const h=harness({data:{app_notes:Array.from({length:150},(_,i)=>note('many'+i,{raw_text:'가'.repeat(20000)}))}});
 const result=await (await h.request({Authorization:'Bearer valid-owner'})).json();
 assert.equal(result.ok,true);
 const html=h.uploads[1].body;assert.match(html,/바구니 미분류 메모 150건 \(내용은 Web2 바구니에서 확인\)/);assert.doesNotMatch(html,/가{10}/);
 assert.ok(new TextEncoder().encode(html).length<100000);
});
test('basket state matches the screen for confirmed, suggested and archived notes',async()=>{
 const {noteState}=await import('../../app/basket-data.js');
 for(const links of [[],[{note_id:'n',status:'confirmed'}],[{note_id:'n',status:'suggested'}]]){
  for(const archived_at of [null,now.toISOString()]) assert.equal(core.basketState(note('n',{archived_at}),links),noteState(note('n',{archived_at}),links).status);
 }
 assert.equal(core.basketState(note('n'),[{note_id:'n',status:'suggested'}]),'분류 제안됨');
});

// BASKET-일지로남기기: an update kept as a work-journal memo (metadata.journal_at) is not 미분류 in the Drive copy either.
test('work-journal memos (metadata.journal_at) leave the basket count; unmarked ones stay',async()=>{
 const AT='2026-10-03T10:00:00.000Z';
 const h=harness({data:{app_notes:[
  note('kept',{metadata:{journal_at:AT,other:'PRIVATE_META'}}),note('keptOld',{occurred_at:'2026-09-01T00:00:00Z',metadata:{journal_at:AT}}),
  note('plain'),note('plainOld',{occurred_at:'2026-09-01T00:00:00Z'}),note('noMeta',{metadata:null}),
  note('badNumber',{metadata:{journal_at:1}}),note('badText',{metadata:{journal_at:'nope'}}),note('badObject',{metadata:{journal_at:{at:AT}}}),
 ]}});
 assert.equal((await h.request({Authorization:'Bearer valid-owner'})).status,200);
 const project=h.uploads[1].body;
 assert.doesNotMatch(project,/TEXT_|PRIVATE_META/);
 assert.match(project,/바구니 미분류 메모 5건 \(내용은 Web2 바구니에서 확인\)/);
 assert.equal(contentCalls(h).length,0);
});
test('Edge noteJournalAt matches the screen rule (app/update-journal.js) for every mark shape',async()=>{
 const {noteJournalAt}=await import('../../app/update-journal.js');
 const basket=await import('../../supabase/functions/drive-summary/basket.mjs');
 for(const value of [undefined,null,'2026-10-03T10:00:00.000Z','nope','',1,0,true,{},[],['2026-10-03T10:00:00Z']]){
  const screen=noteJournalAt({metadata:value===undefined?{}:{journal_at:value}});
  assert.equal(basket.noteJournalAt({journal_at:value??null}),screen,JSON.stringify(value));
 }
 const window=core.kstWindow(now),AT='2026-10-03T10:00:00.000Z';
 const prepared=basket.prepareBasket([note('a',{journal_at:AT}),note('b',{journal_at:null}),note('c',{journal_at:'nope'})],[],now,window);
 assert.deepEqual(prepared.recent.map(n=>n.id),['b','c']);
});
test('a journal mark changed between selection and recheck fails closed',async()=>{
 const h=harness({existing:true,data:{app_notes:[note('one'),note('two')]},mutateRows:({rows,table,content,headerScans})=>table==='app_notes'&&!content&&headerScans===2?rows.map(r=>r.id==='one'?{...r,metadata:{journal_at:'2026-10-03T10:00:00.000Z'}}:r):rows});
 const r=await(await h.request({Authorization:'Bearer valid-owner'})).json();assert.equal(r.error,'DB_READ_FAILED');assert.equal(h.uploads.length,0);
});

test('basket section lists no catalog tree; the existing project report stays unchanged',async()=>{
 const spaces=[...fixture.app_spaces,{id:'done',name:'DONE_PROJECT',project_system:'v2',status:'done'},{id:'archived',name:'ARCHIVED_PARENT',project_system:'v2',status:'archived'},{id:'hidden',name:'HIDDEN_CHILD',parent_id:'archived',status:'active'}];
 const h=harness({data:{app_spaces:spaces}});await h.request({Authorization:'Bearer valid-owner'});
 const html=h.uploads[1].body,[before,rest]=html.split('<h2>바구니</h2>');
 assert.equal(rest.split('</body></html>')[0],'\n<p>바구니 미분류 메모 0건 (내용은 Web2 바구니에서 확인)</p>\n');
 assert.match(before,/ARCHIVED_PARENT/);assert.match(before,/가상 프로젝트|가상 하위 프로젝트/);
});
test('exact 1MiB UTF-8 project limit is inclusive; the next byte fails',()=>{
 const make=n=>({organizations:[],organizationUpdates:[],projects:[{id:'p',name:'합성 상한 프로젝트',project_system:'v2',status:'active'}],workstreams:[],progress:[{id:'u',project_id:'p',effective_on:'2026-10-01',summary:'x'.repeat(n),next_step:'다음',status_label:'확인'}],milestones:[],taskLinks:[],documents:[],meetings:[],noteLinks:[],notes:[]});
 const encoder=new TextEncoder(),bytes=n=>encoder.encode(core.renderDocuments(make(n),now).project).length;
 const unit=bytes(2)-bytes(1);assert.equal(unit,1);
 const fit=core.BASKET_LIMITS.documentBytes-bytes(0);
 let rendered=core.renderDocuments(make(fit),now);assert.equal(rendered.basketError,undefined);assert.equal(encoder.encode(rendered.project).length,1048576);
 const failure=core.renderDocuments(make(fit+1),now);assert.equal(failure.basketError,'BASKET_OUTPUT_LIMIT');assert.match(failure.project,/대상 축소 필요/);assert.doesNotMatch(failure.project,/x{100}/);assert.ok(encoder.encode(failure.project).length<=1048576);
});
test('caller workspace period and folder payload cannot select source or destination',async()=>{
 const h=harness({data:{app_notes:[note('owner')],app_record_links:[{id:'foreign-link',workspace_id:'other',note_id:'owner',status:'confirmed'}]}});
 const response=await h.request({Authorization:'Bearer valid-owner'},'POST',JSON.stringify({workspace_id:'other',start:'1900-01-01',folder_id:'evil-folder'}));assert.equal(response.status,200);
 assert.match(h.uploads[1].body,/바구니 미분류 메모 1건/);assert.doesNotMatch(h.uploads[1].body,/TEXT_owner/);assert.ok(h.calls.every(c=>!c.url.href.includes('evil-folder')&&!c.url.href.includes('1900-01-01')));
});

const decodeHtml=value=>value.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
test('organization copy includes all organization pages across read pages',async()=>{
 const orgs=Array.from({length:501},(_,i)=>({id:`org-${i}`,name:`합성 담당조직 ${i}`}));
 const h=harness({data:{app_suborganizations:orgs}});await h.request({Authorization:'Bearer valid-owner'});
 const orgCopy=h.uploads[0].body;
 for(const org of orgs)assert.ok(orgCopy.includes(`<h2>${org.name}</h2>`),org.name);
 assert.equal(h.calls.filter(c=>c.url.pathname.endsWith('app_suborganizations')).length,2);
 assert.equal(h.uploads[1].body.split('<h2>바구니</h2>')[1].includes('합성 담당조직'),false);
});
test('organization copy, project status and meetings match the starting main snapshot byte for byte',()=>{
 const data={organizations:fixture.app_suborganizations,organizationUpdates:fixture.app_suborganization_updates,projects:fixture.app_spaces,workstreams:fixture.app_project_workstreams,progress:fixture.app_project_progress_updates,milestones:fixture.app_project_milestones,taskLinks:fixture.app_record_links,documents:fixture.app_documents,meetings:fixture.app_meetings};
 const actual=core.renderDocuments(data,now);
 const baseline=JSON.parse(readFileSync(new URL('../fixtures/drive-summary-outside-basket.json',import.meta.url),'utf8'));
 assert.deepEqual({org:actual.org,projectPrefix:actual.project.split('<h2>바구니</h2>')[0]},baseline);
});

const assignedOrgs=[{id:'a',name:'합성 담당 A',active:true},{id:'b',name:'합성 담당 B',active:null},{id:'c',name:'합성 다른 조직',active:true,default_assignee_name:'합성 소유자'},{id:'d',name:'합성 비활성',active:false}];
const assignedUpdates=[['a','2026-10-01T01:00:00Z'],['c','2026-10-02T01:00:00Z'],['d','2026-09-30T01:00:00Z']].map(([id,at])=>({id:'u'+id,organization_id:id,raw_text:`합성 기록 ${id}`,occurred_at:at}));
for(const mode of ['two','zero','inactive-only','failure','owner-failure','later-page-failure']){
 test(`Drive basket organization selection: ${mode}, owner JWT and cron agree`,async()=>{
  for(const headers of [{Authorization:'Bearer valid-owner'},{'x-drive-summary-cron-secret':'right-secret'}]){
   const assignees=mode==='two'?[{organization_id:'a',user_id:'owner'},{organization_id:'b',user_id:'owner'},{organization_id:'d',user_id:'owner'},{organization_id:'c',user_id:'other'},{organization_id:'c',user_id:'owner',organization:{workspace_id:'other'}}]:mode==='inactive-only'?[{organization_id:'d',user_id:'owner'}]:mode==='later-page-failure'?Array.from({length:501},()=>({organization_id:'a',user_id:'owner'})):[];
   const h=harness({failTable:mode==='failure'?'app_suborganization_assignees':mode==='owner-failure'&&headers['x-drive-summary-cron-secret']?'app_workspace_members':undefined,failAssignmentPage:mode==='later-page-failure',data:{app_suborganizations:assignedOrgs,app_suborganization_assignees:assignees,app_suborganization_updates:assignedUpdates}});
   assert.equal((await h.request(headers)).status,200);
   // DRIVE-바구니원문제외: the project copy no longer lists organizations; the selection shows only in the organization copy below.
   const section=h.uploads[1].body.split('<h2>바구니</h2>')[1];
   assert.doesNotMatch(section,/organization ·|담당조직 목록|담당조직이 지정되지 않아|PRIVATE_READ_FAILURE/);
   // ORG-담당13기준: the organization copy follows the same list — one section per organization of mine, and the
   // records of every other organization (not mine, inactive) under one "그 외" so nothing of the 4 weeks is lost.
   const orgCopy=h.uploads[0].body,mineIds=mode==='two'?['a','b']:['a','b','c'];
   for(const row of assignedOrgs){
    const own=mineIds.includes(row.id);
    assert.equal(orgCopy.includes(`<h2>${row.name}</h2>`),own,`${mode} ${row.id} section`);
    if(row.id==='b')continue; // b has no record
    const kst=row.id==='a'?'2026-10-01 10:00':row.id==='c'?'2026-10-02 10:00':'2026-09-30 10:00';
    assert.equal(orgCopy.includes(`<p>${kst} (KST) · 합성 기록 ${row.id}</p>`),own,`${mode} ${row.id} own record`);
    assert.equal(orgCopy.includes(`<p>${kst} (KST) · ${row.name} · 합성 기록 ${row.id}</p>`),!own,`${mode} ${row.id} in 그 외`);
   }
   assert.ok(orgCopy.indexOf('<h2>그 외</h2>')>orgCopy.indexOf('<h2>합성 담당 B</h2>'));
   assert.equal(orgCopy.split('<h2>그 외</h2>').length,2);
   for(const c of h.calls.filter(c=>c.url.pathname.endsWith('/app_suborganization_assignees'))){
    assert.equal(c.url.searchParams.get('user_id'),'eq.owner');
    assert.equal(c.url.searchParams.get('organization.workspace_id'),'eq.ws');
    assert.match(c.url.searchParams.get('select'),/organization:app_suborganizations!organization_id!inner\(workspace_id\)/);
   }
  }
 });
}

test('cron cannot choose an arbitrary owner when the fixed workspace has zero or multiple owners',async()=>{
 for(const members of [[],[{user_id:'owner',role:'owner'},{user_id:'other',role:'owner'}]]){
  const h=harness({data:{app_workspace_members:members,app_suborganizations:assignedOrgs,app_suborganization_assignees:[{organization_id:'a',user_id:'owner'}]}});
  assert.equal((await h.request({'x-drive-summary-cron-secret':'right-secret'})).status,200);
  const orgCopy=h.uploads[0].body;
  for(const name of ['합성 담당 A','합성 담당 B','합성 다른 조직'])assert.ok(orgCopy.includes(`<h2>${name}</h2>`),name);
  assert.ok(!orgCopy.includes('<h2>합성 비활성</h2>'));
  assert.ok(!h.calls.some(c=>c.url.pathname.endsWith('/app_suborganization_assignees')));
  const q=h.calls.find(c=>c.url.pathname.endsWith('/app_workspace_members')).url.searchParams;
  assert.equal(q.get('workspace_id'),'eq.ws');assert.equal(q.get('role'),'eq.owner');
 }
});
test('Drive completes every owner assignment page before selecting the organizations of the copy',async()=>{
 const assignments=[...Array.from({length:500},()=>({organization_id:'a',user_id:'owner'})),{organization_id:'b',user_id:'owner'}];
 const h=harness({data:{app_suborganizations:assignedOrgs,app_suborganization_assignees:assignments}});
 assert.equal((await h.request({Authorization:'Bearer valid-owner'},'POST',JSON.stringify({user_id:'other',organization_ids:['c'],workspace_id:'other'}))).status,200);
 const orgCopy=h.uploads[0].body;
 assert.ok(orgCopy.includes('<h2>합성 담당 A</h2>'));assert.ok(orgCopy.includes('<h2>합성 담당 B</h2>'));assert.ok(!orgCopy.includes('<h2>합성 다른 조직</h2>'));assert.ok(!orgCopy.includes('<h2>합성 비활성</h2>'));
 assert.equal(h.calls.filter(c=>c.url.pathname.endsWith('/app_suborganization_assignees')).length,2);
});

const contentCalls=h=>h.calls.filter(c=>c.url.pathname.endsWith('/app_notes')&&c.url.searchParams.get('select')?.split(',').includes('raw_text'));
test('summary count101 reads headers only and still publishes both copies',async()=>{
 const h=harness({existing:true,notePageCap:2,data:{app_notes:Array.from({length:101},(_,i)=>note('limit'+i))}});
 const result=await(await h.request({Authorization:'Bearer valid-owner'})).json();
 assert.equal(result.ok,true);assert.equal(contentCalls(h).length,0);assert.equal(h.uploads.length,2);
 assert.match(h.uploads[1].body,/바구니 미분류 메모 101건/);
});
test('summary complete capped headers and links are read in full pages; no per-ID body reads',async()=>{
 const notes=[...Array.from({length:12},(_,i)=>note('n'+i)),note('old',{occurred_at:'2026-01-01T00:00:00Z'}),note('excluded',{ai_export_allowed:false}),note('archived',{archived_at:now.toISOString()})];
 const h=harness({notePageCap:2,data:{app_notes:notes,app_record_links:[...fixture.app_record_links,{id:'a',note_id:'n0',status:'confirmed'},{id:'b',note_id:'n11',status:'suggested'}]}});
 assert.equal((await h.request({Authorization:'Bearer valid-owner'})).status,200);
 assert.equal(contentCalls(h).length,0);
 assert.ok(!h.calls.some(c=>c.url.pathname.endsWith('/app_notes')&&c.url.searchParams.has('id')),'no per-ID note reads');
 const body=h.uploads[1].body;assert.doesNotMatch(body,/TEXT_/);assert.match(body,/바구니 미분류 메모 10건 \(내용은 Web2 바구니에서 확인\)/);
});
for(const opts of [{noNoteRange:true},{noteRange:'0-0/*'},{noteRange:'1-1/1'}])test('summary incomplete notes Range fails before document bodies '+JSON.stringify(opts),async()=>{
 const h=harness({existing:true,...opts,data:{app_notes:[note('one')]}});const r=await(await h.request({Authorization:'Bearer valid-owner'})).json();
 assert.equal(r.error,'DB_READ_FAILED');assert.equal(h.uploads.length,0);assert.equal(r.failure_recorded,true);assert.equal(h.files.get('folder').appProperties.last_success_at,'old-success');
});
for(const variant of ['archive','ai','workspace','delete','link'])test('summary snapshot mismatch prevents both bodies '+variant,async()=>{
 const h=harness({existing:true,data:{app_notes:[note('one')]},mutateRows:({rows,table,content,headerScans,linkScans})=>{
  if(table==='app_notes'&&!content&&headerScans>1){if(variant==='delete')return [];if(variant==='archive')return rows.map(r=>({...r,archived_at:now.toISOString()}));if(variant==='ai')return rows.map(r=>({...r,ai_export_allowed:false}));if(variant==='workspace')return rows.map(r=>({...r,workspace_id:'foreign'}));}
  if(table==='app_record_links'&&linkScans>1&&variant==='link')return [...rows,{id:'late',note_id:'one',workspace_id:'ws',status:'confirmed'}];return rows;
 }});const r=await(await h.request({Authorization:'Bearer valid-owner'})).json();assert.equal(r.error,'DB_READ_FAILED');assert.equal(h.uploads.length,0);assert.equal(r.failure_recorded,true);
});

test('summary exactly100 memos need only the two header scans and no body reads',async()=>{
 const h=harness({data:{app_notes:Array.from({length:100},(_,i)=>note(`n${String(i).padStart(3,'0')}`))}});
 assert.equal((await h.request({Authorization:'Bearer valid-owner'})).status,200);assert.equal(contentCalls(h).length,0);
 const headers=h.calls.filter(c=>c.url.pathname.endsWith('/app_notes'));
 assert.equal(headers.length,2);assert.match(h.uploads[1].body,/바구니 미분류 메모 100건/);
});
for(const variant of ['duplicate','rawExtra'])test('invalid notes response identities/projection fails closed '+variant,async()=>{
 const h=harness({existing:true,data:{app_notes:[note('one'),note('two')]},noteResponse:({rows,content,table,value})=>{
  if(table!=='app_notes')return;
  if(variant==='duplicate'&&!content&&rows.length===2)return Response.json([rows[0],rows[0]],{headers:{'Content-Range':value}});
  if(variant==='rawExtra'&&!content)return Response.json(rows.map(r=>({...r,raw_text:'PRIVATE'})),{headers:{'Content-Range':value}});
 }});const r=await(await h.request({Authorization:'Bearer valid-owner'})).json();assert.equal(r.error,'DB_READ_FAILED');assert.equal(h.uploads.length,0);
});

test('capped selector page total drift fails before either body and preserves old success',async()=>{
 let pages=0;
 const h=harness({existing:true,notePageCap:2,data:{app_notes:[note('one'),note('two'),note('three')]},noteResponse:({rows,content,table,value})=>{
  if(!content&&table==='app_notes'&&++pages===2)return Response.json(rows,{headers:{'Content-Range':value.replace('/3','/4')}});
 }});const r=await(await h.request({Authorization:'Bearer valid-owner'})).json();assert.equal(r.error,'DB_READ_FAILED');assert.equal(h.uploads.length,0);assert.equal(h.files.get('folder').appProperties.last_success_at,'old-success');
});
test('notes advertised100000 retains the existing read limit refusal without accumulating that content',async()=>{
 const h=harness({existing:true,data:{app_notes:[note('one')]},noteResponse:({rows,content,table})=>!content&&table==='app_notes'?Response.json(rows,{headers:{'Content-Range':'0-0/100000'}}):undefined});
 const r=await(await h.request({Authorization:'Bearer valid-owner'})).json();assert.equal(r.error,'DB_READ_LIMIT');assert.equal(contentCalls(h).length,0);assert.equal(h.uploads.length,0);
});

// OPS-수집점검: GET ?action=status — owner JWT only, read-only, times and a safe stage code only.
const writes = h => h.calls.filter(c => c.method !== 'GET' && c.url.hostname !== 'oauth2.googleapis.com');
test('status read: anonymous, forged, non-owner and any cron header are refused before Google', async () => {
  for (const [headers, status] of [
    [{}, 401], [{ Authorization: 'Bearer forged' }, 401], [{ Authorization: 'Bearer valid-other' }, 403],
    [{ 'x-drive-summary-cron-secret': 'right-secret' }, 401],
    [{ 'x-drive-summary-cron-secret': 'right-secret', Authorization: 'Bearer valid-owner' }, 401],
    [{ 'x-drive-summary-cron-secret': '' , Authorization: 'Bearer valid-owner' }, 401],
  ]) {
    const h = harness({ existing: true }), response = await h.statusRequest(headers), result = await response.json();
    assert.equal(response.status, status);
    assert.equal(result.ok, false);
    assert.ok(!('copy' in result));
    assert.ok(h.calls.every(c => c.url.hostname === 'db.test'), 'no Google call before owner check');
    assert.equal(writes(h).length, 0);
  }
});
test('status read: other GET actions are 405 without I/O, and POST without action still rebuilds', async () => {
  for (const query of ['', '?action=refresh', '?action=STATUS', '?x=status']) {
    const h = harness({ existing: true }), response = await h.statusRequest({ Authorization: 'Bearer valid-owner' }, query);
    assert.equal(response.status, 405); assert.equal(h.calls.length, 0);
  }
  const h = harness({ existing: true }), r = await h.request({ Authorization: 'Bearer valid-owner' });
  assert.equal(r.status, 200); assert.equal(h.uploads.length, 2);
});
test('status read: returns only the three folder values, never names, IDs, links, or other properties, and writes nothing', async () => {
  const h = harness({ existing: true, folderProps: {
    last_success_at: '2026-10-03T04:17:00.000Z', last_failure_at: '2026-10-02T21:17:05.120Z', last_failure_summary: 'DRIVE_UPLOAD_FAILED', extra: '비공개 내용 FORBIDDEN_EXTRA',
  } });
  const response = await h.statusRequest({ Authorization: 'Bearer valid-owner' }), result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result, { ok: true, checked_at: now.toISOString(), copy: {
    state: 'found', last_success_at: '2026-10-03T04:17:00.000Z', last_failure_at: '2026-10-02T21:17:05.120Z', last_failure_code: 'DRIVE_UPLOAD_FAILED',
  }, collectors: { telegram: null, transcript: null, telegram_send: null, call_send: null }, text_backfill: null });
  assert.doesNotMatch(JSON.stringify(result), /FORBIDDEN|folder"|docs\.google|읽기용 사본|kptu_/);
  assert.equal(writes(h).length, 0, 'no create, upload, or status PATCH');
  assert.equal(h.uploads.length, 0); assert.equal(h.patches.length, 0);
  assert.ok(!h.calls.some(c => /app_suborganization|app_spaces|app_meetings|app_notes|app_project/.test(c.url.pathname)), 'no Web2 record read');
  assert.ok(h.calls.some(c => c.url.pathname.endsWith('/permissions')), 'sharing check kept');
});
test('status read: malformed stored values are dropped, not echoed', async () => {
  const h = harness({ existing: true, folderProps: {
    last_success_at: '내용이 들어간 값', last_failure_at: '2026-10-02T21:17:05Z', last_failure_summary: 'raw upstream text: token=abc',
  } });
  const { copy } = await (await h.statusRequest({ Authorization: 'Bearer valid-owner' })).json();
  assert.deepEqual(copy, { state: 'found', last_success_at: null, last_failure_at: '2026-10-02T21:17:05.000Z', last_failure_code: null });
  assert.equal(core.statusTime('2026-13-45T99:99:99Z'), null);
  assert.equal(core.statusTime(12345), null);
  assert.equal(core.folderStatus({ last_failure_summary: 'DRIVE_UPLOAD_FAILED' }).last_failure_code, null, 'code only with a failure time');
});
test('status read: no folder yet answers state none without creating one', async () => {
  const h = harness(), response = await h.statusRequest({ Authorization: 'Bearer valid-owner' }), result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result.copy, { state: 'none', last_success_at: null, last_failure_at: null, last_failure_code: null });
  assert.equal(writes(h).length, 0); assert.equal(h.files.size, 0);
});
test('status read: public sharing, Drive and OAuth failures give a stage code only and record nothing', async () => {
  for (const [options, code] of [
    [{ existing: true, public: true }, 'DRIVE_PUBLIC_SHARING_FOUND'], [{ existing: true, permissionFail: true }, 'DRIVE_PERMISSION_CHECK_FAILED'],
    [{ existing: true, duplicate: true }, 'DRIVE_DUPLICATE_MARKERS'], [{ oauthFail: true }, 'DRIVE_TOKEN_FAILED'],
  ]) {
    const h = harness(options), response = await h.statusRequest({ Authorization: 'Bearer valid-owner' }), result = await response.json();
    assert.equal(response.status, 502); assert.equal(result.ok, false); assert.equal(result.error, code);
    assert.ok(!('copy' in result));
    assert.doesNotMatch(JSON.stringify(result), /refresh secret|SECRET_RAW/);
    assert.equal(writes(h).length, 0); assert.equal(h.patches.length, 0);
  }
});
test('status read: CORS allows GET for the browser preflight, still no other methods', async () => {
  const h = harness(), options = await h.request({}, 'OPTIONS');
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal((await h.request({}, method)).status, 405);
  assert.equal(h.calls.length, 0);
});

// OPS-수집점검 2단계: POST ?action=heartbeat — collector secret only, strict {source,last_at,count?}, folder props only.
const beat = { source: 'transcript', last_at: '2026-10-03T14:05:00+09:00', count: 4 };
const googleCalls = h => h.calls.filter(c => c.url.hostname !== 'db.test');
test('heartbeat: missing, wrong or unset secret, JWT-only and cron secret are refused before any I/O', async () => {
  for (const [headers, options] of [
    [{}, {}], [{ 'x-collector-heartbeat-secret': 'wrong' }, {}], [{ 'x-collector-heartbeat-secret': '' }, {}],
    [{ 'x-collector-heartbeat-secret': 'beat-secret' }, { noHeartbeatSecret: true }],
    [{ Authorization: 'Bearer valid-owner' }, {}],
    [{ 'x-drive-summary-cron-secret': 'right-secret' }, {}],
    [{ 'x-drive-summary-cron-secret': 'right-secret', 'x-collector-heartbeat-secret': 'beat-secret' }, {}],
    [{ 'x-collector-heartbeat-secret': 'right-secret' }, {}],
  ]) {
    const h = harness({ existing: true, ...options }), response = await h.heartbeatRequest(headers, beat), result = await response.json();
    assert.equal(response.status, 401, JSON.stringify(headers)); assert.deepEqual(result, { ok: false, error: 'UNAUTHORIZED' });
    assert.equal(h.calls.length, 0);
  }
});
test('heartbeat: records only this source\'s time, count and received time on the existing folder', async () => {
  const h = harness({ existing: true, folderProps: { last_success_at: '2026-10-03T04:17:00.000Z', collector_telegram_at: '2026-10-03T10:00:00.000Z', collector_telegram_reported_at: '2026-10-03T10:00:00.000Z' } });
  const response = await h.heartbeatRequest({ 'x-collector-heartbeat-secret': 'beat-secret', 'Content-Type': 'application/json' }, beat), result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result, { ok: true, source: 'transcript', recorded_at: now.toISOString() });
  assert.deepEqual(h.patches, [{ appProperties: { collector_transcript_at: '2026-10-03T05:05:00.000Z', collector_transcript_count: '4', collector_transcript_reported_at: now.toISOString() } }]);
  const props = h.files.get('folder').appProperties;
  assert.equal(props.last_success_at, '2026-10-03T04:17:00.000Z', 'copy status untouched');
  assert.equal(props.collector_telegram_at, '2026-10-03T10:00:00.000Z', 'other source untouched');
  assert.equal(h.uploads.length, 0, 'no document rebuild');
  assert.ok(h.calls.every(c => c.url.hostname !== 'db.test' || (c.method === 'GET' && /public_policy_drive_config/.test(c.url.pathname))), 'DB: Drive config read only');
  assert.ok(h.calls.some(c => c.url.pathname.endsWith('/permissions')), 'sharing check kept');
  assert.ok(!h.calls.some(c => c.method === 'POST' && c.url.hostname === 'www.googleapis.com'), 'never creates a folder');
  const status = await (await h.statusRequest({ Authorization: 'Bearer valid-owner' })).json();
  assert.deepEqual(status.collectors, {
    telegram: { last_at: '2026-10-03T10:00:00.000Z', count: null, reported_at: '2026-10-03T10:00:00.000Z' },
    transcript: { last_at: '2026-10-03T05:05:00.000Z', count: 4, reported_at: now.toISOString() },
    telegram_send: null, call_send: null,
  });
  // A later beat without count clears the earlier count.
  await h.heartbeatRequest({ 'x-collector-heartbeat-secret': 'beat-secret' }, { source: 'transcript', last_at: '2026-10-03T06:00:00Z' });
  assert.equal(h.files.get('folder').appProperties.collector_transcript_count, undefined);
});
test('heartbeat: malformed bodies are refused before Google; no content, names or IDs accepted', async () => {
  const future = new Date(now.getTime() + 11 * 60000).toISOString();
  for (const body of [
    undefined, '', 'not json', '[]', 'null', JSON.stringify({ ...beat, source: 'drive' }), JSON.stringify({ ...beat, name: '파일 이름' }),
    JSON.stringify({ ...beat, file_id: 'abc' }), JSON.stringify({ ...beat, text: '내용' }), JSON.stringify({ source: 'telegram' }),
    JSON.stringify({ ...beat, last_at: '2026-10-03' }), JSON.stringify({ ...beat, last_at: 'yesterday' }), JSON.stringify({ ...beat, last_at: future }),
    JSON.stringify({ ...beat, last_at: '2019-12-31T23:59:59Z' }), JSON.stringify({ ...beat, last_at: 1696300000000 }),
    JSON.stringify({ ...beat, count: -1 }), JSON.stringify({ ...beat, count: 1.5 }), JSON.stringify({ ...beat, count: '4' }), JSON.stringify({ ...beat, count: 100001 }),
    JSON.stringify({ ...beat, pad: 'x'.repeat(2000) }),
  ]) {
    const h = harness({ existing: true }), response = await h.heartbeatRequest({ 'x-collector-heartbeat-secret': 'beat-secret' }, body), result = await response.json();
    assert.equal(response.status, 400, String(body).slice(0, 80)); assert.deepEqual(result, { ok: false, error: 'INVALID_BODY' });
    assert.equal(googleCalls(h).length, 0); assert.equal(h.patches.length, 0);
  }
  assert.ok(core.parseHeartbeat(JSON.stringify({ source: 'telegram', last_at: '2026-10-03T15:39:00Z' }), now), 'within 10 minutes ahead is clock skew');
});
test('heartbeat: no folder is 409 without creating one; Drive failures give a stage code only', async () => {
  const none = harness(), r = await none.heartbeatRequest({ 'x-collector-heartbeat-secret': 'beat-secret' }, beat);
  assert.equal(r.status, 409); assert.deepEqual(await r.json(), { ok: false, error: 'COPY_FOLDER_MISSING' });
  assert.equal(none.files.size, 0); assert.equal(writes(none).length, 0);
  for (const [options, code] of [
    [{ existing: true, public: true }, 'DRIVE_PUBLIC_SHARING_FOUND'], [{ existing: true, statusFail: true }, 'DRIVE_STATUS_WRITE_FAILED'],
    [{ existing: true, duplicate: true }, 'DRIVE_DUPLICATE_MARKERS'], [{ existing: true, oauthFail: true }, 'DRIVE_TOKEN_FAILED'],
  ]) {
    const h = harness(options), response = await h.heartbeatRequest({ 'x-collector-heartbeat-secret': 'beat-secret' }, beat), result = await response.json();
    assert.equal(response.status, 502); assert.deepEqual(result, { ok: false, error: code });
    assert.doesNotMatch(JSON.stringify(result), /refresh secret|SECRET_RAW/);
  }
});
test('heartbeat: the collector secret never reaches the rebuild path or the status read', async () => {
  for (const headers of [{ 'x-collector-heartbeat-secret': 'beat-secret' }, { 'x-collector-heartbeat-secret': 'beat-secret', Authorization: 'Bearer valid-owner' }]) {
    const h = harness({ existing: true }), response = await h.request(headers, 'POST', JSON.stringify(beat));
    assert.equal(response.status, 401); assert.equal(h.calls.length, 0); assert.equal(h.uploads.length, 0);
  }
  const h = harness({ existing: true }), status = await h.statusRequest({ 'x-collector-heartbeat-secret': 'beat-secret' });
  assert.equal(status.status, 401); assert.ok(googleCalls(h).length === 0);
  // GET ?action=heartbeat is not a write path.
  const get = harness({ existing: true }), g = await get.statusRequest({ 'x-collector-heartbeat-secret': 'beat-secret' }, '?action=heartbeat');
  assert.equal(g.status, 405); assert.equal(get.calls.length, 0);
  // CORS does not invite browsers to send the collector header.
  const o = await harness().request({}, 'OPTIONS');
  assert.doesNotMatch(o.headers.get('Access-Control-Allow-Headers'), /collector/);
});
test('status read: stored collector values with a bad shape are dropped', () => {
  assert.deepEqual(core.collectorStatus({
    collector_telegram_at: '파일 이름.txt', collector_telegram_reported_at: '2026-10-03T10:00:00.000Z',
    collector_transcript_at: '2026-10-03T10:00:00.000Z', collector_transcript_reported_at: '2026-10-03T10:00:00.000Z', collector_transcript_count: '12; drop',
  }), { telegram: null, transcript: { last_at: '2026-10-03T10:00:00.000Z', count: null, reported_at: '2026-10-03T10:00:00.000Z' }, telegram_send: null, call_send: null });
  assert.deepEqual(core.collectorStatus(null), { telegram: null, transcript: null, telegram_send: null, call_send: null });
});

// OPS-수집멈춤알림: the Apps Script feed reports how its own sending went. Closed state list, no free text, no count.
const sendBeat = { source: 'telegram_send', last_at: '2026-10-03T14:05:00+09:00', state: 'limit_ai' };
test('heartbeat: a send source records time and a closed state only, and the status read returns them', async () => {
  const h = harness({ existing: true });
  const response = await h.heartbeatRequest({ 'x-collector-heartbeat-secret': 'beat-secret', 'Content-Type': 'application/json' }, sendBeat), result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result, { ok: true, source: 'telegram_send', recorded_at: now.toISOString() });
  assert.deepEqual(h.patches, [{ appProperties: { collector_telegram_send_at: '2026-10-03T05:05:00.000Z', collector_telegram_send_state: 'limit_ai', collector_telegram_send_reported_at: now.toISOString() } }]);
  const status = await (await h.statusRequest({ Authorization: 'Bearer valid-owner' })).json();
  assert.deepEqual(status.collectors.telegram_send, { last_at: '2026-10-03T05:05:00.000Z', state: 'limit_ai', reported_at: now.toISOString() });
  assert.equal(status.collectors.call_send, null);
  assert.equal(status.collectors.telegram, null, 'other sources untouched');
});
test('heartbeat: send sources need a listed state and no count; the first two sources never take a state', async () => {
  for (const body of [
    { source: 'call_send', last_at: sendBeat.last_at }, { ...sendBeat, state: '' }, { ...sendBeat, state: 'AI 상한에 걸림' }, { ...sendBeat, state: 'unknown' },
    { ...sendBeat, count: 3 }, { ...beat, state: 'ok' }, { source: 'telegram', last_at: sendBeat.last_at, state: 'ok' },
  ]) {
    const h = harness({ existing: true }), response = await h.heartbeatRequest({ 'x-collector-heartbeat-secret': 'beat-secret' }, body), result = await response.json();
    assert.equal(response.status, 400, JSON.stringify(body)); assert.deepEqual(result, { ok: false, error: 'INVALID_BODY' });
    assert.equal(googleCalls(h).length, 0); assert.equal(h.patches.length, 0);
  }
  for (const state of core.COLLECTOR_SEND_STATES) assert.ok(core.parseHeartbeat(JSON.stringify({ ...sendBeat, source: 'call_send', state }), now), state);
});
test('status read: a stored send state outside the list is dropped', () => {
  const out = core.collectorStatus({ collector_call_send_at: '2026-10-03T10:00:00.000Z', collector_call_send_reported_at: '2026-10-03T10:00:00.000Z', collector_call_send_state: 'FORBIDDEN 내용' });
  assert.equal(out.call_send, null);
});

// TRASH-Edge거르기2: 서버 키는 RLS를 건너뛰므로 휴지통의 담당조직·사업 보고(deleted_at)를 읽기에서 직접 뺀다. 이름은 모두 가짜다.
test('휴지통의 담당조직·사업 보고와 그 조직의 기록·담당 지정은 사본에 들어가지 않는다', async () => {
  const gone = '2026-10-25T01:00:00Z', at = '2026-10-01T01:00:00Z';
  const h = harness({ data: {
    app_suborganizations: [
      { id: 'org', name: '합성 살아있는 조직', active: true },
      { id: 'org-trash', name: '합성 휴지통 조직', active: true, deleted_at: gone },
    ],
    app_suborganization_updates: [
      { id: 'u-live', organization_id: 'org', occurred_at: at, raw_text: 'LIVE_RECORD' },
      { id: 'u-trash', organization_id: 'org-trash', occurred_at: at, raw_text: 'TRASH_RECORD', organization: { workspace_id: 'ws', deleted_at: gone } },
    ],
    app_suborganization_assignees: [
      { organization_id: 'org-trash', user_id: 'owner', organization: { workspace_id: 'ws', deleted_at: gone } },
    ],
    app_meetings: [
      { id: 'm-live', project_id: 'p', series_name: '합성 살아있는 회의', title: 't', meeting_at: at, round_no: 1 },
      { id: 'm-trash', project_id: 'p', series_name: '합성 휴지통 회의', title: 't', meeting_at: at, round_no: 2, deleted_at: gone },
    ],
  } });
  assert.equal((await h.request({ Authorization: 'Bearer valid-owner' })).status, 200);
  const body = h.uploads.map(u => u.body).join('');
  assert.match(body, /합성 살아있는 조직/); assert.match(body, /LIVE_RECORD/); assert.match(body, /합성 살아있는 회의/);
  assert.doesNotMatch(body, /합성 휴지통 조직|TRASH_RECORD|합성 휴지통 회의/);
  const q = table => h.calls.find(c => c.url.pathname.endsWith(`/${table}`)).url.searchParams;
  assert.equal(q('app_suborganizations').get('deleted_at'), 'is.null');
  assert.equal(q('app_meetings').get('deleted_at'), 'is.null');
  assert.equal(q('app_suborganization_updates').get('organization.deleted_at'), 'is.null');
  assert.equal(q('app_suborganization_assignees').get('organization.deleted_at'), 'is.null');
});

// ---- TRASH-다른삭제 5단계: 서버 키로 읽는 바구니 줄에서 휴지통 노트(deleted_at)를 뺀다 ----
test('basket count line leaves out trashed notes and sends deleted_at=is.null on every note read', async () => {
  const window=core.kstWindow(now);
  const h=harness({existing:true,data:{app_notes:[note('live',{occurred_at:window.start}),note('trashed',{occurred_at:window.start,deleted_at:'2026-10-26T00:00:00Z'})],
    // 휴지통 노트의 연결은 결과에 영향이 없다(연결은 거른 노트 id로만 쓰인다).
    app_record_links:[...fixture.app_record_links,{id:'tl',note_id:'trashed',status:'confirmed'}]}});
  assert.equal((await h.request({Authorization:'Bearer valid-owner'})).status,200);
  assert.match(h.uploads[1].body,/바구니 미분류 메모 1건/);
  const reads=h.calls.filter(c=>c.url.pathname.endsWith('/app_notes'));
  assert.ok(reads.length>=2,'머리 읽기와 다시 확인 두 번 이상');
  for(const c of reads){assert.equal(c.url.searchParams.get('deleted_at'),'is.null');assert.equal(c.url.searchParams.get('select'),'id,workspace_id,occurred_at,archived_at,ai_export_allowed,journal_at:metadata->journal_at');}
});
test('before the database has deleted_at the read drops the filter once, starts over, and still counts', async () => {
  const window=core.kstWindow(now);
  const h=harness({existing:true,noTrashColumn:true,data:{app_notes:[note('one',{occurred_at:window.start}),note('two',{occurred_at:window.start})]}});
  assert.equal((await h.request({Authorization:'Bearer valid-owner'})).status,200);
  assert.match(h.uploads[1].body,/바구니 미분류 메모 2건/);
  const reads=h.calls.filter(c=>c.url.pathname.endsWith('/app_notes'));
  assert.equal(reads.filter(c=>c.url.searchParams.has('deleted_at')).length,1,'거절은 한 번만 받는다');
  assert.ok(reads.slice(1).every(c=>!c.url.searchParams.has('deleted_at')),'그 뒤 읽기는 거르기 없이');
});
test('only the missing-column refusal (42703) turns the filter off; any other refusal still fails the read', async () => {
  const h=harness({existing:true,otherColumnError:true,data:{app_notes:[note('one')]}});
  const response=await h.request({Authorization:'Bearer valid-owner'});
  assert.notEqual(response.status,200);
  assert.equal(h.uploads.length,0,'읽기 실패면 사본을 올리지 않는다');
  assert.ok(h.calls.filter(c=>c.url.pathname.endsWith('/app_notes')).every(c=>c.url.searchParams.has('deleted_at')),'다른 오류에서는 거르기를 끄지 않는다');
});
