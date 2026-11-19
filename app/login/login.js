(()=>{
  'use strict';
  const $=s=>document.querySelector(s);
  const params=new URLSearchParams(location.search);
  const returnTo=window.KPTUAuth.safeReturn(params.get('return'));
  function status(message,type=''){const el=$('#authStatus');if(!el)return;el.textContent=message||'';el.className='status'+(type?' '+type:'')}
  function goBack(){location.replace(returnTo)}
  async function init(){
    // SEC-기능PIN잠금 ②: PIN을 잊었을 때 '구글로 다시 로그인'은 again=1로 온다 — 로그인돼 있어도 돌려보내지 않고 다시 로그인하게 한다(서버가 최근 로그인을 본다).
    if(!params.has('again')&&await window.KPTURuntime.session.ensure()){goBack();return}
    $('#googleLoginBtn').onclick=()=>{status('Google 로그인으로 이동합니다…');location.href=window.KPTUAuth.googleUrl(returnTo)};
  }
  init().catch(err=>status(err.message||String(err),'error'));
})();
