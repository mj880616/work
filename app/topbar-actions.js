(()=>{
'use strict';
if(window.__KPTU_TOPBAR_ACTIONS__)return;
window.__KPTU_TOPBAR_ACTIONS__=true;
const logoutButtons=[...document.querySelectorAll('[data-kptu-logout]')];
if(!logoutButtons.length)return;
logoutButtons.forEach(button=>button.addEventListener('click',()=>closeAccount(()=>window.KPTUTeamAuth?.logout?.())));
// The shell owns each account menu; feature modules only fill its slots.
const accounts=logoutButtons.map(logout=>{
  const sidebar=logout.id==='sidebarLogoutBtn',id=sidebar?'sidebarAccountPanel':'topAccountPanel';
  const host=document.createElement('div');host.className='account-menu hidden';
  const trigger=document.createElement('button');trigger.type='button';trigger.className='account-trigger';trigger.dataset.accountOpen='';
  trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',id);
  trigger.innerHTML='계정 <span aria-hidden="true">▾</span>';
  const panel=document.createElement('div');panel.id=id;panel.className='account-panel';panel.setAttribute('role','group');panel.setAttribute('aria-label','계정');panel.setAttribute('popover','manual');
  const theme=document.createElement('button');theme.type='button';theme.className='account-action';theme.dataset.themeOpen='';
  if(sidebar)theme.id='sidebarThemeBtn';theme.textContent='화면 색';theme.setAttribute('aria-haspopup','dialog');theme.setAttribute('aria-controls','themeModal');
  const slot=document.createElement('div');slot.dataset.accountDriveSlot='';
  logout.before(host);host.append(trigger);panel.append(theme,slot,logout);document.body.append(panel);
  logout.classList.remove('ghost','sidebar-utility','hidden');logout.classList.add('account-action');
  return {host,trigger,panel,theme};
});
let activeAccount=null;
function closeAccount(then,fromBack=false){
  const account=activeAccount;if(!account){then?.();return}
  activeAccount=null;account.panel.hidePopover();account.trigger.setAttribute('aria-expanded','false');account.trigger.querySelector('span').textContent='▾';
  const finish=()=>queueMicrotask(()=>{if(then)then();else if(account.trigger.getClientRects().length)account.trigger.focus({preventScroll:true})});
  if(!fromBack&&history.state?.kptuAccount===account.panel.id){window.addEventListener('popstate',finish,{once:true});history.back()}
  else finish();
}
function positionAccount(){
  if(!activeAccount)return;
  const {trigger,panel}=activeAccount,rect=trigger.getBoundingClientRect(),height=panel.getBoundingClientRect().height;
  panel.style.top=Math.max(12,Math.min(rect.bottom+8,innerHeight-height-12))+'px';
}
const panelResize=new ResizeObserver(positionAccount);
accounts.forEach(account=>{
  panelResize.observe(account.panel);
  account.trigger.addEventListener('click',()=>{
    if(activeAccount){closeAccount();return}
    activeAccount=account;account.panel.showPopover();positionAccount();account.theme.focus({preventScroll:true});
    account.trigger.setAttribute('aria-expanded','true');account.trigger.querySelector('span').textContent='▴';
    history.pushState({...history.state,kptuAccount:account.panel.id},'',location.href);
  });
});
// Consume the account history entry before forwarding an outside action to its
// existing handler. This also preserves modal/view history and avoids duplicate actions.
document.addEventListener('click',event=>{
  if(!activeAccount||activeAccount.panel.contains(event.target)||activeAccount.trigger.contains(event.target))return;
  const target=event.target,forward=new MouseEvent('click',event);
  event.preventDefault();event.stopImmediatePropagation();
  closeAccount(()=>{if(target.isConnected)target.dispatchEvent(forward)});
},true);
document.addEventListener('keydown',event=>{if(activeAccount&&event.key==='Escape'){event.preventDefault();event.stopPropagation();closeAccount()}});
window.addEventListener('resize',positionAccount);
window.addEventListener('popstate',event=>{if(activeAccount&&event.state?.kptuAccount!==activeAccount.panel.id)closeAccount(null,true)});
const themeButtons=accounts.map(account=>account.theme);
window.dispatchEvent(new CustomEvent('kptu:account-ready'));
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
themeButtons.forEach(button=>button.addEventListener('click',()=>closeAccount(()=>{
  const account=accounts.find(account=>account.theme===button);
  const focusTrigger=account.trigger;
  window.removeEventListener('popstate',restoreAfterBack);
  // Register after the current view's history listeners, and restore on traversal completion.
  restoreAfterBack=()=>queueMicrotask(()=>{
    if(modal.classList.contains('hidden')&&focusTrigger.isConnected&&focusTrigger.getClientRects().length)focusTrigger.focus({preventScroll:true});
  });
  window.addEventListener('popstate',restoreAfterBack,{once:true});
  selected();modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
  window.KPTUA11y?.dialog.activate(modal,{trigger:focusTrigger,initialFocus:'[aria-pressed="true"]',onRequestClose:closeTheme});
})));
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
  accounts.forEach(account=>account.host.classList.toggle('hidden',state!=='workspace'));
  if(state!=='workspace')closeAccount();
  if(state!=='workspace')closeTheme();
};
show(window.__KPTU_TEAM_READY_STATE__);
window.addEventListener('kptu:team-ready',event=>show(event.detail?.state));
window.addEventListener('kptu:session-changed',event=>{if(!event.detail?.session)show('auth')});
})();
