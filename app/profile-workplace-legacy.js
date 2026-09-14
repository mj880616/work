const pwlRt=window.KPTURuntime;
const pwlEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let pwlTimer=null;
async function pwlRender(){
  clearTimeout(pwlTimer);
  const box=document.querySelector('#psWorkplaceList');
  if(!box||!pwlRt||!(await pwlRt.session.ensure()))return;
  try{
    const user=await pwlRt.api('/auth/v1/user');
    const rows=await pwlRt.api(`/rest/v1/app_profile_workplaces?user_id=eq.${user.id}&organization_id=is.null&select=id,full_name,aliases,sort_order,created_at&order=sort_order.asc,created_at.asc`);
    box.querySelectorAll('[data-pwl-legacy="1"]').forEach(x=>x.remove());
    if(!rows?.length)return;
    let wrap=box.querySelector('.ps-workplace-chips');
    if(!wrap){box.innerHTML='<div class="ps-workplace-chips"></div>';wrap=box.querySelector('.ps-workplace-chips')}
    for(const row of rows){const span=document.createElement('span');span.className='ps-workplace-chip pwl-legacy-chip';span.dataset.pwlLegacy='1';span.title='기존 담당사업장 정보';span.innerHTML=pwlEsc(row.full_name||'이름 없는 사업장');wrap.appendChild(span)}
  }catch(e){console.warn('legacy workplace render skipped',e)}
}
function pwlSchedule(){clearTimeout(pwlTimer);pwlTimer=setTimeout(()=>pwlRender(),250)}
window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view==='profile')pwlSchedule()});
window.addEventListener('kptu:profile-updated',pwlSchedule);
pwlSchedule();
