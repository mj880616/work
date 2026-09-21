const rt=window.KPTURuntime;
const caps=window.KPTUCapabilities;
let pages=[],spaces=[];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusLabel={draft:'초안',review:'검토중',published:'게시',archived:'보관'};
const visibilityLabel={public:'공개',unlisted:'링크 공개',workspace:'내부',groups:'지정 그룹',private:'비공개'};
const phaseLabel={preparation:'준비',in_progress:'진행',consultation:'협의',execution:'실행',follow_up:'후속',done:'종료'};
const typeLabel={ongoing:'상시사업',campaign:'의제사업',event:'행사',knowledge:'자료'};
function projectName(id){return spaces.find(x=>x.id===id)?.name||''}
function projectSearchText(id){
  const names=[],seen=new Set();
  let current=spaces.find(x=>x.id===id);
  while(current&&!seen.has(current.id)){
    seen.add(current.id);names.push(current.name||'');
    current=current.parent_id?spaces.find(x=>x.id===current.parent_id):null;
  }
  return names.join(' ');
}
function visibleRows(){
  const q=(document.querySelector('#pageSearch')?.value||'').trim().toLowerCase();
  const filter=document.querySelector('#pageFilter')?.value||'all';
  return pages.filter(p=>!p.metadata?.web1_trial_import&&!String(p.slug||'').startsWith('media-')&&(filter==='all'||p.status===filter)&&(!q||`${p.title||''} ${p.summary||''} ${projectSearchText(p.space_id)}`.toLowerCase().includes(q)));
}
function pageCard(p){
  const project=projectName(p.space_id);
  const publicPage=p.status==='published'&&['public','unlisted'].includes(p.visibility)&&p.slug;
  const publication=publicPage?visibilityLabel[p.visibility]:'비공개';
  const updated=p.updated_at?`<time datetime="${esc(p.updated_at)}">${esc(new Date(p.updated_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric'}))}</time>`:'';
  const publicActions=publicPage?`<a class="mini" data-page-shortcut="1" href="../p/?slug=${encodeURIComponent(p.slug)}&external=1" target="_blank" rel="noopener">공개 열기</a><button class="mini" type="button" data-copy-page="${esc(p.slug)}">링크 복사</button>`:'';
  return `<article class="page-card compact-entry" data-inline-page="${esc(p.id)}" data-page-card-id="${esc(p.id)}">
    <div class="compact-entry-main page-row-open" role="button" tabindex="0" aria-label="${esc(p.title)} 열기">
      <div class="page-row-title"><h3>${esc(p.title)}</h3><span class="page-visibility ${publicPage?'is-public':'is-private'}" data-page-visibility>${esc(publication)}</span></div>
      <p class="compact-entry-summary">${esc(p.summary||'요약 없음')}</p>
      <div class="page-row-meta"><span>${esc(statusLabel[p.status]||p.status)}</span>${project?`<span>${esc(project)}</span>`:''}${updated}</div>
    </div>
    <div class="page-card-foot compact-entry-actions"><details class="page-row-menu"><summary aria-label="${esc(p.title)} 메뉴">⋯</summary><div class="card-actions page-row-menu-panel">
      <button class="mini" type="button" data-edit-page="${esc(p.id)}">편집</button><button class="mini" type="button" data-page-visibility-action="${esc(p.id)}">공개 설정</button>${publicActions}<button class="mini page-row-danger" type="button" data-page-select-delete="${esc(p.id)}">삭제 선택</button>
    </div></details></div>
  </article>`;
}
function projectMeta(space){
  const bits=[typeLabel[space.project_type]||'',phaseLabel[space.current_phase]||'',space.end_on?`~ ${space.end_on}`:''].filter(Boolean);
  return bits.join(' · ');
}
function projectHeader(space,{root=false,count=0}={}){
  const meta=projectMeta(space);
  return `<button class="${root?'board-root-link':'board-child-link'}" type="button" data-board-project="${esc(space.id)}">
    <span class="board-project-title">${esc(space.name)}</span>
    ${meta?`<span class="board-project-meta">${esc(meta)}</span>`:''}
    <span class="board-page-count">${count}개</span>
  </button>`;
}
function renderBoard(rows){
  const bySpace=new Map();
  const unassigned=[];
  rows.forEach(p=>{
    if(p.space_id){
      if(!bySpace.has(p.space_id))bySpace.set(p.space_id,[]);
      bySpace.get(p.space_id).push(p);
    }else unassigned.push(p);
  });
  const spaceMap=new Map(spaces.map(s=>[s.id,s]));
  const children=new Map();
  spaces.forEach(s=>{
    if(!s.parent_id)return;
    if(!children.has(s.parent_id))children.set(s.parent_id,[]);
    children.get(s.parent_id).push(s);
  });
  const q=(document.querySelector('#pageSearch')?.value||'').trim();
  const filter=document.querySelector('#pageFilter')?.value||'all';
  const filtering=Boolean(q)||filter!=='all';
  const roots=spaces.filter(s=>!s.parent_id&&s.status!=='archived'&&!s.is_legacy_snapshot);
  const html=[];
  roots.forEach(root=>{
    const direct=bySpace.get(root.id)||[];
    const childRows=(children.get(root.id)||[]).filter(c=>c.status!=='archived'&&!c.is_legacy_snapshot);
    const childPageCount=childRows.reduce((n,c)=>n+(bySpace.get(c.id)?.length||0),0);
    if(filtering&&!direct.length&&!childPageCount)return;
    const total=direct.length+childPageCount;
    const body=[];
    if(direct.length){
      body.push(`<div class="board-common"><div class="board-subhead">공통 페이지</div><div class="board-page-list">${direct.map(pageCard).join('')}</div></div>`);
    }
    childRows.forEach(child=>{
      const childPages=bySpace.get(child.id)||[];
      if(filtering&&!childPages.length)return;
      body.push(`<section class="board-child" data-board-child="${esc(child.id)}">
        ${projectHeader(child,{count:childPages.length})}
        <div class="board-page-list">${childPages.length?childPages.map(pageCard).join(''):'<div class="board-no-pages">연결된 페이지가 없습니다.</div>'}</div>
      </section>`);
    });
    if(!body.length)body.push('<div class="board-no-pages">아직 연결된 페이지가 없습니다.</div>');
    html.push(`<section class="board-root" data-board-root="${esc(root.id)}">
      <div class="board-root-head">${projectHeader(root,{root:true,count:total})}</div>
      <div class="board-root-body">${body.join('')}</div>
    </section>`);
  });
  const known=new Set(spaces.map(s=>s.id));
  rows.forEach(p=>{if(p.space_id&&!known.has(p.space_id))unassigned.push(p)});
  if(unassigned.length){
    html.push(`<section class="board-root board-unassigned"><div class="board-root-head"><div class="board-static-title">기타 페이지 <span>${unassigned.length}개</span></div></div><div class="board-root-body"><div class="board-page-list">${unassigned.map(pageCard).join('')}</div></div></section>`);
  }
  return html.join('');
}
function render(){
  const list=document.querySelector('#pageList');
  if(!list)return;
  const rows=visibleRows();
  const html=renderBoard(rows);
  document.querySelector('#pageEmpty')?.classList.toggle('hidden',Boolean(html));
  list.innerHTML=html;
  window.dispatchEvent(new CustomEvent('kptu:pages-rendered',{detail:{count:rows.length}}));
}
async function refresh(){
  const workspaceId=caps?.workspaceId?.();
  if(!rt||!workspaceId)return false;
  [pages,spaces]=await Promise.all([
    rt.api(`/rest/v1/app_pages?workspace_id=eq.${workspaceId}&select=id,space_id,slug,title,summary,visibility,status,owner_id,legacy_path,published_at,created_at,updated_at,metadata&order=updated_at.desc`),
    rt.api(`/rest/v1/app_spaces?workspace_id=eq.${workspaceId}&select=id,name,parent_id,status,sort_order,project_type,current_phase,start_on,end_on,is_legacy_snapshot,metadata,updated_at&order=sort_order.asc,created_at.asc`)
  ]);
  window.__KPTU_SYNC_TEAM_PAGES__?.(pages);
  render();
  return true;
}
function openProject(id){
  if(!id)return;
  window.KPTURouter?.go?.('projects',{source:'board'});
  requestAnimationFrame(()=>{
    const target=[...document.querySelectorAll('#projectGrid [data-ps3-project]')].find(el=>el.dataset.ps3Project===id);
    target?.click?.();
  });
}
function bind(){
  const search=document.querySelector('#pageSearch'),filter=document.querySelector('#pageFilter');
  if(search)search.oninput=render;
  if(filter)filter.onchange=render;
  document.addEventListener('click',e=>{
    const project=e.target.closest?.('[data-board-project]');
    if(project){e.preventDefault();openProject(project.dataset.boardProject)}
  });
  window.KPTURouter?.on?.('pages',render);
  window.addEventListener('kptu:pages-changed',()=>refresh().catch(console.error));
  window.addEventListener('kptu:projects-changed',()=>refresh().catch(console.error));
}
async function init(){bind();return refresh()}
window.KPTUPageList={refresh,render,getPages:()=>[...pages]};
window.__KPTU_PAGE_LIST_READY__=init().catch(e=>{console.warn('page list init',e);return false});
