// BIZ-기록하나로 B-3(설계 docs/design/record-one.md 2-3·2-4·3-1): 사업 '지금 상황'·사업 기록 읽기·쓰기 한 곳(기존 로그인 사용자 owner RLS 길).
// - app_business_now: 사업·주(월요일)마다 1행. 쓰는 칸은 표가 허락한 것만(넣기 workspace_id·space_id·week_start·body·owner_text, 고치기 body·owner_text).
// - app_business_records: 사업마다 '날짜 + 한 줄'. 화면에서 넣는 출처는 user·update·feed·memorable(progress는 옮기기 SQL만).
// - 작업공간·사업이 같은 작업공간인지는 DB 정책·트리거가 다시 판정한다(화면이 보낸 번호를 믿지 않음). 기기 저장 없음, 글은 로그에 쓰지 않는다.
import {missingTable} from './feed-model.mjs';
import * as M from './business-now-model.mjs';

const NOW = '/rest/v1/app_business_now';
const RECS = '/rest/v1/app_business_records';
const NOW_COLS = 'id,space_id,week_start,body,owner_text,updated_at';
const REC_COLS = 'id,space_id,day,end_day,body,source_kind,source_id,created_at';
const enc = encodeURIComponent;
export const BIZ_NOW_EVENT = 'kptu:business-now-changed';
const wsOf = rt => rt?.context?.read?.()?.workspace?.id || '';

// 지금 상황 행 전부(모든 주 — 처음 채우기는 '행이 하나도 없는 사업'을 봐야 함). 표가 아직 없으면 {missing:true}.
export async function readNow(rt, workspaceId = wsOf(rt)) {
  try {
    const rows = await rt.api(`${NOW}?workspace_id=eq.${enc(workspaceId)}&select=${NOW_COLS}&order=week_start.asc,id.asc&limit=5000`, {singleFlight: false});
    if (!Array.isArray(rows)) throw new Error('now');
    return {missing: false, rows};
  } catch (e) { if (missingTable(e)) return {missing: true, rows: []}; throw e; }
}
// 그 주에 걸친 사업 기록(줄 모양). 표가 아직 없으면 {missing:true}.
export async function readWeekRecords(rt, week, workspaceId = wsOf(rt)) {
  const r = M.recordReadRange(week);
  if (!r) return {missing: false, items: []};
  try {
    const rows = await rt.api(`${RECS}?workspace_id=eq.${enc(workspaceId)}&day=gte.${r.from}&day=lte.${r.to}&select=${REC_COLS}&order=day.asc,id.asc&limit=3000`, {singleFlight: false});
    if (!Array.isArray(rows)) throw new Error('records');
    return {missing: false, items: rows.map(M.bizRecordItem).filter(Boolean)};
  } catch (e) { if (missingTable(e)) return {missing: true, items: []}; throw e; }
}
// 그 주 지금 상황·담당 쓰기(모델 nextNow가 넣기·고치기를 정함). rows = 읽어 둔 행. 돌려주는 값 = 바뀐 뒤 행 목록.
export async function writeNow(rt, {rows, spaceId, week, change}, workspaceId = wsOf(rt)) {
  const p = M.nextNow(rows, {spaceId, week}, change);
  if (p.op === 'none') return rows;
  let saved;
  if (p.op === 'insert') {
    saved = await rt.api(`${NOW}?select=${NOW_COLS}`, {method: 'POST', prefer: 'return=representation', singleFlight: false, body: {workspace_id: workspaceId, ...p.row}});
  } else {
    saved = await rt.api(`${NOW}?id=eq.${enc(p.id)}&workspace_id=eq.${enc(workspaceId)}&select=${NOW_COLS}`, {method: 'PATCH', prefer: 'return=representation', singleFlight: false, body: p.row});
  }
  if (!Array.isArray(saved) || !saved[0]) throw new Error('now');
  window.dispatchEvent(new CustomEvent(BIZ_NOW_EVENT, {detail: {week}}));
  return p.op === 'insert' ? [...rows, saved[0]] : rows.map(r => (r.id === p.id ? saved[0] : r));
}
// 처음 한 번 채우기: 행들을 한 번에 넣는다. 다른 기기·탭이 먼저 넣은 (사업, 주)는 건너뛴다(같은 칸 덮지 않음).
export async function fillNow(rt, list, workspaceId = wsOf(rt)) {
  if (!Array.isArray(list) || !list.length) return 0;
  const body = list.map(r => ({workspace_id: workspaceId, ...r}));
  await rt.api(`${NOW}?on_conflict=workspace_id,space_id,week_start`, {method: 'POST', prefer: 'return=minimal,resolution=ignore-duplicates', singleFlight: false, body});
  return list.length;
}
// 사업 기록 한 줄 넣기(업데이트·소식 [사업]). source_kind user는 원래 줄이 없고, 그 밖은 원래 줄 번호가 있어야 한다(DB 검사와 같음).
// 같은 원래 줄을 두 번 넣으면 DB 고유 색인이 거절한다(409) — 이미 들어간 것이므로 저장된 것으로 본다.
export async function saveBusinessRecord({space_id, day, end_day = null, body, source_kind = 'user', source_id = null}, rt = window.KPTURuntime, workspaceId = wsOf(rt)) {
  const text = M.recordBody(body), d = M.recordDay(day);
  if (!space_id || !text || !d) throw Object.assign(new Error('사업 기록 내용이 비었어요.'), {code: 'empty'});
  const kind = ['update', 'feed', 'memorable'].includes(source_kind) && source_id ? source_kind : 'user';
  const row = {workspace_id: workspaceId, space_id, day: d, body: text, source_kind: kind, ...(end_day && end_day > d ? {end_day} : {}), ...(kind !== 'user' ? {source_id} : {})};
  try {
    const rows = await rt.api(`${RECS}?select=${REC_COLS}`, {method: 'POST', prefer: 'return=representation', singleFlight: false, body: row});
    window.dispatchEvent(new CustomEvent(BIZ_NOW_EVENT, {detail: {records: true}}));
    return Array.isArray(rows) ? rows : [];
  } catch (e) { if (kind !== 'user' && e?.status === 409) return []; throw e; }
}
