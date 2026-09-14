(()=>{
  'use strict';
  if(window.__KPTU_PUBLIC_WORKSPACE__)return;
  window.__KPTU_PUBLIC_WORKSPACE__=true;
  const rt=window.KPTURuntime;
  if(!rt?.api)return;
  const state={spaces:[],tasks:[],pages:[]};
  const PUBLIC_VIEWS=new Set(['projects','pages']);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>v?new Date(v).toLocaleDateString('ko-KR'):'';
  const taskLabel={todo:'할 일',doing:'진행',done:'완료',blocked:'막힘'};
  const priorityLabel={urgent:'긴급',high:'높음',normal:'보통',low:'낮음'};

  function normalizePublicRoute(){
    const u=new URL(location.href);
    let view=u.searchParams.get('view');
    if(!PUBLIC_VIEWS.has(view)){
      view='projects';u.searchParams.set('view',view);
      history.replaceState({...history.state,kptuView:view},'',u.pathname+u.search+u.hash);
    }
    return view;
  }
  function installStyle(){
    if(document.getElementById('publicWorkspaceCss'))return;
    const style=document.createElement('style');style.id='publicWorkspaceCss';style.textContent=`
      body.kptu-public-workspace .public-hidden{display:none!important}
      .public-readonly-badge{display:inline-flex;align-items:center;font-size:10px;font-weight:900;color:#48647f;background:#edf3f8;border-radius:999px;padding:4px 8px;margin-left:5px}
      .public-project-meta{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px;color:#77848f;font-size:10px}
      .public-project-detail{display:grid;gap:18px}.public-project-detail section{border-top:1px solid #e8edf0;padding-top:14px}.public-project-detail section:first-child{border-top:0;padding-top:0}
      .public-project-detail h3{font-size:14px;margin:0 0 9px}.public-project-task{display:grid;gap:3px;padding:9px 0;border-bottom:1px solid #eef1f3}.public-project-task:last-child{border-bottom:0}
      .public-project-task b{font-size:13px}.public-project-task span,.public-project-task small{font-size:10.5px;color:#6f7c87}.public-page-actions{display:flex;justify-content:flex-end;margin-top:10px}
      .public-child-list{display:grid;gap:7px}.public-child{border:1px solid #dfe6eb;background:#fafcfd;border-radius:11px;padding:10px 12px;text-align:left;color:inherit}.public-child b{display:block;font-size:12px}.public-child span{display:block;margin-top:3px;font-size:10.5px;color:#72808b}
    `;document.head.appendChild(style);
  }
  function showApp(){
    document.body.classList.add('kptu-public-workspace');
    document.getElementById('authView')?.classList.add('hidden');
    document.getElementById('bootstrapView')?.classList.add('hidden');
    document.getElementById('appView')?.classList.remove('hidden');
    const role=document.getElementById('workspaceRole');if(role)role.innerHTML='로그인 없이 공개 업무를 열람할 수 있습니다. <span class="public-readonly-badge">읽기 전용</span>';
    const badge=document.getElementById('userBadge');if(badge){badge.textContent='공개 열람';badge.classList.remove('hidden')}
    document.getElementById('logoutBtn')?.classList.add('hidden');
    let login=document.getElementById('publicLoginBtn');
    if(!login){login=document.createElement('button');login.id='publicLoginBtn';login.type='button';login.className='secondary';login.textContent='로그인';login.onclick=()=>location.href=window.KPTUAuth.loginUrl(location.href);document.querySelector('.top-actions')?.appendChild(login)}
    document.querySelectorAll('.app-nav [data-view]').forEach(btn=>btn.classList.toggle('public-hidden',!PUBLIC_VIEWS.has(btn.dataset.view)));
    document.querySelectorAll('#appView .view-panel').forEach(panel=>{const view=panel.id?.replace(/View$/,'');if(view&&!PUBLIC_VIEWS.has(view))panel.classList.add('public-hidden')});
    ['quickInviteBtn','quickTaskBtn','newEventBtn','homeAddEvent','newTaskBtn','newDocumentBtn','newMeetingBtn','newPageBtn','inviteBtn','newGroupBtn','newProjectBtn'].forEach(id=>document.getElementById(id)?.classList.add('public-hidden'));
    document.querySelectorAll('.admin-only').forEach(x=>x.classList.add('public-hidden'));
    const p=document.querySelector('#projectsView .section-head p');if(p)p.textContent='공개된 사업의 개요와 프로젝트 할 일을 볼 수 있습니다.';
    const pp=document.querySelector('#pagesView .section-head p');if(pp)pp.textContent='공개 상태로 게시된 페이지를 로그인 없이 볼 수 있습니다.';
  }
  const children=id=>state.spaces.filter(x=>x.parent_id===id);
  const tasks=id=>state.tasks.filter(x=>x.project_id===id);
  const pages=id=>state.pages.filter(x=>x.space_id===id);
  function renderProjects(){
    const grid=document.getElementById('projectGrid');if(!grid)return;
    const tops=state.spaces.filter(x=>!x.parent_id&&x.status!=='archived');
    grid.innerHTML=tops.length?tops.map(p=>`<button class="project-card" data-public-project="${esc(p.id)}" type="button"><span class="badge">공개</span><h3>${esc(p.name)}</h3><p>${esc(p.description||'')}</p><div class="public-project-meta"><span>미완료 할 일 ${tasks(p.id).filter(t=>t.status!=='done').length}</span><span>하위 프로젝트 ${children(p.id).length}</span></div></button>`).join(''):'<div class="empty">현재 공개된 프로젝트가 없습니다.</div>';
    const stat=document.getElementById('statProjects');if(stat)stat.textContent=tops.length;
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
    if(filter){filter.innerHTML='<option value="published">공개 게시</option>';filter.disabled=true}
    const paint=()=>{const q=(search?.value||'').trim().toLowerCase(),rows=state.pages.filter(p=>!q||`${p.title||''} ${p.summary||''}`.toLowerCase().includes(q));list.innerHTML=rows.map(p=>`<article class="page-card"><div class="badges"><span class="badge published">공개</span></div><h3>${esc(p.title)}</h3><p>${esc(p.summary||'')}</p><div class="page-card-foot"><span class="updated">${fmt(p.updated_at)}</span><a class="mini" href="../p/${encodeURIComponent(p.slug)}/" target="_blank" rel="noopener">열기</a></div></article>`).join('');document.getElementById('pageEmpty')?.classList.toggle('hidden',!!rows.length)};
    if(search)search.oninput=paint;paint();
  }
  async function load(){
    const data=await rt.api('/rest/v1/rpc/app_public_projects_snapshot',{method:'POST',body:{},auth:false});
    state.spaces=Array.isArray(data?.spaces)?data.spaces:[];
    state.tasks=(Array.isArray(data?.tasks)?data.tasks:[]).filter(t=>!!t.project_id);
    state.pages=Array.isArray(data?.pages)?data.pages:[];
  }
  async function init(){
    const initialView=normalizePublicRoute();
    installStyle();showApp();
    document.addEventListener('click',e=>{const p=e.target.closest?.('[data-public-project]');if(p){e.preventDefault();openProject(p.dataset.publicProject)}},true);
    try{await load();renderProjects();renderPages();window.KPTURouter?.go?.(initialView,{source:'public',updateUrl:false,scroll:false})}catch(err){console.error(err);const grid=document.getElementById('projectGrid');if(grid)grid.innerHTML='<div class="empty">공개 프로젝트를 불러오지 못했습니다.</div>'}
    document.querySelector('#authPreloadStyle')?.remove();window.__KPTU_MARK_APP_UI_READY__?.();
  }
  init();
})();
