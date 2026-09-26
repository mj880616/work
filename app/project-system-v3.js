(()=>{
'use strict';
const rt=window.KPTURuntime,catalog=window.KPTUProjectCatalog;if(!rt||!catalog)return;
const api=(p,o={})=>rt.api(p,o),$=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>v?new Date(v).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const date=v=>v?new Date(v).toLocaleDateString('ko-KR'):'미정';
const localInput=v=>{if(!v)return'';const d=new Date(v),off=d.getTimezoneOffset();return new Date(d.getTime()-off*60000).toISOString().slice(0,16)};
const PHASE={preparation:'준비',in_progress:'진행',consultation:'협의',execution:'실행',follow_up:'후속조치',done:'종료'};
const MTYPE={action:'행동·사업',meeting:'협의·회의',policy:'정책·국회',deadline:'마감',result:'성과·결과'};
const MILESTONE_EVENT_TYPE={action:'other',meeting:'meeting',policy:'other',deadline:'deadline',result:'other'};
const MODULES=[['progress','진행상황'],['milestones','주요 일정'],['tasks','할 일'],['documents','자료']];
const MSTATUS={planned:'예정',scheduled:'예정',confirmed:'확정',in_progress:'진행',done:'완료',completed:'완료',postponed:'연기',cancelled:'취소',canceled:'취소'};
const mstatus=v=>MSTATUS[v||'planned']||v;
const day=v=>{const [y,m,d]=String(v||'').slice(0,10).split('-');if(!d)return'';return (Number(y)===new Date().getFullYear()?'':y+'.')+Number(m)+'.'+Number(d)};
const CONTENT_TYPES={text:'글',status:'현황',metrics:'지표',table:'표',timeline:'흐름·경과',links:'링크'};
let user=null,membership=null,wid=null,members=[],profiles=[],spaces=[],projects=[],current=null,detail=null,editingProject=null,editingMilestone=null,editingWs=null,editingMemo=null,lastSpacesKey='',detailEpoch=0,projectEpoch=0,googleCalendarState=null;
const archived=()=>catalog.archived(projects);
const tops=()=>catalog.tops(projects);
const kids=p=>catalog.kids(projects,p);
const parent=p=>p?.parent_id?projects.find(x=>x.id===p.parent_id):null;
const nameOf=id=>profiles.find(x=>x.user_id===id)?.display_name||id?.slice(0,8)||'팀원';
const canManage=p=>p?.owner_id===user?.id;
const canEdit=p=>canManage(p);
const MODAL_FOCUS={ps3DetailModal:'[data-ps3-close="ps3DetailModal"]',ps3CreateModal:'#ps3CreateName',ps3WorkstreamModal:'#ps3WsTitle',ps3MilestoneModal:'#ps3MilestoneTitle'};
function toast(msg){const t=$('#toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.add('hidden'),2400)}
async function googleCalendarCall(action,{method='GET',body=null,params=null}={}){if(!(await rt.session.ensure()))throw new Error('로그인이 필요합니다.');const u=new URL(rt.config.url+'/functions/v1/google-calendar');if(action)u.searchParams.set('action',action);if(params)Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v)));const d=await api(u.toString(),{method,body});if(d?.error)throw new Error(d.error||'Google Calendar 요청 실패');return d}
async function googleCalendarStatus(){const cached=window.__KPTU_GOOGLE_STATE__;if(cached&&typeof cached.connected==='boolean'&&Array.isArray(cached.calendars)){googleCalendarState=cached;return cached}try{googleCalendarState=await googleCalendarCall('status');window.__KPTU_GOOGLE_STATE__={...(window.__KPTU_GOOGLE_STATE__||{}),...(googleCalendarState||{})};return googleCalendarState}catch(e){googleCalendarState={connected:false,calendars:[],warning:e?.message||String(e)};return googleCalendarState}}
const writableGoogleCalendars=s=>(s?.calendars||[]).filter(x=>['owner','writer'].includes(x.accessRole||''));
const milestoneGoogleLinked=m=>!!(m?.google_calendar_id&&m?.google_event_id);
function milestoneVisibleBody(){
  const value=$('#ps3MilestoneAt').value;
  return {title:$('#ps3MilestoneTitle').value.trim(),start_at:value?new Date(value).toISOString():null,end_at:null,notes:$('#ps3MilestoneNotes').value.trim()||null}
}
function milestoneFullBody(visible,source=null){return{workstream_id:source?.workstream_id||null,title:visible.title,milestone_type:source?.milestone_type||'action',status:source?.status||'planned',start_at:visible.start_at,end_at:visible.end_at||null,notes:visible.notes||null}}
function milestoneRestorePayload(row,googleEventId=row?.google_event_id){
  const out={};
  for(const key of ['id','project_id','workstream_id','title','milestone_type','status','start_at','end_at','notes','event_id','child_project_id','sort_order','created_by','google_calendar_id'])if(row?.[key]!==undefined)out[key]=row[key];
  out.google_event_id=googleEventId||null;
  return out
}
async function prepareMilestoneGoogle(milestone=null){
  const sel=$('#ps3MilestoneGoogle'),hint=$('#ps3MilestoneGoogleHint'),save=$('#ps3MilestoneSave');
  if(!sel)return;
  sel.disabled=true;sel.innerHTML='';
  if(milestone){
    if(milestoneGoogleLinked(milestone)){
      const s=await googleCalendarStatus(),rows=writableGoogleCalendars(s),current=rows.find(x=>x.id===milestone.google_calendar_id);
      sel.innerHTML='<option value="'+esc(milestone.google_calendar_id)+'">'+esc(current?.summary||milestone.google_calendar_id)+'</option>';
      sel.value=milestone.google_calendar_id;
      if(hint)hint.textContent='이 일정은 Google Calendar와 연결되어 있습니다. 캘린더 이동 없이 같은 일정으로 수정됩니다.';
    }else{
      sel.innerHTML='<option value="">Google 연결 없음</option>';
      if(hint)hint.textContent='기존 미연동 일정입니다. 수정해도 Google 일정을 새로 만들지 않습니다.';
    }
    if(save)save.disabled=false;
    return
  }
  if(save)save.disabled=true;
  sel.innerHTML='<option value="">Google Calendar 확인 중…</option>';
  if(hint)hint.textContent='Google Calendar 연결 상태를 확인하는 중…';
  const s=await googleCalendarStatus();
  if(!s?.connected){
    const reconnect=!!s?.warning;
    sel.innerHTML='<option value="">'+(reconnect?'Google Calendar 재연결 필요':'Google Calendar 연결 필요')+'</option>';
    if(hint)hint.textContent=reconnect?'Google Calendar 재연결이 필요합니다: '+s.warning:'신규 프로젝트 일정은 Google Calendar 연결 후 저장할 수 있습니다.';
    return
  }
  const rows=writableGoogleCalendars(s);
  if(!rows.length){
    sel.innerHTML='<option value="">쓰기 가능한 캘린더 없음</option>';
    if(hint)hint.textContent=s.warning?'Google Calendar 재연결이 필요합니다: '+s.warning:'쓰기 가능한 Google 세부캘린더가 없습니다.';
    return
  }
  sel.innerHTML=rows.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.summary||x.id)+(x.primary?' (기본)':'')+'</option>').join('');
  const selected=new Set(s.selected||[]),preferred=rows.find(x=>selected.has(x.id)||(x.primary&&selected.has('primary')))||rows.find(x=>x.primary)||rows[0];
  if(preferred)sel.value=preferred.id;
  sel.disabled=false;
  if(save)save.disabled=!sel.value;
  if(hint)hint.textContent='신규 프로젝트 일정은 선택한 Google 세부캘린더와 Web2에 함께 저장됩니다.'
}
function milestoneEventPayload(body,eventId=null){
  const payload={workspace_id:wid,project_id:current.id,workstream_id:body.workstream_id||null,title:body.title,description:body.notes||null,event_type:MILESTONE_EVENT_TYPE[body.milestone_type]||'other',start_at:body.start_at,end_at:body.end_at||null,location:null,created_by:user.id,body:body.notes||'',calendar_scope:'personal'};
  if(eventId)payload.id=eventId;
  return payload
}
async function createLinkedMilestoneEvent(body,eventId=null){
  if(!body.start_at)throw new Error('프로젝트 일정의 일시를 입력해 주세요.');
  const rows=await api('/rest/v1/app_events',{method:'POST',body:milestoneEventPayload(body,eventId),prefer:'return=representation'});
  const row=rows?.[0];
  if(!row?.id)throw new Error('Web2 일정 저장 결과를 확인하지 못했습니다.');
  return row
}
async function syncLinkedMilestoneEvent(eventId,body){
  if(!eventId||!body.start_at)return;
  const payload=milestoneEventPayload(body);delete payload.workspace_id;delete payload.created_by;
  await api('/rest/v1/app_events?id=eq.'+encodeURIComponent(eventId),{method:'PATCH',body:{...payload,updated_at:new Date().toISOString()}})
}
async function deleteLinkedMilestoneEvent(eventId){if(eventId)await api('/rest/v1/app_events?id=eq.'+encodeURIComponent(eventId),{method:'DELETE'})}
function googleMilestonePayload(action,calendarId,eventId,body){
  if(!body.start_at)throw new Error('Google Calendar에 저장하려면 일시를 입력해 주세요.');
  const start=new Date(body.start_at),end=new Date(start.getTime()+60*60*1000);
  return {action,calendar_id:calendarId,...(eventId?{event_id:eventId}:{}),title:body.title,memo:body.notes||'',location:'',all_day:false,start_iso:start.toISOString(),end_iso:end.toISOString()}
}
async function createGoogleMilestone(calendarId,body){
  const result=await googleCalendarCall('',{method:'POST',body:googleMilestonePayload('create-event',calendarId,null,body)});
  if(!result?.event?.id)throw new Error('Google Calendar가 생성한 일정 ID를 확인하지 못했습니다.');
  return result.event
}
async function updateGoogleMilestone(calendarId,eventId,body){
  if(!calendarId||!eventId)throw new Error('Google Calendar 연결 식별자가 없습니다.');
  const result=await googleCalendarCall('',{method:'POST',body:googleMilestonePayload('update-event',calendarId,eventId,body)});
  if(!result?.event?.id)throw new Error('Google Calendar 수정 결과를 확인하지 못했습니다.');
  return result.event
}
async function deleteGoogleMilestone(calendarId,eventId){
  if(!calendarId||!eventId)throw new Error('Google Calendar 연결 식별자가 없습니다.');
  return googleCalendarCall('',{method:'POST',body:{action:'delete-event',calendar_id:calendarId,event_id:eventId}})
}
async function reloadMilestoneCalendars(){
  if(window.__KPTU_RELOAD_GOOGLE_EVENTS__)await window.__KPTU_RELOAD_GOOGLE_EVENTS__();
  window.dispatchEvent(new CustomEvent('kptu:calendar-changed',{detail:{source:'project-milestone'}}))
}
function rollbackMessage(stage,error,link={}){
  console.error('project milestone rollback failed',{stage,calendarId:link.calendarId||null,eventId:link.eventId||null,error});
  return stage+' 되돌리기에도 실패해 Google Calendar와 Web2가 불일치할 수 있습니다. 일정을 직접 확인해 주세요.'
}
function openModal(id,{trigger=document.activeElement,initialFocus=null}={}){const m=$('#'+id);if(!m)return;const wasHidden=m.classList.contains('hidden');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');if(wasHidden)window.KPTUA11y?.dialog.activate(m,{trigger,initialFocus:initialFocus||MODAL_FOCUS[id]||null,onRequestClose:()=>m.querySelector(`[data-ps3-close="${id}"]`)?.click()})}
function closeModal(id){const m=$('#'+id);if(!m)return;m.classList.add('hidden');m.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate(m,{restoreFocus:true,fallbackFocus:id==='ps3DetailModal'?'#newProjectBtn':null})}
function urlFor(id){const u=new URL(location.href);u.searchParams.set('project',id);return u.pathname+u.search+u.hash}
function clearUrl(){const u=new URL(location.href);u.searchParams.delete('project');history.replaceState({},'',u.pathname+u.search+u.hash)}
async function context(epoch=projectEpoch){
  if(!(await rt.session.ensure()))return false;
  const shared=rt.context?.read?.()||window.__KPTU_BOOT_CONTEXT__;
  let nextUser=shared?.user||null,nextMembership=shared?.membership||null,nextWid=shared?.workspace?.id||nextMembership?.workspace_id||null;
  if(!nextUser?.id||!nextWid){
    nextUser=await api('/auth/v1/user');
    if(epoch!==projectEpoch||!nextUser?.id)return false;
    const ms=await api(`/rest/v1/app_workspace_members?user_id=eq.${nextUser.id}&select=workspace_id,role&limit=1`);
    if(epoch!==projectEpoch)return false;
    nextMembership=ms?.[0]||null;nextWid=nextMembership?.workspace_id||null;
  }
  if(!nextWid)return false;
  const nextProfiles=await api('/rest/v1/app_profiles?select=user_id,display_name');
  if(epoch!==projectEpoch)return false;
  user=nextUser;membership=nextMembership;wid=nextWid;members=[];profiles=nextProfiles||[];
  return true
}
async function loadProjects(epoch=projectEpoch){
  if(!wid||!user?.id)return projects;
  const rows=await catalog.fetchSpaces(wid,user.id);
  if(epoch!==projectEpoch)return projects;
  spaces=rows||[];
  projects=catalog.publish({workspaceId:wid,userId:user.id,spaces}).projects;
  return projects
}
function enabled(d,key){return !d.modules.length||d.modules.some(m=>m.module_key===key)}
function moduleTitle(d,key,fallback){return d.modules.find(m=>m.module_key===key)?.title||fallback}
function empty(t){return `<div class="ps3-empty">${esc(t)}</div>`}
function ensureUi(){if($('#ps3DetailModal'))return;document.body.insertAdjacentHTML('beforeend',`
<div id="ps3DetailModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ps3Title"><div class="modal-card ps3-detail-card"><div class="modal-head ps3-modal-head"><div class="ps3-title-wrap"><div id="ps3Hierarchy" class="ps3-hierarchy"></div><h2 id="ps3Title"></h2><p id="ps3Objective" class="muted ps3-objective"></p></div><div class="ps3-head-actions"><div id="ps3Menu"></div><button class="icon-btn" data-ps3-close="ps3DetailModal" type="button" aria-label="닫기">×</button></div></div><div id="ps3Body"></div></div></div>
<div id="ps3CreateModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ps3CreateHeading"><div class="modal-card small-card"><div class="modal-head"><div><div class="eyebrow">PROJECT</div><h2 id="ps3CreateHeading">프로젝트 만들기</h2></div><button class="icon-btn" data-ps3-close="ps3CreateModal" type="button" aria-label="닫기">×</button></div><label>프로젝트명<input id="ps3CreateName"></label><label>목표·설명<textarea id="ps3CreateObjective" rows="4"></textarea></label><label>상위 프로젝트<select id="ps3CreateParent"></select></label><div class="two-col"><label>시작일<input id="ps3CreateStart" type="date"></label><label>종료일<input id="ps3CreateEnd" type="date"></label></div><button id="ps3CreateSave" class="primary wide">저장</button><div id="ps3CreateStatus" class="status"></div></div></div>
<div id="ps3WorkstreamModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ps3WorkstreamHeading"><div class="modal-card small-card"><div class="modal-head"><div><div class="eyebrow">진행상황</div><h2 id="ps3WorkstreamHeading">진행상황 추가</h2></div><button class="icon-btn" data-ps3-close="ps3WorkstreamModal" aria-label="닫기">×</button></div><label>진행상황 제목<input id="ps3WsTitle" maxlength="160"></label><div class="ps3-modal-actions"><button id="ps3WsDelete" class="ghost ps3-danger hidden">삭제</button><button id="ps3WsSave" class="primary">저장</button></div><div id="ps3WsState" class="status"></div></div></div>
<div id="ps3ProgressModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ps3ProgressHeading"><div class="modal-card small-card"><div class="modal-head"><div><div class="eyebrow">진행 기록</div><h2 id="ps3ProgressHeading">진척상황 기록</h2></div><button class="icon-btn" data-ps3-close="ps3ProgressModal" aria-label="닫기">×</button></div><label>영역<select id="ps3ProgressWs"></select></label><div class="two-col"><label>단계<select id="ps3ProgressPhase">${Object.entries(PHASE).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label>기준일<input id="ps3ProgressDate" type="date"></label></div><label>현재 상황<textarea id="ps3ProgressSummary" rows="4"></textarea></label><label>다음 단계<textarea id="ps3ProgressNext" rows="3"></textarea></label><button id="ps3ProgressSave" class="primary wide">저장</button><div id="ps3ProgressState" class="status"></div></div></div>
<div id="ps3MilestoneModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ps3MilestoneHeading"><div class="modal-card small-card"><div class="modal-head"><div><div class="eyebrow">주요 일정</div><h2 id="ps3MilestoneHeading">주요 일정 추가</h2></div><button class="icon-btn" data-ps3-close="ps3MilestoneModal" aria-label="닫기">×</button></div><label>제목<input id="ps3MilestoneTitle"></label><label>일시<input id="ps3MilestoneAt" type="datetime-local"></label><label>Google 세부캘린더<select id="ps3MilestoneGoogle"></select><small id="ps3MilestoneGoogleHint" class="muted"></small></label><label>메모<textarea id="ps3MilestoneNotes" rows="3"></textarea></label><div class="ps3-modal-actions"><button id="ps3MilestoneDelete" class="ghost ps3-danger hidden">삭제</button><button id="ps3MilestoneSave" class="primary">저장</button></div><div id="ps3MilestoneState" class="status"></div></div></div>
<div id="ps3DeleteModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ps3DeleteHeading"><div class="modal-card small-card"><div class="modal-head"><div><div class="eyebrow">DELETE PROJECT</div><h2 id="ps3DeleteHeading">프로젝트 삭제</h2></div><button class="icon-btn" data-ps3-close="ps3DeleteModal" aria-label="닫기">×</button></div><div id="ps3DeleteMessage" class="notice"></div><p class="muted">연결된 할 일·일정·회의·자료·게시물은 삭제하지 않고 프로젝트 연결만 해제함. 프로젝트 전용 진행기록·주요 일정·의견은 함께 삭제됨.</p><button id="ps3DeleteConfirm" class="primary wide ps3-danger-btn">삭제</button><div id="ps3DeleteState" class="status"></div></div></div>
<div id="ps3ArchiveModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="ps3ArchiveHeading"><div class="modal-card small-card"><div class="modal-head"><div><div class="eyebrow">ARCHIVED PROJECTS</div><h2 id="ps3ArchiveHeading">보관한 프로젝트</h2></div><button class="icon-btn" data-ps3-close="ps3ArchiveModal" aria-label="닫기">×</button></div><p class="muted">삭제하지 않고 목록에서만 숨긴 프로젝트입니다.</p><div id="ps3ArchiveList" class="ps3-archive-list"></div></div></div>`)}
// Project list (Task 17a): one bordered list, two lines per top project; child rows stay in the DOM but collapsed.
const expandedTops=new Set();let listCounts=null;
// Top rows sum their own and child counts; ids is a comma-separated list.
const countText=(c,ids,docs=true)=>{if(!c)return'';const list=String(ids).split(','),sum=m=>list.reduce((n,id)=>n+(m[id]||0),0);return `할 일 ${sum(c.tasks)}${docs?` · 자료 ${sum(c.docs)}`:''}`};
function listRowHtml(p,ch,{open=true,c=listCounts,trail=''}={}){const exp=expandedTops.has(p.id)&&ch.length>0,kidsId=`ps3-kids-${esc(p.id)}`;
  const main=`<span class="ps3-prow-line1"><span class="ps3-prow-name">${esc(p.name)}</span>${p.status==='done'?'<span class="ps3-phase">완료</span>':''}</span><span class="ps3-prow-meta"><span data-ps3-count="${esc([p.id,...ch.map(x=>x.id)].join(','))}">${countText(c,[p.id,...ch.map(x=>x.id)].join(','))}</span></span>`;
  const kid=x=>{const inner=`<span class="ps3-kid-name">${esc(x.name)}</span><small data-ps3-count="${esc(x.id)}" data-ps3-count-docs="0">${countText(c,x.id,false)}</small>`;return open?`<button type="button" class="ps3-kid-row" data-ps3-project="${x.id}">${inner}</button>`:`<div class="ps3-kid-row">${inner}</div>`};
  return `<div class="ps3-prow" data-ps3-row="${esc(p.id)}"><div class="ps3-prow-head">${open?`<button type="button" class="ps3-prow-main" data-ps3-project="${p.id}">${main}</button>`:`<div class="ps3-prow-main">${main}</div>`}${ch.length?`<button type="button" class="ps3-prow-toggle" data-ps3-kids-toggle="${esc(p.id)}" aria-expanded="${exp}" aria-controls="${kidsId}">하위 ${ch.length} <span aria-hidden="true">▾</span></button>`:''}${trail}</div>${ch.length?`<div class="ps3-prow-kids" id="${kidsId}"${exp?'':' hidden'}>${ch.map(kid).join('')}</div>`:''}</div>`}
function toggleKids(btn){const id=btn.dataset.ps3KidsToggle,box=document.getElementById(btn.getAttribute('aria-controls'));if(!box)return;const open=box.hidden;box.hidden=!open;btn.setAttribute('aria-expanded',String(open));if(open)expandedTops.add(id);else expandedTops.delete(id)}
function paintCounts(root,c){root?.querySelectorAll('[data-ps3-count]').forEach(el=>{el.textContent=countText(c,el.dataset.ps3Count,el.dataset.ps3CountDocs!=='0')})}
async function renderGrid(){
  const grid=$('#projectGrid');if(!grid)return;
  const epoch=projectEpoch;
  await loadProjects(epoch);
  if(epoch!==projectEpoch)return;
  const rows=tops(),listed=rows.flatMap(p=>[p,...kids(p)]);
  grid.dataset.ps3Ready='1';
  grid.innerHTML=rows.length?`<div class="ps3-plist">${rows.map(p=>listRowHtml(p,kids(p))).join('')}</div>`:'<div class="empty">프로젝트가 없습니다.</div>';
  const key=JSON.stringify(spaces.map(p=>[p.id,p.name,p.parent_id,p.status,p.updated_at]));
  if(key!==lastSpacesKey){lastSpacesKey=key;window.dispatchEvent(new CustomEvent('kptu:project-spaces-updated',{detail:{workspaceId:wid,userId:user.id,spaces}}))}
  // Counts fill in afterwards; callers (e.g. a status change followed by refreshDetail) must not wait on them.
  if(listed.length)childCounts(listed).then(counts=>{if(epoch!==projectEpoch)return;listCounts=counts;paintCounts(grid,counts)})
}
async function childCounts(ch){if(!ch.length)return null;const ids=`in.(${ch.map(c=>encodeURIComponent(c.id)).join(',')})`;try{const [tasks,docs]=await Promise.all([api(`/rest/v1/app_tasks?project_id=${ids}&assignee_id=eq.${encodeURIComponent(user.id)}&select=project_id,status`),api(`/rest/v1/app_documents?project_id=${ids}&select=project_id`)]);const tally=(rows,keep=()=>true)=>(rows||[]).reduce((m,x)=>{if(keep(x))m[x.project_id]=(m[x.project_id]||0)+1;return m},{});return{tasks:tally(tasks,x=>x.status!=='done'),docs:tally(docs)}}catch(e){console.warn('child project counts',e);return null}}
async function fetchDetail(id){const p=projects.find(x=>x.id===id);if(!p)return null;const enc=encodeURIComponent(id);const [modules,workstreams,progress,milestones,tasks,docs,memos,counts]=await Promise.all([api(`/rest/v1/app_project_modules?project_id=eq.${enc}&select=*&order=sort_order.asc`),api(`/rest/v1/app_project_workstreams?project_id=eq.${enc}&select=*&order=sort_order.asc`),api(`/rest/v1/app_project_progress_updates?project_id=eq.${enc}&select=*&order=effective_on.desc,created_at.desc`),api(`/rest/v1/app_project_milestones?project_id=eq.${enc}&select=*&order=start_at.asc.nullslast,sort_order.asc`),api(`/rest/v1/app_tasks?project_id=eq.${enc}&assignee_id=eq.${encodeURIComponent(user.id)}&select=*&order=due_at.asc.nullslast,created_at.desc`),api(`/rest/v1/app_documents?project_id=eq.${enc}&select=*&order=document_date.desc.nullslast,created_at.desc`),api(`/rest/v1/app_project_comments?project_id=eq.${enc}&select=*&order=created_at.desc`),childCounts(kids(p))]);return{p,childCounts:counts,modules:(modules||[]).filter(x=>x.enabled),workstreams:workstreams||[],progress:progress||[],milestones:milestones||[],tasks:tasks||[],docs:docs||[],memos:memos||[]}}
const wsOptions=(d,blank=true)=>(blank?'<option value="">프로젝트 전체</option>':'')+d.workstreams.map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join('');
function overview(d){const open=d.tasks.filter(x=>x.status!=='done').length,up=d.milestones.filter(x=>!x.start_at||new Date(x.start_at)>=new Date()).sort((a,b)=>new Date(a.start_at||'2999')-new Date(b.start_at||'2999'))[0],last=d.progress[0],m=d.p.metadata||{};return `<section class="ps3-section" id="ps3-overview"><div class="ps3-section-head"><div><h3>${esc(moduleTitle(d,'overview','개요'))}</h3><p>현재 상태를 빠르게 파악합니다.</p></div></div><div class="ps3-stat-grid"><div><b>${d.workstreams.length}</b><span>진행 영역</span></div><div><b>${open}</b><span>미완료 할 일</span></div><div><b>${d.docs.length}</b><span>관련 자료</span></div><div><b>${d.milestones.length}</b><span>주요 일정</span></div></div><div class="ps3-summary"><b>목표</b><p>${esc(m.objective||d.p.description||'목표 미입력')}</p><b>최근 변화</b><p>${esc(last?.summary||'아직 진행 기록이 없습니다.')}</p><b>다음 주요 일정</b><p>${up?`${esc(up.title)}${up.start_at?' · '+date(up.start_at):''}`:'등록된 주요 일정이 없습니다.'}</p></div></section>`}
const count=n=>`<span class="ps3-count">${n}</span>`;
function childrenHtml(d,ch,manageable){if(d.p.parent_id||(!ch.length&&!manageable))return'';const c=d.childCounts;return `<section class="ps3-section" id="ps3-children"><div class="ps3-section-head"><h3>하위 프로젝트 ${count(ch.length)}</h3>${manageable?'<button type="button" class="ps3-text-btn" data-ps3-child>+ 추가</button>':''}</div>${ch.length?`<div class="ps3-child-rows">${ch.map(x=>`<button type="button" class="ps3-child-link" data-ps3-project="${x.id}"><strong>${esc(x.name)}</strong>${c?`<small>할 일 ${c.tasks[x.id]||0} · 자료 ${c.docs[x.id]||0}</small>`:''}<span aria-hidden="true">›</span></button>`).join('')}</div>`:''}</section>`}
function progress(d){const rows=d.workstreams.map(ws=>{const updates=d.progress.filter(x=>x.workstream_id===ws.id),l=updates[0],head=`<span class="ps3-phase">${esc(PHASE[ws.phase]||ws.phase||'진행')}</span><b class="ps3-pg-title">${esc(ws.title)}</b>`;
  if(!l)return `<div class="ps3-pg-item" data-ps3-progress-item="${ws.id}"><div class="ps3-pg-line1">${head}<button type="button" class="ps3-text-btn" data-ps3-edit-ws="${ws.id}" aria-label="진행상황 항목 수정: ${esc(ws.title)}">수정</button></div><form class="ps3-pg-quick" data-ps3-quick-progress="${ws.id}"><input type="text" maxlength="500" placeholder="현재 상황 한 줄 기록" aria-label="${esc(ws.title)} 현재 상황"><button type="submit" class="mini">저장</button></form></div>`;
  return `<details class="ps3-pg-item" data-ps3-progress-item="${ws.id}" data-ps3-panel="progress-${esc(ws.id)}"><summary><span class="ps3-pg-line1">${head}<span class="ps3-pg-count" aria-label="기록 ${updates.length}개">${updates.length}</span></span><span class="ps3-pg-line2"><span class="ps3-pg-summary">${esc(l.summary||'')}</span><time>${esc(day(l.effective_on))}</time></span></summary><div class="ps3-pg-history">${updates.map(u=>`<div class="ps3-pg-record"><time>${esc(day(u.effective_on))}${u.status_label?' · '+esc(u.status_label):''}</time><p>${esc(u.summary||'')}</p>${u.next_step?`<p class="ps3-pg-next">다음: ${esc(u.next_step)}</p>`:''}</div>`).join('')}<div class="ps3-pg-actions"><button type="button" class="mini" data-ps3-progress-ws="${ws.id}">기록 추가</button><button type="button" class="ps3-text-btn" data-ps3-edit-ws="${ws.id}" aria-label="진행상황 항목 수정: ${esc(ws.title)}">항목 수정</button></div></div></details>`});
  return `<section class="ps3-section" id="ps3-progress"><div class="ps3-section-head"><h3>${esc(moduleTitle(d,'progress','진행상황'))}</h3><button type="button" class="ps3-text-btn" data-ps3-add-ws>+ 추가</button></div>${rows.length?`<div class="ps3-pg-list">${rows.join('')}</div>`:''}</section>`}
function fold(id,title,n,body){return `<details class="ps3-section ps3-fold" id="${id}" data-ps3-panel="${id}"><summary><h3>${esc(title)} ${count(n)}</h3></summary><div class="ps3-fold-body">${body}</div></details>`}
function milestones(d){return fold('ps3-milestones',moduleTitle(d,'milestones','주요 일정'),d.milestones.length,`<div class="ps3-fold-actions"><button type="button" class="ps3-text-btn" data-ps3-add-milestone>+ 추가</button></div>${d.milestones.length?`<div class="ps3-list">${d.milestones.map(x=>`<div class="ps3-row"><div class="ps3-row-main"><div class="ps3-row-title"><span class="ps3-phase">${esc(MTYPE[x.milestone_type]||'일정')}</span><b>${esc(x.title)}</b></div>${x.notes?`<p>${esc(x.notes)}</p>`:''}<small>${x.start_at?fmt(x.start_at):'일정 미정'} · ${esc(mstatus(x.status))}</small></div><button type="button" class="mini" data-ps3-edit-milestone="${x.id}">수정</button></div>`).join('')}</div>`:''}`)}
function tasksHtml(d){const open=d.tasks.filter(x=>x.status!=='done');return `<section class="ps3-section" id="ps3-tasks"><div class="ps3-section-head"><h3>${esc(moduleTitle(d,'tasks','할 일'))} ${count(open.length)}</h3></div>${open.length?`<div class="ps3-list">${open.map(x=>`<div class="ps3-row"><div class="ps3-row-main"><b>${esc(x.title)}</b>${x.due_at?`<small>${fmt(x.due_at)}</small>`:''}</div><button class="mini" type="button" data-ps3-task="${x.id}" aria-label="${esc(x.title)} 할 일 관리">관리</button></div>`).join('')}</div>`:''}</section>`}
function docsHtml(d){const rows=d.docs.slice(0,3);return `<section class="ps3-section" id="ps3-documents"><div class="ps3-section-head"><h3>${esc(moduleTitle(d,'documents','자료'))} ${count(d.docs.length)}</h3>${d.docs.length?'<button type="button" class="ps3-text-btn" data-ps3-library>전체 보기</button>':''}</div>${rows.length?`<div class="ps3-list">${rows.map(x=>`<div class="ps3-row ps3-doc-row"><div class="ps3-row-main"><b>${esc(x.title)}</b><small>${esc([x.category||'기타',x.document_date].filter(Boolean).join(' · '))}</small></div><div class="ps3-row-actions">${x.drive_url?`<a class="mini" href="${esc(x.drive_url)}" target="_blank" rel="noopener">열기</a>`:''}<button type="button" class="mini" data-ps3-edit-doc="${x.id}">수정</button></div></div>`).join('')}</div>`:''}</section>`}
function decisions(d){const all=[...d.decisions.map(x=>({kind:'결정',title:x.title,body:x.body,at:x.decided_at})),...d.meetings.map(x=>({kind:'회의',title:x.title,body:x.decisions||x.notes||'',at:x.meeting_at}))].sort((a,b)=>new Date(b.at)-new Date(a.at));return `<section class="ps3-section" id="ps3-decisions"><div class="ps3-section-head"><div><h3>${esc(moduleTitle(d,'decisions','회의·결정'))}</h3><p>회의 결과와 중요한 결정사항을 함께 봅니다.</p></div><button class="mini" data-ps3-global="meeting">+ 회의</button></div><div class="ps3-list">${all.length?all.map(x=>`<div class="ps3-row"><div class="ps3-row-main"><b><span class="ps3-phase">${x.kind}</span> ${esc(x.title)}</b><p>${esc(x.body||'')}</p><small>${fmt(x.at)}</small></div></div>`).join(''):empty('회의·결정 기록이 없습니다.')}</div></section>`}
function memoHtml(d){return fold('ps3-memos','메모',d.memos.length,`<div class="ps3-memo-form"><textarea id="ps3MemoBody" rows="3" placeholder="메모를 입력하세요"></textarea><div class="ps3-memo-actions"><button class="mini hidden" type="button" data-ps3-memo-cancel>취소</button><button class="secondary" type="button" data-ps3-memo-save>메모 추가</button></div><div id="ps3MemoState" class="status"></div></div><div class="ps3-list ps3-memo-list">${d.memos.length?d.memos.map(x=>{const own=x.author_id===user?.id,del=own||canManage(d.p);return `<div class="ps3-row ps3-memo-row"><div class="ps3-row-main"><p>${esc(x.body)}</p><small>${esc(nameOf(x.author_id))} · ${fmt(x.updated_at||x.created_at)}</small></div><div class="ps3-memo-row-actions">${own?`<button class="mini" type="button" data-ps3-edit-memo="${x.id}">수정</button>`:''}${del?`<button class="mini ps3-danger" type="button" data-ps3-delete-memo="${x.id}">삭제</button>`:''}</div></div>`}).join(''):''}</div>`)}
function pagesHtml(d){
  const activePages=d.pages.filter(x=>!x.metadata?.web1_trial_import);
  const bySource=new Map(activePages.filter(x=>x.metadata?.web1_source_id).map(x=>[x.metadata.web1_source_id,x]));
  const children=new Map();
  const roots=[];
  for(const page of activePages){
    const parent=bySource.get(page.metadata?.web1_parent_source_id);
    if(parent&&parent.id!==page.id){
      if(!children.has(parent.id))children.set(parent.id,[]);
      children.get(parent.id).push(page);
    }else roots.push(page);
  }
  const shown=new Set();
  const row=(page,depth=0)=>{
    if(shown.has(page.id))return '';
    shown.add(page.id);
    const child=depth>0;
    return `<div class="ps3-row ps3-page-row${child?' ps3-page-child':''}"><div class="ps3-row-main"><b>${child?'↳ ':''}${esc(page.title)}</b><p>${esc(page.summary||'')}</p><small>${esc(page.status||'')} · ${fmt(page.updated_at)}</small></div><div class="ps3-page-actions"><a class="mini" data-ps3-page-view href="./?view=pages&amp;page=${encodeURIComponent(page.id)}">내부 보기</a></div></div>${(children.get(page.id)||[]).map(x=>row(x,depth+1)).join('')}`;
  };
  const content=roots.map(x=>row(x)).join('')+activePages.filter(x=>!shown.has(x.id)).map(x=>row(x)).join('');
  return `<section class="ps3-section" id="ps3-pages"><div class="ps3-section-head"><div><h3>기존 연결 게시글</h3><p>사업 내용은 프로젝트의 콘텐츠와 하위페이지에서 관리합니다.</p></div></div><div class="ps3-list">${content||empty('연결된 게시물이 없습니다.')}</div></section>`;
}
function collab(d){return `<section class="ps3-section" id="ps3-collaboration"><div class="ps3-section-head"><div><h3>${esc(moduleTitle(d,'collaboration','협업'))}</h3><p>프로젝트 관련 의견과 검토 메모입니다.</p></div></div><div class="ps3-list">${d.comments.length?d.comments.map(x=>`<div class="ps3-row"><div class="ps3-row-main"><b>${esc(nameOf(x.author_id))}</b><p>${esc(x.body)}</p><small>${fmt(x.created_at)}</small></div></div>`).join(''):empty('아직 의견이 없습니다.')}</div><div class="ps3-comment-form"><input id="ps3CommentBody" placeholder="의견·검토 메모"><button class="secondary" data-ps3-comment>등록</button></div></section>`}
const ordered=rows=>[...rows].sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||String(a.created_at||a.id).localeCompare(String(b.created_at||b.id)));
function blockBody(b){const c=b.content||{};if(b.block_type==='text')return `<p>${esc(c.text||'')}</p>`;
  if(b.block_type==='table')return `<div class="ps3-content-table-wrap"><table><thead><tr>${(c.columns||[]).map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${(c.rows||[]).map(row=>`<tr>${row.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  if(b.block_type==='timeline')return `<ul>${(c.items||[]).map(x=>`<li><b>${esc(x.date)}</b> ${esc(x.title)}${x.body?`<span> · ${esc(x.body)}</span>`:''}</li>`).join('')}</ul>`;
  if(b.block_type==='links')return `<ul>${(c.items||[]).map(x=>{let url='';try{const u=new URL(x.url);if(['https:','http:'].includes(u.protocol))url=u.href}catch{}return `<li>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(x.label||url)}</a>`:esc(x.label||'링크')}${x.note?` · ${esc(x.note)}`:''}</li>`}).join('')}</ul>`;
  return `<dl>${(c.items||[]).map(x=>`<div><dt>${esc(x.label)}</dt><dd>${esc(x.value)}${x.note?` <small>${esc(x.note)}</small>`:''}</dd></div>`).join('')}</dl>`}
function contentHtml(d){const edit=canEdit(d.p),sections=ordered(d.sections);return `<section class="ps3-section ps3-content" id="ps3-content"><div class="ps3-section-head"><div><h3>사업 콘텐츠·현황</h3><p>프로젝트의 비공개 원본 내용입니다.</p></div>${edit?'<button class="mini" data-ps3-add-section>+ 섹션</button>':''}</div>${sections.map((s,si)=>{const blocks=ordered(d.blocks.filter(x=>x.section_id===s.id));return `<div class="ps3-content-section" data-ps3-section="${esc(s.id)}"><div class="ps3-content-heading"><h4>${esc(s.title)}</h4>${edit?`<div class="ps3-content-actions"><button class="mini" data-ps3-edit-section="${esc(s.id)}">이름 수정</button><button class="mini" data-ps3-section-up="${esc(s.id)}" ${si?'':'disabled'} aria-label="${esc(s.title)} 섹션 위로">↑</button><button class="mini" data-ps3-section-down="${esc(s.id)}" ${si<sections.length-1?'':'disabled'} aria-label="${esc(s.title)} 섹션 아래로">↓</button><button class="mini" data-ps3-add-block="${esc(s.id)}">+ 내용</button></div>`:''}</div>${blocks.map((b,bi)=>`<article class="ps3-content-block" data-ps3-block="${esc(b.id)}"><div class="ps3-content-heading"><div><small>${esc(CONTENT_TYPES[b.block_type]||'내용')} · 비공개</small><h5>${esc(b.title||'제목 없음')}</h5></div>${edit?`<div class="ps3-content-actions"><button class="mini" data-ps3-edit-block="${esc(b.id)}">수정</button><button class="mini" data-ps3-block-up="${esc(b.id)}" ${bi?'':'disabled'} aria-label="${esc(b.title)} 위로">↑</button><button class="mini" data-ps3-block-down="${esc(b.id)}" ${bi<blocks.length-1?'':'disabled'} aria-label="${esc(b.title)} 아래로">↓</button></div>`:''}</div><div class="ps3-content-body">${blockBody(b)}</div></article>`).join('')||empty('내용이 없습니다.')}</div>`}).join('')||empty('섹션이 없습니다.')}</section>`}
function blockFields(b){const c=b.content||{};if(b.block_type==='text')return `<label>내용<textarea data-ps3-block-text rows="7">${esc(c.text||'')}</textarea></label>`;
  if(b.block_type==='table')return `<div class="ps3-content-fields"><b>열 이름</b>${(c.columns||[]).map((v,j)=>`<label>열 ${j+1}<input data-ps3-cell="column" data-index="${j}" value="${esc(v)}"></label>`).join('')}<b>행</b>${(c.rows||[]).map((r,i)=>`<div class="ps3-content-field-row">${r.map((v,j)=>`<label>${esc(c.columns?.[j]||`열 ${j+1}`)}<input data-ps3-cell="row" data-index="${i}" data-column="${j}" value="${esc(v)}"></label>`).join('')}</div>`).join('')}<button type="button" class="mini" data-ps3-add-item>+ 행</button></div>`;
  const fields=b.block_type==='timeline'?['date','title','body']:b.block_type==='links'?['label','url','note']:['label','value','note'];return `<div class="ps3-content-fields">${(c.items||[]).map((item,i)=>`<div class="ps3-content-field-row">${fields.map(key=>`<label>${esc({date:'날짜',title:'제목',body:'설명',label:'항목',url:'URL',value:'내용',note:'비고'}[key])}<input data-ps3-item="${key}" data-index="${i}" value="${esc(item[key]||'')}"></label>`).join('')}</div>`).join('')}<button type="button" class="mini" data-ps3-add-item>+ 항목</button></div>`}
function editBlock(id){if(!canEdit(current))return;const b=detail.blocks.find(x=>x.id===id),node=$(`[data-ps3-block="${id}"]`);if(!b||!node)return;node.querySelector('.ps3-content-body').innerHTML=`<form class="ps3-content-editor" data-ps3-editing="${esc(id)}"><label>제목<input data-ps3-block-title value="${esc(b.title||'')}"></label>${blockFields(b)}<div class="ps3-content-actions"><button type="submit" class="primary mini" data-ps3-save-block>저장</button><button type="button" class="mini" data-ps3-cancel-block>취소</button><span class="ps3-save-state" data-ps3-block-state role="status"></span></div></form>`;node.querySelector('[data-ps3-block-title]')?.focus()}
function readBlockContent(b,form){const content=structuredClone(form._draftContent||b.content||{});if(b.block_type==='text'){content.text=form.querySelector('[data-ps3-block-text]').value;return content}if(b.block_type==='table'){content.columns=[...(content.columns||[])];content.rows=(content.rows||[]).map(row=>[...row]);form.querySelectorAll('[data-ps3-cell]').forEach(input=>{if(input.dataset.ps3Cell==='column')content.columns[Number(input.dataset.index)]=input.value;else content.rows[Number(input.dataset.index)][Number(input.dataset.column)]=input.value});return content}content.items=(content.items||[]).map(x=>({...x}));form.querySelectorAll('[data-ps3-item]').forEach(input=>{content.items[Number(input.dataset.index)][input.dataset.ps3Item]=input.value});return content}
async function saveBlock(form){
  if(!canEdit(current))return;
  const id=form.dataset.ps3Editing,b=detail.blocks.find(x=>x.id===id),state=form.querySelector('[data-ps3-block-state]'),button=form.querySelector('[data-ps3-save-block]');
  if(!b)return;
  state.textContent='저장 중…';button.disabled=true;
  try{
    const body={title:form.querySelector('[data-ps3-block-title]').value.trim()||null,content:readBlockContent(b,form),updated_at:new Date().toISOString()};
    await api(`/rest/v1/app_project_blocks?id=eq.${encodeURIComponent(id)}&project_id=eq.${encodeURIComponent(current.id)}`,{method:'PATCH',body});
    state.textContent='저장 완료';form.dataset.dirty='false';
    Object.assign(b,body);
    const node=form.closest('[data-ps3-block]');
    if(node){node.querySelector('h5').textContent=b.title||'제목 없음';node.querySelector('.ps3-content-body').innerHTML=blockBody(b)}
    await refreshDetail({preserveOpenEditors:true});
  }catch(e){if(form.isConnected){state.textContent=`저장 실패: ${e.message||e}`;button.disabled=false}else toast('저장 후 화면 갱신에 실패했습니다.')}
}
async function moveContent(kind,id,direction){if(!canEdit(current))return;const projectId=current.id,section=kind==='section',rows=ordered(section?detail.sections:detail.blocks.filter(x=>x.section_id===detail.blocks.find(y=>y.id===id)?.section_id)),index=rows.findIndex(x=>x.id===id),other=rows[index+direction];if(index<0||!other)return;const path=section?'app_project_sections':'app_project_blocks',a=rows[index];try{await api(`/rest/v1/${path}?id=eq.${encodeURIComponent(a.id)}&project_id=eq.${encodeURIComponent(projectId)}`,{method:'PATCH',body:{sort_order:other.sort_order}});await api(`/rest/v1/${path}?id=eq.${encodeURIComponent(other.id)}&project_id=eq.${encodeURIComponent(projectId)}`,{method:'PATCH',body:{sort_order:a.sort_order}});if(current?.id===projectId)await refreshDetail()}catch(e){toast('순서 저장 실패: 다시 확인해 주세요.');if(current?.id===projectId)await refreshDetail()}}
function addSection(){if(!canEdit(current))return;const head=$('#ps3-content .ps3-section-head');if(!head)return;head.insertAdjacentHTML('afterend','<form class="ps3-content-editor ps3-new-form" data-ps3-new-section><label>섹션 이름<input required maxlength="160"></label><div class="ps3-content-actions"><button class="primary mini" type="submit">섹션 저장</button><button class="mini" type="button" data-ps3-cancel-new>취소</button><span data-ps3-form-state role="status"></span></div></form>');head.nextElementSibling.querySelector('input')?.focus()}
async function saveNewSection(form){if(!canEdit(current))return;const title=form.querySelector('input').value.trim(),state=form.querySelector('[data-ps3-form-state]');if(!title){state.textContent='이름을 입력해 주세요.';return}state.textContent='저장 중…';try{await api('/rest/v1/app_project_sections',{method:'POST',body:{project_id:current.id,title,sort_order:Math.max(0,...detail.sections.map(x=>Number(x.sort_order)||0))+10,created_by:user.id,collapsed_default:false}});form.dataset.dirty='false';await refreshDetail()}catch(e){state.textContent=`저장 실패: ${e.message||e}`}}
async function renameSection(id){if(!canEdit(current))return;const s=detail.sections.find(x=>x.id===id);if(!s)return;const title=prompt('섹션 이름',s.title);if(!title?.trim()||title.trim()===s.title)return;try{await api(`/rest/v1/app_project_sections?id=eq.${encodeURIComponent(id)}&project_id=eq.${encodeURIComponent(current.id)}`,{method:'PATCH',body:{title:title.trim()}});await refreshDetail()}catch(e){toast('섹션 이름을 저장하지 못했습니다.')}}
const newBlockContent=type=>type==='text'?{text:''}:type==='table'?{columns:['항목','내용'],rows:[['','']]}:{items:[type==='timeline'?{date:'',title:'',body:''}:type==='links'?{label:'',url:'',note:''}:{label:'',value:'',note:''}]};
function addBlock(sectionId){if(!canEdit(current)||!detail.sections.some(x=>x.id===sectionId))return;const section=$(`[data-ps3-section="${sectionId}"]`),form=document.createElement('form');form.className='ps3-content-editor ps3-new-form';form.dataset.ps3NewBlock=sectionId;form._newBlock={block_type:'text',content:newBlockContent('text')};form.innerHTML=newBlockForm(form._newBlock);section.querySelector('.ps3-content-heading').insertAdjacentElement('afterend',form);form.querySelector('[data-ps3-block-title]')?.focus()}
function newBlockForm(b,title=''){return `<label>내용 종류<select data-ps3-new-type>${Object.entries(CONTENT_TYPES).map(([key,label])=>`<option value="${key}" ${b.block_type===key?'selected':''}>${label}</option>`).join('')}</select></label><label>제목<input data-ps3-block-title required maxlength="160" value="${esc(title)}"></label>${blockFields(b)}<div class="ps3-content-actions"><button type="submit" class="primary mini">내용 저장</button><button type="button" class="mini" data-ps3-cancel-new>취소</button><span data-ps3-form-state role="status"></span></div>`}
async function saveNewBlock(form){if(!canEdit(current))return;const b=form._newBlock,title=form.querySelector('[data-ps3-block-title]').value.trim(),state=form.querySelector('[data-ps3-form-state]');if(!title){state.textContent='제목을 입력해 주세요.';return}const content=readBlockContent(b,form);if(b.block_type==='text'&&!content.text.trim()){state.textContent='내용을 입력해 주세요.';return}state.textContent='저장 중…';try{await api('/rest/v1/app_project_blocks',{method:'POST',body:{project_id:current.id,section_id:form.dataset.ps3NewBlock,block_type:b.block_type,title,content,sort_order:Math.max(0,...detail.blocks.filter(x=>x.section_id===form.dataset.ps3NewBlock).map(x=>Number(x.sort_order)||0))+10,created_by:user.id}});form.dataset.dirty='false';await refreshDetail()}catch(e){state.textContent=`저장 실패: ${e.message||e}`}}
function addBlockItem(form){const id=form.dataset.ps3Editing,b=form._newBlock||detail.blocks.find(x=>x.id===id);if(!b)return;const content=readBlockContent(b,form);if(b.block_type==='table')content.rows.push(content.columns.map(() => ''));else content.items.push(b.block_type==='timeline'?{date:'',title:'',body:''}:b.block_type==='links'?{label:'',url:'',note:''}:{label:'',value:'',note:''});const draft={...b,content},title=form.querySelector('[data-ps3-block-title]').value;form._draftContent=content;form.dataset.dirty='true';if(form._newBlock){form._newBlock=draft;form.innerHTML=newBlockForm(draft,title)}else form.innerHTML=`<label>제목<input data-ps3-block-title value="${esc(title)}"></label>${blockFields(draft)}<div class="ps3-content-actions"><button type="submit" class="primary mini" data-ps3-save-block>저장</button><button type="button" class="mini" data-ps3-cancel-block>취소</button><span class="ps3-save-state" data-ps3-block-state role="status"></span></div>`;form.querySelector('[data-ps3-add-item]')?.scrollIntoView({block:'nearest'})}
function moreMenu(p){return `<details class="ps3-more"><summary class="icon-btn" aria-label="프로젝트 관리 메뉴">⋯</summary><div class="ps3-more-panel" role="group" aria-label="프로젝트 관리"><button type="button" data-ps3-toggle-done>${p.status==='done'?'완료 취소':'완료'}</button><button type="button" data-ps3-edit-project>수정</button><button type="button" data-ps3-archive-project>보관</button><button type="button" class="ps3-danger" data-ps3-delete-project>삭제</button></div></details>`}
function renderDetail(d){const p=d.p,m=p.metadata||{},par=parent(p),ch=par?[]:kids(p),manageable=canManage(p),body=$('#ps3Body'),objective=m.objective||p.description||'';const keep=body.dataset.project===p.id?[...body.querySelectorAll('details[data-ps3-panel][open]')].map(x=>x.dataset.ps3Panel):[];$('#ps3Hierarchy').innerHTML=par?`<button class="ps3-parent-link" data-ps3-project="${par.id}">← ${esc(par.name)}</button>`:'';$('#ps3Title').textContent=p.name;$('#ps3Objective').textContent=objective;$('#ps3Objective').title=objective;$('#ps3Menu').innerHTML=manageable?moreMenu(p):'';const parts=['<div class="ps3-quick"><button type="button" class="primary" data-ps3-global="task">할 일 추가</button><button type="button" class="secondary" data-ps3-global="document">자료 올리기</button></div>',childrenHtml(d,ch,manageable)];if(enabled(d,'progress'))parts.push(progress(d));if(enabled(d,'tasks'))parts.push(tasksHtml(d));if(enabled(d,'documents'))parts.push(docsHtml(d));if(enabled(d,'milestones'))parts.push(milestones(d));parts.push(memoHtml(d));body.innerHTML=parts.join('');body.dataset.project=p.id;keep.forEach(k=>body.querySelector(`details[data-ps3-panel="${CSS.escape(k)}"]`)?.setAttribute('open',''))}
const unsavedContent=()=>!!$('#ps3Body [data-dirty="true"]:is([data-ps3-editing],[data-ps3-new-section],[data-ps3-new-block],[data-ps3-quick-progress])');
const confirmDiscard=()=>!unsavedContent()||confirm('저장하지 않은 프로젝트 내용이 있습니다. 이동하면서 버릴까요?');
async function openProject(id,push=true){if(current?.id!==id&&!confirmDiscard())return;const epoch=++detailEpoch;await loadProjects();if(epoch!==detailEpoch)return;const p=projects.find(x=>x.id===id&&x.status!=='archived');if(!p)return;current=p;const result=await fetchDetail(id);if(epoch!==detailEpoch)return;detail=result;if(!detail)return;renderDetail(detail);openModal('ps3DetailModal');if(push)history.pushState({project:id},'',urlFor(id));else history.replaceState({project:id},'',urlFor(id))}
async function refreshDetail({preserveOpenEditors=false}={}){const editorOpen=()=>preserveOpenEditors&&!!$('#ps3Body [data-ps3-editing]');if(!current||unsavedContent()||editorOpen())return;const epoch=++detailEpoch,id=current.id;await loadProjects();if(epoch!==detailEpoch||unsavedContent()||editorOpen())return;current=projects.find(x=>x.id===id)||current;const result=await fetchDetail(id);if(epoch!==detailEpoch||unsavedContent()||editorOpen())return;detail=result;renderDetail(detail)}
function closeDetail(){if(!confirmDiscard())return;detailEpoch++;closeModal('ps3DetailModal');delete $('#ps3Body').dataset.project;current=null;detail=null;clearUrl()}
function projectParentOptions(selected='',exclude=''){return '<option value="">상위 프로젝트 없음</option>'+tops().filter(p=>p.id!==exclude).map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join('')}
function openCreate(parentId=''){editingProject=null;$('#ps3CreateHeading').textContent=parentId?'하위 프로젝트 만들기':'프로젝트 만들기';$('#ps3CreateSave').textContent='저장';$('#ps3CreateName').value='';$('#ps3CreateObjective').value='';$('#ps3CreateParent').innerHTML=projectParentOptions(parentId);$('#ps3CreateParent').value=parentId||'';$('#ps3CreateStart').value=new Date().toISOString().slice(0,10);$('#ps3CreateEnd').value='';$('#ps3CreateStatus').textContent='';openModal('ps3CreateModal',{initialFocus:'#ps3CreateName'})}
function openEdit(){if(!current)return;editingProject=current;const m=current.metadata||{};$('#ps3CreateHeading').textContent='프로젝트 수정';$('#ps3CreateSave').textContent='변경사항 저장';$('#ps3CreateName').value=current.name||'';$('#ps3CreateObjective').value=m.objective||current.description||'';$('#ps3CreateParent').innerHTML=projectParentOptions(current.parent_id||'',current.id);$('#ps3CreateParent').value=current.parent_id||'';$('#ps3CreateStart').value=m.start_on||'';$('#ps3CreateEnd').value=m.end_on||'';$('#ps3CreateStatus').textContent='';openModal('ps3CreateModal',{initialFocus:'#ps3CreateName'})}
async function saveProject(){const name=$('#ps3CreateName').value.trim(),st=$('#ps3CreateStatus');if(!name){st.textContent='프로젝트명을 입력해 주세요.';return}try{st.textContent='저장 중…';const parent_id=$('#ps3CreateParent').value||null,objective=$('#ps3CreateObjective').value.trim()||null,meta={...(editingProject?.metadata||{}),project_system:'v2',management_version:2,objective,start_on:$('#ps3CreateStart').value||null,end_on:$('#ps3CreateEnd').value||null};if(editingProject){await api(`/rest/v1/app_spaces?id=eq.${editingProject.id}`,{method:'PATCH',body:{parent_id,name,description:objective,metadata:meta,updated_at:new Date().toISOString()}});closeModal('ps3CreateModal');await renderGrid();await openProject(editingProject.id,false);toast('프로젝트 정보를 수정했습니다.');editingProject=null;return}const max=Math.max(0,...spaces.map(x=>Number(x.sort_order)||0));meta.created_from='project_system_v3';const rows=await api('/rest/v1/app_spaces',{method:'POST',body:{workspace_id:wid,parent_id,slug:'project-'+Date.now().toString(36),name,description:objective,sort_order:max+10,created_by:user.id,owner_id:user.id,status:'active',visibility:'private',metadata:meta},prefer:'return=representation'}),p=rows?.[0];if(p)await api('/rest/v1/app_project_modules',{method:'POST',body:MODULES.map(([module_key,title],i)=>({project_id:p.id,module_key,title,enabled:true,sort_order:(i+1)*10,config:{},created_by:user.id}))});closeModal('ps3CreateModal');await renderGrid();toast('프로젝트를 만들었습니다.');if(p)await openProject(p.id)}catch(e){st.textContent=e.message||String(e);st.className='status error'}}
function openWs(id=''){editingWs=id?detail.workstreams.find(x=>x.id===id):null;$('#ps3WorkstreamHeading').textContent=editingWs?'진행상황 수정':'진행상황 추가';$('#ps3WsTitle').value=editingWs?.title||'';$('#ps3WsDelete').classList.toggle('hidden',!editingWs);$('#ps3WsState').textContent='';openModal('ps3WorkstreamModal')}
async function saveWs(){const title=$('#ps3WsTitle').value.trim(),st=$('#ps3WsState');if(!title){st.textContent='진행상황 제목을 입력해 주세요.';return}try{if(editingWs)await api(`/rest/v1/app_project_workstreams?id=eq.${editingWs.id}`,{method:'PATCH',body:{title}});else await api('/rest/v1/app_project_workstreams',{method:'POST',body:{project_id:current.id,title,description:null,phase:'in_progress',sort_order:(detail.workstreams.length+1)*10,created_by:user.id}});closeModal('ps3WorkstreamModal');await refreshDetail()}catch(e){st.textContent=e.message||String(e)}}
async function delWs(){if(!editingWs||!confirm(`“${editingWs.title}” 진행상황을 삭제할까요?`))return;await api(`/rest/v1/app_project_workstreams?id=eq.${editingWs.id}`,{method:'DELETE'});closeModal('ps3WorkstreamModal');await refreshDetail()}
function openProgress(id=''){if(!detail.workstreams.length){toast('먼저 진행상황을 추가하세요.');return}$('#ps3ProgressWs').innerHTML=wsOptions(detail,false);$('#ps3ProgressWs').value=id||detail.workstreams[0].id;const ws=detail.workstreams.find(x=>x.id===$('#ps3ProgressWs').value);$('#ps3ProgressPhase').value=ws?.phase||'in_progress';$('#ps3ProgressDate').value=new Date().toISOString().slice(0,10);$('#ps3ProgressSummary').value='';$('#ps3ProgressNext').value='';$('#ps3ProgressState').textContent='';openModal('ps3ProgressModal')}
async function insertProgress({workstreamId,summary,nextStep=null,phase=null,effectiveOn}){const ws=detail.workstreams.find(x=>x.id===workstreamId),label=phase||ws?.phase||'in_progress';await api('/rest/v1/app_project_progress_updates',{method:'POST',body:{project_id:current.id,workstream_id:workstreamId,author_id:user.id,status_label:PHASE[label]||label,summary,next_step:nextStep,effective_on:effectiveOn,metadata:{}}});if(phase)await api(`/rest/v1/app_project_workstreams?id=eq.${workstreamId}`,{method:'PATCH',body:{phase}})}
async function saveProgress(){const id=$('#ps3ProgressWs').value,sum=$('#ps3ProgressSummary').value.trim(),phase=$('#ps3ProgressPhase').value,st=$('#ps3ProgressState');if(!id||!sum){st.textContent='영역과 현재 상황을 입력해 주세요.';return}try{await insertProgress({workstreamId:id,summary:sum,nextStep:$('#ps3ProgressNext').value.trim()||null,phase,effectiveOn:$('#ps3ProgressDate').value});closeModal('ps3ProgressModal');await refreshDetail()}catch(e){st.textContent=e.message||String(e)}}
async function saveQuickProgress(form){if(!current||form.dataset.saving==='1')return;const input=form.querySelector('input'),button=form.querySelector('button'),summary=input.value.trim();if(!summary){input.focus();return}form.dataset.saving='1';button.disabled=true;try{await insertProgress({workstreamId:form.dataset.ps3QuickProgress,summary,effectiveOn:new Date().toISOString().slice(0,10)});form.dataset.dirty='false';await refreshDetail();toast('진행상황을 기록했습니다.')}catch(e){form.dataset.saving='0';button.disabled=false;toast('저장 실패: '+(e.message||e))}}
function openMilestone(id=''){
  editingMilestone=id?detail.milestones.find(x=>x.id===id):null;
  $('#ps3MilestoneHeading').textContent=editingMilestone?'주요 일정 수정':'주요 일정 추가';
  $('#ps3MilestoneTitle').value=editingMilestone?.title||'';
  $('#ps3MilestoneAt').value=localInput(editingMilestone?.start_at);
  $('#ps3MilestoneNotes').value=editingMilestone?.notes||'';
  $('#ps3MilestoneDelete').classList.toggle('hidden',!editingMilestone);
  $('#ps3MilestoneState').textContent='';
  openModal('ps3MilestoneModal');
  prepareMilestoneGoogle(editingMilestone).catch(e=>{$('#ps3MilestoneGoogleHint').textContent=e.message||String(e)})
}
async function restoreMilestoneSnapshot(snapshot,googleEventId=snapshot?.google_event_id){
  const payload=milestoneRestorePayload(snapshot,googleEventId);
  return api('/rest/v1/app_project_milestones?on_conflict=id',{method:'POST',body:payload,prefer:'resolution=merge-duplicates,return=representation'})
}
async function saveExistingMilestone(visible){
  const previousVisible={title:editingMilestone.title,start_at:editingMilestone.start_at||null,end_at:editingMilestone.end_at||null,notes:editingMilestone.notes||null};
  const nextFull=milestoneFullBody(visible,editingMilestone),previousFull=milestoneFullBody(previousVisible,editingMilestone);
  if(editingMilestone.event_id&&!visible.start_at)throw new Error('연결된 일정은 일시를 비울 수 없습니다.');
  if(milestoneGoogleLinked(editingMilestone)){
    const calendarId=editingMilestone.google_calendar_id,eventId=editingMilestone.google_event_id;
    await updateGoogleMilestone(calendarId,eventId,nextFull);
    try{
      await api('/rest/v1/app_project_milestones?id=eq.'+encodeURIComponent(editingMilestone.id),{method:'PATCH',body:visible});
      if(editingMilestone.event_id)await syncLinkedMilestoneEvent(editingMilestone.event_id,nextFull)
    }catch(localError){
      const rollbackErrors=[];
      try{await api('/rest/v1/app_project_milestones?id=eq.'+encodeURIComponent(editingMilestone.id),{method:'PATCH',body:previousVisible})}catch(e){rollbackErrors.push(['Web2 주요 일정',e])}
      if(editingMilestone.event_id)try{await syncLinkedMilestoneEvent(editingMilestone.event_id,previousFull)}catch(e){rollbackErrors.push(['Web2 연결 일정',e])}
      try{await updateGoogleMilestone(calendarId,eventId,previousFull)}catch(e){rollbackErrors.push(['Google Calendar',e])}
      if(rollbackErrors.length)throw new Error(rollbackErrors.map(([stage,e])=>rollbackMessage(stage,e,{calendarId,eventId})).join(' '));
      throw new Error('Web2 저장에 실패해 Google Calendar 변경을 되돌렸습니다: '+(localError.message||localError))
    }
    return
  }
  try{
    await api('/rest/v1/app_project_milestones?id=eq.'+encodeURIComponent(editingMilestone.id),{method:'PATCH',body:visible});
    if(editingMilestone.event_id)await syncLinkedMilestoneEvent(editingMilestone.event_id,nextFull)
  }catch(localError){
    try{await api('/rest/v1/app_project_milestones?id=eq.'+encodeURIComponent(editingMilestone.id),{method:'PATCH',body:previousVisible})}catch(e){console.error('legacy milestone rollback failed',{milestoneId:editingMilestone.id,error:e})}
    if(editingMilestone.event_id)try{await syncLinkedMilestoneEvent(editingMilestone.event_id,previousFull)}catch(e){console.error('legacy milestone event rollback failed',{eventId:editingMilestone.event_id,error:e})}
    throw localError
  }
}
async function saveNewMilestone(visible){
  const calendarId=$('#ps3MilestoneGoogle').value||'';
  if(!calendarId)throw new Error('Google Calendar 연결과 쓰기 가능한 세부캘린더 선택이 필요합니다.');
  if(!visible.start_at)throw new Error('일시를 입력해 주세요.');
  const body=milestoneFullBody(visible),googleEvent=await createGoogleMilestone(calendarId,body);
  const localEventId=crypto.randomUUID(),milestoneId=crypto.randomUUID();
  try{
    await createLinkedMilestoneEvent(body,localEventId);
    const rows=await api('/rest/v1/app_project_milestones',{method:'POST',body:{id:milestoneId,project_id:current.id,...body,event_id:localEventId,child_project_id:null,sort_order:(detail.milestones.length+1)*10,created_by:user.id,google_calendar_id:calendarId,google_event_id:googleEvent.id},prefer:'return=representation'});
    if(!rows?.[0]?.id)throw new Error('Web2 주요 일정 저장 결과를 확인하지 못했습니다.')
  }catch(localError){
    const rollbackErrors=[];
    try{await api('/rest/v1/app_project_milestones?id=eq.'+encodeURIComponent(milestoneId),{method:'DELETE'})}catch(e){rollbackErrors.push(['Web2 주요 일정',e])}
    try{await deleteLinkedMilestoneEvent(localEventId)}catch(e){rollbackErrors.push(['Web2 연결 일정',e])}
    try{await deleteGoogleMilestone(calendarId,googleEvent.id)}catch(e){rollbackErrors.push(['Google Calendar',e])}
    if(rollbackErrors.length)throw new Error((localError.message||localError)+' '+rollbackErrors.map(([stage,e])=>rollbackMessage(stage,e,{calendarId,eventId:googleEvent.id})).join(' '));
    throw new Error('Web2 저장에 실패해 생성한 Google Calendar 일정을 되돌렸습니다: '+(localError.message||localError))
  }
}
async function saveMilestone(){
  const st=$('#ps3MilestoneState'),button=$('#ps3MilestoneSave'),visible=milestoneVisibleBody();
  if(!visible.title){st.textContent='제목을 입력해 주세요.';return}
  button.disabled=true;st.textContent='저장 중…';
  try{
    if(editingMilestone)await saveExistingMilestone(visible);else await saveNewMilestone(visible);
    closeModal('ps3MilestoneModal');
    await refreshDetail();
    if(milestoneGoogleLinked(editingMilestone)||!editingMilestone)await reloadMilestoneCalendars();
    toast(editingMilestone?'주요 일정을 수정했습니다.':'주요 일정을 추가했습니다.')
  }catch(e){st.textContent=e.message||String(e)}
  finally{if(document.body.contains(button))button.disabled=!editingMilestone&&!$('#ps3MilestoneGoogle')?.value}
}
async function delMilestone(){
  if(!editingMilestone||!confirm('“'+editingMilestone.title+'” 주요 일정을 삭제할까요?'))return;
  const snapshot={...editingMilestone},eventId=snapshot.event_id||null,linked=milestoneGoogleLinked(snapshot),calendarId=snapshot.google_calendar_id,googleEventId=snapshot.google_event_id;
  const st=$('#ps3MilestoneState'),button=$('#ps3MilestoneDelete');button.disabled=true;st.textContent='삭제 중…';
  if(linked){
    const body=milestoneFullBody({title:snapshot.title,start_at:snapshot.start_at||null,end_at:snapshot.end_at||null,notes:snapshot.notes||null},snapshot);
    try{
      await deleteGoogleMilestone(calendarId,googleEventId);
      try{
        await api('/rest/v1/app_project_milestones?id=eq.'+encodeURIComponent(snapshot.id),{method:'DELETE'});
        if(eventId)await deleteLinkedMilestoneEvent(eventId)
      }catch(localError){
        let restored=null;
        try{restored=await createGoogleMilestone(calendarId,body)}catch(e){throw new Error((localError.message||localError)+' '+rollbackMessage('Google Calendar',e,{calendarId,eventId:googleEventId}))}
        try{await restoreMilestoneSnapshot(snapshot,restored.id)}catch(e){throw new Error((localError.message||localError)+' '+rollbackMessage('Web2 주요 일정',e,{calendarId,eventId:restored.id}))}
        throw new Error('Web2 삭제에 실패해 Google Calendar 일정을 복원했습니다: '+(localError.message||localError))
      }
    }catch(e){st.textContent=e.message||String(e);button.disabled=false;return}
  }else{
    try{
      await api('/rest/v1/app_project_milestones?id=eq.'+encodeURIComponent(snapshot.id),{method:'DELETE'});
      if(eventId)try{await deleteLinkedMilestoneEvent(eventId)}catch(localError){try{await restoreMilestoneSnapshot(snapshot)}catch(e){console.error('legacy milestone restore failed',{milestoneId:snapshot.id,error:e})}throw localError}
    }catch(e){st.textContent=e.message||String(e);button.disabled=false;return}
  }
  closeModal('ps3MilestoneModal');await refreshDetail();if(linked)await reloadMilestoneCalendars();toast('주요 일정을 삭제했습니다.')
}
async function ensureFeature(view){const loader=window.KPTUViewLoader;if(loader?.isLoaded?.(view))return true;if(loader?.load){try{await loader.load(view);return true}catch(e){console.error('project feature load failed',view,e);return false}}return false}
async function openProjectTask(id){if(!window.KPTUTaskLayout?.openTask&&!(await ensureFeature('tasks')))return toast('할 일 기능을 불러오지 못했습니다.');return window.KPTUTaskLayout?.openTask?.(id)}
async function openGlobal(kind){if(!current)return;if(kind==='task'){if(!window.KPTUTaskLayout?.openCreate&&!(await ensureFeature('tasks')))return toast('할 일 기능을 불러오지 못했습니다.');window.KPTUTaskLayout?.openCreate?.(current.id);return}const target={document:['library','newDocumentBtn','docProject'],meeting:['meetings','newMeetingBtn','meetingProject'],page:['pages','newPageBtn','pageSpace']}[kind];if(!target)return;const [view,buttonId,selectId]=target;if(!(await ensureFeature(view)))return toast('기능을 불러오지 못했습니다.');const project={id:current.id,name:current.name};$('#'+buttonId)?.click();queueMicrotask(()=>{const s=$('#'+selectId);if(!s)return;if(![...s.options].some(o=>o.value===project.id))s.add(new Option(project.name,project.id));s.value=project.id;if(kind==='document')s.dispatchEvent(new Event('change',{bubbles:true}))})}
function goLibrary(){closeModal('ps3DetailModal');const s=$('#documentProject');if(s&&[...s.options].some(o=>o.value===current.id)){s.value=current.id;s.dispatchEvent(new Event('change',{bubbles:true}))}window.KPTURouter?.go?.('library')}
function resetMemoEditor(){editingMemo=null;const i=$('#ps3MemoBody'),save=$('[data-ps3-memo-save]'),cancel=$('[data-ps3-memo-cancel]'),st=$('#ps3MemoState');if(i)i.value='';if(save)save.textContent='메모 추가';cancel?.classList.add('hidden');if(st){st.textContent='';st.className='status'}}
function editMemo(id){const memo=detail?.memos?.find(x=>x.id===id&&x.author_id===user?.id);if(!memo)return;editingMemo=memo;$('#ps3MemoBody').value=memo.body||'';$('[data-ps3-memo-save]').textContent='수정 저장';$('[data-ps3-memo-cancel]').classList.remove('hidden');$('#ps3MemoBody').focus()}
async function saveMemo(){if(!current)return;const i=$('#ps3MemoBody'),body=i?.value.trim(),st=$('#ps3MemoState');if(!body){if(st){st.textContent='메모를 입력해 주세요.';st.className='status error'}return}try{if(st){st.textContent='저장 중…';st.className='status'};if(editingMemo)await api(`/rest/v1/app_project_comments?id=eq.${editingMemo.id}&author_id=eq.${user.id}`,{method:'PATCH',body:{body,updated_at:new Date().toISOString()}});else await api('/rest/v1/app_project_comments',{method:'POST',body:{project_id:current.id,author_id:user.id,body}});editingMemo=null;await refreshDetail();toast('메모를 저장했습니다.')}catch(e){if(st){st.textContent=e.message||String(e);st.className='status error'}}}
async function deleteMemo(id){const memo=detail?.memos?.find(x=>x.id===id);if(!memo||!(memo.author_id===user?.id||canManage(current)))return;if(!confirm('이 메모를 삭제할까요?'))return;try{await api(`/rest/v1/app_project_comments?id=eq.${id}`,{method:'DELETE'});if(editingMemo?.id===id)editingMemo=null;await refreshDetail();toast('메모를 삭제했습니다.')}catch(e){toast(e.message||String(e))}}
function openDelete(){const ch=kids(current);$('#ps3DeleteMessage').innerHTML=`<b>${esc(current.name)}</b><br>${current.parent_id?'하위 프로젝트':'프로젝트'}를 삭제합니다.${ch.length?` 하위 프로젝트 <b>${ch.length}개</b>도 함께 삭제됩니다.`:''}`;$('#ps3DeleteState').textContent='';openModal('ps3DeleteModal')}
async function unlink(id){await Promise.all([api(`/rest/v1/app_tasks?project_id=eq.${id}`,{method:'PATCH',body:{project_id:null}}),api(`/rest/v1/app_events?project_id=eq.${id}`,{method:'PATCH',body:{project_id:null}}),api(`/rest/v1/app_meetings?project_id=eq.${id}`,{method:'PATCH',body:{project_id:null}}),api(`/rest/v1/app_documents?project_id=eq.${id}`,{method:'PATCH',body:{project_id:null}}),api(`/rest/v1/app_pages?space_id=eq.${id}`,{method:'PATCH',body:{space_id:null}})])}
async function deleteProject(){const st=$('#ps3DeleteState');st.textContent='삭제 중…';try{for(const id of [...kids(current).map(x=>x.id),current.id])await unlink(id);await api(`/rest/v1/app_spaces?id=eq.${current.id}`,{method:'DELETE'});closeModal('ps3DeleteModal');closeModal('ps3DetailModal');current=detail=null;clearUrl();await renderGrid();toast('프로젝트를 삭제했습니다.')}catch(e){st.textContent=e.message||String(e);st.className='status error'}}
async function archiveProject(){if(!current)return;const ch=kids(current);const note=ch.length?`\n하위 프로젝트 ${ch.length}개는 함께 숨겨지고 상위 프로젝트를 복구하면 다시 표시됩니다.`:'';if(!confirm(`“${current.name}” 프로젝트를 보관할까요?${note}`))return;await api(`/rest/v1/app_spaces?id=eq.${current.id}`,{method:'PATCH',body:{status:'archived',updated_at:new Date().toISOString()}});closeModal('ps3DetailModal');clearUrl();current=detail=null;await renderGrid();toast('프로젝트를 보관했습니다.')}
async function toggleProjectDone(){if(!current||!canManage(current))return;const next=current.status==='done'?'active':'done';try{await api(`/rest/v1/app_spaces?id=eq.${encodeURIComponent(current.id)}`,{method:'PATCH',body:{status:next,updated_at:new Date().toISOString()}});await renderGrid();await refreshDetail();toast(next==='done'?'프로젝트를 완료했습니다.':'프로젝트를 다시 진행합니다.')}catch(e){console.error('project status update failed',e);toast('프로젝트 상태를 변경하지 못했습니다.')}}
async function renderArchiveList(){const box=$('#ps3ArchiveList'),rows=archived();if(!box)return;if(!rows.length){box.innerHTML=empty('보관한 프로젝트가 없습니다.');return}const under=p=>projects.filter(x=>x.parent_id===p.id);box.innerHTML=`<div class="ps3-plist">${rows.map(p=>listRowHtml(p,under(p),{open:false,c:null,trail:`<button type="button" class="mini ps3-prow-restore" data-ps3-restore="${p.id}">복구</button>`})).join('')}</div>`;const counts=await childCounts(rows.flatMap(p=>[p,...under(p)]));if(box.isConnected)paintCounts(box,counts)}
function openArchive(){renderArchiveList();openModal('ps3ArchiveModal')}
async function restoreArchive(id){await api(`/rest/v1/app_spaces?id=eq.${id}`,{method:'PATCH',body:{status:'active',updated_at:new Date().toISOString()}});await loadProjects();renderArchiveList();await renderGrid();toast('프로젝트를 복구했습니다.')}
function bind(){document.addEventListener('submit',e=>{const quick=e.target.closest?.('[data-ps3-quick-progress]');if(quick){e.preventDefault();saveQuickProgress(quick);return}const form=e.target.closest?.('[data-ps3-editing]');if(form){e.preventDefault();saveBlock(form)}},true);document.addEventListener('click',e=>{document.querySelectorAll('.ps3-more[open]').forEach(menu=>{if(!menu.contains(e.target)||e.target.closest('.ps3-more-panel button'))menu.open=false});const kt=e.target.closest?.('[data-ps3-kids-toggle]');if(kt){e.preventDefault();toggleKids(kt);return}const p=e.target.closest?.('[data-ps3-project]');if(p){e.preventDefault();e.stopPropagation();openProject(p.dataset.ps3Project);return}const c=e.target.closest?.('[data-ps3-close]');if(c){c.dataset.ps3Close==='ps3DetailModal'?closeDetail():closeModal(c.dataset.ps3Close);return}if(e.target.closest('[data-ps3-child]'))return openCreate(current.id);if(e.target.closest('[data-ps3-edit-project]'))return openEdit();if(e.target.closest('[data-ps3-archive-project]'))return archiveProject();if(e.target.closest('[data-ps3-toggle-done]'))return toggleProjectDone();const task=e.target.closest?.('[data-ps3-task]');if(task)return openProjectTask(task.dataset.ps3Task);const rr=e.target.closest?.('[data-ps3-restore]');if(rr)return restoreArchive(rr.dataset.ps3Restore);if(e.target.closest('[data-ps3-add-ws]'))return openWs();const ew=e.target.closest?.('[data-ps3-edit-ws]');if(ew)return openWs(ew.dataset.ps3EditWs);if(e.target.closest('[data-ps3-add-progress]'))return openProgress();const pw=e.target.closest?.('[data-ps3-progress-ws]');if(pw)return openProgress(pw.dataset.ps3ProgressWs);if(e.target.closest('[data-ps3-add-milestone]'))return openMilestone();const em=e.target.closest?.('[data-ps3-edit-milestone]');if(em)return openMilestone(em.dataset.ps3EditMilestone);const ed=e.target.closest?.('[data-ps3-edit-doc]');if(ed){window.dispatchEvent(new CustomEvent('kptu:edit-document',{detail:{id:ed.dataset.ps3EditDoc}}));return}const ememo=e.target.closest?.('[data-ps3-edit-memo]');if(ememo)return editMemo(ememo.dataset.ps3EditMemo);const dmemo=e.target.closest?.('[data-ps3-delete-memo]');if(dmemo)return deleteMemo(dmemo.dataset.ps3DeleteMemo);if(e.target.closest('[data-ps3-memo-save]'))return saveMemo();if(e.target.closest('[data-ps3-memo-cancel]'))return resetMemoEditor();if(e.target.closest('[data-ps3-library]'))return goLibrary();if(e.target.closest('[data-ps3-delete-project]'))return openDelete();const g=e.target.closest?.('[data-ps3-global]');if(g)return openGlobal(g.dataset.ps3Global)},true);$('#ps3CreateSave').onclick=saveProject;$('#ps3WsSave').onclick=saveWs;$('#ps3WsDelete').onclick=delWs;$('#ps3ProgressSave').onclick=saveProgress;$('#ps3MilestoneSave').onclick=saveMilestone;$('#ps3MilestoneDelete').onclick=delMilestone;$('#ps3DeleteConfirm').onclick=deleteProject;document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;const menu=$('.ps3-more[open]');if(!menu)return;e.preventDefault();e.stopImmediatePropagation();menu.open=false;menu.querySelector('summary')?.focus()},true);window.addEventListener('kptu:tasks-changed',()=>{if(current)refreshDetail().catch(console.error)});window.addEventListener('popstate',()=>{const id=new URLSearchParams(location.search).get('project');id?openProject(id,false):closeModal('ps3DetailModal')})}
function bindContentCompose(){document.addEventListener('submit',e=>{const form=e.target.closest?.('[data-ps3-new-section],[data-ps3-new-block]');if(!form)return;e.preventDefault();e.stopImmediatePropagation();if(form.dataset.ps3NewSection!==undefined)saveNewSection(form);else saveNewBlock(form)},true);document.addEventListener('change',e=>{const form=e.target.closest?.('[data-ps3-new-block]');if(!form||!e.target.matches('[data-ps3-new-type]'))return;const title=form.querySelector('[data-ps3-block-title]').value,type=e.target.value;form._newBlock={block_type:type,content:newBlockContent(type)};form._draftContent=null;form.innerHTML=newBlockForm(form._newBlock,title);form.dataset.dirty='true'},true);document.addEventListener('click',e=>{const cancel=e.target.closest?.('[data-ps3-cancel-new]');if(cancel){e.stopImmediatePropagation();cancel.closest('form')?.remove();return}const add=e.target.closest?.('[data-ps3-new-block] [data-ps3-add-item]');if(add){e.stopImmediatePropagation();addBlockItem(add.closest('form'))}},true);document.addEventListener('input',e=>{const form=e.target.closest?.('[data-ps3-new-section],[data-ps3-new-block],[data-ps3-quick-progress]');if(form)form.dataset.dirty=form.matches('[data-ps3-quick-progress]')&&!e.target.value.trim()?'false':'true'},true)}
function installProjectToolbar(){const head=$('#projectsView .section-head');if(!head)return;let actions=head.querySelector('.ps3-project-toolbar');if(!actions){actions=document.createElement('div');actions.className='ps3-project-toolbar';const existing=$('#newProjectBtn');if(existing){existing.insertAdjacentElement('beforebegin',actions);actions.appendChild(existing)}else head.appendChild(actions)}let archiveBtn=$('#ps3ArchiveBtn');if(!archiveBtn){archiveBtn=document.createElement('button');archiveBtn.id='ps3ArchiveBtn';archiveBtn.type='button';archiveBtn.className='secondary ps3-toolbar-btn';archiveBtn.textContent='보관함';actions.prepend(archiveBtn)}archiveBtn.onclick=openArchive}
function resetProjectSession(){
  projectEpoch+=1;detailEpoch+=1;
  user=null;membership=null;wid=null;members=[];profiles=[];spaces=[];projects=[];
  current=null;detail=null;editingProject=null;editingMilestone=null;editingWs=null;editingMemo=null;googleCalendarState=null;
  lastSpacesKey='';expandedTops.clear();listCounts=null;
  document.querySelectorAll('#ps3DetailModal,#ps3CreateModal,#ps3WorkstreamModal,#ps3ProgressModal,#ps3MilestoneModal,#ps3DeleteModal,#ps3ArchiveModal').forEach(m=>{m.classList.add('hidden');m.setAttribute('aria-hidden','true')});
  const grid=$('#projectGrid');if(grid){grid.dataset.ps3Ready='0';grid.innerHTML=''}
  clearUrl()
}
async function handleProjectSessionChange(){
  resetProjectSession();
  const epoch=projectEpoch;
  if(await context(epoch)&&epoch===projectEpoch)await renderGrid()
}
async function boot(){ensureUi();bind();window.addEventListener('kptu:session-changed',handleProjectSessionChange);if(!(await context(projectEpoch)))return false;await loadProjects();installProjectToolbar();const b=$('#newProjectBtn');if(b){b.textContent='+ 프로젝트';b.classList.add('ps3-toolbar-btn');b.onclick=e=>{e.preventDefault();e.stopImmediatePropagation();openCreate()}}await renderGrid();if(window.KPTURouter?.on)window.KPTURouter.on('projects',renderGrid);const id=new URLSearchParams(location.search).get('project');if(id&&projects.some(x=>x.id===id&&x.status!=='archived'))await openProject(id,false);document.documentElement.classList.add('kptu-project-v3-ready');return true}
window.__KPTU_PROJECT_V3_READY__=boot().catch(err=>{console.error(err);return false});
})();
