(()=>{
  if(window.__KPTU_MOBILE_SWIPE_NAV__)return;
  window.__KPTU_MOBILE_SWIPE_NAV__=true;
  // Shared with the calendar release-click guard: up to 12px per axis is still a tap.
  const tapSlop=12;
  window.KPTUMobileSwipeNavigation={tapSlop};
  const mq=window.matchMedia('(max-width:760px)');
  let gesture=null,pendingNavigation=null,suppressClickUntil=0;
  // Allow 1% rounding noise around the browser's original pinch scale.
  const isZoomed=()=> (window.visualViewport?.scale||1)>1.01;
  function cancelGesture(){
    if(gesture)resetPanel(gesture.panel,false);
    gesture=null;
    if(pendingNavigation){
      clearTimeout(pendingNavigation.timer);
      resetPanel(pendingNavigation.panel,false);
      pendingNavigation=null;
      suppressClickUntil=0;
    }
  }
  function syncTouchAction(){
    const zoomed=isZoomed();
    document.documentElement.style.setProperty('--kptu-swipe-touch-action',zoomed?'auto':'pan-y pinch-zoom');
    if(zoomed)cancelGesture();
  }
  window.visualViewport?.addEventListener('resize',syncTouchAction);
  syncTouchAction();

  const style=document.createElement('style');
  style.id='kptuSwipeStyle';
  style.textContent=`@media(max-width:760px){#appView .view-panel,#appView,.shell>main{touch-action:var(--kptu-swipe-touch-action,pan-y pinch-zoom)}#calendarView .calendar-toolbar,#calendarView .google-bar,#calendarView .google-cal-list,#calendarView .calendar-grid,#calendarView .cal-cell,#calendarView .cal-event,#calendarView .kptu-day-more{touch-action:var(--kptu-swipe-touch-action,pan-y pinch-zoom)}.kptu-swipe-panel{position:relative}.kptu-swipe-animate{transition:left .18s cubic-bezier(.2,.72,.2,1),opacity .18s ease}}`;
  document.head.appendChild(style);

  function orderedViews(){
    const out=[],seen=new Set();
    const controls=[...document.querySelectorAll('.mobile-tabs [data-view]')];
    for(const btn of controls){
      const view=btn.dataset.view;
      if(!view||seen.has(view))continue;
      const panel=document.getElementById(view+'View');
      if(!panel)continue;
      seen.add(view);out.push(view);
    }
    if(out.length)return out;
    return ['home','basket','calendar','projects','team'].filter(view=>document.getElementById(view+'View'));
  }

  function blockedTarget(target){
    return !!target?.closest?.('.modal,.app-nav,.mobile-tabs,.mobile-menu,[data-swipe-lock],.pm2-nav,.pv-nav,.cc-peer-list,.home-quick');
  }

  // An open window is any dialog the app already marks: .modal, a native <dialog open>, or role=dialog / aria-modal
  // (the shared KPTUA11y.dialog windows, choice sheets and the in-screen sheets such as the 분류 결과 입력 panel).
  const OPEN_WINDOW='.modal:not(.hidden),dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
  function windowOpen(){
    for(const el of document.querySelectorAll(OPEN_WINDOW)){
      if(el.matches('.modal:not(.hidden),dialog[open]'))return true;
      if(!el.hidden&&el.getAttribute('aria-hidden')!=='true'&&el.getClientRects().length)return true;
    }
    return false;
  }

  // Panel that follows the finger: the one under the finger, or for a touch on empty space (below a short list,
  // beside it) the screen the router shows.
  function visiblePanel(target){
    const app=document.getElementById('appView');
    if(!app||app.classList.contains('hidden'))return null;
    const own=target?.closest?.('#appView .view-panel');
    if(own)return own.classList.contains('hidden')?null:own;
    if(!(target===app||target?.contains?.(app)||app.contains(target)))return null;
    const current=document.getElementById((window.KPTURouter?.current||'')+'View');
    if(current&&app.contains(current)&&current.classList.contains('view-panel')&&!current.classList.contains('hidden'))return current;
    return app.querySelector('.view-panel:not(.hidden)');
  }

  function inSwipeArea(y,panel){
    // Empty space below a short panel still counts; the bottom bars are excluded by blockedTarget.
    return y>=panel.getBoundingClientRect().top;
  }

  const TEXT_FIELD='textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"],input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]):not([type=file])';
  function hasSelection(){
    const sel=window.getSelection?.();
    return !!sel&&!sel.isCollapsed&&!!String(sel).trim();
  }
  // Text fields, a live text selection and a row that really scrolls sideways keep their own horizontal drag.
  function ownsHorizontalDrag(target){
    if(target?.closest?.(TEXT_FIELD)||hasSelection())return true;
    for(let n=target instanceof Element?target:target?.parentElement;n&&n!==document.body&&n!==document.documentElement&&!n.matches('#appView,.view-panel');n=n.parentElement){
      if(n.scrollWidth<=n.clientWidth+1)continue;
      const ox=getComputedStyle(n).overflowX;
      if(ox==='auto'||ox==='scroll')return true;
    }
    return false;
  }

  function resetPanel(panel,animated=true){
    if(!panel)return;
    if(animated)panel.classList.add('kptu-swipe-animate');
    panel.style.left='0px';
    panel.style.opacity='';
    const done=()=>{panel.classList.remove('kptu-swipe-panel','kptu-swipe-animate');panel.style.left='';panel.style.opacity=''};
    if(animated)setTimeout(done,200);else done();
  }

  function enterPanel(panel,from){
    if(!panel)return;
    panel.classList.add('kptu-swipe-panel');
    panel.style.transition='none';
    panel.style.left=`${from}px`;
    panel.style.opacity='.78';
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      panel.style.transition='';
      panel.classList.add('kptu-swipe-animate');
      panel.style.left='0px';
      panel.style.opacity='1';
      setTimeout(()=>resetPanel(panel,false),200);
    }));
  }

  function navigate(g,dx){
    if(pendingNavigation)cancelGesture();
    const views=orderedViews();
    const current=window.KPTURouter?.current||window.KPTURouter?.detect?.()||g.panel.id.replace(/View$/,'');
    const idx=views.indexOf(current);if(idx<0){resetPanel(g.panel);return false}
    const nextIndex=dx<0?idx+1:idx-1;
    if(nextIndex<0||nextIndex>=views.length){resetPanel(g.panel);return false}
    const width=Math.max(g.panel.getBoundingClientRect().width,window.innerWidth||320);
    const dir=dx<0?-1:1;
    g.panel.classList.add('kptu-swipe-animate');
    g.panel.style.left=`${dir*Math.min(width*.28,120)}px`;
    g.panel.style.opacity='.45';
    suppressClickUntil=Date.now()+220;
    const timer=setTimeout(()=>{
      pendingNavigation=null;
      resetPanel(g.panel,false);
      if(isZoomed())return;
      const next=views[nextIndex];
      window.KPTURouter?.go?.(next,{source:'swipe',scroll:false});
      const incoming=document.getElementById(next+'View');
      enterPanel(incoming,dir<0?Math.min(width*.18,72):-Math.min(width*.18,72));
      window.scrollTo({top:0,behavior:'instant'});
    },115);
    pendingNavigation={timer,panel:g.panel};
    return true;
  }

  document.addEventListener('touchstart',event=>{
    if(isZoomed()||event.touches.length!==1){cancelGesture();return}
    if(!mq.matches||windowOpen())return;
    const panel=visiblePanel(event.target);if(!panel||blockedTarget(event.target)||ownsHorizontalDrag(event.target))return;
    const t=event.touches[0];if(!inSwipeArea(t.clientY,panel))return;
    // Nothing on the panel changes at finger-down: a tap must leave the screen exactly as it is.
    gesture={x:t.clientX,y:t.clientY,lastX:t.clientX,lastY:t.clientY,time:performance.now(),panel,axis:null,moved:false};
  },{passive:true});

  document.addEventListener('touchmove',event=>{
    if(isZoomed()||event.touches.length!==1){cancelGesture();return}
    if(!gesture||!mq.matches)return;
    const t=event.touches[0],dx=t.clientX-gesture.x,dy=t.clientY-gesture.y;
    gesture.lastX=t.clientX;gesture.lastY=t.clientY;
    if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>tapSlop)gesture.axis=Math.abs(dx)>Math.abs(dy)*1.05?'x':'y';
    if(gesture.axis==='y'){resetPanel(gesture.panel,false);gesture=null;return}
    if(gesture.axis!=='x')return;
    event.preventDefault();gesture.moved=true;gesture.panel.classList.add('kptu-swipe-panel');
    const views=orderedViews(),current=window.KPTURouter?.current||window.KPTURouter?.detect?.(),idx=views.indexOf(current),next=dx<0?idx+1:idx-1;
    const edge=idx<0||next<0||next>=views.length;
    const eased=dx*(edge?.2:.72);
    gesture.panel.style.transition='none';
    gesture.panel.style.left=`${eased}px`;
    gesture.panel.style.opacity=String(Math.max(.68,1-Math.abs(eased)/(window.innerWidth||360)*.42));
  },{passive:false});

  function finish(event,cancelled=false){
    if(isZoomed()){cancelGesture();return}
    if(!gesture)return;
    const g=gesture;gesture=null;
    if(g.axis!=='x'||!g.moved){resetPanel(g.panel,false);return}
    const t=event?.changedTouches?.[0];
    const dx=(t?.clientX??g.lastX)-g.x,dy=(t?.clientY??g.lastY)-g.y;
    const elapsed=Math.max(1,performance.now()-g.time),velocity=Math.abs(dx)/elapsed;
    const commit=!cancelled&&!windowOpen()&&Math.abs(dx)>=56&&Math.abs(dx)>Math.abs(dy)*1.05&&(elapsed<850||velocity>.18);
    if(commit)navigate(g,dx);else resetPanel(g.panel,true);
  }
  document.addEventListener('touchend',event=>finish(event,false),{passive:true});
  document.addEventListener('touchcancel',event=>finish(event,true),{passive:true});
  document.addEventListener('click',event=>{if(!isZoomed()&&Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation()}},true);
})();
