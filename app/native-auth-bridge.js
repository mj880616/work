const q=new URLSearchParams(location.search);
const native=q.get('native');
const p=new URLSearchParams(location.hash.replace(/^#/,''));
const isLoginCallback=location.pathname.endsWith('/native-callback.html')||
  ['access_token','refresh_token'].some(name=>p.has(name)||q.has(name));
if((native==='android'||native==='windows')&&isLoginCallback){
  window.__KPTU_NATIVE_BRIDGE__=true;
  const access=p.get('access_token')||q.get('access_token');
  const refresh=p.get('refresh_token')||q.get('refresh_token');
  // Capture in memory, then erase the callback before DOM work or any await.
  // Query support is for callback compatibility, never for an app-link fallback.
  for(const name of ['access_token','refresh_token','provider_token','provider_refresh_token','id_token','token_type','expires_in','expires_at','error','error_code','error_description','code','state','payload'])q.delete(name);
  let cleaned=false;
  try{
    const query=q.toString();
    history.replaceState({},'',location.pathname+(query?'?'+query:''));
    cleaned=true;
  }catch{}
  const appTarget=params=>native==='windows'
    ?'kptuwork://auth?'+params
    :'intent://auth?'+params+'#Intent;scheme=kptuwork;package=kr.or.kptu.work;end';
  document.documentElement.innerHTML='<head><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,sans-serif;padding:28px;line-height:1.6"><h2>업무 현황 앱으로 돌아가는 중입니다.</h2><p id="handoffStatus">로그인 정보를 안전하게 전달하고 있습니다.</p><p><a id="backToApp" style="display:none;padding:12px 16px;border-radius:10px;background:#17324d;color:#fff;text-decoration:none;font-weight:700">앱으로 돌아가기</a></p></body>';
  (async()=>{
    const st=document.querySelector('#handoffStatus');
    const link=document.querySelector('#backToApp');
    try{
      if(!cleaned||!access||!refresh)throw new Error('invalid callback');
      const r=await fetch('https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/auth-handoff',{method:'POST',cache:'no-store',referrerPolicy:'no-referrer',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({action:'seal',refresh_token:refresh})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||typeof d?.token!=='string'||!d.token)throw new Error('seal failed');
      const target=appTarget('handoff='+encodeURIComponent(d.token));
      if(link){link.href=target;link.style.display='inline-block'}
      if(st)st.textContent='앱으로 돌아갑니다.';
      setTimeout(()=>{location.href=target},120);
    }catch{
      if(st)st.textContent='로그인 정보를 전달하지 못했습니다. 앱에서 새 로그인을 시작해 주세요.';
      if(link){link.removeAttribute('href');link.style.display='none'}
    }
  })();
}
