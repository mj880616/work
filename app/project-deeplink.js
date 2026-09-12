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
    }finally{
      opening=false;
    }
  }

  document.addEventListener('click',e=>{
    const card=e.target.closest?.('[data-project]');
    if(card?.dataset.project)setProjectInUrl(card.dataset.project);
    const close=e.target.closest?.('[data-close="projectModal"],#projectModal [data-pv-close="projectModal"]');
    if(close)setProjectInUrl('');
  },true);

  window.addEventListener('popstate',openFromUrl);
  window.addEventListener('kptu:session-changed',()=>setTimeout(openFromUrl,80));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(openFromUrl,250));
  else setTimeout(openFromUrl,250);
})();