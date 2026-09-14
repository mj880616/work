(()=>{
  'use strict';
  if(window.__KPTU_PUBLIC_READONLY__)return;
  window.__KPTU_PUBLIC_READONLY__=true;

  const rt=window.KPTURuntime;
  if(!rt?.api)return;
  const state={spaces:[],tasks:[],pages:[]};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>v?new Date(v).toLocaleString('ko-KR',{year:'numeric',month:'numeric',day:'numeric'}):'';
  const taskLabel={todo:'할 일',doing:'진행',done:'완료',blocked:'막힘'};
  const priorityLabel={urgent:'긴급',high:'높음',normal:'보통',low:'낮음'};

  const style=document.createElement('style');
  style.id='publicReadonlyCss';
  style.textContent=`
    body.kptu-public-readonly #workspaceRole{color:#657383}
    body.kptu-public-readonly .public-hidden{display:none!important}
    .public-readonly-badge{display:inline-flex;align-items:center;font-size:10px;font-weight:900;color:#48647f;background:#edf3f8;border-radius:999px;padding:4px 8px;margin-left:5px}
    .public-project-meta{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px;color:#77848f;font-size:10px}
    .public-project-detail{display:grid;gap:18px}
    .public-project-detail section{border-top:1px solid #e8edf0;padding-top:14px}
    .public-project-detail section:first-child{border-top:0;padding-top:0}
    .public-project-detail h3{font-size:14px;margin:0 0 9px}
    .public-project-task{display:grid;gap:3px;padding:9px 0;border-bottom:1px solid #eef1f3}
    .public-project-task:last-child{border-bottom:0}
    .public-project-task b{font-size:13px}.public-project-task span,.public-project-task small{font-size:10.5px;color:#6f7c87}
    .public-child-list{display:grid;gap:7px}.public-child{border:1px solid #dfe6eb;background:#fafcfd;border-radius:11px;padding:10px 12px;text-align:left;color:inherit}
    .public-child b{display:block;font-size:12px}.public-child span{display:block;margin-top:3px;font-size:10.5px;color:#72808b}
    .public-page-actions{display:flex;justify-content:flex-end;margin-top:10px}
    @media(max-width:700px){.public-project-detail{gap:14px}}
  `;
  document.head.appendChild(style);

  function showOnly(id){
    ['authView','bootstrapView','appView'].forEach(x=>document.getElementById(x)?.classList.toggle('hidden',x!==id));
  }

  function loginView(){
    showOnly('authView');
    document.querySelector('#authPreloadStyle')?.remove();
    let back=document.getElementById('publicBackBtn');
    if(!back){
      back=document.createElement('button');
      back.id='publicBackBtn';
      back.type='button';
      back.className='secondary wide';
      back.textContent='로그인 없이 계속 둘러보기';
      const st=document.getElementById('authStatus');
      st?.insertAdjacentElement('afterend',back);
      back.onclick=()=>{showOnly('appView');window.KPTURouter?.go?.('projects',{source:'public-back',updateUrl:false});window.__KPTU_MARK_APP_UI_READY__?.()};
    }
  }

  function setupShell(){
    document.body.classList.add('kptu-public-readonly');
    showOnly('appView');
    document.getElementById('bootstrapView')?.classList.add('hidden');
    const role=document.getElementById('workspaceRole');
    if(role)role.innerHTML='로그인 없이 공개 업무를 열람할 수 있습니다. <span class="public-readonly-badge">읽기 전용</span>';
    const badge=document.getElementById('userBadge');
    if(badge){badge.textContent='공개 열람';badge.classList.remove('hidden')}
    document.getElementById('logoutBtn')?.classList.add('hidden');
    let login=document.getElementById('publicLoginBtn');
    if(!login){
      login=document.createElement('button');login.id='publicLoginBtn';login.type='button';login.className='secondary';login.textContent='로그인';login.onclick=loginView;
      document.querySelector('.top-actions')?.appendChild(login);
    }
    const allowed=new Set(['projects','pages']);
    document.querySelectorAll('.app-nav [data-view]').forEach(btn=>btn.classList.toggle('public-hidden',!allowed.has(btn.dataset.view)));
    document.querySelectorAll('#appView .view-panel').forEach(panel=>{
      const view=panel.id?.replace(/View$/,'');
      if(view&&!allowed.has(view))panel.classList.add('public-hidden');
    });
    ['quickInviteBtn','quickTaskBtn','newEventBtn','homeAddEvent','newTaskBtn','newDocumentBtn','newMeetingBtn','newPageBtn','inviteBtn','newGroupBtn','newProjectBtn'].forEach(id=>document.getElementById(id)?.classList.add('public-hidden'));
    document.querySelectorAll('.admin-only').forEach(x=>x.classList.add('public-hidden'));
    const pHead=document.querySelector('#projectsView .section-head');
    if(pHead){const h=pHead.querySelector('h2');const p=pHead.querySelector('p');if(h)h.textContent='프로젝트';if(p)p.textContent='공개된 사업의 개요와 프로젝트 할 일을 볼 수 있습니다.'}
    const pageHead=document.querySelector('#pagesView .section-head');
    if(pageHead){const h=pageHead.querySelector('h2');const p=pageHead.querySelector('p');if(h)h.textContent='공개 게시';if(p)p.textContent='공개 상태로 게시된 페이지를 로그인 없이 볼 수 있습니다.'}
  }

  function projectChildren(id){return state.spaces.filter(x=>x.parent_id===id)}
  function projectTasks(id){return state.tasks.filter(x=>x.project_id===id)}
  function projectPages(id){return state.pages.filter(x=>x.space_id===id)}

  function renderProjects(){
    const grid=document.getElementById('projectGrid');if(!grid)return;
    const tops=state.spaces.filter(x=>!x.parent_id&&x.status!=='archived');
    grid.innerHTML=tops.length?tops.map(p=>{
      const children=projectChildren(p.id),open=projectTasks(p.id).filter(t=>t.status!=='done').length;
      return `<button class="project-card" data-public-project="${p.id}" type="button"><span class="badge">공개</span><h3>${esc(p.name)}</h3><p>${esc(p.description||'')}</p><div class="public-project-meta"><span>미완료 할 일 ${open}</span><span>하위 프로젝트 ${children.length}</span>${p.end_on?`<span>~ ${esc(p.end_on)}</span>`:''}</div>${children.length?`<div class="subchips">${children.slice(0,4).map(c=>`<span>${esc(c.name)}</span>`).join('')}</div>`:''}</button>`;
    }).join(''):'<div class="empty">현재 공개된 프로젝트가 없습니다.</div>';
    const stat=document.getElementById('statProjects');if(stat)stat.textContent=tops.length;
  }

  function ensureProjectModal(){
    if(document.getElementById('publicProjectModal'))return;
    document.body.insertAdjacentHTML('beforeend',`<div id="publicProjectModal" class="modal hidden" aria-hidden="true"><div class="modal-card medium-card"><div class="modal-head"><div><div class="eyebrow">PUBLIC PROJECT · READ ONLY</div><h2 id="publicProjectTitle"></h2><p id="publicProjectDescription" class="muted"></p></div><button id="publicProjectClose" class="icon-btn" type="button">×</button></div><div id="publicProjectBody" class="public-project-detail"></div></div></div>`);
    document.getElementById('publicProjectClose').onclick=()=>{const m=document.getElementById('publicProjectModal');m.classList.add('hidden');m.setAttribute('aria-hidden','true')};
  }

  function taskRows(rows){
    if(!rows.length)return '<div class="empty compact">연결된 공개 할 일이 없습니다.</div>';
    return rows.map(t=>`<div class="public-project-task"><b>${esc(t.title)}</b><span>${esc(taskLabel[t.status]||t.status||'')} · 우선순위 ${esc(priorityLabel[t.priority]||t.priority||'보통')}</span>${t.due_at?`<small>기한 ${fmt(t.due_at)}</small>`:''}</div>`).join('');
  }

  function openProject(id){
    const p=state.spaces.find(x=>x.id===id);if(!p)return;
    ensureProjectModal();
    document.getElementById('publicProjectTitle').textContent=p.name;
    document.getElementById('publicProjectDescription').textContent=p.description||'';
    const tasks=projectTasks(id),children=projectChildren(id),pages=projectPages(id);
    document.getElementById('publicProjectBody').innerHTML=`
      <section><h3>프로젝트 할 일</h3>${taskRows(tasks)}</section>
      ${pages.length?`<section><h3>공개 게시</h3>${pages.map(pg=>`<div class="public-project-task"><b>${esc(pg.title)}</b><span>${esc(pg.summary||'')}</span><div class="public-page-actions"><a class="mini" href="../p/${encodeURIComponent(pg.slug)}/" target="_blank" rel="noopener">열기</a></div></div>`).join('')}</section>`:''}
      ${children.length?`<section><h3>하위 프로젝트</h3><div class="public-child-list">${children.map(c=>`<button class="public-child" type="button" data-public-project="${c.id}"><b>${esc(c.name)}</b><span>${esc(c.description||'')}</span></button>`).join('')}</div></section>`:''}
    `;
    const m=document.getElementById('publicProjectModal');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');
  }

  function renderPages(){
    const list=document.getElementById('pageList'),filter=document.getElementById('pageFilter'),search=document.getElementById('pageSearch');if(!list)return;
    if(filter){filter.innerHTML='<option value="published">공개 게시</option>';filter.disabled=true}
    const paint=()=>{
      const q=(search?.value||'').trim().toLowerCase();
      const rows=state.pages.filter(p=>!q||`${p.title||''} ${p.summary||''}`.toLowerCase().includes(q));
      list.innerHTML=rows.map(p=>`<article class="page-card"><div class="page-meta"><span class="badge published">공개</span><span class="updated">${fmt(p.updated_at)}</span></div><h3>${esc(p.title)}</h3><p>${esc(p.summary||'')}</p><div class="page-card-foot"><span></span><a class="mini" href="../p/${encodeURIComponent(p.slug)}/" target="_blank" rel="noopener">열기</a></div></article>`).join('');
      document.getElementById('pageEmpty')?.classList.toggle('hidden',!!rows.length);
    };
    if(search)search.oninput=paint;paint();
  }

  async function load(){
    const data=await rt.api('/rest/v1/rpc/app_public_projects_snapshot',{method:'POST',body:{},auth:false});
    state.spaces=Array.isArray(data?.spaces)?data.spaces:[];
    state.tasks=Array.isArray(data?.tasks)?data.tasks:[];
    state.pages=Array.isArray(data?.pages)?data.pages:[];
  }

  function bind(){
    document.addEventListener('click',e=>{
      const project=e.target.closest?.('[data-public-project]');
      if(project){e.preventDefault();openProject(project.dataset.publicProject)}
    },true);
    window.addEventListener('kptu:session-changed',e=>{if(e.detail?.session)location.reload()});
  }

  async function init(){
    setupShell();bind();
    try{await load();renderProjects();renderPages();window.KPTURouter?.go?.('projects',{source:'public',updateUrl:false});}
    catch(err){console.error('public readonly load',err);const grid=document.getElementById('projectGrid');if(grid)grid.innerHTML='<div class="empty">공개 프로젝트를 불러오지 못했습니다.</div>'}
    window.__KPTU_MARK_APP_UI_READY__?.();
    document.getElementById('authPreloadStyle')?.remove();
  }
  init();
})();
