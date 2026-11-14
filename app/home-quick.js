import {fitHeight} from './auto-grow.js'; // UI-줄입력늘어나기: 글만큼 늘어나는 공용 칸
import {requestNoteAiTitle} from './note-ai-title.js';
import {holdToast as kptuHoldToast,askConfirm} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import { viewPrefs } from './view-prefs.js';
import { waitInlineHtml } from './wait-state.js'; // UI-기다림표시통일 2차: 누른 뒤 기다리는 동안 상태 줄은 글자 없는 회색 칸(wait-state.js)
import { createChoiceSheet } from './choice-sheet.js';
import { openRowMenu } from './row-menu.js';
import { openAreaOrgPicker, dismissAreaOrgPicker, usedKeysNow, catalogAreas, areaTree, areaChipText } from './area-org-picker.js';
import { readPlaces, placeSheetHtml, placeValue, keepPlaces, placeList, togglePlace, choiceCountText, placesLabel, PLACE_LIMIT, saveUpdate, saveUpdateFilesBehind, rememberPlace, linkFailText } from './update-places.js';
import { createGoogleTask } from './quick-save.js';
import { createNote, validateNoteText, createNoteDoc, noteTitleFromText } from './basket-data.js';
import { createUploadBatch, sendNoteBehind, mountBasketPicker, fileTitle } from './basket-upload.js';
import { extractHtmlDocument, htmlFileName, utf8Bytes, HTML_MAX_BYTES, HTML_MARK } from './chatgpt-html.mjs';
import { dayKey } from './home-read-model.js';
import { quickDueDay, weekdayLabel, newTaskDue } from './task-due.mjs';
import { openWeekPick } from './task-week-pick.js'; // S46-30 [다음주] 요일 목록
// PERF-첫로딩 ③(S61-32): 클립 자리 답·개수 한도만 작은 task-files-ready.js에서 받는다. 파일 보내기(task-files.js sendTaskFilesBehind)는 그 큰 사슬을
// 첫 화면 전에 받지 않도록 [할 일]에서 클립이 보일 때 미리 받기 시작하고, 저장 때 그 받기를 기다린다(taskFilesModule).
import { taskFilesAvailable, taskFilesKnown, onTaskFilesReady, MAX_TASK_FILES } from './task-files-ready.js';
let taskFilesFlight=null;
const taskFilesModule=()=>taskFilesFlight||=import('./task-files.js').catch(e=>{taskFilesFlight=null;throw e;});

export function mountQuick({root, dependencies, refreshTasks=()=>{}, invalidateProjects=()=>{}, esc, basketOnly=false, taskOnly=false, noteOnly=false, onBig=null, onFolder=null, view="home", idPrefix="home", onSaved=()=>{}}) {
  // UI-할일입력: taskOnly is the [할 일] screen's always-visible input. It is the [할 일] mode of this same box with the mode
  // buttons (head row), project·date row taken out; each task it adds is due today (KST) and uses the same create path.
  // BASKET-노트입력창: noteOnly is the basket [노트] list's always-visible input, the same box as the basket's update input
  // (phone: docked above the tabs; PC: at the top of the list). [추가] saves a note whose title is the first line (createNoteDoc,
  // 마크다운 off like a new note in the write window); [크게] hands the text and this box's files to onBig (the note list's write
  // window). NOTE-파일붙이기: its clip and drop take files too; they go up with the new note's id after the note is saved.
  const box=root.querySelector('.home-quick-placeholder');
  box.removeAttribute('aria-hidden'); box.className='home-quick'; box.dataset.homeQuick='';
  // UI-빠른입력Ctrl엔터: the shared Enter-to-save rule (enter-save.js) — PC Ctrl+Enter (Mac ⌘+Enter) = [추가], Enter = new line
  // (the [할 일] mode keeps its own Enter = add below). The phone keyboard has no Ctrl, so there Enter only adds a line.
  box.setAttribute('data-enter-save','');
  const quickScope=()=>{const c=window.KPTURuntime.context.read();return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
  let quickOwner=quickScope();
  // BASKET-업데이트통합 PR 1: the home box has two modes, [업데이트 ▾] and [할 일]. [업데이트] with no place chosen is the old
  // [바구니] (a basket note, attachments allowed); with an organization or a project chosen it is that place's record, saved
  // through the same existing paths as before. toBasket() is that one rule; data-mode shows the effective kind (basket/update/task).
  let mode='update',saving=false,expanded=false,focusIn=false,keyboardSeen=false,project='',places=[],pendingPlaces=[],due='',dateKind='',choicesFlight=null,choiceEpoch=0,projectChoices=[],orgChoices={recent:[],groups:[]},bundleChoices=[];
  { const saved=basketOnly||taskOnly?null:viewPrefs.get('home_quick_mode'); mode=saved==='task'?'task':'update'; }
  if(taskOnly)mode='task';
  if(noteOnly)mode='note';
  // NOTE-추가폴더표시: the note input's [폴더 ▾] shows the folder a new note goes into (null = 폴더 없음). The note list owns the
  // choice and its picker (onFolder opens it under this button); setFolder() only paints the name here and in the placeholder.
  let folderName=null;
  // HOME-입력칸두모양(S61-44, 명진 11/14 12:44 '한 줄·두 줄·세 줄 왔다 갔다' → 12:50 'ㄱ'): the phone home box (≤760) has only two
  // shapes, both drawn by paint() into one attribute (data-quick-shape, ui-standard.css): one row [종류 ▾][입력칸][잊지 말기 n], and in
  // [할 일] — only while the input has text or focus — the date row on top of it. The [업데이트 | 할 일] row is never shown there; the
  // kind button opens a small list (업데이트 · 할 일 · 기록할 곳 선택). Once the input has text (or files), [추가] takes the chip's place —
  // the one change while writing. The old fold (rest → open → expanded, two jumps per press) is gone. The basket·note·task boxes and
  // the PC home (761px~) are unchanged: they get no data-quick-shape.
  const homeBox=!basketOnly&&!taskOnly&&!noteOnly;
  const toBasket=()=>mode==='update'&&!places.length;
  // Whether the clip and drop take files for this save: an update (basket or chosen places), or a note (NOTE-파일붙이기).
  // BUG-업데이트첨부연결: choosing an organization or a project keeps the clip, the drop and the files already chosen; [추가]
  // saves them as the basket would and then links/files them there (update-places.js saveUpdateFilesBehind — the files behind, S59-10).
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
  let upload = createUploadBatch(),pickError='';
  // HOME-잊지말기칩(S53-13, 시안 docs/design/mockups/home-forget-slim.html A): the head row is [업데이트 ▾ | 할 일] + the home's
  // [잊지 말기 n] chip slot on the right. This box only places the empty slot; home-summary.js is its one renderer (home view only —
  // the basket·note·task boxes remove the whole head row).
  // HOME-빠른입력정리: the task options row sits above the mode buttons, and the organization picker is the ▾ right of [업데이트].
  box.innerHTML=`<div data-quick-options hidden><div data-quick-task-options><button type="button" data-quick-project aria-label="사업영역" aria-haspopup="dialog" aria-expanded="false">사업영역 ▾</button><button type="button" data-quick-day="today">오늘</button><button type="button" data-quick-day="tomorrow">내일</button><button type="button" data-quick-day="after">모레</button><button type="button" data-quick-day="week" aria-haspopup="true">다음주</button><button type="button" data-quick-day="date">날짜</button><input type="date" data-quick-date aria-label="기한 날짜" tabindex="-1"></div></div><div class="home-quick-head"><div class="home-quick-modes ds-seg" role="group" aria-label="입력 종류"><span class="home-quick-update-split ds-seg-group"><button type="button" class="ds-seg-btn" data-quick-mode="update">업데이트</button><button type="button" class="ds-seg-btn" data-quick-org aria-label="기록할 곳 선택" aria-haspopup="dialog" aria-expanded="false">▾</button></span><button type="button" class="ds-seg-btn" data-quick-mode="task">할 일</button></div><span class="home-forget-slot" data-home-summary role="group" aria-label="잊지 말기"></span></div><div class="home-quick-entry"><button type="button" class="home-quick-kind" data-quick-kind hidden></button><div class="home-quick-input-wrap"><div data-quick-file-picker hidden></div><textarea data-quick-input aria-label="빠른 입력" rows="1" placeholder="할 일을 입력하세요"></textarea><button type="button" class="home-quick-big" data-quick-big aria-label="큰 창에서 쓰기" aria-haspopup="dialog"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button type="button" class="home-quick-detail" data-quick-detail aria-label="상세 설정으로 추가" aria-haspopup="dialog"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div><button type="button" class="home-quick-folder" data-quick-folder aria-haspopup="dialog" aria-expanded="false" hidden>폴더 없음 ▾</button><button type="button" class="home-quick-save" data-quick-save data-enter-save-submit>추가</button></div><p class="home-quick-hint" data-quick-hint role="status"></p><div data-quick-basket-options hidden><div data-quick-files></div></div><div data-quick-status role="status"></div>`;
  const input=box.querySelector('[data-quick-input]'),options=box.querySelector('[data-quick-options]'),status=box.querySelector('[data-quick-status]'),hint=box.querySelector('[data-quick-hint]'),orgSelect=box.querySelector('[data-quick-org]'),projectSelect=box.querySelector('[data-quick-project]'),date=box.querySelector('[data-quick-date]');
  const pickerFiles=mountBasketPicker(box.querySelector('[data-quick-file-picker]'),{id:idPrefix==='home'?'quickBasketFiles':idPrefix+'QuickBasketFiles',filesHost:box.querySelector('[data-quick-files]'),dropTarget:box,pasteTarget:input,isActive:()=>takesFiles(),getBatch:()=>upload,isBusy:()=>saving,onError:message=>{status.textContent=message;pickError=message.startsWith('사진을 못 받았어요')?message:'';},onChange:()=>{status.textContent='';pickError='';paint();}});
  // UI-PC바구니첨부버튼: on PC the same picker part sits outside the input, just left of [추가], as [📎 첨부].
  // The phone keeps it inside the input's left edge. Moving the node keeps focus order the same as what is seen.
  const pickerHost=box.querySelector('[data-quick-file-picker]'),pickerWide=window.matchMedia('(min-width:761px)');
  const placePicker=()=>{if(pickerWide.matches)box.querySelector('[data-quick-save]').before(pickerHost);else box.querySelector('.home-quick-input-wrap').prepend(pickerHost);};
  pickerWide.addEventListener('change',placePicker);placePicker();
  // NOTE-추가폴더표시: [폴더 ▾] sits right after the input on a wide screen (input → [폴더 ▾] → [📎 첨부] → [추가], each 8px apart).
  // S52-34 UI-전체정리(노트): on a phone it is in the same row too (input → [폴더 ▾] → [추가]), so the docked box is one row, not two.
  const folderBtn=box.querySelector('[data-quick-folder]');
  if(!noteOnly)folderBtn.remove();
  else{
    const placeFolder=()=>{if(pickerWide.matches)pickerHost.before(folderBtn);else box.querySelector('[data-quick-save]').before(folderBtn);};
    pickerWide.addEventListener('change',()=>{placeFolder();paint();});placeFolder();
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
    status.textContent=toBasket()||noteOnly?'HTML 문서를 첨부 파일로 바꿨어요. [추가]를 누르면 잊지 말기에 저장돼요.':'HTML 문서를 첨부 파일로 바꿨어요. [추가]를 누르면 선택한 곳 자료로 넣어요.';
  });
  // UI-버튼크기: 홈은 세 모드 모두 한 줄 높이에서 시작해 글에 맞춰 늘고 5줄에서 멈춘다(그 뒤는 칸 안 스크롤). 바구니 화면은 CSS 높이 그대로.
  // UI-줄입력늘어나기: 높이 셈은 공용 auto-grow.js(이 칸에서 끌어냄) — 많아야 5줄, 스크롤 표시는 칸 CSS 그대로.
  function size(){ input.style.height=''; if(basketOnly||taskOnly||noteOnly)return; fitHeight(input,{maxLines:5,overflow:false}); }
  // 같은 글이면 글자 칸을 갈지 않는다: 누르는 사이(포커스가 들어와 paint)에 단추 안 글자 칸이 바뀌면 브라우저가 그 누름을 click으로 치지 않는다.
  const setText=(el,text)=>{if(el.textContent!==text)el.textContent=text;};
  // HOME-입력칸두모양: the one writer of the phone home's shape (data-quick-shape, ui-standard.css) and of the date row's hidden:
  // 'dates' ([할 일] with focus — or, where no phone keyboard was ever seen (the shared detector, accessibility-dialog.js), with
  // text too), 'typing' (text or files: [추가] in the chip's place), else 'line'. PC/other boxes: no shape.
  // paint() calls it; a focus change calls only this (a full paint would redraw the file rows under a press and lose its click).
  function shape(){
    const phone=phoneHome(),text=!!input.value.trim(),written=text||takesFiles()&&upload.entries.length>0,dates=phone&&mode==='task'&&(focusIn||!keyboardSeen&&text);
    if(phone)box.dataset.quickShape=[dates&&'dates',written&&'typing'].filter(Boolean).join(' ')||'line';else delete box.dataset.quickShape;
    options.hidden=phone?!dates:taskOnly||!expanded||mode!=='task';
    return phone;
  }
  function paint(){
    pickerFiles.render();
    // BIZ-저장먼저닫기 2차(S59-10): the files of a save always go to the update's or note's own line behind (the input gets a fresh batch
    // at once), so the input never holds a saved or unconfirmed batch and never locks.
    if(noteOnly){const f=box.querySelector('[data-quick-folder]'),label=folderName||'폴더 없음';f.hidden=false;const name=document.createElement('span');name.className='home-quick-folder-name';name.textContent=[...label].length>8?[...label].slice(0,8).join('')+'…':label;f.replaceChildren(name,' ▾');/* NOTE-큰창잘림: 좁으면 이름만 '…'로 줄고 ▾는 늘 보인다(basket.css) */f.title='노트를 넣을 폴더: '+label;f.setAttribute('aria-label','노트를 넣을 폴더: '+label+'. 누르면 다른 폴더를 고릅니다');}
    box.dataset.mode=noteOnly?'note':toBasket()?'basket':mode; input.rows=1; const targetName=placesLabel(placeChoices(),places);
    input.placeholder=noteOnly?(folderName?(pickerWide.matches?`${folderName}에 노트 추가`:'노트 추가'):'노트를 입력하세요'):mode==='task'?'할 일을 입력하세요':toBasket()?'업데이트를 입력하세요':(targetName||'담당조직')+' 기록을 입력하세요';
    const filesWait=!takesFiles()&&taskFilesWait&&mode==='task';
    const phone=shape();
    const kindBtn=box.querySelector('[data-quick-kind]');
    if(kindBtn){const kindName=mode==='task'?'할 일':'업데이트';kindBtn.hidden=!phone;setText(kindBtn,kindName+' ▾');kindBtn.setAttribute('aria-label','입력 종류: '+kindName+(mode==='update'&&places.length&&targetName?` (${targetName})`:'')+'. 누르면 종류를 고릅니다');}
    box.querySelector('[data-quick-file-picker]').hidden=!takesFiles()&&!filesWait;box.querySelector('[data-quick-file-picker]').toggleAttribute('data-quick-files-wait',filesWait);
    // TASK-추가창파일: a task takes up to 10 files (the ⋯ → 파일 붙이기 limit), not the basket's 20; say where they go.
    const fileHint=box.querySelector('[data-basket-hint]');if(fileHint)fileHint.textContent=mode==='task'?`파일당 100MB · ${MAX_TASK_FILES}개까지 · 추가하면 Drive "자료실/할 일 첨부"에 올라갑니다`:'파일당 100MiB · 20개까지';
    if(!taskOnly)box.querySelector('[data-quick-big]').hidden=mode==='task';
    if(!taskOnly&&!basketOnly&&!noteOnly)box.querySelector('[data-quick-detail]').hidden=mode!=='task';
    box.querySelector('[data-quick-basket-options]').hidden=!takesFiles()||!upload.entries.length;
    box.querySelectorAll('[data-quick-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.quickMode===mode)));
    setText(projectSelect,(projectChoices.find(x=>x.project.id===project)?.project.name||'사업영역')+' ▾');
    // S52-01 ②: 좁은 줄이라 단추에는 이름만, 하위면 '상위 › 하위'는 단추 설명(title·aria-label)으로.
    const projectPath=project?areaChipText(areaTree(catalogAreas(projectChoices)),'p:'+project):'';projectSelect.title=projectPath;
    projectSelect.setAttribute('aria-label',project?'사업영역: '+(projectPath||projectSelect.textContent.slice(0,-2)):'사업영역');
    orgSelect.setAttribute('aria-label',places.length&&targetName?'기록할 곳 선택: '+targetName:'기록할 곳 선택');
    // UPD-여러곳고르기 ⑥: with two or more places the [업데이트] button itself says where ("첫 곳 이름 외 N"); one place keeps
    // [업데이트] (its name is in the input's placeholder, as before).
    const updateBtn=box.querySelector('[data-quick-mode="update"]');if(updateBtn){const many=mode==='update'&&places.length>1&&targetName;setText(updateBtn,many?targetName:'업데이트');updateBtn.title=many?targetName:'';updateBtn.toggleAttribute('data-quick-many',!!many);}
    box.querySelectorAll('[data-quick-day]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.quickDay===dateKind));if(b.dataset.quickDay==='date')setText(b,dateKind==='date'?`${Number(due.slice(5,7))}.${Number(due.slice(8,10))}`:'날짜');if(b.dataset.quickDay==='week')setText(b,dateKind==='week'?weekdayLabel(due):'다음주');});size();
  }
  async function choices(){
    if(choicesFlight)return choicesFlight;
    const run=choiceEpoch;
    const flight=choicesFlight=(async()=>{
      await dependencies.google();
      // BASKET-업데이트통합: the same place lists (and three recent organizations) as the write window (update-places.js).
      const read=await readPlaces(dependencies,{isCurrent:()=>run===choiceEpoch});
      // The lists changed while they were being read (the project catalog published, or the router entered this view; both start a new
      // epoch and clear the flight). Read again for the new epoch and finish with that: returning here would let the sheet open with empty lists.
      if(run!==choiceEpoch){if(choicesFlight===flight)choicesFlight=null;return choices();}
      if(!read)return;
      projectChoices=read.projects;orgChoices=read.orgs;bundleChoices=read.bundles||[];
      if(!projectChoices.some(x=>x.project.id===project))project='';
      places=keepPlaces(placeChoices(),places);
      paint();picker.render();
    })().catch(e=>{if(run===choiceEpoch){choicesFlight=null;status.textContent=e.message||'선택 목록을 불러오지 못했어요.';}});
    return choicesFlight;
  }
  // The [할 일] options need the lists at once; [업데이트] reads them when its ▾ sheet opens (the sheet waits for choices()).
  function expand(){expanded=true;paint();if(mode==='task'&&!taskOnly)void choices();}
  // HOME-입력칸두모양: the phone home box (see homeBox above). focusIn = focus is in the box or in a sheet or small list it opened
  // (they live outside it), so pressing a date button or choosing a 사업영역 keeps the date row; focus going anywhere else drops it.
  function phoneHome(){return homeBox&&!pickerWide.matches;}
  const OPENED_HERE='[role="dialog"],[role="menu"],[role="listbox"],.home-choice-sheet,.kptu-week-pick,#taskWeekPick,#rowMenu';
  const focusHere=el=>!!el&&(box.contains(el)||!!el.closest?.(OPENED_HERE));
  const setFocusIn=next=>{if(next===focusIn)return;focusIn=next;if(phoneHome())shape();};
  if(homeBox){
    // The phone row reads [종류 ▾][입력칸][잊지 말기]: the chip's head row goes after the input there (so Tab follows what is seen),
    // and back above it on a wide screen. The slot node itself moves, so home-summary.js keeps drawing into the same place.
    const placeHead=()=>{const head=box.querySelector('.home-quick-head'),entry=box.querySelector('.home-quick-entry');if(!head||!entry)return;if(phoneHome())entry.after(head);else entry.before(head);};
    pickerWide.addEventListener('change',()=>{placeHead();paint();});placeHead();
    document.addEventListener('focusin',e=>setFocusIn(focusHere(e.target)));
    box.addEventListener('focusout',e=>{if(!e.relatedTarget)setFocusIn(false);});
    // HOME-자판내리면한줄(S61-50, 명진 11/14 18:48): on the phone the date row shows only while writing a task with the keyboard up.
    // The keyboard state comes from the one shared detector (accessibility-dialog.js, event kptu:keyboard). When it goes down
    // (Android back closes only the keyboard) with focus still in the input, the input lets go of focus, so the box is one row
    // again; the text, the chosen date and 사업영역 stay, and pressing the input brings the date row back. While a sheet or small
    // list this box opened is showing (a date, the next-week days, 사업영역) the row stays. Without a detected keyboard (PC) the
    // old rule stays (text keeps the row).
    document.addEventListener('kptu:keyboard',e=>{
      if(e.detail?.open){keyboardSeen=true;return;}
      if(!phoneHome()||document.activeElement!==input)return;
      if([...document.querySelectorAll(OPENED_HERE)].some(el=>!box.contains(el)&&el.getClientRects().length>0))return;
      input.blur();shape();
    });
    // The kind button's small list: [업데이트] · [할 일] and 기록할 곳 선택 (the old ▾ right of [업데이트]).
    const kindBtn=box.querySelector('[data-quick-kind]');kindBtn.setAttribute('aria-haspopup','true');kindBtn.setAttribute('aria-expanded','false');
    // 공용 작은 메뉴(row-menu.js, ⋯ 메뉴와 같은 상자). 고르면 그 종류로 바꾸고 입력칸으로 간다.
    kindBtn.onclick=()=>{
      if(saving||window.KPTURouter.current!==view)return;
      openRowMenu(kindBtn,{key:'home-quick-kind',label:'입력 종류',items:[{id:'kind-update',label:'업데이트'},{id:'kind-task',label:'할 일'},{id:'kind-org',label:'기록할 곳 선택…',sep:true}],
        run:id=>{if(saving)return;if(id==='kind-org'){if(mode!=='update')setMode('update');void openSheet('org');return;}const k=id==='kind-task'?'task':'update';if(k!==mode)setMode(k);input.focus({preventScroll:true});}});
    };
  }
  input.addEventListener('focus',expand); input.addEventListener('input',()=>{if(input.value.trim())hint.textContent='';expand();size();});
  const picker=createChoiceSheet({id:idPrefix+'ChoiceSheet',titleId:idPrefix+'ChoiceTitle',historyKey:idPrefix==='home'?'kptuHomeChoice':'kptu'+idPrefix+'Choice',
    canOpen:()=>!saving&&window.KPTURouter.current===view,choices,
    render:kind=>{
      // BASKET-업데이트통합: [바구니(미분류)] (no place) is the first chip, on the recent line (update-places.js, shared with the write window).
      // UPD-여러곳고르기: the 기록할 곳 sheet keeps many; presses mark a pending list that only [저장] makes the input's (onCommit).
      if(kind==='org')pendingPlaces=currentPlaces();
      return {title:'기록할 곳 선택',search:'조직·사업영역 이름 검색',searchAlways:true,split:true,html:placeSheetHtml(placeChoices(),pendingPlaces,esc)};
    },
    multi:kind=>kind==='org'?{pressed:value=>value==='basket'?!pendingPlaces.length:pendingPlaces.some(p=>placeValue(p)===value),label:choiceCountText(pendingPlaces)}:null,
    onSelect:(kind,value)=>{if(kind==='org'){const next=togglePlace(pendingPlaces,value);if(next)pendingPlaces=next;else status.textContent=`한 번에 ${PLACE_LIMIT}곳까지 선택할 수 있어요.`;}},
    onCommit:kind=>{if(kind!=='org')return;setPlaces(pendingPlaces);status.textContent='';paint();}
  });
  // HOME-입력칸두모양: 폰 홈은 [종류 ▾]에서, 넓은 화면은 [업데이트] 옆 ▾에서 연다. 창 자리는 지금 보이는 그 단추 곁 — 창이 열린 채 폭이
  // 바뀌어도(폴드 접기·펴기) 닫히지 않고 새 단추 곁으로 옮겨 간다(공용 followAnchor는 잴 수 있는 것이면 된다).
  const kindTrigger=box.querySelector('[data-quick-kind]'),placeButton=()=>homeBox&&phoneHome()?kindTrigger:orgSelect;
  const openSheet=kind=>picker.open(kind,placeButton(),homeBox?{getBoundingClientRect:()=>placeButton().getBoundingClientRect()}:null);
  const dismissForNavigation=()=>{picker.dismiss();dismissAreaOrgPicker(projectSelect);};
  // S52-01 ② UI-사업영역조직고르기창: [할 일]의 사업영역은 모든 화면과 같은 고르기 창(area-org-picker.js) 하나로, 하나만 고른다
  // (줄을 누르면 고르고 닫힘, 맨 위 '사업영역 없음'). 큰 묶음만 보이고 꺾쇠로 하위를 펼친다. 저장 값(project)은 그대로다.
  async function openProject(){
    if(saving||window.KPTURouter.current!==view)return;const run=choiceEpoch;await choices();
    if(saving||window.KPTURouter.current!==view||run!==choiceEpoch&&!projectChoices.length)return;
    const used=await usedKeysNow().catch(()=>[]);if(saving||window.KPTURouter.current!==view)return;
    await openAreaOrgPicker({kind:'area',trigger:projectSelect,areas:catalogAreas(projectChoices),selected:project?['p:'+project]:[],used,multi:false,none:true,
      onCommit:keys=>{const k=[...keys][0]||'';project=k.startsWith('p:')?k.slice(2):'';paint();}});
  }
  projectSelect.onclick=()=>void openProject();
  // ▾ also picks [업데이트] when another mode is showing, then opens the organization sheet.
  orgSelect.onclick=()=>{if(saving)return;if(mode!=='update')setMode('update');void openSheet('org');};
  // UI-기록할곳되돌리기 (b)(c): a place (and a task's project) chosen here is for one add only. Leaving the screen, or closing the big
  // window without saving, puts the next input back on the basket (and no project); the placeholder then says 바구니. A save in
  // flight keeps its place, and a task whose result is still being confirmed keeps its project.
  const resetChoices=()=>{if(saving)return;if(places.length)setPlaces([]);if(project&&!taskAttempt&&!taskRequest)project='';paint();};
  window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view!==view){dismissForNavigation();resetChoices();}});
  // The clip shows in [할 일] only when the task-file table answers for this owner (checked once; only a yes is kept).
  // The [할 일] screen's own input does not ask: the task list below it reads the table anyway, and its answer turns the clip on.
  const filesAnswer=on=>{taskFilesWait=false;if(on){taskFilesOn=true;void taskFilesModule().catch(()=>{});}paint();};
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
    // S46-30: [다음주]는 다음 주 월~일 작은 목록에서 고른다(고르면 이 칸의 기한이 그날, 버튼 글자는 '수 11.4').
    if(kind==='week')return openWeekPick(b,{onPick:day=>{if(saving)return;dateKind='week';due=day;date.value='';paint();}});
    dateKind=kind;due=quickDueDay(kind==='tomorrow'?1:kind==='after'?2:0,dayKey(Date.now()));paint();
  });
  date.onchange=()=>{due=date.value;dateKind=due?'date':'';paint();};
  const taskRuntime=window.KPTURuntime;
  const taskIdentity=task=>!!task&&typeof task.id==='string'&&!!task.id&&typeof task.taskListId==='string'&&!!task.taskListId&&typeof task.title==='string';
  const taskSnapshot=()=>JSON.stringify({raw:input.value,project,due,dateKind});
  const taskScopeCurrent=r=>{const c=taskRuntime.context.read();return box.isConnected&&r.owner===c?.user?.id&&r.workspace===c?.workspace?.id&&r.epoch===taskRuntime.session.epoch();};
  const taskCurrent=r=>taskRequest===r&&r.token===taskSequence&&taskScopeCurrent(r)&&mode==='task';
  const taskLinkKey=link=>link.project_id?'project:'+link.project_id:link.organization_id?'organization:'+link.organization_id:link.meeting_id?'meeting:'+link.meeting_id:'';
  function taskLinkKeys(result){if(!Array.isArray(result?.links)||!Array.isArray(result?.meeting_links))throw new Error('사업영역 연결의 저장 결과를 확인하지 못했어요.');return new Set([...result.links,...result.meeting_links].filter(l=>l.status==='confirmed').map(taskLinkKey).filter(Boolean))}
  function taskNotice(message,{confirm=false}={}){status.textContent=message;if(confirm&&mode==='task'){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=taskAttempt?.task?'연결 확인':'할 일 목록에서 확인';b.onclick=()=>recoverQuickTask();status.append(document.createTextNode(' '),b)}}
  function taskControls(busy){box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=busy);pickerFiles.render()}
  function taskToast(r,message){if(!taskScopeCurrent(r))return;const toast=document.querySelector('#toast');if(!toast)return;toast.textContent=message;kptuHoldToast(toast)}
  function taskBodyMatches(task,body){return task.title===body.title&&(task.notes||'')===(body.notes||'')&&(task.due?String(task.due).slice(0,10):null)===(body.due||null)}
  async function recoverQuickTask(){
    const a=taskAttempt;if(!a||a.pending||taskRequest||taskReading||mode!=='task'||!taskScopeCurrent(a))return;
    const run=++taskSequence,active=()=>run===taskSequence&&taskAttempt===a&&taskScopeCurrent(a)&&mode==='task';
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
    // S50-35: 기한을 고르지 않으면 오늘(task-due.mjs newTaskDue 한 곳). 같은 시도를 다시 보낼 때는 처음 정한 오늘을 그대로 쓴다.
    attempt.defaultDue||=dayKey(Date.now());
    const body=Object.freeze({title,due:newTaskDue(taskOnly?'':due,attempt.defaultDue),notes:attempt.task?.notes||'',links:Object.freeze(project?[Object.freeze({project_id:project})]:[])}),r={owner:attempt.owner,workspace:attempt.workspace,epoch:attempt.epoch,token:++taskSequence,attempt,body,draft:taskSnapshot()};
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
        if(result.link_error||body.links.some(l=>!attempt.links.has(taskLinkKey(l)))){attempt.linkState='partial';attempt.needsReview=true;taskNotice('할 일은 저장했습니다. 사업영역 연결을 확인해 주세요.',{confirm:true});taskToast(r,'할 일은 저장했습니다. 사업영역 연결을 확인해 주세요.');return}
      }else if(!taskBodyMatches(attempt.task,body)){
        const result=await call('update',{action:'update',task_id:attempt.task.id,task_list_id:attempt.task.taskListId,title:body.title,notes:body.notes,due:body.due});if(!taskScopeCurrent(r))return;
        if(result?.ok!==true||!taskIdentity(result.task)||result.task.id!==attempt.task.id||result.task.taskListId!==attempt.task.taskListId||!taskBodyMatches(result.task,body))throw new Error('기존 할 일의 수정 결과를 확인하지 못했어요.');attempt.task=structuredClone(result.task);attempt.bodyState='confirmed';if(!taskCurrent(r)){attempt.needsReview=true;return}
      }
      sendFiles();if(!taskCurrent(r)){attempt.needsReview=true;return}
      stage='links';const missing=body.links.filter(l=>!attempt.links.has(taskLinkKey(l)));
      if(missing.length){const result=await call('link',{action:'link',task_id:attempt.task.id,links:missing});if(!taskScopeCurrent(r))return;const confirmed=taskLinkKeys(result);if(result?.ok!==true||missing.some(l=>!confirmed.has(taskLinkKey(l))))throw new Error('사업영역 연결의 저장 결과를 확인하지 못했어요.');attempt.links=confirmed;if(!taskCurrent(r)){attempt.needsReview=true;return}}
      attempt.linkState='confirmed';if(!taskCurrent(r))return;taskAttempt=null;r.completed=true;
      
      if(taskSnapshot()===r.draft){input.value='';expanded=false;taskNotice('')}else{expanded=true;taskNotice('제출한 할 일은 저장했습니다. 추가 입력은 남겨 두었습니다.')}
      // UI-기록할곳되돌리기 (c): the next task starts with no project (the date choice stays as before).
      project='';paint();if(!attempt.filesSent)taskToast(r,'할 일을 추가했습니다.');
      try{void Promise.resolve(refreshTasks()).catch(()=>{if(taskScopeCurrent(r)&&r.token===taskSequence&&mode==='task'&&!input.value)taskNotice('할 일은 저장했어요. 목록을 다시 불러오지 못했어요.')})}catch(error){if(taskCurrent(r))taskNotice('할 일은 저장했어요. 목록을 다시 불러오지 못했어요.')}
    }catch(error){if(!taskScopeCurrent(r))return;if(stage==='body')attempt.bodyState='unknown';else attempt.linkState='unknown';attempt.needsReview=true;if(taskCurrent(r))taskNotice((attempt.task?'할 일은 확인했습니다. 연결과 수정 결과를 확인해 주세요. ':'저장 결과를 확인하지 못했어요. ')+(error.message||error),{confirm:true})}
    finally{attempt.pending=false;if(taskRequest===r&&taskScopeCurrent(r)&&r.token===taskSequence){taskRequest=null;saving=false;taskControls(false);paint()}}
  }
  // Resolves {ok:true} or {ok:false, message}; the write window's save icon ([크게]) waits for it (same path as [추가]).
  // doc (ED③ 업데이트): the new big window's saved form, kept with the letters on the basket update (never on one organization's or project's own record).
  async function save({doc=null}={}){
    if(mode==='task')return saveTask();
    if(noteOnly)return saveNote();
    const fail=message=>{status.textContent=message;return {ok:false,message};};
    if(saving)return {ok:false,message:'저장 중이에요.'};
    // UI-빈입력안내: no text is a small hint line right under the input (not an error, no red); typing removes it.
    if(!input.value.trim()&&!(mode==='update'&&upload.entries.length)){const message=pickError||'글을 입력해 주세요.';status.textContent='';hint.textContent=message;return {ok:false,message};}
    if(toBasket()||places.length>1){if(!upload.entries.length){try{validateNoteText(input.value);}catch(e){return fail(e.message);}}}
    const ctx=window.KPTURuntime.context.read(),owner=ctx?.user?.id;if(!owner)return {ok:false,message:'로그인 정보를 확인하지 못했어요.'};
    // BIZ-저장먼저닫기 2차(S59-10): with files (the basket, or chosen places — BUG-업데이트첨부연결), only the letters are saved and linked
    // while the input waits (update-places.js saveUpdateFilesBehind); the input is then emptied and freed at once and the files go up behind
    // on the update's line to the end, even after leaving this screen (the line above the bottom bar, [다시 올리기] for what did not go up).
    // A failed letters save keeps the letters and the files here and sends nothing.
    if(upload.entries.length)return saveWithFiles({doc,owner});
    const saveMode=toBasket()?'basket':mode,text=saveMode==='update'?input.value.trim():input.value,workspace=ctx.workspace?.id;
    const isCurrent=()=>{const c=window.KPTURuntime.context.read();return c?.user?.id===owner&&c?.workspace?.id===workspace&&window.KPTURouter.current===view;};
    saving=true;status.textContent='';hint.textContent='';
    box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);pickerFiles.render();
    try{
      const result=saveMode==='basket'?await createNote({raw_text:text,...(doc?{doc}:{})}):await saveUpdate({places:currentPlaces(),text,owner,doc});
      if(!isCurrent())return {ok:false,message:'화면이 바뀌어 저장 결과를 확인하지 못했어요.'};
      // A fresh (empty) batch also clears a native file selection the preflight refused (the picker resets its input for a new batch).
      if(saveMode==='basket'&&!upload.entries.length)upload=createUploadBatch();
      // UI-기록할곳되돌리기: after an organization or project record is added, the next input goes to the basket again; the places
      // stay first on the sheet's 최근 line (update-places.js). A failed save keeps the places (catch below) for another try.
      // UPD-여러곳고르기: with two or more places the update is one basket note linked to each; when the links are refused the
      // note is still saved in the basket, so the input is emptied (no second note on a retry) and the line says what to do.
      const linkFailed=!!result?.linkError;
      if(saveMode!=='basket'){rememberPlace(currentPlaces());setPlaces([]);}
      input.value='';expanded=false;paint();if(saveMode==='basket'||result?.note)onSaved(result?.note||result);
      if(linkFailed)status.textContent=linkFailText;
      const toast=document.querySelector('#toast');toast.textContent=linkFailed||saveMode==='basket'?'잊지 말기에 저장했습니다.':'기록을 저장했습니다.';kptuHoldToast(toast);
      choicesFlight=null;
      return linkFailed?{ok:true,linkError:result.linkError}:{ok:true};
    }catch(e){const message=e.message||'저장하지 못했어요.';if(isCurrent())status.textContent=message;return {ok:false,message};}
    finally{saving=false;box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);paint();}
  }
  async function saveWithFiles({doc,owner}){
    const batch=upload,chosen=currentPlaces(),text=input.value,basketSave=!chosen.length,quickOwner=quickScope();
    const where=basketSave?'업데이트':`${placesLabel(placeChoices(),chosen)||'선택한 곳'} 기록`;
    saving=true;status.textContent='';hint.textContent='';
    box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);pickerFiles.render();
    try{
      const result=await saveUpdateFilesBehind({places:chosen,text,batch,doc,where,done:()=>{if(quickOwner===quickScope())onSaved(null);}});
      if(upload===batch)upload=createUploadBatch();
      if(result.stale||quickOwner!==quickScope()||window.KPTURuntime.context.read()?.user?.id!==owner)return {ok:false,message:'로그인 정보가 바뀌어 저장 결과를 확인하지 못했어요.'};
      if(!basketSave){rememberPlace(chosen);setPlaces([]);}
      input.value='';expanded=false;paint();if(result.note)onSaved(result.note);
      const linkFailed=!!result.linkError;if(linkFailed)status.textContent=linkFailText;
      const toast=document.querySelector('#toast');/* UX-알림하나로(S59-21): 올리는 진행·끝은 하단바 위 한 줄 하나 — 저장 알림에 '올리는 중'을 또 쓰지 않고, 글 없이 파일만이면 저장 알림도 띄우지 않는다. */if(linkFailed||text.trim()){toast.textContent=linkFailed||basketSave?'잊지 말기에 저장했어요.':'기록을 저장했어요.';kptuHoldToast(toast);}
      choicesFlight=null;
      return linkFailed?{ok:true,linkError:result.linkError,sending:true}:{ok:true,sending:true};
    }catch(e){const message=e.message||'저장하지 못했어요.';if(quickOwner===quickScope())status.textContent=message;return {ok:false,message};}
    finally{saving=false;box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);paint();}
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
      input.value='';expanded=false;paint();onSaved(note);
      const toast=document.querySelector('#toast');if(toast){toast.textContent=sending?'노트를 추가했어요.':'노트를 추가했습니다.';kptuHoldToast(toast);}
      return {ok:true};
    }catch(e){const message=e.message||'저장하지 못했어요.';if(isCurrent())status.textContent=message;return {ok:false,message};}
    finally{saving=false;box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);paint();}
  }
  box.querySelector('[data-quick-save]').onclick=()=>void save();
  // ED③ 업데이트: [크게] opens the update's new big window (update-window.js) on this input's text and chosen place. The window's [저장] saves
  // through this box's own save() (its attachments and photo text reading go along) and hands it the saved form; a note is written from the
  // note input's [크게] (note-window.js). Saving closes the window (저장하고 닫기); closing without saving hands the letters back to this input.
  const bigBtn=box.querySelector('[data-quick-big]');
  const fileHandle={getBatch:()=>upload,isBusy:()=>saving,onChange:()=>paint(),reset:()=>{upload=createUploadBatch();paint();}};
  if(taskOnly)bigBtn.remove();
  // BASKET-노트입력창: the note input's [크게] opens the note list's own write window on this text (onBig, basket-notes.js).
  // The window works on this box's own file batch (as the home input's [크게] does); a note saved there empties it (reset).
  else if(noteOnly)bigBtn.onclick=()=>{if(saving||document.querySelector('#edWindow:not(.hidden)'))return;onBig?.(input.value,fileHandle);};
  else bigBtn.onclick=async()=>{
    if(saving||input.readOnly||document.querySelector('#edWindow:not(.hidden)'))return;
    const owner=quickScope();
    // The editor's styles come with the basket view's (as the top line [+ 추가] does).
    let uw;try{[uw]=await Promise.all([import('./update-window.js'),window.KPTUViewLoader?.prepare?.('basket')]);}catch{status.textContent='큰 창을 열지 못했어요. 다시 눌러 주세요.';return;}
    if(owner!==quickScope()||saving)return;
    const places=projectChoices.length||orgChoices.groups.length?placeChoices():null;
    uw.openUpdateWindow({text:input.value,draft:false,place:currentPlaces(),places,title:'크게 쓰기',sources:dependencies?.orgs?dependencies:null,
      // UI-크게첨부: the window's [📎 첨부] works on this input's own file batch, so files chosen in either place go together.
      upload:fileHandle,
      // The basket screen's input has no ▾: a place chosen in the window is used for that one save only.
      // The window may have read the place lists itself (the home had not yet): read them here too so the button says the names.
      onPlace:list=>{if(basketOnly)return;setPlaces(list);if(mode!=='update')setMode('update');else paint();if(list.length&&!orgChoices.groups.length&&!projectChoices.length)void choices();},
      updateVia:async(letters,list,doc)=>{input.value=letters;setPlaces(list);if(mode!=='update')setMode('update');try{return await save({doc});}finally{if(basketOnly){setPlaces([]);paint();}}},
      onClose:(letters,{saved})=>{if(!saved){input.value=letters;resetChoices();paint();}input.focus({preventScroll:true});}});
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
  if(basketOnly){box.querySelector('.home-quick-head').remove();input.setAttribute('aria-label','잊지 말기에 업데이트 입력');}
  if(noteOnly){box.querySelector('.home-quick-head').remove();input.setAttribute('aria-label','노트 입력');bigBtn.setAttribute('aria-label','큰 창에서 노트 쓰기');box.dataset.noteOnly='';}
  if(taskOnly){box.querySelector('.home-quick-head').remove();input.setAttribute('aria-label','오늘 할 일 입력');box.dataset.taskOnly='';}
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
