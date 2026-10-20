(()=>{
  'use strict';
  const $=s=>document.querySelector(s);
  const params=new URLSearchParams(location.search);
  const returnTo=window.KPTUAuth.safeReturn(params.get('return'));
  function status(message,type=''){const el=$('#authStatus');if(!el)return;el.textContent=message||'';el.className='status'+(type?' '+type:'')}
  function goBack(){location.replace(returnTo)}
  async function init(){
    if(await window.KPTURuntime.session.ensure()){goBack();return}
    $('#googleLoginBtn').onclick=()=>{status('Google 로그인으로 이동합니다…');location.href=window.KPTUAuth.googleUrl(returnTo)};
  }
  init().catch(err=>status(err.message||String(err),'error'));
})();
