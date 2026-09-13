(()=>{
  if(window.__KPTU_HOME_TASK_EXPAND__)return;
  window.__KPTU_HOME_TASK_EXPAND__=true;
  const rt=window.KPTURuntime;
  let busy=false,expanded=false;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const due=v=>v?new Date(v).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',weekday:'short'}):'기한 미정';

  async function context(){
    if(!rt?.session||!(await rt.session.ensure()))return null;
    const user=await rt.api('/auth/v1/user');
    const ms=await rt.api('/rest/v1/app_workspace_members?user_id=eq.'+encodeURIComponent(user.id)+'&select=workspace_id&limit=1');
    if(!ms?.length)return null;
    return {user,workspaceId:ms[0].workspace_id};
  }

  async function appendExtra(root,button,tasks,ctx){
    root.querySelectorAll('.hta-expanded-row').forEach(x=>x.remove());
    if(!expanded){button.dataset.open='0';button.textContent=`+ ${Math.max(0,tasks.length-6)}개 더 보기`;return}
    const projects=await rt.api('/rest/v1/app_spaces?workspace_id=eq.'+encodeURIComponent(ctx.workspaceId)+'&select=id,name');
    if(!button.isConnected||!root.isConnected)return;
    const names=new Map((projects||[]).map(x=>[x.id,x.name]));
    tasks.slice(6).forEach(task=>{
      const row=document.createElement('div');row.className='hta-task hta-expanded-row';row.dataset.htaTask=task.id;
      row.innerHTML=`<label class="hta-check" title="완료 처리"><input type="checkbox" data-hta-toggle="${esc(task.id)}"><span></span></label><div class="hta-content"><b>${esc(task.title||'제목 없음')}</b><small>${esc(names.get(task.project_id)||'일반 업무')} · ${esc(due(task.due_at))}</small></div><div class="hta-actions"><button class="mini" type="button" data-hta-edit="${esc(task.id)}">수정</button>${task.created_by===ctx.user.id?`<button class="mini hta-delete" type="button" data-hta-delete="${esc(task.id)}">삭제</button>`:''}</div>`;
      button.before(row);
    });
    button.dataset.open='1';button.textContent='접기';
  }

  async function decorate(){
    if(busy)return;
    const root=document.querySelector('#myTaskMini [data-hta-root]');
    if(!root||root.querySelector('[data-hta-expand]'))return;
    busy=true;
    try{
      const ctx=await context();if(!ctx)return;
      const tasks=await rt.api('/rest/v1/app_tasks?workspace_id=eq.'+encodeURIComponent(ctx.workspaceId)+'&assignee_id=eq.'+encodeURIComponent(ctx.user.id)+'&status=neq.done&select=id,title,project_id,due_at,created_by&order=due_at.asc.nullslast,created_at.desc');
      if((tasks||[]).length<=6){expanded=false;return}
      const extra=tasks.length-6;
      const button=document.createElement('button');
      button.type='button';button.dataset.htaExpand='1';button.className='hta-expand';button.textContent=expanded?'접기':`+ ${extra}개 더 보기`;
      button.onclick=async()=>{expanded=!expanded;await appendExtra(root,button,tasks,ctx)};
      root.appendChild(button);
      if(expanded)await appendExtra(root,button,tasks,ctx);
    }finally{busy=false}
  }

  const style=document.createElement('style');
  style.textContent='.hta-expand{border:0;background:transparent;color:var(--blue);font-size:11px;font-weight:850;padding:10px 4px 2px;text-align:left;cursor:pointer}.hta-expanded-row{animation:htaExpandIn .12s ease-out}@keyframes htaExpandIn{from{opacity:.2;transform:translateY(-2px)}to{opacity:1;transform:none}}';
  document.head.appendChild(style);
  const root=document.querySelector('#myTaskMini');
  if(root)new MutationObserver(()=>setTimeout(decorate,0)).observe(root,{childList:true,subtree:true});
  window.KPTURouter?.on?.('home',()=>setTimeout(decorate,80));
  window.addEventListener('kptu:tasks-changed',()=>setTimeout(decorate,100));
  window.addEventListener('kptu:session-changed',()=>{expanded=false;setTimeout(decorate,300)});
  setTimeout(decorate,300);
})();
