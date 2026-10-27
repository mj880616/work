(()=>{
  'use strict';
  if(window.__KPTU_NATIVE_BACK_GUARD__)return;
  window.__KPTU_NATIVE_BACK_GUARD__=true;
  const ua=navigator.userAgent||'';
  if(!/KPTUAndroid/i.test(ua))return;

  // BUG-뒤로가기: Android back is the browser's back. Every open menu, sheet, dialog and memo
  // owns a history entry, so KPTURouter.back() closes the top one first, then the previous tab;
  // at Web2's first entry the last return is home and the press is consumed (the app stays).
  // Version 3 makes the APK's injected v2 bridge (DOM guessing and its own view stack) step aside.
  window.KPTUNativeBack={
    version:3,
    handle(){
      const router=window.KPTURouter;
      // Without the Navigation API the WebView's own history back is the same traversal.
      if(!window.navigation||!router?.back)return false;
      try{router.back()}catch(err){console.error('native back',err)}
      return true;
    },
  };
})();
