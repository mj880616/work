(()=>{
  'use strict';
  if(window.__KPTU_TASK_STATUS_STATE__)return;
  window.__KPTU_TASK_STATUS_STATE__=true;

  const states=new Map();
  let root=null;
  let observer=null;
  let applying=false;

  function keyFor(details){
    const section=details?.closest?.('.tl-task-section');
    if(!section)return '';
    const title=section.querySelector('.tl-section-head h3')?.textContent?.trim()||'';
    const status=details.classList.contains('tl-completed')?'completed':'incomplete';
    return `${title}:${status}`;
  }

  function remember(details){
    const key=keyFor(details);
    if(key)states.set(key,details.open);
  }

  function seed(){
    root?.querySelectorAll('details.tl-status-group').forEach(details=>{
      const key=keyFor(details);
      if(key&&!states.has(key))states.set(key,details.open);
    });
  }

  function restore(){
    if(!root||applying)return;
    applying=true;
    try{
      root.querySelectorAll('details.tl-status-group').forEach(details=>{
        const key=keyFor(details);
        if(key&&states.has(key))details.open=states.get(key);
      });
    }finally{applying=false}
  }

  function attach(){
    const next=document.querySelector('#tlTaskSections');
    if(!next)return false;
    if(root===next)return true;
    observer?.disconnect();
    root=next;
    seed();
    root.addEventListener('toggle',event=>{
      const details=event.target?.closest?.('details.tl-status-group');
      if(details&&!applying)remember(details);
    },true);
    root.addEventListener('click',event=>{
      if(event.target?.closest?.('[data-tl-toggle]'))root.querySelectorAll('details.tl-status-group').forEach(remember);
    },true);
    observer=new MutationObserver(()=>queueMicrotask(restore));
    observer.observe(root,{childList:true,subtree:true});
    restore();
    return true;
  }

  if(!attach()){
    const boot=new MutationObserver(()=>{
      if(attach())boot.disconnect();
    });
    boot.observe(document.body,{childList:true,subtree:true});
  }

  window.addEventListener('kptu:session-changed',()=>{
    states.clear();
    setTimeout(()=>{seed();restore()},120);
  });
})();
