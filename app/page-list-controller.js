const rt=window.KPTURuntime;
const caps=window.KPTUCapabilities;
let pages=[],spaces=[];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusLabel={draft:'초안',review:'검토중',published:'게시',archived:'보관'};
const visibilityLabel={public:'공개',unlisted:'링크 공개',workspace:'내부',groups:'지정 그룹',private:'비공개'};
function projectName(id){return spaces.find(x=>x.id===id)?.name||''}
function visibleRows(){const q=(document.querySelector('#pageSearch')?.value||'').trim().toLowerCase();const filter=document.querySelector('#pageFilter')?.value||'all';return pages.filter(p=>!p.metadata?.web1_trial_import&&!String(p.slug||'').startsWith('media-')&&(filter==='all'||p.status===filter)&&(!q||`${p.title||''} ${p.summary||''}`.toLowerCase().includes(q)))}
function render(){
  const list=document.querySelector('#pageList');
  if(!list)return;
  const rows=visibleRows();
  document.querySelector('#pageEmpty')?.classList.toggle('hidden',rows.length>0);
  list.innerHTML=rows.map(p=>{
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
  }).join('');
  window.dispatchEvent(new CustomEvent('kptu:pages-rendered',{detail:{count:rows.length}}));
}
async function refresh(){const workspaceId=caps?.workspaceId?.();if(!rt||!workspaceId)return false;[pages,spaces]=await Promise.all([rt.api(`/rest/v1/app_pages?workspace_id=eq.${workspaceId}&select=id,space_id,slug,title,summary,visibility,status,owner_id,legacy_path,published_at,created_at,updated_at,metadata&order=updated_at.desc`),rt.api(`/rest/v1/app_spaces?workspace_id=eq.${workspaceId}&select=id,name&order=sort_order.asc,created_at.asc`)]);window.__KPTU_SYNC_TEAM_PAGES__?.(pages);render();return true}
function bind(){const search=document.querySelector('#pageSearch'),filter=document.querySelector('#pageFilter');if(search)search.oninput=render;if(filter)filter.onchange=render;window.KPTURouter?.on?.('pages',render);window.addEventListener('kptu:pages-changed',()=>refresh().catch(console.error))}
async function init(){bind();return refresh()}
window.KPTUPageList={refresh,render,getPages:()=>[...pages]};
window.__KPTU_PAGE_LIST_READY__=init().catch(e=>{console.warn('page list init',e);return false});
