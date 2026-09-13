const q=new URLSearchParams(location.search);
const native=q.get('native');
if((native==='android'||native==='windows')&&location.hash){
  window.__KPTU_NATIVE_BRIDGE__=true;
  const p=new URLSearchParams(location.hash.replace(/^#/,''));
  const access=p.get('access_token');
  const refresh=p.get('refresh_token');
  const appTarget=params=>native==='windows'
    ?'kptuwork://auth?'+params
    :'intent://auth?'+params+'#Intent;scheme=kptuwork;package=kr.or.kptu.work;end';
  document.documentElement.innerHTML='<head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,sans-serif;padding:28px;line-height:1.6"><h2>업무 현황 앱으로 돌아가는 중입니다.</h2><p id="handoffStatus">로그인 정보를 안전하게 전달하고 있습니다.</p><p><a id="backToApp" style="display:none;padding:12px 16px;border-radius:10px;background:#17324d;color:#fff;text-decoration:none;font-weight:700">앱으로 돌아가기</a></p></body>';
  (async()=>{
    const st=document.querySelector('#handoffStatus');
    const link=document.querySelector('#backToApp');
    try{
      if(!access||!refresh)throw new Error('로그인 토큰을 받지 못했습니다.');
      const r=await fetch('https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/auth-handoff',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({action:'seal',refresh_token:refresh})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||!d?.token)throw new Error(d?.error||'handoff 생성 실패');
      const target=appTarget('handoff='+encodeURIComponent(d.token));
      if(link){link.href=target;link.style.display='inline-block'}
      if(st)st.textContent='앱으로 돌아갑니다.';
      setTimeout(()=>{location.href=target},120);
    }catch(e){
      if(st)st.textContent='자동 복귀에 실패했습니다. 아래 버튼을 눌러 주세요.';
      const payload=location.hash.replace(/^#/,'');
      const fallback=appTarget('payload='+encodeURIComponent(payload));
      if(link){link.href=fallback;link.style.display='inline-block'}
    }
  })();
}
