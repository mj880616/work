(()=>{
  'use strict';
  if(window.__KPTU_PUBLIC_WORKSPACE__)return;
  window.__KPTU_PUBLIC_WORKSPACE__=true;
  const rt=window.KPTURuntime;
  if(!rt?.api)return;
  const state={spaces:[],tasks:[],pages:[],documents:[],events:[]};
  const PUBLIC_VIEWS=new Set(['home','calendar','tasks','projects','library','meetings','pages','team']);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>v?new Date(v).toLocaleDateString('ko-KR'):'';
  const fmtDateTime=v=>v?new Date(v).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
  const eventLabel={meeting:'회의',press:'기자회견',rally:'집회',field:'현장',deadline:'마감',education:'교육',other:'기타'};
  const taskLabel={todo:'할 일',doing:'진행',done:'완료',blocked:'막힘'};
  const priorityLabel={urgent:'긴급',high:'높음',normal:'보통',low:'낮음'};

  function loginUrl(){return window.KPTUAuth.loginUrl(location.href)}
  function normalizePublicRoute(){
    const u=new URL(location.href);
    let view=u.searchParams.get('view')||'home';
    if(!PUBLIC_VIEWS.has(view))view='home';
    if(view==='home')u.searchParams.delete('view');else u.searchParams.set('view',view);
    history.replaceState({...history.state,kptuView:view},'',u.pathname+u.search+u.hash);
    return view;
  }
  function showApp(){
    document.body.classList.add('kptu-public-workspace');
    document.getElementById('authView')?.classList.add('hidden');
    document.getElementById('bootstrapView')?.classList.add('hidden');
    document.getElementById('appView')?.classList.remove('hidden');
    document.getElementById('logoutBtn')?.classList.add('hidden');
    let login=document.getElementById('publicLoginBtn');
    if(!login){login=document.createElement('button');login.id='publicLoginBtn';login.type='button';login.className='secondary';login.textContent='로그인';login.onclick=()=>location.href=loginUrl();document.querySelector('.top-actions')?.appendChild(login)}
    document.querySelectorAll('.app-nav [data-view]').forEach(btn=>btn.classList.remove('public-hidden'));
    document.querySelectorAll('#appView .view-panel').forEach(panel=>panel.classList.remove('public-hidden'));
    ['quickInviteBtn','quickTaskBtn','newEventBtn','homeAddEvent','newTaskBtn','newDocumentBtn','newMeetingBtn','newPageBtn','inviteBtn','newGroupBtn','newProjectBtn'].forEach(id=>document.getElementById(id)?.classList.add('public-hidden'));
    document.querySelectorAll('.admin-only').forEach(x=>x.classList.add('public-hidden'));
  }
  function gateMarkup(title,description){return `<div class="public-access-gate"><div class="public-lock" aria-hidden="true">🔒</div><h3>${esc(title)}</h3><p>${esc(description)}</p><a class="primary" href="${esc(loginUrl())}">로그인해서 보기</a></div>`}
  function renderHome(){
    const view=document.getElementById('homeView');if(!view)return;
    const topProjects=state.spaces.filter(s=>s.status!=='archived').slice(0,5);
    const now=Date.now()-86400000;
    const upcoming=[...state.events].filter(e=>new Date(e.start_at).getTime()>=now).sort((a,b)=>new Date(a.start_at)-new Date(b.start_at)).slice(0,5);
    const board=[...state.pages].sort((a,b)=>new Date(b.updated_at||b.published_at||0)-new Date(a.updated_at||a.published_at||0)).slice(0,5);
    const docs=[...state.documents].sort((a,b)=>new Date(b.updated_at||b.document_date||0)-new Date(a.updated_at||a.document_date||0)).slice(0,5);
    const empty=text=>`<div class="hdv-empty">${esc(text)}</div>`;
    view.innerHTML=`<div class="public-home-intro"><div class="section-head"><div><h2>공개 업무</h2><p>외부 공개로 지정된 프로젝트·게시·자료만 표시합니다.</p></div></div><div class="dashboard-grid home-dashboard-current public-home-grid">
      <article class="panel hdv-panel"><div class="panel-head"><div><h2>프로젝트</h2><p>공개 프로젝트 ${topProjects.length}개</p></div><button class="mini" type="button" data-goto="projects">전체</button></div><div class="hdv-list">${topProjects.length?topProjects.map(p=>`<button class="hdv-row" type="button" data-public-project="${esc(p.slug)}"><div class="hdv-main"><b>${esc(p.name)}</b><small>${esc(p.description||'공개 프로젝트')}</small></div></button>`).join(''):empty('현재 공개된 프로젝트가 없습니다.')}</div></article>
      <article class="panel hdv-panel"><div class="panel-head"><div><h2>다가오는 주요 일정</h2><p>공개 팀 일정 중 가까운 일정</p></div><button class="mini" type="button" data-goto="calendar">전체</button></div><div class="hdv-list">${upcoming.length?upcoming.map(e=>`<button class="hdv-row" type="button" data-goto="calendar"><span class="hdv-date">${esc(fmt(e.start_at))}</span><div class="hdv-main"><b>${esc(e.title)}</b><small>${esc(eventLabel[e.event_type]||e.event_type||'일정')}</small></div></button>`).join(''):empty('다가오는 공개 일정이 없습니다.')}</div></article>
      <article class="panel hdv-panel"><div class="panel-head"><div><h2>게시판</h2><p>최근 공개 게시</p></div><button class="mini" type="button" data-goto="pages">전체</button></div><div class="hdv-list">${board.length?board.map(p=>`<a class="hdv-row public-home-link" href="../p/${encodeURIComponent(p.slug)}/"><div class="hdv-main"><b>${esc(p.title)}</b><small>${esc(p.summary||'공개 게시')}</small></div><span class="hdv-meta">${esc(fmt(p.updated_at||p.published_at))}</span></a>`).join(''):empty('현재 공개된 게시가 없습니다.')}</div></article>
      <article class="panel hdv-panel"><div class="panel-head"><div><h2>자료실</h2><p>최근 공개 자료</p></div><button class="mini" type="button" data-goto="library">전체</button></div><div class="hdv-list">${docs.length?docs.map(d=>`<button class="hdv-row" type="button" data-goto="library"><div class="hdv-main"><b>${esc(d.title||d.file_name||'자료')}</b><small>${esc([d.category,d.source].filter(Boolean).join(' · ')||'공개 자료')}</small></div><span class="hdv-meta">${esc(fmt(d.document_date||d.updated_at))}</span></button>`).join(''):empty('현재 공개된 자료가 없습니다.')}</div></article>
    </div><div class="public-home-note">할 일은 독립 목록으로 공개하지 않고 공개 프로젝트 상세에서 필요한 진행상황만 표시합니다. 개인 일정·Google 일정·회의결과·팀 정보는 공개하지 않습니다.</div></div>`;
  }
  function renderLockedViews(){
    const configs={
      tasks:['할 일은 로그인 후 열람할 수 있습니다.','공개 프로젝트에 연결된 일부 업무는 해당 프로젝트 상세에서만 진행상황으로 표시합니다.'],
      meetings:['회의 결과는 로그인 후 열람할 수 있습니다.','회의에는 아직 항목별 외부 공개범위가 없으므로 제목과 회의내용을 외부에 노출하지 않습니다.'],
      team:['팀 정보는 로그인 후 열람할 수 있습니다.','구성원·권한·그룹 정보는 업무자료와 별도의 내부 정보로 취급합니다.']
    };
    for(const [view,[title,description]] of Object.entries(configs)){
      const panel=document.getElementById(view+'View');if(!panel)continue;
      const heading={tasks:'할 일',meetings:'회의 결과',team:'팀'}[view]||view;panel.innerHTML=`<div class="section-head"><div><h2>${heading}</h2><p>메뉴는 공개되며 실제 데이터는 열람권한에 따라 표시됩니다.</p></div></div>${gateMarkup(title,description)}`;
    }
  }
  const children=id=>state.spaces.filter(x=>x.parent_id===id);
  const tasks=id=>state.tasks.filter(x=>x.project_id===id);
  const pages=id=>state.pages.filter(x=>x.space_id===id);
  function renderCalendar(){
    const view=document.getElementById('calendarView');if(!view)return;
    const rows=[...state.events].sort((a,b)=>new Date(a.start_at)-new Date(b.start_at));
    view.innerHTML=`<div class="section-head"><div><h2>공동 일정</h2><p>팀 일정 중 외부 공개에 필요한 기본 정보만 읽기 전용으로 표시합니다.</p></div></div><div class="public-visibility-note">개인 일정·Google 일정·상세 메모·참석자 정보는 비로그인 사용자에게 노출하지 않습니다.</div><div class="card-list public-calendar-list">${rows.length?rows.map(e=>`<article class="item-card"><div><span class="badge">${esc(eventLabel[e.event_type]||e.event_type||'일정')}</span><h3>${esc(e.title)}</h3><p>${fmtDateTime(e.start_at)}${e.end_at?' ~ '+fmtDateTime(e.end_at):''}</p></div></article>`).join(''):'<div class="empty">공개된 공동 일정이 없습니다.</div>'}</div>`;
  }
  function renderProjects(){
    const grid=document.getElementById('projectGrid');if(!grid)return;
    const tops=state.spaces.filter(x=>x.status!=='archived');
    const head=document.querySelector('#projectsView .section-head p');if(head)head.textContent='전체 공개로 설정된 프로젝트와 공개 가능한 업무만 표시됩니다.';
    grid.innerHTML=tops.length?tops.map(p=>`<button class="project-card" data-public-project="${esc(p.slug)}" type="button"><span class="badge">공개</span><h3>${esc(p.name)}</h3><p>${esc(p.description||'')}</p><div class="public-project-meta"><span>공개 프로젝트</span></div></button>`).join(''):'<div class="empty">현재 공개된 프로젝트가 없습니다.</div>';
  }
  function ensureModal(){
    if(document.getElementById('publicProjectModal'))return;
    document.body.insertAdjacentHTML('beforeend','<div id="publicProjectModal" class="modal hidden" aria-hidden="true"><div class="modal-card medium-card"><div class="modal-head"><div><div class="eyebrow">PUBLIC PROJECT · READ ONLY</div><h2 id="publicProjectTitle"></h2><p id="publicProjectDescription" class="muted"></p></div><button id="publicProjectClose" class="icon-btn" type="button">×</button></div><div id="publicProjectBody" class="public-project-detail"></div></div></div>');
    document.getElementById('publicProjectClose').onclick=()=>document.getElementById('publicProjectModal').classList.add('hidden');
  }
  function taskRows(rows){return rows.length?rows.map(t=>`<div class="public-project-task"><b>${esc(t.title)}</b><span>${esc(taskLabel[t.status]||t.status||'')} · 우선순위 ${esc(priorityLabel[t.priority]||t.priority||'보통')}</span>${t.due_at?`<small>기한 ${fmt(t.due_at)}</small>`:''}</div>`).join(''):'<div class="empty compact">연결된 공개 할 일이 없습니다.</div>'}
  function openProject(slug){
    if(!/^project-[0-9a-f]{32}$/.test(String(slug||'')))return;
    location.href='../p/?slug='+encodeURIComponent(slug);
  }
  function renderPages(){
    const list=document.getElementById('pageList'),search=document.getElementById('pageSearch'),filter=document.getElementById('pageFilter');if(!list)return;
    const title=document.querySelector('#pagesView .section-head h2');if(title)title.textContent='게시판';
    const head=document.querySelector('#pagesView .section-head p');if(head)head.textContent='게시글의 열람 상태에 따라 비로그인 열람 여부가 결정됩니다.';
    if(filter){filter.innerHTML='<option value="published">전체 공개 게시</option>';filter.disabled=true}
    if(!document.getElementById('publicPageVisibilityNote'))list.insertAdjacentHTML('beforebegin','<div id="publicPageVisibilityNote" class="public-visibility-note">전체 공개(public) 글만 목록에 표시됩니다. 링크 공개(unlisted)는 주소를 아는 사람만 직접 열람할 수 있고, 로그인 사용자·지정 그룹·비공개 글은 제목과 요약도 외부 목록에 노출하지 않습니다.</div>');
    const paint=()=>{const q=(search?.value||'').trim().toLowerCase(),rows=state.pages.filter(p=>!q||`${p.title||''} ${p.summary||''}`.toLowerCase().includes(q));list.innerHTML=rows.map(p=>`<article class="page-card compact-entry" tabindex="0" role="link" data-public-card-url="../p/${encodeURIComponent(p.slug)}/"><div class="compact-entry-main"><span class="badge published">전체 공개</span><h3>${esc(p.title)}</h3><p class="compact-entry-summary">${esc(p.summary||'')}</p></div><div class="page-card-foot compact-entry-actions"><span class="updated compact-entry-meta">${fmt(p.updated_at)}</span></div></article>`).join('');document.getElementById('pageEmpty')?.classList.toggle('hidden',!!rows.length)};
    if(search)search.oninput=paint;paint();
    const openCard=e=>{
      const card=e.target.closest?.('.page-card[data-public-card-url]');
      if(!card||e.target.closest('button,input,select,textarea,label,a'))return;
      if(e.type==='keydown'&&!['Enter',' '].includes(e.key))return;
      if(e.type==='keydown')e.preventDefault();
      location.href=card.dataset.publicCardUrl;
    };
    list.onclick=openCard;
    list.onkeydown=openCard;
  }
  function renderLibrary(){
    const view=document.getElementById('libraryView');if(!view)return;
    view.innerHTML=`<div class="section-head"><div><h2>자료실</h2><p>외부 공개로 지정된 자료는 로그인 없이 열람할 수 있습니다.</p></div></div><div class="public-library-toolbar"><input id="publicLibrarySearch" class="search" type="search" placeholder="자료명·출처·태그 검색"></div><div class="public-visibility-note">팀 공개·비공개 자료는 제목과 설명도 외부에 노출하지 않습니다.</div><div id="publicLibraryList" class="public-library-list"></div>`;
    const box=document.getElementById('publicLibraryList'),search=document.getElementById('publicLibrarySearch');
    const paint=()=>{
      const q=(search?.value||'').trim().toLowerCase();
      const rows=state.documents.filter(d=>!q||[d.title,d.file_name,d.source,d.category,d.description,(d.tags||[]).join(' ')].join(' ').toLowerCase().includes(q));
      box.innerHTML=rows.length?rows.map(d=>{
        const body=`<div class="compact-entry-main"><div class="badges"><span class="badge">${esc(d.category||'기타')}</span><span class="badge published">공개</span></div><h3>${esc(d.title||d.file_name||'자료')}</h3>${d.description?`<small class="compact-entry-summary">${esc(d.description)}</small>`:''}</div><div class="compact-entry-actions compact-entry-meta">${esc(d.source||'출처 미기재')}${d.document_date?' · '+esc(d.document_date):''}</div>`;
        return d.drive_url?`<button class="public-library-card compact-entry" type="button" data-public-document-url="${esc(d.drive_url)}">${body}</button>`:`<article class="public-library-card compact-entry">${body}</article>`;
      }).join(''):'<div class="empty">현재 외부 공개로 지정된 자료가 없습니다.</div>';
    };
    if(search)search.oninput=paint;
    box.onclick=e=>{const card=e.target.closest?.('[data-public-document-url]');if(!card)return;try{const url=new URL(card.dataset.publicDocumentUrl);if(['http:','https:'].includes(url.protocol))window.open(url.href,'_blank','noopener');else console.error('invalid public document URL protocol')}catch{console.error('invalid public document URL')}};
    paint();
  }
  async function load(){
    const data=await rt.api('/rest/v1/rpc/app_public_workspace_index',{method:'POST',body:{},auth:false});
    state.spaces=Array.isArray(data?.projects)?data.projects:[];
    state.tasks=[];
    state.pages=Array.isArray(data?.pages)?data.pages:[];
    state.documents=Array.isArray(data?.documents)?data.documents:[];
    state.events=[];
  }
  async function init(){
    const initialView=normalizePublicRoute();
    showApp();
    document.addEventListener('click',e=>{const p=e.target.closest?.('[data-public-project]');if(p){e.preventDefault();openProject(p.dataset.publicProject)}},true);
    try{
      await load();
      renderHome();renderLockedViews();renderCalendar();renderProjects();renderPages();renderLibrary();
      window.KPTURouter?.go?.(initialView,{source:'public',updateUrl:false,scroll:false});
    }catch(err){
      console.error(err);
      const home=document.getElementById('homeView');if(home)home.innerHTML=gateMarkup('공개 업무를 불러오지 못했습니다.','잠시 후 다시 시도하거나 로그인해 주세요.');
    }
    document.querySelector('#authPreloadStyle')?.remove();window.__KPTU_MARK_APP_UI_READY__?.();
  }
  init();
})();
