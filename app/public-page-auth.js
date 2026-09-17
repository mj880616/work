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
      super(message);this.name='KPTUPublicAuthError';this.status=status;this.code=code;this.retryable=retryable;if(cause)this.cause=cause;
    }
  }

  function read(){try{return JSON.parse(localStorage.getItem(config.sessionKey)||'null')}catch{return null}}
  function write(value){
    try{if(value)localStorage.setItem(config.sessionKey,JSON.stringify(value));else localStorage.removeItem(config.sessionKey)}
    catch(e){throw new PublicAuthError('편집자 로그인 정보를 저장하지 못했습니다.',{code:'storage_error',cause:e})}
    return value||null;
  }
  function normalizeSession(value){if(!value)return null;return {...value,expires_at:value.expires_at||Math.floor(Date.now()/1000)+(Number(value.expires_in)||3600)}}
  async function fetchWithTimeout(url,options={},timeoutMs=config.timeoutMs){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}
    catch(e){
      if(e?.name==='AbortError')throw new PublicAuthError('요청 시간이 초과되었습니다. 다시 시도해 주세요.',{code:'timeout',retryable:true,cause:e});
      throw new PublicAuthError('네트워크 연결을 확인한 뒤 다시 시도해 주세요.',{code:'network_error',retryable:true,cause:e});
    }finally{clearTimeout(timer)}
  }
  async function responseData(response){const text=await response.text();if(!text)return null;try{return JSON.parse(text)}catch{return text}}
  function message(data,status){return data?.message||data?.error_description||data?.hint||data?.error||`요청 실패 ${status}`}
  function retryable(status){return status===408||status===425||status===429||status>=500}

  async function refresh(){
    if(refreshPromise)return refreshPromise;
    const current=read();if(!current?.refresh_token)return false;
    refreshPromise=(async()=>{
      try{
        const response=await fetchWithTimeout(config.url+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:current.refresh_token})});
        const data=await responseData(response);
        if(!response.ok){if([400,401,403].includes(response.status)){write(null);return false}throw new PublicAuthError(message(data,response.status),{status:response.status,code:'refresh_failed',retryable:retryable(response.status)})}
        const next=normalizeSession(data);write(next);return next;
      }finally{refreshPromise=null}
    })();
    return refreshPromise;
  }

  async function ensure(){const current=read();if(!current?.access_token)return false;if((Number(current.expires_at)||0)<Math.floor(Date.now()/1000)+60)return !!(await refresh());return true}

  async function signIn(email,password){
    const cleanEmail=String(email||'').trim();if(!cleanEmail||!password)throw new PublicAuthError('이메일과 비밀번호를 입력해 주세요.',{code:'missing_credentials'});
    const response=await fetchWithTimeout(config.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify({email:cleanEmail,password:String(password)})});
    const data=await responseData(response);
    if(!response.ok){if([400,401,403].includes(response.status))throw new PublicAuthError('이메일 또는 비밀번호를 확인해 주세요.',{status:response.status,code:'invalid_credentials'});throw new PublicAuthError(message(data,response.status),{status:response.status,code:'sign_in_failed',retryable:retryable(response.status)})}
    const session=normalizeSession(data);if(!session?.access_token||!session?.refresh_token)throw new PublicAuthError('로그인 결과를 확인하지 못했습니다.',{code:'invalid_session'});write(session);return session;
  }

  function recoveryRedirect(){return location.origin+location.pathname}
  async function resetPasswordForEmail(email,{redirectTo=recoveryRedirect()}={}){
    const cleanEmail=String(email||'').trim();if(!cleanEmail)throw new PublicAuthError('재설정 메일을 받을 이메일을 입력해 주세요.',{code:'missing_email'});
    const endpoint=config.url+'/auth/v1/recover?redirect_to='+encodeURIComponent(String(redirectTo));
    const response=await fetchWithTimeout(endpoint,{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:JSON.stringify({email:cleanEmail})});
    const data=await responseData(response);
    if(!response.ok){if(response.status===429)throw new PublicAuthError('재설정 메일을 너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요.',{status:429,code:'recovery_rate_limited',retryable:true});throw new PublicAuthError(message(data,response.status),{status:response.status,code:'recovery_failed',retryable:retryable(response.status)})}
    return data||{};
  }

  function consumeRecoverySession(){
    const params=new URLSearchParams(String(location.hash||'').replace(/^#/,''));
    if(params.get('type')!=='recovery')return false;
    const access_token=params.get('access_token'),refresh_token=params.get('refresh_token');
    if(!access_token||!refresh_token)return false;
    const session=normalizeSession({access_token,refresh_token,expires_in:Number(params.get('expires_in'))||3600,token_type:params.get('token_type')||'bearer'});
    write(session);
    history.replaceState(null,'',location.pathname+location.search);
    return session;
  }

  async function updatePassword(password){
    const next=String(password||'');if(next.length<8)throw new PublicAuthError('새 비밀번호는 8자 이상 입력해 주세요.',{code:'weak_password'});
    if(!(await ensure()))throw new PublicAuthError('비밀번호 재설정 링크가 만료되었습니다. 재설정 메일을 다시 요청해 주세요.',{status:401,code:'session_required'});
    const current=read();
    const response=await fetchWithTimeout(config.url+'/auth/v1/user',{method:'PUT',headers:{apikey:config.key,'Content-Type':'application/json',Authorization:'Bearer '+current.access_token},body:JSON.stringify({password:next})});
    const data=await responseData(response);
    if(!response.ok)throw new PublicAuthError(message(data,response.status),{status:response.status,code:'password_update_failed',retryable:retryable(response.status)});
    return data||{};
  }

  async function api(path,{method='GET',body=null,headers={},timeoutMs=config.timeoutMs}={}){
    if(!(await ensure()))throw new PublicAuthError('편집자 로그인이 필요합니다.',{status:401,code:'session_required'});
    const url=path.startsWith('http')?path:config.url+path,requestBody=body===null?null:JSON.stringify(body);
    const request=async()=>{const current=read();if(!current?.access_token)throw new PublicAuthError('편집자 로그인이 필요합니다.',{status:401,code:'session_required'});return fetchWithTimeout(url,{method,headers:{apikey:config.key,'Content-Type':'application/json',Authorization:'Bearer '+current.access_token,...headers},body:requestBody},timeoutMs)};
    let response=await request();
    if(response.status===401){const renewed=await refresh();if(!renewed)throw new PublicAuthError('편집자 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',{status:401,code:'session_required'});response=await request();if(response.status===401){write(null);throw new PublicAuthError('편집자 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',{status:401,code:'session_required'})}}
    const data=await responseData(response);if(!response.ok)throw new PublicAuthError(message(data,response.status),{status:response.status,code:'http_'+response.status,retryable:retryable(response.status)});return data;
  }

  function setDialogMessage(root,text,error=false){const el=root?.querySelector('#ppeAuthError');if(!el)return;el.textContent=text||'';el.style.color=error?'#a33b45':'#356447'}
  function showRecoveryForm(root){
    if(!root||root.querySelector('#ppeRecoveryForm'))return;
    const dialog=root.querySelector('.ppe-auth-dialog');if(!dialog)return;
    dialog.querySelector('#ppeAuthForm')?.classList.add('hidden');
    const title=dialog.querySelector('#ppeAuthTitle');if(title)title.textContent='새 비밀번호 설정';
    let intro=dialog.querySelector('p');if(intro)intro.textContent='새 비밀번호를 입력하면 편집자 계정의 비밀번호가 변경됩니다.';
    const form=document.createElement('form');form.id='ppeRecoveryForm';form.innerHTML='<label class="ppe-auth-field"><span>새 비밀번호</span><input id="ppeRecoveryPassword" type="password" autocomplete="new-password" minlength="8" required></label><label class="ppe-auth-field"><span>새 비밀번호 확인</span><input id="ppeRecoveryPasswordConfirm" type="password" autocomplete="new-password" minlength="8" required></label><div class="ppe-auth-actions"><button type="submit">비밀번호 변경</button></div>';
    dialog.appendChild(form);root.classList.remove('hidden');
    form.addEventListener('submit',async event=>{
      event.preventDefault();const first=form.querySelector('#ppeRecoveryPassword')?.value||'',second=form.querySelector('#ppeRecoveryPasswordConfirm')?.value||'',submit=form.querySelector('button[type="submit"]');
      if(first!==second){setDialogMessage(root,'새 비밀번호가 서로 일치하지 않습니다.',true);return}
      if(submit)submit.disabled=true;setDialogMessage(root,'비밀번호를 변경하는 중입니다.');
      try{await updatePassword(first);setDialogMessage(root,'비밀번호를 변경했습니다. 편집을 계속합니다.');setTimeout(()=>{root.classList.add('hidden');document.querySelector('#editPageBtn')?.click()},250)}
      catch(e){setDialogMessage(root,e?.message||'비밀번호 변경에 실패했습니다.',true)}finally{if(submit)submit.disabled=false}
    });
    requestAnimationFrame(()=>form.querySelector('#ppeRecoveryPassword')?.focus());
  }

  function enhanceAuthDialog(root){
    if(!root||root.dataset.ppeRecoveryReady==='1')return;root.dataset.ppeRecoveryReady='1';
    const actions=root.querySelector('#ppeAuthForm .ppe-auth-actions'),email=root.querySelector('#ppeAuthEmail');
    if(actions&&!root.querySelector('#ppeAuthReset')){
      const reset=document.createElement('button');reset.id='ppeAuthReset';reset.type='button';reset.textContent='비밀번호를 잊으셨나요?';actions.prepend(reset);
      let cooldownTimer=null;
      const startCooldown=seconds=>{let left=Math.max(1,Number(seconds)||60);reset.disabled=true;reset.textContent=`재요청 ${left}초`;clearInterval(cooldownTimer);cooldownTimer=setInterval(()=>{left-=1;if(left<=0){clearInterval(cooldownTimer);reset.disabled=false;reset.textContent='비밀번호를 잊으셨나요?';return}reset.textContent=`재요청 ${left}초`},1000)};
      reset.addEventListener('click',async()=>{
        const address=String(email?.value||'').trim();if(!address){setDialogMessage(root,'먼저 이메일을 입력해 주세요.',true);email?.focus();return}
        reset.disabled=true;setDialogMessage(root,'재설정 메일을 보내는 중입니다.');
        try{await resetPasswordForEmail(address);setDialogMessage(root,'재설정 메일을 보냈습니다. 메일의 링크를 열어 새 비밀번호를 설정해 주세요.');startCooldown(60)}
        catch(e){setDialogMessage(root,e?.message||'재설정 메일 발송에 실패했습니다.',true);if(e?.status===429)startCooldown(60);else reset.disabled=false}
      });
    }
    if(consumeRecoverySession())showRecoveryForm(root);
  }

  function installRecoveryUi(){
    const existing=document.querySelector('#ppeAuthDialog');if(existing)enhanceAuthDialog(existing);
    const observer=new MutationObserver(()=>{const root=document.querySelector('#ppeAuthDialog');if(root)enhanceAuthDialog(root)});observer.observe(document.documentElement,{childList:true,subtree:true});
  }

  window.KPTUPublicAuth={version:'1.1.1',config,PublicAuthError,session:{read,write,ensure,refresh},signIn,resetPasswordForEmail,consumeRecoverySession,updatePassword,api};
  installRecoveryUi();
})();