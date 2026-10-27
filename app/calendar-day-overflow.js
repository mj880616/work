import {seoulDateKey,seoulClock,formatSeoulTime} from './meeting-time.js';
(()=>{
  if(window.__KPTU_CALENDAR_DAY_OVERFLOW__)return;
  window.__KPTU_CALENDAR_DAY_OVERFLOW__=true;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pad=n=>String(n).padStart(2,'0');

  function ensureModal(){
    if(document.querySelector('#calendarDayModal'))return;
    document.body.insertAdjacentHTML('beforeend','<div id="calendarDayModal" class="modal hidden" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="calendarDayTitle"><div class="modal-card small-card kptu-day-card"><div class="modal-head"><div><h2 id="calendarDayTitle">일정</h2></div><button class="icon-btn" data-close="calendarDayModal" type="button" aria-label="닫기">×</button></div><div id="calendarDayList" class="kptu-day-list"></div></div></div>');
  }
  const taskDate=ev=>ev.date||(ev.start?seoulDateKey(ev.start):'');
  function eventRow(ev){
    // Google tasks (CAL-할일) keep the month view's task chip; calendar-tasks.js opens the task editor for them.
    // UI-디자인손질 2: an overdue one also shows a small "지남" on the right (its aria-label already says 기한 지남).
    if(ev.source==='task'){const t=window.KPTUCalendarMonthView?.taskButton?.(ev,'cmv-day-event');if(t){const main=document.createElement('span');main.className='gt-day-main';main.append(t.querySelector('.cmv-event-title'));main.insertAdjacentHTML('beforeend',window.KPTUGoogleTasks?.taskMeta?.({due:taskDate(ev)})||'');t.append(main);if(ev.overdue&&!ev.done)t.insertAdjacentHTML('beforeend','<span class="kptu-day-overdue" aria-hidden="true">지남</span>');return t}}
    const b=document.createElement('button');b.type='button';b.className='cal-event cmv-day-event '+(ev.source==='google'?'google cp-event':'cm-app');
    if(ev.source==='google'){b.dataset.googleEvent=ev.id;b.dataset.googleCalendar=ev.calendarId||'primary'}else b.dataset.appEvent=ev.id;
    b.style.background=ev.color||'#7656a8';b.style.color=ev.text||'#fff';
    if(ev.source==='google')b.style.setProperty('--cmv-google-source',ev.color||'#4285f4');
    const time=ev.allDay?'종일':seoulClock(ev.start);
    b.innerHTML=`<span class="cmv-day-time">${esc(time)}</span><span class="cmv-day-title">${esc(ev.title)}</span>`;
    b.setAttribute('aria-label',time+' '+ev.title);return b;
  }
  // UI-할일조작통일 → TASK-바로처리통일: each task row sits beside a ⋯ button, the shared task line's menu (task-inline.js, opened by
  // calendar-tasks.js). On a PC it shows on the hovered / focused row only (ui-standard.css [data-task-inline-row]).
  function taskLine(ev,row){
    const wrap=document.createElement('div');wrap.className='gt-day-row';wrap.dataset.calendarTaskLine=ev.id;wrap.dataset.taskInlineRow='';
    const menu=document.createElement('button');menu.type='button';menu.className='gt-day-menu task-inline-more';menu.dataset.calendarTaskMenu=ev.id;
    menu.textContent='⋯';menu.setAttribute('aria-label',(ev.title||'제목 없음')+' 메뉴');menu.setAttribute('aria-haspopup','true');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-controls','calendarTaskMenu');
    wrap.append(row,menu);return wrap;
  }
  let openSeq=0;
  function open(date,events=[]){
    const seq=++openSeq,owner=window.KPTURuntime?.session?.read?.()?.user?.id;
    ensureModal();
    const list=document.querySelector('#calendarDayList'),title=document.querySelector('#calendarDayTitle');
    title.textContent=formatSeoulTime(date,{month:'long',day:'numeric',weekday:'long'});
    list.replaceChildren();
    const schedules=events.filter(e=>e.source!=='task'),tasks=events.filter(e=>e.source==='task');
    if(schedules.length){const section=document.createElement('section');section.id='calendarDayEvents';schedules.forEach(e=>section.append(eventRow(e)));list.append(section)}
    if(tasks.length){const section=document.createElement('section');section.id='calendarDayTasks';const heading=document.createElement('h3');heading.textContent='할 일';section.append(heading);tasks.forEach(e=>section.append(taskLine(e,eventRow(e))));list.append(section)}
    if(tasks.length)window.KPTUGoogleTasks?.describeTasks?.(tasks.map(e=>({id:e.id,due:taskDate(e)}))).then(rows=>{if(seq!==openSeq||owner!==window.KPTURuntime?.session?.read?.()?.user?.id)return;rows.forEach(t=>{const main=list.querySelector(`[data-calendar-task="${CSS.escape(t.id)}"] .gt-day-main`);if(!main)return;main.querySelector('.gt-meta')?.remove();main.insertAdjacentHTML('beforeend',window.KPTUGoogleTasks.taskMeta(t));})}).catch(()=>{});
    if(!events.length){const known=window.KPTUCalendarPersistence?.knows?.(new Date(seoulDateKey(date)+'T00:00:00+09:00'),new Date(Date.parse(seoulDateKey(date)+'T00:00:00+09:00')+86400000))??false;list.innerHTML=`<div class="empty compact">${known?'일정 없음':'불러오는 중…'}</div>`}
    // JOURNAL-일기: that day's diary first photo, small, on top of the list (opens [일기] on that day).
    Promise.all([import('./diary-data.js'),window.KPTUViewLoader?.prepare?.('diary')]).then(([diary])=>diary.diaryDayPreview(seoulDateKey(date))).then(preview=>{
      if(!preview||seq!==openSeq||owner!==window.KPTURuntime?.session?.read?.()?.user?.id)return;
      const section=document.createElement('section');section.id='calendarDayDiary';section.append(preview);list.prepend(section);
    }).catch(()=>{});
    const modal=document.querySelector('#calendarDayModal');modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
    window.KPTUA11y?.dialog.activate?.(modal,{trigger:document.activeElement,initialFocus:'#calendarDayList .cal-event',onRequestClose:()=>{modal.classList.add('hidden');modal.setAttribute('aria-hidden','true')}});
  }
  function apply(){return true}

  ensureModal();
  window.KPTUCalendarDayOverflow={apply,open};
  document.addEventListener('click',event=>{
    const preview=event.target.closest?.('#calendarDayList [data-diary-preview]');
    if(preview){
      const modal=document.querySelector('#calendarDayModal'),day=preview.dataset.diaryPreview;
      import('./diary-data.js').then(diary=>{
        diary.requestDiaryDay(day);
        const show=()=>window.KPTURouter?.go?.('diary');
        if(window.KPTUMobileModalHistory)window.KPTUMobileModalHistory.closeThen(modal,show);
        else{modal?.classList.add('hidden');modal?.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate?.(modal,{restoreFocus:false});show()}
      }).catch(()=>{});
      return;
    }
    if(!event.target.closest?.('#calendarDayList .cal-event'))return;
    // The task handler closes this list and waits for its history traversal before opening the editor.
    if(event.target.closest('[data-calendar-task]'))return;
    const modal=document.querySelector('#calendarDayModal');modal?.classList.add('hidden');modal?.setAttribute('aria-hidden','true');
  });
  window.__KPTU_CALENDAR_DAY_OVERFLOW_READY__=Promise.resolve(true);
})();