import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import {viewPrefs,THEMES,DEFAULT_THEME} from './view-prefs.js';
import {repaintMobileTabs} from './mobile-tab-selection.mjs';
import {midKeys,pcSplit,itemOf,isDefaultLayout} from './menu-model.mjs';
import './menu-layout.js';
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
  const menuEdit=document.createElement('button');menuEdit.type='button';menuEdit.className='account-action';menuEdit.dataset.menuEditOpen='';menuEdit.textContent='메뉴 편집';menuEdit.setAttribute('aria-haspopup','dialog');menuEdit.setAttribute('aria-controls','menuEditModal');
  const theme=document.createElement('button');theme.type='button';theme.className='account-action';theme.dataset.themeOpen='';
  if(sidebar)theme.id='sidebarThemeBtn';theme.textContent='화면 색';theme.setAttribute('aria-haspopup','dialog');theme.setAttribute('aria-controls','themeModal');
  logout.before(host);host.append(trigger);panel.append(profile,menuEdit,theme,logout);document.body.append(panel);
  logout.classList.remove('ghost','sidebar-utility','hidden');logout.classList.add('account-action');
  return {host,trigger,panel,profile,menuEdit,theme,nativePopover};
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
// UI-모바일메뉴순서 (phone): the sheet opens scrolled to its bottom so the 메뉴 칸 next to the tab bar are seen without scrolling; a taller
// sheet loses its upper part instead. It stays pinned while content above grows (수집 시각 arrives late) until the person scrolls up.
let sheetPinned=false,sheetWatch=null;
const pinSheet=()=>{if(sheetPinned&&mobileQuery.matches&&mobilePanel)mobilePanel.scrollTop=mobilePanel.scrollHeight};
function watchSheet(){
  sheetWatch?.disconnect();sheetPinned=true;pinSheet();
  if(typeof ResizeObserver!=='function'||!mobilePanel)return;
  sheetWatch=new ResizeObserver(pinSheet);sheetWatch.observe(mobilePanel);[...mobilePanel.children].forEach(child=>sheetWatch.observe(child));
}

// One close control: the × in the drawer head (761~1023px), drawn as the sheet's grip on a phone.
const closeControl=()=>mobilePanel?.querySelector('[data-mobile-menu-close]')||mobilePanel;
// Mid-width navigation reuses the original controls and the mobile dialog.
const midQuery=window.matchMedia('(min-width:761px) and (max-width:1023px)');
const menuQuery=window.matchMedia('(max-width:1023px)');
const appNav=document.querySelector('#appView>.app-nav'),drawerNav=mobilePanel?.querySelector('nav');
// MENU-HOME-편집: 폰 [메뉴] 창 안 줄은 menu-layout.js가 순서대로 다시 만들 수 있으므로 그때그때 읽는다(한 줄 메뉴 때 옮겨 담은 PC 버튼은 뺀다).
const phoneButtons=()=>[...drawerNav?.children||[]].filter(el=>!el.matches('.nav-btn,.nav-sub-btn'));
// BASKET-정리함이름: [노트] (data-basket-kind-nav) and BASKET-PC메뉴 [업데이트]·[챙길 것] (data-basket-pane-nav) are not screens of their own; they sit in the 761~1023px row too.
// BASKET-PC메뉴: the order is the sidebar's: 홈 / 정리함(업데이트·챙길 것) / 일정(달력·할 일·업무일지·일기) / 노트 / 프로젝트 …
// MENU-HOME-편집: 순서는 menu-model.mjs(사용자가 정한 메뉴 순서). 버튼은 처음 모양(index.html)의 것을 그대로 쓰고 자리만 바꾼다.
const ALL_KEYS=['home','basket','pane:update','pane:todo','calendar','tasks','journal','diary','note','projects','meetings','library','pages','team','hwp','ledger','calls','telegram'];
const keyButton=key=>appNav?.querySelector(key==='note'?'[data-basket-kind-nav="note"]':key.startsWith('pane:')?`[data-basket-pane-nav="${key.slice(5)}"]`:`[data-view="${key}"]`);
const buttonByKey=new Map(ALL_KEYS.map(key=>[key,keyButton(key)]).filter(([,button])=>button));
const orderedButtons=()=>{const layout=window.KPTUMenuLayout?.current?.();return midKeys(layout).map(key=>buttonByKey.get(key)).filter(Boolean)};
let midItems=orderedButtons();
const homes=new Map([...buttonByKey.values(),mobileTrigger].filter(Boolean).map(button=>{
  const anchor=document.createComment('navigation home');button.before(anchor);return [button,anchor];
}));
const isNavigationControl=el=>homes.has(el)||phoneButtons().includes(el);
let midActive=false,navigationFocus=null;
// display:none may clear activeElement before resize/media-query callbacks.
// Retain only a menu focus lost through hiding; explicit blur or another
// focused control clears this reference.
document.addEventListener('focusin',event=>{
  if(event.target!==document.body)navigationFocus=isNavigationControl(event.target)?event.target:null;
});
document.addEventListener('focusout',event=>{
  if(event.target===navigationFocus&&event.target.getClientRects().length)navigationFocus=null;
});
function syncMenuLocation(){
  if(!midActive)return;
  const view=window.KPTURouter?.current||window.KPTURouter?.detect?.();
  let overflowCurrent=false;
  const noteMode=view==='basket'&&document.getElementById('basketView')?.dataset.kind==='note';
  midItems.forEach(button=>{
    const paneNow=document.getElementById('basketView')?.dataset.pane==='todo'?'todo':'update';
    // The [정리함] head is never the current page here: its sub item of the side shown is (like [일정] over [할 일]).
    const current=button.dataset.basketKindNav?noteMode:button.dataset.basketPaneNav?view==='basket'&&!noteMode&&button.dataset.basketPaneNav===paneNow:button.hasAttribute('data-basket-head')?false:button.dataset.view===view&&!(noteMode&&view==='basket');
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
// PC 왼쪽 메뉴: 하단바 칸 메뉴가 위, 나머지가 그 아래 같은 순서. 정리함·일정은 아래 작은 메뉴(.nav-sub)와 한 덩어리로 옮긴다.
// 맨 끝에 이어진 통화·텔레그램은 처음처럼 빈 공간 아래에 붙고, 그 위로 옮기면 보통 줄이 된다. 한 줄 메뉴 중에는 건드리지 않는다(나올 때 다시 맞춘다).
let sidebarMoved=false;
function placeSidebar(){
  if(midActive||!appNav)return;
  const layout=window.KPTUMenuLayout?.current?.();
  // 한 번도 바꾸지 않았으면 index.html의 처음 모양을 그대로 둔다(다시 끼우지 않음).
  if(!sidebarMoved&&(!layout||isDefaultLayout(layout)))return;
  sidebarMoved=true;
  const {main,tail}=pcSplit(layout);
  const spacer=appNav.querySelector('.sidebar-spacer'),links=appNav.querySelector('.nav-quick-links');
  const unit=id=>{
    const head=buttonByKey.get(id);if(!head)return [];
    const out=[],anchor=homes.get(head);
    if(anchor?.parentNode===appNav)out.push(anchor);
    out.push(head);
    const sub=head.nextElementSibling;if(sub?.classList.contains('nav-sub'))out.push(sub);
    return out;
  };
  const place=(ids,before)=>ids.map(unit).forEach(nodes=>nodes.forEach(node=>appNav.insertBefore(node,before)));
  place(main,spacer);place(tail,links);
  ['calls','telegram'].forEach(id=>{
    const button=buttonByKey.get(id);if(!button)return;
    button.classList.toggle('nav-feed',tail.includes(id));
    button.classList.toggle('nav-feed-first',tail[0]===id);
  });
}
// 메뉴 순서가 바뀌면(menu-layout.js) 한 줄 메뉴의 순서와 PC 왼쪽 메뉴 자리를 새로 맞춘다.
window.addEventListener('kptu:menu-layout-applied',()=>{
  midItems=orderedButtons();
  if(midActive)syncMidNavigation();
  else placeSidebar();
  phoneButtons().forEach(button=>{button.hidden=midActive});
  syncMenuLocation();
});
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
    placeSidebar();
    phoneButtons().forEach(button=>button.hidden=false);
    mobileTrigger.classList.remove('nav-btn','mid-menu-trigger','active');mobileTrigger.removeAttribute('aria-current');
    window.KPTURouter?.syncNavigation?.();
    if(homes.has(focus)){
      const target=mobileOpen&&menuQuery.matches?closeControl()
        :focus.getClientRects().length?focus:mobileQuery.matches?menuButton():pcFocusTarget();
      target?.focus({preventScroll:true});
    }
    return;
  }
  midActive=true;phoneButtons().forEach(button=>button.hidden=true);
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
  }else if(phoneButtons().includes(focus)&&!focus.getClientRects().length){
    (mobileOpen?closeControl():mobileTrigger)?.focus({preventScroll:true});
  }else if(focus===mobileTrigger)mobileTrigger.focus({preventScroll:true});
  syncMenuLocation();
}
const navResize=new ResizeObserver(syncMidNavigation);
if(appNav)navResize.observe(appNav);
buttonByKey.forEach(button=>navResize.observe(button));
if(mobileTrigger)navResize.observe(mobileTrigger);
midQuery.addEventListener('change',syncMidNavigation);
window.addEventListener('resize',syncMidNavigation);
document.fonts?.ready.then(syncMidNavigation);
document.fonts?.addEventListener('loadingdone',syncMidNavigation);

function closeMobile(then,fromBack=false){
  if(!mobileOpen){then?.();return}
  mobileOpen=false;mobileClosing=true;sheetWatch?.disconnect();sheetWatch=null;sheetPinned=false;resetDrag();mobileMenu.hidden=true;[mobileTrigger,mobileTab].forEach(button=>button?.setAttribute('aria-expanded','false'));repaintMobileTabs();
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
    target.append(mobileAccount.profile,mobileAccount.menuEdit,mobileAccount.theme,logoutButtons[0]);
  }
  syncKeyboard();
}
function openMobile(trigger){
  if(mobileClosing)return;
  if(mobileOpen){closeMobile();return}
  if(!menuQuery.matches||window.__KPTU_TEAM_READY_STATE__!=='workspace')return;
  mobileOpen=true;mobileOpener=trigger;dragEndedAt=0;mobileMenu.hidden=false;trigger.setAttribute('aria-expanded','true');repaintMobileTabs();
  history.pushState({...history.state,kptuMobileMenu:true},'',location.href);watchSheet();
  window.KPTUA11y?.dialog.activate(mobilePanel,{trigger,initialFocus:closeControl(),onRequestClose:closeMobile});
  pinSheet();
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
mobilePanel?.addEventListener('scroll',()=>{if(mobileOpen)sheetPinned=mobilePanel.scrollHeight-mobilePanel.scrollTop-mobilePanel.clientHeight<=2},{passive:true});
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
  const name=document.querySelector('[data-mobile-view-name]');if(name){name.hidden=home;name.textContent=({basket:document.getElementById('basketView')?.dataset.kind==='note'?'노트':'정리함',calendar:'일정',tasks:'일정',journal:'일정',diary:'일정',projects:'프로젝트',team:'담당조직',meetings:'사업 보고',library:'자료실',hwp:'HWP 편집',profile:'내 프로필',ledger:'원장',pages:'공유 페이지',search:'검색',reference:'참고 묶음',calls:'통화',telegram:'텔레그램 소식'})[event.detail?.view]||''}
});
// [+ 추가] (UI-디자인손질 8, BASKET-업데이트통합 PR 2, ED③): [업데이트] opens the update's big window (update-window.js) with no place (= the basket),
// [노트] opens the note's (note-window.js). Each saves through its existing owner-RLS path and the window closes (저장하고 닫기). A saved
// note then opens on the basket's [노트] side. Text closed without saving stays in this tab's memory for the next time only
// (never in browser storage).
let writeDraft='',writeDraftDoc=null,writerOpening=false;
const writeToast=message=>{const toast=document.querySelector('#toast');if(!toast)return;toast.textContent=message;kptuHoldToast(toast)};
// kind: 'update' (top line [+ 추가] → 업데이트) or 'note' (top line → 노트).
async function openWriter(kind='update'){
  if(writerOpening||document.querySelector('#edWindow:not(.hidden)')||window.__KPTU_TEAM_READY_STATE__!=='workspace')return;
  writerOpening=true;
  try{
    const owner=window.KPTURuntime?.session?.read?.()?.user?.id;
    // ED③ 노트: [+ 추가] → [노트] opens the note's new big window (note-window.js: title, [📎 첨부], the new editor). The saved note opens on
    // the basket's [노트] side.
    if(kind==='note'){
      const [{openNoteWindow},{requestNoteDocOpen},{createNoteFolderPick,lastViewedFolder}]=await Promise.all([import('./note-window.js'),import('./basket-note-tasks.js'),import('./note-folder-pick.js'),window.KPTUViewLoader?.prepare?.('basket')]);
      if(owner!==window.KPTURuntime?.session?.read?.()?.user?.id)return;
      // NOTE-탐색기 후속 ⑤: the note window's [폴더 ▾] is the same folder tree picker as the note screen (note-folder-pick.js → library-move-picker.js).
      // It starts at the top folder named by the last viewed folder setting (server view settings; none = 폴더 밖). The chosen folder (id) is
      // written by the window right after the note is saved (pick.put → setNoteFolderRef).
      const pick=createNoteFolderPick({initial:lastViewedFolder(),title:'새 노트를 넣을 폴더'});void pick.load();
      openNoteWindow({text:'',title:'새 노트',noteFolder:{label:pick.label,open:pick.open,get:pick.get,put:pick.put,watch:pick.watch,close:pick.close,write:true},onClose:({saved})=>{
        if(saved?.kind!=='note')return;
        requestNoteDocOpen(saved.id);
        const go=()=>window.KPTURouter?.go('basket',{source:'delegated'});
        if(history.state?.kptuOverlay==='edWindow')window.addEventListener('popstate',()=>queueMicrotask(go),{once:true});else go();
      }});
      return;
    }
    // ED③ 업데이트: [+ 추가] → [업데이트] opens the update's new big window (update-window.js). Unsaved writing stays in this tab's memory
    // (the letters, and the saved form so the formats come back) for the next time.
    const [{openUpdateWindow}]=await Promise.all([import('./update-window.js'),window.KPTUViewLoader?.prepare?.('basket')]);
    if(owner!==window.KPTURuntime?.session?.read?.()?.user?.id)return;
    openUpdateWindow({text:writeDraft,doc:writeDraftDoc,title:'쓰기',onClose:(text,{saved,value})=>{
      if(saved){writeDraft='';writeDraftDoc=null;return}
      writeDraft=text.trim()?text:'';writeDraftDoc=writeDraft?value:null;
      if(writeDraft)writeToast('저장하지 않은 글은 빠른 추가의 [업데이트]로 다시 열면 이어서 쓸 수 있어요.');
    }});
  }catch(error){console.error('menu write',error);writeToast('쓰기 화면을 열지 못했어요. 다시 시도해 주세요.')}
  finally{writerOpening=false}
}
// BASKET-정리함이름: [노트] is its own menu item (PC sidebar row, phone [메뉴] sheet row). It opens the note side through the basket's
// own one-shot hand-off (basket-note-tasks.js); [정리함] (data-view="basket") always opens the update/챙길 것 side.
// BASKET-PC메뉴: [업데이트]·[챙길 것] under [정리함] open the same panel on that side through the router (the side is written to the address,
// ?view=basket&pane=todo, and back goes to the previous side).
document.querySelectorAll('#appView [data-basket-pane-nav]').forEach(button=>button.addEventListener('click',()=>{
  window.KPTURouter?.go('basket',{source:'delegated',sub:button.dataset.basketPaneNav});
}));
window.addEventListener('kptu:basket-pane',()=>syncMenuLocation());
// MENU-HOME-편집: [노트]는 하단바에도 올 수 있고 줄이 다시 만들어지므로 누르기를 위임으로 받는다.
document.addEventListener('click',async event=>{
  const button=event.target.closest?.('#appView [data-basket-kind-nav]');if(!button)return;
  try{const {requestBasketKind}=await import('./basket-note-tasks.js');requestBasketKind(button.dataset.basketKindNav);}catch(error){console.error('basket kind',error)}
  // NAV-새로고침제자리: the note side is written to the address (?view=basket&pane=note) like [챙길 것].
  // On the basket screen already, [노트] changes the side of the same entry (Back still leaves the screen), as before.
  window.KPTURouter?.go('basket',{source:'delegated',sub:button.dataset.basketKindNav==='note'?'note':null,replaceUrl:window.KPTURouter?.current==='basket'});
});
// UI-자주가는링크: PC sidebar '자주 가는 링크 ›' opens the small links window beside it (quick-links.js owns the window and its saving).
document.querySelector('#appView>.app-nav [data-quick-links]')?.addEventListener('click',async event=>{
  const trigger=event.currentTarget;
  try{const quickLinks=await import('./quick-links.js');quickLinks.open(trigger);}catch(error){console.error('quick links',error);writeToast('자주 가는 링크를 열지 못했어요. 다시 시도해 주세요.')}
});
window.addEventListener('kptu:session-changed',()=>{writeDraft='';writeDraftDoc=null});
syncMobile();
placeSidebar();
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
// UI-상단줄 (PC ≥1024 only; phone and 761~1023px keep their own shell). One thin row above every screen, owned and drawn here:
// [sidebar] [←][→] [where] [search slot] [+ 추가] [계정 ▾]. Nothing else draws into it; the search slot is mounted later by SEARCH.
const topline=document.querySelector('[data-app-topline]'),appView=document.querySelector('#appView');
const sidebarAccount=accounts.find(account=>account.panel.id==='sidebarAccountPanel');
// The PC account trigger lives at the right end of the top line (it was the last row of the sidebar). Same node and handlers.
topline?.querySelector('[data-topline-account]')?.append(sidebarAccount?.host||document.createComment('no account'));
// ① Sidebar hide. Remembered on the server with the other view choices (view-prefs.js, profile view_prefs); unread or missing means "shown".
const navToggle=topline?.querySelector('[data-nav-toggle]');
function paintNavToggle(){
  const hidden=!!appView?.classList.contains('nav-collapsed');
  navToggle?.setAttribute('aria-expanded',String(!hidden));
  navToggle?.setAttribute('aria-label',hidden?'메뉴 보이기':'메뉴 숨기기');
  if(navToggle)navToggle.title=hidden?'메뉴 보이기':'메뉴 숨기기';
}
function setNavCollapsed(hidden,{save=true}={}){
  appView?.classList.toggle('nav-collapsed',hidden);paintNavToggle();
  if(save)viewPrefs.set('nav_collapsed',hidden?true:null);
  window.dispatchEvent(new CustomEvent('kptu:nav-collapsed',{detail:{hidden}}));
}
setNavCollapsed(false,{save:false});
// 서버 값은 앱 화면 공개 전에 한 번 도착한다(loader-v2.js가 기다림): 그때 한 번만 맞춘다.
window.addEventListener('kptu:view-prefs-ready',()=>setNavCollapsed(viewPrefs.get('nav_collapsed')===true,{save:false}),{once:true});
if(viewPrefs.status()==='ok')setNavCollapsed(viewPrefs.get('nav_collapsed')===true,{save:false});
navToggle?.addEventListener('click',()=>setNavCollapsed(!appView?.classList.contains('nav-collapsed')));
// ② ← →: the app's own record of screens moved through (and the item chosen on a left-list / right-detail screen). It never
// reads or moves browser history: a step is an ordinary KPTURouter.go (the same as a menu click), so the router stays the one
// owner of screens and history, and back/forward of the browser, PWA and Android keep their own rules (BUG-뒤로가기).
const SPLIT_OPEN={
  projects:item=>window.KPTUProjects?.open?.(item.id,false),
  team:item=>window.KPTUWorkplace?.open?.(item.id),
  tasks:item=>window.KPTUGoogleTasks?.openById?.(item.id),
  meetings:item=>window.KPTUMeetingColumns?.select?.(item)
};
const trail={entries:[],index:-1,pending:null,restoring:null};
const sameItem=(a,b)=>(a?.id??null)===(b?.id??null)&&(a?.kind??null)===(b?.kind??null);
const backBtn=topline?.querySelector('[data-trail="back"]'),forwardBtn=topline?.querySelector('[data-trail="forward"]');
function paintTrail(){
  const focused=document.activeElement;
  if(backBtn)backBtn.disabled=trail.index<=0;
  if(forwardBtn)forwardBtn.disabled=trail.index>=trail.entries.length-1;
  // A button that just went dim drops the keyboard focus; hand it to the other arrow (or the sidebar toggle).
  if(focused&&focused.disabled&&(focused===backBtn||focused===forwardBtn)){
    const other=focused===backBtn?forwardBtn:backBtn;
    (other&&!other.disabled?other:navToggle)?.focus({preventScroll:true});
  }
}
function pushTrail(entry){
  trail.entries.splice(trail.index+1);trail.entries.push(entry);
  if(trail.entries.length>50)trail.entries.shift();
  trail.index=trail.entries.length-1;paintTrail();
}
function stepTrail(delta){
  const index=trail.index+delta,entry=trail.entries[index];
  if(trail.pending&&performance.now()-trail.pending.at<10000)return;
  trail.pending=null;if(!entry)return;
  const router=window.KPTURouter;if(!router)return;
  if(router.current===entry.view){trail.index=index;paintTrail();restoreItem(entry);return}
  trail.pending={index,at:performance.now()};
  const moved=router.go(entry.view,{source:'trail'});
  // A refused move (unsaved text kept) leaves the record as it was. A view still loading moves on its own later.
  if(!moved&&window.KPTUViewLoader?.isLoaded?.(entry.view)!==false)trail.pending=null;
}
function restoreItem(entry){
  if(!entry.item||!SPLIT_OPEN[entry.view])return;
  trail.restoring={view:entry.view,id:entry.item.id,until:performance.now()+3000};
  try{SPLIT_OPEN[entry.view](entry.item)}catch(error){console.error('trail item',error)}
}
backBtn?.addEventListener('click',()=>stepTrail(-1));
forwardBtn?.addEventListener('click',()=>stepTrail(1));
window.addEventListener('kptu:view-changed',event=>{
  const view=event.detail?.view;if(!view)return;
  if(trail.pending){
    const {index}=trail.pending;trail.pending=null;
    if(trail.entries[index]?.view===view){trail.index=index;paintTrail();restoreItem(trail.entries[index]);paintWhere(view);return}
  }
  if(trail.entries[trail.index]?.view!==view)pushTrail({view,item:null});
  paintWhere(view);
});
// A left-list / right-detail screen names the item shown on the right (its own module paints the selection and sends this).
function recordItem(view,item){
  if(!view||view!==window.KPTURouter?.current||!item?.id)return;
  const current=trail.entries[trail.index];if(!current||current.view!==view)return;
  if(sameItem(current.item,item))return;
  const restoring=trail.restoring&&trail.restoring.view===view&&performance.now()<trail.restoring.until;
  if(restoring&&trail.restoring.id===item.id)trail.restoring=null;
  // The first item a screen opens by itself (last seen / first in list) belongs to the step that opened the screen;
  // while a ← → step is putting its item back, what the screen shows belongs to that step too.
  if(!current.item||restoring){current.item={...item};return}
  pushTrail({view,item:{...item}});
}
window.addEventListener('kptu:split-selection',event=>recordItem(event.detail?.view,event.detail?.item));
window.addEventListener('kptu:workplace-selection',event=>{if(event.detail?.id)recordItem('team',{id:event.detail.id})});
window.addEventListener('kptu:session-changed',()=>{trail.entries=[];trail.index=-1;trail.pending=null;trail.restoring=null;paintTrail()});
paintTrail();
// Where you are: group › screen. The group word goes to the group's first screen; the last word is the current page.
const GROUPS={calendar:'schedule',tasks:'schedule',journal:'schedule',diary:'schedule',reference:'team'};
const GROUP_HEAD={schedule:{name:'일정',view:'calendar'},team:{name:'담당조직',view:'team'}};
const VIEW_NAMES={home:'홈',basket:'정리함',calendar:'달력',tasks:'할 일',journal:'업무일지',diary:'일기',projects:'프로젝트',library:'자료실',meetings:'사업 보고',pages:'공유 페이지',team:'담당조직',hwp:'HWP 편집',profile:'내 프로필',ledger:'원장',search:'검색',reference:'참고 묶음',calls:'통화',telegram:'텔레그램 소식'};
const whereList=topline?.querySelector('[data-topline-where]');
let basketKind=null;
const whereItems=new Map();
function paintWhere(view=window.KPTURouter?.current){
  if(!whereList)return;
  // Home only: the date sits beside the location (the PC counterpart of the phone header date); view-loader fills its text.
  topline.querySelector('[data-topline-date]')?.toggleAttribute('hidden',view!=='home');
  const parts=[];
  const groupKey=GROUPS[view]||null;
  if(groupKey)parts.push({name:GROUP_HEAD[groupKey].name,go:GROUP_HEAD[groupKey].view});
  // BASKET-정리함이름: 정리함 and 노트 are two menu items, so the top line names the one shown (no group word).
  parts.push({name:view==='basket'&&basketKind==='note'?'노트':VIEW_NAMES[view]||''});
  // The item open on the right of a left-list / right-detail screen goes last ("담당조직 › 조직명"); the screen word before it
  // is plain text (it would only go to the screen already shown).
  const itemKey=view==='basket'?`basket:${basketKind==='note'?'note':'memo'}`:view;
  if(whereItems.has(itemKey))parts.push({name:whereItems.get(itemKey),item:true});
  whereList.replaceChildren(...parts.map((part,i)=>{
    const li=document.createElement('li');
    if(i<parts.length-1&&part.go){const b=document.createElement('button');b.type='button';b.className='topline-where-link';b.dataset.toplineGo=part.go;b.textContent=part.name;li.append(b)}
    else{const s=document.createElement('span');if(i===parts.length-1)s.setAttribute('aria-current','page');s.textContent=part.name;if(part.item)s.title=part.name;li.append(s)}
    return li;
  }));
}
whereList?.addEventListener('click',event=>{
  const go=event.target.closest('[data-topline-go]')?.dataset.toplineGo;if(!go)return;
  window.KPTURouter?.go(go,{source:'delegated'});
});
window.addEventListener('kptu:basket-kind',event=>{
  basketKind=event.detail?.kind||null;paintWhere();
  // The phone header names the side shown (정리함 / 노트).
  const name=document.querySelector('[data-mobile-view-name]');if(name&&window.KPTURouter?.current==='basket')name.textContent=basketKind==='note'?'노트':'정리함';
});
// ORG-PC상세정리 (요청 14:06 "상단 줄에 지금 연 것 이름"): a screen names the item it shows on the right with
// kptu:where-item {view, name}; {view, name:null} drops it. Sent by 담당조직 (workplace-detail.js) and 바구니 › 노트 (basket-notes.js, the open note's title).
// UI-상단줄제목: one name per screen (a Map), so a screen keeps its name while another screen is shown and gets it back on return; only the
// current screen's name is drawn. Every screen's title goes through this one event and this one painter.
window.addEventListener('kptu:where-item',event=>{
  const view=event.detail?.view,name=String(event.detail?.name??'').trim(),key=event.detail?.kind?`${view}:${event.detail.kind}`:view;
  if(!view)return;
  if(name){if(whereItems.get(key)===name)return;whereItems.set(key,name)}else if(!whereItems.delete(key))return;
  paintWhere();
});
window.addEventListener('kptu:session-changed',()=>{if(whereItems.size){whereItems.clear();paintWhere()}});
paintWhere();
// [+ 추가]: 업데이트·할 일·노트·일정 open the existing windows, each through its existing opener (no new save path):
// 업데이트·노트 = the menu [쓰기] window; 일정 = [+ 일정 등록]; 할 일 = the same window on its [할 일] side (as the home input's [+]).
// 일기·공유 페이지 (MTG-사업보고 1단계) = the router opens the screen, then that screen's own [새 일기] / [새 공유 페이지] button is pressed (no new save path).
const addButton=topline?.querySelector('[data-quick-add]');
const ADD_ITEMS=[['update','업데이트'],['task','할 일'],['note','노트'],['event','일정'],['diary','일기'],['page','공유 페이지'],['report','사업 보고']];
async function openEventWindow(task){
  try{
    await window.KPTUDeferredFeatures?.loadView?.('calendar');
    const open=document.querySelector('#newEventBtn');if(!open)throw new Error('missing');
    open.click();
    if(task)document.querySelector('#eventModal [data-event-mode="task"]')?.click();
  }catch(error){console.error('quick add',error);writeToast('추가 창을 열지 못했어요. 다시 시도해 주세요.')}
}
async function openScreenNewButton(view,selector){
  try{
    await window.KPTURouter?.go(view,{source:'delegated'});
    let button=null;
    for(let i=0;i<80&&!button;i++){
      const found=document.querySelector(`#${view}View ${selector}`);
      if(found&&!found.disabled&&!found.hidden&&found.getClientRects().length)button=found;else await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!button)throw new Error('missing');
    button.click();
  }catch(error){console.error('quick add',error);writeToast('추가 창을 열지 못했어요. 다시 시도해 주세요.')}
}
if(addButton){
  import('./anchored-menu.js').then(({createAnchoredMenu})=>{
    const menu=createAnchoredMenu({id:'toplineAddMenu',className:'topline-add-menu',label:'추가',historyKey:'kptuToplineAdd',key:()=>'add',
      canOpen:()=>window.__KPTU_TEAM_READY_STATE__==='workspace',
      render:()=>ADD_ITEMS.map(([kind,name])=>`<button type="button" data-topline-add="${kind}">${name}</button>`).join(''),
      onAction:button=>{
        const kind=button.dataset.toplineAdd;
        if(kind==='update'||kind==='note')void openWriter(kind);
        else if(kind==='diary')void openScreenNewButton('diary','[data-diary-new]');
        else if(kind==='page')void openScreenNewButton('pages','[data-sp-new]');
        else if(kind==='report')void openScreenNewButton('meetings','#newMeetingBtn');
        else void openEventWindow(kind==='task');
      }});
    addButton.addEventListener('click',()=>menu.open(addButton));
  }).catch(error=>console.error('quick add menu',error));
}
// [내 프로필]: close the account menu, then the router (the one owner of screen changes) opens the screen; its module loads on first use.
accounts.forEach(account=>account.profile.addEventListener('click',()=>closeAccount(()=>window.KPTURouter?.go('profile',{source:'delegated'}))));
// [메뉴 편집]: 계정 메뉴를 닫은 뒤 편집 창(menu-edit.js)을 처음 쓸 때 불러 연다.
accounts.forEach(account=>account.menuEdit.addEventListener('click',()=>closeAccount(()=>{
  const focusTrigger=menuQuery.matches?menuButton():account.trigger;
  import('./menu-edit.js').then(({openMenuEdit})=>openMenuEdit({trigger:focusTrigger})).catch(error=>{console.error('menu edit',error);writeToast('메뉴 편집을 열지 못했어요. 다시 시도해 주세요.')});
})));
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
// UI-화면색10: loader가 서버에 저장된 색을 첫 화면 공개 전에 적용한 직후(kptu:theme-applied) 상태줄 색도 그 색의 바탕으로 맞춘다.
window.addEventListener('kptu:theme-applied',syncThemeColor);
function selected(){
  const current=document.documentElement.dataset.theme||DEFAULT_THEME;
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
  if(!THEMES.includes(theme))return;
  document.documentElement.dataset.theme=theme;
  // 바로 서버에 보낸다. 서버 검사가 이 색을 거절하면(DB가 아직 모를 때) kptu:view-prefs-rejected로 원래 색으로 돌아가고 알린다.
  viewPrefs.set('theme',theme,{rejectable:true});
  void viewPrefs.flush();
  syncThemeColor();
  selected();
});
const themeToast=message=>{const toast=document.querySelector('#toast');if(!toast)return;toast.textContent=message;kptuHoldToast(toast)};
window.addEventListener('kptu:view-prefs-rejected',event=>{
  if(!event.detail?.paths?.includes('theme'))return;
  const saved=viewPrefs.get('theme');
  document.documentElement.dataset.theme=THEMES.includes(saved)?saved:DEFAULT_THEME;
  syncThemeColor();selected();
  themeToast('이 색은 서버가 아직 받지 못해 원래 색으로 되돌렸어요.');
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
