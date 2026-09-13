(()=>{
'use strict';
let observer=null;
function installStyle(){
  if(document.querySelector('#projectHideLegacyStyle'))return;
  const style=document.createElement('style');
  style.id='projectHideLegacyStyle';
  style.textContent='#projectGrid .pm2-legacy-box,#projectGrid [data-project]:not([data-pm2-project]){display:none!important}';
  document.head.appendChild(style);
}
function clean(){
  const grid=document.querySelector('#projectGrid');
  if(!grid)return false;
  grid.querySelectorAll('.pm2-legacy-box').forEach(el=>el.remove());
  grid.querySelectorAll('[data-project]').forEach(el=>{
    if(!el.hasAttribute('data-pm2-project'))el.remove();
  });
  return true;
}
function boot(){
  installStyle();
  if(!clean())return;
  if(observer)return;
  const grid=document.querySelector('#projectGrid');
  observer=new MutationObserver(()=>queueMicrotask(clean));
  observer.observe(grid,{childList:true,subtree:true});
}
boot();
window.addEventListener('kptu:session-changed',()=>setTimeout(boot,0));
})();
