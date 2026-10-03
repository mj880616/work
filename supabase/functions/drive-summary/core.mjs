// Pure rendering + injectable HTTP boundary. Node 24 tests exercise this same code.
const WORKSPACE = 'kptu-work';
const DAY = 86400000, KST = 9 * 3600000, PAGE = 500;
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DOC_MIME = 'application/vnd.google-apps.document';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const NOTICE = '이 문서는 Web2가 자동으로 만드는 읽기용 사본입니다. 직접 고쳐도 다음 갱신 때 덮어써집니다. 원본은 Web2입니다.';
const TITLES = { org: '조직 업데이트 (읽기용 사본)', project: '프로젝트 현황 (읽기용 사본)' };
const PHASE = { preparation: '준비', in_progress: '진행', consultation: '협의', execution: '실행', follow_up: '후속조치', done: '종료' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-drive-summary-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
export const ORGANIZATION_GROUPS = Object.freeze([
  ['전국철도노동조합'],
  ['서울교통공사노동조합', '부산지하철노동조합', '대구교통공사노동조합', '인천교통공사노동조합'],
  ['서해선지부', '신분당선지부', '지티엑스에이운영지부', '공항철도지부'],
  ['메트로9호선노동조합', '서울교통공사9호선지부'],
  ['김포도시철도지부', '용인경전철지부'],
].map(names => Object.freeze(names)));
const places = new Map();
ORGANIZATION_GROUPS.forEach((names, group) => names.forEach((name, index) => places.set(name, { group, index })));
export function compareOrganizations(a, b) {
  const an = String(a?.name ?? ''), bn = String(b?.name ?? '');
  const ap = places.get(an), bp = places.get(bn);
  if (ap && bp) return ap.group - bp.group || ap.index - bp.index;
  if (ap || bp) return ap ? -1 : 1;
  return an.localeCompare(bn, 'ko');
}
export function kstWindow(now) {
  const today = new Date(now.getTime() + KST).toISOString().slice(0, 10);
  const midnight = Date.parse(`${today}T00:00:00+09:00`);
  const start = new Date(midnight - 28 * DAY).toISOString();
  return { start, end: now.toISOString(), startDate: new Date(midnight - 28 * DAY + KST).toISOString().slice(0, 10), today };
}
function kstText(value) {
  return new Date(new Date(value).getTime() + KST).toISOString().slice(0, 16).replace('T', ' ');
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).replace(/\r?\n/g, '<br>');
}
const paragraph = text => `<p>${escapeHtml(text)}</p>`;
const heading = text => `<h2>${escapeHtml(text)}</h2>`;
const byProject = (rows, id) => rows.filter(row => row.project_id === id);
function dday(at, today) {
  const date = new Date(new Date(at).getTime() + KST).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(date) - Date.parse(today)) / DAY);
  return days === 0 ? 'D-day' : days > 0 ? `D-${days}` : `D+${-days}`;
}
export function renderDocuments(data, now) {
  const window = kstWindow(now);
  const top = `<html><head><meta charset="utf-8"></head><body>\n${paragraph(`마지막 갱신: ${kstText(now)} (KST)`)}\n${paragraph(NOTICE)}`;
  const wrap = (title, lines) => `${top}\n<h1>${escapeHtml(title)}</h1>\n${paragraph(`최근 4주: ${window.startDate} 00:00 ~ ${kstText(now)} (KST)`)}\n${lines.join('\n')}\n</body></html>`;
  const org = [];
  for (const row of data.organizations.slice().sort(compareOrganizations)) {
    org.push(heading(row.name), paragraph(`현재 요약: ${row.recent_month_summary || '없음'}`));
    const updates = data.organizationUpdates.filter(u => u.organization_id === row.id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    org.push(...updates.map(u => paragraph(`${kstText(u.occurred_at)} (KST) · ${u.raw_text || ''}`)));
    if (!updates.length) org.push(paragraph('최근 4주 기록 없음'));
  }
  // Same classification as app/project-catalog.js, using only two JSON scalar keys.
  const included = new Set(data.projects.filter(p => p.project_system === 'v2' || Number(p.management_version) === 2).map(p => p.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of data.projects) if (p.parent_id && included.has(p.parent_id) && !included.has(p.id)) { included.add(p.id); changed = true; }
  }
  const project = [], projects = data.projects.filter(p => included.has(p.id)).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name), 'ko'));
  const names = new Map(projects.map(p => [p.id, p.name]));
  for (const p of projects) {
    project.push(heading(p.name), paragraph(`상태: ${p.status || '미지정'}${p.parent_id ? ` · 상위 프로젝트: ${names.get(p.parent_id) || '연결 없음'}` : ''}`));
    const children = projects.filter(c => c.parent_id === p.id);
    if (children.length) project.push(paragraph(`하위 프로젝트: ${children.map(c => c.name).join(', ')}`));
    project.push(paragraph(`미완료 연결 할 일: ${byProject(data.taskLinks, p.id).length} · 자료: ${byProject(data.documents, p.id).length}`));
    project.push('<h3>진행상황</h3>');
    const streams = byProject(data.workstreams, p.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    for (const stream of streams) project.push(paragraph(`${PHASE[stream.phase] || stream.phase || '진행'} · ${stream.title}`));
    const streamNames = new Map(streams.map(s => [s.id, s.title]));
    const progress = byProject(data.progress, p.id).sort((a, b) => b.effective_on.localeCompare(a.effective_on));
    for (const u of progress) project.push(paragraph(`${u.effective_on} · ${streamNames.get(u.workstream_id) || '프로젝트'}${u.status_label ? ` · ${u.status_label}` : ''} · ${u.summary || ''}${u.next_step ? ` · 다음: ${u.next_step}` : ''}`));
    if (!progress.length) project.push(paragraph('최근 4주 진행 기록 없음'));
    project.push('<h3>주요 일정</h3>');
    const milestones = byProject(data.milestones, p.id).sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
    for (const m of milestones) project.push(paragraph(`${kstText(m.start_at)} (KST) · ${dday(m.start_at, window.today)} · ${m.title}`));
    if (!milestones.length) project.push(paragraph('지난 4주·다가오는 주요 일정 없음'));
  }
  project.push(heading('최근 4주 회의'));
  for (const m of data.meetings.slice().sort((a, b) => b.meeting_at.localeCompare(a.meeting_at))) {
    project.push(paragraph(`${m.series_name || m.title || '회의'} · ${kstText(m.meeting_at)} (KST) · ${m.round_no == null ? '회차 미지정' : `${m.round_no}회차`} · ${names.get(m.project_id) || '연결 프로젝트 없음'}`));
  }
  if (!data.meetings.length) project.push(paragraph('최근 4주 회의 없음'));
  return { org: wrap(TITLES.org, org), project: wrap(TITLES.project, project) };
}
class SummaryError extends Error {
  constructor(code, status = 502) { super(code); this.status = status; }
}
// SHA-256 makes both buffers fixed length. Compare every byte without early exit.
async function secretMatches(given, expected) {
  if (!expected || !given || given.length > 4096) return false;
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
const json = (body, status = 200) => Response.json(body, { status, headers: CORS });
const driveQuote = value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export function createHandler({ env, fetcher = fetch, now = () => new Date() }) {
  // No global cached tokens, database state, or caller-selected workspace/Drive IDs.
  async function checked(url, init, code) {
    let response;
    try { response = await fetcher(url, { ...init, signal: AbortSignal.timeout(30000) }); }
    catch { throw new SummaryError(code); }
    if (!response.ok) throw new SummaryError(code);
    try { return await response.json(); } catch { throw new SummaryError(code); }
  }
  async function dbRows(table, params) {
    const rows = [];
    for (let offset = 0; offset < 100000; offset += PAGE) {
      const q = new URLSearchParams(params);
      if (!q.has('order')) q.set('order', 'id.asc');
      q.set('limit', String(PAGE)); q.set('offset', String(offset));
      const page = await checked(`${env.SUPABASE_URL}/rest/v1/${table}?${q}`, {
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
      }, 'DB_READ_FAILED');
      if (!Array.isArray(page)) throw new SummaryError('DB_READ_FAILED');
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
    throw new SummaryError('DB_READ_LIMIT'); // Never publish a silently truncated copy.
  }
  async function authorize(req) {
    const cron = req.headers.get('x-drive-summary-cron-secret');
    let user = null;
    // A supplied cron header selects cron exclusively; a wrong secret cannot fall back to JWT.
    if (cron !== null) {
      if (!await secretMatches(cron, env.DRIVE_SUMMARY_CRON_SECRET)) throw new SummaryError('UNAUTHORIZED', 401);
    } else {
      const authorization = req.headers.get('Authorization') || '';
      if (!/^Bearer\s+\S+$/i.test(authorization)) throw new SummaryError('UNAUTHORIZED', 401);
      let response;
      try { response = await fetcher(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: authorization }, signal: AbortSignal.timeout(30000) }); }
      catch { throw new SummaryError('AUTH_UNAVAILABLE'); }
      if (response.status >= 500) throw new SummaryError('AUTH_UNAVAILABLE');
      if (!response.ok) throw new SummaryError('UNAUTHORIZED', 401);
      user = await response.json().catch(() => null);
      if (!user?.id) throw new SummaryError('UNAUTHORIZED', 401);
    }
    const workspaces = await dbRows('app_workspaces', { select: 'id', slug: `eq.${WORKSPACE}` });
    if (workspaces.length !== 1) throw new SummaryError('WORKSPACE_UNAVAILABLE');
    const workspaceId = workspaces[0].id;
    if (user) {
      const members = await dbRows('app_workspace_members', { select: 'user_id,role', order: 'user_id.asc', workspace_id: `eq.${workspaceId}`, user_id: `eq.${user.id}` });
      if (members.length !== 1 || members[0].role !== 'owner') throw new SummaryError('FORBIDDEN', 403);
    }
    return workspaceId;
  }
  async function readData(workspaceId, at) {
    const window = kstWindow(at), scope = { workspace_id: `eq.${workspaceId}` };
    const projectScope = { 'project.workspace_id': `eq.${workspaceId}` };
    // Child tables have no workspace_id; !inner + referenced-workspace filter enforces scope.
    // Milestones also reference app_spaces via child_project_id; disambiguate the FK.
    const projectSelect = columns => `${columns},project:app_spaces!project_id!inner(workspace_id)`;
    const timeParams = (columns, scopeParams, column, start, end) => [
      ['select', columns], ...Object.entries(scopeParams), [column, `gte.${start}`], [column, `lte.${end}`],
    ];
    const [organizations, organizationUpdates, projects, workstreams, progress, milestones, taskLinks, documents, meetings] = await Promise.all([
      dbRows('app_suborganizations', { select: 'id,name,recent_month_summary', ...scope }),
      dbRows('app_suborganization_updates', timeParams('id,organization_id,raw_text,occurred_at,organization:app_suborganizations!organization_id!inner(workspace_id)', { 'organization.workspace_id': `eq.${workspaceId}` }, 'occurred_at', window.start, window.end)),
      dbRows('app_spaces', { select: 'id,parent_id,name,status,sort_order,project_system:metadata->>project_system,management_version:metadata->>management_version', ...scope }),
      dbRows('app_project_workstreams', { select: projectSelect('id,project_id,phase,title,sort_order'), ...projectScope }),
      dbRows('app_project_progress_updates', timeParams(projectSelect('id,project_id,workstream_id,effective_on,status_label,summary,next_step'), projectScope, 'effective_on', window.startDate, window.today)),
      dbRows('app_project_milestones', { select: projectSelect('id,project_id,title,start_at'), ...projectScope, start_at: `gte.${window.start}` }),
      dbRows('app_record_links', { select: 'id,project_id', ...scope, project_id: 'not.is.null', google_task_id: 'not.is.null', task_completed: 'eq.false', status: 'eq.confirmed' }),
      dbRows('app_documents', { select: 'id,project_id', ...scope, project_id: 'not.is.null' }),
      // Strict metadata allowlist: transcript_text/notes/decisions are never selected.
      dbRows('app_meetings', timeParams('id,series_name,title,meeting_at,round_no,project_id', scope, 'meeting_at', window.start, window.end)),
    ]);
    return { organizations, organizationUpdates, projects, workstreams, progress, milestones, taskLinks, documents, meetings };
  }
  async function accessToken() {
    const configs = await dbRows('public_policy_drive_config', { select: 'google_client_id,google_client_secret,google_refresh_token', id: 'eq.1' });
    const c = configs[0];
    if (configs.length !== 1 || !c.google_client_id || !c.google_client_secret || !c.google_refresh_token) throw new SummaryError('DRIVE_CONFIG_MISSING');
    const token = await checked('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.google_client_id, client_secret: c.google_client_secret, refresh_token: c.google_refresh_token, grant_type: 'refresh_token' }),
    }, 'DRIVE_TOKEN_FAILED'); // No scope request, no reconnection or token storage.
    if (!token.access_token) throw new SummaryError('DRIVE_TOKEN_FAILED');
    return token.access_token;
  }
  async function findFile(token, kind, parent) {
    const mime = kind === 'folder' ? FOLDER_MIME : DOC_MIME;
    const q = `trashed = false and 'me' in owners and mimeType = '${mime}' and appProperties has { key='kptu_summary' and value='${kind}' } and appProperties has { key='kptu_workspace' and value='${WORKSPACE}' } and '${driveQuote(parent || 'root')}' in parents`;
    const files = []; let pageToken = '';
    do {
      const params = new URLSearchParams({ q, spaces: 'drive', pageSize: '100', fields: 'files(id,appProperties),nextPageToken,incompleteSearch' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await checked(`${DRIVE}?${params}`, { headers: { Authorization: `Bearer ${token}` } }, 'DRIVE_DISCOVERY_FAILED');
      if (data.incompleteSearch || !Array.isArray(data.files)) throw new SummaryError('DRIVE_DISCOVERY_FAILED');
      files.push(...data.files); pageToken = data.nextPageToken || '';
    } while (pageToken);
    if (files.length > 1) throw new SummaryError('DRIVE_DUPLICATE_MARKERS');
    return files[0] || null;
  }
  async function assertPrivate(token, id) {
    let pageToken = '';
    do {
      const q = new URLSearchParams({ fields: 'permissions(type,role),nextPageToken', pageSize: '100' });
      if (pageToken) q.set('pageToken', pageToken);
      const data = await checked(`${DRIVE}/${encodeURIComponent(id)}/permissions?${q}`, { headers: { Authorization: `Bearer ${token}` } }, 'DRIVE_PERMISSION_CHECK_FAILED');
      if (!Array.isArray(data.permissions)) throw new SummaryError('DRIVE_PERMISSION_CHECK_FAILED');
      if (data.permissions.some(p => p.type === 'anyone' || p.type === 'domain')) throw new SummaryError('DRIVE_PUBLIC_SHARING_FOUND');
      pageToken = data.nextPageToken || '';
    } while (pageToken);
  }
  async function folderFor(token) {
    const found = await findFile(token, 'folder');
    if (found) return found;
    const folder = await checked(`${DRIVE}?fields=id,appProperties`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Web2 읽기용 사본', mimeType: FOLDER_MIME, appProperties: { kptu_summary: 'folder', kptu_workspace: WORKSPACE } }),
    }, 'DRIVE_FOLDER_CREATE_FAILED');
    if (!folder.id) throw new SummaryError('DRIVE_FOLDER_CREATE_FAILED');
    return folder;
  }
  async function replaceDocument(token, folder, kind, html) {
    const found = await findFile(token, kind, folder.id);
    if (found) await assertPrivate(token, found.id);
    const boundary = `summary_${crypto.randomUUID()}`;
    const metadata = { name: TITLES[kind], mimeType: DOC_MIME, appProperties: { kptu_summary: kind, kptu_workspace: WORKSPACE }, ...(!found ? { parents: [folder.id] } : {}) };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${boundary}--\r\n`;
    const file = await checked(`https://www.googleapis.com/upload/drive/v3/files${found ? `/${encodeURIComponent(found.id)}` : ''}?uploadType=multipart&fields=id`, {
      method: found ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    }, 'DRIVE_UPLOAD_FAILED');
    if (!file.id) throw new SummaryError('DRIVE_UPLOAD_FAILED');
    await assertPrivate(token, file.id);
    return `https://docs.google.com/document/d/${encodeURIComponent(file.id)}/edit`;
  }
  async function recordStatus(token, folder, patch) {
    await checked(`${DRIVE}/${encodeURIComponent(folder.id)}?fields=id`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appProperties: { ...folder.appProperties, ...patch } }),
    }, 'DRIVE_STATUS_WRITE_FAILED');
  }
  return async req => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED', updated_at: null, documents: {} }, 405);
    let token, folder;
    const documents = {};
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new SummaryError('SERVER_CONFIG_MISSING');
      const workspaceId = await authorize(req);
      token = await accessToken();
      folder = await folderFor(token);
      await assertPrivate(token, folder.id);
      const at = now(), data = await readData(workspaceId, at), html = renderDocuments(data, at);
      // Sequential uploads make partial failure explicit; last_success only after both + checks.
      for (const kind of ['org', 'project']) documents[kind] = await replaceDocument(token, folder, kind, html[kind]);
      await assertPrivate(token, folder.id);
      const updatedAt = at.toISOString(); // Matches the timestamp at the top of both copies.
      await recordStatus(token, folder, { last_success_at: updatedAt });
      return json({ ok: true, updated_at: updatedAt, documents });
    } catch (error) {
      // Only controlled stage codes leave the server. Upstream text may contain secrets/content.
      const code = error instanceof SummaryError ? error.message : 'SUMMARY_FAILED';
      const status = error instanceof SummaryError ? error.status : 502;
      let failureRecorded = false;
      if (token && folder) {
        try {
          await recordStatus(token, folder, { last_failure_at: now().toISOString(), last_failure_summary: code });
          failureRecorded = true;
        } catch { /* Drive outage can also prevent status persistence. Report this honestly. */ }
      }
      return json({ ok: false, error: code, updated_at: null, attempted_at: now().toISOString(), documents, failure_recorded: failureRecorded }, status);
    }
  };
}
