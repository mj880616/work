(()=>{
'use strict';
const rt=window.KPTURuntime;if(!rt)return;
let user=null,workspaceId=null,spaces=[],members=[],profiles=[],currentMeeting=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=(p,o={})=>rt.api(p,o);
const childSpaces=()=>spaces.filter(s=>s.parent_id&&s.status!=='archived');
const childOptions=(selected='')=>'<option value="">프로젝트 없음</option>'+childSpaces().map(s=>`<option value="${s.id}" ${s.id===selected?'selected':''}>${esc((spaces.find(p=>p.id===s.parent_id)?.name||'')+' › '+s.name)}</option>`).join('');
async function context(){if(!(await rt.session.ensure()))return false;user=await api('/auth/v1/user');const ms=await api(`/rest/v1/app_workspace_members?user_id=eq.${user.id}&select=workspace_id&limit=1`);if(!ms?.length)return false;workspaceId=ms[0].workspace_id;[spaces,members,profiles]=await Promise.all([api(`/rest/v1/app_spaces?workspace_id=eq.${workspaceId}&select=id,parent_id,name,status&order=sort_order.asc,created_at.asc`),api(`/rest/v1/app_workspace_members?workspace_id=eq.${workspaceId}&select=user_id,role`),api('/rest/v1/app_profiles?select=user_id,display_name')]);return true}
function filterTaskProjects(){['taskProject','meetingProject'].forEach(id=>{const el=document.querySelector('#'+id);if(!el)return;const keep=el.value;el.innerHTML=childOptions(keep);if(keep&&childSpaces().some(s=>s.id===keep))el.value=keep});const note=document.querySelector('#taskModalStatus');if(note&&!document.querySelector('#wfTaskRule'))note.insertAdjacentHTML('beforebegin','<p id="wfTaskRule" class="muted" style="font-size:11px;margin:6px 0 8px">프로젝트 할 일은 하위 프로젝트에만 연결됩니다. 프로젝트와 무관한 개인 할 일은 프로젝트 없음으로 둘 수 있습니다.</p>')}
function enhanceMeetingCreate(){const card=document.querySelector('#meetingModal .modal-card');if(!card||document.querySelector('#wfMeetingMeta'))return;const project=document.querySelector('#meetingProject')?.closest('.two-col');if(project)project.insertAdjacentHTML('afterend','<div id="wfMeetingMeta" class="two-col"><label>장소<input id="wfMeetingLocation" type="text" placeholder="회의 장소"></label><label>참석 인원<input id="wfMeetingAttendees" type="number" min="0" inputmode="numeric" placeholder="명"></label></div>');const notes=document.querySelector('#meetingNotes')?.closest('label');if(notes){notes.firstChild.nodeValue='사업 정보공유 ';notes.querySelector('textarea').placeholder='사업·정세·현장 상황 등 공유된 내용을 적습니다.'}const dec=document.querySelector('#meetingDecisions')?.closest('label');if(dec){dec.firstChild.nodeValue='중요 결정 사항 ';dec.querySelector('textarea').placeholder='회의에서 확정된 결정만 적습니다.'}const box=document.querySelector('.action-box');if(box)box.querySelector('b').textContent='후속 과제와 역할분담 및 기한'}
function setMeetingAiLabels(){const modal=document.querySelector('#wfMeetingAiModal');modal.querySelector('.modal-head h2').textContent='회의 결과 자동 분류';modal.querySelector('.modal-head p.muted').textContent='회의 결과·메모를 그대로 붙여넣으면 AI가 결정 사항, 역할 분담 및 후속 과제, 주요 정보 공유로 나눠 초안을 만듭니다.';const input=modal.querySelector('#wfMeetingTranscript');input.closest('label').firstChild.nodeValue='회의 결과·메모 원문 ';input.placeholder='회의 결과, 메모, 녹취 정리 내용을 형식 없이 그대로 붙여넣으세요.';modal.querySelector('#wfMeetingGenerate').textContent='AI로 3가지로 분류';modal.querySelector('#wfDraftDecisions').closest('label').firstChild.nodeValue='1. 결정 사항 ';modal.querySelector('#wfDraftActions').closest('label').firstChild.nodeValue='2. 역할 분담 및 후속 과제 ';modal.querySelector('#wfDraftInfo').closest('label').firstChild.nodeValue='3. 주요 정보 공유 '}
function installMeetingAi(){if(document.querySelector('#wfMeetingAiModal'))return;document.body.insertAdjacentHTML('beforeend',`<div id="wfMeetingAiModal" class="modal hidden" aria-hidden="true"><div class="modal-card medium-card"><div class="modal-head"><div><div class="eyebrow">AI MEETING DRAFT</div><h2>회의 결과 초안 만들기</h2><p class="muted">녹취 텍스트와 회의자료를 바탕으로 초안을 만들고 사람이 검수한 뒤 확정합니다.</p></div><button id="wfMeetingAiClose" class="icon-btn" type="button">×</button></div><label>녹취·회의록 텍스트<textarea id="wfMeetingTranscript" rows="10" placeholder="텍스트 회의록을 붙여넣거나 텍스트 파일을 불러오세요."></textarea></label><label class="secondary" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:6px 0">텍스트 파일 불러오기<input id="wfMeetingTextFile" type="file" accept=".txt,.md,.csv,text/plain,text/markdown,text/csv" hidden></label><div class="notice" style="margin:8px 0">PDF·HWP·녹음파일은 회의자료로 업로드해 보관할 수 있습니다. 현재 AI 초안은 입력된 녹취 텍스트와 프로젝트 업무맥락, 등록된 회의자료의 제목·설명을 사용합니다. PDF·HWP 본문 추출과 음성 자동전사는 다음 백엔드 단계에서 연결합니다.</div><button id="wfMeetingGenerate" class="primary wide" type="button">AI로 회의결과 초안</button><div id="wfMeetingAiStatus" class="status"></div><div id="wfMeetingDraft" class="hidden"><label>1. 중요 결정 사항<textarea id="wfDraftDecisions" rows="5"></textarea></label><label>2. 후속 과제와 역할분담 및 기한 <small>한 줄에 과제 | 담당자 | 기한</small><textarea id="wfDraftActions" rows="6"></textarea></label><label>3. 사업 정보공유<textarea id="wfDraftInfo" rows="6"></textarea></label><div class="two-col"><button id="wfSaveDraft" class="secondary" type="button">초안 저장</button><button id="wfFinalizeMeeting" class="primary" type="button">검수 후 최종 확정</button></div><p class="muted" style="font-size:10.5px;margin-top:7px">최종 확정 시 담당자가 팀원 이름과 정확히 일치하고 기한이 확인된 후속 과제는 실제 할 일로 생성합니다. 프로젝트가 연결된 경우 하위 프로젝트에만 생성됩니다.</p></div></div></div>`);document.querySelector('#wfMeetingAiModal .notice').textContent='회의록·녹취 스크립트를 직접 입력하고 PDF·HWP·HWPX·텍스트 등 회의자료를 함께 사용합니다. 음성파일 자동전사(STT)는 비용 절감을 위해 사용하지 않습니다. 회의자료 본문 읽기 실패 파일은 경고로 표시합니다.';document.querySelector('#wfMeetingAiClose').onclick=()=>close('wfMeetingAiModal');document.querySelector('#wfMeetingTextFile').onchange=async e=>{const f=e.target.files?.[0],epoch=aiOpenEpoch,meetingId=currentMeeting?.id;if(!f)return;const content=await f.text();if(epoch===aiOpenEpoch&&currentMeeting?.id===meetingId)document.querySelector('#wfMeetingTranscript').value=content};document.querySelector('#wfMeetingGenerate').onclick=generateMeetingDraft;document.querySelector('#wfMeetingGenerate').dataset.ingestBackend='text-only';document.querySelector('#wfSaveDraft').onclick=()=>saveMeetingResult(false);document.querySelector('#wfFinalizeMeeting').onclick=()=>saveMeetingResult(true)}
function open(id){const m=document.querySelector('#'+id);if(m){m.classList.remove('hidden');m.setAttribute('aria-hidden','false')}}function close(id){if(id==='wfMeetingAiModal')aiOpenEpoch++;const m=document.querySelector('#'+id);if(m){m.classList.add('hidden');m.setAttribute('aria-hidden','true')}}
let aiOpenEpoch=0;
async function openAiForMeeting(id){const epoch=++aiOpenEpoch;const rows=await api(`/rest/v1/app_meetings?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);if(epoch!==aiOpenEpoch)return;currentMeeting=rows?.[0];if(!currentMeeting)return;installMeetingAi();document.querySelector('#wfMeetingTranscript').value=currentMeeting.transcript_text||'';const d=currentMeeting.ai_draft||{};document.querySelector('#wfDraftDecisions').value=d.decisions||currentMeeting.decisions||'';document.querySelector('#wfDraftActions').value=(d.actions||currentMeeting.followups||[]).map(a=>typeof a==='string'?a:[a.task,a.assignee,a.due].filter(Boolean).join(' | ')).join('\n');document.querySelector('#wfDraftInfo').value=d.information||currentMeeting.notes||'';document.querySelector('#wfMeetingDraft').classList.toggle('hidden',!(currentMeeting.ai_draft||currentMeeting.followups?.length));document.querySelector('#wfMeetingAiStatus').textContent='';open('wfMeetingAiModal')}
window.__KPTU_OPEN_AI_FOR_MEETING__=openAiForMeeting;
// Preserve reviewable meeting content even when AI response keys vary slightly.
function normalizeMeetingDraftPayload(data){
  const raw=data?.draft??data?.result??null;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const decisions=typeof raw.decisions==='string'?raw.decisions:'';
  const information=typeof raw.information==='string'?raw.information:(typeof raw.info==='string'?raw.info:'');
  const sourceActions=Array.isArray(raw.actions)?raw.actions:[];
  const actions=sourceActions.map(action=>{
    if(typeof action==='string'){
      const task=action.trim();
      return task?{task,assignee:'[확인 필요]',due:'[확인 필요]'}:null;
    }
    if(!action||typeof action!=='object')return null;
    const task=String(action.task??action.title??'').trim();
    if(!task)return null;
    const assignee=String(action.assignee??action.owner??'[확인 필요]').trim()||'[확인 필요]';
    const due=String(action.due??action.deadline??'[확인 필요]').trim()||'[확인 필요]';
    return {task,assignee,due};
  }).filter(Boolean);
  if(!decisions&&!information&&!actions.length)return null;
  return {decisions,actions,information};
}
async function generateMeetingDraft(){
  const meeting=currentMeeting,epoch=aiOpenEpoch;
  if(!meeting)return;
  const transcript=document.querySelector('#wfMeetingTranscript').value.trim(),st=document.querySelector('#wfMeetingAiStatus'),btn=document.querySelector('#wfMeetingGenerate');
  if(!transcript){st.textContent='녹취 스크립트나 텍스트 회의록을 입력해 주세요.';st.className='status error';return}
  const stillCurrent=()=>epoch===aiOpenEpoch&&currentMeeting?.id===meeting.id;
  btn.disabled=true;st.textContent='회의자료 본문을 읽는 중…';st.className='status';
  try{
    let ingestWarning=false;
    try{const ingest=await api('/functions/v1/meeting-ai-ingest',{method:'POST',body:{meeting_id:meeting.id}});if(!stillCurrent())return;ingestWarning=Boolean(ingest?.warnings?.length)}
    catch(e){if(!stillCurrent())return;console.warn('meeting material ingest failed',e);ingestWarning=true}
    st.textContent='회의자료 맥락과 스크립트를 바탕으로 결과 초안을 만드는 중…';
    const data=await api('/functions/v1/meeting-ai-draft',{method:'POST',body:{meeting_id:meeting.id,transcript_text:transcript}});
    if(!stillCurrent())return;
    const draft=normalizeMeetingDraftPayload(data);
    if(!draft)throw new Error('invalid_meeting_draft');
    document.querySelector('#wfDraftDecisions').value=draft.decisions;
    document.querySelector('#wfDraftActions').value=draft.actions.map(a=>[a.task,a.assignee,a.due].filter(Boolean).join(' | ')).join('\n');
    document.querySelector('#wfDraftInfo').value=draft.information;
    document.querySelector('#wfMeetingDraft').classList.remove('hidden');
    const warnings=(data.warnings||[]).length+(ingestWarning?1:0);
    st.textContent=warnings?`초안을 만들었습니다. 일부 자료 또는 응답 형식을 확인해 주세요 (${warnings}건). 원문은 검수용 초안에 보존됩니다.`:'초안을 만들었습니다. 반드시 검수·수정한 뒤 최종 확정하세요.';
    st.className=warnings?'status':'status ok';
  }catch(e){if(stillCurrent()){console.error('meeting AI draft failed',e);st.textContent=e?.code==='session_required'?'로그인 세션이 만료됐습니다. 다시 로그인해 주세요.':'초안을 만들지 못했습니다. 입력한 회의록은 유지됩니다. 잠시 후 다시 시도해 주세요.';st.className='status error'}}
  finally{if(stillCurrent())btn.disabled=false}
}
function actionLines(){return document.querySelector('#wfDraftActions').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{const [task,assignee,due]=line.split('|').map(x=>x?.trim()||'');return {task,assignee,due}})}
function memberIdByName(name){const n=String(name||'').trim();if(!n||/확인 필요/.test(n))return null;const p=profiles.find(x=>String(x.display_name||'').trim()===n);return p?.user_id||null}
function dueIso(v){const s=String(v||'').trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const d=new Date(s+'T18:00:00+09:00');return Number.isNaN(d.getTime())?null:d.toISOString()}
async function createConfirmedTasks(meeting,actions,stillCurrent){if(!actions.length)return {created:0,skipped:0};const projectId=meeting.project_id||null;if(projectId){const p=spaces.find(s=>s.id===projectId);if(!p?.parent_id)return {created:0,skipped:actions.length,reason:'회의가 메인 프로젝트에 연결되어 있어 할 일을 만들지 않았습니다. 하위 프로젝트로 변경한 뒤 생성하세요.'}}const existing=await api(`/rest/v1/app_tasks?source_type=eq.meeting&source_id=eq.${meeting.id}&select=id,title`);if(!stillCurrent())return null;const titles=new Set((existing||[]).map(x=>x.title));let created=0,skipped=0;for(const a of actions){if(!stillCurrent())return null;const title=String(a.task||'').trim(),assignee=memberIdByName(a.assignee),due=dueIso(a.due);if(!title||!assignee||!due||titles.has(title)){skipped++;continue}await api('/rest/v1/app_tasks',{method:'POST',body:{workspace_id:workspaceId,project_id:projectId,title,description:`회의 결과에서 확정 · ${meeting.title}`,assignee_id:assignee,status:'todo',priority:'normal',due_at:due,source_type:'meeting',source_id:meeting.id,created_by:user.id}});titles.add(title);created++}if(created)window.dispatchEvent(new CustomEvent('kptu:tasks-changed'));return {created,skipped}}
async function saveMeetingResult(finalize){const meeting=currentMeeting,epoch=aiOpenEpoch;if(!meeting)return;const st=document.querySelector('#wfMeetingAiStatus'),draft={decisions:document.querySelector('#wfDraftDecisions').value.trim(),actions:actionLines(),information:document.querySelector('#wfDraftInfo').value.trim()},stillCurrent=()=>epoch===aiOpenEpoch&&currentMeeting?.id===meeting.id;try{const body={ai_draft:draft,transcript_text:document.querySelector('#wfMeetingTranscript').value.trim()||null,result_status:finalize?'final':'draft',updated_at:new Date().toISOString()};if(finalize){body.decisions=draft.decisions;body.notes=draft.information;body.followups=draft.actions;body.finalized_at=new Date().toISOString()}const saved=await api(`/rest/v1/app_meetings?id=eq.${encodeURIComponent(meeting.id)}&select=id`,{method:'PATCH',body,prefer:'return=representation'});if(!Array.isArray(saved)||saved.length!==1)throw new Error('회의 결과 저장 권한을 확인하지 못했습니다.');if(!stillCurrent())return;if(!finalize){st.textContent='초안을 저장했습니다.';st.className='status ok';return}const taskResult=await createConfirmedTasks(meeting,draft.actions,stillCurrent);if(!stillCurrent()||!taskResult)return;st.textContent=`최종 확정했습니다. 할 일 ${taskResult.created}건 생성${taskResult.skipped?` · ${taskResult.skipped}건은 담당자/기한 확인이 필요해 보류`:''}${taskResult.reason?' · '+taskResult.reason:''}`;st.className='status ok';setTimeout(()=>{if(stillCurrent()){close('wfMeetingAiModal');location.reload()}},1100)}catch(e){if(stillCurrent()){st.textContent=e.message||String(e);st.className='status error'}}}
function bind(){if(document.documentElement.dataset.wfAiBound)return;document.documentElement.dataset.wfAiBound='1';document.addEventListener('click',e=>{if(e.target.closest('#quickTaskBtn,#newTaskBtn'))setTimeout(filterTaskProjects,0);if(e.target.closest('#newMeetingBtn'))setTimeout(()=>{filterTaskProjects();enhanceMeetingCreate()},0)});window.addEventListener('kptu:session-changed',()=>{aiOpenEpoch++;currentMeeting=null;close('wfMeetingAiModal');setTimeout(init,0)})}
async function init(){if(!(await context()))return;filterTaskProjects();enhanceMeetingCreate();installMeetingAi();setMeetingAiLabels();bind()}
init();
})();
