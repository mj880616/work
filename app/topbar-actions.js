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
  const panel=document.createElement('div');panel.id=id;panel.className='account-panel';panel.setAttribute('role','group');panel.setAttribute('aria-label','계정');panel.hidden=true;
  let nativePopover=typeof panel.showPopover==='function'&&typeof panel.hidePopover==='function'&&'popover' in panel;
  if(nativePopover)panel.setAttribute('popover','manual');
  const theme=document.createElement('button');theme.type='button';theme.className='account-action';theme.dataset.themeOpen='';
  if(sidebar)theme.id='sidebarThemeBtn';theme.textContent='화면 색';theme.setAttribute('aria-haspopup','dialog');theme.setAttribute('aria-controls','themeModal');
  const slot=document.createElement('div');slot.dataset.accountDriveSlot='';
  logout.before(host);host.append(trigger);panel.append(theme,slot,logout);document.body.append(panel);
  logout.classList.remove('ghost','sidebar-utility','hidden');logout.classList.add('account-action');
  return {host,trigger,panel,theme,nativePopover};
});
let activeAccount=null;
const mobileQuery=window.matchMedia('(max-width:760px)');
const mobileMenu=document.querySelector('#mobileMenu'),mobileTrigger=document.querySelector('#mobileMenuOpen');
const mobilePanel=mobileMenu?.querySelector('.mobile-menu-panel'),mobileGroup=document.querySelector('#mobileAccountGroup');
const mobileAccount=accounts[0];
let mobileOpen=false,mobileClosing=false;
// Mid-width navigation reuses the original controls and the mobile dialog.
const midQuery=window.matchMedia('(min-width:761px) and (max-width:1023px)');
const menuQuery=window.matchMedia('(max-width:1023px)');
const appNav=document.querySelector('#appView>.app-nav'),drawerNav=mobilePanel?.querySelector('nav');
const phoneOnly=[...drawerNav?.querySelectorAll('[data-view],[data-mobile-press]')||[]];
const midItems=['home','calendar','tasks','projects','library','meetings','media','pages','team']
  .map(view=>appNav?.querySelector(`[data-view="${view}"]`)).filter(Boolean);
const homes=new Map([...midItems,mobileTrigger].filter(Boolean).map(button=>{
  const anchor=document.createComment('navigation home');button.before(anchor);return [button,anchor];
}));
const navigationControls=new Set([...homes.keys(),...phoneOnly]);
let midActive=false,navigationFocus=null;
// display:none may clear activeElement before resize/media-query callbacks.
// Retain only a menu focus lost through hiding; explicit blur or another
// focused control clears this reference.
document.addEventListener('focusin',event=>{
  if(event.target!==document.body)navigationFocus=navigationControls.has(event.target)?event.target:null;
});
document.addEventListener('focusout',event=>{
  if(event.target===navigationFocus&&event.target.getClientRects().length)navigationFocus=null;
});
function syncMenuLocation(){
  if(!midActive)return;
  const view=window.KPTURouter?.current||window.KPTURouter?.detect?.();
  let overflowCurrent=false;
  midItems.forEach(button=>{
    const current=button.dataset.view===view;
    button.classList.toggle('active',current);
    if(current)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    if(current&&button.parentElement===drawerNav)overflowCurrent=true;
  });
  mobileTrigger.classList.toggle('active',overflowCurrent);
  if(overflowCurrent)mobileTrigger.setAttribute('aria-current','page');else mobileTrigger.removeAttribute('aria-current');
}
function syncMidNavigation(){
  if(!appNav||!drawerNav||!mobileTrigger)return;
  const active=document.activeElement;
  const focus=active===document.body&&navigationFocus&&!navigationFocus.getClientRects().length?navigationFocus:active;
  if(!midQuery.matches){
    if(!midActive){
      if(mobileQuery.matches&&homes.has(focus)&&!focus.getClientRects().length)mobileTrigger.focus({preventScroll:true});
      return;
    }
    midActive=false;
    homes.forEach((anchor,button)=>anchor.after(button));
    phoneOnly.forEach(button=>button.hidden=false);
    mobileTrigger.classList.remove('nav-btn','mid-menu-trigger','active');mobileTrigger.removeAttribute('aria-current');
    if(homes.has(focus)){
      const target=mobileOpen&&menuQuery.matches?mobilePanel.querySelector('[data-mobile-menu-close]')
        :focus.getClientRects().length?focus:mobileQuery.matches?mobileTrigger:appNav.querySelector('.nav-btn.active')||midItems[0];
      target?.focus({preventScroll:true});
    }
    return;
  }
  midActive=true;phoneOnly.forEach(button=>button.hidden=true);
  mobileTrigger.classList.add('nav-btn','mid-menu-trigger');appNav.append(mobileTrigger);
  // Measure intrinsic widths in the real row before distributing its suffix.
  // All moves finish synchronously, before paint; no duplicate menu or storage.
  midItems.forEach(button=>{button.classList.add('nav-btn');appNav.insertBefore(button,mobileTrigger)});
  const style=getComputedStyle(appNav),gap=parseFloat(style.columnGap)||0;
  const available=appNav.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0);
  let used=mobileTrigger.getBoundingClientRect().width,count=0;
  for(const button of midItems){
    const width=button.getBoundingClientRect().width;
    if(used+gap+width>available)break;
    used+=gap+width;count++;
  }
  midItems.slice(count).forEach(button=>drawerNav.append(button));
  if(midItems.includes(focus)){
    if(focus.parentElement===drawerNav&&!mobileOpen)mobileTrigger.focus({preventScroll:true});
    else if(focus.parentElement===appNav&&mobileOpen)mobilePanel.querySelector('[data-mobile-menu-close]')?.focus({preventScroll:true});
    else focus.focus({preventScroll:true});
  }else if(phoneOnly.includes(focus)&&!focus.getClientRects().length){
    (mobileOpen?mobilePanel.querySelector('[data-mobile-menu-close]'):mobileTrigger)?.focus({preventScroll:true});
  }else if(focus===mobileTrigger)mobileTrigger.focus({preventScroll:true});
  syncMenuLocation();
}
const navResize=new ResizeObserver(syncMidNavigation);
if(appNav)navResize.observe(appNav);
midItems.forEach(button=>navResize.observe(button));
if(mobileTrigger)navResize.observe(mobileTrigger);
midQuery.addEventListener('change',syncMidNavigation);
window.addEventListener('resize',syncMidNavigation);
document.fonts?.ready.then(syncMidNavigation);
document.fonts?.addEventListener('loadingdone',syncMidNavigation);

function closeMobile(then,fromBack=false){
  if(!mobileOpen){then?.();return}
  mobileOpen=false;mobileClosing=true;mobileMenu.hidden=true;mobileTrigger.setAttribute('aria-expanded','false');
  window.KPTUA11y?.dialog.deactivate(mobilePanel,{restoreFocus:false});
  const finish=()=>queueMicrotask(()=>{mobileClosing=false;if(mobileTrigger.getClientRects().length)mobileTrigger.focus({preventScroll:true});then?.()});
  if(!fromBack&&history.state?.kptuMobileMenu){window.addEventListener('popstate',finish,{once:true});history.back()}else finish();
}
window.KPTUMobileMenu={isOpen:()=>mobileOpen,close:closeMobile};
function syncMobile(){
  if(!mobileGroup||!mobileAccount)return;
  if(!menuQuery.matches&&mobileOpen)closeMobile();
  const target=menuQuery.matches?mobileGroup:mobileAccount.panel;
  if(mobileAccount.theme.parentElement!==target){
    if(activeAccount)closeAccount();
    target.append(mobileAccount.theme,mobileAccount.panel.querySelector('[data-account-drive-slot]')||mobileGroup.querySelector('[data-account-drive-slot]'),logoutButtons[0]);
  }
  syncKeyboard();
}
mobileTrigger?.addEventListener('click',()=>{
  if(mobileClosing)return;
  if(mobileOpen){closeMobile();return}
  if(!menuQuery.matches||window.__KPTU_TEAM_READY_STATE__!=='workspace')return;
  mobileOpen=true;mobileMenu.hidden=false;mobileTrigger.setAttribute('aria-expanded','true');
  history.pushState({...history.state,kptuMobileMenu:true},'',location.href);
  window.KPTUA11y?.dialog.activate(mobilePanel,{trigger:mobileTrigger,initialFocus:'[data-mobile-menu-close]',onRequestClose:closeMobile});
});
// History is consumed before the existing router/feature/account handler sees the click.
document.addEventListener('click',event=>{
  if(!mobileOpen)return;
  if(mobileTrigger.contains(event.target))return;
  if(!mobilePanel.contains(event.target)||event.target.closest('[data-mobile-menu-close]')){
    event.preventDefault();event.stopImmediatePropagation();closeMobile();return;
  }
  const button=event.target.closest('button,a[href]');if(!button||button.disabled)return;
  event.preventDefault();event.stopImmediatePropagation();
  closeMobile(()=>{if(button.isConnected)button.click()});
},true);
document.querySelectorAll('[data-mobile-press]').forEach(button=>button.addEventListener('click',async()=>{
  try{
    await window.KPTUViewLoader.load('media');
    window.KPTURouter.go('media',{source:'delegated'});
    document.querySelector(`#mediaView [data-press-type="${button.dataset.mobilePress}"]`)?.click();
    const name=document.querySelector('[data-mobile-view-name]');if(name)name.textContent=button.dataset.mobilePress==='release'?'보도자료':'성명';
    syncMenuLocation();
  }catch(error){console.error('press menu navigation',error)}
}));
document.addEventListener('keydown',event=>{if(mobileOpen&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeMobile()}});
window.addEventListener('popstate',event=>{if(mobileOpen&&!event.state?.kptuMobileMenu)closeMobile(null,true)});
const editable=()=>document.activeElement?.matches('input:not([type="button"]):not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"]');
let keyboardLayoutHeight=innerHeight;
function syncKeyboard(){
  const viewport=window.visualViewport;
  const editing=editable();
  if(!editing||!mobileQuery.matches)keyboardLayoutHeight=innerHeight;
  // Zoom also shrinks the viewport: require an editable focus and a normal scale.
  const keyboard=mobileQuery.matches&&editing&&(!viewport||(viewport.scale<=1.01&&Math.max(keyboardLayoutHeight,innerHeight)-viewport.height-viewport.offsetTop>120));
  document.body.classList.toggle('kptu-mobile-keyboard',!!keyboard);
}
window.visualViewport?.addEventListener('resize',syncKeyboard);
window.visualViewport?.addEventListener('scroll',syncKeyboard);
document.addEventListener('focusin',syncKeyboard);
document.addEventListener('focusout',()=>queueMicrotask(syncKeyboard));
menuQuery.addEventListener('change',syncMobile);
window.addEventListener('resize',syncKeyboard);
document.addEventListener('click',event=>{syncMenuLocation();const type=event.target.closest?.('[data-press-type]')?.dataset.pressType;if(type&&window.KPTURouter?.current==='media'){const name=document.querySelector('[data-mobile-view-name]');if(name)name.textContent=type==='release'?'보도자료':'성명'}});
window.addEventListener('kptu:view-changed',event=>{
  syncMenuLocation();
  const home=event.detail?.view==='home';
  document.querySelector('.mobile-shell-header [data-home-date]')?.toggleAttribute('hidden',!home);
  const name=document.querySelector('[data-mobile-view-name]');if(name){name.hidden=home;name.textContent=({calendar:'일정',tasks:'할 일',projects:'프로젝트',team:'담당조직',meetings:'회의',library:'자료실',media:document.querySelector('#mediaView [data-press-type].active')?.dataset.pressType==='release'?'보도자료':'성명',pages:'게시판'})[event.detail?.view]||''}
});
syncMobile();
syncMidNavigation();
function closeAccount(then,fromBack=false){
  if(mobileOpen){closeMobile(then,fromBack);return}
  const account=activeAccount;if(!account){then?.();return}
  activeAccount=null;if(account.nativePopover)account.panel.hidePopover();account.panel.hidden=true;account.trigger.setAttribute('aria-expanded','false');account.trigger.querySelector('span').textContent='▾';
  const finish=()=>queueMicrotask(()=>{if(then)then();else if(account.trigger.getClientRects().length)account.trigger.focus({preventScroll:true})});
  if(!fromBack&&history.state?.kptuAccount===account.panel.id){window.addEventListener('popstate',finish,{once:true});history.back()}
  else finish();
}
function positionAccount(){
  if(!activeAccount)return;
  const {trigger,panel}=activeAccount,rect=trigger.getBoundingClientRect();
  const nav=trigger.closest('.app-nav'),desktop=innerWidth>=1024&&nav;
  const margin=12,gap=8;
  let width=Math.min(300,innerWidth-margin*2),left;
  if(desktop){
    const bounds=nav.getBoundingClientRect(),style=getComputedStyle(nav);
    left=bounds.left+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft);
    const right=bounds.right-parseFloat(style.borderRightWidth)-parseFloat(style.paddingRight);
    width=Math.min(right-left,innerWidth-margin*2);
  }else left=rect.right-width;
  panel.style.width=width+'px';
  panel.style.left=Math.max(margin,Math.min(left,innerWidth-width-margin))+'px';
  // Constrain the height on the chosen side before measuring; never cover the trigger.
  panel.style.maxHeight=Math.max(0,desktop?rect.top-gap-margin:innerHeight-rect.bottom-gap-margin)+'px';
  const height=panel.getBoundingClientRect().height;
  panel.style.top=(desktop?Math.max(margin,rect.top-gap-height):rect.bottom+gap)+'px';
}
const panelResize=new ResizeObserver(positionAccount);
accounts.forEach(account=>{
  panelResize.observe(account.panel);
  account.trigger.closest('.app-nav')?.addEventListener('scroll',positionAccount);
  account.trigger.addEventListener('click',()=>{
    if(activeAccount){closeAccount();return}
    activeAccount=account;account.panel.hidden=false;
    if(account.nativePopover){
      try{account.panel.showPopover()}catch{account.nativePopover=false;account.panel.removeAttribute('popover')}
    }
    positionAccount();account.theme.focus({preventScroll:true});
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
  const focusTrigger=menuQuery.matches?mobileTrigger:account.trigger;
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
  if(state!=='workspace')closeMobile();
  if(state!=='workspace')closeTheme();
};
show(window.__KPTU_TEAM_READY_STATE__);
window.addEventListener('kptu:team-ready',event=>show(event.detail?.state));
window.addEventListener('kptu:session-changed',event=>{if(!event.detail?.session)show('auth')});
})();
