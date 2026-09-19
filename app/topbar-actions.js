(()=>{
'use strict';
if(window.__KPTU_TOPBAR_ACTIONS__)return;
window.__KPTU_TOPBAR_ACTIONS__=true;
const host=document.querySelector('.top-actions');
if(!host)return;
// Topbar actions are owned here. Remove the legacy logout control so later renderers cannot flash or re-show it.
document.querySelector('#logoutBtn')?.remove();
let teamButton=document.querySelector('#teamManageTop');
if(!teamButton){
  teamButton=document.createElement('button');
  teamButton.id='teamManageTop';
  teamButton.type='button';
  teamButton.className='ghost hidden';
  teamButton.textContent='구성원';
  host.append(teamButton);
}
let messageButton=document.querySelector('#ccMessageTop');
if(!messageButton){
  messageButton=document.createElement('button');
  messageButton.id='ccMessageTop';
  messageButton.type='button';
  messageButton.className='ghost hidden';
  messageButton.innerHTML='메시지 <span id="ccMessageBadge" class="cc-count hidden">0</span>';
  host.append(messageButton);
}
const badge=document.querySelector('#userBadge');
if(badge)badge.disabled=true;
async function openSecondary(view){
  if(window.__KPTU_TEAM_READY_STATE__==='bootstrap')return;
  if(!window.KPTUDeferredFeatures){
    await new Promise(resolve=>window.addEventListener('kptu:app-ui-ready',resolve,{once:true}));
  }
  await window.KPTUDeferredFeatures?.load?.();
  window.KPTURouter?.go?.(view,{source:'topbar'});
}
teamButton.onclick=()=>openSecondary('team').catch(console.error);
messageButton.onclick=()=>openSecondary('messages').catch(console.error);
if(badge)badge.onclick=()=>openSecondary('profile').catch(console.error);
window.addEventListener('kptu:team-ready',event=>{
  const workspace=event.detail?.state==='workspace';
  teamButton.classList.toggle('hidden',!workspace);
  messageButton.classList.toggle('hidden',!workspace);
  if(badge)badge.disabled=!workspace;
});
window.addEventListener('kptu:message-unread',event=>{
  const count=Math.max(0,Number(event.detail?.count)||0),unread=document.querySelector('#ccMessageBadge');
  if(!unread)return;
  unread.textContent=count>99?'99+':String(count);
  unread.classList.toggle('hidden',!count);
});
window.addEventListener('kptu:session-changed',event=>{if(!event.detail?.session){teamButton.classList.add('hidden');messageButton.classList.add('hidden');if(badge)badge.disabled=true}});
})();
