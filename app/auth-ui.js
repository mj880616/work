const SESSION_KEY='kptu_collab_session_v1';
const EMAIL_KEY='kptu_saved_email_v1';
const AUTO_KEY='kptu_auto_login_v1';

function isNativeWebView(){
  return /;\s*wv\)/i.test(navigator.userAgent)||/\bwv\b/i.test(navigator.userAgent);
}

function showStatus(msg){
  const el=document.querySelector('#authStatus');
  if(!el)return;
  el.textContent=msg;
  el.className='status error';
}

function startGoogleLogin(){
  const redirect=isNativeWebView()?'kptuwork://auth':new URL('./',location.href).href;
  const url='https://xmlkxfjeagycwttklxjw.supabase.co/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(redirect);
  localStorage.setItem(AUTO_KEY,'1');
  location.href=url;
}

function enhanceAuth(){
  const form=document.querySelector('#authForm');
  const email=document.querySelector('#authEmail');
  if(!form||!email||document.querySelector('#googleLoginBtn'))return false;

  const google=document.createElement('button');
  google.type='button';
  google.id='googleLoginBtn';
  google.className='google-login-btn';
  google.innerHTML='<span class="google-g">G</span><span>Google로 계속하기</span>';
  google.addEventListener('click',startGoogleLogin);
  form.parentElement.insertBefore(google,form);

  const divider=document.createElement('div');
  divider.className='auth-divider';
  divider.innerHTML='<span>또는 이메일로 로그인</span>';
  form.parentElement.insertBefore(divider,form);

  const prefs=document.createElement('div');
  prefs.id='authPrefs';
  prefs.className='auth-prefs';
  prefs.innerHTML='<label><input id="rememberEmail" type="checkbox"> 아이디 저장</label><label><input id="autoLogin" type="checkbox"> 자동 로그인</label>';
  const submit=document.querySelector('#authSubmit');
  if(submit)submit.insertAdjacentElement('afterend',prefs);

  const note=document.createElement('div');
  note.className='auth-save-note';
  note.textContent='비밀번호 자체는 기기에 저장하지 않고 로그인 세션만 유지합니다.';
  prefs.insertAdjacentElement('afterend',note);

  const savedEmail=localStorage.getItem(EMAIL_KEY)||'';
  const remember=document.querySelector('#rememberEmail');
  const auto=document.querySelector('#autoLogin');
  if(savedEmail){email.value=savedEmail;remember.checked=true}
  auto.checked=localStorage.getItem(AUTO_KEY)!=='0';

  form.addEventListener('submit',()=>{
    if(remember.checked)localStorage.setItem(EMAIL_KEY,email.value.trim());
    else localStorage.removeItem(EMAIL_KEY);
    localStorage.setItem(AUTO_KEY,auto.checked?'1':'0');
    if(!auto.checked)setTimeout(()=>localStorage.removeItem(SESSION_KEY),5000);
  },true);

  document.querySelectorAll('[data-auth-tab]').forEach(tab=>tab.addEventListener('click',()=>{
    const signup=tab.dataset.authTab==='signup';
    google.classList.toggle('hidden',signup);
    divider.classList.toggle('hidden',signup);
    prefs.classList.toggle('hidden',signup);
    note.classList.toggle('hidden',signup);
  }));

  const style=document.createElement('style');
  style.textContent='.google-login-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#243447;border:1px solid #d7dde4;border-radius:12px;padding:14px 16px;font-size:15px;font-weight:850;margin:0 0 12px}.google-g{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;font-weight:900;color:#4285f4}.auth-divider{display:flex;align-items:center;gap:10px;color:#939ba5;font-size:11px;margin:4px 0 15px}.auth-divider:before,.auth-divider:after{content:"";height:1px;background:#e6e9ed;flex:1}.auth-prefs{display:flex;justify-content:space-between;gap:12px;margin:12px 2px 0}.auth-prefs label{display:flex;align-items:center;gap:6px;font-size:12px;color:#566270;margin:0}.auth-prefs input{width:auto;margin:0}.auth-save-note{font-size:10px;line-height:1.5;color:#929aa4;margin:8px 2px 0}';
  document.head.appendChild(style);
  return true;
}

if(!enhanceAuth()){
  const timer=setInterval(()=>{if(enhanceAuth())clearInterval(timer)},100);
  setTimeout(()=>clearInterval(timer),10000);
}
