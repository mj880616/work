function syncCreateEventTitle(){
  const modal=document.querySelector('#eventModal');
  const input=document.querySelector('#eventTitle');
  const title=modal?.querySelector('.modal-head h2');
  if(!input||!title)return;
  title.textContent=input.value.trim()||'새 일정 등록';
}
function bindCreateEventTitle(){
  const input=document.querySelector('#eventTitle');
  if(!input||input.dataset.liveTitleBound)return;
  input.dataset.liveTitleBound='1';
  input.addEventListener('input',syncCreateEventTitle);
  input.addEventListener('change',syncCreateEventTitle);
}
bindCreateEventTitle();
document.addEventListener('click',e=>{
  if(e.target.closest?.('#newEventBtn,#homeAddEvent,#calendarQuickAdd,.calendar-quick-add')){
    setTimeout(()=>{bindCreateEventTitle();syncCreateEventTitle()},0);
  }
},true);
window.__KPTU_SYNC_CREATE_EVENT_TITLE__=syncCreateEventTitle;
