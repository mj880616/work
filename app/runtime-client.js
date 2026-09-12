(()=>{
  if(window.KPTURuntime)return;
  const config={
    url:'https://xmlkxfjeagycwttklxjw.supabase.co',
    key:'sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA',
    sessionKey:'kptu_collab_session_v1'
  };
  let refreshPromise=null;

  function read(){
    try{return JSON.parse(localStorage.getItem(config.sessionKey)||'null')}catch{return null}
  }
  function write(value){
    if(value)localStorage.setItem(config.sessionKey,JSON.stringify(value));
    else localStorage.removeItem(config.sessionKey);
    window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:value||null}}));
    return value||null;
  }
  async function refresh(){
    if(refreshPromise)return refreshPromise;
    const current=read();
    if(!current?.refresh_token)return false;
    refreshPromise=(async()=>{
      try{
        const r=await fetch(config.url+'/auth/v1/token?grant_type=refresh_token',{
          method:'POST',
          headers:{apikey:config.key,'Content-Type':'application/json'},
          body:JSON.stringify({refresh_token:current.refresh_token}),
          cache:'no-store'
        });
        if(!r.ok){write(null);return false}
        const next=await r.json();
        next.expires_at=next.expires_at||Math.floor(Date.now()/1000)+(next.expires_in||3600);
        write(next);
        return next;
      }catch(_){return false}
      finally{refreshPromise=null}
    })();
    return refreshPromise;
  }
  async function ensure(){
    const current=read();
    if(!current)return false;
    if((current.expires_at||0)<Math.floor(Date.now()/1000)+60)return !!(await refresh());
    return true;
  }
  async function api(path,{method='GET',body=null,prefer='',auth=true,headers={}}={}){
    if(auth&&!(await ensure()))throw new Error('로그인이 필요합니다.');
    const current=read();
    const h={apikey:config.key,...headers};
    if(!(body instanceof FormData)&&!h['Content-Type'])h['Content-Type']='application/json';
    h.Authorization='Bearer '+(auth?current.access_token:config.key);
    if(prefer)h.Prefer=prefer;
    const r=await fetch(path.startsWith('http')?path:config.url+path,{
      method,
      headers:h,
      body:body===null?null:(body instanceof FormData?body:JSON.stringify(body)),
      cache:'no-store'
    });
    const text=await r.text();
    let data=null;
    try{data=text?JSON.parse(text):null}catch{data=text}
    if(!r.ok)throw new Error(data?.message||data?.error_description||data?.hint||data?.error||('요청 실패 '+r.status));
    return data;
  }

  window.KPTURuntime={
    version:'1.0.0',
    config,
    session:{read,write,refresh,ensure},
    api
  };
})();
