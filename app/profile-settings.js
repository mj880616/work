import {word} from './brand/brand.mjs';
const kptuHoldToast=(el,opt)=>{el.classList.remove('hidden');import('./small-notice.js').then(m=>m.holdToast(el,opt)).catch(()=>{})}; // UI-작은알림자리: 일반 스크립트라 동적 import(#toast 위쪽·2초·올려 두면 멈춤)
(()=>{
'use strict';
// PROFILE-화면정리(docs/design/profile-screen-tidy.md): 이 모듈이 #profileView의 유일한 renderer다. 저장 버튼은 위 줄에 하나(이름).
// S71-35 ORG-조직관리로모으기(2026-11-26 사용자 "관련 대상 현황 이것도 걍 없애 / 조직관리에서 추가수정 삭제 보관 가능하게",
// "내 묶음도 여기서 삭제 조직 관리에서 처리 가능하게"): '담당조직 현황' 체크 칸과 '내 묶음' 칸은 내 프로필에서 없앴다(그리기·코드째).
// 담당 추가·보관·삭제 등은 조직 관리 화면(suborganizations.js), 내 묶음은 조직 관리 목록 맨 아래 접힌 '내 묶음'(묶음 칸 모듈은 조직 관리가 부른다).
// 담당 여부 저장(app_suborganization_assignees·app_profile_workplaces)·서버 함수는 그대로다 — 이 화면이 더는 쓰지 않을 뿐, 자료는 지우지 않는다.
const rt=window.KPTURuntime;
let user=null,workspaceId=null;
// S71-34 PROFILE-이름만(명진 11/26 "기본 정보는 이름(닉네임) 말고 나머지는 수집 x 창도 없애"): 기본 정보 칸은 이름(닉네임) 하나다.
// 소속·부서·직책은 화면에서 받지도 읽지도 보내지도 않는다. 이미 저장된 값과 DB 칸(app_profiles.union_name·department_name·job_title)은 지우지 않는다(명진 결정 대기).
const EMPTY_SAVED={name:''};
let saved={...EMPTY_SAVED},saving=false,bound=false;
// PROFILE-바뀜것없음글자빼기(명진 확정): 바뀐 게 없으면 상태 글자 없음 + [저장] 흐리게. 고쳤을 때만 'n곳 바뀜, 저장 안 됨'. 저장 직후 잠깐 '저장됨'.
let justSaved=0,justSavedTimer=null;const SAVED_MS=2000;
const api=(path,options={})=>rt.api(path,options);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=sel=>document.querySelector(sel);
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;kptuHoldToast(t)}
function installView(){
  if($('#profileView'))return;
  $('#appView')?.insertAdjacentHTML('beforeend',word`<section id="profileView" class="view-panel hidden" aria-label="내 프로필"><div class="ps-profile-grid"><article class="panel ps-panel"><h3>기본 정보</h3><div class="ps-fields"><input id="psName" type="text" placeholder="이름 (닉네임 써도 돼요)" aria-label="이름" autocomplete="off"></div></article><article class="panel ps-panel ps-account-panel"><h3>계정</h3><div class="ps-account-actions"><button id="psMySpaceEntry" class="secondary hidden" data-goto="myspace" type="button">내 공간</button></div></article></div><div class="ps-actions save-row save-row-sticky"><span id="psState" class="ps-state" role="status" aria-live="polite"></span><button id="psSave" class="primary ps-save" type="button" disabled>저장</button></div></section>`);
}
async function context(){if(!rt?.session||!(await rt.session.ensure()))return false;user=await api('/auth/v1/user');const rows=await api(`/rest/v1/app_workspace_members?user_id=eq.${user.id}&select=workspace_id&limit=1`);workspaceId=rows?.[0]?.workspace_id||null;return !!workspaceId}
const nameValue=()=>($('#psName')?.value||'').trim();
const FIELDS=[['#psName','name']];
const profileDirty=()=>nameValue()!==saved.name;
const changeCount=()=>profileDirty()?1:0;
function renderStatus(){
  const n=changeCount(),state=$('#psState'),save=$('#psSave');
  if(n&&justSaved){justSaved=0;clearTimeout(justSavedTimer)}
  if(state)state.textContent=n?'바뀜, 저장 안 됨':justSaved?'저장됨':'';
  if(save){save.disabled=saving||!n;save.textContent=saving?'저장 중…':'저장';if(saving)save.setAttribute('aria-busy','true');else save.removeAttribute('aria-busy')}
  for(const [id] of FIELDS){const el=$(id);if(el)el.disabled=saving}
}
async function load(){
  if(!user&&!(await context()))return false;
  const profile=await api(`/rest/v1/app_profiles?user_id=eq.${user.id}&select=user_id,display_name&limit=1`);
  const p=profile?.[0]||{},next={name:p.display_name||user.user_metadata?.display_name||''};
  // 고치던 칸(서버 값과 달라진 칸)은 덮어쓰지 않는다. 고치지 않은 칸만 서버 값으로 맞춘다.
  for(const [id,key] of FIELDS){const el=$(id);if(el&&el.value.trim()===saved[key])el.value=next[key]}
  saved=next;
  renderStatus();
  void loadPush();
  void loadBackup();
  void loadDriveFolders();
  void loadMcpRead();
  void loadHomeOff();
  return true;
}
// S71-34 PROFILE-주간캘린더칸삭제(명진 11/26): '주간 정리 일정 캘린더' 칸은 없앴다. 주간 정리는 모든 캘린더 일정을 읽고, 이미 저장된 값
// (view_prefs.report_calendar)은 서버에 그대로 두어 업무 캘린더로 계속 쓴다(report-calendar.mjs). 화면에서 바꾸는 길은 없다.
// APP-폰알림 N4: '폰 알림' 칸(종류별 켜고 끄기·조용한 시간·시험 알림·등록된 폰)은 따로 바로 저장한다(phone-push-settings.js). 칸 자리는 '계정' 칸 앞, 한 번만 붙인다.
let pushSettings=null;
// PRIVACY-백업안내(S66-01): '내 기록 백업' 칸(record-backup.js가 그린다). 자리는 '폰 알림' 칸 다음('계정' 칸 앞), 한 번만 붙인다.
let backupPanel=null;
async function loadBackup(){
  try{
    let host=$('#psBackupPanel');
    if(!host){const before=$('#profileView .ps-account-panel');if(!before)return;before.insertAdjacentHTML('beforebegin','<article class="panel ps-panel" id="psBackupPanel" aria-label="내 기록 백업"></article>');host=$('#psBackupPanel')}
    if(!backupPanel||backupPanel.host!==host){const ready=import('./record-backup.js').then(m=>m.mountRecordBackup(host,{rt}));backupPanel={host,ready};ready.catch(()=>{if(backupPanel?.ready===ready)backupPanel=null})}
    await (await backupPanel.ready).load();
  }catch(e){console.error('record backup',e?.name||'Error')}
}
// S69-41: '구글 드라이브' 칸(drive-folders-panel.js가 그린다) — 앱이 쓰는 드라이브 폴더 한 줄 + [열기 ↗](S70-29: [한곳으로 모으기]는 지움 — 서버가 저절로).
// 자리는 '내 기록 백업' 칸 바로 다음, 한 번만 붙인다. 드라이브 연결이 없거나 읽기가 실패하면 칸이 감춰진다.
let driveFoldersPanel=null;
async function loadDriveFolders(){
  try{
    let host=$('#psDriveFoldersPanel');
    if(!host){const after=$('#psBackupPanel');const before=$('#profileView .ps-account-panel');if(!after&&!before)return;(after||before).insertAdjacentHTML(after?'afterend':'beforebegin','<article class="panel ps-panel ps-drive-folders" id="psDriveFoldersPanel" aria-label="구글 드라이브" hidden></article>');host=$('#psDriveFoldersPanel')}
    if(!driveFoldersPanel||driveFoldersPanel.host!==host){const ready=import('./drive-folders-panel.js').then(m=>m.mountDriveFolders(host,{rt}));driveFoldersPanel={host,ready};ready.catch(()=>{if(driveFoldersPanel?.ready===ready)driveFoldersPanel=null})}
    await (await driveFoldersPanel.ready).load();
  }catch(e){console.error('drive folders',e?.name||'Error')}
}
// MCP-Claude읽기 M-5: 'Claude 읽기 연결' 칸(mcp-read-settings.js가 그린다). 설정 행이 있는 작업공간에서만 보인다(행은 SQL로만, 설계 7.6). 자리는 '내 기록 백업' 칸 다음('계정' 칸 앞), 한 번만 붙인다.
let mcpReadPanel=null;
async function loadMcpRead(){
  try{
    let host=$('#psMcpReadPanel');
    if(!host){const before=$('#profileView .ps-account-panel');if(!before)return;before.insertAdjacentHTML('beforebegin','<article class="panel ps-panel" id="psMcpReadPanel" aria-label="Claude 읽기 연결" hidden></article>');host=$('#psMcpReadPanel')}
    if(!mcpReadPanel||mcpReadPanel.host!==host){const ready=import('./mcp-read-settings.js').then(m=>m.mountMcpReadSettings(host,{rt}));mcpReadPanel={host,ready};ready.catch(()=>{if(mcpReadPanel?.ready===ready)mcpReadPanel=null})}
    await (await mcpReadPanel.ready).load();
  }catch(e){console.error('mcp read settings',e?.name||'Error')}
}
// S67-52 HOME-칸끄기: '홈 칸'(끈 홈 칸 다시 켜기 — home-off.js가 그리고 서버 화면 기억 view_prefs.home_off에 바로 저장). 자리는 '폰 알림' 칸 앞('계정' 칸 앞), 한 번만 붙인다.
let homeOffPanel=null;
async function loadHomeOff(){
  try{
    let host=$('#psHomeOffPanel');
    if(!host){const before=$('#psPushPanel')||$('#profileView .ps-account-panel');if(!before)return;before.insertAdjacentHTML('beforebegin','<article class="panel ps-panel" id="psHomeOffPanel" aria-label="홈 칸"></article>');host=$('#psHomeOffPanel')}
    if(!homeOffPanel||homeOffPanel.host!==host){const ready=import('./home-off.js').then(m=>m.mountHomeOffSettings(host));homeOffPanel={host,ready};ready.catch(()=>{if(homeOffPanel?.ready===ready)homeOffPanel=null})}
    (await homeOffPanel.ready).load();
  }catch(e){console.error('home off settings',e?.name||'Error')}
}
async function loadPush(){
  try{
    let host=$('#psPushPanel');
    if(!host){const before=$('#profileView .ps-account-panel');if(!before)return;before.insertAdjacentHTML('beforebegin','<article class="panel ps-panel" id="psPushPanel" aria-label="폰 알림"></article>');host=$('#psPushPanel')}
    if(!pushSettings||pushSettings.host!==host){const ready=import('./phone-push-settings.js').then(m=>m.mountPhonePushSettings(host,{rt}));pushSettings={host,ready};ready.catch(()=>{if(pushSettings?.ready===ready)pushSettings=null})}
    await (await pushSettings.ready).load();
  }catch(e){console.error('phone push settings',e?.name||'Error')}
}
function discardEdits(){for(const [id,key] of FIELDS){const el=$(id);if(el)el.value=saved[key]}renderStatus()}
function emitProfileChange(){window.dispatchEvent(new CustomEvent('kptu:profile-updated'));window.__KPTU_RELOAD_TEAM_MEMBERS__?.()}
// 저장이 실패하면 입력을 남겨 다시 저장할 수 있게 한다.
async function save(){
  if(saving||!changeCount())return;
  if(!nameValue()){toast('이름을 입력해 주세요.');$('#psName')?.focus();return}
  saving=true;renderStatus();
  let ok=false;
  try{await api(`/rest/v1/app_profiles?user_id=eq.${user.id}`,{method:'PATCH',body:{display_name:nameValue(),updated_at:new Date().toISOString()}});ok=true}
  catch{ok=false}
  finally{
    saving=false;
    if(ok)saved={name:nameValue()};
    try{await load()}catch{}
    renderStatus();
    if(ok)emitProfileChange();
  }
  if(ok){markSaved();return}
  toast('프로필은 저장하지 못했어요. 저장을 다시 눌러 주세요.',6000);
}
// 저장 성공: 저장 줄에 '저장됨'을 잠깐 보였다가 지운다(알림 띄우기 대신 — 같은 말을 두 곳에 띄우지 않음).
function markSaved(){clearTimeout(justSavedTimer);justSaved=1;renderStatus();justSavedTimer=setTimeout(()=>{justSaved=0;renderStatus()},SAVED_MS)}
function bind(){
  if(bound)return;bound=true;
  $('#psSave')?.addEventListener('click',save);
  $('#profileView')?.addEventListener('input',e=>{if(e.target.matches('#psName'))renderStatus()});
  window.KPTURouter?.on?.('profile',()=>load());
}
// 저장 안 된 변경이 있으면 화면을 떠나기 전에 한 번 묻는다(저장 중에는 떠나지 않음). 떠나기로 하면 고치던 것은 버린다.
window.addEventListener('kptu:before-view-change',e=>{
  if(window.KPTURouter?.current!=='profile'||e.detail?.view==='profile')return;
  if(!saving&&!changeCount())return;
  // UI-알림창정리(S61-31): 라우터의 공용 작은 확인창으로 묻는다(e.detail.ask). 저장 중이면 묻지 않고 막는다.
  if(saving){e.preventDefault();return}
  e.detail.ask('저장하지 않은 변경이 있어요. 저장하지 않고 나갈까요?');
});
window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view!=='profile'&&changeCount())discardEdits()});
window.addEventListener('beforeunload',e=>{if($('#profileView')&&!$('#profileView').classList.contains('hidden')&&(saving||changeCount())){e.preventDefault();e.returnValue=''}});
function syncMySpaceEntry(allowed=window.__KPTU_MYSPACE_ALLOWED__){$('#psMySpaceEntry')?.classList.toggle('hidden',!allowed)}
window.addEventListener('kptu:myspace-access',event=>syncMySpaceEntry(event.detail?.allowed));
// UI-업데이트기록입구: 업데이트 기록은 계정 메뉴 [업데이트 기록] 화면(release-notes-ui.js) 한 곳이다. 내 프로필에는 두지 않는다.
// APP-폰앱새로 ③: 폰 앱에서만 '계정' 칸에 [위젯 로그아웃] 작은 줄(phone-widget-line.js). 웹 브라우저에서는 아무것도 붙지 않는다.
function installWidgetLine(){if(!/KPTUAndroid/i.test(navigator.userAgent||''))return;import('./phone-widget-line.js').then(m=>m.mountWidgetLine($('#profileView .ps-account-actions'))).catch(()=>{})}
// HOME-업무일지홈: 옛 홈에만 있던 마지막 수집 시각·AI 사용량(+ 글자 읽기 끝남 줄)은 '사용 현황' 칸(profile-status.js, MULTI-다른담당자맞춤 ⑥).
let statusMount=null;
function installStatus(){const grid=$('#profileView .ps-profile-grid');if(!grid)return;if(!$('#psStatusPanel'))grid.insertAdjacentHTML('beforeend','<article class="panel ps-panel ps-status" id="psStatusPanel" aria-label="사용 현황" hidden></article>');import('./profile-status.js').then(m=>{statusMount=statusMount||m.mountProfileStatus($('#psStatusPanel'))}).catch(()=>{})}
window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view==='profile')statusMount?.refresh()});
// S69 STORE-계정삭제: '계정' 칸 끝에 [계정 삭제](account-delete.js가 버튼·확인 창의 주인). 폰 앱·웹 모두.
function installAccountDelete(){import('./account-delete.js').then(m=>m.mountAccountDelete($('#profileView .ps-account-actions'))).catch(()=>{})}
// S71-35: 옛 초대 링크(?view=profile&join=…)는 '내 묶음'이 옮겨 간 조직 관리로 넘긴다(주소의 join은 그대로 — 조직 관리의 내 묶음 칸이 읽자마자 지운다).
function forwardInvite(){try{if(new URL(location.href).searchParams.has('join')&&window.KPTURouter?.current==='profile')window.KPTURouter.go('team',{replaceUrl:true})}catch{}}
async function boot(){installView();installStatus();installWidgetLine();installAccountDelete();syncMySpaceEntry();forwardInvite();window.KPTURouter?.on?.('profile',forwardInvite);if(!(await context()))return false;bind();await load();window.KPTUProfileSettings={reload:load};return true}
window.addEventListener('kptu:session-changed',async()=>{user=null;workspaceId=null;justSaved=0;clearTimeout(justSavedTimer);saved={...EMPTY_SAVED};for(const [id] of FIELDS){const el=$(id);if(el)el.value=''}if(await context()){bind();await load()}});
window.__KPTU_PROFILE_SETTINGS_READY__=boot().catch(err=>{console.error('profile settings init',err);return false});
})();
