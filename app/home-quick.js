import {basketOcrFor} from './basket-ocr-runtime.js?v=2';
import { createChoiceSheet, projectRows } from './choice-sheet.js?v=1';
import { createGoogleTask, saveOrganizationUpdate } from './quick-save.js?v=2';
import { createNote, validateNoteText } from './basket-data.js?v=3';
import { createUploadBatch, uploadBatch, mountBasketPicker } from './basket-upload.js?v=6';
import { dayKey } from './home-read-model.js?v=3';

export function mountQuick({root, dependencies, refreshTasks=()=>{}, invalidateProjects=()=>{}, esc, basketOnly=false, view="home", idPrefix="home", onSaved=()=>{}}) {
  const box=root.querySelector('.home-quick-placeholder');
  box.removeAttribute('aria-hidden'); box.className='home-quick'; box.dataset.homeQuick='';
  const quickScope=()=>{const c=window.KPTURuntime.context.read();return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
  let quickOwner=quickScope();
  let mode='basket',saving=false,expanded=false,project='',organization='',due='',dateKind='',choicesFlight=null,choiceEpoch=0,projectChoices=[],orgChoices={recent:[],groups:[]};
  try { const saved=basketOnly?null:window.localStorage.getItem('kptu-home-quick-mode'); mode=['basket','task','update'].includes(saved)?saved:'basket'; } catch {}
  let taskAttempt=null,taskRequest=null,taskSequence=0,taskReading=false,taskSessionEpoch=window.KPTURuntime.session.epoch();
  let upload = createUploadBatch(),uploadGeneration=0,pendingOcr=null;
  const guardPendingOcr=()=>{pendingOcr?.current();};
  for(const event of ['click','keydown','input'])box.addEventListener(event,guardPendingOcr,true);
  window.addEventListener('storage',guardPendingOcr);
  window.addEventListener('kptu:session-changed',guardPendingOcr);
  box.innerHTML=`<div class="home-quick-modes" role="group" aria-label="입력 종류"><button type="button" data-quick-mode="basket">바구니</button><button type="button" data-quick-mode="task">할 일</button><button type="button" data-quick-mode="update">업데이트</button></div><div class="home-quick-entry"><div class="home-quick-input-wrap"><div data-quick-file-picker hidden></div><textarea data-quick-input aria-label="빠른 입력" rows="1" placeholder="할 일을 입력하세요"></textarea></div><button type="button" class="home-quick-save" data-quick-save>추가</button></div><div class="home-quick-lock" data-quick-lock hidden><p data-quick-lock-reason></p><button type="button" class="home-quick-new-note" data-quick-new-note>새 메모 입력</button></div><div data-quick-basket-options hidden><div data-quick-files></div></div><div data-quick-options hidden><div data-quick-task-options><button type="button" data-quick-project aria-label="프로젝트" aria-haspopup="dialog" aria-expanded="false">프로젝트 ▾</button><button type="button" data-quick-day="today">오늘</button><button type="button" data-quick-day="tomorrow">내일</button><button type="button" data-quick-day="date">날짜</button><input type="date" data-quick-date aria-label="기한 날짜" tabindex="-1"></div><div data-quick-update-options hidden><button type="button" data-quick-org aria-label="조직" aria-haspopup="dialog" aria-expanded="false">조직 ▾</button></div><small data-quick-destination></small></div><div data-quick-status role="status"></div><button type="button" data-goto="basket" class="home-basket-link">바구니 전체 보기 ›</button>`;
  const input=box.querySelector('[data-quick-input]'),options=box.querySelector('[data-quick-options]'),status=box.querySelector('[data-quick-status]'),orgSelect=box.querySelector('[data-quick-org]'),projectSelect=box.querySelector('[data-quick-project]'),date=box.querySelector('[data-quick-date]');
  const pickerFiles=mountBasketPicker(box.querySelector('[data-quick-file-picker]'),{id:idPrefix==='home'?'quickBasketFiles':idPrefix+'QuickBasketFiles',filesHost:box.querySelector('[data-quick-files]'),dropTarget:box,isActive:()=>mode==='basket',getBatch:()=>upload,isBusy:()=>saving,onError:message=>status.textContent=message,onChange:()=>{status.textContent='';paint();}});
  box.querySelector('[data-quick-new-note]').onclick=()=>{if(saving)return;if((input.value||upload.entries.some(e=>e.kind!=='success'))&&!window.confirm('바구니에서 저장 여부를 확인한 후 새 메모를 입력할까요? 현재 입력과 파일 선택은 비워집니다.'))return;upload=createUploadBatch();input.value='';status.textContent='';paint();input.focus();};
  function size(){ input.style.height=''; if(mode==='update')input.style.height=Math.min(146,Math.max(83,input.scrollHeight+2))+'px'; }
  function paint(){
    pickerFiles.render();
    // A saved or unconfirmed note keeps its text; say why and offer the reset next to the input.
    const locked=mode==='basket'&&(!!upload.note_id||!!upload.blocked);input.readOnly=locked;box.querySelector('[data-quick-lock]').hidden=!locked;
    box.querySelector('[data-quick-lock-reason]').textContent=!locked?'':upload.blocked?'앞선 저장 결과를 확인하지 못해 입력창을 잠갔어요. 바구니 목록에서 저장 여부를 확인하고, 새로 쓰려면 ‘새 메모 입력’을 눌러 주세요.':'메모 글은 이미 저장되어 남은 첨부만 다시 저장할 수 있어요. 새로 쓰려면 ‘새 메모 입력’을 눌러 주세요.';
    box.dataset.mode=mode; input.rows=mode==='update'?3:1; input.placeholder=mode==='basket'?'메모를 입력하세요':mode==='task'?'할 일을 입력하세요':'담당조직 기록을 입력하세요';
    box.querySelector('[data-quick-file-picker]').hidden=mode!=='basket';
    box.querySelector('[data-quick-basket-options]').hidden=mode!=='basket'||!upload.entries.length;
    box.querySelectorAll('[data-quick-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.quickMode===mode)));
    box.querySelector('[data-quick-task-options]').hidden=mode!=='task'; box.querySelector('[data-quick-update-options]').hidden=mode!=='update';
    box.querySelector('[data-quick-destination]').textContent=mode==='basket'?'→ 바구니':mode==='task'?'→ Google 할 일':'→ 담당조직 기록';
    options.hidden=!expanded||mode==='basket';
    projectSelect.textContent=(projectChoices.find(x=>x.project.id===project)?.project.name||'프로젝트')+' ▾';
    orgSelect.textContent=(orgChoices.groups.flat().find(o=>o.id===organization)?.name||'조직')+' ▾';
    projectSelect.setAttribute('aria-label',project?'프로젝트: '+projectSelect.textContent.slice(0,-2):'프로젝트');
    orgSelect.setAttribute('aria-label',organization?'조직: '+orgSelect.textContent.slice(0,-2):'조직');
    box.querySelectorAll('[data-quick-day]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.quickDay===dateKind));if(b.dataset.quickDay==='date')b.textContent=dateKind==='date'?`${Number(due.slice(5,7))}.${Number(due.slice(8,10))}`:'날짜';});size();
  }
  async function choices(){
    if(choicesFlight)return choicesFlight;
    const run=choiceEpoch;
    choicesFlight=(async()=>{
      await dependencies.google();
      const [ps,os,as]=await Promise.all([dependencies.projects(),dependencies.orgs(),dependencies.assignments()]);
      if(run!==choiceEpoch)return;
      const ctx=window.KPTURuntime.context.read(),order=window.KPTUOrganizationOrder;
      const eligible=order.forPicker(os.filter(o=>as.some(a=>a.organization_id===o.id)));
      const recent=[],recentIds=new Set(),eligibleIds=new Set(eligible.map(o=>o.id));
      // Page older records until three distinct organizations are found; one busy organization must not hide the others.
      for(let offset=0;eligible.length&&recentIds.size<Math.min(3,eligible.length);offset+=100){
        const rows=await window.KPTURuntime.api(`/rest/v1/app_suborganization_updates?created_by=eq.${encodeURIComponent(ctx.user.id)}&organization_id=in.(${eligible.map(o=>encodeURIComponent(o.id)).join(',')})&select=organization_id,occurred_at&order=occurred_at.desc,id.desc&limit=100&offset=${offset}`);
        if(run!==choiceEpoch)return;
        recent.push(...rows);rows.forEach(r=>{if(eligibleIds.has(r.organization_id))recentIds.add(r.organization_id);});
        if(rows.length<100)break;
      }
      if(run!==choiceEpoch)return;
      const cat=window.KPTUProjectCatalog;
      projectChoices=cat.tree(ps).filter(x=>x.project.status==='active');
      if(!projectChoices.some(x=>x.project.id===project))project='';
      orgChoices=order.withRecent(eligible,recent.map(r=>r.organization_id),3);
      if(!eligible.some(o=>o.id===organization))organization='';
      paint();picker.render();
    })().catch(e=>{if(run===choiceEpoch){choicesFlight=null;status.textContent=e.message||'선택 목록을 불러오지 못했습니다.';}});
    return choicesFlight;
  }
  function expand(){expanded=true;paint();if(mode!=='basket')void choices();}
  input.addEventListener('focus',expand); input.addEventListener('input',()=>{expand();size();});
  const picker=createChoiceSheet({id:idPrefix+'ChoiceSheet',titleId:idPrefix+'ChoiceTitle',historyKey:idPrefix==='home'?'kptuHomeChoice':'kptu'+idPrefix+'Choice',
    canOpen:()=>!saving&&window.KPTURouter.current===view,choices,
    render:kind=>{
      const selected=kind==='org'?organization:project;
      const chip=o=>`<button type="button" class="home-choice-chip" data-sheet-value="${esc(o.id)}" aria-pressed="${o.id===selected}">${esc(o.name)}</button>`;
      return {title:kind==='org'?'조직 선택':'프로젝트 선택',html:kind==='org'?`<p class="home-choice-label">최근</p><div class="home-choice-group" data-sheet-recent>${orgChoices.recent.map(chip).join('')}</div><p class="home-choice-label">전체</p><div data-sheet-all>${orgChoices.groups.filter(g=>g.length).map(g=>`<div class="home-choice-group">${g.map(chip).join('')}</div>`).join('')}</div>`:projectRows(projectChoices,selected,esc)};
    },onSelect:(kind,value)=>{if(kind==='org')organization=value;else project=value;paint();}
  });
  const openSheet=kind=>picker.open(kind,kind==='org'?orgSelect:projectSelect);
  const dismissForNavigation=()=>picker.dismiss();
  projectSelect.onclick=()=>void openSheet('project');orgSelect.onclick=()=>void openSheet('org');
  window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view!==view){uploadGeneration++;dismissForNavigation();}});
  box.querySelectorAll('[data-quick-mode]').forEach(b=>b.onclick=()=>{
    if(saving)return;mode=b.dataset.quickMode;status.textContent='';
    try{if(!basketOnly)window.localStorage.setItem('kptu-home-quick-mode',mode);}catch{}
    paint();if(mode==='task'&&taskAttempt?.needsReview)taskNotice('앞선 저장 결과를 확인해 주세요. 입력은 유지했습니다.',{confirm:true});if(expanded&&mode!=='basket')void choices();
  });
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
    const attempt=a||{owner:ctx.user.id,workspace:ctx.workspace.id,epoch:taskRuntime.session.epoch(),task:null,bodyState:'idle',linkState:'idle',links:new Set(),needsReview:false};
    const body=Object.freeze({title,due:due||null,notes:attempt.task?.notes||'',links:Object.freeze(project?[Object.freeze({project_id:project})]:[])}),r={owner:attempt.owner,workspace:attempt.workspace,epoch:attempt.epoch,token:++taskSequence,attempt,body,draft:taskSnapshot()};
    taskAttempt=attempt;taskRequest=r;attempt.pending=true;saving=true;taskControls(true);taskNotice('저장 중…');let stage='body';
    const call=(action,body)=>{if(!taskCurrent(r))throw new Error('입력창이나 로그인이 바뀌었습니다.');return taskRuntime.api('/functions/v1/google-tasks?action='+action,{method:'POST',body,expectedSessionEpoch:r.epoch})};
    try{
      if(!attempt.task){
        const result=await createGoogleTask({...body,expectedSessionEpoch:r.epoch});if(!taskScopeCurrent(r))return;
        if(result?.ok===true&&taskIdentity(result.task))attempt.task=structuredClone(result.task);
        if(!attempt.task||!taskBodyMatches(attempt.task,body))throw new Error('Google 할 일의 저장 결과를 확인하지 못했습니다.');attempt.bodyState='confirmed';
        if(!taskCurrent(r)){attempt.needsReview=true;return}
        stage='links';attempt.links=taskLinkKeys(result);
        if(result.link_error||body.links.some(l=>!attempt.links.has(taskLinkKey(l)))){attempt.linkState='partial';attempt.needsReview=true;taskNotice('할 일은 저장했습니다. 프로젝트 연결을 확인해 주세요.',{confirm:true});taskToast(r,'할 일은 저장했습니다. 프로젝트 연결을 확인해 주세요.');return}
      }else if(!taskBodyMatches(attempt.task,body)){
        const result=await call('update',{action:'update',task_id:attempt.task.id,task_list_id:attempt.task.taskListId,title:body.title,notes:body.notes,due:body.due});if(!taskScopeCurrent(r))return;
        if(result?.ok!==true||!taskIdentity(result.task)||result.task.id!==attempt.task.id||result.task.taskListId!==attempt.task.taskListId||!taskBodyMatches(result.task,body))throw new Error('기존 할 일의 수정 결과를 확인하지 못했습니다.');attempt.task=structuredClone(result.task);attempt.bodyState='confirmed';if(!taskCurrent(r)){attempt.needsReview=true;return}
      }
      stage='links';const missing=body.links.filter(l=>!attempt.links.has(taskLinkKey(l)));
      if(missing.length){const result=await call('link',{action:'link',task_id:attempt.task.id,links:missing});if(!taskScopeCurrent(r))return;const confirmed=taskLinkKeys(result);if(result?.ok!==true||missing.some(l=>!confirmed.has(taskLinkKey(l))))throw new Error('프로젝트 연결의 저장 결과를 확인하지 못했습니다.');attempt.links=confirmed;if(!taskCurrent(r)){attempt.needsReview=true;return}}
      attempt.linkState='confirmed';if(!taskCurrent(r))return;taskAttempt=null;r.completed=true;
      if(taskSnapshot()===r.draft){input.value='';expanded=false;taskNotice('')}else{expanded=true;taskNotice('제출한 할 일은 저장했습니다. 추가 입력은 남겨 두었습니다.')}paint();taskToast(r,'할 일을 추가했습니다.');
      try{void Promise.resolve(refreshTasks()).catch(()=>{if(taskScopeCurrent(r)&&r.token===taskSequence&&mode==='task'&&!input.value)taskNotice('할 일은 저장했습니다. 목록을 다시 불러오지 못했습니다.')})}catch(error){if(taskCurrent(r))taskNotice('할 일은 저장했습니다. 목록을 다시 불러오지 못했습니다.')}
    }catch(error){if(!taskScopeCurrent(r))return;if(stage==='body')attempt.bodyState='unknown';else attempt.linkState='unknown';attempt.needsReview=true;if(taskCurrent(r))taskNotice((attempt.task?'할 일은 확인했습니다. 연결과 수정 결과를 확인해 주세요. ':'저장 결과를 확인하지 못했습니다. ')+(error.message||error),{confirm:true})}
    finally{attempt.pending=false;if(taskRequest===r&&taskScopeCurrent(r)&&r.token===taskSequence){taskRequest=null;saving=false;taskControls(false);paint()}}
  }
  async function save(){
    if(mode==='task')return saveTask();
    if(saving)return;
    if(mode==='basket'){if(!upload.entries.length){try{validateNoteText(input.value);}catch(e){status.textContent=e.message;return;}}}else if(!input.value.trim())return;
    if(mode==='update'&&!organization){expand();await choices();status.textContent='조직을 선택해 주세요.';await openSheet('org');return;}
    const ctx=window.KPTURuntime.context.read(),owner=ctx?.user?.id;if(!owner)return;
    const saveMode=mode,text=mode==='basket'?input.value:input.value.trim(),workspace=ctx.workspace?.id,batch=upload,generation=uploadGeneration;const isCurrent=()=>{const c=window.KPTURuntime.context.read();return c?.user?.id===owner&&c?.workspace?.id===workspace&&batch===upload&&window.KPTURouter.current===view;};
    // The native guard belongs to this save, even after the view comes back.
    let invalidated=false,sessionEpoch;
    const token={current:()=>{if(invalidated)return false;const session=window.KPTURuntime.session.read();if(generation!==uploadGeneration||!isCurrent()||sessionEpoch!==window.KPTURuntime.session.epoch()||session?.user?.id!==owner||!session?.access_token)invalidated=true;return !invalidated;}};
    const ocr=saveMode==='basket'&&batch.entries.length?basketOcrFor({isCurrent:token.current}):null;
    if(ocr?.enabled){sessionEpoch=window.KPTURuntime.session.epoch();pendingOcr=token;}
    saving=true;status.textContent='';
    box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);pickerFiles.render();
    try{
      const result=saveMode==='basket'?(batch.entries.length?await uploadBatch(batch,{raw_text:text,isCurrent,ocr,onChange:()=>{if(isCurrent())paint();},onOcrChange:value=>{if(isCurrent()&&token.current()&&!value.ok)status.textContent=value.result_unknown?'사진은 저장했습니다. 글자 읽기 결과는 바구니에서 확인해 주세요.':value.ocr_saved?'사진과 글자는 저장했습니다. 임시 문서 정리는 바구니에서 확인해 주세요.':value.text?'사진은 저장했습니다. 이전 글자는 유지했습니다. 읽기 결과와 임시 문서 정리는 바구니에서 확인해 주세요.':'사진은 저장했습니다. 글자는 읽지 못했습니다.';}}):await createNote({raw_text:text})):await saveOrganizationUpdate({organization_id:organization,raw_text:text,created_by:owner});
      if(!isCurrent())return;
      if(saveMode==='basket'&&!batch.blocked&&batch.entries.every(entry=>entry.kind==='success'))upload=createUploadBatch();
      input.value='';expanded=false;paint();if(saveMode==='basket')onSaved(result);
      const toast=document.querySelector('#toast');toast.textContent=saveMode==='basket'?'바구니에 저장했습니다.':'기록을 저장했습니다.';toast.classList.remove('hidden');clearTimeout(save.toastTimer);save.toastTimer=setTimeout(()=>toast.classList.add('hidden'),3200);
      choicesFlight=null;
    }catch(e){if(isCurrent())status.textContent=e.message||'저장하지 못했습니다.';}
    finally{if(pendingOcr===token)pendingOcr=null;saving=false;box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);paint();}
  }
  box.querySelector('[data-quick-save]').onclick=save;
  input.addEventListener('keydown',e=>{if(mode==='task'&&e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();void save();}});
  window.addEventListener('kptu:before-reload',e=>{if(saving)e.preventDefault();else if(input.value.length||taskAttempt||upload.entries.some(e=>e.kind!=='success'))e.detail.otherDraft=true;});
  window.addEventListener('kptu:session-changed',()=>{const nextEpoch=taskRuntime.session.epoch();if(nextEpoch!==taskSessionEpoch){taskSessionEpoch=nextEpoch;taskSequence++;taskAttempt=null;taskRequest=null;taskReading=false;if(mode==='task'){saving=false;taskControls(false)}}const nextOwner=quickScope();if(nextOwner===quickOwner)return;dismissForNavigation();quickOwner=nextOwner;projectChoices=[];orgChoices={recent:[],groups:[]};choiceEpoch++;choicesFlight=null;project='';organization='';due='';dateKind='';input.value='';upload=createUploadBatch();expanded=false;paint();});
  window.addEventListener('kptu:project-catalog-updated',()=>{choiceEpoch++;choicesFlight=null;invalidateProjects();if(expanded&&mode!=='basket')void choices();});
  window.KPTURouter.on(view,()=>{choiceEpoch++;choicesFlight=null;if(expanded&&mode!=='basket')void choices();});
  if(basketOnly){box.querySelector('.home-quick-modes').remove();box.querySelector('[data-goto="basket"]').remove();input.setAttribute('aria-label','바구니에 메모 입력');}
  paint();
  return {hasDraft:()=>!!input.value||!!taskAttempt||upload.entries.some(e=>e.kind!=='success'),isBusy:()=>saving};
}
