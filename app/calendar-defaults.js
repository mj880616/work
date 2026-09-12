function preferPersonalCalendarForNewEvent(){
  const scope=document.querySelector('#eventCalendarScope');
  if(!scope)return;
  scope.value='personal';
  scope.dispatchEvent(new Event('change',{bubbles:true}));
}

document.addEventListener('click',e=>{
  if(!e.target.closest?.('#newEventBtn,#homeAddEvent,#calendarQuickAdd'))return;
  setTimeout(preferPersonalCalendarForNewEvent,0);
},true);
