// CALL-개인통화함 3단계 (docs/design/call-personal.md): this file is also the ONLY place of the app that names the personal call
// table app_call_personal (personal and 애매 calls; owner RLS, select + hidden_at / raw_text clear / updated_at only) and the move
// function app_call_move. The work reads above (readFeed, readDays, readRaw, patchItem) never touch that table.
// CALL-통화메뉴·TG-소식메뉴 4단계: reads and owner writes of app_feed_items / app_feed_days (migration 20261024140000_call_tg_feed)
// for the 통화 (call-feed.js) and 텔레그램 소식 (telegram-feed.js) screens. Plain owner-RLS REST with the signed-in token, no RPC and
// no Edge: the table's one policy (private.app_is_workspace_owner) and its column grants decide. The signed-in owner may only
// change pinned_at, hidden_at, raw_text (clear only — the guard trigger refuses any other value), organization_id, project_id
// and updated_at; there is no insert or delete. Rows come in through collector-feed only.
import {readRecordPages} from './basket-link-records.js';
import {addDays, kstDay} from './feed-model.mjs';

const encode = encodeURIComponent;
const ctx = rt => rt?.context?.read?.() || {};
const workspaceOf = rt => { const id = ctx(rt)?.workspace?.id; if (!id) throw Error('업무 공간을 확인할 수 없어요.'); return id; };
export const scopeOf = rt => { const c = ctx(rt); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };

// raw_text is read only for the one row shown (it may be up to 200 KB).
export const ITEM_FIELDS = 'id,workspace_id,source,day,occurred_at,room_key,room_label,title,summary,points,counterpart,speaker_split,raw_count,organization_id,project_id,drive_url,pinned_at,hidden_at,updated_at';
// The list keeps the last 120 days (and at most 600 rows); older ones stay in the table and in Drive.
export const LIST_DAYS = 120;
export const LIST_MAX = 600;

export async function readFeed(source, rt = window.KPTURuntime, today = kstDay()) {
  const ws = workspaceOf(rt), from = addDays(today, -LIST_DAYS);
  const rows = [];
  for (let offset = 0; offset < LIST_MAX; offset += 100) {
    const page = await rt.api(`/rest/v1/app_feed_items?workspace_id=eq.${encode(ws)}&source=eq.${encode(source)}&hidden_at=is.null&day=gte.${from}&select=${ITEM_FIELDS}&order=day.desc,occurred_at.desc,id.desc&limit=100&offset=${offset}`);
    if (!Array.isArray(page)) throw Error('목록을 확인하지 못했어요.');
    rows.push(...page.filter(r => r?.id && r.workspace_id === ws && r.source === source));
    if (page.length < 100) break;
  }
  return rows;
}
export async function readDays(source, rt = window.KPTURuntime, today = kstDay()) {
  const ws = workspaceOf(rt);
  return readRecordPages(`/rest/v1/app_feed_days?workspace_id=eq.${encode(ws)}&source=eq.${encode(source)}&day=gte.${addDays(today, -6)}&select=day,source,total_count,kept_count,room_count,personal_count,unsure_count,failed_count&order=day.desc`, rt);
}
// The stored copy of one row: {raw_text, speaker_split, drive_url} or null when the row is gone.
export async function readRaw(id, rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  const rows = await rt.api(`/rest/v1/app_feed_items?id=eq.${encode(id)}&workspace_id=eq.${encode(ws)}&select=id,raw_text,speaker_split,drive_url&limit=1`);
  return Array.isArray(rows) && rows[0]?.id === id ? rows[0] : null;
}
// One owner change (only the columns the grant allows). Returns the saved row, or null when it is gone.
const ALLOWED = new Set(['pinned_at', 'hidden_at', 'raw_text', 'organization_id', 'project_id']);
export async function patchItem(id, changes, rt = window.KPTURuntime) {
  const ws = workspaceOf(rt), body = {};
  for (const [k, v] of Object.entries(changes || {})) { if (!ALLOWED.has(k)) throw Error('바꿀 수 없는 칸이에요.'); body[k] = v; }
  if (Object.hasOwn(body, 'raw_text') && body.raw_text !== null) throw Error('전문은 비우기만 할 수 있어요.');
  body.updated_at = new Date().toISOString();
  const rows = await rt.api(`/rest/v1/app_feed_items?id=eq.${encode(id)}&workspace_id=eq.${encode(ws)}&select=${ITEM_FIELDS}`, {method:'PATCH', prefer:'return=representation', body});
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}
export const setPinned = (id, on, rt) => patchItem(id, {pinned_at:on ? new Date().toISOString() : null}, rt);
export const setHidden = (id, on, rt) => patchItem(id, {hidden_at:on ? new Date().toISOString() : null}, rt);

// Organizations for names and for the 조직 연결 box: every organization of the workspace (names of inactive ones are still shown on
// old rows), plus which are mine (내 프로필 → 담당 사업장, the same rule as the 기록할 곳 sheet).
export async function readOrganizations(rt = window.KPTURuntime) {
  const c = ctx(rt), ws = workspaceOf(rt);
  const [orgs, mine] = await Promise.all([
    readRecordPages(`/rest/v1/app_suborganizations?workspace_id=eq.${encode(ws)}&select=id,name,active&order=id.asc`, rt),
    readRecordPages(`/rest/v1/app_suborganization_assignees?user_id=eq.${encode(c.user?.id || '')}&select=organization_id&order=organization_id.asc`, rt).catch(() => []),
  ]);
  return {orgs:orgs.filter(o => o?.id), mine:new Set(mine.map(a => a.organization_id))};
}
// 조직 연결 (요약 부품 통일 ②, minimal): the row's organization is set, and the summary (default: the core points) is added to that
// organization's 기록 through the existing organization-record path (quick-save.js, app_suborganization_updates owner RLS).
export async function linkOrganization(row, organizationId, summary, rt = window.KPTURuntime) {
  const saved = await patchItem(row.id, {organization_id:organizationId || null}, rt);
  if (!saved) return {saved:null, recorded:false, recordFailed:false};
  const text = String(summary || '').trim();
  if (!organizationId || !text) return {saved, recorded:false, recordFailed:false};
  try {
    const {saveOrganizationUpdate} = await import('./quick-save.js');
    await saveOrganizationUpdate({organization_id:organizationId, raw_text:text, created_by:ctx(rt).user?.id}, rt);
    return {saved, recorded:true, recordFailed:false};
  } catch { return {saved, recorded:false, recordFailed:true}; }
}

// ---------- CALL-개인통화함 3단계: 개인 통화함(app_call_personal). 업무 읽기(위)와 섞이지 않게 이 아래에만 둔다.
export const PERSONAL_FIELDS = 'id,workspace_id,kind,day,occurred_at,title,summary,points,counterpart,speaker_split,drive_url,hidden_at,moved_at,updated_at';
// personal (개인 통화) and unsure (애매, 정하기 전) rows of the last LIST_DAYS days, newest first; raw_text is not in the list.
export async function readPersonal(rt = window.KPTURuntime, today = kstDay()) {
  const ws = workspaceOf(rt), from = addDays(today, -LIST_DAYS);
  const rows = [];
  for (let offset = 0; offset < LIST_MAX; offset += 100) {
    const page = await rt.api(`/rest/v1/app_call_personal?workspace_id=eq.${encode(ws)}&kind=in.(personal,unsure)&hidden_at=is.null&day=gte.${from}&select=${PERSONAL_FIELDS}&order=day.desc,occurred_at.desc,id.desc&limit=100&offset=${offset}`);
    if (!Array.isArray(page)) throw Error('목록을 확인하지 못했어요.');
    rows.push(...page.filter(r => r?.id && r.workspace_id === ws && (r.kind === 'personal' || r.kind === 'unsure')).map(r => ({...r, box:'personal'})));
    if (page.length < 100) break;
  }
  return rows;
}
export async function readPersonalRaw(id, rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  const rows = await rt.api(`/rest/v1/app_call_personal?id=eq.${encode(id)}&workspace_id=eq.${encode(ws)}&select=id,raw_text,speaker_split,drive_url&limit=1`);
  return Array.isArray(rows) && rows[0]?.id === id ? rows[0] : null;
}
// 지우기(목록에서만)·되돌리기: hidden_at and updated_at are the only columns the owner may change on this table.
export async function setPersonalHidden(id, on, rt = window.KPTURuntime) {
  const ws = workspaceOf(rt), body = {hidden_at:on ? new Date().toISOString() : null, updated_at:new Date().toISOString()};
  const rows = await rt.api(`/rest/v1/app_call_personal?id=eq.${encode(id)}&workspace_id=eq.${encode(ws)}&select=${PERSONAL_FIELDS}`, {method:'PATCH', prefer:'return=representation', body});
  return Array.isArray(rows) && rows.length === 1 ? {...rows[0], box:'personal'} : null;
}
// 옮기기: one DB function (one transaction) moves the call between the two boxes. to = 'work' | 'personal'.
// {ok:true, changed, needsRefill} or {ok:false, error: GONE | DUPLICATE | UNAVAILABLE | REFUSED | UNKNOWN}.
export async function moveCall(id, to, rt = window.KPTURuntime) {
  if (to !== 'work' && to !== 'personal') return {ok:false, error:'REFUSED'};
  let data;
  try { data = await rt.api('/rest/v1/rpc/app_call_move', {method:'POST', body:{p_id:id, p_to:to}, singleFlight:false}); }
  catch (error) {
    const status = Number(error?.status) || 0, text = String(error?.message || '');
    if (/CALL_NOT_FOUND/.test(text)) return {ok:false, error:'GONE'};
    if (status === 409 || /23505|CALL_REF_IN/.test(text)) return {ok:false, error:'DUPLICATE'};
    if (status === 404 || /PGRST202|Could not find the function/i.test(text)) return {ok:false, error:'UNAVAILABLE'};
    return {ok:false, error:status >= 400 && status < 500 ? 'REFUSED' : 'UNKNOWN'};
  }
  if (data && typeof data === 'object' && data.ok === true) return {ok:true, changed:data.changed === true, needsRefill:data.needs_refill === true};
  return {ok:false, error:'UNKNOWN'};
}
// 업무→개인 안내: has this work call already been read into the ledger? (원장 처리 표 app_ledger_auto_sources, owner RLS.)
// true / false, or null when it cannot be told (the table is not there or the read failed).
export async function readLedgerSeen(id, rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  try {
    const rows = await rt.api(`/rest/v1/app_ledger_auto_sources?workspace_id=eq.${encode(ws)}&source_kind=eq.call&source_id=eq.${encode(id)}&select=source_id&limit=1`);
    return Array.isArray(rows) ? rows.length > 0 : null;
  } catch { return null; }
}
