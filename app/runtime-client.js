(()=>{
  if(window.KPTURuntime)return;
  const config={
    url:'https://xmlkxfjeagycwttklxjw.supabase.co',
    key:'sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA',
    sessionKey:'kptu_collab_session_v1',
    timeoutMs:15000
  };
  let refreshPromise=null;
  let sessionEpoch=0;
  let bootContext=null;
  const mutationFlights=new Map();
  const getFlights=new Map();

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
  function sessionOwner(value=read()){return value?.user?.id||''}
  function matchesSessionSnapshot(expected){
    const latest=read();
    return !!latest&&latest.access_token===expected?.access_token&&latest.refresh_token===expected?.refresh_token;
  }
  function write(value){
    const beforeOwner=sessionOwner();
    const afterOwner=value?.user?.id||'';
    if(value)localStorage.setItem(config.sessionKey,JSON.stringify(value));
    else localStorage.removeItem(config.sessionKey);
    if(beforeOwner!==afterOwner){
      sessionEpoch+=1;
      getFlights.clear();
      bootContext=null;
    }
    window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:value||null,epoch:sessionEpoch}}));
    return value||null;
  }
  function contextRead(){return bootContext}
  function contextSet(next){
    const owner=sessionOwner();
    if(!next?.user?.id||!next?.workspace?.id||next.user.id!==owner)return null;
    bootContext={user:next.user,membership:next.membership||null,workspace:next.workspace};
    return bootContext;
  }
  function contextClear(){bootContext=null;return null}
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
  function mutationBodyKey(body){
    if(body===null||body===undefined)return '';
    if(body instanceof FormData){
      const parts=[];
      for(const [key,value] of body.entries()){
        if(typeof value==='string')parts.push([key,'text',value]);
        else parts.push([key,'blob',value.name||'',Number(value.size)||0,value.type||'',Number(value.lastModified)||0]);
      }
      return JSON.stringify(parts);
    }
    try{return JSON.stringify(body)}catch{return null}
  }
  function getKey(path,{method='GET',auth=true,headers={}}={}){
    const verb=String(method||'GET').toUpperCase();
    if(verb!=='GET')return null;
    const headerKey=JSON.stringify(Object.entries(headers||{}).sort(([a],[b])=>a.localeCompare(b)));
    return [sessionEpoch,path,auth?'auth':'anon',headerKey].join('\n');
  }
  function mutationKey(path,{method='GET',body=null,prefer='',auth=true,headers={}}={}){
    const verb=String(method||'GET').toUpperCase();
    if(!['POST','PUT','PATCH','DELETE'].includes(verb))return null;
    const bodyKey=mutationBodyKey(body);
    if(bodyKey===null)return null;
    const headerKey=JSON.stringify(Object.entries(headers||{}).sort(([a],[b])=>a.localeCompare(b)));
    return [verb,path,auth?'auth':'anon',prefer||'',headerKey,bodyKey].join('\n');
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
            if(matchesSessionSnapshot(current))write(null);
            return false;
          }
          throw new RuntimeError(responseMessage(data,r.status),{status:r.status,code:'session_refresh_failed',retryable:retryableStatus(r.status)});
        }
        const next=data||{};
        next.expires_at=next.expires_at||Math.floor(Date.now()/1000)+(next.expires_in||3600);
        if(!matchesSessionSnapshot(current))return false;
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
  async function apiRequest(path,{method='GET',body=null,prefer='',auth=true,headers={},timeoutMs=config.timeoutMs}={}){
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
      const started=performance.now();
      try{
        const response=await fetchWithTimeout(url,{method,headers:h,body:requestBody,cache:'no-store'},timeoutMs);
        window.__KPTU_STARTUP__?.request?.(url,performance.now()-started,response.status);
        return response;
      }catch(e){
        window.__KPTU_STARTUP__?.request?.(url,performance.now()-started,e?.status||0);
        throw e;
      }
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
  async function api(path,options={}){
    const dedupe=options.singleFlight!==false;
    const getFlightKey=dedupe?getKey(path,options):null;
    if(getFlightKey&&getFlights.has(getFlightKey))return getFlights.get(getFlightKey);
    const mutationFlightKey=dedupe?mutationKey(path,options):null;
    if(mutationFlightKey&&mutationFlights.has(mutationFlightKey))return mutationFlights.get(mutationFlightKey);
    const flight=apiRequest(path,options);
    const map=getFlightKey?getFlights:(mutationFlightKey?mutationFlights:null);
    const key=getFlightKey||mutationFlightKey;
    if(!map||!key)return flight;
    map.set(key,flight);
    try{return await flight}
    finally{if(map.get(key)===flight)map.delete(key)}
  }

  window.KPTURuntime={
    version:'1.3.1',
    config,
    RuntimeError,
    session:{read,write,refresh,ensure,epoch:()=>sessionEpoch},
    context:{read:contextRead,set:contextSet,clear:contextClear},
    api
  };
})();
