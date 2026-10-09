(()=>{
  if(window.KPTUCalendarMonthView)return;
  const DAY_MS=86400000;
  const mq760=window.matchMedia('(max-width:760px)');
  const mq1024=window.matchMedia('(min-width:1024px)');
  // Navigation is optional during startup; retain the same 12px click protection if its import fails.
  const tapSlop=()=>window.KPTUMobileSwipeNavigation?.tapSlop??12;
  let last=null,touchStart=null,suppressUntil=0,resizeFrame=0;
  let layoutSize={width:document.documentElement.clientWidth,height:document.documentElement.clientHeight};
  // Google tasks by due date (CAL-할일). calendar-tasks.js owns this list and hands it over with setTasks().
  let tasks=[],tasksSig='';

  const pad=n=>String(n).padStart(2,'0');
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const key=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const dateOnly=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?new Date(+m[1],+m[2]-1,+m[3],0,0,0,0):new Date(v)};
  const dayStart=v=>{const d=v instanceof Date?new Date(v):dateOnly(v);d.setHours(0,0,0,0);return d};
  const dayDiff=(a,b)=>Math.round((dayStart(a)-dayStart(b))/DAY_MS);
  function visibleRange(year,month){
    const first=new Date(year,month,1),start=new Date(first),days=new Date(year,month+1,0).getDate();
    start.setDate(1-first.getDay());start.setHours(0,0,0,0);
    const weeks=Math.max(5,Math.min(6,Math.ceil((first.getDay()+days)/7)));
    const end=new Date(start);end.setDate(start.getDate()+weeks*7);
    return {start,end,weeks,days:weeks*7};
  }
  function textColor(hex){
    const h=String(hex||'').replace('#','');if(!/^[0-9a-f]{6}$/i.test(h))return '#fff';
    const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
    return r*299+g*587+b*114>155000?'#26323d':'#fff';
  }
  function inclusiveEnd(start,end,allDay){
    if(!end)return new Date(start);
    const d=dateOnly(end);
    if(d<=start)return new Date(start);
    if(allDay||(!d.getHours()&&!d.getMinutes()&&!d.getSeconds()&&!d.getMilliseconds()))return new Date(d.getTime()-1);
    return d;
  }
  function googleColor(ev,state){
    const cal=state?.calendars?.find(x=>x.id===ev.calendarId);
    return ev.color||state?.colors?.[ev.calendarId]||cal?.backgroundColor||'#4285f4';
  }
  function normalizeGoogle(ev,state){
    const start=dateOnly(ev.start),allDay=!!ev.allDay||/^\d{4}-\d{2}-\d{2}$/.test(String(ev.start||'')),endRaw=ev.end?dateOnly(ev.end):new Date(start),color=googleColor(ev,state);
    return {key:'google:'+ev.calendarId+':'+ev.id,id:ev.id,source:'google',calendarId:ev.calendarId||'primary',title:ev.title||'(제목 없음)',start,end:inclusiveEnd(start,endRaw,allDay),allDay,color,text:textColor(color),raw:ev};
  }
  function cssPx(el,name,fallback){
    const value=parseFloat(getComputedStyle(el).getPropertyValue(name));
    return Number.isFinite(value)?value:fallback;
  }
  function viewportLayout(grid,weeks,head,maxLanes){
    const header=cssPx(grid,'--cmv-date-header-height',44),step=cssPx(grid,'--cmv-lane-step',14);
    // Phones reserve three unchanged rows plus one thin overflow row, then fill the viewport.
    const moreHeight=cssPx(grid,'--cmv-more-height',44);
    const required=mq760.matches?header+3*step+moreHeight+2:mq1024.matches?0:header+Math.min(1,maxLanes)*step+(maxLanes>1?44:0)+2;
    grid.style.setProperty('--cmv-content-week-height',required+'px');
    const headHeight=cssPx(grid,'--cmv-head-height',23),minWeek=Math.max(required,cssPx(grid,'--cmv-min-week-height',58));
    const dateHeaderHeight=cssPx(grid,'--cmv-date-header-height',23),laneStep=cssPx(grid,'--cmv-lane-step',14);
    const style=getComputedStyle(grid);
    const border=(parseFloat(style.borderTopWidth)||0)+(parseFloat(style.borderBottomWidth)||0);
    const minGrid=Math.ceil(headHeight+minWeek*weeks+border);
    const view=grid.closest('#calendarView');
    let height=minGrid;
    if(!view||!view.classList.contains('hidden')){
      // Pinch zoom changes the visual viewport, not the layout space available to the grid.
      const viewportHeight=document.documentElement.clientHeight||window.innerHeight||window.visualViewport?.height||0;
      const safeBottom=view?(parseFloat(getComputedStyle(view).paddingBottom)||0):0;
      // Page scrolling must not create extra slots when tasks or events trigger a rerender.
      const gridTop=grid.getBoundingClientRect().top+(mq760.matches?window.scrollY:0);
      const available=Math.floor(viewportHeight-gridTop-safeBottom);
      height=Math.max(minGrid,available);
      if(!mq760.matches)height=Math.min(height,Math.max(minGrid,Math.floor(viewportHeight*.82)));
    }
    grid.style.setProperty('--cmv-grid-height',height+'px');
    grid.dataset.cmvViewportHeight=String(height);
    const actualHead=head?.getBoundingClientRect().height||headHeight;
    const rowHeight=Math.max(minWeek,(grid.clientHeight-actualHead)/weeks);
    const slots=Math.max(1,Math.floor((rowHeight-dateHeaderHeight-2-(mq760.matches?Math.max(0,moreHeight-laneStep):0))/laneStep));
    grid.dataset.cmvLaneSlots=String(slots);
    return {height,rowHeight,slots,dateHeaderHeight,laneStep};
  }
  function laneCap(laneCount,layout){
    if(mq760.matches)return laneCount>layout.slots?layout.slots-1:layout.slots;
    return laneCount>layout.slots?Math.max(1,Math.floor((layout.rowHeight-layout.dateHeaderHeight-44-2)/layout.laneStep)):layout.slots;
  }
  function eventSort(a,b){
    const at=a.source==='task'?1:0,bt=b.source==='task'?1:0;
    if(at!==bt)return at-bt;
    const am=dayDiff(a.end,a.start)>0?0:1,bm=dayDiff(b.end,b.start)>0?0:1;
    if(am!==bm)return am-bm;
    if(a.allDay!==b.allDay)return a.allDay?-1:1;
    const d=a.start-b.start;if(d)return d;
    return String(a.title).localeCompare(String(b.title),'ko');
  }
  function segmentWeeks(events,range){
    const result=[];
    for(let w=0;w<range.weeks;w++){
      const ws=new Date(range.start);ws.setDate(range.start.getDate()+w*7);
      const we=new Date(ws);we.setDate(ws.getDate()+6);we.setHours(23,59,59,999);
      const segments=[];
      for(const ev of events){
        if(ev.end<ws||ev.start>we)continue;
        const segStart=ev.start<ws?ws:dayStart(ev.start),segEnd=ev.end>we?we:ev.end;
        const startCol=Math.max(0,dayDiff(segStart,ws)),endCol=Math.min(6,dayDiff(segEnd,ws));
        segments.push({ev,startCol,endCol,span:endCol-startCol+1,continuesLeft:ev.start<ws,continuesRight:ev.end>we});
      }
      segments.sort((a,b)=>eventSort(a.ev,b.ev)||a.startCol-b.startCol||b.span-a.span);
      const lanes=[];
      for(const seg of segments){
        let lane=0;
        for(;lane<lanes.length;lane++)if(lanes[lane].every(x=>seg.endCol<x.startCol||seg.startCol>x.endCol))break;
        if(!lanes[lane])lanes[lane]=[];
        lanes[lane].push({startCol:seg.startCol,endCol:seg.endCol});
        seg.lane=lane;
      }
      result.push({week:w,start:ws,segments,laneCount:lanes.length});
    }
    return result;
  }
  // Phones fill each date independently. Join adjacent pieces when an event stays in the same row.
  function compactPhoneWeek(week){
    const days=Array.from({length:7},(_,col)=>week.segments.filter(seg=>seg.startCol<=col&&seg.endCol>=col));
    const pieces=[];
    for(const seg of week.segments){
      let run=null;
      for(let col=seg.startCol;col<=seg.endCol;col++){
        const lane=days[col].indexOf(seg);
        if(run&&run.lane===lane){run.endCol=col;run.span++}
        else{
          run={...seg,startCol:col,endCol:col,span:1,lane,continuesLeft:seg.continuesLeft||col>seg.startCol};
          pieces.push(run);
        }
        run.continuesRight=seg.continuesRight||col<seg.endCol;
      }
    }
    return {...week,segments:pieces,laneCount:Math.max(...days.map(day=>day.length))};
  }
  // t.date is the date part of the Google due value (YYYY-MM-DD), used as it is, so no time zone can move it to another day.
  function normalizeTask(t){
    const start=dateOnly(t.date);
    return {key:'task:'+t.id,id:t.id,source:'task',title:t.title||'(제목 없음)',start,end:new Date(start),allDay:true,done:!!t.done,overdue:!!t.overdue};
  }
  function taskLabel(ev){
    return '할 일: '+ev.title+(ev.done?', 완료':ev.overdue?', 기한 지남':'');
  }
  // A task is drawn as an outlined chip with a completion circle, unlike the filled event bars; a completed one is struck and faded.
  function taskButton(ev,className){
    const b=document.createElement('button');
    b.type='button';
    b.className='cal-event cmv-task '+className+(ev.done?' cmv-task-done':ev.overdue?' cmv-task-overdue':'');
    b.dataset.calendarTask=ev.id;
    b.innerHTML=`<span class="cmv-task-mark" aria-hidden="true">${ev.done?'✓':''}</span><span class="cmv-event-title">${esc(ev.title)}</span>`;
    const label=taskLabel(ev);
    b.title=label;b.setAttribute('aria-label',label);
    return b;
  }
  function timeLabel(ev){
    if(ev.allDay)return '';
    return `${pad(ev.start.getHours())}:${pad(ev.start.getMinutes())}`;
  }
  function eventButton(seg){
    const ev=seg.ev;
    const b=document.createElement('button');
    b.type='button';
    b.className='cal-event cmv-event '+'google cp-event'+(seg.continuesLeft?' cmv-continues-left':'')+(seg.continuesRight?' cmv-continues-right':'');
    b.dataset.cmvEvent=ev.key;
    b.dataset.googleEvent=ev.id;b.dataset.googleCalendar=ev.calendarId;
    b.style.gridColumn=`${seg.startCol+1} / span ${seg.span}`;
    b.style.gridRow=String(seg.lane+1);
    b.style.background=ev.color;b.style.color=ev.text;
    if(ev.source==='google')b.style.setProperty('--cmv-google-source',ev.color||'#4285f4');
    const tm=timeLabel(ev),label=(tm?tm+' ':'')+ev.title;
    b.innerHTML=(tm?`<span class="cmv-event-time">${esc(tm)}</span>`:'')+`<span class="cmv-event-title">${esc(ev.title)}</span>`;
    b.title=label;
    b.setAttribute('aria-label',label);
    return b;
  }
  function dayEvents(events,date){
    const s=dayStart(date),e=new Date(s);e.setHours(23,59,59,999);
    return events.filter(ev=>ev.start<=e&&ev.end>=s).sort(eventSort);
  }
  function allEvents(options){
    return [
      ...(options.googleEvents||[]).map(ev=>normalizeGoogle(ev,options.googleState||{})),
      ...tasks.map(normalizeTask)
    ].filter(ev=>Number.isFinite(ev.start.getTime())&&Number.isFinite(ev.end.getTime()));
  }
  function render(options){
    last=options;
    const grid=document.querySelector('#calendarGrid');if(!grid||window.KPTUCalendarView?.current()==='list')return false;
    bindTouchGuard();
    layoutSize={width:document.documentElement.clientWidth,height:document.documentElement.clientHeight};
    const year=Number(options.year),month=Number(options.month),range=visibleRange(year,month);
    const events=allEvents(options);
    const weeks=segmentWeeks(events.filter(ev=>ev.source!=='task'),range).map(week=>mq760.matches?compactPhoneWeek(week):week);
    const pendingByDate=new Map();
    tasks.forEach(t=>{if(t.done||t.date<key(range.start)||t.date>=key(range.end))return;const group=pendingByDate.get(t.date)||[];group.push(t);pendingByDate.set(t.date,group)});

    grid.replaceChildren();
    grid.dataset.monthView='1';
    grid.style.setProperty('--cmv-week-count',String(range.weeks));

    const heads=document.createElement('div');heads.className='cmv-head-row';
    ['일','월','화','수','목','금','토'].forEach((name,i)=>{const h=document.createElement('div');h.className='cal-head'+(i===0?' sunday':i===6?' saturday':'');h.textContent=name;heads.appendChild(h)});
    grid.appendChild(heads);
    const layout=viewportLayout(grid,range.weeks,heads,Math.max(...weeks.map(w=>w.laneCount)));

    const weeksBox=document.createElement('div');weeksBox.className='cmv-weeks';
    weeks.forEach(week=>{
      const lanes=mq1024.matches?week.laneCount:laneCap(week.laneCount,layout);
      const wrap=document.createElement('div');wrap.className='cmv-week';wrap.dataset.weekStart=key(week.start);wrap.dataset.laneCap=String(lanes);wrap.dataset.laneCount=String(week.laneCount);
      const dayGrid=document.createElement('div');dayGrid.className='cmv-week-days';
      for(let i=0;i<7;i++){
        const date=new Date(week.start);date.setDate(week.start.getDate()+i);
        const dkey=key(date),pending=pendingByDate.get(dkey)||[],split=mq760.matches||pending.length>0,cell=document.createElement(split?'div':'button');
        if(!split)cell.type='button';
        cell.className='cal-cell'+(date.getMonth()===month?'':' other')+(dkey===key(new Date())?' today':'');
        cell.dataset.date=dkey;cell.setAttribute('aria-label',date.toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'})+' 일정 추가');
        const day=document.createElement('span');day.className='cal-day';day.textContent=String(date.getDate());
        if(split){
          const create=document.createElement('button');create.type='button';create.className='cmv-date-create';create.setAttribute('aria-label',cell.getAttribute('aria-label'));
          if(mq760.matches){
            const list=document.createElement('button');list.type='button';list.className='cmv-date-list';list.dataset.date=dkey;
            list.setAttribute('aria-label',`${date.getMonth()+1}월 ${date.getDate()}일 목록 보기`);
            list.appendChild(day);
            list.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();window.KPTUCalendarDayOverflow?.open?.(date,dayEvents(events,date))});
            cell.append(create,list);
          }else{create.classList.add('cmv-date-create-pc');create.appendChild(day);cell.append(create)}
          cell.removeAttribute('aria-label');
        }else cell.appendChild(day);
        if(pending.length){
          cell.classList.add('cmv-cell-tasks');
          const count=document.createElement(mq760.matches?'span':'button');
          if(mq760.matches)count.setAttribute('role','img');else count.type='button';
          count.className='cmv-task-count';
          const overdue=pending.some(t=>t.overdue);count.classList.toggle('cmv-task-count-overdue',overdue);
          count.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span>${pending.length}</span>`;count.setAttribute('aria-label',`할 일 ${pending.length}개`+(overdue?', 기한 지남 포함':''));
          if(mq760.matches){
            const list=cell.querySelector('.cmv-date-list');
            list.setAttribute('aria-label',list.getAttribute('aria-label')+', '+count.getAttribute('aria-label'));
            list.appendChild(count);
          }else{
            count.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();window.KPTUCalendarDayOverflow?.open?.(date,dayEvents(events,date))});
            cell.appendChild(count);
          }
        }
        dayGrid.appendChild(cell);
      }
      const layer=document.createElement('div');layer.className='cmv-week-events';
      const hidden=Array(7).fill(0);
      const dayCaps=mq760.matches?Array.from({length:7},(_,col)=>laneCap(week.segments.filter(seg=>seg.startCol<=col&&seg.endCol>=col).length,layout)):Array(7).fill(lanes);
      week.segments.forEach(seg=>{
        if(!mq760.matches){
          if(seg.lane<lanes)layer.appendChild(eventButton(seg));
          else for(let col=seg.startCol;col<=seg.endCol;col++)hidden[col]++;
          return;
        }
        // A busier neighbour must not reserve overflow on a date whose events all fit.
        let run=null;
        const appendRun=()=>{if(run)layer.appendChild(eventButton(run));run=null};
        for(let col=seg.startCol;col<=seg.endCol;col++){
          if(seg.lane>=dayCaps[col]){appendRun();hidden[col]++;continue}
          if(run){run.endCol=col;run.span++}
          else run={...seg,startCol:col,endCol:col,span:1,continuesLeft:seg.continuesLeft||col>seg.startCol};
          run.continuesRight=seg.continuesRight||col<seg.endCol;
        }
        appendRun();
      });
      hidden.forEach((count,col)=>{
        if(!count)return;
        const date=new Date(week.start);date.setDate(week.start.getDate()+col);
        const more=document.createElement('button');more.type='button';more.className='kptu-day-more';more.dataset.date=key(date);more.textContent=`+${count}`;more.style.gridColumn=String(col+1);more.style.gridRow=String(dayCaps[col]+1);more.setAttribute('aria-label',`${date.getMonth()+1}월 ${date.getDate()}일 일정 ${count}개 더 보기`);
        more.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();window.KPTUCalendarDayOverflow?.open?.(date,dayEvents(events,date))});
        layer.appendChild(more);
      });
      wrap.append(dayGrid,layer);weeksBox.appendChild(wrap);
    });
    grid.appendChild(weeksBox);
    window.__KPTU_MONTH_VIEW_RANGE__={start:new Date(range.start),end:new Date(range.end),weeks:range.weeks,days:range.days};
    return true;
  }
  // Menu gestures belong to mobile-swipe-navigation.js. Only guard the release click here,
  // including events and overflow, without consuming touch events or restricting browser pan.
  function bindTouchGuard(){
    const grid=document.querySelector('#calendarGrid');if(!grid||grid.dataset.cmvTouchGuard==='1')return;
    grid.dataset.cmvTouchGuard='1';
    grid.addEventListener('touchstart',e=>{
      if(e.touches?.length!==1){touchStart=null;return}
      const t=e.touches[0];touchStart={x:t.clientX,y:t.clientY,moved:false};
    },{passive:true});
    grid.addEventListener('touchmove',e=>{
      if(e.touches?.length!==1){touchStart=null;return}
      if(!touchStart)return;
      const t=e.touches[0];
      const slop=tapSlop();
      if(Math.abs(t.clientX-touchStart.x)>slop||Math.abs(t.clientY-touchStart.y)>slop)touchStart.moved=true;
    },{passive:true});
    grid.addEventListener('touchend',e=>{
      if(e.touches?.length){touchStart=null;return}
      if(!touchStart||!e.changedTouches?.length)return;
      const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;
      const slop=tapSlop();
      if(touchStart.moved||Math.abs(dx)>slop||Math.abs(dy)>slop)suppressUntil=Date.now()+350;
      touchStart=null;
    },{passive:true});
    grid.addEventListener('touchcancel',()=>{
      if(touchStart?.moved)suppressUntil=Date.now()+350;
      touchStart=null;
    },{passive:true});
  }
  // Compatibility with team.js: month navigation is disabled; buttons own month changes.
  function setNavigate(){bindTouchGuard()}
  function suppressClick(){return Date.now()<suppressUntil}
  document.addEventListener('click',e=>{if(suppressClick()&&e.target.closest?.('#calendarGrid')){e.preventDefault();e.stopImmediatePropagation()}},true);
  const rerender=()=>{if(last)render(last);bindTouchGuard()};
  // Unchanged tasks (e.g. a fresh copy equal to this device's copy) do not redraw. While the calendar is hidden the list is only
  // kept; team.js redraws the calendar when it is shown again.
  function setTasks(list){
    const next=(Array.isArray(list)?list:[]).filter(t=>t&&t.id&&/^\d{4}-\d{2}-\d{2}$/.test(String(t.date||'')));
    const sig=JSON.stringify(next.map(t=>[t.id,t.title||'',t.date,!!t.done,!!t.overdue]));
    if(sig===tasksSig)return false;
    tasks=next;tasksSig=sig;
    if(last&&!document.querySelector('#calendarView')?.classList.contains('hidden'))render(last);
    return true;
  }
  const scheduleRerender=()=>{
    if(!last||document.querySelector('#calendarView')?.classList.contains('hidden'))return;
    const next={width:document.documentElement.clientWidth,height:document.documentElement.clientHeight};
    if(next.width===layoutSize.width&&next.height===layoutSize.height)return;
    layoutSize=next;
    cancelAnimationFrame(resizeFrame);
    resizeFrame=requestAnimationFrame(rerender);
  };
  window.addEventListener('resize',scheduleRerender,{passive:true});
  const forceRerender=()=>{if(last&&!document.querySelector('#calendarView')?.classList.contains('hidden')){cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(rerender)}};
  if(mq760.addEventListener)mq760.addEventListener('change',forceRerender);else mq760.addListener?.(forceRerender);
  document.addEventListener('toggle',event=>{if(event.target?.id==='googleCalendarPanel')forceRerender()},true);

  window.KPTUCalendarMonthView={render,googleColor,visibleRange,setNavigate,suppressClick,setTasks,taskButton,dayEvents:date=>last?dayEvents(allEvents(last),date):[]};
  if(window.__KPTU_CALENDAR_MOVE_MONTH__)setNavigate(window.__KPTU_CALENDAR_MOVE_MONTH__);
  window.__KPTU_CALENDAR_MONTH_VIEW_READY__=Promise.resolve(true);
})();
