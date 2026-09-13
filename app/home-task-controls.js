(()=>{
  'use strict';
  if(window.__KPTU_HOME_TASK_CONTROLS__)return;
  window.__KPTU_HOME_TASK_CONTROLS__=true;

  const rt=window.KPTURuntime;
  let userId='';
  let workspaceId='';
  let projects=[];
  let loading=false;
  let scheduled=null;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const projectName=id=>projects.find(x=>x.id===id)?.name||'일반 업무';
  const due=v=>v?new Date(v).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',weekday:'short'}):'기한 미정';

  async function api(path,opts={}){if(!rt?.api)throw new Error('공용 런타임을 불러오지 못했습니다.');return rt.api(path,opts)}

  async function context(){
    if(userId&&workspaceId)return true;
    if(!rt||!(await rt.session.ensure()))return false;
    const user=await api('/auth/v1/user');
    const membership=await api('/rest/v1/app_workspace_members?user_id=eq.'+encodeURIComponent(user.id)+'&select=workspace_id&limit=1');
    if(!membership?.length)return false;
    userId=user.id;workspaceId=membership[0].workspace_id;
    projects=await api('/rest/v1/app_spaces?workspace_id=eq.'+encodeURIComponent(workspaceId)+'&select=id,name');
    return true;
  }

  function row(task){
    const canDelete=task.created_by===userId;
    return `<div class="hta-task" data-hta-task="${esc(task.id)}"><label class="hta-check" title="완료 처리"><input type="checkbox" data-hta-toggle="${esc(task.id)}"><span></span></label><div class="hta-content"><b>${esc(task.title||'제목 없음')}</b><small>${esc(projectName(task.project_id))} · ${esc(due(task.due_at))}</small></div><div class="hta-actions"><button class="mini" type="button" data-hta-edit="${esc(task.id)}">수정</button>${canDelete?`<button class="mini hta-delete" type="button" data-hta-delete="${esc(task.id)}">삭제</button>`:''}</div></div>`;
  }

  async function render(){
    const root=document.querySelector('#myTaskMini');
    if(!root||loading||!(await context()))return;
    loading=true;
    try{
      const tasks=await api('/rest/v1/app_tasks?workspace_id=eq.'+encodeURIComponent(workspaceId)+'&assignee_id=eq.'+encodeURIComponent(userId)+'&status=neq.done&select=*&order=due_at.asc.nullslast,created_at.desc');
      const shown=(tasks||[]).slice(0,6);
      root.innerHTML=`<div data-hta-root>${shown.length?shown.map(row).join(''):'<div class="empty compact">미완료 업무가 없습니다.</div>'}</div>`;
    }catch(e){
      root.innerHTML=`<div data-hta-root class="status error">${esc(e.message||String(e))}</div>`;
    }finally{loading=false}
  }

  function schedule(){clearTimeout(scheduled);scheduled=setTimeout(render,80)}

  async function toggle(id,input){
    if(input)input.disabled=true;
    try{
      await api('/rest/v1/app_tasks?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{status:'done',completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}});
      window.dispatchEvent(new CustomEvent('kptu:tasks-changed',{detail:{id,action:'done'}}));
      await render();
    }catch(e){if(input){input.checked=false;input.disabled=false}alert(e.message||String(e))}
  }

  function edit(id){
    const existing=document.querySelector(`[data-tl-edit="${CSS.escape(id)}"]`);
    if(existing){existing.click();return}
    window.KPTURouter?.go?.('tasks',{source:'home-task-edit'});
    setTimeout(()=>document.querySelector(`[data-tl-edit="${CSS.escape(id)}"]`)?.click(),180);
  }

  async function remove(id){
    const rows=await api('/rest/v1/app_tasks?id=eq.'+encodeURIComponent(id)+'&select=id,title,created_by&limit=1');
    const task=rows?.[0];
    if(!task||task.created_by!==userId)return;
    if(!confirm(`“${task.title}” 할 일을 삭제할까요?`))return;
    try{
      await api('/rest/v1/app_tasks?id=eq.'+encodeURIComponent(id),{method:'DELETE'});
      window.dispatchEvent(new CustomEvent('kptu:tasks-changed',{detail:{id,action:'delete'}}));
      await render();
    }catch(e){alert(e.message||String(e))}
  }

  function style(){
    if(document.querySelector('#htaStyle'))return;
    const s=document.createElement('style');s.id='htaStyle';s.textContent=`
      #myTaskMini [data-hta-root]{display:grid}.hta-task{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;padding:8px 2px;border-bottom:1px solid #edf0f3}.hta-task:last-child{border-bottom:0}.hta-check{display:grid;place-items:center;width:25px;height:25px;cursor:pointer}.hta-check input{width:16px;height:16px;margin:0;accent-color:var(--navy)}.hta-content{min-width:0}.hta-content b{display:block;font-size:12.5px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hta-content small{display:block;margin-top:2px;color:var(--muted);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hta-actions{display:flex;gap:4px}.hta-actions .mini{padding:4px 7px;min-height:27px;font-size:10px}.hta-actions .hta-delete{color:#a33b45;border-color:#ead2d5;background:#fff}@media(max-width:700px){.hta-task{gap:6px}.hta-actions{gap:3px}.hta-actions .mini{padding:4px 6px}.hta-content small{font-size:10px}}
    `;document.head.appendChild(s);
  }

  function install(){
    style();
    const root=document.querySelector('#myTaskMini');
    if(root)new MutationObserver(()=>{if(!root.querySelector('[data-hta-root]'))schedule()}).observe(root,{childList:true,subtree:false});
    const taskSections=document.querySelector('#tlTaskSections');
    if(taskSections)new MutationObserver(schedule).observe(taskSections,{childList:true,subtree:true});
    document.addEventListener('change',e=>{const input=e.target.closest?.('[data-hta-toggle]');if(input&&input.checked)toggle(input.dataset.htaToggle,input)});
    document.addEventListener('click',e=>{const editBtn=e.target.closest?.('[data-hta-edit]');if(editBtn){edit(editBtn.dataset.htaEdit);return}const del=e.target.closest?.('[data-hta-delete]');if(del)remove(del.dataset.htaDelete)});
    window.KPTURouter?.on?.('home',schedule);
    window.addEventListener('kptu:tasks-changed',schedule);
    window.addEventListener('kptu:session-changed',()=>{userId='';workspaceId='';projects=[];schedule()});
    schedule();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
