(()=>{
  function apply(){
    const home=document.querySelector('#homeView');
    if(!home)return;
    ['#todayList','#notifList','#weeklyCopyBtn'].forEach(sel=>{
      const el=home.querySelector(sel);
      const panel=el?.closest('article.panel');
      if(panel){
        panel.hidden=true;
        panel.setAttribute('aria-hidden','true');
        panel.classList.add('home-cleanup-hidden');
      }
    });
    const grid=home.querySelector('.dashboard-grid');
    if(grid)grid.classList.add('home-dashboard-single');
  }
  if(!document.querySelector('#homeCleanupStyle')){
    const s=document.createElement('style');
    s.id='homeCleanupStyle';
    s.textContent='#homeView .dashboard-grid.home-dashboard-single{grid-template-columns:minmax(0,1fr)!important}#homeView .home-cleanup-hidden{display:none!important}';
    document.head.appendChild(s);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
  const root=document.querySelector('#homeView');
  if(root)new MutationObserver(()=>apply()).observe(root,{childList:true,subtree:true});
})();
