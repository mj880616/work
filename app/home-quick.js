import {requestNoteAiTitle} from './note-ai-title.js';
import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import { waitInlineHtml } from './wait-state.js'; // UI-기다림표시통일 2차: 누른 뒤 기다리는 동안 상태 줄은 글자 없는 회색 칸(wait-state.js)
import { createGoogleTask } from './quick-save.js';
import { createNoteDoc, noteTitleFromText } from './basket-data.js';
import { createUploadBatch, sendNoteBehind, mountBasketPicker, fileTitle } from './basket-upload.js';
import { extractHtmlDocument, htmlFileName, utf8Bytes, HTML_MAX_BYTES, HTML_MARK } from './chatgpt-html.mjs';
import { dayKey } from './home-read-model.js';
import { newTaskDue } from './task-due.mjs';
// PERF-첫로딩 ③(S61-32): 클립 자리 답·개수 한도만 작은 task-files-ready.js에서 받는다. 파일 보내기(task-files.js sendTaskFilesBehind)는 그 큰 사슬을
// 첫 화면 전에 받지 않도록 [할 일]에서 클립이 보일 때 미리 받기 시작하고, 저장 때 그 받기를 기다린다(taskFilesModule).
import { taskFilesKnown, onTaskFilesReady, MAX_TASK_FILES } from './task-files-ready.js';
import {word} from './brand/brand.mjs';
import {folderShapeHtml} from './folder-look-model.mjs';
let taskFilesFlight=null;
const taskFilesModule=()=>taskFilesFlight||=import('./task-files.js').catch(e=>{taskFilesFlight=null;throw e;});

// QUICK-입력정리(2026-11-28 사용자 결정 '홈 막대 통째로 없앰', '잊지 말기는 입력한 자체를 없애'): 이 빠른 입력칸은 두 화면에만 있다.
//   - taskOnly: [할 일] 화면 입력칸(UI-할일입력). 넣는 할 일은 오늘(KST) 기한, 같은 만들기 길(quick-save.js createGoogleTask).
//   - noteOnly: 노트 목록 입력칸(BASKET-노트입력창). [추가] = 첫 줄이 제목인 노트(createNoteDoc, 마크다운 끔), [크게] = onBig(노트 쓰기 창).
//     NOTE-파일붙이기: 클립·끌어 놓기로 파일도 받고, 노트를 저장한 뒤 그 노트 id로 올린다.
// 옛 홈 막대([잊지 말기 ▾ | 할 일] + 잊지 말기 칩)와 잊지 말기 화면의 손 입력칸은 부르는 곳째 지웠다.
export function mountQuick({root, refreshTasks=()=>{}, taskOnly=false, noteOnly=false, onBig=null, onFolder=null, view="tasks", idPrefix="tasks", onSaved=()=>{}}) {
  if(!taskOnly&&!noteOnly)throw new Error('mountQuick: taskOnly 또는 noteOnly');
  const box=root.querySelector('.home-quick-placeholder');
  box.removeAttribute('aria-hidden'); box.className='home-quick'; box.dataset.homeQuick='';
  // UI-빠른입력Ctrl엔터: the shared Enter-to-save rule (enter-save.js) — PC Ctrl+Enter (Mac ⌘+Enter) = [추가], Enter = new line
  // (the [할 일] input keeps its own Enter = add below). The phone keyboard has no Ctrl, so there Enter only adds a line.
  box.setAttribute('data-enter-save','');
  const quickScope=()=>{const c=window.KPTURuntime.context.read();return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
  let quickOwner=quickScope();
  const mode=taskOnly?'task':'note';
  let saving=false;
  // NOTE-추가폴더표시: the note input's [폴더 ▾] shows the folder a new note goes into (null = 폴더 없음). The note list owns the
  // choice and its picker (onFolder opens it under this button); setFolder() only paints the name here and in the placeholder.
  let folderName=null,folderColor=null;
  // Whether the clip and drop take files for this save: a note (NOTE-파일붙이기), or a new task once the task-file table answers
  // (TASK-추가창파일, as ⋯ → 파일 붙이기; they go up after Google made the task).
  // TEST-홈빠른입력안정화: while this load's task-file table answer is not in, the clip's place is kept (unseen, unusable), so the
  // input does not narrow once the answer comes. A no frees the place.
  let taskFilesOn=false,taskFilesWait=false;
  const takesFiles=()=>noteOnly||taskFilesOn;
  let taskAttempt=null,taskRequest=null,taskSequence=0,taskReading=false,taskSessionEpoch=window.KPTURuntime.session.epoch();
  let upload = createUploadBatch();
  box.innerHTML=`<div class="home-quick-entry"><div class="home-quick-input-wrap"><div data-quick-file-picker hidden></div><textarea data-quick-input aria-label="빠른 입력" rows="1" placeholder="할 일을 입력하세요"></textarea>${noteOnly?'<button type="button" class="home-quick-big" data-quick-big aria-label="큰 창에서 노트 쓰기" aria-haspopup="dialog"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>':'<button type="button" class="home-quick-detail" data-quick-detail aria-label="상세 설정으로 추가" aria-haspopup="dialog"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'}</div>${noteOnly?'<button type="button" class="home-quick-folder" data-quick-folder aria-haspopup="dialog" aria-expanded="false" aria-label="폴더: 폴더 없음"></button>':''}<button type="button" class="home-quick-save" data-quick-save data-enter-save-submit>추가</button></div><p class="home-quick-hint" data-quick-hint role="status"></p><div data-quick-basket-options hidden><div data-quick-files></div></div><div data-quick-status role="status"></div>`;
  const input=box.querySelector('[data-quick-input]'),status=box.querySelector('[data-quick-status]'),hint=box.querySelector('[data-quick-hint]');
  const pickerFiles=mountBasketPicker(box.querySelector('[data-quick-file-picker]'),{id:idPrefix+'QuickBasketFiles',filesHost:box.querySelector('[data-quick-files]'),dropTarget:box,pasteTarget:input,isActive:()=>takesFiles(),getBatch:()=>upload,isBusy:()=>saving,onError:message=>{status.textContent=message;},onChange:()=>{status.textContent='';paint();}});
  // NOTE-입력줄높이(S71-67, 사용자 결정 2026-11-26 'B인데 위로 화살표는 추가로'): the clip is the input's own left icon at every width.
  // One row = [입력칸(📎 … ⤢)] [폴더 아이콘](노트만) [추가]; the three are one height (ui-standard.css 'NOTE-입력줄높이', --quick-row-h).
  const pickerWide=window.matchMedia('(min-width:761px)');
  pickerWide.addEventListener('change',()=>paint());
  // The note input's folder button is a square folder icon (+ the chosen folder's short name), right after the input.
  const folderBtn=box.querySelector('[data-quick-folder]');
  if(folderBtn)folderBtn.onclick=()=>{if(saving)return;onFolder?.(folderBtn);};
  // MD-표시보완: a pasted complete HTML document (ChatGPT HTML) becomes a .html attachment of this note through the
  // same upload path as the clip; the text keeps a short mark. Nothing is saved until [추가].
  input.addEventListener('paste',e=>{
    if(!noteOnly||saving||input.readOnly)return;
    const found=extractHtmlDocument(e.clipboardData?.getData('text/plain')||'');if(!found)return;
    e.preventDefault();
    if(utf8Bytes(found.html)>HTML_MAX_BYTES){status.textContent='HTML 문서가 2MB를 넘어 붙여 넣지 않았어요. 더 짧게 만들어 달라고 한 뒤 다시 붙여 넣어 주세요.';return;}
    if(!pickerFiles.add([new File([found.html],htmlFileName(),{type:'text/html'})]))return;
    input.setRangeText([found.before,HTML_MARK,found.after].filter(Boolean).join('\n'),input.selectionStart,input.selectionEnd,'end');
    input.dispatchEvent(new Event('input',{bubbles:true}));
    status.textContent='HTML 문서를 첨부 파일로 바꿨어요. [추가]를 누르면 노트에 저장돼요.';
  });
  function paint(){
    pickerFiles.render();
    // BIZ-저장먼저닫기 2차(S59-10): the files of a save always go to the note's or task's own line behind (the input gets a fresh batch
    // at once), so the input never holds a saved or unconfirmed batch and never locks.
    if(folderBtn){
      // NOTE-입력줄높이: 폴더 없음 = 정사각 폴더 아이콘만, 고른 폴더 = 그 폴더 색 아이콘 + 작은 이름(넘치면 CSS가 '…'로 줄임).
      const f=folderBtn,label=folderName||'폴더 없음';f.toggleAttribute('data-quick-folder-on',!!folderName);
      const ico=document.createElement('span');ico.className='home-quick-folder-ico fl-ico';ico.setAttribute('aria-hidden','true');ico.innerHTML=folderShapeHtml('closed');
      if(folderName&&folderColor)ico.dataset.fc=String(folderColor);
      if(folderName){const name=document.createElement('span');name.className='home-quick-folder-name';name.textContent=folderName;f.replaceChildren(ico,name);}else f.replaceChildren(ico);
      f.title='노트를 넣을 폴더: '+label;f.setAttribute('aria-label','폴더: '+label);}
    box.dataset.mode=mode; input.rows=1;
    input.placeholder=noteOnly?(folderName?(pickerWide.matches?`${folderName}에 노트 추가`:'노트 추가'):'노트를 입력하세요'):'할 일을 입력하세요';
    const filesWait=!takesFiles()&&taskFilesWait;
    const filePicker=box.querySelector('[data-quick-file-picker]');filePicker.hidden=!takesFiles()&&!filesWait;filePicker.toggleAttribute('data-quick-files-wait',filesWait);
    // TASK-추가창파일: a task takes up to 10 files (the ⋯ → 파일 붙이기 limit), not a note's 20; say where they go.
    const fileHint=box.querySelector('[data-basket-hint]');if(fileHint)fileHint.textContent=taskOnly?`파일당 100MB · ${MAX_TASK_FILES}개까지 · 추가하면 Drive "자료실/할 일 첨부"에 올라갑니다`:'파일당 100MiB · 20개까지';
    box.querySelector('[data-quick-basket-options]').hidden=!takesFiles()||!upload.entries.length;
  }
  input.addEventListener('input',()=>{if(input.value.trim())hint.textContent='';});
  // The clip shows in [할 일] only when the task-file table answers for this owner (only a yes is kept). The [할 일] screen's input does
  // not ask itself: the task list below it reads the table anyway, and its answer (onTaskFilesReady, a failed read too) turns the clip on.
  const filesAnswer=on=>{taskFilesWait=false;if(on){taskFilesOn=true;void taskFilesModule().catch(()=>{});}paint();};
  const checkTaskFiles=()=>{
    if(taskFilesOn||!taskOnly)return;
    if(taskFilesKnown()){filesAnswer(true);return;}
    taskFilesWait=true;paint();
  };
  if(taskOnly)onTaskFilesReady((owner,yes)=>{if(taskFilesOn||!owner||owner!==window.KPTURuntime.context.read()?.user?.id)return;if(yes)checkTaskFiles();else if(taskFilesWait)filesAnswer(false);});
  const taskRuntime=window.KPTURuntime;
  const taskIdentity=task=>!!task&&typeof task.id==='string'&&!!task.id&&typeof task.taskListId==='string'&&!!task.taskListId&&typeof task.title==='string';
  const taskSnapshot=()=>JSON.stringify({raw:input.value});
  const taskScopeCurrent=r=>{const c=taskRuntime.context.read();return box.isConnected&&r.owner===c?.user?.id&&r.workspace===c?.workspace?.id&&r.epoch===taskRuntime.session.epoch();};
  const taskCurrent=r=>taskRequest===r&&r.token===taskSequence&&taskScopeCurrent(r);
  const taskLinkKey=link=>link.project_id?'project:'+link.project_id:link.organization_id?'organization:'+link.organization_id:link.meeting_id?'meeting:'+link.meeting_id:'';
  function taskLinkKeys(result){if(!Array.isArray(result?.links)||!Array.isArray(result?.meeting_links))throw new Error(word('사업영역 연결의 저장 결과를 확인하지 못했어요.'));return new Set([...result.links,...result.meeting_links].filter(l=>l.status==='confirmed').map(taskLinkKey).filter(Boolean))}
  function taskNotice(message,{confirm=false}={}){status.textContent=message;if(confirm&&taskOnly){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=taskAttempt?.task?'연결 확인':'할 일 목록에서 확인';b.onclick=()=>recoverQuickTask();status.append(document.createTextNode(' '),b)}}
  function taskControls(busy){box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=busy);pickerFiles.render()}
  function taskToast(r,message){if(!taskScopeCurrent(r))return;const toast=document.querySelector('#toast');if(!toast)return;toast.textContent=message;kptuHoldToast(toast)}
  function taskBodyMatches(task,body){return task.title===body.title&&(task.notes||'')===(body.notes||'')&&(task.due?String(task.due).slice(0,10):null)===(body.due||null)}
  async function recoverQuickTask(){
    const a=taskAttempt;if(!a||a.pending||taskRequest||taskReading||!taskOnly||!taskScopeCurrent(a))return;
    const run=++taskSequence,active=()=>run===taskSequence&&taskAttempt===a&&taskScopeCurrent(a);
    const read=async path=>{if(!active())throw new Error('입력창이나 로그인이 바뀌었습니다.');const d=await taskRuntime.api('/functions/v1/google-tasks?action='+path,{singleFlight:false,expectedSessionEpoch:a.epoch});if(!active())throw new Error('입력창이나 로그인이 바뀌었습니다.');return d};
    const tasks=async()=>{const d=await read('tasks&pending_scope=all');if(!Array.isArray(d?.tasks)||d.needs_reconnect||d.error)throw new Error(d?.warning||d?.error||'Google 할 일 목록을 확인하지 못했어요.');return d.tasks.filter(taskIdentity)};
    const accept=async row=>{const exact=(await tasks()).filter(t=>t.id===row.id&&t.taskListId===row.taskListId);if(exact.length!==1)throw new Error('선택한 기존 할 일을 확인하지 못했어요.');const links=taskLinkKeys(await read('links&task_id='+encodeURIComponent(row.id)));a.task=structuredClone(exact[0]);a.bodyState='confirmed';a.links=links;a.linkState='confirmed';a.needsReview=false;taskNotice('선택한 기존 할 일을 사용합니다. 입력을 확인한 뒤 저장해 주세요.')};
    taskReading=true;saving=true;taskControls(true);status.innerHTML=waitInlineHtml();
    try{
      if(a.task)await accept(a.task);
      else{const rows=await tasks();taskNotice(rows.length?'저장된 할 일을 직접 선택해 주세요. 제목만으로 저장을 판단하지 않습니다.':'목록에서 결과를 찾지 못했어요. 입력은 유지하며 새로 만들지 않아요.',{confirm:!rows.length});for(const row of rows){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=row.title+' · 이 항목 사용';b.onclick=async()=>{if(!active()||taskReading)return;taskReading=true;saving=true;taskControls(true);try{await accept(row)}catch(error){if(active())taskNotice(error.message||String(error),{confirm:true})}finally{if(active()){taskReading=false;saving=false;taskControls(false);paint()}}};status.append(document.createTextNode(' '),b);const hint=document.createElement('small');hint.textContent=[row.taskListTitle||'Google 할 일',row.due?String(row.due).slice(0,10):'기한 없음',row.notes||''].join(' · ');status.append(hint)}}
    }catch(error){if(active())taskNotice('저장 결과를 확인하지 못했어요. '+(error.message||error),{confirm:true})}
    finally{if(active()){taskReading=false;saving=false;taskControls(false);paint()}}
  }
  async function saveTask(){
    if(saving||taskRequest||taskReading)return;const ctx=taskRuntime.context.read();if(!ctx?.user?.id||!ctx?.workspace?.id)return;
    const a=taskAttempt;if(a?.pending)return;if(a&&(a.needsReview||a.bodyState==='unknown'||a.linkState==='unknown')){taskNotice('앞선 저장 결과를 먼저 확인해 주세요. 새 할 일은 만들지 않았어요.',{confirm:true});return}
    const title=input.value.trim();if(!title)return;
    const batch=upload,files=takesFiles()?batch.entries.filter(e=>e.kind!=='success').map(e=>e.file):[];
    if(files.length>MAX_TASK_FILES){taskNotice(`한 할 일에는 파일을 ${MAX_TASK_FILES}개까지 붙일 수 있습니다.`);return}
    const attempt=a||{owner:ctx.user.id,workspace:ctx.workspace.id,epoch:taskRuntime.session.epoch(),task:null,bodyState:'idle',linkState:'idle',links:new Set(),needsReview:false};
    // S50-35: 기한은 오늘(task-due.mjs newTaskDue 한 곳). 같은 시도를 다시 보낼 때는 처음 정한 오늘을 그대로 쓴다.
    attempt.defaultDue||=dayKey(Date.now());
    const body=Object.freeze({title,due:newTaskDue('',attempt.defaultDue),notes:attempt.task?.notes||'',links:Object.freeze([])}),r={owner:attempt.owner,workspace:attempt.workspace,epoch:attempt.epoch,token:++taskSequence,attempt,body,draft:taskSnapshot()};
    taskAttempt=attempt;taskRequest=r;attempt.pending=true;saving=true;taskControls(true);taskNotice('저장 중…');let stage='body';
    // BIZ-저장먼저닫기 3차(S59-18): 할 일이 생기면 고른 파일은 그 할 일의 뒤 줄로 넘긴다(시도마다 한 번, 목록에서 고른 할 일도) — 입력칸은 기다리지 않고
    // 풀리며, 진행·끝·못 올림·[다시 올리기]는 하단바 위 한 줄 하나(task-files.js sendTaskFilesBehind). 그래서 파일이 있으면 위쪽 작은 알림은 띄우지 않는다.
    const sendFiles=()=>{if(!files.length||attempt.filesSent||!attempt.task||!taskScopeCurrent(r))return;attempt.filesSent=true;
      const job={task:attempt.task,files,count:attempt.bodyState==='confirmed'&&!a?0:null,rt:taskRuntime};
      // 보통은 클립이 보일 때 이미 받았다. 받기에 실패하면 파일이 말없이 사라지지 않게 알린다(할 일 자체는 이미 저장됨).
      taskFilesModule().then(m=>m.sendTaskFilesBehind(job)).catch(()=>{taskNotice('파일 보내기 프로그램을 받지 못했어요. 할 일은 저장됐어요. 할 일 ⋯ → 파일 붙이기로 다시 붙여 주세요.');});
      if(upload===batch)upload=createUploadBatch();pickerFiles.render();};
    const call=(action,body)=>{if(!taskCurrent(r))throw new Error('입력창이나 로그인이 바뀌었습니다.');return taskRuntime.api('/functions/v1/google-tasks?action='+action,{method:'POST',body,expectedSessionEpoch:r.epoch})};
    try{
      if(!attempt.task){
        const result=await createGoogleTask({...body,expectedSessionEpoch:r.epoch});if(!taskScopeCurrent(r))return;
        if(result?.ok===true&&taskIdentity(result.task))attempt.task=structuredClone(result.task);
        if(!attempt.task||!taskBodyMatches(attempt.task,body))throw new Error('Google 할 일의 저장 결과를 확인하지 못했어요.');attempt.bodyState='confirmed';
        // BIZ-저장먼저닫기 3차: the task exists; the chosen files go behind now (once, even if the links need another save).
        sendFiles();
        if(!taskCurrent(r)){attempt.needsReview=true;return}
        stage='links';attempt.links=taskLinkKeys(result);
        if(result.link_error||body.links.some(l=>!attempt.links.has(taskLinkKey(l)))){attempt.linkState='partial';attempt.needsReview=true;taskNotice(word('할 일은 저장했습니다. 사업영역 연결을 확인해 주세요.'),{confirm:true});taskToast(r,word('할 일은 저장했습니다. 사업영역 연결을 확인해 주세요.'));return}
      }else if(!taskBodyMatches(attempt.task,body)){
        const result=await call('update',{action:'update',task_id:attempt.task.id,task_list_id:attempt.task.taskListId,title:body.title,notes:body.notes,due:body.due});if(!taskScopeCurrent(r))return;
        if(result?.ok!==true||!taskIdentity(result.task)||result.task.id!==attempt.task.id||result.task.taskListId!==attempt.task.taskListId||!taskBodyMatches(result.task,body))throw new Error('기존 할 일의 수정 결과를 확인하지 못했어요.');attempt.task=structuredClone(result.task);attempt.bodyState='confirmed';if(!taskCurrent(r)){attempt.needsReview=true;return}
      }
      sendFiles();if(!taskCurrent(r)){attempt.needsReview=true;return}
      stage='links';const missing=body.links.filter(l=>!attempt.links.has(taskLinkKey(l)));
      if(missing.length){const result=await call('link',{action:'link',task_id:attempt.task.id,links:missing});if(!taskScopeCurrent(r))return;const confirmed=taskLinkKeys(result);if(result?.ok!==true||missing.some(l=>!confirmed.has(taskLinkKey(l))))throw new Error(word('사업영역 연결의 저장 결과를 확인하지 못했어요.'));attempt.links=confirmed;if(!taskCurrent(r)){attempt.needsReview=true;return}}
      attempt.linkState='confirmed';if(!taskCurrent(r))return;taskAttempt=null;r.completed=true;
      if(taskSnapshot()===r.draft){input.value='';taskNotice('')}else{taskNotice('제출한 할 일은 저장했습니다. 추가 입력은 남겨 두었습니다.')}
      paint();if(!attempt.filesSent)taskToast(r,'할 일을 추가했습니다.');
      try{void Promise.resolve(refreshTasks()).catch(()=>{if(taskScopeCurrent(r)&&r.token===taskSequence&&!input.value)taskNotice('할 일은 저장했어요. 목록을 다시 불러오지 못했어요.')})}catch(error){if(taskCurrent(r))taskNotice('할 일은 저장했어요. 목록을 다시 불러오지 못했어요.')}
    }catch(error){if(!taskScopeCurrent(r))return;if(stage==='body')attempt.bodyState='unknown';else attempt.linkState='unknown';attempt.needsReview=true;if(taskCurrent(r))taskNotice((attempt.task?'할 일은 확인했습니다. 연결과 수정 결과를 확인해 주세요. ':'저장 결과를 확인하지 못했어요. ')+(error.message||error),{confirm:true})}
    finally{attempt.pending=false;if(taskRequest===r&&taskScopeCurrent(r)&&r.token===taskSequence){taskRequest=null;saving=false;taskControls(false);paint()}}
  }
  // BASKET-노트입력창: one line (or more) + [추가] → a note titled by its first line, through the same insert as the write window.
  // NOTE-파일붙이기: with files, the note is made first (files only: titled by the first file's name), then the files go up with its
  // id. A file that did not go up leaves the note saved and says so; the box is emptied either way (no lock, no second note).
  async function saveNote(){
    if(saving)return {ok:false,message:'저장 중이에요.'};
    const batch=upload,files=batch.entries.filter(e=>e.kind!=='success'),text=input.value,title=noteTitleFromText(text)||(files.length?fileTitle(files[0].file?.name):'');
    if(!title){const message='글을 입력해 주세요.';status.textContent='';hint.textContent=message;return {ok:false,message};}
    const owner=quickScope(),isCurrent=()=>owner===quickScope()&&window.KPTURouter.current===view;
    saving=true;status.textContent='';hint.textContent='';
    box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);pickerFiles.render();
    try{
      const note=await createNoteDoc({title,raw_text:text,markdown:false});
      void requestNoteAiTitle(note.id);// NOTE-탐색기 ③: AI 요약 제목(서버가 정함, 기다리지 않음)
      // BIZ-저장먼저닫기 2차(S59-8): 글이 저장되면 입력칸을 바로 풀고 비운다. 고른 파일은 그 노트의 뒤 줄에서 끝까지 올라간다(화면을 옮겨도 —
      // 끝·못 올림은 하단바 위 한 줄, 못 올린 것은 [다시 올리기]). 글 저장이 실패하면(위) 입력칸·파일은 그대로 두고 아무것도 보내지 않는다.
      const sending=files.length>0;
      if(sending)void sendNoteBehind(note.id,batch);
      if(upload===batch)upload=createUploadBatch();
      if(owner!==quickScope())return {ok:false,message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      if(!isCurrent())return {ok:false,message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      input.value='';paint();onSaved(note);
      const toast=document.querySelector('#toast');if(toast){toast.textContent=sending?'노트를 추가했어요.':'노트를 추가했습니다.';kptuHoldToast(toast);}
      return {ok:true};
    }catch(e){const message=e.message||'저장하지 못했어요.';if(isCurrent())status.textContent=message;return {ok:false,message};}
    finally{saving=false;box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);paint();}
  }
  const save=()=>taskOnly?saveTask():saveNote();
  box.querySelector('[data-quick-save]').onclick=()=>void save();
  // BASKET-노트입력창: the note input's [크게] opens the note list's own write window on this text (onBig, basket-notes.js).
  // The window works on this box's own file batch; a note saved there empties it (reset).
  const fileHandle={getBatch:()=>upload,isBusy:()=>saving,onChange:()=>paint(),reset:()=>{upload=createUploadBatch();paint();}};
  const bigBtn=box.querySelector('[data-quick-big]');
  if(bigBtn)bigBtn.onclick=()=>{if(saving||document.querySelector('#edWindow:not(.hidden)'))return;onBig?.(input.value,fileHandle);};
  // UI-할일빠른추가상세: [할 일] 화면의 입력 칸 안 오른쪽 끝 [+]는 새 창 없이 일정 화면의 기존 [할 일 등록] 창(프로젝트·날짜 등)을 연다.
  // 입력한 글은 그 창의 제목으로 미리 채운다. 입력 칸 글은 그 창에서 저장될 때 비운다(같은 글이 두 번 남지 않게). 저장 경로는 기존 그대로.
  const detailBtn=box.querySelector('[data-quick-detail]');
  if(detailBtn){
    let detailTitle=null;
    detailBtn.onclick=async()=>{
      if(saving)return;
      const title=input.value.trim();
      try{
        await window.KPTUDeferredFeatures?.loadView?.('calendar');
        const open=document.querySelector('#newEventBtn');if(!open)throw new Error('missing');
        open.click();
        document.querySelector('#eventModal [data-event-mode="task"]')?.click();
        const field=document.querySelector('#eventTitle');if(field){field.value=title;field.dispatchEvent(new Event('input',{bubbles:true}));}
        detailTitle=title||null;
      }catch(e){status.textContent='상세 설정 창을 열지 못했어요. 잠시 뒤 다시 눌러 주세요.';}
    };
    // 창에서 저장되면 입력 칸 글을 비운다.
    window.addEventListener('kptu:google-tasks-changed',()=>{if(detailTitle!==null&&input.value.trim()===detailTitle){input.value='';detailTitle=null;paint();}});
    window.addEventListener('kptu:dialog-closed',e=>{if(e.detail?.modal?.id==='eventModal')setTimeout(()=>{detailTitle=null;},0);});
  }
  input.addEventListener('keydown',e=>{if(taskOnly&&e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();void save();}});
  window.addEventListener('kptu:before-reload',e=>{if(saving)e.preventDefault();else if(input.value.length||taskAttempt||upload.entries.some(e=>e.kind!=='success'))e.detail.otherDraft=true;});
  window.addEventListener('kptu:session-changed',()=>{const nextEpoch=taskRuntime.session.epoch();if(nextEpoch!==taskSessionEpoch){taskSessionEpoch=nextEpoch;taskSequence++;taskAttempt=null;taskRequest=null;taskReading=false;if(taskOnly){saving=false;taskControls(false)}}const nextOwner=quickScope();if(nextOwner===quickOwner)return;quickOwner=nextOwner;taskFilesOn=false;input.value='';upload=createUploadBatch();paint();checkTaskFiles();});
  if(noteOnly){input.setAttribute('aria-label','노트 입력');box.dataset.noteOnly='';}
  if(taskOnly){input.setAttribute('aria-label','오늘 할 일 입력');box.dataset.taskOnly='';}
  // Phone (ui-standard.css): this box is docked above the bottom tabs. Its height keeps the
  // last card and the toast clear of it; only the visible box (tasks or note list) writes it.
  new ResizeObserver(()=>{const height=box.getBoundingClientRect().height;if(height)document.documentElement.style.setProperty('--kptu-quick-dock',Math.ceil(height)+'px');}).observe(box);
  paint();checkTaskFiles();
  return {hasDraft:()=>!!input.value||!!taskAttempt||upload.entries.some(e=>e.kind!=='success'),isBusy:()=>saving,
    // The note list's write window hands unsaved text back here (and clears it after a save there).
    setText:value=>{input.value=String(value??'');paint();},focus:()=>input.focus({preventScroll:true}),
    // The folder a new note goes into, as the note list decides it (null = 폴더 없음).
    // color: the folder's color number (1~8) or null — the icon takes that folder's color (folder-look.css [data-fc]).
    setFolder:(name,color=null)=>{folderName=name||null;folderColor=folderName?color:null;paint();}};
}
