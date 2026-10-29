// CALL-개인통화함 3단계 (docs/design/call-personal.md): this file is also the ONLY place of the app that names the personal call
// table app_call_personal (personal and 애매 calls; owner RLS, select + hidden_at / raw_text clear / updated_at only) and the move
// function app_call_move. The work reads above (readFeed, readDays, readRaw, patchItem) never touch that table.
// CALL-통화메뉴·TG-소식메뉴 4단계: reads and owner writes of app_feed_items / app_feed_days (migration 20261024140000_call_tg_feed)
// for the 통화 (call-feed.js) and 텔레그램 소식 (telegram-feed.js) screens. Plain owner-RLS REST with the signed-in token, no RPC and
// no Edge: the table's one policy (private.app_is_workspace_owner) and its column grants decide. The signed-in owner may only
// change pinned_at, hidden_at, raw_text (clear only — the guard trigger refuses any other value), organization_id, project_id
// and updated_at; there is no insert or delete. Rows come in through collector-feed only.
// TG-방날짜묶기: a telegram item's 삭제/되살리기 goes through the DB function app_feed_set_state; 삭제 is hidden_at (the 휴지통), never emptied by itself.
import {readRecordPages} from './basket-link-records.js';
import {myOrganizationIds} from './my-organizations.js';
import {addDays, kstDay} from './feed-model.mjs';
import {callAiAssist} from './basket-ai-summary.js';

const encode = encodeURIComponent;
const ctx = rt => rt?.context?.read?.() || {};
export const workspaceOf = rt => { const id = ctx(rt)?.workspace?.id; if (!id) throw Error('업무 공간을 확인할 수 없어요.'); return id; };
export const scopeOf = rt => { const c = ctx(rt); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };

// raw_text is read only for the one row shown (it may be up to 200 KB).
export const ITEM_FIELDS = 'id,workspace_id,source,day,occurred_at,room_key,room_label,title,summary,points,counterpart,speaker_split,raw_count,organization_id,project_id,drive_url,pinned_at,hidden_at,created_at,updated_at';
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

// ---------- 텔레그램 소식 (TG-방날짜묶기 4단계): 방·날 한 줄 목록과 방 상세. 읽기는 DB 함수 app_feed_room_day_lines(소유자 RLS 그대로)와
// 소유자 읽기 표(app_feed_items·app_feed_room_days). 소식 한 줄의 삭제·되살리기는 DB 함수 app_feed_set_state(주인만, 텔레그램 줄만)로 하며
// 삭제(hidden_at)는 휴지통이고 자동으로 비우지 않는다. Drive 원문은 건드리지 않는다.
// 이 날 범위의 방·날 줄. 한 번에 7일씩 나눠 부른다(chunks: [[from,to],...]).
export async function readRoomDayLines(chunks, rt = window.KPTURuntime) {
  const pages = await Promise.all(chunks.map(async ([from, to]) => {
    const data = await rt.api('/rest/v1/rpc/app_feed_room_day_lines', {method:'POST', body:{p_from:from, p_to:to}, singleFlight:false});
    if (!Array.isArray(data)) throw Error('목록을 확인하지 못했어요.');
    return data;
  }));
  return pages.flat();
}
// 그 방·날의 지우지 않은 소식(시간 순)과 요약 묶음. parts는 읽지 못하면 null(화면이 소식 제목 모음으로 물러난다).
export async function readRoomDay(room, day, rt = window.KPTURuntime) {
  const ws = workspaceOf(rt), at = `workspace_id=eq.${encode(ws)}&room_key=eq.${encode(room)}&day=eq.${encode(day)}`;
  const [items, days] = await Promise.all([
    rt.api(`/rest/v1/app_feed_items?${at}&source=eq.telegram&hidden_at=is.null&select=${ITEM_FIELDS}&order=occurred_at.asc,id.asc&limit=200`),
    rt.api(`/rest/v1/app_feed_room_days?${at}&select=parts&limit=1`).catch(() => null),
  ]);
  if (!Array.isArray(items)) throw Error('목록을 확인하지 못했어요.');
  return {items:items.filter(r => r?.id && r.workspace_id === ws && r.source === 'telegram'), parts:Array.isArray(days) ? (days[0]?.parts ?? []) : null};
}
// 요약이 없는 날의 소식 제목 재료(방·날 줄 글이 빈 날만). days: 날짜 배열(14개씩 나눠 부름).
export async function readTitleRows(days, rt = window.KPTURuntime) {
  const ws = workspaceOf(rt), out = [];
  for (let i = 0; i < days.length; i += 14) {
    const part = days.slice(i, i + 14);
    for (let offset = 0; offset < 500; offset += 100) {
      const page = await rt.api(`/rest/v1/app_feed_items?workspace_id=eq.${encode(ws)}&source=eq.telegram&hidden_at=is.null&day=in.(${part.map(encode).join(',')})&select=room_key,day,title,summary,occurred_at&order=day.desc,occurred_at.asc&limit=100&offset=${offset}`);
      if (!Array.isArray(page)) throw Error('목록을 확인하지 못했어요.');
      out.push(...page);
      if (page.length < 100) break;
    }
  }
  return out;
}
// TG-요청강조: 방·날 줄의 회색 꼬리표(담당조직·일정) 재료. 지우지 않은 소식의 방·날·조직·제목·요약만(원문 없음), 600줄까지.
export async function readLineMarks(from, to, rt = window.KPTURuntime) {
  const ws = workspaceOf(rt), out = [];
  for (let offset = 0; offset < LIST_MAX; offset += 100) {
    const page = await rt.api(`/rest/v1/app_feed_items?workspace_id=eq.${encode(ws)}&source=eq.telegram&hidden_at=is.null&day=gte.${encode(from)}&day=lte.${encode(to)}&select=room_key,day,organization_id,title,summary&order=day.desc,occurred_at.asc,id.asc&limit=100&offset=${offset}`);
    if (!Array.isArray(page)) throw Error('목록을 확인하지 못했어요.');
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}
export async function readPinnedItems(rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  const page = await rt.api(`/rest/v1/app_feed_items?workspace_id=eq.${encode(ws)}&source=eq.telegram&pinned_at=not.is.null&hidden_at=is.null&select=${ITEM_FIELDS}&order=pinned_at.desc,id.desc&limit=50`);
  if (!Array.isArray(page)) throw Error('목록을 확인하지 못했어요.');
  return page.filter(r => r?.id && r.workspace_id === ws && r.source === 'telegram');
}
// 휴지통: 지운 소식(날짜 제한 없이 최근 200줄).
export async function readTrashedItems(rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  const page = await rt.api(`/rest/v1/app_feed_items?workspace_id=eq.${encode(ws)}&source=eq.telegram&hidden_at=not.is.null&select=${ITEM_FIELDS}&order=day.desc,occurred_at.desc,id.desc&limit=200`);
  if (!Array.isArray(page)) throw Error('목록을 확인하지 못했어요.');
  return page.filter(r => r?.id && r.workspace_id === ws && r.source === 'telegram');
}
// 소식 한 줄의 삭제('trashed')·되살리기('active'). {ok:true, hidden_at} 또는 {ok:false, error: GONE | UNAVAILABLE | REFUSED | UNKNOWN}.
export async function setFeedState(id, state, rt = window.KPTURuntime) {
  if (state !== 'active' && state !== 'trashed') return {ok:false, error:'REFUSED'};
  let data;
  try { data = await rt.api('/rest/v1/rpc/app_feed_set_state', {method:'POST', body:{p_id:id, p_state:state}, singleFlight:false}); }
  catch (error) {
    const status = Number(error?.status) || 0, text = String(error?.message || '');
    if (/FEED_NOT_FOUND/.test(text)) return {ok:false, error:'GONE'};
    if (status === 404 || /PGRST202|Could not find the function/i.test(text)) return {ok:false, error:'UNAVAILABLE'};
    return {ok:false, error:status >= 400 && status < 500 ? 'REFUSED' : 'UNKNOWN'};
  }
  if (data && typeof data === 'object' && data.ok === true) return {ok:true, hidden_at:data.hidden_at ?? null};
  return {ok:false, error:'UNKNOWN'};
}

// ---------- TG-방날짜묶기 4-나: 폴더·보관·날 삭제. 새 표 3개는 소유자 읽기만, 쓰기는 DB 함수(TGDG_* 오류 코드)로만 한다.
export async function readFeedFolders(rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  const rows = await readRecordPages(`/rest/v1/app_feed_folders?workspace_id=eq.${encode(ws)}&select=id,name,sort_order&order=sort_order.asc,name.asc`, rt);
  return rows.filter(f => f?.id && typeof f.name === 'string');
}
export async function readFeedRooms(rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  const rows = await readRecordPages(`/rest/v1/app_feed_rooms?workspace_id=eq.${encode(ws)}&select=room_key,room_label,folder_id,archived_at&order=room_key.asc`, rt);
  return new Map(rows.filter(r => r?.room_key).map(r => [r.room_key, {room_label:r.room_label || '', folder_id:r.folder_id || null, archived_at:r.archived_at || null}]));
}
// 지운 날(휴지통): {room_key, day, hidden_at}, 날짜 제한 없이 최근 200줄.
export async function readTrashedDays(rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  const page = await rt.api(`/rest/v1/app_feed_room_days?workspace_id=eq.${encode(ws)}&hidden_at=not.is.null&select=room_key,day,hidden_at&order=day.desc,room_key.asc&limit=200`);
  if (!Array.isArray(page)) throw Error('목록을 확인하지 못했어요.');
  return page.filter(r => r?.room_key && r.day);
}
const TGDG = [[/TGDG_FOLDER_NAME_TAKEN/, 'TAKEN'], [/TGDG_FOLDER_LIMIT/, 'LIMIT'], [/TGDG_FOLDER_NAME|TGDG_ARGS/, 'INVALID'], [/TGDG_NOT_FOUND|TGDG_NO_ROOM/, 'GONE'],
  [/TGSE_NOT_FOUND/, 'GONE'], [/TGSE_(SUMMARY|HEADLINE|LINES|ARGS|FIELD|PATCH|RESET)/, 'INVALID']];
function tgdgError(error) {
  const status = Number(error?.status) || 0, text = String(error?.message || '') + ' ' + String(error?.code || '');
  for (const [re, code] of TGDG) if (re.test(text)) return code;
  if (status === 404 || /PGRST202|Could not find the function/i.test(text)) return 'UNAVAILABLE';
  return status >= 400 && status < 500 ? 'REFUSED' : 'UNKNOWN';
}
async function tgdg(name, body, rt) {
  try {
    const data = await rt.api(`/rest/v1/rpc/${name}`, {method:'POST', body, singleFlight:false});
    return data && typeof data === 'object' && data.ok === true ? {...data, ok:true} : {ok:false, error:'UNKNOWN'};
  } catch (error) { return {ok:false, error:tgdgError(error)}; }
}
// 방의 폴더와 보관을 통째로 정한다(folder: 폴더 ID 또는 null, archived: true/false). 돌려주는 값 {ok, folder_id, archived} 또는 {ok:false, error}.
export const setRoom = (roomKey, folder, archived, rt = window.KPTURuntime) => tgdg('app_feed_room_set', {p_room_key:roomKey, p_folder:folder || null, p_archived:!!archived}, rt);
// 그날 그 줄만 삭제('trashed')·되살리기('active').
export const setRoomDay = (roomKey, day, state, rt = window.KPTURuntime) => tgdg('app_feed_room_day_set', {p_room_key:roomKey, p_day:day, p_state:state}, rt);
export const createFolder = (name, rt = window.KPTURuntime) => tgdg('app_feed_folder_create', {p_name:name}, rt);
export const renameFolder = (id, name, rt = window.KPTURuntime) => tgdg('app_feed_folder_rename', {p_id:id, p_name:name}, rt);
export const deleteFolder = (id, rt = window.KPTURuntime) => tgdg('app_feed_folder_delete', {p_id:id}, rt);

// ---------- TG-요약고치기: 명진이 손으로 고친 요약은 AI 값과 따로 서버(app_feed_summary_edits, 소유자 읽기만)에 있고, 쓰기는 DB 함수 app_feed_summary_edit 하나뿐이다.
// 읽기: [{target, vals}] 전부(소식 한 줄은 'item:<id>', 그날 요약은 'day:<방>|<날짜>'). 표가 아직 없거나 읽지 못하면 던진다(부르는 쪽이 고치기를 숨긴다).
export async function readSummaryEdits(rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  const rows = await readRecordPages(`/rest/v1/app_feed_summary_edits?workspace_id=eq.${encode(ws)}&select=target,vals&order=target.asc`, rt);
  return rows.filter(r => r && typeof r.target === 'string');
}
// target 하나를 고친다. 소식 한 줄: {item}, 그날 요약: {room, day}. patch: {summary} | {headline?, lines?} 와 {reset:[칸 이름]}(AI 값으로 되돌림).
// 돌려주는 값 {ok:true, changed, target, vals(그 target의 고친 값 전부)} 또는 {ok:false, error: GONE | INVALID | UNAVAILABLE | REFUSED | UNKNOWN}.
export const editSummary = ({item = null, room = null, day = null, patch}, rt = window.KPTURuntime) =>
  tgdg('app_feed_summary_edit', {p_item:item, p_room_key:room, p_day:day, p_patch:patch || {}}, rt);

// Organizations for names and for the 조직 연결 box: every organization of the workspace (names of inactive ones are still shown on
// old rows), plus which are mine (my-organizations.js, ORG-고르기통일: the one rule every organization picker uses).
export async function readOrganizations(rt = window.KPTURuntime) {
  const c = ctx(rt), ws = workspaceOf(rt);
  const [orgs, mine] = await Promise.all([
    readRecordPages(`/rest/v1/app_suborganizations?workspace_id=eq.${encode(ws)}&select=id,name,aliases,active&order=id.asc`, rt),
    readRecordPages(`/rest/v1/app_suborganization_assignees?user_id=eq.${encode(c.user?.id || '')}&select=organization_id&order=organization_id.asc`, rt).catch(() => []),
  ]);
  const rows = orgs.filter(o => o?.id);
  return {orgs:rows, mine:myOrganizationIds(rows, mine)};
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
// CALL-개인통화함 4단계: 업무로 옮긴 직후 그 한 건만 서버 AI(ai-assist call_refill)가 제목·조직·상대·직함을 다시 채운다.
// 화면은 통화 ID만 보낸다. 저장은 서버가 DB 함수로 하므로 여기서는 쓰지 않는다. Never throws.
// {ok:true, skipped} or {ok:false, code}. An undeployed server answers with a known code and the old values stay.
export async function refillCall(id, rt = window.KPTURuntime, options = {}) {
  const r = await callAiAssist({kind:'call_refill', id}, {rt, ...options});
  return r.ok ? {ok:true, skipped:r.data.skipped === true} : {ok:false, code:r.code};
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

// ---------- CALL-손고치기 (docs/design/call-user-edit.md): 통화의 제목·조직·상대 이름·핵심내용을 손으로 고친 값.
// 고친 값은 app_call_edits(소유자 읽기 전용)에 따로 있고 AI가 채운 칸은 그대로다. 쓰기는 DB 함수 app_call_edit 하나로만 한다.
// Map(통화 ID → 사용자 값). 표가 아직 없으면(DB 적용 전) 위로 던져서 화면이 missingTable로 알아본다.
export async function readCallEdits(rt = window.KPTURuntime) {
  const ws = workspaceOf(rt);
  const rows = await readRecordPages(`/rest/v1/app_call_edits?workspace_id=eq.${encode(ws)}&select=call_id,vals&order=call_id.asc`, rt);
  return new Map(rows.filter(r => r?.call_id && r.vals && typeof r.vals === 'object').map(r => [r.call_id, r.vals]));
}
// patch 키: title · counterpart · organization_id (업무 통화만) · points · reset(고쳤던 칸 이름 배열 = AI 값으로).
// {ok:true, changed, vals} 또는 {ok:false, error: GONE | INVALID | UNAVAILABLE | REFUSED | UNKNOWN}.
export async function editCall(id, patch, rt = window.KPTURuntime) {
  let data;
  try { data = await rt.api('/rest/v1/rpc/app_call_edit', {method:'POST', body:{p_id:id, p_patch:patch}, singleFlight:false}); }
  catch (error) {
    const status = Number(error?.status) || 0, text = String(error?.message || '');
    if (/CALL_NOT_FOUND/.test(text)) return {ok:false, error:'GONE'};
    if (/CALL_EDIT_|FEED_LINK_SCOPE/.test(text)) return {ok:false, error:'INVALID'};
    if (status === 404 || /PGRST202|Could not find the function/i.test(text)) return {ok:false, error:'UNAVAILABLE'};
    return {ok:false, error:status >= 400 && status < 500 ? 'REFUSED' : 'UNKNOWN'};
  }
  if (data && typeof data === 'object' && data.ok === true && data.vals && typeof data.vals === 'object') return {ok:true, changed:data.changed === true, vals:data.vals};
  return {ok:false, error:'UNKNOWN'};
}
