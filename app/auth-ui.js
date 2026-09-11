const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const APP_URL='https://mj880616.github.io/work/app/';
const ANDROID_CALLBACK='https://mj880616.github.io/work/app/native-callback.html?native=android';

function isNativeAndroid(){
  return /KPTUAndroid/i.test(navigator.userAgent)||/;\s*wv\)/i.test(navigator.userAgent)||/\bwv\b/i.test(navigator.userAgent);
}

function showStatus(msg,type='error'){
  const el=document.querySelector('#authStatus');
  if(!el)return;
  el.textContent=msg;
  el.className='status '+type;
}

function startGoogleLogin(){
  const redirect=isNativeAndroid()?ANDROID_CALLBACK:APP_URL;
  const url=SB+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(redirect);
  showStatus('Google 로그인으로 이동합니다…','');
  location.href=url;
}

function enhanceAuth(){
  const form=document.querySelector('#authForm');
  if(!form||document.querySelector('#googleLoginBtn'))return false;

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

  document.querySelectorAll('[data-auth-tab]').forEach(tab=>tab.addEventListener('click',()=>{
    const signup=tab.dataset.authTab==='signup';
    google.classList.toggle('hidden',signup);
    divider.classList.toggle('hidden',signup);
  }));

  const style=document.createElement('style');
  style.textContent='.google-login-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#243447;border:1px solid #d7dde4;border-radius:12px;padding:14px 16px;font-size:15px;font-weight:850;margin:0 0 12px}.google-g{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;font-weight:900;color:#4285f4}.auth-divider{display:flex;align-items:center;gap:10px;color:#939ba5;font-size:11px;margin:4px 0 15px}.auth-divider:before,.auth-divider:after{content:"";height:1px;background:#e6e9ed;flex:1}';
  document.head.appendChild(style);
  return true;
}

if(!enhanceAuth()){
  const timer=setInterval(()=>{if(enhanceAuth())clearInterval(timer)},100);
  setTimeout(()=>clearInterval(timer),10000);
}
