function gcrsToast(message,type=''){
  const t=document.querySelector('#toast');
  if(t){t.textContent=message;t.classList.remove('hidden');if(type)t.dataset.type=type;clearTimeout(gcrsToast.t);gcrsToast.t=setTimeout(()=>{t.classList.add('hidden');delete t.dataset.type},4200);return}
  alert(message);
}
function gcrsRun(){
  const url=new URL(location.href),result=url.searchParams.get('google');
  if(!result||result==='connected')return;
  const reason=url.searchParams.get('reason')||'';
  let message='Google Calendar 연결을 완료하지 못했습니다. 다시 연결해 주세요.';
  if(/access_denied|denied/i.test(reason)||result==='denied')message='Google Calendar 연결이 취소되었거나 이 Google 계정에 OAuth 사용 권한이 없습니다.';
  if(/token/i.test(reason))message='Google 인증 정보를 발급받지 못했습니다. Google 계정을 다시 연결해 주세요.';
  gcrsToast(message,'error');
  url.searchParams.delete('google');url.searchParams.delete('reason');
  history.replaceState({},'',url.pathname+(url.searchParams.toString()?'?'+url.searchParams.toString():'')+url.hash);
  const label=document.querySelector('#googleAccountLabel');if(label)label.textContent='연결 실패 · 다시 시도 필요';
}
setTimeout(gcrsRun,350);
