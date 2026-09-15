(()=>{
  'use strict';
  const auth=window.KPTUAuth;
  if(!auth)return;
  const baseGoogleUrl=auth.googleUrl.bind(auth);
  const ua=navigator.userAgent||'';
  const platform=/KPTUAndroid/i.test(ua)||/;\s*wv\)/i.test(ua)||/\bwv\b/i.test(ua)?'android':/KPTUWindows/i.test(ua)?'windows':'';
  if(!platform)return;
  auth.googleUrl=()=>{
    const url=new URL(baseGoogleUrl(auth.APP_ROOT));
    url.searchParams.set('redirect_to',new URL(`native-callback.html?native=${platform}`,auth.APP_ROOT).href);
    return url.href;
  };
})();
