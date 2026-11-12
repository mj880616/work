import {waitHtml, emptyHtml, waitInlineHtml, failEl} from './wait-state.js';
import {holdToast as kptuHoldToast,askConfirm} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {formatMeetingTime,toMeetingISO,seoulParts,seoulDate,seoulDateKey,seoulClock} from './meeting-time.js';
import './time-input.js';
import {appMenuPoint} from './row-menu.js'; // S51-27 UI-PC우클릭: 기본 메뉴 그대로 둘 때 규칙(공용)
import {fileLine,bindDropTarget} from './meeting-compact.js';
import {paintUploadLine,paintUploadOverlay,watchUploads,announceDock} from './upload-progress.js'; // UI-올리기진행표시 ②
import {sendFailLine} from './meeting-send.mjs'; // BIZ-저장먼저닫기
import {viewPrefs} from './view-prefs.js';
import {PERIOD_CHOICES,periodFromPref,prefFromPeriod,inRange,rangeLabel,quickRanges,validRange} from './report-period-model.mjs';import {rangePanelHtml,weekNumberPanelHtml,isoYearChanged,weekNumberName} from './report-period-panel.mjs';import {isoWeekOf,isoWeekStart} from './business-area-model.mjs'; // REPORT-기간고르기 // ACT-사진 6단계: 사업 보고 [목록|달력|사진] 보기 선택은 서버(report_view)에 기억
import {ALL_KINDS,DEFAULT_KIND,REPORT_KINDS,ONELINE_KIND,isReportKind,isReportChip,reportKindOf,reportKindLabel,reportKindChips,filterByReportKind} from './report-kinds.mjs';
import {missingOrganizationLabel} from './project-trash-model.mjs'; // TRASH-화면2: 휴지통에 든 조직을 가리키는 연결의 빈 이름
import {readMeetings,readDocuments} from './report-list-read.js'; // APP-낭비줄이기 ①: 목록은 쓰는 열만
import {newTaskDue} from './task-due.mjs'; // S50-36: 사업 보고 후속 할 일은 줄마다 고른 날, 없으면 오늘(한 곳 규칙)
// PERF-첫로딩 P5-b(docs/design/first-load.md 10절): 사업 보고 화면·입력 창에만 쓰는 모듈은 team-report-kit.js 한 묶음으로 모아
// 홈 등 다른 화면이 보이기 전 정적 사슬에서 뺐다. 사업 보고 화면 자료를 읽을 때(loadForView('meetings'))·연결 다시 읽기 때 reportKit()으로 한 번 부른다.
// 아래 이름들은 묶음이 온 뒤 채워진다 — 그리기·창 열기는 모두 그 뒤에만 불린다(renderMeetings·reportLinkLabel은 오기 전이면 그리지 않음).
let renderFilterChips,defaultReportAt,isPhotoFile,paintLocalPhotos,REPORT_VIEW_OPTIONS,reportViewOf,shiftMonth,photosByMeeting,calendarHtml,photoViewHtml,mountPhotoView,mountStrips,PC_QUERY,NONE_KEY,sortRecentFirst,MEETING_DOCS_LABEL,meetingColumns,columnsHtml,listHtml,pickMeeting,assignMeetingColors,meetingPaletteColor,nameHash,MEETING_HUES,roundLabel,hasRound,meetingShortName,formatMeetingWhen,pickReportKind,reportWords,isMeetingKind,createFieldRows,mountSplitResize,followPane,stickTop,targetList,targetsLabel,firstProjectId,saveReportTargets,readAllReportTargets,locationAvailable,noteLocationFromMeetings,attendeesAvailable,noteAttendeesFromMeetings,noteAreaFromMeetings,noteAreaNoneFromMeetings,LEGACY_NOTE,mountAreaFields,mountBigWrite,untaggedInWeek,AREA_NONE,areaRoots,areaChipOptions,matchesAreaChip,areaIdOf,shownReportWeek,inReportWeek,undatedCount,reportWeekLabel,reportDayOf,weekOf,shiftDays,readNameSorts,peekNameSorts,orgSections;
import {within, isLoadTimeout} from './load-deadline.js';
import {SPLIT_QUERY} from './screen-width.mjs'; // FOLD-넓은화면 2차: 사업 보고 '목록 | 결과' 칸 나누기 폭은 공용 판정 한 곳(600px~)
// FOLD-넓은화면 2차(S59-19, 요청함 11/06 01:18 ④): meetingPc = 칸 나누기(공용 판정 600px~ — 펼친 폴드·PC), meetingWide = [회의] 칸 세 칸(종류 | 차수 | 결과)을 쓰는 PC(1200px~, 홈 두 단·잊지 말기와 같은 경계),
// meetingFramePc = 앱 틀이 PC(761px~)인지(아니면 폰 틀: 결과 칸은 아래 하단바만큼 짧게 붙는다, follow-pane.js narrow).
// 폴드 펼침(600~1199px)은 칸 칩과 상관없이 '날짜·이름 목록 | 결과' 두 칸(meeting-columns.js listHtml — PC [전체]·다른 칸 칩과 같은 부품)이고, 회의명은 위 [종류 ▾] 상자의 '회의명' 묶음으로 거른다(폰과 같음).
let reportKitLoaded=false,reportKitFlight=null,meetingPc=null,meetingWide=null,meetingFramePc=null,entryRoundRows=null;
function reportKit(){
  if(reportKitLoaded)return Promise.resolve();
  return reportKitFlight||=import('./team-report-kit.js').then(kit=>{
    ({renderFilterChips,defaultReportAt,isPhotoFile,paintLocalPhotos,REPORT_VIEW_OPTIONS,reportViewOf,shiftMonth,photosByMeeting,calendarHtml,photoViewHtml,mountPhotoView,mountStrips,PC_QUERY,NONE_KEY,sortRecentFirst,MEETING_DOCS_LABEL,meetingColumns,columnsHtml,listHtml,pickMeeting,assignMeetingColors,meetingPaletteColor,nameHash,MEETING_HUES,roundLabel,hasRound,meetingShortName,formatMeetingWhen,pickReportKind,reportWords,isMeetingKind,createFieldRows,mountSplitResize,followPane,stickTop,targetList,targetsLabel,firstProjectId,saveReportTargets,readAllReportTargets,locationAvailable,noteLocationFromMeetings,attendeesAvailable,noteAttendeesFromMeetings,noteAreaFromMeetings,noteAreaNoneFromMeetings,LEGACY_NOTE,mountAreaFields,mountBigWrite,untaggedInWeek,AREA_NONE,areaRoots,areaChipOptions,matchesAreaChip,areaIdOf,shownReportWeek,inReportWeek,undatedCount,reportWeekLabel,reportDay:reportDayOf,weekOf,shiftDays,readNameSorts,peekNameSorts,orgSections}=kit);
    meetingPc=window.matchMedia?.(SPLIT_QUERY);meetingWide=window.matchMedia?.('(min-width:1200px)');meetingFramePc=window.matchMedia?.(PC_QUERY);
    for(const q of [meetingPc,meetingWide,meetingFramePc])q?.addEventListener?.('change',()=>{if(workspace?.id)renderMeetings()});
    entryRoundRows=createFieldRows(['meetingRoundNo','meetingShortName']);
    // MTG-결과마크다운: 결과 원문·특이사항 [⤢] = 노트와 같은 쓰기 창(글자는 칸에 그대로 넣고 저장은 이 창의 저장)
    mountBigWrite($('#meetingTranscript'),{title:'결과 원문 크게 쓰기'});mountBigWrite($('#meetingNotes'),{title:'특이사항 크게 쓰기'});
    reportKitLoaded=true;
  },error=>{reportKitFlight=null;throw error});
}
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const GOOGLE_FN=SB+'/functions/v1/google-calendar';
const STATUS_LABEL={draft:'초안',review:'검토중',published:'게시',archived:'보관'};
let session=null,user=null,membership=null,workspace=null;
let members=[],profiles=[],spaces=[],events=[],meetings=[],documents=[];
const teamViewFlights=new Map(),teamViewLoaded=new Set();
let meetingSavePending=false,documentSavePending=false;
let meetingUploadEntries=[];
// BIZ-보고할일정 PR D: 창을 닫은 뒤 미리 골라 둔 그 시각 사진을 파일로 만드는 중인 묶음 수(아직 올리기 줄에 서기 전 — 새로 고치면 사라지므로 먼저 묻는다).
let timePhotosPreparing=0;
window.addEventListener('kptu:before-reload',event=>{if(meetingUploadEntries.some(entry=>entry.kind!=='success')&&!document.querySelector('#meetingModal')?.classList.contains('hidden')||meetingEntryDirty()||timePhotosPreparing>0)event.detail.otherDraft=true});
let monthCursor=seoulDate(seoulParts().year,seoulParts().month);
let googleState={connected:null,enabled:false,selected:[],calendars:[],events:[],email:null};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
const fmt=formatMeetingTime;
const dateKey=seoulDateKey;
const todayKey=()=>dateKey(new Date());
function setStatus(el,msg,type=''){if(!el)return;el.textContent=msg||'';el.className='status'+(type?' '+type:'');if(type==='error'){el.setAttribute('role','alert');el.removeAttribute('aria-live')}else{el.setAttribute('role','status');el.setAttribute('aria-live','polite')}}
function setBusy(button,busy){if(!button)return;button.disabled=!!busy;if(busy)button.setAttribute('aria-busy','true');else button.removeAttribute('aria-busy')}
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;kptuHoldToast(t)}
// 로그인 세션 저장은 runtime-client.js(KPTURuntime.session) 한 곳이 맡는다(loader-v2가 runtime을 먼저 불러온다).
function saveSession(s){session=s;window.KPTURuntime?.session?.write(s)}
function loadSession(){return window.KPTURuntime?.session?.read?.()||null}
async function refreshSession(){if(window.KPTURuntime?.session){const next=await window.KPTURuntime.session.refresh();session=next||null;return !!next}if(!session?.refresh_token)return false;const r=await fetch(SB+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});if(!r.ok){saveSession(null);return false}const d=await r.json();d.expires_at=d.expires_at||Math.floor(Date.now()/1000)+(d.expires_in||3600);saveSession(d);return true}
async function ensureSession(){if(window.KPTURuntime?.session){const ok=await window.KPTURuntime.session.ensure();session=window.KPTURuntime.session.read();return ok}if(!session)return false;if((session.expires_at||0)<Math.floor(Date.now()/1000)+60)return refreshSession();return true}
const API_MS=30000;
async function api(path,{method='GET',body=null,auth=true,prefer=''}={}){if(auth&&!(await ensureSession()))throw new Error('로그인이 필요합니다.');const isForm=typeof FormData!=='undefined'&&body instanceof FormData;const headers={apikey:KEY};if(!isForm)headers['Content-Type']='application/json';headers.Authorization='Bearer '+(auth?session.access_token:KEY);if(prefer)headers.Prefer=prefer;const started=performance.now();let r;
// LOAD-끝있는불러오기(S51-29): 한 번 읽기(GET)는 API_MS 안에 끝난다(받는 중 약속 teamViewFlights가 멈춘 채 다시 받기를 막지 않게). 넘으면 오류 → 화면 프로그램 받기 실패 표시([다시]).
let text;
try{
  const job=async signal=>{
    r=await fetch(SB+path,{method,headers,body:body===null?null:(isForm?body:JSON.stringify(body)),signal});
    window.__KPTU_STARTUP__?.request?.(SB+path,performance.now()-started,r.status);
    return r.text();
  };
  text=String(method).toUpperCase()==='GET'?await within(job,API_MS):await job(); // 쓰기는 끊지 않는다(결과를 모르게 되지 않게)
}catch(e){
  if(!r)window.__KPTU_STARTUP__?.request?.(SB+path,performance.now()-started,0);
  if(isLoadTimeout(e))throw new Error('요청 시간이 초과되었습니다. 다시 시도해 주세요.');
  throw e;
}let data=null;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.error_description||data?.hint||('요청 실패 '+r.status));return data}
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
function projectOptions(includeBlank=true,selected=''){return window.KPTUProjectCatalog?.options(selected,includeBlank)||(includeBlank?'<option value="">사업영역 없음</option>':'')}
function publishProjects(){if(window.KPTUProjectCatalog&&workspace?.id&&user?.id)window.KPTUProjectCatalog.publish({workspaceId:workspace.id,userId:user.id,spaces:spaces.filter(x=>x.owner_id===user.id)})}
function showOnly(id){document.body.classList.toggle('kptu-workspace-shell',id==='appView');['accessDeniedView','appView','bootView'].forEach(x=>{const el=$('#'+x);if(!el)return;const active=x===id;el.classList.toggle('hidden',!active);el.inert=!active;el.setAttribute('aria-hidden',active?'false':'true')})}
function showWorkspaceError(){const view=$('#bootView');if(!view)return;view.classList.remove('boot-quiet');view.querySelector('h2').textContent='업무 공간을 열 수 없어요.';view.querySelector('p').textContent='연결 상태를 확인한 뒤 다시 시도하거나 로그아웃해 주세요.';$('#bootErrorActions')?.classList.remove('hidden');showOnly('bootView')}
function enhanceDom(){
  const toolbar=$('#calendarView .calendar-toolbar');if(toolbar&&!$('#googleCalendarControls'))toolbar.insertAdjacentHTML('beforebegin',`<details id="googleCalendarPanel" class="calendar-google-panel"><summary><span>구글 캘린더</span><span id="googleAccountLabel" class="updated"></span></summary><div id="googleCalendarControls" class="google-bar"><button id="googleConnectBtn" class="secondary" type="button">구글 캘린더 연결</button></div><div id="googleCalendarList" class="google-cal-list hidden"></div></details>`);
}
async function logout(){try{if(session)await api('/auth/v1/logout',{method:'POST'})}catch{}saveSession(null);if(!window.KPTUAuthGate)location.replace('./login/')}
window.KPTUTeamAuth={logout};
function resetPrivateState(){reportChip=DEFAULT_KIND;areaChip='all';reportWeek=null;reportWeekIn='';reportPeriod='week';reportRange=null;reportPeriodChosen=false;periodPanel='';periodDraft=null;isoDraft=null;weekNumbered=false;areaTree=null;reportPlaceReady=false;meetingSelectedKind=null;meetingSelectedId=null;session=null;user=null;membership=null;workspace=null;members=[];profiles=[];spaces=[];events=[];meetings=[];documents=[];reportTargetMap=new Map();orgNames=new Map();meetingEntryTargets=[];googleState={connected:null,enabled:false,selected:[],calendars:[],events:[],email:null};teamViewFlights.clear();teamViewLoaded.clear();window.__KPTU_BOOT_CONTEXT__=null;window.KPTURuntime?.context?.clear?.();nameSortsAsked=false}
window.__KPTU_RESET_PRIVATE_STATE__=resetPrivateState;
window.addEventListener('kptu:session-changed',e=>{const next=e.detail?.session?.user?.id||'';if(next&&next===user?.id)return;resetPrivateState();window.KPTUAuthGate?.lock?.()});
async function loadWorkspaceState(){user=userFromSession()||await getUser();const prefetched=window.__KPTU_BOOT_MEMBERSHIP_PROMISE__?await window.__KPTU_BOOT_MEMBERSHIP_PROMISE__:null;const ms=prefetched?.ok?prefetched.rows:await api('/rest/v1/app_workspace_members?user_id=eq.'+encodeURIComponent(user.id)+'&select=workspace_id,role,workspace:app_workspaces(id,slug,name)&limit=1');if(!ms?.length){showOnly('accessDeniedView');void import('./workspace-start.js').then(m=>m.offerWorkspaceStart({rpc}),err=>console.warn('workspace start load failed',err?.name||'Error'));return}const row=ms[0];membership={workspace_id:row.workspace_id,role:row.role};workspace=Array.isArray(row.workspace)?row.workspace[0]:row.workspace;if(!workspace){const ws=await api('/rest/v1/app_workspaces?id=eq.'+membership.workspace_id+'&select=id,slug,name&limit=1');workspace=ws[0]}if(!workspace)throw new Error('웹2를 확인할 수 없어요.');window.__KPTU_BOOT_CONTEXT__={user,membership,workspace};window.KPTURuntime?.context?.set?.(window.__KPTU_BOOT_CONTEXT__);window.__KPTU_STARTUP__?.mark('workspaceReady');showOnly('appView');if($('#workspaceName'))$('#workspaceName').textContent='웹2';const admin=['owner','admin'].includes(membership.role);$$('.admin-only').forEach(x=>x.classList.toggle('hidden',!admin));window.__KPTU_START_TEAM_DATA__=()=>window.__KPTU_TEAM_DATA_READY__||(window.__KPTU_TEAM_DATA_READY__=loadAll().then(()=>{renderAll();window.__KPTU_STARTUP__?.mark('teamDataReady');if(new URLSearchParams(location.search).get('google')==='connected'){history.replaceState({},'',location.pathname);return loadGoogleStatus(false)}}))}
async function loadAll(){const wid=workspace.id;[members,profiles,spaces,meetings,documents]=await Promise.all([
 api('/rest/v1/app_workspace_members?workspace_id=eq.'+wid+'&select=workspace_id,user_id,role,created_at'),
 api('/rest/v1/app_profiles?user_id=eq.'+encodeURIComponent(user.id)+'&select=user_id,display_name,created_at,updated_at'),
 api('/rest/v1/app_spaces?workspace_id=eq.'+wid+'&select=*&order=sort_order.asc,created_at.asc'),
 readMeetings(api,wid),
 readDocuments(api,wid)
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
       readMeetings(api,wid),
       readDocuments(api,wid),
       reportKit()
     ]);
     publishProjects();fillSelects();restoreReportPlace();renderMeetings();
     void loadReportLinks().then(()=>{if(teamViewLoaded.has('meetings'))renderMeetings()});
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
function renderAll(){fillSelects();renderHome();renderCalendar();renderDocuments();renderMeetings()}
function fillSelects(){const po=projectOptions(true);['meetingProject'].forEach(id=>{if($('#'+id))$('#'+id).innerHTML=po})}
function renderHome(){}
// APP-낭비줄이기 ①: 달력은 그리는 함수가 이 하나다. 다른 파일(calendar-persistence·calendar-view·view-loader)의 '다시 그려 줘'는
// __KPTU_RENDER_CALENDAR__ = scheduleCalendarRender 로 받아 같은 프레임 안 요청을 requestAnimationFrame 한 번으로 합친다.
// 이 파일 안에서 바로 부르는 renderCalendar()는 그 자리에서 그리고, 기다리던 예약은 취소한다(방금 그린 것이 최신).
let calendarFrame=0;
function scheduleCalendarRender(){if(calendarFrame)return;calendarFrame=requestAnimationFrame(()=>{calendarFrame=0;renderCalendar()})}
function renderCalendar(){if(calendarFrame){cancelAnimationFrame(calendarFrame);calendarFrame=0}const y=seoulParts(monthCursor).year,m=seoulParts(monthCursor).month;$('#monthTitle').textContent=`${y}년 ${m+1}월`;(window.KPTUCalendarView||window.KPTUCalendarMonthView)?.render?.({year:y,month:m,googleEvents:googleState.events,googleState});renderGoogleControls();window.KPTUCalendarDayOverflow?.apply?.()}
window.__KPTU_RENDER_CALENDAR__=scheduleCalendarRender
function renderDocuments(){if(window.KPTULibrary?.render){window.KPTULibrary.render();return}const q=($('#documentSearch')?.value||'').trim().toLowerCase(),pid=$('#documentProject')?.value||'all';const rows=documents.filter(d=>(pid==='all'||d.project_id===pid)&&(!q||[d.title,d.source,d.category,(d.tags||[]).join(' ')].join(' ').toLowerCase().includes(q)));$('#documentList').innerHTML=rows.map(d=>`<article class="item-card"><div><div class="badges"><span class="badge">${esc(d.category)}</span>${d.project_id?`<span class="badge">${esc(projectName(d.project_id))}</span>`:''}</div><h3>${esc(d.title)}</h3><p>${esc(d.source||'출처 미기재')}${d.document_date?' · '+esc(d.document_date):''}</p>${d.description?`<small>${esc(d.description)}</small>`:''}</div>${/^https?:\/\//i.test(d.drive_url||'')?`<a class="mini" href="${esc(d.drive_url)}" target="_blank" rel="noopener noreferrer">열기</a>`:''}</article>`).join('')||emptyHtml()}
function meetingName(m){return String(m?.series_name||m?.title||'').trim()}
function meetingNameKey(name){return String(name||'').replace(/\s+/g,'').toLowerCase()}
function meetingNameChoices(kind=null){const seen=new Set();return [...(kind?filterByReportKind(meetings,kind):meetings)].sort((a,b)=>new Date(b.meeting_at)-new Date(a.meeting_at)).map(meetingName).filter(name=>{const key=meetingNameKey(name);if(!key||seen.has(key))return false;seen.add(key);return true})}
function installMeetingNamePicker(input,prefix){if(document.querySelector(`#${prefix}NameSelect`))return;input.insertAdjacentHTML('beforebegin',`<select id="${prefix}NameSelect" aria-label="이름 선택"></select>`);input.parentElement.insertAdjacentHTML('afterend',`<select id="${prefix}NameSort" class="mnp-new-sort" aria-label="새 회의명 종류" hidden></select><div id="${prefix}NameMatch" class="hidden" role="status"><span></span> <button id="${prefix}NameUseMatch" type="button" class="mini">이걸로</button></div>`)}
// S53-20 MTG-비정기회의접기: 회의명 고르기 상자는 작은 창(meeting-name-panel.js — 찾기 칸·정기 줄·상위 아래 접힌 비정기 묶음·⋯)으로 연다.
// 이름마다 가장 최근 회의 날을 함께 넘긴다(묶음 날짜·최근 차수 위). 상자의 option은 모든 이름(숨은 비정기 이름도 값으로 고를 수 있게)이고 보이기는 그 창이 정한다.
function meetingNameEntries(names){const latest=new Map();for(const m of meetings){const key=meetingNameKey(meetingName(m)),at=String(m.meeting_at||'');if(key&&(!latest.has(key)||at>latest.get(key)))latest.set(key,at)}return names.map(name=>({name,at:latest.get(meetingNameKey(name))||''}))}
let namePanel=null;
const loadNamePanel=()=>import('./meeting-name-panel.js').then(m=>(namePanel=m));
function meetingsNamed(name){const key=meetingNameKey(name);return key?meetings.filter(m=>meetingNameKey(meetingName(m))===key):[]}
// ⋯ [이름 바꾸기]: 그 이름의 내 보고 회의명(series_name, 짧은 이름이 없던 보고는 title도)을 새 이름으로. 내 작업공간 행만(owner RLS 그대로). 보고 글·연결은 그대로.
async function renameMeetingName(from,to){const next=String(to||'').trim(),rows=meetingsNamed(from);if(!next||!rows.length)return {ok:false,message:'바꿀 보고가 없어요.'};
  const same=new Set(rows.filter(m=>String(m.title||'').trim()===String(from).trim()||!String(m.title||'').trim()).map(m=>m.id)),rest=rows.filter(m=>!same.has(m.id)).map(m=>m.id),now=new Date().toISOString(),wid=encodeURIComponent(workspace.id);
  const patch=(ids,body)=>ids.length?api(`/rest/v1/app_meetings?workspace_id=eq.${wid}&id=in.(${ids.map(encodeURIComponent).join(',')})&select=id`,{method:'PATCH',body:{...body,updated_at:now},prefer:'return=representation'}):Promise.resolve([]);
  try{const a=await patch([...same],{series_name:next,title:next}),b=await patch(rest,{series_name:next});const n=(a?.length||0)+(b?.length||0);await reload(['meetings']);window.dispatchEvent(new CustomEvent('kptu:meetings-changed'));return n===rows.length?{ok:true,count:n}:{ok:false,message:`${n}건만 바꿨어요. 목록을 다시 열어 확인해 주세요.`}}
  catch(e){return {ok:false,message:'이름을 바꾸지 못했어요. 다시 해 주세요.'}}}
function setupMeetingNamePicker(select,input,match,use,{current='',names=meetingNameChoices(),onChoose=()=>{},onCustom=()=>{}}={}){
  select.replaceChildren();
  const add=(value,label)=>select.add(new Option(label,value));
  add('','이름 선택');names.forEach(name=>add(name,name));add('__other__','기타(직접 입력)');
  const chosen=names.find(name=>name===current);
  select.value=chosen||'__other__';input.value=current;
  select.classList.toggle('hidden',!names.length);
  const prefix=select.id.replace(/NameSelect$/,''),entries=meetingNameEntries(names);
  function update(){const custom=select.value==='__other__'||!names.length;input.classList.toggle('hidden',!custom);if(!custom)input.value=select.value;const equivalent=custom?names.find(name=>meetingNameKey(name)===meetingNameKey(input.value)&&name!==input.value.trim()):null;match.classList.toggle('hidden',!equivalent);match.querySelector('span').textContent=equivalent?`같은 이름이 있습니다: ${equivalent}`:'';use.onclick=()=>{select.value=equivalent;update()};
    namePanel?.paintNewSort(prefix,{custom,name:input.value,known:names.some(name=>meetingNameKey(name)===meetingNameKey(input.value))});if(custom)onCustom();else onChoose()}
  select.onchange=update;input.oninput=update;update();
  if(names.length)void loadNamePanel().then(m=>{if(!select.isConnected)return;m.bindPicker(select,{entries});update()},err=>console.warn('meeting name panel load failed',err?.name||'Error'));
}
// 다른 화면(자료실 회의 고르기 등)이 쓰는 회의 이름표도 회의 화면과 같은 차수·짧은 이름·회의 시각 규칙(MEET-결과정리 ①③).
function meetingDisplay(m){return {name:meetingName(m)||'회의명 미지정',meta:meetingRowMeta(m)}}
window.KPTUMeetingNames={installPicker:installMeetingNamePicker,choices:meetingNameChoices,setupPicker:setupMeetingNamePicker,count:name=>meetingsNamed(name).length,rename:renameMeetingName,commitSort:(prefix,name)=>loadNamePanel().then(m=>m.commitNewSort(prefix,name)).catch(()=>{}),label:m=>{const {name,meta}=meetingDisplay(m);return [name,...meta].join(' · ')}};
// MEET-결과정리 ②: 종류마다 서로 다른 색 칸(meeting-columns.js assignMeetingColors). 회의 목록이 바뀔 때만 다시 나눈다.
let meetingColorCache={source:null,slots:new Map()};
function meetingColor(name){const key=meetingNameKey(name);if(!key)return '#808080';if(meetingColorCache.source!==meetings)meetingColorCache={source:meetings,slots:assignMeetingColors(meetings,{nameOf:meetingName,keyOf:meetingNameKey})};const slot=meetingColorCache.slots.get(key);return meetingPaletteColor(slot??nameHash(key)%MEETING_HUES)}
// 회의 화면 목록 줄(폰)의 작은 글자: 차수(없으면 짧은 이름) · 회의 시각(①: 직접 지정 → 결과 글의 일시 → 날짜만).
// MTG-프로젝트합치기 ⑤: 일시가 없는 보고는 목록에서 빠지지 않고 '일시 없음'으로 보인다.
const NO_WHEN='일시 없음',whenText=m=>formatMeetingWhen(m)||NO_WHEN;
function meetingRowMeta(m){return [hasRound(m)||meetingShortName(m)?roundLabel(m):null,whenText(m)].filter(Boolean)}
// S52-22 TEAM-맨위한줄 → BIZ-위쪽정돈PC(11/09): 회의명은 모든 폭에서 맨 위 [종류 ▾] 고르기 상자 안 '회의명' 묶음이다(PC 칩·[회의명 ▾] 상자는 없앰). 고른 값은 이 화면이 열린 동안만 기억한다.
let meetingType='all';
function meetingTypeOptions(){const types=[...new Set(filterByReportKind(meetings,DEFAULT_KIND).map(meetingName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));return [{value:'all',label:'전체'},...types.map(name=>({value:name,label:name,color:meetingColor(name)})),{value:'__none__',label:'회의명 미지정',color:meetingColor('')}]}
function renderMeetingTypeOptions(){if(!meetingTypeOptions().some(o=>o.value===meetingType))meetingType='all'}
// 회의명 묶음은 [회의] 칩에서만, PC 세 칸 목록(왼쪽 회의 종류 칸이 같은 일을 함)에서는 없다. 폴드 두 칸 목록은 종류 칸이 없어 폰처럼 있다.
function threeCols(){return !!meetingPc?.matches&&!!meetingWide?.matches&&reportView==='list'&&reportChip===DEFAULT_KIND}
function nameFilterOn(){return reportChip===DEFAULT_KIND&&!threeCols()}
function typeFilter(){return reportChip===DEFAULT_KIND?meetingType:'all'}
// UI-PC회의 → MEET-결과정리 ⑤ → MEET-결과3단: 회의 화면을 그리는 곳은 여기 하나다. PC(≥1200, FOLD-넓은화면 2차 전에는 ≥761)는 왼쪽 회의 종류 / 가운데 차수·날짜·시간 /
// 오른쪽 고른 차수의 회의 결과(읽기용) 3단(meeting-columns.js), 폰은 지금 한 줄 목록. 고른 종류·차수는 이 화면이 열려 있는 동안만
// 기억한다(처음엔 가장 최근 결과가 있는 종류의 가장 최근 차수). 오른쪽 후속 할 일은 결과 창과 같은 읽기(google-tasks linked)로 따로 불러온다.
let meetingSelectedKind=null,meetingSelectedId=null;
// MTG-사업보고 4단계: 위쪽 칸 칩 줄(report-kinds.mjs). 고른 칩은 이 화면이 열려 있는 동안 기억하고 처음은 [회의](지금 기록은 모두 회의라 첫 화면이 그대로).
// [회의] 칩: PC 3단·폰 회의명 칩 그대로(폴드 펼침 600~1199px은 아래 2단 + 회의명 묶음). [전체]·다른 칸: PC·폴드는 '날짜·이름 목록 | 결과' 2단, 폰은 한 줄 목록(회의명 칩 없음). 그리는 주인은 renderMeetings 하나.
let reportChip=DEFAULT_KIND;
let reportPlaceReady=false;
// ACT-사진 6단계: [목록|달력|사진] 보기. 그리는 주인은 renderMeetings 하나(목록=기존 그리기, 달력·사진=아래 두 함수). 칸 칩·회의명 거르기는 세 보기에 똑같이 걸린다.
// 달력은 사업 보고 화면 안에서만 쓴다(일정 탭 달력과 섞지 않음). 보기 선택은 이 화면 안 상태이고 서버(view-prefs report_view)에 기억한다.
// 서버에서 읽은 기억은 사용자가 이번에 직접 고르기 전까지 그릴 때마다 따른다(팀 모듈이 기억을 읽기 전에 불러와질 수 있어 처음 값은 그릴 때 읽는다).
let reportView='list',reportViewChosen=false,reportMonth=(()=>{const p=seoulParts();return {year:p.year,month:p.month}})(),reportDay='',photoFocusId=null;
// UI-보기탭드롭다운(11/10 명진 'ㅇㅋㅇㅋ', 시안 docs/design/mockups/photos-top-dropdown.html): 보기 [목록|달력|사진] 탭 줄 대신 위 줄 기간 [주 단위 ▾] 옆 같은 고르기 상자 [목록 ▾] 하나(fillSelect, 열리는 작은 목록은 select-menu.js).
function renderReportViewSelect(){fillSelect($('#reportViewSelect'),{groups:[{options:REPORT_VIEW_OPTIONS.map(o=>({value:o.value,label:o.label}))}],value:reportView,on:false})}
// MTG-고치기바로: 세 번째 칸에서 고치던 내용이 있으면, 다른 줄·종류·칸·보기를 누를 때 그 자리에서 [저장] [버리기]를 묻고 고른 뒤에 간다(meeting-round-detail.js 문지기). 없으면 바로 간다.
// 물어서 멈췄으면(false) 눌린 칩은 원래 상태로 되돌려 그린다.
function leaveReport(go){const guard=window.KPTUMeetingRoundDetail?.guardLeave;if(!guard){go();return true}return guard(go)}
function selectReportView(next){next=reportViewOf(next);if(next===reportView)return;if(!leaveReport(()=>{reportViewChosen=true;reportView=next;viewPrefs.set('report_view',next);renderMeetings({resetList:true})}))renderReportViewSelect()}
function viewRows(){renderMeetingTypeOptions();const filter=typeFilter();return sortRecentFirst(reportRows().filter(m=>filter==='all'||(filter==='__none__'?!meetingName(m):meetingName(m)===filter)))}
const viewName=m=>meetingName(m)||'이름 없음',viewColor=m=>meetingColor(meetingName(m)),viewMeta=m=>[reportKindLabel(reportKindOf(m)),areaNameOf(m),...meetingRowMeta(m)].filter(Boolean).join(' · ');
function renderReportCalendar(box){meetingWhere(null);const active=box.contains(document.activeElement)?document.activeElement:null,keep=active?(active.dataset.rvNav?['data-rv-nav',active.dataset.rvNav]:active.dataset.rvDay?['data-rv-day',active.dataset.rvDay]:active.dataset.rvMore?['data-rv-more',active.dataset.rvMore]:null):null,keepPlan=keep?null:planFocusOf(active),dueOpen=!!box.querySelector('[data-rv-due]')?.open;planNow=reportPlans?.planView({month:reportMonth,todayKey:seoulDateKey(),nameFilter:typeFilter()})||null;box.innerHTML=calendarHtml({rows:viewRows(),month:reportMonth,selectedDay:reportDay,todayKey:seoulDateKey(),photos:photosByMeeting(documents),colorOf:viewColor,nameOf:viewName,metaOf:viewMeta,plan:planNow,planColorOf:planColor,dueOpen});mountStrips(box,()=>box.isConnected);mountReportDrag();if(keep)box.querySelector(`[${keep[0]}="${keep[1]}"]`)?.focus({preventScroll:true});else if(keepPlan)planFocusBack(box,keepPlan);wantReportPlans();showReportDay('',true)}
// S58-10 BIZ-보고할일정 PR C(설계 docs/design/biz-report-plan-link.md 4절): 달력에 □ 보고할 일정·점선 □ 보고할까요?·'안 쓴 보고 n'을 같이 그린다.
// 읽기·저장은 report-calendar-plans.js(달력을 처음 그릴 때 한 번 부름), 규칙은 report-calendar-plan.mjs. 그리는 곳은 위 renderReportCalendar 하나이고
// 여기는 지금 그린 값(planNow)과 단추 누름을 저장 길에 잇기만 한다. 서버에 새 표가 없으면 planNow=null → 표시 없이 지금 그대로.
let reportPlans=null,reportPlansFlight=null,planNow=null;const planBusy=new Set();
const planColor=item=>meetingColor(item.title);
// 읽기가 끝났거나 줄이 바뀌었을 때: 그릴 것이 지금 그린 것과 같으면 다시 그리지 않는다(보고할 일정이 없는 사람의 달력은 한 번만 그린다 — 다시 그리면 누르던 줄·끌던 보고가 끊긴다).
// 그림은 같아도 다음 읽기(이 달 일정)는 이어 가야 하므로 wantReportPlans는 부른다. 보고를 끄는 중이면 끝난 뒤에 그린다.
const planSig=p=>{if(!p)return '';const items=[...p.byDay.values()].flat();return items.length||p.overdue.length?JSON.stringify([items.map(i=>[i.eventId,i.status,i.day,i.title,i.startsAt]),p.overdue.map(i=>[i.eventId,i.day,i.title])]):''};
function redrawReportPlans(){if(!(workspace?.id&&reportKitLoaded&&reportView==='calendar'&&teamViewLoaded.has('meetings')))return;
  if(document.documentElement.classList.contains('cal-drag-on')){setTimeout(redrawReportPlans,400);return}
  const next=reportPlans?.planView({month:reportMonth,todayKey:seoulDateKey(),nameFilter:typeFilter()})||null;
  if(planSig(next)===planSig(planNow)){wantReportPlans();return}
  renderMeetings()}
function wantReportPlans(){if(reportPlans){reportPlans.wantPlans(reportMonth,redrawReportPlans);return}
  reportPlansFlight||=import('./report-calendar-plans.js').then(m=>{reportPlans=m;m.onPlansChanged(redrawReportPlans);$('#meetingList')?.addEventListener('keydown',planKeys);redrawReportPlans()},()=>{reportPlansFlight=null})}
function planItemOf(id){if(!planNow)return null;for(const list of planNow.byDay.values()){const hit=list.find(i=>i.eventId===id);if(hit)return hit}return planNow.overdue.find(i=>i.eventId===id)||null}
// 다시 그린 뒤 초점: 누른 단추가 있던 줄(그날 목록·'안 쓴 보고' 목록·칸)의 단추로. 줄이 없어졌으면(뺐거나 보고를 씀) 고른 날 숫자로.
function planFocusOf(el){if(!el)return null;if(el.matches('[data-rv-due]>summary'))return {summary:true};const row=el.closest('[data-rv-plan]');return row?{id:row.dataset.rvPlan,scope:row.closest('[data-rv-due]')?'[data-rv-due]':row.closest('.rv-table')?'.rv-table':'.rv-day-list'}:null}
function planFocusBack(box,k){const id=k.summary?'':CSS.escape(k.id),el=k.summary?box.querySelector('[data-rv-due]>summary'):box.querySelector(`${k.scope} [data-rv-plan="${id}"] button`)||box.querySelector(`${k.scope} [data-rv-plan="${id}"][tabindex]`)||box.querySelector('.rv-sel .rv-num');el?.focus({preventScroll:true})}
// [보고 쓰기] = 일정 창 [결과 남기기]와 같은 쓰기 창(일정 제목·시각·장소가 채워지고, 저장하면 보고 줄에 일정이 이어진다 — PR A).
function planWrite(id,trigger){const item=planItemOf(id);if(!item||!reportPlans)return;void window.KPTUReportEntry.open({...reportPlans.writeOptions(item,reportMonth),trigger:trigger?.isConnected?trigger:document.body,onSaved:()=>reportPlans.noteWritten(item.eventId)})}
// [보고할까요?](on)·⋯ [보고할 일정 ✓](off — 이 일정만 끔)·⋯ [빼기](skip — 같은 이름은 다시 묻지 않음). 저장되면 report-plan-data.js가 알려 다시 그린다.
// 저장하는 동안 같은 일정을 또 누르면 받지 않는다(planBusy). 단추를 꺼 두지는 않는다 — 꺼진 단추는 초점을 잃어, 다시 그린 뒤 그 줄로 초점을 돌려줄 수 없다.
async function planDecide(id,state){const item=planItemOf(id);if(!item||!reportPlans||planBusy.has(id))return;planBusy.add(id);
  try{await reportPlans.decidePlan(item,state);toast(reportPlans.DECIDED_TEXT[state])}
  catch(err){console.error('report plan decide',err);toast('저장하지 못했어요. 다시 눌러 주세요.')}
  finally{planBusy.delete(id)}}
function planMenu(id,trigger,at=null){const item=planItemOf(id);if(!item||!reportPlans)return false;return reportPlans.openPlanMenu(trigger,item,at,state=>void planDecide(id,state))}
// 칸 안 □ 줄(글자 단추 role=button)의 Enter·Space = 누름.
function planKeys(e){if((e.key==='Enter'||e.key===' ')&&e.target instanceof Element&&e.target.matches('[data-rv-plan-write][role="button"]')){e.preventDefault();e.target.click()}}
// 달력 안 보고할 일정 누름(reportViewClick 맨 앞에서 부른다). 받았으면 true.
function planClick(e){const t=e.target;const w=t.closest('[data-rv-plan-write]');if(w){planWrite(w.dataset.rvPlanWrite,w);return true}const a=t.closest('[data-rv-plan-ask]');if(a){void planDecide(a.dataset.rvPlanAsk,'on');return true}const m=t.closest('[data-rv-plan-more]');if(m){planMenu(m.dataset.rvPlanMore,m);return true}
  // '안 쓴 보고' 접는 줄·그날 목록의 보고할 일정 줄 바탕은 아무 일도 하지 않는다(펼치기는 브라우저가, 동작은 단추가) — 칸 고르기로 넘기지 않는다.
  return !!t.closest('[data-rv-due],.rv-plan-row')}
function renderReportPhotos(box){meetingWhere(null);const rows=viewRows(),photos=photosByMeeting(documents);box.innerHTML=photoViewHtml({rows,photos,colorOf:viewColor,nameOf:viewName,kindOf:m=>reportKindLabel(reportKindOf(m))});mountPhotoView(box,{rows,photos,api,onError:m=>toast(m),openReport:id=>import('./report-open.js').then(mod=>mod.openReport(id))});if(photoFocusId&&meetings.length){const el=box.querySelector(`[data-rv-set="${CSS.escape(photoFocusId)}"] .rv-set-head`);photoFocusId=null;if(el){el.scrollIntoView({block:'start'});el.focus({preventScroll:true})}}}
function reportViewClick(e){if(planClick(e))return true;const nav=e.target.closest('[data-rv-nav]');if(nav){const to=nav.dataset.rvNav;if(to==='today'){const p=seoulParts();reportMonth={year:p.year,month:p.month};reportDay=seoulDateKey()}else{reportMonth=shiftMonth(reportMonth,to==='next'?1:-1);reportDay=''}renderMeetings();return true}if(e.target.closest('[data-mrd-meeting]'))return false;const more=e.target.closest('[data-rv-more]');if(more){const day=more.dataset.rvMore;pickReportDay(day,false);showReportDay(day);return true}const cell=e.target.closest('[data-rv-cell]');if(cell){pickReportDay(cell.dataset.rvCell,false);return true}return false}
// S57-8: 그날 고르기 한 길(칸 누름·+n·우클릭 [이날 보기]). scroll = 그날 목록이 보이게.
function pickReportDay(day,scroll){reportDay=day;renderMeetings();if(scroll)$('#meetingList')?.querySelector('.rv-day-list')?.scrollIntoView?.({block:'nearest'})}
// MTG-프로젝트합치기 2단계: 칸 칩 아래 사업영역 칩([전체]·1단 사업영역·[꼬리표 없음 n]). 예전 프로젝트 화면 대신 여기서 사업영역별로 걸러 본다.
// 사업영역 = 프로젝트 트리(고르기 창과 같은 읽기 loadReportPlaces). 트리를 못 읽었으면 칩 줄을 숨기고 거르지 않는다. 고른 칩은 이 화면이 열린 동안만.
let areaChip='all',areaTree=null,areaTreeLoading=false;
function loadAreaTree(){if(areaTree||areaTreeLoading)return;areaTreeLoading=true;import('./report-places-sheet.js').then(s=>s.loadReportPlaces()).then(p=>{areaTree=p?.projects||[];renderAreaChips()},()=>{}).finally(()=>{areaTreeLoading=false})}
function areaMatch(list){if(!areaTree||areaChip==='all')return list;const roots=areaRoots(areaTree);return list.filter(m=>matchesAreaChip(m,areaChip,roots))}
// 목록 줄의 작은 글자는 직접 단 꼬리표만(옛 보고에 빌려 보이는 꼬리표는 보기 면에만).
function areaNameOf(m){if(!areaTree)return '';const id=areaIdOf(m),x=id&&areaTree.find(r=>String(r.project.id)===id);return x?[x.path,x.project.name].filter(Boolean).join(' › '):''}
let areaOptions=[];
function renderAreaChips(){loadAreaTree();const options=areaTree?areaChipOptions(filterByReportKind(meetings,reportChip),areaTree):[];areaOptions=options.length<2?[]:options;if(!areaOptions.length){if(areaChip!=='all')areaChip='all'}else if(!options.some(o=>o.value===areaChip))areaChip='all';renderReportSelects()}
// S52-22 TEAM-맨위한줄(요청 11/07 16:18, 시안 docs/design/mockups/report-top-bar.html): 맨 위는 언제나 한 줄 [종류 ▾][사업영역 ▾][녹음][⋯].
// 고르기는 공용 고르기 상자(<select>, 열리는 작은 목록은 select-menu.js)다. BIZ-위쪽정돈PC(명진 11/09 10:52 A): 종류는 모든 폭에서 [회의 ▾] 상자 하나(PC 종류 칩 줄은 없앰).
// 사업영역 상자 = 전체 · 각 사업영역 · 사업영역 없음('안 단 보고'는 목록 위 '사업영역 안 단 보고 n건 · 달기' 줄). 고른 값이 있으면 상자 글자가 진하다(is-on).
// 상자를 그리는 곳은 이 함수 하나이고, 상태 주인은 그대로 reportChip·meetingType·areaChip이다.
const KIND_PICK='kind:',NAME_PICK='name:';
function fillSelect(sel,{groups,value,on,show=true}){if(!sel)return;sel.hidden=!show;if(!show)return;const sig=JSON.stringify(groups);if(sel._pickSig!==sig){const opt=o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`;sel.innerHTML=groups.map(g=>g.title?`<optgroup label="${esc(g.title)}">${g.options.map(opt).join('')}</optgroup>`:g.options.map(opt).join('')).join('');sel._pickSig=sig}sel.value=value;sel.classList.toggle('is-on',!!on)}
const firstLabel=(options,label)=>options.map((o,i)=>i===0&&o.value==='all'?{...o,label}:o);
function nameChoices(){return meetingTypeOptions().filter(o=>o.value!=='all').map(o=>({value:o.value,label:o.label}))}
// S56-36 MTG-회의목록조직묶기: 회의명을 고르기 창과 같은 조직 머리글로 묶는다(값 = 내 프로필 meeting_name_sorts, 묶는 함수 = meeting-name-sorts.mjs orgSections 하나).
// 조직으로 묶지 않는 정리·읽기 전·읽기 실패면 null → 지금처럼 묶음 없이. 처음 한 번만 읽고(읽으면 다시 그림), 정리를 고치면 kptu:meeting-name-sorts 알림으로 다시 그린다.
let nameSortsAsked=false;
function nameSections(items,nameOf){const now=peekNameSorts?.();if(now?.status==='ok')return orgSections(items,now.sorts,nameOf);if(!nameSortsAsked&&readNameSorts){nameSortsAsked=true;readNameSorts().then(r=>{if(r?.status==='ok'&&teamViewLoaded.has('meetings'))renderMeetings()},()=>{})}return null}
window.addEventListener('kptu:meeting-name-sorts',()=>{if(workspace?.id&&teamViewLoaded.has('meetings'))renderMeetings()});
// [회의 ▾] 상자의 회의명: 조직으로 묶이면 조직마다 머리글 묶음(조직 순서, 묶음 안은 가나다), 아니면 지금처럼 '회의명' 묶음 하나.
function nameGroups(names){const opt=o=>({value:NAME_PICK+o.value,label:o.label});if(!names.length)return [];const sections=nameSections(names,o=>o.value==='__none__'?'':o.value);return sections?sections.map(g=>({title:g.label,options:g.items.map(opt)})):[{title:'회의명',options:names.map(opt)}]}
function renderReportSelects(){renderMeetingTypeOptions();const nameOn=nameFilterOn(),names=nameOn?nameChoices():[];
  const kinds=firstLabel(reportKindChips(meetings),'종류 전체').map(o=>({value:KIND_PICK+o.value,label:o.label}));
  fillSelect($('#reportKindSelect'),{groups:[{options:kinds},...nameGroups(names)],value:nameOn&&meetingType!=='all'?NAME_PICK+meetingType:KIND_PICK+reportChip,on:reportChip!==ALL_KINDS});
  fillSelect($('#reportAreaSelect'),{groups:[{options:firstLabel(areaOptions,'사업영역 전체')}],value:areaChip,on:areaChip!=='all',show:areaOptions.length>0})}
function reportSelectChange(e){const sel=e.target;if(sel.id==='reportViewSelect'){selectReportView(sel.value);return}if(sel.id==='reportAreaSelect'){selectAreaChip(sel.value);return}if(sel.id!=='reportKindSelect')return;const v=sel.value;
  if(v.startsWith(NAME_PICK)){selectMeetingType(v.slice(NAME_PICK.length));return}const kind=v.slice(KIND_PICK.length);
  if(kind===reportChip&&meetingType!=='all'){selectMeetingType('all');return}selectReportChip(kind)}
function selectMeetingType(value){if(value===meetingType)return;if(!leaveReport(()=>{meetingType=value;meetingSelectedId=null;renderMeetings({resetList:true})}))renderReportSelects()}
function selectAreaChip(value){if(value===areaChip)return;if(!leaveReport(()=>{areaChip=value;meetingSelectedId=null;renderMeetings({resetList:true})}))renderAreaChips()}
// MTG-프로젝트합치기 3단계(요청 10/28 19:07 ③): [목록] 보기는 주 단위(‹ › 주 넘기기, [전체]로 모든 주). 달력·사진 보기는 그대로 모든 주.
// 처음 주는 늘 이번 주(BIZ-주간표이번주 11/09, shownReportWeek). 고른 주는 이 화면이 열린 동안, 그 주(이번 주)가 지나기 전까지만 기억한다(기기·서버에 저장하지 않음).
// REPORT-기간고르기(S49-11) → S52-22 TEAM-맨위한줄(11/07): 기간은 한 줄 '‹ 11.2(월)~11.8(일) · n건 ›' + 오른쪽 작은 고르기 상자 [이번 주 ▾](이번 주 · 전체 기간 · 기간 정하기).
// 전체 기간은 '전체 · n건', 기간 정하기는 달력에서 시작·끝 날을 골라 '10.1~11.3 · n건 ×'. 다른 주로 넘기면 상자는 '주 단위'(그때 '이번 주'를 고르면 이번 주로), 정한 기간이면 '정한 기간'. '이번 주'를 고르면 어디서든 이번 주로 간다(BIZ-주간표이번주).
// 고른 보기·기간은 서버(view-prefs report_period)에 기억하고, 어느 주인지는 기억하지 않는다.
// BIZ-기간정하기·BIZ-주차고르기(11/09): periodPanel = 열린 작은 창(''·'range' 기간 정하기·'isoweek' 주차 고르기). weekNumbered = 주차 고르기로 고른 주라 'n주차'를 붙여 보임(‹ ›로 넘겨도 번호가 따라감).
let reportWeek=null,reportWeekIn='',reportPeriod='week',reportRange=null,reportPeriodChosen=false,periodPanel='',periodDraft=null,isoDraft=null,weekNumbered=false;
const weekOn=()=>reportView==='list'&&reportPeriod==='week';
const rangeOn=()=>reportView==='list'&&reportPeriod==='range'&&!!reportRange;
const todayWeek=()=>weekOf(seoulDateKey()).from;
function currentWeek(){return shownReportWeek(reportWeek,reportWeekIn,seoulDateKey())}
function pickWeek(from){reportWeek=from||null;reportWeekIn=todayWeek()}
function weekMatch(list){return weekOn()?inReportWeek(list,currentWeek()):rangeOn()?inRange(list,reportRange.from,reportRange.to):list}
function applyPeriodPref(){if(reportPeriodChosen)return;const p=periodFromPref(viewPrefs.get('report_period'));reportPeriod=p.mode;if(p.mode==='range')reportRange={from:p.from,to:p.to}}
function setPeriod(mode,range=null){reportPeriodChosen=true;reportPeriod=mode;if(range)reportRange=range;periodPanel='';periodDraft=null;isoDraft=null;meetingSelectedId=null;viewPrefs.set('report_period',prefFromPeriod({mode,...(mode==='range'?reportRange:{})}),{rejectable:true});renderMeetings({resetList:true})}
function renderReportWeek(){const host=$('#reportWeekFilter'),bar=host?.parentElement,pickHost=$('#reportPeriodPick');if(!host)return;const show=reportView==='list'&&meetings.length>0;if(bar)bar.hidden=!show;if(pickHost)pickHost.hidden=!show;if(!show){host.innerHTML='';if(pickHost)pickHost.innerHTML='';return}
  const mode=rangeOn()||reportPeriod!=='range'?reportPeriod:'all',list=filterByReportKind(meetings,reportChip),inList=mode==='week'?inReportWeek(list,currentWeek()):mode==='range'?inRange(list,reportRange.from,reportRange.to):list,none=undatedCount(inList),n=inList.length-none,count=`<small class="report-week-count">· ${n}건${none?` · ${NO_WHEN} ${none}`:''}</small>`;
  const thisWeek=weekOf(seoulDateKey()).from,numbered=mode==='week'&&weekNumbered,away=mode==='week'&&(currentWeek()!==thisWeek||numbered),held=mode==='range'&&!periodPanel,value=periodPanel||(away||held?'':mode);
  // BIZ-위쪽정돈(B안, 11/09): 기간 고르기 상자는 둘째 줄(회의·사업영역 옆), 주 넘기기 ‹ ›는 셋째 줄. 주를 고르는 곳은 이 한 곳이고 '이번 주 주간보고' 칸도 이 주를 따른다.
  const pick=`<select class="report-top-select report-period-select" data-report-period aria-label="기간 선택"><option value="" hidden>${held?'정한 기간':numbered?weekNumberName(currentWeek()):'주 단위'}</option>${PERIOD_CHOICES.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select>`;
  let nav='';
  if(mode==='week')nav=`<button type="button" class="icon-btn" data-report-week="prev" aria-label="이전 주">‹</button><span class="report-week-label" aria-live="polite">${numbered?`${weekNumberName(currentWeek())} · `:''}${esc(reportWeekLabel(currentWeek()))}</span><button type="button" class="icon-btn" data-report-week="next" aria-label="다음 주">›</button>${count}`;
  else if(mode==='all')nav=`<span class="report-week-label" aria-live="polite">전체</span>${count}`;
  else nav=`<span class="report-week-label" aria-live="polite">${esc(rangeLabel(reportRange.from,reportRange.to))}</span><button type="button" class="icon-btn report-period-x" data-report-week="clear" aria-label="기간 삭제">×</button>${count}`;
  let panel='';
  if(periodPanel==='range')panel=rangePanelHtml(periodDraft||(periodDraft=reportRange?{...reportRange,key:''}:{from:'',to:'',key:''}),quickRanges(seoulDateKey(),meetings));
  else if(periodPanel==='isoweek')panel=weekNumberPanelHtml(isoDraft||(isoDraft=isoPick(weekOn()?currentWeek():thisWeek)),seoulDateKey(),firstReportDay());
  // 작은 창은 기간 고르기 상자(둘째 줄) 바로 아래, 주 줄 위.
  host.innerHTML=`${panel}<div class="report-week-nav">${nav}</div>`;
  if(pickHost){pickHost.innerHTML=pick;const sel=pickHost.querySelector('[data-report-period]');sel.value=value;sel.classList.toggle('is-on',mode!=='week'||away)}
}
const isoPick=from=>{const w=isoWeekOf(from);return {year:w.year,week:w.week}};
function firstReportDay(){let first='';for(const m of meetings){const d=reportDayOf(m);if(d&&(!first||d<first))first=d}return first}
function reportWeekClick(e){
  // 기간 칩은 아래 날짜 칸만 채운다(BIZ-기간정하기). [적용]을 눌러야 정한다.
  const q=e.target.closest('[data-report-quick]');
  if(q){const r=quickRanges(seoulDateKey(),meetings).find(x=>x.key===q.dataset.reportQuick);if(r){periodDraft={from:r.from,to:r.to,key:r.key};renderReportWeek();$('#reportWeekFilter')?.querySelector(`[data-report-quick="${r.key}"]`)?.focus({preventScroll:true})}return}
  const b=e.target.closest('[data-report-week]');if(!b||b.disabled)return;const to=b.dataset.reportWeek;
  if(to==='cancel'){periodPanel='';periodDraft=null;isoDraft=null;renderReportWeek();return}
  if(to==='apply'){const host=$('#reportWeekFilter'),from=host.querySelector('[data-report-from]')?.value||'',end=host.querySelector('[data-report-to]')?.value||'';if(!validRange(from,end)){toast('시작 날짜와 끝 날짜를 확인해 주세요. 시작이 끝보다 늦을 수 없어요.');return}
    // [전체] 칩 그대로면 '전체 기간'으로.
    const all=periodDraft?.key==='all'&&periodDraft.from===from&&periodDraft.to===end;
    if(!leaveReport(()=>{weekNumbered=false;if(all)setPeriod('all');else setPeriod('range',{from,to:end})}))renderReportWeek();return}
  if(to==='iso-apply'){const d=isoDraft;if(!d)return;if(!leaveReport(()=>{weekNumbered=true;pickWeek(isoWeekStart(d.year,d.week));setPeriod('week')}))renderReportWeek();return}
  if(!leaveReport(()=>{
    if(to==='all'){weekNumbered=false;setPeriod('all')}
    else if(to==='week'||to==='clear'){weekNumbered=false;setPeriod('week')}
    else{pickWeek(shiftDays(currentWeek(),to==='next'?7:-7));meetingSelectedId=null;renderMeetings({resetList:true})}
  }))renderReportWeek()}
function reportPeriodPick(e){const sel=e.target.closest?.('[data-report-period]');if(!sel)return;const to=sel.value;
  if(to==='range'||to==='isoweek'){periodPanel=to;periodDraft=null;isoDraft=null;renderReportWeek();return}
  if(!leaveReport(()=>{weekNumbered=false;if(to==='all')setPeriod('all');else if(to==='week'){pickWeek(null);setPeriod('week')}}))renderReportWeek()}
function reportPeriodInput(e){
  const t=e.target;
  if(t.matches?.('[data-report-iso-year]')&&isoDraft){const year=Number(t.value);isoDraft={year,week:isoYearChanged(year,isoDraft.week,seoulDateKey())};renderReportWeek();$('#reportWeekFilter [data-report-iso-year]')?.focus({preventScroll:true});return}
  if(t.matches?.('[data-report-iso-week]')&&isoDraft){isoDraft.week=Number(t.value);return}
  if(!periodDraft)return;if(t.matches('[data-report-from]'))periodDraft={...periodDraft,from:t.value,key:''};else if(t.matches('[data-report-to]'))periodDraft={...periodDraft,to:t.value,key:''}}
// 다른 곳에서 고른 보고가 지금 주에 없으면 그 보고의 주로 옮긴다.
function weekFor(m){const day=reportDayOf(m);if(rangeOn()&&day&&(day<reportRange.from||day>reportRange.to)){reportPeriod='all';return true}if(!weekOn()||!day)return false;const from=weekOf(day).from;if(from===currentWeek())return false;pickWeek(from);return true}
// 새로 저장한(고친) 보고는 그 보고의 주로 옮겨 바로 보이게 한다. meetingAt은 쓰기 창의 서울 날짜·시각 'YYYY-MM-DDTHH:MM'.
function weekOfSaved(at){const day=String(at||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(day)){pickWeek(weekOf(day).from);if(rangeOn()&&(day<reportRange.from||day>reportRange.to))reportPeriod='all'}}
// MTG-프로젝트합치기 ⑤: 새로 저장한 보고는 그 주로 옮기고 고른 보고로 둔다. 사업영역 칩·회의명 거르기가 그 보고를 가리면 [전체]로 푼다.
function showSaved(m,at){weekOfSaved(at||(m?.meeting_at?seoulDateKey(m.meeting_at):''));if(!m?.id)return;meetingSelectedId=m.id;if(reportChip===DEFAULT_KIND){const n=meetingName(m);meetingSelectedKind=n?meetingNameKey(n):NONE_KEY;if(meetingType!=='all'&&meetingType!==(n||'__none__'))meetingType='all'}if(areaChip!=='all'&&areaTree&&!matchesAreaChip(m,areaChip,areaRoots(areaTree)))areaChip='all'}
function reportRows(){return weekMatch(areaMatch(filterByReportKind(meetings,reportChip)))}
function selectReportChip(value){const next=isReportChip(value)?value:DEFAULT_KIND;if(next===reportChip)return;if(!leaveReport(()=>{reportChip=next;meetingSelectedId=null;renderMeetings({resetList:true});writeReportPlace()}))renderReportSelects()}
function meetingColumnList(){return meetingColumns(weekMatch(areaMatch(filterByReportKind(meetings,DEFAULT_KIND))),{nameOf:meetingName,keyOf:meetingNameKey})}
function selectedMeetingColumn(columns=meetingColumnList()){return columns.find(c=>c.key===meetingSelectedKind)||columns[0]||null}
function renderMeetingRows(box){renderMeetingTypeOptions();const chip=reportChip,filter=typeFilter();const rows=sortRecentFirst(reportRows().filter(m=>filter==='all'||(filter==='__none__'?!meetingName(m):meetingName(m)===filter)));box.innerHTML=rows.map(m=>{const related=documents.filter(d=>d.meeting_id===m.id),color=meetingColor(meetingName(m)),name=meetingName(m)||'회의명 미지정',meta=[chip===ALL_KINDS?reportKindLabel(reportKindOf(m)):null,...meetingRowMeta(m),areaNameOf(m),related.length?MEETING_DOCS_LABEL:null].filter(Boolean).join(' · ');return `<article class="item-card meeting-list-row" data-mrd-meeting="${esc(m.id)}" data-report-kind="${esc(reportKindOf(m))}"${color?` style="--meeting-color:${color}"`:''} role="button" tabindex="0"><div class="meeting-list-main"><div class="meeting-list-title"><h3>${esc(name)}</h3></div><p>${esc(meta)}</p></div></article>`}).join('')||emptyHtml()}
// MTG-고치기바로: 세 번째 칸의 안쪽은 이 파일이 그리지 않는다. 칸(자리)만 만들고, 고른 사업 보고의 보기·고치기 창(meeting-round-detail.js의 창 요소 하나)을 붙인다.
// 창을 아직 못 불러왔으면 이 한 줄이 보이고, 창이 준비되면(kptu:report-detail-ready) 바로 바뀐다.
const meetingResult=()=>`<div class="mcol-wait" data-mcol-pending>${waitHtml({rows:5})}</div>`;
function undockReport(){window.KPTUMeetingRoundDetail?.undock?.()}
function dockReport(){const slot=$('#meetingList #mcolResult'),id=slot?.dataset.meetingResult,api=window.KPTUMeetingRoundDetail;if(!slot||!id||!api?.dock)return;void api.dock(slot,id)}
for(const name of ['kptu:report-detail-ready','kptu:report-pane-free'])window.addEventListener(name,()=>{if(meetingPc?.matches&&teamViewLoaded.has('meetings'))dockReport()});
// UI-상단줄제목: the 사업 보고 shown on the right goes to the PC top line's place (kptu:where-item, topbar-actions.js), named like the result head (name + round); null when none.
function meetingWhere(m){const round=m&&(reportKindOf(m)===DEFAULT_KIND||hasRound(m)||meetingShortName(m))?roundLabel(m):'';window.dispatchEvent(new CustomEvent('kptu:where-item',{detail:{view:'meetings',name:m?[meetingName(m)||'이름 없음',round].filter(Boolean).join(' '):null,trail:m?[{name:reportChip===ALL_KINDS?'전체':reportKindLabel(reportChip),step:'chip:'+reportChip}]:[]}}))}
// UI-상단줄중간단계(S48-30): 위쪽 줄 '사업 보고 › 칸 › 항목'의 칸을 누르면 그 칸으로(같은 칸이면 [종류 ▾] 상자에 초점).
window.addEventListener('kptu:where-step',e=>{if(e.detail?.view!=='meetings')return;const step=String(e.detail?.step||'');if(!step.startsWith('chip:'))return;const chip=step.slice(5);if(!isReportChip(chip))return;if(chip!==reportChip){selectReportChip(chip);return}$('#reportKindSelect')?.focus({preventScroll:false})});
function renderMeetingColumns(box,{resetList=false,resetResult=resetList}={}){const columns=meetingColumnList(),selected=selectedMeetingColumn(columns);meetingSelectedKind=selected?.key??null;const current=pickMeeting(selected,meetingSelectedId);meetingSelectedId=current?.id??null;meetingWhere(current);const active=document.activeElement?.closest?.('#meetingList')?document.activeElement:null,focusKey=active?{kind:active.dataset.meetingKind,round:active.dataset.meetingRound}:null;const handleAt=active?.classList?.contains('split-resize-handle')?[...box.querySelectorAll('.split-resize-handle')].indexOf(active):-1;const kindsTop=box.querySelector('.mcol-kinds')?.scrollTop||0,listTop=resetList?0:box.querySelector('.mcol-cards')?.scrollTop||0;box.innerHTML=columnsHtml(columns,{selectedKey:meetingSelectedKind,selectedId:meetingSelectedId,colorOf:meetingColor,whenOf:whenText,resultHtml:meetingResult,sections:nameSections(columns,c=>c.name)});const kinds=box.querySelector('.mcol-kinds'),list=box.querySelector('.mcol-cards');if(kinds)kinds.scrollTop=kindsTop;if(list)list.scrollTop=listTop;const layout=box.querySelector('.mcol-layout');const split=layout?mountSplitResize({container:layout,name:'reports3',inherit:'reports',label:'사업 보고 칸 폭 조절',columns:[{el:()=>box.querySelector('.mcol-kinds'),varName:'--ds-split-col-a',minVar:'--ds-split-col-min',minFallback:150,share:1.3,id:'mcolRounds'},{el:()=>box.querySelector('.mcol-rounds'),varName:'--ds-split-col-b',minVar:'--ds-split-col-b-min',minFallback:112,share:.8,id:'mcolResult'},{el:()=>box.querySelector('.mcol-result'),varName:'--ds-split-col-c',minVar:'--ds-split-detail-min',minFallback:360,share:5.9}],active:()=>!!meetingPc?.matches&&reportChip===DEFAULT_KIND&&box.contains(layout)}):null;if(handleAt>=0)split?.handles[handleAt]?.focus({preventScroll:true});if(focusKey){const [attr,value]=focusKey.kind!=null?['data-meeting-kind',focusKey.kind]:focusKey.round!=null?['data-meeting-round',focusKey.round]:[];if(attr){const el=[...box.querySelectorAll(`[${attr}]`)].find(e=>e.getAttribute(attr)===value);el?.focus({preventScroll:true})}}followResult(box,resetList);dockReport()}
// FOLD-넓은화면 2차: 폴드 펼침의 [회의] 두 칸 목록 줄은 PC 세 칸의 차수 줄처럼 날짜·차수만 붙인다(사업영역 이름이 길어 날짜·차수를 밀어내지 않게 — 사업영역은 오른쪽 결과 칸에 있음).
function renderReportList(box,{resetList=false,resetResult=resetList}={}){const rows=viewRows(),current=rows.find(m=>String(m.id)===String(meetingSelectedId))||rows[0]||null;meetingSelectedId=current?.id??null;meetingWhere(current);const active=document.activeElement?.closest?.('#meetingList')?document.activeElement:null,focusKey=active?{round:active.dataset.meetingRound}:null;const listTop=resetList?0:box.querySelector('.mcol-cards')?.scrollTop||0;const name=typeFilter();box.innerHTML=listHtml(rows,{selectedId:meetingSelectedId,label:name!=='all'?(name==='__none__'?'회의명 미지정':name):reportChip===ALL_KINDS?'전체':reportKindLabel(reportChip),nameOf:m=>meetingName(m)||'이름 없음',kindOf:m=>[reportChip===ALL_KINDS?reportKindLabel(reportKindOf(m)):'',reportChip===DEFAULT_KIND?'':areaNameOf(m)].filter(Boolean).join(' · '),colorOf:m=>meetingColor(meetingName(m)),whenOf:whenText,resultHtml:m=>meetingResult(m,{kindName:meetingName(m)||'이름 없음'})});const layout=box.querySelector('.mcol-layout'),list=box.querySelector('.mcol-cards');if(list)list.scrollTop=listTop;if(layout)mountSplitResize({container:layout,name:'reports',query:SPLIT_QUERY,label:'사업 보고 목록과 결과 칸 폭 조절',controls:'mcolRounds',list:()=>box.querySelector('.mcol-rounds'),pane:()=>box.querySelector('.mcol-result'),active:()=>!!meetingPc?.matches&&!threeCols()&&box.contains(layout)});if(focusKey){const [attr,value]=focusKey.round!=null?['data-meeting-round',focusKey.round]:[];if(attr)[...box.querySelectorAll(`[${attr}]`)].find(e=>e.getAttribute(attr)===value)?.focus({preventScroll:true})}followResult(box,resetList);dockReport()}
// UI-칸안스크롤하나로(시안 A): PC는 화면 스크롤 하나. 오른쪽 결과 칸은 화면에 붙어 따라오고(follow-pane.js), 다른 종류·목록으로 바꾸면(resetList)
// 칸들 머리가 화면 위로 지나가 있을 때 칸 머리로 올려 가운데 목록을 맨 위부터 보여 준다.
function followResult(box,resetList){if(!meetingPc?.matches)return;const pane=box.querySelector('.mcol-result'),layout=box.querySelector('.mcol-layout');if(pane)followPane(pane,{narrow:!meetingFramePc?.matches});if(resetList&&layout){const top=layout.getBoundingClientRect().top-stickTop();if(top<0)window.scrollBy({top:top-12,behavior:'instant'})}}
// MTG-프로젝트합치기 ③(10/29 시안 승인): 목록 맨 위 얇은 줄 '사업영역 안 단 보고 n건 [달기]' — 보고 있는 주(‹ ›로 넘긴 주) 안에 있을 때만, 0건이면 줄 없음.
// 그리는 곳은 여기 하나(renderMeetings가 부름), [달기] 창·저장은 report-area-tag.js(기존 app_meetings 저장 길).
function paintUntagged(){const line=$('#areaUntaggedLine');if(!line)return;const n=weekOn()&&meetings.length?untaggedInWeek(meetings,currentWeek()).length:0;line.hidden=!n||!weekBoxOpen;line.innerHTML=n?`<span class="area-untagged-text">사업영역 안 단 보고 <b>${n}</b>건</span><button type="button" class="area-untagged-btn" data-area-untagged aria-haspopup="dialog">달기</button>`:''}
function untaggedClick(e){const b=e.target.closest('[data-area-untagged]');if(!b)return;import('./report-area-tag.js').then(m=>m.openAreaTag(b,{meetings,from:currentWeek(),onSaved:n=>{paintUntagged();toast(`사업영역을 ${n}건 달았어요.`)},onMessage:toast}),err=>toast(err?.message||'사업영역 달기 창을 열지 못했어요.'))}
// WEEKLY-메뉴짝짓기 P5: 사업 보고 위 접는 칸 '이번 주 주간보고'(weekly-summary-table.js). 처음 펼칠 때 부품을 부르고, 보고가 바뀌면 펼쳐 있을 때만 다시 그린다.
// BIZ-위쪽정돈(B안): '이번 주 주간보고'는 주 단위에서는 늘 펼쳐 둔 칸이고, 주는 위 주 고르기(currentWeek)를 따른다. 부품(weekly-summary-table.js)은 처음 한 번만 불러온다.
// 달력·사진 보기는 주 고르기 줄이 없어 따라갈 주가 없으므로 이 칸도 [목록] 보기에서만 보인다(달력·사진을 아래로 밀지 않는다).
// BIZ-주간표이번주 ⑤⑥(11/09): 전체 기간·정한 기간(목록이 여러 주)이면 이 칸은 늘 이번 주이고 접힌 한 줄('이번 주 주간보고 11.9~11.15 ⌄')로 시작한다(누르면 펼침, 접힘은 기억하지 않음).
// BIZ-주간보고접기(요청함 11/09 18:16): 처음 들어오면 펼침(주 단위), 사업 보고 하나를 직접 열면(PC 가운데 줄 누르기·폰 줄 눌러 창) 자동으로 접고
// 창을 닫으면 다시 펼친다. 제목 줄로 언제든 손으로 접고 펴며, 손으로 고른 것은 이 화면에 머무는 동안 자동보다 우선(부품이 가짐).
// 화면을 떠나면 weekVisit을 올려 손으로 고른 것·자동 접힘을 잊는다. 위 띠 '사업영역 안 단 보고 n건'도 칸과 같이 접힌다(weekBoxOpen).
let weekAuto=false,weekVisit=0,weekBoxOpen=true;
function weekBoxFolded(open){if(weekBoxOpen===open)return;weekBoxOpen=open;paintUntagged()}
function setWeekAuto(on){if(weekAuto===on)return;weekAuto=on;if(teamViewLoaded.has('meetings')&&reportKitLoaded)syncWeekBox()}
window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view!=='meetings'){weekVisit++;weekAuto=false;return}if(teamViewLoaded.has('meetings')&&reportKitLoaded)syncWeekBox()});
window.addEventListener('kptu:report-open',()=>{if(window.KPTURouter?.current==='meetings')setWeekAuto(true)});
window.addEventListener('kptu:report-pane-free',()=>setWeekAuto(false));
function syncWeekBox(){const el=$('#bizWeekBox');if(!el)return;el.hidden=reportView!=='list';if(el.hidden)return;const many=!weekOn(),bw=el.querySelector('[data-bw-body]');if(bw&&!el.dataset.bpMounted){bw.hidden=many||weekAuto;el.querySelector('[data-bw-fold]')?.setAttribute('aria-expanded',String(!bw.hidden))} /* 모듈이 오기 전에도 접힌 보기는 한 줄, 펼친 보기는 표 자리를 차지 */ const week=many?todayWeek():currentWeek();import('./weekly-summary-table.js').then(m=>m.mountWeekSummary(el,{meetings:()=>meetings,week,fold:many,auto:weekAuto,visit:weekVisit,onFold:weekBoxFolded}),err=>toast(err?.message||'주간보고 칸을 열지 못했어요.'))}
function renderMeetings(opts){const box=$('#meetingList');if(!box||!reportKitLoaded)return;undockReport();if(!reportViewChosen)reportView=reportViewOf(viewPrefs.get('report_view'));applyPeriodPref();renderAreaChips();renderReportViewSelect();renderReportWeek();paintUntagged();syncWeekBox();const pc=!!meetingPc?.matches,listView=reportView==='list',columns=threeCols();box.classList.toggle('meeting-columns',pc&&listView);box.dataset.reportKind=reportChip;box.dataset.reportView=reportView;if(reportView==='calendar')renderReportCalendar(box);else if(reportView==='photo')renderReportPhotos(box);else if(columns)renderMeetingColumns(box,opts);else if(pc)renderReportList(box,opts);else renderMeetingRows(box)}
// NAV-새로고침제자리(S48-30): 사업 보고의 고른 칸 칩(?chip=, [회의]면 생략)과 고른 보고(?report=)를 주소에 적어 새로고침 뒤 같은 자리. 사용자가 칸·회의명·보고를 고를 때만 적고(그릴 때마다 적지 않음 — 기록 이동 중 주소를 건드리지 않게), 자료를 처음 읽을 때 한 번 주소에서 되살린다.
function restoreReportPlace(){if(reportPlaceReady)return;reportPlaceReady=true;const q=new URLSearchParams(location.search),raw=['reports','meetings'].includes(q.get('view'))?{chip:q.get('chip'),report:q.get('report')}:{},placed=window.KPTURouter?.place?.('meetings')||{},at=placed.chip||placed.report?placed:raw;if(at.chip&&isReportChip(at.chip))reportChip=at.chip;if(!at.report)return;const m=meetings.find(x=>String(x.id)===String(at.report));if(!m)return;if(reportChip!==ALL_KINDS&&reportKindOf(m)!==reportChip)reportChip=reportKindOf(m);weekFor(m);meetingSelectedId=m.id;if(reportChip===DEFAULT_KIND){const n=meetingName(m);meetingSelectedKind=n?meetingNameKey(n):NONE_KEY;if(meetingType!=='all'&&meetingType!==(n||'__none__'))meetingType='all'}}
function writeReportPlace(){if(!reportPlaceReady||window.KPTURouter?.current!=='meetings')return;window.KPTURouter.setPlace?.('meetings',{chip:reportChip===DEFAULT_KIND?null:reportChip,report:meetingSelectedId!=null?String(meetingSelectedId):null})}
function selectMeetingKind(key){if(key===meetingSelectedKind){setWeekAuto(true);return}leaveReport(()=>{const had=meetingSelectedId!=null;meetingSelectedKind=key;meetingSelectedId=null;weekAuto=true;renderMeetings({resetList:true});pickReport(had);writeReportPlace()})}
function selectMeetingRound(id){if(String(id)===String(meetingSelectedId)){setWeekAuto(true);return}leaveReport(()=>{const had=meetingSelectedId!=null;meetingSelectedId=id;weekAuto=true;renderMeetings({resetResult:true});pickReport(had);writeReportPlace()})}
// NAV-PC뒤로직전(명진 결정 11/11 (나)): on PC a report (or a column of reports) the person picks is a back step of its own (router pick, one owner).
// The report the screen opened by itself (the first one) is not a step. Back/forward to a picked entry shows that report again; one no longer there shows the list (first report).
function pickReport(had=true){if(!meetingPc?.matches||reportView!=='list'||meetingSelectedId==null||window.KPTURouter?.current!=='meetings')return;window.KPTURouter.pick?.record?.('meetings',{chip:reportChip===DEFAULT_KIND?null:reportChip,report:String(meetingSelectedId)},{fromNone:!had})}
function showPickedReport({report}={}){if(!meetingPc?.matches||window.KPTURouter?.current!=='meetings'||!reportKitLoaded)return true;if(report&&String(report)===String(meetingSelectedId))return true;const m=report?meetings.find(x=>String(x.id)===String(report)):null;if(!m){leaveReport(()=>{meetingSelectedId=null;renderMeetings({resetResult:true});writeReportPlace()});return true}window.KPTUMeetingColumns.select({id:m.id});writeReportPlace();return true}
window.KPTURouter?.pick?.on?.('meetings',showPickedReport);
// UI-상단줄 ← →: show a recorded meeting result again (its kind, then the round), through the same one renderer.
// MTG-사업보고 4단계: 고른 건이 지금 칩에 없으면(칸을 바꿨거나 다른 칸 건을 열 때) 그 건의 칸 칩으로 옮긴다. 폰은 칩만 옮긴다.
window.KPTUMeetingColumns={showPhotos:id=>{if(!id)return;leaveReport(()=>{reportViewChosen=true;reportChip=ALL_KINDS;meetingSelectedId=null;photoFocusId=String(id);reportView='photo';viewPrefs.set('report_view','photo');renderMeetings({resetList:true})})},select:item=>{if(!item?.id)return;leaveReport(()=>{if(reportView!=='list'){reportViewChosen=true;reportView='list'}const m=meetings.find(x=>String(x.id)===String(item.id));let chipChanged=m?weekFor(m):false;if(m&&reportChip!==ALL_KINDS&&reportKindOf(m)!==reportChip){reportChip=reportKindOf(m);chipChanged=true}if(!meetingPc?.matches){if(chipChanged)renderMeetings({resetList:true});return}if(!threeCols()){if(m&&typeFilter()!=='all'&&(typeFilter()==='__none__'?!!meetingName(m):meetingName(m)!==typeFilter())){meetingType='all';chipChanged=true}meetingSelectedId=item.id;renderMeetings(chipChanged?{resetList:true}:{resetResult:true});return}const key=item.kind??(m?(meetingName(m)?meetingNameKey(meetingName(m)):NONE_KEY):meetingSelectedKind),kindChanged=chipChanged||key!==meetingSelectedKind;meetingSelectedKind=key;meetingSelectedId=item.id;renderMeetings(kindChanged?{resetList:true}:{resetResult:true})})},
  // 열기 길(meeting-round-detail.js open)이 PC 사업 보고 화면 위에서 팝업 대신 쓴다: 세 칸·두 칸이 떠 있으면 그 건을 고르고 true, 아니면 false(팝업).
  reveal:id=>{if(!meetingPc?.matches||reportView!=='list'||(window.KPTURouter&&window.KPTURouter.current!=='meetings')||window.KPTUAreaWindow?.isOpen?.()||!$('#meetingList #mcolResult'))return false;/* MTG-프로젝트합치기 ①: 사업영역 관리 창 안에서 연 보고는 그 창 위 팝업 */const m=meetings.find(x=>String(x.id)===String(id));if(!m)return false;weekAuto=true;window.KPTUMeetingColumns.select({id:m.id});return true}};
function meetingListClick(e){if(reportView!=='list'&&reportViewClick(e))return;const kind=e.target.closest('[data-meeting-kind]');if(kind){selectMeetingKind(kind.dataset.meetingKind);return}const round=e.target.closest('[data-meeting-round]');if(round){selectMeetingRound(round.dataset.meetingRound);return}}
// 왼쪽 종류 목록·가운데 차수 목록: 위·아래 화살표로 같은 목록 안에서 옮겨 다니고(Home·End 처음·끝), Enter·Space로 고른다(버튼 기본 동작).
// S51-27 UI-PC우클릭: PC에서 보고 줄을 우클릭하면 그 줄을 고른 것(왼쪽 누름과 같음)으로 하고, 그 보고가 오른쪽 칸에 뜨면 그 보고의 ⋯ 메뉴
// ([수정][종류 바꾸기][삭제], meeting-round-detail.js)를 누른 자리에 연다. 예전에는 공용 우클릭이 지금 떠 있는 다른 보고의 ⋯를 눌렀다.
// 목록 보기는 그 보고가 오른쪽 칸에 앉은 뒤 그 ⋯를 누른 자리에 연다. 달력·사진 보기는 창을 열지 않고 같은 메뉴를 그 줄 자리에 연다(reportViewMenu → menuAt, S58-16).
async function openReportMenuAt(id,at){
  for(let i=0;i<180;i++){const modal=document.querySelector('#meetingRoundDetailModal'),more=document.querySelector('#mrdMore');
    if(modal?.dataset.meetingId===id&&more&&!more.classList.contains('hidden')&&more.getClientRects().length){window.KPTUContextMenu?.pinAt?.(more,at.x,at.y);more.click();return}
    await new Promise(r=>requestAnimationFrame(r))}}
// 달력·사진 보기: 보고(칸 안 제목·그날 목록 줄·'+n' 그날 창 줄·사진 보기 머리) 우클릭 = 목록 보기와 같은 보고 메뉴, 달력 빈 칸 우클릭 = [이날 사업 보고 추가][이날 보기].
// 키보드 메뉴 키·Shift+F10도 같은 contextmenu라 포커스 받은 제목·숫자 단추에서 같은 메뉴가 열린다. 폰 폭·꾹 누르기·글자 칸은 appMenuPoint가 기본 메뉴로 남긴다.
// S58-16 BIZ-달력우클릭창뜸: 보고 우클릭은 메뉴만 — 보고 창은 왼쪽 누를 때만 연다. 메뉴는 보고 창 ⋯와 같은 부품을 창 밖에서 여는 한 길(meeting-round-detail.js menuAt)이고,
// [수정]을 고르면 그때 수정 창, [종류 바꾸기]·[삭제]는 창 없이 그 자리에서. before = [수정]으로 창을 열기 전에 할 일(그날 창이 부를 때 그 창 닫기).
function reportViewMenu(e,{before=null}={}){
  const t=e.target instanceof Element?e.target:null;if(!t)return false;
  const rep=t.closest('[data-mrd-meeting]');
  if(rep&&!t.closest('button,a,input,select,textarea')){const at=appMenuPoint(e,rep);if(!at)return false;e.preventDefault();void window.KPTUMeetingRoundDetail?.menuAt?.(String(rep.dataset.mrdMeeting),rep,at,{before});return true}
  // S58-10: 칸 안 보고할 일정 줄(⋯ 단추가 없는 자리) 우클릭 = 그날 목록 그 줄의 ⋯와 같은 메뉴. ⋯가 있는 줄(그날 목록·'안 쓴 보고' 목록)의 우클릭은
  // 사이트 공통 우클릭(context-menu.js)이 그 줄의 ⋯를 눌러 준다 — 여기서 받지 않고 넘긴다(칸 메뉴로도 가지 않게).
  const plan=reportView==='calendar'?t.closest('#meetingList .rv-table [data-rv-plan]'):null;
  if(plan){const at=appMenuPoint(e,plan);if(!at)return false;e.preventDefault();return planMenu(plan.dataset.rvPlan,plan,at)}
  if(reportView==='calendar'&&t.closest('[data-rv-due],.rv-plan-row'))return false;
  const cell=reportView==='calendar'?t.closest('[data-rv-cell]'):null;if(!cell)return false;
  const at=appMenuPoint(e,cell);if(!at)return false;e.preventDefault();
  void reportActions().then(a=>a.openReportDayMenu(cell,at,{add:(day,from)=>newReport(from.querySelector('.rv-num')||from,day),show:day=>pickReportDay(day,true)}));return true}
// 끌어 옮기기(PC)·저장·되돌리기는 report-calendar-actions.js(달력을 처음 그릴 때 한 번 부름 — 사업 보고 밖 화면의 첫 로딩에 싣지 않음).
let reportActionsFlight=null,reportMover=null;
const reportActions=()=>reportActionsFlight||=import('./report-calendar-actions.js');
// BIZ-달력그날창: '+n' → 그 칸 자리에 그날 보고 전부(일정 달력과 같은 그날 창, report-calendar-actions.js showReportDayWindow). 창을 채우는 길은 이것 하나다 —
// 달력을 다시 그릴 때(renderReportCalendar)도 창이 열려 있으면 again으로 같은 길을 타 그날 줄을 다시 채우고, 그날 '+n'이 없어졌거나 달력 보기가 아니면 닫는다.
function showReportDay(day,again=false){void reportActions().then(a=>{if(again&&!(day=a.reportDayWindowDay()))return;const box=$('#meetingList'),on=reportView==='calendar'&&!!box;
  return a.showReportDayWindow({day,again,rows:on?viewRows():[],colorOf:viewColor,nameOf:viewName,anchor:()=>box?.querySelector(`[data-rv-cell="${day}"]`),trigger:()=>on?box.querySelector(`[data-rv-more="${day}"]`):null,
    plans:on?planNow?.byDay.get(day)||[]:[],planColorOf:planColor,plan:(kind,id)=>kind==='write'?planWrite(id,box?.querySelector(`[data-rv-more="${day}"]`)):void planDecide(id,'on'),
    open:id=>void window.KPTUMeetingRoundDetail?.open?.(id),add:d=>newReport(box?.querySelector(`[data-rv-more="${d}"]`)||document.activeElement,d),menu:reportViewMenu})},()=>{})}
function mountReportDrag(){void reportActions().then(a=>{reportMover||=a.createReportDayMover({api,workspaceId:()=>workspace?.id,meetingOf:id=>meetings.find(x=>String(x.id)===String(id)),reload:()=>window.__KPTU_RELOAD_MEETINGS__(),setDay:d=>{reportDay=d},toast});a.installReportDrag({move:reportMover})},()=>{})}
async function meetingListMenu(e){if(reportView!=='list'&&reportViewMenu(e))return;const round=e.target.closest?.('[data-meeting-round]');if(!round)return;const at=appMenuPoint(e,round);if(!at)return;e.preventDefault();
  const id=String(round.dataset.meetingRound);if(String(meetingSelectedId)!==id)selectMeetingRound(id);
  await openReportMenuAt(id,at)}
function meetingKindKeys(e){const item=e.target.closest?.('[data-meeting-kind],[data-meeting-round]');if(!item||!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;const all=[...$$(item.dataset.meetingKind!=null?'#meetingList [data-meeting-kind]':'#meetingList [data-meeting-round]')],i=all.indexOf(item);const next=e.key==='Home'?all[0]:e.key==='End'?all.at(-1):all[i+(e.key==='ArrowDown'?1:-1)];if(next){e.preventDefault();next.focus()}}
// ④ [+ 회의 결과]는 화면 위 하나. PC에서는 왼쪽에서 고른 종류를 미리 고른 채 연다(만들기 창에서 바꿀 수 있음). 폰은 지금처럼 비운 채.
// FOLD-넓은화면 2차: 폴드 펼침(600~1199px)은 종류 칸이 없으므로 위 [종류 ▾]에서 고른 회의명을 미리 고른다(PC 1200px~는 그대로 왼쪽에서 고른 종류).
function newMeetingName(){if(!meetingPc?.matches||reportChip!==DEFAULT_KIND)return '';if(!meetingWide?.matches)return meetingType!=='all'&&meetingType!=='__none__'?meetingType:'';const c=selectedMeetingColumn();return c&&c.key!==NONE_KEY?c.name:''}
function suggestMeetingRound(){if(meetingRoundEdited||entryKind()!==DEFAULT_KIND)return;const key=meetingNameKey($('#meetingTitle')?.value),round=$('#meetingRoundNo');if(!round)return;let max=0;for(const m of meetings){const value=Number(m.round_no);if(key&&meetingNameKey(meetingName(m))===key&&Number.isSafeInteger(value)&&value>max)max=value}round.value=max?String(max+1):''}
let meetingRoundEdited=false;
// FILE-누르면동작: 회의자료 줄을 누르면 종류별 동작(file-actions.js).
function openModal(id,{trigger=document.activeElement,initialFocus=null,onRequestClose=null}={}){const m=$('#'+id);if(!m)return;m.classList.remove('hidden');m.setAttribute('aria-hidden','false');window.KPTUA11y?.dialog.activate(m,{trigger,initialFocus,onRequestClose:onRequestClose||(()=>closeModal(id))})}
function closeModal(id,{restoreFocus=true}={}){const m=$('#'+id);if(!m)return;m.classList.add('hidden');m.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate(m,{restoreFocus,fallbackFocus:'#appView .view-panel:not(.hidden) h2'})}
async function saveDocument(){if(documentSavePending)return;const title=$('#docTitle').value.trim();if(!title)return setStatus($('#documentStatus'),'자료명을 입력해 주세요.','error');const projectId=$('#docProject').value||null;const button=$('#saveDocumentBtn'),originalLabel=button.textContent;documentSavePending=true;setBusy(button,true);button.textContent='저장 중…';try{await api('/rest/v1/app_documents',{method:'POST',body:{workspace_id:workspace.id,project_id:projectId,title,category:$('#docCategory').value.trim()||'기타',source:$('#docSource').value.trim()||null,document_date:$('#docDate').value||null,description:$('#docDescription').value.trim()||null,tags:$('#docTags').value.split(',').map(x=>x.trim()).filter(Boolean),drive_url:$('#docUrl').value.trim()||null,visibility:'private',uploaded_by:user.id},prefer:'return=representation'});if(projectId)window.KPTUDriveSummary?.saved?.();closeModal('documentModal');await reload(['documents']);window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:projectId}}));toast('자료를 등록했습니다.')}catch(e){setStatus($('#documentStatus'),e.message,'error')}finally{documentSavePending=false;setBusy(button,false);button.textContent=originalLabel}}
// UI-회의결과창정리: 파일 한 줄(종류·이름·상태·×). 새 회의는 아직 저장 전이라 회의 결과를 저장할 때 차례로 올린다.
const MEETING_FILE_LABEL={pending:'저장할 때 올림',uploading:'올리는 중…',success:'완료'};
function renderMeetingSelectedFiles(){
 const box=$('#meetingSelectedFiles'),input=$('#meetingFiles');if(!box||!input)return;
 input.disabled=meetingSavePending;if($('#meetingPickFiles'))$('#meetingPickFiles').disabled=meetingSavePending;
 // ACT-사진 3단계: 고른 파일 중 사진은 위 '사진' 줄(작은 미리보기), 나머지만 이 자료 줄. 올리는 길은 같다(저장할 때 차례로).
 const photoBox=$('#meetingSelectedPhotos');if(photoBox)paintLocalPhotos(photoBox,meetingUploadEntries.map((entry,index)=>({...entry,index})).filter(entry=>isPhotoFile(entry.file)),{busy:meetingSavePending});
 const pickPhotos=$('#meetingPickPhotos'),photoInput=$('#meetingPhotoFiles');if(pickPhotos)pickPhotos.disabled=meetingSavePending;if(photoInput)photoInput.disabled=meetingSavePending;
 const fileEntries=meetingUploadEntries.map((entry,index)=>({entry,index})).filter(({entry})=>!isPhotoFile(entry.file));
 box.innerHTML=fileEntries.length?fileEntries.map(({entry,index})=>fileLine({name:entry.file.name,state:entry.kind,label:entry.label||MEETING_FILE_LABEL[entry.kind]||'',attrs:` data-meeting-file="${index}"`,end:entry.kind==='success'?'':`<button class="icon-btn file-line-x" type="button" data-meeting-remove-file="${index}" aria-label="${esc(entry.file.name)} 선택 취소"${meetingSavePending?' disabled':''}>×</button>`})).join(''):(meetingUploadEntries.length?'':emptyHtml());
 paintMeetingUploads();
}
// UI-올리기진행표시 ②: 올리는 동안 자료 줄 안에 막대 + % + ✕, 사진 칸 위에 흐린 막대 + %(공용 부품 upload-progress.js). 다른 화면으로 가면 하단바 위 한 줄.
function paintMeetingUploads(){
 const box=$('#meetingSelectedFiles');box?.querySelectorAll('[data-meeting-file]').forEach(row=>{const entry=meetingUploadEntries[Number(row.dataset.meetingFile)];paintUploadLine(row,entry?.kind==='uploading'?entry.file:null)});
 const tiles=[...($('#meetingSelectedPhotos')?.querySelectorAll('.act-photo-local')||[])],photos=meetingUploadEntries.filter(entry=>isPhotoFile(entry.file));
 tiles.forEach((tile,at)=>{const entry=photos[at];if(entry)paintUploadOverlay(tile,entry.kind==='uploading'?entry.file:null)});
}
watchUploads(()=>{if(meetingSavePending)paintMeetingUploads()});
// BIZ-저장먼저닫기: 창이 닫힌 뒤 고른 사진·자료를 공용 뒤 줄 한 묶음으로 넘긴다. 자료실 올리기를 불러오지 못하면 하단바 위 한 줄에 알리고 [다시 올리기]로 같은 파일을 다시 넘긴다(파일은 이 탭 메모리에만).
// BIZ-보고할일정 PR D(요청 ⑤): picks = 쓰기 창에 미리 골라 둔 그 시각 사진(폰·원드라이브 칸). 창이 닫힌 뒤 여기서 파일로 만들어(prepareTimePhotos) 고른 사진·자료와 한 묶음으로 넘긴다(새 올리기 줄 없음).
async function sendReportFiles(target,files,ready=null,picks=[]){if(picks?.length){const made=await prepareTimePhotos(target,picks);if(!made)return;files=[...files,...made]}if(!files.length)return;try{await (ready||ensureLibraryUpload());if(typeof window.KPTULibrary?.sendForMeeting!=='function')throw new Error('자료실 올리기를 불러오지 못했어요.');window.KPTULibrary.sendForMeeting(target,files)}catch(e){console.warn('report files hand-off failed',e);const photos=files.filter(file=>isPhotoFile?.(file)).length;announceDock({text:sendFailLine({badPhotos:photos,badFiles:files.length-photos}),note:'자료실 올리기를 불러오지 못했어요. 잠시 후 다시 올려 주세요.',error:true,ms:0,actions:[{label:'다시 올리기',aria:'못 올린 파일 다시 올리기',run:()=>sendReportFiles(target,files)}]})}}
// 미리 골라 둔 사진을 파일로 만든다(한 장씩 원본 받기 — time-photos.js timePhotoFiles). 그동안은 하단바 위 한 줄 '사진 n장 준비 중'.
// 읽지 못한 사진은 그 한 줄에 [다시 올리기](그 사진만 다시 읽어 같은 길로). 만드는 사이 계정이 바뀌면 보내지 않는다(null).
async function prepareTimePhotos(target,picks){const who=user?.id||'';timePhotosPreparing++;const live=announceDock({text:`사진 ${picks.length}장 준비 중`,ms:0});let made={files:[],failed:picks};
  try{const m=await import('./time-photos.js');made=await m.timePhotoFiles(picks)}catch(e){console.warn('time photos prepare failed',e?.message||e)}
  finally{timePhotosPreparing--;live.close()}
  if(!who||user?.id!==who)return null;
  if(made.failed.length)announceDock({text:sendFailLine({badPhotos:made.failed.length}),note:'사진을 읽지 못했어요. 폰·원드라이브 연결을 확인한 뒤 다시 올려 주세요.',error:true,ms:0,actions:[{label:'다시 올리기',aria:'못 올린 사진 다시 올리기',run:()=>sendReportFiles(target,[],null,made.failed)}]});
  return made.files}
// S46-20 사진 정리 ⑥(명진 11/01 01:04): 사진 줄 안 '그 시각 사진 [골라 붙이기]'(time-photos.js). 고른 사진만 위 사진 파일과 같은 길(저장할 때 차례로 올림, Drive 첨부).
// BIZ-보고할일정 PR D: 일정에서 연 창(일정 id + 시각)이면 창을 열 때 그 시각 사진을 미리 골라 둔다(preset). [저장]하면 chosen()을 받아 창을 닫은 뒤 위 길로 올린다.
let meetingTimePhotos=null,meetingTimePhotosLoading=false,meetingEntryPreset=false;
function resetMeetingTimePhotos(){const host=$('#meetingTimePhotos');if(!host)return;if(meetingTimePhotos){void meetingTimePhotos();return}if(meetingTimePhotosLoading)return;meetingTimePhotosLoading=true;import('./time-photos.js').then(m=>{meetingTimePhotos=m.mountTimePhotos(host,{at:()=>$('#meetingAt')?.value||'',onPick:files=>addMeetingFiles(files),busy:()=>meetingSavePending,quiet:true,preset:()=>meetingEntryPreset})},e=>console.warn('time photos load failed',e)).finally(()=>{meetingTimePhotosLoading=false})}
// CAL-일정첨부 요청 6번(S59-23, 시안 ③): 일정에서 연 창이면 사진 칸 아래 '일정에 붙인 사진 n · 넣으려면 누르기'(report-event-photos.js). 처음엔 안 고른 상태,
// [저장]하면 창이 닫힌 뒤 고른 사진만 같은 Drive 원본을 가리키는 자료로 그 보고에 잇는다(서버 document-actions link-event-photo, 올리기 없음).
let meetingEventPhotos=null,meetingEventPhotosLoading=null;
function resetMeetingEventPhotos(){const host=$('#meetingEventPhotos');if(!host)return;if(meetingEventPhotos){void meetingEventPhotos.reset(meetingEntryEvent);return}if(!meetingEntryEvent){host.hidden=true;return}if(meetingEventPhotosLoading)return;meetingEventPhotosLoading=import('./report-event-photos.js').then(m=>{meetingEventPhotos=m.mountEventPhotoPick(host,{busy:()=>meetingSavePending});void meetingEventPhotos.reset(meetingEntryEvent)},e=>console.warn('event photos load failed',e?.name||'Error')).finally(()=>{meetingEventPhotosLoading=null})}
function sendEventPhotos(target,picks){if(!picks?.length)return;import('./report-event-photos.js').then(m=>m.linkEventPhotos(target,picks)).catch(e=>{console.warn('event photos send failed',e?.name||'Error');announceDock({text:`일정 사진 ${picks.length}장 못 넣었어요`,note:'잠시 뒤 다시 넣어 주세요.',error:true,ms:0,actions:[{label:'다시 넣기',aria:'못 넣은 일정 사진 다시 넣기',run:()=>sendEventPhotos(target,picks)}]})})}
function addMeetingFiles(files){if(meetingSavePending)return;const added=Array.from(files||[]).map(file=>({file,kind:'pending'}));if(!added.length)return;meetingUploadEntries=[...meetingUploadEntries,...added];renderMeetingSelectedFiles()}
function selectMeetingFiles(){const input=$('#meetingFiles'),files=Array.from(input.files||[]);input.value='';addMeetingFiles(files)}
function selectMeetingPhotos(){const input=$('#meetingPhotoFiles'),files=Array.from(input.files||[]).filter(isPhotoFile);input.value='';addMeetingFiles(files)}
function removeMeetingFile(e){const b=e.target.closest('[data-meeting-remove-file]');if(!b||meetingSavePending)return;const fromPhotos=!!b.closest('#meetingSelectedPhotos');const index=Number(b.dataset.meetingRemoveFile);if(meetingUploadEntries[index]?.kind==='success')return;meetingUploadEntries.splice(index,1);renderMeetingSelectedFiles();const buttons=$$(fromPhotos?'#meetingSelectedPhotos button':'#meetingSelectedFiles button');(buttons[Math.min(index,buttons.length-1)]||(fromPhotos?$('#meetingPickPhotos'):$('#meetingPickFiles'))).focus()}
// MEET-파일AI분류: 새 사업 보고의 자료도 자료실 올리기와 같은 요청·AI 자동 분류로 올린다(자료실 부품을 먼저 불러온다).
async function ensureLibraryUpload(){const loader=window.KPTUViewLoader;if(loader?.load&&!loader.isLoaded?.('library'))await loader.load('library');if(!(await window.__KPTU_LIBRARY_UPLOAD_READY__)||!window.KPTULibrary?.uploadFileForMeeting)throw new Error('자료실 올리기를 불러오지 못했어요.')}
async function saveMeeting(){if(meetingSavePending)return;const button=$('#saveMeetingBtn'),originalLabel=button.textContent;const title=$('#meetingTitle').value.trim(),meetingAt=$('#meetingAt').value,transcript=$('#meetingTranscript')?.value??'',specialNotes=$('#meetingNotes')?.value??'',shortName=isMeetingKind(entryKind())?($('#meetingShortName')?.value||'').trim():'';if(!title)return setStatus($('#meetingStatus'),reportWords(entryKind()).nameMissing,'error');if(!meetingAt)return setStatus($('#meetingStatus'),'일시를 입력해 주세요.','error');const entryTargets=targetList(meetingEntryTargets),projectId=firstProjectId(entryTargets),locationText=($('#meetingLocation')?.value||'').trim(),attendeesText=isMeetingKind(entryKind())?($('#meetingAttendees')?.value||'').trim():'',roundRaw=$('#meetingRoundNo')?.value,roundNo=roundRaw&&isMeetingKind(entryKind())?Number(roundRaw):null,files=meetingUploadEntries.filter(entry=>entry.kind!=='success').map(entry=>entry.file),timePicks=meetingTimePhotos?.chosen?.()||[],eventPicks=meetingEventPhotos?.chosen?.()||[];if(files.some(file=>file.size>100*1024*1024))return setStatus($('#meetingStatus'),reportWords(entryKind()).materials+'는 파일당 100MB까지 첨부할 수 있습니다.','error');meetingSavePending=true;$('#newMeetingBtn').disabled=true;renderMeetingSelectedFiles();setBusy(button,true);button.textContent='저장 중…';setStatus($('#meetingStatus'),'저장 중…');let savedMeeting=null,linkNote='';try{const actionRows=$$('#meetingActionList .meeting-action-row').map(r=>({title:String(r.dataset.title||'').trim(),due:r.dataset.due||''}));const lineTitle=$('#meetingActionTitle')?.value.trim()||'',lineDue=$('#meetingActionDue')?.value||'';if(lineTitle||lineDue)actionRows.push({title:lineTitle,due:lineDue});if(actionRows.some(x=>!x.title))throw new Error('후속 할 일을 입력해 주세요.');const areaBody=await (areaFields()?.body()??{}),fileProjectId=areaBody.business_area_id||projectId;const withLocation=locationText&&await locationAvailable().catch(()=>false);const withAttendees=attendeesText&&await attendeesAvailable().catch(()=>false);const eventLink=meetingEntryEvent?await import('./report-plan-data.js').then(m=>m.reportLinkBody(meetingEntryEvent)).catch(()=>({})):{};const rows=await api('/rest/v1/app_meetings',{method:'POST',body:{workspace_id:workspace.id,activity_kind:entryKind(),project_id:projectId,...areaBody,...(withLocation?{location:locationText}:{}),...(withAttendees?{attendees:attendeesText}:{}),...eventLink,title:shortName&&shortName!==title?shortName:title,series_name:title,round_no:Number.isFinite(roundNo)?roundNo:null,meeting_at:toMeetingISO(meetingAt),notes:specialNotes.trim()?specialNotes:'',transcript_text:transcript,result_status:'final',finalized_at:new Date().toISOString(),created_by:user.id},prefer:'return=representation'});const meeting=rows?.[0];if(!meeting)throw new Error('저장된 사업 보고를 확인하지 못했어요.');savedMeeting=meeting;if(isMeetingKind(entryKind()))void window.KPTUMeetingNames.commitSort('meeting',title);if(entryTargets.length){const linked=await saveReportTargets(meeting,entryTargets);if(!linked.ok)linkNote='연결은 저장하지 못했어요. '+(linked.message||'');else if(linked.legacy&&linked.skippedOrgs)linkNote=LEGACY_NOTE}if(meetingEntryOnSaved){try{await meetingEntryOnSaved(meeting)}catch(err){console.warn('report onSaved failed',err);linkNote=(linkNote?linkNote+' ':'')+'사업 보고는 저장했지만 업데이트와 잇지 못했어요.'}}window.KPTUDriveSummary?.saved?.();for(const a of actionRows){const result=await window.KPTURuntime.api('/functions/v1/google-tasks?action=create',{method:'POST',body:{action:'create',title:a.title,notes:'',due:newTaskDue(a.due),links:[{meeting_id:meeting.id},...(projectId?[{project_id:projectId}]:[])]}});if(result?.link_error)throw new Error('Google 할 일은 만들었지만 사업 보고 연결을 저장하지 못했어요.')}let uploaded=0,failed=0,readFailureMessage='';const libraryReady=files.length||timePicks.length?ensureLibraryUpload():null;// UI-올리기진행표시 ②: 막대·%는 자료 줄·사진 칸 안(공용 부품). 사본은 한 번에 하나만 읽어 보낸다(폰 메모리, material-selection-delete 시험이 지키는 약속).
// BIZ-저장먼저닫기(S58-1, 요청함 11/11 07:01): 글 저장(연결·후속 할 일 포함)이 끝났으면 창을 먼저 닫고, 고른 사진·자료는 공용 뒤 줄 한 묶음으로 넘긴다(sendReportFiles → library-upload.js sendForMeeting, meeting-send.mjs). 놓은 그 보고 id로 화면을 옮겨도 끝까지 올라가고, 진행·끝 글·[다시 올리기]는 하단바 위 한 줄(upload-progress.js)이 맡는다. files.splice(0) = 넘긴 파일은 이 창에서 뺀다(아래 catch가 같은 파일을 또 넘기지 않게). 글 저장이 실패하면 창은 닫히지 않는다(catch의 else). 한 번에 하나만 읽어 보내는 약속은 뒤 줄이 지킨다.
meetingEntryOnClosed=null;closeModal('meetingModal');showSaved(meeting,meetingAt);if(files.length||timePicks.length)void sendReportFiles({id:meeting.id,project_id:fileProjectId,kind:entryKind(),day:seoulDateKey(meeting.meeting_at||meetingAt)},files.splice(0),libraryReady,timePicks.splice(0));sendEventPhotos({id:meeting.id,kind:entryKind(),day:seoulDateKey(meeting.meeting_at||meetingAt)},eventPicks.splice(0));await reload(['meetings','documents']);window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:meeting.id}}));window.dispatchEvent(new CustomEvent('kptu:record-saved',{detail:{kind:'meeting',id:meeting.id,project_id:projectId,day:seoulDateKey(meeting.meeting_at||meetingAt),title:meeting.series_name||meeting.title||title,text:transcript}}));if(actionRows.length)window.dispatchEvent(new CustomEvent('kptu:tasks-changed'));toast('사업 보고를 저장했습니다.'+(linkNote?' '+linkNote:''))}catch(e){if(savedMeeting){meetingEntryOnClosed=null;closeModal('meetingModal');showSaved(savedMeeting,meetingAt);if(files.length||timePicks.length)void sendReportFiles({id:savedMeeting.id,project_id:savedMeeting.business_area_id||savedMeeting.project_id||'',kind:entryKind(),day:seoulDateKey(savedMeeting.meeting_at||meetingAt)},files.splice(0),null,timePicks.splice(0));sendEventPhotos({id:savedMeeting.id,kind:entryKind(),day:seoulDateKey(savedMeeting.meeting_at||meetingAt)},eventPicks.splice(0));try{await reload(['meetings','documents'])}catch(err){console.warn('meeting list refresh failed',err)}window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:savedMeeting.id}}));toast('사업 보고는 저장됐습니다. 후속 할 일 상태를 사업 보고 상세에서 확인해 주세요. '+e.message)}else setStatus($('#meetingStatus'),e.message,'error')}finally{meetingSavePending=false;$('#newMeetingBtn').disabled=false;renderMeetingSelectedFiles();setBusy(button,false);button.textContent=originalLabel}}
async function reload(parts,render=renderAll){const wid=workspace.id;const jobs=[];if(parts.includes('meetings'))jobs.push(readMeetings(api,wid).then(rows=>{meetings=rows;return loadReportLinks()}));if(parts.includes('documents'))jobs.push(readDocuments(api,wid).then(rows=>{documents=rows}));if(parts.includes('spaces'))jobs.push(api('/rest/v1/app_spaces?workspace_id=eq.'+wid+'&select=*&order=sort_order.asc,created_at.asc').then(rows=>{spaces=rows;publishProjects()}));await Promise.all(jobs);render()}
window.__KPTU_RELOAD_MEETINGS__=async()=>{if(!workspace?.id)return;[meetings,documents]=await Promise.all([readMeetings(api,workspace.id),readDocuments(api,workspace.id)]);await loadReportLinks();const sel=reportKitLoaded&&meetingSelectedId!=null&&meetings.find(x=>String(x.id)===String(meetingSelectedId));if(sel)weekFor(sel);renderMeetings()};
async function googleCall(action,opts={}){await ensureSession();const url=new URL(GOOGLE_FN);if(action)url.searchParams.set('action',action);if(opts.params)Object.entries(opts.params).forEach(([k,v])=>url.searchParams.set(k,String(v)));const r=await fetch(url,{method:opts.method||'GET',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:opts.body?JSON.stringify(opts.body):null});const d=await r.json();if(!r.ok||d.error)throw new Error(d.error||'Google Calendar 요청 실패');return d}
async function loadGoogleStatus(loadEvents=false){try{const s=await googleCall('status');googleState={...googleState,...s};if(s.connected&&loadEvents)await loadGoogleEvents();renderGoogleControls()}catch(e){googleState.connected=false;renderGoogleControls();console.warn(e)}}
async function loadGoogleEvents(){return window.KPTUCalendarPersistence?.refresh?.()}
// CAL-캘린더색칩(S52-18, 11/07 'A'): 표시할 캘린더 하나 = 칩 하나(공용 ④ button.ds-chip + 12px 색 점 .ui-color-dot + 이름).
// 칩 누르기 = 보이기/숨기기(aria-pressed, 숨김 = 빈 점·흐린 글자), 색 점 누르기·길게 누르기·우클릭·Shift+F10 = 작은 색 고르기 상자.
// 누름·색·저장은 calendar-persistence.js(cpDecorate)가 맡고, 점 색도 그쪽이 칠한다(한 주인).
// 달력을 다시 그릴 때마다 부르므로 내용이 같으면 칩을 새로 만들지 않는다(누른 칩의 초점·열린 색 상자 유지).
let googleListHtml='';
function calendarChipHtml(c,on){const name=esc(c.summary||'')+(c.primary?' (기본)':'');return `<button type="button" class="ds-chip cal-chip" data-dot-toggle data-google-cal="${esc(c.id)}" aria-pressed="${on?'true':'false'}" title="누르면 보이기·숨기기 · 색 점을 누르면 색 바꾸기"><span class="ui-color-dot" data-cp-dot="${esc(c.id)}" aria-hidden="true"></span><span class="cal-chip-name">${name}</span></button>`}
function renderGoogleControls(){if(!$('#googleConnectBtn'))return;const panel=$('#googleCalendarPanel'),connect=$('#googleConnectBtn'),box=$('#googleCalendarList');$('#googleAccountLabel').textContent=googleState.connected?(googleState.email||'연결됨'):'연결 안 됨';connect.classList.toggle('hidden',!!googleState.connected);if(panel&&!panel.dataset.initialized&&typeof googleState.connected==='boolean'){panel.open=!googleState.connected;panel.dataset.initialized='1'}if(googleState.connected&&googleState.calendars?.length){box.classList.remove('hidden');const html='<b>표시할 Google 캘린더</b>'+googleState.calendars.map(c=>calendarChipHtml(c,googleState.selected?.includes(c.id))).join('')+'<span id="cpSaved" class="cal-saved" role="status" aria-live="polite"></span><button id="disconnectGoogle" class="secondary" type="button">연결 해제</button>';if(googleListHtml!==html||!$('#disconnectGoogle')){box.innerHTML=html;googleListHtml=html;$('#disconnectGoogle').onclick=disconnectGoogle}}else{box.classList.add('hidden');googleListHtml=''}window.KPTUCalendarPersistence?.decorate?.()}
window.__KPTU_SYNC_GOOGLE_STATE__=next=>{googleState={...googleState,...(next||{})}};
window.__KPTU_SYNC_GOOGLE_EVENTS__=next=>{googleState.events=Array.isArray(next)?next:[];scheduleCalendarRender()};
window.__KPTU_RENDER_GOOGLE_CONTROLS__=renderGoogleControls;
async function connectGoogle(){if(googleState.connected){const panel=$('#googleCalendarPanel');if(panel)panel.open=true;return}const d=await googleCall('start');location.href=d.url}
async function disconnectGoogle(){await googleCall('',{method:'POST',body:{action:'disconnect'}});window.KPTUCalendarPersistence?.disconnected?.();googleState={connected:false,enabled:false,selected:[],calendars:[],events:[],email:null};renderCalendar();toast('Google Calendar 연결을 해제했습니다.')}
function switchView(view){if(window.KPTURouter?.go){window.KPTURouter.go(view,{source:'team'});return}$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('.view-panel').forEach(v=>v.classList.add('hidden'));$('#'+view+'View')?.classList.remove('hidden')}
// FAMILY-잊지말기: preset({title, memo, onCreated})이 오면 제목·메모를 채우고, 그 창에서 새 일정이 만들어지면 한 번 알린다. 캘린더는 창에서 고른다.
function openEventModal(preset){const p=preset&&typeof preset==='object'&&!(typeof Event!=='undefined'&&preset instanceof Event)?preset:{};['eventTitle','eventLocation','eventDescription'].forEach(id=>{if($('#'+id))$('#'+id).value=''});if(p.title&&$('#eventTitle'))$('#eventTitle').value=String(p.title);if(p.memo&&$('#eventDescription'))$('#eventDescription').value=String(p.memo);const now=new Date(),finish=new Date(now.getTime()+3600000),date=seoulDateKey,time=seoulClock;if($('#eventAllDay'))$('#eventAllDay').checked=false;if($('#eventStartDate'))$('#eventStartDate').value=date(now);if($('#eventEndDate'))$('#eventEndDate').value=date(finish);if($('#eventStartTime'))$('#eventStartTime').value=time(now);if($('#eventEndTime'))$('#eventEndTime').value=time(finish);document.querySelectorAll('.event-time-row').forEach(x=>x.classList.remove('hidden'));setStatus($('#eventStatus'),'');openModal('eventModal',{initialFocus:'#eventTitle'});void prepareEventModal(typeof p.onCreated==='function'?p.onCreated:null)}
// CAL-다른화면일정등록: 창의 Google 세부 캘린더·색·종일 칸·[저장]은 달력 묶음(calendar-plus.js)이 맡는다. 달력을 아직 안 연 화면(잊지 말기·정리함·
// 홈 업데이트 등 KPTUEventCreate.open)에서 열면 이 한 곳에서 화면 불러오기 길(KPTUViewLoader.load('calendar') — 홈 빠른 입력·[+ 추가]·event-open.js와 같은 길)로
// 먼저 불러온 뒤 창을 채운다. 그동안 종일·[저장]·[일정|할 일]은 잠그고 상태 줄에 기다림, 못 불러오면 창 안에 한 줄 + [다시]. 창을 닫거나 다시 열면 앞 준비는 버린다.
let eventPrepSeq=0;
function lockEventForm(on){document.querySelectorAll('#eventAllDay,#saveEventBtn,#eventModal [data-event-mode]').forEach(el=>{el.disabled=!!on});const b=$('#saveEventBtn');if(b){if(on)b.setAttribute('aria-busy','true');else b.removeAttribute('aria-busy')}}
async function prepareEventModal(onCreated){
  const seq=++eventPrepSeq,modal=$('#eventModal'),status=$('#eventStatus'),loader=window.KPTUViewLoader;
  const live=()=>seq===eventPrepSeq&&!!modal&&!modal.classList.contains('hidden');
  if(!loader?.isLoaded?.('calendar')||!window.KPTUCalendarPlus?.prepareNewEvent){
    lockEventForm(true);if(status){status.className='status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.innerHTML=waitInlineHtml()}
    try{if(!loader?.load)throw new Error('view loader');await loader.load('calendar');await window.__KPTU_CALENDAR_PLUS_READY__;if(!window.KPTUCalendarPlus?.prepareNewEvent)throw new Error('calendar plus')}
    catch(err){console.warn('event modal prepare',err?.name||'Error');if(!live())return false;lockEventForm(true);if(status){status.className='status error';status.removeAttribute('aria-live');status.replaceChildren(failEl({text:'일정 창을 준비하지 못했어요',onRetry:()=>void prepareEventModal(onCreated)}))}return false}
    if(!live())return false;
  }
  lockEventForm(false);
  await window.KPTUCalendarPlus.prepareNewEvent({onCreated});
  return true
}
window.KPTUEventCreate={open:preset=>openEventModal(preset||{})};
// ORG-자료더하기먹통: 자료 등록 창을 여는 공용 길(자료실 [+]가 쓰는 같은 함수). 다른 화면은 버튼을 .click()하지 않고 이것을 부른다(library-upload.js luOpenUploadWindow).
window.KPTUDocumentModal={open:()=>openDocumentModal(),close:()=>closeModal('documentModal')};
// UI-플러스키보드(요청함 11/03 15:09): 자료 [+]·[+ 자료 등록]은 파일을 고르는 일이 먼저라, 손가락으로 쓰는 폰·태블릿(pointer:coarse)에서는 자료명 칸에 초점을 주지 않는다(키보드가 올라와 창 아래를 가리던 원인). 첫 조작 가능한 버튼(닫기)이 초점을 받고, 자료명은 눌러서 쓴다. 마우스·키보드 화면은 그대로 자료명 칸.
const docInitialFocus=()=>window.matchMedia?.('(pointer: coarse)').matches?null:'#docTitle';
function openDocumentModal(){['docTitle','docCategory','docSource','docDate','docTags','docUrl','docDescription'].forEach(id=>{if($('#'+id))$('#'+id).value=''});openModal('documentModal',{initialFocus:docInitialFocus()})}
// MTG-사업보고 4단계: 입력 창 맨 위 칸 칩(#meetingKindPick). 저장 때 activity_kind로 보낸다. 차수·짧은 이름 줄은 [회의] 칸에서만 창에 있다(MTG-보고창정리: 숨김이 아니라 창에서 뺌, 그리는 주인은 paintEntryWords 하나).
// MTG-사업보고 6단계: 연결(프로젝트·담당조직)은 한 곳 — 연결 표의 '출처 회의' 줄(report-links.js). 입력 창 [연결할 곳]·결과 창·목록·프로젝트/조직 화면이 같은 줄을 읽고 쓴다.
let meetingEntryTargets=[],entryNames=new Map(),reportTargetMap=new Map(),orgNames=new Map();
const tkey=t=>t.kind+':'+t.id;
function targetNameOf(t){return (t.kind==='project'?projectName(t.id):orgNames.get(t.id))||entryNames.get(tkey(t))||(t.kind==='project'?'사업영역':missingOrganizationLabel(orgNames.size>0))}
function reportTargetsOf(m){return reportTargetMap.get(m?.id)||(m?.project_id?[{kind:'project',id:m.project_id}]:[])}
function reportLinkLabel(m){if(!reportKitLoaded)return '';return targetsLabel(reportTargetsOf(m),targetNameOf)}
async function loadReportLinks(){
  try{await reportKit()}catch(e){console.warn('report kit load failed',e?.name||'Error');return}
  noteLocationFromMeetings(meetings);noteAttendeesFromMeetings(meetings);noteAreaFromMeetings(meetings);noteAreaNoneFromMeetings(meetings); // 장소 칸이 서버에 있는지: 이미 읽은 사업 보고 줄(목록 열에 그 칸이 들어 있어, 서버에 없으면 select=*로 다시 읽는다)로 정한다. 입력 창을 열 때 새 요청을 보내지 않는다.
  try{
    const [map,orgs]=await Promise.all([readAllReportTargets(meetings),api('/rest/v1/app_suborganizations?workspace_id=eq.'+workspace.id+'&select=id,name&limit=1000')]);
    reportTargetMap=map;orgNames=new Map((orgs||[]).map(o=>[o.id,o.name]));
  }catch(e){console.warn('report links read failed',e)}
  await rememberAreas();
}
// BIZ-사업영역기억(11/10): 사업 보고를 읽을 때마다(처음·다시 읽기·녹음으로 생긴 보고 포함) 같은 회의명에서 전에 고른 사업영역·[없음]을
// 아직 안 단 새 보고에 붙여 저장한다(규칙 business-area-model.mjs, 저장 report-area-tag.js applyRememberedAreas — 기존 PATCH 길). 붙인 게 있으면
// 목록 배열을 새로 만들어(주간보고 칸도 다시 그림) 다른 화면에도 알린다. 부르는 쪽(읽은 뒤 그리기)이 그린다.
async function rememberAreas(){
  if(!meetings?.length||!workspace?.id)return;
  try{
    const model=await import('./business-area-model.mjs');if(!model.rememberedAreaRows(meetings).length)return;
    const tag=await import('./report-area-tag.js'),wid=workspace.id,saved=await tag.applyRememberedAreas(meetings,{api,workspace:wid});
    if(saved&&workspace?.id===wid){meetings=meetings.slice();window.dispatchEvent(new CustomEvent('kptu:meetings-changed'))}
  }catch(e){console.warn('remembered area failed',e?.message||e)}
}
function paintEntryPlaces(){
  const button=$('#meetingPlaces');if(button)button.textContent=targetsLabel(meetingEntryTargets,targetNameOf,'연결 안 함');
  const select=$('#meetingProject'),pid=firstProjectId(meetingEntryTargets)||'';
  if(select){if(pid&&![...select.options].some(o=>o.value===pid))select.add(new Option(projectName(pid)||'사업영역',pid));select.value=pid}
}
async function choosePlaces(trigger){
  try{
    const sheet=await import('./report-places-sheet.js');
    await sheet.pickReportPlaces(trigger,{chosen:meetingEntryTargets,onMessage:msg=>setStatus($('#meetingStatus'),msg,'error'),onCommit:async list=>{
      const places=await sheet.loadReportPlaces().catch(()=>null);
      meetingEntryTargets=targetList(list);
      if(places)meetingEntryTargets.forEach(t=>entryNames.set(tkey(t),sheet.targetName(places,t)));
      paintEntryPlaces();areaFields()?.suggest(firstProjectId(meetingEntryTargets));
    }});
  }catch(e){setStatus($('#meetingStatus'),e.message||'연결할 곳을 불러오지 못했어요.','error')}
}
// REC-한회의로잇기 PR-0 '초안 지키기'(설계 docs/design/rec-join.md 2-3절): 사업 보고 입력 창(#meetingModal)의 쓰던 글을 묻지 않고 비우지 않는다.
// - 묻는 곳은 창의 주인인 이 파일 한 곳이다. 녹음 네 길·다른 화면이 여는 길이 모두 KPTUReportEntry.open을 지나므로 길마다 따로 막지 않는다.
// - '쓰던 글' = 창을 연 직후의 글 칸(meetingEntryBase)과 지금이 다름(사람이 쓴 글, 녹음 정리 결과가 채운 글, 후속 할 일 줄, 고른 파일, 녹음·전사 넣기 칸).
//   회의명·차수·짧은 이름·장소·일시처럼 고르거나 한 줄로 넣는 값만 바꾼 창은 묻지 않는다(다시 고르면 되는 값, 지금처럼 바로 닫힘).
// - 닫기(×·Esc·폰 뒤로가기·바깥 누르기)는 쓰던 글이 있으면 [계속 쓰기][닫기]로 묻는다(일기·바구니와 같은 작은 확인창).
// - 열려 있는 창에 새로 열기(녹음 정리 결과 등)는 쓰던 글이 있으면 [쓰던 창 두기][새로 열기]로 묻는다. 두면 KPTUReportEntry.open은 false.
// - 연 쪽에 알림: onSaved(저장한 보고 행) · onClosed({reason}) — 'closed' 저장하지 않고 닫음, 'replaced' 쓰던 글을 버리고 새로 열기를 고름.
//   녹음 정리 결과의 '열었음'(서버 job_opened)은 연 쪽(meeting-recorder.js)이 이 두 알림으로 보낸다(창을 열기만 했을 때는 보내지 않음).
const ENTRY_TEXT_IDS=['meetingTranscript','meetingNotes','meetingAttendees','meetingActionTitle'];
let meetingEntryBase='',meetingEntryOnClosed=null,meetingEntryCloseNote='',entryAsking=false;
function entrySnapshot(){return JSON.stringify([ENTRY_TEXT_IDS.map(id=>$('#'+id)?.value??''),$$('#meetingActionList .meeting-action-row').map(r=>[r.dataset.title||'',r.dataset.due||'']),meetingUploadEntries.filter(entry=>entry.kind!=='success').length,!!window.KPTUMeetingTranscriptDraft?.hasDraft?.()])}
function meetingEntryOpen(){const m=$('#meetingModal');return !!m&&!m.classList.contains('hidden')}
function meetingEntryDirty(){return meetingEntryOpen()&&entrySnapshot()!==meetingEntryBase}
const entryCloseButton=()=>$('#meetingModal [data-close="meetingModal"]');
function endEntry(reason){const fn=meetingEntryOnClosed;meetingEntryOnClosed=null;meetingEntryOnSaved=null;if(!fn)return;try{fn({reason})}catch(e){console.warn('report entry close hook failed',e?.name||'Error')}}
async function askEntry(options){entryAsking=true;try{return await askConfirm(entryCloseButton(),options)}finally{entryAsking=false}}
// 닫기 요청(× 버튼, Esc, 폰 뒤로가기·바깥 누르기는 mobile-modal-history.js가 ×를 누름). 저장 중이면 지금처럼 바로 닫는다(저장은 끝까지 가고 onSaved가 알린다).
async function requestMeetingClose(){
  const modal=$('#meetingModal');if(!meetingEntryOpen()||entryAsking)return;
  if(!meetingSavePending&&meetingEntryDirty()){
    // 폰 뒤로가기로 온 닫기: 창의 뒤로가기 칸은 이미 빠졌으므로 다시 넣고 묻는다(두기로 하면 다음 뒤로가기도 이 창을 닫으러 온다).
    if(modal.dataset.kptuHistoryClosing==='pop'){delete modal.dataset.kptuHistoryClosing;history.pushState({...(history.state||{}),kptuOverlay:modal.id},'',location.href)}
    const yes=await askEntry({text:'쓰던 사업 보고를 저장하지 않고 닫을까요?',note:meetingEntryCloseNote,ok:'닫기',cancel:'계속 쓰기',danger:true});
    if(!yes||!meetingEntryOpen()||meetingSavePending)return;
  }
  if(!meetingSavePending)endEntry('closed');
  closeModal('meetingModal');
}
// 새로 열기 전: 열려 있는 창을 끝내고 닫는다(다음 창의 칸·녹음·전사 넣기·회의 만들기 상태가 '창이 열릴 때' 처음부터 다시 시작하게).
// 쓰던 글이 있으면 먼저 묻는다. 두기로 하거나, 저장 중이거나, 이미 묻는 중이면 false.
async function settleOpenEntry(opts={}){
  if(!meetingEntryOpen())return true;
  if(entryAsking||meetingSavePending)return false;
  let reason='closed';
  if(meetingEntryDirty()){
    const yes=await askEntry({text:'쓰던 사업 보고가 있어요. 저장하지 않고 새로 열까요?',note:String(opts.keepNote||''),ok:'새로 열기',cancel:'쓰던 창 두기',danger:true});
    if(!meetingEntryOpen())return true;
    if(!yes||meetingSavePending)return false;
    reason='replaced';
  }
  endEntry(reason);
  const modal=$('#meetingModal'),windows=window.KPTUMobileModalHistory;
  // 폰은 창의 뒤로가기 칸을 먼저 빼고 다음 창을 연다(mobile-modal-history.js closeThen). PC는 바로.
  if(windows?.closeThen)await new Promise(resolve=>windows.closeThen(modal,resolve));
  else closeModal('meetingModal',{restoreFocus:false});
  return true;
}
// 다른 화면(프로젝트·담당조직·캘린더·바구니·[+ 추가])이 사업 보고 입력 창을 여는 길: 화면을 불러온 뒤 칸 고르기(또는 정해진 칸) → 채워진 입력 창.
window.KPTUReportEntry={open:async(opts={})=>{
  if(!workspace?.id)return false;
  await loadForView('meetings');
  // REC-한회의로잇기 PR-0: 입력 창이 이미 열려 있으면 그 창부터 끝낸다(쓰던 글이 있으면 먼저 묻고, 두기로 하면 false — 연 쪽은 결과를 제자리에 둔다).
  if(!await settleOpenEntry(opts))return false;
  const trigger=opts.trigger||document.activeElement;
  if(opts.dedupe&&opts.name&&(opts.at||opts.date)){
    // 같은 날·같은 이름의 사업 보고가 이미 있으면 먼저 묻는다(일정에서 [결과 남기기]를 두 번 눌렀을 때 중복 방지).
    const day=String(opts.at||opts.date).slice(0,10),key=meetingNameKey(opts.name);
    const same=meetings.find(m=>m.meeting_at&&seoulDateKey(new Date(m.meeting_at))===day&&meetingNameKey(meetingName(m))===key);
    if(same&&await askConfirm(trigger,{text:'같은 날 같은 이름의 사업 보고가 이미 있어요.',ok:'그 보고 열기',cancel:'새로 만들기'})){
      try{await window.KPTUViewLoader?.prepare?.('meetings');await import('./meeting-round-detail.js');if(await window.__KPTU_MEETING_ROUND_DETAIL_READY__){await window.KPTUMeetingRoundDetail.open(same.id);return true}}catch(e){console.error('open existing report',e)}
    }
  }
  if(opts.kind&&isReportKind(opts.kind)){openMeetingModal({...opts,trigger});return true}
  await pickReportKind(trigger,{title:'어느 칸에 남길까요?',onPick:kind=>openMeetingModal({...opts,kind,trigger})});
  return true;
}};
window.KPTUTeamData.reportTargets=()=>reportTargetMap;
Object.assign(window.KPTUTeamData,{targetName:targetNameOf,reportLabel:reportLinkLabel,refreshReportLinks:loadReportLinks,reportTargetsOf});
let meetingEntryKind=DEFAULT_KIND,meetingEntryOnSaved=null;
// BIZ-보고할일정 PR A: 일정 [결과 남기기]로 연 쓰기 창이면 그 일정({id, calendarId}). 저장할 때 보고 줄의 일정 id 칸에 남긴다(서버에 칸이 없으면 지금처럼 저장 — report-plan-data.js).
let meetingEntryEvent=null;
let entryArea=null;const areaFields=()=>entryArea||=mountAreaFields($('#meetingAreaFields'),{onMessage:m=>setStatus($('#meetingStatus'),m,'error'),material:()=>({title:$('#meetingTitle')?.value||'',text:$('#meetingTranscript')?.value||''})});
// MTG-참석인원칸(S56-31): '회의 결과' 맨 위 참석인원 한 줄은 [회의] 칸이고 서버에 칸이 있을 때만 보인다(다른 칸은 숨기고 보내지 않음).
let entryAttendeesOk=false;
function paintAttendeesRow(){const row=$('#meetingAttendeesRow');if(row)row.hidden=!(entryAttendeesOk&&isMeetingKind(entryKind()))}
function entryKind(){return isReportKind(meetingEntryKind)?meetingEntryKind:DEFAULT_KIND}
function paintEntryWords(){
  const kind=entryKind(),w=reportWords(kind),meeting=isMeetingKind(kind),set=(sel,text)=>{const el=$(sel);if(el)el.textContent=text};
  const modal=$('#meetingModal');if(modal)modal.dataset.reportKind=kind;
  set('#meetingTitleLabel',w.nameLabel);set('[data-rw="meetingResultLegend"]',w.resultLegend);set('#meetingTextLabel',w.textLabel);set('#meetingMaterialsHead',w.materials);
  const ta=$('#meetingTranscript');if(ta)ta.placeholder=w.textPlaceholder;
  set('#meetingNotesLabel',w.notesLabel);const notes=$('#meetingNotes');if(notes)notes.placeholder=w.notesPlaceholder;
  $('#meetingPickFiles')?.setAttribute('aria-label',w.pickFiles);
  // 회의명 고르기·차수·짧은 이름은 [회의] 칸에서만 보인다. 다른 칸은 제목 한 칸.
  entryRoundRows.paint(meeting);
  paintAttendeesRow();
  const select=$('#meetingNameSelect');
  if(select&&!meeting&&select.value!=='__other__'){select.value='__other__';select.dispatchEvent(new Event('change'))}
  renderMeetingSelectedFiles();
  window.dispatchEvent(new CustomEvent('kptu:report-entry-kind',{detail:{kind}}));
}
function paintEntryKind(){const host=$('#meetingKindPick');if(!host)return;renderFilterChips(host,{label:'칸',value:entryKind(),options:REPORT_KINDS.map(k=>({value:k.value,label:k.label})),onChange:value=>{meetingEntryKind=value;paintEntryKind()}});paintEntryWords()}
// [+]: [전체] 칩이면 칸 고르기 창을 먼저 열고, 다른 칩이면 그 칸이 채워진 입력 창을 바로 연다.
// MTG-한줄업데이트: [전체]의 [+] 메뉴 맨 위 [한 줄 업데이트], [한 줄] 칩에서 [+]는 바로 한 줄 창. 사업영역 칩을 고른 채면 그 사업영역을 미리 고른다.
function openOnelineEntry(trigger){const area=areaChip!=='all'&&areaChip!==AREA_NONE?areaChip:'';import('./report-oneline.js').then(m=>m.openOneline(trigger,{areaId:area,onSaved:row=>{showSaved(row);renderMeetings({resetList:true})}}),err=>toast(err?.message||'한 줄 업데이트 창을 열지 못했어요.'))}
function newReport(trigger,date=''){if(reportChip===ONELINE_KIND){openOnelineEntry(trigger);return}if(reportChip!==ALL_KINDS){openMeetingModal({name:newMeetingName(),kind:reportChip,date});return}pickReportKind(trigger,{title:'어느 칸에 남길까요?',onPick:kind=>openMeetingModal({kind,trigger,date}),onOneline:()=>openOnelineEntry(trigger)})}
function openMeetingModal({name='',kind=DEFAULT_KIND,trigger=document.activeElement,targets=[],at='',date='',location='',text='',onSaved=null,onClosed=null,closeNote='',event=null}={}){meetingEntryOnSaved=onSaved;meetingEntryOnClosed=typeof onClosed==='function'?onClosed:null;meetingEntryCloseNote=String(closeNote||'');meetingEntryEvent=event?.id?{id:String(event.id),calendarId:String(event.calendarId||'primary')}:null;meetingEntryPreset=!!meetingEntryEvent&&!!String(at||'').trim();meetingEntryKind=isReportKind(kind)?kind:DEFAULT_KIND;entryRoundRows.paint(true);['meetingTitle','meetingAt','meetingNotes','meetingRoundNo','meetingShortName','meetingTranscript'].forEach(id=>{if($('#'+id))$('#'+id).value=''});meetingRoundEdited=false;meetingUploadEntries=[];renderMeetingSelectedFiles();if($('#meetingFiles'))$('#meetingFiles').value='';$('#meetingProject').innerHTML=projectOptions(true);meetingEntryTargets=targetList(targets);entryNames=new Map();$('#meetingAt').value=defaultReportAt({at,date});if($('#meetingLocation'))$('#meetingLocation').value=location||'';if($('#meetingAttendees'))$('#meetingAttendees').value='';if(text)$('#meetingTranscript').value=text;paintEntryPlaces();areaFields()?.start({areaId:firstProjectId(meetingEntryTargets)||''});void locationAvailable().then(ok=>{const row=$('#meetingLocationRow');if(row)row.hidden=!ok},()=>{});entryAttendeesOk=false;paintAttendeesRow();void attendeesAvailable().then(ok=>{entryAttendeesOk=!!ok;paintAttendeesRow()},()=>{});installMeetingNamePicker($('#meetingTitle'),'meeting');setupMeetingNamePicker($('#meetingNameSelect'),$('#meetingTitle'),$('#meetingNameMatch'),$('#meetingNameUseMatch'),{current:name,names:meetingNameChoices(DEFAULT_KIND),onChoose:suggestMeetingRound,onCustom:()=>{const round=$('#meetingRoundNo');if(round&&!meetingRoundEdited)round.value=''}});paintEntryKind();resetMeetingTimePhotos();resetMeetingEventPhotos();openModal('meetingModal',{trigger,initialFocus:isMeetingKind(meetingEntryKind)&&meetingNameChoices(DEFAULT_KIND).length?'#meetingNameSelect':'#meetingTitle',onRequestClose:()=>void requestMeetingClose()});meetingEntryBase=entrySnapshot()}
function bind(){
 $('#bootRetryBtn').onclick=()=>{try{window.KPTUAppShell?.postMessage?.('reopen:mark:retry')}catch{}location.reload()};$('#bootLogoutBtn').onclick=logout;$('#accessDeniedLogoutBtn').onclick=logout;
 document.addEventListener('click',async e=>{const b=e.target.closest('button,a');if(!b)return;if(b.dataset.close){if(b.dataset.close==='meetingModal')void requestMeetingClose();else closeModal(b.dataset.close);return}});
 if(window.KPTURouter?.on)window.KPTURouter.on('calendar',()=>{renderCalendar();if(googleState.connected)window.KPTUCalendarPersistence?.refresh?.()});
 if($('#homeAddEvent'))$('#homeAddEvent').onclick=openEventModal;$('#newEventBtn').onclick=openEventModal;$('#newDocumentBtn').onclick=openDocumentModal;$('#newMeetingBtn').onclick=e=>newReport(e.currentTarget);bindReportMore();$('#meetingPlaces').onclick=e=>void choosePlaces(e.currentTarget);$('#meetingList')?.addEventListener('click',meetingListClick);$('#meetingList')?.addEventListener('contextmenu',e=>void meetingListMenu(e));$('#reportWeekFilter')?.addEventListener('click',reportWeekClick);$('#reportWeekFilter')?.addEventListener('input',reportPeriodInput);$('#reportWeekFilter')?.addEventListener('change',reportPeriodPick);$('#reportPeriodPick')?.addEventListener('change',reportPeriodPick);$('#areaUntaggedLine')?.addEventListener('click',untaggedClick);$('#meetingsView .report-kind-bar')?.addEventListener('change',reportSelectChange);$('#meetingList')?.addEventListener('keydown',meetingKindKeys);
 $('#meetingRoundNo').oninput=()=>{meetingRoundEdited=true};$('#meetingRoundNo').addEventListener('change',paintEntryKind);
 $('#saveDocumentBtn').onclick=saveDocument;$('#saveMeetingBtn').onclick=saveMeeting;$('#meetingFiles').onchange=selectMeetingFiles;$('#meetingPickFiles').onclick=()=>$('#meetingFiles').click();bindDropTarget($('#meetingModal .modal-card'),addMeetingFiles,()=>!meetingSavePending);$('#meetingSelectedFiles').addEventListener('click',removeMeetingFile);$('#meetingPhotoFiles').onchange=selectMeetingPhotos;$('#meetingPickPhotos').onclick=()=>$('#meetingPhotoFiles').click();$('#meetingSelectedPhotos').addEventListener('click',removeMeetingFile);
 $('#documentSearch').oninput=renderDocuments;
 window.addEventListener('kptu:project-spaces-updated',e=>{const d=e.detail;if(!workspace||!user||d?.workspaceId!==workspace.id||d.userId!==user.id||!Array.isArray(d.spaces))return;spaces=d.spaces;renderAll()});
 const moveMonth=delta=>{if(window.KPTUCalendarView?.move(delta))return;monthCursor=seoulDate(seoulParts(monthCursor).year,seoulParts(monthCursor).month+delta);renderCalendar();window.KPTUCalendarPersistence?.refresh?.()};window.__KPTU_CALENDAR_TODAY__=()=>{monthCursor=new Date();renderCalendar();window.KPTUCalendarPersistence?.refresh?.()};window.__KPTU_CALENDAR_SHOW_MONTH__=day=>{monthCursor=seoulDate(seoulParts(day).year,seoulParts(day).month);renderCalendar();window.KPTUCalendarPersistence?.refresh?.()};window.__KPTU_CALENDAR_MOVE_MONTH__=moveMonth;$('#prevMonthBtn').onclick=()=>moveMonth(-1);$('#nextMonthBtn').onclick=()=>moveMonth(1);window.KPTUCalendarMonthView?.setNavigate?.(moveMonth);
 $('#googleConnectBtn').onclick=connectGoogle;
}
async function init(){enhanceDom();bind();session=window.__KPTU_AUTHENTICATED_BOOT_SESSION__||loadSession();if(!session){window.KPTUAuthGate?.redirect?.();return}try{await loadWorkspaceState()}catch(e){console.error('workspace init failed',e);if(await ensureSession()){showWorkspaceError();return 'error'}saveSession(null);window.KPTUAuthGate?.redirect?.();return 'error'}}
window.__KPTU_TEAM_READY__=init().then(result=>{const state=result==='error'?'error':!session?'auth':membership?'workspace':'denied';window.__KPTU_TEAM_READY_STATE__=state;window.dispatchEvent(new CustomEvent('kptu:team-ready',{detail:{state}}));return state});

// MEET-결과3단: 오른쪽 후속 할 일은 할 일·회의가 바뀌거나 회의 결과 창을 닫으면 다시 읽는다(창 안에서 고친 할 일 반영).
window.addEventListener('kptu:documents-changed',()=>{if(workspace?.id&&teamViewLoaded.has('meetings'))reload(['documents'],renderMeetings).catch(err=>console.error('meeting document count refresh failed',err))});
/* BIZ-버튼줄정리(10/29 시안 B): 사업 보고 위쪽 줄 ⋯ 메뉴 — 사업영역 관리(WEEKLY-메뉴짝짓기 P5: [사업요약표 미리보기]는 위 접는 칸 '이번 주 주간보고'로 옮김). 공용 메뉴 부품(anchored-menu.js: ⋯ 바로 아래 오른쪽 맞춤,
   바깥 누르기·Esc·뒤로가기로 닫힘)과 공용 글자 줄 모양(.topline-add-menu). 미리보기는 ⋯를 기준 자리로 연다(전에는 줄의 [사업요약표 미리보기] 버튼).
   [사업영역 관리]는 메뉴가 닫힌 뒤 사업 보고 위의 창으로 연다(area-window.js, MTG-프로젝트합치기 ①: 닫으면 보던 주·거르기 그대로). */
function bindReportMore(){
  const more=$('#reportMore');if(!more||more.dataset.reportMoreBound)return;more.dataset.reportMoreBound='1';
  let menu=null;
  more.addEventListener('click',async()=>{
    if(!menu){const {createAnchoredMenu}=await import('./anchored-menu.js');
      menu=createAnchoredMenu({id:'reportMoreMenu',className:'topline-add-menu report-more-menu',label:'사업 보고 더 보기',historyKey:'kptuReportMore',key:()=>'report',
        render:()=>'<button type="button" data-report-areas>사업영역 관리</button>',
        onAction:(b,{trigger})=>{
          if(b.matches('[data-report-areas]'))return void window.KPTUAreaWindow?.open?.({trigger});
        }});}
    menu.open(more);
  });
}
