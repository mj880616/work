(()=>{
'use strict';
if(window.__KPTU_TOPBAR_ACTIONS__)return;
window.__KPTU_TOPBAR_ACTIONS__=true;
const logout=document.querySelector('.top-actions #logoutBtn');
const notifications=document.querySelector('.top-actions #ccNotifTop');
if(!logout)return;
logout.addEventListener('click',()=>window.KPTUTeamAuth?.logout?.());
const show=state=>{
  logout.classList.toggle('hidden',state!=='workspace'&&state!=='bootstrap');
  notifications?.classList.toggle('hidden',state!=='workspace');
};
show(window.__KPTU_TEAM_READY_STATE__);
window.addEventListener('kptu:team-ready',event=>show(event.detail?.state));
window.addEventListener('kptu:session-changed',event=>{if(!event.detail?.session)show('auth')});
})();
