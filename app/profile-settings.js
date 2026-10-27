(()=>{
'use strict';
// PROFILE-화면정리(docs/design/profile-screen-tidy.md): 이 모듈이 #profileView의 유일한 renderer다.
// 저장 버튼은 위 줄에 하나(이름·직책 + 담당 사업장 체크 변경). 순서는 프로필 → 사업장 추가 → 사업장 삭제이고, 서버 호출(표·방식)은 그대로다.
// 담당 사업장 목록의 묶음·순서는 organization-order.js(KPTUOrganizationOrder)의 정의를 그대로 쓴다.
const rt=window.KPTURuntime;
let user=null,workspaceId=null,workplaces=[],legacyWorkplaces=[],organizations=[],assignments=[],profileWorkplaces=[];
let baseline=new Set(),saved={name:'',title:''},saving=false,bound=false,calRef=null;
// 사용자가 바꾼 체크만 담는다(조직 id → 체크 여부). 서버 값과 같아지면 지운다.
const want=new Map();
const api=(path,options={})=>rt.api(path,options);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=sel=>document.querySelector(sel);
function toast(msg,ms=2200){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.add('hidden'),ms)}
function installView(){
  if($('#profileView'))return;
  $('#appView')?.insertAdjacentHTML('beforeend',`<section id="profileView" class="view-panel hidden"><div class="ps-head"><h2>내 프로필</h2></div><div class="ps-profile-grid"><article class="panel ps-panel"><h3>기본 정보</h3><div class="ps-fields"><input id="psName" type="text" placeholder="이름" aria-label="이름" autocomplete="off"><input id="psTitle" type="text" placeholder="직책 (예: 국장)" aria-label="직책" autocomplete="off"></div></article><article class="panel ps-panel" id="psWorkplacePanel"><div class="ps-panel-head"><h3>담당 사업장</h3><span id="psWorkplaceCount" class="ps-state"></span></div><div id="psWorkplaceList"></div></article><article class="panel ps-panel" id="psCalRefPanel"></article><article class="panel ps-panel ps-account-panel"><h3>계정</h3><div class="ps-account-actions"><button id="psMySpaceEntry" class="secondary hidden" data-goto="myspace" type="button">내 공간</button><button id="psLogout" class="mini ps-danger" type="button">로그아웃</button></div></article></div><div class="ps-actions save-row save-row-sticky"><span id="psState" class="ps-state" role="status" aria-live="polite"></span><button id="psSave" class="primary ps-save" type="button" disabled>저장</button></div></section>`);
}
async function context(){if(!rt?.session||!(await rt.session.ensure()))return false;user=await api('/auth/v1/user');const rows=await api(`/rest/v1/app_workspace_members?user_id=eq.${user.id}&select=workspace_id&limit=1`);workspaceId=rows?.[0]?.workspace_id||null;return !!workspaceId}
function buildWorkplaces(){
  const orgById=new Map(organizations.map(x=>[x.id,x])),ids=new Set();
  assignments.forEach(x=>x.organization_id&&ids.add(x.organization_id));
  profileWorkplaces.filter(x=>x.organization_id).forEach(x=>ids.add(x.organization_id));
  workplaces=[...ids].map(id=>{const org=orgById.get(id),mirror=profileWorkplaces.find(x=>x.organization_id===id);return {organization_id:id,full_name:org?.name||mirror?.full_name||'이름 없는 조직',aliases:org?.aliases||mirror?.aliases||[],active:org?.active!==false}});
  legacyWorkplaces=profileWorkplaces.filter(x=>!x.organization_id).sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0));
  baseline=new Set(ids);
  for(const [id,v] of [...want])if(v===baseline.has(id))want.delete(id);
}
const isChecked=id=>want.has(id)?want.get(id):baseline.has(id);
const pendingAdds=()=>[...want].filter(([id,v])=>v&&!baseline.has(id)).map(([id])=>id);
const pendingRemoves=()=>[...want].filter(([id,v])=>!v&&baseline.has(id)).map(([id])=>id);
const nameValue=()=>($('#psName')?.value||'').trim();
const titleValue=()=>($('#psTitle')?.value||'').trim();
const profileDirty=()=>nameValue()!==saved.name||titleValue()!==saved.title;
const changeCount=()=>(profileDirty()?1:0)+pendingAdds().length+pendingRemoves().length;
// 목록: 활성 조직 + 이미 담당인 조직(비활성이어도 유지). 묶음 순서·묶음 밖(그 외, 가나다순)은 organization-order.js 그대로.
function listItems(){
  const mine=new Map(workplaces.map(x=>[x.organization_id,{id:x.organization_id,name:x.full_name,active:x.active}]));
  const items=new Map(mine);
  organizations.filter(x=>x.active!==false).forEach(x=>{if(!items.has(x.id))items.set(x.id,{id:x.id,name:x.name,active:true})});
  const order=window.KPTUOrganizationOrder,list=[...items.values()];
  return order?order.forPicker(list,[...baseline]):list.sort((a,b)=>String(a.name).localeCompare(String(b.name),'ko'));
}
function orgRow(o){
  const name=o.name||'이름 없는 조직';
  return `<div class="ps-org-row"><label class="ps-org-pick"><input class="ps-org-box" type="checkbox" data-ps-org-check="${esc(o.id)}"${isChecked(o.id)?' checked':''}${saving?' disabled':''}><span class="ps-org-name">${esc(name)}${o.active?'':' · 비활성'}</span></label><button class="ps-org-go" type="button" data-ps-workplace-org="${esc(o.id)}" aria-label="${esc(name)} 정보와 현황 열기">›</button></div>`;
}
function renderWorkplaces(){
  const box=$('#psWorkplaceList');if(!box)return;
  const order=window.KPTUOrganizationOrder,items=listItems();
  let html='';
  if(!items.length)html='<div class="empty compact">담당 사업장으로 고를 수 있는 조직이 없습니다.</div>';
  else if(order){
    const groups=order.groups(items),tail=order.GROUP_NAMES.at(-1),plain=groups.length===1&&order.groupName(groups[0][0])===tail;
    html=groups.map(g=>`<div class="ps-org-group">${plain?'':`<p class="ps-group-name">${esc(order.groupName(g[0]))}</p>`}${g.map(orgRow).join('')}</div>`).join('');
  }else html=`<div class="ps-org-group">${items.map(orgRow).join('')}</div>`;
  const legacy=legacyWorkplaces.length?`<div class="ps-legacy-wrap"><span class="ps-legacy-title">기존 담당사업장 정보</span>${legacyWorkplaces.map(x=>`<span class="ps-legacy-chip">${esc(x.full_name||'이름 없는 사업장')}<small>산하조직 연결 전</small></span>`).join('')}</div>`:'';
  box.innerHTML=`<div class="ps-org-list">${html}</div>${legacy}`;
  renderStatus();
}
function renderStatus(){
  const n=changeCount(),state=$('#psState'),save=$('#psSave'),count=$('#psWorkplaceCount');
  if(state)state.textContent=n?`바뀐 것 ${n}곳`:'바뀐 것 없음';
  if(save){save.disabled=saving||!n;save.textContent=saving?'저장 중…':'저장';if(saving)save.setAttribute('aria-busy','true');else save.removeAttribute('aria-busy')}
  if(count)count.textContent=`${listItems().filter(o=>isChecked(o.id)).length}곳 선택`;
  for(const id of['#psName','#psTitle']){const el=$(id);if(el)el.disabled=saving}
}
async function load(){
  if(!user&&!(await context()))return false;
  const [profile,a,orgs,pw]=await Promise.all([
    api(`/rest/v1/app_profiles?user_id=eq.${user.id}&select=user_id,display_name,job_title&limit=1`),
    api(`/rest/v1/app_suborganization_assignees?user_id=eq.${user.id}&select=organization_id,user_id,assigned_by,created_at`),
    api(`/rest/v1/app_suborganizations?workspace_id=eq.${workspaceId}&select=id,name,aliases,active&order=name.asc`),
    api(`/rest/v1/app_profile_workplaces?user_id=eq.${user.id}&select=id,organization_id,full_name,aliases,sort_order,created_at&order=sort_order.asc,created_at.asc`)
  ]);
  assignments=a||[];organizations=orgs||[];profileWorkplaces=pw||[];buildWorkplaces();
  const p=profile?.[0]||{},next={name:p.display_name||user.user_metadata?.display_name||'',title:p.job_title||''},name=$('#psName'),title=$('#psTitle');
  // 고치던 칸(서버 값과 달라진 칸)은 덮어쓰지 않는다. 고치지 않은 칸만 서버 값으로 맞춘다.
  if(name&&name.value.trim()===saved.name)name.value=next.name;
  if(title&&title.value.trim()===saved.title)title.value=next.title;
  saved=next;
  renderWorkplaces();
  void loadCalRef();
  return true;
}
// 원장 재료 C-4: '참고 일정' 칸은 따로 바로 저장한다(calendar-ref-settings.js). 못 불러와도 프로필 화면은 그대로다.
async function loadCalRef(){
  try{
    const host=$('#psCalRefPanel');if(!host)return;
    if(!calRef||calRef.host!==host){const m=await import('./calendar-ref-settings.js');calRef={host,api:m.mountCalendarRefSettings(host,{rt,userId:()=>user?.id})}}
    await calRef.api.load();
  }catch(e){console.error('calendar ref settings',e?.name||'Error')}
}
function discardEdits(){want.clear();const name=$('#psName'),title=$('#psTitle');if(name)name.value=saved.name;if(title)title.value=saved.title;if($('#psWorkplaceList'))renderWorkplaces()}
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
      try{await api(`/rest/v1/app_profiles?user_id=eq.${user.id}`,{method:'PATCH',body:{display_name:nameValue(),job_title:titleValue()||null,updated_at:new Date().toISOString()}});profileSaved=true}
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
    if(profileSaved)saved={name:nameValue(),title:titleValue()};
    try{await load()}catch{}
    renderWorkplaces();
    if(wpSaved)emitWorkplaceChange();else if(profileSaved)emitProfileChange();
  }
  if(!failed){toast('변경사항을 저장했습니다.');return}
  const okParts=[],badParts=[],wpLeft=wpTotal-wpSaved;
  if(wasProfile)(profileSaved?okParts:badParts).push('프로필');
  if(wpSaved)okParts.push(`담당 사업장 ${wpSaved}곳`);
  if(wpLeft)badParts.push(`담당 사업장 ${wpLeft}곳`);
  toast(`${okParts.length?okParts.join('과 ')+'은 저장했고 ':''}${badParts.join('과 ')}은 저장하지 못했어요. 저장을 다시 눌러 주세요.`,6000);
}
function bind(){
  if(bound)return;bound=true;
  $('#psSave')?.addEventListener('click',save);
  $('#psLogout')?.addEventListener('click',()=>window.KPTUTeamAuth?.logout?.());
  $('#profileView')?.addEventListener('input',e=>{if(e.target.matches('#psName,#psTitle'))renderStatus()});
  $('#profileView')?.addEventListener('change',e=>{const box=e.target.closest?.('[data-ps-org-check]');if(!box||saving)return;want.set(box.dataset.psOrgCheck,box.checked);if(want.get(box.dataset.psOrgCheck)===baseline.has(box.dataset.psOrgCheck))want.delete(box.dataset.psOrgCheck);renderStatus()});
  window.KPTURouter?.on?.('profile',()=>load());
}
// 저장 안 된 변경이 있으면 화면을 떠나기 전에 한 번 묻는다(저장 중에는 떠나지 않음). 떠나기로 하면 고치던 것은 버린다.
window.addEventListener('kptu:before-view-change',e=>{
  if(window.KPTURouter?.current!=='profile'||e.detail?.view==='profile')return;
  if(!saving&&!changeCount())return;
  if(saving||!window.confirm('저장하지 않은 변경이 있어요. 저장하지 않고 나갈까요?'))e.preventDefault();
});
window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view!=='profile'&&changeCount())discardEdits()});
window.addEventListener('beforeunload',e=>{if($('#profileView')&&!$('#profileView').classList.contains('hidden')&&(saving||changeCount())){e.preventDefault();e.returnValue=''}});
function syncMySpaceEntry(allowed=window.__KPTU_MYSPACE_ALLOWED__){$('#psMySpaceEntry')?.classList.toggle('hidden',!allowed)}
window.addEventListener('kptu:myspace-access',event=>syncMySpaceEntry(event.detail?.allowed));
async function boot(){installView();syncMySpaceEntry();if(!(await context()))return false;bind();await load();window.KPTUProfileSettings={reload:load};return true}
window.addEventListener('kptu:suborganization-updated',()=>{if(user&&!saving)load().catch(console.error)});
window.addEventListener('kptu:session-changed',async()=>{user=null;workspaceId=null;workplaces=[];legacyWorkplaces=[];organizations=[];assignments=[];profileWorkplaces=[];baseline=new Set();want.clear();saved={name:'',title:''};const name=$('#psName'),title=$('#psTitle');if(name)name.value='';if(title)title.value='';if(await context()){bind();await load()}});
window.__KPTU_PROFILE_SETTINGS_READY__=boot().catch(err=>{console.error('profile settings init',err);return false});
})();
