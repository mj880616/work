let ciGoogleCurrent=null,ciGoogleSavePending=false,ciGoogleOpenSeq=0,ciGoogleReadySeq=0,ciGoogleOwner=null;
function ciRuntime(){const rt=window.KPTURuntime;if(!rt?.session||!rt?.api)throw new Error('앱 런타임을 불러오지 못했습니다.');return rt}
async function ciGoogleCall(action,{method='GET',body=null,params=null}={}){const rt=ciRuntime();if(!(await rt.session.ensure()))throw new Error('로그인이 필요합니다.');const u=new URL(rt.config.url+'/functions/v1/google-calendar');if(action)u.searchParams.set('action',action);if(params)Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v)));const d=await rt.api(u.toString(),{method,body});if(d?.error)throw new Error(d.error||'Google Calendar 요청 실패');return d}
function ciPad(n){return String(n).padStart(2,'0')}
function ciLocal(v){if(!v)return '';const d=new Date(v);return `${d.getFullYear()}-${ciPad(d.getMonth()+1)}-${ciPad(d.getDate())}T${ciPad(d.getHours())}:${ciPad(d.getMinutes())}`}
function ciParts(v){const d=new Date(v);return {date:`${d.getFullYear()}-${ciPad(d.getMonth()+1)}-${ciPad(d.getDate())}`,time:`${ciPad(d.getHours())}:${ciPad(d.getMinutes())}`}}
function ciMinusDay(v){const d=new Date(String(v)+'T00:00:00');d.setDate(d.getDate()-1);return `${d.getFullYear()}-${ciPad(d.getMonth()+1)}-${ciPad(d.getDate())}`}
function ciStatus(id,msg,err=false){const e=document.querySelector(id);if(e){e.textContent=msg||'';e.className='status'+(err?' error':'')}}
function ciToast(msg){const t=document.querySelector('#toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');clearTimeout(ciToast.t);ciToast.t=setTimeout(()=>t.classList.add('hidden'),2200)}
function ciOpen(id){const m=document.querySelector(id);if(m){m.classList.remove('hidden');m.setAttribute('aria-hidden','false')}}
function ciClose(id){const m=document.querySelector(id);if(m){m.classList.add('hidden');m.setAttribute('aria-hidden','true')}}
function ciCloseDay(openNext){
  const m=document.querySelector('#calendarDayModal');
  if(!m||m.classList.contains('hidden'))return openNext();
  if(window.KPTUMobileModalHistory)return window.KPTUMobileModalHistory.closeThen(m,openNext);
  m.classList.add('hidden');m.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate?.(m,{restoreFocus:false});openNext();
}
function ciInject(){if(document.querySelector('#ciGoogleModal'))return;document.body.insertAdjacentHTML('beforeend',`<div id="ciGoogleModal" class="modal hidden" aria-hidden="true"><div class="modal-card small-card ci-card"><div class="modal-head"><div><div class="eyebrow">GOOGLE CALENDAR</div><h2 id="ciGoogleHero">일정 수정</h2></div><button id="ciGoogleClose" class="icon-btn" type="button">×</button></div><label>캘린더<select id="ciGoogleCalendar" aria-label="캘린더"></select></label><div id="ciGoogleCalendarHint" class="muted"></div><label>제목<input id="ciGoogleTitle" type="text"></label><label class="ci-all"><input id="ciGoogleAllDay" type="checkbox"> 종일</label><div class="ci-date-grid"><label>시작 날짜<input id="ciGoogleStartDate" type="date"></label><label class="ci-gtime">시작 시간<input id="ciGoogleStartTime" type="time"></label><label>종료 날짜<input id="ciGoogleEndDate" type="date"></label><label class="ci-gtime">종료 시간<input id="ciGoogleEndTime" type="time"></label></div><div class="calendar-color-field"><span class="calendar-color-label">색상</span><div id="ciGoogleColor" class="calendar-color-presets" aria-label="Google 일정 색상"></div></div><label>메모<textarea id="ciGoogleMemo" rows="5"></textarea></label><div class="ci-actions"><button id="ciGoogleDelete" class="ci-delete" type="button">일정 삭제</button><button id="ciGoogleSave" class="primary" type="button">변경사항 저장</button></div><div id="ciGoogleStatus" class="status"></div></div></div>`);document.querySelector('#ciGoogleClose').onclick=()=>{ciGoogleOpenSeq++;ciGoogleCurrent=null;ciClose('#ciGoogleModal')};document.querySelector('#ciGoogleSave').onclick=ciSaveGoogle;document.querySelector('#ciGoogleDelete').onclick=ciDeleteGoogle;document.querySelector('#ciGoogleAllDay').onchange=ciToggleGoogleTime;document.querySelector('#ciGoogleTitle').addEventListener('input',()=>document.querySelector('#ciGoogleHero').textContent=document.querySelector('#ciGoogleTitle').value.trim()||'일정 수정')}
function ciToggleGoogleTime(){const on=document.querySelector('#ciGoogleAllDay').checked;document.querySelectorAll('.ci-gtime').forEach(x=>x.classList.toggle('hidden',on))}
function ciGoogleDisplayColor(e){const state=window.__KPTU_GOOGLE_STATE__||{},cal=state.calendars?.find(x=>x.id===e?.calendarId);return e?.color||state.colors?.[e?.calendarId]||cal?.backgroundColor||'#4285f4'}
function ciPopulateGoogleCalendars(event){
  const sel=document.querySelector('#ciGoogleCalendar'),state=window.__KPTU_GOOGLE_STATE__||{};
  const rows=(state.calendars||[]).filter(c=>['owner','writer'].includes(c.accessRole));
  sel.replaceChildren(...rows.map(c=>new Option((c.summary||c.id)+(c.primary?' (기본)':''),c.id)));
  if(!rows.some(c=>c.id===event.calendarId)){
    const current=state.calendars?.find(c=>c.id===event.calendarId),option=new Option(current?.summary||'현재 캘린더',event.calendarId);
    option.disabled=true;sel.prepend(option);
  }
  sel.value=event.calendarId;sel.disabled=!!event.recurring||!rows.length;
  document.querySelector('#ciGoogleCalendarHint').textContent=event.recurring?'반복 일정은 Google 캘린더에서 옮겨 주세요':!rows.length?'쓰기 가능한 캘린더가 없습니다.':'';
}
async function ciOpenGoogle(eventId,calendarId,{fresh=false,fallback=null}={}){
  const seq=++ciGoogleOpenSeq,owner=ciRuntime().session.read()?.user?.id;
  ciGoogleOwner=owner;
  const active=()=>seq===ciGoogleOpenSeq&&owner===ciRuntime().session.read()?.user?.id&&!document.querySelector('#ciGoogleModal').classList.contains('hidden');
  ciInject();ciGoogleCurrent=null;ciOpen('#ciGoogleModal');ciStatus('#ciGoogleStatus','Google 일정을 불러오는 중…');
  document.querySelector('#ciGoogleSave').disabled=true;document.querySelector('#ciGoogleDelete').disabled=true;document.querySelector('#ciGoogleCalendar').disabled=true;
  try{
    const cached=(window.__KPTU_GOOGLE_EVENTS__||[]).find(e=>e.id===eventId&&(!calendarId||e.calendarId===calendarId));
    let d,readFailed=false;
    try{d=!fresh&&cached&&typeof cached.recurring==='boolean'?{event:cached}:await ciGoogleCall('event',{params:{eventId,calendarId}})}catch(e){if(!fallback)throw e;d={event:fallback};readFailed=true}
    if(!active())return;
    if(d.eventColors)window.__KPTU_GOOGLE_STATE__={...(window.__KPTU_GOOGLE_STATE__||{}),eventColors:d.eventColors};
    ciGoogleCurrent=d.event;const e=ciGoogleCurrent;
    if(!e?.id)throw new Error('Google 일정을 확인하지 못했습니다.');
    ciPopulateGoogleCalendars(e);
    document.querySelector('#ciGoogleTitle').value=e.title||'';document.querySelector('#ciGoogleHero').textContent=e.title||'일정 수정';document.querySelector('#ciGoogleMemo').value=e.description||'';document.querySelector('#ciGoogleAllDay').checked=!!e.allDay;
    if(e.allDay){document.querySelector('#ciGoogleStartDate').value=e.start;document.querySelector('#ciGoogleEndDate').value=ciMinusDay(e.end)}
    else{const s=ciParts(e.start),en=ciParts(e.end);document.querySelector('#ciGoogleStartDate').value=s.date;document.querySelector('#ciGoogleStartTime').value=s.time;document.querySelector('#ciGoogleEndDate').value=en.date;document.querySelector('#ciGoogleEndTime').value=en.time}
    window.KPTUCalendarColors?.render?.('#ciGoogleColor',{value:ciGoogleDisplayColor(e),colorId:e.colorId||null,touched:false,label:'Google 일정 색상'});
    ciToggleGoogleTime();window.__KPTU_GOOGLE_EDIT_ORGS_PENDING__=e.organizationIds||[];
    if(window.__KPTU_SUBORGANIZATIONS_READY__)await window.__KPTU_SUBORGANIZATIONS_READY__;
    if(!active())return;
    window.__KPTU_EDIT_GOOGLE_ORGS__?.(e.organizationIds||[]);ciGoogleReadySeq=seq;ciStatus('#ciGoogleStatus','');document.querySelector('#ciGoogleSave').disabled=ciGoogleSavePending;document.querySelector('#ciGoogleDelete').disabled=ciGoogleSavePending;
    return {seq,readFailed};
  }catch(e){if(active())ciStatus('#ciGoogleStatus',e.message||String(e),true)}
}
async function ciSaveGoogle(){
  if(!ciGoogleCurrent||ciGoogleSavePending)return;
  const current=ciGoogleCurrent,seq=ciGoogleOpenSeq,owner=ciRuntime().session.read()?.user?.id;
  const title=document.querySelector('#ciGoogleTitle').value.trim(),allDay=document.querySelector('#ciGoogleAllDay').checked,startDate=document.querySelector('#ciGoogleStartDate').value,endDate=document.querySelector('#ciGoogleEndDate').value;
  if(!title)return ciStatus('#ciGoogleStatus','제목을 입력해 주세요.',true);
  if(!startDate||!endDate)return ciStatus('#ciGoogleStatus','시작 날짜와 종료 날짜를 입력해 주세요.',true);
  const body={action:'update-event',calendar_id:current.calendarId,event_id:current.id,title,memo:document.querySelector('#ciGoogleMemo').value,all_day:allDay,start_date:startDate,end_date:endDate},color=window.KPTUCalendarColors?.value?.('#ciGoogleColor');
  const target=document.querySelector('#ciGoogleCalendar').value;
  if(!current.recurring&&target&&target!==current.calendarId)body.target_calendar_id=target;
  if(color?.touched)body.color_hex=color.hex;
  if(!allDay){const st=document.querySelector('#ciGoogleStartTime').value,et=document.querySelector('#ciGoogleEndTime').value;if(!st||!et)return ciStatus('#ciGoogleStatus','시작 시간과 종료 시간을 입력해 주세요.',true);const s=new Date(startDate+'T'+st),e=new Date(endDate+'T'+et);if(e<=s)return ciStatus('#ciGoogleStatus','종료 시각은 시작 시각보다 뒤여야 합니다.',true);body.start_iso=s.toISOString();body.end_iso=e.toISOString()}
  body.organization_ids=window.__KPTU_SELECTED_GOOGLE_EDIT_ORGS__?.()||current.organizationIds||[];
  const b=document.querySelector('#ciGoogleSave'),label=b.textContent;
  ciGoogleSavePending=true;b.disabled=true;b.textContent='저장 중…';b.setAttribute('aria-busy','true');document.querySelector('#ciGoogleDelete').disabled=true;
  ciStatus('#ciGoogleStatus','Google Calendar에 저장 중…');
  const active=()=>owner===ciRuntime().session.read()?.user?.id&&seq===ciGoogleOpenSeq&&ciGoogleCurrent===current&&!document.querySelector('#ciGoogleModal').classList.contains('hidden');
  try{
    const result=await ciGoogleCall('',{method:'POST',body});
    if(owner!==ciRuntime().session.read()?.user?.id)return;
    if(result?.partial_failure&&result.moved){
      if(active()){
        // Update the address immediately even if the following fresh read fails.
        ciGoogleCurrent={...current,...result.event};ciPopulateGoogleCalendars(ciGoogleCurrent);
        const opened=await ciOpenGoogle(result.event.id,result.event.calendarId,{fresh:true,fallback:result.event});
        if(opened?.seq===ciGoogleOpenSeq&&owner===ciRuntime().session.read()?.user?.id&&!document.querySelector('#ciGoogleModal').classList.contains('hidden'))ciStatus('#ciGoogleStatus',result.message+(opened.readFailed?' 최신 조회도 실패해 서버가 확인한 이동 결과를 표시합니다.':''),true);
      }else ciToast(result.message);
      await window.__KPTU_RELOAD_GOOGLE_EVENTS__?.();return;
    }
    if(result?.ok===false)throw new Error(result.message||'Google 일정 저장에 실패했습니다.');
    if(active()){ciClose('#ciGoogleModal');ciGoogleCurrent=null;ciGoogleOpenSeq++}
    await window.__KPTU_RELOAD_GOOGLE_EVENTS__?.();ciToast('Google 일정을 수정했습니다.');
  }catch(e){if(active())ciStatus('#ciGoogleStatus',e.message||String(e),true)}
  finally{ciGoogleSavePending=false;const ready=document.querySelector('#ciGoogleModal').classList.contains('hidden')||(!!ciGoogleCurrent&&ciGoogleReadySeq===ciGoogleOpenSeq&&ciGoogleOwner===ciRuntime().session.read()?.user?.id);b.disabled=!ready;b.textContent=label;b.removeAttribute('aria-busy');document.querySelector('#ciGoogleDelete').disabled=!ready}
}
async function ciDeleteGoogle(){if(!ciGoogleCurrent)return;if(!confirm('이 Google 일정을 삭제할까요?'))return;const b=document.querySelector('#ciGoogleDelete');b.disabled=true;ciStatus('#ciGoogleStatus','삭제 중…');try{await ciGoogleCall('',{method:'POST',body:{action:'delete-event',calendar_id:ciGoogleCurrent.calendarId||'primary',event_id:ciGoogleCurrent.id}});ciClose('#ciGoogleModal');ciGoogleCurrent=null;await window.__KPTU_RELOAD_GOOGLE_EVENTS__?.();ciToast('Google 일정을 삭제했습니다.')}catch(e){ciStatus('#ciGoogleStatus',e.message||String(e),true)}finally{b.disabled=false}}
function ciClickedDate(cell){const m=String(cell?.dataset?.date||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;const d=new Date(+m[1],+m[2]-1,+m[3],9,0,0,0);return Number.isFinite(d.getTime())?d:null}
function ciCreateAt(d){const btn=document.querySelector('#newEventBtn');if(!btn)return;btn.click();const finish=new Date(d.getTime()+3600000),sp=ciParts(d),ep=ciParts(finish);const allDay=document.querySelector('#eventAllDay');if(allDay){allDay.checked=false;allDay.dispatchEvent(new Event('change',{bubbles:true}))}if(document.querySelector('#eventStartDate'))document.querySelector('#eventStartDate').value=sp.date;if(document.querySelector('#eventStartTime'))document.querySelector('#eventStartTime').value=sp.time;if(document.querySelector('#eventEndDate'))document.querySelector('#eventEndDate').value=ep.date;if(document.querySelector('#eventEndTime'))document.querySelector('#eventEndTime').value=ep.time;queueMicrotask(()=>document.querySelector('#eventTitle')?.focus())}
ciInject();
document.addEventListener('click',e=>{const g=e.target.closest?.('.cp-event[data-google-event]');if(g){e.preventDefault();e.stopImmediatePropagation();ciCloseDay(()=>ciOpenGoogle(g.dataset.googleEvent,g.dataset.googleCalendar));return}const cell=e.target.closest?.('#calendarGrid .cal-cell');if(!cell||window.KPTUCalendarMonthView?.suppressClick?.()||e.target.closest?.('.cal-event,.kptu-day-more,.cmv-date-list,.cmv-task-count,a,input,select,textarea'))return;const d=ciClickedDate(cell);if(d){e.preventDefault();e.stopPropagation();ciCreateAt(d)}},true);
window.__KPTU_CALENDAR_INTERACTIONS_READY__=Promise.resolve(true);
