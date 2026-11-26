import {word} from './brand/brand.mjs';
const kptuHoldToast=(el,opt)=>{el.classList.remove('hidden');import('./small-notice.js').then(m=>m.holdToast(el,opt)).catch(()=>{})}; // UI-작은알림자리: 일반 스크립트라 동적 import(#toast 위쪽·2초·올려 두면 멈춤)
(()=>{
'use strict';
// PROFILE-화면정리(docs/design/profile-screen-tidy.md): 이 모듈이 #profileView의 유일한 renderer다.
// S71-36: 이름은 바꾸면 바로 저장. [저장]은 '담당조직 현황' 장 안에 하나(담당 사업장 체크 변경 — 사업장 추가 → 사업장 삭제 순서, 서버 호출 그대로).
// 담당 사업장 목록의 묶음·순서는 organization-order.js(KPTUOrganizationOrder)의 정의를 그대로 쓴다.
// PROFILE-담당사업장접기(2026-10-29 명진 결정): 칸은 '담당조직 현황 n' 한 줄로 접힌 채 시작한다. 펼치면 담당만 체크된 채(체크를 풀면
// 저장 전까지 흐리게 남음), 그 아래 접힌 '그 외 n'(맨 위 찾기 칸, 초성 포함). 모양은 공용 부품 pick-fold.mjs 하나다.
const rt=window.KPTURuntime;
let user=null,workspaceId=null,workplaces=[],legacyWorkplaces=[],organizations=[],assignments=[],profileWorkplaces=[];
// S71-34 PROFILE-이름만(명진 11/26 "기본 정보는 이름(닉네임) 말고 나머지는 수집 x 창도 없애"): 기본 정보 칸은 이름(닉네임) 하나다.
// 소속·부서·직책은 화면에서 받지도 읽지도 보내지도 않는다. 이미 저장된 값과 DB 칸(app_profiles.union_name·department_name·job_title)은 지우지 않는다(명진 결정 대기).
const EMPTY_SAVED={name:''};
let baseline=new Set(),saved={...EMPTY_SAVED},saving=false,bound=false,fold=null,freshFold=true,note=null;
// PROFILE-바뀜것없음글자빼기(사용자 확정): 담당조직 현황 장의 [저장] — 바뀐 게 없으면 상태 글자 없음 + 흐리게. 고쳤을 때만 'n곳 바뀜, 저장 안 됨'. 저장 직후 잠깐 '저장됨'.
let justSaved=0,justSavedTimer=null;const SAVED_MS=2000;
// S62-16 PROFILE-없음칸제목: 담당조직이 하나도 없을 때도 칸 제목 + 안내 한 줄 → 아래 [조직 보고로](연결 안내 공용 부품 connect-note.mjs).
const foldReady=Promise.all([import('./pick-fold.mjs').then(m=>(fold=m)),import('./connect-note.mjs').then(m=>(note=m))]);
// 사용자가 바꾼 체크만 담는다(조직 id → 체크 여부). 서버 값과 같아지면 지운다.
const want=new Map();
const api=(path,options={})=>rt.api(path,options);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=sel=>document.querySelector(sel);
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;kptuHoldToast(t)}
// S71-36 PROFILE-설정화면(사용자 11/26 시안 확정 "ㅇㅋ", 안드로이드 설정처럼): 첫 화면은 묶음별 한 줄 메뉴만(이름 + 오른쪽 작은 회색 요약 + ›),
// 줄을 누르면 그 화면(?view=profile&pane=…, 라우터 한 겹), 뒤로가기·‹는 내 프로필로. 줄은 공용 설정 줄 부품(settings-list.mjs)이 그린다.
// 화면 하나에 한 장(data-ps-page)만 보이고, 어떤 장이 보일지는 이 파일의 show() 하나가 정한다(라우터의 sub와 같음).
// 각 장 안은 지금처럼 각 모듈이 그리고 바로 서버에 저장한다(아래 load*). 맨 아래 큰 [저장]은 없다: 이름은 바꾸면 바로 저장,
// 담당조직 현황(S71-35가 조직 관리로 옮기기 전까지 이 화면에 남는 장)만 지금처럼 그 장의 [저장] 한 번.
const PAGES=['name','home','push','backup','drive','mcp','account','status','org','groups'];
const PAGE_TITLE={name:'이름',home:'홈 칸',push:'알림 설정',backup:'내 기록 백업',drive:'구글 드라이브',mcp:'Claude 읽기 연결',account:'계정',status:'사용 현황',groups:'내 묶음'};
// 단어표를 거치는 이름은 그릴 때 읽는다(사람마다 고친 이름).
const titleOf=key=>key==='org'?word('담당조직 현황'):PAGE_TITLE[key];
// 모듈이 알려 주는 첫 화면 요약(오른쪽 회색 글). show=false면 그 줄을 그리지 않는다(드라이브 연결 없음·Claude 연결 행 없음·사용 현황 줄 없음 — 서버 답이 정함).
// known=false: 아직 서버 답을 못 받음(그동안은 주소로 바로 연 그 장을 닫지 않는다).
const summaries={drive:{show:false,text:'',known:false},mcp:{show:false,text:'',known:false},status:{show:false,text:'',known:false}};
let sl=null,page='',entered=false;
const slReady=import('./settings-list.mjs').then(m=>(sl=m));
const pageHtml=key=>`<div class="sl-page ps-page" data-ps-page="${key}" hidden aria-label="${titleOf(key)}"><div class="sl-page-head"><button type="button" class="icon-btn sl-back" data-ps-back aria-label="뒤로">‹</button><h2 class="sl-page-title">${titleOf(key)}</h2></div>${pageBody(key)}</div>`;
const pageBody=key=>key==='org'?word`<div class="ps-panel" id="psWorkplacePanel" aria-label="담당 사업장"><div id="psWorkplaceList"></div></div><div class="ps-actions save-row save-row-sticky"><span id="psState" class="ps-state" role="status" aria-live="polite"></span><button id="psSave" class="primary ps-save" type="button" disabled>저장</button></div>`:PAGE_BODY[key]||'';
const PAGE_BODY={
  name:`<div class="sl-group"><div class="sl-row"><input id="psName" type="text" placeholder="이름" aria-label="이름" autocomplete="off"></div></div><p class="sl-note">닉네임 써도 돼요</p><p class="sl-status" id="psNameState" role="status" aria-live="polite"></p>`,
  home:'<div id="psHomeOffPanel"></div>',
  push:'<div id="psPushPanel"></div>',
  backup:'<div id="psBackupPanel"></div>',
  drive:'<div id="psDriveFoldersPanel"></div>',
  mcp:'<div id="psMcpReadPanel"></div>',
  account:'<div id="psAccountPanel"><div class="ps-account-actions" data-ps-account-rows></div><div data-ps-widget></div><div data-ps-account-delete></div></div>',
  status:'<div class="ps-status" id="psStatusPanel"></div>',
  groups:'<div class="ps-collab" id="psCollabPanel" aria-label="내 묶음"></div>',
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
  const organizationsOn=baseline.size;
  root.innerHTML=sl.groupHtml([nav('name',saved.name)])
    +sl.groupHtml([nav('home',text('home')),nav('push',text('push'))],{title:'앱'})
    +sl.groupHtml([nav('backup',text('backup')),show('drive')&&nav('drive',text('drive')),show('mcp')&&nav('mcp',text('mcp'))],{title:'자료'})
    // S71-35(조직 관리로 옮기기)가 들어오면 이 묶음(담당조직 현황·내 묶음)과 두 장을 지운다.
    +sl.groupHtml([nav('org',word`${organizationsOn}곳`),nav('groups',text('groups'))],{title:word('조직')})
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
function buildWorkplaces(){
  const orgById=new Map(organizations.map(x=>[x.id,x])),ids=new Set();
  assignments.forEach(x=>x.organization_id&&ids.add(x.organization_id));
  profileWorkplaces.filter(x=>x.organization_id).forEach(x=>ids.add(x.organization_id));
  workplaces=[...ids].map(id=>{const org=orgById.get(id),mirror=profileWorkplaces.find(x=>x.organization_id===id);return {organization_id:id,full_name:org?.name||mirror?.full_name||word('이름 없는 조직'),aliases:org?.aliases||mirror?.aliases||[],active:org?.active!==false}});
  legacyWorkplaces=profileWorkplaces.filter(x=>!x.organization_id).sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0));
  baseline=new Set(ids);
  for(const [id,v] of [...want])if(v===baseline.has(id))want.delete(id);
}
const isChecked=id=>want.has(id)?want.get(id):baseline.has(id);
const pendingAdds=()=>[...want].filter(([id,v])=>v&&!baseline.has(id)).map(([id])=>id);
const pendingRemoves=()=>[...want].filter(([id,v])=>!v&&baseline.has(id)).map(([id])=>id);
const nameValue=()=>($('#psName')?.value||'').trim();
const FIELDS=[['#psName','name']];
// 담당 사업장 체크 바뀜 수(그 장의 [저장] 하나가 맡음). 이름은 바꾸면 바로 저장(saveName)이라 여기 세지 않는다.
const changeCount=()=>pendingAdds().length+pendingRemoves().length;
// 목록: 활성 조직 + 이미 담당인 조직(비활성이어도 유지). 묶음 순서·묶음 밖(그 외, 가나다순)은 organization-order.js 그대로.
function listItems(){
  const mine=new Map(workplaces.map(x=>[x.organization_id,{id:x.organization_id,name:x.full_name,active:x.active}]));
  const items=new Map(mine);
  organizations.filter(x=>x.active!==false).forEach(x=>{if(!items.has(x.id))items.set(x.id,{id:x.id,name:x.name,active:true})});
  const order=window.KPTUOrganizationOrder,list=[...items.values()];
  return order?order.sort(order.forPicker(list,[...baseline])):list.sort((a,b)=>String(a.name).localeCompare(String(b.name),'ko'));
}
function orgRow(o){
  const name=o.name||word('이름 없는 조직'),on=isChecked(o.id),off=!on&&baseline.has(o.id);
  return `<div class="ps-org-row${off?' pick-off':''}"><label class="ps-org-pick"><input class="ps-org-box" type="checkbox" data-ps-org-check="${esc(o.id)}"${on?' checked':''}${saving?' disabled':''}><span class="ps-org-name">${esc(name)}${o.active?'':' · 비활성'}</span></label><button class="ps-org-go" type="button" data-ps-workplace-org="${esc(o.id)}" aria-label="${esc(name)} 정보와 현황 열기">›</button></div>`;
}
// 고른 것 = 서버에 담당인 조직(체크를 풀어도 저장 전까지 흐리게 남음) + 이번에 새로 체크한 조직. 나머지는 '그 외' 안, 묶음 순서 그대로.
const inPicked=o=>baseline.has(o.id)||want.get(o.id)===true;
function othersGroups(rest){
  const order=window.KPTUOrganizationOrder;
  if(!order)return [{label:'',items:rest.map(o=>({name:o.name||'',html:orgRow(o)}))}];
  const tail=order.GROUP_NAMES.at(-1);
  return order.groups(rest).map(g=>{const label=order.groupName(g[0]);return {label:label===tail?'':label,items:g.map(o=>({name:o.name||'',html:orgRow(o)}))}});
}
function renderWorkplaces(){
  const box=$('#psWorkplaceList');if(!box||!fold||!note)return;
  const items=listItems(),picked=items.filter(inPicked),rest=items.filter(o=>!inPicked(o));
  const state=freshFold?null:fold.readPickState(box).ws;freshFold=false;
  const legacy=legacyWorkplaces.length?word`<div class="ps-legacy-wrap"><span class="ps-legacy-title">기존 담당사업장 정보</span>${legacyWorkplaces.map(x=>word`<span class="ps-legacy-chip">${esc(x.full_name||word('이름 없는 사업장'))}<small>산하조직 연결 전</small></span>`).join('')}</div>`:'';
  box.innerHTML=items.length?fold.pickFoldHtml({key:'ws',title:word('담당조직 현황'),count:picked.filter(o=>isChecked(o.id)).length,picked:picked.map(orgRow).join(''),others:othersGroups(rest),state,noneText:word('담당 조직 없음'),extra:legacy}):word`<h3>담당조직 현황</h3>${note?note.connectNoteHtml({line:word('조직 관리에서 담당조직을 더하면 여기서 선택할 수 있어요.'),button:word('조직 관리로'),attrs:{'data-goto':'team'},boxAttrs:{'data-ps-org-empty':''}}):''}${legacy}`;
  fold.bindPickFold(box);
  renderStatus();
  renderRoot();
}
function renderStatus(){
  const n=changeCount(),state=$('#psState'),save=$('#psSave'),count=$('#psWorkplaceList [data-pick-count]');
  if(n&&justSaved){justSaved=0;clearTimeout(justSavedTimer)}
  if(state)state.textContent=n?`${n}곳 바뀜, 저장 안 됨`:justSaved?'저장됨':'';
  if(save){save.disabled=saving||!n;save.textContent=saving?'저장 중…':'저장';if(saving)save.setAttribute('aria-busy','true');else save.removeAttribute('aria-busy')}
  if(count)count.textContent=String(listItems().filter(o=>isChecked(o.id)).length);
}
async function load(){
  await foldReady;
  if(!user&&!(await context()))return false;
  const [profile,a,orgs,pw]=await Promise.all([
    api(`/rest/v1/app_profiles?user_id=eq.${user.id}&select=user_id,display_name&limit=1`),
    api(`/rest/v1/app_suborganization_assignees?user_id=eq.${user.id}&select=organization_id,user_id,assigned_by,created_at`),
    api(`/rest/v1/app_suborganizations?workspace_id=eq.${workspaceId}&select=id,name,aliases,active&order=name.asc`),
    api(`/rest/v1/app_profile_workplaces?user_id=eq.${user.id}&select=id,organization_id,full_name,aliases,sort_order,created_at&order=sort_order.asc,created_at.asc`)
  ]);
  assignments=a||[];organizations=orgs||[];profileWorkplaces=pw||[];buildWorkplaces();
  const p=profile?.[0]||{},next={name:p.display_name||user.user_metadata?.display_name||''};
  // 고치던 칸(서버 값과 달라진 칸)은 덮어쓰지 않는다. 고치지 않은 칸만 서버 값으로 맞춘다.
  for(const [id,key] of FIELDS){const el=$(id);if(el&&el.value.trim()===saved[key])el.value=next[key]}
  saved=next;
  renderWorkplaces();
  void loadCollab();
  void loadPush();
  void loadBackup();
  void loadDriveFolders();
  void loadMcpRead();
  void loadHomeOff();
  return true;
}
// S71-34 PROFILE-주간캘린더칸삭제(명진 11/26): '주간 정리 일정 캘린더' 칸은 없앴다. 주간 정리는 모든 캘린더 일정을 읽고, 이미 저장된 값
// (view_prefs.report_calendar)은 서버에 그대로 두어 업무 캘린더로 계속 쓴다(report-calendar.mjs). 화면에서 바꾸는 길은 없다.
// COLLAB-묶인사람끼리공유 1단계: '내 묶음' 장(만들기·초대 링크·같은 이름 요청·멤버·나가기·관리자 넘기기)은 collab-groups.js가 그리고 서버 함수로 바로 저장한다.
// 만들기·들어가기에 쓰는 것은 저장된 이름(saved.name)뿐이다(소속·부서는 만들기 창에서 직접 씀). S71-35가 조직 관리로 옮긴다.
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
const loadCollab=()=>loadPart('groups','#psCollabPanel',host=>import('./collab-groups.js').then(m=>m.mountCollabGroups(host,{rt,toast,profile:()=>({name:saved.name})})));
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
function discardEdits(){want.clear();if($('#psWorkplaceList'))renderWorkplaces()}
async function addOrg(org,currentAssignments,currentWorkplaces){let assignmentCreated=false;const existing=currentWorkplaces.find(x=>x.organization_id===org.id);if(!currentAssignments.some(x=>x.organization_id===org.id)){await api('/rest/v1/app_suborganization_assignees',{method:'POST',body:{organization_id:org.id,user_id:user.id,assigned_by:user.id}});assignmentCreated=true}try{if(existing)await api(`/rest/v1/app_profile_workplaces?id=eq.${encodeURIComponent(existing.id)}`,{method:'PATCH',body:{full_name:org.name,aliases:org.aliases||[],updated_at:new Date().toISOString()}});else{const last=currentWorkplaces.reduce((m,x)=>Math.max(m,Number(x.sort_order)||0),-10);await api('/rest/v1/app_profile_workplaces',{method:'POST',body:{user_id:user.id,organization_id:org.id,full_name:org.name,aliases:org.aliases||[],sort_order:last+10}});currentWorkplaces.push({organization_id:org.id,sort_order:last+10})}if(assignmentCreated)currentAssignments.push({organization_id:org.id,user_id:user.id})}catch(e){if(assignmentCreated)try{await api(`/rest/v1/app_suborganization_assignees?organization_id=eq.${encodeURIComponent(org.id)}&user_id=eq.${user.id}`,{method:'DELETE'})}catch{}throw e}}
async function removeOrg(id,currentAssignments,currentWorkplaces){const backups=currentWorkplaces.filter(x=>x.organization_id===id).map(x=>({id:x.id,user_id:user.id,organization_id:id,full_name:x.full_name,aliases:x.aliases||[],sort_order:x.sort_order||0}));let mirrorDeleted=false;if(backups.length){await api(`/rest/v1/app_profile_workplaces?user_id=eq.${user.id}&organization_id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});mirrorDeleted=true}try{if(currentAssignments.some(x=>x.organization_id===id))await api(`/rest/v1/app_suborganization_assignees?organization_id=eq.${encodeURIComponent(id)}&user_id=eq.${user.id}`,{method:'DELETE'})}catch(e){if(mirrorDeleted&&backups.length)try{await api('/rest/v1/app_profile_workplaces',{method:'POST',body:backups})}catch{}throw e}}
function emitProfileChange(){window.dispatchEvent(new CustomEvent('kptu:profile-updated'));window.__KPTU_RELOAD_TEAM_MEMBERS__?.()}
function emitWorkplaceChange(){window.dispatchEvent(new CustomEvent('kptu:profile-updated'));window.dispatchEvent(new CustomEvent('kptu:suborganization-updated'));window.__KPTU_RELOAD_SUBORGANIZATIONS__?.();window.__KPTU_RELOAD_TEAM_MEMBERS__?.()}
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
// 담당조직 현황 장의 [저장]: 사업장 추가 → 사업장 삭제. 한 단계가 실패하면 거기서 멈추고, 성공한 것은 그대로 두며, 실패한 것부터는 화면에 남겨 다시 저장할 수 있게 한다.
async function save(){
  if(saving||!changeCount())return;
  saving=true;renderWorkplaces();
  const wpTotal=pendingAdds().length+pendingRemoves().length;
  let wpSaved=0,failed=false;
  try{
    const [a,pw]=await Promise.all([api(`/rest/v1/app_suborganization_assignees?user_id=eq.${user.id}&select=organization_id,user_id,assigned_by,created_at`),api(`/rest/v1/app_profile_workplaces?user_id=eq.${user.id}&select=id,organization_id,full_name,aliases,sort_order,created_at&order=sort_order.asc,created_at.asc`)]);
    const currentAssignments=[...(a||[])],currentWorkplaces=[...(pw||[])];
    for(const id of pendingAdds()){const org=organizations.find(x=>x.id===id&&x.active);if(!org)throw new Error('not-addable');await addOrg(org,currentAssignments,currentWorkplaces);wpSaved++}
    for(const id of pendingRemoves()){await removeOrg(id,currentAssignments,currentWorkplaces);wpSaved++}
  }catch{failed=true}
  finally{
    saving=false;
    try{await load()}catch{}
    renderWorkplaces();
    if(wpSaved)emitWorkplaceChange();
  }
  if(!failed){markSaved();return}
  const wpLeft=wpTotal-wpSaved;
  toast(`${wpSaved?word`담당 사업장 ${wpSaved}곳은 저장했고 `:''}${word`담당 사업장 ${wpLeft}곳`}은 저장하지 못했어요. 저장을 다시 눌러 주세요.`,6000);
}
// 저장 성공: 저장 줄에 '저장됨'을 잠깐 보였다가 지운다(알림 띄우기 대신 — 같은 말을 두 곳에 띄우지 않음).
function markSaved(){clearTimeout(justSavedTimer);justSaved=1;renderStatus();justSavedTimer=setTimeout(()=>{justSaved=0;renderStatus()},SAVED_MS)}
function bind(){
  if(bound)return;bound=true;
  const view=$('#profileView');
  $('#psSave')?.addEventListener('click',save);
  view?.addEventListener('click',e=>{
    const open=e.target.closest?.('[data-ps-open]');
    if(open){openPage(open.dataset.psOpen);return}
    if(e.target.closest?.('[data-ps-back]'))leavePage();
  });
  view?.addEventListener('change',e=>{
    if(e.target.matches?.('#psName')){void saveName();return}
    const box=e.target.closest?.('[data-ps-org-check]');if(!box||saving)return;want.set(box.dataset.psOrgCheck,box.checked);const id=box.dataset.psOrgCheck;if(want.get(id)===baseline.has(id))want.delete(id);renderWorkplaces();$(`#psWorkplaceList [data-ps-org-check="${CSS.escape(id)}"]`)?.focus();
  });
  view?.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches?.('#psName')){e.preventDefault();void saveName()}});
  // 묶음 초대 링크(?view=profile&join=…)로 들어오면 '내 묶음' 장을 바로 연다(링크는 collab-groups.js가 읽고 주소에서 지운다).
  const wanted=sub=>new URLSearchParams(location.search).has('join')?'groups':sub||'';
  window.KPTURouter?.on?.('profile',detail=>{freshFold=true;show(wanted(detail?.sub));return load()});
  window.addEventListener('kptu:sub-changed',e=>{if(e.detail?.view!=='profile')return;if(!e.detail.sub)entered=false;show(e.detail.sub||'')});
}
// 담당조직 현황 장에 저장 안 된 체크가 있으면 화면을 떠나기 전에 한 번 묻는다(저장 중에는 떠나지 않음). 떠나기로 하면 고치던 것은 버린다.
window.addEventListener('kptu:before-view-change',e=>{
  if(window.KPTURouter?.current!=='profile'||e.detail?.view==='profile')return;
  if(page==='name')void saveName();
  if(!saving&&!changeCount())return;
  // UI-알림창정리(S61-31): 라우터의 공용 작은 확인창으로 묻는다(e.detail.ask). 저장 중이면 묻지 않고 막는다.
  if(saving){e.preventDefault();return}
  e.detail.ask('저장하지 않은 변경이 있어요. 저장하지 않고 나갈까요?');
});
window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view!=='profile'&&changeCount())discardEdits()});
window.addEventListener('beforeunload',e=>{if($('#profileView')&&!$('#profileView').classList.contains('hidden')&&(saving||nameSaving||changeCount()||(page==='name'&&nameValue()&&nameValue()!==saved.name))){e.preventDefault();e.returnValue=''}});
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
async function boot(){
  installView();await slReady;renderRoot();renderAccountRows();installWidgetLine();installAccountDelete();
  show(window.KPTURouter?.current==='profile'?(new URLSearchParams(location.search).has('join')?'groups':window.KPTURouter.sub||''):'');
  if(!(await context()))return false;
  // 사용 현황은 로그인·작업공간을 안 뒤에 붙인다(그 전 첫 읽기는 운영자 기능을 '없음'으로 잘못 알아 장을 닫을 수 있다).
  installStatus();bind();await load();window.KPTUProfileSettings={reload:load};return true;
}
window.addEventListener('kptu:suborganization-updated',()=>{if(user&&!saving)load().catch(console.error)});
// MULTI ②-3: 묶음·순서가 바뀌면(조직 보고 화면) 담당 사업장 목록을 같은 자료로 다시 그린다(서버 다시 읽기 없음).
window.addEventListener('kptu:report-settings-changed',()=>{if(user&&!saving&&$('#psWorkplaceList'))renderWorkplaces()});
window.addEventListener('kptu:session-changed',async()=>{user=null;workspaceId=null;workplaces=[];legacyWorkplaces=[];organizations=[];assignments=[];profileWorkplaces=[];baseline=new Set();want.clear();justSaved=0;clearTimeout(justSavedTimer);saved={...EMPTY_SAVED};for(const [id] of FIELDS){const el=$(id);if(el)el.value=''}renderRoot();if(await context()){bind();await load()}});
window.__KPTU_PROFILE_SETTINGS_READY__=boot().catch(err=>{console.error('profile settings init',err);return false});
})();
