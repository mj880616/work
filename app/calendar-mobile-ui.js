function applyCalendarMobileUi(){
  document.querySelector('#newEventBtn')?.setAttribute('aria-label','일정 등록');
  const monthToolbar=document.querySelector('.calendar-toolbar');
  if(monthToolbar){
    monthToolbar.setAttribute('role','group');
    monthToolbar.setAttribute('aria-labelledby','monthTitle');
  }
}
applyCalendarMobileUi();
window.__KPTU_CALENDAR_MOBILE_UI_READY__=Promise.resolve(true);
