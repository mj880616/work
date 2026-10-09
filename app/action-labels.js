// One owner for shell action labels, independent of the entry route.
const mq=window.matchMedia('(max-width:760px)');
const mobileLabels={
  newDocumentBtn:['+ 자료','+ 자료 등록'],
  newMeetingBtn:['+ 회의','+ 회의 결과'],
  newProjectBtn:['+ 프로젝트','+ 프로젝트']
};
function applyActionLabels(){
  Object.entries(mobileLabels).forEach(([id,labels])=>{
    const btn=document.querySelector('#'+id);
    if(!btn)return;
    btn.textContent=mq.matches?labels[0]:labels[1];
  });
}
applyActionLabels();
if(mq.addEventListener)mq.addEventListener('change',applyActionLabels);else mq.addListener?.(applyActionLabels);
