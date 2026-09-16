(()=>{
  if(window.KPTURuntime)return;
  const config={
    url:'https://xmlkxfjeagycwttklxjw.supabase.co',
    key:'sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA',
    sessionKey:'kptu_collab_session_v1',
    timeoutMs:15000
  };
  let refreshPromise=null;

  class RuntimeError extends Error{
    constructor(message,{status=0,code='request_failed',retryable=false,cause=null}={}){
      super(message);
      this.name='KPTURuntimeError';
      this.status=status;
      this.code=code;
      this.retryable=retryable;
      if(cause)this.cause=cause;
    }
  }

  function read(){
    try{return JSON.parse(localStorage.getItem(config.sessionKey)||'null')}catch{return null}
  }
  function write(value){
    if(value)localStorage.setItem(config.sessionKey,JSON.stringify(value));
    else localStorage.removeItem(config.sessionKey);
    window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:value||null}}));
    return value||null;
  }
  function timeoutError(cause){
    return new RuntimeError('요청 시간이 초과되었습니다. 다시 시도해 주세요.',{code:'timeout',retryable:true,cause});
  }
  function networkError(cause){
    return new RuntimeError('네트워크 연결을 확인한 뒤 다시 시도해 주세요.',{code:'network_error',retryable:true,cause});
  }
  async function fetchWithTimeout(url,options={},timeoutMs=config.timeoutMs){
    const controller=new AbortController();
    const upstream=options.signal;
    const onAbort=()=>controller.abort();
    if(upstream){
      if(upstream.aborted)controller.abort();
      else upstream.addEventListener('abort',onAbort,{once:true});
    }
    const timer=Number(timeoutMs)>0?setTimeout(()=>controller.abort(),Number(timeoutMs)):null;
    try{
      return await fetch(url,{...options,signal:controller.signal});
    }catch(e){
      if(controller.signal.aborted&&!upstream?.aborted)throw timeoutError(e);
      if(e?.name==='AbortError')throw timeoutError(e);
      throw networkError(e);
    }finally{
      if(timer)clearTimeout(timer);
      upstream?.removeEventListener?.('abort',onAbort);
    }
  }
  async function responseData(r){
    const text=await r.text();
    if(!text)return null;
    try{return JSON.parse(text)}catch{return text}
  }
  function responseMessage(data,status){
    return data?.message||data?.error_description||data?.hint||data?.error||('요청 실패 '+status);
  }
  function retryableStatus(status){
    return status===408||status===425||status===429||status>=500;
  }
  function sessionRequired(message='로그인이 필요합니다.'){
    return new RuntimeError(message,{status:401,code:'session_required',retryable:false});
  }

  async function refresh(){
    if(refreshPromise)return refreshPromise;
    const current=read();
    if(!current?.refresh_token)return false;
    refreshPromise=(async()=>{
      try{
        const r=await fetchWithTimeout(config.url+'/auth/v1/token?grant_type=refresh_token',{
          method:'POST',
          headers:{apikey:config.key,'Content-Type':'application/json'},
          body:JSON.stringify({refresh_token:current.refresh_token}),
          cache:'no-store'
        });
        const data=await responseData(r);
        if(!r.ok){
          if([400,401,403].includes(r.status)){
            write(null);
            return false;
          }
          throw new RuntimeError(responseMessage(data,r.status),{status:r.status,code:'session_refresh_failed',retryable:retryableStatus(r.status)});
        }
        const next=data||{};
        next.expires_at=next.expires_at||Math.floor(Date.now()/1000)+(next.expires_in||3600);
        write(next);
        return next;
      }catch(e){
        if(e instanceof RuntimeError&&e.code==='session_refresh_failed')throw e;
        throw new RuntimeError('세션 갱신에 일시적으로 실패했습니다. 다시 시도해 주세요.',{
          status:e?.status||0,
          code:'session_refresh_failed',
          retryable:true,
          cause:e
        });
      }finally{refreshPromise=null}
    })();
    return refreshPromise;
  }
  async function ensure(){
    const current=read();
    if(!current)return false;
    if((current.expires_at||0)<Math.floor(Date.now()/1000)+60)return !!(await refresh());
    return true;
  }
  async function api(path,{method='GET',body=null,prefer='',auth=true,headers={},timeoutMs=config.timeoutMs}={}){
    if(auth&&!(await ensure()))throw sessionRequired();
    const url=path.startsWith('http')?path:config.url+path;
    const requestBody=body===null?null:(body instanceof FormData?body:JSON.stringify(body));

    async function request(){
      const current=read();
      if(auth&&!current?.access_token)throw sessionRequired();
      const h={apikey:config.key,...headers};
      if(!(body instanceof FormData)&&!h['Content-Type'])h['Content-Type']='application/json';
      h.Authorization='Bearer '+(auth?current.access_token:config.key);
      if(prefer)h.Prefer=prefer;
      return fetchWithTimeout(url,{method,headers:h,body:requestBody,cache:'no-store'},timeoutMs);
    }

    let r=await request();
    if(auth&&r.status===401){
      const refreshed=await refresh();
      if(!refreshed)throw sessionRequired();
      r=await request();
      if(r.status===401){
        write(null);
        throw sessionRequired();
      }
    }

    const data=await responseData(r);
    if(!r.ok){
      throw new RuntimeError(responseMessage(data,r.status),{
        status:r.status,
        code:'http_'+r.status,
        retryable:retryableStatus(r.status)
      });
    }
    return data;
  }

  window.KPTURuntime={
    version:'1.1.0',
    config,
    RuntimeError,
    session:{read,write,refresh,ensure},
    api
  };
})();
