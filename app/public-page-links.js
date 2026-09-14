(()=>{
  'use strict';
  if(window.__KPTU_PUBLIC_PAGE_LINKS__)return;
  window.__KPTU_PUBLIC_PAGE_LINKS__=true;

  function rewrite(){
    const link=document.querySelector('[data-piv-external]');
    if(!link||link.classList.contains('hidden')||!link.href)return;
    const isPublic=!!document.querySelector('#pivSheet .piv-chip.public');
    if(!isPublic)return;
    try{
      const u=new URL(link.href,location.href);
      const slug=u.searchParams.get('slug');
      if(!slug||!/^[a-z0-9-]+$/.test(slug))return;
      link.href=new URL('../p/'+slug+'/',location.href).href;
    }catch{}
  }

  const observer=new MutationObserver(()=>rewrite());
  function install(){
    rewrite();
    const root=document.querySelector('#pagesView')||document.body;
    observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['href','class']});
    window.KPTURouter?.on?.('pages',()=>setTimeout(rewrite,50));
    window.addEventListener('popstate',()=>setTimeout(rewrite,50));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
