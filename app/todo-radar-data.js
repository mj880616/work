// JOURNAL-챙길것 1단계 + AI-서버연동 S5 (docs/design/todo-radar.md 10·11절, docs/design/ai-server.md 5.2).
// Data side of "챙길 것": the owner-RLS candidate table app_todo_candidates (20261021075034_todo_radar_candidates), read and
// changed with the signed-in token through the shared runtime. The find state table belongs to the server (ai-assist).
// Finding is the server's job: ai-assist kind=todo_radar reads the Web2 records itself and adds "open" candidates.
// The screen only sends {kind,mode}; it never sends record text. [할 일로] uses the existing Google task create path
// (quick-save.js createGoogleTask) and then marks the candidate; [무시] marks it. A counterpart promise (COM) is never
// stored: the server returns it once and the screen offers [원장으로 복사] (todo-radar 결정 6).
// When the table or the function is not deployed yet, every read reports {missing:true} and the screen hides quietly.
import {callAiAssist, AI_SUMMARY_TEXT} from './basket-ai-summary.js';
import {createGoogleTask} from './quick-save.js';
import {recordNoteTask, noteTaskEntry} from './basket-note-tasks.js';

export const RADAR_KIND_LABEL = Object.freeze({request:'요청', my_task:'내 할 일', deadline:'마감', prepare:'준비', attend:'참석'});
export const RADAR_SOURCE_LABEL = Object.freeze({basket:'업데이트', note:'노트', work:'일지', meeting:'사업 보고', org_update:'조직 기록', project_update:'사업영역 기록', telegram:'텔레그램'});
// JOURNAL-챙길것화면 ⑥: the first 4 open rows, the rest behind 'N건 더 ›' (home and journal alike).
export const HOME_ROWS = 4;
export const TASK_TITLE_MAX = 200;
// The server waits for OpenAI up to 30 s and may try once more; finding reads several tables first.
export const RADAR_TIMEOUT_MS = 90000;
const FIELDS = 'id,kind,summary,due,source_kind,source_id,source_day,evidence,project_id,organization_id,status,task_id,task_due,created_at,decided_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const encode = encodeURIComponent;

export const RADAR_TEXT = Object.freeze({
  ...AI_SUMMARY_TEXT,
  not_ready: '챙길 것 찾기는 아직 준비 중이에요.',
  daily_limit: '오늘 챙길 것을 찾을 수 있는 횟수를 다 썼어요. 내일 다시 찾아요.',
  monthly_limit: '이번 달 AI 한도에 닿았어요. 챙길 것 찾기는 다음 달에 다시 돼요.',
  in_progress: '챙길 것을 찾는 중이에요. 잠시 뒤 다시 확인해 주세요.',
  radar_unavailable: '챙길 것 기록을 읽거나 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
});

function workspace(rt) {
  const id = rt.context.read()?.workspace?.id;
  if (!id) throw new Error('업무 공간을 확인할 수 없어요.');
  return id;
}
export const radarScope = rt => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
// A table that does not exist yet answers 404 (PostgREST PGRST205 / 42P01).
export const isMissing = error => error?.status === 404 || /PGRST205|42P01|does not exist|schema cache/i.test(String(error?.message || ''));

// Only well-formed rows are shown; anything else from the database is skipped, never rendered raw.
export function validCandidate(row) {
  return !!row && typeof row === 'object' && UUID.test(String(row.id)) && Object.hasOwn(RADAR_KIND_LABEL, row.kind)
    && Object.hasOwn(RADAR_SOURCE_LABEL, row.source_kind) && UUID.test(String(row.source_id)) && DAY.test(String(row.source_day))
    && typeof row.summary === 'string' && row.summary.trim() !== '' && ['open', 'tasked', 'dismissed'].includes(row.status)
    && (row.due == null || DAY.test(String(row.due))) && (row.task_due == null || DAY.test(String(row.task_due)));
}
const clean = rows => (Array.isArray(rows) ? rows : []).filter(validCandidate);

// FEAT-1029 ⑤: a telegram candidate (server collector-feed, migration 20261029120000) points at one telegram news row (app_feed_items,
// owner read). One read per list adds the room (key + name) so the row shows '텔레그램 · 방 이름' and opens that room·day. A failed
// or missing read only leaves the room out ('텔레그램'); the candidate itself is still shown.
export const ROOM_KEY = /^[A-Za-z0-9_.:-]{1,100}$/;
async function withTelegramPlaces(rows, rt) {
  const ids = [...new Set(rows.filter(r => r.source_kind === 'telegram').map(r => String(r.source_id).toLowerCase()))].slice(0, 100);
  if (!ids.length) return rows;
  try {
    const found = await rt.api(`/rest/v1/app_feed_items?workspace_id=eq.${encode(workspace(rt))}&source=eq.telegram&id=in.(${ids.map(encode).join(',')})&select=id,room_key,room_label&limit=100`, {singleFlight:false});
    const byId = new Map((Array.isArray(found) ? found : []).filter(f => UUID.test(String(f?.id)) && ROOM_KEY.test(String(f?.room_key || '')))
      .map(f => [String(f.id).toLowerCase(), {room_key:String(f.room_key), room_label:typeof f.room_label === 'string' ? f.room_label.trim().slice(0, 60) : ''}]));
    for (const r of rows) if (r.source_kind === 'telegram') { const place = byId.get(String(r.source_id).toLowerCase()); if (place) r.tg = place; }
  } catch { /* room names are extra; the rows stay */ }
  return rows;
}
// The source words on a row: '텔레그램 · 가지부 간부방' for a telegram candidate whose room is known, else the plain label.
export function sourceText(c) {
  const label = RADAR_SOURCE_LABEL[c?.source_kind] || '기록';
  return c?.source_kind === 'telegram' && c.tg?.room_label ? `${label} · ${c.tg.room_label}` : label;
}

export async function readOpenCandidates(rt = window.KPTURuntime) {
  try {
    const rows = await rt.api(`/rest/v1/app_todo_candidates?workspace_id=eq.${encode(workspace(rt))}&status=eq.open&select=${FIELDS}&order=created_at.desc,id.asc&limit=100`, {singleFlight:false});
    return {ok:true, rows:await withTelegramPlaces(clean(rows), rt)};
  } catch (error) { return isMissing(error) ? {missing:true} : {ok:false}; }
}
// TODO-쌓인후보건수: 내 프로필 '챙길 것 기준'의 '쌓인 후보 n건' 줄. 대기 중(open) 후보의 id만 읽어 센다(1000건까지, 넘으면 more).
export const OPEN_COUNT_LIMIT = 1000;
export async function countOpenCandidates(rt = window.KPTURuntime) {
  try {
    const rows = await rt.api(`/rest/v1/app_todo_candidates?workspace_id=eq.${encode(workspace(rt))}&status=eq.open&select=id&limit=${OPEN_COUNT_LIMIT + 1}`, {singleFlight:false});
    const n = Array.isArray(rows) ? rows.length : 0;
    return {ok:true, count:Math.min(n, OPEN_COUNT_LIMIT), more:n > OPEN_COUNT_LIMIT};
  } catch (error) { return isMissing(error) ? {missing:true} : {ok:false}; }
}
// TG-요청강조: the 텔레그램 소식 list marks the room·day rows that hold an open "나한테 온 요청" (the same ask_me result the collector
// server saved as a candidate; no new AI judgement). One read of the open telegram candidates plus the room lookup above.
export async function readTelegramAsks(rt = window.KPTURuntime) {
  try {
    const rows = await rt.api(`/rest/v1/app_todo_candidates?workspace_id=eq.${encode(workspace(rt))}&source_kind=eq.telegram&status=eq.open&select=${FIELDS}&order=created_at.desc,id.asc&limit=100`, {singleFlight:false});
    return {ok:true, rows:await withTelegramPlaces(clean(rows), rt)};
  } catch (error) { return isMissing(error) ? {missing:true} : {ok:false}; }
}
// BASKET-정리함이름: the 정리함's [챙길 것] side shows what is still open and, under its other chips, what was sent to a task or
// ignored (newest decision first). Two reads so a long history of handled rows never pushes an open row out of the list.
export async function readInboxCandidates(rt = window.KPTURuntime) {
  try {
    const base = `/rest/v1/app_todo_candidates?workspace_id=eq.${encode(workspace(rt))}`;
    const [open, handled] = await Promise.all([
      rt.api(`${base}&status=eq.open&select=${FIELDS}&order=created_at.desc,id.asc&limit=100`, {singleFlight:false}),
      rt.api(`${base}&status=in.(tasked,dismissed)&select=${FIELDS}&order=decided_at.desc.nullslast,id.asc&limit=100`, {singleFlight:false}),
    ]);
    return {ok:true, rows:await withTelegramPlaces([...clean(open), ...clean(handled)], rt)};
  } catch (error) { return isMissing(error) ? {missing:true} : {ok:false}; }
}
// JOURNAL-챙길것화면 ⑤: home shows what is still open and, folded below, what was handled since `since` (today's start).
export async function readHomeCandidates(since, rt = window.KPTURuntime) {
  if (!Number.isFinite(Date.parse(since))) return {ok:false};
  try {
    const rows = await rt.api(`/rest/v1/app_todo_candidates?workspace_id=eq.${encode(workspace(rt))}&or=${encode(`(status.eq.open,decided_at.gte."${new Date(since).toISOString()}")`)}&select=${FIELDS}&order=created_at.desc,id.asc&limit=150`, {singleFlight:false});
    return {ok:true, rows:await withTelegramPlaces(clean(rows), rt)};
  } catch (error) { return isMissing(error) ? {missing:true} : {ok:false}; }
}
// The journal shows, for each day of the week, the candidates found in that day's records and what became of them.
export async function readWeekCandidates(from, to, rt = window.KPTURuntime) {
  if (!DAY.test(from) || !DAY.test(to)) return {ok:false};
  try {
    const rows = await rt.api(`/rest/v1/app_todo_candidates?workspace_id=eq.${encode(workspace(rt))}&source_day=gte.${from}&source_day=lte.${to}&select=${FIELDS}&order=created_at.asc,id.asc&limit=300`, {singleFlight:false});
    return {ok:true, rows:await withTelegramPlaces(clean(rows), rt)};
  } catch (error) { return isMissing(error) ? {missing:true} : {ok:false}; }
}

// A promise returned by the server: shown once, never stored.
function validPromise(p) {
  return !!p && typeof p === 'object' && typeof p.summary === 'string' && p.summary.trim() && [...p.summary].length <= 100
    && (p.due == null || DAY.test(String(p.due))) && typeof p.evidence === 'string' && [...p.evidence].length <= 200
    && Object.hasOwn(RADAR_SOURCE_LABEL, p.source_kind) && UUID.test(String(p.source_id)) && DAY.test(String(p.source_day));
}
// mode: 'auto' (the first open of the day; the server skips when it already looked today) or 'again' ([다시 찾기]).
export async function findTodos(mode, options = {}) {
  if (mode !== 'auto' && mode !== 'again') return {ok:false, code:'invalid_request', message:RADAR_TEXT.invalid_request};
  const r = await callAiAssist({kind:'todo_radar', mode}, {timeoutMs:RADAR_TIMEOUT_MS, ...options}, RADAR_TEXT);
  if (!r.ok) return {ok:false, code:r.code, message:RADAR_TEXT[r.code] || RADAR_TEXT.internal_error};
  const d = r.data;
  // The last finding time comes with every answer (the screen does not read the state table itself).
  const checkedAt = typeof d.checked_at === 'string' && Number.isFinite(Date.parse(d.checked_at)) ? d.checked_at : null;
  if (d.skipped === true) return {ok:true, skipped:true, checkedAt, partial:d.partial === true};
  if (!Number.isSafeInteger(d.added) || d.added < 0 || !Array.isArray(d.promises)) return {ok:false, code:'ai_invalid_response', message:RADAR_TEXT.ai_invalid_response};
  return {ok:true, skipped:false, added:d.added, checkedAt, partial:d.partial === true, promises:d.promises.filter(validPromise).slice(0, 10)};
}

// MTG-후속할일후보: the candidates of ONE 사업 보고 (same table, same rows as the 정리함 [챙길 것]); open and handled both come back so a
// handled one is never shown as new. Without a meeting id nothing is read.
export async function readMeetingCandidates(meetingId, rt = window.KPTURuntime) {
  if (!UUID.test(String(meetingId || ''))) return {ok:true, rows:[]};
  try {
    const rows = await rt.api(`/rest/v1/app_todo_candidates?workspace_id=eq.${encode(workspace(rt))}&source_kind=eq.meeting&source_id=eq.${encode(String(meetingId).toLowerCase())}&select=${FIELDS}&order=created_at.desc,id.asc&limit=100`, {singleFlight:false});
    return {ok:true, rows:clean(rows)};
  } catch (error) { return isMissing(error) ? {missing:true} : {ok:false}; }
}
// [후속 할 일 만들기]: the server reads this one meeting itself and adds 'open' candidates (ai-assist kind=todo_radar, mode=meeting).
// The screen sends only the meeting id, never the record text. Returns {ok:true, added} or {ok:false, code, message}.
export async function findMeetingTodos(meetingId, options = {}) {
  if (!UUID.test(String(meetingId || ''))) return {ok:false, code:'invalid_request', message:RADAR_TEXT.invalid_request};
  const r = await callAiAssist({kind:'todo_radar', mode:'meeting', meeting_id:String(meetingId).toLowerCase()}, {timeoutMs:RADAR_TIMEOUT_MS, ...options}, RADAR_TEXT);
  if (!r.ok) return {ok:false, code:r.code, message:RADAR_TEXT[r.code] || RADAR_TEXT.internal_error};
  if (!Number.isSafeInteger(r.data.added) || r.data.added < 0) return {ok:false, code:'ai_invalid_response', message:RADAR_TEXT.ai_invalid_response};
  return {ok:true, added:r.data.added};
}

// Each change is guarded by the current status, so a candidate already handled elsewhere is not changed twice.
async function patch(id, from, body, rt) {
  const rows = await rt.api(`/rest/v1/app_todo_candidates?id=eq.${encode(id)}&workspace_id=eq.${encode(workspace(rt))}&status=eq.${from}&select=id,status,task_id,decided_at`, {method:'PATCH', prefer:'return=representation', body});
  return Array.isArray(rows) && rows.length === 1 && rows[0].status === body.status;
}
export const dismissCandidate = (id, rt = window.KPTURuntime, now = new Date()) => patch(id, 'open', {status:'dismissed', decided_at:now.toISOString()}, rt);
export const reopenCandidate = (id, rt = window.KPTURuntime) => patch(id, 'dismissed', {status:'open', decided_at:null}, rt);
// JOURNAL-챙길것화면 후속: the due the task was put in with is saved on the candidate (task_due; null = no due), so the handled row can always show it.
export const markTasked = (id, taskId, rt = window.KPTURuntime, now = new Date(), due = null) =>
  patch(id, 'open', {status:'tasked', task_id:String(taskId), decided_at:now.toISOString(), task_due:due && DAY.test(String(due)) ? String(due) : null}, rt);

// The same targets the Google task create path takes (google-tasks Edge parseTargets): the candidate's project or
// organization, and the meeting when the source is a meeting result.
export function taskLinks(candidate) {
  const links = [];
  if (UUID.test(String(candidate?.project_id || ''))) links.push({project_id:candidate.project_id});
  if (UUID.test(String(candidate?.organization_id || ''))) links.push({organization_id:candidate.organization_id});
  if (candidate?.source_kind === 'meeting' && UUID.test(String(candidate.source_id))) links.push({meeting_id:candidate.source_id});
  return links;
}
export function validateTaskDraft({title, due}) {
  const t = String(title ?? '').trim();
  if (!t) return '할 일 제목을 써 주세요.';
  if ([...t].length > TASK_TITLE_MAX) return `할 일 제목은 ${TASK_TITLE_MAX}자까지 쓸 수 있어요.`;
  if (due && !DAY.test(due)) return '기한 날짜를 확인해 주세요.';
  return '';
}
// [할 일로]: one Google task through the existing create path, then the candidate is marked. The Google task is never
// created twice: a lost answer is 'unknown', and a failed mark only offers marking again.
// Returns {status:'done'|'marked_failed'|'failed'|'unknown', task?, recorded?}.
export async function candidateToTask(candidate, draft, {rt = window.KPTURuntime, now = () => new Date()} = {}) {
  const body = {title:String(draft.title).trim(), notes:'', due:draft.due || null, links:taskLinks(candidate)};
  const epoch = rt.session?.epoch?.();
  let result;
  try { result = await createGoogleTask({...body, expectedSessionEpoch:epoch ?? null}, rt); }
  catch (error) { return {status:error?.status ? 'failed' : 'unknown', code:error?.status === 401 ? 'session_required' : ''}; }
  if (result?.ok !== true || !result.task?.id) return {status:'failed'};
  let marked = false;
  try { marked = await markTasked(candidate.id, result.task.id, rt, now(), draft.due || null); } catch { marked = false; }
  // BASKET-할일출처: a task made from an update is also listed on that update (existing feature). Failure is only reported.
  let recorded = null;
  if (candidate.source_kind === 'basket') {
    try { recorded = (await recordNoteTask(candidate.source_id, noteTaskEntry(result.task, now()), {rt, expectedSessionEpoch:epoch ?? null})).ok; } catch { recorded = false; }
  }
  return {status:marked ? 'done' : 'marked_failed', task:result.task, recorded, linkError:!!result.link_error};
}

// JOURNAL-챙길것화면 ③: [✓ 바로 할 일로] takes the AI's suggested due when there is one, else today.
export const quickDue = (candidate, today) => candidate?.due && DAY.test(String(candidate.due)) ? candidate.due : today;
// '10.23' from a date-only value or a Google due ('2026-10-23T00:00:00.000Z'); '' when it is not a date.
export function dotDay(value) {
  const m = String(value ?? '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${Number(m[1])}.${Number(m[2])}` : '';
}
// [✎ 고쳐서 넣기] due choices: 오늘 / 내일 / 제안 기한(only when the AI suggested one) / 기한 없음.
export function dueChoices(candidate, today, tomorrow) {
  const list = [{key:'today', label:'오늘', due:today}, {key:'tomorrow', label:'내일', due:tomorrow}];
  if (candidate?.due && DAY.test(String(candidate.due))) list.push({key:'suggested', label:`제안 기한 ${dotDay(candidate.due)}`, due:candidate.due});
  list.push({key:'none', label:'기한 없음', due:''});
  return list;
}

// todo-radar 결정 5: what is already a task is not shown again (title match after removing spaces and marks).
export const normalizeTitle = value => String(value ?? '').toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 80);
export function notPlanned(rows, taskTitles = []) {
  const known = new Set(taskTitles.map(normalizeTitle).filter(Boolean));
  return rows.filter(row => !known.has(normalizeTitle(row.summary)));
}

// 결정 6: a counterpart promise goes to the ledger by the user's own paste ("쓰기요청" text), never stored here.
export function ledgerRequestText(p) {
  return ['쓰기요청', '- 종류: 약속(상대·제3자)', `- 내용: ${p.summary}`, `- 기한: ${p.due || '없음'}`,
    `- 근거: ${p.evidence || '없음'}`, `- 출처: Web2 ${RADAR_SOURCE_LABEL[p.source_kind] || '기록'} ${p.source_day}`].join('\n');
}

// ---- TODO-내일만: [내 일 아님]·예외 방·쌓인 후보 다시 거르기 (migration 20261029210000, 소유자 RLS) ----------------------
// [내 일 아님]: the candidate is dismissed (same guarded change as [무시]) and its source kind + one-line summary are kept in
// app_todo_not_mine, which the server shows the AI as "not mine" examples next time. Nothing is kept in browser storage.
// Returns {ok:false} when the candidate could not be dismissed, else {ok:true, saved} (saved=false: the example was not kept).
export async function markNotMine(candidate, rt = window.KPTURuntime, now = new Date()) {
  if (!candidate || !UUID.test(String(candidate.id))) return {ok:false};
  if (!(await dismissCandidate(candidate.id, rt, now))) return {ok:false};
  const summary = String(candidate.summary || '').trim();
  if (!summary || [...summary].length > 100 || !Object.hasOwn(RADAR_SOURCE_LABEL, candidate.source_kind)) return {ok:true, saved:false};
  try {
    const rows = await rt.api('/rest/v1/app_todo_not_mine?select=id', {method:'POST', prefer:'return=representation', body:{workspace_id:workspace(rt), source_kind:candidate.source_kind, summary}});
    const id = Array.isArray(rows) && UUID.test(String(rows[0]?.id)) ? rows[0].id : null;
    return {ok:true, saved:true, exampleId:id};
  } catch { return {ok:true, saved:false}; }
}
// [되돌리기] after [내 일 아님]: the candidate comes back (reopenCandidate) and the example is removed again.
export async function undoNotMine(candidateId, exampleId, rt = window.KPTURuntime) {
  if (!(await reopenCandidate(candidateId, rt))) return false;
  if (UUID.test(String(exampleId || ''))) {
    try { await rt.api(`/rest/v1/app_todo_not_mine?id=eq.${encode(exampleId)}&workspace_id=eq.${encode(workspace(rt))}`, {method:'DELETE', prefer:'return=minimal'}); } catch { /* the candidate is back; the example stays */ }
  }
  return true;
}

// The rooms whose group-wide asks ('다들 ~해 주세요') still become candidates. Stored by room key; the name comes from the room list.
export async function readAskRooms(rt = window.KPTURuntime) {
  try {
    const rows = await rt.api(`/rest/v1/app_todo_ask_rooms?workspace_id=eq.${encode(workspace(rt))}&select=room_key&order=created_at.asc&limit=500`, {singleFlight:false});
    return {ok:true, keys:(Array.isArray(rows) ? rows : []).map(r => r?.room_key).filter(k => typeof k === 'string' && ROOM_KEY.test(k))};
  } catch (error) { return isMissing(error) ? {missing:true} : {ok:false}; }
}
export async function addAskRoom(roomKey, rt = window.KPTURuntime) {
  if (!ROOM_KEY.test(String(roomKey || ''))) return false;
  try { await rt.api('/rest/v1/app_todo_ask_rooms?on_conflict=workspace_id,room_key', {method:'POST', prefer:'resolution=ignore-duplicates,return=minimal', body:{workspace_id:workspace(rt), room_key:roomKey}}); return true; }
  catch { return false; }
}
export async function removeAskRoom(roomKey, rt = window.KPTURuntime) {
  if (!ROOM_KEY.test(String(roomKey || ''))) return false;
  try { await rt.api(`/rest/v1/app_todo_ask_rooms?workspace_id=eq.${encode(workspace(rt))}&room_key=eq.${encode(roomKey)}`, {method:'DELETE', prefer:'return=minimal'}); return true; }
  catch { return false; }
}

// One run of "filter the waiting candidates again with the new rule" (ai-assist kind=todo_recheck). Only {kind} is sent.
// Returns {ok:true, checked, dismissed, more} or {ok:false, code, message}.
export async function recheckTodos(options = {}) {
  const r = await callAiAssist({kind:'todo_recheck'}, {timeoutMs:RADAR_TIMEOUT_MS, ...options}, RADAR_TEXT);
  if (!r.ok) return {ok:false, code:r.code, message:RADAR_TEXT[r.code] || RADAR_TEXT.internal_error};
  const d = r.data;
  if (!Number.isSafeInteger(d.checked) || !Number.isSafeInteger(d.dismissed) || d.checked < 0 || d.dismissed < 0 || d.dismissed > d.checked)
    return {ok:false, code:'ai_invalid_response', message:RADAR_TEXT.ai_invalid_response};
  return {ok:true, checked:d.checked, dismissed:d.dismissed, more:d.more === true};
}
