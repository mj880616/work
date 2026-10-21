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
  const profile=document.createElement('button');profile.type='button';profile.className='account-action';profile.dataset.profileOpen='';profile.textContent='내 프로필';
  const theme=document.createElement('button');theme.type='button';theme.className='account-action';theme.dataset.themeOpen='';
  if(sidebar)theme.id='sidebarThemeBtn';theme.textContent='화면 색';theme.setAttribute('aria-haspopup','dialog');theme.setAttribute('aria-controls','themeModal');
  logout.before(host);host.append(trigger);panel.append(profile,theme,logout);document.body.append(panel);
  logout.classList.remove('ghost','sidebar-utility','hidden');logout.classList.add('account-action');
  return {host,trigger,panel,profile,theme,nativePopover};
});
let activeAccount=null;
const mobileQuery=window.matchMedia('(max-width:760px)');
const mobileMenu=document.querySelector('#mobileMenu'),mobileTrigger=document.querySelector('#mobileMenuOpen');
const mobilePanel=mobileMenu?.querySelector('.mobile-menu-panel'),mobileGroup=document.querySelector('#mobileAccountGroup');
const mobileAccount=accounts[0];
// Phone: the [메뉴] tab at the end of the bottom tabs opens the same dialog; the top ☰ is hidden there.
const mobileTab=document.querySelector('#mobileMenuTab');
const menuButton=()=>mobileTab?.getClientRects().length?mobileTab:mobileTrigger;
let mobileOpen=false,mobileClosing=false,mobileOpener=null;
// One close control: the × in the drawer head (761~1023px), drawn as the sheet's grip on a phone.
const closeControl=()=>mobilePanel?.querySelector('[data-mobile-menu-close]')||mobilePanel;
// Mid-width navigation reuses the original controls and the mobile dialog.
const midQuery=window.matchMedia('(min-width:761px) and (max-width:1023px)');
const menuQuery=window.matchMedia('(max-width:1023px)');
const appNav=document.querySelector('#appView>.app-nav'),drawerNav=mobilePanel?.querySelector('nav');
const phoneOnly=[...drawerNav?.querySelectorAll('[data-view]')||[]];
const midItems=['home','basket','calendar','tasks','journal','diary','projects','library','meetings','media','pages','team','hwp']
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
// UI-PC사이드바: on the PC sidebar the [홈] row is hidden and the top line (icon + 홈) is the home menu, so focus that crosses
// into the PC width lands on the first visible of: the current menu row, that top line when home is current, the top line.
const pcFocusTarget=()=>[appNav.querySelector('.nav-btn.active'),appNav.querySelector('.sidebar-brand.active'),...midItems,appNav.querySelector('.sidebar-brand')].find(el=>el?.getClientRects().length);
function syncMidNavigation(){
  if(!appNav||!drawerNav||!mobileTrigger)return;
  const active=document.activeElement;
  const focus=active===document.body&&navigationFocus&&!navigationFocus.getClientRects().length?navigationFocus:active;
  if(!midQuery.matches){
    if(!midActive){
      if(mobileQuery.matches&&homes.has(focus)&&!focus.getClientRects().length)menuButton().focus({preventScroll:true});
      return;
    }
    midActive=false;
    // UI-PC일정묶음: 할 일·업무일지·일기 live in the PC sidebar's [일정] sub menu; back home they are sub rows again.
    homes.forEach((anchor,button)=>{anchor.after(button);if(button.classList.contains('nav-sub-btn'))button.classList.remove('nav-btn')});
    phoneOnly.forEach(button=>button.hidden=false);
    mobileTrigger.classList.remove('nav-btn','mid-menu-trigger','active');mobileTrigger.removeAttribute('aria-current');
    window.KPTURouter?.syncNavigation?.();
    if(homes.has(focus)){
      const target=mobileOpen&&menuQuery.matches?closeControl()
        :focus.getClientRects().length?focus:mobileQuery.matches?menuButton():pcFocusTarget();
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
    else if(focus.parentElement===appNav&&mobileOpen)closeControl()?.focus({preventScroll:true});
    else focus.focus({preventScroll:true});
  }else if(phoneOnly.includes(focus)&&!focus.getClientRects().length){
    (mobileOpen?closeControl():mobileTrigger)?.focus({preventScroll:true});
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
  mobileOpen=false;mobileClosing=true;resetDrag();mobileMenu.hidden=true;[mobileTrigger,mobileTab].forEach(button=>button?.setAttribute('aria-expanded','false'));
  window.KPTUA11y?.dialog.deactivate(mobilePanel,{restoreFocus:false});
  const opener=mobileOpener?.getClientRects().length?mobileOpener:menuButton();mobileOpener=null;
  const finish=()=>queueMicrotask(()=>{mobileClosing=false;if(opener.getClientRects().length)opener.focus({preventScroll:true});then?.()});
  if(!fromBack&&history.state?.kptuMobileMenu){window.addEventListener('popstate',finish,{once:true});history.back()}else finish();
}
window.KPTUMobileMenu={isOpen:()=>mobileOpen,close:closeMobile};
function syncMobile(){
  if(!mobileGroup||!mobileAccount)return;
  if(!menuQuery.matches&&mobileOpen)closeMobile();
  const target=menuQuery.matches?mobileGroup:mobileAccount.panel;
  if(mobileAccount.theme.parentElement!==target){
    if(activeAccount)closeAccount();
    target.append(mobileAccount.profile,mobileAccount.theme,logoutButtons[0]);
  }
  syncKeyboard();
}
function openMobile(trigger){
  if(mobileClosing)return;
  if(mobileOpen){closeMobile();return}
  if(!menuQuery.matches||window.__KPTU_TEAM_READY_STATE__!=='workspace')return;
  mobileOpen=true;mobileOpener=trigger;dragEndedAt=0;mobileMenu.hidden=false;trigger.setAttribute('aria-expanded','true');
  history.pushState({...history.state,kptuMobileMenu:true},'',location.href);
  window.KPTUA11y?.dialog.activate(mobilePanel,{trigger,initialFocus:closeControl(),onRequestClose:closeMobile});
}
mobileTrigger?.addEventListener('click',()=>openMobile(mobileTrigger));
mobileTab?.addEventListener('click',()=>openMobile(mobileTab));
// History is consumed before the existing router/feature/account handler sees the click.
document.addEventListener('click',event=>{
  if(!mobileOpen)return;
  if(mobileTrigger.contains(event.target)||mobileTab?.contains(event.target))return;
  // The click that ends a pull on the sheet is not a press.
  if(dragEndedAt&&performance.now()-dragEndedAt<500&&mobilePanel.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();return}
  if(!mobilePanel.contains(event.target)||event.target.closest('[data-mobile-menu-close]')){
    event.preventDefault();event.stopImmediatePropagation();closeMobile();return;
  }
  const button=event.target.closest('button,a[href]');if(!button||button.disabled)return;
  event.preventDefault();event.stopImmediatePropagation();
  closeMobile(()=>{if(button.isConnected)button.click()});
},true);
// Phone sheet (UI-디자인손질 4): pull the grip or the top row down to close. A short pull springs back; a tap on the grip closes.
let drag=null,dragEndedAt=0;
function resetDrag(){if(!drag)return;drag=null;mobilePanel.style.transform='';mobilePanel.classList.remove('is-dragging')}
// Only the click that ends a pull is swallowed: any new press clears that mark.
mobilePanel?.addEventListener('pointerdown',()=>{dragEndedAt=0},true);
mobilePanel?.addEventListener('pointerdown',event=>{
  if(!mobileOpen||!mobileQuery.matches||event.button>0||!event.target.closest('.mobile-menu-head'))return;
  drag={id:event.pointerId,y:event.clientY,dy:0,captured:false};
});
mobilePanel?.addEventListener('pointermove',event=>{
  if(drag?.id!==event.pointerId)return;
  drag.dy=Math.max(0,event.clientY-drag.y);
  // Capture only once it is really a pull, so a plain tap still reaches the grip (its click closes the sheet).
  if(!drag.captured&&drag.dy>6){drag.captured=true;mobilePanel.classList.add('is-dragging');try{mobilePanel.setPointerCapture(event.pointerId)}catch{}}
  if(drag.captured)mobilePanel.style.transform=drag.dy?`translateY(${drag.dy}px)`:'';
});
const endDrag=event=>{
  if(drag?.id!==event.pointerId)return;
  const far=drag.dy>Math.min(96,mobilePanel.getBoundingClientRect().height/4);
  if(drag.captured)dragEndedAt=performance.now();
  resetDrag();if(far&&event.type==='pointerup')closeMobile();
};
mobilePanel?.addEventListener('pointerup',endDrag);
mobilePanel?.addEventListener('pointercancel',endDrag);

document.addEventListener('keydown',event=>{if(mobileOpen&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeMobile()}});
window.addEventListener('popstate',event=>{if(mobileOpen&&!event.state?.kptuMobileMenu)closeMobile(null,true)});
// Phone keyboard state (body.kptu-mobile-keyboard, --kptu-keyboard-inset) is owned by accessibility-dialog.js (UI-키보드하단바).
const syncKeyboard=()=>window.KPTUA11y?.keyboard?.sync?.();
menuQuery.addEventListener('change',syncMobile);
document.addEventListener('click',()=>syncMenuLocation());
window.addEventListener('kptu:view-changed',event=>{
  syncMenuLocation();
  const home=event.detail?.view==='home';
  document.querySelector('.mobile-shell-header [data-home-date]')?.toggleAttribute('hidden',!home);
  const name=document.querySelector('[data-mobile-view-name]');if(name){name.hidden=home;name.textContent=({basket:'바구니',calendar:'일정',tasks:'일정',journal:'일정',diary:'일정',projects:'프로젝트',team:'담당조직',meetings:'회의',library:'자료실',hwp:'HWP 편집',profile:'내 프로필',media:'성명·보도자료',pages:'공유 페이지'})[event.detail?.view]||''}
});
// Menu [쓰기] (UI-디자인손질 8, BASKET-업데이트통합 PR 2): the shared write window (write-window.js) opens empty with [업데이트 ▾ | 노트],
// 업데이트 preselected and no place (= the basket). Each choice saves through its existing owner-RLS path and the window closes
// (저장하고 닫기). A saved note then opens on the basket's [노트] side. Text closed without saving stays in this tab's memory for
// the next [쓰기] only (never in browser storage).
let writeDraft='',writerOpening=false;
const writeToast=message=>{const toast=document.querySelector('#toast');if(!toast)return;toast.textContent=message;toast.classList.remove('hidden');clearTimeout(writeToast.timer);writeToast.timer=setTimeout(()=>toast.classList.add('hidden'),3200)};
async function openWriter(){
  if(writerOpening||document.querySelector('#mdEditor:not(.hidden)')||window.__KPTU_TEAM_READY_STATE__!=='workspace')return;
  writerOpening=true;
  try{
    const owner=window.KPTURuntime?.session?.read?.()?.user?.id;
    const [{openWriteWindow},{requestNoteDocOpen}]=await Promise.all([import('./write-window.js'),import('./basket-note-tasks.js'),window.KPTUViewLoader?.prepare?.('basket')]);
    if(owner!==window.KPTURuntime?.session?.read?.()?.user?.id)return;
    openWriteWindow({text:writeDraft,title:'쓰기',kind:'update',onClose:(text,{saved})=>{
      if(saved){
        writeDraft='';
        if(saved.kind!=='note')return;
        // The editor's own history entry steps back first; the basket opens after that (as other screens hand off a note).
        requestNoteDocOpen(saved.id);
        const go=()=>window.KPTURouter?.go('basket',{source:'delegated'});
        if(history.state?.kptuOverlay==='mdEditor')window.addEventListener('popstate',()=>queueMicrotask(go),{once:true});else go();
        return;
      }
      writeDraft=text.trim()?text:'';
      if(writeDraft)writeToast('저장하지 않은 글은 [쓰기]를 다시 누르면 이어서 쓸 수 있어요.');
    }});
  }catch(error){console.error('menu write',error);writeToast('쓰기 화면을 열지 못했어요. 다시 시도해 주세요.')}
  finally{writerOpening=false}
}
document.querySelectorAll('[data-menu-write]').forEach(button=>button.addEventListener('click',()=>void openWriter()));
// UI-PC메모노트: PC sidebar [바구니] → [업데이트]·[노트] (always shown). Each opens the basket on that side through the basket's
// own one-shot hand-off (basket-note-tasks.js); the basket screen itself and the phone stay as they are.
document.querySelectorAll('#appView>.app-nav [data-basket-kind-nav]').forEach(button=>button.addEventListener('click',async()=>{
  try{const {requestBasketKind}=await import('./basket-note-tasks.js');requestBasketKind(button.dataset.basketKindNav);}catch(error){console.error('basket kind',error)}
  window.KPTURouter?.go('basket',{source:'delegated'});
}));
window.addEventListener('kptu:session-changed',()=>{writeDraft=''});
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
// [내 프로필]: close the account menu, then the router (the one owner of screen changes) opens the screen; its module loads on first use.
accounts.forEach(account=>account.profile.addEventListener('click',()=>closeAccount(()=>window.KPTURouter?.go('profile',{source:'delegated'}))));
const themeButtons=accounts.map(account=>account.theme);
window.dispatchEvent(new CustomEvent('kptu:account-ready'));
const modal=document.querySelector('#themeModal');
let restoreAfterBack=null;
// UI-버튼크기: 폰 위 상태줄·아래 버튼줄은 앱 바탕(--kptu-bg)과 같은 색. 지금 켜진 쪽(밝게/어둡게) meta를 계정 테마의 바탕 값으로 맞춘다(manifest background_color·theme_color는 밝은 바탕 고정, 테마별 값 불가).
const darkScheme=window.matchMedia?.('(prefers-color-scheme: dark)');
function syncThemeColor(){
  const meta=document.querySelector(`meta[name="theme-color"][media="(prefers-color-scheme: ${darkScheme?.matches?'dark':'light'})"]`);
  const bg=getComputedStyle(document.documentElement).getPropertyValue('--kptu-bg').trim();
  if(meta&&bg)meta.setAttribute('content',bg);
}
syncThemeColor();darkScheme?.addEventListener?.('change',syncThemeColor);
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
  const focusTrigger=menuQuery.matches?menuButton():account.trigger;
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
  syncThemeColor();
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
