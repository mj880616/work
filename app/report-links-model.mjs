// MTG-사업보고 6단계: 사업 보고 ↔ 프로젝트·담당조직 연결의 순수 규칙(DOM·네트워크 없음, 단위 시험 대상).
// 연결은 한 곳에 모은다: 연결 표(app_record_links)의 '출처 회의' 줄(source_meeting_id, DB-2 20261023023500)이 원본이고,
// 옛 app_meetings.project_id(첫 프로젝트)는 DB-2 적용 전·후 모두 함께 읽는다. 그래서 사업 보고 쪽에서 연결하든 프로젝트·조직 쪽에서
// 연결하든 같은 줄을 읽고 쓰므로 양쪽에 똑같이 보인다. 이 모듈은 줄을 합치고 이름을 만드는 일만 한다.
import {reportKindOf,reportKindLabel} from './report-kinds.mjs';

export const TARGET_LIMIT=20; // app_meeting_set_links 는 0~20곳
export const KIND_PROJECT='project';
export const KIND_ORGANIZATION='organization';
const KINDS=new Set([KIND_PROJECT,KIND_ORGANIZATION]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const targetKey=t=>`${t.kind}:${t.id}`;
export const sameTarget=(a,b)=>!!a&&!!b&&a.kind===b.kind&&a.id===b.id;
export const cleanTarget=t=>t&&KINDS.has(t.kind)&&typeof t.id==='string'&&t.id?{kind:t.kind,id:t.id}:null;
// 같은 곳은 한 번만, 순서는 처음 나온 대로.
export function targetList(items){
  const out=[];
  for(const item of Array.isArray(items)?items:[]){const t=cleanTarget(item);if(t&&!out.some(x=>sameTarget(x,t)))out.push(t)}
  return out;
}
// 연결 줄(app_record_links, 출처 회의)들 → 고른 곳 목록. summary 가 있으면 '보낸 기록'이 달린 줄이다(해제 전에 먼저 묻는다).
export function targetsFromLinkRows(rows){
  const out=[];
  for(const row of Array.isArray(rows)?rows:[]){
    const t=row?.project_id?{kind:KIND_PROJECT,id:row.project_id}:row?.organization_id?{kind:KIND_ORGANIZATION,id:row.organization_id}:null;
    if(!t||out.some(x=>sameTarget(x,t)))continue;
    const summary=typeof row.summary==='string'&&row.summary.trim()!==''?row.summary:null;
    out.push({...t,linkId:row.id??null,hasSummary:!!summary,summary});
  }
  return out;
}
// 고른 곳에 한 곳을 더한다/뺀다. 한도(20곳)를 넘으면 null.
export function withTarget(targets,target){
  const list=targetList(targets),t=cleanTarget(target);
  if(!t||list.some(x=>sameTarget(x,t)))return list;
  return list.length>=TARGET_LIMIT?null:[...list,t];
}
export const withoutTarget=(targets,target)=>targetList(targets).filter(x=>!sameTarget(x,target));
// app_meeting_set_links 의 p_targets. 요약은 summaries(곳 → 글)에 글이 있는 곳만 보낸다.
// 요약 없이 보내면 그 곳의 기존 요약을 지킨다(DB 규칙) — 빈 칸은 '지금 요약 그대로'(새 곳이면 요약 없음 = 사업 보고 본문).
// UPD-요약부품통일 ①: 요약 칸에 쓴 글(또는 [AI 요약])이 연결 줄의 summary 가 되고, 조직·프로젝트 기록 줄과 주간보고가 그것을 먼저 쓴다.
export const SUMMARY_LIMIT=2000;
export function rpcTargets(targets,summaries=null){
  const list=targetList(targets);
  if(list.length>TARGET_LIMIT)throw new RangeError(`한 번에 ${TARGET_LIMIT}곳까지 연결할 수 있어요.`);
  return list.map(t=>{
    const text=summaries instanceof Map?summaries.get(targetKey(t)):null;
    const clean=typeof text==='string'?text.trim():'';
    if(clean&&[...clean].length>SUMMARY_LIMIT)throw new RangeError(`요약은 ${SUMMARY_LIMIT.toLocaleString('ko-KR')}자까지 쓸 수 있어요.`);
    return clean?{kind:t.kind,target_id:t.id,summary:clean}:{kind:t.kind,target_id:t.id};
  });
}
// 저장할 것이 있는지: 곳이 바뀌었거나, 요약 칸 글이 지금 저장된 요약과 다르고 비어 있지 않을 때.
export function summariesChanged(targets,summaries,saved){
  if(!(summaries instanceof Map))return false;
  return targetList(targets).some(t=>{const v=String(summaries.get(targetKey(t))||'').trim();return !!v&&v!==String(saved?.get?.(targetKey(t))||'').trim()});
}
export const firstProjectId=targets=>targetList(targets).find(t=>t.kind===KIND_PROJECT)?.id||null;
export const validId=value=>typeof value==='string'&&UUID.test(value);

export const SET_LINKS_ERROR=Object.freeze({
  INVALID_INPUT:'연결 정보를 확인해 주세요.',
  INVALID_TARGETS:'연결할 곳을 확인해 주세요. 한 번에 20곳까지 고를 수 있어요.',
  MEETING_MISSING:'사업 보고를 찾을 수 없어요. 이미 지워졌을 수 있어요.',
  MEETING_CHANGED:'다른 곳에서 사업 보고가 바뀌었어요. 다시 열어 확인한 뒤 연결해 주세요.',
  TARGET_MISSING:'연결할 곳을 찾을 수 없어요. 지워졌거나 고를 수 없는 곳이에요.',
  TARGET_WORKSPACE:'연결할 곳이 이 업무 공간에 없어요.',
  TARGET_UNSELECTABLE:'고를 수 없는 곳이 들어 있어요(보관된 사업영역 등).',
  PERMISSION_DENIED:'연결을 바꿀 권한이 없어요.',
  FUNCTION_UNAVAILABLE:'연결 기능이 아직 서버에 준비되지 않았어요.',
  RESULT_UNKNOWN:'연결 결과를 확인하지 못했어요. 목록을 다시 불러와 확인해 주세요.',
});
export const setLinksErrorText=code=>SET_LINKS_ERROR[code]||SET_LINKS_ERROR.RESULT_UNKNOWN;
// 함수가 서버에 없을 때(DB-2 적용 전)의 응답. PostgREST: 404 / PGRST202.
export const isMissingFunction=error=>Number(error?.status)===404||/PGRST202|Could not find the function|does not exist/i.test(String(error?.message||''));
// 칸이 서버에 없을 때(DB-2 적용 전)의 응답. PostgREST: 400 / 42703.
export const isMissingColumn=error=>/42703|PGRST204|PGRST200|column .* does not exist|Could not find .* column|Could not find a relationship|source_meeting_id|location/i.test(String(error?.message||''));

// 한 줄 표시. 이름(없으면 '이름 없음') + 차수, 종류(회의·정책 …) 꼬리표, 일자.
export const reportName=m=>String(m?.series_name||m?.title||'').trim()||'이름 없음';
export function reportTitle(m){
  const round=Number(m?.round_no);
  return `${reportName(m)}${m?.round_no!=null&&m.round_no!==''&&Number.isFinite(round)?` ${round}차`:''}`;
}
export const reportKindTag=m=>reportKindLabel(reportKindOf(m));
const time=value=>{const t=Date.parse(value);return Number.isFinite(t)?t:-Infinity};
export const byRecent=(a,b)=>time(b?.meeting_at)-time(a?.meeting_at)||time(b?.created_at)-time(a?.created_at)||String(a?.id).localeCompare(String(b?.id));
// 프로젝트·조직 화면 목록: 연결 줄로 읽은 사업 보고(report)와 옛 project_id 로 읽은 회의를 한 목록으로(같은 id 는 한 번).
// 이미 연결된 회의는 그대로 '회의' 종류로 나온다(activity_kind 기본값 meeting). 최근 순.
export function linkedReportRows(linkRows,legacyRows=[]){
  const byId=new Map();
  for(const row of Array.isArray(linkRows)?linkRows:[]){
    const m=row?.report;
    if(m?.id&&!byId.has(m.id))byId.set(m.id,{...m,linkId:row.id??null,linked:true,linkSummary:typeof row.summary==='string'&&row.summary.trim()?row.summary:null});
  }
  for(const m of Array.isArray(legacyRows)?legacyRows:[])if(m?.id&&!byId.has(m.id))byId.set(m.id,{...m,linkId:null,linked:false});
  return [...byId.values()].sort(byRecent);
}
// 사업 보고 하나의 '연결' 줄 글자: 첫 곳 이름 외 N. names: (target)=>이름.
export function targetsLabel(targets,nameOf,empty=''){
  const list=targetList(targets);if(!list.length)return empty;
  const first=nameOf(list[0])||'고른 곳';
  return list.length>1?`${first} 외 ${list.length-1}`:first;
}
// 연결 고르기 창의 목록 줄: 이미 이 곳에 연결된 보고는 빼고, 최근 순, 이름·종류로 찾기 쉽게 한 줄 글자를 만든다.
export function pickableReports(reports,linkedIds=new Set()){
  return (Array.isArray(reports)?reports:[]).filter(m=>m?.id&&!linkedIds.has(m.id)).sort(byRecent);
}
export const pickerLine=m=>`[${reportKindTag(m)}] ${reportTitle(m)}`;
