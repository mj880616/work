const SB_CAL='https://xmlkxfjeagycwttklxjw.supabase.co';
const SESSION_KEY_CAL='kptu_collab_session_v1';

function readCalendarSession(){
  try{return JSON.parse(localStorage.getItem(SESSION_KEY_CAL)||'null')}catch{return null}
}

async function refreshCalendarStatus(){
  const s=readCalendarSession();
  if(!s?.access_token)return;
  try{
    const r=await fetch(SB_CAL+'/functions/v1/google-calendar?action=status',{headers:{Authorization:'Bearer '+s.access_token}});
    const d=await r.json();
    if(!r.ok||d.error)return;
    const btn=document.querySelector('#googleConnectBtn');
    const label=document.querySelector('#googleAccountLabel');
    const toggle=document.querySelector('#showGoogleCalendar');
    if(d.connected){
      if(btn)btn.textContent='Google 설정';
      if(label)label.textContent=d.email||'연결됨';
      if(toggle)toggle.checked=!!d.enabled;
    }
    document.querySelector('#googleCalendarWarning')?.remove();
    if(d.warning){
      const bar=document.querySelector('#googleCalendarControls');
      if(bar){
        const w=document.createElement('div');
        w.id='googleCalendarWarning';
        w.style.cssText='width:100%;margin-top:8px;padding:9px 11px;border-radius:10px;background:#fff4e5;color:#8a5a00;font-size:12px;line-height:1.45';
        w.textContent='Google Calendar 연결은 완료됐지만 일정 읽기 오류: '+d.warning;
        bar.appendChild(w);
      }
    }
  }catch(_){ }
}

setTimeout(refreshCalendarStatus,500);
window.addEventListener('focus',()=>setTimeout(refreshCalendarStatus,250));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(refreshCalendarStatus,250)});
