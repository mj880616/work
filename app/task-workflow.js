let twUser=null,twBound=false;
const twRuntime=()=>window.KPTURuntime;
async function twApi(path,options={}){const rt=twRuntime();if(!rt?.api)throw new Error('공용 런타임을 불러오지 못했습니다.');return rt.api(path,options)}
async function twLoadContext(){try{twUser=await twApi('/auth/v1/user');return Boolean(twUser?.id)}catch{return false}}
function twActionRow(){const row=document.createElement('div');row.className='meeting-action-row';row.innerHTML=`<input class="meeting-action-title" type="text" placeholder="후속 할 일"><input class="meeting-action-due" type="date"><button class="meeting-action-remove" type="button">삭제</button>`;row.querySelector('.meeting-action-remove').onclick=()=>row.remove();return row}
function twResetMeetingActions(){const list=document.querySelector('#meetingActionList');if(!list)return;list.innerHTML='';list.appendChild(twActionRow())}
function twResetMeetingExtras(){const s=document.querySelector('#meetingSeriesName'),r=document.querySelector('#meetingRoundNo'),f=document.querySelector('#meetingFiles');if(s)s.value='';if(r)r.value='';if(f)f.value='';twResetMeetingActions()}
function twBind(){if(twBound)return;twBound=true;document.querySelector('#addMeetingAction')?.addEventListener('click',()=>document.querySelector('#meetingActionList')?.appendChild(twActionRow()));document.addEventListener('click',e=>{if(e.target.closest('#newMeetingBtn'))twResetMeetingExtras()},false)}
async function twInit(){if(!(await twLoadContext()))return false;twResetMeetingActions();twBind();return true}
window.__KPTU_TASK_WORKFLOW_MEETING_UI_ONLY__=true;
window.__KPTU_TASK_WORKFLOW_READY__=twInit().catch(err=>{console.error('task workflow init',err);return false});
