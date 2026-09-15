(()=>{
'use strict';
const rt=window.KPTURuntime;
if(!rt) return;

const TYPE_LABEL={ongoing:'상시사업·산업관리',campaign:'쟁점·캠페인',event:'행사·집중사업',knowledge:'자료·지식',blank:'일반 프로젝트'};
const PHASES={preparation:'준비',in_progress:'진행',consultation:'협의',execution:'실행',follow_up:'후속조치',done:'종료'};
const MILESTONE_TYPES={action:'행동·사업',meeting:'협의·회의',policy:'정책·국회',deadline:'마감',result:'성과·결과'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=v=>v?new Date(v).toLocaleDateString('ko-KR',{year:'numeric',month:'numeric',day:'numeric'}):'';
const fmtDateTime=v=>v?new Date(v).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const toLocalInput=v=>{if(!v)return'';const d=new Date(v);const off=d.getTimezoneOffset();return new Date(d.getTime()-off*60000).toISOString().slice(0,16)};
const api=(p,o={})=>rt.api(p,o);
const qs=s=>document.querySelector(s);

let user=null,workspaceId=null,membership=null,spaces=[],projects=[],current=null,detail=null;
let members=[],profiles=[],editingMilestone=null,docFilter='all',docQuery='',editingWs=null;

function isProject(p){return p?.metadata?.project_system==='v2'||Number(p?.metadata?.management_version)===2}
function activeProjects(){return projects.filter(p=>p.status!=='archived')}
function topProjects(){return activeProjects().filter(p=>!p.parent_id)}
function nameOf(id){return profiles.find(p=>p.user_id===id)?.display_name||members.find(m=>m.user_id===id)?.email||id?.slice(0,8)||'팀원'}
function toast(msg){const t=qs('#toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.add('hidden'),2400)}
function openModal(id){const m=qs('#'+id);if(!m)return;m.classList.remove('hidden');m.setAttribute('aria-hidden','false')}
function closeModal(id){const m=qs('#'+id);if(!m)return;m.classList.add('hidden');m.setAttribute('aria-hidden','true')}
function projectType(p){return TYPE_LABEL[p?.metadata?.project_type]||TYPE_LABEL.blank}
function canManage(p){return p?.owner_id===user?.id||membership?.role==='owner'||membership?.role==='admin'}
function parentOf(p){return p?.parent_id?projects.find(x=>x.id===p.parent_id):null}
function childrenOf(p){return activeProjects().filter(x=>x.parent_id===p.id)}
function projectUrl(id){const u=new URL(location.href);u.searchParams.set('project',id);return u.pathname+u.search+u.hash}
function clearProjectUrl(){const u=new URL(location.href);u.searchParams.delete('project');history.replaceState({},'',u.pathname+u.search+u.hash)}

async function context(){
  if(!(await rt.session.ensure())) return false;
  user=await api('/auth/v1/user');
  const ms=await api(`/rest/v1/app_workspace_members?user_id=eq.${encodeURIComponent(user.id)}&select=workspace_id,role&limit=1`);
  membership=ms?.[0]||null;
  workspaceId=membership?.workspace_id||null;
  if(!workspaceId)return false;
  [members,profiles]=await Promise.all([
    api(`/rest/v1/app_workspace_members?workspace_id=eq.${workspaceId}&select=workspace_id,user_id,role,email,created_at`),
    api('/rest/v1/app_profiles?select=user_id,display_name')
  ]);
  return true;
}
async function loadProjects(){
  spaces=await api(`/rest/v1/app_spaces?workspace_id=eq.${workspaceId}&select=*&order=sort_order.asc,created_at.asc`);
  projects=spaces.filter(isProject);
  return projects;
}

function ensureUi(){
  if(qs('#ps3DetailModal'))return;
  document.body.insertAdjacentHTML('beforeend',`
  <div id="ps3DetailModal" class="modal hidden" aria-hidden="true">
    <div class="modal-card ps3-detail-card">
      <div class="modal-head ps3-modal-head">
        <div class="ps3-title-wrap">
          <div id="ps3Hierarchy" class="ps3-hierarchy"></div>
          <div id="ps3Kicker" class="eyebrow"></div>
          <h2 id="ps3Title"></h2>
          <p id="ps3Objective" class="muted"></p>
        </div>
        <button class="icon-btn" data-ps3-close="ps3DetailModal" type="button">×</button>
      </div>
      <div id="ps3Body"></div>
    </div>
  </div>

  <div id="ps3CreateModal" class="modal hidden" aria-hidden="true">
    <div class="modal-card small-card">
      <div class="modal-head"><div><div class="eyebrow">PROJECT</div><h2 id="ps3CreateHeading">프로젝트 만들기</h2></div><button class="icon-btn" data-ps3-close="ps3CreateModal" type="button">×</button></div>
      <label>프로젝트명<input id="ps3CreateName" type="text" maxlength="120"></label>
      <label>목표·설명<textarea id="ps3CreateObjective" rows="4"></textarea></label>
      <div class="two-col">
        <label>유형<select id="ps3CreateType"><option value="ongoing">상시사업·산업관리</option><option value="campaign">쟁점·캠페인</option><option value="event">행사·집중사업</option><option value="knowledge">자료·지식</option><option value="blank">일반 프로젝트</option></select></label>
        <label>상위 프로젝트<select id="ps3CreateParent"><option value="">없음</option></select></label>
      </div>
      <div class="two-col"><label>시작일<input id="ps3CreateStart" type="date"></label><label>종료일<input id="ps3CreateEnd" type="date"></label></div>
      <label>공개범위<select id="ps3CreateVisibility"><option value="public">전체 공개</option><option value="team">팀 전체</option><option value="restricted">지정 참여자</option><option value="private">비공개</option></select></label>
      <button id="ps3CreateSave" class="primary wide" type="button">저장</button>
      <div id="ps3CreateStatus" class="status"></div>
    </div>
  </div>

  <div id="ps3MilestoneModal" class="modal hidden" aria-hidden="true">
    <div class="modal-card small-card">
      <div class="modal-head"><div><div class="eyebrow">주요 일정</div><h2 id="ps3MilestoneHeading">주요 일정 추가</h2></div><button class="icon-btn" data-ps3-close="ps3MilestoneModal" type="button">×</button></div>
      <label>제목<input id="ps3MilestoneTitle" type="text"></label>
      <div class="two-col"><label>유형<select id="ps3MilestoneType">${Object.entries(MILESTONE_TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label>상태<select id="ps3MilestoneStatusValue"><option value="planned">예정</option><option value="in_progress">진행</option><option value="done">완료</option><option value="cancelled">취소</option></select></label></div>
      <label>일시<input id="ps3MilestoneAt" type="datetime-local"></label>
      <label>연결 영역<select id="ps3MilestoneWs"><option value="">프로젝트 전체</option></select></label>
      <label>메모<textarea id="ps3MilestoneNotes" rows="3"></textarea></label>
      <div class="ps3-modal-actions"><button id="ps3MilestoneDelete" class="ghost ps3-danger hidden" type="button">삭제</button><button id="ps3MilestoneSave" class="primary" type="button">저장</button></div>
      <div id="ps3MilestoneState" class="status"></div>
    </div>
  </div>

  <div id="ps3ProgressModal" class="modal hidden" aria-hidden="true">
    <div class="modal-card small-card">
      <div class="modal-head"><div><div class="eyebrow">진행 기록</div><h2>진척상황 기록</h2></div><button class="icon-btn" data-ps3-close="ps3ProgressModal" type="button">×</button></div>
      <label>영역<select id="ps3ProgressWs"></select></label>
      <div class="two-col"><label>단계<select id="ps3ProgressPhase">${Object.entries(PHASES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><label>기준일<input id="ps3ProgressDate" type="date"></label></div>
      <label>현재 상황<textarea id="ps3ProgressSummary" rows="4"></textarea></label>
      <label>다음 단계<textarea id="ps3ProgressNext" rows="3"></textarea></label>
      <button id="ps3ProgressSave" class="primary wide" type="button">저장</button><div id="ps3ProgressState" class="status"></div>
    </div>
  </div>

  <div id="ps3WorkstreamModal" class="modal hidden" aria-hidden="true">
    <div class="modal-card small-card">
      <div class="modal-head"><div><div class="eyebrow">진행 영역</div><h2 id="ps3WorkstreamHeading">진행 영역 추가</h2></div><button class="icon-btn" data-ps3-close="ps3WorkstreamModal" type="button">×</button></div>
      <label>영역명<input id="ps3WsTitle" type="text"></label>
      <label>설명<textarea id="ps3WsDesc" rows="3"></textarea></label>
      <label>단계<select id="ps3WsPhase">${Object.entries(PHASES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
      <div class="ps3-modal-actions"><button id="ps3WsDelete" class="ghost ps3-danger hidden" type="button">삭제</button><button id="ps3WsSave" class="primary" type="button">저장</button></div>
      <div id="ps3WsState" class="status"></div>
    </div>
  </div>

  <div id="ps3DeleteModal" class="modal hidden" aria-hidden="true">
    <div class="modal-card small-card">
      <div class="modal-head"><div><div class="eyebrow">DELETE PROJECT</div><h2>프로젝트 삭제</h2></div><button class="icon-btn" data-ps3-close="ps3DeleteModal" type="button">×</button></div>
      <div id="ps3DeleteMessage" class="notice"></div>
      <p class="muted">연결된 할 일·일정·회의·자료·게시물은 삭제하지 않고 프로젝트 연결만 해제합니다. 프로젝트 전용 진행기록·주요 일정·의견 등은 함께 삭제됩니다.</p>
      <button id="ps3DeleteConfirm" class="primary wide ps3-danger-btn" type="button">삭제</button><div id="ps3DeleteState" class="status"></div>
    </div>
  </div>

  <div id="ps3AccessModal" class="modal hidden" aria-hidden="true">
    <div class="modal-card small-card">
      <div class="modal-head"><div><div class="eyebrow">PROJECT ACCESS</div><h2>공개·참여자</h2></div><button class="icon-btn" data-ps3-close="ps3AccessModal" type="button">×</button></div>
      <label>공개범위<select id="ps3AccessVisibility"><option value="public">전체 공개</option><option value="team">팀 전체</option><option value="restricted">지정 참여자</option><option value="private">비공개</option></select></label>
      <div class="permission-box"><b>참여자 권한</b><div id="ps3AccessPeople"></div></div>
      <button id="ps3AccessSave" class="primary wide" type="button">저장</button><div id="ps3AccessState" class="status"></div>
    </div>
  </div>`);
}

async function renderGrid(){
  const grid=qs('#projectGrid');if(!grid)return;
  await loadProjects();
  const tops=topProjects();
  grid.dataset.ps3Ready='1';
  grid.innerHTML=tops.length?tops.map(p=>{
    const kids=childrenOf(p),meta=p.metadata||{};
    return `<article class="ps3-project-card ps3-main-card" data-ps3-project="${p.id}" tabindex="0" role="button">
      <div class="ps3-card-top"><span class="ps3-kind main">상위 프로젝트</span><span class="ps3-type">${esc(projectType(p))}</span></div>
      <h3>${esc(p.name)}</h3><p>${esc(meta.objective||p.description||'')}</p>
      <div class="ps3-card-meta"><span>${meta.start_on?esc(meta.start_on):'시작일 미정'}</span><span>하위 ${kids.length}</span></div>
      ${kids.length?`<div class="ps3-child-list">${kids.map(c=>`<button type="button" class="ps3-child-row" data-ps3-project="${c.id}"><span>↳</span><b>${esc(c.name)}</b><small>하위 프로젝트</small></button>`).join('')}</div>`:''}
    </article>`;
  }).join(''):'<div class="empty">프로젝트가 없습니다.</div>';
}

async function fetchDetail(id){
  const p=projects.find(x=>x.id===id)||(await api(`/rest/v1/app_spaces?id=eq.${encodeURIComponent(id)}&select=*&limit=1`))?.[0];
  if(!p)return null;
  const enc=encodeURIComponent(id);
  const [modules,workstreams,progress,milestones,tasks,docs,meetings,decisions,pages,comments,spaceMembers]=await Promise.all([
    api(`/rest/v1/app_project_modules?project_id=eq.${enc}&select=*&order=sort_order.asc`),
    api(`/rest/v1/app_project_workstreams?project_id=eq.${enc}&select=*&order=sort_order.asc`),
    api(`/rest/v1/app_project_progress_updates?project_id=eq.${enc}&select=*&order=effective_on.desc,created_at.desc`),
    api(`/rest/v1/app_project_milestones?project_id=eq.${enc}&select=*&order=start_at.asc.nullslast,sort_order.asc`),
    api(`/rest/v1/app_tasks?project_id=eq.${enc}&select=*&order=due_at.asc.nullslast,created_at.desc`),
    api(`/rest/v1/app_documents?project_id=eq.${enc}&select=*&order=document_date.desc.nullslast,created_at.desc`),
    api(`/rest/v1/app_meetings?project_id=eq.${enc}&select=*&order=meeting_at.desc`),
    api(`/rest/v1/app_project_decisions?project_id=eq.${enc}&select=*&order=decided_at.desc`),
    api(`/rest/v1/app_pages?space_id=eq.${enc}&select=id,space_id,title,slug,summary,status,visibility,updated_at&order=updated_at.desc`),
    api(`/rest/v1/app_project_comments?project_id=eq.${enc}&select=*&order=created_at.asc`),
    api(`/rest/v1/app_space_members?project_id=eq.${enc}&select=user_id,role`)
  ]);
  return {p,modules:(modules||[]).filter(x=>x.enabled),workstreams:workstreams||[],progress:progress||[],milestones:milestones||[],tasks:tasks||[],docs:docs||[],meetings:meetings||[],decisions:decisions||[],pages:pages||[],comments:comments||[],spaceMembers:spaceMembers||[]};
}

function wsOptions(d,blank=true){return (blank?'<option value="">프로젝트 전체</option>':'')+d.workstreams.map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join('')}
function latestFor(ws,d){return d.progress.find(x=>x.workstream_id===ws.id)}
function enabled(d,key){return !d.modules.length||d.modules.some(m=>m.module_key===key)}
function titleFor(d,key,fallback){return d.modules.find(m=>m.module_key===key)?.title||fallback}
function empty(text){return `<div class="ps3-empty">${esc(text)}</div>`}

function overviewHtml(d){
  const open=d.tasks.filter(x=>x.status!=='done').length;
  const upcoming=d.milestones.filter(x=>!x.start_at||new Date(x.start_at)>=new Date()).sort((a,b)=>new Date(a.start_at||'2999')-new Date(b.start_at||'2999'))[0];
  const last=d.progress[0],meta=d.p.metadata||{};
  return `<section class="ps3-section" id="ps3-overview"><div class="ps3-section-head"><div><h3>${esc(titleFor(d,'overview','개요'))}</h3><p>현재 상태를 빠르게 파악합니다.</p></div></div>
  <div class="ps3-stat-grid"><div><b>${d.workstreams.length}</b><span>진행 영역</span></div><div><b>${open}</b><span>미완료 할 일</span></div><div><b>${d.docs.length}</b><span>관련 자료</span></div><div><b>${d.milestones.length}</b><span>주요 일정</span></div></div>
  <div class="ps3-summary"><b>목표</b><p>${esc(meta.objective||d.p.description||'목표 미입력')}</p><b>최근 변화</b><p>${esc(last?.summary||'아직 진행 기록이 없습니다.')}</p><b>다음 주요 일정</b><p>${upcoming?`${esc(upcoming.title)}${upcoming.start_at?' · '+fmtDate(upcoming.start_at):''}`:'등록된 주요 일정이 없습니다.'}</p></div></section>`;
}

function progressHtml(d){
  return `<section class="ps3-section" id="ps3-progress"><div class="ps3-section-head"><div><h3>${esc(titleFor(d,'progress','진행상황'))}</h3><p>업데이트를 시간순으로 누적합니다.</p></div><div class="ps3-actions"><button class="mini" data-ps3-add-ws type="button">+ 영역</button><button class="mini" data-ps3-add-progress type="button">+ 진행 기록</button></div></div>
  <div class="ps3-ws-grid">${d.workstreams.length?d.workstreams.map(ws=>{const latest=latestFor(ws,d);return `<article class="ps3-ws"><div class="ps3-ws-top"><div><span class="ps3-phase">${esc(PHASES[ws.phase]||ws.phase||'진행')}</span><h4>${esc(ws.title)}</h4></div><button class="mini" data-ps3-edit-ws="${ws.id}" type="button">수정</button></div>${ws.description?`<p>${esc(ws.description)}</p>`:''}${latest?`<div class="ps3-latest"><b>${esc(latest.status_label||'진행')}</b><p>${esc(latest.summary||'')}</p>${latest.next_step?`<small>다음 · ${esc(latest.next_step)}</small>`:''}<small>${esc(latest.effective_on||'')}</small></div>`:empty('진행 기록이 없습니다.')}<button class="mini ps3-update-btn" data-ps3-progress-ws="${ws.id}" type="button">업데이트</button></article>`}).join(''):empty('진행 영역이 없습니다.')}</div></section>`;
}

function milestonesHtml(d){
  return `<section class="ps3-section" id="ps3-milestones"><div class="ps3-section-head"><div><h3>${esc(titleFor(d,'milestones','주요 일정'))}</h3><p>기자회견·집회·정부협의·토론회·마감 등을 관리합니다.</p></div><button class="mini" data-ps3-add-milestone type="button">+ 주요 일정</button></div>
  <div class="ps3-list">${d.milestones.length?d.milestones.map(x=>`<div class="ps3-row"><div class="ps3-row-main"><div class="ps3-row-title"><span class="ps3-phase">${esc(MILESTONE_TYPES[x.milestone_type]||x.milestone_type||'일정')}</span><b>${esc(x.title)}</b></div>${x.notes?`<p>${esc(x.notes)}</p>`:''}<small>${x.start_at?fmtDateTime(x.start_at):'일정 미정'} · ${esc(x.status||'planned')}</small></div><button class="mini" data-ps3-edit-milestone="${x.id}" type="button">수정</button></div>`).join(''):empty('주요 일정이 없습니다.')}</div></section>`;
}

function tasksHtml(d){
  return `<section class="ps3-section" id="ps3-tasks"><div class="ps3-section-head"><div><h3>${esc(titleFor(d,'tasks','할 일'))}</h3><p>전체 할 일과 같은 데이터를 사용합니다.</p></div><button class="mini" data-ps3-global="task" type="button">+ 할 일</button></div><div class="ps3-list">${d.tasks.length?d.tasks.map(x=>`<div class="ps3-row"><div class="ps3-row-main"><b>${esc(x.title)}</b><p>${esc(x.note||x.description||'')}</p><small>${x.due_at?fmtDateTime(x.due_at)+' · ':''}${esc(x.status||'')}</small></div></div>`).join(''):empty('연결된 할 일이 없습니다.')}</div></section>`;
}

function docCategories(d){return ['all',...new Set(d.docs.map(x=>(x.category||'기타').trim()).filter(Boolean))]}
function filteredDocs(d){const q=docQuery.trim().toLowerCase();return d.docs.filter(x=>(docFilter==='all'||(x.category||'기타')===docFilter)&&(!q||[x.title,x.category,x.source,(x.tags||[]).join(' '),x.description].join(' ').toLowerCase().includes(q)))}
function docsHtml(d){
  const cats=docCategories(d),rows=filteredDocs(d);
  return `<section class="ps3-section" id="ps3-documents"><div class="ps3-section-head"><div><h3>${esc(titleFor(d,'documents','자료'))}</h3><p>자료실의 같은 자료를 프로젝트 관점에서 찾습니다.</p></div><div class="ps3-actions"><button class="mini" data-ps3-library type="button">자료실에서 전체 보기</button><button class="mini" data-ps3-global="document" type="button">+ 자료</button></div></div>
  <div class="ps3-doc-tools"><input id="ps3DocSearch" type="search" placeholder="제목·출처·태그 검색" value="${esc(docQuery)}"><div class="ps3-doc-chips">${cats.map(c=>`<button class="${c===docFilter?'active':''}" type="button" data-ps3-doc-filter="${esc(c)}">${c==='all'?'전체 '+d.docs.length:esc(c)+' '+d.docs.filter(x=>(x.category||'기타')===c).length}</button>`).join('')}</div></div>
  <div class="ps3-doc-grid">${rows.length?rows.map(x=>`<article class="ps3-doc-card"><div class="ps3-doc-meta"><span>${esc(x.category||'기타')}</span>${x.document_date?`<time>${esc(x.document_date)}</time>`:''}</div><h4>${esc(x.title)}</h4><p>${esc(x.source||'출처 미기재')}</p>${Array.isArray(x.tags)&&x.tags.length?`<div class="ps3-tags">${x.tags.slice(0,3).map(t=>`<span>${esc(t)}</span>`).join('')}</div>`:''}${x.description?`<small>${esc(x.description)}</small>`:''}<div class="ps3-doc-actions">${x.drive_url?`<a class="mini" href="${esc(x.drive_url)}" target="_blank" rel="noopener">열기</a>`:''}<button class="mini" type="button" data-ps3-edit-doc="${x.id}">정보 수정</button></div></article>`).join(''):empty('조건에 맞는 자료가 없습니다.')}</div></section>`;
}

function decisionsHtml(d){
  const all=[...d.decisions.map(x=>({kind:'결정',title:x.title,body:x.body,at:x.decided_at})),...d.meetings.map(x=>({kind:'회의',title:x.title,body:x.decisions||x.notes||'',at:x.meeting_at}))].sort((a,b)=>new Date(b.at)-new Date(a.at));
  return `<section class="ps3-section" id="ps3-decisions"><div class="ps3-section-head"><div><h3>${esc(titleFor(d,'decisions','회의·결정'))}</h3><p>회의 결과와 중요한 결정사항을 함께 봅니다.</p></div><button class="mini" data-ps3-global="meeting" type="button">+ 회의</button></div><div class="ps3-list">${all.length?all.map(x=>`<div class="ps3-row"><div class="ps3-row-main"><b><span class="ps3-phase">${x.kind}</span> ${esc(x.title)}</b><p>${esc(x.body||'')}</p><small>${fmtDateTime(x.at)}</small></div></div>`).join(''):empty('회의·결정 기록이 없습니다.')}</div></section>`;
}
function pagesHtml(d){
  return `<section class="ps3-section" id="ps3-pages"><div class="ps3-section-head"><div><h3>${esc(titleFor(d,'pages','게시'))}</h3><p>프로젝트에 연결된 공유 페이지입니다.</p></div><button class="mini" data-ps3-global="page" type="button">+ 게시</button></div><div class="ps3-list">${d.pages.length?d.pages.map(x=>`<div class="ps3-row"><div class="ps3-row-main"><b>${esc(x.title)}</b><p>${esc(x.summary||'')}</p><small>${esc(x.status||'')} · ${fmtDateTime(x.updated_at)}</small></div>${x.status==='published'&&['public','unlisted'].includes(x.visibility)?`<a class="mini" href="../p/?slug=${encodeURIComponent(x.slug)}" target="_blank">열기</a>`:''}</div>`).join(''):empty('연결된 게시물이 없습니다.')}</div></section>`;
}
function collaborationHtml(d){
  return `<section class="ps3-section" id="ps3-collaboration"><div class="ps3-section-head"><div><h3>${esc(titleFor(d,'collaboration','협업'))}</h3><p>프로젝트 관련 의견과 검토 메모입니다.</p></div></div><div class="ps3-list">${d.comments.length?d.comments.map(x=>`<div class="ps3-row"><div class="ps3-row-main"><b>${esc(nameOf(x.author_id))}</b><p>${esc(x.body)}</p><small>${fmtDateTime(x.created_at)}</small></div></div>`).join(''):empty('아직 의견이 없습니다.')}</div><div class="ps3-comment-form"><input id="ps3CommentBody" type="text" placeholder="의견·검토 메모"><button class="secondary" data-ps3-comment type="button">등록</button></div></section>`;
}

function hierarchyHtml(p){
  const parent=parentOf(p);
  return parent?`<button type="button" class="ps3-parent-link" data-ps3-project="${parent.id}">← ${esc(parent.name)}</button><span class="ps3-kind child">하위 프로젝트</span>`:`<span class="ps3-kind main">상위 프로젝트</span>`;
}

function renderDetail(d){
  const p=d.p,meta=p.metadata||{},parent=parentOf(p),kids=childrenOf(p);
  qs('#ps3Hierarchy').innerHTML=hierarchyHtml(p);
  qs('#ps3Kicker').textContent=`${projectType(p)} · ${parent?'SUB PROJECT':'PROJECT'}`;
  qs('#ps3Title').textContent=p.name;
  qs('#ps3Objective').textContent=meta.objective||p.description||'';
  const sections=[];
  if(enabled(d,'overview'))sections.push(overviewHtml(d));
  if(enabled(d,'progress'))sections.push(progressHtml(d));
  if(enabled(d,'milestones'))sections.push(milestonesHtml(d));
  if(enabled(d,'tasks'))sections.push(tasksHtml(d));
  if(enabled(d,'documents'))sections.push(docsHtml(d));
  if(enabled(d,'decisions'))sections.push(decisionsHtml(d));
  if(enabled(d,'pages'))sections.push(pagesHtml(d));
  if(enabled(d,'collaboration'))sections.push(collaborationHtml(d));
  const childSection=!parent&&kids.length?`<section class="ps3-section ps3-child-section"><div class="ps3-section-head"><div><h3>하위 프로젝트</h3><p>집중사업·행사 등 구체 사업 단위입니다.</p></div><button class="mini" data-ps3-child type="button">+ 하위 프로젝트</button></div><div class="ps3-child-cards">${kids.map(c=>`<button class="ps3-child-card" type="button" data-ps3-project="${c.id}"><span>하위 프로젝트</span><b>${esc(c.name)}</b><small>${esc(c.metadata?.objective||c.description||'')}</small></button>`).join('')}</div></section>`:(!parent?`<section class="ps3-section ps3-child-section"><div class="ps3-section-head"><div><h3>하위 프로젝트</h3><p>필요한 경우 구체 사업을 하위 프로젝트로 분리합니다.</p></div><button class="mini" data-ps3-child type="button">+ 하위 프로젝트</button></div>${empty('등록된 하위 프로젝트가 없습니다.')}</section>`:'');
  qs('#ps3Body').innerHTML=`<div class="ps3-detail-head"><div class="ps3-detail-meta"><span>${parent?'하위':'상위'} 프로젝트</span><span>기간 · ${esc(meta.start_on||'미정')} ~ ${esc(meta.end_on||'미정')}</span><span>진행 영역 · ${d.workstreams.length}</span></div><div class="ps3-actions">${canManage(p)?'<button class="mini" data-ps3-access type="button">공개·참여자</button><button class="mini ps3-danger" data-ps3-delete-project type="button">삭제</button>':''}</div></div>
  <nav class="ps3-nav">${[['overview','개요'],['progress','진행상황'],['milestones','주요 일정'],['tasks','할 일'],['documents','자료'],['decisions','회의·결정'],['pages','게시'],['collaboration','협업']].filter(([k])=>enabled(d,k)).map(([k,t])=>`<button type="button" data-ps3-nav="ps3-${k}">${t}</button>`).join('')}</nav>
  ${sections.join('')}${childSection}`;
  bindDynamicDetail();
}

async function openProject(id,push=true){
  await loadProjects();
  const p=projects.find(x=>x.id===id);if(!p)return;
  current=p;docFilter='all';docQuery='';
  detail=await fetchDetail(id);if(!detail)return;
  qs('#projectModal')?.classList.add('hidden');
  renderDetail(detail);
  openModal('ps3DetailModal');
  if(push)history.pushState({ps3Project:id},'',projectUrl(id));else history.replaceState({ps3Project:id},'',projectUrl(id));
}
async function refreshDetail(){if(!current)return;await loadProjects();current=projects.find(x=>x.id===current.id)||current;detail=await fetchDetail(current.id);renderDetail(detail)}
function closeDetail(){closeModal('ps3DetailModal');current=null;detail=null;clearProjectUrl()}

function openCreate(parentId=''){
  qs('#ps3CreateHeading').textContent=parentId?'하위 프로젝트 만들기':'프로젝트 만들기';
  qs('#ps3CreateName').value='';qs('#ps3CreateObjective').value='';qs('#ps3CreateType').value=parentId?'event':'ongoing';qs('#ps3CreateStart').value=new Date().toISOString().slice(0,10);qs('#ps3CreateEnd').value='';qs('#ps3CreateVisibility').value='public';
  qs('#ps3CreateParent').innerHTML='<option value="">없음</option>'+topProjects().map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  qs('#ps3CreateParent').value=parentId||'';
  qs('#ps3CreateStatus').textContent='';
  openModal('ps3CreateModal');
}
async function saveCreate(){
  const name=qs('#ps3CreateName').value.trim(),st=qs('#ps3CreateStatus');if(!name){st.textContent='프로젝트명을 입력해 주세요.';st.className='status error';return}
  const parentId=qs('#ps3CreateParent').value||null;
  const type=qs('#ps3CreateType').value;
  try{
    st.textContent='저장 중…';st.className='status';
    const max=Math.max(0,...spaces.map(s=>Number(s.sort_order)||0));
    const meta={project_system:'v2',management_version:2,project_type:type,current_phase:'preparation',objective:qs('#ps3CreateObjective').value.trim()||null,start_on:qs('#ps3CreateStart').value||null,end_on:qs('#ps3CreateEnd').value||null,created_from:'project_system_v3'};
    const rows=await api('/rest/v1/app_spaces',{method:'POST',body:{workspace_id:workspaceId,parent_id:parentId,slug:'project-'+Date.now().toString(36),name,description:meta.objective,sort_order:max+10,created_by:user.id,owner_id:user.id,status:'active',visibility:qs('#ps3CreateVisibility').value,metadata:meta},prefer:'return=representation'});
    const p=rows?.[0];
    if(p){
      const modules=['overview','progress','milestones','tasks','documents','decisions','pages','collaboration'];
      await api('/rest/v1/app_project_modules',{method:'POST',body:modules.map((k,i)=>({project_id:p.id,module_key:k,title:{overview:'개요',progress:'진행상황',milestones:'주요 일정',tasks:'할 일',documents:'자료',decisions:'회의·결정',pages:'게시',collaboration:'협업'}[k],enabled:true,sort_order:(i+1)*10,config:{},created_by:user.id}))});
    }
    closeModal('ps3CreateModal');await renderGrid();toast('프로젝트를 만들었습니다.');if(p)await openProject(p.id);
  }catch(e){st.textContent=e.message||String(e);st.className='status error'}
}

function openWorkstream(id=''){
  editingWs=id?detail.workstreams.find(x=>x.id===id):null;
  qs('#ps3WorkstreamHeading').textContent=editingWs?'진행 영역 수정':'진행 영역 추가';
  qs('#ps3WsTitle').value=editingWs?.title||'';qs('#ps3WsDesc').value=editingWs?.description||'';qs('#ps3WsPhase').value=editingWs?.phase||'preparation';qs('#ps3WsDelete').classList.toggle('hidden',!editingWs);qs('#ps3WsState').textContent='';openModal('ps3WorkstreamModal');
}
async function saveWorkstream(){
  const title=qs('#ps3WsTitle').value.trim(),st=qs('#ps3WsState');if(!title){st.textContent='영역명을 입력해 주세요.';return}
  const body={title,description:qs('#ps3WsDesc').value.trim()||null,phase:qs('#ps3WsPhase').value,updated_at:new Date().toISOString()};
  try{if(editingWs)await api(`/rest/v1/app_project_workstreams?id=eq.${editingWs.id}`,{method:'PATCH',body});else await api('/rest/v1/app_project_workstreams',{method:'POST',body:{project_id:current.id,...body,sort_order:(detail.workstreams.length+1)*10,created_by:user.id}});closeModal('ps3WorkstreamModal');await refreshDetail()}catch(e){st.textContent=e.message||String(e);st.className='status error'}
}
async function deleteWorkstream(){
  if(!editingWs||!confirm(`“${editingWs.title}” 진행 영역을 삭제할까요?`))return;
  try{await api(`/rest/v1/app_project_workstreams?id=eq.${editingWs.id}`,{method:'DELETE'});closeModal('ps3WorkstreamModal');await refreshDetail()}catch(e){qs('#ps3WsState').textContent=e.message||String(e)}
}
function openProgress(wsId=''){
  if(!detail.workstreams.length){toast('먼저 진행 영역을 추가하세요.');return}
  qs('#ps3ProgressWs').innerHTML=wsOptions(detail,false);qs('#ps3ProgressWs').value=wsId||detail.workstreams[0].id;const ws=detail.workstreams.find(x=>x.id===qs('#ps3ProgressWs').value);qs('#ps3ProgressPhase').value=ws?.phase||'in_progress';qs('#ps3ProgressDate').value=new Date().toISOString().slice(0,10);qs('#ps3ProgressSummary').value='';qs('#ps3ProgressNext').value='';qs('#ps3ProgressState').textContent='';openModal('ps3ProgressModal');
}
async function saveProgress(){
  const wsId=qs('#ps3ProgressWs').value,summary=qs('#ps3ProgressSummary').value.trim(),phase=qs('#ps3ProgressPhase').value,st=qs('#ps3ProgressState');if(!wsId||!summary){st.textContent='영역과 현재 상황을 입력해 주세요.';return}
  try{await api('/rest/v1/app_project_progress_updates',{method:'POST',body:{project_id:current.id,workstream_id:wsId,author_id:user.id,status_label:PHASES[phase]||phase,summary,next_step:qs('#ps3ProgressNext').value.trim()||null,effective_on:qs('#ps3ProgressDate').value,metadata:{}}});await api(`/rest/v1/app_project_workstreams?id=eq.${wsId}`,{method:'PATCH',body:{phase,updated_at:new Date().toISOString()}});closeModal('ps3ProgressModal');await refreshDetail()}catch(e){st.textContent=e.message||String(e);st.className='status error'}
}

function openMilestone(id=''){
  editingMilestone=id?detail.milestones.find(x=>x.id===id):null;
  qs('#ps3MilestoneHeading').textContent=editingMilestone?'주요 일정 수정':'주요 일정 추가';
  qs('#ps3MilestoneTitle').value=editingMilestone?.title||'';
  qs('#ps3MilestoneType').value=editingMilestone?.milestone_type||'action';
  qs('#ps3MilestoneStatusValue').value=editingMilestone?.status||'planned';
  qs('#ps3MilestoneAt').value=toLocalInput(editingMilestone?.start_at);
  qs('#ps3MilestoneWs').innerHTML=wsOptions(detail,true);qs('#ps3MilestoneWs').value=editingMilestone?.workstream_id||'';
  qs('#ps3MilestoneNotes').value=editingMilestone?.notes||'';
  qs('#ps3MilestoneDelete').classList.toggle('hidden',!editingMilestone);
  qs('#ps3MilestoneState').textContent='';openModal('ps3MilestoneModal');
}
async function saveMilestone(){
  const title=qs('#ps3MilestoneTitle').value.trim(),st=qs('#ps3MilestoneState');if(!title){st.textContent='제목을 입력해 주세요.';return}
  const body={workstream_id:qs('#ps3MilestoneWs').value||null,title,milestone_type:qs('#ps3MilestoneType').value,status:qs('#ps3MilestoneStatusValue').value,start_at:qs('#ps3MilestoneAt').value?new Date(qs('#ps3MilestoneAt').value).toISOString():null,end_at:null,notes:qs('#ps3MilestoneNotes').value.trim()||null};
  try{if(editingMilestone)await api(`/rest/v1/app_project_milestones?id=eq.${editingMilestone.id}`,{method:'PATCH',body});else await api('/rest/v1/app_project_milestones',{method:'POST',body:{project_id:current.id,...body,event_id:null,child_project_id:null,sort_order:(detail.milestones.length+1)*10,created_by:user.id}});closeModal('ps3MilestoneModal');await refreshDetail();toast(editingMilestone?'주요 일정을 수정했습니다.':'주요 일정을 추가했습니다.')}catch(e){st.textContent=e.message||String(e);st.className='status error'}
}
async function deleteMilestone(){
  if(!editingMilestone||!confirm(`“${editingMilestone.title}” 주요 일정을 삭제할까요?`))return;
  try{await api(`/rest/v1/app_project_milestones?id=eq.${editingMilestone.id}`,{method:'DELETE'});closeModal('ps3MilestoneModal');await refreshDetail();toast('주요 일정을 삭제했습니다.')}catch(e){qs('#ps3MilestoneState').textContent=e.message||String(e)}
}

function openGlobal(kind){
  const map={task:['newTaskBtn','taskProject'],document:['newDocumentBtn','docProject'],meeting:['newMeetingBtn','meetingProject'],page:['newPageBtn','pageSpace']},a=map[kind];if(!a)return;
  qs('#'+a[0])?.click();setTimeout(()=>{const s=qs('#'+a[1]);if(s){const opt=[...s.options].find(o=>o.value===current.id);if(opt)s.value=current.id}},0);
}
function goLibrary(){closeModal('ps3DetailModal');const sel=qs('#documentProject');if(sel){const opt=[...sel.options].find(o=>o.value===current.id);if(opt)sel.value=current.id;sel.dispatchEvent(new Event('change',{bubbles:true}))}window.KPTURouter?.go?.('library')}
function editDocument(id){window.dispatchEvent(new CustomEvent('kptu:edit-document',{detail:{id}}))}

async function addComment(){
  const input=qs('#ps3CommentBody'),body=input?.value.trim();if(!body)return;
  try{await api('/rest/v1/app_project_comments',{method:'POST',body:{project_id:current.id,author_id:user.id,body}});input.value='';await refreshDetail()}catch(e){toast(e.message||String(e))}
}

function openDelete(){
  const kids=childrenOf(current);
  qs('#ps3DeleteMessage').innerHTML=`<b>${esc(current.name)}</b><br>${current.parent_id?'하위 프로젝트':'프로젝트'}를 삭제합니다.${kids.length?` 하위 프로젝트 <b>${kids.length}개</b>도 함께 삭제됩니다.`:''}`;
  qs('#ps3DeleteState').textContent='';openModal('ps3DeleteModal');
}
async function unlinkProjectData(id){
  await Promise.all([
    api(`/rest/v1/app_tasks?project_id=eq.${id}`,{method:'PATCH',body:{project_id:null}}),
    api(`/rest/v1/app_events?project_id=eq.${id}`,{method:'PATCH',body:{project_id:null}}),
    api(`/rest/v1/app_meetings?project_id=eq.${id}`,{method:'PATCH',body:{project_id:null}}),
    api(`/rest/v1/app_documents?project_id=eq.${id}`,{method:'PATCH',body:{project_id:null}}),
    api(`/rest/v1/app_pages?space_id=eq.${id}`,{method:'PATCH',body:{space_id:null}})
  ]);
}
async function deleteProject(){
  const st=qs('#ps3DeleteState');st.textContent='삭제 중…';
  try{
    const ids=[...childrenOf(current).map(x=>x.id),current.id];
    for(const id of ids)await unlinkProjectData(id);
    await api(`/rest/v1/app_spaces?id=eq.${encodeURIComponent(current.id)}`,{method:'DELETE'});
    closeModal('ps3DeleteModal');closeModal('ps3DetailModal');current=null;detail=null;clearProjectUrl();await renderGrid();toast('프로젝트를 삭제했습니다.');
  }catch(e){st.textContent=e.message||String(e);st.className='status error'}
}

function peopleRows(selected=new Map()){
  return members.filter(m=>m.user_id!==user.id).map(m=>{const role=selected.get(m.user_id)||'';return `<div class="ps3-person"><label><input type="checkbox" data-ps3-person="${m.user_id}" ${role?'checked':''}> <span>${esc(nameOf(m.user_id))}</span></label><select data-ps3-role="${m.user_id}" ${role?'':'disabled'}><option value="view" ${role==='view'?'selected':''}>열람</option><option value="edit" ${(!role||role==='edit')?'selected':''}>편집</option><option value="manage" ${role==='manage'?'selected':''}>관리</option></select></div>`}).join('')||'<div class="updated">다른 팀원이 없습니다.</div>';
}
function openAccess(){
  const selected=new Map(detail.spaceMembers.map(x=>[x.user_id,x.role]));
  qs('#ps3AccessVisibility').value=current.visibility||'public';
  qs('#ps3AccessPeople').innerHTML=peopleRows(selected);
  qs('#ps3AccessState').textContent='';openModal('ps3AccessModal');
}
async function saveAccess(){
  const st=qs('#ps3AccessState');st.textContent='저장 중…';
  try{
    await api(`/rest/v1/app_spaces?id=eq.${current.id}`,{method:'PATCH',body:{visibility:qs('#ps3AccessVisibility').value}});
    await api(`/rest/v1/app_space_members?project_id=eq.${current.id}`,{method:'DELETE'});
    const rows=[...document.querySelectorAll('#ps3AccessPeople [data-ps3-person]:checked')].map(cb=>({project_id:current.id,user_id:cb.dataset.ps3Person,role:qs(`[data-ps3-role="${cb.dataset.ps3Person}"]`).value,added_by:user.id}));
    if(rows.length)await api('/rest/v1/app_space_members',{method:'POST',body:rows});
    closeModal('ps3AccessModal');await refreshDetail();toast('공개범위를 저장했습니다.');
  }catch(e){st.textContent=e.message||String(e);st.className='status error'}
}

function bindDynamicDetail(){
  const search=qs('#ps3DocSearch');
  if(search)search.oninput=e=>{docQuery=e.target.value;const sec=qs('#ps3-documents');if(sec)sec.outerHTML=docsHtml(detail);bindDynamicDetail()};
}

function bind(){
  document.addEventListener('click',e=>{
    const legacy=e.target.closest?.('#projectGrid [data-project]');
    if(legacy){e.preventDefault();e.stopImmediatePropagation();openProject(legacy.dataset.project);return}
    const p=e.target.closest?.('[data-ps3-project]');if(p){e.preventDefault();e.stopPropagation();openProject(p.dataset.ps3Project);return}
    const close=e.target.closest?.('[data-ps3-close]');if(close){if(close.dataset.ps3Close==='ps3DetailModal')closeDetail();else closeModal(close.dataset.ps3Close);return}
    const nav=e.target.closest?.('[data-ps3-nav]');if(nav){qs('#'+nav.dataset.ps3Nav)?.scrollIntoView({behavior:'smooth',block:'start'});return}
    if(e.target.closest('[data-ps3-child]')){openCreate(current.id);return}
    if(e.target.closest('[data-ps3-add-ws]')){openWorkstream();return}
    const ew=e.target.closest?.('[data-ps3-edit-ws]');if(ew){openWorkstream(ew.dataset.ps3EditWs);return}
    if(e.target.closest('[data-ps3-add-progress]')){openProgress();return}
    const pw=e.target.closest?.('[data-ps3-progress-ws]');if(pw){openProgress(pw.dataset.ps3ProgressWs);return}
    if(e.target.closest('[data-ps3-add-milestone]')){openMilestone();return}
    const em=e.target.closest?.('[data-ps3-edit-milestone]');if(em){openMilestone(em.dataset.ps3EditMilestone);return}
    const df=e.target.closest?.('[data-ps3-doc-filter]');if(df){docFilter=df.dataset.ps3DocFilter;const sec=qs('#ps3-documents');if(sec)sec.outerHTML=docsHtml(detail);bindDynamicDetail();return}
    const ed=e.target.closest?.('[data-ps3-edit-doc]');if(ed){editDocument(ed.dataset.ps3EditDoc);return}
    if(e.target.closest('[data-ps3-library]')){goLibrary();return}
    if(e.target.closest('[data-ps3-comment]')){addComment();return}
    if(e.target.closest('[data-ps3-access]')){openAccess();return}
    if(e.target.closest('[data-ps3-delete-project]')){openDelete();return}
    const gl=e.target.closest?.('[data-ps3-global]');if(gl){openGlobal(gl.dataset.ps3Global);return}
  },true);
  qs('#ps3CreateSave').onclick=saveCreate;
  qs('#ps3WsSave').onclick=saveWorkstream;qs('#ps3WsDelete').onclick=deleteWorkstream;
  qs('#ps3ProgressSave').onclick=saveProgress;
  qs('#ps3MilestoneSave').onclick=saveMilestone;qs('#ps3MilestoneDelete').onclick=deleteMilestone;
  qs('#ps3DeleteConfirm').onclick=deleteProject;
  qs('#ps3AccessSave').onclick=saveAccess;
  qs('#ps3AccessPeople').addEventListener('change',e=>{const cb=e.target.closest('[data-ps3-person]');if(cb){const sel=qs(`[data-ps3-role="${cb.dataset.ps3Person}"]`);if(sel)sel.disabled=!cb.checked}});
  window.addEventListener('popstate',()=>{const id=new URLSearchParams(location.search).get('project');if(id)openProject(id,false);else closeModal('ps3DetailModal')});
}

async function takeoverCreate(){
  const btn=qs('#newProjectBtn');if(!btn)return;
  btn.textContent='+ 프로젝트 만들기';
  btn.onclick=e=>{e.preventDefault();e.stopImmediatePropagation();openCreate()};
}
async function boot(){
  ensureUi();bind();
  if(!(await context()))return;
  await loadProjects();
  await takeoverCreate();
  await renderGrid();
  if(window.KPTURouter?.on)window.KPTURouter.on('projects',()=>renderGrid());
  ['kptu:tasks-changed','kptu:documents-changed','kptu:meetings-changed','kptu:pages-changed'].forEach(ev=>window.addEventListener(ev,()=>{if(window.KPTURouter?.current?.()==='projects')renderGrid()}));
  const q=new URLSearchParams(location.search).get('project');if(q&&projects.some(x=>x.id===q))await openProject(q,false);
  document.documentElement.classList.add('kptu-project-v3-ready');
  window.__KPTU_PROJECT_V3_READY__=true;
}
boot().catch(console.error);
})();