const AH_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// 로그인 세션 저장 이름은 runtime-client.js(KPTURuntime.config.sessionKey) 한 곳이 가진다. loader-v2가 runtime을 먼저 기다린다.
const ah=new URLSearchParams(location.search);
const sealed=ah.get('handoff');
if(ah.has('handoff')){
  const status=document.querySelector('#authStatus');
  try{
    // Consume attempts are terminal. Erase first, including mixed OAuth input,
    // so failure/reload cannot reuse this handoff or fall back to raw tokens.
    ah.delete('handoff');
    for(const name of ['access_token','refresh_token','provider_token','provider_refresh_token','id_token','payload','code'])ah.delete(name);
    const qs=ah.toString();
    history.replaceState({},'',location.pathname+(qs?'?'+qs:''));
    if(!sealed)throw new Error('missing handoff');
    if(status){status.textContent='로그인 정보를 앱으로 가져오는 중입니다…';status.className='status'}
    const r=await fetch(AH_SB+'/functions/v1/auth-handoff',{method:'POST',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'consume',token:sealed})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d?.session?.access_token||!d?.session?.refresh_token)throw new Error('handoff failed');
    const s=d.session;
    s.expires_at=s.expires_at||Math.floor(Date.now()/1000)+(s.expires_in||3600);
    window.KPTURuntime.session.write(s);
    if(status){status.textContent='로그인 완료';status.className='status ok'}
  }catch{
    if(status){status.textContent='로그인 정보를 전달하지 못했습니다. 새 로그인을 시작해 주세요.';status.className='status error'}
  }
}
