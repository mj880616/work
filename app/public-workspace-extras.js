(()=>{
  'use strict';
  if(window.__KPTU_PUBLIC_WORKSPACE_EXTRAS__)return;
  window.__KPTU_PUBLIC_WORKSPACE_EXTRAS__=true;
  const rt=window.KPTURuntime;
  if(!rt?.api)return;
  import('./mobile-swipe-navigation.js?v=3').catch(console.error);

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const fmt=v=>v?new Date(v).toLocaleDateString('ko-KR'):'';
  let documents=[];

  function installStyle(){
    if(document.querySelector('#publicWorkspaceExtrasStyle'))return;
    const s=document.createElement('style');
    s.id='publicWorkspaceExtrasStyle';
    s.textContent=`
      .kptu-public-workspace #pageList .page-card[data-public-card-url]{cursor:pointer;transition:border-color .14s ease,box-shadow .14s ease,transform .14s ease}
      .kptu-public-workspace #pageList .page-card[data-public-card-url]:hover{border-color:#b8c7d5;box-shadow:0 9px 24px rgba(20,33,48,.075);transform:translateY(-1px)}
      .kptu-public-workspace #pageList .page-card[data-public-card-url]:focus-visible{outline:3px solid rgba(49,95,149,.18);outline-offset:2px}
      .kptu-public-workspace #pageList .page-card .page-card-foot a.mini{display:none!important}
      .public-library-toolbar{display:flex;gap:8px;margin:0 0 14px}.public-library-toolbar input{width:100%}
      .public-library-list{display:grid;gap:10px}
      .public-library-card{display:block;width:100%;text-align:left;border:1px solid #e2e7eb;border-radius:14px;background:#fff;padding:14px;color:inherit}
      button.public-library-card{cursor:pointer}.public-library-card h3{margin:6px 0 4px;font-size:15px}.public-library-card p{margin:0;color:#65727e;font-size:12px;line-height:1.55}.public-library-card small{display:block;color:#8a949d;font-size:10.5px;margin-top:6px}.public-library-card .badges{display:flex;gap:5px;flex-wrap:wrap}
    `;
    document.head.appendChild(s);
  }

  function decoratePageCards(){
    document.querySelectorAll('#pageList .page-card').forEach(card=>{
      const link=card.querySelector('.page-card-foot a[href]');
      if(!link)return;
      card.dataset.publicCardUrl=link.href;
      card.tabIndex=0;
      card.setAttribute('role','link');
      card.setAttribute('aria-label',(card.querySelector('h3')?.textContent||'게시글')+' 열기');
    });
  }

  function bindPageCards(){
    const list=document.querySelector('#pageList');
    if(!list||list.dataset.publicCardBound==='1')return;
    list.dataset.publicCardBound='1';
    list.addEventListener('click',e=>{
      const card=e.target.closest?.('.page-card[data-public-card-url]');
      if(!card||e.target.closest('button,input,select,textarea,label'))return;
      location.href=card.dataset.publicCardUrl;
    });
    list.addEventListener('keydown',e=>{
      if(!['Enter',' '].includes(e.key))return;
      const card=e.target.closest?.('.page-card[data-public-card-url]');
      if(!card)return;
      e.preventDefault();location.href=card.dataset.publicCardUrl;
    });
    new MutationObserver(()=>decoratePageCards()).observe(list,{childList:true,subtree:true});
    decoratePageCards();
  }

  function renderLibrary(){
    const view=document.querySelector('#libraryView');if(!view)return;
    view.innerHTML=`<div class="section-head"><div><h2>자료실</h2><p>외부 공개로 지정된 자료는 로그인 없이 열람할 수 있습니다.</p></div></div><div class="public-library-toolbar"><input id="publicLibrarySearch" class="search" type="search" placeholder="자료명·출처·태그 검색"></div><div class="public-visibility-note">팀 공개·비공개 자료는 제목과 설명도 외부에 노출하지 않습니다.</div><div id="publicLibraryList" class="public-library-list"></div>`;
    const box=document.querySelector('#publicLibraryList'),search=document.querySelector('#publicLibrarySearch');
    const paint=()=>{
      const q=(search?.value||'').trim().toLowerCase();
      const rows=documents.filter(d=>!q||[d.title,d.file_name,d.source,d.category,d.description,(d.tags||[]).join(' ')].join(' ').toLowerCase().includes(q));
      box.innerHTML=rows.length?rows.map(d=>{
        const body=`<div class="badges"><span class="badge">${esc(d.category||'기타')}</span><span class="badge published">공개</span></div><h3>${esc(d.title||d.file_name||'자료')}</h3><p>${esc(d.source||'출처 미기재')}${d.document_date?' · '+esc(d.document_date):''}</p>${d.description?`<small>${esc(d.description)}</small>`:''}`;
        return d.drive_url?`<button class="public-library-card" type="button" data-public-document-url="${esc(d.drive_url)}">${body}</button>`:`<article class="public-library-card">${body}</article>`;
      }).join(''):'<div class="empty">현재 외부 공개로 지정된 자료가 없습니다.</div>';
    };
    if(search)search.addEventListener('input',paint);paint();
    box.addEventListener('click',e=>{const card=e.target.closest?.('[data-public-document-url]');if(card)window.open(card.dataset.publicDocumentUrl,'_blank','noopener')});
  }

  async function loadPublicDocuments(){
    try{
      const data=await rt.api('/rest/v1/rpc/app_public_projects_snapshot',{method:'POST',body:{},auth:false});
      documents=Array.isArray(data?.documents)?data.documents:[];
    }catch(e){console.warn('public library load failed',e);documents=[]}
    renderLibrary();
  }

  function boot(){installStyle();bindPageCards();loadPublicDocuments()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  setTimeout(()=>{bindPageCards();renderLibrary()},350);
})();
