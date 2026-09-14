const pwsRt=window.KPTURuntime;
let pwsBusy=false,pwsQueued=false;
const pwsEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function pwsRefresh(){
  if(pwsBusy){pwsQueued=true;return}
  if(!pwsRt||!(await pwsRt.session.ensure()))return;
  pwsBusy=true;
  try{
    const user=await pwsRt.api('/auth/v1/user');
    const memberships=await pwsRt.api(`/rest/v1/app_workspace_members?user_id=eq.${user.id}&select=workspace_id&limit=1`);
    const workspaceId=memberships?.[0]?.workspace_id;if(!workspaceId)return;
    const [assignments,profiles]=await Promise.all([
      pwsRt.api(`/rest/v1/app_suborganization_assignees?select=organization_id,user_id`),
      pwsRt.api(`/rest/v1/app_profiles?select=user_id,display_name`)
    ]);
    const names=new Map((profiles||[]).map(x=>[x.user_id,x.display_name||'팀원']));
    document.querySelectorAll('.so-card[data-so-org]').forEach(card=>{
      const box=card.querySelector('.so-assignee-chips');if(!box)return;
      const people=(assignments||[]).filter(x=>x.organization_id===card.dataset.soOrg);
      box.innerHTML=people.length?people.map(x=>`<span class="so-chip">${pwsEsc(names.get(x.user_id)||'팀원')}</span>`).join(''):'<span class="updated">담당자 미지정</span>';
    });
  }catch(e){console.warn('profile workplace sync skipped',e)}
  finally{
    pwsBusy=false;
    if(pwsQueued){pwsQueued=false;setTimeout(pwsRefresh,0)}
  }
}
window.__KPTU_RELOAD_SUBORGANIZATIONS__=pwsRefresh;
window.addEventListener('kptu:suborganization-updated',()=>pwsRefresh());
window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view==='team')pwsRefresh()});
