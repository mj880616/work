const PA_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const PA_KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const PA_SESSION='kptu_collab_session_v1';
let paOrganizations=new Map();
let paApplying=false;

function paSession(){try{return JSON.parse(localStorage.getItem(PA_SESSION)||'null')}catch{return null}}
function paEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function paApi(path){const s=paSession();if(!s?.access_token)return null;const r=await fetch(PA_SB+path,{headers:{apikey:PA_KEY,Authorization:'Bearer '+s.access_token},cache:'no-store'});if(!r.ok)return null;return r.json()}

function paOrgIdFromInput(input){
  if(!input)return null;
  for(const [key,value] of Object.entries(input.dataset||{})){
    if(key.toLowerCase().endsWith('org')&&value)return value;
  }
  return null;
}

function paApply(){
  if(paApplying||!paOrganizations.size)return;
  paApplying=true;
  try{
    document.querySelectorAll('[data-so-org]').forEach(card=>{
      const planned=paOrganizations.get(card.dataset.soOrg);
      if(!planned)return;
      const chips=card.querySelector('.so-assignee-chips');
      if(!chips)return;
      const unassigned=[...chips.querySelectorAll('.updated')].some(x=>x.textContent.includes('담당자 미지정'));
      if(unassigned){
        chips.innerHTML=`<span class="so-chip">${paEsc(planned)}</span><span class="updated">계정 연결 전</span>`;
      }
    });

    document.querySelectorAll('.so-org-check').forEach(label=>{
      const input=label.querySelector('input');
      const id=paOrgIdFromInput(input);
      const planned=id?paOrganizations.get(id):null;
      if(!planned)return;
      const span=label.querySelector('span');
      if(!span||span.querySelector('small'))return;
      span.insertAdjacentHTML('beforeend',`<small> · 담당 ${paEsc(planned)} (계정 연결 전)</small>`);
    });
  }finally{paApplying=false}
}

async function paLoad(){
  const s=paSession();if(!s?.access_token)return;
  const ur=await fetch(PA_SB+'/auth/v1/user',{headers:{apikey:PA_KEY,Authorization:'Bearer '+s.access_token},cache:'no-store'});
  if(!ur.ok)return;
  const user=await ur.json();
  const memberships=await paApi('/rest/v1/app_workspace_members?user_id=eq.'+user.id+'&select=workspace_id&limit=1');
  const workspaceId=memberships?.[0]?.workspace_id;if(!workspaceId)return;
  const rows=await paApi('/rest/v1/app_suborganizations?workspace_id=eq.'+workspaceId+'&active=eq.true&select=id,default_assignee_name');
  paOrganizations=new Map((rows||[]).filter(x=>x.default_assignee_name).map(x=>[x.id,String(x.default_assignee_name).trim()]));
  paApply();
}

const paObserver=new MutationObserver(()=>paApply());
paObserver.observe(document.documentElement,{childList:true,subtree:true});
document.addEventListener('click',e=>{if(e.target.closest('[data-view="team"]'))setTimeout(paApply,80)},true);
setTimeout(paLoad,0);
