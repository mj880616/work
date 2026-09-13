(()=>{
  'use strict';

  const TARGETS=['pm2MilestoneWs','pm2DecisionWs'];

  function syncSelect(select){
    if(!select)return;
    const realOptions=[...select.options].filter(option=>option.value);
    const emptyOption=[...select.options].find(option=>!option.value);
    const hasWorkstreams=realOptions.length>0;
    const shouldDisable=!hasWorkstreams;

    if(select.disabled!==shouldDisable)select.disabled=shouldDisable;
    const aria=hasWorkstreams?'false':'true';
    if(select.getAttribute('aria-disabled')!==aria)select.setAttribute('aria-disabled',aria);

    if(emptyOption){
      const label=hasWorkstreams?'프로젝트 전체':'프로젝트 전체 · 진행 영역 없음';
      if(emptyOption.textContent!==label)emptyOption.textContent=label;
    }

    if(!hasWorkstreams){
      if(select.value!=='')select.value='';
      const title='진행 영역이 없어 프로젝트 전체에 연결됩니다.';
      if(select.title!==title)select.title=title;
    }else if(select.hasAttribute('title')){
      select.removeAttribute('title');
    }
  }

  function syncAll(){
    TARGETS.forEach(id=>syncSelect(document.getElementById(id)));
  }

  function attach(){
    const found=TARGETS.map(id=>document.getElementById(id)).filter(Boolean);
    if(!found.length)return false;

    found.forEach(select=>{
      if(select.dataset.pm2EmptyGuard==='1')return;
      select.dataset.pm2EmptyGuard='1';
      new MutationObserver(()=>syncSelect(select)).observe(select,{childList:true,subtree:true});
      syncSelect(select);
    });
    return true;
  }

  if(!document.querySelector('#pm2EmptyWorkstreamGuardStyle')){
    const style=document.createElement('style');
    style.id='pm2EmptyWorkstreamGuardStyle';
    style.textContent=`
      #pm2MilestoneWs:disabled,
      #pm2DecisionWs:disabled{
        opacity:1!important;
        color:#4d5963!important;
        background:#f3f5f6!important;
        cursor:default!important;
      }
    `;
    document.head.appendChild(style);
  }

  if(!attach()){
    const observer=new MutationObserver(()=>{
      if(attach())observer.disconnect();
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }

  document.addEventListener('click',event=>{
    if(event.target.closest('[data-pm2-add-milestone],[data-pm2-add-decision]')){
      queueMicrotask(syncAll);
    }
  },true);
})();
