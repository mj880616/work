(()=>{
  'use strict';
  if(window.__PRIVATE_RAIL_QUESTION_TOOLS__)return;
  window.__PRIVATE_RAIL_QUESTION_TOOLS__=true;

  const API='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/pc0921-board?board=private_rail';
  const KEY='page_edit_question_0912_live';
  const BASE_TITLE='[2026 국정감사 대응] 철도안전관리체계 실질화 및 민자철도 운영기준에 최저 인력기준 반영';
  const state={editing:false,password:'',snapshot:'',loaded:false,loading:false};
  const main=()=>document.querySelector('main.wrap');

  function setHeadTitle(title){
    const next=String(title||'').trim()||BASE_TITLE;
    document.title=next;
    const og=document.querySelector('meta[property="og:title"]');if(og)og.setAttribute('content',next);
    const h1=document.querySelector('.hero h1');if(h1&&(!state.loaded||!h1.textContent.trim()))h1.textContent=next;
  }

  function syncHeadFromPage(){
    const h1=document.querySelector('.hero h1');
    const title=h1?.textContent?.trim()||BASE_TITLE;
    document.title=title;
    const og=document.querySelector('meta[property="og:title"]');if(og)og.setAttribute('content',title);
  }

  function installStyle(){
    if(document.getElementById('privateRailQuestionToolsStyle'))return;
    const s=document.createElement('style');s.id='privateRailQuestionToolsStyle';
    s.textContent=`
      .private-rail-printbar{display:flex!important;justify-content:flex-end!important;align-items:center!important;gap:7px!important;flex-wrap:wrap!important;margin:12px 0 -4px!important}
      .private-rail-printbtn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;min-height:34px}
      .private-rail-question-back,.private-rail-question-edit,.private-rail-question-cancel{background:#fff!important;color:#294b69!important;border-color:#c7d3dd!important;box-shadow:none!important}
      .private-rail-question-cancel{display:none!important}
      .private-rail-question-editing .private-rail-question-cancel{display:inline-flex!important}
      .private-rail-question-editing main.wrap{outline:2px solid rgba(49,95,136,.22);outline-offset:8px;border-radius:20px}
      .private-rail-question-editing main.wrap [contenteditable="true"]{caret-color:#17324d}
      .private-rail-question-editing main.wrap .kptu-copy-wrap{display:none!important}
      .private-rail-question-status{font-size:11px;color:#66717d;margin-right:auto}
      @media(max-width:760px){.private-rail-printbar{justify-content:flex-start!important}.private-rail-question-status{width:100%;order:9;margin-top:2px}}
      @media print{#privateRailPrintBar{display:none!important}}
    `;
    document.head.append(s);
  }

  function cleanDocumentHtml(){
    const root=main();if(!root)return '';
    const clone=root.cloneNode(true);
    clone.querySelectorAll('#privateRailPrintBar,.kptu-copy-wrap,.kptu-copy-btn,script,style').forEach(x=>x.remove());
    clone.removeAttribute('contenteditable');clone.removeAttribute('spellcheck');
    clone.querySelectorAll('[contenteditable]').forEach(x=>x.removeAttribute('contenteditable'));
    clone.querySelectorAll('[spellcheck]').forEach(x=>x.removeAttribute('spellcheck'));
    clone.querySelectorAll('details').forEach(x=>x.removeAttribute('open'));
    return clone.innerHTML.trim();
  }

  function status(text,error=false){
    const el=document.getElementById('privateRailQuestionStatus');if(!el)return;
    el.textContent=text||'';el.style.color=error?'#a33b32':'#66717d';
  }

  function installTools(){
    const hero=document.querySelector('.hero');if(!hero)return;
    document.getElementById('privateRailPrintBar')?.remove();
    const bar=document.createElement('div');bar.id='privateRailPrintBar';bar.className='private-rail-printbar';bar.contentEditable='false';
    const stat=document.createElement('span');stat.id='privateRailQuestionStatus';stat.className='private-rail-question-status';stat.textContent='';
    const back=document.createElement('a');back.className='private-rail-printbtn private-rail-question-back';back.href='/work/private-rail/';back.textContent='← 사업현황';
    const edit=document.createElement('button');edit.type='button';edit.id='privateRailQuestionEdit';edit.className='private-rail-printbtn private-rail-question-edit';edit.textContent=state.editing?'저장':'수정';edit.addEventListener('click',toggleEdit);
    const cancel=document.createElement('button');cancel.type='button';cancel.id='privateRailQuestionCancel';cancel.className='private-rail-printbtn private-rail-question-cancel';cancel.textContent='취소';cancel.addEventListener('click',cancelEdit);
    const print=document.createElement('button');print.type='button';print.className='private-rail-printbtn';print.textContent='인쇄';print.addEventListener('click',()=>window.print());
    bar.append(stat,back,edit,cancel,print);hero.after(bar);
    if(state.editing){bar.classList.add('editing');status('수정 중 · 화면의 문구를 직접 수정한 뒤 저장');}
  }

  function setEditing(on){
    const root=main();if(!root)return;
    state.editing=on;document.body.classList.toggle('private-rail-question-editing',on);
    if(on){
      root.contentEditable='true';root.spellcheck=true;
      root.querySelectorAll('details').forEach(x=>x.open=true);
    }else{
      root.removeAttribute('contenteditable');root.removeAttribute('spellcheck');
    }
    installTools();
    if(on){const h1=document.querySelector('.hero h1');h1?.focus();}
  }

  async function post(value,password){
    const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item_key:KEY,value,master_password:password})});
    let d=null;try{d=await r.json()}catch{}
    if(!r.ok){if(r.status===403||d?.error==='password')throw new Error('마스터 비밀번호가 올바르지 않습니다.');throw new Error(d?.error||'저장하지 못했습니다.');}
    return true;
  }

  async function toggleEdit(){
    const btn=document.getElementById('privateRailQuestionEdit');if(!btn)return;
    if(!state.editing){
      const pw=prompt('마스터 비밀번호를 입력하세요.');if(pw===null)return;
      const password=pw.trim();const current=cleanDocumentHtml();
      btn.disabled=true;btn.textContent='확인 중…';
      try{
        await post(current,password);
        state.password=password;state.snapshot=current;setEditing(true);
      }catch(e){alert(e?.message||'수정 모드를 열지 못했습니다.');installTools();}
      finally{const b=document.getElementById('privateRailQuestionEdit');if(b)b.disabled=false;}
      return;
    }
    const next=cleanDocumentHtml();
    btn.disabled=true;btn.textContent='저장 중…';status('저장 중…');
    try{
      await post(next,state.password);
      state.snapshot=next;state.password='';state.editing=false;
      const root=main();if(root)root.innerHTML=next;
      document.body.classList.remove('private-rail-question-editing');
      syncHeadFromPage();installTools();window.KPTURichCopy?.enhance?.();
      status('저장됨 · 새로 접속해도 이 내용이 표시됩니다.');
    }catch(e){status(e?.message||'저장하지 못했습니다.',true);alert(e?.message||'저장하지 못했습니다.');const b=document.getElementById('privateRailQuestionEdit');if(b){b.disabled=false;b.textContent='저장';}}
  }

  function cancelEdit(){
    if(!state.editing)return;
    const root=main();if(root&&state.snapshot)root.innerHTML=state.snapshot;
    state.password='';state.editing=false;document.body.classList.remove('private-rail-question-editing');
    syncHeadFromPage();installTools();window.KPTURichCopy?.enhance?.();
  }

  async function loadSaved(){
    if(state.loading||state.editing)return;
    state.loading=true;
    setHeadTitle(BASE_TITLE);
    try{
      const r=await fetch(API,{cache:'no-store'});if(!r.ok)throw new Error('load');
      const rows=await r.json();if(!Array.isArray(rows))throw new Error('load');
      const row=rows.find(x=>x.item_key===KEY);
      if(row&&typeof row.value==='string'&&row.value.trim()){
        const root=main();if(root)root.innerHTML=row.value;
        state.snapshot=row.value.trim();
      }else state.snapshot=cleanDocumentHtml();
    }catch(e){state.snapshot=cleanDocumentHtml();}
    finally{
      state.loaded=true;state.loading=false;syncHeadFromPage();installStyle();installTools();window.KPTURichCopy?.enhance?.();
    }
  }

  document.addEventListener('keydown',e=>{
    if(!state.editing)return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();toggleEdit();}
    else if(e.key==='Escape'){e.preventDefault();cancelEdit();}
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!state.editing)loadSaved();});

  installStyle();
  loadSaved();
})();