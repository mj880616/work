import {seoulDateKey} from './meeting-time.js';
// Existing authenticated runtime remains responsible for session, RLS and save events.
export function createGoogleTask({title,due=null,links=[],notes='',expectedSessionEpoch=null}, rt=window.KPTURuntime) {
  return rt.api('/functions/v1/google-tasks?action=create', {method:'POST',...(expectedSessionEpoch==null?{}:{expectedSessionEpoch}),body:{action:'create',task_id:null,title,notes,due,links}});
}
export function saveOrganizationUpdate({organization_id,raw_text,created_by}, rt=window.KPTURuntime) {
  return rt.api('/rest/v1/app_suborganization_updates', {method:'POST',body:{organization_id,raw_text,created_by}});
}
// UI-홈업데이트선택: same table and row shape as the project screen's progress input (project-system-v3.js saveRecordInput).
export function saveProjectProgress({project_id,raw_text,created_by}, rt=window.KPTURuntime) {
  return rt.api('/rest/v1/app_project_progress_updates', {method:'POST',body:{project_id,workstream_id:null,author_id:created_by,status_label:null,summary:raw_text,next_step:null,effective_on:seoulDateKey(),metadata:{}}});
}
