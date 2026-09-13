(()=>{
  'use strict';
  const apply=()=>{
    const campaign=document.querySelector('[data-pm2-type="campaign"] strong');
    if(campaign&&campaign.textContent.trim()!=='의제 사업')campaign.textContent='의제 사업';
    document.querySelectorAll('.pm2-card-type,#pm2DetailKicker').forEach(el=>{
      if(el.textContent.trim()==='쟁점·캠페인')el.textContent='의제 사업';
    });
  };
  let queued=false;
  const schedule=()=>{
    if(queued)return;
    queued=true;
    requestAnimationFrame(()=>{
      queued=false;
      apply();
    });
  };
  apply();
  const observer=new MutationObserver(schedule);
  observer.observe(document.body,{childList:true,subtree:true});
})();
