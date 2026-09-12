function updateCompletedTaskLabels(root=document){
  root.querySelectorAll?.('[data-pt-toggle]').forEach(btn=>{
    if(btn.textContent.trim()==='되돌리기')btn.textContent='미완료로 변경';
  });
}

updateCompletedTaskLabels();
const taskList=document.querySelector('#projectTaskList');
if(taskList){
  new MutationObserver(()=>updateCompletedTaskLabels(taskList)).observe(taskList,{childList:true,subtree:true});
}else{
  const bodyObserver=new MutationObserver(()=>{
    const list=document.querySelector('#projectTaskList');
    if(!list)return;
    updateCompletedTaskLabels(list);
    new MutationObserver(()=>updateCompletedTaskLabels(list)).observe(list,{childList:true,subtree:true});
    bodyObserver.disconnect();
  });
  bodyObserver.observe(document.body,{childList:true,subtree:true});
}
