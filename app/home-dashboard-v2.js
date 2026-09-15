(()=>{
  'use strict';
  if(window.__KPTU_HOME_DASHBOARD_V2__)return;
  window.__KPTU_HOME_DASHBOARD_V2__=true;

  const rt=window.KPTURuntime;
  let userId='';
  let workspaceId='';
  let loading=false;
  let timer=null;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dt=v=>{if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d};
  const dateLabel=v=>{const d=dt(v);return d?d.toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',weekday:'short'}):'일정 미정'};
  const relative=v=>{const d=dt(v);if(!d)return '';const diff=Date.now()-d.getTime();const day=Math.floor(diff/86400000);if(day<=0)return '오늘';if(day===1)return '어제';if(day<7)return `${day}일 전`;return d.toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'})};
  const phaseLabel=v=>({preparation:'준비',in_progress:'진행',consultation:'협의',execution:'실행',follow_up:'후속조치',done:'종료'}[v]||v||'진행');
  const typeLabel=v=>({ongoing:'상시사업·산업관리',campaign:'의제 사업',event:'행사·집중사업',knowledge:'자료·지식',blank:'프로젝트'}[v]||'프로젝트');

  async function api(path,opts={}){if(!rt?.api)throw new Error('공용 런타임을 불러오지 못했습니다.');return rt.api(path,opts)}
  async function context(){
    if(userId&&workspaceId)return true;
    if(!rt?.session||!(await rt.session.ensure()))return false;
    const user=await api('/auth/v1/user');
    const ms=await api('/rest/v1/app_workspace_members?user_id=eq.'+encodeURIComponent(user.id)+'&select=workspace_id&limit=1');
    if(!ms?.length)return false;
    userId=user.id;workspaceId=ms[0].workspace_id;return true;
  }

  function prepareStructure(){
    const home=document.querySelector('#homeView');
    const grid=home?.querySelector('.dashboard-grid');
    const taskPanel=home?.querySelector('#myTaskMini')?.closest('article.panel');
    if(!home||!grid||!taskPanel)return false;
    ['#todayList','#notifList','#weeklyCopyBtn'].forEach(sel=>{
      const panel=home.querySelector(sel)?.closest('article.panel');
      if(!panel)return;
      panel.hidden=true;
      panel.setAttribute('aria-hidden','true');
      panel.classList.add('home-dashboard-deprecated');
    });
    grid.classList.add('home-dashboard-current');
    if(!document.querySelector('#hdvMilestones')){
      taskPanel.insertAdjacentHTML('afterend',`
        <article class="panel hdv-panel" id="hdvMilestonePanel"><div class="panel-head"><div><h2>다가오는 주요 일정</h2><p>프로젝트의 다음 분기점</p></div><button class="mini" type="button" data-hdv-goto="projects">전체</button></div><div id="hdvMilestones" class="hdv-list"></div></article>
        <article class="panel hdv-panel" id="hdvProjectPanel"><div class="panel-head"><div><h2>진행 중 프로젝트</h2><p>최근 움직임이 있는 사업</p></div><button class="mini" type="button" data-hdv-goto="projects">전체</button></div><div id="hdvProjects" class="hdv-list"></div></article>
        <article class="panel hdv-panel" id="hdvRecentPanel"><div class="panel-head"><div><h2>최근 진행 기록</h2><p>프로젝트에서 최근 갱신된 내용</p></div><button class="mini" type="button" data-hdv-goto="projects">전체</button></div><div id="hdvRecent" class="hdv-list"></div></article>`);
    }
    return true;
  }

  function empty(text){return `<div class="hdv-empty">${esc(text)}</div>`}
  function projectRow(p,next){
    const kind=p.project_type||p.metadata?.project_type||'blank';
    const phase=p.current_phase||p.metadata?.current_phase||'in_progress';
    const nextText=next?.start_at?`다음 일정 ${dateLabel(next.start_at)}`:(p.end_on?`종료 ${dateLabel(p.end_on)}`:'일정 확인 필요');
    return `<button class="hdv-row hdv-project" type="button" data-hdv-project="${esc(p.id)}"><div class="hdv-main"><b>${esc(p.name||'이름 없는 프로젝트')}</b><small>${esc(typeLabel(kind))} · ${esc(phaseLabel(phase))}</small></div><span class="hdv-meta">${esc(nextText)}</span></button>`;
  }
  function milestoneRow(m,names){
    return `<button class="hdv-row hdv-milestone" type="button" data-hdv-project="${esc(m.project_id)}"><span class="hdv-date">${esc(dateLabel(m.start_at))}</span><div class="hdv-main"><b>${esc(m.title||'주요 일정')}</b><small>${esc(names.get(m.project_id)||'프로젝트')}</small></div></button>`;
  }
  function recentRow(u,names){
    const when=u.effective_on||u.updated_at||u.created_at;
    const summary=(u.summary||'진행 기록이 갱신되었습니다.').trim();
    const next=(u.next_step||'').trim();
    return `<button class="hdv-row hdv-update" type="button" data-hdv-project="${esc(u.project_id)}"><div class="hdv-main"><b>${esc(summary)}</b><small>${esc(names.get(u.project_id)||'프로젝트')}${next?` · 다음: ${esc(next)}`:''}</small></div><span class="hdv-meta">${esc(relative(when))}</span></button>`;
  }

  async function render(){
    if(loading||!prepareStructure()||!(await context()))return;
    loading=true;
    try{
      const [spaceRows,milestoneRows,progressRows]=await Promise.all([
        api('/rest/v1/app_spaces?workspace_id=eq.'+encodeURIComponent(workspaceId)+'&status=neq.archived&select=id,name,parent_id,status,metadata,project_type,current_phase,start_on,end_on,updated_at,is_legacy_snapshot'),
        api('/rest/v1/app_project_milestones?select=id,project_id,title,status,start_at,end_at,updated_at&order=start_at.asc.nullslast&limit=100'),
        api('/rest/v1/app_project_progress_updates?select=id,project_id,summary,next_step,effective_on,created_at,updated_at&order=updated_at.desc&limit=30')
      ]);
      const projects=(spaceRows||[]).filter(p=>!p.parent_id&&!p.is_legacy_snapshot&&p.metadata?.legacy_snapshot!==true&&(p.metadata?.project_system==='v2'||Number(p.metadata?.management_version)===2||p.project_type));
      const projectIds=new Set(projects.map(p=>p.id));
      const names=new Map(projects.map(p=>[p.id,p.name]));
      const now=Date.now();
      const future=(milestoneRows||[]).filter(m=>projectIds.has(m.project_id)&&m.start_at&&dt(m.start_at)?.getTime()>=now-86400000&&!['done','cancelled','canceled'].includes(String(m.status||'').toLowerCase()));
      const nextByProject=new Map();future.forEach(m=>{if(!nextByProject.has(m.project_id))nextByProject.set(m.project_id,m)});
      const progress=(progressRows||[]).filter(u=>projectIds.has(u.project_id));
      const lastActivity=new Map(projects.map(p=>[p.id,dt(p.updated_at)?.getTime()||0]));
      progress.forEach(u=>lastActivity.set(u.project_id,Math.max(lastActivity.get(u.project_id)||0,dt(u.updated_at||u.created_at)?.getTime()||0)));
      (milestoneRows||[]).forEach(m=>{if(projectIds.has(m.project_id))lastActivity.set(m.project_id,Math.max(lastActivity.get(m.project_id)||0,dt(m.updated_at)?.getTime()||0))});
      projects.sort((a,b)=>(lastActivity.get(b.id)||0)-(lastActivity.get(a.id)||0));

      const mRoot=document.querySelector('#hdvMilestones');
      const pRoot=document.querySelector('#hdvProjects');
      const rRoot=document.querySelector('#hdvRecent');
      if(mRoot)mRoot.innerHTML=future.length?future.slice(0,4).map(m=>milestoneRow(m,names)).join(''):empty('등록된 다음 주요 일정이 없습니다.');
      if(pRoot)pRoot.innerHTML=projects.length?projects.slice(0,4).map(p=>projectRow(p,nextByProject.get(p.id))).join(''):empty('진행 중인 프로젝트가 없습니다.');
      if(rRoot)rRoot.innerHTML=progress.length?progress.slice(0,4).map(u=>recentRow(u,names)).join(''):empty('최근 진행 기록이 없습니다.');
    }catch(e){
      ['#hdvMilestones','#hdvProjects','#hdvRecent'].forEach(sel=>{const el=document.querySelector(sel);if(el)el.innerHTML=`<div class="hdv-empty error">${esc(e.message||String(e))}</div>`});
    }finally{loading=false}
  }

  function schedule(delay=100){clearTimeout(timer);timer=setTimeout(render,delay)}
  function goProjects(projectId){
    window.KPTURouter?.go?.('projects',{source:'home-dashboard'});
    if(!projectId)return;
    const target=[...document.querySelectorAll('#projectGrid [data-ps3-project]')].find(el=>el.dataset?.ps3Project===projectId);
    target?.click?.();
  }

  function install(){
    prepareStructure();
    document.addEventListener('click',e=>{const goto=e.target.closest?.('[data-hdv-goto]');if(goto){window.KPTURouter?.go?.(goto.dataset.hdvGoto,{source:'home-dashboard'});return}const row=e.target.closest?.('[data-hdv-project]');if(row)goProjects(row.dataset.hdvProject)});
    window.KPTURouter?.on?.('home',()=>schedule(60));
    window.addEventListener('kptu:session-changed',()=>{userId='';workspaceId='';schedule(250)});
    ['kptu:tasks-changed','kptu:projects-changed','kptu:calendar-changed'].forEach(name=>window.addEventListener(name,()=>schedule(120)));
    schedule(180);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();