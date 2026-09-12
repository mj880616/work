const params=new URLSearchParams(location.search);
const googleResult=params.get('google');
const isCalendarReturn=['connected','error','denied'].includes(googleResult||'');
const isAndroid=/Android/i.test(navigator.userAgent);
const isKptuApp=/KPTUAndroid/i.test(navigator.userAgent);

if(isCalendarReturn&&isAndroid&&!isKptuApp){
  window.__KPTU_CALENDAR_BRIDGE__=true;
  const reason=params.get('reason')||'';
  const q=new URLSearchParams({google:googleResult||'error'});
  if(reason)q.set('reason',reason);
  const target='kptuwork://auth?'+q.toString();
  const ok=googleResult==='connected';
  document.documentElement.innerHTML=`<head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,sans-serif;padding:28px;line-height:1.6"><h2>${ok?'Google Calendar 연결이 완료되었습니다.':'Google Calendar 연결을 완료하지 못했습니다.'}</h2><p>${ok?'업무 현황 앱으로 돌아갑니다.':'앱으로 돌아가 연결 상태를 확인합니다.'}</p><p><a id="openKptuApp" style="display:inline-block;padding:12px 16px;border-radius:10px;background:#17324d;color:#fff;text-decoration:none;font-weight:700">업무 현황 앱 열기</a></p></body>`;
  const link=document.querySelector('#openKptuApp');
  if(link)link.href=target;
  setTimeout(()=>{location.href=target},150);
}
