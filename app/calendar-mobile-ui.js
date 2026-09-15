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
  document.querySelector('#newEventBtn')?.setAttribute('aria-label','일정 등록');
}
applyCalendarMobileUi();
if(mq.addEventListener)mq.addEventListener('change',applyCalendarMobileUi);else mq.addListener?.(applyCalendarMobileUi);
window.__KPTU_CALENDAR_MOBILE_UI_READY__=Promise.resolve(true);
