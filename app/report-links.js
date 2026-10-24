// MTG-사업보고 6단계: 사업 보고 ↔ 프로젝트·담당조직 연결 읽기/쓰기의 한 곳(규칙은 report-links-model.mjs).
// 서버: 연결 표 app_record_links 의 '출처 회의' 줄 + 저장 함수 app_meeting_set_links(INVOKER, 소유자 RLS, 전부 아니면 전무).
// DB-2(20261023023500)가 운영에 적용되기 전에도 화면이 깨지지 않게 한다: 칸·함수가 없으면 옛 방식(app_meetings.project_id 한 곳)으로
// 읽고 쓰며, 담당조직 연결은 '서버 준비 전'이라고 알린다. 새 서버 경로·권한은 만들지 않는다.
import {targetsFromLinkRows,rpcTargets,firstProjectId,targetList,isMissingFunction,isMissingColumn,linkedReportRows,setLinksErrorText,KIND_PROJECT} from './report-links-model.mjs';

const enc=encodeURIComponent;
// 공용 실행기(KPTURuntime)에 로그인 맥락이 아직 안 깔렸으면 화면이 정한 맥락(__KPTU_BOOT_CONTEXT__)을 쓴다(workplace-detail.js wdCtx와 같은 기준).
// 화면 편의일 뿐이고, 같은 업무공간·소유자 확인은 서버(RLS·함수)가 한다.
export function reportRuntime(rt=window.KPTURuntime){
  if(!rt)return rt;
  const read=()=>rt.context?.read?.()||window.__KPTU_BOOT_CONTEXT__||null;
  return {...rt,context:{...(rt.context||{}),read}};
}
const rtOf=()=>reportRuntime();
const workspaceOf=rt=>{const id=rt.context?.read?.()?.workspace?.id;if(!id)throw new Error('로그인 상태를 확인하지 못했어요.');return id};
export const REPORT_FIELDS='id,title,series_name,round_no,meeting_at,created_at,updated_at,activity_kind,project_id';
const FK='app_record_links_source_meeting_id_fkey';

// 서버에 DB-2 칸이 있는지 한 번만 확인한다(없으면 400). 로그아웃·계정 바뀜에 대비해 사용자별로 기억.
const probes=new Map();
function probe(key,path,rt=rtOf()){
  const owner=rt.context?.read?.()?.user?.id||'';const k=owner+'|'+key;
  if(!probes.has(k))probes.set(k,rt.api(path).then(()=>true,error=>{if(isMissingColumn(error)||Number(error?.status)===400)return false;probes.delete(k);throw error}));
  return probes.get(k);
}
export const resetProbes=()=>probes.clear();
// 이미 select=* 로 읽은 사업 보고 줄이 있으면 그 줄에 칸이 있는지로 답을 정해 둔다(따로 묻는 요청을 보내지 않는다). 줄이 없으면 정하지 않는다.
export function noteColumnFromRows(key,column,rows,rt=rtOf()){
  const row=Array.isArray(rows)?rows.find(r=>r&&typeof r==='object'):null;if(!row)return;
  const owner=rt.context?.read?.()?.user?.id||'';const k=owner+'|'+key;
  if(!probes.has(k))probes.set(k,Promise.resolve(Object.hasOwn(row,column)));
}
export const linksAvailable=(rt)=>probe('links','/rest/v1/app_record_links?select=source_meeting_id&limit=1',rt);
export const locationAvailable=(rt)=>probe('location','/rest/v1/app_meetings?select=location&limit=1',rt);
export const noteLocationFromMeetings=(rows,rt)=>noteColumnFromRows('location','location',rows,rt);

// 사업 보고 하나에 연결된 곳(프로젝트·조직) 목록. DB-2 전에는 옛 project_id 한 곳.
export async function readReportTargets(meeting,rt=rtOf()){
  const id=typeof meeting==='string'?meeting:meeting?.id,ws=workspaceOf(rt);
  if(await linksAvailable(rt)){
    const rows=await rt.api(`/rest/v1/app_record_links?workspace_id=eq.${enc(ws)}&source_meeting_id=eq.${enc(id)}&status=eq.confirmed&select=id,project_id,organization_id,summary&order=id.asc`);
    return targetsFromLinkRows(rows);
  }
  const pid=typeof meeting==='object'?meeting?.project_id:(await rt.api(`/rest/v1/app_meetings?id=eq.${enc(id)}&workspace_id=eq.${enc(ws)}&select=project_id&limit=1`))?.[0]?.project_id;
  return pid?[{kind:KIND_PROJECT,id:pid,linkId:null,hasSummary:false}]:[];
}
// 모든 사업 보고의 연결 한 번에(화면 목록·결과의 '연결' 줄용): {meetingId: [target…]}. DB-2 전에는 project_id 로 만든다.
export async function readAllReportTargets(meetings,rt=rtOf()){
  const map=new Map(),ws=workspaceOf(rt);
  if(await linksAvailable(rt)){
    for(let offset=0;;offset+=1000){
      const rows=await rt.api(`/rest/v1/app_record_links?workspace_id=eq.${enc(ws)}&source_meeting_id=not.is.null&status=eq.confirmed&select=id,source_meeting_id,project_id,organization_id,summary&order=id.asc&limit=1000&offset=${offset}`);
      for(const row of rows){const list=map.get(row.source_meeting_id)||[];list.push(row);map.set(row.source_meeting_id,list)}
      if(rows.length<1000)break;
    }
    return new Map([...map].map(([id,rows])=>[id,targetsFromLinkRows(rows)]));
  }
  for(const m of meetings||[])if(m?.project_id)map.set(m.id,[{kind:KIND_PROJECT,id:m.project_id,linkId:null,hasSummary:false}]);
  return map;
}
// 프로젝트·조직 화면: 이 곳에 연결된 사업 보고(모든 종류), 최근 순. 연결 줄 + 옛 project_id(프로젝트만)를 합친다.
export async function readLinkedReports(target,rt=rtOf()){
  const ws=workspaceOf(rt),col=target.kind===KIND_PROJECT?'project_id':'organization_id';
  // 연결 줄과 옛 project_id 읽기는 서로 기다리지 않는다(상세 화면 다시 읽기가 한 번 왕복으로 끝나게).
  const readLinked=(async()=>{
    try{
      if(await linksAvailable(rt))return {rows:await rt.api(`/rest/v1/app_record_links?workspace_id=eq.${enc(ws)}&source_meeting_id=not.is.null&status=eq.confirmed&${col}=eq.${enc(target.id)}&select=id,summary,report:app_meetings!${FK}(${REPORT_FIELDS})&order=id.asc`),available:true};
    }catch(error){if(!isMissingColumn(error))throw error}
    return {rows:[],available:false};
  })();
  const readLegacy=target.kind===KIND_PROJECT?rt.api(`/rest/v1/app_meetings?workspace_id=eq.${enc(ws)}&project_id=eq.${enc(target.id)}&select=${REPORT_FIELDS}&order=meeting_at.desc.nullslast,created_at.desc`):Promise.resolve([]);
  const [{rows:linked,available},legacy]=await Promise.all([readLinked,readLegacy]);
  return {rows:linkedReportRows(linked.filter(l=>l.report),legacy),available};
}
// 연결 고르기 창에 보일 모든 사업 보고(종류 무관), 최근 순 200건.
export async function readAllReports(rt=rtOf()){
  return rt.api(`/rest/v1/app_meetings?workspace_id=eq.${enc(workspaceOf(rt))}&select=${REPORT_FIELDS}&order=meeting_at.desc.nullslast,created_at.desc&limit=200`);
}
// 고른 곳으로 '그대로 맞추기'. meeting: {id, updated_at}. 반환 {ok, updated_at?, legacy?, skippedOrgs?, error?, message?}.
export async function saveReportTargets(meeting,targets,rt=rtOf(),summaries=null){
  const list=targetList(targets);
  let body;try{body=rpcTargets(list,summaries)}catch(e){return {ok:false,error:'INVALID_TARGETS',message:e.message}}
  try{
    const r=await rt.api('/rest/v1/rpc/app_meeting_set_links',{method:'POST',body:{p_meeting_id:meeting.id,p_meeting_updated_at:meeting.updated_at,p_targets:body}});
    if(r?.ok===true)return {ok:true,updated_at:r.updated_at||null,created:r.created,removed:r.removed};
    if(r?.ok===false)return {ok:false,error:r.error,message:setLinksErrorText(r.error)};
    return {ok:false,error:'RESULT_UNKNOWN',message:setLinksErrorText('RESULT_UNKNOWN')};
  }catch(error){
    if(!isMissingFunction(error))return {ok:false,error:'RESULT_UNKNOWN',message:setLinksErrorText('RESULT_UNKNOWN')};
  }
  // 서버에 함수가 아직 없다(DB-2 적용 전): 프로젝트 한 곳(옛 칸)만 저장할 수 있다. 담당조직·둘째 프로젝트는 건너뛰고 알린다.
  const first=firstProjectId(list),skipped=list.length-(first?1:0);
  try{
    const rows=await rt.api(`/rest/v1/app_meetings?id=eq.${enc(meeting.id)}&workspace_id=eq.${enc(workspaceOf(rt))}&select=id,updated_at`,{method:'PATCH',body:{project_id:first},prefer:'return=representation'});
    return {ok:true,legacy:true,skippedOrgs:skipped,updated_at:rows?.[0]?.updated_at||null};
  }catch{return {ok:false,error:'RESULT_UNKNOWN',message:setLinksErrorText('RESULT_UNKNOWN')}}
}
export const LEGACY_NOTE='담당조직과 둘째 프로젝트 연결은 서버 준비가 끝난 뒤에 저장돼요. 첫 프로젝트만 저장했어요.';

// 한 곳을 더하거나 빼기(프로젝트·조직 화면용): 지금 연결을 읽어 한 곳만 바꿔 다시 저장한다. 버전은 방금 읽은 것.
export async function changeOneTarget(meetingId,target,mode,rt=rtOf()){
  const ws=workspaceOf(rt);
  const row=(await rt.api(`/rest/v1/app_meetings?id=eq.${enc(meetingId)}&workspace_id=eq.${enc(ws)}&select=id,updated_at,project_id`))?.[0];
  if(!row)return {ok:false,error:'MEETING_MISSING',message:setLinksErrorText('MEETING_MISSING')};
  const current=await readReportTargets(row,rt);
  const same=t=>t.kind===target.kind&&t.id===target.id;
  const next=mode==='add'?(current.some(same)?current:[...current,{kind:target.kind,id:target.id}]):current.filter(t=>!same(t));
  if(next.length>20)return {ok:false,error:'INVALID_TARGETS',message:setLinksErrorText('INVALID_TARGETS')};
  const result=await saveReportTargets(row,next,rt);
  return {...result,previous:current};
}

// 5초 되돌리기: 해제 전 연결 목록으로 다시 맞춘다(그 사이 사업 보고가 바뀌었으면 최신 버전으로 읽어 다시 맞춘다).
export async function restoreTargets(meetingId,targets,rt=rtOf()){
  const row=(await rt.api(`/rest/v1/app_meetings?id=eq.${enc(meetingId)}&workspace_id=eq.${enc(workspaceOf(rt))}&select=id,updated_at`))?.[0];
  if(!row)return {ok:false,error:'MEETING_MISSING',message:setLinksErrorText('MEETING_MISSING')};
  return saveReportTargets(row,targets,rt);
}
