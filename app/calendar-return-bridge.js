const params=new URLSearchParams(location.search);
const isCalendarReturn=params.get('google')==='connected';
const isAndroid=/Android/i.test(navigator.userAgent);
const isKptuApp=/KPTUAndroid/i.test(navigator.userAgent);

if(isCalendarReturn&&isAndroid&&!isKptuApp){
  window.__KPTU_CALENDAR_BRIDGE__=true;
  const target='kptuwork://auth?google=connected';
  document.documentElement.innerHTML='<head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,sans-serif;padding:28px;line-height:1.6"><h2>Google Calendar 연결이 완료되었습니다.</h2><p>업무 현황 앱으로 돌아갑니다.</p><p><a id="openKptuApp" style="display:inline-block;padding:12px 16px;border-radius:10px;background:#17324d;color:#fff;text-decoration:none;font-weight:700">업무 현황 앱 열기</a></p></body>';
  const link=document.querySelector('#openKptuApp');
  if(link)link.href=target;
  setTimeout(()=>{location.href=target},150);
}
