(()=>{
'use strict';
// PROFILE-화면정리(docs/design/profile-screen-tidy.md): 이 모듈이 #profileView의 유일한 renderer다.
// S71-35 ORG-조직관리로모으기(2026-11-26 사용자 결정): '담당조직 현황' 체크 칸과 '내 묶음' 칸은 내 프로필에서 없앴다(그리기·코드째).
// 담당 추가·보관·삭제 등은 조직 관리 화면(suborganizations.js), 내 묶음은 조직 관리 목록 맨 아래 접힌 '내 묶음'(묶음 칸 모듈은 조직 관리가 부른다).
// 담당 여부 저장(app_suborganization_assignees·app_profile_workplaces)·서버 함수는 그대로다 — 이 화면이 더는 쓰지 않을 뿐, 자료는 지우지 않는다.
const rt=window.KPTURuntime;
let user=null,workspaceId=null;
// S71-34 PROFILE-이름만(사용자 11/26 결정): 기본 정보는 이름(닉네임) 하나다.
// 소속·부서·직책은 화면에서 받지도 읽지도 보내지도 않는다. 이미 저장된 값과 DB 칸(app_profiles.union_name·department_name·job_title)은 지우지 않는다(사용자 결정 대기).
const EMPTY_SAVED={name:''};
let saved={...EMPTY_SAVED},bound=false;
const SAVED_MS=2000;
const api=(path,options={})=>rt.api(path,options);
const $=sel=>document.querySelector(sel);
// S71-36 PROFILE-설정화면(사용자 11/26 시안 확정 "ㅇㅋ", 안드로이드 설정처럼): 첫 화면은 묶음별 한 줄 메뉴만(이름 + 오른쪽 작은 회색 요약 + ›),
// 줄을 누르면 그 화면(?view=profile&pane=…, 라우터 한 겹), 뒤로가기·‹는 내 프로필로. 줄은 공용 설정 줄 부품(settings-list.mjs)이 그린다.
// 화면 하나에 한 장(data-ps-page)만 보이고, 어떤 장이 보일지는 이 파일의 show() 하나가 정한다(라우터의 sub와 같음).
// 각 장 안은 지금처럼 각 모듈이 그리고 바로 서버에 저장한다(아래 load*). 맨 아래 큰 [저장]은 없다: 이름도 바꾸면 바로 저장.
const PAGES=['name','home','push','backup','drive','mcp','account','status'];
const PAGE_TITLE={name:'이름',home:'홈 칸',push:'알림 설정',backup:'내 기록 백업',drive:'구글 드라이브',mcp:'Claude 읽기 연결',account:'계정',status:'사용 현황'};
const titleOf=key=>PAGE_TITLE[key];
// 모듈이 알려 주는 첫 화면 요약(오른쪽 회색 글). show=false면 그 줄을 그리지 않는다(드라이브 연결 없음·Claude 연결 행 없음·사용 현황 줄 없음 — 서버 답이 정함).
// known=false: 아직 서버 답을 못 받음(그동안은 주소로 바로 연 그 장을 닫지 않는다).
const summaries={drive:{show:false,text:'',known:false},mcp:{show:false,text:'',known:false},status:{show:false,text:'',known:false}};
let sl=null,page='',entered=false;
const slReady=import('./settings-list.mjs').then(m=>(sl=m));
const pageHtml=key=>`<div class="sl-page ps-page" data-ps-page="${key}" hidden aria-label="${titleOf(key)}"><div class="sl-page-head"><button type="button" class="icon-btn sl-back" data-ps-back aria-label="뒤로">‹</button><h2 class="sl-page-title">${titleOf(key)}</h2></div>${pageBody(key)}</div>`;
const pageBody=key=>PAGE_BODY[key]||'';
const PAGE_BODY={
  name:`<div class="sl-group"><div class="sl-row"><input id="psName" type="text" placeholder="이름" aria-label="이름" autocomplete="off"></div></div><p class="sl-note">닉네임 써도 돼요</p><p class="sl-status" id="psNameState" role="status" aria-live="polite"></p>`,
  home:'<div id="psHomeOffPanel"></div>',
  push:'<div id="psPushPanel"></div>',
  backup:'<div id="psBackupPanel"></div>',
  drive:'<div id="psDriveFoldersPanel"></div>',
  mcp:'<div id="psMcpReadPanel"></div>',
  account:'<div id="psAccountPanel"><div class="ps-account-actions" data-ps-account-rows></div><div data-ps-widget></div><div data-ps-account-delete></div></div>',
  status:'<div class="ps-status" id="psStatusPanel"></div>',
};
function installView(){
  if($('#profileView'))return;
  $('#appView')?.insertAdjacentHTML('beforeend',`<section id="profileView" class="view-panel hidden" aria-label="내 프로필"><div class="sl-page ps-page ps-root" data-ps-page="" id="psRoot"></div>${PAGES.map(pageHtml).join('')}</section>`);
}
// 첫 화면: 묶음별 한 줄 메뉴만. 요약은 각 모듈이 읽은 서버 값(onSummary).
function renderRoot(){
  const root=$('#psRoot');if(!root||!sl)return;
  const nav=(key,sum)=>sl.navRow({label:titleOf(key),sum,attrs:{'data-ps-open':key}});
  const show=key=>summaries[key]?.show!==false;
  const text=key=>summaries[key]?.text||'';
  root.innerHTML=sl.groupHtml([nav('name',saved.name)])
    +sl.groupHtml([nav('home',text('home')),nav('push',text('push'))],{title:'앱'})
    +sl.groupHtml([nav('backup',text('backup')),show('drive')&&nav('drive',text('drive')),show('mcp')&&nav('mcp',text('mcp'))],{title:'자료'})
    +sl.groupHtml([nav('account',''),show('status')&&nav('status','')]);
}
function setSummary(key,next){summaries[key]={show:next?.show!==false,text:String(next?.text||''),known:true};renderRoot();if(page===key&&summaries[key].show===false&&['drive','mcp','status'].includes(key))leavePage()}
const pageAvailable=key=>key===''||(PAGES.includes(key)&&(!['drive','mcp','status'].includes(key)||summaries[key].show||!summaries[key].known));
// 장 바꾸기의 하나뿐인 주인. 떠나는 장이 이름이면 고치던 이름을 먼저 저장한다.
function show(key){
  key=PAGES.includes(key)?key:'';
  if(!pageAvailable(key))key='';
  if(page==='name'&&key!=='name')void saveName();
  const was=page;page=key;
  document.querySelectorAll('#profileView [data-ps-page]').forEach(el=>{el.hidden=el.dataset.psPage!==key});
  if(was!==key){
    window.scrollTo?.({top:0,behavior:'instant'});
    if(key)$(`#profileView [data-ps-page="${key}"] [data-ps-back]`)?.focus({preventScroll:true});
    else if(was)$(`#psRoot [data-ps-open="${was}"]`)?.focus({preventScroll:true});
  }
}
function openPage(key){
  if(!PAGES.includes(key))return;
  if(window.KPTURouter?.current==='profile'&&window.KPTURouter.setSub?.('profile',key))entered=true;
  show(key);
}
// ‹: 이 화면 안에서 들어온 장이면 한 걸음 뒤로(폰 뒤로가기와 같음), 주소로 바로 열린 장이면 내 프로필로 바꿔 쓴다(뒤로 가면 앞 화면).
function leavePage(){
  if(entered&&window.KPTURouter?.current==='profile'&&history.state?.kptuView==='profile'){entered=false;history.back();return}
  window.KPTURouter?.setSub?.('profile',null,{replace:true});show('');
}
async function context(){if(!rt?.session||!(await rt.session.ensure()))return false;user=await api('/auth/v1/user');const rows=await api(`/rest/v1/app_workspace_members?user_id=eq.${user.id}&select=workspace_id&limit=1`);workspaceId=rows?.[0]?.workspace_id||null;return !!workspaceId}
const nameValue=()=>($('#psName')?.value||'').trim();
const FIELDS=[['#psName','name']];
async function load(){
  if(!user&&!(await context()))return false;
  const profile=await api(`/rest/v1/app_profiles?user_id=eq.${user.id}&select=user_id,display_name&limit=1`);
  const p=profile?.[0]||{},next={name:p.display_name||user.user_metadata?.display_name||''};
  // 고치던 칸(서버 값과 달라진 칸)은 덮어쓰지 않는다. 고치지 않은 칸만 서버 값으로 맞춘다.
  for(const [id,key] of FIELDS){const el=$(id);if(el&&el.value.trim()===saved[key])el.value=next[key]}
  saved=next;
  renderRoot();
  void loadPush();
  void loadBackup();
  void loadDriveFolders();
  void loadMcpRead();
  void loadHomeOff();
  return true;
}
// S71-34 PROFILE-주간캘린더칸삭제(명진 11/26): '주간 정리 일정 캘린더' 칸은 없앴다. 주간 정리는 모든 캘린더 일정을 읽고, 이미 저장된 값
// (view_prefs.report_calendar)은 서버에 그대로 두어 업무 캘린더로 계속 쓴다(report-calendar.mjs). 화면에서 바꾸는 길은 없다.
// 아래 장들은 각 모듈이 그 자리(host) 안을 그리고 바로 서버에 저장한다. 첫 화면 요약은 onSummary로 받는다.
const mounted=new Map();
async function mountOnce(key,sel,load){
  const host=$(sel);if(!host)return null;
  let m=mounted.get(key);
  if(!m||m.host!==host){const ready=load(host);m={host,ready};mounted.set(key,m);ready.catch(()=>{if(mounted.get(key)===m)mounted.delete(key)})}
  return m.ready;
}
const summaryTo=key=>next=>setSummary(key,next);
async function loadPart(key,sel,load,run=(x)=>x.load()){
  try{const part=await mountOnce(key,sel,load);if(part)await run(part)}
  catch(e){console.error('profile '+key,e?.name||'Error')}
}
// APP-폰알림 N4: '알림 설정' 장(이 폰 알림·종류별 켜고 끄기·조용한 시간·시험 알림·등록된 폰)은 phone-push-settings.js.
const loadPush=()=>loadPart('push','#psPushPanel',host=>import('./phone-push-settings.js').then(m=>m.mountPhonePushSettings(host,{rt,onSummary:summaryTo('push')})));
// PRIVACY-백업안내(S66-01): '내 기록 백업' 장은 record-backup.js.
const loadBackup=()=>loadPart('backup','#psBackupPanel',host=>import('./record-backup.js').then(m=>m.mountRecordBackup(host,{rt,onSummary:summaryTo('backup')})));
// S69-41: '구글 드라이브' 장(앱이 쓰는 드라이브 폴더 + 열기 ↗)은 drive-folders-panel.js. 드라이브 연결이 없거나 읽기가 실패하면 첫 화면 줄이 없다.
const loadDriveFolders=()=>loadPart('drive','#psDriveFoldersPanel',host=>import('./drive-folders-panel.js').then(m=>m.mountDriveFolders(host,{rt,account:()=>user?.email||'',onSummary:summaryTo('drive')})));
// MCP-Claude읽기 M-5: 'Claude 읽기 연결' 장은 mcp-read-settings.js. 설정 행이 있는 작업공간에서만 첫 화면 줄이 있다(행은 SQL로만, 설계 7.6).
const loadMcpRead=()=>loadPart('mcp','#psMcpReadPanel',host=>import('./mcp-read-settings.js').then(m=>m.mountMcpReadSettings(host,{rt,onSummary:summaryTo('mcp')})));
// S67-52 HOME-칸끄기: '홈 칸' 장(끌 수 있는 칸마다 스위치 — 서버 화면 기억 view_prefs.home_off에 바로 저장)은 home-off.js.
const loadHomeOff=()=>loadPart('home','#psHomeOffPanel',host=>import('./home-off.js').then(m=>m.mountHomeOffSettings(host,{onSummary:summaryTo('home')})));
function emitProfileChange(){window.dispatchEvent(new CustomEvent('kptu:profile-updated'));window.__KPTU_RELOAD_TEAM_MEMBERS__?.()}
// 이름: 바꾸면 바로 저장(칸을 벗어날 때·Enter·장을 떠날 때). 빈 이름은 저장하지 않고 저장된 이름으로 되돌린다. 저장은 한 줄로 세운다.
let nameChain=Promise.resolve(),nameSaving=false,nameTimer=null;
function sayName(text,error=false){const el=$('#psNameState');if(!el)return;el.textContent=text;el.classList.toggle('sl-error',!!error);clearTimeout(nameTimer);if(text&&!error)nameTimer=setTimeout(()=>{if(el.textContent===text)el.textContent=''},SAVED_MS)}
function saveName(){
  const value=nameValue(),el=$('#psName');
  if(!user||value===saved.name)return nameChain;
  if(!value){if(el)el.value=saved.name;sayName('이름을 입력해 주세요.',true);return nameChain}
  nameSaving=true;
  nameChain=nameChain.then(async()=>{
    try{await api(`/rest/v1/app_profiles?user_id=eq.${user.id}`,{method:'PATCH',body:{display_name:value,updated_at:new Date().toISOString()}});saved={...saved,name:value};sayName('저장했어요');emitProfileChange()}
    catch{sayName('저장하지 못했어요. 다시 해 주세요.',true)}
    finally{nameSaving=false;renderRoot()}
  });
  return nameChain;
}
function bind(){
  if(bound)return;bound=true;
  const view=$('#profileView');
  view?.addEventListener('click',e=>{
    const open=e.target.closest?.('[data-ps-open]');
    if(open){openPage(open.dataset.psOpen);return}
    if(e.target.closest?.('[data-ps-back]'))leavePage();
  });
  view?.addEventListener('change',e=>{if(e.target.matches?.('#psName'))void saveName()});
  view?.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches?.('#psName')){e.preventDefault();void saveName()}});
  window.KPTURouter?.on?.('profile',detail=>{show(detail?.sub||'');return load()});
  window.addEventListener('kptu:sub-changed',e=>{if(e.detail?.view!=='profile')return;if(!e.detail.sub)entered=false;show(e.detail.sub||'')});
}
// 이름 장을 떠나면(다른 화면으로 가도) 고치던 이름을 저장한다. 묻지 않는다(바꾸면 바로 저장).
window.addEventListener('kptu:before-view-change',e=>{if(window.KPTURouter?.current==='profile'&&e.detail?.view!=='profile'&&page==='name')void saveName()});
window.addEventListener('beforeunload',e=>{if($('#profileView')&&!$('#profileView').classList.contains('hidden')&&(nameSaving||(page==='name'&&nameValue()&&nameValue()!==saved.name))){e.preventDefault();e.returnValue=''}});
// '계정' 장: [내 공간](허용된 사람만 — 서버가 정함, myspace-return.js) · 폰 위젯(폰 앱에서만) · 계정 삭제(따로 떨어진 묶음).
function renderAccountRows(allowed=window.__KPTU_MYSPACE_ALLOWED__){const box=$('#profileView [data-ps-account-rows]');if(!box||!sl)return;box.innerHTML=allowed?sl.groupHtml([sl.navRow({label:'내 공간',attrs:{id:'psMySpaceEntry','data-goto':'myspace'}})]):''}
window.addEventListener('kptu:myspace-access',event=>renderAccountRows(event.detail?.allowed));
// UI-업데이트기록입구: 업데이트 기록은 계정 메뉴 [업데이트 기록] 화면(release-notes-ui.js) 한 곳이다. 내 프로필에는 두지 않는다.
// APP-폰앱새로 ③: 폰 앱에서만 '계정' 장에 폰 위젯 줄(phone-widget-line.js). 웹 브라우저에서는 아무것도 붙지 않는다.
function installWidgetLine(){if(!/KPTUAndroid/i.test(navigator.userAgent||''))return;import('./phone-widget-line.js').then(m=>m.mountWidgetLine($('#profileView [data-ps-widget]'))).catch(()=>{})}
// HOME-업무일지홈: 마지막 수집 시각·AI 사용량(+ 글자 읽기 끝남 줄)은 '사용 현황' 장(profile-status.js, MULTI-다른담당자맞춤 ⑥).
// 보일 줄이 하나도 없으면(운영자 기능이 없는 사람 — 서버 허용 표가 정함) 첫 화면에 '사용 현황' 줄이 없다.
let statusMount=null;
function installStatus(){import('./profile-status.js').then(m=>{statusMount=statusMount||m.mountProfileStatus($('#psStatusPanel'),{onSummary:summaryTo('status')})}).catch(()=>{})}
window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view==='profile')statusMount?.refresh()});
// S69 STORE-계정삭제: '계정' 장 끝 따로 떨어진 묶음의 [계정 삭제](account-delete.js가 줄·확인 창의 주인). 폰 앱·웹 모두.
function installAccountDelete(){import('./account-delete.js').then(m=>m.mountAccountDelete($('#profileView [data-ps-account-delete]'))).catch(()=>{})}
// S71-35: 옛 초대 링크(?view=profile&join=…)는 '내 묶음'이 옮겨 간 조직 관리로 넘긴다(주소의 join은 그대로 — 조직 관리의 내 묶음 칸이 읽자마자 지운다).
function forwardInvite(){try{if(new URL(location.href).searchParams.has('join')&&window.KPTURouter?.current==='profile')window.KPTURouter.go('team',{replaceUrl:true})}catch{}}
async function boot(){
  installView();await slReady;renderRoot();renderAccountRows();installWidgetLine();installAccountDelete();
  show(window.KPTURouter?.current==='profile'?window.KPTURouter.sub||'':'');
  forwardInvite();window.KPTURouter?.on?.('profile',forwardInvite);
  if(!(await context()))return false;
  // 사용 현황은 로그인·작업공간을 안 뒤에 붙인다(그 전 첫 읽기는 운영자 기능을 '없음'으로 잘못 알아 장을 닫을 수 있다).
  installStatus();bind();await load();window.KPTUProfileSettings={reload:load};return true;
}
window.addEventListener('kptu:session-changed',async()=>{user=null;workspaceId=null;saved={...EMPTY_SAVED};for(const [id] of FIELDS){const el=$(id);if(el)el.value=''}renderRoot();if(await context()){bind();await load()}});
window.__KPTU_PROFILE_SETTINGS_READY__=boot().catch(err=>{console.error('profile settings init',err);return false});
})();
