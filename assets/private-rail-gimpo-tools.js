(()=>{
  'use strict';
  if(window.__PRIVATE_RAIL_GIMPO_TOOLS__)return;
  window.__PRIVATE_RAIL_GIMPO_TOOLS__=true;

  const API='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/pc0921-board?board=private_rail';
  const KEY='page_edit_gimpo_public_live';
  const state={editing:false,password:'',snapshot:'',loading:false,loaded:false};
  const root=()=>document.getElementById('gimpoContent');
  const editBtn=()=>document.getElementById('gimpoEdit');
  const cancelBtn=()=>document.getElementById('gimpoCancel');

  function setStatus(text,error=false){
    const el=document.getElementById('gimpoStatus');
    if(!el)return;
    el.textContent=text||'';
    el.classList.toggle('error',!!error);
  }

  function cleanHtml(){
    const el=root();if(!el)return '';
    const clone=el.cloneNode(true);
    clone.removeAttribute('contenteditable');clone.removeAttribute('spellcheck');
    clone.querySelectorAll('.kptu-copy-wrap,.kptu-copy-btn,script,style').forEach(x=>x.remove());
    clone.querySelectorAll('[contenteditable]').forEach(x=>x.removeAttribute('contenteditable'));
    clone.querySelectorAll('[spellcheck]').forEach(x=>x.removeAttribute('spellcheck'));
    return clone.innerHTML.trim();
  }

  function syncHead(){
    const title=root()?.querySelector('h1')?.textContent?.trim()||'김포 공영화 투쟁';
    document.title=`${title} | 민자철도 사업 현황`;
    document.querySelector('meta[property="og:title"]')?.setAttribute('content',title);
  }

  async function post(value,password){
    const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item_key:KEY,value,master_password:password})});
    let d=null;try{d=await r.json()}catch{}
    if(!r.ok){
      if(r.status===403||d?.error==='password')throw new Error('마스터 비밀번호가 올바르지 않습니다.');
      throw new Error(d?.error||'저장하지 못했습니다.');
    }
  }

  function setEditing(on){
    const el=root();if(!el)return;
    state.editing=on;
    document.body.classList.toggle('editing',on);
    if(on){el.contentEditable='true';el.spellcheck=true;}
    else{el.removeAttribute('contenteditable');el.removeAttribute('spellcheck');}
    const edit=editBtn();if(edit)edit.textContent=on?'저장':'수정';
    if(cancelBtn())cancelBtn().style.display=on?'inline-flex':'';
    if(on){setStatus('수정 중 · 문구를 직접 수정한 뒤 저장');el.querySelector('h1')?.focus();}
  }

  async function toggleEdit(){
    const btn=editBtn();if(!btn)return;
    if(!state.editing){
      const pw=prompt('마스터 비밀번호를 입력하세요.');if(pw===null)return;
      const password=pw.trim();
      btn.disabled=true;btn.textContent='확인 중…';setStatus('수정 권한 확인 중…');
      try{
        const current=cleanHtml();
        await post(current,password);
        state.password=password;state.snapshot=current;setEditing(true);
      }catch(e){setStatus(e?.message||'수정 모드를 열지 못했습니다.',true);alert(e?.message||'수정 모드를 열지 못했습니다.');}
      finally{const b=editBtn();if(b)b.disabled=false;if(!state.editing&&b)b.textContent='수정';}
      return;
    }

    const next=cleanHtml();
    btn.disabled=true;btn.textContent='저장 중…';setStatus('저장 중…');
    try{
      await post(next,state.password);
      const el=root();if(el)el.innerHTML=next;
      state.snapshot=next;state.password='';setEditing(false);syncHead();
      window.KPTURichCopy?.enhance?.();
      setStatus('저장됨 · 새로 접속해도 이 내용이 표시됩니다.');
    }catch(e){setStatus(e?.message||'저장하지 못했습니다.',true);alert(e?.message||'저장하지 못했습니다.');btn.textContent='저장';}
    finally{const b=editBtn();if(b)b.disabled=false;}
  }

  function cancelEdit(){
    if(!state.editing)return;
    const el=root();if(el&&state.snapshot)el.innerHTML=state.snapshot;
    state.password='';setEditing(false);syncHead();window.KPTURichCopy?.enhance?.();setStatus('수정을 취소했습니다.');
  }

  async function loadSaved(){
    if(state.loading||state.editing)return;
    state.loading=true;setStatus('최신 저장본 확인 중…');
    try{
      const r=await fetch(API,{cache:'no-store'});if(!r.ok)throw new Error('load');
      const rows=await r.json();if(!Array.isArray(rows))throw new Error('load');
      const row=rows.find(x=>x.item_key===KEY);
      if(row&&typeof row.value==='string'&&row.value.trim()){
        const el=root();if(el)el.innerHTML=row.value;
        state.snapshot=row.value.trim();
        setStatus('서버 저장본 표시 중');
      }else{
        state.snapshot=cleanHtml();setStatus('기본 원고 표시 중');
      }
    }catch(e){state.snapshot=cleanHtml();setStatus('기본 원고 표시 중');}
    finally{state.loading=false;state.loaded=true;syncHead();window.KPTURichCopy?.enhance?.();}
  }

  editBtn()?.addEventListener('click',toggleEdit);
  cancelBtn()?.addEventListener('click',cancelEdit);
  document.getElementById('gimpoPrint')?.addEventListener('click',()=>window.print());
  document.addEventListener('keydown',e=>{
    if(!state.editing)return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();toggleEdit();}
    else if(e.key==='Escape'){e.preventDefault();cancelEdit();}
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!state.editing)loadSaved();});
  loadSaved();
})();
