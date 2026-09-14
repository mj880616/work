(()=>{
  'use strict';
  const $=s=>document.querySelector(s);
  const params=new URLSearchParams(location.search);
  const returnTo=window.KPTUAuth.safeReturn(params.get('return'));
  const invite=params.get('invite');
  let mode='signin';
  function status(message,type=''){const el=$('#authStatus');if(!el)return;el.textContent=message||'';el.className='status'+(type?' '+type:'')}
  function setMode(next){mode=next;document.querySelectorAll('[data-auth-tab]').forEach(b=>b.classList.toggle('active',b.dataset.authTab===next));$('#displayNameRow').classList.toggle('hidden',next!=='signup');$('#passwordConfirmRow').classList.toggle('hidden',next!=='signup');$('#authPassword').autocomplete=next==='signup'?'new-password':'current-password';$('#authSubmit').textContent=next==='signup'?'계정 만들기':'로그인';status('')}
  function destination(){if(!invite)return returnTo;const u=new URL(returnTo,window.KPTUAuth.APP_ROOT);u.searchParams.set('invite',invite);return u.href}
  function goBack(){location.replace(destination())}
  async function init(){
    if(invite)$('#inviteNotice').classList.remove('hidden');
    $('#publicBackLink').href=returnTo;
    if(await window.KPTURuntime.session.ensure()){goBack();return}
    $('#emailAuthToggle').onclick=()=>{$('#emailAuthPanel').classList.remove('hidden');$('#emailAuthToggle').classList.add('hidden');$('#authEmail').focus()};
    document.querySelectorAll('[data-auth-tab]').forEach(b=>b.onclick=()=>setMode(b.dataset.authTab));
    $('#googleLoginBtn').onclick=()=>{status('Google 로그인으로 이동합니다…');location.href=window.KPTUAuth.googleUrl(destination())};
    $('#authForm').onsubmit=async e=>{
      e.preventDefault();const email=$('#authEmail').value.trim(),password=$('#authPassword').value,name=$('#authDisplayName').value.trim();status('처리 중…');
      try{if(mode==='signup'){if(password!==$('#authPasswordConfirm').value)throw new Error('비밀번호 확인이 일치하지 않습니다.');const result=await window.KPTUAuth.signUp(email,password,name);if(result.needsConfirmation){status('계정이 생성되었습니다. 이메일 인증 후 로그인해 주세요.','ok');setMode('signin');return}}else await window.KPTUAuth.signIn(email,password);goBack()}catch(err){status(err.message||String(err),'error')}
    };
  }
  init().catch(err=>status(err.message||String(err),'error'));
})();
