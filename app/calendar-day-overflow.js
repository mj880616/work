(()=>{
  if(window.__KPTU_CALENDAR_DAY_OVERFLOW__)return;
  window.__KPTU_CALENDAR_DAY_OVERFLOW__=true;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pad=n=>String(n).padStart(2,'0');

  function ensureModal(){
    if(document.querySelector('#calendarDayModal'))return;
    document.body.insertAdjacentHTML('beforeend','<div id="calendarDayModal" class="modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="calendarDayTitle"><div class="modal-card small-card kptu-day-card"><div class="modal-head"><div><div class="eyebrow">DAY SCHEDULE</div><h2 id="calendarDayTitle">일정</h2></div><button class="icon-btn" data-close="calendarDayModal" type="button" aria-label="닫기">×</button></div><div id="calendarDayList" class="kptu-day-list"></div></div></div>');
  }
  function eventRow(ev){
    const b=document.createElement('button');b.type='button';b.className='cal-event cmv-day-event '+(ev.source==='google'?'google cp-event':'cm-app');
    if(ev.source==='google'){b.dataset.googleEvent=ev.id;b.dataset.googleCalendar=ev.calendarId||'primary'}else b.dataset.appEvent=ev.id;
    b.style.background=ev.color||'#7656a8';b.style.color=ev.text||'#fff';
    const time=ev.allDay?'종일':`${pad(ev.start.getHours())}:${pad(ev.start.getMinutes())}`;
    b.innerHTML=`<span class="cmv-day-time">${esc(time)}</span><span class="cmv-day-title">${esc(ev.title)}</span>`;
    b.setAttribute('aria-label',time+' '+ev.title);return b;
  }
  function open(date,events=[]){
    ensureModal();
    const list=document.querySelector('#calendarDayList'),title=document.querySelector('#calendarDayTitle');
    title.textContent=date.toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'});
    list.replaceChildren();
    events.forEach(ev=>list.appendChild(eventRow(ev)));
    if(!events.length)list.innerHTML='<div class="empty compact">등록된 일정이 없습니다.</div>';
    const modal=document.querySelector('#calendarDayModal');modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
    window.KPTUA11y?.dialog.activate?.(modal,{trigger:document.activeElement,initialFocus:'#calendarDayList .cal-event',onRequestClose:()=>{modal.classList.add('hidden');modal.setAttribute('aria-hidden','true')}});
  }
  function apply(){return true}

  ensureModal();
  window.KPTUCalendarDayOverflow={apply,open};
  document.addEventListener('click',event=>{
    if(!event.target.closest?.('#calendarDayList .cal-event'))return;
    const modal=document.querySelector('#calendarDayModal');modal?.classList.add('hidden');modal?.setAttribute('aria-hidden','true');
  });
  window.__KPTU_CALENDAR_DAY_OVERFLOW_READY__=Promise.resolve(true);
})();