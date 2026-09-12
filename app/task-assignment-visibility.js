let tavTimer=null;
function tavApply(){
  document.querySelectorAll('[data-tl-task-row],[data-pt-task-row]').forEach(row=>row.style.display='');
  const projectList=document.querySelector('#projectTaskList');
  if(projectList){
    const rows=[...projectList.querySelectorAll('[data-pt-task-row]')];
    const count=document.querySelector('#projectTaskCount');
    if(count)count.textContent=`미완료 ${rows.filter(x=>!x.classList.contains('done')).length}건 · 전체 ${rows.length}건`;
  }
}
function tavSchedule(){clearTimeout(tavTimer);tavTimer=setTimeout(tavApply,80)}
setTimeout(()=>{
  tavApply();
  const root=document.querySelector('#tasksView');
  if(root)new MutationObserver(tavSchedule).observe(root,{childList:true,subtree:true});
  const pm=document.querySelector('#projectModal');
  if(pm)new MutationObserver(tavSchedule).observe(pm,{childList:true,subtree:true});
  window.addEventListener('kptu:tasks-changed',tavSchedule);
  window.addEventListener('focus',tavSchedule);
},0);
