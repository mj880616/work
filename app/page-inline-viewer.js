(()=>{
  'use strict';
  if(window.__KPTU_PAGE_INLINE_VIEWER__)return;
  window.__KPTU_PAGE_INLINE_VIEWER__=true;

  const PARAM='page';
  let currentId='';
  let opening=false;

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const STATUS_LABELS={draft:'초안',review:'검토중',published:'게시',archived:'보관'};
  const VISIBILITY_LABELS={public:'공개',unlisted:'링크 공개',workspace:'팀 공개',groups:'그룹 공개',private:'비공개'};

  function pageIdFromUrl(){return new URLSearchParams(location.search).get(PARAM)||''}
  function setPageInUrl(id,{replace=false}={}){
    const u=new URL(location.href);
    if(id){u.searchParams.set('view','pages');u.searchParams.set(PARAM,id)}
    else u.searchParams.delete(PARAM);
    const next=u.pathname+(u.search||'')+u.hash;
    const state={...(history.state||{}),kptuPage:id||null,kptuView:'pages'};
    if(replace)history.replaceState(state,'',next);else history.pushState(state,'',next);
  }

  function formatDate(value){
    if(!value)return '';
    const d=new Date(value);
    if(Number.isNaN(d.getTime()))return '';
    return d.toLocaleString('ko-KR',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});
  }

  function ensureStyle(){
    if(document.querySelector('#pageInlineViewerStyle'))return;
    const s=document.createElement('style');
    s.id='pageInlineViewerStyle';
    s.textContent=`
      #pageList .page-card[data-inline-page]{cursor:pointer;transition:border-color .14s ease,box-shadow .14s ease,transform .14s ease}
      #pageList .page-card[data-inline-page]:hover{border-color:#b8c7d5;box-shadow:0 9px 24px rgba(20,33,48,.075);transform:translateY(-1px)}
      #pageList .page-card[data-inline-page]:focus-visible{outline:3px solid rgba(49,95,149,.18);outline-offset:2px}
      .piv-viewer{width:100%}
      .piv-toolbar{display:flex;align-items:center;gap:12px;margin-bottom:14px;min-height:40px}
      .piv-back{border:0;background:transparent;color:#52606d;border-radius:9px;padding:7px 2px;font-weight:850;font-size:13px;white-space:nowrap}
      .piv-back:hover{color:var(--navy)}
      .piv-toolbar-spacer{flex:1}
      .piv-actions{display:flex;gap:7px;align-items:center}.piv-actions .mini{text-decoration:none;padding:7px 10px;font-size:12px}
      .piv-sheet{background:#fff;border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(20,33,48,.055)}
      .piv-head{padding:40px 48px 30px;border-bottom:1px solid #edf0f3;background:linear-gradient(180deg,#fff 0%,#fcfdfe 100%)}
      .piv-kicker{font-size:11px;letter-spacing:.12em;font-weight:900;color:var(--blue);margin-bottom:13px}
      .piv-head h1{font-size:34px;line-height:1.25;letter-spacing:-.7px;margin:0;max-width:900px;word-break:keep-all;overflow-wrap:anywhere}
      .piv-summary{max-width:900px;margin:14px 0 0;color:#626e7a;font-size:16px;line-height:1.7;word-break:keep-all;overflow-wrap:anywhere}
      .piv-badges{display:flex;gap:7px;flex-wrap:wrap;margin-top:21px}
      .piv-chip{display:inline-flex;align-items:center;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:850;background:#eef2f5;color:#566370}
      .piv-chip.published{background:#eaf5ee;color:var(--green)}.piv-chip.review{background:#fff4df;color:var(--amber)}.piv-chip.public,.piv-chip.unlisted{background:#e9f2fb;color:var(--blue)}
      .piv-content{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:44px;padding:36px 48px 58px;align-items:start}
      .piv-body{min-width:0;font-size:15.5px;line-height:1.9;color:#273441;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere}
      .piv-body:empty:before{content:'내용이 없습니다.';color:var(--muted)}
      .piv-aside{border-left:1px solid #edf0f3;padding-left:22px;color:var(--muted)}
      .piv-aside h2{font-size:12px;letter-spacing:.08em;color:#65717d;margin:0 0 16px;text-transform:uppercase}
      .piv-info{margin:0 0 15px}.piv-info dt{font-size:10px;font-weight:900;color:#89939d;margin-bottom:3px}.piv-info dd{font-size:12px;line-height:1.55;color:#4d5965;margin:0;word-break:break-word}
      .piv-loading{padding:90px 24px;text-align:center;color:var(--muted);font-size:13px}
      .piv-error{padding:70px 24px;text-align:center;color:var(--muted)}
      @media(max-width:820px){.piv-head{padding:32px 30px 26px}.piv-content{grid-template-columns:1fr;gap:28px;padding:30px 30px 48px}.piv-aside{border-left:0;border-top:1px solid #edf0f3;padding:22px 0 0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.piv-aside h2{grid-column:1/-1;margin-bottom:0}.piv-info{margin:0}.piv-head h1{font-size:30px}}
      @media(max-width:760px){.piv-toolbar{margin-bottom:10px;gap:7px}.piv-actions [data-piv-external]{display:none}.piv-actions .mini{padding:6px 8px}.piv-sheet{border-radius:16px}.piv-head{padding:26px 20px 22px}.piv-kicker{margin-bottom:10px}.piv-head h1{font-size:26px;letter-spacing:-.45px}.piv-summary{font-size:14px;margin-top:11px}.piv-badges{margin-top:17px}.piv-content{padding:24px 20px 46px}.piv-body{font-size:15px;line-height:1.82}.piv-aside{grid-template-columns:1fr 1fr}.piv-info:last-child{grid-column:1/-1}}
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
    box.innerHTML=`<div class="piv-toolbar"><button class="piv-back" type="button" data-piv-back>← 게시 목록</button><div class="piv-toolbar-spacer"></div><div class="piv-actions"><button class="mini" type="button" data-piv-edit>편집</button><a class="mini hidden" data-piv-external target="_blank" rel="noopener">공개 페이지</a></div></div><article id="pivSheet" class="piv-sheet"><div class="piv-loading">게시글을 불러오는 중입니다.</div></article>`;
    view.appendChild(box);
    return box;
  }

  function listParts(){
    const view=document.querySelector('#pagesView');
    return [view?.querySelector(':scope > .section-head'),view?.querySelector(':scope > .toolbar'),document.querySelector('#pageList')].filter(Boolean);
  }

  function showList({sync=true}={}){
    const box=ensureViewer();
    box?.classList.add('hidden');
    listParts().forEach(el=>el.classList.remove('hidden'));
    const empty=document.querySelector('#pageEmpty');
    if(empty)empty.classList.toggle('hidden',!!document.querySelector('#pageList')?.children.length);
    currentId='';
    if(sync&&pageIdFromUrl())setPageInUrl('',{replace:true});
  }

  function showViewer(){
    listParts().forEach(el=>el.classList.add('hidden'));
    document.querySelector('#pageEmpty')?.classList.add('hidden');
    ensureViewer()?.classList.remove('hidden');
  }

  async function fetchPage(id){
    const rows=await window.KPTURuntime.api('/rest/v1/app_pages?id=eq.'+encodeURIComponent(id)+'&select=id,space_id,slug,title,summary,body,visibility,status,updated_at&limit=1');
    return rows?.[0]||null;
  }

  function renderPage(row){
    const sheet=document.querySelector('#pivSheet');
    if(!sheet)return;
    const status=row.status||'draft';
    const visibility=row.visibility||'private';
    const updated=formatDate(row.updated_at);
    sheet.innerHTML=`
      <header class="piv-head">
        <div class="piv-kicker">게시글 상세</div>
        <h1>${esc(row.title||'제목 없음')}</h1>
        ${row.summary?`<p class="piv-summary">${esc(row.summary)}</p>`:''}
        <div class="piv-badges">
          <span class="piv-chip ${esc(status)}">${esc(STATUS_LABELS[status]||status)}</span>
          <span class="piv-chip ${esc(visibility)}">${esc(VISIBILITY_LABELS[visibility]||visibility)}</span>
        </div>
      </header>
      <div class="piv-content">
        <div class="piv-body">${esc(row.body||'')}</div>
        <aside class="piv-aside" aria-label="문서 정보">
          <h2>문서 정보</h2>
          <dl class="piv-info"><dt>상태</dt><dd>${esc(STATUS_LABELS[status]||status)}</dd></dl>
          <dl class="piv-info"><dt>공개 범위</dt><dd>${esc(VISIBILITY_LABELS[visibility]||visibility)}</dd></dl>
          <dl class="piv-info"><dt>마지막 수정</dt><dd>${esc(updated||'-')}</dd></dl>
        </aside>
      </div>`;
  }

  async function openPage(id,{sync=true}={}){
    if(!id||opening)return;
    opening=true;
    try{
      window.KPTURouter?.go?.('pages',{source:'page-inline',scroll:false,updateUrl:true,replaceUrl:true});
      showViewer();
      const sheet=document.querySelector('#pivSheet');
      if(sheet)sheet.innerHTML='<div class="piv-loading">게시글을 불러오는 중입니다.</div>';
      const row=await fetchPage(id);
      if(!row){showList({sync:false});return}
      currentId=id;
      const edit=document.querySelector('[data-piv-edit]');
      if(edit)edit.dataset.pageId=id;
      const external=document.querySelector('[data-piv-external]');
      const publishable=row.status==='published'&&['public','unlisted'].includes(row.visibility)&&row.slug;
      if(publishable){
        const url=new URL('../p/',location.href);url.searchParams.set('slug',row.slug);
        if(external){external.href=url.href;external.classList.remove('hidden')}
      }else{
        external?.classList.add('hidden');
        if(external)external.removeAttribute('href');
      }
      renderPage(row);
      if(sync&&pageIdFromUrl()!==id)setPageInUrl(id);
      window.scrollTo({top:0,behavior:'instant'});
    }catch(err){
      const sheet=document.querySelector('#pivSheet');
      if(sheet)sheet.innerHTML=`<div class="piv-error">게시글을 불러오지 못했습니다.<br>${esc(err?.message||err)}</div>`;
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
    if(opening)return;
    const pagesView=document.querySelector('#pagesView');
    if(!pagesView||pagesView.classList.contains('hidden'))return;
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
