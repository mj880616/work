// ORG-쟁의단계: 쟁의 단계 목록·조직별 이력의 읽기·저장(서버 저장만, 기기 저장 없음). 판정은 org-dispute-stage-model.mjs 한 곳.
// 읽기는 쓰기를 하지 않는다(보기만 해서 운영 데이터가 바뀌지 않게). 기본 단계 11개는 명진이 단계를 저장하거나 관리 창을 처음 열 때 ensureSeeded가 채운다.
// 표는 app_dispute_stages(단계 목록)·app_suborganization_dispute_stages(이력)·함수 app_dispute_stage_delete(지우기).
// 표가 아직 없는 운영(DB 적용 전)에서는 status:'preparing'으로 돌려주고 화면은 '준비 중' 한 줄만 보인다.
import {seedRows, sortStages, defaultStage, latestRow, stageNameProblem} from './org-dispute-stage-model.mjs';

const enc = encodeURIComponent;
const SELECT_STAGES = 'id,name,sort_order,is_struggle,is_ending,is_default,created_at';
const SELECT_HISTORY = 'id,organization_id,stage_id,stage_name,stage_date,created_at';
let cache = null; // {owner, workspace, state}
let flight = null;

const ownerOf = rt => rt?.context?.read?.()?.user?.id || '';
const missingTable = e => e?.status === 404 || e?.status === 400 && /relation|PGRST20[0-9]|schema cache/i.test(String(e?.message));
const notify = () => window.dispatchEvent(new CustomEvent('kptu:dispute-stages-changed'));

export const peekDisputeState = () => cache?.state ?? null;
export function resetDisputeState() { cache = null; flight = null; }
if (typeof window !== 'undefined') window.addEventListener('kptu:session-changed', resetDisputeState);

async function readPages(path, rt) {
  const all = [], limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const rows = await rt.api(`${path}&limit=${limit}&offset=${offset}`);
    if (!Array.isArray(rows)) throw new Error('목록 모양이 달라요.');
    all.push(...rows);
    if (rows.length < limit) return all;
  }
}

async function readAll(workspaceId, rt) {
  const stagePath = `/rest/v1/app_dispute_stages?workspace_id=eq.${enc(workspaceId)}&select=${SELECT_STAGES}&order=sort_order.asc,created_at.asc,id.asc`;
  let stages = await readPages(stagePath, rt);
  const history = await readPages(`/rest/v1/app_suborganization_dispute_stages?select=${SELECT_HISTORY}&order=stage_date.desc,created_at.desc,id.desc`, rt);
  return {stages: sortStages(stages), histories: groupHistory(history)};
}
export function groupHistory(rows) {
  const map = new Map();
  for (const row of rows) (map.get(row.organization_id) ?? map.set(row.organization_id, []).get(row.organization_id)).push(row);
  return map;
}

// 기본 단계가 없으면 기본 단계 줄을 맨 앞에 둔 11개를 한 번에(원자적) 넣고 다시 읽는다. 이미 있는 이름은 건너뛴다(두 화면이 동시에 해도 안전).
export async function ensureSeeded({rt = window.KPTURuntime, workspaceId} = {}) {
  let state = await loadDisputeState({rt, workspaceId});
  if (state.status !== 'ready') throw new Error('단계를 준비하지 못했어요.');
  if (defaultStage(state.stages)) return state;
  await rt.api('/rest/v1/app_dispute_stages?on_conflict=workspace_id,name', {method: 'POST', body: seedRows(workspaceId), prefer: 'resolution=ignore-duplicates,return=minimal'});
  state = await loadDisputeState({rt, workspaceId, force: true});
  if (state.status !== 'ready' || !defaultStage(state.stages)) throw new Error('기본 단계를 준비하지 못했어요.');
  return state;
}

// 상태 읽기. status: 'ready' | 'preparing'(표 없음) | 'error'. 같은 로그인·업무공간에서는 저장본을 먼저 주고 force로 다시 읽는다.
export async function loadDisputeState({rt = window.KPTURuntime, workspaceId, force = false} = {}) {
  const owner = ownerOf(rt);
  if (!workspaceId || !owner) return {status: 'error', stages: [], histories: new Map()};
  if (!force && cache && cache.owner === owner && cache.workspace === workspaceId && cache.state.status === 'ready') return cache.state;
  if (flight && flight.key === owner + workspaceId && !force) return flight.promise;
  const promise = (async () => {
    let state;
    try { state = {status: 'ready', ...(await readAll(workspaceId, rt))}; }
    catch (e) { state = {status: missingTable(e) ? 'preparing' : 'error', stages: [], histories: new Map(), message: e?.message || ''}; }
    if (ownerOf(rt) === owner) { cache = {owner, workspace: workspaceId, state}; notify(); }
    return state;
  })().finally(() => { if (flight?.promise === promise) flight = null; });
  flight = {key: owner + workspaceId, promise};
  return promise;
}

// 이력 한 줄 저장. 같은 단계를 다시 저장하면 날짜만 고친 것: 새 줄을 먼저 넣고 같은 단계의 지금 줄을 지운다(고치기 권한이 없어서).
export async function saveOrgStage({rt = window.KPTURuntime, workspaceId, orgId, stage, date, history = []}) {
  if (!stage?.id || !orgId || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('단계와 날짜를 확인해 주세요.');
  const last = latestRow(history);
  if (last && last.stage_id === stage.id && last.stage_date === date) return false;
  await rt.api('/rest/v1/app_suborganization_dispute_stages', {method: 'POST', body: {organization_id: orgId, stage_id: stage.id, stage_name: stage.name, stage_date: date}, prefer: 'return=minimal'});
  if (last && last.stage_id === stage.id) {
    await rt.api(`/rest/v1/app_suborganization_dispute_stages?id=eq.${enc(last.id)}`, {method: 'DELETE'}).catch(() => { /* 같은 단계 줄이 둘 남을 뿐이라 다음 읽기에서 맞춰 보인다 */ });
  }
  await loadDisputeState({rt, workspaceId, force: true});
  return true;
}

const reload = (rt, workspaceId) => loadDisputeState({rt, workspaceId, force: true});

export async function addStage({rt = window.KPTURuntime, workspaceId, name, stages}) {
  const problem = stageNameProblem(name, stages);
  if (problem) throw new Error(problem);
  const order = Math.max(0, ...stages.map(s => Number(s.sort_order) || 0)) + 1;
  await rt.api('/rest/v1/app_dispute_stages', {method: 'POST', body: {workspace_id: workspaceId, name: name.trim(), sort_order: order, is_struggle: false, is_ending: false}, prefer: 'return=minimal'});
  return reload(rt, workspaceId);
}
async function patchStage(rt, workspaceId, id, body) {
  await rt.api(`/rest/v1/app_dispute_stages?id=eq.${enc(id)}&workspace_id=eq.${enc(workspaceId)}`, {method: 'PATCH', body: {...body, updated_at: new Date().toISOString()}, prefer: 'return=minimal'});
}
export async function renameStage({rt = window.KPTURuntime, workspaceId, id, name, stages}) {
  const problem = stageNameProblem(name, stages, id);
  if (problem) throw new Error(problem);
  await patchStage(rt, workspaceId, id, {name: name.trim()});
  return reload(rt, workspaceId);
}
// 투쟁 중·끝남 켬/끔. 한 단계에 둘을 같이 켜지 못하므로 하나를 켜면 다른 하나는 같은 저장에서 끈다.
export async function setStageFlag({rt = window.KPTURuntime, workspaceId, id, flag, on}) {
  const body = flag === 'struggle' ? {is_struggle: !!on, ...(on ? {is_ending: false} : {})} : {is_ending: !!on, ...(on ? {is_struggle: false} : {})};
  await patchStage(rt, workspaceId, id, body);
  return reload(rt, workspaceId);
}
export async function reorderStages({rt = window.KPTURuntime, workspaceId, changes}) {
  try { for (const change of changes) await patchStage(rt, workspaceId, change.id, {sort_order: change.sort_order}); }
  finally { await reload(rt, workspaceId); }
}
// 지우기: 결과 {ok:true,moved} 또는 {ok:false,error,organization_ids?}. 조직이 있는데 확인 없으면 ORGS_AT_STAGE.
export async function deleteStage({rt = window.KPTURuntime, workspaceId, id, move = false}) {
  const result = await rt.api('/rest/v1/rpc/app_dispute_stage_delete', {method: 'POST', body: {p_stage_id: id, p_move_organizations: !!move}});
  await reload(rt, workspaceId);
  return result;
}
