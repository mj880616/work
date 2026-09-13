(()=>{
  if(window.__KPTU_MOBILE_SAFE_AREA__)return;
  window.__KPTU_MOBILE_SAFE_AREA__=true;
  const style=document.createElement('style');
  style.id='kptuMobileSafeAreaStyle';
  style.textContent=`@media(max-width:760px){
    :root{--kptu-mobile-dock:calc(72px + env(safe-area-inset-bottom));--kptu-mobile-gap:14px}
    html,body{scroll-padding-bottom:calc(var(--kptu-mobile-dock) + var(--kptu-mobile-gap))!important}
    body{padding-bottom:var(--kptu-mobile-dock)!important}
    main{padding-bottom:calc(var(--kptu-mobile-dock) + 30px)!important}
    #appView .view-panel{padding-bottom:calc(var(--kptu-mobile-dock) + 22px)!important;scroll-padding-bottom:calc(var(--kptu-mobile-dock) + 22px)!important}
    .toast{bottom:calc(var(--kptu-mobile-dock) + 8px)!important}
    .modal:not([id^="pm2"]){padding:max(8px,env(safe-area-inset-top)) 0 calc(var(--kptu-mobile-dock) + 8px)!important;align-items:end!important;overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch}
    .modal:not([id^="pm2"])>.modal-card{width:100%!important;max-height:calc(100dvh - var(--kptu-mobile-dock) - 16px)!important;overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch;scroll-padding-bottom:24px!important;padding-bottom:24px!important}
    [id^="pm2"][id$="Modal"].modal{padding-bottom:calc(var(--kptu-mobile-dock) + 10px)!important;scroll-padding-bottom:calc(var(--kptu-mobile-dock) + 10px)!important}
    [id^="pm2"][id$="Modal"].modal .modal-card{padding-bottom:28px!important}
    #pm2DetailModal .pm2-detail-card{min-height:calc(100dvh - var(--kptu-mobile-dock) - 12px)!important}
  }`;
  document.head.appendChild(style);
})();
