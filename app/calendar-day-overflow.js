(()=>{
  if(window.__KPTU_CALENDAR_DAY_OVERFLOW__)return;
  window.__KPTU_CALENDAR_DAY_OVERFLOW__=true;
  const mq=window.matchMedia('(max-width:760px)');
  let painting=false;

  function dayInfo(cell){
    const grid=document.querySelector('#calendarGrid');
    const cells=[...grid.querySelectorAll('.cal-cell')];
    const index=cells.indexOf(cell);if(index<0)return null;
    const m=(document.querySelector('#monthTitle')?.textContent||'').match(/(\d{4})년\s*(\d{1,2})월/);if(!m)return null;
    const first=new Date(Number(m[1]),Number(m[2])-1,1),start=new Date(first);
    start.setDate(1-first.getDay());
    const date=new Date(start);date.setDate(start.getDate()+index);
    return {date,label:date.toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'})};
  }

  function ensureModal(){
    if(document.querySelector('#calendarDayModal'))return;
    document.body.insertAdjacentHTML('beforeend','<div id="calendarDayModal" class="modal hidden" aria-hidden="true"><div class="modal-card small-card kptu-day-card"><div class="modal-head"><div><div class="eyebrow">DAY SCHEDULE</div><h2 id="calendarDayTitle">일정</h2></div><button class="icon-btn" data-close="calendarDayModal" type="button">×</button></div><div id="calendarDayList" class="kptu-day-list"></div></div></div>');
    const style=document.createElement('style');
    style.textContent='.kptu-day-more{display:block;width:100%;border:0;background:transparent;color:var(--blue);font-size:9px;font-weight:900;text-align:left;padding:3px 1px;cursor:pointer}.kptu-day-list{display:grid;gap:8px}.kptu-day-list .cal-event{display:block!important;margin:0!important;padding:9px 10px!important;font-size:12px!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;border-radius:9px!important;min-height:38px}.kptu-day-card{width:min(100%,520px)!important}';
    document.head.appendChild(style);
  }

  function openDay(cell){
    ensureModal();
    const info=dayInfo(cell);if(!info)return;
    const list=document.querySelector('#calendarDayList');
    const events=[...cell.querySelectorAll(':scope > .cal-event')];
    document.querySelector('#calendarDayTitle').textContent=info.label;
    list.innerHTML='';
    events.forEach(event=>{
      const clone=event.cloneNode(true);clone.style.display='block';clone.classList.remove('kptu-overflow-hidden');list.appendChild(clone);
    });
    if(!events.length)list.innerHTML='<div class="empty compact">등록된 일정이 없습니다.</div>';
    const modal=document.querySelector('#calendarDayModal');modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
  }

  function apply(){
    if(painting)return;painting=true;
    try{
      const grid=document.querySelector('#calendarGrid');if(!grid)return;
      const mobile=mq.matches;
      grid.querySelectorAll('.cal-cell').forEach(cell=>{
        const events=[...cell.querySelectorAll(':scope > .cal-event')];
        const sig=events.map(e=>e.dataset.googleEvent||e.dataset.appEvent||e.textContent||'').join('|');
        if(cell.dataset.kptuOverflowSig===sig&&cell.dataset.kptuOverflowMobile===String(mobile))return;
        cell.dataset.kptuOverflowSig=sig;cell.dataset.kptuOverflowMobile=String(mobile);
        cell.querySelector('.kptu-day-more')?.remove();
        cell.querySelectorAll(':scope > small').forEach(s=>{if(/^\+\d+/.test((s.textContent||'').trim()))s.style.display='none'});
        events.forEach(e=>{e.classList.remove('kptu-overflow-hidden');e.style.display=''});
        if(!mobile||events.length<=2)return;
        events.slice(2).forEach(e=>{e.classList.add('kptu-overflow-hidden');e.style.display='none'});
        const more=document.createElement('button');more.type='button';more.className='kptu-day-more';more.textContent=`+${events.length-2}개`;more.setAttribute('aria-label',`일정 ${events.length-2}개 더 보기`);more.onclick=event=>{event.preventDefault();event.stopPropagation();openDay(cell)};cell.appendChild(more);
      });
    }finally{painting=false}
  }

  ensureModal();
  const grid=document.querySelector('#calendarGrid');
  if(grid)new MutationObserver(()=>setTimeout(apply,20)).observe(grid,{childList:true,subtree:true});
  document.addEventListener('click',event=>{
    if(event.target.closest?.('#calendarDayList .cal-event')){
      const modal=document.querySelector('#calendarDayModal');
      setTimeout(()=>{modal?.classList.add('hidden');modal?.setAttribute('aria-hidden','true')},0);
    }
  });
  if(mq.addEventListener)mq.addEventListener('change',apply);else mq.addListener?.(apply);
  window.KPTURouter?.on?.('calendar',()=>setTimeout(apply,180));
  setTimeout(apply,400);
})();
