(()=>{
'use strict';
const rt=window.KPTURuntime;if(!rt)return;
let spaces=[];
const api=(p,o={})=>rt.api(p,o);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]||c));
function render(){
  const sel=document.querySelector('#taskProject');
  if(!sel)return;
  const previous=sel.value;
  const children=spaces.filter(s=>s.status!=='archived'&&s.parent_id);
  sel.innerHTML='<option value="">프로젝트 없음</option>'+children.map(s=>`<option value="${esc(s.id)}">${esc(s.name||'이름 없는 프로젝트')}</option>`).join('');
  if(children.some(s=>s.id===previous))sel.value=previous;
}
async function refresh(){
  if(!(await rt.session.ensure()))return;
  const u=await api('/auth/v1/user');
  const ms=await api(`/rest/v1/app_workspace_members?user_id=eq.${encodeURIComponent(u.id)}&select=workspace_id&limit=1`);
  if(!ms?.length)return;
  spaces=await api(`/rest/v1/app_spaces?workspace_id=eq.${encodeURIComponent(ms[0].workspace_id)}&select=id,name,parent_id,status&order=sort_order.asc,created_at.asc`);
  spaces=spaces||[];
  render();
}
async function boot(){
  await refresh();
  document.addEventListener('click',e=>{
    if(!e.target.closest?.('#newTaskBtn,#quickTaskBtn'))return;
    render();
    refresh().catch(err=>console.warn('task project options refresh',err));
  },true);
  window.addEventListener('kptu:projects-changed',()=>refresh().catch(err=>console.warn('task project options refresh',err)));
  window.addEventListener('kptu:session-changed',e=>{if(e.detail?.session)refresh().catch(err=>console.warn('task project options refresh',err));else{spaces=[];render()}});
}
window.__KPTU_TASK_CHILD_GUARD_READY__=boot().catch(err=>{console.warn('task child-project guard',err)});
})();
