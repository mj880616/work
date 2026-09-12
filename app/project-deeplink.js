(()=>{
  'use strict';
  if(window.__KPTU_PROJECT_DEEPLINK__)return;
  window.__KPTU_PROJECT_DEEPLINK__=true;

  const PARAM='project';
  let opening=false;

  function projectIdFromUrl(){
    return new URLSearchParams(location.search).get(PARAM)||'';
  }

  function setProjectInUrl(id){
    const u=new URL(location.href);
    if(id)u.searchParams.set(PARAM,id);else u.searchParams.delete(PARAM);
    history.replaceState(history.state||{},'',u.pathname+(u.search||'')+u.hash);
  }

  function projectLink(id){
    const u=new URL(location.href);
    u.searchParams.set(PARAM,id);
    u.hash='';
    return u.href;
  }

  async function copyText(text){
    if(navigator.clipboard?.writeText){
      try{await navigator.clipboard.writeText(text);return true}catch(_){ }
    }
    const ta=document.createElement('textarea');
    ta.value=text;ta.style.cssText='position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);ta.select();
    let ok=false;try{ok=document.execCommand('copy')}catch(_){ }
    ta.remove();return ok;
  }

  function installLinkButton(){
    const main=document.querySelector('#pvOverview .pv-overview-main');
    if(!main||document.querySelector('#projectDeepLinkBtn'))return;
    const wrap=document.createElement('div');
    wrap.style.cssText='display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px';
    const btn=document.createElement('button');
    btn.id='projectDeepLinkBtn';btn.type='button';btn.className='mini';btn.textContent='프로젝트 링크 복사';
    btn.addEventListener('click',async()=>{
      const id=projectIdFromUrl()||document.querySelector('#projectGrid [data-project][aria-current="true"]')?.dataset.project||'';
      if(!id)return;
      const ok=await copyText(projectLink(id));
      const old=btn.textContent;btn.textContent=ok?'복사됨':'복사 실패';
      setTimeout(()=>btn.textContent=old,1200);
    });
    wrap.appendChild(btn);main.appendChild(wrap);
  }

  function goProjects(){
    const nav=document.querySelector('[data-view="projects"]');
    if(nav&&!nav.classList.contains('active'))nav.click();
  }

  async function waitForCard(id,timeout=10000){
    const started=Date.now();
    while(Date.now()-started<timeout){
      const card=document.querySelector(`[data-project="${CSS.escape(id)}"]`);
      if(card)return card;
      await new Promise(r=>setTimeout(r,120));
    }
    return null;
  }

  async function openFromUrl(){
    if(opening)return;
    const id=projectIdFromUrl();
    if(!id)return;
    opening=true;
    try{
      goProjects();
      const card=await waitForCard(id);
      if(!card)return;
      const modal=document.querySelector('#projectModal');
      if(modal?.classList.contains('hidden'))card.click();
      installLinkButton();
    }finally{
      opening=false;
    }
  }

  document.addEventListener('click',e=>{
    const card=e.target.closest?.('[data-project]');
    if(card?.dataset.project){
      setProjectInUrl(card.dataset.project);
      setTimeout(installLinkButton,80);
    }
    const close=e.target.closest?.('[data-close="projectModal"],#projectModal [data-pv-close="projectModal"]');
    if(close)setProjectInUrl('');
  },true);

  window.addEventListener('popstate',openFromUrl);
  window.addEventListener('kptu:session-changed',()=>setTimeout(openFromUrl,80));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(openFromUrl,250));
  else setTimeout(openFromUrl,250);
})();