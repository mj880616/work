const TAV_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const TAV_KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const TAV_SESSION='kptu_collab_session_v1';
let tavUser=null,tavRows=[],tavHidden=new Set(),tavBusy=false,tavTimer=null;
function tavSession(){try{return JSON.parse(localStorage.getItem(TAV_SESSION)||'null')}catch{return null}}
async function tavApi(path){const s=tavSession();if(!s?.access_token)return[];const r=await fetch(TAV_SB+path,{headers:{apikey:TAV_KEY,Authorization:'Bearer '+s.access_token},cache:'no-store'});if(!r.ok)return[];return r.json()}
function tavApply(){
  document.querySelectorAll('[data-tl-task-row]').forEach(row=>row.style.display=tavHidden.has(row.dataset.tlTaskRow)?'none':'');
  document.querySelectorAll('[data-pt-task-row]').forEach(row=>row.style.display=tavHidden.has(row.dataset.ptTaskRow)?'none':'');
  const secs=[...document.querySelectorAll('#tlTaskSections .tl-task-section')];
  if(secs.length>=2){const accepted=tavRows.filter(t=>t.assignment_status==='accepted'),mine=accepted.filter(t=>(t.source_type||'manual')==='manual'&&t.created_by===tavUser),assigned=accepted.filter(t=>!((t.source_type||'manual')==='manual'&&t.created_by===tavUser));const a=secs[0].querySelector('.tl-section-head span'),b=secs[1].querySelector('.tl-section-head span');if(a)a.textContent=mine.filter(t=>t.status!=='done').length+'건';if(b)b.textContent=assigned.filter(t=>t.status!=='done').length+'건'}
  const projectList=document.querySelector('#projectTaskList');if(projectList){const visible=[...projectList.querySelectorAll('[data-pt-task-row]')].filter(x=>x.style.display!=='none');const count=document.querySelector('#projectTaskCount');if(count)count.textContent=`미완료 ${visible.filter(x=>!x.classList.contains('done')).length}건 · 전체 ${visible.length}건`}
}
async function tavRefresh(){if(tavBusy)return;tavBusy=true;try{const s=tavSession();if(!s?.access_token)return;if(!tavUser){const r=await fetch(TAV_SB+'/auth/v1/user',{headers:{apikey:TAV_KEY,Authorization:'Bearer '+s.access_token},cache:'no-store'});if(!r.ok)return;tavUser=(await r.json()).id}tavRows=await tavApi('/rest/v1/app_tasks?assignee_id=eq.'+tavUser+'&select=id,status,source_type,created_by,assignment_status');tavHidden=new Set(tavRows.filter(x=>x.assignment_status!=='accepted').map(x=>x.id));tavApply()}finally{tavBusy=false}}
function tavSchedule(){clearTimeout(tavTimer);tavTimer=setTimeout(tavRefresh,80)}
setTimeout(async()=>{await tavRefresh();const root=document.querySelector('#tasksView');if(root)new MutationObserver(tavSchedule).observe(root,{childList:true,subtree:true});const pm=document.querySelector('#projectModal');if(pm)new MutationObserver(tavSchedule).observe(pm,{childList:true,subtree:true});window.addEventListener('kptu:tasks-changed',tavSchedule);window.addEventListener('focus',tavSchedule)},0);