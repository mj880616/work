(()=>{
  'use strict';
  const $=s=>document.querySelector(s);
  const params=new URLSearchParams(location.search);
  const returnTo=window.KPTUAuth.safeReturn(params.get('return'));
  function status(message,type=''){const el=$('#authStatus');if(!el)return;el.textContent=message||'';el.className='status'+(type?' '+type:'')}
  function goBack(){location.replace(returnTo)}
  async function init(){
    if(await window.KPTURuntime.session.ensure()){goBack();return}
    $('#emailAuthToggle').onclick=()=>{$('#emailAuthPanel').classList.remove('hidden');$('#emailAuthToggle').classList.add('hidden');$('#authEmail').focus()};
    $('#googleLoginBtn').onclick=()=>{status('Google 로그인으로 이동합니다…');location.href=window.KPTUAuth.googleUrl(returnTo)};
    $('#authForm').onsubmit=async e=>{
      e.preventDefault();const email=$('#authEmail').value.trim(),password=$('#authPassword').value;status('처리 중…');
      try{await window.KPTUAuth.signIn(email,password);goBack()}catch(err){status(err.message||String(err),'error')}
    };
  }
  init().catch(err=>status(err.message||String(err),'error'));
})();
