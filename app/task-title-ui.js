function ttuSyncCreateHeading(){
  const input=document.querySelector('#taskTitle');
  const heading=document.querySelector('#taskModal .modal-head h2');
  const save=document.querySelector('#saveTaskBtn');
  if(!input||!heading||!save)return;
  if(save.textContent.includes('수정'))return;
  heading.textContent=input.value.trim()||'할 일 추가';
}

function ttuInstall(){
  if(window.__KPTU_TASK_TITLE_UI__)return;
  window.__KPTU_TASK_TITLE_UI__=true;

  const style=document.createElement('style');
  style.id='taskTitleUiStyle';
  style.textContent=`
    #tlTaskSections .tl-task-section:first-child .tl-section-head h3{display:none}
    #tlTaskSections .tl-task-section:first-child .tl-section-head{justify-content:flex-end;margin-bottom:4px}
    #tlTaskSections .tl-task-content b{font-size:16px;line-height:1.35}
    @media(max-width:700px){
      #tlTaskSections .tl-task-content b{font-size:18px;line-height:1.4}
      #tlTaskSections .tl-task-section:first-child .tl-section-head{margin-bottom:2px}
    }
  `;
  document.head.appendChild(style);

  const input=document.querySelector('#taskTitle');
  input?.addEventListener('input',ttuSyncCreateHeading);

  document.addEventListener('click',e=>{
    if(e.target.closest?.('#quickTaskBtn,#newTaskBtn')){
      setTimeout(()=>{
        const save=document.querySelector('#saveTaskBtn');
        if(save&&!save.textContent.includes('수정'))ttuSyncCreateHeading();
      },0);
    }
  },true);

  const modal=document.querySelector('#taskModal');
  if(modal){
    new MutationObserver(()=>{
      if(!modal.classList.contains('hidden'))setTimeout(ttuSyncCreateHeading,0);
    }).observe(modal,{attributes:true,attributeFilter:['class']});
  }
}

ttuInstall();
