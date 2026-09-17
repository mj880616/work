(()=>{
  'use strict';
  if(window.__KPTU_PUBLIC_PAGE_EDITOR__)return;
  window.__KPTU_PUBLIC_PAGE_EDITOR__=true;

  const EDIT_API='/functions/v1/public-page-edit';
  const RUNTIME_SRC='/work/app/runtime-client.js?v=1';
  const btn=()=>document.querySelector('#editPageBtn');
  let current=null;
  let secureMode=false;
  let saving=false;
  let editing=false;
  let canEdit=false;
  let accessCheckSeq=0;
  let runtimePromise=null;

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
      .ppe-live-status{font-size:11px;color:#687681;align-self:center;margin-right:auto}.ppe-live-status.error{color:#a33b45}
      .ppe-live-save{background:#17324d!important;border-color:#17324d!important;color:#fff!important}.ppe-live-save:disabled{opacity:.55;cursor:default}
      @media(max-width:650px){.ppe-editing [data-ppe-editable]{outline-offset:2px}.ppe-live-status{display:none}}
      @media print{.ppe-live-controls{display:none!important}.ppe-editing [data-ppe-editable]{outline:0!important;box-shadow:none!important}}
    `;
    document.head.appendChild(s);
  }

  function ensureTools(){
    const tools=document.querySelector('.print-tools,.tools');
    if(!tools)return null;
    if(!document.querySelector('#ppeLiveStatus')){
      const status=document.createElement('span');
      status.id='ppeLiveStatus';
      status.className='ppe-live-status ppe-live-controls hidden';
      status.textContent='수정 중 · 문구를 직접 클릭해 수정';
      tools.prepend(status);

      const cancel=document.createElement('button');
      cancel.id='ppeLiveCancel';
      cancel.type='button';
      cancel.className='print-btn ppe-live-controls hidden';
      cancel.textContent='취소';
      cancel.addEventListener('click',cancelEdit);

      const saveBtn=document.createElement('button');
      saveBtn.id='ppeLiveSave';
      saveBtn.type='button';
      saveBtn.className='print-btn ppe-live-save ppe-live-controls hidden';
      saveBtn.textContent='저장';
      saveBtn.addEventListener('click',save);
      tools.append(cancel,saveBtn);
    }
    return tools;
  }

  function setStatus(text,error=false){
    const el=document.querySelector('#ppeLiveStatus');
    if(!el)return;
    el.textContent=text||'';
    el.classList.toggle('error',!!error);
  }

  async function runtime(){
    if(window.KPTURuntime?.api&&window.KPTURuntime?.session)return window.KPTURuntime;
    if(!runtimePromise){
      runtimePromise=new Promise((resolve,reject)=>{
        const existing=document.querySelector('script[data-kptu-public-runtime]');
        if(existing){
          existing.addEventListener('load',()=>resolve(window.KPTURuntime),{once:true});
          existing.addEventListener('error',()=>reject(new Error('편집 인증 모듈을 불러오지 못했습니다.')),{once:true});
          return;
        }
        const script=document.createElement('script');
        script.src=RUNTIME_SRC;
        script.async=true;
        script.dataset.kptuPublicRuntime='1';
        script.onload=()=>resolve(window.KPTURuntime);
        script.onerror=()=>reject(new Error('편집 인증 모듈을 불러오지 못했습니다.'));
        document.head.appendChild(script);
      }).catch(error=>{
        runtimePromise=null;
        throw error;
      });
    }
    await runtimePromise;
    if(!window.KPTURuntime?.api||!window.KPTURuntime?.session){
      throw new Error('편집 인증 모듈을 초기화하지 못했습니다. 새로고침 후 다시 시도해 주세요.');
    }
    return window.KPTURuntime;
  }

  async function checkAccess(pageId=current?.id){
    const rt=await runtime();
    if(!(await rt.session.ensure()))throw new Error('Web2에서 로그인한 뒤 다시 시도해 주세요.');
    return rt.api(EDIT_API,{method:'POST',body:{action:'check',id:pageId}});
  }

  async function refreshEditAvailability(pageId,seq){
    try{
      await checkAccess(pageId);
      if(seq!==accessCheckSeq||secureMode||editing||current?.id!==pageId)return;
      canEdit=true;
      btn()?.classList.remove('hidden');
    }catch{
      if(seq!==accessCheckSeq||current?.id!==pageId)return;
      canEdit=false;
      btn()?.classList.add('hidden');
    }
  }

  async function updatePage(next){
    const rt=await runtime();
    if(!(await rt.session.ensure()))throw new Error('로그인 세션이 만료되었습니다. Web2에서 다시 로그인해 주세요.');
    return rt.api(EDIT_API,{method:'POST',body:{action:'update',id:current?.id,...next}});
  }

  function cleanText(el){
    return String(el?.innerText??el?.textContent??'').replace(/\u00a0/g,' ').replace(/\r/g,'').trim();
  }

  function encodeFlow(v){return String(v||'').replace(/\r/g,'').replace(/\n/g,'\\n').trim()}

  function markEditable(el){
    if(!el)return;
    el.contentEditable='true';
    el.spellcheck=true;
    el.dataset.ppeEditable='1';
  }

  function prepareFlow(flow){
    flow.querySelectorAll('.pd-flow-node,.pd-flow-solution,.pd-flow-goal,.pd-flow-note').forEach(markEditable);
    flow.querySelectorAll('.pd-flow-problem').forEach(problem=>{
      const note=problem.querySelector(':scope > .pd-flow-note');
      if(!note){markEditable(problem);return}
      let field=problem.querySelector(':scope > [data-ppe-flow-problem]');
      if(!field){
        field=document.createElement('span');
        field.dataset.ppeFlowProblem='1';
        [...problem.childNodes].filter(n=>n!==note).forEach(n=>field.appendChild(n));
        problem.insertBefore(field,note);
      }
      markEditable(field);
      markEditable(note);
    });
  }

  function prepareLiveFields(){
    const paper=document.querySelector('#paper');
    if(!paper)return false;
    const title=paper.querySelector('.pd-title');
    let summary=paper.querySelector('.pd-summary');
    const hero=paper.querySelector('.pd-hero');
    if(!summary&&hero){
      summary=document.createElement('p');
      summary.className='pd-summary ppe-empty-summary';
      hero.appendChild(summary);
    }
    markEditable(title);
    markEditable(summary);

    paper.querySelectorAll('.pd-body p,.pd-body h2,.pd-body h3,.pd-body h4,.pd-body blockquote,.pd-details summary').forEach(markEditable);
    paper.querySelectorAll('.pd-body ul:not(.pd-checklist) > li,.pd-body ol > li').forEach(markEditable);
    paper.querySelectorAll('.pd-body .pd-checklist > li').forEach(li=>markEditable(li.querySelector(':scope > span:last-child')||li));
    paper.querySelectorAll('.pd-forum-flow').forEach(prepareFlow);
    return true;
  }

  function inlineNode(node){
    if(node.nodeType===Node.TEXT_NODE)return String(node.nodeValue||'').replace(/\u00a0/g,' ');
    if(node.nodeType!==Node.ELEMENT_NODE)return '';
    const el=node,tag=el.tagName;
    if(tag==='BR')return '\n';
    const inner=[...el.childNodes].map(inlineNode).join('');
    if(tag==='STRONG'||tag==='B')return '**'+inner+'**';
    if(tag==='EM'||tag==='I')return '*'+inner+'*';
    return inner;
  }

  function inlineText(el){return [...(el?.childNodes||[])].map(inlineNode).join('').replace(/[ \t]+\n/g,'\n').trim()}

  function serializeFlow(flow){
    const top=[...flow.querySelectorAll('.pd-flow-top .pd-flow-node')].map(cleanText).filter(Boolean);
    const tracks=[...flow.querySelectorAll('.pd-flow-track')];
    const readTrack=track=>{
      const problem=track?.querySelector('.pd-flow-problem');
      const field=problem?.querySelector(':scope > [data-ppe-flow-problem]');
      return {
        problem:cleanText(field||problem),
        note:cleanText(problem?.querySelector(':scope > .pd-flow-note')),
        solution:cleanText(track?.querySelector('.pd-flow-solution'))
      };
    };
    const left=readTrack(tracks[0]),right=readTrack(tracks[1]);
    return [':::forum-flow',
      `top: ${top.map(encodeFlow).join(' | ')}`,
      `left_problem: ${encodeFlow(left.problem)}`,
      `left_note: ${encodeFlow(left.note)}`,
      `left_solution: ${encodeFlow(left.solution)}`,
      `right_problem: ${encodeFlow(right.problem)}`,
      `right_note: ${encodeFlow(right.note)}`,
      `right_solution: ${encodeFlow(right.solution)}`,
      `goal: ${encodeFlow(cleanText(flow.querySelector('.pd-flow-goal')))}`,
      ':::'
    ].join('\n');
  }

  function serializeList(el){
    const ordered=el.tagName==='OL';
    const checklist=el.classList.contains('pd-checklist');
    return [...el.children].filter(x=>x.tagName==='LI').map((li,i)=>{
      if(checklist){
        const done=li.classList.contains('pd-check-done');
        const textEl=li.querySelector(':scope > span:last-child')||li;
        return `- [${done?'x':' '}] ${inlineText(textEl)}`;
      }
      return `${ordered?(i+1)+'.':'-'} ${inlineText(li)}`;
    }).join('\n');
  }

  function serializeChildren(parent,inSection=false){
    const out=[];
    [...parent.children].forEach(el=>{
      const value=serializeBlock(el,inSection);
      if(value&&value.trim())out.push(value.trim());
    });
    return out.join('\n\n');
  }

  function serializeBlock(el,inSection=false){
    if(!el)return '';
    if(el.classList.contains('pd-forum-flow'))return serializeFlow(el);
    if(el.classList.contains('pd-section')){
      const children=[...el.children],parts=[];
      children.forEach((child,i)=>{
        if(i===0&&child.tagName==='H2')parts.push('## '+inlineText(child));
        else{const v=serializeBlock(child,true);if(v)parts.push(v)}
      });
      return parts.join('\n\n');
    }
    if(el.tagName==='DETAILS'){
      const summary=inlineText(el.querySelector(':scope > summary'));
      const body=el.querySelector(':scope > .pd-details-body');
      return `:::details ${summary}\n${body?serializeChildren(body,inSection):''}\n:::`;
    }
    if(el.tagName==='H2')return `${inSection?'##':'#'} ${inlineText(el)}`;
    if(el.tagName==='H3')return `### ${inlineText(el)}`;
    if(el.tagName==='H4')return `#### ${inlineText(el)}`;
    if(el.tagName==='P')return inlineText(el);
    if(el.tagName==='UL'||el.tagName==='OL')return serializeList(el);
    if(el.tagName==='BLOCKQUOTE')return '> '+inlineText(el).replace(/\n/g,'\n> ');
    return serializeChildren(el,inSection);
  }

  function collectLivePage(){
    const paper=document.querySelector('#paper');
    const title=cleanText(paper?.querySelector('.pd-title'));
    const summary=cleanText(paper?.querySelector('.pd-summary'));
    const bodyEl=paper?.querySelector('.pd-body');
    const body=bodyEl?serializeChildren(bodyEl,false):'';
    return {title,summary,body};
  }

  function setEditingUi(on){
    editing=on;
    document.body.classList.toggle('ppe-editing',on);
    const edit=btn(),print=document.querySelector('#printPageBtn');
    const saveBtn=document.querySelector('#ppeLiveSave'),cancel=document.querySelector('#ppeLiveCancel'),status=document.querySelector('#ppeLiveStatus');
    edit?.classList.toggle('hidden',on||secureMode||!current?.id||!canEdit);
    print?.classList.toggle('hidden',on);
    [saveBtn,cancel,status].forEach(x=>x?.classList.toggle('hidden',!on));
    if(on)setStatus('수정 중 · 바꾸고 싶은 문구를 화면에서 직접 클릭');
  }

  async function open(){
    if(secureMode||!current?.id||editing||!canEdit)return;
    try{
      await checkAccess(current.id);
      canEdit=true;
      ensureTools();
      setEditingUi(true);
      if(!prepareLiveFields())throw new Error('편집할 내용을 찾지 못했습니다.');
      document.querySelector('#paper .pd-title')?.focus();
    }catch(e){
      canEdit=false;
      setEditingUi(false);
      alert(e?.message||'수정 권한을 확인하지 못했습니다.');
    }
  }

  function cancelEdit(){
    if(saving||!editing)return;
    editing=false;
    document.body.classList.remove('ppe-editing');
    if(typeof window.KPTURenderPublicPage==='function')window.KPTURenderPublicPage(current,false);
    setEditingUi(false);
  }

  async function save(){
    if(saving||!editing||!current?.id)return;
    const next=collectLivePage();
    if(!next.title){setStatus('제목은 비워둘 수 없습니다.',true);return}
    const saveBtn=document.querySelector('#ppeLiveSave');
    saving=true;
    if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='저장 중…'}
    setStatus('저장 중…');
    try{
      const d=await updatePage(next);
      if(!d?.page)throw new Error(d?.error||'저장 결과를 확인하지 못했습니다.');
      current={...current,...d.page};
      editing=false;
      document.body.classList.remove('ppe-editing');
      if(typeof window.KPTURenderPublicPage==='function')window.KPTURenderPublicPage(current,false);
      setEditingUi(false);
    }catch(e){
      setStatus(e?.message||'저장에 실패했습니다. 수정 내용은 화면에 유지됩니다.',true);
    }finally{
      saving=false;
      if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='저장'}
    }
  }

  function setPage(page,secure=false){
    current=page||null;
    secureMode=!!secure;
    canEdit=false;
    const seq=++accessCheckSeq;
    ensureTools();
    const b=btn();
    if(!b)return;
    b.onclick=null;
    b.classList.add('hidden');
    if(secureMode||!current?.id)return;
    const pageId=current.id;
    b.onclick=e=>{e.preventDefault();open()};
    void refreshEditAvailability(pageId,seq);
  }

  document.addEventListener('keydown',e=>{
    if(!editing)return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save();return}
    if(e.key==='Escape'){e.preventDefault();cancelEdit()}
  });

  ensureStyle();
  window.KPTUPublicPageEditor={setPage,open,cancel:cancelEdit,save};
})();
