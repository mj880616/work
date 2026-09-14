(()=>{
  'use strict';
  if(window.KPTUAuth)return;
  const APP_ROOT='https://mj880616.github.io/work/app/';
  const rt=window.KPTURuntime;
  if(!rt)throw new Error('KPTURuntime is required before KPTUAuth');
  const {url:SB,key:KEY}=rt.config;

  function normalizeSession(data){
    if(!data?.access_token)return null;
    data.expires_at=data.expires_at||Math.floor(Date.now()/1000)+(data.expires_in||3600);
    return data;
  }

  async function signIn(email,password){
    const r=await fetch(SB+'/auth/v1/token?grant_type=password',{
      method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},
      body:JSON.stringify({email,password}),cache:'no-store'
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error_description||data.msg||data.message||'로그인에 실패했습니다.');
    const session=normalizeSession(data);
    rt.session.write(session);
    return session;
  }

  async function signUp(email,password,displayName=''){
    const redirectTo=APP_ROOT+'confirmed.html';
    const u=new URL(SB+'/auth/v1/signup');
    u.searchParams.set('redirect_to',redirectTo);
    const r=await fetch(u,{
      method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},
      body:JSON.stringify({email,password,data:{display_name:displayName}}),cache:'no-store'
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error_description||data.msg||data.message||'계정 생성에 실패했습니다.');
    const session=normalizeSession(data);
    if(session)rt.session.write(session);
    return {session,needsConfirmation:!session};
  }

  function safeReturn(raw){
    if(!raw)return APP_ROOT;
    try{
      const u=new URL(raw,APP_ROOT);
      const app=new URL(APP_ROOT);
      if(u.origin!==app.origin||!u.pathname.startsWith(app.pathname))return APP_ROOT;
      if(u.pathname.startsWith(app.pathname+'login/'))return APP_ROOT;
      return u.href;
    }catch{return APP_ROOT}
  }

  function loginUrl(returnTo=location.href){
    const u=new URL('login/',APP_ROOT);
    u.searchParams.set('return',safeReturn(returnTo));
    return u.href;
  }

  function googleUrl(){
    const u=new URL(SB+'/auth/v1/authorize');
    u.searchParams.set('provider','google');
    u.searchParams.set('redirect_to',APP_ROOT);
    return u.href;
  }

  window.KPTUAuth={APP_ROOT,signIn,signUp,safeReturn,loginUrl,googleUrl};
})();
