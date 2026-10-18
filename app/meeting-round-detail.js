import {formatMeetingTime,meetingInputValue,toMeetingISO,seoulDateKey} from './meeting-time.js';
import {bindDateTimeFields} from './time-input.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {selectedResultText,sendMeetingToBasket} from './meeting-basket-send.js';
import {dueText,fileLine,bindDue,paintDue,bindDropTarget} from './meeting-compact.js';
let mrdUploadEntries=[],mrdUploading=false;
window.addEventListener('kptu:before-reload',event=>{if(mrdUploadEntries.some(entry=>entry.kind!=='success')&&!document.querySelector('#meetingRoundDetailModal')?.classList.contains('hidden'))event.detail.otherDraft=true});
let mrdUser=null,mrdWorkspace=null,mrdRole=null,mrdProjects=[],mrdCurrent=null,mrdTasks=[],mrdEditingTask=null,mrdRequestEpoch=0,mrdSavingTask=false,mrdSavingEdit=false;const mrdTaskToggleSeq=new Map();
let mrdEditSequence=0,mrdEditor=null,mrdEditObservedScope=null;const mrdEditAttempts=new Map();
// These tokens own only the lifetime of in-flight UI work, not deletion authority.
const mrdDeleteTokens=new Set();
async function mrdApi(path,options={}){const rt=window.KPTURuntime;if(!rt?.api)throw new Error('공용 런타임을 불러오지 못했습니다.');return rt.api(path,options)}
function mrdEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
const mrdFmt=v=>formatMeetingTime(v,{year:'numeric'});
const mrdDateValue=meetingInputValue;
function mrdDueDateValue(v){if(!v)return'';const s=String(v),m=s.match(/^(\d{4}-\d{2}-\d{2})/);if(m)return m[1];const d=new Date(v);if(Number.isNaN(d.getTime()))return'';const p=n=>String(n).padStart(2,'0');return seoulDateKey(d)}
const mrdTaskEndpoint=action=>'/functions/v1/google-tasks?action='+encodeURIComponent(action);
const mrdTaskLinks=meeting=>[{meeting_id:meeting.id},...(meeting.project_id?[{project_id:meeting.project_id}]:[])];
async function mrdReadTasks(meetingId){
  // The task screen shows completion before its Google save finishes.
  await window.KPTUGoogleTasks?.waitForPendingToggles?.();
  return mrdApi(mrdTaskEndpoint('linked')+'&meeting_id='+encodeURIComponent(meetingId));
}
function mrdCanEdit(m){return !!m&&(m.created_by===mrdUser?.id||['owner','admin','editor'].includes(mrdRole))}
function mrdCanDelete(m){return !!m&&(m.created_by===mrdUser?.id||['owner','admin'].includes(mrdRole))}
function mrdProjectOptions(selected=''){return window.KPTUProjectCatalog?.options(selected)||'<option value="">프로젝트 없음</option>'}
function mrdMeetingName(m){return String(m?.series_name||m?.title||'').trim()}
function mrdLegacyTitle(m){const name=mrdMeetingName(m),title=String(m?.title||'').trim();return title&&name&&title!==name?title:''}
function mrdResultText(m){if(m?.transcript_text!=null&&String(m.transcript_text).length)return String(m.transcript_text);if(String(m?.decisions||'').trim())return `[기존 회의결과 기록]\n${m.decisions}`;return '기록 없음'}
// MEET-기록보내기 1단계: 고른 글(없으면 전체)을 바구니 메모로 담는다. 버튼을 누르면 선택이 풀릴 수 있어 누르기 직전에 한 번 붙잡아 둔다.
let mrdBasketBusy=false,mrdPickedText='',mrdBasketDoneId='';// UI-MEET결과창정리: 담기에 성공한 회의 id. 창을 닫으면 비운다(다시 열면 원래 버튼, 기억은 MEET 2단계).
const mrdPicked=()=>selectedResultText(document.querySelector('#mrdResult'),window.getSelection());
function mrdBasketBody(){const picked=mrdPickedText||mrdPicked();if(picked)return picked;const m=mrdCurrent;if(!m)return'';return m.transcript_text!=null&&String(m.transcript_text).trim()?String(m.transcript_text):String(m.decisions||'')}
function mrdPaintBasketButton(){const b=document.querySelector('#mrdToBasket');if(!b)return;const done=!!mrdCurrent&&mrdBasketDoneId===mrdCurrent.id;b.disabled=done||mrdBasketBusy||!mrdBasketBody().trim();b.textContent=done?'바구니에 담김':mrdPicked()?'선택한 글 담기':'바구니에 담기'}
async function mrdSendToBasket(){
  const meeting=mrdCurrent,st=document.querySelector('#mrdBasketStatus'),body=mrdBasketBody();mrdPickedText='';
  if(mrdBasketBusy||!meeting||!body.trim()||mrdBasketDoneId===meeting.id)return;
  mrdBasketBusy=true;mrdPaintBasketButton();st.className='status';st.textContent='바구니에 담는 중…';
  try{const r=await sendMeetingToBasket(meeting,body);if(mrdCurrent?.id!==meeting.id)return;mrdBasketDoneId=meeting.id;st.textContent=r.truncated?'바구니에 담았어요. 글이 길어 앞 2만 자까지만 담았어요.':'바구니에 담았어요.';window.getSelection()?.removeAllRanges()}
  catch(e){if(mrdCurrent?.id===meeting.id){st.className='status error';st.textContent=e.message||'바구니에 담지 못했어요. 다시 시도해 주세요.'}}
  finally{mrdBasketBusy=false;mrdPaintBasketButton()}
}
function mrdBindBasketSend(){const b=document.querySelector('#mrdToBasket');b.addEventListener('pointerdown',()=>{mrdPickedText=mrdPicked()});b.addEventListener('click',mrdSendToBasket);document.addEventListener('selectionchange',()=>{if(!mrdBasketBusy&&!document.querySelector('#meetingRoundDetailModal')?.classList.contains('hidden'))mrdPaintBasketButton()})}
function mrdInstallModal(){if(document.querySelector('#meetingRoundDetailModal'))return;document.body.insertAdjacentHTML('beforeend',`<div id="meetingRoundDetailModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="mrdTitle"><div class="modal-card medium-card meeting-round-detail-card"><div class="modal-head"><div><h2 id="mrdTitle">회의 결과</h2><p id="mrdMeta" class="muted"></p><div id="mrdHeadActions" class="mrd-head-actions"><button id="mrdEdit" class="mini" type="button">수정</button><button id="mrdDelete" class="mini mrd-delete" type="button">삭제</button></div></div><button class="icon-btn" id="mrdClose" type="button" aria-label="닫기">×</button></div><div id="mrdView"><section class="mrd-result-section"><div class="mtg-group-head mrd-result-head"><h3>회의 결과 원문</h3><button id="mrdToBasket" class="mini" type="button">바구니에 담기</button></div><p class="mtg-note">글을 길게 눌러 고르면 그 부분만 담아요. 고르지 않으면 전체(앞 2만 자)를 담아요.</p><div id="mrdBasketStatus" class="status" role="status" aria-live="polite"></div><div id="mrdResult" class="mrd-text mrd-result-text"></div></section><section id="mrdSpecialSection" class="mrd-special-section hidden"><h3>특이사항</h3><div id="mrdSpecial" class="mrd-text mrd-special-text"></div></section><section class="mrd-followup-section mtg-group" aria-labelledby="mrdTasksHead"><div class="mtg-group-head"><h3 id="mrdTasksHead">후속 할 일</h3><button id="mrdAddTask" class="mtg-add-plus" type="button" aria-label="후속 할 일 추가" aria-expanded="false" aria-controls="mrdTaskForm">+</button></div><div id="mrdTaskForm" class="mtg-task-line hidden"><input id="mrdTaskTitle" type="text" placeholder="후속 할 일" aria-label="후속 할 일"><span class="due-chip"><input id="mrdTaskDue" class="due-chip-input" type="date" aria-label="기한"><span class="due-chip-label" aria-hidden="true">기한 ▾</span></span><button id="mrdTaskSave" class="mtg-line-add" type="button">추가</button><button id="mrdTaskCancel" class="mtg-line-cancel hidden" type="button">취소</button><div id="mrdTaskStatus" class="status"></div></div><div id="mrdTasks" class="gt-linked gt-list mtg-task-list"></div></section><section class="mrd-material-section mtg-group" aria-labelledby="mrdMaterialsHead"><div class="mtg-group-head"><h3 id="mrdMaterialsHead">회의자료</h3><button id="mrdPickFiles" class="mtg-add-plus" type="button" aria-label="회의자료 파일 고르기">+</button><input id="mrdFiles" type="file" multiple hidden></div><p class="mtg-note">자료실에도 자동 등록</p><div id="mrdSelectedFiles" class="mtg-file-list" aria-live="polite"></div><div id="mrdMaterials" class="mtg-file-list"></div><div id="mrdStatus" class="status"></div></section></div><div id="mrdEditor" class="hidden"><fieldset class="meeting-entry-section"><legend>기본정보</legend><label>회의명<input id="mrdEditTitle" type="text"></label><label>차수<input id="mrdEditRound" type="number" min="1"></label><div class="two-col"><label>일시<input id="mrdEditAt" type="hidden" data-datetime-input="일시"></label><label>프로젝트<select id="mrdEditProject"></select></label></div></fieldset><fieldset class="meeting-entry-section"><legend>회의 결과</legend><label>회의 결과 원문<textarea id="mrdEditTranscript" rows="10"></textarea></label><label>특이사항 <span class="optional">선택</span><textarea id="mrdEditNotes" rows="4"></textarea></label></fieldset><div class="mrd-editor-actions"><button id="mrdCancelEdit" class="secondary" type="button">취소</button><button id="mrdSaveEdit" class="primary" type="button">수정 저장</button></div><div id="mrdEditStatus" class="status"></div></div></div></div>`);bindDateTimeFields(document.querySelector('#meetingRoundDetailModal'));document.querySelector('#mrdClose').onclick=mrdClose;mrdBindBasketSend();document.querySelector('#mrdPickFiles').onclick=()=>document.querySelector('#mrdFiles').click();document.querySelector('#mrdFiles').addEventListener('change',mrdSelectFiles);document.querySelector('#mrdSelectedFiles').addEventListener('click',mrdRemoveFile);document.querySelector('#mrdEdit').onclick=mrdStartEdit;document.querySelector('#mrdDelete').onclick=mrdDeleteMeeting;document.querySelector('#mrdCancelEdit').onclick=()=>mrdSetEdit(false);document.querySelector('#mrdSaveEdit').onclick=mrdSaveEdit;document.querySelector('#mrdAddTask').onclick=mrdToggleTaskForm;bindDue(document.querySelector('#mrdTaskDue'));document.querySelector('#mrdTaskTitle').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();mrdSaveTask()}});bindDropTarget(document.querySelector('#meetingRoundDetailModal .meeting-round-detail-card'),files=>mrdAddFiles(files),()=>!!mrdCurrent&&!document.querySelector('#mrdView')?.classList.contains('hidden'));document.querySelector('#mrdTaskCancel').onclick=mrdResetTaskForm;document.querySelector('#mrdTaskSave').onclick=mrdSaveTask;document.querySelector('#mrdTasks').addEventListener('click',mrdTaskClick)}
function mrdOpen(){const m=document.querySelector('#meetingRoundDetailModal'),wasHidden=m.classList.contains('hidden'),trigger=document.activeElement;m.classList.remove('hidden');m.setAttribute('aria-hidden','false');if(wasHidden)window.KPTUA11y?.dialog.activate(m,{trigger,initialFocus:'#mrdClose',onRequestClose:mrdClose})}
function mrdClose(){mrdRequestEpoch++;const m=document.querySelector('#meetingRoundDetailModal');m.classList.add('hidden');m.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate(m,{restoreFocus:true,fallbackFocus:'#newMeetingBtn'});m.dataset.meetingId='';mrdCurrent=null;mrdBasketDoneId='';mrdTasks=[];mrdUploadEntries=[];mrdRenderSelectedFiles();mrdResetTaskForm();mrdSetEdit(false)}
function mrdSetEdit(on){if(!on){mrdEditSequence++;mrdEditor=null}document.querySelector('#mrdView')?.classList.toggle('hidden',on);document.querySelector('#mrdEditor')?.classList.toggle('hidden',!on);document.querySelector('#mrdHeadActions')?.classList.toggle('hidden',on)}
function mrdResetTaskForm(){mrdEditingTask=null;const f=document.querySelector('#mrdTaskForm');f?.classList.add('hidden');document.querySelector('#mrdAddTask')?.setAttribute('aria-expanded','false');const title=document.querySelector('#mrdTaskTitle'),due=document.querySelector('#mrdTaskDue'),save=document.querySelector('#mrdTaskSave'),st=document.querySelector('#mrdTaskStatus');if(title)title.value='';if(due){due.value='';paintDue(due)}if(save){save.textContent='추가';save.disabled=mrdSavingTask}document.querySelector('#mrdTaskCancel')?.classList.add('hidden');if(st){st.textContent='';st.className='status'}}
function mrdOpenTaskForm(task=null){if(!mrdCurrent||!mrdCanEdit(mrdCurrent))return;mrdEditingTask=task;const f=document.querySelector('#mrdTaskForm');f?.classList.remove('hidden');document.querySelector('#mrdAddTask')?.setAttribute('aria-expanded','true');document.querySelector('#mrdTaskTitle').value=task?.title||'';const due=document.querySelector('#mrdTaskDue');due.value=mrdDueDateValue(task?.due);paintDue(due);document.querySelector('#mrdTaskSave').textContent=task?'저장':'추가';document.querySelector('#mrdTaskCancel')?.classList.toggle('hidden',!task);const st=document.querySelector('#mrdTaskStatus');st.textContent='';st.className='status';queueMicrotask(()=>document.querySelector('#mrdTaskTitle')?.focus())}
// UI-회의결과창정리: 제목 옆 작은 +는 입력 한 줄을 열고 닫는다(수정 중이면 새 할 일 입력으로 바꾼다).
function mrdToggleTaskForm(){const open=!document.querySelector('#mrdTaskForm')?.classList.contains('hidden');if(open&&!mrdEditingTask){mrdResetTaskForm();document.querySelector('#mrdAddTask')?.focus();return}mrdOpenTaskForm()}
function mrdRenderTasks(){const box=document.querySelector('#mrdTasks');if(!box)return;mrdTaskMenu?.close();const editable=mrdCanEdit(mrdCurrent);box.innerHTML=mrdTasks.length?mrdTasks.map(t=>`<div class="gt-row gt-side-row ${t.status==='completed'?'completed':'pending'}" data-mrd-task="${mrdEsc(t.id)}"><button class="gt-check" type="button" data-mrd-task-toggle="${mrdEsc(t.id)}" aria-label="${t.status==='completed'?'완료 취소':'완료'}"></button>${editable?`<button class="gt-main mrd-task-main" type="button" data-mrd-task-edit="${mrdEsc(t.id)}">`:'<div class="gt-main mrd-task-main">'}<b>${mrdEsc(t.title||'제목 없음')}</b>${t.due?`<div class="gt-meta"><span class="gt-due">${mrdEsc(dueText(mrdDueDateValue(t.due)))}</span></div>`:''}${editable?'</button>':'</div>'}${editable?`<button class="icon-btn gt-menu-trigger" type="button" data-mrd-task-menu="${mrdEsc(t.id)}" aria-label="할 일 관리: ${mrdEsc(t.title||'제목 없음')}" aria-expanded="false" aria-controls="mrdTaskMenu">⋯</button>`:''}</div>`).join(''):'<p class="mtg-empty">후속 할 일이 없습니다.</p>';document.querySelector('#mrdAddTask')?.classList.toggle('hidden',!editable)}
// 할 일 화면과 같은 ⋯ 메뉴(수정·삭제). 창 안에 붙여 포커스가 창을 벗어나지 않게 한다.
let mrdTaskMenu=null;
function mrdEnsureTaskMenu(){if(mrdTaskMenu)return mrdTaskMenu;mrdTaskMenu=createAnchoredMenu({id:'mrdTaskMenu',className:'gt-task-menu',label:'후속 할 일 관리',historyKey:'kptuMeetingTaskMenu',parent:document.querySelector('#meetingRoundDetailModal'),key:trigger=>trigger.dataset.mrdTaskMenu,canOpen:()=>mrdCanEdit(mrdCurrent),render:()=>'<button type="button" data-mrd-menu-action="edit">수정</button><button type="button" class="gt-menu-danger" data-mrd-menu-action="delete">삭제</button>',onAction:(button,active)=>{const t=mrdTasks.find(x=>x.id===active.id);if(!t)return;if(button.dataset.mrdMenuAction==='edit')mrdOpenTaskForm(t);else mrdDeleteTask(t,active.trigger)}});return mrdTaskMenu}
async function mrdSaveTask(){if(mrdSavingTask||!mrdCurrent)return;const meeting=mrdCurrent,task=mrdEditingTask,epoch=mrdRequestEpoch;const title=document.querySelector('#mrdTaskTitle')?.value.trim()||'',due=document.querySelector('#mrdTaskDue')?.value||'',st=document.querySelector('#mrdTaskStatus'),btn=document.querySelector('#mrdTaskSave');if(!title){st.textContent='할 일을 입력해 주세요.';st.className='status error';return}mrdSavingTask=true;btn.disabled=true;st.textContent=task?'수정 중…':'등록 중…';st.className='status';const stillCurrent=()=>epoch===mrdRequestEpoch&&mrdCurrent?.id===meeting.id;try{const action=task?'update':'create',body=task?{action,task_id:task.id,task_list_id:task.taskListId||null,title,due:due||null,notes:task.notes||''}:{action,title,due:due||null,notes:'',links:mrdTaskLinks(meeting)};const result=await mrdApi(mrdTaskEndpoint(action),{method:'POST',body});if(result?.link_error)throw new Error('Google 할 일은 만들었지만 회의 연결을 저장하지 못했습니다.');window.dispatchEvent(new CustomEvent('kptu:tasks-changed'));if(!stillCurrent())return;mrdResetTaskForm();await mrdOpenMeeting(meeting.id)}catch(e){if(stillCurrent()){st.textContent=e.message||String(e);st.className='status error'}}finally{mrdSavingTask=false;btn.disabled=false}}
async function mrdTaskClick(e){
  const mb=e.target.closest('[data-mrd-task-menu]');
  if(mb){mrdEnsureTaskMenu().open(mb);return}
  const eb=e.target.closest('[data-mrd-task-edit]');
  if(eb){const t=mrdTasks.find(x=>x.id===eb.dataset.mrdTaskEdit);if(t)mrdOpenTaskForm(t);return}
  const tb=e.target.closest('[data-mrd-task-toggle]');
  if(tb){
    const t=mrdTasks.find(x=>x.id===tb.dataset.mrdTaskToggle),meeting=mrdCurrent,epoch=mrdRequestEpoch,g=window.KPTUGoogleTasks;
    if(!t||!meeting||!g?.toggleTask)return;
    const want=t.status!=='completed',seq=(mrdTaskToggleSeq.get(t.id)||0)+1;
    mrdTaskToggleSeq.set(t.id,seq);
    mrdTasks=mrdTasks.map(x=>x.id===t.id?{...x,status:want?'completed':'needsAction',completed:want?new Date().toISOString():null}:x);
    mrdRenderTasks();
    try{
      await g.toggleTask(t);
      if(epoch!==mrdRequestEpoch||mrdCurrent?.id!==meeting.id||mrdTaskToggleSeq.get(t.id)!==seq)return;
      await mrdOpenMeeting(meeting.id);
      const saved=mrdTasks.find(x=>x.id===t.id);
      if(saved&&(saved.status==='completed')!==want)alert(want?'완료를 저장하지 못해 되돌렸습니다':'완료 취소를 저장하지 못해 되돌렸습니다');
      else window.dispatchEvent(new CustomEvent('kptu:tasks-changed'));
    }catch(err){if(epoch===mrdRequestEpoch&&mrdCurrent?.id===meeting.id)alert(err.message||String(err))}
    return;
  }
}
async function mrdDeleteTask(t,trigger){const meeting=mrdCurrent,epoch=mrdRequestEpoch;if(!t||!meeting||!confirm(`“${t.title}” Google 할 일을 삭제할까요?`))return;if(trigger)trigger.disabled=true;try{await mrdApi(mrdTaskEndpoint('delete'),{method:'POST',body:{action:'delete',task_id:t.id,task_list_id:t.taskListId||null}});window.dispatchEvent(new CustomEvent('kptu:tasks-changed'));if(epoch===mrdRequestEpoch&&mrdCurrent?.id===meeting.id)await mrdOpenMeeting(meeting.id)}catch(err){if(epoch===mrdRequestEpoch&&mrdCurrent?.id===meeting.id){alert(err.message||String(err));if(trigger)trigger.disabled=false}}}
async function mrdDownload(id){try{const d=await mrdApi('/functions/v1/workspace-drive?action=download-token',{method:'POST',body:{document_id:id}});location.href=d.url}catch(e){alert(e.message)}}
function mrdRenderMaterials(docs){
    // UI-회의결과창정리: 파일 한 줄(종류·이름·크기). 이름을 누르면 내려받고, ×는 기존 삭제 확인을 거친다.
    document.querySelector('#mrdMaterials').innerHTML=(docs||[]).length?docs.map(d=>{const name=d.file_name||d.title;return fileLine({name,meta:[d.title&&d.title!==name?d.title:'',d.file_size?Math.max(1,Math.round(d.file_size/1024))+'KB':''].filter(Boolean).join(' · '),cls:'mrd-file-row',end:`<button class="file-line-open" type="button" data-mrd-download="${mrdEsc(d.id)}" aria-label="${mrdEsc(name)} 내려받기"></button><button class="icon-btn file-line-x" type="button" data-mrd-delete-document="${mrdEsc(d.id)}" aria-label="${mrdEsc(name)} 삭제">×</button>`})}).join(''):(mrdUploadEntries.length?'':'<p class="mtg-empty">회의자료가 없습니다.</p>');
    if(mrdUploadEntries.some(e=>e.kind==='success')){mrdUploadEntries=mrdUploadEntries.filter(e=>e.kind!=='success');mrdRenderSelectedFiles()}
    document.querySelectorAll('[data-mrd-delete-document]').forEach(b=>b.onclick=e=>{e.stopPropagation();return mrdDeleteMaterial(b,docs)});
    document.querySelectorAll('[data-mrd-download]').forEach(b=>b.onclick=e=>{e.stopPropagation();mrdDownload(b.dataset.mrdDownload)});
}
async function mrdDeleteMaterial(button,docs){
  if(button.disabled)return;
  const id=button.dataset.mrdDeleteDocument,scope=mrdDeleteScope(),meetingId=mrdCurrent?.id;
  if(typeof id!=='string'||!id.trim())return;
  if(!scope){alert('로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 자료 목록과 원본 상태를 먼저 확인해 주세요.');return}
  const token=Object.freeze({id,scope:Object.freeze(scope),meetingId,requestEpoch:mrdRequestEpoch});
  mrdDeleteTokens.add(token);
  const isCurrent=()=>mrdDeleteCurrent(token);
  button.disabled=true;
  try{
    const d=docs.find(d=>d.id===token.id);
    if(!isCurrent()||d?.id!==token.id||d.workspace_id!==scope.workspace)return;
    const registration=Object.freeze({...d});
    let helper;
    try{helper=await import('./document-delete.js')}
    catch{if(isCurrent())alert('자료를 삭제하지 못했습니다. 관리자에게 오류 확인을 요청해 주세요.');return}
    if(isCurrent())await helper.deleteDocument(registration,{api:mrdApi,role:mrdRole,expectedSessionEpoch:scope.epoch,isCurrent});
  }finally{mrdDeleteTokens.delete(token);button.disabled=false}
}
let mrdMaterialsRefreshing=false,mrdMaterialsDirty=false;
async function mrdRefreshMaterials(){
  mrdMaterialsDirty=true;
  if(mrdMaterialsRefreshing)return;
  mrdMaterialsRefreshing=true;
  try{
    // A second change during the shared GET must get a fresh read after it settles.
    while(mrdMaterialsDirty){
      mrdMaterialsDirty=false;
      const id=mrdCurrent?.id,epoch=mrdRequestEpoch;
      if(!id)break;
      try{
        const docs=await mrdApi('/rest/v1/app_documents?meeting_id=eq.'+encodeURIComponent(id)+'&select=*&order=created_at.asc');
        if(!mrdMaterialsDirty&&epoch===mrdRequestEpoch&&mrdCurrent?.id===id)mrdRenderMaterials(docs);
      }catch(e){if(epoch===mrdRequestEpoch&&mrdCurrent?.id===id){const st=document.querySelector('#mrdStatus');st.textContent=e.message||String(e);st.className='status error'}}
    }
  }finally{mrdMaterialsRefreshing=false}
}
window.addEventListener('kptu:documents-changed',mrdRefreshMaterials);
function mrdRenderMeetingInfo(m){
    const name=mrdMeetingName(m)||'회의 결과',legacyTitle=mrdLegacyTitle(m);
    document.querySelector('#mrdTitle').textContent=name;
    document.querySelector('#mrdMeta').textContent=[legacyTitle?`기존 제목: ${legacyTitle}`:null,m.round_no?`${m.round_no}차`:null,mrdFmt(m.meeting_at),m.project_id?mrdProjects.find(x=>x.id===m.project_id)?.name:null].filter(Boolean).join(' · ');
    document.querySelector('#mrdResult').textContent=mrdResultText(m);{const st=document.querySelector('#mrdBasketStatus');st.textContent='';st.className='status';mrdPickedText='';mrdPaintBasketButton()}
    const special=String(m.notes||''),specialSection=document.querySelector('#mrdSpecialSection');specialSection.classList.toggle('hidden',!special.trim());document.querySelector('#mrdSpecial').textContent=special;
}
async function mrdOpenMeeting(id){
  const epoch=++mrdRequestEpoch;
  mrdEditSequence++;mrdEditor=null;
  try{
    mrdInstallModal();
    const [mr,docs,tasks]=await Promise.all([
      mrdApi('/rest/v1/app_meetings?id=eq.'+encodeURIComponent(id)+'&select=*&limit=1'),
      mrdApi('/rest/v1/app_documents?meeting_id=eq.'+encodeURIComponent(id)+'&select=*&order=created_at.asc'),
      mrdReadTasks(id)
    ]);
    if(epoch!==mrdRequestEpoch)return;
    const m=mr?.[0];if(!m)throw new Error('회의를 찾을 수 없습니다.');
    if(mrdCurrent?.id!==m.id){mrdUploadEntries=[];mrdRenderSelectedFiles()}mrdCurrent=m;mrdTasks=tasks?.tasks||[];
    const modal=document.querySelector('#meetingRoundDetailModal');modal.dataset.meetingId=id;
    mrdRenderMeetingInfo(m);
    mrdRenderTasks();
    mrdRenderMaterials(docs);
    document.querySelector('#mrdEdit').classList.toggle('hidden',!mrdCanEdit(m));
    document.querySelector('#mrdDelete').classList.toggle('hidden',!mrdCanDelete(m));
    document.querySelector('#mrdStatus').textContent='';
    mrdResetTaskForm();mrdSetEdit(false);mrdOpen();
  }catch(e){if(epoch===mrdRequestEpoch)alert(e.message||String(e))}
}
const mrdEditInputs=['Title','Round','At','Project','Transcript','Notes'];
function mrdEditDraft(){return JSON.stringify(mrdEditInputs.map(key=>document.querySelector('#mrdEdit'+key)?.value??''))}
function mrdEditScope(){const rt=window.KPTURuntime,epoch=rt?.session?.epoch?.(),ctx=rt?.context?.read?.(),owner=rt?.session?.read?.()?.user?.id;return Number.isInteger(epoch)&&epoch>=0&&owner===mrdUser?.id&&ctx?.user?.id===owner&&ctx?.workspace?.id===mrdWorkspace?{owner,workspace:mrdWorkspace,epoch}:null}
function mrdEditSameScope(scope){const now=mrdEditScope();return !!scope&&!!now&&['owner','workspace','epoch'].every(k=>now[k]===scope[k])}
function mrdDeleteScope(){const rt=window.KPTURuntime;if(typeof rt?.api!=='function'||typeof rt.session?.read!=='function'||typeof rt.session?.epoch!=='function'||typeof rt.context?.read!=='function')return null;const scope=mrdEditScope(),session=rt.session.read();return scope&&typeof scope.owner==='string'&&scope.owner.trim()&&typeof scope.workspace==='string'&&scope.workspace.trim()&&typeof session?.access_token==='string'&&session.access_token.trim()?scope:null}
function mrdDeleteCurrent(token){const scope=mrdDeleteScope(),modal=document.querySelector('#meetingRoundDetailModal');if(!mrdDeleteTokens.has(token)||!scope||!['owner','workspace','epoch'].every(key=>scope[key]===token.scope[key])||window.KPTURouter?.current!=='meetings'||!token.meetingId||mrdCurrent?.id!==token.meetingId||mrdCurrent.workspace_id!==token.scope.workspace||token.requestEpoch!==mrdRequestEpoch||!modal||modal.classList.contains('hidden')||modal.getAttribute('aria-hidden')!=='false'||modal.dataset.meetingId!==token.meetingId){mrdDeleteTokens.delete(token);return false}return true}
window.addEventListener('kptu:session-changed',event=>{for(const token of mrdDeleteTokens){const detail=event.detail,session=detail?.session;if(!mrdDeleteCurrent(token)||(detail&&Object.prototype.hasOwnProperty.call(detail,'session')&&(!session?.access_token?.trim?.()||session.user?.id!==token.scope.owner))||(detail&&Object.prototype.hasOwnProperty.call(detail,'epoch')&&detail.epoch!==token.scope.epoch))mrdDeleteTokens.delete(token)}});
window.addEventListener('kptu:view-changed',event=>{for(const token of mrdDeleteTokens)if(event.detail?.view!=='meetings'||event.detail?.source!=='session'||!mrdDeleteCurrent(token))mrdDeleteTokens.delete(token)});
for(const name of ['kptu:dialog-closed','kptu:dialog-opened'])window.addEventListener(name,event=>{if(event.detail?.modal?.id==='meetingRoundDetailModal')mrdDeleteTokens.clear()});
function mrdEditCurrent(e){return mrdEditor===e&&e.sequence===mrdEditSequence&&e.view===mrdRequestEpoch&&mrdCurrent?.id===e.id&&mrdEditSameScope(e.scope)&&!document.querySelector('#mrdEditor')?.classList.contains('hidden')}
function mrdEditKey(e){return [e.scope.owner,e.scope.workspace,e.scope.epoch,e.id].join(':')}
function mrdEditRow(e,rows,body){const row=Array.isArray(rows)&&rows.length===1&&rows[0];if(!row||row.id!==e.id||row.workspace_id!==e.scope.workspace||!Object.entries(body).every(([k,v])=>k==='updated_at'||(k==='meeting_at'?Number.isFinite(Date.parse(row[k]))&&Date.parse(row[k])===Date.parse(v):JSON.stringify(row[k])===JSON.stringify(v))))throw new Error('회의의 저장 결과를 확인하지 못했습니다.');return row}
function mrdEditNotice(e,text,check=false){if(!mrdEditCurrent(e))return;const st=document.querySelector('#mrdEditStatus');st.textContent=text;st.className='status';if(check){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent='저장 결과 확인';b.onclick=()=>mrdCheckEdit(e);st.append(document.createTextNode(' '),b)}}
async function mrdCheckEdit(e){const a=mrdEditAttempts.get(mrdEditKey(e));if(!a||a.pending||a.reading||!mrdEditCurrent(e))return;a.reading=true;const current=()=>mrdEditCurrent(e)&&mrdEditAttempts.get(mrdEditKey(e))===a;try{const rows=await mrdApi(`/rest/v1/app_meetings?id=eq.${encodeURIComponent(e.id)}&workspace_id=eq.${encodeURIComponent(e.scope.workspace)}&select=*`,{expectedSessionEpoch:e.scope.epoch,singleFlight:false});if(!current())return;const row=mrdEditRow(e,rows,a.body);Object.assign(mrdCurrent,row);mrdEditAttempts.delete(mrdEditKey(e));mrdEditNotice(e,'제출한 회의 정보는 확인했습니다. 현재 입력은 남겨두었습니다.')}catch{if(current())mrdEditNotice(e,'저장 결과를 아직 확인하지 못했습니다. 입력을 유지했으며 다시 저장하지 않았습니다.',true)}finally{a.reading=false}}
function mrdStartEdit(){if(!mrdCurrent||!mrdCanEdit(mrdCurrent))return;const editor={id:mrdCurrent.id,scope:mrdEditScope(),view:mrdRequestEpoch,sequence:++mrdEditSequence};mrdEditor=editor;if(editor.scope)mrdEditObservedScope={...editor.scope};const button=document.querySelector('#mrdSaveEdit');button.disabled=false;button.textContent='수정 저장';const input=document.querySelector('#mrdEditTitle');window.KPTUMeetingNames.installPicker(input,'mrdEdit');window.KPTUMeetingNames.setupPicker(document.querySelector('#mrdEditNameSelect'),input,document.querySelector('#mrdEditNameMatch'),document.querySelector('#mrdEditNameUseMatch'),{current:mrdMeetingName(mrdCurrent)});document.querySelector('#mrdEditRound').value=mrdCurrent.round_no??'';document.querySelector('#mrdEditAt').value=mrdDateValue(mrdCurrent.meeting_at);document.querySelector('#mrdEditProject').innerHTML=mrdProjectOptions(mrdCurrent.project_id||'');document.querySelector('#mrdEditTranscript').value=mrdCurrent.transcript_text??'';document.querySelector('#mrdEditNotes').value=mrdCurrent.notes||'';document.querySelector('#mrdEditStatus').textContent='';mrdSetEdit(true);const attempt=editor.scope&&mrdEditAttempts.get(mrdEditKey(editor));if(attempt?.pending){button.disabled=true;button.textContent='앞선 저장 확인 중…';mrdEditNotice(editor,'앞선 저장 결과를 기다리는 중입니다.');attempt.done.then(()=>{if(mrdEditCurrent(editor)){button.disabled=false;button.textContent='수정 저장';mrdEditNotice(editor,'앞선 요청이 끝났습니다. 현재 입력은 유지했습니다.',attempt.state==='unknown')}})}else if(attempt)mrdEditNotice(editor,'앞선 저장 결과를 먼저 확인해 주세요.',true)}
async function mrdRefreshMeetingList(){await window.__KPTU_RELOAD_MEETINGS__?.();window.dispatchEvent(new CustomEvent('kptu:meetings-changed'))}
async function mrdSaveEdit(){
  const e=mrdEditor,st=document.querySelector('#mrdEditStatus');if(!e)return;
  if(!e.scope||!mrdEditSameScope(e.scope)){st.textContent='로그인 상태를 확인하지 못했습니다. 입력은 남겨두었습니다.';st.className='status error';return}
  if(!mrdEditCurrent(e))return;
  const key=mrdEditKey(e),prior=mrdEditAttempts.get(key);if(prior?.pending||prior?.state==='unknown'){mrdEditNotice(e,'앞선 저장 결과를 먼저 확인해 주세요.',!prior.pending);return}
  const name=document.querySelector('#mrdEditTitle').value.trim(),at=document.querySelector('#mrdEditAt').value,transcript=document.querySelector('#mrdEditTranscript').value,notes=document.querySelector('#mrdEditNotes').value;
  if(!name||!at){st.textContent='회의명과 일시를 입력해 주세요.';st.className='status error';return}if(!transcript.trim()){st.textContent='회의 결과 원문을 입력해 주세요.';st.className='status error';return}
  let meetingAt;try{meetingAt=toMeetingISO(at)}catch(err){st.textContent=err.message;st.className='status error';return}
  const roundRaw=document.querySelector('#mrdEditRound').value,body={meeting_at:meetingAt,project_id:document.querySelector('#mrdEditProject').value||null,round_no:roundRaw?Number(roundRaw):null,transcript_text:transcript,notes:notes.trim()?notes:'',updated_at:new Date().toISOString()};
  if(name!==mrdMeetingName(mrdCurrent)){body.title=name;body.series_name=name}
  const a={body,draft:mrdEditDraft(),pending:true,state:'pending'};a.done=new Promise(resolve=>a.finish=resolve);e.request=a;mrdEditAttempts.set(key,a);
  const btn=document.querySelector('#mrdSaveEdit'),label=btn.textContent;btn.disabled=true;btn.textContent='저장 중…';mrdEditNotice(e,'저장 중…');
  try{
    const rows=await mrdApi(`/rest/v1/app_meetings?id=eq.${encodeURIComponent(e.id)}&workspace_id=eq.${encodeURIComponent(e.scope.workspace)}&select=*`,{method:'PATCH',body,prefer:'return=representation',expectedSessionEpoch:e.scope.epoch});
    const row=mrdEditRow(e,rows,body);a.state='confirmed';if(!mrdEditSameScope(e.scope))return;if(mrdEditAttempts.get(key)===a)mrdEditAttempts.delete(key);
    // Keep the same-target saved model current without touching a replacement draft.
    if(mrdCurrent?.id===e.id&&mrdCurrent.workspace_id===e.scope.workspace)Object.assign(mrdCurrent,row);
    if(!mrdEditCurrent(e))return;
    if(mrdEditDraft()!==a.draft){mrdEditNotice(e,'제출한 회의 정보는 저장했습니다. 추가 입력은 남겨두었습니다.');return}
    mrdRenderMeetingInfo(mrdCurrent);btn.disabled=false;btn.textContent=label;mrdSetEdit(false);
    const sequence=mrdEditSequence;await window.__KPTU_RELOAD_MEETINGS__?.();
    if(mrdEditSameScope(e.scope)&&e.view===mrdRequestEpoch&&sequence===mrdEditSequence&&mrdCurrent?.id===e.id)window.dispatchEvent(new CustomEvent('kptu:meetings-changed'));
  }catch(err){if(a.state==='confirmed')return;a.state=[401,403].includes(err?.status)?'rejected':'unknown';if(mrdEditSameScope(e.scope)&&a.state==='rejected'&&mrdEditAttempts.get(key)===a)mrdEditAttempts.delete(key);mrdEditNotice(e,a.state==='rejected'?'회의 수정 권한을 확인해 주세요. 입력은 유지했습니다.':'저장 결과를 확인하지 못했습니다. 입력을 유지했습니다.',a.state==='unknown')}
  finally{a.pending=false;a.finish();if(e.request===a&&mrdEditCurrent(e)){btn.disabled=false;btn.textContent=label}}
}
window.addEventListener('kptu:view-changed',()=>{if(mrdEditor)mrdSetEdit(false)});
window.addEventListener('kptu:session-changed',()=>{if(mrdEditSameScope(mrdEditObservedScope))return;mrdEditObservedScope=null;mrdEditAttempts.clear();mrdEditSequence++;mrdEditor=null;mrdEditInputs.forEach(k=>{const input=document.querySelector('#mrdEdit'+k);if(input)input.value=''})});
window.addEventListener('kptu:dialog-closed',event=>{if(event.detail?.modal?.id==='meetingRoundDetailModal')mrdSetEdit(false)});
async function mrdDeleteMeeting(){const meeting=mrdCurrent,epoch=mrdRequestEpoch;if(!meeting||!mrdCanDelete(meeting))return;if(!confirm(`“${mrdMeetingName(meeting)||meeting.title||'회의'}” 회의 결과를 삭제할까요?\n후속 할 일은 Google 할 일에 남고 자료 파일은 삭제하지 않습니다.`))return;try{await mrdApi('/rest/v1/app_meetings?id=eq.'+encodeURIComponent(meeting.id),{method:'DELETE'});if(epoch===mrdRequestEpoch&&mrdCurrent?.id===meeting.id)mrdClose();await mrdRefreshMeetingList()}catch(e){if(epoch===mrdRequestEpoch&&mrdCurrent?.id===meeting.id)alert(e.message||String(e))}}
// UI-회의결과창정리: 파일을 고르면 바로 올라간다([업로드] 버튼 없음). 아직 차례가 오지 않은 파일은 ×로 뺄 수 있다.
const MRD_STATE_LABEL={pending:'대기',uploading:'올리는 중…',success:'완료'};
function mrdRenderSelectedFiles(){
  const box=document.querySelector('#mrdSelectedFiles');if(!box)return;
  box.innerHTML=mrdUploadEntries.map((entry,index)=>fileLine({name:entry.file.name,state:entry.kind,label:entry.label||MRD_STATE_LABEL[entry.kind]||'',end:['uploading','success'].includes(entry.kind)?'':`<button class="icon-btn file-line-x" type="button" data-mrd-remove-file="${index}" aria-label="${mrdEsc(entry.file.name)} 선택 취소">×</button>`})).join('');
  const empty=document.querySelector('#mrdMaterials > .mtg-empty');if(empty&&mrdUploadEntries.length)empty.remove();
}
function mrdAddFiles(files){if(!mrdCurrent)return;const added=Array.from(files||[]).map(file=>file.size>100*1024*1024?{file,kind:'error',label:'100MB 초과'}:{file,kind:'pending'});if(!added.length)return;mrdUploadEntries=[...mrdUploadEntries.filter(e=>e.kind!=='success'),...added];mrdRenderSelectedFiles();if(added.some(e=>e.kind==='error')){const st=document.querySelector('#mrdStatus');st.textContent='회의자료는 파일당 100MB까지 첨부할 수 있습니다.';st.className='status error'}mrdUploadSelected()}
function mrdSelectFiles(){const input=document.querySelector('#mrdFiles'),files=Array.from(input.files||[]);input.value='';mrdAddFiles(files)}
function mrdRemoveFile(e){const b=e.target.closest('[data-mrd-remove-file]');if(!b)return;const index=Number(b.dataset.mrdRemoveFile),entry=mrdUploadEntries[index];if(!entry||['uploading','success'].includes(entry.kind))return;mrdUploadEntries.splice(index,1);mrdRenderSelectedFiles();const buttons=document.querySelectorAll('[data-mrd-remove-file]');(buttons[Math.min(index,buttons.length-1)]||document.querySelector('#mrdPickFiles')).focus()}
async function mrdUploadSelected(){
  if(mrdUploading)return;
  const id=mrdCurrent?.id,epoch=mrdRequestEpoch,status=document.querySelector('#mrdStatus');
  if(!id||!mrdUploadEntries.some(e=>e.kind==='pending'))return;
  const stillCurrent=()=>epoch===mrdRequestEpoch&&mrdCurrent?.id===id;
  let uploaded=0,failed=0,readFailureMessage='',entry;mrdUploading=true;status.textContent='';status.className='status';
  try{
    // 올리는 동안 더 고른 파일도 같은 차례로 이어서 올린다(한 번에 하나씩).
    while(stillCurrent()&&(entry=mrdUploadEntries.find(e=>e.kind==='pending'))){
      const f=entry.file;entry.kind='uploading';entry.label='';mrdRenderSelectedFiles();
      let fd=null;try{fd=new FormData();fd.append('meeting_id',id);fd.append('file',await window.KPTURuntime.copyUploadFile(f));if(!stillCurrent())break;await mrdApi('/functions/v1/meeting-files',{method:'POST',body:fd});uploaded++;entry.kind='success';entry.label=''}catch(err){failed++;const readFailed=err?.code==='file_read_failed';if(readFailed)readFailureMessage=err.message;entry.kind='error';entry.label=readFailed?err.message:'실패';console.warn('meeting material upload failed',f.name,err)}finally{fd?.delete('file');fd=null}
      if(stillCurrent())mrdRenderSelectedFiles();
    }
    window.dispatchEvent(new CustomEvent('kptu:documents-changed'));
    if(!stillCurrent())return;
    status.textContent=failed?`회의자료 ${uploaded}개 저장 · ${failed}개 실패${readFailureMessage?' · '+readFailureMessage:''}`:(uploaded?'업로드 완료':'');status.className=failed?'status error':'status ok';
    await mrdRefreshMeetingList();
  }finally{mrdUploading=false;mrdRenderSelectedFiles()}
}
async function mrdInit(){const shared=window.KPTURuntime?.context?.read?.()||window.__KPTU_BOOT_CONTEXT__;if(shared?.user?.id&&shared?.workspace?.id){mrdUser=shared.user;mrdWorkspace=shared.workspace.id;mrdRole=shared.membership?.role||null}else{try{mrdUser=await mrdApi('/auth/v1/user')}catch{return false}const ms=await mrdApi('/rest/v1/app_workspace_members?user_id=eq.'+mrdUser.id+'&select=workspace_id,user_id,role&limit=1');if(!ms?.length)return false;mrdWorkspace=ms[0].workspace_id;mrdRole=ms[0].role}const loadedProjects=window.KPTUTeamData?.spaces?.();mrdProjects=Array.isArray(loadedProjects)&&loadedProjects.length?loadedProjects:await mrdApi('/rest/v1/app_spaces?workspace_id=eq.'+mrdWorkspace+'&select=id,name,status,parent_id');mrdInstallModal();const list=document.querySelector('#meetingList');if(list){list.addEventListener('click',e=>{if(e.target.closest('button,a,input,select,textarea,label'))return;const card=e.target.closest('[data-mrd-meeting]');if(card)mrdOpenMeeting(card.dataset.mrdMeeting)});list.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-mrd-meeting]')){e.preventDefault();mrdOpenMeeting(e.target.dataset.mrdMeeting)}})}return true}
window.__KPTU_MEETING_ROUND_DETAIL_READY__=mrdInit().catch(err=>{console.error('meeting detail init',err);return false});
