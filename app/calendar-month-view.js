(()=>{
  if(window.KPTUCalendarMonthView)return;
  const DAY_MS=86400000;
  const mq760=window.matchMedia('(max-width:760px)');
  let last=null,navigate=null,touchStart=null,suppressUntil=0,resizeFrame=0;

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
  function normalizeApp(ev){
    const start=dateOnly(ev.start_at),endRaw=ev.end_at?dateOnly(ev.end_at):new Date(start);
    const allDay=!!ev.end_at&&!start.getHours()&&!start.getMinutes()&&!endRaw.getHours()&&!endRaw.getMinutes()&&endRaw>start;
    return {key:'web2:'+ev.id,id:ev.id,source:'web2',title:ev.title||'(제목 없음)',start,end:inclusiveEnd(start,endRaw,allDay),allDay,color:ev.color_hex||'#7656a8',text:'#fff',projectId:ev.project_id||null,raw:ev};
  }
  function normalizeGoogle(ev,state){
    const start=dateOnly(ev.start),allDay=!!ev.allDay||/^\d{4}-\d{2}-\d{2}$/.test(String(ev.start||'')),endRaw=ev.end?dateOnly(ev.end):new Date(start),color=googleColor(ev,state);
    return {key:'google:'+ev.calendarId+':'+ev.id,id:ev.id,source:'google',calendarId:ev.calendarId||'primary',title:ev.title||'(제목 없음)',start,end:inclusiveEnd(start,endRaw,allDay),allDay,color,text:textColor(color),raw:ev};
  }
  function cssPx(el,name,fallback){
    const value=parseFloat(getComputedStyle(el).getPropertyValue(name));
    return Number.isFinite(value)?value:fallback;
  }
  function viewportLayout(grid,weeks,head){
    const headHeight=cssPx(grid,'--cmv-head-height',23),minWeek=cssPx(grid,'--cmv-min-week-height',58);
    const dateHeaderHeight=cssPx(grid,'--cmv-date-header-height',23),laneStep=cssPx(grid,'--cmv-lane-step',14);
    const style=getComputedStyle(grid);
    const border=(parseFloat(style.borderTopWidth)||0)+(parseFloat(style.borderBottomWidth)||0);
    const minGrid=Math.ceil(headHeight+minWeek*weeks+border);
    const view=grid.closest('#calendarView');
    let height=minGrid;
    if(!view||!view.classList.contains('hidden')){
      const vv=window.visualViewport,viewportHeight=vv?.height||document.documentElement.clientHeight||window.innerHeight;
      const viewportBottom=(vv?.offsetTop||0)+viewportHeight;
      const safeBottom=view?(parseFloat(getComputedStyle(view).paddingBottom)||0):0;
      const available=Math.floor(viewportBottom-grid.getBoundingClientRect().top-safeBottom);
      height=Math.max(minGrid,available);
      if(!mq760.matches)height=Math.min(height,Math.max(minGrid,Math.floor(viewportHeight*.72)));
    }
    grid.style.setProperty('--cmv-grid-height',height+'px');
    grid.dataset.cmvViewportHeight=String(height);
    const actualHead=head?.getBoundingClientRect().height||headHeight;
    const rowHeight=Math.max(minWeek,(grid.clientHeight-actualHead)/weeks);
    const slots=Math.max(2,Math.floor((rowHeight-dateHeaderHeight-1)/laneStep));
    grid.dataset.cmvLaneSlots=String(slots);
    return {height,rowHeight,slots,dateHeaderHeight};
  }
  function laneCap(laneCount,slots){
    return laneCount>slots?Math.max(1,slots-1):slots;
  }
  function eventSort(a,b){
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
  function timeLabel(ev){
    if(ev.allDay)return '';
    return `${pad(ev.start.getHours())}:${pad(ev.start.getMinutes())}`;
  }
  function eventButton(seg){
    const ev=seg.ev,b=document.createElement('button');
    b.type='button';
    b.className='cal-event cmv-event '+(ev.source==='google'?'google cp-event':'cm-app')+(seg.continuesLeft?' cmv-continues-left':'')+(seg.continuesRight?' cmv-continues-right':'');
    b.dataset.cmvEvent=ev.key;
    if(ev.source==='google'){b.dataset.googleEvent=ev.id;b.dataset.googleCalendar=ev.calendarId}
    else b.dataset.appEvent=ev.id;
    b.style.gridColumn=`${seg.startCol+1} / span ${seg.span}`;
    b.style.gridRow=String(seg.lane+1);
    b.style.background=ev.color;b.style.color=ev.text;
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
  function render(options){
    last=options;
    const grid=document.querySelector('#calendarGrid');if(!grid)return false;
    const year=Number(options.year),month=Number(options.month),range=visibleRange(year,month);
    const events=[
      ...(options.appEvents||[]).map(normalizeApp),
      ...(options.googleEvents||[]).map(ev=>normalizeGoogle(ev,options.googleState||{}))
    ].filter(ev=>Number.isFinite(ev.start.getTime())&&Number.isFinite(ev.end.getTime()));
    const weeks=segmentWeeks(events,range);
    grid.replaceChildren();
    grid.dataset.monthView='1';
    grid.style.setProperty('--cmv-week-count',String(range.weeks));

    const heads=document.createElement('div');heads.className='cmv-head-row';
    ['일','월','화','수','목','금','토'].forEach((name,i)=>{const h=document.createElement('div');h.className='cal-head'+(i===0?' sunday':i===6?' saturday':'');h.textContent=name;heads.appendChild(h)});
    grid.appendChild(heads);
    const layout=viewportLayout(grid,range.weeks,heads);

    const weeksBox=document.createElement('div');weeksBox.className='cmv-weeks';
    weeks.forEach(week=>{
      const lanes=laneCap(week.laneCount,layout.slots);
      const wrap=document.createElement('div');wrap.className='cmv-week';wrap.dataset.weekStart=key(week.start);wrap.dataset.laneCap=String(lanes);wrap.dataset.laneCount=String(week.laneCount);
      const dayGrid=document.createElement('div');dayGrid.className='cmv-week-days';
      for(let i=0;i<7;i++){
        const date=new Date(week.start);date.setDate(week.start.getDate()+i);
        const dkey=key(date),cell=document.createElement('button');
        cell.type='button';cell.className='cal-cell'+(date.getMonth()===month?'':' other')+(dkey===key(new Date())?' today':'');
        cell.dataset.date=dkey;cell.setAttribute('aria-label',date.toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'})+' 일정 추가');
        const day=document.createElement('span');day.className='cal-day';day.textContent=String(date.getDate());cell.appendChild(day);dayGrid.appendChild(cell);
      }
      const layer=document.createElement('div');layer.className='cmv-week-events';
      const hidden=Array(7).fill(0);
      week.segments.forEach(seg=>{
        if(seg.lane<lanes){layer.appendChild(eventButton(seg));return}
        for(let col=seg.startCol;col<=seg.endCol;col++)hidden[col]++;
      });
      hidden.forEach((count,col)=>{
        if(!count)return;
        const date=new Date(week.start);date.setDate(week.start.getDate()+col);
        const more=document.createElement('button');more.type='button';more.className='kptu-day-more';more.textContent=`+${count}`;more.style.gridColumn=String(col+1);more.style.gridRow=String(lanes+1);more.setAttribute('aria-label',`${date.getMonth()+1}월 ${date.getDate()}일 일정 ${count}개 더 보기`);
        more.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();window.KPTUCalendarDayOverflow?.open?.(date,dayEvents(events,date))});
        layer.appendChild(more);
      });
      wrap.append(dayGrid,layer);weeksBox.appendChild(wrap);
    });
    grid.appendChild(weeksBox);
    window.__KPTU_MONTH_VIEW_RANGE__={start:new Date(range.start),end:new Date(range.end),weeks:range.weeks,days:range.days};
    return true;
  }
  function bindSwipe(){
    const grid=document.querySelector('#calendarGrid');if(!grid||grid.dataset.cmvSwipe==='1')return;
    grid.dataset.cmvSwipe='1';
    grid.addEventListener('touchstart',e=>{
      if(e.touches?.length!==1||e.target.closest('.cal-event,.kptu-day-more,input,select,textarea,a')){touchStart=null;return}
      e.stopPropagation();
      const t=e.touches[0];touchStart={x:t.clientX,y:t.clientY};
    },{passive:true});
    grid.addEventListener('touchend',e=>{
      if(!touchStart||!e.changedTouches?.length)return;
      e.stopPropagation();
      const t=e.changedTouches[0],dx=t.clientX-touchStart.x,dy=t.clientY-touchStart.y;touchStart=null;
      if(Math.abs(dx)<55||Math.abs(dy)>45||Math.abs(dx)<Math.abs(dy)*1.4)return;
      suppressUntil=Date.now()+350;
      navigate?.(dx<0?1:-1);
    },{passive:true});
  }
  function setNavigate(fn){navigate=typeof fn==='function'?fn:null;bindSwipe()}
  function suppressClick(){return Date.now()<suppressUntil}
  document.addEventListener('click',e=>{if(suppressClick()&&e.target.closest?.('#calendarGrid')){e.preventDefault();e.stopImmediatePropagation()}},true);
  const rerender=()=>{if(last)render(last);bindSwipe()};
  const scheduleRerender=()=>{
    if(!last||document.querySelector('#calendarView')?.classList.contains('hidden'))return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame=requestAnimationFrame(rerender);
  };
  if(mq760.addEventListener)mq760.addEventListener('change',scheduleRerender);else mq760.addListener?.(scheduleRerender);
  window.addEventListener('resize',scheduleRerender,{passive:true});
  window.visualViewport?.addEventListener('resize',scheduleRerender,{passive:true});
  document.addEventListener('toggle',event=>{if(event.target?.id==='googleCalendarPanel')scheduleRerender()},true);

  window.KPTUCalendarMonthView={render,visibleRange,setNavigate,suppressClick,dayEvents:date=>last?dayEvents([...(last.appEvents||[]).map(normalizeApp),...(last.googleEvents||[]).map(ev=>normalizeGoogle(ev,last.googleState||{}))],date):[]};
  if(window.__KPTU_CALENDAR_MOVE_MONTH__)setNavigate(window.__KPTU_CALENDAR_MOVE_MONTH__);
  window.__KPTU_CALENDAR_MONTH_VIEW_READY__=Promise.resolve(true);
})();