(()=>{
  'use strict';
  if(window.__KPTU_PROJECT_PUBLIC_VISIBILITY__)return;
  window.__KPTU_PROJECT_PUBLIC_VISIBILITY__=true;
  const addPublicOption=select=>{
    if(!select||select.querySelector('option[value="public"]'))return;
    const opt=document.createElement('option');opt.value='public';opt.textContent='전체 공개 · 로그인 없이 열람';select.insertBefore(opt,select.firstChild);
  };
  const applyCreateDefault=()=>{
    const select=document.getElementById('newProjectVisibility');addPublicOption(select);
    if(select&&!document.getElementById('newProjectParent')?.value)select.value='public';
  };
  applyCreateDefault();addPublicOption(document.getElementById('paVisibility'));
  const modal=document.getElementById('projectCreateModal');if(modal)new MutationObserver(()=>{if(!modal.classList.contains('hidden'))queueMicrotask(applyCreateDefault)}).observe(modal,{attributes:true,attributeFilter:['class']});
  const accessModal=document.getElementById('projectAccessModal');if(accessModal)new MutationObserver(()=>addPublicOption(document.getElementById('paVisibility'))).observe(accessModal,{attributes:true,attributeFilter:['class']});
  const style=document.createElement('style');style.textContent='.pa-badge.public{background:#e7f3fb;color:#255f85}';document.head.appendChild(style);
  const relabel=()=>document.querySelectorAll('.pa-badge').forEach(x=>{if(x.textContent.trim()==='public')x.textContent='전체 공개'});relabel();new MutationObserver(relabel).observe(document.getElementById('projectGrid')||document.body,{childList:true,subtree:true});
})();
