(()=>{
  if(window.__KPTU_MOBILE_SWIPE_NAV__)return;
  window.__KPTU_MOBILE_SWIPE_NAV__=true;
  const mq=window.matchMedia('(max-width:760px)');
  let gesture=null,suppressClickUntil=0;

  const style=document.createElement('style');
  style.id='kptuSwipeStyle';
  style.textContent=`@media(max-width:760px){#appView .view-panel{touch-action:pan-y}.kptu-swipe-panel{will-change:transform,opacity}.kptu-swipe-animate{transition:transform .18s cubic-bezier(.2,.72,.2,1),opacity .18s ease}}`;
  document.head.appendChild(style);

  function orderedViews(){
    const out=[],seen=new Set();
    const controls=[...document.querySelectorAll('#ccMobileDock [data-cc-view],.app-nav .nav-btn[data-view]')];
    for(const btn of controls){
      const view=btn.dataset.ccView||btn.dataset.view;
      if(!view||seen.has(view))continue;
      const panel=document.getElementById(view+'View');
      if(!panel||btn.classList.contains('hidden')||getComputedStyle(btn).display==='none')continue;
      seen.add(view);out.push(view);
    }
    if(out.length)return out;
    return [...document.querySelectorAll('#appView .view-panel')].filter(p=>!p.dataset.swipeSkip).map(p=>p.id.replace(/View$/,''));
  }

  function blockedTarget(target){
    return !!target?.closest?.('.modal,.app-nav,#ccMobileDock,[data-swipe-lock],.pm2-nav,.pv-nav,.google-cal-list,.cc-peer-list,.calendar-toolbar');
  }

  function visiblePanel(target){
    const panel=target?.closest?.('#appView .view-panel');
    if(!panel||panel.classList.contains('hidden'))return null;
    return panel;
  }

  function inSwipeArea(y,panel){
    const r=panel.getBoundingClientRect();
    if(y<r.top||y>r.bottom)return false;
    const dock=document.querySelector('#ccMobileDock');
    if(dock&&getComputedStyle(dock).display!=='none'){
      const dr=dock.getBoundingClientRect();
      if(y>=dr.top)return false;
    }
    return true;
  }

  function resetPanel(panel,animated=true){
    if(!panel)return;
    if(animated)panel.classList.add('kptu-swipe-animate');
    panel.style.transform='translate3d(0,0,0)';
    panel.style.opacity='';
    const done=()=>{panel.classList.remove('kptu-swipe-panel','kptu-swipe-animate');panel.style.transform='';panel.style.opacity=''};
    if(animated)setTimeout(done,200);else done();
  }

  function enterPanel(panel,from){
    if(!panel)return;
    panel.classList.add('kptu-swipe-panel');
    panel.style.transition='none';
    panel.style.transform=`translate3d(${from}px,0,0)`;
    panel.style.opacity='.78';
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      panel.style.transition='';
      panel.classList.add('kptu-swipe-animate');
      panel.style.transform='translate3d(0,0,0)';
      panel.style.opacity='1';
      setTimeout(()=>resetPanel(panel,false),200);
    }));
  }

  function navigate(g,dx){
    const views=orderedViews();
    const current=window.KPTURouter?.current||window.KPTURouter?.detect?.()||g.panel.id.replace(/View$/,'');
    const idx=views.indexOf(current);if(idx<0){resetPanel(g.panel);return false}
    const nextIndex=dx<0?idx+1:idx-1;
    if(nextIndex<0||nextIndex>=views.length){resetPanel(g.panel);return false}
    const width=Math.max(g.panel.getBoundingClientRect().width,window.innerWidth||320);
    const dir=dx<0?-1:1;
    g.panel.classList.add('kptu-swipe-animate');
    g.panel.style.transform=`translate3d(${dir*Math.min(width*.28,120)}px,0,0)`;
    g.panel.style.opacity='.45';
    suppressClickUntil=Date.now()+220;
    setTimeout(()=>{
      resetPanel(g.panel,false);
      const next=views[nextIndex];
      window.KPTURouter?.go?.(next,{source:'swipe',scroll:false});
      const incoming=document.getElementById(next+'View');
      enterPanel(incoming,dir<0?Math.min(width*.18,72):-Math.min(width*.18,72));
      window.scrollTo({top:0,behavior:'instant'});
    },115);
    return true;
  }

  document.addEventListener('touchstart',event=>{
    if(!mq.matches||event.touches.length!==1||document.querySelector('.modal:not(.hidden)'))return;
    const panel=visiblePanel(event.target);if(!panel||blockedTarget(event.target))return;
    const t=event.touches[0];if(!inSwipeArea(t.clientY,panel))return;
    gesture={x:t.clientX,y:t.clientY,lastX:t.clientX,lastY:t.clientY,time:performance.now(),panel,axis:null,moved:false};
    panel.classList.add('kptu-swipe-panel');
  },{passive:true});

  document.addEventListener('touchmove',event=>{
    if(!gesture||!mq.matches||event.touches.length!==1)return;
    const t=event.touches[0],dx=t.clientX-gesture.x,dy=t.clientY-gesture.y;
    gesture.lastX=t.clientX;gesture.lastY=t.clientY;
    if(!gesture.axis&&Math.max(Math.abs(dx),Math.abs(dy))>=10)gesture.axis=Math.abs(dx)>Math.abs(dy)*1.05?'x':'y';
    if(gesture.axis==='y'){resetPanel(gesture.panel,false);gesture=null;return}
    if(gesture.axis!=='x')return;
    event.preventDefault();gesture.moved=true;
    const views=orderedViews(),current=window.KPTURouter?.current||window.KPTURouter?.detect?.(),idx=views.indexOf(current),next=dx<0?idx+1:idx-1;
    const edge=idx<0||next<0||next>=views.length;
    const eased=dx*(edge?.2:.72);
    gesture.panel.style.transition='none';
    gesture.panel.style.transform=`translate3d(${eased}px,0,0)`;
    gesture.panel.style.opacity=String(Math.max(.68,1-Math.abs(eased)/(window.innerWidth||360)*.42));
  },{passive:false});

  function finish(event,cancelled=false){
    if(!gesture)return;
    const g=gesture;gesture=null;
    if(g.axis!=='x'||!g.moved){resetPanel(g.panel,false);return}
    const t=event?.changedTouches?.[0];
    const dx=(t?.clientX??g.lastX)-g.x,dy=(t?.clientY??g.lastY)-g.y;
    const elapsed=Math.max(1,performance.now()-g.time),velocity=Math.abs(dx)/elapsed;
    const commit=!cancelled&&Math.abs(dx)>=56&&Math.abs(dx)>Math.abs(dy)*1.05&&(elapsed<850||velocity>.18);
    if(commit)navigate(g,dx);else resetPanel(g.panel,true);
  }
  document.addEventListener('touchend',event=>finish(event,false),{passive:true});
  document.addEventListener('touchcancel',event=>finish(event,true),{passive:true});
  document.addEventListener('click',event=>{if(Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation()}},true);
})();
