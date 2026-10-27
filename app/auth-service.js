(()=>{
  'use strict';
  if(window.KPTUAuth)return;
  const marker='/app/';
  const markerAt=location.pathname.indexOf(marker);
  const rootPath=markerAt>=0?location.pathname.slice(0,markerAt+marker.length):'/work/app/';
  const APP_ROOT=new URL(rootPath,location.origin).href;
  const rt=window.KPTURuntime;
  if(!rt)throw new Error('KPTURuntime is required before KPTUAuth');
  const {url:SB,key:KEY}=rt.config;
  function safeReturn(raw){if(!raw)return APP_ROOT;try{const u=new URL(raw,APP_ROOT),app=new URL(APP_ROOT);if(u.origin!==app.origin||!u.pathname.startsWith(app.pathname))return APP_ROOT;if(u.pathname.startsWith(app.pathname+'login/'))return APP_ROOT;return u.href}catch{return APP_ROOT}}
  function loginUrl(returnTo=location.href){const u=new URL('login/',APP_ROOT);u.searchParams.set('return',safeReturn(returnTo));return u.href}
  function googleUrl(returnTo=APP_ROOT){const u=new URL(SB+'/auth/v1/authorize');u.searchParams.set('provider','google');u.searchParams.set('redirect_to',safeReturn(returnTo));return u.href}
  window.KPTUAuth={APP_ROOT,safeReturn,loginUrl,googleUrl};
})();
