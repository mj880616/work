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
// ORG-고르기통일: the event and Google event checks are pickers, so they offer my organizations by the app's one rule
// (my-organizations.js; nothing when nothing is assigned, as before). The 담당조직 list itself keeps myOrganizations() below.
let soPickRule=null;
function pickerOrganizations(){return soPickRule?soPickRule(soOrganizations,soAssignments.filter(x=>x.user_id===soUser?.id),{whenNone:'none'}):[]}
function myOrganizations(){const myName=soUser?.id?nameOf(soUser.id):'';return soOrganizations.filter(o=>{const ids=assignedIds(o.id);if(ids.includes(soUser?.id))return true;return !ids.length&&!!myName&&norm(o.default_assignee_name)===norm(myName)})}
function assigneeMarkup(o){const actual=actualNames(o);if(actual.length)return actual.map(n=>`<span class="so-chip">${esc(n)}</span>`).join('');if(o.default_assignee_name)return `<span class="so-chip">${esc(o.default_assignee_name)}</span><span class="so-planned-note">계정 연결 전</span>`;return '<span class="updated">담당자 미지정</span>'}
// ORG-쟁의단계 다듬기 ③(2026-10-24 11:08): 화면 전체 ⋯(담당조직 메뉴)는 첫 묶음 머리줄이 아니라 화면 제목 '담당조직' 줄 오른쪽에 둔다(바구니 머리줄과 같은 방식:
// 폰은 위 머리줄 "담당조직" 오른쪽으로 올라가고, 761px~는 본문 제목 줄 오른쪽). 묶음이 바뀌어도 자리가 그대로다.
// UI-전수디자인점검 F07: 머리줄은 #soTeamSection의 첫 칸이다. PC(761px~)에서는 ⋯ 하나만 담은 빈 줄을 두지 않고, 목록 칸 맨 위 줄(첫 묶음 머리줄 높이)
// 오른쪽 끝에 겹쳐 놓는다(suborganizations.css). 목록 HTML은 다시 그려지므로 ⋯는 목록 안에 넣지 않는다.
function installTeamHead(section){if(document.querySelector('#soTeamHead'))return;section.insertAdjacentHTML('afterbegin','<div id="soTeamHead" class="so-team-tools so-team-head"><h2 class="so-team-title screen-title">조직 보고</h2>'+(isAdmin()?'<button id="soAddOrg" class="secondary so-team-add" type="button" aria-label="담당조직 추가">+ 담당조직</button>':'')+'<button id="soTeamMore" class="icon-btn so-team-more" type="button" data-ctx="screen" aria-haspopup="true" aria-expanded="false" aria-label="조직 보고 메뉴"><span class="more-dots" aria-hidden="true">⋯</span></button></div>')}
function installTeam(){const team=document.querySelector('#teamView');if(!team)return false;let section=document.querySelector('#soTeamSection');if(!section){section=document.createElement('section');section.id='soTeamSection';section.className='so-team-section';section.innerHTML='<div id="soOrganizationList" class="so-list"></div>';team.appendChild(section)}installTeamHead(section);if(!document.querySelector('#wdDetailPane'))section.insertAdjacentHTML('beforeend','<aside id="wdDetailPane" class="so-pane" aria-label="담당조직 상세"></aside>');return true}
// ORG-PC좌우: on a PC the organization shown on the right (workplace-detail.js, kptu:workplace-selection) is marked in the list.
let soSelected=null;
function paintSelection(){document.querySelectorAll('#soOrganizationList [data-so-org]').forEach(row=>{const on=!!soSelected&&row.dataset.soOrg===soSelected;row.classList.toggle('is-selected',on);if(on)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current')})}
function installModals(){if(document.querySelector('#soEditModal'))return;document.body.insertAdjacentHTML('beforeend',`<div id="soGroupModal" class="modal hidden" data-enter-save role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="soGroupHeading"><div class="modal-card small-card"><div class="modal-head"><div><h2 id="soGroupHeading">묶음 만들기</h2></div><button class="icon-btn" data-so-close="soGroupModal" type="button" aria-label="닫기">×</button></div><label>묶음 이름<input id="soGroupName" type="text" maxlength="20" autocomplete="off" placeholder="예: 병원, 지방공기업"></label><div class="modal-action-footer"><div id="soGroupStatus" class="status"></div><button id="soSaveGroup" data-enter-save-submit class="primary wide" type="button">저장</button></div></div></div><div id="soEditModal" class="modal hidden" data-enter-save role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="soEditHeading"><div class="modal-card small-card"><div class="modal-head"><div><h2 id="soEditHeading">담당조직 추가</h2></div><button class="icon-btn" data-so-close="soEditModal" type="button" aria-label="닫기">×</button></div><label>조직명<input id="soEditName" type="text" maxlength="60" autocomplete="off"></label><label>종류 <span class="optional">안 써도 됨</span><input id="sofEditType" type="text" maxlength="80" list="sofTypeSuggestions" autocomplete="off" placeholder="예: 공공기관, 지방공기업, 병원"><datalist id="sofTypeSuggestions"><option value="중앙공공기관"><option value="지방공기업·출연기관"><option value="철도·도시철도"><option value="자회사·용역"><option value="기타"></datalist></label><div class="modal-action-footer"><div id="soEditStatus" class="status"></div><button id="soSaveOrg" data-enter-save-submit class="primary wide" type="button">저장</button></div></div></div><div id="soAssignModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="soAssignHeading"><div class="modal-card small-card"><div class="modal-head"><div><h2 id="soAssignHeading">담당자 지정</h2></div><button class="icon-btn" data-so-close="soAssignModal" type="button" aria-label="닫기">×</button></div><div id="soAssignMembers" class="so-admin-members"></div><div class="modal-action-footer"><div id="soAssignStatus" class="status"></div><button id="soSaveAssignees" class="primary wide" type="button">담당자 저장</button></div></div></div>`)}
// TASK-조직순서 / D-4c: one surface box per shared organization group.
// UI-디자인기준 3/3: the list heading is the group name with "N곳" on the right.
// MULTI ②-3: 묶음을 정하지 않은 사람(묶음은 조직 보고 화면 [+ 묶음])은 묶음 이름 없이 가나다순 한 목록.
const ordered=(list,item,headings=false)=>(headings=headings&&window.KPTUOrganizationOrder.hasGroups?.()!==false,window.KPTUOrganizationOrder.groups(list)).map(g=>`<div class="so-org-group">${headings?`<div class="so-group-card"><div class="so-group-heading"><span>${esc(window.KPTUOrganizationOrder.groupName(g[0]))}</span><span class="so-group-count">${g.length}곳</span></div>`:''}${g.map(item).join('')}${headings?'</div>':''}</div>`).join('');
// One renderer for the list. The list is read twice on the way in (module start, then entering team); the same rows are not rebuilt,
// so a row someone is about to tap (or has focus on) is not swapped out under them. Selection, stage tags and dots repaint on top as before.
let soTeamHtml=null,soTeamBox=null,soGroupsMod=null,soGroupEditing=null;
function renderTeam(){const box=document.querySelector('#soOrganizationList');if(!box)return;const mine=myOrganizations();const hidden=new Set(window.KPTUOrganizationOrder.PICKER_EXCLUDED||[]),shown=mine.filter(o=>!hidden.has(o.name)),excluded=mine.filter(o=>hidden.has(o.name)).sort((a,b)=>a.name.localeCompare(b.name,'ko'));
 const row=o=>`<div class="so-row${hidden.has(o.name)?' is-excluded':''}" data-so-row="${esc(o.id)}"><article class="so-card kptu-list-row" data-so-org="${esc(o.id)}" data-ps-workplace-org="${esc(o.id)}" role="button" tabindex="0" aria-label="${esc(o.name)} 상세 열기"><div class="so-card-main kptu-list-row-main"><span class="so-dot" data-so-dot="${esc(o.id)}" aria-hidden="true"></span><h4 class="kptu-list-name">${esc(o.name)}</h4><span class="so-chevron kptu-list-chevron" aria-hidden="true">›</span></div></article><button type="button" class="icon-btn so-row-more" data-so-row-more="${esc(o.id)}" aria-haspopup="true" aria-expanded="false" aria-label="${esc(o.name)} 메뉴"><span class="more-dots" aria-hidden="true">⋯</span></button></div>`;
 // MULTI-다른담당자맞춤 ①: [담당 조직에서 제외]한 조직(org_order.hidden)은 원래 묶음에서 빠져 맨 아래 '제외한 조직' 묶음에 흐리게(가나다순).
 const excludedHtml=excluded.length?`<div class="so-org-group so-excluded-group"><div class="so-group-card"><div class="so-group-heading"><span>제외한 조직</span><span class="so-group-count">${excluded.length}곳</span></div>${excluded.map(row).join('')}</div></div>`:'';
 // 묶음 이름 줄이 없는 목록(묶음을 정하지 않은 사람)은 PC에서 맨 위 줄(+ 담당조직·⋯)을 목록 위 따로 한 줄로(첫 조직 줄을 덮지 않게).
 const sec=document.querySelector('#soTeamSection');sec?.classList.toggle('so-none',!mine.length);
 // MULTI-다른담당자맞춤 ②: 묶음이 있거나(값) 빈 묶음을 만들었으면 묶음 칸·손잡이·묶음 ⋯(org-groups-drag.js), 아니면 지금처럼 가나다순 한 목록.
 const grouped=!!soGroupsMod&&(window.KPTUOrganizationOrder.hasGroups?.()||soGroupsMod.hasPending());
 const html=(mine.length?(grouped?soGroupsMod.sectionsHtml(shown,row):ordered(shown,row,true))+excludedHtml:(globalThis.KPTUWait?.emptyHtml?.()||''))+'<button type="button" class="so-reference-entry" data-goto="reference">참고 묶음 <span aria-hidden="true">›</span></button>';if(html!==soTeamHtml||box!==soTeamBox||!box.firstElementChild){box.innerHTML=html;soTeamHtml=html;soTeamBox=box}paintSelection();paintStageTags();window.dispatchEvent(new CustomEvent('kptu:suborganizations-rendered',{detail:{count:mine.length}}));
 // DESK-전체현황표: 담당조직 맨 위 소탭 [목록|전체 표]. 전체 표(org-overview.js)는 같은 내 담당조직 목록을 받아 묶음별 표로 그린다.
 if(mine.length||document.querySelector('#soTeamTabs'))import('./org-overview.js').then(m=>m.syncOverview({orgs:mine,workspaceId:soWorkspace,rt})).catch(err=>console.error('org overview',err))}
// ORG-쟁의단계: 목록 줄 꼬리표(모든 조직의 지금 단계, 색 = 투쟁 중·끝남·평시 — ORG-단계꼬리표전부)와 ⋯ 메뉴 [쟁의 단계 관리]. 판정은 org-dispute-stage-model.mjs 한 곳, 읽기·쓰기는 org-dispute-stage.js.
let stageMod=null,stageMenu=null;
async function stageModules(){if(!stageMod){const [data,model,ui]=await Promise.all([import('./org-dispute-stage.js'),import('./org-dispute-stage-model.mjs'),import('./org-dispute-stage-ui.js')]);stageMod={...data,...model,...ui}}return stageMod}
function paintStageTags(){
 document.querySelectorAll('#soOrganizationList .so-stage-tag').forEach(el=>el.remove());document.querySelectorAll('#soOrganizationList .has-stage').forEach(el=>el.classList.remove('has-stage'));
 const state=stageMod?.peekDisputeState();if(!state||state.status!=='ready')return;
 document.querySelectorAll('#soOrganizationList [data-so-org]').forEach(row=>{const tag=stageMod.listTag(stageMod.stageOfOrg(row.dataset.soOrg,state.histories,state.stages)),main=row.querySelector('.kptu-list-row-main');if(!tag||!main)return;
  const span=document.createElement('span');span.className='so-stage-tag'+(tag.kind==='ended'?' is-end':tag.kind==='quiet'?' is-quiet':'');span.dataset.soStage=tag.kind;span.textContent=tag.text;main.querySelector('.kptu-list-chevron')?.before(span);main.classList.add('has-stage')});
}
async function refreshStages(){if(!soWorkspace)return;try{await stageModules();await stageMod.loadDisputeState({rt,workspaceId:soWorkspace});paintStageTags()}catch(err){console.error('dispute stages',err)}}
// UI-PC손맛묶음 ⑦(2026-11-11 명진 결정 B안): PC에서 선택하지 않은 조직 줄을 우클릭하면 같은 화면 메뉴 맨 위에 [열기] 한 줄이 더 붙는다
// ([열기] ─ [쟁의 단계 관리]). [열기] = 그 줄을 왼쪽 누름과 같은 길로 눌러 오른쪽 상세를 그 조직으로. 메뉴를 띄우는 길은 공용 우클릭(context-menu.js openAt)
// 그대로이고, 어느 줄에서 열었는지만 이 화면이 기억한다(⋯를 그냥 누르면 [열기] 없이 지금 메뉴).
let ctxOrg=null,menuOrg=null;
const soMenuItem=(attr,label)=>`<button type="button" ${attr}>${label}</button>`; // 메뉴 글자 줄(모양은 .basket-link-menu 공용) 한 틀
// MULTI-다른담당자맞춤 ①: 조직 줄 ⋯(폰·PC 모두)와 PC 우클릭은 같은 메뉴에 그 조직 일 — [이름 바꾸기]·[쟁의 단계]·[담당 조직에서 제외]/[담당 조직으로 추가]·[삭제].
// 화면 제목 줄 ⋯는 지금처럼 [쟁의 단계 관리] 하나. 우클릭은 맨 위 [열기]가 더 붙는다. 어느 조직의 메뉴인지는 이 화면만 기억한다(menuOrg).
let menuFrom='screen';
function orgMenuItems(id){const o=soOrganizations.find(x=>x.id===id);if(!o)return '';const out=window.KPTUOrganizationOrder.PICKER_EXCLUDED?.includes(o.name);const mine=canEdit(o);return (mine?soMenuItem('data-so-rename','이름 바꾸기'):'')+(menuFrom==='row'?soMenuItem('data-so-stage-manage','쟁의 단계'):'')+soMenuItem('data-so-exclude',out?'담당 조직으로 추가':'담당 조직에서 제외')+(mine?'<hr class="so-menu-sep" role="separator">'+soMenuItem('data-so-row-delete','삭제'):'')}
// MULTI-다른담당자맞춤 ⑥: 홈 '연락 없는 조직' 줄의 기준 [2주|3주|4주|6주|끄기]는 내 프로필에서 조직 보고 화면 ⋯로 옮겼다. 값은 그대로
// 서버 화면 기억 view_prefs.quiet_weeks 하나(바꾸면 바로 서버 저장). 통화·텔레그램 수집이 있는 작업공간(서버 운영자 기능)에서만 보인다.
let quietMod=null,quietShown=false;
function quietItems(){if(!quietShown||!quietMod)return '';const now=quietMod.weeksOf(window.KPTUViewPrefs?.get?.('quiet_weeks'));return '<hr class="so-menu-sep" role="separator"><div class="so-menu-label" id="soQuietLabel">홈 \'연락 없는 조직\' 기준</div><span class="ds-seg so-quiet-seg" role="group" aria-labelledby="soQuietLabel">'+quietMod.WEEK_CHOICES.map(w=>`<button type="button" class="ds-seg-btn" data-so-quiet="${w}" aria-pressed="${now===w}">${w?w+'주':'끄기'}</button>`).join('')+'</span>'}
async function quietReady(){try{const [{myFeatures},m]=await Promise.all([import('./my-features.js'),import('./org-quiet-model.mjs')]);quietMod=m;const f=await myFeatures(rt);quietShown=f.includes('calls')||f.includes('telegram')}catch{quietShown=false}}
function setQuiet(w){const prefs=window.KPTUViewPrefs;if(!prefs?.set||!quietMod)return;prefs.set('quiet_weeks',w,{rejectable:true});void prefs.flush?.();window.dispatchEvent(new CustomEvent('kptu:quiet-weeks-changed'));toast(w?`'연락 없는 조직' 기준을 ${w}주로 바꿨어요.`:"'연락 없는 조직' 줄을 껐어요.")}
window.addEventListener('kptu:view-prefs-rejected',e=>{if(!e.detail?.paths?.includes('quiet_weeks'))return;notify('서버가 아직 이 기준을 받지 못해 이전 값으로 되돌렸어요.',{error:true});window.dispatchEvent(new CustomEvent('kptu:quiet-weeks-changed'))});
async function installStageMenu(trigger,org=null,from=org?'ctx':'screen'){
 await Promise.all([stageModules(),org?null:quietReady()]);const {createAnchoredMenu}=await import('./anchored-menu.js');
 if(!stageMenu)stageMenu=createAnchoredMenu({id:'soTeamMenu',className:'basket-link-menu so-team-menu',label:'조직 보고 메뉴',historyKey:'kptuSoTeamMenu',key:()=>'team',
  render:()=>{if(menuOrg&&menuFrom==='row')return orgMenuItems(menuOrg);return (menuOrg?soMenuItem('data-so-open-org','열기')+'<hr class="so-menu-sep" role="separator">'+orgMenuItems(menuOrg)+'<hr class="so-menu-sep" role="separator">':'')+(menuOrg?'':soMenuItem('data-so-add-group','묶음 만들기'))+soMenuItem('data-so-stage-manage','쟁의 단계 관리')+(menuOrg?'':quietItems())},
  onAction:(button,active)=>{const id=menuOrg;if(button.matches('[data-so-open-org]')){const row=id&&[...document.querySelectorAll('#soOrganizationList [data-so-org]')].find(r=>r.dataset.soOrg===id);row?.click();return}
   if(button.matches('[data-so-rename]')){openEdit(id,{trigger:active.trigger});return}
   if(button.matches('[data-so-exclude]')){void toggleExcluded(id);return}
   if(button.matches('[data-so-row-delete]')){void removeOrg(id);return}
   if(button.matches('[data-so-quiet]')){setQuiet(Number(button.dataset.soQuiet));return}
   if(button.matches('[data-so-add-group]')){openGroupEdit(null,active.trigger);return}
   stageMod.openStageManager({workspaceId:soWorkspace,rt,trigger:active.trigger,orgNames:()=>new Map(soOrganizations.map(o=>[o.id,o.name]))})}});
 menuOrg=org;menuFrom=org?from:'screen';stageMenu.open(trigger);
}
function orgRowContext(e){
 const row=e.target instanceof Element?e.target.closest('#soOrganizationList [data-so-org]'):null;
 if(!row||e.defaultPrevented||e.shiftKey||e.ctrlKey||e.altKey||e.metaKey||e.pointerType==='touch'||!window.matchMedia('(min-width:761px)').matches)return;
 if(row.classList.contains('is-selected')||!window.KPTUContextMenu?.openAt)return; // 고른 줄은 지금처럼 화면 메뉴만(공용 우클릭)
 const sel=window.getSelection?.();if(sel&&!sel.isCollapsed&&sel.toString().trim()!=='')return;
 const more=document.querySelector('#soTeamMore');if(!more||!more.getClientRects().length)return;
 e.preventDefault();
 const r=row.getBoundingClientRect(),x=e.clientX||Math.round(r.left+r.width/2),y=e.clientY||Math.round(r.bottom),id=row.dataset.soOrg;
 const go=()=>{ctxOrg=id;window.KPTUContextMenu.openAt(more,x,y);ctxOrg=null};
 if(stageMenu?.active)stageMenu.close(go);else go();
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
// S52-01 ③b UI-사업영역조직고르기창: 일정 추가·Google 일정 수정의 '관련 담당조직'은 체크 목록 대신 한 줄(꼬리표 ✕ + [+ 고르기])이고, 누르면 모든 화면과
// 같은 고르기 창(area-org-picker.js: 묶음만 + 펼침, 찾기·자주 쓴 것, 여러 개 + [넣기])이 뜬다. 고를 수 있는 곳(내 담당조직, pickerOrganizations)과
// 저장(app_event_suborganizations, Google 일정 organization_ids)은 그대로. 고른 id는 이 파일의 두 목록(soEventSel·soGoogleSel)이 갖는다(화면 상태, 기기 저장 없음).
// S52-30 CAL-일정사업영역: 같은 칸에 할 일 창과 같은 '사업영역' 줄을 더한다(두 줄 '사업영역 / 관련 담당조직', 같은 고르기 창, 여러 개).
// 고를 수 있는 사업영역은 공용 사업영역 목록(project-catalog.js)의 진행 중인 것(할 일 창과 같음). 고른 id는 soEventAreas·soGoogleAreas가 갖고,
// 저장은 부르는 쪽(calendar-plus.js·calendar-interactions-v2.js)이 '사업영역 주요 일정' 행으로 한다(quick-save.js syncEventAreas).
// 목록에 없는 사업영역(보관한 곳 등)에 이미 걸린 것은 보이지 않아도 그대로 둔다. Google 일정의 연결을 읽지 못했으면 사업영역 줄만 누를 수 없다.
let soEventSel=[],soGoogleSel=[],soEventAreas=[],soGoogleAreas=[],soGoogleAreasKnown=true,soPicker=null,soPickerFlight=null;const soLines=new Map();
function pickerModule(){soPickerFlight||=import('./area-org-picker.js').then(m=>soPicker=m);return soPickerFlight}
async function areaChoices(){const ctx=rt.context?.read?.(),ws=ctx?.workspace?.id||ctx?.workspaceId,owner=ctx?.user?.id;if(!ws||!owner)return [];if(!window.KPTUProjectCatalog?.load)await import('./project-catalog.js');const snap=await window.KPTUProjectCatalog.load({workspaceId:ws,userId:owner});return (snap?.tree||[]).filter(x=>x?.project?.id&&x.project.status==='active')}
// pick: {orgs(), setOrgs(ids), areas(), setAreas(ids), areasKnown()}.
function orgLine(boxId,pick,{withAreas=true}={}){
 const box=document.querySelector('#'+boxId);if(!box)return;
 const paint=entry=>{const mine=pickerOrganizations(),order=window.KPTUOrganizationOrder,list=order.forPicker(mine,pick.orgs()),lines=entry.lines;lines.set({areas:soPicker.catalogAreas(entry.areaRows||[]),orgGroups:soPicker.orderedOrgGroups(order.groups(list)),selected:[...pick.areas().map(id=>'p:'+id),...pick.orgs().map(id=>'o:'+id)]});lines.disable(false);if(pick.areasKnown()===false)lines.disable(true,'area');void soPicker.usedKeysNow(rt).then(keys=>{if(soLines.get(boxId)===entry)lines.used(keys)}).catch(()=>{})};
 const areas=entry=>{if(!withAreas&&!entry.areaRows)return;void areaChoices().then(rows=>{if(soLines.get(boxId)!==entry||!entry.host.isConnected)return;entry.areaRows=rows;paint(entry)}).catch(err=>console.error('area choices',err))};
 const have=soLines.get(boxId);if(have&&have.host===box&&soPicker){have.pick=pick;paint(have);areas(have);return}
 void pickerModule().then(()=>{const now=document.querySelector('#'+boxId);if(!now)return;let entry=soLines.get(boxId);
  if(!entry||entry.host!==now){entry={host:now,lines:null,areaRows:null,pick};const e=entry;entry.lines=soPicker.mountAreaOrgLines(now,{kinds:['area','org'],labels:{org:'관련 담당조직'},onChange:()=>{const keys=[...e.lines.value()],known=e.lines.known(),keep=e.pick.areas().filter(id=>!known.has('p:'+id));e.pick.setOrgs(keys.filter(k=>k.startsWith('o:')).map(k=>k.slice(2)));e.pick.setAreas([...keep,...keys.filter(k=>k.startsWith('p:')).map(k=>k.slice(2))])}});soLines.set(boxId,entry)}
  entry.pick=pick;paint(entry);areas(entry)}).catch(err=>console.error('organization picker',err));
}
const eventPick={orgs:()=>soEventSel,setOrgs:ids=>{soEventSel=ids},areas:()=>soEventAreas,setAreas:ids=>{soEventAreas=ids},areasKnown:()=>true};
const googlePick={orgs:()=>soGoogleSel,setOrgs:ids=>{soGoogleSel=ids},areas:()=>soGoogleAreas,setAreas:ids=>{soGoogleAreas=ids},areasKnown:()=>soGoogleAreasKnown};
// PERF-첫로딩 P5: 첫 화면(load)에서 그릴 때는 사업영역 목록(project-catalog.js)을 받지 않는다 — 새 일정 창을 열 때(resetCreate) 받는다.
function renderEventCreate(selected=[],areas=soEventAreas,{withAreas=true}={}){soEventSel=[...selected];soEventAreas=[...areas];orgLine('soEventOrgChecks',eventPick,{withAreas})}
// MULTI-다른담당자맞춤 ②: 묶음 칸·끌기 모듈은 목록 읽기를 기다리게 하지 않는다(첫 화면 시간 그대로). 받으면 목록을 한 번 다시 그린다.
let groupsFlight=null;
function loadGroups(){groupsFlight||=import('./org-groups-drag.js').then(m=>{if(!soGroupsMod){soGroupsMod=m;m.install({writeOrder,rerender:()=>renderTeam(),toast,notify,openGroupEdit,menuItem:soMenuItem});if(soOrganizations.length)renderTeam()}return m}).catch(err=>{groupsFlight=null;console.error('org groups',err)});return groupsFlight}
async function load(){if(!soWorkspace)return;let rule;void loadGroups();[soOrganizations,soAssignments,rule]=await Promise.all([api(`/rest/v1/app_suborganizations?workspace_id=eq.${soWorkspace}&active=eq.true&select=*&order=name.asc`),api('/rest/v1/app_suborganization_assignees?select=organization_id,user_id,assigned_by,created_at'),import('./my-organizations.js')]);soPickRule=rule.pickMyOrganizations;renderTeam();renderEventCreate(undefined,undefined,{withAreas:false});void loadSummaries();if(window.KPTURouter?.current==='team')void refreshStages();return {organizations:soOrganizations,assignments:soAssignments}}
function open(id,{trigger=document.activeElement,initialFocus=null}={}){const m=document.querySelector('#'+id);if(!m)return;m.classList.remove('hidden');m.setAttribute('aria-hidden','false');window.KPTUA11y?.dialog.activate(m,{trigger,initialFocus,onRequestClose:()=>close(id)})}
function close(id){const m=document.querySelector('#'+id);if(!m)return;m.classList.add('hidden');m.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate(m,{restoreFocus:true,fallbackFocus:'#soAddOrg'})}
// MULTI-다른담당자맞춤 ①: 조직 보고 맨 위 [+ 담당조직]과 줄 ⋯ [이름 바꾸기]가 여는 창. 칸은 이름·종류 둘(다른 이름·설명은 고치지 않고 그대로 둔다).
function openEdit(id=null,{trigger=document.activeElement}={}){soEditing=id?soOrganizations.find(x=>x.id===id):null;if(id&&!soEditing)return;document.querySelector('#soEditHeading').textContent=soEditing?'이름 바꾸기':'담당조직 추가';document.querySelector('#soEditName').value=soEditing?.name||'';document.querySelector('#sofEditType').value=soEditing?.organization_type&&soEditing.organization_type!=='미분류'?soEditing.organization_type:'';setStatus(document.querySelector('#soEditStatus'),'');open('soEditModal',{trigger,initialFocus:'#soEditName'})}
// 새로 만든 조직은 만든 사람의 담당으로 바로 잇는다(내 담당조직 규칙 my-organizations.js는 담당 행으로 고르므로, 잇지 않으면 목록에 안 보인다).
// 이름을 바꾸면 내 묶음·제외 표시(org_order, 이름으로 맞춤)도 새 이름으로 옮긴다. 같은 작업공간에 같은 이름이 있으면 저장하지 않는다.
async function saveOrg(){const btn=document.querySelector('#soSaveOrg'),creating=!soEditing;if(btn.dataset.saving==='1')return;const name=document.querySelector('#soEditName').value.trim(),organization_type=document.querySelector('#sofEditType').value.trim()||'미분류',st=document.querySelector('#soEditStatus');if(!name){setStatus(st,'조직명을 입력해 주세요.','error');return}if(soOrganizations.some(o=>o.id!==soEditing?.id&&norm(o.name)===norm(name))){setStatus(st,'같은 이름의 담당조직이 이미 있어요.','error');return}const before=soEditing?.name||'';btn.dataset.saving='1';setBusy(btn,true);setStatus(st,'저장 중…');try{const body={name,organization_type,updated_at:new Date().toISOString()};if(soEditing){await api(`/rest/v1/app_suborganizations?id=eq.${encodeURIComponent(soEditing.id)}`,{method:'PATCH',body});if(before!==name)await moveOrderName(before,name)}else{const rows=await api('/rest/v1/app_suborganizations?select=id',{method:'POST',body:{workspace_id:soWorkspace,...body,aliases:[],description:null,created_by:soUser.id,active:true},prefer:'return=representation'});const id=Array.isArray(rows)?rows[0]?.id:rows?.id;if(id)await api('/rest/v1/app_suborganization_assignees',{method:'POST',body:{organization_id:id,user_id:soUser.id,assigned_by:soUser.id}})}close('soEditModal');await load();window.dispatchEvent(new Event('kptu:suborganization-updated'));toast(creating?'담당조직을 추가했어요.':'이름을 바꿨어요.')}catch(e){setStatus(st,e.message||String(e),'error')}finally{btn.dataset.saving='0';setBusy(btn,false)}}
// MULTI-다른담당자맞춤 ②: 화면 ⋯ [묶음 만들기](name=null)와 묶음 ⋯ [이름 바꾸기]가 여는 창. ([+ 묶음]을 맨 위 줄 단추로 두면 PC 900px에서
// 첫 묶음 머리줄(맨 위 줄 단추가 겹쳐 놓이는 줄, F07)의 묶음 이름이 가려져 화면 ⋯ 메뉴 줄로 두었다.) 칸은 묶음 이름 하나(1~20자). 규칙·저장은 org-groups-drag.js.
function openGroupEdit(name=null,trigger=document.activeElement){soGroupEditing=name;document.querySelector('#soGroupHeading').textContent=name?'묶음 이름 바꾸기':'묶음 만들기';document.querySelector('#soGroupName').value=name||'';setStatus(document.querySelector('#soGroupStatus'),'');open('soGroupModal',{trigger,initialFocus:'#soGroupName'})}
async function saveGroup(){const btn=document.querySelector('#soSaveGroup');if(btn.dataset.saving==='1'||!soGroupsMod)return;const st=document.querySelector('#soGroupStatus'),name=document.querySelector('#soGroupName').value.trim();btn.dataset.saving='1';setBusy(btn,true);try{const problem=soGroupEditing===null?soGroupsMod.addGroup(name):await soGroupsMod.renameGroupNamed(soGroupEditing,name);if(problem){setStatus(st,problem,'error');return}close('soGroupModal')}finally{btn.dataset.saving='0';setBusy(btn,false)}}
// 내 묶음·제외 표시 고치기(org_order 하나, view-prefs.js). 서버가 받지 않으면 값은 되돌아가고 한 줄로 알린다.
let orderEdit=null;const orderEditMod=()=>orderEdit||=import('./org-order-edit.mjs');
async function writeOrder(next){const prefs=window.KPTUViewPrefs;if(!prefs?.set)return false;prefs.set('org_order',next,{rejectable:true});await prefs.flush?.();const ok=JSON.stringify(prefs.get('org_order')??null)===JSON.stringify(next)&&(!prefs.status||prefs.status()==='ok');if(ok)window.dispatchEvent(new CustomEvent('kptu:report-settings-changed'));return ok}
async function moveOrderName(from,to){const m=await orderEditMod(),r=m.renameInOrder(window.KPTUViewPrefs?.get?.('org_order')??null,from,to);if(r.changed&&!(await writeOrder(r.value)))notify('묶음 자리를 새 이름으로 옮기지 못했어요. 이 조직은 그 외 묶음에 보여요.',{error:true})}
async function toggleExcluded(id){const o=soOrganizations.find(x=>x.id===id);if(!o)return;const m=await orderEditMod(),cur=window.KPTUViewPrefs?.get?.('org_order')??null,exclude=!m.isExcluded(cur,o.name),r=m.setExcluded(cur,o.name,exclude);if(r.error){notify(r.error,{error:true});return}if(!r.changed)return;if(!(await writeOrder(r.value))){notify('저장하지 못했어요. 잠시 뒤 다시 해 주세요.',{error:true});return}renderTeam();toast(exclude?'담당 조직에서 제외했어요. 선택 창에 안 나와요.':'담당 조직으로 추가했어요.')}
async function removeOrg(id){const o=soOrganizations.find(x=>x.id===id);if(!o||!canEdit(o))return;const {deleteToTrash}=await import('./trash-actions.js');const r=await deleteToTrash({kind:'organization',id,name:o.name,remove:()=>api(`/rest/v1/app_suborganizations?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'}),afterChange:async()=>{await load();window.dispatchEvent(new Event('kptu:suborganization-updated'))},notify:toast});if(r.status==='failed')notify(r.error?.message||String(r.error),{error:true})}
async function openAssign(id){if(!isAdmin())return;soEditing=soOrganizations.find(x=>x.id===id);if(!soEditing)return;await ensureMembers();const selected=new Set(assignedIds(id));document.querySelector('#soAssignHeading').textContent=soEditing.name+' · 담당자';document.querySelector('#soAssignMembers').innerHTML=soMembers.map(m=>`<label class="so-admin-member"><input type="checkbox" value="${esc(m.user_id)}" ${selected.has(m.user_id)?'checked':''}> <span>${esc(nameOf(m.user_id))}</span></label>`).join('');setStatus(document.querySelector('#soAssignStatus'),'');open('soAssignModal',{initialFocus:'#soAssignMembers input'})}
async function saveAssignees(){const btn=document.querySelector('#soSaveAssignees');if(btn.dataset.saving==='1'||!soEditing||!isAdmin())return;const st=document.querySelector('#soAssignStatus'),ids=[...document.querySelectorAll('#soAssignMembers input:checked')].map(x=>x.value);btn.dataset.saving='1';setBusy(btn,true);setStatus(st,'저장 중…');try{await api(`/rest/v1/app_suborganization_assignees?organization_id=eq.${encodeURIComponent(soEditing.id)}`,{method:'DELETE'});if(ids.length)await api('/rest/v1/app_suborganization_assignees',{method:'POST',body:ids.map(user_id=>({organization_id:soEditing.id,user_id,assigned_by:soUser.id}))});close('soAssignModal');await load();window.dispatchEvent(new Event('kptu:suborganization-updated'));toast('담당자를 저장했습니다.')}catch(e){setStatus(st,e.message||String(e),'error')}finally{btn.dataset.saving='0';setBusy(btn,false)}}
function installEventCreate(){const modal=document.querySelector('#eventModal .modal-card');if(!modal||document.querySelector('#soEventOrganizations'))return;const desc=document.querySelector('#eventDescription')?.closest('label');if(!desc)return;const box=document.createElement('div');box.id='soEventOrganizations';box.className='so-org-box';box.hidden=document.querySelector('#eventModal')?.dataset.mode==='task';box.innerHTML='<div id="soEventOrgChecks"></div>';desc.insertAdjacentElement('afterend',box);renderEventCreate(undefined,undefined,{withAreas:false})}
function selectedCreate(){return [...soEventSel]}
window.__KPTU_SELECTED_EVENT_ORGS__=selectedCreate;
window.__KPTU_SELECTED_EVENT_AREAS__=()=>[...soEventAreas];
async function syncEvent(eventId,ids){await api(`/rest/v1/app_event_suborganizations?event_id=eq.${encodeURIComponent(eventId)}`,{method:'DELETE'});if(ids.length)await api('/rest/v1/app_event_suborganizations',{method:'POST',body:ids.map(organization_id=>({event_id:eventId,organization_id,created_by:soUser.id}))})}
window.__KPTU_SYNC_EVENT_ORGS__=eventId=>syncEvent(eventId,selectedCreate());
function installGoogleEditSelector(){const modal=document.querySelector('#ciGoogleModal .modal-card');if(!modal||document.querySelector('#soGoogleEditOrganizations'))return;const memo=document.querySelector('#ciGoogleMemo')?.closest('label');if(!memo)return;const box=document.createElement('div');box.id='soGoogleEditOrganizations';box.className='so-org-box';box.innerHTML='<div id="soGoogleEditOrgChecks"></div>';(document.querySelector('#ciGoogleFiles')||memo).insertAdjacentElement('afterend',box)} // CAL-일정첨부: [사진·파일] 칸은 [메모] 바로 아래(시안 ①), 담당조직은 그 다음
let soGoogleHiddenOrgIds=[];
// areas: the project ids already linked to this event (its 주요 일정 rows), or null when they could not be read.
window.__KPTU_EDIT_GOOGLE_ORGS__=(selected,{areas=[]}={})=>{installGoogleEditSelector();soGoogleAreasKnown=Array.isArray(areas);soGoogleAreas=soGoogleAreasKnown?[...new Set(areas.map(String))]:[];if(!document.querySelector('#soGoogleEditOrgChecks'))return;const mine=pickerOrganizations();soGoogleHiddenOrgIds=selected.filter(id=>!mine.some(o=>o.id===id));soGoogleSel=selected.filter(id=>mine.some(o=>o.id===id));orgLine('soGoogleEditOrgChecks',googlePick)};
window.__KPTU_SELECTED_GOOGLE_EDIT_ORGS__=()=>[...soGoogleHiddenOrgIds,...soGoogleSel];
// null: the event's areas were not read, so the save leaves them as they are.
window.__KPTU_SELECTED_GOOGLE_EDIT_AREAS__=()=>soGoogleAreasKnown?[...soGoogleAreas]:null;
function resetCreate(){renderEventCreate([],[])}
window.__KPTU_RESET_EVENT_PICKS__=resetCreate; // CAL-일정사업영역: 새 일정 창마다(calendar-plus.js cmPrepareNewEvent) 고른 사업영역·담당조직을 비운다
function bind(){if(soBound)return;soBound=true;window.addEventListener('kptu:workplace-selection',e=>{soSelected=e.detail?.id||null;paintSelection()});window.addEventListener('kptu:basket-links-changed',()=>{void loadSummaries()});window.addEventListener('kptu:dispute-stages-changed',paintStageTags);window.addEventListener('kptu:api-saved',e=>{if(e.detail?.path?.includes('/app_suborganization_updates'))void loadSummaries()});document.querySelector('#soSaveOrg')?.addEventListener('click',saveOrg);document.querySelector('#soSaveGroup')?.addEventListener('click',saveGroup);document.querySelector('#soSaveAssignees')?.addEventListener('click',saveAssignees);document.addEventListener('contextmenu',orgRowContext,true);document.addEventListener('keydown',e=>{const card=e.target.closest?.('[data-ps-workplace-org]');if(card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();card.click()}});document.addEventListener('click',e=>{const more=e.target.closest('#soTeamMore');if(more){void installStageMenu(more,ctxOrg).catch(err=>console.error('stage menu',err));return}const rowMore=e.target.closest('[data-so-row-more]');if(rowMore){e.preventDefault();e.stopPropagation();void installStageMenu(rowMore,rowMore.dataset.soRowMore,'row').catch(err=>console.error('org row menu',err));return}if(e.target.closest('#soAddOrg')){openEdit(null,{trigger:e.target.closest('#soAddOrg')});return}const closeBtn=e.target.closest('[data-so-close]');if(closeBtn){close(closeBtn.dataset.soClose);return}const edit=e.target.closest('[data-so-edit]');if(edit){openEdit(edit.dataset.soEdit);return}const del=e.target.closest('[data-so-delete]');if(del){removeOrg(del.dataset.soDelete);return}const assign=e.target.closest('[data-so-assign]');if(assign){openAssign(assign.dataset.soAssign);return}if(e.target.closest('#newEventBtn,#homeAddEvent,#calendarQuickAdd'))resetCreate();},true);window.addEventListener('kptu:view-changed',e=>{summaryRun++;summaryFlight=null;summaryDirty=false;if(e.detail?.view==='team')load().catch(console.error)});window.addEventListener('kptu:session-changed',()=>{summaryRun++;summaryFlight=null;summaryDirty=false;clearRecency();context().then(ok=>ok&&load()).catch(console.error)})}
async function boot(){if(!rt)return false;if(!(await context()))return false;installTeam();installModals();installEventCreate();installGoogleEditSelector();bind();await load();if(document.querySelector('#ciGoogleModal:not(.hidden)'))window.__KPTU_EDIT_GOOGLE_ORGS__(window.__KPTU_GOOGLE_EDIT_ORGS_PENDING__||[],{areas:window.__KPTU_GOOGLE_EDIT_AREAS_PENDING__});window.__KPTU_RELOAD_SUBORGANIZATIONS__=()=>load();return true}
// PERF-첫로딩 P5: 조직 상세(workplace-detail.js)와 그 할 일 칸(project-catalog.js·google-tasks.js)은 목록이 보인 뒤 받는다(첫 화면 앞에 받던 JS 약 40개).
// 순서는 옛 view-loader.js organizations()와 같다. 다 받기 전의 열기 길: KPTUWorkplace.open(다른 화면·검색에서 여는 곳)은 받은 뒤 진짜 open으로 넘기고,
// 목록·프로필의 조직 줄([data-ps-workplace-org]) 클릭은 받은 뒤 같은 줄을 다시 누른다(첫 클릭만 잠깐 늦을 수 있음 — 명진 결정 11/02).
let detailFlight=null;
function loadDetail(){
 // 이미 받은 것(할 일 화면이 먼저 받은 google-tasks.js 등)은 건너뛴다.
 detailFlight||=(async()=>{if(!window.KPTUProjectCatalog)await import('./project-catalog.js');if(!window.KPTUGoogleTasks)await import('./google-tasks.js');if(!detailLoaded()){await import('./workplace-detail.js');import('./workplace-report.js').catch(console.error)}})();
 detailFlight.catch(()=>{detailFlight=null});
 return detailFlight;
}
const detailLoaded=()=>window.KPTUWorkplace&&window.KPTUWorkplace.open!==openBeforeDetail;
async function openBeforeDetail(...args){await loadDetail();if(!detailLoaded())throw new Error('organization detail did not load');return window.KPTUWorkplace.open(...args)}
if(!window.KPTUWorkplace)window.KPTUWorkplace={open:openBeforeDetail,load:loadDetail}; // workplace-detail.js가 {open:wdOpen}으로 바꾼다
document.addEventListener('click',e=>{
 if(detailLoaded())return;
 const row=e.target.closest?.('[data-ps-workplace-org]');if(!row)return;
 e.preventDefault();e.stopImmediatePropagation();
 row.setAttribute('aria-busy','true');
 loadDetail().then(()=>{row.removeAttribute('aria-busy');if(row.isConnected&&detailLoaded())row.click()}).catch(err=>{row.removeAttribute('aria-busy');console.error('organization detail load',err);notify('조직 상세를 불러오지 못했어요. 다시 눌러 주세요.',{error:true})});
},true);
function afterReveal(){return new Promise(resolve=>{const next=()=>requestAnimationFrame(()=>setTimeout(resolve,0));if(document.querySelector('#appView')?.classList.contains('kptu-ui-ready'))return next();window.addEventListener('kptu:app-ui-ready',next,{once:true})})}
// 담당조직 화면에 들어왔을 때만 미리 받는다(달력 일정 칸 등 목록 모듈만 쓰는 화면에서는 받지 않음). 앱 화면 안에서만(KPTUViewLoader가 있을 때)
// — 상세를 따로 띄운 시험 틀은 자기가 고른 모듈을 그대로 쓴다.
function preloadDetail(){void afterReveal().then(loadDetail).catch(err=>console.error('organization detail load',err))}
if(window.KPTUViewLoader){if(window.KPTURouter?.current==='team')preloadDetail();window.KPTURouter?.on?.('team',preloadDetail)}
window.__KPTU_SUBORGANIZATIONS_READY__=boot().catch(err=>{console.error('suborganizations init',err);return false});
})();
