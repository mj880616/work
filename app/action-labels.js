// One owner for shell action labels, independent of the entry route.
// 자료실 [+](#newDocumentBtn)는 LIB-위쪽한줄로 글자 없는 작은 아이콘(이름은 aria-label '자료 등록')이라 여기서 글자를 넣지 않는다.
// #newProjectBtn(사업영역 관리 [+])의 글자는 index.html 마크업과 project-system-v3.css가 정한다. 여기서 덮어쓰지 않는다.
const mq=window.matchMedia('(max-width:760px)');
const mobileLabels={
  newMeetingBtn:['+ 사업 보고','+ 사업 보고']
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
