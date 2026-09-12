const mq=window.matchMedia('(max-width:760px)');
const mobileLabels={
  newEventBtn:['+ 일정','+ 일정 등록'],
  newTaskBtn:['+ 할 일','+ 할 일 추가'],
  newDocumentBtn:['+ 자료','+ 자료 등록'],
  newMeetingBtn:['+ 회의','+ 회의 결과'],
  newPageBtn:['+ 페이지','+ 새 페이지'],
  newProjectBtn:['+ 프로젝트','+ 프로젝트 만들기'],
  inviteBtn:['+ 초대','구성원 초대'],
  newGroupBtn:['+ 그룹','+ 그룹']
};
function applyCalendarMobileUi(){
  Object.entries(mobileLabels).forEach(([id,labels])=>{
    const btn=document.querySelector('#'+id);
    if(!btn)return;
    btn.textContent=mq.matches?labels[0]:labels[1];
  });
  const eventBtn=document.querySelector('#newEventBtn');
  eventBtn?.setAttribute('aria-label','일정 등록');
}
const style=document.createElement('style');
style.textContent=`
#calendarView .section-head>#newEventBtn{flex:0 0 auto;width:auto;min-width:0;white-space:nowrap}
@media(max-width:760px){
  .view-panel>.section-head{align-items:flex-start;gap:8px}
  .view-panel>.section-head>div:first-child{min-width:0;flex:1}
  .view-panel>.section-head>.primary,
  .view-panel>.section-head>.secondary{flex:0 0 auto;width:auto;min-width:0;white-space:nowrap;padding:8px 11px;font-size:13px;line-height:1.15;border-radius:9px;margin-top:1px;min-height:34px}
  .view-panel>.section-head>.head-actions{width:auto;flex:0 0 auto;gap:6px}
  .view-panel>.section-head>.head-actions button{flex:0 0 auto;width:auto;min-width:0;white-space:nowrap;padding:8px 10px;font-size:12px;line-height:1.15;min-height:34px}
  #calendarView>.section-head>div{min-width:0;flex:1}
}
`;
document.head.appendChild(style);
applyCalendarMobileUi();
if(mq.addEventListener)mq.addEventListener('change',applyCalendarMobileUi);else mq.addListener?.(applyCalendarMobileUi);
