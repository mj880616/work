(()=>{
  if(window.__KPTU_MOBILE_SAFE_AREA__)return;
  window.__KPTU_MOBILE_SAFE_AREA__=true;
  const style=document.createElement('style');
  style.id='kptuMobileSafeAreaStyle';
  style.textContent=`@media(max-width:760px){
    :root{--kptu-mobile-dock:calc(60px + env(safe-area-inset-bottom));--kptu-mobile-gap:18px}
    html,body{scroll-padding-bottom:calc(var(--kptu-mobile-dock) + var(--kptu-mobile-gap))!important}
    body{padding-bottom:0!important}
    main{padding-bottom:calc(var(--kptu-mobile-dock) + var(--kptu-mobile-gap))!important}
    #appView .view-panel{padding-bottom:0!important;scroll-padding-bottom:calc(var(--kptu-mobile-dock) + var(--kptu-mobile-gap))!important}
    .toast{bottom:calc(var(--kptu-mobile-dock) + 8px)!important}
    .modal{z-index:120!important;padding:max(8px,env(safe-area-inset-top)) 0 max(8px,env(safe-area-inset-bottom))!important;align-items:end!important;overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch}
    .modal>.modal-card{width:100%!important;max-height:calc(100dvh - max(16px,env(safe-area-inset-top)) - max(16px,env(safe-area-inset-bottom)))!important;overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch;scroll-padding-bottom:24px!important;padding-bottom:max(24px,env(safe-area-inset-bottom))!important}
    #pm2DetailModal .pm2-detail-card{min-height:0!important}
  }`;
  document.head.appendChild(style);
})();
