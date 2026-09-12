const ALF_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const ALF_APP='https://mj880616.github.io/work/app/';
const ALF_NATIVE=ALF_APP+'native-callback.html?native=android';
function alfNative(){return /KPTUAndroid/i.test(navigator.userAgent)||/;\s*wv\)/i.test(navigator.userAgent)||/\bwv\b/i.test(navigator.userAgent)}
function alfBind(){
  const btn=document.querySelector('#googleLoginBtn');
  if(!btn||btn.dataset.alfBound)return false;
  btn.dataset.alfBound='1';
  btn.addEventListener('click',e=>{
    e.preventDefault();
    e.stopImmediatePropagation();
    const redirect=alfNative()?ALF_NATIVE:ALF_APP;
    const url=ALF_SB+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(redirect);
    const st=document.querySelector('#authStatus');
    if(st){st.textContent='Google 로그인으로 이동합니다…';st.className='status'}
    location.href=url;
  },true);
  return true;
}
if(!alfBind()){
  const t=setInterval(()=>{if(alfBind())clearInterval(t)},50);
  setTimeout(()=>clearInterval(t),5000);
}
