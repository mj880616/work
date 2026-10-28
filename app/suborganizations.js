const kptuHoldToast=(el,opt)=>{el.classList.remove('hidden');import('./small-notice.js').then(m=>m.holdToast(el,opt)).catch(()=>{})}; // UI-작은알림자리: 일반 스크립트라 동적 import(#toast 위쪽·2초·올려 두면 멈춤)
(()=>{
'use strict';
const notify=(text,opt)=>import('./small-notice.js').then(m=>m.notify(text,opt)).catch(()=>{}); // UI-알림창정리: 일반 스크립트라 공용 작은 알림을 동적 import로

const rt=window.KPTURuntime;
let summaryRun=0,summaryFlight=null,summaryDirty=false;
let soUser=null,soWorkspace=null,soRole=null,soMembers=[],soProfiles=[],soOrganizations=[],soAssignments=[],soEditing=null,soBound=false;
const api=(path,options={})=>rt.api(path,options);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nameOf=id=>soProfiles.find(x=>x.user_id===id)?.display_name||id?.slice(0,8)||'팀원';
const norm=v=>String(v??'').trim().toLocaleLowerCase('ko-KR');
const isAdmin=()=>['owner','admin'].includes(soRole);
const canEdit=o=>isAdmin()||o?.created_by===soUser?.id;
function toast(msg){const t=document.querySelector('#toast');if(!t)return;t.textContent=msg;kptuHoldToast(t)}
function setStatus(el,msg,type=''){if(!el)return;el.textContent=msg||'';el.className='status'+(type?' '+type:'');if(type==='error'){el.setAttribute('role','alert');el.removeAttribute('aria-live')}else{el.setAttribute('role','status');el.setAttribute('aria-live','polite')}}
function setBusy(btn,busy){if(!btn)return;btn.disabled=!!busy;if(busy)btn.setAttribute('aria-busy','true');else btn.removeAttribute('aria-busy')}
async function context(){if(!rt?.session||!(await rt.session.ensure()))return false;const shared=rt.context?.read?.()||window.__KPTU_BOOT_CONTEXT__;if(shared?.user?.id&&shared?.workspace?.id){soUser=shared.user;soWorkspace=shared.workspace.id;soRole=shared.membership?.role||null}else{soUser=await api('/auth/v1/user');const ms=await api(`/rest/v1/app_workspace_members?user_id=eq.${soUser.id}&select=workspace_id,role&limit=1`);if(!ms?.length)return false;soWorkspace=ms[0].workspace_id;soRole=ms[0].role}soMembers=[];soProfiles=await api('/rest/v1/app_profiles?select=user_id,display_name');return true}
async function ensureMembers(){if(soMembers.length)return soMembers;soMembers=await api(`/rest/v1/app_workspace_members?workspace_id=eq.${soWorkspace}&select=user_id,role`);return soMembers}
function assignedIds(id){return soAssignments.filter(x=>x.organization_id===id).map(x=>x.user_id)}
function actualNames(o){return assignedIds(o.id).map(nameOf).filter(Boolean)}
function effectiveNames(o){const actual=actualNames(o);return actual.length?actual:(o.default_assignee_name?[String(o.default_assignee_name).trim()].filter(Boolean):[])}
function myOrganizations(){const myName=soUser?.id?nameOf(soUser.id):'';return soOrganizations.filter(o=>{const ids=assignedIds(o.id);if(ids.includes(soUser?.id))return true;return !ids.length&&!!myName&&norm(o.default_assignee_name)===norm(myName)})}
function assigneeMarkup(o){const actual=actualNames(o);if(actual.length)return actual.map(n=>`<span class="so-chip">${esc(n)}</span>`).join('');if(o.default_assignee_name)return `<span class="so-chip">${esc(o.default_assignee_name)}</span><span class="so-planned-note">계정 연결 전</span>`;return '<span class="updated">담당자 미지정</span>'}
// ORG-쟁의단계 다듬기 ③(2026-10-24 11:08): 화면 전체 ⋯(담당조직 메뉴)는 첫 묶음 머리줄이 아니라 화면 제목 '담당조직' 줄 오른쪽에 둔다(바구니 머리줄과 같은 방식:
// 폰은 위 머리줄 "담당조직" 오른쪽으로 올라가고, 761px~는 본문 제목 줄 오른쪽). 묶음이 바뀌어도 자리가 그대로다.
function installTeamHead(team){if(document.querySelector('#soTeamHead'))return;team.insertAdjacentHTML('afterbegin','<div id="soTeamHead" class="so-team-tools so-team-head"><h2 class="so-team-title">담당조직</h2><button id="soTeamMore" class="icon-btn so-team-more" type="button" data-ctx="off" aria-haspopup="true" aria-expanded="false" aria-label="담당조직 메뉴">⋯</button></div>')}
function installTeam(){const team=document.querySelector('#teamView');if(!team)return false;installTeamHead(team);let section=document.querySelector('#soTeamSection');if(!section){section=document.createElement('section');section.id='soTeamSection';section.className='so-team-section';section.innerHTML='<div id="soOrganizationList" class="so-list"></div>';team.appendChild(section)}if(!document.querySelector('#wdDetailPane'))section.insertAdjacentHTML('beforeend','<aside id="wdDetailPane" class="so-pane" aria-label="담당조직 상세"><p class="so-pane-empty">왼쪽에서 조직을 고르면 여기에 보입니다.</p></aside>');return true}
// ORG-PC좌우: on a PC the organization shown on the right (workplace-detail.js, kptu:workplace-selection) is marked in the list.
let soSelected=null;
function paintSelection(){document.querySelectorAll('#soOrganizationList [data-so-org]').forEach(row=>{const on=!!soSelected&&row.dataset.soOrg===soSelected;row.classList.toggle('is-selected',on);if(on)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current')})}
function installModals(){if(document.querySelector('#soEditModal'))return;document.body.insertAdjacentHTML('beforeend',`<div id="soEditModal" class="modal hidden" data-enter-save role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="soEditHeading"><div class="modal-card small-card"><div class="modal-head"><div><h2 id="soEditHeading">담당조직 추가</h2></div><button class="icon-btn" data-so-close="soEditModal" type="button" aria-label="닫기">×</button></div><label>조직명<input id="soEditName" type="text" maxlength="120"></label><label>다른 이름(보고서 표기 등) <span class="optional">쉼표로 구분</span><input id="soEditAliases" type="text" placeholder="예: 철도, 철도노조"></label><label>조직유형 <span class="optional">선택</span><input id="sofEditType" type="text" maxlength="80" list="sofTypeSuggestions" placeholder="예: 철도·도시철도"><datalist id="sofTypeSuggestions"><option value="중앙공공기관"><option value="지방공기업·출연기관"><option value="철도·도시철도"><option value="자회사·용역"><option value="기타"></datalist></label><label>설명 <span class="optional">선택</span><textarea id="soEditDescription" rows="3"></textarea></label><div class="modal-action-footer"><div id="soEditStatus" class="status"></div><button id="soSaveOrg" data-enter-save-submit class="primary wide" type="button">저장</button></div></div></div><div id="soAssignModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="soAssignHeading"><div class="modal-card small-card"><div class="modal-head"><div><h2 id="soAssignHeading">담당자 지정</h2></div><button class="icon-btn" data-so-close="soAssignModal" type="button" aria-label="닫기">×</button></div><p class="muted">관리자가 이 조직의 담당자를 지정합니다. 여러 명 지정할 수 있습니다.</p><div id="soAssignMembers" class="so-admin-members"></div><div class="modal-action-footer"><div id="soAssignStatus" class="status"></div><button id="soSaveAssignees" class="primary wide" type="button">담당자 저장</button></div></div></div>`)}
// TASK-조직순서 / D-4c: one surface box per shared organization group.
// UI-디자인기준 3/3: the list heading is the group name with "N곳" on the right.
const ordered=(list,item,headings=false)=>window.KPTUOrganizationOrder.groups(list).map(g=>`<div class="so-org-group">${headings?`<div class="so-group-card"><div class="so-group-heading"><span>${esc(window.KPTUOrganizationOrder.groupName(g[0]))}</span><span class="so-group-count">${g.length}곳</span></div>`:''}${g.map(item).join('')}${headings?'</div>':''}</div>`).join('');
function renderTeam(){const box=document.querySelector('#soOrganizationList');if(!box)return;const mine=myOrganizations();box.innerHTML=(mine.length?ordered(mine,o=>`<article class="so-card kptu-list-row" data-so-org="${esc(o.id)}" data-ps-workplace-org="${esc(o.id)}" role="button" tabindex="0" aria-label="${esc(o.name)} 상세 열기"><div class="so-card-main kptu-list-row-main"><span class="so-dot" data-so-dot="${esc(o.id)}" aria-hidden="true"></span><h4 class="kptu-list-name">${esc(o.name)}</h4><span class="so-chevron kptu-list-chevron" aria-hidden="true">›</span></div></article>`,true):'<div class="empty compact">등록된 담당조직이 없습니다.</div>')+'<button type="button" class="so-reference-entry" data-goto="reference">참고 묶음 <span aria-hidden="true">›</span></button>';paintSelection();paintStageTags();window.dispatchEvent(new CustomEvent('kptu:suborganizations-rendered',{detail:{count:mine.length}}))}
// ORG-쟁의단계: 목록 줄 꼬리표(투쟁 중 + 이번 주 끝남만)와 ⋯ 메뉴 [쟁의 단계 관리]. 판정은 org-dispute-stage-model.mjs 한 곳, 읽기·쓰기는 org-dispute-stage.js.
let stageMod=null,stageMenu=null;
async function stageModules(){if(!stageMod){const [data,model,ui]=await Promise.all([import('./org-dispute-stage.js'),import('./org-dispute-stage-model.mjs'),import('./org-dispute-stage-ui.js')]);stageMod={...data,...model,...ui}}return stageMod}
function paintStageTags(){
 document.querySelectorAll('#soOrganizationList .so-stage-tag').forEach(el=>el.remove());document.querySelectorAll('#soOrganizationList .has-stage').forEach(el=>el.classList.remove('has-stage'));
 const state=stageMod?.peekDisputeState();if(!state||state.status!=='ready')return;
 const today=kstDay(Date.now());
 document.querySelectorAll('#soOrganizationList [data-so-org]').forEach(row=>{const tag=stageMod.listTag(stageMod.stageOfOrg(row.dataset.soOrg,state.histories,state.stages),today),main=row.querySelector('.kptu-list-row-main');if(!tag||!main)return;
  const span=document.createElement('span');span.className='so-stage-tag'+(tag.kind==='ended'?' is-end':'');span.dataset.soStage=tag.kind;span.textContent=tag.text;main.querySelector('.kptu-list-chevron')?.before(span);main.classList.add('has-stage')});
}
async function refreshStages(){if(!soWorkspace)return;try{await stageModules();await stageMod.loadDisputeState({rt,workspaceId:soWorkspace});paintStageTags()}catch(err){console.error('dispute stages',err)}}
async function installStageMenu(trigger){
 await stageModules();const {createAnchoredMenu}=await import('./anchored-menu.js');
 if(!stageMenu)stageMenu=createAnchoredMenu({id:'soTeamMenu',className:'basket-link-menu so-team-menu',label:'담당조직 메뉴',historyKey:'kptuSoTeamMenu',key:()=>'team',render:()=>'<button type="button" data-so-stage-manage>쟁의 단계 관리</button>',
  onAction:(button,active)=>{stageMod.openStageManager({workspaceId:soWorkspace,rt,trigger:active.trigger,orgNames:()=>new Map(soOrganizations.map(o=>[o.id,o.name]))})}});
 stageMenu.open(trigger);
}
// Names render before optional metadata: one batched read of the latest record dates, never one request per organization.
function summaryCurrent(run,user,workspace){const c=rt.context?.read?.();return run===summaryRun&&soUser?.id===user&&soWorkspace===workspace&&(!rt.context?.read||(c?.user?.id===user&&c?.workspace?.id===workspace))&&(!window.KPTURouter||window.KPTURouter.current==='team')}
// UI-디자인기준 3/3: one line per organization (2026-10-16 user decision: no second line, no task count). The dot left of the name
// shows how long ago the last record was (KST days): within 7 days green, 8~20 days orange, 21 days or more (or no record) red.
// Painted only after the read. The same words go into the row's accessible name, so the color is not the only signal.
const kstDay=ms=>new Date(ms+9*3600000).toISOString().slice(0,10);
function recency(at){if(!at)return {level:'stale',text:'기록 없음'};const days=Math.max(0,Math.round((Date.parse(kstDay(Date.now()))-Date.parse(kstDay(Date.parse(at))))/86400000));return {level:days<=7?'fresh':days<=20?'warn':'stale',text:days?`${days}일 전 기록`:'오늘 기록',days}}
function paintRecency(latest){
 document.querySelectorAll('[data-so-dot]').forEach(dot=>{const id=dot.dataset.soDot,at=latest.get(id),r=recency(at),row=dot.closest('.so-card'),name=row?.querySelector('.kptu-list-name')?.textContent||'';
  dot.dataset.soRecency=r.level;if(at)dot.dataset.soAt=at;else delete dot.dataset.soAt;row?.setAttribute('aria-label',`${name}, ${r.text}, 상세 열기`)});
}
function clearRecency(){document.querySelectorAll('[data-so-dot]').forEach(dot=>{delete dot.dataset.soRecency;delete dot.dataset.soAt;const row=dot.closest('.so-card'),name=row?.querySelector('.kptu-list-name')?.textContent||'';row?.setAttribute('aria-label',`${name} 상세 열기`)})}
function loadSummaries(){
 if(window.KPTURouter&&window.KPTURouter.current!=='team')return Promise.resolve();
 if(summaryFlight){summaryDirty=true;return summaryFlight;}
 const tracked=readSummaries().finally(()=>{
  if(summaryFlight!==tracked)return;
  summaryFlight=null;
  if(summaryDirty){summaryDirty=false;return loadSummaries();}
 });
 summaryFlight=tracked;return tracked;
}
async function readSummaries(){
 if(window.KPTURouter&&window.KPTURouter.current!=='team')return;
 const run=++summaryRun,user=soUser?.id,workspace=soWorkspace,ids=myOrganizations().map(o=>o.id);if(!ids.length)return;
 const current=()=>summaryCurrent(run,user,workspace);
 const updateRead=async()=>{
  // Reuse the owner/workspace-checked confirmed note reader. Both sources
  // must succeed before publishing a latest date; neither write time is used.
  const {readLinkRecords}=await import('./basket-link-records.js');
  const latest=new Map();
  const newer=row=>{const at=Date.parse(row.occurred_at);if(ids.includes(row.organization_id)&&Number.isFinite(at)&&(!latest.has(row.organization_id)||at>Date.parse(latest.get(row.organization_id))))latest.set(row.organization_id,row.occurred_at);};
  const legacy=async()=>{
   for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100),found=new Set(),pageSize=500;
    for(let offset=0;current();offset+=pageSize){
     const rows=await api(`/rest/v1/app_suborganization_updates?organization_id=in.(${batch.map(encodeURIComponent).join(',')})&select=organization_id,occurred_at&order=occurred_at.desc,id.asc&limit=${pageSize}&offset=${offset}`);
     if(!Array.isArray(rows))throw Error('최근 기록을 확인하지 못했어요.');
     for(const row of rows)if(batch.includes(row.organization_id)&&Number.isFinite(Date.parse(row.occurred_at))){newer(row);found.add(row.organization_id);}
     if(rows.length<pageSize||found.size===batch.length)break;
    }
   }
  };
  const [,basket]=await Promise.all([legacy(),readLinkRecords({kind:'organization',targetIds:ids,dateOnly:true},rt)]);
  basket.forEach(newer);
  if(!current())return;
  paintRecency(latest);
 };
 await updateRead().catch(()=>{});
}
function checks(prefix,selected=[],source=soOrganizations){const set=new Set(selected),list=window.KPTUOrganizationOrder.forPicker(source,selected);return list.length?`<div class="so-org-checks">${ordered(list,o=>{const names=effectiveNames(o),planned=!actualNames(o).length&&!!o.default_assignee_name;return `<label class="so-org-check"><input type="checkbox" data-${prefix}-org="${esc(o.id)}" ${set.has(o.id)?'checked':''}><span>${esc(o.name)}${names.length?`<small> · 담당 ${esc(names.join(', '))}${planned?' (계정 연결 전)':''}</small>`:''}</span></label>`})}</div>`:'<div class="updated">표시할 담당조직이 없습니다.</div>'}
function renderEventCreate(selected=[]){const box=document.querySelector('#soEventOrgChecks');if(box)box.innerHTML=checks('event',selected,myOrganizations())}
async function load(){if(!soWorkspace)return;[soOrganizations,soAssignments]=await Promise.all([api(`/rest/v1/app_suborganizations?workspace_id=eq.${soWorkspace}&active=eq.true&select=*&order=name.asc`),api('/rest/v1/app_suborganization_assignees?select=organization_id,user_id,assigned_by,created_at')]);renderTeam();renderEventCreate();void loadSummaries();if(window.KPTURouter?.current==='team')void refreshStages();return {organizations:soOrganizations,assignments:soAssignments}}
function open(id,{trigger=document.activeElement,initialFocus=null}={}){const m=document.querySelector('#'+id);if(!m)return;m.classList.remove('hidden');m.setAttribute('aria-hidden','false');window.KPTUA11y?.dialog.activate(m,{trigger,initialFocus,onRequestClose:()=>close(id)})}
function close(id){const m=document.querySelector('#'+id);if(!m)return;m.classList.add('hidden');m.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate(m,{restoreFocus:true,fallbackFocus:'#soAddOrg'})}
function openEdit(id=null){soEditing=id?soOrganizations.find(x=>x.id===id):null;document.querySelector('#soEditHeading').textContent=soEditing?'담당조직 수정':'담당조직 추가';document.querySelector('#soEditName').value=soEditing?.name||'';document.querySelector('#soEditAliases').value=(soEditing?.aliases||[]).join(', ');document.querySelector('#sofEditType').value=soEditing?.organization_type&&soEditing.organization_type!=='미분류'?soEditing.organization_type:'';document.querySelector('#soEditDescription').value=soEditing?.description||'';setStatus(document.querySelector('#soEditStatus'),'');open('soEditModal',{initialFocus:'#soEditName'})}
async function saveOrg(){const btn=document.querySelector('#soSaveOrg'),creating=!soEditing;if(creating&&btn.dataset.saving==='1')return;const name=document.querySelector('#soEditName').value.trim(),aliases=document.querySelector('#soEditAliases').value.split(',').map(x=>x.trim()).filter(Boolean),organization_type=document.querySelector('#sofEditType').value.trim()||'미분류',description=document.querySelector('#soEditDescription').value.trim(),st=document.querySelector('#soEditStatus');if(!name){setStatus(st,'조직명을 입력해 주세요.','error');return}if(creating)btn.dataset.saving='1';setBusy(btn,true);setStatus(st,'저장 중…');try{const body={name,aliases,organization_type,description:description||null,updated_at:new Date().toISOString()};if(soEditing)await api(`/rest/v1/app_suborganizations?id=eq.${encodeURIComponent(soEditing.id)}`,{method:'PATCH',body});else await api('/rest/v1/app_suborganizations',{method:'POST',body:{workspace_id:soWorkspace,...body,created_by:soUser.id,active:true}});close('soEditModal');await load();window.dispatchEvent(new Event('kptu:suborganization-updated'));toast(soEditing?'담당조직을 수정했습니다.':'담당조직을 추가했습니다.')}catch(e){setStatus(st,e.message||String(e),'error')}finally{if(creating)btn.dataset.saving='0';setBusy(btn,false)}}
async function removeOrg(id){const o=soOrganizations.find(x=>x.id===id);if(!o||!canEdit(o))return;const {deleteToTrash}=await import('./trash-actions.js');const r=await deleteToTrash({kind:'organization',id,name:o.name,remove:()=>api(`/rest/v1/app_suborganizations?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'}),afterChange:async()=>{await load();window.dispatchEvent(new Event('kptu:suborganization-updated'))},notify:toast});if(r.status==='failed')notify(r.error?.message||String(r.error),{error:true})}
async function openAssign(id){if(!isAdmin())return;soEditing=soOrganizations.find(x=>x.id===id);if(!soEditing)return;await ensureMembers();const selected=new Set(assignedIds(id));document.querySelector('#soAssignHeading').textContent=soEditing.name+' · 담당자';document.querySelector('#soAssignMembers').innerHTML=soMembers.map(m=>`<label class="so-admin-member"><input type="checkbox" value="${esc(m.user_id)}" ${selected.has(m.user_id)?'checked':''}> <span>${esc(nameOf(m.user_id))}</span></label>`).join('');setStatus(document.querySelector('#soAssignStatus'),'');open('soAssignModal',{initialFocus:'#soAssignMembers input'})}
async function saveAssignees(){const btn=document.querySelector('#soSaveAssignees');if(btn.dataset.saving==='1'||!soEditing||!isAdmin())return;const st=document.querySelector('#soAssignStatus'),ids=[...document.querySelectorAll('#soAssignMembers input:checked')].map(x=>x.value);btn.dataset.saving='1';setBusy(btn,true);setStatus(st,'저장 중…');try{await api(`/rest/v1/app_suborganization_assignees?organization_id=eq.${encodeURIComponent(soEditing.id)}`,{method:'DELETE'});if(ids.length)await api('/rest/v1/app_suborganization_assignees',{method:'POST',body:ids.map(user_id=>({organization_id:soEditing.id,user_id,assigned_by:soUser.id}))});close('soAssignModal');await load();window.dispatchEvent(new Event('kptu:suborganization-updated'));toast('담당자를 저장했습니다.')}catch(e){setStatus(st,e.message||String(e),'error')}finally{btn.dataset.saving='0';setBusy(btn,false)}}
function installEventCreate(){const modal=document.querySelector('#eventModal .modal-card');if(!modal||document.querySelector('#soEventOrganizations'))return;const desc=document.querySelector('#eventDescription')?.closest('label');if(!desc)return;const box=document.createElement('div');box.id='soEventOrganizations';box.className='so-org-box';box.hidden=document.querySelector('#eventModal')?.dataset.mode==='task';box.innerHTML='<b>관련 담당조직 <span class="optional">선택</span></b><p>내 담당조직만 표시됩니다.</p><div id="soEventOrgChecks"></div>';desc.insertAdjacentElement('afterend',box);renderEventCreate()}
function selectedCreate(){return [...document.querySelectorAll('[data-event-org]:checked')].map(x=>x.dataset.eventOrg)}
window.__KPTU_SELECTED_EVENT_ORGS__=selectedCreate;
async function syncEvent(eventId,ids){await api(`/rest/v1/app_event_suborganizations?event_id=eq.${encodeURIComponent(eventId)}`,{method:'DELETE'});if(ids.length)await api('/rest/v1/app_event_suborganizations',{method:'POST',body:ids.map(organization_id=>({event_id:eventId,organization_id,created_by:soUser.id}))})}
window.__KPTU_SYNC_EVENT_ORGS__=eventId=>syncEvent(eventId,selectedCreate());
function installGoogleEditSelector(){const modal=document.querySelector('#ciGoogleModal .modal-card');if(!modal||document.querySelector('#soGoogleEditOrganizations'))return;const memo=document.querySelector('#ciGoogleMemo')?.closest('label');if(!memo)return;const box=document.createElement('div');box.id='soGoogleEditOrganizations';box.className='so-org-box';box.innerHTML='<b>관련 담당조직 <span class="optional">선택</span></b><p>내 담당조직만 표시됩니다.</p><div id="soGoogleEditOrgChecks"></div>';memo.insertAdjacentElement('afterend',box)}
let soGoogleHiddenOrgIds=[];
window.__KPTU_EDIT_GOOGLE_ORGS__=selected=>{installGoogleEditSelector();const box=document.querySelector('#soGoogleEditOrgChecks');if(box){const mine=myOrganizations();soGoogleHiddenOrgIds=selected.filter(id=>!mine.some(o=>o.id===id));box.innerHTML=checks('google-edit',selected,mine)}};
window.__KPTU_SELECTED_GOOGLE_EDIT_ORGS__=()=>[...soGoogleHiddenOrgIds,...[...document.querySelectorAll('[data-google-edit-org]:checked')].map(x=>x.dataset.googleEditOrg)];
function resetCreate(){document.querySelectorAll('[data-event-org]').forEach(x=>x.checked=false)}
function bind(){if(soBound)return;soBound=true;window.addEventListener('kptu:workplace-selection',e=>{soSelected=e.detail?.id||null;paintSelection()});window.addEventListener('kptu:basket-links-changed',()=>{void loadSummaries()});window.addEventListener('kptu:dispute-stages-changed',paintStageTags);window.addEventListener('kptu:api-saved',e=>{if(e.detail?.path?.includes('/app_suborganization_updates'))void loadSummaries()});document.querySelector('#soSaveOrg')?.addEventListener('click',saveOrg);document.querySelector('#soSaveAssignees')?.addEventListener('click',saveAssignees);document.addEventListener('keydown',e=>{const card=e.target.closest?.('[data-ps-workplace-org]');if(card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();card.click()}});document.addEventListener('click',e=>{const more=e.target.closest('#soTeamMore');if(more){void installStageMenu(more).catch(err=>console.error('stage menu',err));return}const closeBtn=e.target.closest('[data-so-close]');if(closeBtn){close(closeBtn.dataset.soClose);return}const edit=e.target.closest('[data-so-edit]');if(edit){openEdit(edit.dataset.soEdit);return}const del=e.target.closest('[data-so-delete]');if(del){removeOrg(del.dataset.soDelete);return}const assign=e.target.closest('[data-so-assign]');if(assign){openAssign(assign.dataset.soAssign);return}if(e.target.closest('#newEventBtn,#homeAddEvent,#calendarQuickAdd'))resetCreate();},true);window.addEventListener('kptu:view-changed',e=>{summaryRun++;summaryFlight=null;summaryDirty=false;if(e.detail?.view==='team')load().catch(console.error)});window.addEventListener('kptu:session-changed',()=>{summaryRun++;summaryFlight=null;summaryDirty=false;clearRecency();context().then(ok=>ok&&load()).catch(console.error)})}
async function boot(){if(!rt)return false;if(!(await context()))return false;installTeam();installModals();installEventCreate();installGoogleEditSelector();bind();await load();if(document.querySelector('#ciGoogleModal:not(.hidden)'))window.__KPTU_EDIT_GOOGLE_ORGS__(window.__KPTU_GOOGLE_EDIT_ORGS_PENDING__||[]);window.__KPTU_RELOAD_SUBORGANIZATIONS__=()=>load();return true}
window.__KPTU_SUBORGANIZATIONS_READY__=boot().catch(err=>{console.error('suborganizations init',err);return false});
})();
