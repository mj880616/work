(()=>{
  'use strict';
  if(window.KPTUCapabilities)return;
  const rt=window.KPTURuntime;
  let context={user:null,membership:null};
  const signedIn=()=>!!rt?.session?.read?.()?.access_token;
  const userId=()=>context.user?.id||null;
  const role=()=>context.membership?.role||null;
  const canWriteWorkspace=()=>signedIn()&&!['viewer',null].includes(role());

  function setContext(next={}){context={...context,...next}}
  function can(action,resource={}){
    switch(action){
      case 'project.read': return signedIn()||resource.visibility==='public';
      case 'project.create': return canWriteWorkspace();
      case 'project.edit': return canWriteWorkspace()&&resource.can_edit!==false;
      case 'page.read': return signedIn()||(resource.status==='published'&&['public','unlisted'].includes(resource.visibility));
      case 'page.create': return canWriteWorkspace();
      case 'page.edit': return canWriteWorkspace()&&resource.can_edit!==false;
      case 'task.read':
        if(resource.project_id)return signedIn()||resource.project_public===true;
        return signedIn()&&!!userId()&&resource.assignee_id===userId();
      case 'task.edit':
        if(resource.project_id)return canWriteWorkspace()&&resource.can_edit!==false;
        return signedIn()&&!!userId()&&resource.assignee_id===userId();
      default: return signedIn();
    }
  }
  function requireCapability(action,resource={},opts={}){
    if(can(action,resource))return true;
    if(!signedIn()){
      location.href=window.KPTUAuth?.loginUrl?.(opts.returnTo||location.href)||'./login/';
      return false;
    }
    window.dispatchEvent(new CustomEvent('kptu:permission-denied',{detail:{action,resource}}));
    return false;
  }
  window.KPTUCapabilities={setContext,can,require:requireCapability,signedIn,userId,role};
})();
