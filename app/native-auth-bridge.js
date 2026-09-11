const q=new URLSearchParams(location.search);
if(q.get('native')==='android'&&location.hash){
  window.__KPTU_NATIVE_BRIDGE__=true;
  const target='kptuwork://auth'+location.hash;
  document.documentElement.innerHTML='<head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,sans-serif;padding:28px;line-height:1.6"><h2>업무 현황 앱으로 돌아가는 중입니다.</h2><p>자동으로 돌아가지 않으면 아래 버튼을 눌러 주세요.</p><p><a id="backToApp" style="display:inline-block;padding:12px 16px;border-radius:10px;background:#17324d;color:#fff;text-decoration:none;font-weight:700">앱으로 돌아가기</a></p></body>';
  const link=document.querySelector('#backToApp');
  if(link)link.href=target;
  setTimeout(()=>{location.href=target},120);
}
