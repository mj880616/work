import { createGoogleTask, saveOrganizationUpdate } from './quick-save.js?v=1';
import { dayKey } from './home-read-model.js?v=1';

export function mountQuick({root, dependencies, refreshTasks, invalidateProjects, esc}) {
  const box=root.querySelector('.home-quick-placeholder');
  box.removeAttribute('aria-hidden'); box.className='home-quick'; box.dataset.homeQuick='';
  let quickOwner=window.KPTURuntime.context.read()?.user?.id;
  let mode='task',saving=false,expanded=false,project='',organization='',due='',dateKind='',choicesFlight=null,choiceEpoch=0;
  try { mode=window.localStorage.getItem('kptu-home-quick-mode')==='update'?'update':'task'; } catch {}
  box.innerHTML=`<div class="home-quick-modes" role="group" aria-label="입력 종류"><button type="button" data-quick-mode="task">할 일</button><button type="button" data-quick-mode="update">업데이트</button></div><div class="home-quick-entry"><textarea data-quick-input aria-label="빠른 입력" rows="1" placeholder="할 일을 입력하세요"></textarea><button type="button" class="home-quick-save" data-quick-save>추가</button></div><div data-quick-options hidden><div data-quick-task-options><select data-quick-project aria-label="프로젝트"><option value="">프로젝트 ▾</option></select><button type="button" data-quick-day="today">오늘</button><button type="button" data-quick-day="tomorrow">내일</button><button type="button" data-quick-day="date">날짜</button><input type="date" data-quick-date aria-label="기한 날짜" tabindex="-1"></div><div data-quick-update-options hidden><select data-quick-org aria-label="조직"><option value="">조직 ▾</option></select></div><small data-quick-destination></small></div><div data-quick-status role="status"></div>`;
  const input=box.querySelector('[data-quick-input]'),options=box.querySelector('[data-quick-options]'),status=box.querySelector('[data-quick-status]'),orgSelect=box.querySelector('[data-quick-org]'),projectSelect=box.querySelector('[data-quick-project]'),date=box.querySelector('[data-quick-date]');
  function size(){ input.style.height=''; if(mode==='update')input.style.height=Math.min(146,Math.max(83,input.scrollHeight+2))+'px'; }
  function paint(){
    box.dataset.mode=mode; input.rows=mode==='task'?1:3; input.placeholder=mode==='task'?'할 일을 입력하세요':'담당조직 기록을 입력하세요';
    box.querySelectorAll('[data-quick-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.quickMode===mode)));
    box.querySelector('[data-quick-task-options]').hidden=mode!=='task'; box.querySelector('[data-quick-update-options]').hidden=mode!=='update';
    box.querySelector('[data-quick-destination]').textContent=mode==='task'?'→ Google 할 일':'→ 담당조직 기록';
    options.hidden=!expanded;
    box.querySelectorAll('[data-quick-day]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.quickDay===dateKind));if(b.dataset.quickDay==='date')b.textContent=dateKind==='date'?`${Number(due.slice(5,7))}.${Number(due.slice(8,10))}`:'날짜';});size();
  }
  async function choices(){
    if(choicesFlight)return choicesFlight;
    const run=choiceEpoch;
    choicesFlight=(async()=>{
      await dependencies.google();
      const [ps,os,as]=await Promise.all([dependencies.projects(),dependencies.orgs(),dependencies.assignments()]);
      if(run!==choiceEpoch)return;
      const ctx=window.KPTURuntime.context.read(),order=window.KPTUOrganizationOrder;
      const eligible=order.forPicker(os.filter(o=>as.some(a=>a.organization_id===o.id)));
      const recent=[],recentIds=new Set(),eligibleIds=new Set(eligible.map(o=>o.id));
      // Page older records until three distinct organizations are found; one busy organization must not hide the others.
      for(let offset=0;eligible.length&&recentIds.size<Math.min(3,eligible.length);offset+=100){
        const rows=await window.KPTURuntime.api(`/rest/v1/app_suborganization_updates?created_by=eq.${encodeURIComponent(ctx.user.id)}&organization_id=in.(${eligible.map(o=>encodeURIComponent(o.id)).join(',')})&select=organization_id,occurred_at&order=occurred_at.desc,id.desc&limit=100&offset=${offset}`);
        if(run!==choiceEpoch)return;
        recent.push(...rows);rows.forEach(r=>{if(eligibleIds.has(r.organization_id))recentIds.add(r.organization_id);});
        if(rows.length<100)break;
      }
      if(run!==choiceEpoch)return;
      const cat=window.KPTUProjectCatalog;
      projectSelect.innerHTML='<option value="">프로젝트 ▾</option>'+cat.tree(ps).filter(x=>x.project.status==='active').map(x=>`<option value="${esc(x.project.id)}">${esc(cat.label(x.project.name,x.depth))}</option>`).join('');projectSelect.value=project;project=projectSelect.value;
      const ordered=order.withRecent(eligible,recent.map(r=>r.organization_id),3),opts=rows=>rows.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
      orgSelect.innerHTML='<option value="">조직 ▾</option>'+(ordered.recent.length?`<optgroup label="최근 기록">${opts(ordered.recent)}</optgroup>`:'')+ordered.groups.filter(g=>g.length).map(g=>`<optgroup label="────────">${opts(g)}</optgroup>`).join('');orgSelect.value=organization;organization=orgSelect.value;
    })().catch(e=>{if(run===choiceEpoch){choicesFlight=null;status.textContent=e.message||'선택 목록을 불러오지 못했습니다.';}});
    return choicesFlight;
  }
  function expand(){expanded=true;paint();void choices();}
  input.addEventListener('focus',expand); input.addEventListener('input',()=>{expand();size();});
  projectSelect.onchange=()=>{project=projectSelect.value;};orgSelect.onchange=()=>{organization=orgSelect.value;};
  box.querySelectorAll('[data-quick-mode]').forEach(b=>b.onclick=()=>{
    if(saving)return;mode=b.dataset.quickMode;status.textContent='';
    try{window.localStorage.setItem('kptu-home-quick-mode',mode);}catch{mode='task';}
    paint();if(expanded)void choices();
  });
  box.querySelectorAll('[data-quick-day]').forEach(b=>b.onclick=()=>{
    if(saving)return;const kind=b.dataset.quickDay;
    if(dateKind===kind){due='';dateKind='';date.value='';paint();return;}
    if(kind==='date'){try{date.showPicker();}catch{date.focus();date.click();}return;}
    dateKind=kind;due=dayKey(Date.now()+(kind==='tomorrow'?86400000:0));paint();
  });
  date.onchange=()=>{due=date.value;dateKind=due?'date':'';paint();};
  async function save(){
    if(saving||!input.value.trim())return;
    if(mode==='update'&&!organization){expand();await choices();status.textContent='조직을 선택해 주세요.';orgSelect.focus();try{orgSelect.showPicker?.();}catch{}return;}
    const ctx=window.KPTURuntime.context.read(),owner=ctx?.user?.id;if(!owner)return;
    const saveMode=mode,text=input.value.trim();saving=true;status.textContent='';
    box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);
    try{
      const result=saveMode==='task'?await createGoogleTask({title:text,due:due||null,links:project?[{project_id:project}]:[]}):await saveOrganizationUpdate({organization_id:organization,raw_text:text,created_by:owner});
      if(window.KPTURuntime.context.read()?.user?.id!==owner)return;
      input.value='';expanded=false;paint();
      const toast=document.querySelector('#toast');toast.textContent=saveMode==='task'&&result?.link_error?'할 일은 추가됨, 프로젝트 연결 실패':saveMode==='task'?'할 일을 추가했습니다.':'기록을 저장했습니다.';toast.classList.remove('hidden');clearTimeout(save.toastTimer);save.toastTimer=setTimeout(()=>toast.classList.add('hidden'),3200);
      if(saveMode==='task')void refreshTasks();else choicesFlight=null;
    }catch(e){if(window.KPTURuntime.context.read()?.user?.id===owner)status.textContent=e.message||'저장하지 못했습니다.';}
    finally{saving=false;box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);}
  }
  box.querySelector('[data-quick-save]').onclick=save;
  input.addEventListener('keydown',e=>{if(mode==='task'&&e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();void save();}});
  window.addEventListener('kptu:before-reload',e=>{if(saving)e.preventDefault();else if(input.value.length)e.detail.otherDraft=true;});
  window.addEventListener('kptu:session-changed',()=>{const nextOwner=window.KPTURuntime.context.read()?.user?.id;if(nextOwner===quickOwner)return;quickOwner=nextOwner;choiceEpoch++;choicesFlight=null;project='';organization='';due='';dateKind='';input.value='';expanded=false;paint();});
  window.addEventListener('kptu:project-catalog-updated',()=>{choiceEpoch++;choicesFlight=null;invalidateProjects();if(expanded)void choices();});
  window.KPTURouter.on('home',()=>{choiceEpoch++;choicesFlight=null;if(expanded)void choices();});
  paint();
}
