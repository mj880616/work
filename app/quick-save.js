import {seoulDateKey} from './meeting-time.js';
import {announceRecordSaved, projectUpdateDetail, orgUpdateDetail} from './record-saved.js';
// Existing authenticated runtime remains responsible for session, RLS and save events.
export function createGoogleTask({title,due=null,links=[],notes='',expectedSessionEpoch=null}, rt=window.KPTURuntime) {
  return rt.api('/functions/v1/google-tasks?action=create', {method:'POST',...(expectedSessionEpoch==null?{}:{expectedSessionEpoch}),body:{action:'create',task_id:null,title,notes,due,links}});
}
// ED③ 기록: doc (optional) is the new editor's saved form, written with the letters in the same insert (설계 3.1·11.3).
// MTG-기록겹침거르기: 저장된 행(id)을 돌려받아(return=representation) 저장이 끝난 뒤 겹침 확인에 알린다. 알림은 저장 결과를 바꾸지 않는다.
// ORG-기록하나로 O-4(설계 record-one.md 2-2): 어디서 넣었나(source_kind user·update·feed·memorable)와 원래 줄 번호(source_id)를 함께 남긴다.
// user는 원래 줄이 없다(DB 검사: user·null ↔ source_id null). 안 주면 칸을 보내지 않는다(null = 직접 쓰기로 봄). 기록 날짜(occurred_at)·기간 끝 날(end_day)은 주면 넣고, 안 주면 서버 기본값(지금).
export async function saveOrganizationUpdate({organization_id,raw_text,created_by,doc=null,occurred_at=null,end_day=null,source_kind=null,source_id=null}, rt=window.KPTURuntime) {
  const kind=['update','feed','memorable'].includes(source_kind)&&source_id?source_kind:source_kind==='user'?'user':null;
  const body={organization_id,raw_text,created_by,...(doc?{doc}:{}),...(occurred_at?{occurred_at}:{}),...(end_day?{end_day}:{}),...(kind?{source_kind:kind}:{}),...(kind&&kind!=='user'?{source_id}:{})};
  let rows;
  // 같은 원래 줄을 같은 조직에 두 번 넣으면 DB 고유 색인이 거절한다(409) — 이미 들어간 것이므로 저장된 것으로 본다.
  try{rows=await rt.api('/rest/v1/app_suborganization_updates', {method:'POST',prefer:'return=representation',body});}
  catch(e){if(kind&&kind!=='user'&&e?.status===409)return [];throw e;}
  announceRecordSaved(orgUpdateDetail(rows,{organization_id,raw_text}));
  return rows;
}
// 일정 만들기에서 프로젝트를 고른 경우: 프로젝트 화면의 주요 일정과 같은 표·같은 행 모양으로 저장.
// 같은 google_event_id가 이미 있으면 새로 만들지 않아 재시도·연타에도 한 번만 생긴다.
export async function saveProjectMilestone({id,project_id,title,start_at,notes=null,google_calendar_id,google_event_id,created_by,expectedSessionEpoch=null}, rt=window.KPTURuntime) {
  if(!project_id||!google_calendar_id||!google_event_id)throw new Error('사업영역 연결 정보가 부족합니다.');
  const epoch=expectedSessionEpoch==null?{}:{expectedSessionEpoch};
  const rows=await rt.api('/rest/v1/app_project_milestones?project_id=eq.'+encodeURIComponent(project_id)+'&select=id,google_event_id', {singleFlight:false,...epoch});
  if(!Array.isArray(rows))throw new Error('주요 일정 목록을 확인하지 못했습니다.');
  const found=rows.find(x=>x.google_event_id===google_event_id);
  if(found)return {id:found.id,existing:true};
  const body={id,project_id,workstream_id:null,title,milestone_type:'action',status:'planned',start_at,end_at:null,notes,event_id:null,child_project_id:null,sort_order:(rows.length+1)*10,created_by,google_calendar_id,google_event_id};
  await rt.api('/rest/v1/app_project_milestones', {method:'POST',body,prefer:'return=representation',...epoch});
  return {id,existing:false};
}
// CAL-일정사업영역: 일정의 사업영역은 따로 저장하지 않고 위와 같은 '사업영역 주요 일정' 행(같은 google_event_id, 사업영역마다 한 행)이다.
// 일정 창은 열 때 이 행들을 읽어 고른 사업영역으로 보이고(eventAreaRows), 저장 때 고른 것과 맞춘다(syncEventAreas).
export async function eventAreaRows(google_event_id, rt=window.KPTURuntime, {expectedSessionEpoch=null}={}) {
  if(!google_event_id)return [];
  const rows=await rt.api('/rest/v1/app_project_milestones?google_event_id=eq.'+encodeURIComponent(google_event_id)+'&select=id,project_id', {singleFlight:false,...(expectedSessionEpoch==null?{}:{expectedSessionEpoch})});
  if(!Array.isArray(rows))throw new Error('사업영역 연결을 확인하지 못했습니다.');
  return rows.filter(r=>r?.id&&r?.project_id).map(r=>({id:String(r.id),project_id:String(r.project_id)}));
}
// had: the rows read on open (kept up to date here, so a retry after a half-done save only does what is left).
// next: every project id that should stay linked (chosen ones plus ones the window did not offer, e.g. an archived area).
// A newly chosen area gets a milestone row (saveProjectMilestone, never twice); an area taken off loses its row only (the Google event stays).
export async function syncEventAreas({had,next,title,start_at,notes=null,google_calendar_id,google_event_id,created_by,expectedSessionEpoch=null}, rt=window.KPTURuntime) {
  const want=new Set([...(next||[])].map(String)),have=new Set(had.map(r=>r.project_id)),epoch=expectedSessionEpoch==null?{}:{expectedSessionEpoch};
  for(const project_id of want){
    if(have.has(project_id))continue;
    const r=await saveProjectMilestone({id:crypto.randomUUID(),project_id,title,start_at,notes,google_calendar_id,google_event_id,created_by,expectedSessionEpoch},rt);
    had.push({id:String(r.id),project_id});have.add(project_id);
  }
  const drop=had.filter(r=>!want.has(r.project_id));
  if(drop.length){
    await rt.api('/rest/v1/app_project_milestones?google_event_id=eq.'+encodeURIComponent(google_event_id)+'&id=in.('+drop.map(r=>encodeURIComponent(r.id)).join(',')+')', {method:'DELETE',...epoch});
    for(const r of drop)had.splice(had.indexOf(r),1);
  }
  return had;
}
// UI-홈업데이트선택: same table and row shape as the project screen's progress input (project-system-v3.js saveRecordInput).
// ED③ 기록: doc (optional) is the new editor's saved form, kept with the letters (summary) in the same insert.
export async function saveProjectProgress({project_id,raw_text,created_by,doc=null}, rt=window.KPTURuntime) {
  const body={project_id,workstream_id:null,author_id:created_by,status_label:null,summary:raw_text,next_step:null,effective_on:seoulDateKey(),metadata:{},...(doc?{doc}:{})};
  const rows=await rt.api('/rest/v1/app_project_progress_updates', {method:'POST',prefer:'return=representation',body});
  announceRecordSaved(projectUpdateDetail(rows,{project_id,summary:raw_text,effective_on:body.effective_on}));
  return rows;
}
