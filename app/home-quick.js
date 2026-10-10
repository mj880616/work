import { createChoiceSheet, projectRows } from './choice-sheet.js?v=1';
import { createGoogleTask, saveOrganizationUpdate } from './quick-save.js?v=1';
import { createNote, validateNoteText } from './basket-data.js?v=2';
import { createUploadBatch, uploadBatch, mountBasketPicker } from './basket-upload.js?v=1';
import { dayKey } from './home-read-model.js?v=1';

export function mountQuick({root, dependencies, refreshTasks, invalidateProjects, esc}) {
  const box=root.querySelector('.home-quick-placeholder');
  box.removeAttribute('aria-hidden'); box.className='home-quick'; box.dataset.homeQuick='';
  const quickScope=()=>{const c=window.KPTURuntime.context.read();return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
  let quickOwner=quickScope();
  let mode='basket',saving=false,expanded=false,project='',organization='',due='',dateKind='',choicesFlight=null,choiceEpoch=0,projectChoices=[],orgChoices={recent:[],groups:[]};
  try { const saved=window.localStorage.getItem('kptu-home-quick-mode'); mode=['basket','task','update'].includes(saved)?saved:'basket'; } catch {}
  let upload = createUploadBatch();
  box.innerHTML=`<div class="home-quick-modes" role="group" aria-label="입력 종류"><button type="button" data-quick-mode="basket">바구니</button><button type="button" data-quick-mode="task">할 일</button><button type="button" data-quick-mode="update">업데이트</button></div><div class="home-quick-entry"><textarea data-quick-input aria-label="빠른 입력" rows="1" placeholder="할 일을 입력하세요"></textarea><button type="button" class="home-quick-save" data-quick-save>추가</button></div><div data-quick-basket-options><div data-quick-file-picker></div><button type="button" class="home-basket-link" data-quick-new-note hidden>새 메모 입력</button></div><div data-quick-options hidden><div data-quick-task-options><button type="button" data-quick-project aria-label="프로젝트" aria-haspopup="dialog" aria-expanded="false">프로젝트 ▾</button><button type="button" data-quick-day="today">오늘</button><button type="button" data-quick-day="tomorrow">내일</button><button type="button" data-quick-day="date">날짜</button><input type="date" data-quick-date aria-label="기한 날짜" tabindex="-1"></div><div data-quick-update-options hidden><button type="button" data-quick-org aria-label="조직" aria-haspopup="dialog" aria-expanded="false">조직 ▾</button></div><small data-quick-destination></small></div><div data-quick-status role="status"></div><button type="button" data-goto="basket" class="home-basket-link">바구니 전체 보기 ›</button>`;
  const input=box.querySelector('[data-quick-input]'),options=box.querySelector('[data-quick-options]'),status=box.querySelector('[data-quick-status]'),orgSelect=box.querySelector('[data-quick-org]'),projectSelect=box.querySelector('[data-quick-project]'),date=box.querySelector('[data-quick-date]');
  const pickerFiles=mountBasketPicker(box.querySelector('[data-quick-file-picker]'),{id:'quickBasketFiles',getBatch:()=>upload,isBusy:()=>saving,onError:message=>status.textContent=message,onChange:()=>{status.textContent='';paint();}});
  box.querySelector('[data-quick-new-note]').onclick=()=>{if(saving)return;if((input.value||upload.entries.some(e=>e.kind!=='success'))&&!window.confirm('바구니에서 저장 여부를 확인한 후 새 메모를 입력할까요? 현재 입력과 파일 선택은 비워집니다.'))return;upload=createUploadBatch();input.value='';status.textContent='';paint();input.focus();};
  function size(){ input.style.height=''; if(mode==='update')input.style.height=Math.min(146,Math.max(83,input.scrollHeight+2))+'px'; }
  function paint(){
    pickerFiles.render(); input.readOnly=mode==='basket'&&(!!upload.note_id||!!upload.blocked);box.querySelector('[data-quick-new-note]').hidden=!upload.note_id&&!upload.blocked;
    box.dataset.mode=mode; input.rows=mode==='update'?3:1; input.placeholder=mode==='basket'?'메모를 입력하세요':mode==='task'?'할 일을 입력하세요':'담당조직 기록을 입력하세요';
    box.querySelector('[data-quick-basket-options]').hidden=mode!=='basket';
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
  const picker=createChoiceSheet({id:'homeChoiceSheet',titleId:'homeChoiceTitle',historyKey:'kptuHomeChoice',
    canOpen:()=>!saving&&window.KPTURouter.current==='home',choices,
    render:kind=>{
      const selected=kind==='org'?organization:project;
      const chip=o=>`<button type="button" class="home-choice-chip" data-sheet-value="${esc(o.id)}" aria-pressed="${o.id===selected}">${esc(o.name)}</button>`;
      return {title:kind==='org'?'조직 선택':'프로젝트 선택',html:kind==='org'?`<p class="home-choice-label">최근</p><div class="home-choice-group" data-sheet-recent>${orgChoices.recent.map(chip).join('')}</div><p class="home-choice-label">전체</p><div data-sheet-all>${orgChoices.groups.filter(g=>g.length).map(g=>`<div class="home-choice-group">${g.map(chip).join('')}</div>`).join('')}</div>`:projectRows(projectChoices,selected,esc)};
    },onSelect:(kind,value)=>{if(kind==='org')organization=value;else project=value;paint();}
  });
  const openSheet=kind=>picker.open(kind,kind==='org'?orgSelect:projectSelect);
  const dismissForNavigation=()=>picker.dismiss();
  projectSelect.onclick=()=>void openSheet('project');orgSelect.onclick=()=>void openSheet('org');
  window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view!=='home')dismissForNavigation();});
  box.querySelectorAll('[data-quick-mode]').forEach(b=>b.onclick=()=>{
    if(saving)return;mode=b.dataset.quickMode;status.textContent='';
    try{window.localStorage.setItem('kptu-home-quick-mode',mode);}catch{}
    paint();if(expanded&&mode!=='basket')void choices();
  });
  box.querySelectorAll('[data-quick-day]').forEach(b=>b.onclick=()=>{
    if(saving)return;const kind=b.dataset.quickDay;
    if(dateKind===kind){due='';dateKind='';date.value='';paint();return;}
    if(kind==='date'){try{date.showPicker();}catch{date.focus();date.click();}return;}
    dateKind=kind;due=dayKey(Date.now()+(kind==='tomorrow'?86400000:0));paint();
  });
  date.onchange=()=>{due=date.value;dateKind=due?'date':'';paint();};
  async function save(){
    if(saving)return;
    if(mode==='basket'){if(!upload.entries.length){try{validateNoteText(input.value);}catch(e){status.textContent=e.message;return;}}}else if(!input.value.trim())return;
    if(mode==='update'&&!organization){expand();await choices();status.textContent='조직을 선택해 주세요.';await openSheet('org');return;}
    const ctx=window.KPTURuntime.context.read(),owner=ctx?.user?.id;if(!owner)return;
    const saveMode=mode,text=mode==='basket'?input.value:input.value.trim(),workspace=ctx.workspace?.id,batch=upload;const isCurrent=()=>{const c=window.KPTURuntime.context.read();return c?.user?.id===owner&&c?.workspace?.id===workspace&&batch===upload;};saving=true;status.textContent='';
    box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);pickerFiles.render();
    try{
      const result=saveMode==='basket'?(batch.entries.length?await uploadBatch(batch,{raw_text:text,isCurrent,onChange:()=>{if(isCurrent())paint();}}):await createNote({raw_text:text})):saveMode==='task'?await createGoogleTask({title:text,due:due||null,links:project?[{project_id:project}]:[]}):await saveOrganizationUpdate({organization_id:organization,raw_text:text,created_by:owner});
      if(!isCurrent())return;
      input.value='';expanded=false;paint();
      const toast=document.querySelector('#toast');toast.textContent=saveMode==='task'&&result?.link_error?'할 일은 추가됨, 프로젝트 연결 실패':saveMode==='basket'?'바구니에 저장했습니다.':saveMode==='task'?'할 일을 추가했습니다.':'기록을 저장했습니다.';toast.classList.remove('hidden');clearTimeout(save.toastTimer);save.toastTimer=setTimeout(()=>toast.classList.add('hidden'),3200);
      if(saveMode==='task')void refreshTasks();else choicesFlight=null;
    }catch(e){if(isCurrent())status.textContent=e.message||'저장하지 못했습니다.';}
    finally{saving=false;box.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);paint();}
  }
  box.querySelector('[data-quick-save]').onclick=save;
  input.addEventListener('keydown',e=>{if(mode==='task'&&e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();void save();}});
  window.addEventListener('kptu:before-reload',e=>{if(saving)e.preventDefault();else if(input.value.length||upload.entries.some(e=>e.kind!=='success'))e.detail.otherDraft=true;});
  window.addEventListener('kptu:session-changed',()=>{const nextOwner=quickScope();if(nextOwner===quickOwner)return;dismissForNavigation();quickOwner=nextOwner;projectChoices=[];orgChoices={recent:[],groups:[]};choiceEpoch++;choicesFlight=null;project='';organization='';due='';dateKind='';input.value='';upload=createUploadBatch();expanded=false;paint();});
  window.addEventListener('kptu:project-catalog-updated',()=>{choiceEpoch++;choicesFlight=null;invalidateProjects();if(expanded&&mode!=='basket')void choices();});
  window.KPTURouter.on('home',()=>{choiceEpoch++;choicesFlight=null;if(expanded&&mode!=='basket')void choices();});
  paint();
}
