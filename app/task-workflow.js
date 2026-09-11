const TW_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const TW_KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const TW_SESSION='kptu_collab_session_v1';
let twSession=null,twUser=null,twWorkspace=null,twMembers=[],twProfiles=[];

function twReadSession(){try{return JSON.parse(localStorage.getItem(TW_SESSION)||'null')}catch{return null}}
async function twRefresh(){
  if(!twSession?.refresh_token)return false;
  const r=await fetch(TW_SB+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:TW_KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:twSession.refresh_token})});
  if(!r.ok)return false;
  const d=await r.json();d.expires_at=d.expires_at||Math.floor(Date.now()/1000)+(d.expires_in||3600);twSession=d;localStorage.setItem(TW_SESSION,JSON.stringify(d));return true;
}
async function twEnsure(){twSession=twReadSession();if(!twSession)return false;if((twSession.expires_at||0)<Math.floor(Date.now()/1000)+60)return twRefresh();return true}
async function twApi(path,{method='GET',body=null,prefer=''}={}){
  if(!(await twEnsure()))throw new Error('로그인이 필요합니다.');
  const h={apikey:TW_KEY,Authorization:'Bearer '+twSession.access_token,'Content-Type':'application/json'};if(prefer)h.Prefer=prefer;
  const r=await fetch(TW_SB+path,{method,headers:h,body:body===null?null:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||d?.error_description||d?.hint||('요청 실패 '+r.status));return d;
}
function twName(id){const p=twProfiles.find(x=>x.user_id===id),m=twMembers.find(x=>x.user_id===id);return p?.display_name||m?.email||'팀원'}
function twMemberOptions(){return '<option value="">담당자 선택</option>'+twMembers.map(m=>`<option value="${m.user_id}">${String(twName(m.user_id)).replace(/[&<>"']/g,'')}</option>`).join('')}

async function twLoadContext(){
  if(!(await twEnsure()))return false;
  const ur=await fetch(TW_SB+'/auth/v1/user',{headers:{apikey:TW_KEY,Authorization:'Bearer '+twSession.access_token}});if(!ur.ok)return false;twUser=await ur.json();
  const ms=await twApi('/rest/v1/app_workspace_members?user_id=eq.'+twUser.id+'&select=workspace_id,user_id,role,email&limit=1');if(!ms?.length)return false;
  twWorkspace=ms[0].workspace_id;
  [twMembers,twProfiles]=await Promise.all([
    twApi('/rest/v1/app_workspace_members?workspace_id=eq.'+twWorkspace+'&select=workspace_id,user_id,role,email'),
    twApi('/rest/v1/app_profiles?select=user_id,display_name')
  ]);
  return true;
}

function twLockPersonalTask(){
  if(!twUser)return;
  const sel=document.querySelector('#taskAssignee');if(!sel)return;
  sel.innerHTML=`<option value="${twUser.id}" selected>${twName(twUser.id)} (본인)</option>`;sel.value=twUser.id;sel.disabled=true;
  const lab=sel.closest('label');if(lab&&lab.firstChild?.nodeType===3)lab.firstChild.nodeValue='담당자 (본인만 가능)';
  let note=document.querySelector('#personalTaskNote');if(!note){note=document.createElement('div');note.id='personalTaskNote';note.className='task-workflow-note';note.textContent='+ 할 일로 추가하는 업무는 내 할 일로만 등록됩니다.';sel.closest('.two-col')?.insertAdjacentElement('beforebegin',note)}
}

function twActionRow(){
  const row=document.createElement('div');row.className='meeting-action-row';
  row.innerHTML=`<input class="meeting-action-title" type="text" placeholder="역할·후속 할 일"><select class="meeting-action-assignee">${twMemberOptions()}</select><input class="meeting-action-due" type="date"><button class="meeting-action-remove" type="button">삭제</button>`;
  row.querySelector('.meeting-action-remove').onclick=()=>row.remove();return row;
}
function twResetMeetingActions(){const list=document.querySelector('#meetingActionList');if(!list)return;list.innerHTML='';list.appendChild(twActionRow())}
function twEnhanceMeeting(){
  const box=document.querySelector('#meetingModal .action-box');if(!box||document.querySelector('#meetingActionList'))return;
  box.innerHTML='<div class="meeting-action-head"><div><b>역할분담 · 후속 할 일</b><p>회의결과에서 팀원별 업무를 배정하면 각자의 할 일에 자동 등록됩니다.</p></div><button id="addMeetingAction" class="secondary" type="button">+ 역할 추가</button></div><div id="meetingActionList"></div>';
  document.querySelector('#addMeetingAction').onclick=()=>document.querySelector('#meetingActionList')?.appendChild(twActionRow());twResetMeetingActions();
}
async function twSaveMeeting(){
  const title=document.querySelector('#meetingTitle')?.value.trim();const status=document.querySelector('#meetingStatus');
  const set=(m,err=false)=>{if(status){status.textContent=m;status.className='status'+(err?' error':'')}};
  if(!title)return set('회의명을 입력해 주세요.',true);
  set('저장 중…');
  try{
    const project=document.querySelector('#meetingProject')?.value||null;
    const rows=await twApi('/rest/v1/app_meetings',{method:'POST',prefer:'return=representation',body:{workspace_id:twWorkspace,project_id:project,title,meeting_at:document.querySelector('#meetingAt')?.value?new Date(document.querySelector('#meetingAt').value).toISOString():new Date().toISOString(),notes:document.querySelector('#meetingNotes')?.value||'',decisions:document.querySelector('#meetingDecisions')?.value||'',created_by:twUser.id}});
    const meeting=rows?.[0];
    const assignments=[...document.querySelectorAll('.meeting-action-row')].map(r=>({title:r.querySelector('.meeting-action-title')?.value.trim(),assignee:r.querySelector('.meeting-action-assignee')?.value,due:r.querySelector('.meeting-action-due')?.value})).filter(x=>x.title&&x.assignee);
    if(assignments.length){
      await twApi('/rest/v1/app_tasks',{method:'POST',body:assignments.map(a=>({workspace_id:twWorkspace,project_id:project,title:a.title,description:'회의 역할분담 · '+title,assignee_id:a.assignee,status:'todo',priority:'normal',due_at:a.due?new Date(a.due+'T18:00:00').toISOString():null,source_type:'meeting',source_id:meeting.id,created_by:twUser.id}))});
    }
    set('저장했습니다.');setTimeout(()=>location.reload(),250);
  }catch(e){set(e.message||String(e),true)}
}

let twOriginTimer=null;
async function twAnnotateTaskOrigins(){
  clearTimeout(twOriginTimer);twOriginTimer=setTimeout(async()=>{
    if(!twWorkspace||!twUser)return;
    try{
      const rows=await twApi('/rest/v1/app_tasks?workspace_id=eq.'+twWorkspace+'&select=id,source_type,source_id,created_by,assignee_id');const byId=new Map(rows.map(x=>[x.id,x]));
      document.querySelectorAll('#taskList article.item-card').forEach(card=>{
        const id=card.querySelector('[data-task-toggle]')?.dataset.taskToggle,t=byId.get(id);if(!t)return;
        card.querySelector('.task-origin-badge')?.remove();
        const badges=card.querySelector('.badges');if(!badges)return;
        const b=document.createElement('span');b.className='badge task-origin-badge';
        if(t.assignee_id===twUser.id&&t.source_type==='manual'&&t.created_by===twUser.id)b.textContent='내가 추가';
        else if(t.assignee_id===twUser.id&&t.source_type==='meeting')b.textContent='팀에서 부여 · 회의';
        else if(t.assignee_id===twUser.id)b.textContent='팀에서 부여';
        else if(t.source_type==='meeting')b.textContent='회의 역할분담';
        else b.textContent='개인 할 일';
        badges.appendChild(b);
      });
    }catch(_){ }
  },80)
}

function twInstallStyles(){const s=document.createElement('style');s.textContent='.task-workflow-note{padding:9px 11px;margin:0 0 10px;border-radius:10px;background:#f3f6f8;color:#657383;font-size:12px}.meeting-action-head{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;margin-bottom:10px}.meeting-action-head p{margin:4px 0 0;color:#74808c;font-size:12px;line-height:1.45}.meeting-action-row{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(120px,1fr) 132px auto;gap:8px;margin:8px 0}.meeting-action-row input,.meeting-action-row select{min-width:0}.meeting-action-remove{border:0;background:#f1f3f5;border-radius:9px;padding:0 10px;font-weight:700;color:#68727d}@media(max-width:700px){.meeting-action-row{grid-template-columns:1fr 1fr}.meeting-action-title{grid-column:1/-1}.meeting-action-remove{min-height:42px}}.task-origin-badge{background:#eef4ff!important;color:#315b91!important}';document.head.appendChild(s)}

async function twInit(){
  if(!(await twLoadContext()))return;twInstallStyles();twEnhanceMeeting();twLockPersonalTask();
  const saveMeeting=document.querySelector('#saveMeetingBtn');if(saveMeeting)saveMeeting.onclick=twSaveMeeting;
  document.addEventListener('click',e=>{const b=e.target.closest('#quickTaskBtn,#newTaskBtn');if(b)setTimeout(twLockPersonalTask,0);const m=e.target.closest('#newMeetingBtn');if(m)setTimeout(()=>{twEnhanceMeeting();twResetMeetingActions()},0)},true);
  const taskModal=document.querySelector('#taskModal');if(taskModal)new MutationObserver(()=>{if(!taskModal.classList.contains('hidden'))setTimeout(twLockPersonalTask,0)}).observe(taskModal,{attributes:true,attributeFilter:['class']});
  const meetingModal=document.querySelector('#meetingModal');if(meetingModal)new MutationObserver(()=>{if(!meetingModal.classList.contains('hidden'))setTimeout(()=>{twEnhanceMeeting();twResetMeetingActions()},0)}).observe(meetingModal,{attributes:true,attributeFilter:['class']});
  const taskList=document.querySelector('#taskList');if(taskList){new MutationObserver(twAnnotateTaskOrigins).observe(taskList,{childList:true,subtree:true});twAnnotateTaskOrigins()}
}
setTimeout(twInit,0);
