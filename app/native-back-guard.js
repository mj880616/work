(()=>{
  'use strict';
  if(window.__KPTU_NATIVE_BACK_GUARD__)return;
  window.__KPTU_NATIVE_BACK_GUARD__=true;
  const ua=navigator.userAgent||'';
  if(!/KPTUAndroid/i.test(ua))return;

  // BUG-뒤로가기: Android back is the browser's back. Every open menu, sheet, dialog and memo
  // owns a history entry, so KPTURouter.back() closes the top one first, then the previous screen;
  // at Web2's first entry the last return is home.
  // S47-18(명진 결정 규칙 3, 2026-11-01): on home with nothing left (KPTURouter.back() → false) the app leaves, like any Android app:
  // the press goes back to the app as 'share:back', which it already answers by moving itself to the back (moveTaskToBack, the app's
  // own '뒤로 보내기'; it is not killed). The bridge is the existing KPTUAppShell (allowed origin, top frame only). Without it the
  // press is consumed as before (the WebView's own earlier pages are the sign-in steps, never a place to go back to).
  // Version 3 makes the APK's injected v2 bridge (DOM guessing and its own view stack) step aside.
  window.KPTUNativeBack={
    version:3,
    handle(){
      const router=window.KPTURouter;
      // Without the Navigation API the WebView's own history back is the same traversal.
      if(!window.navigation||!router?.back)return false;
      let moved=true;
      try{moved=router.back()!==false}catch(err){console.error('native back',err)}
      if(!moved){
        const bridge=window.KPTUAppShell;
        try{bridge?.postMessage?.('share:back')}catch{/* 다리가 사라진 화면: 누름만 먹는다 */}
      }
      return true;
    },
  };
})();
