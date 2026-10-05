(()=>{
  'use strict';
  if(window.KPTUDriveSummary)return;
  const rt=window.KPTURuntime;
  const WAIT_MS=4000;
  const fields={
    app_suborganizations:['name','recent_month_summary'],
    app_suborganization_updates:['organization_id','raw_text','occurred_at'],
    app_spaces:['name','parent_id','status','sort_order','metadata'],
    app_project_workstreams:['project_id','phase','title','sort_order'],
    app_project_progress_updates:['project_id','workstream_id','effective_on','status_label','summary','next_step'],
    app_project_milestones:['project_id','title','start_at'],
    app_meetings:['title','series_name','meeting_at','round_no','project_id'],
    app_record_links:['project_id','google_task_id','task_completed','status'],
    app_documents:['project_id']
  };
  const stages=new Set(['METHOD_NOT_ALLOWED','SERVER_CONFIG_MISSING','UNAUTHORIZED','AUTH_UNAVAILABLE','WORKSPACE_UNAVAILABLE','FORBIDDEN','DB_READ_FAILED','DB_READ_LIMIT','DRIVE_CONFIG_MISSING','DRIVE_TOKEN_FAILED','DRIVE_DISCOVERY_FAILED','DRIVE_DUPLICATE_MARKERS','DRIVE_PERMISSION_CHECK_FAILED','DRIVE_PUBLIC_SHARING_FOUND','DRIVE_FOLDER_CREATE_FAILED','DRIVE_UPLOAD_FAILED','DRIVE_STATUS_WRITE_FAILED','SUMMARY_FAILED']);
  let timer=null,flight=null,dirty=false,manualPending=false,generation=0,result=null;
  function owner(){
    const c=rt.context.read(),s=rt.session.read();
    return !!s?.access_token&&c?.user?.id===s?.user?.id&&c?.workspace?.slug==='kptu-work'&&c?.membership?.role==='owner';
  }
  function affectsSummary(saved){
    const path=new URL(saved.path,rt.config.url),table=path.pathname.replace('/rest/v1/','');
    if(path.origin!==rt.config.url)return false;
    const relevant=fields[table];
    if(relevant){
      if(saved.method==='POST'&&['app_documents','app_record_links'].includes(table))return saved.projectLinked;
      return ['POST','DELETE'].includes(saved.method)||saved.fields.some(field=>relevant.includes(field));
    }
    if(path.pathname==='/functions/v1/google-tasks'){
      const action=saved.action||path.searchParams.get('action');
      // update/toggle/delete synchronize or remove the DB completion/link copy.
      return ['update','toggle','delete'].includes(action)||(['create','link','unlink'].includes(action)&&saved.projectLinked);
    }
    // These successful uploads/deletions change the project document count.
    return ['/functions/v1/library-files','/functions/v1/meeting-files'].includes(path.pathname)&&saved.projectLinked;
  }
  function clearTimer(){if(timer!==null)clearTimeout(timer);timer=null}
  function schedule(){
    if(!owner())return;
    dirty=true;
    if(flight)return;
    clearTimer();timer=setTimeout(()=>{timer=null;void run()},WAIT_MS);
  }
  function safeStage(value){return stages.has(value)?value:'SUMMARY_FAILED'}
  function documentUrl(value){
    try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='docs.google.com'&&/^\/document\/d\/[^/]+(?:\/|$)/.test(url.pathname)&&!url.username&&!url.password?url.href:null}catch{return null}
  }
  function render(){
    for(const button of document.querySelectorAll('[data-drive-summary-refresh]')){
      button.disabled=!!flight;button.textContent=flight?'갱신 중…':'사본 갱신';
      button.setAttribute('aria-busy',String(!!flight));
    }
    for(const status of document.querySelectorAll('[data-drive-summary-status]')){
      status.replaceChildren();
      if(!result)continue;
      if(!result.ok){
        const words=result.error.split('_');
        words.forEach((word,index)=>{status.append(document.createTextNode(word+(index<words.length-1?'_':'')));if(index<words.length-1)status.append(document.createElement('wbr'))});
        continue;
      }
      const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(result.updated_at)).map(part=>[part.type,part.value]));
      const time=document.createElement('span');time.className='drive-summary-time';time.textContent=`갱신 ${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
      const links=document.createElement('div');links.className='drive-summary-links';
      for(const [kind,label] of [['org','조직'],['project','프로젝트']]){
        if(links.childNodes.length)links.append(document.createTextNode(' · '));
        const link=document.createElement('a');link.href=result.documents[kind];link.textContent=label;link.target='_blank';link.rel='noopener noreferrer';links.append(link);
      }
      status.append(time,links);
    }
  }
  async function run(manual=false){
    if(!owner())return;
    if(flight){if(manual)manualPending=true;return flight}
    clearTimer();dirty=false;
    const epoch=generation;
    manualPending=manual;
    // Use the shared runtime's current user token, with no payload or auth side effects.
    flight=(async()=>{
      try{
        const data=await rt.api('/functions/v1/drive-summary',{method:'POST',refreshSession:false,timeoutMs:120000});
        if(epoch!==generation||!owner())return;
        const org=documentUrl(data?.documents?.org),project=documentUrl(data?.documents?.project);
        if(data?.ok&&org&&project&&Number.isFinite(Date.parse(data.updated_at)))result={ok:true,updated_at:data.updated_at,documents:{org,project}};
        else if(manualPending)result={ok:false,error:safeStage(data?.error)};
      }catch(error){
        if(epoch===generation&&owner()&&manualPending)result={ok:false,error:safeStage(error?.message)};
      }finally{
        flight=null;
        if(epoch===generation){manualPending=false;render();if(dirty&&owner())void run()}
      }
    })();
    render();return flight;
  }
  function syncMenus(){
    if(!owner()){
      clearTimer();dirty=false;manualPending=false;result=null;generation++;
      document.querySelectorAll('[data-account-drive-slot]').forEach(slot=>slot.replaceChildren());return;
    }
    for(const slot of document.querySelectorAll('[data-account-drive-slot]')){
      if(slot.childNodes.length)continue;
      const button=document.createElement('button');button.type='button';button.className='account-action';button.dataset.driveSummaryRefresh='';button.addEventListener('click',()=>void run(true));
      button.setAttribute('aria-label','Drive 사본 지금 갱신');button.title='Drive 사본 지금 갱신';
      const status=document.createElement('div');status.dataset.driveSummaryStatus='';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      slot.append(button,status);
    }
    render();
  }
  window.KPTUDriveSummary={refresh:()=>run(true),saved:schedule};
  window.addEventListener('kptu:api-saved',event=>{if(owner()&&affectsSummary(event.detail))schedule()});
  // Deletion already knows the old project; the Edge response contains no project ID.
  window.addEventListener('kptu:documents-changed',event=>{if(event.detail?.project_id)schedule()});
  window.addEventListener('kptu:team-ready',syncMenus);
  window.addEventListener('kptu:session-changed',syncMenus);
  window.addEventListener('kptu:account-ready',syncMenus);
  syncMenus();
})();
