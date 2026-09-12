const AH_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const AH_SESSION='kptu_collab_session_v1';
const ah=new URLSearchParams(location.search);
const sealed=ah.get('handoff');
if(sealed){
  const status=document.querySelector('#authStatus');
  try{
    if(status){status.textContent='로그인 정보를 앱으로 가져오는 중입니다…';status.className='status'}
    const r=await fetch(AH_SB+'/functions/v1/auth-handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'consume',token:sealed})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d?.session?.access_token||!d?.session?.refresh_token)throw new Error(d?.error||'로그인 정보 전달에 실패했습니다.');
    const s=d.session;
    s.expires_at=s.expires_at||Math.floor(Date.now()/1000)+(s.expires_in||3600);
    localStorage.setItem(AH_SESSION,JSON.stringify(s));
    ah.delete('handoff');
    const qs=ah.toString();
    history.replaceState({},'',location.pathname+(qs?'?'+qs:''));
    if(status){status.textContent='로그인 완료';status.className='status ok'}
  }catch(e){
    if(status){status.textContent='로그인 정보 전달 실패: '+String(e?.message||e);status.className='status error'}
  }
}
