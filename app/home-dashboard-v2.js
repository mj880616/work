(()=>{
  'use strict';
  if(window.__KPTU_HOME_DASHBOARD_V2__)return;
  window.__KPTU_HOME_DASHBOARD_V2__=true;

  const rt=window.KPTURuntime;
  let userId='';
  let workspaceId='';
  let loading=false;
  let timer=null;
  let renderEpoch=0;
  let resolveReady;
  window.__KPTU_HOME_READY__=new Promise(resolve=>{resolveReady=resolve});

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dt=v=>{if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d};
  const dateLabel=v=>{const d=dt(v);return d?d.toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',weekday:'short'}):'일정 미정'};
  const phaseLabel=v=>({preparation:'준비',in_progress:'진행',consultation:'협의',execution:'실행',follow_up:'후속조치',done:'종료'}[v]||v||'진행');
  const typeLabel=v=>({ongoing:'상시사업·산업관리',campaign:'의제 사업',event:'행사·집중사업',knowledge:'자료·지식',blank:'프로젝트'}[v]||'프로젝트');

  async function api(path,opts={}){if(!rt?.api)throw new Error('공용 런타임을 불러오지 못했습니다.');return rt.api(path,opts)}
  async function context(epoch){
    if(userId&&workspaceId)return {userId,workspaceId};
    const boot=window.__KPTU_BOOT_CONTEXT__;
    if(boot?.user?.id&&boot?.workspace?.id){userId=boot.user.id;workspaceId=boot.workspace.id;return {userId,workspaceId}}
    if(!rt?.session||!(await rt.session.ensure()))return false;
    const user=await api('/auth/v1/user');
    const ms=await api('/rest/v1/app_workspace_members?user_id=eq.'+encodeURIComponent(user.id)+'&select=workspace_id&limit=1');
    if(!ms?.length||epoch!==renderEpoch)return false;
    userId=user.id;
    workspaceId=ms[0].workspace_id;
    return {userId,workspaceId};
  }

  function prepareStructure(){
    const home=document.querySelector('#homeView');
    if(!home)return false;
    if(home.dataset.hdvOwned==='1')return true;
    home.dataset.hdvOwned='1';
    home.innerHTML=`
      <div class="dashboard-grid home-dashboard-current hdv-home-grid">
        <article class="panel hdv-panel" id="hdvProjectPanel"><div class="panel-head"><div><h2>프로젝트</h2><p>최근 갱신된 주요 사업</p></div><button class="mini" type="button" data-hdv-goto="projects">전체</button></div><div id="hdvProjects" class="hdv-list"></div></article>
        <article class="panel hdv-panel" id="hdvTaskPanel"><div class="panel-head"><div><h2>할 일</h2><p>내 미완료 업무</p></div><button class="mini" type="button" data-hdv-goto="tasks">전체</button></div><div id="hdvTasks" class="hdv-list"></div></article>
        <article class="panel hdv-panel" id="hdvMilestonePanel"><div class="panel-head"><div><h2>다가오는 주요 일정</h2><p>현재는 프로젝트 마일스톤 기준</p></div><button class="mini" type="button" data-hdv-goto="calendar">일정</button></div><div id="hdvMilestones" class="hdv-list"></div></article>
        <article class="panel hdv-panel" id="hdvLibraryPanel"><div class="panel-head"><div><h2>자료실</h2><p>최근 등록·갱신된 자료</p></div><button class="mini" type="button" data-hdv-goto="library">전체</button></div><div id="hdvLibrary" class="hdv-list"></div></article>
      </div>`;
    return true;
  }

  function empty(text){return `<div class="hdv-empty">${esc(text)}</div>`}
  function revealHomeShell(){
    const requested=new URLSearchParams(location.search).get('view');
    if(requested&&requested!=='home')return;
    const app=document.querySelector('#appView');
    if(!app||app.classList.contains('hidden'))return;
    app.classList.add('kptu-shell-ready');
    window.__KPTU_STARTUP__?.mark('shellReady');
  }
  function projectRow(p){
    const kind=p.project_type||p.metadata?.project_type||'blank';
    const phase=p.current_phase||p.metadata?.current_phase||'in_progress';
    const meta=[typeLabel(kind),phaseLabel(phase),p.end_on?'종료 '+dateLabel(p.end_on):null].filter(Boolean).join(' · ');
    return `<button class="hdv-row hdv-project" type="button" data-hdv-project="${esc(p.id)}"><div class="hdv-main"><b>${esc(p.name||'이름 없는 프로젝트')}</b><small>${esc(meta)}</small></div></button>`;
  }
  function taskRow(t,names){
    const project=names.get(t.project_id)||'일반 업무';
    const due=t.due_at?dateLabel(t.due_at):'기한 미정';
    return `<button class="hdv-row hdv-task" type="button" data-hdv-goto="tasks"><div class="hdv-main"><b>${esc(t.title||'할 일')}</b><small>${esc(project)}</small></div><span class="hdv-meta">${esc(due)}</span></button>`;
  }
  function milestoneRow(m,names){
    return `<button class="hdv-row hdv-milestone" type="button" data-hdv-project="${esc(m.project_id)}"><span class="hdv-date">${esc(dateLabel(m.start_at))}</span><div class="hdv-main"><b>${esc(m.title||'주요 일정')}</b><small>${esc(names.get(m.project_id)||'프로젝트')}</small></div></button>`;
  }
  function documentRow(d,names){
    const meta=[d.category,names.get(d.project_id),d.source].filter(Boolean).join(' · ')||'자료';
    const when=d.document_date?dateLabel(d.document_date):dateLabel(d.updated_at||d.created_at);
    return `<button class="hdv-row hdv-document" type="button" data-hdv-goto="library"><div class="hdv-main"><b>${esc(d.title||'자료')}</b><small>${esc(meta)}</small></div><span class="hdv-meta">${esc(when)}</span></button>`;
  }

  async function render(){
    if(loading||!prepareStructure())return;
    loading=true;
    const epoch=renderEpoch;
    try{
      const activeContext=await context(epoch);
      if(!activeContext||epoch!==renderEpoch)return;
      const wid=encodeURIComponent(activeContext.workspaceId),uid=encodeURIComponent(activeContext.userId);
      window.__KPTU_STARTUP__?.mark('homeDataStart');
      const [spaceRows,milestoneRows,taskRows,documentRows]=await Promise.all([
        api('/rest/v1/app_spaces?workspace_id=eq.'+wid+'&status=neq.archived&select=id,name,parent_id,status,metadata,project_type,current_phase,start_on,end_on,updated_at,is_legacy_snapshot'),
        api('/rest/v1/app_project_milestones?select=id,project_id,title,status,start_at,end_at,updated_at&order=start_at.asc.nullslast&limit=100'),
        api('/rest/v1/app_tasks?workspace_id=eq.'+wid+'&assignee_id=eq.'+uid+'&status=neq.done&select=id,title,project_id,status,priority,due_at,updated_at&order=due_at.asc.nullslast,updated_at.desc&limit=20'),
        api('/rest/v1/app_documents?workspace_id=eq.'+wid+'&select=id,title,project_id,category,source,document_date,created_at,updated_at&order=updated_at.desc&limit=20')
      ]);

      const allSpaces=(spaceRows||[]);
      const names=new Map(allSpaces.map(p=>[p.id,p.name]));
      const projects=allSpaces
        .filter(p=>!p.parent_id&&!p.is_legacy_snapshot&&p.metadata?.legacy_snapshot!==true&&(p.metadata?.project_system==='v2'||Number(p.metadata?.management_version)===2||p.project_type))
        .sort((a,b)=>(dt(b.updated_at)?.getTime()||0)-(dt(a.updated_at)?.getTime()||0));

      const projectIds=new Set(projects.map(p=>p.id));
      const now=Date.now();
      const future=(milestoneRows||[])
        .filter(m=>projectIds.has(m.project_id)&&m.start_at&&(dt(m.start_at)?.getTime()||0)>=now-86400000&&!['done','cancelled','canceled'].includes(String(m.status||'').toLowerCase()))
        .sort((a,b)=>(dt(a.start_at)?.getTime()||0)-(dt(b.start_at)?.getTime()||0));

      const tasks=(taskRows||[]).sort((a,b)=>{
        const ad=dt(a.due_at)?.getTime()??Number.MAX_SAFE_INTEGER;
        const bd=dt(b.due_at)?.getTime()??Number.MAX_SAFE_INTEGER;
        return ad-bd||(dt(b.updated_at)?.getTime()||0)-(dt(a.updated_at)?.getTime()||0);
      });
      const docs=(documentRows||[]).sort((a,b)=>(dt(b.updated_at||b.created_at)?.getTime()||0)-(dt(a.updated_at||a.created_at)?.getTime()||0));

      // A session change can happen while the requests above are in flight. Never
      // commit a previous user's dashboard into the next session's shell.
      if(epoch!==renderEpoch)return;
      document.querySelector('#hdvProjects').innerHTML=projects.length?projects.slice(0,5).map(projectRow).join(''):empty('진행 중인 프로젝트가 없습니다.');
      document.querySelector('#hdvTasks').innerHTML=tasks.length?tasks.slice(0,6).map(t=>taskRow(t,names)).join(''):empty('미완료 업무가 없습니다.');
      document.querySelector('#hdvMilestones').innerHTML=future.length?future.slice(0,5).map(m=>milestoneRow(m,names)).join(''):empty('등록된 다음 주요 일정이 없습니다.');
      document.querySelector('#hdvLibrary').innerHTML=docs.length?docs.slice(0,5).map(d=>documentRow(d,names)).join(''):empty('최근 자료가 없습니다.');
      window.__KPTU_STARTUP__?.mark('homeDataComplete');
      resolveReady?.({ok:true});resolveReady=null;
    }catch(e){
      if(epoch===renderEpoch)['#hdvProjects','#hdvTasks','#hdvMilestones','#hdvLibrary'].forEach(sel=>{const el=document.querySelector(sel);if(el)el.innerHTML=`<div class="hdv-empty error">${esc(e.message||String(e))}</div>`});
      resolveReady?.({ok:false});resolveReady=null;
    }finally{
      loading=false;
      if(epoch!==renderEpoch)schedule(0);
    }
  }

  function schedule(delay=80){clearTimeout(timer);timer=setTimeout(render,delay)}
  function goProjects(projectId){
    window.KPTURouter?.go?.('projects',{source:'home-dashboard'});
    if(!projectId)return;
    const target=[...document.querySelectorAll('#projectGrid [data-ps3-project]')].find(el=>el.dataset?.ps3Project===projectId);
    target?.click?.();
  }

  function install(){
    prepareStructure();
    revealHomeShell();
    document.addEventListener('click',e=>{
      const row=e.target.closest?.('[data-hdv-project]');
      if(row){goProjects(row.dataset.hdvProject);return}
      const goto=e.target.closest?.('[data-hdv-goto]');
      if(goto)window.KPTURouter?.go?.(goto.dataset.hdvGoto,{source:'home-dashboard'});
    });
    window.KPTURouter?.on?.('home',()=>schedule(40));
    window.addEventListener('kptu:session-changed',()=>{renderEpoch+=1;userId='';workspaceId='';schedule(120)});
    ['kptu:tasks-changed','kptu:projects-changed','kptu:calendar-changed','kptu:documents-changed'].forEach(name=>window.addEventListener(name,()=>schedule(80)));
    schedule(80);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
