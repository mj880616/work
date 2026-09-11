function tidyAuth(){
  const google=document.querySelector('#googleLoginBtn');
  const card=document.querySelector('#authView .auth-card');
  const tabs=card?.querySelector('.auth-tabs');
  const form=document.querySelector('#authForm');
  const status=document.querySelector('#authStatus');
  if(!google||!card||!tabs||!form||!status)return false;
  if(document.querySelector('#emailAuthToggle'))return true;

  document.querySelector('#authPrefs')?.remove();
  card.querySelector('.auth-save-note')?.remove();
  document.querySelector('#forgotPasswordBtn')?.remove();
  card.querySelector('.auth-divider')?.remove();

  const toggle=document.createElement('button');
  toggle.id='emailAuthToggle';
  toggle.type='button';
  toggle.className='email-auth-toggle';
  toggle.textContent='다른 방법으로 로그인';

  const wrap=document.createElement('div');
  wrap.id='emailAuthWrap';
  wrap.className='email-auth-wrap hidden';
  google.insertAdjacentElement('afterend',toggle);
  toggle.insertAdjacentElement('afterend',wrap);
  wrap.appendChild(tabs);
  wrap.appendChild(form);

  const note=document.createElement('p');
  note.className='login-session-note';
  note.textContent='로그인 상태는 기본으로 유지되며, 로그아웃하거나 세션이 만료될 때 다시 로그인합니다.';
  status.insertAdjacentElement('afterend',note);

  toggle.addEventListener('click',()=>{
    const open=wrap.classList.contains('hidden');
    wrap.classList.toggle('hidden',!open);
    toggle.textContent=open?'이메일 로그인 닫기':'다른 방법으로 로그인';
  });

  const style=document.createElement('style');
  style.textContent='.email-auth-toggle{width:100%;border:0;background:transparent;color:#657383;font-size:12px;font-weight:750;padding:9px 4px;cursor:pointer}.email-auth-wrap{border-top:1px solid #e8ebef;margin-top:7px;padding-top:14px}.email-auth-wrap.hidden{display:none!important}.login-session-note{text-align:center;color:#929aa4;font-size:10px;line-height:1.5;margin:8px 8px 0}#authStatus{margin-top:8px}';
  document.head.appendChild(style);
  return true;
}

if(!tidyAuth()){
  const timer=setInterval(()=>{if(tidyAuth())clearInterval(timer)},100);
  setTimeout(()=>clearInterval(timer),10000);
}
