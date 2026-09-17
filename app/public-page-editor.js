(()=>{
  'use strict';
  if(window.__KPTU_PUBLIC_PAGE_EDITOR__)return;
  window.__KPTU_PUBLIC_PAGE_EDITOR__=true;

  const EDIT_API='/functions/v1/public-page-edit';
  const PUBLIC_AUTH_SRC='/work/app/public-page-auth.js?v=5';
  const AUTOSAVE_DELAY=650;
  const RETRY_DELAYS=[900,2200];
  const btn=()=>document.querySelector('#editPageBtn');
  let current=null;
  let secureMode=false;
  let saving=false;
  let editing=false;
  let authPromise=null;
  let savePromise=null;
  let autosaveTimer=null;
  let retryTimer=null;
  let retryAttempt=0;
  let dirtyVersion=0;
  let savedVersion=0;

  function ensureStyle(){
    if(document.querySelector('#publicPageEditorStyle'))return;
    const s=document.createElement('style');
    s.id='publicPageEditorStyle';
    s.textContent=`
      .ppe-editing .paper{box-shadow:0 0 0 3px rgba(47,97,149,.08),0 10px 32px rgba(25,45,65,.055)}
      .ppe-editing [data-ppe-editable]{border-radius:6px;outline:1px dashed rgba(47,97,149,.32);outline-offset:3px;cursor:text;transition:outline-color .12s,background .12s}
      .ppe-editing [data-ppe-editable]:hover{outline-color:rgba(47,97,149,.62);background:rgba(237,244,251,.42)}
      .ppe-editing [data-ppe-editable]:focus{outline:2px solid rgba(47,97,149,.72);background:#fff;box-shadow:0 0 0 4px rgba(47,97,149,.08)}
      .ppe-editing .pd-summary.ppe-empty-summary{min-height:34px;padding:6px 8px;margin-left:-8px;margin-right:-8px}
      .ppe-editing .pd-summary.ppe-empty-summary:empty:before{content:'요약을 입력하려면 여기를 클릭';color:#9aa5ae;font-weight:500}
      .ppe-editing .pd-forum-flow{position:relative}
      .ppe-editing .pd-forum-flow:before{content:'도식 문구도 직접 수정할 수 있습니다';display:block;margin:0 0 8px;color:#73808b;font-size:11px;font-weight:700;letter-spacing:-.1px}
      .ppe-live-status{font-size:11px;color:#687681;align-self:center;margin-right:auto;font-weight:700}.ppe-live-status.error{color:#a33b45}
      .ppe-live-save{background:#17324d!important;border-color:#17324d!important;color:#fff!important}.ppe-live-save:disabled{opacity:.55;cursor:default}
      .ppe-live-retry{border-color:#c98b91!important;color:#9b2730!important;background:#fff7f7!important}
      .ppe-editing .ppe-deletable{position:relative}
      .ppe-block-delete{position:absolute;z-index:3;right:8px;top:8px;border:1px solid #d9a8ac;background:#fff8f8;color:#9d3038;border-radius:7px;padding:5px 8px;font:inherit;font-size:10px;font-weight:800;line-height:1;cursor:pointer;box-shadow:0 2px 8px rgba(90,25,30,.06)}
      .ppe-block-delete:hover{background:#fff0f1;border-color:#c98288}.ppe-editing .pd-section>.ppe-block-delete{top:4px}
      .ppe-auth-backdrop{position:fixed;inset:0;z-index:9999;background:rgba(18,30,42,.45);display:flex;align-items:center;justify-content:center;padding:18px}.ppe-auth-backdrop.hidden{display:none!important}
      .ppe-auth-dialog{width:min(420px,100%);background:#fff;border:1px solid #dce3e8;border-radius:18px;padding:24px;box-shadow:0 22px 70px rgba(18,30,42,.24);color:#18222d}.ppe-auth-dialog h2{margin:0 0 7px;font-size:20px}.ppe-auth-dialog p{margin:0 0 18px;color:#66747f;font-size:13px;line-height:1.55}.ppe-auth-field{display:block;margin:12px 0}.ppe-auth-field span{display:block;margin-bottom:5px;font-size:12px;font-weight:800}.ppe-auth-field input{width:100%;border:1px solid #cbd5dd;border-radius:9px;padding:10px 11px;font:inherit;font-size:14px}.ppe-auth-field input:focus{outline:3px solid rgba(49,95,149,.14);border-color:#7894ad}.ppe-auth-error{min-height:18px;color:#a33b45;font-size:12px;font-weight:700;margin:8px 0}.ppe-auth-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.ppe-auth-actions button{appearance:none;border:1px solid #cbd5dd;background:#fff;border-radius:9px;padding:9px 12px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.ppe-auth-actions button[type=submit]{background:#17324d;border-color:#17324d;color:#fff}.ppe-auth-actions button:disabled{opacity:.55;cursor:default}
      @media(max-width:650px){.ppe-editing [data-ppe-editable]{outline-offset:2px}.ppe-editing .print-tools,.ppe-editing .tools{gap:6px!important;align-items:center;flex-wrap:wrap}.ppe-editing .print-btn{padding:7px 9px!important;min-height:34px!important;font-size:11px!important;line-height:1.15!important}.ppe-editing #ppeLiveCancel{order:1}.ppe-editing #ppeLiveDone{order:2}.ppe-editing #ppeLiveSave{order:3}.ppe-live-status{display:block;flex:1 1 100%;order:5;margin:2px 0 0;font-size:10px}.ppe-block-delete{right:4px;top:4px;padding:5px 7px}.ppe-auth-dialog{padding:20px;border-radius:15px}}
      @media print{.ppe-live-controls,.ppe-block-delete,.ppe-auth-backdrop{display:none!important}.ppe-editing [data-ppe-editable]{outline:0!important;box-shadow:none!important}}
    `;
    document.head.appendChild(s);
  }

  function ensureTools(){
    const tools=document.querySelector('.print-tools,.tools');
    if(!tools)return null;
    if(!document.querySelector('#ppeLiveStatus')){
      const status=document.createElement('span');status.id='ppeLiveStatus';status.className='ppe-live-status ppe-live-controls hidden';status.textContent='수정 중 · 자동 저장';tools.prepend(status);
      const cancel=document.createElement('button');cancel.id='ppeLiveCancel';cancel.type='button';cancel.className='print-btn ppe-live-controls hidden';cancel.textContent='취소';cancel.addEventListener('click',cancelEdit);
      const retry=document.createElement('button');retry.id='ppeLiveRetry';retry.type='button';retry.className='print-btn ppe-live-retry ppe-live-controls hidden';retry.textContent='다시 저장';retry.addEventListener('click',retrySave);
      const done=document.createElement('button');done.id='ppeLiveDone';done.type='button';done.className='print-btn ppe-live-controls hidden';done.textContent='편집 종료';done.addEventListener('click',finishEditing);
      const saveBtn=document.createElement('button');saveBtn.id='ppeLiveSave';saveBtn.type='button';saveBtn.className='print-btn ppe-live-save ppe-live-controls hidden';saveBtn.textContent='저장';saveBtn.addEventListener('click',save);
      const logout=document.createElement('button');logout.id='ppeLogout';logout.type='button';logout.className='print-btn';logout.textContent='로그아웃';logout.addEventListener('click',logoutEditor);
      tools.append(cancel,retry,done,saveBtn,logout);
    }
    return tools;
  }

  function ensureAuthDialog(){
    let root=document.querySelector('#ppeAuthDialog');
    if(root)return root;
    root=document.createElement('div');
    root.id='ppeAuthDialog';
    root.className='ppe-auth-backdrop hidden';
    root.setAttribute('role','dialog');
    root.setAttribute('aria-modal','true');
    root.setAttribute('aria-labelledby','ppeAuthTitle');
    root.innerHTML=`<div class="ppe-auth-dialog"><h2 id="ppeAuthTitle">편집자 로그인</h2><p>페이지 열람에는 로그인이 필요하지 않습니다. 수정이 필요한 경우에만 편집자 계정으로 로그인합니다.</p><form id="ppeAuthForm"><label class="ppe-auth-field"><span>이메일</span><input id="ppeAuthEmail" type="email" autocomplete="username" required></label><label class="ppe-auth-field"><span>비밀번호</span><input id="ppeAuthPassword" type="password" autocomplete="current-password" required></label><div id="ppeAuthError" class="ppe-auth-error" role="alert"></div><div class="ppe-auth-actions"><button id="ppeAuthCancel" type="button">취소</button><button type="submit">로그인 후 수정</button></div></form></div>`;
    document.body.appendChild(root);
    root.querySelector('#ppeAuthCancel')?.addEventListener('click',closeAuthDialog);
    root.querySelector('#ppeAuthForm')?.addEventListener('submit',submitAuth);
    return root;
  }

  function authError(text=''){const el=document.querySelector('#ppeAuthError');if(el)el.textContent=text}
  function showAuthDialog(message=''){
    const root=ensureAuthDialog();authError(message);const pass=root.querySelector('#ppeAuthPassword');if(pass)pass.value='';root.classList.remove('hidden');requestAnimationFrame(()=>root.querySelector('#ppeAuthEmail')?.focus());
  }
  function closeAuthDialog(){
    const root=document.querySelector('#ppeAuthDialog');if(!root||root.classList.contains('hidden'))return;root.classList.add('hidden');authError('');const pass=root.querySelector('#ppeAuthPassword');if(pass)pass.value='';btn()?.focus();
  }
  function authDialogOpen(){return !document.querySelector('#ppeAuthDialog')?.classList.contains('hidden')}
  function setStatus(text,error=false){const el=document.querySelector('#ppeLiveStatus');if(!el)return;el.textContent=text||'';el.classList.toggle('error',!!error)}
  function showRetry(on){const el=document.querySelector('#ppeLiveRetry');if(el)el.classList.toggle('hidden',!on||!editing)}
  function clearAutosave(){if(autosaveTimer){clearTimeout(autosaveTimer);autosaveTimer=null}}
  function clearRetry(){if(retryTimer){clearTimeout(retryTimer);retryTimer=null}}

  async function publicAuth(){
    if(window.KPTUPublicAuth?.api&&window.KPTUPublicAuth?.session&&window.KPTUPublicAuth?.signIn)return window.KPTUPublicAuth;
    if(!authPromise){
      authPromise=new Promise((resolve,reject)=>{
        const existing=document.querySelector('script[data-kptu-public-auth]');
        if(existing){
          if(window.KPTUPublicAuth)return resolve(window.KPTUPublicAuth);
          existing.addEventListener('load',()=>resolve(window.KPTUPublicAuth),{once:true});
          existing.addEventListener('error',()=>reject(new Error('편집 인증 모듈을 불러오지 못했습니다.')),{once:true});
          return;
        }
        const script=document.createElement('script');script.src=PUBLIC_AUTH_SRC;script.async=true;script.dataset.kptuPublicAuth='1';script.onload=()=>resolve(window.KPTUPublicAuth);script.onerror=()=>reject(new Error('편집 인증 모듈을 불러오지 못했습니다.'));document.head.appendChild(script);
      }).catch(error=>{authPromise=null;throw error});
    }
    await authPromise;
    if(!window.KPTUPublicAuth?.api||!window.KPTUPublicAuth?.session||!window.KPTUPublicAuth?.signIn)throw new Error('편집 인증 모듈을 초기화하지 못했습니다. 새로고침 후 다시 시도해 주세요.');
    return window.KPTUPublicAuth;
  }

  async function checkAccess(pageId=current?.id){const auth=await publicAuth();return auth.api(EDIT_API,{method:'POST',body:{action:'check',id:pageId}})}
  async function updatePage(next){const auth=await publicAuth();if(!(await auth.session.ensure()))throw new Error('편집자 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');return auth.api(EDIT_API,{method:'POST',body:{action:'update',id:current?.id,...next}})}

  async function logoutEditor(){
    if(editing){const ok=await finishEditing();if(editing)return}
    try{const auth=await publicAuth();auth.session.write(null);setStatus('');showAuthDialog('로그아웃했습니다. 다시 수정하려면 편집자 계정으로 로그인해 주세요.')}catch(e){showAuthDialog(e?.message||'로그아웃 처리에 실패했습니다.')}
  }

  async function startEditing(){
    closeAuthDialog();ensureTools();dirtyVersion=0;savedVersion=0;retryAttempt=0;clearAutosave();clearRetry();setEditingUi(true);
    if(!prepareLiveFields()){setEditingUi(false);throw new Error('편집할 내용을 찾지 못했습니다.')}
    document.querySelector('#paper .pd-title')?.focus();
  }

  async function submitAuth(event){
    event.preventDefault();if(secureMode||!current?.id||editing)return;
    const form=event.currentTarget,submit=form.querySelector('button[type="submit"]'),email=form.querySelector('#ppeAuthEmail')?.value||'',pass=form.querySelector('#ppeAuthPassword'),password=pass?.value||'';
    authError('');if(submit)submit.disabled=true;
    try{
      const auth=await publicAuth();await auth.signIn(email,password);if(pass)pass.value='';
      try{await checkAccess(current.id)}catch{authError('이 계정에는 이 페이지 수정 권한이 없습니다. 다른 편집자 계정으로 로그인해 주세요.');return}
      await startEditing();
    }catch(e){if(pass)pass.value='';authError(e?.message||'로그인에 실패했습니다.')}finally{if(submit)submit.disabled=false}
  }

  function cleanText(el){return String(el?.innerText??el?.textContent??'').replace(/\u00a0/g,' ').replace(/\r/g,'').trim()}
  function encodeFlow(v){return String(v||'').replace(/\r/g,'').replace(/\n/g,'\\n').trim()}
  function markEditable(el){if(!el)return;el.contentEditable='true';el.spellcheck=true;el.dataset.ppeEditable='1'}

  function prepareFlow(flow){
    flow.querySelectorAll('.pd-flow-node,.pd-flow-solution,.pd-flow-goal,.pd-flow-note').forEach(markEditable);
    flow.querySelectorAll('.pd-flow-problem').forEach(problem=>{
      const note=problem.querySelector(':scope > .pd-flow-note');if(!note){markEditable(problem);return}
      let field=problem.querySelector(':scope > [data-ppe-flow-problem]');
      if(!field){field=document.createElement('span');field.dataset.ppeFlowProblem='1';[...problem.childNodes].filter(n=>n!==note).forEach(n=>field.appendChild(n));problem.insertBefore(field,note)}
      markEditable(field);markEditable(note);
    });
  }

  function addDeleteControl(target,label='칸'){
    if(!target||target.querySelector(':scope > .ppe-block-delete'))return;target.classList.add('ppe-deletable');
    const del=document.createElement('button');del.type='button';del.className='ppe-block-delete';del.dataset.ppeControl='1';del.contentEditable='false';del.setAttribute('aria-label',`${label} 전체 삭제`);del.textContent='삭제';
    del.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if(!editing)return;if(!window.confirm(`${label} 전체를 삭제할까요?`))return;target.remove();markDirty(true)});target.appendChild(del);
  }

  function bindInputTracking(paper){if(paper.dataset.ppeInputBound==='1')return;paper.dataset.ppeInputBound='1';paper.addEventListener('input',e=>{if(editing&&e.target?.closest?.('[data-ppe-editable]'))markDirty(false)})}

  function prepareLiveFields(){
    const paper=document.querySelector('#paper');if(!paper)return false;const title=paper.querySelector('.pd-title');let summary=paper.querySelector('.pd-summary');const hero=paper.querySelector('.pd-hero');
    if(!summary&&hero){summary=document.createElement('p');summary.className='pd-summary ppe-empty-summary';hero.appendChild(summary)}
    markEditable(title);markEditable(summary);
    paper.querySelectorAll('.pd-body p,.pd-body h2,.pd-body h3,.pd-body h4,.pd-body blockquote,.pd-details summary').forEach(markEditable);
    paper.querySelectorAll('.pd-body ul:not(.pd-checklist) > li,.pd-body ol > li').forEach(markEditable);
    paper.querySelectorAll('.pd-body .pd-checklist > li').forEach(li=>markEditable(li.querySelector(':scope > span:last-child')||li));
    paper.querySelectorAll('.pd-forum-flow').forEach(prepareFlow);
    paper.querySelectorAll('.pd-body .section-link').forEach(el=>{el.dataset.ppeControl='1';el.contentEditable='false'});
    paper.querySelectorAll('.pd-body > .pd-section').forEach(el=>addDeleteControl(el,'섹션'));
    paper.querySelectorAll('.pd-body .pd-details').forEach(el=>addDeleteControl(el,'카드'));
    bindInputTracking(paper);return true;
  }

  function inlineNode(node){
    if(node.nodeType===Node.TEXT_NODE)return String(node.nodeValue||'').replace(/\u00a0/g,' ');if(node.nodeType!==Node.ELEMENT_NODE)return '';
    const el=node,tag=el.tagName;if(el.dataset?.ppeControl==='1'||el.classList?.contains('ppe-block-delete'))return '';if(tag==='BR')return '\n';const inner=[...el.childNodes].map(inlineNode).join('');if(tag==='STRONG'||tag==='B')return '**'+inner+'**';if(tag==='EM'||tag==='I')return '*'+inner+'*';return inner;
  }
  function inlineText(el){return [...(el?.childNodes||[])].map(inlineNode).join('').replace(/[ \t]+\n/g,'\n').trim()}

  function serializeFlow(flow){
    const top=[...flow.querySelectorAll('.pd-flow-top .pd-flow-node')].map(cleanText).filter(Boolean),tracks=[...flow.querySelectorAll('.pd-flow-track')];
    const readTrack=track=>{const problem=track?.querySelector('.pd-flow-problem'),field=problem?.querySelector(':scope > [data-ppe-flow-problem]');return {problem:cleanText(field||problem),note:cleanText(problem?.querySelector(':scope > .pd-flow-note')),solution:cleanText(track?.querySelector('.pd-flow-solution'))}};
    const left=readTrack(tracks[0]),right=readTrack(tracks[1]);
    return [':::forum-flow',`top: ${top.map(encodeFlow).join(' | ')}`,`left_problem: ${encodeFlow(left.problem)}`,`left_note: ${encodeFlow(left.note)}`,`left_solution: ${encodeFlow(left.solution)}`,`right_problem: ${encodeFlow(right.problem)}`,`right_note: ${encodeFlow(right.note)}`,`right_solution: ${encodeFlow(right.solution)}`,`goal: ${encodeFlow(cleanText(flow.querySelector('.pd-flow-goal')))}`,':::'].join('\n');
  }

  function serializeList(el){
    const ordered=el.tagName==='OL',checklist=el.classList.contains('pd-checklist');
    return [...el.children].filter(x=>x.tagName==='LI').map((li,i)=>{if(checklist){const done=li.classList.contains('pd-check-done'),textEl=li.querySelector(':scope > span:last-child')||li;return `- [${done?'x':' '}] ${inlineText(textEl)}`}return `${ordered?(i+1)+'.':'-'} ${inlineText(li)}`}).join('\n');
  }
  function serializeChildren(parent,inSection=false){const out=[];[...parent.children].forEach(el=>{const value=serializeBlock(el,inSection);if(value&&value.trim())out.push(value.trim())});return out.join('\n\n')}
  function serializeBlock(el,inSection=false){
    if(!el||el.dataset?.ppeControl==='1'||el.classList?.contains('ppe-block-delete'))return '';if(el.classList.contains('pd-forum-flow'))return serializeFlow(el);
    if(el.classList.contains('pd-section')){const children=[...el.children].filter(child=>child.dataset?.ppeControl!=='1'&&!child.classList?.contains('ppe-block-delete')),parts=[];children.forEach((child,i)=>{if(i===0&&child.tagName==='H2')parts.push('## '+inlineText(child));else{const v=serializeBlock(child,true);if(v)parts.push(v)}});return parts.join('\n\n')}
    if(el.tagName==='DETAILS'){const summary=inlineText(el.querySelector(':scope > summary')),body=el.querySelector(':scope > .pd-details-body');return `:::details ${summary}\n${body?serializeChildren(body,inSection):''}\n:::`}
    if(el.tagName==='H2')return `${inSection?'##':'#'} ${inlineText(el)}`;if(el.tagName==='H3')return `### ${inlineText(el)}`;if(el.tagName==='H4')return `#### ${inlineText(el)}`;if(el.tagName==='P')return inlineText(el);if(el.tagName==='UL'||el.tagName==='OL')return serializeList(el);if(el.tagName==='BLOCKQUOTE')return '> '+inlineText(el).replace(/\n/g,'\n> ');return serializeChildren(el,inSection);
  }
  function collectLivePage(){const paper=document.querySelector('#paper'),title=cleanText(paper?.querySelector('.pd-title')),summary=cleanText(paper?.querySelector('.pd-summary')),bodyEl=paper?.querySelector('.pd-body');return {title,summary,body:bodyEl?serializeChildren(bodyEl,false):''}}

  function setSavingControls(on){['#ppeLiveSave','#ppeLiveDone','#ppeLiveCancel'].forEach(selector=>{const el=document.querySelector(selector);if(el)el.disabled=!!on})}
  function scheduleAutosave(){clearAutosave();if(!editing||dirtyVersion<=savedVersion)return;autosaveTimer=setTimeout(()=>{autosaveTimer=null;void persistDirty({autoRetry:true})},AUTOSAVE_DELAY)}
  function markDirty(immediate=false){if(!editing)return;dirtyVersion+=1;retryAttempt=0;clearRetry();showRetry(false);setStatus(immediate?'저장 중…':'저장 대기 중…');if(immediate){clearAutosave();void persistDirty({autoRetry:true})}else scheduleAutosave()}
  function scheduleRetry(error){
    clearRetry();if(!editing||dirtyVersion<=savedVersion)return;
    if(retryAttempt<RETRY_DELAYS.length){const delay=RETRY_DELAYS[retryAttempt++];setStatus(`저장 실패 · ${Math.ceil(delay/100)/10}초 후 다시 시도`,true);retryTimer=setTimeout(()=>{retryTimer=null;void persistDirty({autoRetry:true})},delay);return}
    showRetry(true);setStatus(`${error?.message||'저장 실패'} · 수정 내용은 화면에 유지됨`,true);
  }

  async function persistDirty({autoRetry=true}={}){
    clearAutosave();if(!editing||!current?.id)return true;if(saving)return savePromise||false;if(dirtyVersion<=savedVersion){setStatus('저장됨');return true}
    saving=true;setSavingControls(true);showRetry(false);
    savePromise=(async()=>{
      while(editing&&dirtyVersion>savedVersion){
        const version=dirtyVersion,next=collectLivePage();if(!next.title){setStatus('제목은 비워둘 수 없습니다.',true);showRetry(true);return false}setStatus('저장 중…');
        try{const d=await updatePage(next);if(!d?.page)throw new Error(d?.error||'저장 결과를 확인하지 못했습니다.');current={...current,...d.page};savedVersion=Math.max(savedVersion,version);retryAttempt=0;clearRetry();showRetry(false)}
        catch(e){if(autoRetry)scheduleRetry(e);else{clearRetry();showRetry(true);setStatus(e?.message||'저장에 실패했습니다. 수정 내용은 화면에 유지됩니다.',true)}return false}
      }
      if(editing)setStatus('저장됨');return true;
    })();
    try{return await savePromise}finally{saving=false;savePromise=null;setSavingControls(false)}
  }
  async function retrySave(){if(!editing)return;clearRetry();retryAttempt=0;showRetry(false);await persistDirty({autoRetry:true})}
  function exitEditing(){clearAutosave();clearRetry();retryAttempt=0;editing=false;document.body.classList.remove('ppe-editing');if(typeof window.KPTURenderPublicPage==='function')window.KPTURenderPublicPage(current,false);setEditingUi(false)}
  async function finishEditing(){if(!editing)return;clearAutosave();clearRetry();let ok=true;if(saving)ok=await(savePromise||Promise.resolve(false));if(ok&&dirtyVersion>savedVersion)ok=await persistDirty({autoRetry:false});if(!ok||dirtyVersion>savedVersion)return;exitEditing()}

  function setEditingUi(on){
    editing=on;document.body.classList.toggle('ppe-editing',on);const edit=btn(),print=document.querySelector('#printPageBtn'),saveBtn=document.querySelector('#ppeLiveSave'),done=document.querySelector('#ppeLiveDone'),cancel=document.querySelector('#ppeLiveCancel'),status=document.querySelector('#ppeLiveStatus'),logout=document.querySelector('#ppeLogout');
    edit?.classList.toggle('hidden',on||secureMode||!current?.id);print?.classList.toggle('hidden',on);logout?.classList.toggle('hidden',on||secureMode||!current?.id);[saveBtn,done,cancel,status].forEach(x=>x?.classList.toggle('hidden',!on));if(!on)showRetry(false);if(on)setStatus('수정 중 · 자동 저장');
  }

  async function open(){
    if(secureMode||!current?.id||editing)return;
    try{
      const auth=await publicAuth();if(!(await auth.session.ensure())){showAuthDialog();return}
      try{await checkAccess(current.id)}catch{showAuthDialog('현재 편집자 계정에는 이 페이지 수정 권한이 없습니다. 다른 계정으로 로그인해 주세요.');return}
      await startEditing();
    }catch(e){showAuthDialog(e?.message||'편집자 로그인을 준비하지 못했습니다.')}
  }

  function cancelEdit(){if(!editing||saving)return;const hasUnsaved=dirtyVersion>savedVersion;if(hasUnsaved&&!window.confirm('아직 저장되지 않은 변경을 버릴까요?'))return;exitEditing()}
  async function save(){await finishEditing()}

  function setPage(page,secure=false){
    current=page||null;secureMode=!!secure;ensureTools();const b=btn();if(!b)return;b.onclick=null;
    if(secureMode||!current?.id){b.classList.add('hidden');return}
    b.classList.remove('hidden');b.onclick=e=>{e.preventDefault();void open()};
  }

  document.addEventListener('keydown',e=>{
    if(authDialogOpen()&&e.key==='Escape'){e.preventDefault();closeAuthDialog();return}
    if(!editing)return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();void save();return}if(e.key==='Escape'){e.preventDefault();cancelEdit()}
  });
  window.addEventListener('beforeunload',e=>{if(!editing||(!saving&&dirtyVersion<=savedVersion))return;e.preventDefault();e.returnValue=''});

  ensureStyle();ensureAuthDialog();
  window.KPTUPublicPageEditor={setPage,open,cancel:cancelEdit,save,finish:finishEditing,retry:retrySave,logout:logoutEditor};
})();