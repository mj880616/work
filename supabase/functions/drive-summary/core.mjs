import {select} from './project-catalog-model.mjs';
// Pure rendering + injectable HTTP boundary. Node 24 tests exercise this same code.
import {createBasketReader} from './basket-read.mjs';
import {createHtmlBudget} from './html-budget.mjs';
import { LedgerError, LEDGER_LIMITS, LEDGER_TITLE, readLedger, buildBackup, renderLedgerDocument, ledgerStatus, backupsToTrash, kstDate, backupName } from './ledger-export.mjs';
import { basketState, prepareBasket, selectBasketOrganizations, BASKET_LIMITS } from './basket.mjs';
import { runTextBackfill, textBackfillStatus, TextBackfillError, DONE_AT, DONE_COUNT, DISMISSED_AT } from './text-backfill.mjs';
import { runLibraryPrevPrune, PrevPruneError } from './library-prev-prune.mjs';
export { basketState, BASKET_LIMITS };
const WORKSPACE = 'kptu-work';
const DAY = 86400000, KST = 9 * 3600000, PAGE = 500;
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DOC_MIME = 'application/vnd.google-apps.document';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const NOTICE = '이 문서는 Web2가 자동으로 만드는 읽기용 사본입니다. 직접 고쳐도 다음 갱신 때 덮어써집니다. 원본은 Web2입니다.';
const OTHERS = '그 외';
const TITLES = { org: '조직 업데이트 (읽기용 사본)', project: '프로젝트 현황 (읽기용 사본)', ledger: LEDGER_TITLE };
const LEDGER_BACKUP_FOLDER = '원장 백업';
const PHASE = { preparation: '준비', in_progress: '진행', consultation: '협의', execution: '실행', follow_up: '후속조치', done: '종료' };
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-drive-summary-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
export function escapeHtml(value) {
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
function prepareDocuments(data, now) {
  const window = kstWindow(now);
  const top = `<html><head><meta charset="utf-8"></head><body>\n${paragraph(`마지막 갱신: ${kstText(now)} (KST)`)}\n${paragraph(NOTICE)}`;
  const wrap = (title, lines) => `${top}\n<h1>${escapeHtml(title)}</h1>\n${paragraph(`최근 4주: ${window.startDate} 00:00 ~ ${kstText(now)} (KST)`)}\n${lines.join('\n')}\n</body></html>`;
  // ORG-담당13기준: the organization copy has one section per organization of mine (the same rule as the basket list,
  // app/my-organizations.js). Other organizations get no section; their records of the 4 weeks stay under one "그 외".
  const selected = selectBasketOrganizations(data.organizations, data.organizationAssignees || []);
  const mine = new Set(selected.organizations.map(row => row.id));
  const org = [];
  for (const row of selected.organizations.slice().sort(compareOrganizations)) {
    org.push(heading(row.name), paragraph(`현재 요약: ${row.recent_month_summary || '없음'}`));
    const updates = data.organizationUpdates.filter(u => u.organization_id === row.id).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    org.push(...updates.map(u => paragraph(`${kstText(u.occurred_at)} (KST) · ${u.raw_text || ''}`)));
    if (!updates.length) org.push(paragraph('최근 4주 기록 없음'));
  }
  const otherNames = new Map(data.organizations.filter(row => !mine.has(row.id)).map(row => [row.id, row.name]));
  const others = data.organizationUpdates.filter(u => otherNames.has(u.organization_id))
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || String(a.id).localeCompare(String(b.id)));
  if (others.length) {
    org.push(heading(OTHERS), paragraph('내 담당이 아닌 조직의 최근 4주 기록입니다.'));
    org.push(...others.map(u => paragraph(`${kstText(u.occurred_at)} (KST) · ${otherNames.get(u.organization_id) || '이름 없는 조직'} · ${u.raw_text || ''}`)));
  }
  // Reuse the screen catalog with only the two existing JSON scalar columns.
  const project = [], projects = select(data.projects.map(p => ({...p, metadata: {project_system:p.project_system, management_version:p.management_version}})))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name), 'ko'));
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
  return {org:wrap(TITLES.org,org),project,projects,selected,wrap,top,window};
}
// DRIVE-바구니원문제외: the basket part of the project copy is one count line. Memo bodies are never read or written.
function documentRenderer(data,now,notes,links) {
  const prepared=prepareDocuments(data,now),basket=prepareBasket(notes,links,now,prepared.window);
  const sink=createHtmlBudget(BASKET_LIMITS.documentBytes,'\n</body></html>');
  let overflow=false;
  const append=text=>{if(!overflow&&!sink.append(text)){overflow=true;sink.discard();}};
  append(`${prepared.top}\n<h1>${escapeHtml(TITLES.project)}</h1>\n${paragraph(`최근 4주: ${prepared.window.startDate} 00:00 ~ ${kstText(now)} (KST)`)}\n`);
  let first=true;
  for(const text of [...prepared.project,basket.section]){if(!first)append('\n');first=false;append(text);if(overflow)break;}
  function finish(){
    if(!overflow)return {org:prepared.org,project:sink.finish()};
    const notice=paragraph('대상 축소 필요: 문서 출력 상한 초과. 이번 갱신의 사본은 내보내지 않았습니다. 이전 갱신 성공으로 처리하지 않습니다.');
    let failure=prepared.wrap(TITLES.project,[...prepared.project,basket.section]).replace('<body>\n',`<body>\n${notice}\n`);
    if(new TextEncoder().encode(failure).length>BASKET_LIMITS.documentBytes)failure=prepared.wrap(TITLES.project,[paragraph('기존 프로젝트 절을 포함한 문서 크기가 상한을 넘었습니다.'),basket.section]).replace('<body>\n',`<body>\n${notice}\n`);
    return {org:prepared.org,project:failure,basketError:'BASKET_OUTPUT_LIMIT'};
  }
  return {basket,finish,get overflow(){return overflow;}};
}
export function renderDocuments(data,now){
  return documentRenderer(data,now,data.notes||[],data.noteLinks||[]).finish();
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
// OPS-수집점검: the status read returns only times and a safe stage code. Anything else stored in the folder
// properties is never echoed (it is checked against a strict shape first).
const STATUS_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
export function statusTime(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}
export function folderStatus(appProperties) {
  const p = appProperties && typeof appProperties === 'object' ? appProperties : {};
  const failureAt = statusTime(p.last_failure_at);
  return {
    state: 'found',
    last_success_at: statusTime(p.last_success_at),
    last_failure_at: failureAt,
    last_failure_code: failureAt && typeof p.last_failure_summary === 'string' && STATUS_CODE.test(p.last_failure_summary) ? p.last_failure_summary : null,
  };
}
const driveQuote = value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// OPS-수집점검 2단계: 바깥 수집 점검 신호(heartbeat). 통화 전사용 Google 앱 스크립트가 전사 폴더·텔레그램 수집 상태 파일의
// 시각(과 건수)만 보내면, 사본 폴더 appProperties에 그 값과 받은 시각만 남긴다(사본 상태와 같은 저장 위치, DB 쓰기 없음).
export const COLLECTOR_SOURCES = Object.freeze(['telegram', 'transcript', 'telegram_send', 'call_send']);
// OPS-수집멈춤알림: the two "send" sources are the Apps Script feed (collector-feed.gs) reporting how its own sending went.
// They carry one more field, `state`, from this closed list (no free text); the first two sources never carry it.
export const COLLECTOR_SEND_SOURCES = Object.freeze(['telegram_send', 'call_send']);
export const COLLECTOR_SEND_STATES = Object.freeze(['ok', 'test', 'limit_day', 'limit_ai', 'failing', 'broken']);
const COLLECTOR_KEYS = Object.freeze(['source', 'last_at', 'count', 'state']);
const COLLECTOR_BODY_BYTES = 1024, COLLECTOR_COUNT_MAX = 100000, COLLECTOR_FUTURE_MS = 10 * 60000;
const COLLECTOR_OLDEST = Date.parse('2020-01-01T00:00:00Z');
const collectorKey = (source, field) => `collector_${source}_${field}`;
// Strict body check: exactly {source, last_at, count?}. No names, links, or content are ever accepted.
export function parseHeartbeat(text, at) {
  if (typeof text !== 'string' || !text || new TextEncoder().encode(text).length > COLLECTOR_BODY_BYTES) return null;
  let body;
  try { body = JSON.parse(text); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (Object.keys(body).some(key => !COLLECTOR_KEYS.includes(key))) return null;
  if (!COLLECTOR_SOURCES.includes(body.source)) return null;
  if (typeof body.last_at !== 'string' || body.last_at.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/.test(body.last_at)) return null;
  const lastAt = Date.parse(body.last_at);
  if (!Number.isFinite(lastAt) || lastAt < COLLECTOR_OLDEST || lastAt > at.getTime() + COLLECTOR_FUTURE_MS) return null;
  let count = null;
  if ('count' in body) {
    if (!Number.isInteger(body.count) || body.count < 0 || body.count > COLLECTOR_COUNT_MAX) return null;
    count = body.count;
  }
  const isSend = COLLECTOR_SEND_SOURCES.includes(body.source);
  let state = null;
  if (isSend) {
    if (!COLLECTOR_SEND_STATES.includes(body.state) || count !== null) return null;
    state = body.state;
  } else if ('state' in body) return null;
  return { source: body.source, lastAt: new Date(lastAt).toISOString(), count, state };
}
export function heartbeatProperties({ source, lastAt, count, state = null }, at) {
  if (COLLECTOR_SEND_SOURCES.includes(source)) {
    return { [collectorKey(source, 'at')]: lastAt, [collectorKey(source, 'state')]: state, [collectorKey(source, 'reported_at')]: at.toISOString() };
  }
  return {
    [collectorKey(source, 'at')]: lastAt,
    [collectorKey(source, 'count')]: count === null ? null : String(count), // null clears an earlier count.
    [collectorKey(source, 'reported_at')]: at.toISOString(),
  };
}
// Status side: only values that pass the same strict shape leave the server.
export function collectorStatus(appProperties) {
  const p = appProperties && typeof appProperties === 'object' ? appProperties : {};
  const out = {};
  for (const source of COLLECTOR_SOURCES) {
    const lastAt = statusTime(p[collectorKey(source, 'at')]), reportedAt = statusTime(p[collectorKey(source, 'reported_at')]);
    const rawCount = p[collectorKey(source, 'count')];
    const count = typeof rawCount === 'string' && /^\d{1,6}$/.test(rawCount) && Number(rawCount) <= COLLECTOR_COUNT_MAX ? Number(rawCount) : null;
    if (COLLECTOR_SEND_SOURCES.includes(source)) {
      const state = p[collectorKey(source, 'state')];
      out[source] = lastAt && reportedAt && COLLECTOR_SEND_STATES.includes(state) ? { last_at: lastAt, state, reported_at: reportedAt } : null;
      continue;
    }
    out[source] = lastAt && reportedAt ? { last_at: lastAt, count, reported_at: reportedAt } : null;
  }
  return out;
}

// createTextReader(driveToken) → {extract(file)}: index.ts injects _shared/document-text.ts (LIB-글자채우기야간). Without it the
// nightly text path answers SERVER_CONFIG_MISSING; every other path is unchanged.
/** @param {{ env: Record<string, string | undefined>, fetcher?: typeof fetch, now?: () => Date, createTextReader?: ((driveToken: () => Promise<string>) => { extract: (file: { fileId: string, name: string, mime: string, size: number | null }) => Promise<{ text: string, source: string, reason: string }> }) | null }} deps */
export function createHandler({ env, fetcher = fetch, now = () => new Date(), createTextReader = null, driveTrash = null }) {
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
    return { workspaceId, ownerId: user?.id || null };
  }
  async function readData(workspaceId, at, ownerId) {
    const window = kstWindow(at), scope = { workspace_id: `eq.${workspaceId}` };
    // 휴지통 프로젝트(deleted_at 있음, 하위 포함)는 요약에서 뺀다. 서버 키는 RLS를 건너뛰므로 직접 거른다.
    const projectScope = { 'project.workspace_id': `eq.${workspaceId}`, 'project.deleted_at': 'is.null' };
    // Child tables have no workspace_id; !inner + referenced-workspace filter enforces scope.
    // Milestones also reference app_spaces via child_project_id; disambiguate the FK.
    const projectSelect = columns => `${columns},project:app_spaces!project_id!inner(workspace_id,deleted_at)`;
    const timeParams = (columns, scopeParams, column, start, end) => [
      ['select', columns], ...Object.entries(scopeParams), [column, `gte.${start}`], [column, `lte.${end}`],
    ];
    const [organizations, organizationUpdates, projects, workstreams, progress, milestones, taskLinks, documents, meetings] = await Promise.all([
      // TRASH-Edge거르기2: 서버 키는 RLS를 건너뛰므로 휴지통에 든 담당조직·사업 보고(deleted_at)는 여기서 직접 뺀다.
      dbRows('app_suborganizations', { select: 'id,name,active,recent_month_summary', ...scope, deleted_at: 'is.null' }),
      dbRows('app_suborganization_updates', timeParams('id,organization_id,raw_text,occurred_at,organization:app_suborganizations!organization_id!inner(workspace_id)', { 'organization.workspace_id': `eq.${workspaceId}`, 'organization.deleted_at': 'is.null' }, 'occurred_at', window.start, window.end)),
      dbRows('app_spaces', { select: 'id,parent_id,name,status,sort_order,project_system:metadata->>project_system,management_version:metadata->>management_version', ...scope, deleted_at: 'is.null' }),
      dbRows('app_project_workstreams', { select: projectSelect('id,project_id,phase,title,sort_order'), ...projectScope }),
      dbRows('app_project_progress_updates', timeParams(projectSelect('id,project_id,workstream_id,effective_on,status_label,summary,next_step'), projectScope, 'effective_on', window.startDate, window.today)),
      dbRows('app_project_milestones', { select: projectSelect('id,project_id,title,start_at'), ...projectScope, start_at: `gte.${window.start}` }),
      dbRows('app_record_links', { select: 'id,project_id', ...scope, project_id: 'not.is.null', google_task_id: 'not.is.null', task_completed: 'eq.false', status: 'eq.confirmed' }),
      dbRows('app_documents', { select: 'id,project_id', ...scope, project_id: 'not.is.null' }),
      // Strict metadata allowlist: transcript_text/notes/decisions are never selected.
      dbRows('app_meetings', timeParams('id,series_name,title,meeting_at,round_no,project_id', { ...scope, deleted_at: 'is.null' }, 'meeting_at', window.start, window.end)),
    ]);
    let organizationAssignees = [];
    try {
      // Cron has no user JWT: resolve the sole owner from the fixed workspace.
      if (!ownerId) {
        const owners = await dbRows('app_workspace_members', { select: 'user_id,role', order: 'user_id.asc', ...scope, role: 'eq.owner' });
        if (owners.length !== 1) throw new SummaryError('WORKSPACE_OWNER_UNAVAILABLE');
        ownerId = owners[0].user_id;
        if (!ownerId) throw new SummaryError('WORKSPACE_OWNER_UNAVAILABLE');
      }
      organizationAssignees = await dbRows('app_suborganization_assignees', {
        select: 'organization_id,organization:app_suborganizations!organization_id!inner(workspace_id)',
        order: 'organization_id.asc', user_id: `eq.${ownerId}`, 'organization.workspace_id': `eq.${workspaceId}`, 'organization.deleted_at': 'is.null',
      });
    } catch { /* A failed/partial assignment read uses the full active guidance list. */ }
    return { organizationAssignees, organizations, organizationUpdates, projects, workstreams, progress, milestones, taskLinks, documents, meetings };
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
  // S7-d: kind 'ledger_backup' is a folder, 'ledger_json' a JSON file; the others are Google documents.
  const mimeOf = kind => kind === 'folder' || kind === 'ledger_backup' ? FOLDER_MIME : kind === 'ledger_json' ? 'application/json' : DOC_MIME;
  async function listFiles(token, kind, parent) {
    const q = `trashed = false and 'me' in owners and mimeType = '${mimeOf(kind)}' and appProperties has { key='kptu_summary' and value='${kind}' } and appProperties has { key='kptu_workspace' and value='${WORKSPACE}' } and '${driveQuote(parent || 'root')}' in parents`;
    const files = []; let pageToken = '';
    do {
      const params = new URLSearchParams({ q, spaces: 'drive', pageSize: '100', fields: 'files(id,appProperties),nextPageToken,incompleteSearch' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await checked(`${DRIVE}?${params}`, { headers: { Authorization: `Bearer ${token}` } }, 'DRIVE_DISCOVERY_FAILED');
      if (data.incompleteSearch || !Array.isArray(data.files)) throw new SummaryError('DRIVE_DISCOVERY_FAILED');
      files.push(...data.files); pageToken = data.nextPageToken || '';
    } while (pageToken);
    return files;
  }
  async function findFile(token, kind, parent) {
    const files = await listFiles(token, kind, parent);
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
  // Drive merges appProperties on update (keys not sent stay as they are). Send only the keys this path owns, so the
  // copy status, the ledger export times (S7-d) and the collector heartbeat keys never overwrite each other with a
  // stale snapshot read at the start of a slow call.
  async function recordStatus(token, folder, patch) {
    await checked(`${DRIVE}/${encodeURIComponent(folder.id)}?fields=id`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appProperties: patch }),
    }, 'DRIVE_STATUS_WRITE_FAILED');
  }
  const recordLedger = recordStatus;
  async function backupFolderFor(token, folder) {
    const found = await findFile(token, 'ledger_backup', folder.id);
    if (found) return found;
    const created = await checked(`${DRIVE}?fields=id,appProperties`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: LEDGER_BACKUP_FOLDER, mimeType: FOLDER_MIME, parents: [folder.id], appProperties: { kptu_summary: 'ledger_backup', kptu_workspace: WORKSPACE } }),
    }, 'DRIVE_FOLDER_CREATE_FAILED');
    if (!created.id) throw new SummaryError('DRIVE_FOLDER_CREATE_FAILED');
    return created;
  }
  // One JSON per KST date: the same date replaces the same file ID. Duplicate markers for one date fail closed.
  async function uploadBackup(token, backup, files, date, text) {
    const same = files.filter(f => f?.appProperties?.kptu_export_date === date);
    if (same.length > 1) throw new SummaryError('DRIVE_DUPLICATE_MARKERS');
    const found = same[0] || null;
    if (found) await assertPrivate(token, found.id);
    const boundary = `ledger_${crypto.randomUUID()}`;
    const metadata = { name: backupName(date), mimeType: 'application/json', appProperties: { kptu_summary: 'ledger_json', kptu_workspace: WORKSPACE, kptu_export_date: date }, ...(!found ? { parents: [backup.id] } : {}) };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--\r\n`;
    const file = await checked(`https://www.googleapis.com/upload/drive/v3/files${found ? `/${encodeURIComponent(found.id)}` : ''}?uploadType=multipart&fields=id`, {
      method: found ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    }, 'DRIVE_UPLOAD_FAILED');
    if (!file.id) throw new SummaryError('DRIVE_UPLOAD_FAILED');
    await assertPrivate(token, file.id);
    return file.id;
  }
  // Keep the newest N backups; older ones go to the Drive trash (not permanent delete). Failures only count.
  async function trimBackups(token, backup) {
    let failed = 0;
    for (const f of backupsToTrash(await listFiles(token, 'ledger_json', backup.id))) {
      try {
        await checked(`${DRIVE}/${encodeURIComponent(f.id)}?fields=id`, {
          method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
        }, 'DRIVE_TRASH_FAILED');
      } catch { failed++; }
    }
    return failed;
  }
  // S7-d: POST ?action=ledger_export. Owner JWT only: the ledger tables have no service_role grant, so the ledger is
  // read with the caller's token + anon key (owner RLS applies). The cron secret is refused (no user token to read with).
  async function ledgerExport(req) {
    let token, folder;
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_ANON_KEY) throw new SummaryError('SERVER_CONFIG_MISSING');
      if (req.headers.get('x-drive-summary-cron-secret') !== null) throw new SummaryError('UNAUTHORIZED', 401);
      const { workspaceId, ownerId } = await authorize(req);
      if (!ownerId) throw new SummaryError('UNAUTHORIZED', 401);
      token = await accessToken();
      folder = await folderFor(token);
      await assertPrivate(token, folder.id);
      const at = now();
      const tables = await readLedger({ fetcher, baseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, userAuthorization: req.headers.get('Authorization'), workspaceId });
      const backupFile = await buildBackup(tables, at), doc = renderLedgerDocument(tables, at);
      const backup = await backupFolderFor(token, folder);
      await assertPrivate(token, backup.id);
      // Backup first: an oversized reading copy must not block the restore file.
      await uploadBackup(token, backup, await listFiles(token, 'ledger_json', backup.id), kstDate(at), backupFile.text);
      const link = await replaceDocument(token, folder, 'ledger', doc.html);
      const trimFailed = await trimBackups(token, backup);
      await assertPrivate(token, backup.id);
      await assertPrivate(token, folder.id);
      if (doc.overLimit) throw new SummaryError('LEDGER_DOC_LIMIT');
      const exportedAt = at.toISOString();
      await recordLedger(token, folder, { ledger_last_success_at: exportedAt });
      return json({ ok: true, exported_at: exportedAt, counts: backupFile.counts, keep: LEDGER_LIMITS.keepBackups, trim_failed: trimFailed, documents: { ledger: link } });
    } catch (error) {
      const code = error instanceof SummaryError || error instanceof LedgerError ? error.message : 'LEDGER_EXPORT_FAILED';
      const status = error instanceof SummaryError || error instanceof LedgerError ? error.status : 502;
      let failureRecorded = false;
      if (token && folder) {
        try { await recordLedger(token, folder, { ledger_last_failure_at: now().toISOString(), ledger_last_failure_summary: code }); failureRecorded = true; }
        catch { /* Drive outage can also prevent status persistence. */ }
      }
      return json({ ok: false, error: code, exported_at: null, attempted_at: now().toISOString(), failure_recorded: failureRecorded }, status);
    }
  }
  // S7-d: GET ?action=ledger_status. Owner JWT or the cron secret (weekly check). Times and a stage code only;
  // never creates anything, never reads ledger tables.
  async function ledgerStatusRead(req) {
    const checkedAt = () => now().toISOString();
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new SummaryError('SERVER_CONFIG_MISSING');
      // The collector heartbeat secret is never a credential here, even next to a JWT or the cron secret.
      if (req.headers.get('x-collector-heartbeat-secret') !== null) throw new SummaryError('UNAUTHORIZED', 401);
      await authorize(req);
      const token = await accessToken();
      const folder = await findFile(token, 'folder');
      if (!folder) return json({ ok: true, checked_at: checkedAt(), ledger: ledgerStatus({}, false) });
      await assertPrivate(token, folder.id);
      return json({ ok: true, checked_at: checkedAt(), ledger: ledgerStatus(folder.appProperties) });
    } catch (error) {
      const code = error instanceof SummaryError ? error.message : 'STATUS_FAILED';
      return json({ ok: false, error: code, checked_at: checkedAt() }, error instanceof SummaryError ? error.status : 502);
    }
  }
  // OPS-수집점검: GET ?action=status. Owner JWT only (the cron secret is refused here). Reads the copy folder's three
  // properties; never creates the folder, rebuilds documents, records status, or returns names, links, or content.
  async function statusRead(req) {
    const checkedAt = () => now().toISOString();
    try {
      let action = null;
      try { action = new URL(req.url).searchParams.get('action'); } catch { /* invalid URL → treated as no action */ }
      if (action !== 'status') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new SummaryError('SERVER_CONFIG_MISSING');
      if (req.headers.get('x-drive-summary-cron-secret') !== null) throw new SummaryError('UNAUTHORIZED', 401);
      const { ownerId } = await authorize(req);
      if (!ownerId) throw new SummaryError('UNAUTHORIZED', 401);
      const token = await accessToken();
      const folder = await findFile(token, 'folder');
      if (!folder) return json({ ok: true, checked_at: checkedAt(), copy: { state: 'none', last_success_at: null, last_failure_at: null, last_failure_code: null }, collectors: collectorStatus(null), text_backfill: null });
      await assertPrivate(token, folder.id);
      return json({ ok: true, checked_at: checkedAt(), copy: folderStatus(folder.appProperties), collectors: collectorStatus(folder.appProperties), text_backfill: textBackfillStatus(folder.appProperties) });
    } catch (error) {
      const code = error instanceof SummaryError ? error.message : 'STATUS_FAILED';
      return json({ ok: false, error: code, checked_at: checkedAt() }, error instanceof SummaryError ? error.status : 502);
    }
  }
  // OPS-수집점검 2단계: POST ?action=heartbeat. Only the collector secret header is accepted (no JWT, no cron secret).
  // The one thing it can do is record {time, count} for one source on the existing copy folder. It never creates the
  // folder, rebuilds documents, writes the DB, or reads/accepts content, file names, or IDs.
  async function heartbeat(req) {
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new SummaryError('SERVER_CONFIG_MISSING');
      if (req.headers.get('x-drive-summary-cron-secret') !== null) throw new SummaryError('UNAUTHORIZED', 401);
      if (!await secretMatches(req.headers.get('x-collector-heartbeat-secret'), env.COLLECTOR_HEARTBEAT_SECRET)) throw new SummaryError('UNAUTHORIZED', 401);
      const length = Number(req.headers.get('content-length') || 0);
      if (length > COLLECTOR_BODY_BYTES) throw new SummaryError('INVALID_BODY', 400);
      const at = now(), beat = parseHeartbeat(await req.text().catch(() => ''), at);
      if (!beat) throw new SummaryError('INVALID_BODY', 400);
      const token = await accessToken();
      const folder = await findFile(token, 'folder');
      if (!folder) throw new SummaryError('COPY_FOLDER_MISSING', 409);
      await assertPrivate(token, folder.id);
      // Drive merges appProperties on update: send only this source's keys so copy status is never rewritten here.
      await checked(`${DRIVE}/${encodeURIComponent(folder.id)}?fields=id`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appProperties: heartbeatProperties(beat, at) }),
      }, 'DRIVE_STATUS_WRITE_FAILED');
      return json({ ok: true, source: beat.source, recorded_at: at.toISOString() });
    } catch (error) {
      const code = error instanceof SummaryError ? error.message : 'HEARTBEAT_FAILED';
      return json({ ok: false, error: code }, error instanceof SummaryError ? error.status : 502);
    }
  }
  // LIB-글자채우기야간: POST ?action=text_backfill. The cron secret only (no JWT path: the nightly workflow has no user).
  // Reads up to 5 unfinished documents of the fixed workspace with the same reader as document-actions and writes only the
  // four text columns (service role, server side, workspace-scoped filters). When nothing is left it records the done time and
  // the read count on the copy folder (its own keys only). Counts and stage codes only leave the server.
  const service = () => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` });
  const backfillDb = {
    get: path => checked(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: service() }, 'DB_READ_FAILED'),
    async patch(path, body) {
      const rows = await checked(`${env.SUPABASE_URL}/rest/v1/${path}`, {
        method: 'PATCH', headers: { ...service(), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body),
      }, 'DB_WRITE_FAILED');
      if (!Array.isArray(rows)) throw new SummaryError('DB_WRITE_FAILED');
      return rows;
    },
    async head(path) {
      let response;
      try { response = await fetcher(`${env.SUPABASE_URL}/rest/v1/${path}`, { method: 'HEAD', headers: { ...service(), Prefer: 'count=exact' }, signal: AbortSignal.timeout(30000) }); }
      catch { throw new SummaryError('DB_READ_FAILED'); }
      const total = /\/(\d{1,9})$/.exec(response.headers.get('Content-Range') || '');
      if (!response.ok || !total) throw new SummaryError('DB_READ_FAILED');
      return Number(total[1]);
    },
  };
  async function textBackfill(req) {
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || typeof createTextReader !== 'function') throw new SummaryError('SERVER_CONFIG_MISSING');
      if (req.headers.get('x-drive-summary-cron-secret') === null) throw new SummaryError('UNAUTHORIZED', 401);
      const { workspaceId, ownerId } = await authorize(req);
      if (ownerId) throw new SummaryError('UNAUTHORIZED', 401);
      // Token first: a Drive outage stops here, before any document is marked (it is not the file's fault).
      const token = await accessToken();
      const result = await runTextBackfill({ db: backfillDb, reader: createTextReader(async () => token), workspaceId, now });
      let doneAt = null, doneError = null;
      if (result.remaining === 0) {
        try {
          const folder = await findFile(token, 'folder');
          if (!folder) throw new SummaryError('COPY_FOLDER_MISSING', 409);
          await assertPrivate(token, folder.id);
          doneAt = textBackfillStatus(folder.appProperties)?.done_at || null;
          if (!doneAt) {
            doneAt = now().toISOString();
            await recordStatus(token, folder, { [DONE_AT]: doneAt, [DONE_COUNT]: String(result.ready_total) });
          }
        } catch (error) { doneAt = null; doneError = error instanceof SummaryError ? error.message : 'DONE_RECORD_FAILED'; }
      }
      return json({ ok: true, asked: result.asked, ready: result.ready, error: result.error, gave_up: result.gave_up, skipped: result.skipped,
        remaining: result.remaining, stop: result.stop, done_at: doneAt, ...(doneError ? { done_error: doneError } : {}) });
    } catch (error) {
      const known = error instanceof SummaryError || error instanceof TextBackfillError;
      return json({ ok: false, error: known ? error.message : 'TEXT_BACKFILL_FAILED' }, known ? error.status : 502);
    }
  }
  // LIB-이전파일정리: POST ?action=library_prev_prune[&dry_run=1]. The cron secret only (the daily workflow has no user).
  // Moves the library's replaced "previous files" older than 30 days to the Drive TRASH (never a permanent delete) and hides them from the list;
  // dry_run=1 only counts (reads Drive metadata, writes nothing). Counts and stage codes only leave the server (library-prev-prune.mjs).
  async function libraryPrevPrune(req) {
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !driveTrash || typeof driveTrash.trash !== 'function' || typeof driveTrash.inspect !== 'function') throw new SummaryError('SERVER_CONFIG_MISSING');
      if (req.headers.get('x-drive-summary-cron-secret') === null) throw new SummaryError('UNAUTHORIZED', 401);
      const { workspaceId, ownerId } = await authorize(req);
      if (ownerId) throw new SummaryError('UNAUTHORIZED', 401);
      const url = new URL(req.url), flag = url.searchParams.get('dry_run');
      if (flag !== null && flag !== '1') throw new SummaryError('BAD_REQUEST', 400);
      const settings = await backfillDb.get(`app_drive_settings?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=library_folder_id&limit=1`);
      const folder = Array.isArray(settings) ? settings[0]?.library_folder_id : null;
      if (typeof folder !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(folder)) throw new SummaryError('LIBRARY_FOLDER_MISSING', 409);
      const token = await accessToken();
      const result = await runLibraryPrevPrune({
        db: backfillDb, workspaceId, dryRun: flag === '1', now,
        drive: { inspect: id => driveTrash.inspect(fetcher, id, folder, token), trash: id => driveTrash.trash(fetcher, id, folder, token) },
      });
      return json({ ok: true, ...result });
    } catch (error) {
      const known = error instanceof SummaryError || error instanceof PrevPruneError;
      return json({ ok: false, error: known ? error.message : 'LIBRARY_PREV_PRUNE_FAILED' }, known ? error.status : 502);
    }
  }
  // POST ?action=text_backfill_dismiss: the home line's ✕. Owner JWT only; records the dismissed time on the copy folder.
  async function textBackfillDismiss(req) {
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new SummaryError('SERVER_CONFIG_MISSING');
      if (req.headers.get('x-drive-summary-cron-secret') !== null) throw new SummaryError('UNAUTHORIZED', 401);
      const { ownerId } = await authorize(req);
      if (!ownerId) throw new SummaryError('UNAUTHORIZED', 401);
      const token = await accessToken();
      const folder = await findFile(token, 'folder');
      if (!folder) throw new SummaryError('COPY_FOLDER_MISSING', 409);
      await assertPrivate(token, folder.id);
      if (!textBackfillStatus(folder.appProperties)) throw new SummaryError('NOT_DONE', 409);
      const dismissedAt = now().toISOString();
      await recordStatus(token, folder, { [DISMISSED_AT]: dismissedAt });
      return json({ ok: true, dismissed_at: dismissedAt });
    } catch (error) {
      const code = error instanceof SummaryError ? error.message : 'DISMISS_FAILED';
      return json({ ok: false, error: code }, error instanceof SummaryError ? error.status : 502);
    }
  }
  const actionOf = req => { try { return new URL(req.url).searchParams.get('action'); } catch { return null; } };
  return async req => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method === 'GET') return actionOf(req) === 'ledger_status' ? ledgerStatusRead(req) : statusRead(req);
    if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED', updated_at: null, documents: {} }, 405);
    if (actionOf(req) === 'heartbeat') return heartbeat(req);
    // A collector secret never reaches the copy rebuild path, even next to another credential.
    if (req.headers.get('x-collector-heartbeat-secret') !== null) return json({ ok: false, error: 'UNAUTHORIZED', updated_at: null, documents: {} }, 401);
    if (actionOf(req) === 'ledger_export') return ledgerExport(req);
    if (actionOf(req) === 'text_backfill') return textBackfill(req);
    if (actionOf(req) === 'library_prev_prune') return libraryPrevPrune(req);
    if (actionOf(req) === 'text_backfill_dismiss') return textBackfillDismiss(req);
    let token, folder;
    const documents = {};
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new SummaryError('SERVER_CONFIG_MISSING');
      const { workspaceId, ownerId } = await authorize(req);
      token = await accessToken();
      folder = await folderFor(token);
      await assertPrivate(token, folder.id);
      const at = now(), data = await readData(workspaceId, at, ownerId);
      const reader=createBasketReader({fetcher,baseUrl:env.SUPABASE_URL,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},workspaceId,at});
      let html;
      try {
        const snapshot=await reader.snapshot(),renderer=documentRenderer(data,at,[...snapshot.notes.values()],[...snapshot.links.values()]);
        await reader.recheck(snapshot);
        html=renderer.finish();
      }catch(error){
        if(['DB_READ_FAILED','DB_READ_LIMIT'].includes(error?.message))throw new SummaryError(error.message);
        throw error;
      }
      // Sequential uploads make partial failure explicit; last_success only after both + checks.
      for (const kind of ['org', 'project']) documents[kind] = await replaceDocument(token, folder, kind, html[kind]);
      await assertPrivate(token, folder.id);
      if (html.basketError) throw new SummaryError(html.basketError);
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
