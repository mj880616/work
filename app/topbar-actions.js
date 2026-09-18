(()=>{
'use strict';
if(window.__KPTU_TOPBAR_ACTIONS__)return;
window.__KPTU_TOPBAR_ACTIONS__=true;
const host=document.querySelector('.top-actions');
if(!host)return;
// Topbar actions are owned here. Remove the legacy logout control so later renderers cannot flash or re-show it.
document.querySelector('#logoutBtn')?.remove();
let button=document.querySelector('#ccNotifTop');
if(!button){
  button=document.createElement('button');
  button.id='ccNotifTop';
  button.type='button';
  button.className='ghost';
  button.innerHTML='알림 <span id="ccNotifBadge" class="cc-count hidden">0</span>';
  host.prepend(button);
}
button.classList.remove('hidden');
button.onclick=()=>window.KPTURouter?.go?.('notifications',{source:'topbar'});
})();
