(()=>{
  if(window.KPTURouter)return;
  const hooks=new Map();
  const VIEW_PARAM='view';
  // REF-참고묶음: the 참고 묶음 screen is entered from the organization list, so the 담당조직 menu item stays marked there.
  const NAV_ALIAS={messages:'home',myspace:'home',reference:'team'};
  // Retired addresses that now open another view (HWP 편집기 시험판 ?view=hwp-lab → ?view=hwp).
  const VIEW_ALIAS={'hwp-lab':'hwp',reports:'meetings',media:'library'};
  // PRESS-자료실편입: 옛 ?view=media(성명·보도자료 메뉴)는 자료실을 종류 '성명·보도자료' 하나만 켠 모아보기로 연다.
  // 옛 주소가 가리킨 화면에 한 번만 건네는 요청이고(takeEntry), 거르는 일은 자료실이 한다. 새 저장소 없음.
  const ALIAS_ENTRY={media:{view:'library',category:'성명·보도자료'}};
  let entryRequest=null;
  const noteAlias=raw=>{const entry=ALIAS_ENTRY[raw];if(entry)entryRequest={...entry,at:Date.now()}};
  const takeEntry=view=>{const request=entryRequest;entryRequest=null;return request&&request.view===view&&Date.now()-request.at<60000?{category:request.category}:null};
  // MTG-사업보고: the 회의 screen (#meetingsView) is written as ?view=reports in the address; the old ?view=meetings still opens it.
  const URL_NAME={meetings:'reports'};
  const urlName=view=>URL_NAME[view]||view;
  // BASKET-PC메뉴: a screen's own sides that the menu lists as sub items but that are not screens (정리함의 [챙길 것]) are written to the address as
  // one more parameter (?view=basket&pane=todo), like the 일정 sub screens are written as their own ?view=. The default side has no parameter.
  // The router owns the address and the history entries of it; the screen (basket.js) owns what is drawn and is told through the view hook
  // (detail.sub) and, for a back/forward step inside the same screen, kptu:sub-changed.
  // NAV-새로고침제자리: [노트] is a side of the same screen too (?view=basket&pane=note), so a reload on the note side stays there.
  const SUB_PARAMS={basket:{param:'pane',values:['todo','note']}};
  // NAV-새로고침제자리: the place inside a screen (an open note, the folder entered, the day picked) is written to the address as
  // the screen's own parameters, so a reload (pull-to-refresh) opens the same place. Each screen lists its keys here and writes them
  // with setPlace (replaceState: no history entry of its own, so Back still goes to the previous screen); the screen reads them back
  // with place(view) when it is entered. A step to another screen or side drops them (each screen starts fresh), a reload keeps them.
  // Nothing is stored anywhere else (no device storage, no new server state).
  const PLACE_PARAMS={basket:['note','doc','folder'],library:['folder'],diary:['day'],journal:['day','mode'],calendar:['date'],team:['org'],calls:['box','call']};
  const PLACE_KEYS=[...new Set(Object.values(PLACE_PARAMS).flat())];
  const PLACE_VALUE=/^[A-Za-z0-9_.:-]{1,80}$/;
  const subName=(view,sub)=>SUB_PARAMS[view]?.values.includes(sub)?sub:null;
  const viewName=view=>VIEW_ALIAS[view]||view;
  let bound=false,routeEntry=null,returningTo=null,goSeq=0;
  // BUG-뒤로가기: the app's first entry in this document. Back below it leaves Web2.
  const baseIndex=window.navigation?.currentEntry?.index;

  // Route ownership includes history entries made by menus and dialogs. Native
  // entry positions let a declined traversal return without rewriting either entry.
  function rememberRoute(){
    if(returningTo||!authenticatedShellReady()||viewFromUrl()!==api.current)return;
    const entry=window.navigation?.currentEntry;
    if(entry&&Number.isInteger(entry.index))routeEntry={key:entry.key,index:entry.index};
  }

  function restoreRoutePosition(){
    const entry=window.navigation?.currentEntry;
    if(!routeEntry||!entry||!Number.isInteger(entry.index))return;
    const delta=routeEntry.index-entry.index;
    if(!delta)return;
    returningTo=routeEntry.key;
    history.go(delta);
  }

  function appReady(){
    const app=document.querySelector('#appView');
    return authenticatedShellReady()&&app.classList.contains('kptu-ui-ready');
  }

  function authenticatedShellReady(){
    const app=document.querySelector('#appView');
    const context=window.KPTURuntime?.context?.read?.()||window.__KPTU_BOOT_CONTEXT__;
    const signedIn=!!window.KPTURuntime?.session?.read?.()?.access_token;
    return signedIn&&!!app&&!app.classList.contains('hidden')&&!app.inert&&!!context?.user?.id&&!!context?.workspace?.id;
  }

  function viewExists(view){
    return !!view&&!!document.getElementById(view+'View');
  }

  function viewFromUrl(){
    if(!authenticatedShellReady())return null;
    const params=new URLSearchParams(location.search);
    const requested=params.get(VIEW_PARAM)&&viewName(params.get(VIEW_PARAM));
    if(viewExists(requested))return requested;
    if(requested)return viewExists('home')?'home':null;
    if(params.get('project')&&viewExists('projects'))return 'projects';
    return viewExists('home')?'home':null;
  }

  function subFromUrl(view){
    const rule=SUB_PARAMS[view];
    return rule?subName(view,new URLSearchParams(location.search).get(rule.param)):null;
  }

  function place(view){
    const keys=PLACE_PARAMS[view],out={};
    if(!keys||viewFromUrl()!==view)return out;
    const params=new URLSearchParams(location.search);
    for(const key of keys){const value=params.get(key);if(value&&PLACE_VALUE.test(value))out[key]=value;}
    return out;
  }
  function setPlace(view,values={}){
    const keys=PLACE_PARAMS[view];
    if(!keys||api.current!==view)return false;
    // A layer is closing (its history.back() has not arrived yet): the place is written on the entry the screen ends on, after it.
    if(releasing){pendingPlace={view,values:{...(pendingPlace?.view===view?pendingPlace.values:{}),...values}};return true}
    if(viewFromUrl()!==view||!authenticatedShellReady())return false;
    const u=new URL(location.href);
    for(const [key,value] of Object.entries(values)){
      if(!keys.includes(key))continue;
      if(value===null||value===undefined||value==='')u.searchParams.delete(key);
      else if(PLACE_VALUE.test(String(value)))u.searchParams.set(key,String(value));
    }
    const next=u.pathname+(u.search||'')+u.hash;
    if(next!==location.pathname+location.search+location.hash)history.replaceState(history.state,'',next);
    return true;
  }

  function syncUrl(view,{replace=false,sub=null,keepPlace=false}={}){
    if(!authenticatedShellReady()||!viewExists(view))return;
    const u=new URL(location.href);
    if(view==='home'&&!u.searchParams.has('project'))u.searchParams.delete(VIEW_PARAM);
    else u.searchParams.set(VIEW_PARAM,urlName(view));
    for(const rule of Object.values(SUB_PARAMS))u.searchParams.delete(rule.param);
    if(!keepPlace)for(const key of PLACE_KEYS)u.searchParams.delete(key);
    if(subName(view,sub))u.searchParams.set(SUB_PARAMS[view].param,sub);
    const next=u.pathname+(u.search||'')+u.hash;
    const current=location.pathname+location.search+location.hash;
    if(next===current)return;
    const state={...(history.state||{}),kptuView:view};
    delete state[LAYERS];
    if(replace)history.replaceState(state,'',next);
    else history.pushState(state,'',next);
  }

  // BUG-뒤로가기: back closes the top open thing first. A layer is a screen opened inside
  // a view (a basket memo over its list, a panel): open() adds one same-address entry whose
  // state lists the open layers, so browser, PWA and Android back all pop it before the tab.
  // The owner's close button calls the returned close() after closing itself.
  const LAYERS='kptuLayers';
  const layers=[];let releasing=0,deferred=[],layerReturn=false,traverseDelta=0;
  // NAV-새로고침제자리: a side step (setSub) or a place (setPlace) asked while a layer is closing waits for that back to arrive,
  // so the step's own entry is added after it instead of being the one the late back leaves (one owner of the history stack).
  let pendingSub=null,pendingPlace=null;
  const chainOf=state=>Array.isArray(state?.[LAYERS])?state[LAYERS]:[];
  const topOf=state=>chainOf(state).at(-1);
  function pushLayer(layer){
    history.pushState({...(history.state||{}),[LAYERS]:[...chainOf(history.state),layer.name]},'',location.href);
    layer.index=window.navigation?.currentEntry?.index;
  }
  function openLayer(name,{close,adoptOnly=false}){
    const known=layers.find(layer=>layer.name===name);
    if(known)return {close:()=>releaseLayer(known)};
    // NAV-새로고침제자리: after a reload the entry still lists the layers that were open (a phone note folder, then a note in it); they are
    // reopened in the same order, so each one takes its place in that list instead of adding an entry.
    const adopt=!releasing&&(topOf(history.state)===name||chainOf(history.state)[layers.length]===name);
    if(adoptOnly&&!adopt)return null;
    const layer={name,close,index:adopt?window.navigation?.currentEntry?.index:undefined};
    layers.push(layer);
    if(adopt);else if(releasing)deferred.push(layer);else pushLayer(layer);
    return {close:()=>releaseLayer(layer)};
  }
  function releaseLayer(layer){
    const at=layers.indexOf(layer);
    if(at<0)return;
    layers.splice(at,1);
    const waiting=deferred.indexOf(layer);
    if(waiting>=0){deferred.splice(waiting,1);return}
    if(topOf(history.state)!==layer.name)return;
    releasing++;
    history.back();
  }
  // A view change ends the layers of the view left; their owners close them on kptu:view-changed.
  function forgetLayers(){layers.length=0;deferred=[];releasing=0;pendingSub=null;pendingPlace=null}
  function flushPending(){
    const step=pendingSub,where=pendingPlace;pendingSub=null;pendingPlace=null;
    if(step&&api.current===step.view)writeSub(step.view,step.sub,{replace:step.replace});
    deferred.splice(0).forEach(pushLayer);
    if(where)setPlace(where.view,where.values);
  }
  function returnToLayer(layer){
    const entry=window.navigation?.currentEntry;
    if(entry&&Number.isInteger(entry.index)&&Number.isInteger(layer.index)){
      const delta=layer.index-entry.index;
      if(!delta)return;
      returningTo=window.navigation.entries()[layer.index]?.key||null;
      history.go(delta);
      return;
    }
    layerReturn=true;
    history.forward();
  }
  // Same-view traversal: close each open layer whose entry was left, top first. A declined
  // close (unsaved edit) returns to its entry without rewriting history.
  function closeLeftLayers(){
    const chain=chainOf(history.state);
    while(layers.length&&!chain.includes(layers.at(-1).name)){
      const layer=layers.at(-1);
      let closed=true;
      try{closed=layer.close({fromBack:true})!==false}catch(err){console.error('layer close',layer.name,err)}
      if(!closed){returnToLayer(layer);return true}
      layers.pop();
    }
    return false;
  }
  // An entry for a layer that is no longer open (left by a tab change) is passed over in
  // the direction of travel, so one press always changes the screen.
  function skipStaleLayer(){
    const top=topOf(history.state);
    if(!top||layers.some(layer=>layer.name===top)||!traverseDelta)return;
    if(traverseDelta<0)history.back();else history.forward();
  }
  function onTraversal(){
    if(layerReturn){layerReturn=false;return}
    if(releasing){
      releasing--;
      if(!releasing)flushPending();
      restoreFromUrl('popstate');
      return;
    }
    const sameView=appReady()&&viewFromUrl()===api.current;
    if(sameView&&closeLeftLayers())return;
    restoreFromUrl('popstate');
    if(!returningTo)skipStaleLayer();
  }
  // ‹ and Android back: one step back through Web2's own entries; at the first entry the
  // last return is home (D-4a ②). Returns false only when Web2 has nothing left to close.
  function back(){
    const entry=window.navigation?.currentEntry;
    if(entry&&Number.isInteger(entry.index)&&Number.isInteger(baseIndex)){
      if(entry.index>baseIndex){history.back();return true}
    }else if(layers.length){history.back();return true}
    if(api.current&&api.current!=='home'&&viewExists('home'))return go('home',{source:'back',replaceUrl:true});
    return false;
  }

  function scrollControlIntoView(container,control,behavior='smooth'){
    if(!container||!control||container.scrollWidth<=container.clientWidth+1)return;
    const box=container.getBoundingClientRect(),item=control.getBoundingClientRect();
    const pad=Math.min(24,Math.max(8,container.clientWidth*.06));
    const visible=item.left>=box.left+pad&&item.right<=box.right-pad;
    if(visible)return;
    const current=container.scrollLeft;
    const delta=(item.left-box.left)-(container.clientWidth-item.width)/2;
    const max=Math.max(0,container.scrollWidth-container.clientWidth);
    const left=Math.max(0,Math.min(max,current+delta));
    try{container.scrollTo({left,behavior})}catch{container.scrollLeft=left}
  }

  function keepActiveNavigationVisible(view,{behavior='smooth'}={}){
    const nav=document.querySelector('#appView>.app-nav')||document.querySelector('.app-nav');
    const navButton=nav?[...nav.querySelectorAll('.nav-btn[data-view],.nav-sub-btn[data-view]')].find(btn=>btn.dataset.view===(NAV_ALIAS[view]||view)):null;
    scrollControlIntoView(nav,navButton,behavior);
  }

  function syncNavigationState(view){
    // Phone [일정] tab holds 달력(calendar), 할 일(tasks), 업무일지(journal) and 일기(diary): it opens the side seen last
    // in this tab, so the tab and current mark follow one attribute.
    const schedule=document.querySelector('.mobile-tabs [data-mobile-schedule-tab]');
    if(schedule&&['calendar','tasks','journal','diary'].includes(view))schedule.dataset.view=view;
    // UI-PC일정묶음: the PC sidebar [일정] heads a sub menu (달력·할 일·업무일지·일기). The head (data-nav-group) keeps the
    // selected look for every screen of its group but is the current page only on its own screen (달력), like [바구니]
    // over its sub rows. [달력] repeats the head's screen (data-goto), so it is marked as the current item, not a second page.
    const target=NAV_ALIAS[view]||view;
    // BASKET-정리함이름: [노트] is its own menu item but lives on the basket panel (basket.js writes the side it shows to
    // #basketView[data-kind]). On that side [정리함] is not the current page and [노트] is; on every other screen [노트] is not marked.
    const noteMode=target==='basket'&&document.getElementById('basketView')?.dataset.kind==='note';
    // BASKET-PC메뉴: [정리함] heads the sub items [업데이트]·[챙길 것] (data-basket-pane-nav, the side kept in #basketView[data-pane]). The sub item of the
    // side shown is the current page; the head only carries the group look (data-nav-open) like [일정], so one page is current, not two.
    const paneNow=document.getElementById('basketView')?.dataset.pane==='todo'?'todo':'update';
    document.querySelectorAll('.app-nav .nav-btn,.app-nav .nav-sub-btn:is([data-view],[data-goto],[data-basket-pane-nav]),.mobile-menu-panel :is([data-view],[data-basket-kind-nav])').forEach(btn=>{
      if(btn.hasAttribute('data-basket-head')){
        btn.toggleAttribute('data-nav-open',target==='basket'&&!noteMode);btn.classList.remove('active');btn.removeAttribute('aria-current');return;
      }
      const own=btn.dataset.basketPaneNav?target==='basket'&&!noteMode&&btn.dataset.basketPaneNav===paneNow:btn.dataset.basketKindNav?noteMode:(btn.dataset.view||btn.dataset.goto)===target&&!(noteMode&&btn.dataset.view==='basket');
      btn.classList.toggle('active',own||!!btn.dataset.navGroup?.split(' ').includes(target));
      if(own)btn.setAttribute('aria-current',btn.dataset.goto&&!btn.dataset.view?'true':'page');
      else btn.removeAttribute('aria-current');
    });
    // UI-모바일메뉴순서: the phone bottom tabs are marked in one place (mobile-tab-selection.mjs): exactly one is current —
    // [메뉴] while its sheet is open, else the tab of this screen ([메뉴] for screens reached through the sheet).
    window.KPTUMobileTabs?.paint(document,{view:target,noteMode});
    // UI-PC사이드바: on the PC sidebar the top line (icon + 홈) is the home menu, so it carries the home selection.
    document.querySelectorAll('.app-nav .sidebar-brand').forEach(brand=>{
      const current=(NAV_ALIAS[view]||view)==='home';
      brand.classList.toggle('active',current);
      if(current)brand.setAttribute('aria-current','page');else brand.removeAttribute('aria-current');
    });
  }

  function go(view,{scroll=true,source='api',updateUrl=true,replaceUrl=false,allowUnloaded=false,sub=null}={}){
    view=viewName(view);sub=subName(view,sub);
    if(!view||!authenticatedShellReady()||returningTo)return false;
    const lazy=window.KPTUViewLoader;
    // STAB-노트폴더시험: a view still loading switches only if nothing was opened after it was asked for. Otherwise a slow
    // module (calendar) took the screen and the address back from a view opened while it loaded.
    const request=++goSeq;
    if(!allowUnloaded&&lazy?.isLoaded&&!lazy.isLoaded(view)){
      const requestedEntry=window.navigation?.currentEntry?.key,requestedUrl=location.href;
      lazy.load(view).then(()=>{
        if(request!==goSeq)return false;
        if(source==='popstate'&&(requestedEntry?window.navigation?.currentEntry?.key!==requestedEntry:location.href!==requestedUrl))return false;
        return go(view,{scroll,source:source==='popstate'?'popstate':'lazy-ready',updateUrl,replaceUrl,allowUnloaded:true,sub});
      }).catch(err=>console.error('view lazy load',view,err));
      return false;
    }
    const target=document.getElementById(view+'View');
    if(!target)return false;
    const entry=window.navigation?.currentEntry;
    const canRestoreHistory=!!(routeEntry&&entry&&Number.isInteger(entry.index)&&routeEntry.index!==entry.index);
    const before=new CustomEvent('kptu:before-view-change',{cancelable:true,detail:{view,source,canRestoreHistory}});
    window.dispatchEvent(before);
    if(before.defaultPrevented){if(source==='popstate')restoreRoutePosition();return false;}
    if(api.current!==view)forgetLayers();
    document.querySelectorAll('#appView .view-panel').forEach(panel=>panel.classList.toggle('hidden',panel!==target));
    syncNavigationState(view);
    api.current=view;api.sub=sub;
    const navBehavior=['restore','ready','session','popstate'].includes(source)?'auto':'smooth';
    requestAnimationFrame(()=>keepActiveNavigationVisible(view,{behavior:navBehavior}));
    if(updateUrl&&(appReady()||authenticatedShellReady()))syncUrl(view,{replace:replaceUrl||source==='api',sub});
    rememberRoute();
    if(scroll)window.scrollTo({top:0,behavior:'instant'});
    const detail={view,source,sub,...(before.detail.retainBasketDraft?{retainBasketDraft:true}:{})};
    window.dispatchEvent(new CustomEvent('kptu:view-changed',{detail}));
    for(const fn of hooks.get(view)||[]){
      try{fn(detail)}catch(err){console.error('view hook',view,err)}
    }
    return true;
  }

  function restoreFromUrl(source='restore'){
    if(!appReady())return false;
    const view=viewFromUrl();
    if(!view)return false;
    const written=new URLSearchParams(location.search).get(VIEW_PARAM);
    if(written!==null&&written!==view&&written!==urlName(view))syncUrl(view,{replace:true,sub:subFromUrl(view),keepPlace:true});
    const target=document.getElementById(view+'View');
    const sub=subFromUrl(view);
    if(api.current===view&&target&&!target.classList.contains('hidden')){
      // A back/forward step inside one screen can only change its side (?pane=): the screen is told, the rest stays.
      if((api.sub||null)!==sub){api.sub=sub;window.dispatchEvent(new CustomEvent('kptu:sub-changed',{detail:{view,sub}}));}
      syncNavigationState(view);
      requestAnimationFrame(()=>keepActiveNavigationVisible(view,{behavior:'auto'}));
      rememberRoute();
      return true;
    }
    noteAlias(written);
    return go(view,{scroll:false,source,updateUrl:false,sub});
  }

  function on(view,fn){
    if(!hooks.has(view))hooks.set(view,new Set());
    hooks.get(view).add(fn);
    return()=>hooks.get(view)?.delete(fn);
  }

  function detect(){
    const panel=[...document.querySelectorAll('#appView .view-panel')].find(x=>!x.classList.contains('hidden'));
    return panel?.id?.replace(/View$/,'')||null;
  }

  function handleUiReady(){
    if(!appReady())return false;
    api.current=detect();
    return restoreFromUrl('ready');
  }

  function bind(){
    if(bound)return;
    bound=true;
    document.documentElement.dataset.kptuRouterBound='1';
    api.current=detect();
    document.addEventListener('click',e=>{
      const control=e.target.closest?.('[data-view],[data-goto]');
      if(!control)return;
      const view=control.dataset.view||control.dataset.goto;
      if(view)go(view,{source:'delegated'});
    });
    document.querySelectorAll('[data-core-brand]').forEach(brand=>{
      if(brand.dataset.coreHomeBound==='1')return;
      brand.dataset.coreHomeBound='1';
      brand.addEventListener('click',e=>{
        if(!appReady())return;
        e.preventDefault();
        go('home',{source:'brand'});
      });
    });
    if(api.current)syncNavigationState(api.current);
    if(appReady())handleUiReady();
  }

  // setSub: the screen shown changed its own side by itself (phone switch, 정리함의 [챙길 것]): one history entry for it, like a menu step.
  // replace=true only corrects the address to what the screen really shows (a step it had to refuse).
  function setSub(view,sub,{replace=false}={}){
    if(api.current!==view||!SUB_PARAMS[view]||!authenticatedShellReady())return false;
    sub=subName(view,sub);
    if(releasing){pendingSub={view,sub,replace:replace&&pendingSub?.replace!==false};return true}
    return writeSub(view,sub,{replace});
  }
  function writeSub(view,sub,{replace=false}={}){
    if((api.sub||null)===sub&&subFromUrl(view)===sub)return true;
    api.sub=sub;
    syncUrl(view,{replace,sub});
    rememberRoute();
    syncNavigationState(view);
    return true;
  }

  // syncNavigation: repaint the menu marks for the current view (topbar-actions.js calls it when the 761~1023px row hands
  // its buttons back to the PC sidebar, whose [일정] head marks its whole group).
  const api={current:null,sub:null,go,setSub,place,setPlace,on,noteAlias,takeEntry,detect,bind,restoreFromUrl,keepActiveNavigationVisible,back,layer:{open:openLayer},syncNavigation:()=>{if(api.current)syncNavigationState(api.current)}};
  window.KPTURouter=api;
  window.addEventListener('kptu:app-ui-ready',handleUiReady);
  // currententrychange comes before popstate and names the entry left, so a traversal's
  // direction is known without a navigate listener (which would change traversal timing).
  const nav=window.navigation;
  nav?.addEventListener('currententrychange',e=>{
    const from=e.from?.index,to=nav.currentEntry?.index;
    traverseDelta=e.navigationType==='traverse'&&Number.isInteger(from)&&Number.isInteger(to)?to-from:0;
    rememberRoute();
  });
  window.addEventListener('popstate',()=>{
    if(returningTo&&window.navigation?.currentEntry?.key===returningTo){returningTo=null;traverseDelta=0;rememberRoute();return;}
    onTraversal();
    traverseDelta=0;
  });
  window.addEventListener('kptu:session-changed',e=>{
    if(!e.detail?.session){api.current=null;routeEntry=null;returningTo=null;forgetLayers();return}
    if(appReady())restoreFromUrl('session');
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();
