(()=>{
  if(window.__KPTU_MOBILE_SWIPE_NAV__)return;
  window.__KPTU_MOBILE_SWIPE_NAV__=true;
  const mq=window.matchMedia('(max-width:760px)');
  let start=null;
  const buttons=()=>[...document.querySelectorAll('.app-nav .nav-btn[data-view]')].filter(btn=>{
    const view=btn.dataset.view;
    return view&&document.getElementById(view+'View')&&!btn.classList.contains('hidden')&&getComputedStyle(btn).display!=='none';
  });
  const ignore=target=>!!target?.closest?.('input,textarea,select,button,a,[contenteditable="true"],.modal,.app-nav,.cc-peer-list,.google-cal-list,.toolbar,.pm2-nav');
  document.addEventListener('touchstart',event=>{
    if(!mq.matches||event.touches.length!==1||ignore(event.target)||document.querySelector('.modal:not(.hidden)'))return;
    const t=event.touches[0];
    start={x:t.clientX,y:t.clientY,time:Date.now()};
  },{passive:true});
  document.addEventListener('touchend',event=>{
    if(!start||!mq.matches)return;
    const s=start;start=null;
    const t=event.changedTouches?.[0];if(!t)return;
    const dx=t.clientX-s.x,dy=t.clientY-s.y;
    if(Date.now()-s.time>700||Math.abs(dx)<70||Math.abs(dx)<Math.abs(dy)*1.25)return;
    const nav=buttons();
    const current=window.KPTURouter?.current||window.KPTURouter?.detect?.();
    const idx=nav.findIndex(btn=>btn.dataset.view===current);
    if(idx<0)return;
    const next=dx<0?idx+1:idx-1;
    if(next<0||next>=nav.length)return;
    window.KPTURouter?.go?.(nav[next].dataset.view,{source:'swipe'});
  },{passive:true});
})();
