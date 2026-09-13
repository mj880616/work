const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const APP_URL='https://mj880616.github.io/work/app/';
const ANDROID_CALLBACK=APP_URL+'native-callback.html?native=android';
const WINDOWS_CALLBACK=APP_URL+'native-callback.html?native=windows';
function isNativeAndroid(){return /KPTUAndroid/i.test(navigator.userAgent)||/;\s*wv\)/i.test(navigator.userAgent)||/\bwv\b/i.test(navigator.userAgent)}
function isNativeWindows(){return /KPTUWindows/i.test(navigator.userAgent)}
function showStatus(msg,type='error'){const el=document.querySelector('#authStatus');if(!el)return;el.textContent=msg;el.className='status '+type}
function startGoogleLogin(){let redirect=APP_URL;if(isNativeAndroid())redirect=ANDROID_CALLBACK;else if(isNativeWindows())redirect=WINDOWS_CALLBACK;const url=SB+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(redirect);showStatus('Google 로그인으로 이동합니다…','');location.href=url}
function syncPasswordConfirmation(){const input=document.querySelector('#authPasswordConfirm');if(!input)return;const signup=document.querySelector('[data-auth-tab="signup"]')?.classList.contains('active')===true;input.disabled=!signup;input.required=signup;if(!signup)input.value=''}
function enhanceAuth(){
  const form=document.querySelector('#authForm'),card=document.querySelector('#authView .auth-card'),tabs=card?.querySelector('.auth-tabs'),status=document.querySelector('#authStatus');
  if(!form||!card||!tabs||!status)return false;
  if(document.querySelector('#googleLoginBtn'))return true;
  const google=document.createElement('button');google.type='button';google.id='googleLoginBtn';google.className='google-login-btn';google.innerHTML='<span class="google-g">G</span><span>Google로 계속하기</span>';google.addEventListener('click',startGoogleLogin);tabs.insertAdjacentElement('beforebegin',google);
  const toggle=document.createElement('button');toggle.id='emailAuthToggle';toggle.type='button';toggle.className='email-auth-toggle';toggle.textContent='다른 방법으로 로그인';google.insertAdjacentElement('afterend',toggle);
  const wrap=document.createElement('div');wrap.id='emailAuthWrap';wrap.className='email-auth-wrap hidden';toggle.insertAdjacentElement('afterend',wrap);wrap.appendChild(tabs);wrap.appendChild(form);
  const note=document.createElement('p');note.className='login-session-note';note.textContent='로그인 상태는 기본으로 유지되며, 로그아웃하거나 세션이 만료될 때 다시 로그인합니다.';status.insertAdjacentElement('afterend',note);
  toggle.addEventListener('click',()=>{const open=wrap.classList.contains('hidden');wrap.classList.toggle('hidden',!open);toggle.textContent=open?'이메일 로그인 닫기':'다른 방법으로 로그인'});
  tabs.querySelectorAll('[data-auth-tab]').forEach(btn=>btn.addEventListener('click',()=>queueMicrotask(syncPasswordConfirmation)));
  window.addEventListener('kptu:auth-fields-ready',syncPasswordConfirmation);
  const style=document.createElement('style');style.textContent='.google-login-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#243447;border:1px solid #d7dde4;border-radius:12px;padding:14px 16px;font-size:15px;font-weight:850;margin:0 0 8px}.google-g{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;font-weight:900;color:#4285f4}.email-auth-toggle{width:100%;border:0;background:transparent;color:#657383;font-size:12px;font-weight:750;padding:9px 4px;cursor:pointer}.email-auth-wrap{border-top:1px solid #e8ebef;margin-top:7px;padding-top:14px}.email-auth-wrap.hidden{display:none!important}.login-session-note{text-align:center;color:#929aa4;font-size:10px;line-height:1.5;margin:8px 8px 0}';document.head.appendChild(style);
  return true
}
if(!enhanceAuth()){const timer=setInterval(()=>{if(enhanceAuth())clearInterval(timer)},50);setTimeout(()=>clearInterval(timer),5000)}
