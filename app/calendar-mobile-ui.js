const mq=window.matchMedia('(max-width:760px)');
function applyCalendarMobileUi(){
  const btn=document.querySelector('#newEventBtn');
  if(!btn)return;
  btn.textContent=mq.matches?'+ 일정':'+ 일정 등록';
  btn.setAttribute('aria-label','일정 등록');
}
const style=document.createElement('style');
style.textContent=`
#calendarView .section-head>#newEventBtn{flex:0 0 auto;width:auto;min-width:0;white-space:nowrap}
@media(max-width:760px){
  #calendarView>.section-head{align-items:flex-start;gap:8px}
  #calendarView>.section-head>div{min-width:0;flex:1}
  #calendarView>.section-head>#newEventBtn{padding:8px 11px;font-size:13px;line-height:1.15;border-radius:9px;margin-top:1px;min-height:34px}
}
`;
document.head.appendChild(style);
applyCalendarMobileUi();
if(mq.addEventListener)mq.addEventListener('change',applyCalendarMobileUi);else mq.addListener?.(applyCalendarMobileUi);
