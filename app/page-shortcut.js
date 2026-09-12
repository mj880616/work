function psuDecorate(){
  document.querySelectorAll('#pageList .page-card .card-actions a.mini').forEach(a=>{
    if(a.dataset.pageShortcut==='1')return;
    const href=a.getAttribute('href')||'';
    if(!href.includes('../p/?slug='))return;
    a.dataset.pageShortcut='1';
    a.textContent='바로가기';
    a.target='_blank';
    a.rel='noopener';
    try{
      const u=new URL(href,location.href);
      u.searchParams.set('external','1');
      a.href=u.href;
    }catch{}
  });
}
function psuInstall(){
  psuDecorate();
  const list=document.querySelector('#pageList');
  if(list)new MutationObserver(psuDecorate).observe(list,{childList:true,subtree:true});
  window.KPTURouter?.on?.('pages',()=>setTimeout(psuDecorate,0));
  document.querySelector('#pageSearch')?.addEventListener('input',()=>setTimeout(psuDecorate,0));
  document.querySelector('#pageFilter')?.addEventListener('change',()=>setTimeout(psuDecorate,0));
}
psuInstall();
