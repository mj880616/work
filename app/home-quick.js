import { viewPrefs } from './view-prefs.js';
import {basketOcrFor} from './basket-ocr-runtime.js';
import { createChoiceSheet, projectRows } from './choice-sheet.js';
import { readPlaces, placeSheetHtml, placeValue, keepPlaces, placeList, togglePlace, choiceCountText, placesLabel, PLACE_LIMIT, saveUpdate, saveUpdateWithFiles, rememberPlace, linkFailText, fileFailText } from './update-places.js';
import { createGoogleTask } from './quick-save.js';
import { createNote, validateNoteText, createNoteDoc, noteTitleFromText } from './basket-data.js';
import { createUploadBatch, uploadBatch, uploadNoteFiles, mountBasketPicker, fileTitle } from './basket-upload.js';
import { extractHtmlDocument, htmlFileName, utf8Bytes, HTML_MAX_BYTES, HTML_MARK } from './chatgpt-html.mjs';
import { dayKey } from './home-read-model.js';
import { taskFilesAvailable, taskFilesKnown, onTaskFilesReady, attachNewTaskFiles, newTaskFilesNotice, MAX_TASK_FILES } from './task-files.js';

export function mountQuick({root, dependencies, refreshTasks=()=>{}, invalidateProjects=()=>{}, esc, basketOnly=false, taskOnly=false, noteOnly=false, onBig=null, onFolder=null, view="home", idPrefix="home", onSaved=()=>{}}) {
  // UI-할일입력: taskOnly is the [할 일] screen's always-visible input. It is the [할 일] mode of this same box with the mode
  // buttons, project·date row and basket link taken out; each task it adds is due today (KST) and uses the same create path.
  // BASKET-노트입력창: noteOnly is the basket [노트] list's always-visible input, the same box as the basket's update input
  // (phone: docked above the tabs; PC: at the top of the list). [추가] saves a note whose title is the first line (createNoteDoc,
  // 마크다운 off like a new note in the write window); [크게] hands the text and this box's files to onBig (the note list's write
  // window). NOTE-파일붙이기: its clip and drop take files too; they go up with the new note's id after the note is saved.
  const box=root.querySelector('.home-quick-placeholder');
  box.removeAttribute('aria-hidden'); box.className='home-quick'; box.dataset.homeQuick='';
  const quickScope=()=>{const c=window.KPTURuntime.context.read();return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
  let quickOwner=quickScope();
  // BASKET-업데이트통합 PR 1: the home box has two modes, [업데이트 ▾] and [할 일]. [업데이트] with no place chosen is the old
  // [바구니] (a basket note, attachments allowed); with an organization or a project chosen it is that place's record, saved
  // through the same existing paths as before. toBasket() is that one rule; data-mode shows the effective kind (basket/update/task).
  let mode='update',saving=false,expanded=false,project='',places=[],pendingPlaces=[],due='',dateKind='',choicesFlight=null,choiceEpoch=0,projectChoices=[],orgChoices={recent:[],groups:[]},bundleChoices=[];
  { const saved=basketOnly||taskOnly?null:viewPrefs.get('home_quick_mode'); mode=saved==='task'?'task':'update'; }
  if(taskOnly)mode='task';
  if(noteOnly)mode='note';
  // NOTE-추가폴더표시: the note input's [폴더 ▾] shows the folder a new note goes into (null = 폴더 없음). The note list owns the
  // choice and its picker (onFolder opens it under this button); setFolder() only paints the name here and in the placeholder.
  let folderName=null;
  const toBasket=()=>mode==='update'&&!places.length;
  // Whether the clip and drop take files for this save: an update (basket or chosen places), or a note (NOTE-파일붙이기).
  // BUG-업데이트첨부연결: choosing an organization or a project keeps the clip, the drop and the files already chosen; [추가]
  // saves them as the basket would and then links/files them there (update-places.js saveUpdateWithFiles).
  // TASK-추가창파일: a new task too, once the task-file table answers (as ⋯ → 파일 붙이기); they go up after Google made the task.
  // TEST-홈빠른입력안정화: while this load's task-file table answer for [할 일] is not in, the clip's place is kept (unseen,
  // unusable), so the input does not narrow once the answer comes (PC: [📎 첨부] sits left of [추가]). A no frees the place.
  let taskFilesOn=false,taskFilesWait=false;
  const takesFiles=()=>noteOnly||mode==='update'||(mode==='task'&&taskFilesOn);
  // UPD-여러곳고르기: places is the list chosen on the 기록할 곳 sheet (in the order picked; empty is the basket).
  const currentPlaces=()=>places.map(p=>({...p}));
  // The lists the 기록할 곳 sheet offers (REF-참고묶음: with the reference bundles at the bottom).
  const placeChoices=()=>({projects:projectChoices,orgs:orgChoices,bundles:bundleChoices});
  const setPlaces=list=>{places=placeList(list);};
  let taskAttempt=null,taskRequest=null,taskSequence=0,taskReading=false,taskSessionEpoch=window.KPTURuntime.session.epoch();
  let upload = createUploadBatch(),uploadGeneration=0,pendingOcr=null;
  const guardPendingOcr=()=>{pendingOcr?.current();};
  for(const event of ['click','keydown','input'])box.addEventListener(event,guardPendingOcr,true);
  window.addEventListener('storage',guardPendingOcr);
  window.addEventListener('kptu:session-changed',guardPendingOcr);
  // HOME-빠른입력정리: the task options row sits above the mode buttons, and the organization picker is the ▾ right of [업데이트].
  box.innerHTML=`<div data-quick-options hidden><div data-quick-task-options><button type="button" data-quick-project aria-label="프로젝트" aria-haspopup="dialog" aria-expanded="false">프로젝트 ▾</button><button type="button" data-quick-day="today">오늘</button><button type="button" data-quick-day="tomorrow">내일</button><button type="button" data-quick-day="date">날짜</button><input type="date" data-quick-date aria-label="기한 날짜" tabindex="-1"></div></div><div class="home-quick-modes" role="group" aria-label="입력 종류"><span class="home-quick-update-split"><button type="button" data-quick-mode="update">업데이트</button><button type="button" data-quick-org aria-label="기록할 곳 선택" aria-haspopup="dialog" aria-expanded="false">▾</button></span><button type="button" data-quick-mode="task">할 일</button></div><div class="home-quick-entry"><div class="home-quick-input-wrap"><div data-quick-file-picker hidden></div><textarea data-quick-input aria-label="빠른 입력" rows="1" placeholder="할 일을 입력하세요"></textarea><button type="button" class="home-quick-big" data-quick-big aria-label="큰 창에서 쓰기" aria-haspopup="dialog"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button type="button" class="home-quick-detail" data-quick-detail aria-label="상세 설정으로 추가" aria-haspopup="dialog"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div><button type="button" class="home-quick-folder" data-quick-folder aria-haspopup="dialog" aria-expanded="false" hidden>폴더 없음 ▾</button><button type="button" class="home-quick-save" data-quick-save>추가</button></div><p class="home-quick-hint" data-quick-hint role="status"></p><div class="home-quick-lock" data-quick-lock hidden><p data-quick-lock-reason></p><button type="button" class="home-quick-new-note" data-quick-new-note>새 업데이트 입력</button></div><div data-quick-basket-options hidden><div data-quick-files></div></div><div data-quick-status role="status"></div><button type="button" data-goto="basket" class="home-basket-link">바구니 전체 보기 ›</button>`;
  const input=box.querySelector('[data-quick-input]'),options=box.querySelector('[data-quick-options]'),status=box.querySelector('[data-quick-status]'),hint=box.querySelector('[data-quick-hint]'),orgSelect=box.querySelector('[data-quick-org]'),projectSelect=box.querySelector('[data-quick-project]'),date=box.querySelector('[data-quick-date]');
  const pickerFiles=mountBasketPicker(box.querySelector('[data-quick-file-picker]'),{id:idPrefix==='home'?'quickBasketFiles':idPrefix+'QuickBasketFiles',filesHost:box.querySelector('[data-quick-files]'),dropTarget:box,isActive:()=>takesFiles(),getBatch:()=>upload,isBusy:()=>saving,onError:message=>status.textContent=message,onChange:()=>{status.textContent='';paint();}});
  // UI-PC바구니첨부버튼: on PC the same picker part sits outside the input, just left of [추가], as [📎 첨부].
  // The phone keeps it inside the input's left edge. Moving the node keeps focus order the same as what is seen.
  const pickerHost=box.querySelector('[data-quick-file-picker]'),pickerWide=window.matchMedia('(min-width:761px)');
  const placePicker=()=>{if(pickerWide.matches)box.querySelector('[data-quick-save]').before(pickerHost);else box.querySelector('.home-quick-input-wrap').prepend(pickerHost);};
  pickerWide.addEventListener('change',placePicker);placePicker();
  // NOTE-추가폴더표시: [폴더 ▾] sits right after the input on a wide screen (input → [폴더 ▾] → [📎 첨부] → [추가], each 8px apart); on a phone the docked box gets one small row above the input.
  const folderBtn=box.querySelector('[data-quick-folder]');
  if(!noteOnly)folderBtn.remove();
  else{
    const row=document.createElement('div');row.className='home-quick-folder-row';row.dataset.quickFolderRow='';box.querySelector('.home-quick-entry').before(row);
    const placeFolder=()=>{if(pickerWide.matches)pickerHost.before(folderBtn);else row.append(folderBtn);row.hidden=pickerWide.matches;};
    pickerWide.addEventListener('change',placeFolder);placeFolder();
    folderBtn.onclick=()=>{if(saving)return;onFolder?.(folderBtn);};
  }
  // MD-표시보완: a pasted complete HTML document (ChatGPT HTML) becomes a .html attachment of this memo through the
  // same upload path as the clip; the text keeps a short mark. Nothing is saved until [추가].
  input.addEventListener('paste',e=>{
    if(!(noteOnly||mode==='update')||saving||input.readOnly)return;
    const found=extractHtmlDocument(e.clipboardData?.getData('text/plain')||'');if(!found)return;
    e.preventDefault();
    if(utf8Bytes(found.html)>HTML_MAX_BYTES){status.textContent='HTML 문서가 2MB를 넘어 붙여 넣지 않았어요. 더 짧게 만들어 달라고 한 뒤 다시 붙여 넣어 주세요.';return;}
    if(!pickerFiles.add([new File([found.html],htmlFileName(),{type:'text/html'})]))return;
    input.setRangeText([found.before,HTML_MARK,found.after].filter(Boolean).join('\n'),input.selectionStart,input.selectionEnd,'end');
    input.dispatchEvent(new Event('input',{bubbles:true}));
    status.textContent=toBasket()||noteOnly?'HTML 문서를 첨부 파일로 바꿨어요. [추가]를 누르면 바구니에 저장돼요.':'HTML 문서를 첨부 파일로 바꿨어요. [추가]를 누르면 고른 곳 자료로 넣어요.';
  });
  box.querySelector('[data-quick-new-note]').onclick=()=>{if(saving)return;if((input.value||upload.entries.some(e=>e.kind!=='success'))&&!window.confirm('바구니에서 저장 여부를 확인한 후 새 업데이트를 입력할까요? 현재 입력과 파일 선택은 비워집니다.'))return;upload=createUploadBatch();input.value='';status.textContent='';paint();input.focus();};
  // UI-버튼크기: 홈은 세 모드 모두 한 줄 높이에서 시작해 글에 맞춰 늘고 5줄에서 멈춘다(그 뒤는 칸 안 스크롤). 바구니 화면은 CSS 높이 그대로.
  function size(){ input.style.height=''; if(basketOnly||taskOnly||noteOnly)return; const s=getComputedStyle(input),edge=parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)+parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth),line=parseFloat(s.lineHeight)||21,min=input.offsetHeight;input.style.height=Math.max(min,Math.min(line*5+edge,input.scrollHeight+parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth)))+'px'; }
  function paint(){
    pickerFiles.render();
    // A saved or unconfirmed note keeps its text; say why and offer the reset next to the input.
    // A note's files are always settled by its own save (the batch is emptied after it), so the note input never locks.
    const locked=mode==='update'&&(!!upload.note_id||!!upload.blocked);input.readOnly=locked;box.querySelector('[data-quick-lock]').hidden=!locked;
    box.querySelector('[data-quick-lock-reason]').textContent=!locked?'':upload.blocked?'앞선 저장 결과를 확인하지 못해 입력창을 잠갔어요. 바구니 목록에서 저장 여부를 확인하고, 새로 쓰려면 ‘새 업데이트 입력’을 눌러 주세요.':'업데이트 글은 이미 저장되어 남은 첨부만 다시 저장할 수 있어요. 새로 쓰려면 ‘새 업데이트 입력’을 눌러 주세요.';
    if(noteOnly){const f=box.querySelector('[data-quick-folder]'),label=folderName||'폴더 없음';f.hidden=false;f.textContent=label+' ▾';f.title='노트를 넣을 폴더: '+label;f.setAttribute('aria-label','노트를 넣을 폴더: '+label+'. 누르면 다른 폴더를 고릅니다');}
    box.dataset.mode=noteOnly?'note':toBasket()?'basket':mode; input.rows=1; const targetName=placesLabel(placeChoices(),places);
    input.placeholder=noteOnly?(folderName?`${folderName}에 노트 추가`:'노트를 입력하세요'):mode==='task'?'할 일을 입력하세요':toBasket()?(basketOnly?'업데이트를 입력하세요':'업데이트 입력(바구니에 저장)'):(targetName||'담당조직')+' 기록을 입력하세요';
    const filesWait=!takesFiles()&&taskFilesWait&&mode==='task';
    box.querySelector('[data-quick-file-picker]').hidden=!takesFiles()&&!filesWait;box.querySelector('[data-quick-file-picker]').toggleAttribute('data-quick-files-wait',filesWait);
    // TASK-추가창파일: a task takes up to 10 files (the ⋯ → 파일 붙이기 limit), not the basket's 20; say where they go.
    const fileHint=box.querySelector('[data-basket-hint]');if(fileHint)fileHint.textContent=mode==='task'?`파일당 100MB · ${MAX_TASK_FILES}개까지 · 추가하면 Drive "자료실/할 일 첨부"에 올라갑니다`:'파일당 100MiB · 20개까지';
    if(!taskOnly)box.querySelector('[data-quick-big]').hidden=mode==='task';
    if(!taskOnly&&!basketOnly&&!noteOnly)box.querySelector('[data-quick-detail]').hidden=mode!=='task';
    box.querySelector('[data-quick-basket-options]').hidden=!takesFiles()||!upload.entries.length;
    box.querySelectorAll('[data-quick-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.quickMode===mode)));
    options.hidden=taskOnly||!expanded||mode!=='task';
    projectSelect.textContent=(projectChoices.find(x=>x.project.id===project)?.project.name||'프로젝트')+' ▾';
    projectSelect.setAttribute('aria-label',project?'프로젝트: '+projectSelect.textContent.slice(0,-2):'프로젝트');
    orgSelect.setAttribute('aria-label',places.length&&targetName?'기록할 곳 선택: '+targetName:'기록할 곳 선택');
    // UPD-여러곳고르기 ⑥: with two or more places the [업데이트] button itself says where ("첫 곳 이름 외 N"); one place keeps
    // [업데이트] (its name is in the input's placeholder, as before).
    const updateBtn=box.querySelector('[data-quick-mode="update"]');if(updateBtn){const many=mode==='update'&&places.length>1&&targetName;updateBtn.textContent=many?targetName:'업데이트';updateBtn.title=many?targetName:'';updateBtn.toggleAttribute('data-quick-many',!!many);}
    box.querySelectorAll('[data-quick-day]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.quickDay===dateKind));if(b.dataset.quickDay==='date')b.textContent=dateKind==='date'?`${Number(due.slice(5,7))}.${Number(due.slice(8,10))}`:'날짜';});size();
  }
  async function choices(){
    if(choicesFlight)return choicesFlight;
    const run=choiceEpoch;
    choicesFlight=(async()=>{
      await dependencies.google();
      // BASKET-업데이트통합: the same place lists (and three recent organizations) as the write window (update-places.js).
      const read=await readPlaces(dependencies,{isCurrent:()=>run===choiceEpoch});
      if(!read||run!==choiceEpoch)return;
      projectChoices=read.projects;orgChoices=read.orgs;bundleChoices=read.bundles||[];
      if(!projectChoices.some(x=>x.project.id===project))project='';
      places=keepPlaces(placeChoices(),places);
      paint();picker.render();
    })().catch(e=>{if(run===choiceEpoch){choicesFlight=null;status.textContent=e.message||'선택 목록을 불러오지 못했습니다.';}});
    return choicesFlight;
  }
  // The [할 일] options need the lists at once; [업데이트] reads them when its ▾ sheet opens (the sheet waits for choices()).
  function expand(){expanded=true;paint();if(mode==='task'&&!taskOnly)void choices();}
  input.addEventListener('focus',expand); input.addEventListener('input',()=>{if(input.value.trim())hint.textContent='';expand();size();});
  const picker=createChoiceSheet({id:idPrefix+'ChoiceSheet',titleId:idPrefix+'ChoiceTitle',historyKey:idPrefix==='home'?'kptuHomeChoice':'kptu'+idPrefix+'Choice',
    canOpen:()=>!saving&&window.KPTURouter.current===view,choices,
    render:kind=>{
      // BASKET-업데이트통합: [바구니(미분류)] (no place) is the first chip, on the recent line (update-places.js, shared with the write window).
      // UPD-여러곳고르기: the 기록할 곳 sheet keeps many; presses mark a pending list that only [저장] makes the input's (onCommit).
      if(kind==='org')pendingPlaces=currentPlaces();
      return {title:kind==='org'?'기록할 곳 선택':'프로젝트 선택',search:kind==='org'?'조직·프로젝트 이름 검색':'프로젝트 이름 검색',split:kind==='org',html:kind==='org'?placeSheetHtml(placeChoices(),pendingPlaces,esc):projectRows(projectChoices,project,esc)};
    },
    multi:kind=>kind==='org'?{pressed:value=>value==='basket'?!pendingPlaces.length:pendingPlaces.some(p=>placeValue(p)===value),label:choiceCountText(pendingPlaces)}:null,
    onSelect:(kind,value)=>{if(kind==='org'){const next=togglePlace(pendingPlaces,value);if(next)pendingPlaces=next;else status.textContent=`한 번에 ${PLACE_LIMIT}곳까지 고를 수 있어요.`;return;}project=value;paint();},
    onCommit:kind=>{if(kind!=='org')return;setPlaces(pendingPlaces);status.textContent='';paint();}
  });
  const openSheet=kind=>picker.open(kind,kind==='org'?orgSelect:projectSelect);
  const dismissForNavigation=()=>picker.dismiss();
  projectSelect.onclick=()=>void openSheet('project');
  // ▾ also picks [업데이트] when another mode is showing, then opens the organization sheet.
  orgSelect.onclick=()=>{if(saving)return;if(mode!=='update')setMode('update');void openSheet('org');};
  // UI-기록할곳되돌리기 (b)(c): a place (and a task's project) chosen here is for one add only. Leaving the screen, or closing the big
  // window without saving, puts the next input back on the basket (and no project); the placeholder then says 바구니. A save in
  // flight keeps its place, and a task whose result is still being confirmed keeps its project.
  const resetChoices=()=>{if(saving)return;if(places.length)setPlaces([]);if(project&&!taskAttempt&&!taskRequest)project='';paint();};
  window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view!==view){uploadGeneration++;dismissForNavigation();resetChoices();}});
  // The clip shows in [할 일] only when the task-file table answers for this owner (checked once; only a yes is kept).
  // The [할 일] screen's own input does not ask: the task list below it reads the table anyway, and its answer turns the clip on.
  const filesAnswer=on=>{taskFilesWait=false;if(on)taskFilesOn=true;paint();};
  const checkTaskFiles=()=>{
    if(taskFilesOn||noteOnly||basketOnly||mode!=='task')return;
    if(taskFilesKnown()){filesAnswer(true);return;}
    // The [할 일] screen asks nothing itself: its list's read answers (onTaskFilesReady, a failed read too).
    taskFilesWait=true;paint();
    if(taskOnly)return;
    const owner=quickScope();void taskFilesAvailable().then(on=>{if(owner===quickScope()&&!taskFilesOn)filesAnswer(on);});
  };
  if(!noteOnly&&!basketOnly)onTaskFilesReady((owner,yes)=>{if(taskFilesOn||!owner||owner!==window.KPTURuntime.context.read()?.user?.id)return;if(yes)checkTaskFiles();else if(taskFilesWait)filesAnswer(false);});
  function setMode(next){
    mode=next;status.textContent='';hint.textContent='';
    if(!basketOnly&&!taskOnly&&(mode==='task'||mode==='update'))viewPrefs.set('home_quick_mode',mode);
    paint();checkTaskFiles();if(mode==='task'&&taskAttempt?.needsReview)taskNotice('앞선 저장 결과를 확인해 주세요. 입력은 유지했습니다.',{confirm:true});if(expanded&&mode==='task')void choices();
  }
  box.querySelectorAll('[data-quick-mode]').forEach(b=>b.onclick=()=>{if(!saving)setMode(b.dataset.quickMode);});
  box.querySelectorAll('[data-quick-day]').forEach(b=>b.onclick=()=>{
    if(saving)return;const kind=b.dataset.quickDay;
    if(dateKind===kind){due='';dateKind='';date.value='';paint();return;}
    if(kind==='date'){try{date.showPicker();}catch{date.focus();date.click();}return;}
    dateKind=kind;due=dayKey(Date.now()+(kind==='tomorrow'?86400000:0));paint();
  });
  date.onchange=()=>{due=date.value;dateKind=due?'date':'';paint();};
  const taskRuntime=window.KPTURuntime;
  const taskIdentity=task=>!!task&&typeof task.id==='string'&&!!task.id&&typeof task.taskListId==='string'&&!!task.taskListId&&typeof task.title==='string';
  const taskSnapshot=()=>JSON.stringify({raw:input.value,project,due,dateKind});
  const taskScopeCurrent=r=>{const c=taskRuntime.context.read();return box.isConnected&&r.owner===c?.user?.id&&r.workspace===c?.workspace?.id&&r.epoch===taskRuntime.session.epoch();};
  const taskCurrent=r=>taskRequest===r&&r.token===taskSequence&&taskScopeCurrent(r)&&mode==='task';
  const taskLinkKey=link=>link.project_id?'project:'+link.project_id:link.organization_id?'organization:'+link.organization_id:link.meeting_id?'meeting:'+link.meeting_id:'';
  function taskLinkKeys(result){if(!Array.isArray(result?.links)||!Array.isArray(result?.meeting_links))throw new Error('프로젝트 연결의 저장 결과를 확인하지 못했습니다.');return new Set([...result.links,...result.meeting_links].filter(l=>l.status==='confirmed').map(taskLinkKey).filter(Boolean))}
  function taskNotice(message,{confirm=false}={}){status.textContent=message;if(confirm&&mode==='task'){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=taskAttempt?.task?'연결 확인':'할 일 목록에서 확인';b.onclick=()=>recoverQuickTask();status.append(document.createTextNode(' '),b)}}
  function taskControls(busy){box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=busy);pickerFiles.render()}
  function taskToast(r,message){if(!taskScopeCurrent(r))return;const toast=document.querySelector('#toast');if(!toast)return;toast.textContent=message;toast.classList.remove('hidden');clearTimeout(save.toastTimer);save.toastTimer=setTimeout(()=>{if(taskScopeCurrent(r)&&r.token===taskSequence)toast.classList.add('hidden')},3200)}
  function taskBodyMatches(task,body){return task.title===body.title&&(task.notes||'')===(body.notes||'')&&(task.due?String(task.due).slice(0,10):null)===(body.due||null)}
  async function recoverQuickTask(){
    const a=taskAttempt;if(!a||a.pending||taskRequest||taskReading||mode!=='task'||!taskScopeCurrent(a))return;
    const run=++taskSequence,active=()=>run===taskSequence&&taskAttempt===a&&taskScopeCurrent(a)&&mode==='task';
    const read=async path=>{if(!active())throw new Error('입력창이나 로그인이 바뀌었습니다.');const d=await taskRuntime.api('/functions/v1/google-tasks?action='+path,{singleFlight:false,expectedSessionEpoch:a.epoch});if(!active())throw new Error('입력창이나 로그인이 바뀌었습니다.');return d};
    const tasks=async()=>{const d=await read('tasks&pending_scope=all');if(!Array.isArray(d?.tasks)||d.needs_reconnect||d.error)throw new Error(d?.warning||d?.error||'Google 할 일 목록을 확인하지 못했습니다.');return d.tasks.filter(taskIdentity)};
    const accept=async row=>{const exact=(await tasks()).filter(t=>t.id===row.id&&t.taskListId===row.taskListId);if(exact.length!==1)throw new Error('선택한 기존 할 일을 확인하지 못했습니다.');const links=taskLinkKeys(await read('links&task_id='+encodeURIComponent(row.id)));a.task=structuredClone(exact[0]);a.bodyState='confirmed';a.links=links;a.linkState='confirmed';a.needsReview=false;taskNotice('선택한 기존 할 일을 사용합니다. 입력을 확인한 뒤 저장해 주세요.')};
    taskReading=true;saving=true;taskControls(true);taskNotice('할 일과 프로젝트 연결을 확인하는 중…');
    try{
      if(a.task)await accept(a.task);
      else{const rows=await tasks();taskNotice(rows.length?'저장된 할 일을 직접 골라 주세요. 제목만으로 저장을 판단하지 않습니다.':'목록에서 결과를 찾지 못했습니다. 입력은 유지하며 새로 만들지 않습니다.',{confirm:!rows.length});for(const row of rows){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=row.title+' · 이 항목 사용';b.onclick=async()=>{if(!active()||taskReading)return;taskReading=true;saving=true;taskControls(true);try{await accept(row)}catch(error){if(active())taskNotice(error.message||String(error),{confirm:true})}finally{if(active()){taskReading=false;saving=false;taskControls(false);paint()}}};status.append(document.createTextNode(' '),b);const hint=document.createElement('small');hint.textContent=[row.taskListTitle||'Google 할 일',row.due?String(row.due).slice(0,10):'기한 없음',row.notes||''].join(' · ');status.append(hint)}}
    }catch(error){if(active())taskNotice('저장 결과를 확인하지 못했습니다. '+(error.message||error),{confirm:true})}
    finally{if(active()){taskReading=false;saving=false;taskControls(false);paint()}}
  }
  async function saveTask(){
    if(saving||taskRequest||taskReading)return;const ctx=taskRuntime.context.read();if(!ctx?.user?.id||!ctx?.workspace?.id)return;
    const a=taskAttempt;if(a?.pending)return;if(a&&(a.needsReview||a.bodyState==='unknown'||a.linkState==='unknown')){taskNotice('앞선 저장 결과를 먼저 확인해 주세요. 새 할 일은 만들지 않았습니다.',{confirm:true});return}
    const title=input.value.trim();if(!title)return;
    const batch=upload,files=takesFiles()?batch.entries.filter(e=>e.kind!=='success').map(e=>e.file):[];
    if(files.length>MAX_TASK_FILES){taskNotice(`한 할 일에는 파일을 ${MAX_TASK_FILES}개까지 붙일 수 있습니다.`);return}
    const attempt=a||{owner:ctx.user.id,workspace:ctx.workspace.id,epoch:taskRuntime.session.epoch(),task:null,bodyState:'idle',linkState:'idle',links:new Set(),needsReview:false};
    const body=Object.freeze({title,due:taskOnly?dayKey(Date.now()):due||null,notes:attempt.task?.notes||'',links:Object.freeze(project?[Object.freeze({project_id:project})]:[])}),r={owner:attempt.owner,workspace:attempt.workspace,epoch:attempt.epoch,token:++taskSequence,attempt,body,draft:taskSnapshot()};
    taskAttempt=attempt;taskRequest=r;attempt.pending=true;saving=true;taskControls(true);taskNotice('저장 중…');let stage='body';
    // TASK-추가창파일: the chosen files go up once the task exists (once per attempt, also after a recovered create).
    const sendFiles=async()=>{if(!files.length||attempt.filesSent||!attempt.task)return;attempt.filesSent=true;
      const result=await attachNewTaskFiles(attempt.task.id,files,{onProgress:(i,n,f)=>{if(taskCurrent(r))taskNotice(`${f.name} 올리는 중… (${i+1}/${n})`)}});
      attempt.filesNotice=newTaskFilesNotice(result);if(upload===batch)upload=createUploadBatch();
      if(attempt.filesNotice&&taskScopeCurrent(r))taskToast(r,'할 일은 저장했습니다. 파일을 확인해 주세요.');};
    const call=(action,body)=>{if(!taskCurrent(r))throw new Error('입력창이나 로그인이 바뀌었습니다.');return taskRuntime.api('/functions/v1/google-tasks?action='+action,{method:'POST',body,expectedSessionEpoch:r.epoch})};
    try{
      if(!attempt.task){
        const result=await createGoogleTask({...body,expectedSessionEpoch:r.epoch});if(!taskScopeCurrent(r))return;
        if(result?.ok===true&&taskIdentity(result.task))attempt.task=structuredClone(result.task);
        if(!attempt.task||!taskBodyMatches(attempt.task,body))throw new Error('Google 할 일의 저장 결과를 확인하지 못했습니다.');attempt.bodyState='confirmed';
        // TASK-추가창파일: the task exists; the chosen files go up now (once, even if the links need another save).
        await sendFiles();
        if(!taskCurrent(r)){attempt.needsReview=true;return}
        stage='links';attempt.links=taskLinkKeys(result);
        if(result.link_error||body.links.some(l=>!attempt.links.has(taskLinkKey(l)))){attempt.linkState='partial';attempt.needsReview=true;taskNotice('할 일은 저장했습니다. 프로젝트 연결을 확인해 주세요.'+(attempt.filesNotice?' '+attempt.filesNotice:''),{confirm:true});taskToast(r,'할 일은 저장했습니다. 프로젝트 연결을 확인해 주세요.');return}
      }else if(!taskBodyMatches(attempt.task,body)){
        const result=await call('update',{action:'update',task_id:attempt.task.id,task_list_id:attempt.task.taskListId,title:body.title,notes:body.notes,due:body.due});if(!taskScopeCurrent(r))return;
        if(result?.ok!==true||!taskIdentity(result.task)||result.task.id!==attempt.task.id||result.task.taskListId!==attempt.task.taskListId||!taskBodyMatches(result.task,body))throw new Error('기존 할 일의 수정 결과를 확인하지 못했습니다.');attempt.task=structuredClone(result.task);attempt.bodyState='confirmed';if(!taskCurrent(r)){attempt.needsReview=true;return}
      }
      await sendFiles();if(!taskCurrent(r)){attempt.needsReview=true;return}
      stage='links';const missing=body.links.filter(l=>!attempt.links.has(taskLinkKey(l)));
      if(missing.length){const result=await call('link',{action:'link',task_id:attempt.task.id,links:missing});if(!taskScopeCurrent(r))return;const confirmed=taskLinkKeys(result);if(result?.ok!==true||missing.some(l=>!confirmed.has(taskLinkKey(l))))throw new Error('프로젝트 연결의 저장 결과를 확인하지 못했습니다.');attempt.links=confirmed;if(!taskCurrent(r)){attempt.needsReview=true;return}}
      attempt.linkState='confirmed';if(!taskCurrent(r))return;taskAttempt=null;r.completed=true;
      
      if(taskSnapshot()===r.draft){input.value='';expanded=false;taskNotice(attempt.filesNotice||'')}else{expanded=true;taskNotice('제출한 할 일은 저장했습니다. 추가 입력은 남겨 두었습니다.'+(attempt.filesNotice?' '+attempt.filesNotice:''))}
      // UI-기록할곳되돌리기 (c): the next task starts with no project (the date choice stays as before).
      project='';paint();taskToast(r,attempt.filesNotice?'할 일은 저장했습니다. 파일을 확인해 주세요.':'할 일을 추가했습니다.');
      try{void Promise.resolve(refreshTasks()).catch(()=>{if(taskScopeCurrent(r)&&r.token===taskSequence&&mode==='task'&&!input.value)taskNotice('할 일은 저장했습니다. 목록을 다시 불러오지 못했습니다.')})}catch(error){if(taskCurrent(r))taskNotice('할 일은 저장했습니다. 목록을 다시 불러오지 못했습니다.')}
    }catch(error){if(!taskScopeCurrent(r))return;if(stage==='body')attempt.bodyState='unknown';else attempt.linkState='unknown';attempt.needsReview=true;if(taskCurrent(r))taskNotice((attempt.task?'할 일은 확인했습니다. 연결과 수정 결과를 확인해 주세요. ':'저장 결과를 확인하지 못했습니다. ')+(error.message||error),{confirm:true})}
    finally{attempt.pending=false;if(taskRequest===r&&taskScopeCurrent(r)&&r.token===taskSequence){taskRequest=null;saving=false;taskControls(false);paint()}}
  }
  // Resolves {ok:true} or {ok:false, message}; the write window's save icon ([크게]) waits for it (same path as [추가]).
  async function save(){
    if(mode==='task')return saveTask();
    if(noteOnly)return saveNote();
    const fail=message=>{status.textContent=message;return {ok:false,message};};
    if(saving)return {ok:false,message:'저장 중이에요.'};
    // UI-빈입력안내: no text is a small hint line right under the input (not an error, no red); typing removes it.
    if(!input.value.trim()&&!(mode==='update'&&upload.entries.length)){const message='글을 입력해 주세요.';status.textContent='';hint.textContent=message;return {ok:false,message};}
    if(toBasket()||places.length>1){if(!upload.entries.length){try{validateNoteText(input.value);}catch(e){return fail(e.message);}}}
    // BUG-업데이트첨부연결: organization and project records have no attachment column, so an update with files and chosen
    // places goes up as a basket update first and is then linked and filed there (saveUpdateWithFiles), as the basket would.
    const withFiles=!toBasket()&&upload.entries.length>0;
    const ctx=window.KPTURuntime.context.read(),owner=ctx?.user?.id;if(!owner)return {ok:false,message:'로그인 정보를 확인하지 못했어요.'};
    const saveMode=toBasket()?'basket':withFiles?'files':mode,text=saveMode==='update'?input.value.trim():input.value,workspace=ctx.workspace?.id,batch=upload,generation=uploadGeneration;const isCurrent=()=>{const c=window.KPTURuntime.context.read();return c?.user?.id===owner&&c?.workspace?.id===workspace&&batch===upload&&window.KPTURouter.current===view;};
    // The native guard belongs to this save, even after the view comes back.
    let invalidated=false,sessionEpoch;
    const token={current:()=>{if(invalidated)return false;const session=window.KPTURuntime.session.read();if(generation!==uploadGeneration||!isCurrent()||sessionEpoch!==window.KPTURuntime.session.epoch()||session?.user?.id!==owner||!session?.access_token)invalidated=true;return !invalidated;}};
    const ocr=saveMode!=='update'&&batch.entries.length?basketOcrFor({isCurrent:token.current}):null;
    if(ocr?.enabled){sessionEpoch=window.KPTURuntime.session.epoch();pendingOcr=token;}
    saving=true;status.textContent='';hint.textContent='';
    box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);pickerFiles.render();
    try{
      const onChange=()=>{if(isCurrent())paint();},onOcrChange=value=>{if(isCurrent()&&token.current()&&!value.ok)status.textContent=value.result_unknown?'사진은 저장했습니다. 글자 읽기 결과는 바구니에서 확인해 주세요.':value.ocr_saved?'사진과 글자는 저장했습니다. 임시 문서 정리는 바구니에서 확인해 주세요.':value.text?'사진은 저장했습니다. 이전 글자는 유지했습니다. 읽기 결과와 임시 문서 정리는 바구니에서 확인해 주세요.':'사진은 저장했습니다. 글자는 읽지 못했습니다.';};
      const sameOwner=()=>{const c=window.KPTURuntime.context.read();return c?.user?.id===owner&&c?.workspace?.id===workspace;};
      const result=saveMode==='basket'?(batch.entries.length?await uploadBatch(batch,{raw_text:text,isCurrent,ocr,onChange,onOcrChange}):await createNote({raw_text:text})):saveMode==='files'?await saveUpdateWithFiles({places:currentPlaces(),text,batch,isCurrent,sameOwner,ocr,onChange,onOcrChange}):await saveUpdate({places:currentPlaces(),text,owner});
      if(!isCurrent())return {ok:false,message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      if(saveMode!=='update'&&!batch.blocked&&batch.entries.every(entry=>entry.kind==='success'))upload=createUploadBatch();
      // UI-기록할곳되돌리기: after an organization or project record is added, the next input goes to the basket again; the places
      // stay first on the sheet's 최근 line (update-places.js). A failed save keeps the places (catch below) for another try.
      // UPD-여러곳고르기: with two or more places the update is one basket note linked to each; when the links are refused the
      // note is still saved in the basket, so the input is emptied (no second note on a retry) and the line says what to do.
      // BUG-업데이트첨부연결: with files, a refused link or filing leaves the update saved in the basket; the line says which.
      const linkFailed=!!result?.linkError,fileFailed=saveMode==='files'&&result?.filed?.ok===false;
      if(saveMode!=='basket'){rememberPlace(currentPlaces());setPlaces([]);}
      input.value='';expanded=false;paint();if(saveMode==='basket'||result?.note)onSaved(result?.note||result);
      if(linkFailed||fileFailed)status.textContent=[linkFailed?linkFailText:'',fileFailed?[fileFailText,result.filed.message].filter(Boolean).join(' '):''].filter(Boolean).join(' ');
      const toast=document.querySelector('#toast');toast.textContent=linkFailed||fileFailed||saveMode==='basket'?'바구니에 저장했습니다.':saveMode==='files'?(text.trim()?'기록과 자료를 저장했습니다.':'자료로 넣었습니다.'):'기록을 저장했습니다.';toast.classList.remove('hidden');clearTimeout(save.toastTimer);save.toastTimer=setTimeout(()=>toast.classList.add('hidden'),3200);
      choicesFlight=null;
      return linkFailed||fileFailed?{ok:true,linkError:result.linkError||'',fileError:fileFailed?(result.filed.message||'FILES'):''}:{ok:true};
    }catch(e){const message=e.message||'저장하지 못했습니다.';if(isCurrent())status.textContent=message;return {ok:false,message};}
    finally{if(pendingOcr===token)pendingOcr=null;saving=false;box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);paint();}
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
      let warning='';
      if(files.length){
        try{await uploadNoteFiles(note.id,batch,{isCurrent:()=>owner===quickScope(),onChange:()=>{if(isCurrent())pickerFiles.render();}});}
        catch(e){warning=`노트는 저장했지만 첨부를 올리지 못했어요. ${e?.message||''}`.trim();}
      }
      if(owner!==quickScope())return {ok:false,message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      if(upload===batch)upload=createUploadBatch();
      if(!isCurrent())return {ok:false,message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      input.value='';expanded=false;paint();onSaved(note);
      if(warning)status.textContent=warning;
      const toast=document.querySelector('#toast');if(toast){toast.textContent=warning?'노트는 저장했어요. 첨부를 확인해 주세요.':'노트를 추가했습니다.';toast.classList.remove('hidden');clearTimeout(save.toastTimer);save.toastTimer=setTimeout(()=>toast.classList.add('hidden'),3200);}
      return {ok:true};
    }catch(e){const message=e.message||'저장하지 못했습니다.';if(isCurrent())status.textContent=message;return {ok:false,message};}
    finally{saving=false;box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);paint();}
  }
  box.querySelector('[data-quick-save]').onclick=()=>void save();
  // BASKET-업데이트통합 PR 2: [크게] opens the one write window (write-window.js) on this input's text and chosen place.
  // 업데이트 saves through this box's own save() (its attachments and photo text reading go along); 노트 saves a note.
  // Saving closes the window (저장하고 닫기); closing without saving hands the text back to this input.
  const bigBtn=box.querySelector('[data-quick-big]');
  const fileHandle={getBatch:()=>upload,isBusy:()=>saving,onChange:()=>paint(),reset:()=>{upload=createUploadBatch();paint();}};
  if(taskOnly)bigBtn.remove();
  // BASKET-노트입력창: the note input's [크게] opens the note list's own write window on this text (onBig, basket-notes.js).
  // The window works on this box's own file batch (as the home input's [크게] does); a note saved there empties it (reset).
  else if(noteOnly)bigBtn.onclick=()=>{if(saving||document.querySelector('#mdEditor:not(.hidden),#edWindow:not(.hidden)'))return;onBig?.(input.value,fileHandle);};
  else bigBtn.onclick=async()=>{
    if(saving||input.readOnly||document.querySelector('#mdEditor:not(.hidden)'))return;
    const owner=quickScope();
    // The editor's styles come with the basket view's (as menu [쓰기] does).
    let ww;try{[ww]=await Promise.all([import('./write-window.js'),window.KPTUViewLoader?.prepare?.('basket')]);}catch{status.textContent='큰 창을 열지 못했어요. 다시 눌러 주세요.';return;}
    if(owner!==quickScope()||saving)return;
    const places=projectChoices.length||orgChoices.groups.length?placeChoices():null;
    ww.openWriteWindow({text:input.value,kind:'update',place:currentPlaces(),places,draft:false,title:'크게 쓰기',sources:dependencies?.orgs?dependencies:null,
      // UI-크게첨부: the window's [📎 첨부] works on this input's own file batch, so files chosen in either place go together.
      upload:fileHandle,
      onInput:value=>{input.value=value;},
      // The basket screen's input has no ▾: a place chosen in the window is used for that one save only.
      // The window may have read the place lists itself (the home had not yet): read them here too so the button says the names.
      onPlace:list=>{if(basketOnly)return;setPlaces(list);if(mode!=='update')setMode('update');else paint();if(list.length&&!orgChoices.groups.length&&!projectChoices.length)void choices();},
      updateVia:async(value,list)=>{input.value=value;setPlaces(list);if(mode!=='update')setMode('update');try{return await save();}finally{if(basketOnly){setPlaces([]);paint();}}},
      onSaved:saved=>{if(saved.kind==='note'){input.value='';expanded=false;paint();}},
      onClose:(value,{saved})=>{if(!saved){input.value=value;resetChoices();paint();}input.focus({preventScroll:true});}});
  };
  // UI-할일빠른추가상세: [할 일] 화면의 입력 칸 안 오른쪽 끝 [+]는 새 창 없이 일정 화면의 기존 [할 일 등록] 창(프로젝트·날짜 등)을 연다.
  // 입력한 글은 그 창의 제목으로 미리 채운다. 입력 칸 글은 그 창에서 저장될 때 비운다(같은 글이 두 번 남지 않게). 저장 경로는 기존 그대로.
  // UI-홈빠른입력상세: 홈 빠른 입력도 [할 일] 모드에서 같은 [+]로 같은 창을 연다([업데이트] 모드에서는 숨는다). 바구니 화면에는 없다.
  const detailBtn=box.querySelector('[data-quick-detail]');
  if(basketOnly||noteOnly)detailBtn.remove();
  else{
    let detailTitle=null,detailProject=false;
    detailBtn.onclick=async()=>{
      if(saving||mode!=='task')return;
      const title=input.value.trim();
      try{
        await window.KPTUDeferredFeatures?.loadView?.('calendar');
        const open=document.querySelector('#newEventBtn');if(!open)throw new Error('missing');
        open.click();
        document.querySelector('#eventModal [data-event-mode="task"]')?.click();
        const field=document.querySelector('#eventTitle');if(field){field.value=title;field.dispatchEvent(new Event('input',{bubbles:true}));}
        // 홈은 위 칩(프로젝트·오늘·내일·날짜)으로 고른 값도 창의 기존 칸에 채운다. 고르지 않은 값은 창 기본값 그대로. 창에서 바꾸면 창 값으로 저장된다.
        if(!taskOnly){
          const day=document.querySelector('#eventStartDate');if(due&&day){day.value=due;day.dispatchEvent(new Event('input',{bubbles:true}));day.dispatchEvent(new Event('change',{bubbles:true}));}
          if(project)window.KPTUCalendarPlus?.setTaskProject?.(project);
        }
        detailTitle=title||null;detailProject=!taskOnly&&!!project;
      }catch(e){status.textContent='상세 설정 창을 열지 못했어요. 잠시 뒤 다시 눌러 주세요.';}
    };
    // 창에서 저장되면 입력 칸 글을 비우고, 홈은 [추가]와 같이 다음 할 일을 프로젝트 없이 시작한다(날짜 선택은 그대로).
    window.addEventListener('kptu:google-tasks-changed',()=>{if(detailTitle!==null&&input.value.trim()===detailTitle){input.value='';detailTitle=null;if(detailProject&&!taskAttempt&&!taskRequest)project='';detailProject=false;paint();}});
    window.addEventListener('kptu:dialog-closed',e=>{if(e.detail?.modal?.id==='eventModal')setTimeout(()=>{detailTitle=null;detailProject=false;},0);});
  }
  input.addEventListener('keydown',e=>{if(mode==='task'&&e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();void save();}});
  window.addEventListener('kptu:before-reload',e=>{if(saving)e.preventDefault();else if(input.value.length||taskAttempt||upload.entries.some(e=>e.kind!=='success'))e.detail.otherDraft=true;});
  window.addEventListener('kptu:session-changed',()=>{const nextEpoch=taskRuntime.session.epoch();if(nextEpoch!==taskSessionEpoch){taskSessionEpoch=nextEpoch;taskSequence++;taskAttempt=null;taskRequest=null;taskReading=false;if(mode==='task'){saving=false;taskControls(false)}}const nextOwner=quickScope();if(nextOwner===quickOwner)return;dismissForNavigation();quickOwner=nextOwner;taskFilesOn=false;projectChoices=[];orgChoices={recent:[],groups:[]};choiceEpoch++;choicesFlight=null;project='';places=[];pendingPlaces=[];due='';dateKind='';input.value='';upload=createUploadBatch();expanded=false;paint();checkTaskFiles();});
  window.addEventListener('kptu:project-catalog-updated',()=>{choiceEpoch++;choicesFlight=null;invalidateProjects();if(expanded&&mode==='task'&&!taskOnly)void choices();});
  window.KPTURouter.on(view,()=>{choiceEpoch++;choicesFlight=null;if(expanded&&mode==='task'&&!taskOnly)void choices();});
  if(basketOnly){box.querySelector('.home-quick-modes').remove();box.querySelector('[data-goto="basket"]').remove();input.setAttribute('aria-label','바구니에 업데이트 입력');}
  if(noteOnly){box.querySelector('.home-quick-modes').remove();box.querySelector('[data-goto="basket"]').remove();input.setAttribute('aria-label','노트 입력');bigBtn.setAttribute('aria-label','큰 창에서 노트 쓰기');box.dataset.noteOnly='';}
  if(taskOnly){box.querySelector('.home-quick-modes').remove();box.querySelector('[data-goto="basket"]').remove();input.setAttribute('aria-label','오늘 할 일 입력');box.dataset.taskOnly='';}
  // Phone (ui-standard.css): this box is docked above the bottom tabs. Its height keeps the
  // last card and the toast clear of it; only the visible box (home or basket) writes it.
  new ResizeObserver(()=>{const height=box.getBoundingClientRect().height;if(height)document.documentElement.style.setProperty('--kptu-quick-dock',Math.ceil(height)+'px');}).observe(box);
  paint();checkTaskFiles();
  return {hasDraft:()=>!!input.value||!!taskAttempt||upload.entries.some(e=>e.kind!=='success'),isBusy:()=>saving,
    // The note list's write window hands unsaved text back here (and clears it after a save there).
    setText:value=>{input.value=String(value??'');paint();},focus:()=>input.focus({preventScroll:true}),
    // The folder a new note goes into, as the note list decides it (null = 폴더 없음).
    setFolder:name=>{folderName=name||null;paint();}};
}
