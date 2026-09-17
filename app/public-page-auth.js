(()=>{
  'use strict';
  if(window.KPTUPublicAuth)return;

  const config={
    url:'https://xmlkxfjeagycwttklxjw.supabase.co',
    key:'sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA',
    sessionKey:'kptu_public_editor_session_v1',
    timeoutMs:15000
  };
  let refreshPromise=null;

  class PublicAuthError extends Error{
    constructor(message,{status=0,code='request_failed',retryable=false,cause=null}={}){
      super(message);
      this.name='KPTUPublicAuthError';
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
    try{
      if(value)localStorage.setItem(config.sessionKey,JSON.stringify(value));
      else localStorage.removeItem(config.sessionKey);
    }catch(e){
      throw new PublicAuthError('편집자 로그인 정보를 저장하지 못했습니다.',{code:'storage_error',cause:e});
    }
    return value||null;
  }
  function normalizeSession(value){
    if(!value)return null;
    return {...value,expires_at:value.expires_at||Math.floor(Date.now()/1000)+(Number(value.expires_in)||3600)};
  }
  async function fetchWithTimeout(url,options={},timeoutMs=config.timeoutMs){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}
    catch(e){
      if(e?.name==='AbortError')throw new PublicAuthError('요청 시간이 초과되었습니다. 다시 시도해 주세요.',{code:'timeout',retryable:true,cause:e});
      throw new PublicAuthError('네트워크 연결을 확인한 뒤 다시 시도해 주세요.',{code:'network_error',retryable:true,cause:e});
    }finally{clearTimeout(timer)}
  }
  async function responseData(response){
    const text=await response.text();
    if(!text)return null;
    try{return JSON.parse(text)}catch{return text}
  }
  function message(data,status){return data?.message||data?.error_description||data?.hint||data?.error||`요청 실패 ${status}`}
  function retryable(status){return status===408||status===425||status===429||status>=500}

  async function refresh(){
    if(refreshPromise)return refreshPromise;
    const current=read();
    if(!current?.refresh_token)return false;
    refreshPromise=(async()=>{
      try{
        const response=await fetchWithTimeout(config.url+'/auth/v1/token?grant_type=refresh_token',{
          method:'POST',
          headers:{apikey:config.key,'Content-Type':'application/json'},
          body:JSON.stringify({refresh_token:current.refresh_token})
        });
        const data=await responseData(response);
        if(!response.ok){
          if([400,401,403].includes(response.status)){write(null);return false}
          throw new PublicAuthError(message(data,response.status),{status:response.status,code:'refresh_failed',retryable:retryable(response.status)});
        }
        const next=normalizeSession(data);
        write(next);
        return next;
      }finally{refreshPromise=null}
    })();
    return refreshPromise;
  }

  async function ensure(){
    const current=read();
    if(!current?.access_token)return false;
    if((Number(current.expires_at)||0)<Math.floor(Date.now()/1000)+60)return !!(await refresh());
    return true;
  }

  async function signIn(email,password){
    const cleanEmail=String(email||'').trim();
    if(!cleanEmail||!password)throw new PublicAuthError('이메일과 비밀번호를 입력해 주세요.',{code:'missing_credentials'});
    const response=await fetchWithTimeout(config.url+'/auth/v1/token?grant_type=password',{
      method:'POST',
      headers:{apikey:config.key,'Content-Type':'application/json'},
      body:JSON.stringify({email:cleanEmail,password:String(password)})
    });
    const data=await responseData(response);
    if(!response.ok){
      if([400,401,403].includes(response.status))throw new PublicAuthError('이메일 또는 비밀번호를 확인해 주세요.',{status:response.status,code:'invalid_credentials'});
      throw new PublicAuthError(message(data,response.status),{status:response.status,code:'sign_in_failed',retryable:retryable(response.status)});
    }
    const session=normalizeSession(data);
    if(!session?.access_token||!session?.refresh_token)throw new PublicAuthError('로그인 결과를 확인하지 못했습니다.',{code:'invalid_session'});
    write(session);
    return session;
  }

  async function api(path,{method='GET',body=null,headers={},timeoutMs=config.timeoutMs}={}){
    if(!(await ensure()))throw new PublicAuthError('편집자 로그인이 필요합니다.',{status:401,code:'session_required'});
    const url=path.startsWith('http')?path:config.url+path;
    const requestBody=body===null?null:JSON.stringify(body);
    const request=async()=>{
      const current=read();
      if(!current?.access_token)throw new PublicAuthError('편집자 로그인이 필요합니다.',{status:401,code:'session_required'});
      return fetchWithTimeout(url,{
        method,
        headers:{apikey:config.key,'Content-Type':'application/json',Authorization:'Bearer '+current.access_token,...headers},
        body:requestBody
      },timeoutMs);
    };
    let response=await request();
    if(response.status===401){
      const renewed=await refresh();
      if(!renewed)throw new PublicAuthError('편집자 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',{status:401,code:'session_required'});
      response=await request();
      if(response.status===401){write(null);throw new PublicAuthError('편집자 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',{status:401,code:'session_required'})}
    }
    const data=await responseData(response);
    if(!response.ok)throw new PublicAuthError(message(data,response.status),{status:response.status,code:'http_'+response.status,retryable:retryable(response.status)});
    return data;
  }

  window.KPTUPublicAuth={version:'1.0.0',config,PublicAuthError,session:{read,write,ensure,refresh},signIn,api};
})();