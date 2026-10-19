import {seoulDateKey} from './meeting-time.js';
// Existing authenticated runtime remains responsible for session, RLS and save events.
export function createGoogleTask({title,due=null,links=[],notes='',expectedSessionEpoch=null}, rt=window.KPTURuntime) {
  return rt.api('/functions/v1/google-tasks?action=create', {method:'POST',...(expectedSessionEpoch==null?{}:{expectedSessionEpoch}),body:{action:'create',task_id:null,title,notes,due,links}});
}
export function saveOrganizationUpdate({organization_id,raw_text,created_by}, rt=window.KPTURuntime) {
  return rt.api('/rest/v1/app_suborganization_updates', {method:'POST',body:{organization_id,raw_text,created_by}});
}
// 일정 만들기에서 프로젝트를 고른 경우: 프로젝트 화면의 주요 일정과 같은 표·같은 행 모양으로 저장.
// 같은 google_event_id가 이미 있으면 새로 만들지 않아 재시도·연타에도 한 번만 생긴다.
export async function saveProjectMilestone({id,project_id,title,start_at,notes=null,google_calendar_id,google_event_id,created_by,expectedSessionEpoch=null}, rt=window.KPTURuntime) {
  if(!project_id||!google_calendar_id||!google_event_id)throw new Error('프로젝트 연결 정보가 부족합니다.');
  const epoch=expectedSessionEpoch==null?{}:{expectedSessionEpoch};
  const rows=await rt.api('/rest/v1/app_project_milestones?project_id=eq.'+encodeURIComponent(project_id)+'&select=id,google_event_id', {singleFlight:false,...epoch});
  if(!Array.isArray(rows))throw new Error('주요 일정 목록을 확인하지 못했습니다.');
  const found=rows.find(x=>x.google_event_id===google_event_id);
  if(found)return {id:found.id,existing:true};
  const body={id,project_id,workstream_id:null,title,milestone_type:'action',status:'planned',start_at,end_at:null,notes,event_id:null,child_project_id:null,sort_order:(rows.length+1)*10,created_by,google_calendar_id,google_event_id};
  await rt.api('/rest/v1/app_project_milestones', {method:'POST',body,prefer:'return=representation',...epoch});
  return {id,existing:false};
}
// UI-홈업데이트선택: same table and row shape as the project screen's progress input (project-system-v3.js saveRecordInput).
export function saveProjectProgress({project_id,raw_text,created_by}, rt=window.KPTURuntime) {
  return rt.api('/rest/v1/app_project_progress_updates', {method:'POST',body:{project_id,workstream_id:null,author_id:created_by,status_label:null,summary:raw_text,next_step:null,effective_on:seoulDateKey(),metadata:{}}});
}
