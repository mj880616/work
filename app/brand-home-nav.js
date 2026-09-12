(()=>{
  if(window.__KPTU_BRAND_HOME_NAV__)return;
  window.__KPTU_BRAND_HOME_NAV__=true;

  function goHome(){
    document.querySelectorAll('#appView .view-panel').forEach(x=>x.classList.toggle('hidden',x.id!=='homeView'));
    document.querySelectorAll('.app-nav .nav-btn').forEach(x=>x.classList.toggle('active',x.dataset.view==='home'));
    document.querySelectorAll('#ccMobileDock [data-cc-view]').forEach(x=>x.classList.toggle('active',x.dataset.ccView==='home'));
    window.scrollTo({top:0,behavior:'instant'});
  }

  function bind(){
    const brand=document.querySelector('.topbar .brand');
    if(!brand||brand.dataset.homeNavBound==='1')return;
    brand.dataset.homeNavBound='1';
    brand.removeAttribute('href');
    brand.setAttribute('role','button');
    brand.setAttribute('tabindex','0');
    brand.style.cursor='pointer';
    brand.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();goHome()});
    brand.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();goHome()}});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  const mo=new MutationObserver(bind);mo.observe(document.documentElement,{childList:true,subtree:true});
})();
