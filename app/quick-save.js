// Existing authenticated runtime remains responsible for session, RLS and save events.
export function createGoogleTask({title,due=null,links=[],notes=''}, rt=window.KPTURuntime) {
  return rt.api('/functions/v1/google-tasks?action=create', {method:'POST',body:{action:'create',task_id:null,title,notes,due,links}});
}
export function saveOrganizationUpdate({organization_id,raw_text,created_by}, rt=window.KPTURuntime) {
  return rt.api('/rest/v1/app_suborganization_updates', {method:'POST',body:{organization_id,raw_text,created_by}});
}
