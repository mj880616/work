import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {meetingInputValue,toMeetingISO,seoulDateKey} from './meeting-time.js';
import {formatMeetingWhen} from './meeting-when.js';
import {bindDateTimeFields} from './time-input.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {pressFile} from './file-actions.js';
import {fileMoreHtml,meetingFileFile} from './meeting-columns.js';
import {dueText,fileLine,bindDue,paintDue,bindDropTarget} from './meeting-compact.js';
import {reportKindOf,reportKindLabel} from './report-kinds.mjs';
import {reportWords,isMeetingKind,showRoundRows} from './report-words.mjs';
import {createFieldRows} from './report-entry-rows.js'; // MTG-보고창정리: [차수]·[짧은 이름] 줄을 칸에 따라 창에 두거나 뺀다
import {pickReportKind,saveReportKind} from './report-kind-sheet.js';
import {targetList,targetsLabel,firstProjectId,sameTarget,summariesChanged} from './report-links-model.mjs';
import {createReportSummaries} from './report-link-summaries.js'; // UPD-요약부품통일 ①: 곳마다 요약 칸 + [AI 요약]
import {readReportTargets,saveReportTargets,locationAvailable,LEGACY_NOTE} from './report-links.js';
import {splitPhotoFiles,splitPhotoDocs} from './activity-photo-model.mjs'; // ACT-사진 3단계: 사진 줄(그림 판단은 자료실과 같은 함수 하나)
import {mountPhotoGrid} from './report-photo-row.js';
import {mountMeetingTodos} from './meeting-todo-candidates.js'; // MTG-후속할일후보: [후속 할 일 만들기] + 후보 줄(정리함 챙길 것과 같은 부품)
let mrdTodos=null,mrdUser=null,mrdWorkspace=null,mrdRole=null,mrdProjects=[],mrdCurrent=null,mrdTasks=[],mrdEditingTask=null,mrdRequestEpoch=0,mrdSavingTask=false,mrdSavingEdit=false;const mrdTaskToggleSeq=new Map();
let mrdEditSequence=0,mrdEditor=null,mrdEditObservedScope=null;const mrdEditAttempts=new Map();
// These tokens own only the lifetime of in-flight UI work, not deletion authority.
const mrdDeleteTokens=new Set();
async function mrdApi(path,options={}){const rt=window.KPTURuntime;if(!rt?.api)throw new Error('공용 런타임을 불러오지 못했습니다.');return rt.api(path,options)}
function mrdEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
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
// 수정 창 짧은 이름 칸의 처음 값: 차수가 없는 회의만 종류 이름과 다른 제목을 짧은 이름으로 본다(차수가 있으면 예전 제목은 "기존 제목"으로만 보인다).
function mrdShortNameStart(m){const r=m?.round_no;return r!=null&&r!==''&&Number.isFinite(Number(r))?'':mrdLegacyTitle(m)}
function mrdLegacyTitle(m){const name=mrdMeetingName(m),title=String(m?.title||'').trim();return title&&name&&title!==name?title:''}
function mrdResultText(m){if(m?.transcript_text!=null&&String(m.transcript_text).length)return String(m.transcript_text);if(String(m?.decisions||'').trim())return `[기존 회의결과 기록]\n${m.decisions}`;return ''}
function mrdInstallModal(){if(document.querySelector('#meetingRoundDetailModal'))return;document.body.insertAdjacentHTML('beforeend',`<div id="meetingRoundDetailModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="mrdTitle"><div class="modal-card medium-card meeting-round-detail-card"><div class="modal-head"><div><h2 id="mrdTitle">사업 보고</h2><p id="mrdMeta" class="muted"></p></div><div class="mrd-head-ends"><button id="mrdMore" class="icon-btn" type="button" data-ctx="area" aria-haspopup="true" aria-expanded="false" aria-label="사업 보고 관리"><span aria-hidden="true">⋯</span></button><button class="icon-btn" id="mrdClose" type="button" aria-label="닫기">×</button></div></div><p id="mrdLoading" class="mtg-note hidden" role="status" aria-live="polite"></p><div id="mrdLeave" class="mrd-leave hidden" role="alert"><span>고친 내용을 저장할까요?</span><button id="mrdLeaveSave" class="mini" type="button">저장</button><button id="mrdLeaveDiscard" class="mini" type="button">버리기</button></div><div id="mrdView"><section id="mrdResultSection" class="mrd-result-section hidden"><h3 id="mrdTextHead">회의 결과 원문</h3><div id="mrdResult" class="mrd-text mrd-result-text"></div></section><section id="mrdSpecialSection" class="mrd-special-section hidden"><h3>특이사항</h3><div id="mrdSpecial" class="mrd-text mrd-special-text"></div></section><section class="mrd-followup-section mtg-group" aria-labelledby="mrdTasksHead"><div class="mtg-group-head"><h3 id="mrdTasksHead">후속 할 일</h3><button id="mrdAddTask" class="mtg-add-plus" type="button" aria-label="후속 할 일 추가" aria-expanded="false" aria-controls="mrdTaskForm">+</button><button id="mrdMakeTodos" class="mini mrd-make-todos" type="button" title="이 사업 보고에서 내 후속 할 일 후보를 AI가 찾아요">후속 할 일 만들기</button></div><div id="mrdTaskForm" class="mtg-task-line hidden" data-enter-save><input id="mrdTaskTitle" type="text" placeholder="후속 할 일" aria-label="후속 할 일"><span class="due-chip"><input id="mrdTaskDue" class="due-chip-input" type="date" aria-label="기한"><span class="due-chip-label" aria-hidden="true">기한 ▾</span></span><button id="mrdTaskSave" data-enter-save-submit class="mtg-line-add" type="button">추가</button><button id="mrdTaskCancel" class="mtg-line-cancel hidden" type="button">취소</button><div id="mrdTaskStatus" class="status"></div></div><p id="mrdTodoLine" class="mtg-note" role="status" aria-live="polite"></p><div id="mrdTodoCand" class="inbox-todo-host mrd-todo-cand" hidden></div><div id="mrdTasks" class="gt-linked gt-list mtg-task-list"></div></section><section class="mrd-photo-section mtg-group" id="mrdPhotoSection" aria-labelledby="mrdPhotosHead"><div class="mtg-group-head"><h3 id="mrdPhotosHead">사진</h3><button id="mrdPickPhotos" class="mtg-add-plus" type="button" aria-label="사진 고르기">+</button><input id="mrdPhotoInput" type="file" accept="image/*" multiple hidden></div><div id="mrdPhotos" class="act-photo-grid" hidden></div><div id="mrdPhotoStatus" class="status" role="status" aria-live="polite"></div></section><section class="mrd-material-section mtg-group" aria-labelledby="mrdMaterialsHead"><div class="mtg-group-head"><h3 id="mrdMaterialsHead">회의자료</h3><button id="mrdPickFiles" class="mtg-add-plus" type="button" aria-label="회의자료 파일 고르기">+</button></div><div id="mrdMaterials" class="mtg-file-list"></div><div id="mrdStatus" class="status"></div></section></div><div id="mrdEditor" class="hidden" data-enter-save="#mrdSaveEdit"><fieldset class="meeting-entry-section"><legend>기본정보</legend><label><span id="mrdEditTitleLabel">회의명</span><input id="mrdEditTitle" type="text"></label><div class="two-col"><label>차수<input id="mrdEditRound" type="number" min="1" placeholder="예: 8"></label><label><span>짧은 이름 <span class="optional">차수가 없을 때</span></span><input id="mrdEditShortName" type="text" maxlength="40" placeholder="예: 파생 간담회"></label></div><div class="two-col"><label>일시<input id="mrdEditAt" type="hidden" data-datetime-input="일시"></label><label id="mrdEditLocationRow" hidden><span>장소 <span class="optional">선택</span></span><input id="mrdEditLocation" type="text" maxlength="200"></label></div><label><span>연결할 곳 <span class="optional">선택</span></span><button id="mrdEditPlaces" class="secondary field-btn" type="button" aria-haspopup="dialog">연결 안 함</button></label><select id="mrdEditProject" hidden aria-hidden="true" tabindex="-1"></select><div id="mrdEditSummaries" class="report-link-summaries" hidden></div></fieldset><fieldset class="meeting-entry-section"><legend data-rw="mrdEditLegend">회의 결과</legend><label><span><span id="mrdEditTextLabel">회의 결과 원문</span> <span class="optional">선택</span></span><textarea id="mrdEditTranscript" rows="10"></textarea></label><label>특이사항 <span class="optional">선택</span><textarea id="mrdEditNotes" rows="4"></textarea></label></fieldset><div id="mrdEditFoot" class="modal-action-footer"><div id="mrdEditStatus" class="status"></div><div id="mrdEditActions" class="mrd-editor-actions"><button id="mrdCancelEdit" class="secondary" type="button">취소</button><button id="mrdSaveEdit" data-enter-save-submit class="primary" type="button">수정 저장</button></div></div></div></div></div>`);bindDateTimeFields(document.querySelector('#meetingRoundDetailModal'));mrdRoundRows=createFieldRows(['mrdEditRound','mrdEditShortName']);document.querySelector('#mrdClose').onclick=mrdClose;document.querySelector('#mrdMore').onclick=e=>mrdEnsureMoreMenu().open(e.currentTarget);document.querySelector('#mrdPickFiles').onclick=()=>void mrdAddFiles([]);document.querySelector('#mrdPickPhotos').onclick=()=>document.querySelector('#mrdPhotoInput').click();document.querySelector('#mrdPhotoInput').onchange=e=>{const input=e.currentTarget,files=Array.from(input.files||[]);input.value='';void mrdAddPhotos(files)};document.querySelector('#mrdEditPlaces').onclick=e=>void mrdChoosePlaces(e.currentTarget);document.querySelector('#mrdCancelEdit').onclick=()=>mrdSetEdit(false);document.querySelector('#mrdSaveEdit').onclick=mrdSaveEdit;document.querySelector('#mrdLeaveSave').onclick=async()=>{const next=mrdLeaveNext;mrdLeaveClear();await mrdSaveEdit();if(!mrdEditor&&next)next()};document.querySelector('#mrdLeaveDiscard').onclick=()=>{const next=mrdLeaveNext;mrdLeaveClear();mrdSetEdit(false);if(next)next()};document.querySelector('#mrdAddTask').onclick=mrdToggleTaskForm;bindDue(document.querySelector('#mrdTaskDue'));bindDropTarget(document.querySelector('#meetingRoundDetailModal .meeting-round-detail-card'),files=>mrdAddFiles(files),()=>!!mrdCurrent&&!document.querySelector('#mrdView')?.classList.contains('hidden'));document.querySelector('#mrdTaskCancel').onclick=mrdResetTaskForm;document.querySelector('#mrdTaskSave').onclick=mrdSaveTask;document.querySelector('#mrdTasks').addEventListener('click',mrdTaskClick);mrdTodos=mountMeetingTodos({button:document.querySelector('#mrdMakeTodos'),host:document.querySelector('#mrdTodoCand'),line:document.querySelector('#mrdTodoLine'),meetingId:()=>mrdCurrent?.id||'',onTasksChanged:mrdRefreshTasks})}
function mrdOpen(){const m=document.querySelector('#meetingRoundDetailModal'),wasHidden=m.classList.contains('hidden'),trigger=document.activeElement;m.classList.remove('hidden');m.setAttribute('aria-hidden','false');if(wasHidden)window.KPTUA11y?.dialog.activate(m,{trigger,initialFocus:'#mrdClose',onRequestClose:mrdClose})}
function mrdClose(){mrdRequestEpoch++;const m=document.querySelector('#meetingRoundDetailModal');if(!mrdDocked){m.classList.add('hidden');m.setAttribute('aria-hidden','true');window.KPTUA11y?.dialog.deactivate(m,{restoreFocus:true,fallbackFocus:'#newMeetingBtn'})}m.dataset.meetingId='';mrdCurrent=null;mrdTodos?.close();mrdMoreMenu?.close();mrdTasks=[];mrdResetTaskForm();mrdSetEdit(false);if(mrdDocked)mrdShowLoading('불러오는 중…');else window.dispatchEvent(new CustomEvent('kptu:report-pane-free'))}
// MTG-보고창정리: 제목 줄 오른쪽 ⋯ 하나가 [수정]·[칸 바꾸기]·[삭제]를 가진다. 우클릭은 공용 context-menu.js가 이 ⋯(data-ctx="area")를 눌러 같은 메뉴를 연다.
// 메뉴 부품은 후속 할 일 ⋯와 같은 공용 앵커 메뉴(anchored-menu.js). 삭제는 기존 휴지통 흐름(mrdDeleteMeeting)을 그대로 쓴다.
let mrdRoundRows=null,mrdMoreMenu=null;
// MTG-고치기바로: 이 창(#meetingRoundDetailModal) 요소 하나가 두 곳에 앉는다. ① 팝업(폰·중간 폭·다른 화면 위) ② PC 사업 보고 화면의 세 번째 칸(붙임, dock).
// 프로젝트(project-system-v3.js)·할 일(google-tasks.js) 화면의 붙임과 같은 방식이다: 요소를 옮기고 겉모양만 칸에 맞춘다. 두 벌을 그리지 않는다.
// 옮기는 곳은 mrdDock·mrdUndock 둘뿐이고, 칸을 그리는 team.js가 다시 그릴 때마다 내렸다가 다시 앉힌다.
let mrdDocked=false,mrdActionsTop=false,mrdEditBase='',mrdLeaveNext=null,mrdEditHistory=false,mrdSkipPop=0,mrdMemo=null;
const mrdModalEl=()=>document.querySelector('#meetingRoundDetailModal');
const mrdSaveLabel=()=>mrdDocked?'저장':'수정 저장';
function mrdPaintMore(editing=false){const b=document.querySelector('#mrdMore');if(b)b.classList.toggle('hidden',editing||!mrdCurrent||!(mrdCanEdit(mrdCurrent)||mrdCanDelete(mrdCurrent)))}
function mrdEnsureMoreMenu(){
  if(mrdMoreMenu)return mrdMoreMenu;
  mrdMoreMenu=createAnchoredMenu({id:'mrdMoreMenu',className:'gt-task-menu mrd-more-menu',label:'사업 보고 관리',historyKey:'kptuMeetingDetailMenu',parent:document.querySelector('#meetingRoundDetailModal'),key:()=>mrdCurrent?.id||'',
    canOpen:()=>!!mrdCurrent&&(mrdCanEdit(mrdCurrent)||mrdCanDelete(mrdCurrent)),
    render:()=>[mrdCanEdit(mrdCurrent)?'<button type="button" data-mrd-more="edit">수정</button><button type="button" data-mrd-more="kind">칸 바꾸기</button>':'',mrdCanDelete(mrdCurrent)?'<button type="button" class="gt-menu-danger" data-mrd-more="delete">삭제</button>':''].join(''),
    onAction:(button,active)=>{const act=button.dataset.mrdMore;if(act==='edit')mrdStartEdit();else if(act==='kind')mrdChangeKind(active.trigger);else if(act==='delete')mrdDeleteMeeting()}});
  return mrdMoreMenu;
}
function mrdSetEdit(on){if(!on){mrdEditSequence++;mrdEditor=null;mrdSummaries?.clear();mrdLeaveClear();mrdEditHistoryEnd()}document.querySelector('#mrdView')?.classList.toggle('hidden',on);document.querySelector('#mrdEditor')?.classList.toggle('hidden',!on);mrdPaintMore(on);mrdPlaceActions(on)}
function mrdResetTaskForm(){mrdEditingTask=null;const f=document.querySelector('#mrdTaskForm');f?.classList.add('hidden');document.querySelector('#mrdAddTask')?.setAttribute('aria-expanded','false');const title=document.querySelector('#mrdTaskTitle'),due=document.querySelector('#mrdTaskDue'),save=document.querySelector('#mrdTaskSave'),st=document.querySelector('#mrdTaskStatus');if(title)title.value='';if(due){due.value='';paintDue(due)}if(save){save.textContent='추가';save.disabled=mrdSavingTask}document.querySelector('#mrdTaskCancel')?.classList.add('hidden');if(st){st.textContent='';st.className='status'}}
function mrdOpenTaskForm(task=null){if(!mrdCurrent||!mrdCanEdit(mrdCurrent))return;mrdEditingTask=task;const f=document.querySelector('#mrdTaskForm');f?.classList.remove('hidden');document.querySelector('#mrdAddTask')?.setAttribute('aria-expanded','true');document.querySelector('#mrdTaskTitle').value=task?.title||'';const due=document.querySelector('#mrdTaskDue');due.value=mrdDueDateValue(task?.due);paintDue(due);document.querySelector('#mrdTaskSave').textContent=task?'저장':'추가';document.querySelector('#mrdTaskCancel')?.classList.toggle('hidden',!task);const st=document.querySelector('#mrdTaskStatus');st.textContent='';st.className='status';queueMicrotask(()=>document.querySelector('#mrdTaskTitle')?.focus())}
// UI-회의결과창정리: 제목 옆 작은 +는 입력 한 줄을 열고 닫는다(수정 중이면 새 할 일 입력으로 바꾼다).
function mrdToggleTaskForm(){const open=!document.querySelector('#mrdTaskForm')?.classList.contains('hidden');if(open&&!mrdEditingTask){mrdResetTaskForm();document.querySelector('#mrdAddTask')?.focus();return}mrdOpenTaskForm()}
function mrdRenderTasks(){const box=document.querySelector('#mrdTasks');if(!box)return;mrdTaskMenu?.close();const editable=mrdCanEdit(mrdCurrent);box.innerHTML=mrdTasks.length?mrdTasks.map(t=>`<div class="gt-row gt-side-row ${t.status==='completed'?'completed':'pending'}" data-mrd-task="${mrdEsc(t.id)}"><button class="gt-check" type="button" data-mrd-task-toggle="${mrdEsc(t.id)}" aria-label="${t.status==='completed'?'완료 취소':'완료'}"></button>${editable?`<button class="gt-main mrd-task-main" type="button" data-mrd-task-edit="${mrdEsc(t.id)}">`:'<div class="gt-main mrd-task-main">'}<b>${mrdEsc(t.title||'제목 없음')}</b>${t.due?`<div class="gt-meta"><span class="gt-due">${mrdEsc(dueText(mrdDueDateValue(t.due)))}</span></div>`:''}${editable?'</button>':'</div>'}${editable?`<button class="icon-btn gt-menu-trigger" type="button" data-mrd-task-menu="${mrdEsc(t.id)}" aria-label="할 일 관리: ${mrdEsc(t.title||'제목 없음')}" aria-expanded="false" aria-controls="mrdTaskMenu">⋯</button>`:''}</div>`).join(''):'<p class="mtg-empty">후속 할 일이 없습니다.</p>';document.querySelector('#mrdAddTask')?.classList.toggle('hidden',!editable);document.querySelector('#mrdMakeTodos')?.classList.toggle('hidden',!editable)}
// [할 일로]로 Google 할 일이 생기면 이 창의 후속 할 일 목록만 다시 읽는다(창을 다시 열지 않음).
async function mrdRefreshTasks(){const meeting=mrdCurrent,epoch=mrdRequestEpoch;if(!meeting)return;try{const r=await mrdReadTasks(meeting.id);if(epoch!==mrdRequestEpoch||mrdCurrent?.id!==meeting.id)return;mrdTasks=r?.tasks||[];mrdRenderTasks()}catch(e){console.warn('meeting task refresh failed',e)}}
// 할 일 화면과 같은 ⋯ 메뉴(수정·삭제). 창 안에 붙여 포커스가 창을 벗어나지 않게 한다.
let mrdTaskMenu=null;
function mrdEnsureTaskMenu(){if(mrdTaskMenu)return mrdTaskMenu;mrdTaskMenu=createAnchoredMenu({id:'mrdTaskMenu',className:'gt-task-menu',label:'후속 할 일 관리',historyKey:'kptuMeetingTaskMenu',parent:document.querySelector('#meetingRoundDetailModal'),key:trigger=>trigger.dataset.mrdTaskMenu,canOpen:()=>mrdCanEdit(mrdCurrent),render:()=>'<button type="button" data-mrd-menu-action="edit">수정</button><button type="button" class="gt-menu-danger" data-mrd-menu-action="delete">삭제</button>',onAction:(button,active)=>{const t=mrdTasks.find(x=>x.id===active.id);if(!t)return;if(button.dataset.mrdMenuAction==='edit')mrdOpenTaskForm(t);else mrdDeleteTask(t,active.trigger)}});return mrdTaskMenu}
async function mrdSaveTask(){if(mrdSavingTask||!mrdCurrent)return;const meeting=mrdCurrent,task=mrdEditingTask,epoch=mrdRequestEpoch;const title=document.querySelector('#mrdTaskTitle')?.value.trim()||'',due=document.querySelector('#mrdTaskDue')?.value||'',st=document.querySelector('#mrdTaskStatus'),btn=document.querySelector('#mrdTaskSave');if(!title){st.textContent='할 일을 입력해 주세요.';st.className='status error';return}mrdSavingTask=true;btn.disabled=true;st.textContent=task?'수정 중…':'등록 중…';st.className='status';const stillCurrent=()=>epoch===mrdRequestEpoch&&mrdCurrent?.id===meeting.id;try{const action=task?'update':'create',body=task?{action,task_id:task.id,task_list_id:task.taskListId||null,title,due:due||null,notes:task.notes||''}:{action,title,due:due||null,notes:'',links:mrdTaskLinks(meeting)};const result=await mrdApi(mrdTaskEndpoint(action),{method:'POST',body});if(result?.link_error)throw new Error('Google 할 일은 만들었지만 사업 보고 연결을 저장하지 못했습니다.');window.dispatchEvent(new CustomEvent('kptu:tasks-changed'));if(!stillCurrent())return;mrdResetTaskForm();await mrdReload(meeting.id)}catch(e){if(stillCurrent()){st.textContent=e.message||String(e);st.className='status error'}}finally{mrdSavingTask=false;btn.disabled=false}}
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
      await mrdReload(meeting.id);
      const saved=mrdTasks.find(x=>x.id===t.id);
      if(saved&&(saved.status==='completed')!==want)alert(want?'완료를 저장하지 못해 되돌렸습니다':'완료 취소를 저장하지 못해 되돌렸습니다');
      else window.dispatchEvent(new CustomEvent('kptu:tasks-changed'));
    }catch(err){if(epoch===mrdRequestEpoch&&mrdCurrent?.id===meeting.id)alert(err.message||String(err))}
    return;
  }
}
async function mrdDeleteTask(t,trigger){const meeting=mrdCurrent,epoch=mrdRequestEpoch;if(!t||!meeting||!confirm(`“${t.title}” Google 할 일을 삭제할까요?`))return;if(trigger)trigger.disabled=true;try{await mrdApi(mrdTaskEndpoint('delete'),{method:'POST',body:{action:'delete',task_id:t.id,task_list_id:t.taskListId||null}});window.dispatchEvent(new CustomEvent('kptu:tasks-changed'));if(epoch===mrdRequestEpoch&&mrdCurrent?.id===meeting.id)await mrdReload(meeting.id)}catch(err){if(epoch===mrdRequestEpoch&&mrdCurrent?.id===meeting.id){alert(err.message||String(err));if(trigger)trigger.disabled=false}}}
// FILE-누르면동작: 자료 줄을 누르면 종류별 동작(file-actions.js). docs는 이 창이 그린 자료 목록.
async function mrdDownload(id,docs=[]){const d=docs.find(x=>x.id===id);if(!d)return;await pressFile(meetingFileFile(d),{api:mrdApi,onError:m=>alert(m)})}
function mrdRenderMaterials(allDocs){
    // ACT-사진 3단계: 그림은 '사진' 줄(작은 그림), 나머지는 아래 자료 줄. 같은 자료 목록을 그리는 곳만 둘로 나눈다.
    const {photos,files:docs}=splitPhotoDocs(allDocs);mrdRenderPhotos(photos,allDocs);
    // UI-회의결과창정리: 파일 한 줄(종류·이름·크기). 이름을 누르면 종류별 동작, ⋯는 [Drive에서 열기]·[내려받기](FILE-사업보고⋯), ×는 기존 삭제 확인을 거친다.
    document.querySelector('#mrdMaterials').innerHTML=(docs||[]).length?docs.map(d=>{const name=d.file_name||d.title;return fileLine({name,meta:[d.title&&d.title!==name?d.title:'',d.file_size?Math.max(1,Math.round(d.file_size/1024))+'KB':''].filter(Boolean).join(' · '),cls:'mrd-file-row',end:`<button class="file-line-open" type="button" data-mrd-download="${mrdEsc(d.id)}" aria-label="${mrdEsc(name)} 열기"></button>${fileMoreHtml(d,name)}<button class="icon-btn file-line-x" type="button" data-mrd-delete-document="${mrdEsc(d.id)}" aria-label="${mrdEsc(name)} 삭제">×</button>`})}).join(''):`<p class="mtg-empty">${mrdEsc(reportWords(reportKindOf(mrdCurrent)).materialsEmpty)}</p>`;
    document.querySelectorAll('[data-mrd-delete-document]').forEach(b=>b.onclick=e=>{e.stopPropagation();return mrdDeleteMaterial(b,allDocs)});
    document.querySelectorAll('[data-mrd-download]').forEach(b=>b.onclick=e=>{e.stopPropagation();mrdDownload(b.dataset.mrdDownload,docs)});
}
async function mrdDeleteMaterial(button,docs){
  if(button.disabled)return false;
  return mrdDeleteDocumentById(button.dataset.mrdDeleteDocument,docs,button);
}
// 자료 줄 ×와 사진 크게 보기 ⋯ [지우기]가 같은 삭제 길 하나를 쓴다. 지웠으면 true.
async function mrdDeleteDocumentById(id,docs,button=null){
  const scope=mrdDeleteScope(),meetingId=mrdCurrent?.id;
  if(typeof id!=='string'||!id.trim())return false;
  if(!scope){alert('로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 자료 목록과 원본 상태를 먼저 확인해 주세요.');return false}
  const token=Object.freeze({id,scope:Object.freeze(scope),meetingId,requestEpoch:mrdRequestEpoch});
  mrdDeleteTokens.add(token);
  const isCurrent=()=>mrdDeleteCurrent(token);
  if(button)button.disabled=true;
  try{
    const d=docs.find(d=>d.id===token.id);
    if(!isCurrent()||d?.id!==token.id||d.workspace_id!==scope.workspace)return false;
    const registration=Object.freeze({...d});
    let helper;
    try{helper=await import('./document-delete.js')}
    catch{if(isCurrent())alert('자료를 삭제하지 못했습니다. 관리자에게 오류 확인을 요청해 주세요.');return false}
    return isCurrent()?(await helper.deleteDocument(registration,{api:mrdApi,role:mrdRole,expectedSessionEpoch:scope.epoch,isCurrent}))===true:false;
  }finally{mrdDeleteTokens.delete(token);if(button)button.disabled=false}
}
// ACT-사진 3단계: 사진 줄. 편집할 수 없는 사람은 사진이 없으면 줄을 감춘다. 크게 보기 ⋯ [지우기]는 자료 줄 ×와 같은 삭제 길이다.
function mrdRenderPhotos(photos,allDocs){
  const section=document.querySelector('#mrdPhotoSection'),box=document.querySelector('#mrdPhotos'),head=document.querySelector('#mrdPhotosHead');if(!section||!box)return;
  const canEdit=!!mrdCurrent&&mrdCanEdit(mrdCurrent);
  section.hidden=!canEdit&&!photos.length;head.textContent=photos.length?`사진 ${photos.length}`:'사진';
  document.querySelector('#mrdPickPhotos').hidden=!canEdit;
  mountPhotoGrid(box,photos,{api:mrdApi,onError:m=>alert(m),extraActions:(file,doc)=>doc?[{label:'지우기',run:()=>mrdDeleteDocumentById(doc.id,allDocs)}]:[]});
}
async function mrdEnsureLibrary(fail){
  const loader=window.KPTUViewLoader;
  try{if(!loader?.load)throw new Error('no loader');if(!loader.isLoaded?.('library'))await loader.load('library');if(!(await window.__KPTU_LIBRARY_UPLOAD_READY__))throw new Error('not ready')}catch{fail('자료실을 불러오지 못했습니다.');return false}
  return true;
}
let mrdPhotoBusy=false;
// 사진은 자료실 올리기 창을 거치지 않고 바로 올린다(같은 library-files 요청, AI 분류 없음). 종류는 이 사업 보고의 칸을 따라가고 날짜는 사업 보고 날짜다.
async function mrdAddPhotos(files){
  const m=mrdCurrent;if(!m||!mrdCanEdit(m))return;
  const st=document.querySelector('#mrdPhotoStatus'),say=(text,cls='status')=>{if(mrdCurrent?.id===m.id){st.textContent=text;st.className=cls}};
  const {photos}=splitPhotoFiles(files);
  if(!photos.length){if((files||[]).length)say('사진 파일만 올릴 수 있어요.','status error');return}
  if(mrdPhotoBusy){say('사진을 올리는 중이에요. 끝나면 다시 눌러 주세요.','status error');return}
  mrdPhotoBusy=true;
  try{
    if(!(await mrdEnsureLibrary(t=>say(t,'status error'))))return;
    let done=0,failed=0,why='';
    for(const [i,file] of photos.entries()){
      say(`사진 올리는 중 ${i+1}/${photos.length}`);
      try{await window.KPTULibrary.uploadFileForMeeting({id:m.id,project_id:m.project_id||'',kind:reportKindOf(m),day:seoulDateKey(m.meeting_at)},file);done++}
      catch(err){failed++;why=err?.message||why;console.warn('report photo upload failed',file.name,err)}
    }
    if(done){if(m.project_id)window.KPTUDriveSummary?.saved?.();window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:m.project_id||null,meeting_id:m.id}}))}
    say(failed?`사진 ${done}장 올림 · ${failed}장 실패${why?' · '+why:''}`:`사진 ${done}장을 올렸어요.`,failed?'status error':'status ok');
  }finally{mrdPhotoBusy=false}
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
// MTG-사업보고 6단계: 연결(프로젝트·담당조직)은 연결 표의 '출처 회의' 줄(report-links.js). 머리 줄은 '연결 첫 곳 외 N', 고치기는 [연결할 곳].
const mrdLinkRefreshed=new Set();
let mrdEditTargets=[],mrdEditTargetsStart=[],mrdEditTargetsTouched=false;const mrdNames=new Map();
const mrdTkey=t=>t.kind+':'+t.id;
function mrdTargetName(t){return window.KPTUTeamData?.targetName?.(t)||mrdNames.get(mrdTkey(t))||(t.kind==='project'?mrdProjects.find(x=>x.id===t.id)?.name:'')||(t.kind==='project'?'프로젝트':'담당조직')}
function mrdLinkText(m){const label=window.KPTUTeamData?.reportLabel?.(m)||(m.project_id?mrdProjects.find(x=>x.id===m.project_id)?.name:'');return label?`연결 ${label}`:null}
let mrdSummaries=null;
function mrdSummaryBox(){if(!mrdSummaries){const host=document.querySelector('#mrdEditSummaries');if(!host)return null;mrdSummaries=createReportSummaries({host,nameOf:mrdTargetName,meetingId:()=>mrdEditor?.id||null,rt:window.KPTURuntime})}return mrdSummaries}
function mrdPaintPlaces(){const b=document.querySelector('#mrdEditPlaces');if(b)b.textContent=targetsLabel(mrdEditTargets,mrdTargetName,'연결 안 함')}
async function mrdChoosePlaces(trigger){
  const st=document.querySelector('#mrdEditStatus');
  try{const sheet=await import('./report-places-sheet.js');
    await sheet.pickReportPlaces(trigger,{chosen:mrdEditTargets,onMessage:msg=>{st.textContent=msg;st.className='status error'},onCommit:async list=>{
      const places=await sheet.loadReportPlaces().catch(()=>null);mrdEditTargets=targetList(list);mrdEditTargetsTouched=true;
      if(places)mrdEditTargets.forEach(t=>mrdNames.set(mrdTkey(t),sheet.targetName(places,t)));mrdPaintPlaces();mrdSummaryBox()?.setTargets(mrdEditTargets)}})}
  catch(err){st.textContent=err.message||'연결할 곳을 불러오지 못했습니다.';st.className='status error'}
}
// MTG-사업보고말바꾸기: 칸에 따라 창 글자가 바뀐다([회의] 칸만 회의 말, 나머지는 제목·원문·자료). 정하는 곳은 report-words.mjs 하나.
function mrdPaintWords(m){
  const kind=reportKindOf(m),w=reportWords(kind),set=(sel,text)=>{const el=document.querySelector(sel);if(el)el.textContent=text};
  const modal=document.querySelector('#meetingRoundDetailModal');if(modal)modal.dataset.reportKind=kind;
  set('#mrdTextHead',w.textLabel);set('#mrdMaterialsHead',w.materials);set('#mrdEditTitleLabel',w.nameLabel);set('[data-rw="mrdEditLegend"]',w.resultLegend);set('#mrdEditTextLabel',w.textLabel);
  document.querySelector('#mrdPickFiles')?.setAttribute('aria-label',w.pickFiles);
}
function mrdRenderMeetingInfo(m){
    const name=mrdMeetingName(m)||'사업 보고',legacyTitle=mrdLegacyTitle(m);
    document.querySelector('#mrdTitle').textContent=name;if(mrdDocked)mrdModalEl()?.setAttribute('aria-label',name);mrdPaintWords(m);
    document.querySelector('#mrdMeta').textContent=[`${reportKindLabel(reportKindOf(m))} 칸`,legacyTitle?(m.round_no?`기존 제목: ${legacyTitle}`:legacyTitle):null,(mrdDocked||!m.round_no)?null:`${m.round_no}차`,formatMeetingWhen(m,{year:'numeric'}),m.location&&String(m.location).trim()?`장소 ${String(m.location).trim()}`:null,mrdLinkText(m)].filter(Boolean).join(' · ');
    if(!mrdLinkRefreshed.has(m.id)){mrdLinkRefreshed.add(m.id);Promise.resolve(window.KPTUTeamData?.refreshReportLinks?.()).then(()=>{if(mrdCurrent?.id===m.id)mrdRenderMeetingInfo(mrdCurrent)},()=>{})}
    {const text=mrdResultText(m);document.querySelector('#mrdResultSection').classList.toggle('hidden',!text);document.querySelector('#mrdResult').textContent=text}
    const special=String(m.notes||''),specialSection=document.querySelector('#mrdSpecialSection');specialSection.classList.toggle('hidden',!special.trim());document.querySelector('#mrdSpecial').textContent=special;
}
// 사업 보고 한 건을 읽어 창 안(보기 면)에 채운다. 팝업으로 열든 세 번째 칸에 붙이든 같은 길이다.
async function mrdLoadMeeting(id,epoch){
  const [mr,docs,tasks]=await Promise.all([
    mrdApi('/rest/v1/app_meetings?id=eq.'+encodeURIComponent(id)+'&select=*&limit=1'),
    mrdApi('/rest/v1/app_documents?meeting_id=eq.'+encodeURIComponent(id)+'&select=*&order=created_at.asc'),
    mrdReadTasks(id)
  ]);
  if(epoch!==mrdRequestEpoch)return false;
  const m=mr?.[0];if(!m)throw new Error('사업 보고를 찾을 수 없습니다.');
  mrdCurrent=m;mrdTasks=tasks?.tasks||[];{const ps=document.querySelector('#mrdPhotoStatus');if(ps){ps.textContent='';ps.className='status'}}
  const modal=document.querySelector('#meetingRoundDetailModal');modal.dataset.meetingId=id;
  mrdRenderMeetingInfo(m);
  mrdRenderTasks();
  mrdRenderMaterials(docs);
  document.querySelector('#mrdStatus').textContent='';
  mrdResetTaskForm();mrdSetEdit(false);
  return true;
}
async function mrdOpenMeeting(id){
  // PC 사업 보고 화면(세 칸·두 칸)이 떠 있으면 팝업을 열지 않고 그 칸에서 고른다(team.js reveal). 다른 화면 위·폰·중간 폭은 지금처럼 팝업.
  if(window.KPTUMeetingColumns?.reveal?.(id))return;
  const epoch=++mrdRequestEpoch;
  mrdUndock();mrdEditSequence++;mrdEditor=null;
  try{
    mrdInstallModal();
    if(!(await mrdLoadMeeting(id,epoch)))return;
    mrdOpen();mrdTodos?.open();
  }catch(e){if(epoch===mrdRequestEpoch)alert(e.message||String(e))}
}
// 열려 있는 사업 보고를 다시 읽는다(할 일 완료·삭제 뒤). 칸에 붙어 있으면 창을 다시 열지 않고 칸 안에서만 다시 채운다.
async function mrdReload(id){
  if(!mrdDocked)return mrdOpenMeeting(id);
  const epoch=++mrdRequestEpoch;
  try{await mrdLoadMeeting(id,epoch)}catch(e){if(epoch===mrdRequestEpoch)alert(e.message||String(e))}
}
const mrdEditInputs=['Title','Round','ShortName','At','Project','Transcript','Notes'];
function mrdEditDraft(){return JSON.stringify([...mrdEditInputs.map(key=>document.querySelector('#mrdEdit'+key)?.value??''),mrdSummaries?.draft()||''])}
function mrdEditScope(){const rt=window.KPTURuntime,epoch=rt?.session?.epoch?.(),ctx=rt?.context?.read?.(),owner=rt?.session?.read?.()?.user?.id;return Number.isInteger(epoch)&&epoch>=0&&owner===mrdUser?.id&&ctx?.user?.id===owner&&ctx?.workspace?.id===mrdWorkspace?{owner,workspace:mrdWorkspace,epoch}:null}
function mrdEditSameScope(scope){const now=mrdEditScope();return !!scope&&!!now&&['owner','workspace','epoch'].every(k=>now[k]===scope[k])}
function mrdDeleteScope(){const rt=window.KPTURuntime;if(typeof rt?.api!=='function'||typeof rt.session?.read!=='function'||typeof rt.session?.epoch!=='function'||typeof rt.context?.read!=='function')return null;const scope=mrdEditScope(),session=rt.session.read();return scope&&typeof scope.owner==='string'&&scope.owner.trim()&&typeof scope.workspace==='string'&&scope.workspace.trim()&&typeof session?.access_token==='string'&&session.access_token.trim()?scope:null}
function mrdDeleteCurrent(token){const scope=mrdDeleteScope(),modal=document.querySelector('#meetingRoundDetailModal');if(!mrdDeleteTokens.has(token)||!scope||!['owner','workspace','epoch'].every(key=>scope[key]===token.scope[key])||window.KPTURouter?.current!=='meetings'||!token.meetingId||mrdCurrent?.id!==token.meetingId||mrdCurrent.workspace_id!==token.scope.workspace||token.requestEpoch!==mrdRequestEpoch||!modal||modal.classList.contains('hidden')||modal.getAttribute('aria-hidden')!=='false'||modal.dataset.meetingId!==token.meetingId){mrdDeleteTokens.delete(token);return false}return true}
window.addEventListener('kptu:session-changed',event=>{for(const token of mrdDeleteTokens){const detail=event.detail,session=detail?.session;if(!mrdDeleteCurrent(token)||(detail&&Object.prototype.hasOwnProperty.call(detail,'session')&&(!session?.access_token?.trim?.()||session.user?.id!==token.scope.owner))||(detail&&Object.prototype.hasOwnProperty.call(detail,'epoch')&&detail.epoch!==token.scope.epoch))mrdDeleteTokens.delete(token)}});
window.addEventListener('kptu:view-changed',event=>{for(const token of mrdDeleteTokens)if(event.detail?.view!=='meetings'||event.detail?.source!=='session'||!mrdDeleteCurrent(token))mrdDeleteTokens.delete(token)});
for(const name of ['kptu:dialog-closed','kptu:dialog-opened'])window.addEventListener(name,event=>{if(event.detail?.modal?.id==='meetingRoundDetailModal')mrdDeleteTokens.clear()});
function mrdEditCurrent(e){return mrdEditor===e&&e.sequence===mrdEditSequence&&e.view===mrdRequestEpoch&&mrdCurrent?.id===e.id&&mrdEditSameScope(e.scope)&&!document.querySelector('#mrdEditor')?.classList.contains('hidden')}
function mrdEditKey(e){return [e.scope.owner,e.scope.workspace,e.scope.epoch,e.id].join(':')}
function mrdEditRow(e,rows,body){const row=Array.isArray(rows)&&rows.length===1&&rows[0];if(!row||row.id!==e.id||row.workspace_id!==e.scope.workspace||!Object.entries(body).every(([k,v])=>k==='updated_at'||(k==='meeting_at'?Number.isFinite(Date.parse(row[k]))&&Date.parse(row[k])===Date.parse(v):JSON.stringify(row[k])===JSON.stringify(v))))throw new Error('사업 보고의 저장 결과를 확인하지 못했습니다.');return row}
function mrdEditNotice(e,text,check=false){if(!mrdEditCurrent(e))return;const st=document.querySelector('#mrdEditStatus');st.textContent=text;st.className='status';if(check){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent='저장 결과 확인';b.onclick=()=>mrdCheckEdit(e);st.append(document.createTextNode(' '),b)}}
async function mrdCheckEdit(e){const a=mrdEditAttempts.get(mrdEditKey(e));if(!a||a.pending||a.reading||!mrdEditCurrent(e))return;a.reading=true;const current=()=>mrdEditCurrent(e)&&mrdEditAttempts.get(mrdEditKey(e))===a;try{const rows=await mrdApi(`/rest/v1/app_meetings?id=eq.${encodeURIComponent(e.id)}&workspace_id=eq.${encodeURIComponent(e.scope.workspace)}&select=*`,{expectedSessionEpoch:e.scope.epoch,singleFlight:false});if(!current())return;const row=mrdEditRow(e,rows,a.body);Object.assign(mrdCurrent,row);mrdEditAttempts.delete(mrdEditKey(e));mrdEditNotice(e,'제출한 내용은 확인했습니다. 현재 입력은 남겨두었습니다.')}catch{if(current())mrdEditNotice(e,'저장 결과를 아직 확인하지 못했습니다. 입력을 유지했으며 다시 저장하지 않았습니다.',true)}finally{a.reading=false}}
function mrdStartEdit(){if(!mrdCurrent||!mrdCanEdit(mrdCurrent))return;const editor={id:mrdCurrent.id,scope:mrdEditScope(),view:mrdRequestEpoch,sequence:++mrdEditSequence};mrdEditor=editor;if(editor.scope)mrdEditObservedScope={...editor.scope};const button=document.querySelector('#mrdSaveEdit');button.disabled=false;button.textContent=mrdSaveLabel();const input=document.querySelector('#mrdEditTitle');window.KPTUMeetingNames.installPicker(input,'mrdEdit');window.KPTUMeetingNames.setupPicker(document.querySelector('#mrdEditNameSelect'),input,document.querySelector('#mrdEditNameMatch'),document.querySelector('#mrdEditNameUseMatch'),{current:mrdMeetingName(mrdCurrent),names:isMeetingKind(reportKindOf(mrdCurrent))?window.KPTUMeetingNames.choices('meeting'):[]});{const start=mrdShortNameStart(mrdCurrent);mrdRoundRows?.paint(showRoundRows(reportKindOf(mrdCurrent),{round:mrdCurrent.round_no,shortName:start}));const round=document.querySelector('#mrdEditRound'),short=document.querySelector('#mrdEditShortName');if(round)round.value=mrdCurrent.round_no??'';if(short)short.value=start}document.querySelector('#mrdEditAt').value=mrdDateValue(mrdCurrent.meeting_at);document.querySelector('#mrdEditProject').innerHTML=mrdProjectOptions(mrdCurrent.project_id||'');{const start=targetList(window.KPTUTeamData?.reportTargetsOf?.(mrdCurrent)||(mrdCurrent.project_id?[{kind:'project',id:mrdCurrent.project_id}]:[]));mrdEditTargets=start;mrdEditTargetsStart=start;mrdEditTargetsTouched=false;mrdPaintPlaces();mrdSummaryBox()?.start(start);const startId=mrdCurrent.id;readReportTargets(mrdCurrent).then(list=>{if(mrdCurrent?.id!==startId||!mrdEditor)return;if(!mrdEditTargetsTouched){mrdEditTargets=targetList(list);mrdEditTargetsStart=mrdEditTargets;mrdPaintPlaces();mrdSummaryBox()?.start(list)}else mrdSummaryBox()?.loadSaved(list)},()=>{});document.querySelector('#mrdEditLocation').value=mrdCurrent.location||'';locationAvailable().then(ok=>{const row=document.querySelector('#mrdEditLocationRow');if(row)row.hidden=!ok},()=>{})}document.querySelector('#mrdEditTranscript').value=mrdCurrent.transcript_text??'';document.querySelector('#mrdEditNotes').value=mrdCurrent.notes||'';document.querySelector('#mrdEditStatus').textContent='';mrdEditBase=mrdEditFields();mrdSetEdit(true);mrdEditHistoryStart(editor);mrdFocusEdit();const attempt=editor.scope&&mrdEditAttempts.get(mrdEditKey(editor));if(attempt?.pending){button.disabled=true;button.textContent='앞선 저장 확인 중…';mrdEditNotice(editor,'앞선 저장 결과를 기다리는 중입니다.');attempt.done.then(()=>{if(mrdEditCurrent(editor)){button.disabled=false;button.textContent=mrdSaveLabel();mrdEditNotice(editor,'앞선 요청이 끝났습니다. 현재 입력은 유지했습니다.',attempt.state==='unknown')}})}else if(attempt)mrdEditNotice(editor,'앞선 저장 결과를 먼저 확인해 주세요.',true)}
// MTG-사업보고 4단계: [칸 바꾸기] → 칸 고르기 창 → activity_kind PATCH(report-kind-sheet.js). 고친 행으로 머리 줄을 다시 그린다.
function mrdChangeKind(trigger){const m=mrdCurrent,epoch=mrdRequestEpoch;if(!m||!mrdCanEdit(m))return;pickReportKind(trigger,{title:'칸 바꾸기',current:reportKindOf(m),onPick:async kind=>{if(epoch!==mrdRequestEpoch||mrdCurrent?.id!==m.id||(kind===reportKindOf(m)&&m.activity_kind===kind))return;const st=document.querySelector('#mrdStatus');try{const row=await saveReportKind(m.id,kind);if(epoch!==mrdRequestEpoch||mrdCurrent?.id!==m.id)return;Object.assign(mrdCurrent,row);mrdRenderMeetingInfo(mrdCurrent);st.textContent=`칸을 '${reportKindLabel(kind)}'(으)로 바꿨습니다.`;st.className='status ok'}catch(err){if(epoch===mrdRequestEpoch&&mrdCurrent?.id===m.id){st.textContent=err.message||'칸을 바꾸지 못했습니다.';st.className='status error'}}}})}
async function mrdRefreshMeetingList(){await window.__KPTU_RELOAD_MEETINGS__?.();window.dispatchEvent(new CustomEvent('kptu:meetings-changed'))}
async function mrdSaveEdit(){
  const e=mrdEditor,st=document.querySelector('#mrdEditStatus');if(!e)return;
  if(!e.scope||!mrdEditSameScope(e.scope)){st.textContent='로그인 상태를 확인하지 못했습니다. 입력은 남겨두었습니다.';st.className='status error';return}
  if(!mrdEditCurrent(e))return;
  const key=mrdEditKey(e),prior=mrdEditAttempts.get(key);if(prior?.pending||prior?.state==='unknown'){mrdEditNotice(e,'앞선 저장 결과를 먼저 확인해 주세요.',!prior.pending);return}
  const name=document.querySelector('#mrdEditTitle').value.trim(),at=document.querySelector('#mrdEditAt').value,transcript=document.querySelector('#mrdEditTranscript').value,notes=document.querySelector('#mrdEditNotes').value;
  if(!name||!at){st.textContent=`${reportWords(reportKindOf(mrdCurrent)).nameLabel}과 일시를 입력해 주세요.`;st.className='status error';return}
  let meetingAt;try{meetingAt=toMeetingISO(at)}catch(err){st.textContent=err.message;st.className='status error';return}
  // MTG-보고창정리: 차수 줄이 창에 있을 때만 차수를 보낸다(다른 칸 기록의 옛 차수는 줄이 없으면 건드리지 않는다). 원문은 비어도 저장한다.
  const roundEl=document.querySelector('#mrdEditRound'),roundRaw=roundEl?roundEl.value:'',body={meeting_at:meetingAt,...(roundEl?{round_no:roundRaw?Number(roundRaw):null}:{}),transcript_text:transcript,notes:notes.trim()?notes:'',updated_at:new Date().toISOString()};
  // MEET-결과정리 ③: 회의 종류 이름은 series_name, 차수 없는 회의의 짧은 이름은 title(기존 칸). 짧은 이름을 비우면 title은 종류 이름과 같게.
  // 회의명도 짧은 이름도 그대로면 예전 이름 칸(title·series_name)은 건드리지 않는다. 회의명을 바꾸면 지금처럼 두 칸을 그 이름으로 맞추되, 짧은 이름이 있으면 title은 짧은 이름.
  const shortEl=document.querySelector('#mrdEditShortName'),shortName=shortEl?shortEl.value.trim():mrdShortNameStart(mrdCurrent),renamed=name!==mrdMeetingName(mrdCurrent),shortChanged=shortName!==mrdShortNameStart(mrdCurrent);
  if(renamed||shortChanged){const wantTitle=shortName&&shortName!==name?shortName:name;if(renamed||wantTitle!==String(mrdCurrent.title||'').trim())body.title=wantTitle;if(renamed||name!==String(mrdCurrent.series_name||'').trim())body.series_name=name}
  const locNow=document.querySelector('#mrdEditLocation').value.trim(),locStart=String(mrdCurrent.location||'').trim();
  const a={body,draft:mrdEditDraft(),pending:true,state:'pending'};a.done=new Promise(resolve=>a.finish=resolve);e.request=a;mrdEditAttempts.set(key,a);
  const btn=document.querySelector('#mrdSaveEdit'),label=btn.textContent;btn.disabled=true;btn.textContent='저장 중…';mrdEditNotice(e,'저장 중…');
  // 장소 칸이 서버에 있는지 확인하는 기다림은 반드시 위의 저장 잠금(pending) 뒤에 둔다. 앞에 두면 그 사이 두 번째 누름이 잠금을 통과해 두 번 저장된다.
  if(await locationAvailable().catch(()=>false)&&locNow!==locStart)body.location=locNow||null;
  try{
    const rows=await mrdApi(`/rest/v1/app_meetings?id=eq.${encodeURIComponent(e.id)}&workspace_id=eq.${encodeURIComponent(e.scope.workspace)}&select=*`,{method:'PATCH',body,prefer:'return=representation',expectedSessionEpoch:e.scope.epoch});
    const row=mrdEditRow(e,rows,body);a.state='confirmed';if(!mrdEditSameScope(e.scope))return;if(mrdEditAttempts.get(key)===a)mrdEditAttempts.delete(key);
    // Keep the same-target saved model current without touching a replacement draft.
    let linkMsg='';
    {const {next,same,box,summaries,changedText}=mrdLinksChange();
      if(!same||changedText){const r=await saveReportTargets({id:e.id,updated_at:row.updated_at},next,undefined,summaries);if(r.ok&&!r.legacy)box?.afterSave();
        if(!r.ok)linkMsg='연결은 저장하지 못했어요. '+(r.message||'');else{if(r.legacy&&r.skippedOrgs)linkMsg=LEGACY_NOTE;row.project_id=firstProjectId(next);if(r.updated_at)row.updated_at=r.updated_at;mrdEditTargetsStart=next;await window.KPTUTeamData?.refreshReportLinks?.()}}}
    if(mrdCurrent?.id===e.id&&mrdCurrent.workspace_id===e.scope.workspace)Object.assign(mrdCurrent,row);
    if(!mrdEditCurrent(e))return;
    if(mrdEditDraft()!==a.draft){mrdEditNotice(e,'제출한 내용은 저장했습니다. 추가 입력은 남겨두었습니다.');return}
    mrdRenderMeetingInfo(mrdCurrent);btn.disabled=false;btn.textContent=label;mrdSetEdit(false);if(linkMsg){const ms=document.querySelector('#mrdStatus');if(ms){ms.textContent=linkMsg;ms.className='status error'}}
    const sequence=mrdEditSequence;await window.__KPTU_RELOAD_MEETINGS__?.();
    if(mrdEditSameScope(e.scope)&&e.view===mrdRequestEpoch&&sequence===mrdEditSequence&&mrdCurrent?.id===e.id)window.dispatchEvent(new CustomEvent('kptu:meetings-changed'));
  }catch(err){if(a.state==='confirmed')return;a.state=[401,403].includes(err?.status)?'rejected':'unknown';if(mrdEditSameScope(e.scope)&&a.state==='rejected'&&mrdEditAttempts.get(key)===a)mrdEditAttempts.delete(key);mrdEditNotice(e,a.state==='rejected'?'수정 권한을 확인해 주세요. 입력은 유지했습니다.':'저장 결과를 확인하지 못했습니다. 입력을 유지했습니다.',a.state==='unknown')}
  finally{a.pending=false;a.finish();if(e.request===a&&mrdEditCurrent(e)){btn.disabled=false;btn.textContent=label}}
}
window.addEventListener('kptu:view-changed',()=>{if(mrdEditor)mrdSetEdit(false)});
window.addEventListener('kptu:session-changed',()=>{if(mrdEditSameScope(mrdEditObservedScope))return;mrdEditObservedScope=null;mrdEditAttempts.clear();mrdEditSequence++;mrdEditor=null;mrdEditInputs.forEach(k=>{const input=document.querySelector('#mrdEdit'+k);if(input)input.value=''})});
window.addEventListener('kptu:dialog-closed',event=>{if(event.detail?.modal?.id==='meetingRoundDetailModal')mrdSetEdit(false)});
async function mrdDeleteMeeting(){const meeting=mrdCurrent,epoch=mrdRequestEpoch;if(!meeting||!mrdCanDelete(meeting))return;const {deleteToTrash}=await import('./trash-actions.js');const r=await deleteToTrash({kind:'report',id:meeting.id,name:mrdMeetingName(meeting)||meeting.title||'회의',remove:()=>mrdApi('/rest/v1/app_meetings?id=eq.'+encodeURIComponent(meeting.id),{method:'DELETE'}),closeBefore:()=>{if(epoch===mrdRequestEpoch&&mrdCurrent?.id===meeting.id)mrdClose()},afterChange:mrdRefreshMeetingList,notify:msg=>alert(msg)});if(r.status==='failed'&&epoch===mrdRequestEpoch&&mrdCurrent?.id===meeting.id)alert(r.error?.message||String(r.error))}
// UI-회의결과창정리: 파일을 고르면 바로 올라간다([업로드] 버튼 없음). 아직 차례가 오지 않은 파일은 ×로 뺄 수 있다.
// MEET-파일AI분류: 파일 올리기는 담당조직·프로젝트 상세와 같은 자료실 올리기 창(library-upload.js)을 연다.
// 파일 올리기·AI 자동 분류는 그 창이 하고, 올라온 자료는 library-files의 meeting_id로 이 사업 보고에 붙는다. 올리기가 끝나면 kptu:documents-changed로 아래 자료 목록이 다시 읽힌다.
async function mrdAddFiles(files){
  const m=mrdCurrent;if(!m||!mrdCanEdit(m))return;
  // ACT-사진 3단계: 끌어다 놓은 파일 중 사진은 사진 줄로 바로 올리고, 나머지만 기존 자료 올리기 창으로 보낸다.
  const {photos,others}=splitPhotoFiles(files);
  if(photos.length)void mrdAddPhotos(photos);
  if(photos.length&&!others.length)return;
  const st=document.querySelector('#mrdStatus'),fail=message=>{st.textContent=message;st.className='status error'};
  if(!(await mrdEnsureLibrary(fail)))return;
  if(mrdCurrent?.id!==m.id)return;
  st.textContent='';st.className='status';
  if(!window.KPTULibrary?.startUploadForMeeting?.({id:m.id,name:`${mrdMeetingName(m)||m.title||'사업 보고'}${m.round_no?` ${m.round_no}차`:''}`,project_id:m.project_id||''},others))fail('자료 올리기를 열지 못했습니다. 잠시 후 다시 눌러 주세요.');
}
// ---- MTG-고치기바로: 세 번째 칸에 붙이기 · 고친 내용 지키기 · 폰 뒤로가기 ----
// 붙임 여부에 따른 겉모양: 붙으면 제목(h2)과 닫기(×)는 없다(상단 줄이 이름·차수를 이미 보이고, 칸은 닫지 않는다). 역할은 창(dialog)이 아니라 영역(region).
function mrdPaintDocked(){
  const m=mrdModalEl();if(!m)return;
  m.classList.toggle('mrd-docked',mrdDocked);
  if(mrdDocked){m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.setAttribute('role','region');m.removeAttribute('aria-modal');m.removeAttribute('aria-labelledby');m.setAttribute('aria-label',mrdMeetingName(mrdCurrent)||'사업 보고');m.dataset.mrdDocked='1'}
  else{m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');m.setAttribute('aria-labelledby','mrdTitle');m.removeAttribute('aria-label');delete m.dataset.mrdDocked}
  document.querySelector('#mrdTitle')?.classList.toggle('hidden',mrdDocked);
  document.querySelector('#mrdClose')?.classList.toggle('hidden',mrdDocked);
}
// 한 줄 안내(불러오는 중·불러오지 못함). 글이 있으면 보기·고치기 면은 감춘다(다른 사업 보고의 내용이 남아 보이지 않게).
function mrdShowLoading(text,bad=false){
  const line=document.querySelector('#mrdLoading');if(!line)return;
  line.textContent=text||'';line.classList.toggle('hidden',!text);line.classList.toggle('error',!!bad);
  if(text){document.querySelector('#mrdView')?.classList.add('hidden');document.querySelector('#mrdEditor')?.classList.add('hidden');const meta=document.querySelector('#mrdMeta');if(meta)meta.textContent='';mrdPaintMore(false)}
}
// 고치는 동안 [취소][저장]은 칸에서는 맨 위 오른쪽(제목 줄), 안내 글은 그 아래 줄로 올린다. 팝업과 고치지 않을 때는 아래 줄(footer). 옮길 때만 건드린다.
function mrdPlaceActions(on){
  const want=!!(on&&mrdDocked);if(want===mrdActionsTop)return;mrdActionsTop=want;
  const head=document.querySelector('#meetingRoundDetailModal .modal-head'),ends=head?.querySelector('.mrd-head-ends'),actions=document.querySelector('#mrdEditActions'),st=document.querySelector('#mrdEditStatus'),foot=document.querySelector('#mrdEditFoot');
  if(!head||!ends||!actions||!st||!foot)return;
  if(want){ends.prepend(actions);head.append(st)}else{foot.prepend(st);foot.append(actions)}
}
function mrdFocusEdit(){
  if(!mrdDocked)return;
  const pick=document.querySelector('#mrdEditNameSelect:not(.hidden)')||document.querySelector('#mrdEditTitle');
  queueMicrotask(()=>pick?.focus({preventScroll:true}));
}
// 칸에 앉힌다. 같은 사업 보고가 이미 들어 있으면(칸을 다시 그린 뒤) 다시 읽지 않고, 고치던 내용·스크롤·초점을 그대로 둔다.
async function mrdDock(slot,id){
  const key=String(id??'');if(!slot||!key)return false;
  mrdInstallModal();
  const m=mrdModalEl(),wasDialog=!mrdDocked&&!m.classList.contains('hidden');
  if(wasDialog)window.KPTUA11y?.dialog.deactivate(m,{restoreFocus:false});
  const same=!!mrdCurrent&&String(mrdCurrent.id)===key;
  if(m.parentElement!==slot)slot.replaceChildren(m);
  mrdDocked=true;mrdPaintDocked();mrdPlaceActions(!!mrdEditor);
  if(same){mrdSyncFromList();mrdRestoreView(key);return true}
  mrdMemo=null;
  const epoch=++mrdRequestEpoch;
  mrdEditSequence++;mrdEditor=null;mrdCurrent=null;mrdTodos?.close();mrdMoreMenu?.close();mrdTasks=[];
  mrdShowLoading('불러오는 중…');
  try{
    if(!(await mrdLoadMeeting(key,epoch)))return false;
    mrdShowLoading('');mrdTodos?.open();return true;
  }catch(err){
    if(epoch===mrdRequestEpoch)mrdShowLoading(err.message||'사업 보고를 불러오지 못했습니다.',true);
    return false;
  }
}
// 칸을 다시 그리기 전에 창을 몸통(body)으로 내려 둔다(칸 안쪽이 지워져도 창과 고치던 내용이 살아 있게). 스크롤·초점은 기억했다가 다시 앉을 때 돌려준다.
function mrdUndock(){
  if(!mrdDocked)return;
  const m=mrdModalEl(),a=document.activeElement;
  mrdMemo={id:String(mrdCurrent?.id??''),top:m.scrollTop,focus:a&&a.id&&m.contains(a)?{id:a.id,start:a.selectionStart??null,end:a.selectionEnd??null}:null};
  mrdMoreMenu?.close();mrdTaskMenu?.close();
  document.body.append(m);
  mrdDocked=false;mrdPaintDocked();mrdPlaceActions(false);
  m.classList.add('hidden');m.setAttribute('aria-hidden','true');
}
function mrdRestoreView(key){
  const memo=mrdMemo;mrdMemo=null;if(!memo||memo.id!==key)return;
  const m=mrdModalEl(),set=()=>{if(m)m.scrollTop=memo.top};set();requestAnimationFrame(set);
  if(memo.focus){const el=document.getElementById(memo.focus.id);if(el&&!el.disabled){el.focus({preventScroll:true});try{if(memo.focus.start!=null)el.setSelectionRange(memo.focus.start,memo.focus.end)}catch{}}}
}
// 목록이 더 새로운 기록을 갖고 있으면(다른 곳에서 연결·칸이 바뀜) 칸에 붙은 창도 맞춘다. 고치는 중에는 입력을 건드리지 않는다.
function mrdSyncFromList(){
  const row=(window.KPTUTeamData?.meetings?.()||[]).find(x=>String(x.id)===String(mrdCurrent?.id));
  if(!row||mrdEditor||!(Date.parse(row.updated_at)>Date.parse(mrdCurrent.updated_at||0)))return;
  Object.assign(mrdCurrent,row);mrdRenderMeetingInfo(mrdCurrent);
}
// 고친 내용이 있는지: 입력 칸이 처음 값과 다르거나 연결할 곳·요약이 바뀌었으면 참(저장 때 보낼 것과 같은 기준).
const mrdEditFieldKeys=['Title','Round','ShortName','At','Transcript','Notes','Location'];
function mrdEditFields(){return JSON.stringify(mrdEditFieldKeys.map(k=>document.querySelector('#mrdEdit'+k)?.value??''))}
function mrdLinksChange(){
  const next=targetList(mrdEditTargets),same=next.length===mrdEditTargetsStart.length&&next.every(t=>mrdEditTargetsStart.some(x=>sameTarget(x,t)));
  const box=mrdSummaryBox(),summaries=box?.summaries()||null;
  return {next,same,box,summaries,changedText:summariesChanged(next,summaries,box?.saved())};
}
function mrdEditDirty(){if(!mrdEditor)return false;if(mrdEditFields()!==mrdEditBase)return true;const c=mrdLinksChange();return !c.same||c.changedText}
function mrdLeaveClear(){mrdLeaveNext=null;document.querySelector('#mrdLeave')?.classList.add('hidden')}
// 다른 줄을 누르는 것처럼 고치던 화면을 떠나는 일의 문지기: 고친 내용이 없으면 바로 proceed, 있으면 그 자리에 '고친 내용을 저장할까요? [저장] [버리기]' 한 줄을 띄우고 고른 뒤에 proceed.
function mrdGuardLeave(proceed){
  if(!mrdEditor||!mrdEditDirty()){proceed();return true}
  mrdLeaveNext=proceed;
  document.querySelector('#mrdLeave')?.classList.remove('hidden');document.querySelector('#mrdLeaveSave')?.focus({preventScroll:true});
  return false;
}
// 폰(팝업): 고치는 화면에 들어갈 때 기록 한 칸을 쌓아, 뒤로가기가 창을 닫지 않고 고치는 화면 → 읽는 화면으로 돌아가게 한다.
const mrdPhone=()=>!!window.matchMedia?.('(max-width:760px)').matches;
function mrdEditHistoryStart(editor){
  if(mrdDocked||mrdEditHistory||!mrdPhone())return;
  window.history.pushState({...window.history.state,kptuMrdEdit:editor.id},'',window.location.href);mrdEditHistory=true;
}
function mrdEditHistoryEnd(){if(!mrdEditHistory)return;mrdEditHistory=false;mrdSkipPop++;window.history.back()}
window.addEventListener('popstate',e=>{
  if(mrdSkipPop>0){mrdSkipPop--;return}
  if(!mrdEditHistory||e.state?.kptuMrdEdit)return;
  mrdEditHistory=false;
  // 고친 내용이 있으면 뒤로가기로 버리지 않는다: 기록 한 칸을 다시 쌓고 같은 한 줄로 묻는다.
  if(mrdEditor&&mrdEditDirty()){mrdEditHistoryStart(mrdEditor);mrdGuardLeave(()=>{});return}
  mrdSetEdit(false);
});
window.addEventListener('kptu:tasks-changed',()=>{if(mrdDocked&&mrdCurrent&&!mrdEditor)void mrdRefreshTasks()});
async function mrdInit(){const shared=window.KPTURuntime?.context?.read?.()||window.__KPTU_BOOT_CONTEXT__;if(shared?.user?.id&&shared?.workspace?.id){mrdUser=shared.user;mrdWorkspace=shared.workspace.id;mrdRole=shared.membership?.role||null}else{try{mrdUser=await mrdApi('/auth/v1/user')}catch{return false}const ms=await mrdApi('/rest/v1/app_workspace_members?user_id=eq.'+mrdUser.id+'&select=workspace_id,user_id,role&limit=1');if(!ms?.length)return false;mrdWorkspace=ms[0].workspace_id;mrdRole=ms[0].role}const loadedProjects=window.KPTUTeamData?.spaces?.();mrdProjects=Array.isArray(loadedProjects)&&loadedProjects.length?loadedProjects:await mrdApi('/rest/v1/app_spaces?workspace_id=eq.'+mrdWorkspace+'&select=id,name,status,parent_id');mrdInstallModal();const list=document.querySelector('#meetingList');if(list){list.addEventListener('click',e=>{if(e.target.closest('button,a,input,select,textarea,label'))return;const card=e.target.closest('[data-mrd-meeting]');if(card)mrdOpenMeeting(card.dataset.mrdMeeting)});list.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-mrd-meeting]')){e.preventDefault();mrdOpenMeeting(e.target.dataset.mrdMeeting)}})}return true}
// PRJ-회의표시: the project detail's 회의 rows open this same meeting result dialog over the projects screen.
window.KPTUMeetingRoundDetail={open:mrdOpenMeeting,dock:mrdDock,undock:mrdUndock,guardLeave:mrdGuardLeave};
window.__KPTU_MEETING_ROUND_DETAIL_READY__=mrdInit().then(ok=>{if(ok)window.dispatchEvent(new CustomEvent('kptu:report-detail-ready'));return ok}).catch(err=>{console.error('meeting detail init',err);return false});
