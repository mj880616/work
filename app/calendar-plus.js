import {toSeoulISO} from './meeting-time.js?v=2';
import { createGoogleTask } from './quick-save.js?v=2';
import { createChoiceSheet, projectRows } from './choice-sheet.js?v=1';
const CM_GOOGLE_DEFAULT='#4285f4';
const CM_FALLBACK_EVENT_COLORS=['#a4bdfc','#7ae7bf','#dbadff','#ff887c','#fbd75b','#ffb878','#46d6db','#e1e1e1','#5484ed','#51b749','#dc2127'];
let cmGoogle=null,cmSavePending=false,cmMode='event',cmProject='',cmProjectRows=[],cmFormEpoch=0,cmRequest=null,cmSaved=null;const cmAttempts=new Map();
const cmEsc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function cmHexRgb(hex){const h=String(hex||'').replace('#','');if(!/^[0-9a-f]{6}$/i.test(h))return null;return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]}
function cmColorDistance(a,b){const x=cmHexRgb(a),y=cmHexRgb(b);return x&&y?(x[0]-y[0])**2+(x[1]-y[1])**2+(x[2]-y[2])**2:Number.POSITIVE_INFINITY}
function cmColorPalette(state=window.__KPTU_GOOGLE_STATE__||cmGoogle){
  const rows=Object.entries(state?.eventColors||{}).filter(([,v])=>/^#[0-9a-f]{6}$/i.test(String(v?.background||''))).sort(([a],[b])=>(Number(a)||0)-(Number(b)||0)).map(([id,v])=>({id:String(id),hex:String(v.background).toLowerCase(),foreground:v.foreground||'#fff'}));
  return rows.length?rows:CM_FALLBACK_EVENT_COLORS.map(hex=>({id:null,hex,foreground:'#fff'}))
}
function cmNearestColor(value,presets=cmColorPalette()){return presets.reduce((best,row)=>!best||cmColorDistance(value,row.hex)<cmColorDistance(value,best.hex)?row:best,null)}
function cmRenderColorPresets(target,{value=CM_GOOGLE_DEFAULT,colorId=null,touched=false,label='일정 색상'}={}){
  const box=typeof target==='string'?document.querySelector(target):target;if(!box)return null;
  const presets=cmColorPalette(),exact=colorId?presets.find(row=>row.id===String(colorId)):null,selected=exact||cmNearestColor(value,presets)||presets[0];
  box.classList.add('calendar-color-presets');box.setAttribute('role','radiogroup');box.setAttribute('aria-label',label);box.dataset.colorTouched=touched?'1':'0';box.dataset.originalColor=value||'';box.dataset.originalColorId=colorId||'';
  const buttons=presets.map((row,index)=>{const b=document.createElement('button');b.type='button';b.className='calendar-color-swatch';b.setAttribute('role','radio');b.dataset.colorHex=row.hex;if(row.id)b.dataset.colorId=row.id;b.style.backgroundColor=row.hex;b.title=row.id?'Google Calendar 색상 '+row.id:'일정 색상 '+(index+1);b.setAttribute('aria-label',b.title);return b});
  const choose=(button,emit)=>{buttons.forEach(b=>{const on=b===button;b.classList.toggle('selected',on);b.setAttribute('aria-checked',on?'true':'false');b.tabIndex=on?0:-1});box.dataset.selectedColor=button?.dataset.colorHex||selected?.hex||CM_GOOGLE_DEFAULT;box.dataset.selectedColorId=button?.dataset.colorId||'';if(emit)box.dataset.colorTouched='1'};
  buttons.forEach((b,index)=>{b.addEventListener('click',()=>choose(b,true));b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const delta=['ArrowRight','ArrowDown'].includes(e.key)?1:-1,next=buttons[(index+delta+buttons.length)%buttons.length];next.focus();choose(next,true)})});
  box.replaceChildren(...buttons);choose(buttons.find(b=>selected?.id&&b.dataset.colorId===selected.id)||buttons.find(b=>b.dataset.colorHex===selected?.hex)||buttons[0],false);return selected
}
function cmColorValue(target){const box=typeof target==='string'?document.querySelector(target):target;return box?{hex:box.dataset.selectedColor||CM_GOOGLE_DEFAULT,id:box.dataset.selectedColorId||null,touched:box.dataset.colorTouched==='1'}:{hex:CM_GOOGLE_DEFAULT,id:null,touched:false}}
window.KPTUCalendarColors={palette:cmColorPalette,nearest:cmNearestColor,render:cmRenderColorPresets,value:cmColorValue};
function cmRuntime(){const rt=window.KPTURuntime;if(!rt?.session||!rt?.api)throw new Error('앱 런타임을 불러오지 못했습니다.');return rt}
async function cmGoogleCall(action,{method='GET',body=null,params=null,expectedSessionEpoch=null}={}){const rt=cmRuntime();if(!(await rt.session.ensure()))throw new Error('로그인이 필요합니다.');const u=new URL(rt.config.url+'/functions/v1/google-calendar');if(action)u.searchParams.set('action',action);if(params)Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v)));const d=await rt.api(u.toString(),{method,body,expectedSessionEpoch});if(d?.error)throw new Error(d.error||'Google Calendar 요청 실패');return d}
function cmToast(msg){const t=document.querySelector('#toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');clearTimeout(cmToast.t);cmToast.t=setTimeout(()=>t.classList.add('hidden'),2400)}
function cmCloseModal(){cmFormEpoch++;cmRequest=null;cmSavePending=false;const m=document.querySelector('#eventModal');if(m){m.classList.add('hidden');m.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate(m,{restoreFocus:true,fallbackFocus:'#calendarView h2'})}}
function cmStatus(msg,err=false){const e=document.querySelector('#eventStatus');if(e){e.textContent=msg||'';e.className='status'+(err?' error':'');if(err){e.setAttribute('role','alert');e.removeAttribute('aria-live')}else{e.setAttribute('role','status');e.setAttribute('aria-live','polite')}}}
function cmSetBusy(value){document.querySelectorAll('[data-event-mode],#eventTaskProject').forEach(b=>b.disabled=!!value);const b=document.querySelector('#saveEventBtn');if(!b)return;b.disabled=!!value;if(value)b.setAttribute('aria-busy','true');else b.removeAttribute('aria-busy')}
function cmInjectControls(){const bar=document.querySelector('#googleCalendarControls');if(bar)bar.querySelectorAll('#showTeamCalendar,#showGoogleCalendar,#showPersonalCalendar').forEach(x=>x.closest('label')?.remove())}
async function cmGoogleState(){if(window.__KPTU_GOOGLE_STATE__?.connected){cmGoogle=window.__KPTU_GOOGLE_STATE__;return cmGoogle}try{cmGoogle=await cmGoogleCall('status');window.__KPTU_GOOGLE_STATE__=cmGoogle;return cmGoogle}catch{return null}}
async function cmPopulateGoogleCalendars(){const seq=cmFormEpoch,owner=cmRuntime().session.read()?.user?.id,epoch=cmRuntime().session.epoch();const sel=document.querySelector('#eventGoogleCalendar');if(!sel)return;sel.innerHTML='<option>불러오는 중…</option>';const s=await cmGoogleState();if(seq!==cmFormEpoch||owner!==cmRuntime().session.read()?.user?.id||epoch!==cmRuntime().session.epoch())return;if(!s?.connected){sel.innerHTML='<option value="">Google Calendar 연결 필요</option>';if(cmMode==='event')cmStatus('Google Calendar에 저장하려면 먼저 연결해 주세요.',true);return}const cals=s.calendars||[];sel.innerHTML=cals.map(c=>{const writable=['owner','writer'].includes(c.accessRole||'owner');return `<option value="${String(c.id).replace(/"/g,'&quot;')}" ${writable?'':'disabled'}>${String(c.summary||c.id).replace(/[&<>]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[x]))}${c.primary?' (기본)':''}${writable?'':' · 읽기 전용'}</option>`}).join('')||'<option value="">사용 가능한 캘린더 없음</option>';const named=cals.filter(c=>c.summary==='공공운수노조'&&['owner','writer'].includes(c.accessRole||'owner'));const preferred=(named.length===1?[...sel.options].find(o=>o.value===named[0].id&&!o.disabled):null)||[...sel.options].find(o=>!o.disabled&&s.selected?.includes(o.value))||[...sel.options].find(o=>!o.disabled&&o.value);if(preferred)sel.value=preferred.value;cmGoogleCalendarChanged()}
function cmGoogleCalendarChanged(){const id=document.querySelector('#eventGoogleCalendar')?.value,s=cmGoogle||window.__KPTU_GOOGLE_STATE__,c=s?.calendars?.find(x=>x.id===id),custom=s?.colors?.[id];cmRenderColorPresets('#eventGoogleColor',{value:custom||c?.backgroundColor||CM_GOOGLE_DEFAULT,label:'Google 일정 색상'})}
function cmToggleAllDay(){const allDay=!!document.querySelector('#eventAllDay')?.checked;document.querySelectorAll('.event-time-row').forEach(x=>x.classList.toggle('hidden',allDay))}
function cmPaintMode(){
  const task=cmMode==='task',modal=document.querySelector('#eventModal');modal.dataset.mode=cmMode;
  document.querySelector('#eventModalTitle').textContent=task?'할 일 등록':'일정 등록';document.querySelector('#eventDateLabel').textContent=task?'날짜 (선택)':'시작 날짜';
  modal.querySelectorAll('[data-event-mode]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.eventMode===cmMode));b.disabled=cmSavePending;});
  modal.querySelectorAll('[data-event-only]').forEach(el=>el.hidden=task);document.querySelector('#eventGoogleOptions').hidden=task;document.querySelector('#eventTaskOptions').hidden=!task;
  const org=document.querySelector('#soEventOrganizations');if(org)org.hidden=task;
}
let cmFormOwner=window.KPTURuntime.context.read()?.user?.id;
const cmProjectButton=()=>document.querySelector('#eventTaskProject');
function cmPaintProject(){const b=cmProjectButton();if(b){const name=document.createElement('span');name.textContent=(cmProjectRows.find(x=>x.project.id===cmProject)?.project.name||'프로젝트')+' ▾';b.replaceChildren(name);b.setAttribute('aria-label',cmProject?'프로젝트: '+b.textContent.slice(0,-2):'프로젝트');}}
const cmProjectPicker=createChoiceSheet({id:'eventProjectSheet',titleId:'eventProjectSheetTitle',historyKey:'kptuEventProjectChoice',
  canOpen:()=>cmMode==='task'&&!cmSavePending&&!document.querySelector('#eventModal')?.classList.contains('hidden'),
  choices:async()=>{const ctx=window.KPTURuntime.context.read(),snap=await window.KPTUProjectCatalog.load({workspaceId:ctx.workspaceId,userId:ctx.user.id});cmProjectRows=snap.tree.filter(x=>x.project.status==='active');if(!cmProjectRows.some(x=>x.project.id===cmProject))cmProject='';cmPaintProject();},
  render:()=>({title:'프로젝트 선택',html:projectRows(cmProjectRows,cmProject,cmEsc)}),onSelect:(_,value)=>{cmProject=value;cmPaintProject();},onError:e=>cmStatus(e.message||'프로젝트 목록을 불러오지 못했습니다.',true)
});
window.addEventListener('kptu:session-changed',()=>{const nextOwner=window.KPTURuntime.context.read()?.user?.id;if(nextOwner===cmFormOwner)return;cmFormOwner=nextOwner;cmProjectPicker.dismiss();cmProject='';cmProjectRows=[];cmFormEpoch++;cmRequest=null;cmSaved=null;cmAttempts.clear();cmSavePending=false;cmSetBusy(false);cmPaintProject();});
window.addEventListener('kptu:view-changed',()=>cmProjectPicker.dismiss());
const cmOwner=()=>cmRuntime().session.read()?.user?.id||'';
const cmSession=()=>cmRuntime().session.epoch();
const cmCall=(r,path,options={})=>cmRuntime().api(path,{...options,expectedSessionEpoch:r.epoch});
const cmSameSession=r=>r.owner===cmOwner()&&r.epoch===cmSession();
const cmActive=r=>cmSameSession(r)&&cmRequest===r&&r.seq===cmFormEpoch&&!document.querySelector('#eventModal').classList.contains('hidden');
function cmSnapshot(){return JSON.stringify([cmMode,cmProject,...['eventTitle','eventStartDate','eventStartTime','eventEndDate','eventEndTime','eventDescription','eventLocation','eventGoogleCalendar'].map(id=>document.getElementById(id)?.value||''),document.getElementById('eventAllDay')?.checked,cmColorValue('#eventGoogleColor'),window.__KPTU_SELECTED_EVENT_ORGS__?.()||[]])}
function cmTaskLinks(d){if(!Array.isArray(d?.links)||(d.meeting_links!=null&&!Array.isArray(d.meeting_links)))throw new Error('연결 저장 결과를 확인하지 못했습니다.');return [...d.links,...(d.meeting_links||[])].filter(l=>!l.status||l.status==='confirmed')}
function cmUnknownNotice(kind,message){
  cmStatus(message,true);const b=document.createElement('button');b.type='button';b.className='mini';b.textContent='목록에서 저장 결과 확인';b.onclick=()=>cmRecover(kind);document.querySelector('#eventStatus').append(document.createTextNode(' '),b);
}
async function cmRecover(kind){
  const attempt=cmAttempts.get(kind),seq=cmFormEpoch,owner=cmOwner(),epoch=cmSession();
  const active=()=>seq===cmFormEpoch&&owner===cmOwner()&&epoch===cmSession()&&!document.querySelector('#eventModal').classList.contains('hidden');
  if(!attempt||attempt.pending||attempt.owner!==owner||attempt.epoch!==epoch)return;
  cmStatus('저장 결과를 불러오는 중…');
  try{
    let rows=[];
    if(kind==='task'){
      const d=await cmRuntime().api('/functions/v1/google-tasks?action=overview&pending_scope=all',{singleFlight:false,expectedSessionEpoch:epoch});if(!active())return;
      if(!Array.isArray(d?.tasks)||d.authorized===false||d.connected===false)throw new Error('할 일 목록을 확인하지 못했습니다.');rows=d.tasks;
    }else{
      const body=attempt.body,start=Date.parse(body.start_iso||body.start_date),end=Date.parse(body.end_iso||body.end_date);
      const d=await cmGoogleCall('events',{expectedSessionEpoch:epoch,params:{timeMin:new Date(start-86400000).toISOString(),timeMax:new Date(end+2*86400000).toISOString()}});if(!active())return;
      if(!Array.isArray(d?.events))throw new Error('일정 목록을 확인하지 못했습니다.');rows=d.events.filter(e=>e.calendarId===body.calendar_id);
    }
    if(attempt.record)rows=rows.filter(x=>x.id===attempt.record.id);
    cmStatus('저장된 항목을 직접 골라 주세요. 같은 제목만으로 저장됐다고 판단하지 않습니다.');
    if(!rows.length)return cmUnknownNotice(kind,'목록에서 결과를 찾지 못했습니다. Google에서 먼저 확인해 주세요. 새로 만들지 않았습니다.');
    for(const row of rows.filter(x=>typeof x.id==='string'&&x.id)){
      const button=document.createElement('button');button.type='button';button.className='mini';button.textContent=(row.title||'제목 없음')+' · 이 항목에 이어서 저장';
      button.onclick=async()=>{button.disabled=true;try{
        const result=kind==='task'?await cmRuntime().api('/functions/v1/google-tasks?action=links&task_id='+encodeURIComponent(row.id),{singleFlight:false,expectedSessionEpoch:epoch}):await cmGoogleCall('event',{expectedSessionEpoch:epoch,params:{eventId:row.id,calendarId:row.calendarId}});if(!active())return;
        if(kind==='event'&&result?.event?.id!==row.id)throw new Error('일정 결과를 확인하지 못했습니다.');
        cmSaved={kind,record:kind==='task'?row:result.event,body:null,links:kind==='task'?cmTaskLinks(result):[],managedProject:attempt.body.links?.[0]?.project_id||'',unknown:false};cmAttempts.delete(kind);cmStatus('고른 항목에 이어서 저장합니다. 입력을 확인한 뒤 저장해 주세요.');
      }catch(e){if(active())cmUnknownNotice(kind,e.message||String(e))}};
      document.querySelector('#eventStatus').append(document.createTextNode(' '),button);
    }
  }catch(e){if(active())cmUnknownNotice(kind,e.message||String(e))}
}
async function cmSaveTask(){
  if(cmSavePending)return false;
  const title=document.querySelector('#eventTitle').value.trim();if(!title){cmStatus('제목을 입력해 주세요.',true);return false}
  const owner=cmOwner(),epoch=cmSession();if(!owner){cmStatus('로그인이 필요합니다.',true);return false}
  const prior=cmAttempts.get('task');if(!cmSaved&&prior?.owner===owner&&prior.epoch===epoch){if(prior.pending)cmStatus('앞선 할 일을 저장 중입니다. 결과를 기다려 주세요.');else cmUnknownNotice('task','앞선 할 일의 저장 결과를 확인해 주세요. 새로 만들지 않았습니다.');return false}
  const body={title,due:document.querySelector('#eventStartDate').value||null,links:cmProject?[{project_id:cmProject}]:[],notes:document.querySelector('#eventDescription').value};
  const r={owner,epoch,seq:cmFormEpoch,snapshot:cmSnapshot()},rt=cmRuntime();cmRequest=r;cmSavePending=true;cmSetBusy(true);cmPaintMode();cmStatus('할 일 저장 중…');let attempt=null,stage='body';
  try{
    if(cmSaved?.kind==='task'&&cmSaved.unknown){
      if(cmSaved.unknown==='body'){const d=await cmCall(r,'/functions/v1/google-tasks?action=overview&pending_scope=all',{singleFlight:false});if(!cmActive(r))return false;const t=d?.tasks?.find(t=>t.id===cmSaved.record.id);if(!t)throw new Error('앞선 할 일 저장을 확인하지 못했습니다.');cmSaved.body={title:t.title||'',notes:t.notes||'',due:t.due?String(t.due).slice(0,10):null,links:cmSaved.body?.links||[]}}
      const d=await cmCall(r,'/functions/v1/google-tasks?action=links&task_id='+encodeURIComponent(cmSaved.record.id),{singleFlight:false});if(!cmActive(r))return false;cmSaved.links=cmTaskLinks(d);cmSaved.unknown=false;
    }
    const fields=x=>JSON.stringify([x?.title,x?.due||null,x?.notes||'']);
    if(!cmSaved||fields(body)!==fields(cmSaved.body)){
      if(!cmActive(r))return false;
      if(!cmSaved){attempt={owner,epoch,body,pending:true};cmAttempts.set('task',attempt)}
      const d=cmSaved?await cmCall(r,'/functions/v1/google-tasks?action=update',{method:'POST',body:{action:'update',task_id:cmSaved.record.id,task_list_id:cmSaved.record.taskListId||'@default',...body}}):await createGoogleTask(body,{api:(path,options)=>cmCall(r,path,options)});
      if(attempt){attempt.pending=false;if(d?.ok===true&&d.task?.id)attempt.record=d.task}
      if(!cmActive(r)){if(attempt&&cmSameSession(r)&&d?.ok===true&&d.task?.id&&!d.link_error)cmAttempts.delete('task');return false}
      if(d?.ok!==true||typeof d.task?.id!=='string'||!d.task.id||(cmSaved&&d.task.id!==cmSaved.record.id))throw new Error('할 일 저장 결과를 확인하지 못했습니다.');
      if(!cmSaved)cmSaved={kind:'task',record:d.task,body,links:cmTaskLinks(d),managedProject:body.links[0]?.project_id||'',unknown:false};else{cmSaved.record=d.task;cmSaved.body=body}
      if(d.link_error){stage='links';const links=await cmCall(r,'/functions/v1/google-tasks?action=links&task_id='+encodeURIComponent(cmSaved.record.id),{singleFlight:false});if(!cmActive(r))return false;cmSaved.links=cmTaskLinks(links);cmStatus('할 일은 저장했습니다. 프로젝트 연결을 확인한 뒤 저장해 주세요.',true);return false}
    }
    if(!cmActive(r))return false;
    stage='links';const next=body.links[0]?.project_id||'',previous=cmSaved.managedProject;
    if(next&&!cmSaved.links.some(l=>l.project_id===next)){const d=await cmCall(r,'/functions/v1/google-tasks?action=link',{method:'POST',body:{action:'link',task_id:cmSaved.record.id,links:[{project_id:next}]}});if(!cmActive(r))return false;if(d?.ok!==true)throw new Error('연결 결과를 확인하지 못했습니다.');cmSaved.links=cmTaskLinks(d)}
    if(previous&&previous!==next&&cmSaved.links.some(l=>l.project_id===previous)){const d=await cmCall(r,'/functions/v1/google-tasks?action=unlink',{method:'POST',body:{action:'unlink',task_id:cmSaved.record.id,links:[{project_id:previous}]}});if(!cmActive(r))return false;if(d?.ok!==true)throw new Error('연결 결과를 확인하지 못했습니다.');cmSaved.links=cmTaskLinks(d)}
    if(next&&!cmSaved.links.some(l=>l.project_id===next)||previous&&previous!==next&&cmSaved.links.some(l=>l.project_id===previous))throw new Error('연결 결과가 선택과 다릅니다.');
    cmSaved.managedProject=next;cmAttempts.delete('task');window.KPTUGoogleTasks?.invalidateAfterCreate();window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed'));
    if(!cmActive(r))return false;
    if(r.snapshot===cmSnapshot()){cmCloseModal();cmToast('할 일을 추가했습니다.')}else cmStatus('보낸 내용은 저장했습니다. 이후 수정한 내용은 아직 저장하지 않았습니다.');return true;
  }catch(e){
    if(attempt)attempt.pending=false;if(!cmActive(r))return false;
    const scope=/TASKS_SCOPE_REQUIRED|권한/.test(String(e.message||''));
    if(cmSaved){cmSaved.unknown=stage; if(stage==='links'){try{const d=await cmCall(r,'/functions/v1/google-tasks?action=links&task_id='+encodeURIComponent(cmSaved.record.id),{singleFlight:false});if(!cmActive(r))return false;cmSaved.links=cmTaskLinks(d);cmSaved.unknown=false}catch{}}if(!cmActive(r))return false;cmStatus((stage==='links'?'할 일은 저장했습니다. 연결 결과를 확인해 주세요. ':'저장 결과를 확인하지 못했습니다. ')+(e.message||String(e)),true)}
    else if(scope){if(cmAttempts.get('task')===attempt)cmAttempts.delete('task');cmStatus('Google 할 일 권한을 다시 연결해 주세요. 입력은 유지했습니다.',true)}
    else cmUnknownNotice('task','저장 결과를 확인하지 못했습니다. 입력은 유지했습니다. '+(e.message||String(e)));return false;
  }finally{if(cmRequest===r){cmRequest=null;cmSavePending=false;if(cmSameSession(r)&&r.seq===cmFormEpoch){cmSetBusy(false);cmPaintMode()}}}
}
function cmForm(){const title=document.querySelector('#eventTitle')?.value.trim(),allDay=!!document.querySelector('#eventAllDay')?.checked,startDate=document.querySelector('#eventStartDate')?.value,endDate=document.querySelector('#eventEndDate')?.value||startDate;if(!title)throw new Error('제목을 입력해 주세요.');if(!startDate||!endDate)throw new Error('시작·종료 날짜를 입력해 주세요.');const f={title,allDay,startDate,endDate,memo:document.querySelector('#eventDescription')?.value||'',location:document.querySelector('#eventLocation')?.value||'',color_hex:cmColorValue('#eventGoogleColor').hex};if(!allDay){const st=document.querySelector('#eventStartTime')?.value,et=document.querySelector('#eventEndTime')?.value;if(!st||!et)throw new Error('시작·종료 시간을 입력해 주세요.');const start=new Date(toSeoulISO(startDate+'T'+st)),end=new Date(toSeoulISO(endDate+'T'+et));if(end<=start)throw new Error('종료시간은 시작시간보다 뒤여야 합니다.');f.start_iso=start.toISOString();f.end_iso=end.toISOString()}return f}
async function cmSaveGoogle(){
  if(cmMode==='task')return cmSaveTask();if(cmSavePending)return false;
  let body;
  try{const f=cmForm(),calendar=document.querySelector('#eventGoogleCalendar').value;if(!calendar)throw new Error('Google 세부 캘린더를 선택해 주세요.');body={action:cmSaved?.kind==='event'?'update-event':'create-event',calendar_id:cmSaved?.kind==='event'?cmSaved.record.calendarId:calendar,...(cmSaved?.kind==='event'?{event_id:cmSaved.record.id}:{}),title:f.title,memo:f.memo,location:f.location,color_hex:f.color_hex,all_day:f.allDay,organization_ids:[...(window.__KPTU_SELECTED_EVENT_ORGS__?.()||[])]};if(cmSaved?.kind==='event'&&calendar!==cmSaved.record.calendarId)body.target_calendar_id=calendar;if(f.allDay){body.start_date=f.startDate;body.end_date=f.endDate}else{body.start_iso=f.start_iso;body.end_iso=f.end_iso}}catch(e){cmStatus(e.message||String(e),true);return false}
  const r={owner:cmOwner(),epoch:cmSession(),seq:cmFormEpoch,snapshot:cmSnapshot(),selected:document.querySelector('#eventGoogleCalendar').value};if(!r.owner){cmStatus('로그인이 필요합니다.',true);return false}
  const prior=cmAttempts.get('event');if(!cmSaved&&prior?.owner===r.owner&&prior.epoch===r.epoch){if(prior.pending)cmStatus('앞선 일정을 저장 중입니다. 결과를 기다려 주세요.');else cmUnknownNotice('event','앞선 일정의 저장 결과를 확인해 주세요. 새로 만들지 않았습니다.');return false}
  const button=document.querySelector('#saveEventBtn'),label=button.textContent;cmRequest=r;cmSavePending=true;cmSetBusy(true);button.textContent='저장 중…';cmStatus('Google Calendar에 저장 중…');let attempt=null;
  try{
    if(cmSaved?.unknown){
      const address=cmSaved.pendingAddress||{source:cmSaved.record.calendarId,target:null};let d;
      if(address.target){try{d=await cmGoogleCall('event',{expectedSessionEpoch:r.epoch,params:{eventId:cmSaved.record.id,calendarId:address.target}})}catch(e){if(!cmActive(r))return false;if(e?.status!==400&&e?.status!==404)throw e}}
      if(!cmActive(r))return false;
      if(!d)d=await cmGoogleCall('event',{expectedSessionEpoch:r.epoch,params:{eventId:cmSaved.record.id,calendarId:address.source}});
      if(!cmActive(r))return false;
      if(d?.event?.id!==cmSaved.record.id||![address.source,address.target].filter(Boolean).includes(d.event.calendarId))throw new Error('앞선 일정 저장을 확인하지 못했습니다.');
      cmSaved.record=d.event;cmSaved.unknown=false;delete cmSaved.pendingAddress;
      cmStatus('앞선 저장의 위치를 확인했습니다. 입력을 확인한 뒤 다시 저장해 주세요.');return false;
    }
    if(!cmSaved){attempt={owner:r.owner,epoch:r.epoch,body,pending:true};cmAttempts.set('event',attempt)}
    const d=await cmGoogleCall('',{method:'POST',body,expectedSessionEpoch:r.epoch});if(attempt){attempt.pending=false;if(d?.ok===true&&d.event?.id)attempt.record=d.event}
    if(!cmActive(r)){if(attempt&&cmSameSession(r)&&d?.ok===true&&d.event?.id)cmAttempts.delete('event');return false}
    const destination=body.target_calendar_id||body.calendar_id;
    if(typeof d.event?.id!=='string'||!d.event.id||(body.event_id&&d.event.id!==body.event_id)||d.event.calendarId!==destination)throw new Error('일정 저장 결과를 확인하지 못했습니다.');
    if(d.partial_failure&&d.moved){
      cmSaved={kind:'event',record:d.event,body:null,unknown:false};let readFailed=false;
      try{const fresh=await cmGoogleCall('event',{expectedSessionEpoch:r.epoch,params:{eventId:d.event.id,calendarId:destination}});if(!cmActive(r))return false;if(fresh?.event?.id!==d.event.id||fresh.event.calendarId!==destination)throw new Error('이동한 일정 조회 결과를 확인하지 못했습니다.');cmSaved.record=fresh.event}catch{if(!cmActive(r))return false;readFailed=true}
      if(!cmActive(r))return false;
      cmStatus((d.message||'일정은 옮겨졌지만 일부 저장을 확인하지 못했습니다.')+(readFailed?' 최신 조회도 실패했습니다. 확인된 이동 위치와 수정 입력은 유지했습니다.':' 수정 입력은 유지했습니다. 확인한 뒤 저장해 주세요.'),true);
      try{await window.__KPTU_RELOAD_GOOGLE_EVENTS__?.()}catch{}return false;
    }
    if(d.ok!==true)throw new Error(d.message||'일정 저장 결과를 확인하지 못했습니다.');
    cmSaved={kind:'event',record:d.event,body,unknown:false};cmAttempts.delete('event');
    if(d.event.location!==body.location){cmStatus('일정은 저장했습니다. 장소 저장은 확인하지 못했습니다. 장소와 수정 입력은 유지했습니다. 확인한 뒤 다시 저장해 주세요.',true);try{await window.__KPTU_RELOAD_GOOGLE_EVENTS__?.()}catch{}return false}
    const unchanged=r.snapshot===cmSnapshot();if(unchanged){cmSetBusy(false);button.textContent=label;cmCloseModal()}else cmStatus('보낸 내용은 저장했습니다. 이후 수정한 내용은 아직 저장하지 않았습니다.');
    try{await window.__KPTU_RELOAD_GOOGLE_EVENTS__?.()}catch{if(cmSameSession(r)&&unchanged&&r.seq+1===cmFormEpoch)cmToast('일정은 저장했습니다. 목록을 새로고침해 주세요.');return true}
    if(cmSameSession(r)&&unchanged&&r.seq+1===cmFormEpoch)cmToast('Google Calendar에 저장했습니다.');return true;
  }catch(e){if(attempt)attempt.pending=false;if(!cmActive(r))return false;if(cmSaved){cmSaved.unknown=true;cmSaved.pendingAddress={source:body.calendar_id,target:body.target_calendar_id||null};cmStatus('저장 결과를 확인하지 못했습니다. 입력은 유지했습니다. '+(e.message||String(e)),true)}else if(/권한|연결되지|재인증/.test(String(e.message||''))){if(cmAttempts.get('event')===attempt)cmAttempts.delete('event');cmStatus(e.message||String(e),true)}else cmUnknownNotice('event','저장 결과를 확인하지 못했습니다. 입력은 유지했습니다. '+(e.message||String(e)));return false}
  finally{if(cmRequest===r){cmRequest=null;cmSavePending=false;if(cmSameSession(r)&&r.seq===cmFormEpoch){cmSetBusy(false);button.textContent=label}}}
}
async function cmPrepareNewEvent(){cmFormEpoch++;cmRequest=null;cmSaved=null;cmSavePending=false;cmSetBusy(false);document.querySelector('#saveEventBtn').textContent='저장';cmMode='event';cmProject='';cmPaintMode();cmPaintProject();cmStatus('');cmToggleAllDay();await cmPopulateGoogleCalendars()}
function cmBindCreate(){const modal=document.querySelector('#eventModal');window.addEventListener('kptu:dialog-closed',e=>{if(e.detail?.modal===modal&&cmRequest){cmFormEpoch++;cmRequest=null;cmSavePending=false}});const allDay=document.querySelector('#eventAllDay'),calendar=document.querySelector('#eventGoogleCalendar'),btn=document.querySelector('#saveEventBtn');if(!allDay||!btn)return false;document.querySelectorAll('[data-event-mode]').forEach(b=>b.onclick=()=>{if(cmSavePending)return;if(cmSaved||cmAttempts.has(cmMode==='task'?'task':'event')){cmStatus('현재 항목의 저장 결과를 먼저 확인해 주세요. 입력은 유지했습니다.',true);return}cmMode=b.dataset.eventMode;cmPaintMode();cmStatus('');});cmProjectButton().onclick=()=>void cmProjectPicker.open('project',cmProjectButton());allDay.addEventListener('change',cmToggleAllDay);calendar?.addEventListener('change',cmGoogleCalendarChanged);btn.onclick=e=>{e?.preventDefault?.();return cmSaveGoogle()};return true}
async function cmInit(){if(!document.querySelector('#calendarView'))return false;cmInjectControls();cmBindCreate();return true}
window.KPTUCalendarPlus={paint:()=>{},refresh:async()=>true,prepareNewEvent:cmPrepareNewEvent,saveGoogle:cmSaveGoogle,savePrefs:()=>{}};
window.__KPTU_CALENDAR_PLUS_READY__=cmInit().catch(e=>{console.warn('calendar plus init',e);return false});
