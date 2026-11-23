(()=>{
  'use strict';
  const auth=window.KPTUAuth;
  if(!auth)return;
  const baseGoogleUrl=auth.googleUrl.bind(auth);
  const ua=navigator.userAgent||'';
  // S62-34·S69-10: 플레이 스토어 판은 사용자 에이전트에 WorkOnPlay를 붙인다 → 로그인 복귀를 플레이 판(com.workonplus.app)으로.
  const platform=/WorkOnPlay/.test(ua)?'android-play':/KPTUAndroid/i.test(ua)||/;\s*wv\)/i.test(ua)||/\bwv\b/i.test(ua)?'android':/KPTUWindows/i.test(ua)?'windows':'';
  if(!platform)return;
  auth.googleUrl=()=>{
    const url=new URL(baseGoogleUrl(auth.APP_ROOT));
    url.searchParams.set('redirect_to',new URL(`native-callback.html?native=${platform}`,auth.APP_ROOT).href);
    return url.href;
  };
})();
