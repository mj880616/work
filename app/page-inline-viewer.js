(()=>{
  'use strict';
  if(window.__KPTU_PAGE_INLINE_VIEWER__)return;
  window.__KPTU_PAGE_INLINE_VIEWER__=true;

  const PARAM='page';
  let currentId='';
  let opening=false;

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function pageIdFromUrl(){return new URLSearchParams(location.search).get(PARAM)||''}
  function setPageInUrl(id,{replace=false}={}){
    const u=new URL(location.href);
    if(id){u.searchParams.set('view','pages');u.searchParams.set(PARAM,id)}
    else u.searchParams.delete(PARAM);
    const next=u.pathname+(u.search||'')+u.hash;
    const state={...(history.state||{}),kptuPage:id||null,kptuView:'pages'};
    if(replace)history.replaceState(state,'',next);else history.pushState(state,'',next);
  }

  function ensureStyle(){
    if(document.querySelector('#pageInlineViewerStyle'))return;
    const s=document.createElement('style');
    s.id='pageInlineViewerStyle';
    s.textContent=`
      #pageList .page-card[data-inline-page]{cursor:pointer;transition:border-color .14s ease,box-shadow .14s ease,transform .14s ease}
      #pageList .page-card[data-inline-page]:hover{border-color:#b8c7d5;box-shadow:0 9px 24px rgba(20,33,48,.075);transform:translateY(-1px)}
      #pageList .page-card[data-inline-page]:focus-visible{outline:3px solid rgba(49,95,149,.18);outline-offset:2px}
      .piv-viewer{background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 8px 26px rgba(20,33,48,.055)}
      .piv-toolbar{display:flex;align-items:center;gap:12px;padding:13px 16px;border-bottom:1px solid var(--line);background:#fbfcfd;position:sticky;top:68px;z-index:3}
      .piv-back{border:1px solid #d5dde5;background:#fff;color:#445262;border-radius:9px;padding:7px 10px;font-weight:850;font-size:12px;white-space:nowrap}
      .piv-title{min-width:0;flex:1}.piv-title b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.piv-title small{display:block;color:var(--muted);font-size:10px;margin-top:2px}
      .piv-actions{display:flex;gap:6px;align-items:center}.piv-actions .mini{text-decoration:none}
      .piv-frame{display:block;width:100%;height:calc(100vh - 188px);min-height:680px;border:0;background:#fff}
      .piv-draft{padding:42px 48px 64px;max-width:980px;margin:0 auto}.piv-draft h1{font-size:30px;line-height:1.25;margin:0 0 10px}.piv-draft .piv-summary{color:var(--muted);font-size:15px;margin-bottom:28px}.piv-draft pre{white-space:pre-wrap;word-break:break-word;font:inherit;line-height:1.8;margin:0;color:#263442}
      @media(max-width:760px){.piv-toolbar{top:56px;padding:10px 11px;gap:8px}.piv-title small{display:none}.piv-actions [data-piv-external]{display:none}.piv-frame{height:calc(100vh - 132px);min-height:560px}.piv-draft{padding:26px 18px 80px}.piv-draft h1{font-size:25px}}
    `;
    document.head.appendChild(s);
  }

  function ensureViewer(){
    const view=document.querySelector('#pagesView');
    if(!view)return null;
    let box=document.querySelector('#pageInlineViewer');
    if(box)return box;
    box=document.createElement('div');
    box.id='pageInlineViewer';
    box.className='piv-viewer hidden';
    box.innerHTML=`<div class="piv-toolbar"><button class="piv-back" type="button" data-piv-back>← 게시 목록</button><div class="piv-title"><b id="pivTitle">게시글</b><small id="pivMeta"></small></div><div class="piv-actions"><button class="mini" type="button" data-piv-edit>편집</button><a class="mini" data-piv-external target="_blank" rel="noopener">새 창</a></div></div><iframe id="pivFrame" class="piv-frame hidden" title="게시글 미리보기"></iframe><article id="pivDraft" class="piv-draft hidden"></article>`;
    view.appendChild(box);
    return box;
  }

  function listParts(){
    const view=document.querySelector('#pagesView');
    return [view?.querySelector(':scope > .section-head'),view?.querySelector(':scope > .toolbar'),document.querySelector('#pageList'),document.querySelector('#pageEmpty')].filter(Boolean);
  }

  function showList({sync=true}={}){
    const box=ensureViewer();
    box?.classList.add('hidden');
    listParts().forEach(el=>el.classList.remove('hidden'));
    const frame=document.querySelector('#pivFrame');
    if(frame){frame.src='about:blank';frame.classList.add('hidden')}
    document.querySelector('#pivDraft')?.classList.add('hidden');
    currentId='';
    if(sync&&pageIdFromUrl())setPageInUrl('',{replace:true});
  }

  function showViewer(){
    listParts().forEach(el=>el.classList.add('hidden'));
    ensureViewer()?.classList.remove('hidden');
  }

  async function fetchPage(id){
    const rows=await window.KPTURuntime.api('/rest/v1/app_pages?id=eq.'+encodeURIComponent(id)+'&select=id,space_id,slug,title,summary,body,visibility,status,updated_at&limit=1');
    return rows?.[0]||null;
  }

  function renderDraft(row){
    const frame=document.querySelector('#pivFrame');
    const draft=document.querySelector('#pivDraft');
    frame?.classList.add('hidden');
    if(frame)frame.src='about:blank';
    if(!draft)return;
    draft.innerHTML=`<h1>${esc(row.title||'제목 없음')}</h1>${row.summary?`<div class="piv-summary">${esc(row.summary)}</div>`:''}<pre>${esc(row.body||'내용이 없습니다.')}</pre>`;
    draft.classList.remove('hidden');
  }

  async function openPage(id,{sync=true}={}){
    if(!id||opening)return;
    opening=true;
    try{
      window.KPTURouter?.go?.('pages',{source:'page-inline',scroll:false,updateUrl:true,replaceUrl:true});
      showViewer();
      document.querySelector('#pivTitle').textContent='불러오는 중…';
      document.querySelector('#pivMeta').textContent='';
      const row=await fetchPage(id);
      if(!row){showList({sync:false});return}
      currentId=id;
      document.querySelector('#pivTitle').textContent=row.title||'게시글';
      document.querySelector('#pivMeta').textContent=[row.status,row.visibility,row.updated_at?new Date(row.updated_at).toLocaleString('ko-KR'):null].filter(Boolean).join(' · ');
      const edit=document.querySelector('[data-piv-edit]');
      if(edit)edit.dataset.pageId=id;
      const external=document.querySelector('[data-piv-external]');
      const publishable=row.status==='published'&&['public','unlisted'].includes(row.visibility)&&row.slug;
      if(publishable){
        const url=new URL('../p/',location.href);url.searchParams.set('slug',row.slug);
        if(external){external.href=url.href;external.classList.remove('hidden')}
        const draft=document.querySelector('#pivDraft');draft?.classList.add('hidden');
        const frame=document.querySelector('#pivFrame');
        if(frame){frame.src=url.href;frame.classList.remove('hidden')}
      }else{
        external?.classList.add('hidden');
        renderDraft(row);
      }
      if(sync&&pageIdFromUrl()!==id)setPageInUrl(id);
      window.scrollTo({top:0,behavior:'instant'});
    }catch(err){
      const draft=document.querySelector('#pivDraft');
      document.querySelector('#pivFrame')?.classList.add('hidden');
      if(draft){draft.innerHTML=`<div class="empty">게시글을 불러오지 못했습니다.<br>${esc(err?.message||err)}</div>`;draft.classList.remove('hidden')}
    }finally{opening=false}
  }

  function decorateCards(){
    document.querySelectorAll('#pageList .page-card').forEach(card=>{
      const id=card.querySelector('[data-edit-page]')?.dataset.editPage;
      if(!id)return;
      card.dataset.inlinePage=id;
      card.tabIndex=0;
      card.setAttribute('role','button');
      card.setAttribute('aria-label',(card.querySelector('h3')?.textContent||'게시글')+' 열기');
      card.querySelectorAll('a.mini[href*="../p/?slug="]').forEach(a=>a.remove());
    });
  }

  function restore(){
    if(!document.querySelector('#pagesView')||document.querySelector('#pagesView')?.classList.contains('hidden'))return;
    const id=pageIdFromUrl();
    if(id){if(id!==currentId)openPage(id,{sync:false})}
    else showList({sync:false});
  }

  function install(){
    ensureStyle();ensureViewer();decorateCards();
    const list=document.querySelector('#pageList');
    if(list)new MutationObserver(()=>setTimeout(decorateCards,0)).observe(list,{childList:true,subtree:true});
    document.addEventListener('click',e=>{
      const back=e.target.closest?.('[data-piv-back]');
      if(back){showList();return}
      const edit=e.target.closest?.('[data-piv-edit]');
      if(edit){const id=edit.dataset.pageId;if(id)document.querySelector(`[data-edit-page="${CSS.escape(id)}"]`)?.click();return}
      const card=e.target.closest?.('#pageList .page-card[data-inline-page]');
      if(!card||e.target.closest('button,a,input,select,textarea,label'))return;
      openPage(card.dataset.inlinePage);
    });
    document.addEventListener('keydown',e=>{
      if(!['Enter',' '].includes(e.key))return;
      const card=e.target.closest?.('#pageList .page-card[data-inline-page]');
      if(!card)return;e.preventDefault();openPage(card.dataset.inlinePage);
    });
    window.KPTURouter?.on?.('pages',()=>setTimeout(()=>{decorateCards();restore()},20));
    window.addEventListener('popstate',()=>setTimeout(restore,0));
    window.addEventListener('kptu:session-changed',()=>setTimeout(restore,100));
    setTimeout(restore,250);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
