import {word} from './brand/brand.mjs';
import {UNION_LABEL,REPORT_CALENDAR_TITLE} from './profile-words.mjs';
const kptuHoldToast=(el,opt)=>{el.classList.remove('hidden');import('./small-notice.js').then(m=>m.holdToast(el,opt)).catch(()=>{})}; // UI-작은알림자리: 일반 스크립트라 동적 import(#toast 위쪽·2초·올려 두면 멈춤)
(()=>{
'use strict';
// PROFILE-화면정리(docs/design/profile-screen-tidy.md): 이 모듈이 #profileView의 유일한 renderer다.
// 저장 버튼은 위 줄에 하나(이름·직책 + 담당 사업장 체크 변경). 순서는 프로필 → 사업장 추가 → 사업장 삭제이고, 서버 호출(표·방식)은 그대로다.
// 담당 사업장 목록의 묶음·순서는 organization-order.js(KPTUOrganizationOrder)의 정의를 그대로 쓴다.
// PROFILE-담당사업장접기(2026-10-29 명진 결정): 칸은 '담당조직 현황 n' 한 줄로 접힌 채 시작한다. 펼치면 담당만 체크된 채(체크를 풀면
// 저장 전까지 흐리게 남음), 그 아래 접힌 '그 외 n'(맨 위 찾기 칸, 초성 포함). 모양은 공용 부품 pick-fold.mjs 하나다.
const rt=window.KPTURuntime;
let user=null,workspaceId=null,workplaces=[],legacyWorkplaces=[],organizations=[],assignments=[],profileWorkplaces=[];
// PROFILE-소속칸글로쓰기(명진 확정 11/15 21:45·21:48): 기본 정보 칸 4개 — 노조명·부서명·이름·직책. 모두 글로 직접(목록·자동완성 없음), 가입 때 받지 않고 여기서 채운다.
// 노조명·부서명은 이름·직책과 같은 표(app_profiles.union_name·department_name, 각 60자 한 줄 — DB 검사)·같은 저장 길([저장] → 내 행 PATCH)이다.
const EMPTY_SAVED={name:'',title:'',union:'',dept:''};
let baseline=new Set(),saved={...EMPTY_SAVED},saving=false,bound=false,fold=null,freshFold=true,note=null;
// PROFILE-바뀜것없음글자빼기(명진 확정): 바뀐 게 없으면 상태 글자 없음 + [저장] 흐리게. 고쳤을 때만 'n곳 바뀜, 저장 안 됨'. 저장 직후 잠깐 '저장됨'.
let justSaved=0,justSavedTimer=null;const SAVED_MS=2000;
// S62-16 PROFILE-없음칸제목: 담당조직이 하나도 없을 때도 칸 제목 + 안내 한 줄 → 아래 [조직 보고로](연결 안내 공용 부품 connect-note.mjs).
const foldReady=Promise.all([import('./pick-fold.mjs').then(m=>(fold=m)),import('./connect-note.mjs').then(m=>(note=m))]);
// 사용자가 바꾼 체크만 담는다(조직 id → 체크 여부). 서버 값과 같아지면 지운다.
const want=new Map();
const api=(path,options={})=>rt.api(path,options);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=sel=>document.querySelector(sel);
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;kptuHoldToast(t)}
function installView(){
  if($('#profileView'))return;
  $('#appView')?.insertAdjacentHTML('beforeend',word`<section id="profileView" class="view-panel hidden" aria-label="내 프로필"><div class="ps-profile-grid"><article class="panel ps-panel"><h3>기본 정보</h3><div class="ps-fields"><input id="psUnion" type="text" placeholder="${UNION_LABEL} (예: ${word('○○노동조합 ○○지부','example')})" aria-label="${UNION_LABEL}" autocomplete="off" maxlength="60"><input id="psDept" type="text" placeholder="부서명 (예: ${word('○○사업팀','example')})" aria-label="부서명" autocomplete="off" maxlength="60"><input id="psName" type="text" placeholder="이름" aria-label="이름" autocomplete="off"><input id="psTitle" type="text" placeholder="직책 (예: ${word('국장','example')})" aria-label="직책" autocomplete="off"></div></article><article class="panel ps-panel" id="psWorkplacePanel" aria-label="담당 사업장"><div id="psWorkplaceList"></div></article><article class="panel ps-panel ps-account-panel"><h3>계정</h3><div class="ps-account-actions"><button id="psMySpaceEntry" class="secondary hidden" data-goto="myspace" type="button">내 공간</button></div></article></div><div class="ps-actions save-row save-row-sticky"><span id="psState" class="ps-state" role="status" aria-live="polite"></span><button id="psSave" class="primary ps-save" type="button" disabled>저장</button></div></section>`);
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
const titleValue=()=>($('#psTitle')?.value||'').trim();
// 서버 검사와 같게: 줄바꿈·제어문자는 빈칸으로 바꾸고 앞뒤 공백을 지우고 60자까지.
const lineValue=sel=>($(sel)?.value||'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,60);
const unionValue=()=>lineValue('#psUnion');
const deptValue=()=>lineValue('#psDept');
const FIELDS=[['#psName','name'],['#psTitle','title'],['#psUnion','union'],['#psDept','dept']];
const profileDirty=()=>nameValue()!==saved.name||titleValue()!==saved.title||unionValue()!==saved.union||deptValue()!==saved.dept;
const changeCount=()=>(profileDirty()?1:0)+pendingAdds().length+pendingRemoves().length;
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
}
function renderStatus(){
  const n=changeCount(),state=$('#psState'),save=$('#psSave'),count=$('#psWorkplaceList [data-pick-count]');
  if(n&&justSaved){justSaved=0;clearTimeout(justSavedTimer)}
  if(state)state.textContent=n?`${n}곳 바뀜, 저장 안 됨`:justSaved?'저장됨':'';
  if(save){save.disabled=saving||!n;save.textContent=saving?'저장 중…':'저장';if(saving)save.setAttribute('aria-busy','true');else save.removeAttribute('aria-busy')}
  if(count)count.textContent=String(listItems().filter(o=>isChecked(o.id)).length);
  for(const [id] of FIELDS){const el=$(id);if(el)el.disabled=saving}
}
async function load(){
  await foldReady;
  if(!user&&!(await context()))return false;
  const [profile,a,orgs,pw]=await Promise.all([
    api(`/rest/v1/app_profiles?user_id=eq.${user.id}&select=user_id,display_name,job_title,union_name,department_name&limit=1`),
    api(`/rest/v1/app_suborganization_assignees?user_id=eq.${user.id}&select=organization_id,user_id,assigned_by,created_at`),
    api(`/rest/v1/app_suborganizations?workspace_id=eq.${workspaceId}&select=id,name,aliases,active&order=name.asc`),
    api(`/rest/v1/app_profile_workplaces?user_id=eq.${user.id}&select=id,organization_id,full_name,aliases,sort_order,created_at&order=sort_order.asc,created_at.asc`)
  ]);
  assignments=a||[];organizations=orgs||[];profileWorkplaces=pw||[];buildWorkplaces();
  const p=profile?.[0]||{},next={name:p.display_name||user.user_metadata?.display_name||'',title:p.job_title||'',union:p.union_name||'',dept:p.department_name||''};
  // 고치던 칸(서버 값과 달라진 칸)은 덮어쓰지 않는다. 고치지 않은 칸만 서버 값으로 맞춘다.
  for(const [id,key] of FIELDS){const el=$(id);if(el&&el.value.trim()===saved[key])el.value=next[key]}
  saved=next;
  renderWorkplaces();
  void loadReport();
  void loadCollab();
  void loadPush();
  void loadBackup();
  void loadDriveFolders();
  void loadMcpRead();
  void loadHomeOff();
  return true;
}
// MULTI ②-3(D5) → MULTI-다른담당자맞춤 ②: '주간보고 일정 캘린더' 칸(묶음·제외는 조직 보고 화면으로 옮김)은 따로 바로 저장한다(report-settings.js). 칸 자리는 담당 사업장 칸 바로 뒤, 한 번만 붙인다.
let reportSettings=null;
async function loadReport(){
  try{
    let host=$('#psReportPanel');
    if(!host){const after=$('#psWorkplacePanel');if(!after)return;after.insertAdjacentHTML('afterend',`<article class="panel ps-panel" id="psReportPanel" aria-label="${REPORT_CALENDAR_TITLE}"></article>`);host=$('#psReportPanel')}
    if(!reportSettings||reportSettings.host!==host){const ready=import('./report-settings.js').then(m=>m.mountReportSettings(host,{toast}));reportSettings={host,ready};ready.catch(()=>{if(reportSettings?.ready===ready)reportSettings=null})}
    (await reportSettings.ready).refresh();
  }catch(e){console.error('report settings',e?.name||'Error')}
}
// COLLAB-묶인사람끼리공유 1단계: '내 묶음' 칸(만들기·초대 링크·같은 이름 요청·멤버·나가기·관리자 넘기기)은 collab-groups.js가 그리고 서버 함수로 바로 저장한다.
// 칸 자리는 주간 보고 일정 캘린더 칸 뒤('폰 알림' 칸 앞), 한 번만 붙인다. 만들기·들어가기에 쓰는 이름·노조명·부서명은 저장된 프로필 값(saved)이다.
let collabGroups=null;
async function loadCollab(){
  try{
    let host=$('#psCollabPanel');
    if(!host){const after=$('#psReportPanel')||$('#psWorkplacePanel');if(!after)return;after.insertAdjacentHTML('afterend','<article class="panel ps-panel ps-collab" id="psCollabPanel" aria-label="내 묶음"></article>');host=$('#psCollabPanel')}
    if(!collabGroups||collabGroups.host!==host){const ready=import('./collab-groups.js').then(m=>m.mountCollabGroups(host,{rt,toast,profile:()=>({...saved})}));collabGroups={host,ready};ready.catch(()=>{if(collabGroups?.ready===ready)collabGroups=null})}
    await (await collabGroups.ready).load();
  }catch(e){console.error('collab groups',e?.name||'Error')}
}
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
function discardEdits(){want.clear();for(const [id,key] of FIELDS){const el=$(id);if(el)el.value=saved[key]}if($('#psWorkplaceList'))renderWorkplaces()}
async function addOrg(org,currentAssignments,currentWorkplaces){let assignmentCreated=false;const existing=currentWorkplaces.find(x=>x.organization_id===org.id);if(!currentAssignments.some(x=>x.organization_id===org.id)){await api('/rest/v1/app_suborganization_assignees',{method:'POST',body:{organization_id:org.id,user_id:user.id,assigned_by:user.id}});assignmentCreated=true}try{if(existing)await api(`/rest/v1/app_profile_workplaces?id=eq.${encodeURIComponent(existing.id)}`,{method:'PATCH',body:{full_name:org.name,aliases:org.aliases||[],updated_at:new Date().toISOString()}});else{const last=currentWorkplaces.reduce((m,x)=>Math.max(m,Number(x.sort_order)||0),-10);await api('/rest/v1/app_profile_workplaces',{method:'POST',body:{user_id:user.id,organization_id:org.id,full_name:org.name,aliases:org.aliases||[],sort_order:last+10}});currentWorkplaces.push({organization_id:org.id,sort_order:last+10})}if(assignmentCreated)currentAssignments.push({organization_id:org.id,user_id:user.id})}catch(e){if(assignmentCreated)try{await api(`/rest/v1/app_suborganization_assignees?organization_id=eq.${encodeURIComponent(org.id)}&user_id=eq.${user.id}`,{method:'DELETE'})}catch{}throw e}}
async function removeOrg(id,currentAssignments,currentWorkplaces){const backups=currentWorkplaces.filter(x=>x.organization_id===id).map(x=>({id:x.id,user_id:user.id,organization_id:id,full_name:x.full_name,aliases:x.aliases||[],sort_order:x.sort_order||0}));let mirrorDeleted=false;if(backups.length){await api(`/rest/v1/app_profile_workplaces?user_id=eq.${user.id}&organization_id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});mirrorDeleted=true}try{if(currentAssignments.some(x=>x.organization_id===id))await api(`/rest/v1/app_suborganization_assignees?organization_id=eq.${encodeURIComponent(id)}&user_id=eq.${user.id}`,{method:'DELETE'})}catch(e){if(mirrorDeleted&&backups.length)try{await api('/rest/v1/app_profile_workplaces',{method:'POST',body:backups})}catch{}throw e}}
function emitProfileChange(){window.dispatchEvent(new CustomEvent('kptu:profile-updated'));window.__KPTU_RELOAD_TEAM_MEMBERS__?.()}
function emitWorkplaceChange(){window.dispatchEvent(new CustomEvent('kptu:profile-updated'));window.dispatchEvent(new CustomEvent('kptu:suborganization-updated'));window.__KPTU_RELOAD_SUBORGANIZATIONS__?.();window.__KPTU_RELOAD_TEAM_MEMBERS__?.()}
// 순서: 프로필 → 사업장 추가 → 사업장 삭제. 한 단계가 실패하면 거기서 멈추고, 성공한 것은 그대로 두며, 실패한 것부터는 화면에 남겨 다시 저장할 수 있게 한다.
async function save(){
  if(saving||!changeCount())return;
  if(profileDirty()&&!nameValue()){toast('이름을 입력해 주세요.');$('#psName')?.focus();return}
  saving=true;renderWorkplaces();
  const wpTotal=pendingAdds().length+pendingRemoves().length,wasProfile=profileDirty();
  let profileSaved=false,wpSaved=0,failed=false;
  try{
    if(wasProfile){
      try{await api(`/rest/v1/app_profiles?user_id=eq.${user.id}`,{method:'PATCH',body:{display_name:nameValue(),job_title:titleValue()||null,union_name:unionValue()||null,department_name:deptValue()||null,updated_at:new Date().toISOString()}});profileSaved=true}
      catch{failed=true}
    }
    if(!failed&&wpTotal){
      try{
        const [a,pw]=await Promise.all([api(`/rest/v1/app_suborganization_assignees?user_id=eq.${user.id}&select=organization_id,user_id,assigned_by,created_at`),api(`/rest/v1/app_profile_workplaces?user_id=eq.${user.id}&select=id,organization_id,full_name,aliases,sort_order,created_at&order=sort_order.asc,created_at.asc`)]);
        const currentAssignments=[...(a||[])],currentWorkplaces=[...(pw||[])];
        for(const id of pendingAdds()){const org=organizations.find(x=>x.id===id&&x.active);if(!org)throw new Error('not-addable');await addOrg(org,currentAssignments,currentWorkplaces);wpSaved++}
        for(const id of pendingRemoves()){await removeOrg(id,currentAssignments,currentWorkplaces);wpSaved++}
      }catch{failed=true}
    }
  }finally{
    saving=false;
    if(profileSaved)saved={name:nameValue(),title:titleValue(),union:unionValue(),dept:deptValue()};
    try{await load()}catch{}
    renderWorkplaces();
    if(wpSaved)emitWorkplaceChange();else if(profileSaved)emitProfileChange();
  }
  if(!failed){markSaved();return}
  const okParts=[],badParts=[],wpLeft=wpTotal-wpSaved;
  if(wasProfile)(profileSaved?okParts:badParts).push('프로필');
  if(wpSaved)okParts.push(word`담당 사업장 ${wpSaved}곳`);
  if(wpLeft)badParts.push(word`담당 사업장 ${wpLeft}곳`);
  toast(`${okParts.length?okParts.join('과 ')+'은 저장했고 ':''}${badParts.join('과 ')}은 저장하지 못했어요. 저장을 다시 눌러 주세요.`,6000);
}
// 저장 성공: 저장 줄에 '저장됨'을 잠깐 보였다가 지운다(알림 띄우기 대신 — 같은 말을 두 곳에 띄우지 않음).
function markSaved(){clearTimeout(justSavedTimer);justSaved=1;renderStatus();justSavedTimer=setTimeout(()=>{justSaved=0;renderStatus()},SAVED_MS)}
function bind(){
  if(bound)return;bound=true;
  $('#psSave')?.addEventListener('click',save);
  $('#profileView')?.addEventListener('input',e=>{if(e.target.matches('#psName,#psTitle,#psUnion,#psDept'))renderStatus()});
  $('#profileView')?.addEventListener('change',e=>{const box=e.target.closest?.('[data-ps-org-check]');if(!box||saving)return;want.set(box.dataset.psOrgCheck,box.checked);const id=box.dataset.psOrgCheck;if(want.get(id)===baseline.has(id))want.delete(id);renderWorkplaces();$(`#psWorkplaceList [data-ps-org-check="${CSS.escape(id)}"]`)?.focus()});
  window.KPTURouter?.on?.('profile',()=>{freshFold=true;return load()});
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
async function boot(){installView();installStatus();installWidgetLine();installAccountDelete();syncMySpaceEntry();if(!(await context()))return false;bind();await load();window.KPTUProfileSettings={reload:load};return true}
window.addEventListener('kptu:suborganization-updated',()=>{if(user&&!saving)load().catch(console.error)});
// MULTI ②-3: 묶음·순서가 바뀌면(조직 보고 화면) 담당 사업장 목록을 같은 자료로 다시 그린다(서버 다시 읽기 없음).
window.addEventListener('kptu:report-settings-changed',()=>{if(user&&!saving&&$('#psWorkplaceList'))renderWorkplaces()});
window.addEventListener('kptu:session-changed',async()=>{user=null;workspaceId=null;workplaces=[];legacyWorkplaces=[];organizations=[];assignments=[];profileWorkplaces=[];baseline=new Set();want.clear();justSaved=0;clearTimeout(justSavedTimer);saved={...EMPTY_SAVED};for(const [id] of FIELDS){const el=$(id);if(el)el.value=''}if(await context()){bind();await load()}});
window.__KPTU_PROFILE_SETTINGS_READY__=boot().catch(err=>{console.error('profile settings init',err);return false});
})();
