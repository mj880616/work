function removeProjectTaskGuide(){
  document.querySelector('#projectTasksSection .pt-head p')?.remove();
}
removeProjectTaskGuide();
const observer=new MutationObserver(removeProjectTaskGuide);
observer.observe(document.body,{childList:true,subtree:true});
