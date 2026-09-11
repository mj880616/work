const SB_CAL='https://xmlkxfjeagycwttklxjw.supabase.co';
const SESSION_KEY_CAL='kptu_collab_session_v1';

function readCalendarSession(){
  try{return JSON.parse(localStorage.getItem(SESSION_KEY_CAL)||'null')}catch{return null}
}
function calendarWarningText(raw=''){
  const s=String(raw||'');
  if(/calendar api has not been used|calendar-json\.googleapis\.com|api.*disabled/i.test(s))return 'Google 계정 연결은 완료됐습니다. Google Cloud에서 Calendar API만 켜면 일정이 표시됩니다.';
  return 'Google 계정 연결은 완료됐지만 일정 읽기에 문제가 있습니다.';
}
function installCalendarCompactStyle(){
  if(document.querySelector('#calendarCompactStyle'))return;
  const st=document.createElement('style');st.id='calendarCompactStyle';st.textContent=`
  #googleCalendarControls{align-items:center!important;gap:10px!important;flex-wrap:wrap!important}
  #googleConnectBtn{width:auto!important;min-width:0!important;min-height:40px!important;height:40px!important;padding:0 14px!important;font-size:14px!important;line-height:1!important;white-space:nowrap!important;flex:0 0 auto!important}
  #googleAccountLabel{font-size:12px!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px}
  #googleCalendarWarning{width:100%;margin-top:2px;padding:9px 11px;border-radius:10px;background:#fff4e5;color:#79550b;font-size:12px;line-height:1.45}
  #googleCalendarWarning a{display:inline-block;margin-left:6px;color:#315f91;font-weight:750;text-decoration:none;white-space:nowrap}
  @media(max-width:650px){#googleConnectBtn{min-height:38px!important;height:38px!important;padding:0 12px!important;font-size:13px!important}#googleAccountLabel{max-width:145px}}
  `;document.head.appendChild(st);
}

async function refreshCalendarStatus(){
  const s=readCalendarSession();
  if(!s?.access_token)return;
  installCalendarCompactStyle();
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
        const w=document.createElement('div');w.id='googleCalendarWarning';
        w.innerHTML=`${calendarWarningText(d.warning)}<a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=793069713813" target="_blank" rel="noopener">API 켜기</a>`;
        bar.appendChild(w);
      }
    }
  }catch(_){ }
}

installCalendarCompactStyle();
setTimeout(refreshCalendarStatus,500);
window.addEventListener('focus',()=>setTimeout(refreshCalendarStatus,250));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(refreshCalendarStatus,250)});