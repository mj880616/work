import {waitHtml, emptyHtml} from './wait-state.js';
import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {renderFilterChips} from './filter-chips.js';
import {defaultReportAt} from './report-default-at.mjs';
import {formatMeetingTime,toMeetingISO,seoulParts,seoulDate,seoulDateKey,seoulClock} from './meeting-time.js';
import './time-input.js';
import {fileLine,bindDropTarget} from './meeting-compact.js';
import {isPhotoFile} from './activity-photo-model.mjs'; // ACT-사진 3단계: 사진 줄 (그림 판단은 자료실과 같은 함수 하나)
import {paintLocalPhotos} from './report-photo-row.js';
import {viewPrefs} from './view-prefs.js'; // ACT-사진 6단계: 사업 보고 [목록|달력|사진] 보기 선택은 서버(report_view)에 기억
import {REPORT_VIEW_OPTIONS,reportViewOf,shiftMonth,photosByMeeting} from './report-views-model.mjs';
import {calendarHtml,photoViewHtml,mountPhotoView,mountStrips} from './report-views.js';
import {PC_QUERY,NONE_KEY,sortRecentFirst,MEETING_DOCS_LABEL,meetingColumns,columnsHtml,listHtml,pickMeeting,assignMeetingColors,meetingPaletteColor,nameHash,MEETING_HUES,roundLabel,hasRound,meetingShortName} from './meeting-columns.js';
import {formatMeetingWhen} from './meeting-when.js';
import {ALL_KINDS,DEFAULT_KIND,REPORT_KINDS,ONELINE_KIND,isReportKind,isReportChip,reportKindOf,reportKindLabel,reportKindChips,filterByReportKind} from './report-kinds.mjs';
import {pickReportKind} from './report-kind-sheet.js';
import {reportWords,isMeetingKind} from './report-words.mjs'; // 칸에 따라 입력 창 글자가 바뀐다
import {createFieldRows} from './report-entry-rows.js'; // MTG-보고창정리: 칸에 따라 [차수]·[짧은 이름] 줄을 창에 두거나 뺀다
import {missingOrganizationLabel} from './project-trash-model.mjs'; // TRASH-화면2: 휴지통에 든 조직을 가리키는 연결의 빈 이름
import {mountSplitResize} from './split-resize.js';
import {followPane} from './follow-pane.js';
import {targetList,targetsLabel,firstProjectId} from './report-links-model.mjs';
import {saveReportTargets,readAllReportTargets,locationAvailable,noteLocationFromMeetings,noteAreaFromMeetings,noteAreaNoneFromMeetings,LEGACY_NOTE} from './report-links.js';
import {mountAreaFields} from './business-area-fields.js';
import {mountBigWrite} from './record-text-write.js'; // MTG-결과마크다운: 결과 원문·특이사항 [⤢] = 노트와 같은 쓰기 창(글자는 칸에 그대로 넣고 저장은 이 창의 저장)
import {untaggedInWeek,NO_AREA,AREA_NONE,areaRoots,areaChipOptions,matchesAreaChip,areaIdOf,defaultReportWeek,inReportWeek,undatedCount,reportWeekLabel,reportDay as reportDayOf,weekOf,shiftDays} from './business-area-model.mjs'; // MTG-프로젝트합치기 2단계: [사업영역] 꼬리표 + 다음 할 일 칸
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
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;kptuHoldToast(t)}
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
function projectOptions(includeBlank=true,selected=''){return window.KPTUProjectCatalog?.options(selected,includeBlank)||(includeBlank?'<option value="">사업영역 없음</option>':'')}
function publishProjects(){if(window.KPTUProjectCatalog&&workspace?.id&&user?.id)window.KPTUProjectCatalog.publish({workspaceId:workspace.id,userId:user.id,spaces:spaces.filter(x=>x.owner_id===user.id)})}
function showOnly(id){document.body.classList.toggle('kptu-workspace-shell',id==='appView');['accessDeniedView','appView','bootView'].forEach(x=>{const el=$('#'+x);if(!el)return;const active=x===id;el.classList.toggle('hidden',!active);el.inert=!active;el.setAttribute('aria-hidden',active?'false':'true')})}
function showWorkspaceError(){const view=$('#bootView');if(!view)return;view.querySelector('h2').textContent='업무 공간을 열 수 없습니다.';view.querySelector('p').textContent='연결 상태를 확인한 뒤 다시 시도하거나 로그아웃해 주세요.';$('#bootErrorActions')?.classList.remove('hidden');showOnly('bootView')}
function enhanceDom(){
  const toolbar=$('#calendarView .calendar-toolbar');if(toolbar&&!$('#googleCalendarControls'))toolbar.insertAdjacentHTML('beforebegin',`<details id="googleCalendarPanel" class="calendar-google-panel"><summary><span>구글 캘린더</span><span id="googleAccountLabel" class="updated"></span></summary><div id="googleCalendarControls" class="google-bar"><button id="googleConnectBtn" class="secondary" type="button">구글 캘린더 연결</button></div><div id="googleCalendarList" class="google-cal-list hidden"></div></details>`);
}
async function logout(){try{if(session)await api('/auth/v1/logout',{method:'POST'})}catch{}saveSession(null);if(!window.KPTUAuthGate)location.replace('./login/')}
window.KPTUTeamAuth={logout};
function resetPrivateState(){reportChip=DEFAULT_KIND;areaChip='all';reportWeek=null;reportWeekAll=false;areaTree=null;meetingSelectedKind=null;meetingSelectedId=null;session=null;user=null;membership=null;workspace=null;members=[];profiles=[];spaces=[];events=[];meetings=[];documents=[];reportTargetMap=new Map();orgNames=new Map();meetingEntryTargets=[];googleState={connected:null,enabled:false,selected:[],calendars:[],events:[],email:null};teamViewFlights.clear();teamViewLoaded.clear();window.__KPTU_BOOT_CONTEXT__=null;window.KPTURuntime?.context?.clear?.()}
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
function renderCalendar(){const y=seoulParts(monthCursor).year,m=seoulParts(monthCursor).month;$('#monthTitle').textContent=`${y}년 ${m+1}월`;(window.KPTUCalendarView||window.KPTUCalendarMonthView)?.render?.({year:y,month:m,googleEvents:googleState.events,googleState});renderGoogleControls();window.KPTUCalendarDayOverflow?.apply?.()}
window.__KPTU_RENDER_CALENDAR__=renderCalendar
function renderDocuments(){if(window.KPTULibrary?.render){window.KPTULibrary.render();return}const q=($('#documentSearch')?.value||'').trim().toLowerCase(),pid=$('#documentProject')?.value||'all';const rows=documents.filter(d=>(pid==='all'||d.project_id===pid)&&(!q||[d.title,d.source,d.category,(d.tags||[]).join(' ')].join(' ').toLowerCase().includes(q)));$('#documentList').innerHTML=rows.map(d=>`<article class="item-card"><div><div class="badges"><span class="badge">${esc(d.category)}</span>${d.project_id?`<span class="badge">${esc(projectName(d.project_id))}</span>`:''}</div><h3>${esc(d.title)}</h3><p>${esc(d.source||'출처 미기재')}${d.document_date?' · '+esc(d.document_date):''}</p>${d.description?`<small>${esc(d.description)}</small>`:''}</div>${/^https?:\/\//i.test(d.drive_url||'')?`<a class="mini" href="${esc(d.drive_url)}" target="_blank" rel="noopener noreferrer">열기</a>`:''}</article>`).join('')||emptyHtml()}
function meetingName(m){return String(m?.series_name||m?.title||'').trim()}
function meetingNameKey(name){return String(name||'').replace(/\s+/g,'').toLowerCase()}
function meetingNameChoices(kind=null){const seen=new Set();return [...(kind?filterByReportKind(meetings,kind):meetings)].sort((a,b)=>new Date(b.meeting_at)-new Date(a.meeting_at)).map(meetingName).filter(name=>{const key=meetingNameKey(name);if(!key||seen.has(key))return false;seen.add(key);return true})}
function installMeetingNamePicker(input,prefix){if(document.querySelector(`#${prefix}NameSelect`))return;input.insertAdjacentHTML('beforebegin',`<select id="${prefix}NameSelect" aria-label="이름 선택"></select>`);input.parentElement.insertAdjacentHTML('afterend',`<div id="${prefix}NameMatch" class="hidden" role="status"><span></span> <button id="${prefix}NameUseMatch" type="button" class="mini">이걸로</button></div>`)}
function setupMeetingNamePicker(select,input,match,use,{current='',names=meetingNameChoices(),onChoose=()=>{},onCustom=()=>{}}={}){
  select.replaceChildren();
  const add=(value,label)=>select.add(new Option(label,value));
  add('','이름 선택');names.forEach(name=>add(name,name));add('__other__','기타(직접 입력)');
  const chosen=names.find(name=>name===current);
  select.value=chosen||'__other__';input.value=current;
  select.classList.toggle('hidden',!names.length);
  function update(){const custom=select.value==='__other__'||!names.length;input.classList.toggle('hidden',!custom);if(!custom)input.value=select.value;const equivalent=custom?names.find(name=>meetingNameKey(name)===meetingNameKey(input.value)&&name!==input.value.trim()):null;match.classList.toggle('hidden',!equivalent);match.querySelector('span').textContent=equivalent?`같은 이름이 있습니다: ${equivalent}`:'';use.onclick=()=>{select.value=equivalent;update()};if(custom)onCustom();else onChoose()}
  select.onchange=update;input.oninput=update;update();
}
// 다른 화면(자료실 회의 고르기 등)이 쓰는 회의 이름표도 회의 화면과 같은 차수·짧은 이름·회의 시각 규칙(MEET-결과정리 ①③).
function meetingDisplay(m){return {name:meetingName(m)||'회의명 미지정',meta:meetingRowMeta(m)}}
window.KPTUMeetingNames={installPicker:installMeetingNamePicker,choices:meetingNameChoices,setupPicker:setupMeetingNamePicker,label:m=>{const {name,meta}=meetingDisplay(m);return [name,...meta].join(' · ')}};
// MEET-결과정리 ②: 종류마다 서로 다른 색 칸(meeting-columns.js assignMeetingColors). 회의 목록이 바뀔 때만 다시 나눈다.
let meetingColorCache={source:null,slots:new Map()};
function meetingColor(name){const key=meetingNameKey(name);if(!key)return '#808080';if(meetingColorCache.source!==meetings)meetingColorCache={source:meetings,slots:assignMeetingColors(meetings,{nameOf:meetingName,keyOf:meetingNameKey})};const slot=meetingColorCache.slots.get(key);return meetingPaletteColor(slot??nameHash(key)%MEETING_HUES)}
// 회의 화면 목록 줄(폰)의 작은 글자: 차수(없으면 짧은 이름) · 회의 시각(①: 직접 지정 → 결과 글의 일시 → 날짜만).
// MTG-프로젝트합치기 ⑤: 일시가 없는 보고는 목록에서 빠지지 않고 '일시 없음'으로 보인다.
const NO_WHEN='일시 없음',whenText=m=>formatMeetingWhen(m)||NO_WHEN;
function meetingRowMeta(m){return [hasRound(m)||meetingShortName(m)?roundLabel(m):null,whenText(m)].filter(Boolean)}
// UI-전수디자인점검 F01: 회의명 거르기는 칩 줄 대신 [거르기 ▾] 고르기 창(openReportFilter)의 한 묶음이다. 고른 값은 이 화면이 열린 동안만 기억한다.
let meetingType='all';
function meetingTypeOptions(){const types=[...new Set(filterByReportKind(meetings,DEFAULT_KIND).map(meetingName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));return [{value:'all',label:'전체'},...types.map(name=>({value:name,label:name,color:meetingColor(name)})),{value:'__none__',label:'회의명 미지정',color:meetingColor('')}]}
function renderMeetingTypeOptions(){if(!meetingTypeOptions().some(o=>o.value===meetingType))meetingType='all'}
// 회의명 묶음은 [회의] 칩에서만, PC 목록(왼쪽 회의 종류 칸이 같은 일을 함)에서는 없다.
function nameFilterOn(){return reportChip===DEFAULT_KIND&&!(meetingPc?.matches&&reportView==='list')}
function typeFilter(){return reportChip===DEFAULT_KIND?meetingType:'all'}
// UI-PC회의 → MEET-결과정리 ⑤ → MEET-결과3단: 회의 화면을 그리는 곳은 여기 하나다. PC(≥761)는 왼쪽 회의 종류 / 가운데 차수·날짜·시간 /
// 오른쪽 고른 차수의 회의 결과(읽기용) 3단(meeting-columns.js), 폰은 지금 한 줄 목록. 고른 종류·차수는 이 화면이 열려 있는 동안만
// 기억한다(처음엔 가장 최근 결과가 있는 종류의 가장 최근 차수). 오른쪽 후속 할 일은 결과 창과 같은 읽기(google-tasks linked)로 따로 불러온다.
const meetingPc=window.matchMedia?.(PC_QUERY);
let meetingSelectedKind=null,meetingSelectedId=null;
// MTG-사업보고 4단계: 위쪽 칸 칩 줄(report-kinds.mjs). 고른 칩은 이 화면이 열려 있는 동안 기억하고 처음은 [회의](지금 기록은 모두 회의라 첫 화면이 그대로).
// [회의] 칩: PC 3단·폰 회의명 칩 그대로. [전체]·다른 칸: PC는 '날짜·이름 목록 | 결과' 2단, 폰은 한 줄 목록(회의명 칩 없음). 그리는 주인은 renderMeetings 하나.
let reportChip=DEFAULT_KIND;
// ACT-사진 6단계: [목록|달력|사진] 보기. 그리는 주인은 renderMeetings 하나(목록=기존 그리기, 달력·사진=아래 두 함수). 칸 칩·회의명 거르기는 세 보기에 똑같이 걸린다.
// 달력은 사업 보고 화면 안에서만 쓴다(일정 탭 달력과 섞지 않음). 보기 선택은 이 화면 안 상태이고 서버(view-prefs report_view)에 기억한다.
// 서버에서 읽은 기억은 사용자가 이번에 직접 고르기 전까지 그릴 때마다 따른다(팀 모듈이 기억을 읽기 전에 불러와질 수 있어 처음 값은 그릴 때 읽는다).
let reportView='list',reportViewChosen=false,reportMonth=(()=>{const p=seoulParts();return {year:p.year,month:p.month}})(),reportDay='',photoFocusId=null;
function renderReportViewChips(){const host=$('#reportViewFilter');if(!host)return;renderFilterChips(host,{label:'보기',controls:'meetingList',value:reportView,options:REPORT_VIEW_OPTIONS.map(o=>({value:o.value,label:o.label})),small:true,onChange:value=>selectReportView(value)})}
// MTG-고치기바로: 세 번째 칸에서 고치던 내용이 있으면, 다른 줄·종류·칸·보기를 누를 때 그 자리에서 [저장] [버리기]를 묻고 고른 뒤에 간다(meeting-round-detail.js 문지기). 없으면 바로 간다.
// 물어서 멈췄으면(false) 눌린 칩은 원래 상태로 되돌려 그린다.
function leaveReport(go){const guard=window.KPTUMeetingRoundDetail?.guardLeave;if(!guard){go();return true}return guard(go)}
function selectReportView(next){next=reportViewOf(next);if(next===reportView)return;if(!leaveReport(()=>{reportViewChosen=true;reportView=next;viewPrefs.set('report_view',next);renderMeetings({resetList:true})}))renderReportViewChips()}
function viewRows(){renderMeetingTypeOptions();const filter=typeFilter();return sortRecentFirst(reportRows().filter(m=>filter==='all'||(filter==='__none__'?!meetingName(m):meetingName(m)===filter)))}
const viewName=m=>meetingName(m)||'이름 없음',viewColor=m=>meetingColor(meetingName(m)),viewMeta=m=>[reportKindLabel(reportKindOf(m)),areaNameOf(m),...meetingRowMeta(m)].filter(Boolean).join(' · ');
function renderReportCalendar(box){meetingWhere(null);const active=box.contains(document.activeElement)?document.activeElement:null,keep=active?(active.dataset.rvNav?['data-rv-nav',active.dataset.rvNav]:active.dataset.rvDay?['data-rv-day',active.dataset.rvDay]:null):null;box.innerHTML=calendarHtml({rows:viewRows(),month:reportMonth,selectedDay:reportDay,todayKey:seoulDateKey(),photos:photosByMeeting(documents),colorOf:viewColor,nameOf:viewName,metaOf:viewMeta});mountStrips(box,()=>box.isConnected);if(keep)box.querySelector(`[${keep[0]}="${keep[1]}"]`)?.focus({preventScroll:true})}
function renderReportPhotos(box){meetingWhere(null);const rows=viewRows(),photos=photosByMeeting(documents);box.innerHTML=photoViewHtml({rows,photos,colorOf:viewColor,nameOf:viewName,kindOf:m=>reportKindLabel(reportKindOf(m))});mountPhotoView(box,{rows,photos,api,onError:m=>toast(m),openReport:id=>import('./report-open.js').then(mod=>mod.openReport(id))});if(photoFocusId&&meetings.length){const el=box.querySelector(`[data-rv-set="${CSS.escape(photoFocusId)}"] .rv-set-head`);photoFocusId=null;if(el){el.scrollIntoView({block:'start'});el.focus({preventScroll:true})}}}
function reportViewClick(e){const nav=e.target.closest('[data-rv-nav]');if(nav){const to=nav.dataset.rvNav;if(to==='today'){const p=seoulParts();reportMonth={year:p.year,month:p.month};reportDay=seoulDateKey()}else{reportMonth=shiftMonth(reportMonth,to==='next'?1:-1);reportDay=''}renderMeetings();return true}const day=e.target.closest('[data-rv-day]');if(day){reportDay=day.dataset.rvDay;renderMeetings();return true}return false}
// MTG-프로젝트합치기 2단계: 칸 칩 아래 사업영역 칩([전체]·1단 사업영역·[꼬리표 없음 n]). 예전 프로젝트 화면 대신 여기서 사업영역별로 걸러 본다.
// 사업영역 = 프로젝트 트리(고르기 창과 같은 읽기 loadReportPlaces). 트리를 못 읽었으면 칩 줄을 숨기고 거르지 않는다. 고른 칩은 이 화면이 열린 동안만.
let areaChip='all',areaTree=null,areaTreeLoading=false;
function loadAreaTree(){if(areaTree||areaTreeLoading)return;areaTreeLoading=true;import('./report-places-sheet.js').then(s=>s.loadReportPlaces()).then(p=>{areaTree=p?.projects||[];renderAreaChips()},()=>{}).finally(()=>{areaTreeLoading=false})}
function areaMatch(list){if(!areaTree||areaChip==='all')return list;const roots=areaRoots(areaTree);return list.filter(m=>matchesAreaChip(m,areaChip,roots))}
// 목록 줄의 작은 글자는 직접 단 꼬리표만(옛 보고에 빌려 보이는 꼬리표는 보기 면에만).
function areaNameOf(m){if(!areaTree)return '';const id=areaIdOf(m),x=id&&areaTree.find(r=>String(r.project.id)===id);return x?[x.path,x.project.name].filter(Boolean).join(' › '):''}
let areaOptions=[];
function renderAreaChips(){loadAreaTree();const options=areaTree?areaChipOptions(filterByReportKind(meetings,reportChip),areaTree):[];areaOptions=options.length<2?[]:options;if(!areaOptions.length){if(areaChip!=='all')areaChip='all'}else if(!options.some(o=>o.value===areaChip))areaChip='all';renderReportFilter()}
// UI-전수디자인점검 F01: 칸 칩 줄 끝 [거르기 ▾] 하나가 사업영역·회의명 두 묶음을 연다(공용 고르기 창, report-filter-sheet.js). 고를 묶음이 없으면 버튼도 없다.
// 고른 것이 있으면 버튼 글자가 고른 이름('공공기관 · 가상 회의 1')이 된다. 그리는 곳은 이 함수 하나.
function reportFilterSections(){return [areaOptions.length?{key:'area',title:'사업영역',value:areaChip,options:areaOptions}:null,nameFilterOn()?{key:'name',title:'회의명',value:meetingType,options:meetingTypeOptions()}:null].filter(Boolean)}
function renderReportFilter(){const btn=$('#reportFilterBtn');if(!btn)return;renderMeetingTypeOptions();const sections=reportFilterSections();btn.hidden=!sections.length;const picked=sections.filter(x=>x.value!=='all').map(x=>x.options.find(o=>o.value===x.value)?.label).filter(Boolean);const label=btn.querySelector('.report-filter-label');if(label)label.textContent=picked.join(' · ')||'거르기';btn.classList.toggle('is-on',picked.length>0);btn.setAttribute('aria-label',picked.length?`거르기: ${picked.join(', ')}`:'거르기');btn.title=picked.length?picked.join(' · '):''}
function openReportFilter(trigger){import('./report-filter-sheet.js').then(m=>m.openReportFilter(trigger,{sections:reportFilterSections,onPick:(key,value)=>key==='area'?selectAreaChip(value):selectMeetingType(value)}),err=>toast(err?.message||'거르기 창을 열지 못했습니다.'))}
function selectMeetingType(value){if(value===meetingType)return;if(!leaveReport(()=>{meetingType=value;meetingSelectedId=null;renderMeetings({resetList:true})}))renderReportFilter()}
function selectAreaChip(value){if(value===areaChip)return;if(!leaveReport(()=>{areaChip=value;meetingSelectedId=null;renderMeetings({resetList:true})}))renderAreaChips()}
// MTG-프로젝트합치기 3단계(요청 10/28 19:07 ③): [목록] 보기는 주 단위(‹ › 주 넘기기, [전체]로 모든 주). 달력·사진 보기는 그대로 모든 주.
// 처음 주는 defaultReportWeek(이번 주, 없으면 가장 최근 보고의 주). 고른 주는 이 화면이 열린 동안만 기억한다(기기에 저장하지 않음).
let reportWeek=null,reportWeekAll=false;
const weekOn=()=>reportView==='list'&&!reportWeekAll;
function currentWeek(){if(reportWeek)return reportWeek;const from=defaultReportWeek(meetings,seoulDateKey());if(meetings.length)reportWeek=from;return from}
function weekMatch(list){return weekOn()?inReportWeek(list,currentWeek()):list}
function renderReportWeek(){const host=$('#reportWeekFilter'),bar=host?.parentElement;if(!host)return;const show=reportView==='list'&&meetings.length>0;if(bar)bar.hidden=!show;if(!show){host.innerHTML='';return}const from=currentWeek(),inWeek=inReportWeek(filterByReportKind(meetings,reportChip),from),none=undatedCount(inWeek),n=inWeek.length-none;host.innerHTML=`<button type="button" class="mini secondary" data-report-week="prev" aria-label="이전 주"${reportWeekAll?' disabled':''}>‹</button><span class="report-week-label" aria-live="polite">${reportWeekAll?'모든 주':esc(reportWeekLabel(from))+` <small>${n}건${none?` · ${NO_WHEN} ${none}`:''}</small>`}</span><button type="button" class="mini secondary" data-report-week="next" aria-label="다음 주"${reportWeekAll?' disabled':''}>›</button><button type="button" class="mini secondary" data-report-week="all" aria-pressed="${reportWeekAll}">전체</button>`}
function reportWeekClick(e){const b=e.target.closest('[data-report-week]');if(!b||b.disabled)return;const to=b.dataset.reportWeek;if(!leaveReport(()=>{if(to==='all')reportWeekAll=!reportWeekAll;else reportWeek=shiftDays(currentWeek(),to==='next'?7:-7);meetingSelectedId=null;renderMeetings({resetList:true})}))renderReportWeek()}
// 다른 곳에서 고른 보고가 지금 주에 없으면 그 보고의 주로 옮긴다.
function weekFor(m){const day=reportDayOf(m);if(!weekOn()||!day)return false;const from=weekOf(day).from;if(from===currentWeek())return false;reportWeek=from;return true}
// 새로 저장한(고친) 보고는 그 보고의 주로 옮겨 바로 보이게 한다. meetingAt은 쓰기 창의 서울 날짜·시각 'YYYY-MM-DDTHH:MM'.
function weekOfSaved(at){const day=String(at||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(day))reportWeek=weekOf(day).from}
// MTG-프로젝트합치기 ⑤: 새로 저장한 보고는 그 주로 옮기고 고른 보고로 둔다. 사업영역 칩·회의명 거르기가 그 보고를 가리면 [전체]로 푼다.
function showSaved(m,at){weekOfSaved(at||(m?.meeting_at?seoulDateKey(m.meeting_at):''));if(!m?.id)return;meetingSelectedId=m.id;if(reportChip===DEFAULT_KIND){const n=meetingName(m);meetingSelectedKind=n?meetingNameKey(n):NONE_KEY;if(meetingType!=='all'&&meetingType!==(n||'__none__'))meetingType='all'}if(areaChip!=='all'&&areaTree&&!matchesAreaChip(m,areaChip,areaRoots(areaTree)))areaChip='all'}
function reportRows(){return weekMatch(areaMatch(filterByReportKind(meetings,reportChip)))}
function renderReportChips(){const host=$('#reportKindFilter');if(!host)return;renderFilterChips(host,{label:'칸',controls:'meetingList',value:reportChip,options:reportKindChips(meetings),onChange:value=>selectReportChip(value)})}
function selectReportChip(value){const next=isReportChip(value)?value:DEFAULT_KIND;if(next===reportChip)return;if(!leaveReport(()=>{reportChip=next;meetingSelectedId=null;renderMeetings({resetList:true})}))renderReportChips()}
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
function meetingWhere(m){const round=m&&(reportKindOf(m)===DEFAULT_KIND||hasRound(m)||meetingShortName(m))?roundLabel(m):'';window.dispatchEvent(new CustomEvent('kptu:where-item',{detail:{view:'meetings',name:m?[meetingName(m)||'이름 없음',round].filter(Boolean).join(' '):null}}))}
function renderMeetingColumns(box,{resetList=false,resetResult=resetList}={}){const columns=meetingColumnList(),selected=selectedMeetingColumn(columns);meetingSelectedKind=selected?.key??null;const current=pickMeeting(selected,meetingSelectedId);meetingSelectedId=current?.id??null;meetingWhere(current);const active=document.activeElement?.closest?.('#meetingList')?document.activeElement:null,focusKey=active?{kind:active.dataset.meetingKind,round:active.dataset.meetingRound}:null;const handleAt=active?.classList?.contains('split-resize-handle')?[...box.querySelectorAll('.split-resize-handle')].indexOf(active):-1;const kindsTop=box.querySelector('.mcol-kinds')?.scrollTop||0,listTop=resetList?0:box.querySelector('.mcol-cards')?.scrollTop||0;box.innerHTML=columnsHtml(columns,{selectedKey:meetingSelectedKind,selectedId:meetingSelectedId,colorOf:meetingColor,whenOf:whenText,resultHtml:meetingResult});const kinds=box.querySelector('.mcol-kinds'),list=box.querySelector('.mcol-cards');if(kinds)kinds.scrollTop=kindsTop;if(list)list.scrollTop=listTop;const layout=box.querySelector('.mcol-layout');const split=layout?mountSplitResize({container:layout,name:'reports3',inherit:'reports',label:'사업 보고 칸 폭 조절',columns:[{el:()=>box.querySelector('.mcol-kinds'),varName:'--ds-split-col-a',minVar:'--ds-split-col-min',minFallback:120,share:1,id:'mcolRounds'},{el:()=>box.querySelector('.mcol-rounds'),varName:'--ds-split-col-b',minVar:'--ds-split-col-b-min',minFallback:72,share:.5,id:'mcolResult'},{el:()=>box.querySelector('.mcol-result'),varName:'--ds-split-col-c',minVar:'--ds-split-detail-min',minFallback:360,share:4.5}],active:()=>!!meetingPc?.matches&&reportChip===DEFAULT_KIND&&box.contains(layout)}):null;if(handleAt>=0)split?.handles[handleAt]?.focus({preventScroll:true});if(focusKey){const [attr,value]=focusKey.kind!=null?['data-meeting-kind',focusKey.kind]:focusKey.round!=null?['data-meeting-round',focusKey.round]:[];if(attr){const el=[...box.querySelectorAll(`[${attr}]`)].find(e=>e.getAttribute(attr)===value);el?.focus({preventScroll:true})}}followResult(box,resetList);dockReport()}
function renderReportList(box,{resetList=false,resetResult=resetList}={}){const rows=sortRecentFirst(reportRows()),current=rows.find(m=>String(m.id)===String(meetingSelectedId))||rows[0]||null;meetingSelectedId=current?.id??null;meetingWhere(current);const active=document.activeElement?.closest?.('#meetingList')?document.activeElement:null,focusKey=active?{round:active.dataset.meetingRound}:null;const listTop=resetList?0:box.querySelector('.mcol-cards')?.scrollTop||0;box.innerHTML=listHtml(rows,{selectedId:meetingSelectedId,label:reportChip===ALL_KINDS?'전체':reportKindLabel(reportChip),nameOf:m=>meetingName(m)||'이름 없음',kindOf:m=>[reportChip===ALL_KINDS?reportKindLabel(reportKindOf(m)):'',areaNameOf(m)].filter(Boolean).join(' · '),colorOf:m=>meetingColor(meetingName(m)),whenOf:whenText,resultHtml:m=>meetingResult(m,{kindName:meetingName(m)||'이름 없음'})});const layout=box.querySelector('.mcol-layout'),list=box.querySelector('.mcol-cards');if(list)list.scrollTop=listTop;if(layout)mountSplitResize({container:layout,name:'reports',label:'사업 보고 목록과 결과 칸 폭 조절',controls:'mcolRounds',list:()=>box.querySelector('.mcol-rounds'),pane:()=>box.querySelector('.mcol-result'),active:()=>!!meetingPc?.matches&&reportChip!==DEFAULT_KIND&&box.contains(layout)});if(focusKey){const [attr,value]=focusKey.round!=null?['data-meeting-round',focusKey.round]:[];if(attr)[...box.querySelectorAll(`[${attr}]`)].find(e=>e.getAttribute(attr)===value)?.focus({preventScroll:true})}followResult(box,resetList);dockReport()}
// UI-칸안스크롤하나로(시안 A): PC는 화면 스크롤 하나. 오른쪽 결과 칸은 화면에 붙어 따라오고(follow-pane.js), 다른 종류·목록으로 바꾸면(resetList)
// 칸들 머리가 화면 위로 지나가 있을 때 칸 머리로 올려 가운데 목록을 맨 위부터 보여 준다.
function followResult(box,resetList){if(!meetingPc?.matches)return;const pane=box.querySelector('.mcol-result'),layout=box.querySelector('.mcol-layout');if(pane)followPane(pane);if(resetList&&layout){const top=layout.getBoundingClientRect().top;if(top<0)window.scrollBy({top:top-12,behavior:'instant'})}}
// MTG-프로젝트합치기 ③(10/29 시안 승인): 목록 맨 위 얇은 줄 '사업영역 안 단 보고 n건 [달기]' — 보고 있는 주(‹ ›로 넘긴 주) 안에 있을 때만, 0건이면 줄 없음.
// 그리는 곳은 여기 하나(renderMeetings가 부름), [달기] 창·저장은 report-area-tag.js(기존 app_meetings 저장 길).
function paintUntagged(){const line=$('#areaUntaggedLine');if(!line)return;const n=weekOn()&&meetings.length?untaggedInWeek(meetings,currentWeek()).length:0;line.hidden=!n;line.innerHTML=n?`<span class="area-untagged-text">사업영역 안 단 보고 <b>${n}</b>건</span><button type="button" class="area-untagged-btn" data-area-untagged aria-haspopup="dialog">달기</button>`:''}
function untaggedClick(e){const b=e.target.closest('[data-area-untagged]');if(!b)return;import('./report-area-tag.js').then(m=>m.openAreaTag(b,{meetings,from:currentWeek(),onSaved:n=>{paintUntagged();toast(`사업영역을 ${n}건 달았어요.`)},onMessage:toast}),err=>toast(err?.message||'사업영역 달기 창을 열지 못했습니다.'))}
function renderMeetings(opts){const box=$('#meetingList');if(!box)return;undockReport();if(!reportViewChosen)reportView=reportViewOf(viewPrefs.get('report_view'));renderReportChips();renderAreaChips();renderReportViewChips();renderReportWeek();paintUntagged();const pc=!!meetingPc?.matches,listView=reportView==='list',columns=pc&&listView&&reportChip===DEFAULT_KIND;box.classList.toggle('meeting-columns',pc&&listView);box.dataset.reportKind=reportChip;box.dataset.reportView=reportView;if(reportView==='calendar')renderReportCalendar(box);else if(reportView==='photo')renderReportPhotos(box);else if(columns)renderMeetingColumns(box,opts);else if(pc)renderReportList(box,opts);else renderMeetingRows(box)}
function selectMeetingKind(key){if(key===meetingSelectedKind)return;leaveReport(()=>{meetingSelectedKind=key;meetingSelectedId=null;renderMeetings({resetList:true})})}
function selectMeetingRound(id){if(String(id)===String(meetingSelectedId))return;leaveReport(()=>{meetingSelectedId=id;renderMeetings({resetResult:true})})}
// UI-상단줄 ← →: show a recorded meeting result again (its kind, then the round), through the same one renderer.
// MTG-사업보고 4단계: 고른 건이 지금 칩에 없으면(칸을 바꿨거나 다른 칸 건을 열 때) 그 건의 칸 칩으로 옮긴다. 폰은 칩만 옮긴다.
window.KPTUMeetingColumns={showPhotos:id=>{if(!id)return;leaveReport(()=>{reportViewChosen=true;reportChip=ALL_KINDS;meetingSelectedId=null;photoFocusId=String(id);reportView='photo';viewPrefs.set('report_view','photo');renderMeetings({resetList:true})})},select:item=>{if(!item?.id)return;leaveReport(()=>{if(reportView!=='list'){reportViewChosen=true;reportView='list'}const m=meetings.find(x=>String(x.id)===String(item.id));let chipChanged=m?weekFor(m):false;if(m&&reportChip!==ALL_KINDS&&reportKindOf(m)!==reportChip){reportChip=reportKindOf(m);chipChanged=true}if(!meetingPc?.matches){if(chipChanged)renderMeetings({resetList:true});return}if(reportChip!==DEFAULT_KIND){meetingSelectedId=item.id;renderMeetings(chipChanged?{resetList:true}:{resetResult:true});return}const key=item.kind??(m?(meetingName(m)?meetingNameKey(meetingName(m)):NONE_KEY):meetingSelectedKind),kindChanged=chipChanged||key!==meetingSelectedKind;meetingSelectedKind=key;meetingSelectedId=item.id;renderMeetings(kindChanged?{resetList:true}:{resetResult:true})})},
  // 열기 길(meeting-round-detail.js open)이 PC 사업 보고 화면 위에서 팝업 대신 쓴다: 세 칸·두 칸이 떠 있으면 그 건을 고르고 true, 아니면 false(팝업).
  reveal:id=>{if(!meetingPc?.matches||reportView!=='list'||(window.KPTURouter&&window.KPTURouter.current!=='meetings')||window.KPTUAreaWindow?.isOpen?.()||!$('#meetingList #mcolResult'))return false;/* MTG-프로젝트합치기 ①: 사업영역 관리 창 안에서 연 보고는 그 창 위 팝업 */const m=meetings.find(x=>String(x.id)===String(id));if(!m)return false;window.KPTUMeetingColumns.select({id:m.id});return true}};
function meetingListClick(e){if(reportView!=='list'&&reportViewClick(e))return;const kind=e.target.closest('[data-meeting-kind]');if(kind){selectMeetingKind(kind.dataset.meetingKind);return}const round=e.target.closest('[data-meeting-round]');if(round){selectMeetingRound(round.dataset.meetingRound);return}}
// 왼쪽 종류 목록·가운데 차수 목록: 위·아래 화살표로 같은 목록 안에서 옮겨 다니고(Home·End 처음·끝), Enter·Space로 고른다(버튼 기본 동작).
function meetingKindKeys(e){const item=e.target.closest?.('[data-meeting-kind],[data-meeting-round]');if(!item||!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;const all=[...$$(item.dataset.meetingKind!=null?'#meetingList [data-meeting-kind]':'#meetingList [data-meeting-round]')],i=all.indexOf(item);const next=e.key==='Home'?all[0]:e.key==='End'?all.at(-1):all[i+(e.key==='ArrowDown'?1:-1)];if(next){e.preventDefault();next.focus()}}
// ④ [+ 회의 결과]는 화면 위 하나. PC에서는 왼쪽에서 고른 종류를 미리 고른 채 연다(만들기 창에서 바꿀 수 있음). 폰은 지금처럼 비운 채.
function newMeetingName(){if(!meetingPc?.matches||reportChip!==DEFAULT_KIND)return '';const c=selectedMeetingColumn();return c&&c.key!==NONE_KEY?c.name:''}
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
 box.innerHTML=fileEntries.length?fileEntries.map(({entry,index})=>fileLine({name:entry.file.name,state:entry.kind,label:entry.label||MEETING_FILE_LABEL[entry.kind]||'',end:entry.kind==='success'?'':`<button class="icon-btn file-line-x" type="button" data-meeting-remove-file="${index}" aria-label="${esc(entry.file.name)} 선택 취소"${meetingSavePending?' disabled':''}>×</button>`})).join(''):(meetingUploadEntries.length?'':emptyHtml());
}
// S46-20 사진 정리 ⑥(명진 11/01 01:04): 사진 줄 안 '그 시각 사진 [골라 붙이기]'(time-photos.js). 고른 사진만 위 사진 파일과 같은 길(저장할 때 차례로 올림, Drive 첨부).
let meetingTimePhotos=null,meetingTimePhotosLoading=false;
function resetMeetingTimePhotos(){const host=$('#meetingTimePhotos');if(!host)return;if(meetingTimePhotos){void meetingTimePhotos();return}if(meetingTimePhotosLoading)return;meetingTimePhotosLoading=true;import('./time-photos.js').then(m=>{meetingTimePhotos=m.mountTimePhotos(host,{at:()=>$('#meetingAt')?.value||'',onPick:files=>addMeetingFiles(files),busy:()=>meetingSavePending})},e=>console.warn('time photos load failed',e)).finally(()=>{meetingTimePhotosLoading=false})}
function addMeetingFiles(files){if(meetingSavePending)return;const added=Array.from(files||[]).map(file=>({file,kind:'pending'}));if(!added.length)return;meetingUploadEntries=[...meetingUploadEntries,...added];renderMeetingSelectedFiles()}
function selectMeetingFiles(){const input=$('#meetingFiles'),files=Array.from(input.files||[]);input.value='';addMeetingFiles(files)}
function selectMeetingPhotos(){const input=$('#meetingPhotoFiles'),files=Array.from(input.files||[]).filter(isPhotoFile);input.value='';addMeetingFiles(files)}
function removeMeetingFile(e){const b=e.target.closest('[data-meeting-remove-file]');if(!b||meetingSavePending)return;const fromPhotos=!!b.closest('#meetingSelectedPhotos');const index=Number(b.dataset.meetingRemoveFile);if(meetingUploadEntries[index]?.kind==='success')return;meetingUploadEntries.splice(index,1);renderMeetingSelectedFiles();const buttons=$$(fromPhotos?'#meetingSelectedPhotos button':'#meetingSelectedFiles button');(buttons[Math.min(index,buttons.length-1)]||(fromPhotos?$('#meetingPickPhotos'):$('#meetingPickFiles'))).focus()}
// MEET-파일AI분류: 새 사업 보고의 자료도 자료실 올리기와 같은 요청·AI 자동 분류로 올린다(자료실 부품을 먼저 불러온다).
async function ensureLibraryUpload(){const loader=window.KPTUViewLoader;if(loader?.load&&!loader.isLoaded?.('library'))await loader.load('library');if(!(await window.__KPTU_LIBRARY_UPLOAD_READY__)||!window.KPTULibrary?.uploadFileForMeeting)throw new Error('자료실 올리기를 불러오지 못했습니다.')}
async function saveMeeting(){if(meetingSavePending)return;const button=$('#saveMeetingBtn'),originalLabel=button.textContent;const title=$('#meetingTitle').value.trim(),meetingAt=$('#meetingAt').value,transcript=$('#meetingTranscript')?.value??'',specialNotes=$('#meetingNotes')?.value??'',shortName=isMeetingKind(entryKind())?($('#meetingShortName')?.value||'').trim():'';if(!title)return setStatus($('#meetingStatus'),reportWords(entryKind()).nameMissing,'error');if(!meetingAt)return setStatus($('#meetingStatus'),'일시를 입력해 주세요.','error');const entryTargets=targetList(meetingEntryTargets),projectId=firstProjectId(entryTargets),locationText=($('#meetingLocation')?.value||'').trim(),roundRaw=$('#meetingRoundNo')?.value,roundNo=roundRaw&&isMeetingKind(entryKind())?Number(roundRaw):null,files=meetingUploadEntries.filter(entry=>entry.kind!=='success').map(entry=>entry.file);if(files.some(file=>file.size>100*1024*1024))return setStatus($('#meetingStatus'),reportWords(entryKind()).materials+'는 파일당 100MB까지 첨부할 수 있습니다.','error');meetingSavePending=true;$('#newMeetingBtn').disabled=true;renderMeetingSelectedFiles();setBusy(button,true);button.textContent='저장 중…';setStatus($('#meetingStatus'),'저장 중…');let savedMeeting=null,linkNote='';try{const actionRows=$$('#meetingActionList .meeting-action-row').map(r=>({title:String(r.dataset.title||'').trim(),due:r.dataset.due||''}));const lineTitle=$('#meetingActionTitle')?.value.trim()||'',lineDue=$('#meetingActionDue')?.value||'';if(lineTitle||lineDue)actionRows.push({title:lineTitle,due:lineDue});if(actionRows.some(x=>!x.title))throw new Error('후속 할 일을 입력해 주세요.');const areaBody=await (areaFields()?.body()??{}),fileProjectId=areaBody.business_area_id||projectId;const withLocation=locationText&&await locationAvailable().catch(()=>false);const rows=await api('/rest/v1/app_meetings',{method:'POST',body:{workspace_id:workspace.id,activity_kind:entryKind(),project_id:projectId,...areaBody,...(withLocation?{location:locationText}:{}),title:shortName&&shortName!==title?shortName:title,series_name:title,round_no:Number.isFinite(roundNo)?roundNo:null,meeting_at:toMeetingISO(meetingAt),notes:specialNotes.trim()?specialNotes:'',transcript_text:transcript,result_status:'final',finalized_at:new Date().toISOString(),created_by:user.id},prefer:'return=representation'});const meeting=rows?.[0];if(!meeting)throw new Error('저장된 사업 보고를 확인하지 못했습니다.');savedMeeting=meeting;if(entryTargets.length){const linked=await saveReportTargets(meeting,entryTargets);if(!linked.ok)linkNote='연결은 저장하지 못했어요. '+(linked.message||'');else if(linked.legacy&&linked.skippedOrgs)linkNote=LEGACY_NOTE}if(meetingEntryOnSaved){try{await meetingEntryOnSaved(meeting)}catch(err){console.warn('report onSaved failed',err);linkNote=(linkNote?linkNote+' ':'')+'사업 보고는 저장했지만 업데이트와 잇지 못했어요.'}}window.KPTUDriveSummary?.saved?.();for(const a of actionRows){const result=await window.KPTURuntime.api('/functions/v1/google-tasks?action=create',{method:'POST',body:{action:'create',title:a.title,notes:'',due:a.due||null,links:[{meeting_id:meeting.id},...(projectId?[{project_id:projectId}]:[])]}});if(result?.link_error)throw new Error('Google 할 일은 만들었지만 사업 보고 연결을 저장하지 못했습니다.')}let uploaded=0,failed=0,readFailureMessage='';const libraryReady=files.length?ensureLibraryUpload():null;for(const file of files){const entry=meetingUploadEntries.find(x=>x.file===file);if(entry){entry.kind='uploading';entry.label='업로드 중';renderMeetingSelectedFiles()}try{await libraryReady;await window.KPTULibrary.uploadFileForMeeting({id:meeting.id,project_id:fileProjectId,kind:entryKind(),day:seoulDateKey(meeting.meeting_at||meetingAt)},file);if(projectId)window.KPTUDriveSummary?.saved?.();uploaded++;if(entry){entry.kind='success';entry.label='완료'}}catch(err){failed++;const readFailed=err?.code==='file_read_failed';if(readFailed)readFailureMessage=err.message;if(entry){entry.kind='error';entry.label=readFailed?err.message:'실패'}console.warn('meeting material upload failed',file.name,err)}renderMeetingSelectedFiles()}closeModal('meetingModal');showSaved(meeting,meetingAt);await reload(['meetings','documents']);window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:meeting.id}}));window.dispatchEvent(new CustomEvent('kptu:record-saved',{detail:{kind:'meeting',id:meeting.id,project_id:projectId,day:seoulDateKey(meeting.meeting_at||meetingAt),title:meeting.series_name||meeting.title||title,text:transcript}}));if(actionRows.length)window.dispatchEvent(new CustomEvent('kptu:tasks-changed'));if(failed)toast(`사업 보고는 저장했습니다. ${reportWords(entryKind()).materials} ${uploaded}개 저장 · ${failed}개 실패${readFailureMessage?' · '+readFailureMessage:''}${linkNote?' · '+linkNote:''}`);else toast((files.length?`사업 보고와 자료 ${uploaded}개를 저장했습니다.`:'사업 보고를 저장했습니다.')+(linkNote?' '+linkNote:''))}catch(e){if(savedMeeting){closeModal('meetingModal');showSaved(savedMeeting,meetingAt);try{await reload(['meetings','documents'])}catch(err){console.warn('meeting list refresh failed',err)}window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:savedMeeting.id}}));toast('사업 보고는 저장됐습니다. 후속 할 일 상태를 사업 보고 상세에서 확인해 주세요. '+e.message)}else setStatus($('#meetingStatus'),e.message,'error')}finally{meetingSavePending=false;$('#newMeetingBtn').disabled=false;renderMeetingSelectedFiles();setBusy(button,false);button.textContent=originalLabel}}
async function reload(parts,render=renderAll){const wid=workspace.id;for(const p of parts){if(p==='meetings'){meetings=await api('/rest/v1/app_meetings?workspace_id=eq.'+wid+'&select=*&order=meeting_at.desc');await loadReportLinks()}if(p==='documents')documents=await api('/rest/v1/app_documents?workspace_id=eq.'+wid+'&select=*&order=document_date.desc.nullslast,created_at.desc');if(p==='spaces'){spaces=await api('/rest/v1/app_spaces?workspace_id=eq.'+wid+'&select=*&order=sort_order.asc,created_at.asc');publishProjects()}}render()}
window.__KPTU_RELOAD_MEETINGS__=async()=>{if(!workspace?.id)return;[meetings,documents]=await Promise.all([api('/rest/v1/app_meetings?workspace_id=eq.'+workspace.id+'&select=*&order=meeting_at.desc'),api('/rest/v1/app_documents?workspace_id=eq.'+workspace.id+'&select=*&order=document_date.desc.nullslast,created_at.desc')]);await loadReportLinks();const sel=meetingSelectedId!=null&&meetings.find(x=>String(x.id)===String(meetingSelectedId));if(sel)weekFor(sel);renderMeetings()};
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
// MTG-사업보고 4단계: 입력 창 맨 위 칸 칩(#meetingKindPick). 저장 때 activity_kind로 보낸다. 차수·짧은 이름 줄은 [회의] 칸에서만 창에 있다(MTG-보고창정리: 숨김이 아니라 창에서 뺌, 그리는 주인은 paintEntryWords 하나).
// MTG-사업보고 6단계: 연결(프로젝트·담당조직)은 한 곳 — 연결 표의 '출처 회의' 줄(report-links.js). 입력 창 [연결할 곳]·결과 창·목록·프로젝트/조직 화면이 같은 줄을 읽고 쓴다.
let meetingEntryTargets=[],entryNames=new Map(),reportTargetMap=new Map(),orgNames=new Map();
const tkey=t=>t.kind+':'+t.id;
function targetNameOf(t){return (t.kind==='project'?projectName(t.id):orgNames.get(t.id))||entryNames.get(tkey(t))||(t.kind==='project'?'사업영역':missingOrganizationLabel(orgNames.size>0))}
function reportTargetsOf(m){return reportTargetMap.get(m?.id)||(m?.project_id?[{kind:'project',id:m.project_id}]:[])}
function reportLinkLabel(m){return targetsLabel(reportTargetsOf(m),targetNameOf)}
async function loadReportLinks(){
  noteLocationFromMeetings(meetings);noteAreaFromMeetings(meetings);noteAreaNoneFromMeetings(meetings); // 장소 칸이 서버에 있는지: 이미 읽은 사업 보고 줄(select=*)로 정한다. 입력 창을 열 때 새 요청을 보내지 않는다.
  try{
    const [map,orgs]=await Promise.all([readAllReportTargets(meetings),api('/rest/v1/app_suborganizations?workspace_id=eq.'+workspace.id+'&select=id,name&limit=1000')]);
    reportTargetMap=map;orgNames=new Map((orgs||[]).map(o=>[o.id,o.name]));
  }catch(e){console.warn('report links read failed',e)}
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
  }catch(e){setStatus($('#meetingStatus'),e.message||'연결할 곳을 불러오지 못했습니다.','error')}
}
// 다른 화면(프로젝트·담당조직·캘린더·바구니·[+ 추가])이 사업 보고 입력 창을 여는 길: 화면을 불러온 뒤 칸 고르기(또는 정해진 칸) → 채워진 입력 창.
window.KPTUReportEntry={open:async(opts={})=>{
  if(!workspace?.id)return false;
  await loadForView('meetings');
  const trigger=opts.trigger||document.activeElement;
  if(opts.dedupe&&opts.name&&(opts.at||opts.date)){
    // 같은 날·같은 이름의 사업 보고가 이미 있으면 먼저 묻는다(일정에서 [결과 남기기]를 두 번 눌렀을 때 중복 방지).
    const day=String(opts.at||opts.date).slice(0,10),key=meetingNameKey(opts.name);
    const same=meetings.find(m=>m.meeting_at&&seoulDateKey(new Date(m.meeting_at))===day&&meetingNameKey(meetingName(m))===key);
    if(same&&confirm('같은 날 같은 이름의 사업 보고가 이미 있어요.\n[확인] 그 사업 보고를 열기 / [취소] 새로 만들기')){
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
let entryArea=null;const areaFields=()=>entryArea||=mountAreaFields($('#meetingAreaFields'),{onMessage:m=>setStatus($('#meetingStatus'),m,'error'),material:()=>({title:$('#meetingTitle')?.value||'',text:$('#meetingTranscript')?.value||''})});
const entryRoundRows=createFieldRows(['meetingRoundNo','meetingShortName']);
function entryKind(){return isReportKind(meetingEntryKind)?meetingEntryKind:DEFAULT_KIND}
function paintEntryWords(){
  const kind=entryKind(),w=reportWords(kind),meeting=isMeetingKind(kind),set=(sel,text)=>{const el=$(sel);if(el)el.textContent=text};
  const modal=$('#meetingModal');if(modal)modal.dataset.reportKind=kind;
  set('#meetingTitleLabel',w.nameLabel);set('[data-rw="meetingResultLegend"]',w.resultLegend);set('#meetingTextLabel',w.textLabel);set('#meetingMaterialsHead',w.materials);
  const ta=$('#meetingTranscript');if(ta)ta.placeholder=w.textPlaceholder;
  $('#meetingPickFiles')?.setAttribute('aria-label',w.pickFiles);
  // 회의명 고르기·차수·짧은 이름은 [회의] 칸에서만 보인다. 다른 칸은 제목 한 칸.
  entryRoundRows.paint(meeting);
  const select=$('#meetingNameSelect');
  if(select&&!meeting&&select.value!=='__other__'){select.value='__other__';select.dispatchEvent(new Event('change'))}
  renderMeetingSelectedFiles();
  window.dispatchEvent(new CustomEvent('kptu:report-entry-kind',{detail:{kind}}));
}
function paintEntryKind(){const host=$('#meetingKindPick');if(!host)return;renderFilterChips(host,{label:'칸',value:entryKind(),options:REPORT_KINDS.map(k=>({value:k.value,label:k.label})),onChange:value=>{meetingEntryKind=value;paintEntryKind()}});paintEntryWords()}
// [+]: [전체] 칩이면 칸 고르기 창을 먼저 열고, 다른 칩이면 그 칸이 채워진 입력 창을 바로 연다.
// MTG-한줄업데이트: [전체]의 [+] 메뉴 맨 위 [한 줄 업데이트], [한 줄] 칩에서 [+]는 바로 한 줄 창. 사업영역 칩을 고른 채면 그 사업영역을 미리 고른다.
function openOnelineEntry(trigger){const area=areaChip!=='all'&&areaChip!==NO_AREA&&areaChip!==AREA_NONE?areaChip:'';import('./report-oneline.js').then(m=>m.openOneline(trigger,{areaId:area,onSaved:row=>{showSaved(row);renderMeetings({resetList:true})}}),err=>toast(err?.message||'한 줄 업데이트 창을 열지 못했습니다.'))}
function newReport(trigger){if(reportChip===ONELINE_KIND){openOnelineEntry(trigger);return}if(reportChip!==ALL_KINDS){openMeetingModal({name:newMeetingName(),kind:reportChip});return}pickReportKind(trigger,{title:'어느 칸에 남길까요?',onPick:kind=>openMeetingModal({kind,trigger}),onOneline:()=>openOnelineEntry(trigger)})}
function openMeetingModal({name='',kind=DEFAULT_KIND,trigger=document.activeElement,targets=[],at='',date='',location='',text='',onSaved=null}={}){meetingEntryOnSaved=onSaved;meetingEntryKind=isReportKind(kind)?kind:DEFAULT_KIND;entryRoundRows.paint(true);['meetingTitle','meetingAt','meetingNotes','meetingRoundNo','meetingShortName','meetingTranscript'].forEach(id=>{if($('#'+id))$('#'+id).value=''});meetingRoundEdited=false;meetingUploadEntries=[];renderMeetingSelectedFiles();if($('#meetingFiles'))$('#meetingFiles').value='';$('#meetingProject').innerHTML=projectOptions(true);meetingEntryTargets=targetList(targets);entryNames=new Map();$('#meetingAt').value=defaultReportAt({at,date});if($('#meetingLocation'))$('#meetingLocation').value=location||'';if(text)$('#meetingTranscript').value=text;paintEntryPlaces();areaFields()?.start({areaId:firstProjectId(meetingEntryTargets)||''});void locationAvailable().then(ok=>{const row=$('#meetingLocationRow');if(row)row.hidden=!ok},()=>{});installMeetingNamePicker($('#meetingTitle'),'meeting');setupMeetingNamePicker($('#meetingNameSelect'),$('#meetingTitle'),$('#meetingNameMatch'),$('#meetingNameUseMatch'),{current:name,names:meetingNameChoices(DEFAULT_KIND),onChoose:suggestMeetingRound,onCustom:()=>{const round=$('#meetingRoundNo');if(round&&!meetingRoundEdited)round.value=''}});paintEntryKind();resetMeetingTimePhotos();openModal('meetingModal',{trigger,initialFocus:isMeetingKind(meetingEntryKind)&&meetingNameChoices(DEFAULT_KIND).length?'#meetingNameSelect':'#meetingTitle'})}
function bind(){
 $('#bootRetryBtn').onclick=()=>location.reload();$('#bootLogoutBtn').onclick=logout;$('#accessDeniedLogoutBtn').onclick=logout;
 document.addEventListener('click',async e=>{const b=e.target.closest('button,a');if(!b)return;if(b.dataset.close){closeModal(b.dataset.close);return}});
 if(window.KPTURouter?.on)window.KPTURouter.on('calendar',()=>{renderCalendar();if(googleState.connected)window.KPTUCalendarPersistence?.refresh?.()});
 if($('#homeAddEvent'))$('#homeAddEvent').onclick=openEventModal;$('#newEventBtn').onclick=openEventModal;$('#newDocumentBtn').onclick=openDocumentModal;$('#newMeetingBtn').onclick=e=>newReport(e.currentTarget);bindReportMore();mountBigWrite($('#meetingTranscript'),{title:'결과 원문 크게 쓰기'});mountBigWrite($('#meetingNotes'),{title:'특이사항 크게 쓰기'});$('#meetingPlaces').onclick=e=>void choosePlaces(e.currentTarget);$('#meetingList')?.addEventListener('click',meetingListClick);$('#reportWeekFilter')?.addEventListener('click',reportWeekClick);$('#areaUntaggedLine')?.addEventListener('click',untaggedClick);$('#reportFilterBtn')?.addEventListener('click',e=>openReportFilter(e.currentTarget));$('#meetingList')?.addEventListener('keydown',meetingKindKeys);meetingPc?.addEventListener?.('change',()=>{if(workspace?.id)renderMeetings()});
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
/* BIZ-버튼줄정리(10/29 시안 B): 사업 보고 위쪽 줄 ⋯ 메뉴 두 줄 — 사업요약표 미리보기 · 사업영역 관리. 공용 메뉴 부품(anchored-menu.js: ⋯ 바로 아래 오른쪽 맞춤,
   바깥 누르기·Esc·뒤로가기로 닫힘)과 공용 글자 줄 모양(.topline-add-menu). 미리보기는 ⋯를 기준 자리로 연다(전에는 줄의 [사업요약표 미리보기] 버튼).
   [사업영역 관리]는 메뉴가 닫힌 뒤 사업 보고 위의 창으로 연다(area-window.js, MTG-프로젝트합치기 ①: 닫으면 보던 주·거르기 그대로). */
function bindReportMore(){
  const more=$('#reportMore');if(!more||more.dataset.reportMoreBound)return;more.dataset.reportMoreBound='1';
  let menu=null;
  more.addEventListener('click',async()=>{
    if(!menu){const {createAnchoredMenu}=await import('./anchored-menu.js');
      menu=createAnchoredMenu({id:'reportMoreMenu',className:'topline-add-menu report-more-menu',label:'사업 보고 더 보기',historyKey:'kptuReportMore',key:()=>'report',
        render:()=>'<button type="button" data-report-preview>사업요약표 미리보기</button><button type="button" data-report-areas>사업영역 관리</button>',
        onAction:(b,{trigger})=>{
          if(b.matches('[data-report-preview]'))return void import('./report-summary-preview.js').then(m=>m.openReportPreview(trigger,{meetings:()=>meetings}),err=>toast(err?.message||'미리보기를 열지 못했습니다.'));
          if(b.matches('[data-report-areas]'))return void window.KPTUAreaWindow?.open?.({trigger});
        }});}
    menu.open(more);
  });
}
