(()=>{
'use strict';
if(window.__KPTU_TOPBAR_ACTIONS__)return;
window.__KPTU_TOPBAR_ACTIONS__=true;
const logoutButtons=[...document.querySelectorAll('[data-kptu-logout]')];
const notificationButtons=[...document.querySelectorAll('[data-kptu-notifications]')];
if(!logoutButtons.length)return;
logoutButtons.forEach(button=>button.addEventListener('click',()=>window.KPTUTeamAuth?.logout?.()));
const show=state=>{
  logoutButtons.forEach(button=>button.classList.toggle('hidden',state!=='workspace'&&state!=='bootstrap'));
  notificationButtons.forEach(button=>button.classList.toggle('hidden',state!=='workspace'));
};
show(window.__KPTU_TEAM_READY_STATE__);
window.addEventListener('kptu:team-ready',event=>show(event.detail?.state));
window.addEventListener('kptu:session-changed',event=>{if(!event.detail?.session)show('auth')});
})();
