import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {renderFilterChips} from './filter-chips.js';
import {formatMeetingTime,toMeetingISO,seoulParts,seoulDate,seoulDateKey,seoulClock} from './meeting-time.js';
import './time-input.js';
import {fileLine,bindDropTarget,dueText} from './meeting-compact.js';
import {readTextLater} from './document-text-read.js'; // SEARCH ②: 올린 회의자료 파일 안 글자를 서버가 한 번 읽어 둠
import {PC_QUERY,NONE_KEY,sortRecentFirst,MEETING_DOCS_LABEL,meetingColumns,columnsHtml,listHtml,pickMeeting,resultHtml,tasksHtml,assignMeetingColors,meetingPaletteColor,nameHash,MEETING_HUES,roundLabel,hasRound,meetingShortName} from './meeting-columns.js';
import {formatMeetingWhen} from './meeting-when.js';
import {ALL_KINDS,DEFAULT_KIND,REPORT_KINDS,isReportKind,reportKindOf,reportKindLabel,reportKindChips,filterByReportKind} from './report-kinds.mjs';
import {pickReportKind,saveReportKind} from './report-kind-sheet.js';
import {placeAnchored,followAnchor,clearAnchored} from './anchored-popup.js';
import {mountSplitResize} from './split-resize.js';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const SESSION_KEY='kptu_collab_session_v1';
const GOOGLE_FN=SB+'/functions/v1/google-calendar';
const STATUS_LABEL={draft:'초안',review:'검토중',published:'게시',archived:'보관'};
let session=null,user=null,membership=null,workspace=null;
let members=[],profiles=[],spaces=[],events=[],meetings=[],documents=[];
const teamViewFlights=new Map(),teamViewLoaded=new Set();
let meetingSavePending=false,documentSavePending=false;
let meetingUploadEntries=[];
window.addEventListener('kptu:before-reload',event=>{if(meetingUploadEntries.some(entry=>entry.kind!=='success')&&!document.querySelector('#meetingModal')?.classList.contains('hidden'))event.detail.otherDraft=true});
let monthCursor=seoulDate(seoulParts().year,seoulParts().month);
let googleState={connected:null,enabled:false,selected:[],calendars:[],events:[],email:null};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
const fmt=formatMeetingTime;
const dateKey=seoulDateKey;
const todayKey=()=>dateKey(new Date());
function setStatus(el,msg,type=''){if(!el)return;el.textContent=msg||'';el.className='status'+(type?' '+type:'');if(type==='error'){el.setAttribute('role','alert');el.removeAttribute('aria-live')}else{el.setAttribute('role','status');el.setAttribute('aria-live','polite')}}
function setBusy(button,busy){if(!button)return;button.disabled=!!busy;if(busy)button.setAttribute('aria-busy','true');else button.removeAttribute('aria-busy')}
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.add('hidden'),2600)}
function saveSession(s){session=s;if(window.KPTURuntime?.session){window.KPTURuntime.session.write(s);return}if(s)localStorage.setItem(SESSION_KEY,JSON.stringify(s));else localStorage.removeItem(SESSION_KEY)}
function loadSession(){if(window.KPTURuntime?.session)return window.KPTURuntime.session.read();try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
async function refreshSession(){if(window.KPTURuntime?.session){const next=await window.KPTURuntime.session.refresh();session=next||null;return !!next}if(!session?.refresh_token)return false;const r=await fetch(SB+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});if(!r.ok){saveSession(null);return false}const d=await r.json();d.expires_at=d.expires_at||Math.floor(Date.now()/1000)+(d.expires_in||3600);saveSession(d);return true}
async function ensureSession(){if(window.KPTURuntime?.session){const ok=await window.KPTURuntime.session.ensure();session=window.KPTURuntime.session.read();return ok}if(!session)return false;if((session.expires_at||0)<Math.floor(Date.now()/1000)+60)return refreshSession();return true}
async function api(path,{method='GET',body=null,auth=true,prefer=''}={}){if(auth&&!(await ensureSession()))throw new Error('로그인이 필요합니다.');const isForm=typeof FormData!=='undefined'&&body instanceof FormData;const headers={apikey:KEY};if(!isForm)headers['Content-Type']='application/json';headers.Authorization='Bearer '+(auth?session.access_token:KEY);if(prefer)headers.Prefer=prefer;const started=performance.now();let r;
try{
  r=await fetch(SB+path,{method,headers,body:body===null?null:(isForm?body:JSON.stringify(body))});
  window.__KPTU_STARTUP__?.request?.(SB+path,performance.now()-started,r.status);
}catch(e){
  window.__KPTU_STARTUP__?.request?.(SB+path,performance.now()-started,0);
  throw e;
}const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.error_description||data?.hint||('요청 실패 '+r.status));return data}
async function rpc(name,payload={}){return api('/rest/v1/rpc/'+name,{method:'POST',body:payload})}
async function getUser(){return api('/auth/v1/user')}
function userFromSession(){
  if(session?.user?.id)return session.user;
  try{
    const token=String(session?.access_token||''),part=token.split('.')[1];
    if(!part)return null;
    const b64=part.replace(/-/g,'+').replace(/_/g,'/');
    const padded=b64+'='.repeat((4-b64.length%4)%4);
    const payload=JSON.parse(decodeURIComponent(atob(padded).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join('')));
    if(!payload?.sub)return null;
    return {id:payload.sub,email:payload.email||'',role:payload.role||'authenticated',aud:payload.aud||'authenticated',app_metadata:payload.app_metadata||{},user_metadata:payload.user_metadata||{}};
  }catch{return null}
}
function projectName(id){return spaces.find(x=>x.id===id)?.name||''}
function projectOptions(includeBlank=true,selected=''){return window.KPTUProjectCatalog?.options(selected,includeBlank)||(includeBlank?'<option value="">프로젝트 없음</option>':'')}
function publishProjects(){if(window.KPTUProjectCatalog&&workspace?.id&&user?.id)window.KPTUProjectCatalog.publish({workspaceId:workspace.id,userId:user.id,spaces:spaces.filter(x=>x.owner_id===user.id)})}
function showOnly(id){document.body.classList.toggle('kptu-workspace-shell',id==='appView');['accessDeniedView','appView','bootView'].forEach(x=>{const el=$('#'+x);if(!el)return;const active=x===id;el.classList.toggle('hidden',!active);el.inert=!active;el.setAttribute('aria-hidden',active?'false':'true')})}
function showWorkspaceError(){const view=$('#bootView');if(!view)return;view.querySelector('h2').textContent='업무 공간을 열 수 없습니다.';view.querySelector('p').textContent='연결 상태를 확인한 뒤 다시 시도하거나 로그아웃해 주세요.';$('#bootErrorActions')?.classList.remove('hidden');showOnly('bootView')}
function enhanceDom(){
  const toolbar=$('#calendarView .calendar-toolbar');if(toolbar&&!$('#googleCalendarControls'))toolbar.insertAdjacentHTML('beforebegin',`<details id="googleCalendarPanel" class="calendar-google-panel"><summary><span>Google Calendar</span><span id="googleAccountLabel" class="updated"></span></summary><div id="googleCalendarControls" class="google-bar"><button id="googleConnectBtn" class="secondary" type="button">Google Calendar 연결</button></div><div id="googleCalendarList" class="google-cal-list hidden"></div></details>`);
}
async function logout(){try{if(session)await api('/auth/v1/logout',{method:'POST'})}catch{}saveSession(null);if(!window.KPTUAuthGate)location.replace('./login/')}
window.KPTUTeamAuth={logout};
function resetPrivateState(){reportChip=DEFAULT_KIND;meetingSelectedKind=null;meetingSelectedId=null;meetingTaskCache.clear();closeMeetingMenu();session=null;user=null;membership=null;workspace=null;members=[];profiles=[];spaces=[];events=[];meetings=[];documents=[];googleState={connected:null,enabled:false,selected:[],calendars:[],events:[],email:null};teamViewFlights.clear();teamViewLoaded.clear();window.__KPTU_BOOT_CONTEXT__=null;window.KPTURuntime?.context?.clear?.()}
window.__KPTU_RESET_PRIVATE_STATE__=resetPrivateState;
window.addEventListener('kptu:session-changed',e=>{const next=e.detail?.session?.user?.id||'';if(next&&next===user?.id)return;resetPrivateState();window.KPTUAuthGate?.lock?.()});
async function loadWorkspaceState(){user=userFromSession()||await getUser();const prefetched=window.__KPTU_BOOT_MEMBERSHIP_PROMISE__?await window.__KPTU_BOOT_MEMBERSHIP_PROMISE__:null;const ms=prefetched?.ok?prefetched.rows:await api('/rest/v1/app_workspace_members?user_id=eq.'+encodeURIComponent(user.id)+'&select=workspace_id,role,workspace:app_workspaces(id,slug,name)&limit=1');if(!ms?.length){showOnly('accessDeniedView');return}const row=ms[0];membership={workspace_id:row.workspace_id,role:row.role};workspace=Array.isArray(row.workspace)?row.workspace[0]:row.workspace;if(!workspace){const ws=await api('/rest/v1/app_workspaces?id=eq.'+membership.workspace_id+'&select=id,slug,name&limit=1');workspace=ws[0]}if(!workspace)throw new Error('웹2를 확인할 수 없습니다.');window.__KPTU_BOOT_CONTEXT__={user,membership,workspace};window.KPTURuntime?.context?.set?.(window.__KPTU_BOOT_CONTEXT__);window.__KPTU_STARTUP__?.mark('workspaceReady');showOnly('appView');if($('#workspaceName'))$('#workspaceName').textContent='웹2';const admin=['owner','admin'].includes(membership.role);$$('.admin-only').forEach(x=>x.classList.toggle('hidden',!admin));window.__KPTU_START_TEAM_DATA__=()=>window.__KPTU_TEAM_DATA_READY__||(window.__KPTU_TEAM_DATA_READY__=loadAll().then(()=>{renderAll();window.__KPTU_STARTUP__?.mark('teamDataReady');if(new URLSearchParams(location.search).get('google')==='connected'){history.replaceState({},'',location.pathname);return loadGoogleStatus(false)}}))}
async function loadAll(){const wid=workspace.id;[members,profiles,spaces,meetings,documents]=await Promise.all([
 api('/rest/v1/app_workspace_members?workspace_id=eq.'+wid+'&select=workspace_id,user_id,role,created_at'),
 api('/rest/v1/app_profiles?user_id=eq.'+encodeURIComponent(user.id)+'&select=user_id,display_name,created_at,updated_at'),
 api('/rest/v1/app_spaces?workspace_id=eq.'+wid+'&select=*&order=sort_order.asc,created_at.asc'),
 api('/rest/v1/app_meetings?workspace_id=eq.'+wid+'&select=*&order=meeting_at.desc'),
 api('/rest/v1/app_documents?workspace_id=eq.'+wid+'&select=*&order=document_date.desc.nullslast,created_at.desc')
])}
async function loadForView(view){
 if(!workspace?.id)return false;
 if(teamViewLoaded.has(view))return true;
 if(teamViewFlights.has(view))return teamViewFlights.get(view);
 const wid=workspace.id;
 const flight=(async()=>{
   if(view==='calendar'){
     spaces=await api('/rest/v1/app_spaces?workspace_id=eq.'+wid+'&select=*&order=sort_order.asc,created_at.asc');
     publishProjects();fillSelects();renderCalendar();
   }else if(view==='library'){
     spaces=await api('/rest/v1/app_spaces?workspace_id=eq.'+wid+'&select=*&order=sort_order.asc,created_at.asc');
     fillSelects();
   }else if(view==='meetings'){
     [spaces,meetings,documents]=await Promise.all([
       api('/rest/v1/app_spaces?workspace_id=eq.'+wid+'&select=*&order=sort_order.asc,created_at.asc'),
       api('/rest/v1/app_meetings?workspace_id=eq.'+wid+'&select=*&order=meeting_at.desc'),
       api('/rest/v1/app_documents?workspace_id=eq.'+wid+'&select=*&order=document_date.desc.nullslast,created_at.desc')
     ]);
     publishProjects();fillSelects();renderMeetings();
   }
   teamViewLoaded.add(view);
   return true;
 })().finally(()=>teamViewFlights.delete(view));
 teamViewFlights.set(view,flight);
 return flight
}
window.__KPTU_START_TEAM_VIEW__=view=>loadForView(view);
window.KPTUTeamData={
  spaces:()=>spaces,
  events:()=>events,
  meetings:()=>meetings,
  documents:()=>documents
};
window.__KPTU_EVENT_PROJECT_OPTIONS__=selected=>projectOptions(true,selected);
function renderAll(){fillSelects();renderHome();renderCalendar();renderDocuments();renderMeetings();renderPages()}
function fillSelects(){const po=projectOptions(true);['meetingProject'].forEach(id=>{if($('#'+id))$('#'+id).innerHTML=po})}
function renderHome(){}
function renderCalendar(){const y=seoulParts(monthCursor).year,m=seoulParts(monthCursor).month;$('#monthTitle').textContent=`${y}년 ${m+1}월`;(window.KPTUCalendarView||window.KPTUCalendarMonthView)?.render?.({year:y,month:m,googleEvents:googleState.events,googleState});renderGoogleControls();window.KPTUCalendarDayOverflow?.apply?.()}
window.__KPTU_RENDER_CALENDAR__=renderCalendar
function renderDocuments(){if(window.KPTULibrary?.render){window.KPTULibrary.render();return}const q=($('#documentSearch')?.value||'').trim().toLowerCase(),pid=$('#documentProject')?.value||'all';const rows=documents.filter(d=>(pid==='all'||d.project_id===pid)&&(!q||[d.title,d.source,d.category,(d.tags||[]).join(' ')].join(' ').toLowerCase().includes(q)));$('#documentList').innerHTML=rows.map(d=>`<article class="item-card"><div><div class="badges"><span class="badge">${esc(d.category)}</span>${d.project_id?`<span class="badge">${esc(projectName(d.project_id))}</span>`:''}</div><h3>${esc(d.title)}</h3><p>${esc(d.source||'출처 미기재')}${d.document_date?' · '+esc(d.document_date):''}</p>${d.description?`<small>${esc(d.description)}</small>`:''}</div>${d.drive_url?`<a class="mini" href="${esc(d.drive_url)}" target="_blank" rel="noopener">열기</a>`:''}</article>`).join('')||'<div class="empty">자료가 없습니다.</div>'}
function meetingName(m){return String(m?.series_name||m?.title||'').trim()}
function meetingNameKey(name){return String(name||'').replace(/\s+/g,'').toLowerCase()}
function meetingNameChoices(){const seen=new Set();return [...meetings].sort((a,b)=>new Date(b.meeting_at)-new Date(a.meeting_at)).map(meetingName).filter(name=>{const key=meetingNameKey(name);if(!key||seen.has(key))return false;seen.add(key);return true})}
function installMeetingNamePicker(input,prefix){if(document.querySelector(`#${prefix}NameSelect`))return;input.insertAdjacentHTML('beforebegin',`<select id="${prefix}NameSelect" aria-label="회의명 선택"></select>`);input.parentElement.insertAdjacentHTML('afterend',`<div id="${prefix}NameMatch" class="hidden" role="status"><span></span> <button id="${prefix}NameUseMatch" type="button" class="mini">이걸로</button></div>`)}
function setupMeetingNamePicker(select,input,match,use,{current='',onChoose=()=>{},onCustom=()=>{}}={}){
  const names=meetingNameChoices();select.replaceChildren();
  const add=(value,label)=>select.add(new Option(label,value));
  add('','회의명 선택');names.forEach(name=>add(name,name));add('__other__','기타(직접 입력)');
  const chosen=names.find(name=>name===current);
  select.value=chosen||'__other__';input.value=current;
  select.classList.toggle('hidden',!names.length);
  function update(){const custom=select.value==='__other__'||!names.length;input.classList.toggle('hidden',!custom);if(!custom)input.value=select.value;const equivalent=custom?names.find(name=>meetingNameKey(name)===meetingNameKey(input.value)&&name!==input.value.trim()):null;match.classList.toggle('hidden',!equivalent);match.querySelector('span').textContent=equivalent?`같은 회의가 있습니다: ${equivalent}`:'';use.onclick=()=>{select.value=equivalent;update()};if(custom)onCustom();else onChoose()}
  select.onchange=update;input.oninput=update;update();
}
// 다른 화면(자료실 회의 고르기 등)이 쓰는 회의 이름표도 회의 화면과 같은 차수·짧은 이름·회의 시각 규칙(MEET-결과정리 ①③).
function meetingDisplay(m){return {name:meetingName(m)||'회의명 미지정',meta:meetingRowMeta(m)}}
window.KPTUMeetingNames={installPicker:installMeetingNamePicker,setupPicker:setupMeetingNamePicker,label:m=>{const {name,meta}=meetingDisplay(m);return [name,...meta].join(' · ')}};
// MEET-결과정리 ②: 종류마다 서로 다른 색 칸(meeting-columns.js assignMeetingColors). 회의 목록이 바뀔 때만 다시 나눈다.
let meetingColorCache={source:null,slots:new Map()};
function meetingColor(name){const key=meetingNameKey(name);if(!key)return '#808080';if(meetingColorCache.source!==meetings)meetingColorCache={source:meetings,slots:assignMeetingColors(meetings,{nameOf:meetingName,keyOf:meetingNameKey})};const slot=meetingColorCache.slots.get(key);return meetingPaletteColor(slot??nameHash(key)%MEETING_HUES)}
// 회의 화면 목록 줄(폰·중간 폭)의 작은 글자: 차수(없으면 짧은 이름) · 회의 시각(①: 직접 지정 → 결과 글의 일시 → 날짜만).
function meetingRowMeta(m){return [hasRound(m)||meetingShortName(m)?roundLabel(m):null,formatMeetingWhen(m)].filter(Boolean)}
function renderMeetingTypeOptions(){const host=$('#meetingTypeFilter');if(!host)return;const types=[...new Set(filterByReportKind(meetings,DEFAULT_KIND).map(meetingName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));renderFilterChips(host,{label:'회의명',controls:'meetingList',value:host.value||'all',options:[{value:'all',label:'전체'},...types.map(name=>({value:name,label:name,color:meetingColor(name)})),{value:'__none__',label:'회의명 미지정',color:meetingColor('')}],onChange:renderMeetings})}
// UI-PC회의 → MEET-결과정리 ⑤ → MEET-결과3단: 회의 화면을 그리는 곳은 여기 하나다. PC(≥1024)는 왼쪽 회의 종류 / 가운데 차수·날짜·시간 /
// 오른쪽 고른 차수의 회의 결과(읽기용) 3단(meeting-columns.js), 폰·중간 폭은 지금 한 줄 목록. 고른 종류·차수는 이 화면이 열려 있는 동안만
// 기억한다(처음엔 가장 최근 결과가 있는 종류의 가장 최근 차수). 오른쪽 후속 할 일은 결과 창과 같은 읽기(google-tasks linked)로 따로 불러온다.
const meetingPc=window.matchMedia?.(PC_QUERY);
let meetingSelectedKind=null,meetingSelectedId=null;
const meetingTaskCache=new Map();let meetingTaskSeq=0;
// MTG-사업보고 4단계: 위쪽 칸 칩 줄(report-kinds.mjs). 고른 칩은 이 화면이 열려 있는 동안 기억하고 처음은 [회의](지금 기록은 모두 회의라 첫 화면이 그대로).
// [회의] 칩: PC 3단·폰 회의명 칩 그대로. [전체]·다른 칸: PC는 '날짜·이름 목록 | 결과' 2단, 폰은 한 줄 목록(회의명 칩 없음). 그리는 주인은 renderMeetings 하나.
let reportChip=DEFAULT_KIND;
function reportRows(){return filterByReportKind(meetings,reportChip)}
function renderReportChips(){const host=$('#reportKindFilter');if(!host)return;renderFilterChips(host,{label:'칸',controls:'meetingList',value:reportChip,options:reportKindChips(),onChange:value=>selectReportChip(value)})}
function selectReportChip(value){const next=value===ALL_KINDS||isReportKind(value)?value:DEFAULT_KIND;if(next===reportChip)return;reportChip=next;meetingSelectedId=null;closeMeetingMenu();renderMeetings({resetList:true})}
function meetingColumnList(){return meetingColumns(filterByReportKind(meetings,DEFAULT_KIND),{nameOf:meetingName,keyOf:meetingNameKey})}
function selectedMeetingColumn(columns=meetingColumnList()){return columns.find(c=>c.key===meetingSelectedKind)||columns[0]||null}
function renderMeetingRows(box){renderMeetingTypeOptions();const chip=reportChip,filter=chip===DEFAULT_KIND?$('#meetingTypeFilter')?.value||'all':'all';const rows=sortRecentFirst(reportRows().filter(m=>filter==='all'||(filter==='__none__'?!meetingName(m):meetingName(m)===filter)));box.innerHTML=rows.map(m=>{const related=documents.filter(d=>d.meeting_id===m.id),color=meetingColor(meetingName(m)),name=meetingName(m)||'회의명 미지정',meta=[chip===ALL_KINDS?reportKindLabel(reportKindOf(m)):null,...meetingRowMeta(m),related.length?MEETING_DOCS_LABEL:null].filter(Boolean).join(' · ');return `<article class="item-card meeting-list-row" data-mrd-meeting="${esc(m.id)}" data-report-kind="${esc(reportKindOf(m))}"${color?` style="--meeting-color:${color}"`:''} role="button" tabindex="0"><div class="meeting-list-main"><div class="meeting-list-title"><h3>${esc(name)}</h3></div><p>${esc(meta)}</p></div></article>`}).join('')||`<div class="empty">${chip===DEFAULT_KIND||chip===ALL_KINDS?'조건에 맞는 회의 결과가 없습니다.':'이 칸에 사업 보고가 없습니다.'}</div>`}
function meetingLegacyTitle(m){const name=meetingName(m),title=String(m?.title||'').trim();return title&&name&&title!==name?title:''}
function meetingTaskDue(t){const v=String(t?.due||''),key=v.match(/^\d{4}-\d{2}-\d{2}/)?.[0]||(v&&!Number.isNaN(new Date(v).getTime())?seoulDateKey(new Date(v)):'');return dueText(key)}
function meetingResult(m,{kindName}){return resultHtml(m,{kindName,kindLabel:reportKindLabel(reportKindOf(m)),roundText:reportKindOf(m)===DEFAULT_KIND||hasRound(m)||meetingShortName(m)?roundLabel(m):'',when:formatMeetingWhen(m,{year:'numeric'}),project:m.project_id?spaces.find(x=>x.id===m.project_id)?.name||'':'',legacyTitle:meetingLegacyTitle(m),docs:documents.filter(d=>d.meeting_id===m.id),fileLine,tasksHtml:tasksHtml(meetingTaskCache.get(m.id),{dueOf:meetingTaskDue})})}
// 오른쪽 후속 할 일: 고른 차수가 바뀌거나 할 일·회의가 바뀌면 다시 읽는다. 늦게 온 응답은 지금 고른 차수일 때만 그린다.
// 회의 결과 창이 열려 있는 동안에는 기억만 지우고 읽지 않는다(창이 자기 할 일을 읽음). 창을 닫을 때 한 번 다시 읽는다.
async function loadMeetingTasks(id,{force=false}={}){if(!id||(!force&&meetingTaskCache.has(id)))return;const seq=++meetingTaskSeq;try{await window.KPTUGoogleTasks?.waitForPendingToggles?.();const d=await api('/functions/v1/google-tasks?action=linked&meeting_id='+encodeURIComponent(id));meetingTaskCache.set(id,Array.isArray(d?.tasks)?d.tasks:[])}catch(e){console.warn('meeting tasks read failed',e);if(seq===meetingTaskSeq||!meetingTaskCache.has(id))meetingTaskCache.set(id,'error')}paintMeetingTasks(id)}
function paintMeetingTasks(id){const box=$('#meetingList #mcolTasks');if(box&&$('#meetingList #mcolResult')?.dataset.meetingResult===String(id))box.innerHTML=tasksHtml(meetingTaskCache.get(id),{dueOf:meetingTaskDue})}
function refreshMeetingTasks(){meetingTaskCache.clear();if($('#meetingRoundDetailModal:not(.hidden)'))return;if(meetingPc?.matches&&teamViewLoaded.has('meetings')){const id=$('#meetingList #mcolResult')?.dataset.meetingResult;if(id){paintMeetingTasks(id);loadMeetingTasks(id,{force:true})}}}
// UI-상단줄제목: the 사업 보고 shown on the right goes to the PC top line's place (kptu:where-item, topbar-actions.js), named like the result head (name + round); null when none.
function meetingWhere(m){const round=m&&(reportKindOf(m)===DEFAULT_KIND||hasRound(m)||meetingShortName(m))?roundLabel(m):'';window.dispatchEvent(new CustomEvent('kptu:where-item',{detail:{view:'meetings',name:m?[meetingName(m)||'이름 없음',round].filter(Boolean).join(' '):null}}))}
function renderMeetingColumns(box,{resetList=false,resetResult=resetList}={}){closeMeetingMenu();const columns=meetingColumnList(),selected=selectedMeetingColumn(columns);meetingSelectedKind=selected?.key??null;const current=pickMeeting(selected,meetingSelectedId);meetingSelectedId=current?.id??null;meetingWhere(current);if(meetingSelectedId!=null)window.dispatchEvent(new CustomEvent('kptu:split-selection',{detail:{view:'meetings',item:{id:String(meetingSelectedId),kind:meetingSelectedKind}}}));const active=document.activeElement?.closest?.('#meetingList')?document.activeElement:null,focusKey=active?{kind:active.dataset.meetingKind,round:active.dataset.meetingRound,more:active.dataset.meetingMore}:null;const kindsTop=box.querySelector('.mcol-kinds')?.scrollTop||0,listTop=resetList?0:box.querySelector('.mcol-cards')?.scrollTop||0,resultTop=resetResult?0:box.querySelector('.mcol-result-body')?.scrollTop||0;box.innerHTML=columnsHtml(columns,{selectedKey:meetingSelectedKind,selectedId:meetingSelectedId,colorOf:meetingColor,whenOf:m=>formatMeetingWhen(m),resultHtml:meetingResult});const kinds=box.querySelector('.mcol-kinds'),list=box.querySelector('.mcol-cards'),body=box.querySelector('.mcol-result-body');if(kinds)kinds.scrollTop=kindsTop;if(list)list.scrollTop=listTop;if(body)body.scrollTop=resultTop;if(focusKey){const [attr,value]=focusKey.kind!=null?['data-meeting-kind',focusKey.kind]:focusKey.round!=null?['data-meeting-round',focusKey.round]:focusKey.more!=null?['data-meeting-more',focusKey.more]:[];if(attr){const el=[...box.querySelectorAll(`[${attr}]`)].find(e=>e.getAttribute(attr)===value)||(attr==='data-meeting-more'?box.querySelector('[data-meeting-more]'):null);el?.focus({preventScroll:true})}}if(current)loadMeetingTasks(current.id)}
function renderReportList(box,{resetList=false,resetResult=resetList}={}){closeMeetingMenu();const rows=sortRecentFirst(reportRows()),current=rows.find(m=>String(m.id)===String(meetingSelectedId))||rows[0]||null;meetingSelectedId=current?.id??null;meetingWhere(current);if(meetingSelectedId!=null)window.dispatchEvent(new CustomEvent('kptu:split-selection',{detail:{view:'meetings',item:{id:String(meetingSelectedId)}}}));const active=document.activeElement?.closest?.('#meetingList')?document.activeElement:null,focusKey=active?{round:active.dataset.meetingRound,more:active.dataset.meetingMore}:null;const listTop=resetList?0:box.querySelector('.mcol-cards')?.scrollTop||0,resultTop=resetResult?0:box.querySelector('.mcol-result-body')?.scrollTop||0;box.innerHTML=listHtml(rows,{selectedId:meetingSelectedId,label:reportChip===ALL_KINDS?'전체':reportKindLabel(reportChip),nameOf:m=>meetingName(m)||'이름 없음',kindOf:m=>reportChip===ALL_KINDS?reportKindLabel(reportKindOf(m)):'',colorOf:m=>meetingColor(meetingName(m)),whenOf:m=>formatMeetingWhen(m),resultHtml:m=>meetingResult(m,{kindName:meetingName(m)||'이름 없음'})});const layout=box.querySelector('.mcol-layout'),list=box.querySelector('.mcol-cards'),body=box.querySelector('.mcol-result-body');if(list)list.scrollTop=listTop;if(body)body.scrollTop=resultTop;if(layout)mountSplitResize({container:layout,name:'reports',label:'사업 보고 목록과 결과 칸 폭 조절',controls:'mcolRounds',list:()=>box.querySelector('.mcol-rounds'),pane:()=>box.querySelector('.mcol-result'),active:()=>!!meetingPc?.matches&&reportChip!==DEFAULT_KIND&&box.contains(layout)});if(focusKey){const [attr,value]=focusKey.round!=null?['data-meeting-round',focusKey.round]:focusKey.more!=null?['data-meeting-more',focusKey.more]:[];if(attr)([...box.querySelectorAll(`[${attr}]`)].find(e=>e.getAttribute(attr)===value)||(attr==='data-meeting-more'?box.querySelector('[data-meeting-more]'):null))?.focus({preventScroll:true})}if(current)loadMeetingTasks(current.id)}
function renderMeetings(opts){const box=$('#meetingList');if(!box)return;renderReportChips();const pc=!!meetingPc?.matches,columns=pc&&reportChip===DEFAULT_KIND;box.classList.toggle('meeting-columns',pc);box.dataset.reportKind=reportChip;const toolbar=$('#meetingsView .meeting-toolbar');if(toolbar)toolbar.hidden=pc||reportChip!==DEFAULT_KIND;if(columns)renderMeetingColumns(box,opts);else if(pc)renderReportList(box,opts);else{closeMeetingMenu();renderMeetingRows(box)}}
function selectMeetingKind(key){if(key===meetingSelectedKind)return;meetingSelectedKind=key;meetingSelectedId=null;renderMeetings({resetList:true})}
function selectMeetingRound(id){if(String(id)===String(meetingSelectedId))return;meetingSelectedId=id;renderMeetings({resetResult:true})}
// UI-상단줄 ← →: show a recorded meeting result again (its kind, then the round), through the same one renderer.
// MTG-사업보고 4단계: 고른 건이 지금 칩에 없으면(칸을 바꿨거나 다른 칸 건을 열 때) 그 건의 칸 칩으로 옮긴다. 폰은 칩만 옮긴다.
window.KPTUMeetingColumns={select:item=>{if(!item?.id)return;const m=meetings.find(x=>String(x.id)===String(item.id));let chipChanged=false;if(m&&reportChip!==ALL_KINDS&&reportKindOf(m)!==reportChip){reportChip=reportKindOf(m);chipChanged=true}if(!meetingPc?.matches){if(chipChanged)renderMeetings({resetList:true});return}if(reportChip!==DEFAULT_KIND){meetingSelectedId=item.id;renderMeetings(chipChanged?{resetList:true}:{resetResult:true});return}const key=item.kind??(m?(meetingName(m)?meetingNameKey(meetingName(m)):NONE_KEY):meetingSelectedKind),kindChanged=chipChanged||key!==meetingSelectedKind;meetingSelectedKind=key;meetingSelectedId=item.id;renderMeetings(kindChanged?{resetList:true}:{resetResult:true})}};
function meetingListClick(e){const kind=e.target.closest('[data-meeting-kind]');if(kind){selectMeetingKind(kind.dataset.meetingKind);return}const round=e.target.closest('[data-meeting-round]');if(round){selectMeetingRound(round.dataset.meetingRound);return}const more=e.target.closest('[data-meeting-more]');if(more)toggleMeetingMenu(more)}
// 왼쪽 종류 목록·가운데 차수 목록: 위·아래 화살표로 같은 목록 안에서 옮겨 다니고(Home·End 처음·끝), Enter·Space로 고른다(버튼 기본 동작).
function meetingKindKeys(e){const item=e.target.closest?.('[data-meeting-kind],[data-meeting-round]');if(!item||!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;const all=[...$$(item.dataset.meetingKind!=null?'#meetingList [data-meeting-kind]':'#meetingList [data-meeting-round]')],i=all.indexOf(item);const next=e.key==='Home'?all[0]:e.key==='End'?all.at(-1):all[i+(e.key==='ArrowDown'?1:-1)];if(next){e.preventDefault();next.focus()}}
// 오른쪽 머리 ⋯: 누른 자리에 펼치는 작은 목록(anchored-popup.js, UI-PC팝업위치). [수정]은 지금의 회의 결과 창(meeting-round-detail.js)을 연다.
// Esc·바깥 누르기·고르기·다시 그리기(⋯가 사라짐)로 닫힌다.
let meetingMenu=null;
function meetingMenuEl(){let el=$('#mcolMenu');if(!el){el=document.createElement('div');el.id='mcolMenu';el.className='gt-task-menu mcol-menu';el.setAttribute('role','group');el.setAttribute('aria-label','회의 결과 관리');el.hidden=true;el.innerHTML='<button type="button" data-meeting-menu="edit">수정</button><button type="button" data-meeting-menu="kind">칸 바꾸기</button>';el.addEventListener('click',meetingMenuClick);el.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeMeetingMenu({focus:true})}});el.addEventListener('focusout',e=>{if(meetingMenu&&e.relatedTarget&&!el.contains(e.relatedTarget)&&e.relatedTarget!==meetingMenu.trigger)closeMeetingMenu()});($('#meetingsListCard')||document.body).append(el)}return el}
function closeMeetingMenu({focus=false}={}){if(!meetingMenu)return null;const closed=meetingMenu,el=$('#mcolMenu');meetingMenu=null;closed.stop();if(el){el.hidden=true;clearAnchored(el)}closed.trigger.setAttribute('aria-expanded','false');if(focus&&closed.trigger.isConnected)closed.trigger.focus({preventScroll:true});return closed}
function toggleMeetingMenu(trigger){if(meetingMenu?.trigger===trigger){closeMeetingMenu({focus:true});return}closeMeetingMenu();const el=meetingMenuEl();el.hidden=false;const place=()=>placeAnchored(el,trigger,{maxWidth:200,maxHeight:240,minHeight:60});place();meetingMenu={id:trigger.dataset.meetingMore,trigger,stop:followAnchor(el,trigger,{place,lost:()=>closeMeetingMenu()})};trigger.setAttribute('aria-expanded','true');el.querySelector('button')?.focus({preventScroll:true})}
function meetingMenuClick(e){const b=e.target.closest('[data-meeting-menu]');if(!b||!meetingMenu)return;const {id,trigger}=closeMeetingMenu({focus:true});if(b.dataset.meetingMenu==='edit')window.KPTUMeetingRoundDetail?.open?.(id);else if(b.dataset.meetingMenu==='kind')changeReportKind(id,trigger)}
// [칸 바꾸기]: 칸 고르기 창 → PATCH activity_kind(report-kind-sheet.js). 바꾼 건은 그 칸 칩에서 계속 보인다.
function changeReportKind(id,trigger){const m=meetings.find(x=>String(x.id)===String(id));if(!m||!trigger)return;pickReportKind(trigger,{title:'칸 바꾸기',current:reportKindOf(m),onPick:async kind=>{if(kind===reportKindOf(m)&&m.activity_kind===kind)return;try{await saveReportKind(m.id,kind);toast(`칸을 '${reportKindLabel(kind)}'(으)로 바꿨습니다.`)}catch(err){toast(err.message||'칸을 바꾸지 못했습니다.')}}})}
document.addEventListener('click',e=>{if(meetingMenu&&!$('#mcolMenu')?.contains(e.target)&&!meetingMenu.trigger.contains(e.target))closeMeetingMenu()});
document.addEventListener('keydown',e=>{if(meetingMenu&&e.key==='Escape'&&document.activeElement===meetingMenu.trigger){e.preventDefault();closeMeetingMenu({focus:true})}});
// ④ [+ 회의 결과]는 화면 위 하나. PC에서는 왼쪽에서 고른 종류를 미리 고른 채 연다(만들기 창에서 바꿀 수 있음). 폰은 지금처럼 비운 채.
function newMeetingName(){if(!meetingPc?.matches||reportChip!==DEFAULT_KIND)return '';const c=selectedMeetingColumn();return c&&c.key!==NONE_KEY?c.name:''}
function suggestMeetingRound(){if(meetingRoundEdited||entryKind()!==DEFAULT_KIND)return;const key=meetingNameKey($('#meetingTitle')?.value),round=$('#meetingRoundNo');if(!round)return;let max=0;for(const m of meetings){const value=Number(m.round_no);if(key&&meetingNameKey(meetingName(m))===key&&Number.isSafeInteger(value)&&value>max)max=value}round.value=max?String(max+1):''}
let meetingRoundEdited=false;
async function downloadMeetingDocument(id){try{const d=await api('/functions/v1/workspace-drive?action=download-token',{method:'POST',body:{document_id:id}});location.href=d.url}catch(e){toast(e.message||'회의자료를 열지 못했습니다.')}}
function renderPages(){window.KPTUWeb1Board?.render?.()}
function openModal(id,{trigger=document.activeElement,initialFocus=null,onRequestClose=null}={}){const m=$('#'+id);if(!m)return;m.classList.remove('hidden');m.setAttribute('aria-hidden','false');window.KPTUA11y?.dialog.activate(m,{trigger,initialFocus,onRequestClose:onRequestClose||(()=>closeModal(id))})}
function closeModal(id,{restoreFocus=true}={}){const m=$('#'+id);if(!m)return;m.classList.add('hidden');m.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate(m,{restoreFocus,fallbackFocus:'#appView .view-panel:not(.hidden) h2'})}
async function saveDocument(){if(documentSavePending)return;const title=$('#docTitle').value.trim();if(!title)return setStatus($('#documentStatus'),'자료명을 입력해 주세요.','error');const projectId=$('#docProject').value||null;const button=$('#saveDocumentBtn'),originalLabel=button.textContent;documentSavePending=true;setBusy(button,true);button.textContent='저장 중…';try{await api('/rest/v1/app_documents',{method:'POST',body:{workspace_id:workspace.id,project_id:projectId,title,category:$('#docCategory').value.trim()||'기타',source:$('#docSource').value.trim()||null,document_date:$('#docDate').value||null,description:$('#docDescription').value.trim()||null,tags:$('#docTags').value.split(',').map(x=>x.trim()).filter(Boolean),drive_url:$('#docUrl').value.trim()||null,visibility:'private',uploaded_by:user.id},prefer:'return=representation'});if(projectId)window.KPTUDriveSummary?.saved?.();closeModal('documentModal');await reload(['documents']);window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:projectId}}));toast('자료를 등록했습니다.')}catch(e){setStatus($('#documentStatus'),e.message,'error')}finally{documentSavePending=false;setBusy(button,false);button.textContent=originalLabel}}
// UI-회의결과창정리: 파일 한 줄(종류·이름·상태·×). 새 회의는 아직 저장 전이라 회의 결과를 저장할 때 차례로 올린다.
const MEETING_FILE_LABEL={pending:'저장할 때 올림',uploading:'올리는 중…',success:'완료'};
function renderMeetingSelectedFiles(){
 const box=$('#meetingSelectedFiles'),input=$('#meetingFiles');if(!box||!input)return;
 input.disabled=meetingSavePending;if($('#meetingPickFiles'))$('#meetingPickFiles').disabled=meetingSavePending;
 box.innerHTML=meetingUploadEntries.length?meetingUploadEntries.map((entry,index)=>fileLine({name:entry.file.name,state:entry.kind,label:entry.label||MEETING_FILE_LABEL[entry.kind]||'',end:entry.kind==='success'?'':`<button class="icon-btn file-line-x" type="button" data-meeting-remove-file="${index}" aria-label="${esc(entry.file.name)} 선택 취소"${meetingSavePending?' disabled':''}>×</button>`})).join(''):'<p class="mtg-empty">회의자료가 없습니다.</p>';
}
function addMeetingFiles(files){if(meetingSavePending)return;const added=Array.from(files||[]).map(file=>({file,kind:'pending'}));if(!added.length)return;meetingUploadEntries=[...meetingUploadEntries,...added];renderMeetingSelectedFiles()}
function selectMeetingFiles(){const input=$('#meetingFiles'),files=Array.from(input.files||[]);input.value='';addMeetingFiles(files)}
function removeMeetingFile(e){const b=e.target.closest('[data-meeting-remove-file]');if(!b||meetingSavePending)return;const index=Number(b.dataset.meetingRemoveFile);if(meetingUploadEntries[index]?.kind==='success')return;meetingUploadEntries.splice(index,1);renderMeetingSelectedFiles();const buttons=$$('#meetingSelectedFiles button');(buttons[Math.min(index,buttons.length-1)]||$('#meetingPickFiles')).focus()}
async function saveMeeting(){if(meetingSavePending)return;const button=$('#saveMeetingBtn'),originalLabel=button.textContent;const title=$('#meetingTitle').value.trim(),meetingAt=$('#meetingAt').value,transcript=$('#meetingTranscript')?.value??'',specialNotes=$('#meetingNotes')?.value??'',shortName=($('#meetingShortName')?.value||'').trim();if(!title)return setStatus($('#meetingStatus'),'회의명을 입력해 주세요.','error');if(!meetingAt)return setStatus($('#meetingStatus'),'일시를 입력해 주세요.','error');if(!transcript.trim())return setStatus($('#meetingStatus'),'회의 결과 원문을 입력해 주세요.','error');const projectId=$('#meetingProject').value||null,roundRaw=$('#meetingRoundNo')?.value,roundNo=roundRaw?Number(roundRaw):null,files=meetingUploadEntries.filter(entry=>entry.kind!=='success').map(entry=>entry.file);if(files.some(file=>file.size>100*1024*1024))return setStatus($('#meetingStatus'),'회의자료는 파일당 100MB까지 첨부할 수 있습니다.','error');meetingSavePending=true;$('#newMeetingBtn').disabled=true;renderMeetingSelectedFiles();setBusy(button,true);button.textContent='저장 중…';setStatus($('#meetingStatus'),'저장 중…');let savedMeeting=null;try{const actionRows=$$('#meetingActionList .meeting-action-row').map(r=>({title:String(r.dataset.title||'').trim(),due:r.dataset.due||''}));const lineTitle=$('#meetingActionTitle')?.value.trim()||'',lineDue=$('#meetingActionDue')?.value||'';if(lineTitle||lineDue)actionRows.push({title:lineTitle,due:lineDue});if(actionRows.some(x=>!x.title))throw new Error('후속 할 일을 입력해 주세요.');const rows=await api('/rest/v1/app_meetings',{method:'POST',body:{workspace_id:workspace.id,activity_kind:entryKind(),project_id:projectId,title:shortName&&shortName!==title?shortName:title,series_name:title,round_no:Number.isFinite(roundNo)?roundNo:null,meeting_at:toMeetingISO(meetingAt),notes:specialNotes.trim()?specialNotes:'',transcript_text:transcript,result_status:'final',finalized_at:new Date().toISOString(),created_by:user.id},prefer:'return=representation'});const meeting=rows?.[0];if(!meeting)throw new Error('저장된 회의 정보를 확인하지 못했습니다.');savedMeeting=meeting;window.KPTUDriveSummary?.saved?.();for(const a of actionRows){const result=await window.KPTURuntime.api('/functions/v1/google-tasks?action=create',{method:'POST',body:{action:'create',title:a.title,notes:'',due:a.due||null,links:[{meeting_id:meeting.id},...(projectId?[{project_id:projectId}]:[])]}});if(result?.link_error)throw new Error('Google 할 일은 만들었지만 회의 연결을 저장하지 못했습니다.')}let uploaded=0,failed=0,readFailureMessage='';for(const file of files){const entry=meetingUploadEntries.find(x=>x.file===file);if(entry){entry.kind='uploading';entry.label='업로드 중';renderMeetingSelectedFiles()}let fd=null;try{fd=new FormData();fd.append('file',await window.KPTURuntime.copyUploadFile(file));fd.append('meeting_id',meeting.id);if(projectId)fd.append('project_id',projectId);const up=await api('/functions/v1/meeting-files',{method:'POST',body:fd});readTextLater(up?.document);if(projectId)window.KPTUDriveSummary?.saved?.();uploaded++;if(entry){entry.kind='success';entry.label='완료'}}catch(err){failed++;const readFailed=err?.code==='file_read_failed';if(readFailed)readFailureMessage=err.message;if(entry){entry.kind='error';entry.label=readFailed?err.message:'실패'}console.warn('meeting material upload failed',file.name,err)}finally{fd?.delete('file');fd=null}renderMeetingSelectedFiles()}closeModal('meetingModal');await reload(['meetings','documents']);window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:meeting.id}}));if(actionRows.length)window.dispatchEvent(new CustomEvent('kptu:tasks-changed'));if(failed)toast(`회의 결과는 저장했습니다. 회의자료 ${uploaded}개 저장 · ${failed}개 실패${readFailureMessage?' · '+readFailureMessage:''}`);else toast(files.length?`회의 결과와 자료 ${uploaded}개를 저장했습니다.`:'회의 결과를 저장했습니다.')}catch(e){if(savedMeeting){closeModal('meetingModal');try{await reload(['meetings','documents'])}catch(err){console.warn('meeting list refresh failed',err)}window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:savedMeeting.id}}));toast('회의 결과는 저장됐습니다. 후속 할 일 상태를 회의 상세에서 확인해 주세요. '+e.message)}else setStatus($('#meetingStatus'),e.message,'error')}finally{meetingSavePending=false;$('#newMeetingBtn').disabled=false;renderMeetingSelectedFiles();setBusy(button,false);button.textContent=originalLabel}}
async function reload(parts,render=renderAll){const wid=workspace.id;for(const p of parts){if(p==='meetings')meetings=await api('/rest/v1/app_meetings?workspace_id=eq.'+wid+'&select=*&order=meeting_at.desc');if(p==='documents')documents=await api('/rest/v1/app_documents?workspace_id=eq.'+wid+'&select=*&order=document_date.desc.nullslast,created_at.desc');if(p==='spaces'){spaces=await api('/rest/v1/app_spaces?workspace_id=eq.'+wid+'&select=*&order=sort_order.asc,created_at.asc');publishProjects()}}render()}
window.__KPTU_RELOAD_MEETINGS__=async()=>{if(!workspace?.id)return;[meetings,documents]=await Promise.all([api('/rest/v1/app_meetings?workspace_id=eq.'+workspace.id+'&select=*&order=meeting_at.desc'),api('/rest/v1/app_documents?workspace_id=eq.'+workspace.id+'&select=*&order=document_date.desc.nullslast,created_at.desc')]);renderMeetings()};
async function googleCall(action,opts={}){await ensureSession();const url=new URL(GOOGLE_FN);if(action)url.searchParams.set('action',action);if(opts.params)Object.entries(opts.params).forEach(([k,v])=>url.searchParams.set(k,String(v)));const r=await fetch(url,{method:opts.method||'GET',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:opts.body?JSON.stringify(opts.body):null});const d=await r.json();if(!r.ok||d.error)throw new Error(d.error||'Google Calendar 요청 실패');return d}
async function loadGoogleStatus(loadEvents=false){try{const s=await googleCall('status');googleState={...googleState,...s};if(s.connected&&loadEvents)await loadGoogleEvents();renderGoogleControls()}catch(e){googleState.connected=false;renderGoogleControls();console.warn(e)}}
async function loadGoogleEvents(){return window.KPTUCalendarPersistence?.refresh?.()}
function renderGoogleControls(){if(!$('#googleConnectBtn'))return;const panel=$('#googleCalendarPanel'),connect=$('#googleConnectBtn'),box=$('#googleCalendarList');$('#googleAccountLabel').textContent=googleState.connected?(googleState.email||'연결됨'):'연결 안 됨';connect.classList.toggle('hidden',!!googleState.connected);if(panel&&!panel.dataset.initialized&&typeof googleState.connected==='boolean'){panel.open=!googleState.connected;panel.dataset.initialized='1'}if(googleState.connected&&googleState.calendars?.length){box.classList.remove('hidden');box.innerHTML='<b>표시할 Google 캘린더</b>'+googleState.calendars.map(c=>`<label class="toggle-line"><input type="checkbox" data-google-cal="${esc(c.id)}" ${googleState.selected?.includes(c.id)?'checked':''}> <span>${esc(c.summary)}${c.primary?' (기본)':''}</span></label>`).join('')+'<button id="saveGooglePrefs" class="mini" type="button">자동 저장</button><button id="disconnectGoogle" class="mini" type="button">연결 해제</button>';$('#saveGooglePrefs').onclick=saveGooglePrefs;$('#disconnectGoogle').onclick=disconnectGoogle}else box.classList.add('hidden');window.KPTUCalendarPersistence?.decorate?.()}
window.__KPTU_SYNC_GOOGLE_STATE__=next=>{googleState={...googleState,...(next||{})}};
window.__KPTU_SYNC_GOOGLE_EVENTS__=next=>{googleState.events=Array.isArray(next)?next:[];renderCalendar()};
window.__KPTU_RENDER_GOOGLE_CONTROLS__=renderGoogleControls;
async function connectGoogle(){if(googleState.connected){const panel=$('#googleCalendarPanel');if(panel)panel.open=true;return}const d=await googleCall('start');location.href=d.url}
async function saveGooglePrefs(){const ids=$('[data-google-cal]:checked').map(x=>x.dataset.googleCal);await googleCall('',{method:'POST',body:{action:'preferences',calendar_ids:ids,enabled:true}});googleState.selected=ids;googleState.enabled=true;await loadGoogleEvents();toast('Google 캘린더 표시 설정을 저장했습니다.')}
async function disconnectGoogle(){await googleCall('',{method:'POST',body:{action:'disconnect'}});window.KPTUCalendarPersistence?.disconnected?.();googleState={connected:false,enabled:false,selected:[],calendars:[],events:[],email:null};renderCalendar();toast('Google Calendar 연결을 해제했습니다.')}
function switchView(view){if(window.KPTURouter?.go){window.KPTURouter.go(view,{source:'team'});return}$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('.view-panel').forEach(v=>v.classList.add('hidden'));$('#'+view+'View')?.classList.remove('hidden')}
function openEventModal(){['eventTitle','eventLocation','eventDescription'].forEach(id=>{if($('#'+id))$('#'+id).value=''});const now=new Date(),finish=new Date(now.getTime()+3600000),date=seoulDateKey,time=seoulClock;if($('#eventAllDay'))$('#eventAllDay').checked=false;if($('#eventStartDate'))$('#eventStartDate').value=date(now);if($('#eventEndDate'))$('#eventEndDate').value=date(finish);if($('#eventStartTime'))$('#eventStartTime').value=time(now);if($('#eventEndTime'))$('#eventEndTime').value=time(finish);document.querySelectorAll('.event-time-row').forEach(x=>x.classList.remove('hidden'));setStatus($('#eventStatus'),'');openModal('eventModal',{initialFocus:'#eventTitle'});window.KPTUCalendarPlus?.prepareNewEvent?.()}
function openDocumentModal(){['docTitle','docCategory','docSource','docDate','docTags','docUrl','docDescription'].forEach(id=>{if($('#'+id))$('#'+id).value=''});openModal('documentModal',{initialFocus:'#docTitle'})}
// MTG-사업보고 4단계: 입력 창 맨 위 칸 칩(#meetingKindPick). 저장 때 activity_kind로 보낸다. 차수는 [회의] 칸에서만 보인다(값이 있으면 다른 칸에서도 보임).
let meetingEntryKind=DEFAULT_KIND;
function entryKind(){return isReportKind(meetingEntryKind)?meetingEntryKind:DEFAULT_KIND}
function paintEntryKind(){const host=$('#meetingKindPick');if(!host)return;renderFilterChips(host,{label:'칸',value:entryKind(),options:REPORT_KINDS.map(k=>({value:k.value,label:k.label})),onChange:value=>{meetingEntryKind=value;paintEntryKind()}});const round=$('#meetingRoundNo')?.closest('label');if(round)round.hidden=entryKind()!==DEFAULT_KIND&&!$('#meetingRoundNo').value}
// [+]: [전체] 칩이면 칸 고르기 창을 먼저 열고, 다른 칩이면 그 칸이 채워진 입력 창을 바로 연다.
function newReport(trigger){if(reportChip!==ALL_KINDS){openMeetingModal({name:newMeetingName(),kind:reportChip});return}pickReportKind(trigger,{title:'어느 칸에 남길까요?',onPick:kind=>openMeetingModal({kind,trigger})})}
function openMeetingModal({name='',kind=DEFAULT_KIND,trigger=document.activeElement}={}){meetingEntryKind=isReportKind(kind)?kind:DEFAULT_KIND;['meetingTitle','meetingAt','meetingNotes','meetingRoundNo','meetingShortName','meetingTranscript'].forEach(id=>{if($('#'+id))$('#'+id).value=''});meetingRoundEdited=false;meetingUploadEntries=[];renderMeetingSelectedFiles();if($('#meetingFiles'))$('#meetingFiles').value='';$('#meetingProject').innerHTML=projectOptions(true);installMeetingNamePicker($('#meetingTitle'),'meeting');setupMeetingNamePicker($('#meetingNameSelect'),$('#meetingTitle'),$('#meetingNameMatch'),$('#meetingNameUseMatch'),{current:name,onChoose:suggestMeetingRound,onCustom:()=>{if(!meetingRoundEdited)$('#meetingRoundNo').value=''}});paintEntryKind();openModal('meetingModal',{trigger,initialFocus:meetingNameChoices().length?'#meetingNameSelect':'#meetingTitle'})}
function bind(){
 $('#bootRetryBtn').onclick=()=>location.reload();$('#bootLogoutBtn').onclick=logout;$('#accessDeniedLogoutBtn').onclick=logout;
 document.addEventListener('click',async e=>{const b=e.target.closest('button,a');if(!b)return;if(b.dataset.meetingDoc){e.preventDefault();e.stopPropagation();await downloadMeetingDocument(b.dataset.meetingDoc);return}if(b.dataset.close){closeModal(b.dataset.close);return}});
 if(window.KPTURouter?.on)window.KPTURouter.on('calendar',()=>{renderCalendar();if(googleState.connected)window.KPTUCalendarPersistence?.refresh?.()});
 if($('#homeAddEvent'))$('#homeAddEvent').onclick=openEventModal;$('#newEventBtn').onclick=openEventModal;$('#newDocumentBtn').onclick=openDocumentModal;$('#newMeetingBtn').onclick=e=>newReport(e.currentTarget);$('#meetingList')?.addEventListener('click',meetingListClick);$('#meetingList')?.addEventListener('keydown',meetingKindKeys);meetingPc?.addEventListener?.('change',()=>{if(workspace?.id)renderMeetings()});
 $('#meetingRoundNo').oninput=()=>{meetingRoundEdited=true};$('#meetingRoundNo').addEventListener('change',paintEntryKind);
 $('#saveDocumentBtn').onclick=saveDocument;$('#saveMeetingBtn').onclick=saveMeeting;$('#meetingFiles').onchange=selectMeetingFiles;$('#meetingPickFiles').onclick=()=>$('#meetingFiles').click();bindDropTarget($('#meetingModal .modal-card'),addMeetingFiles,()=>!meetingSavePending);$('#meetingSelectedFiles').addEventListener('click',removeMeetingFile);
 if($('#pageSearch'))$('#pageSearch').oninput=renderPages;if($('#pageFilter'))$('#pageFilter').onchange=renderPages;$('#documentSearch').oninput=renderDocuments;
 window.addEventListener('kptu:project-spaces-updated',e=>{const d=e.detail;if(!workspace||!user||d?.workspaceId!==workspace.id||d.userId!==user.id||!Array.isArray(d.spaces))return;spaces=d.spaces;renderAll()});
 const moveMonth=delta=>{if(window.KPTUCalendarView?.move(delta))return;monthCursor=seoulDate(seoulParts(monthCursor).year,seoulParts(monthCursor).month+delta);renderCalendar();window.KPTUCalendarPersistence?.refresh?.()};window.__KPTU_CALENDAR_TODAY__=()=>{monthCursor=new Date();renderCalendar();window.KPTUCalendarPersistence?.refresh?.()};window.__KPTU_CALENDAR_MOVE_MONTH__=moveMonth;$('#prevMonthBtn').onclick=()=>moveMonth(-1);$('#nextMonthBtn').onclick=()=>moveMonth(1);window.KPTUCalendarMonthView?.setNavigate?.(moveMonth);
 $('#googleConnectBtn').onclick=connectGoogle;
}
async function init(){enhanceDom();bind();session=window.__KPTU_AUTHENTICATED_BOOT_SESSION__||loadSession();if(!session){window.KPTUAuthGate?.redirect?.();return}try{await loadWorkspaceState()}catch(e){console.error('workspace init failed',e);if(await ensureSession()){showWorkspaceError();return 'error'}saveSession(null);window.KPTUAuthGate?.redirect?.();return 'error'}}
window.__KPTU_TEAM_READY__=init().then(result=>{const state=result==='error'?'error':!session?'auth':membership?'workspace':'denied';window.__KPTU_TEAM_READY_STATE__=state;window.dispatchEvent(new CustomEvent('kptu:team-ready',{detail:{state}}));return state});

// MEET-결과3단: 오른쪽 후속 할 일은 할 일·회의가 바뀌거나 회의 결과 창을 닫으면 다시 읽는다(창 안에서 고친 할 일 반영).
for(const name of ['kptu:tasks-changed','kptu:meetings-changed'])window.addEventListener(name,refreshMeetingTasks);
window.addEventListener('kptu:dialog-closed',e=>{if(e.detail?.modal?.id==='meetingRoundDetailModal')refreshMeetingTasks()});
window.addEventListener('kptu:documents-changed',()=>{if(workspace?.id&&teamViewLoaded.has('meetings'))reload(['documents'],renderMeetings).catch(err=>console.error('meeting document count refresh failed',err))});
