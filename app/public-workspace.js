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
    const role=document.getElementById('workspaceRole');if(role)role.innerHTML='로그인 없이 공개된 업무를 둘러볼 수 있습니다. <span class="public-readonly-badge">읽기 전용</span>';
    const badge=document.getElementById('userBadge');if(badge){badge.textContent='공개 열람';badge.classList.remove('hidden')}
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
    view.innerHTML=`<div class="public-home-intro"><div class="section-head"><div><h2>공개 업무 둘러보기</h2><p>메뉴 구조는 모두 볼 수 있고, 실제 내용은 각 항목의 공개범위에 따라 열람됩니다.</p></div></div><div class="stat-grid"><button class="stat-card" data-goto="projects" type="button"><span>공개 프로젝트</span><b>${state.spaces.filter(s=>!s.parent_id).length}</b></button><button class="stat-card" data-goto="calendar" type="button"><span>공동 일정</span><b>${state.events.length}</b></button><button class="stat-card" data-goto="pages" type="button"><span>공개 게시</span><b>${state.pages.length}</b></button><button class="stat-card" data-goto="library" type="button"><span>공개 자료</span><b>${state.documents.length}</b></button></div><div class="public-home-note">할 일은 독립 목록으로 공개하지 않고, 공개 프로젝트의 진행상황 안에서 필요한 항목만 표시합니다. 공동 일정·게시·자료는 공개 범위에 따라 제한된 정보만 제공합니다.</div></div>`;
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
  const projectName=id=>state.spaces.find(x=>x.id===id)?.name||'공개 프로젝트';
  function renderTasks(){
    const view=document.getElementById('tasksView');if(!view)return;
    const rows=state.tasks.filter(t=>t.project_id);
    view.innerHTML=`<div class="section-head"><div><h2>할 일</h2><p>전체 공개 프로젝트에 연결된 업무만 로그인 없이 표시됩니다.</p></div></div><div class="public-visibility-note">개인 할 일과 제한 프로젝트의 할 일은 목록 자체에 나타나지 않습니다.</div><div class="public-task-list">${rows.length?rows.map(t=>`<article class="public-task-card"><b>${esc(t.title)}</b><span>${esc(projectName(t.project_id))} · ${esc(taskLabel[t.status]||t.status||'')} · 우선순위 ${esc(priorityLabel[t.priority]||t.priority||'보통')}</span>${t.due_at?`<small>기한 ${fmt(t.due_at)}</small>`:''}</article>`).join(''):'<div class="empty">현재 공개된 할 일이 없습니다.</div>'}</div>`;
  }
  function renderCalendar(){
    const view=document.getElementById('calendarView');if(!view)return;
    const rows=[...state.events].sort((a,b)=>new Date(a.start_at)-new Date(b.start_at));
    view.innerHTML=`<div class="section-head"><div><h2>공동 일정</h2><p>팀 일정 중 외부 공개에 필요한 기본 정보만 읽기 전용으로 표시합니다.</p></div></div><div class="public-visibility-note">개인 일정·Google 일정·상세 메모·참석자 정보는 비로그인 사용자에게 노출하지 않습니다.</div><div class="card-list public-calendar-list">${rows.length?rows.map(e=>`<article class="item-card"><div><span class="badge">${esc(eventLabel[e.event_type]||e.event_type||'일정')}</span><h3>${esc(e.title)}</h3><p>${fmtDateTime(e.start_at)}${e.end_at?' ~ '+fmtDateTime(e.end_at):''}</p></div></article>`).join(''):'<div class="empty">공개된 공동 일정이 없습니다.</div>'}</div>`;
  }
  function renderProjects(){
    const grid=document.getElementById('projectGrid');if(!grid)return;
    const tops=state.spaces.filter(x=>!x.parent_id&&x.status!=='archived');
    const head=document.querySelector('#projectsView .section-head p');if(head)head.textContent='전체 공개로 설정된 프로젝트와 공개 가능한 업무만 표시됩니다.';
    grid.innerHTML=tops.length?tops.map(p=>`<button class="project-card" data-public-project="${esc(p.id)}" type="button"><span class="badge">공개</span><h3>${esc(p.name)}</h3><p>${esc(p.description||'')}</p><div class="public-project-meta"><span>미완료 할 일 ${tasks(p.id).filter(t=>t.status!=='done').length}</span><span>하위 프로젝트 ${children(p.id).length}</span></div></button>`).join(''):'<div class="empty">현재 공개된 프로젝트가 없습니다.</div>';
  }
  function ensureModal(){
    if(document.getElementById('publicProjectModal'))return;
    document.body.insertAdjacentHTML('beforeend','<div id="publicProjectModal" class="modal hidden" aria-hidden="true"><div class="modal-card medium-card"><div class="modal-head"><div><div class="eyebrow">PUBLIC PROJECT · READ ONLY</div><h2 id="publicProjectTitle"></h2><p id="publicProjectDescription" class="muted"></p></div><button id="publicProjectClose" class="icon-btn" type="button">×</button></div><div id="publicProjectBody" class="public-project-detail"></div></div></div>');
    document.getElementById('publicProjectClose').onclick=()=>document.getElementById('publicProjectModal').classList.add('hidden');
  }
  function taskRows(rows){return rows.length?rows.map(t=>`<div class="public-project-task"><b>${esc(t.title)}</b><span>${esc(taskLabel[t.status]||t.status||'')} · 우선순위 ${esc(priorityLabel[t.priority]||t.priority||'보통')}</span>${t.due_at?`<small>기한 ${fmt(t.due_at)}</small>`:''}</div>`).join(''):'<div class="empty compact">연결된 공개 할 일이 없습니다.</div>'}
  function openProject(id){
    const p=state.spaces.find(x=>x.id===id);if(!p)return;ensureModal();
    document.getElementById('publicProjectTitle').textContent=p.name;document.getElementById('publicProjectDescription').textContent=p.description||'';
    const child=children(id),projectPages=pages(id);
    document.getElementById('publicProjectBody').innerHTML=`<section><h3>프로젝트 할 일</h3>${taskRows(tasks(id))}</section>${projectPages.length?`<section><h3>공개 게시</h3>${projectPages.map(pg=>`<div class="public-project-task"><b>${esc(pg.title)}</b><span>${esc(pg.summary||'')}</span><div class="public-page-actions"><a class="mini" href="../p/${encodeURIComponent(pg.slug)}/" target="_blank" rel="noopener">열기</a></div></div>`).join('')}</section>`:''}${child.length?`<section><h3>하위 프로젝트</h3><div class="public-child-list">${child.map(c=>`<button class="public-child" type="button" data-public-project="${esc(c.id)}"><b>${esc(c.name)}</b><span>${esc(c.description||'')}</span></button>`).join('')}</div></section>`:''}`;
    const modal=document.getElementById('publicProjectModal');modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
  }
  function renderPages(){
    const list=document.getElementById('pageList'),search=document.getElementById('pageSearch'),filter=document.getElementById('pageFilter');if(!list)return;
    const head=document.querySelector('#pagesView .section-head p');if(head)head.textContent='게시글의 열람 상태에 따라 비로그인 열람 여부가 결정됩니다.';
    if(filter){filter.innerHTML='<option value="published">전체 공개 게시</option>';filter.disabled=true}
    if(!document.getElementById('publicPageVisibilityNote'))list.insertAdjacentHTML('beforebegin','<div id="publicPageVisibilityNote" class="public-visibility-note">전체 공개(public) 글만 목록에 표시됩니다. 링크 공개(unlisted)는 주소를 아는 사람만 직접 열람할 수 있고, 로그인 사용자·지정 그룹·비공개 글은 제목과 요약도 외부 목록에 노출하지 않습니다.</div>');
    const paint=()=>{const q=(search?.value||'').trim().toLowerCase(),rows=state.pages.filter(p=>!q||`${p.title||''} ${p.summary||''}`.toLowerCase().includes(q));list.innerHTML=rows.map(p=>`<article class="page-card" tabindex="0" role="link" data-public-card-url="../p/${encodeURIComponent(p.slug)}/"><div class="badges"><span class="badge published">전체 공개</span></div><h3>${esc(p.title)}</h3><p>${esc(p.summary||'')}</p><div class="page-card-foot"><span class="updated">${fmt(p.updated_at)}</span><a class="mini" href="../p/${encodeURIComponent(p.slug)}/" target="_blank" rel="noopener">열기</a></div></article>`).join('');document.getElementById('pageEmpty')?.classList.toggle('hidden',!!rows.length)};
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
        const body=`<div class="badges"><span class="badge">${esc(d.category||'기타')}</span><span class="badge published">공개</span></div><h3>${esc(d.title||d.file_name||'자료')}</h3><p>${esc(d.source||'출처 미기재')}${d.document_date?' · '+esc(d.document_date):''}</p>${d.description?`<small>${esc(d.description)}</small>`:''}`;
        return d.drive_url?`<button class="public-library-card" type="button" data-public-document-url="${esc(d.drive_url)}">${body}</button>`:`<article class="public-library-card">${body}</article>`;
      }).join(''):'<div class="empty">현재 외부 공개로 지정된 자료가 없습니다.</div>';
    };
    if(search)search.oninput=paint;
    box.onclick=e=>{const card=e.target.closest?.('[data-public-document-url]');if(card)window.open(card.dataset.publicDocumentUrl,'_blank','noopener')};
    paint();
  }
  async function load(){
    const data=await rt.api('/rest/v1/rpc/app_public_projects_snapshot',{method:'POST',body:{},auth:false});
    state.spaces=Array.isArray(data?.spaces)?data.spaces:[];
    state.tasks=(Array.isArray(data?.tasks)?data.tasks:[]).filter(t=>!!t.project_id);
    state.pages=Array.isArray(data?.pages)?data.pages:[];
    state.documents=Array.isArray(data?.documents)?data.documents:[];
    state.events=Array.isArray(data?.events)?data.events:[];
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
