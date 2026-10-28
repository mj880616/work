const kptuHoldToast=(el,opt)=>{el.classList.remove('hidden');import('./small-notice.js').then(m=>m.holdToast(el,opt)).catch(()=>{})}; // UI-작은알림자리: 일반 스크립트라 동적 import(#toast 위쪽·2초·올려 두면 멈춤)
const gcrsNotify=(text,opt)=>import('./small-notice.js').then(m=>m.notify(text,opt)).catch(()=>{}); // UI-알림창정리: 일반 스크립트라 공용 작은 알림을 동적 import로
function gcrsToast(message,type=''){
  const t=document.querySelector('#toast');
  if(t){t.textContent=message;if(type)t.dataset.type=type;else delete t.dataset.type;kptuHoldToast(t);return}
  gcrsNotify(message);
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
