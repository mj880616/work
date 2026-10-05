(()=>{
'use strict';
if(window.__KPTU_TOPBAR_ACTIONS__)return;
window.__KPTU_TOPBAR_ACTIONS__=true;
const logoutButtons=[...document.querySelectorAll('[data-kptu-logout]')];
if(!logoutButtons.length)return;
logoutButtons.forEach(button=>button.addEventListener('click',()=>window.KPTUTeamAuth?.logout?.()));
const themeButtons=[...document.querySelectorAll('[data-theme-open]')];
const modal=document.querySelector('#themeModal');
let restoreAfterBack=null;
function selected(){
  const current=document.documentElement.dataset.theme||'olive';
  modal?.querySelectorAll('[data-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===current)));
}
function closeTheme(){
  if(!modal||modal.classList.contains('hidden'))return;
  if(modal.dataset.kptuHistoryOpen!=='1')window.removeEventListener('popstate',restoreAfterBack);
  modal?.classList.add('hidden');modal?.setAttribute('aria-hidden','true');
  window.KPTUA11y?.dialog.deactivate(modal);
}
themeButtons.forEach(button=>button.addEventListener('click',()=>{
  window.removeEventListener('popstate',restoreAfterBack);
  // Register after the current view's history listeners, and restore on traversal completion.
  restoreAfterBack=()=>queueMicrotask(()=>{
    if(modal.classList.contains('hidden')&&button.isConnected&&button.getClientRects().length)button.focus({preventScroll:true});
  });
  window.addEventListener('popstate',restoreAfterBack,{once:true});
  selected();modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
  window.KPTUA11y?.dialog.activate(modal,{trigger:button,initialFocus:'[aria-pressed="true"]',onRequestClose:closeTheme});
}));
modal?.addEventListener('click',event=>{
  if(event.target===modal||event.target.closest('[data-close="themeModal"]')){event.stopPropagation();closeTheme();return}
  const option=event.target.closest('[data-theme-choice]');if(!option)return;
  const theme=option.dataset.themeChoice;
  if(!['olive','navy','terracotta','sand'].includes(theme))return;
  document.documentElement.dataset.theme=theme;
  try{localStorage.setItem('kptu-theme',theme)}catch{}
  selected();
});
const show=state=>{
  logoutButtons.forEach(button=>button.classList.toggle('hidden',state!=='workspace'));
  themeButtons.forEach(button=>button.classList.toggle('hidden',state!=='workspace'));
  if(state!=='workspace')closeTheme();
};
show(window.__KPTU_TEAM_READY_STATE__);
window.addEventListener('kptu:team-ready',event=>show(event.detail?.state));
window.addEventListener('kptu:session-changed',event=>{if(!event.detail?.session)show('auth')});
})();
