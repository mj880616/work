(()=>{
  'use strict';
  if(window.__KPTU_PUBLIC_PAGE_EDITOR__)return;
  window.__KPTU_PUBLIC_PAGE_EDITOR__=true;

  const EDIT_API='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/public-page-edit';
  const btn=()=>document.querySelector('#editPageBtn');
  let current=null;
  let secureMode=false;
  let saving=false;
  let editPassword='';

  function ensureStyle(){
    if(document.querySelector('#publicPageEditorStyle'))return;
    const s=document.createElement('style');
    s.id='publicPageEditorStyle';
    s.textContent=`
      .ppe-backdrop{position:fixed;inset:0;background:rgba(20,31,43,.42);display:grid;place-items:center;padding:18px;z-index:9999}
      .ppe-backdrop.hidden{display:none!important}
      .ppe-card{width:min(920px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.2);padding:20px}
      .ppe-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}.ppe-head>div{flex:1}.ppe-head h2{margin:0;font-size:20px}.ppe-head p{margin:4px 0 0;color:#71808d;font-size:12px}
      .ppe-close{border:0;background:#eef2f5;color:#43515d;width:34px;height:34px;border-radius:10px;font-size:20px;cursor:pointer}
      .ppe-form{display:grid;gap:12px}.ppe-form label{display:grid;gap:6px;font-size:12px;font-weight:800;color:#44525f}
      .ppe-form input,.ppe-form textarea{width:100%;border:1px solid #ccd6de;border-radius:10px;padding:10px 11px;font:inherit;color:#18222d;background:#fff;outline:none}
      .ppe-form input:focus,.ppe-form textarea:focus{border-color:#8ca5ba;box-shadow:0 0 0 3px rgba(49,95,149,.1)}
      .ppe-form textarea{min-height:420px;resize:vertical;line-height:1.65;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
      .ppe-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;align-items:center}.ppe-actions button{border-radius:9px;padding:9px 13px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.ppe-cancel{border:1px solid #ccd6de;background:#fff;color:#40505e}.ppe-save{border:1px solid #17324d;background:#17324d;color:#fff}.ppe-save:disabled{opacity:.55;cursor:default}.ppe-status{margin-right:auto;font-size:11px;color:#6d7a86}.ppe-status.error{color:#a33b45}
      @media(max-width:650px){.ppe-backdrop{padding:0;align-items:end}.ppe-card{border-radius:18px 18px 0 0;max-height:96vh;padding:16px}.ppe-form textarea{min-height:52vh}.ppe-actions{position:sticky;bottom:0;background:#fff;padding-top:10px}}
      @media print{.ppe-backdrop{display:none!important}}
    `;
    document.head.appendChild(s);
  }

  function ensureModal(){
    let root=document.querySelector('#publicPageEditor');
    if(root)return root;
    root=document.createElement('div');
    root.id='publicPageEditor';
    root.className='ppe-backdrop hidden';
    root.innerHTML=`<section class="ppe-card" role="dialog" aria-modal="true" aria-labelledby="ppeTitle"><div class="ppe-head"><div><h2 id="ppeTitle">페이지 수정</h2><p>현재 공개페이지를 벗어나지 않고 원문을 수정합니다.</p></div><button class="ppe-close" type="button" data-ppe-close aria-label="닫기">×</button></div><div class="ppe-form"><label>제목<input id="ppePageTitle" type="text"></label><label>요약<textarea id="ppePageSummary" rows="3" style="min-height:88px;font-family:inherit"></textarea></label><label>본문 (Markdown)<textarea id="ppePageBody"></textarea></label></div><div class="ppe-actions"><span id="ppeStatus" class="ppe-status"></span><button class="ppe-cancel" type="button" data-ppe-close>취소</button><button id="ppeSave" class="ppe-save" type="button">저장</button></div></section>`;
    document.body.appendChild(root);
    root.querySelectorAll('[data-ppe-close]').forEach(x=>x.addEventListener('click',close));
    root.addEventListener('click',e=>{if(e.target===root)close()});
    root.querySelector('#ppeSave')?.addEventListener('click',save);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!root.classList.contains('hidden'))close()});
    return root;
  }

  function status(text,error=false){
    const el=document.querySelector('#ppeStatus');
    if(!el)return;
    el.textContent=text||'';
    el.classList.toggle('error',!!error);
  }

  function close(){
    if(saving)return;
    document.querySelector('#publicPageEditor')?.classList.add('hidden');
    document.body.style.overflow='';
  }

  async function verifyPassword(password){
    const r=await fetch(EDIT_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check',id:current?.id,password})});
    let d=null;try{d=await r.json()}catch{}
    if(!r.ok){
      if(d?.error==='password')throw new Error('비밀번호가 올바르지 않습니다.');
      throw new Error(d?.error||'수정 권한 확인에 실패했습니다.');
    }
    return true;
  }

  async function open(){
    if(secureMode||!current?.id)return;
    const pw=prompt('마스터 비밀번호를 입력하세요.');
    if(pw===null)return;
    try{
      await verifyPassword(pw.trim());
      editPassword=pw.trim();
      const root=ensureModal();
      root.querySelector('#ppePageTitle').value=current.title||'';
      root.querySelector('#ppePageSummary').value=current.summary||'';
      root.querySelector('#ppePageBody').value=current.body||'';
      status('');
      root.classList.remove('hidden');
      document.body.style.overflow='hidden';
      root.querySelector('#ppePageTitle')?.focus();
    }catch(e){
      editPassword='';
      alert(e?.message||'수정 화면을 열지 못했습니다.');
    }
  }

  async function save(){
    if(saving||!current?.id||!editPassword)return;
    const title=document.querySelector('#ppePageTitle')?.value.trim()||'';
    if(!title){status('제목을 입력해 주세요.',true);return}
    const summary=document.querySelector('#ppePageSummary')?.value.trim()||'';
    const body=document.querySelector('#ppePageBody')?.value||'';
    const saveBtn=document.querySelector('#ppeSave');
    saving=true;
    if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='저장 중…'}
    status('저장 중…');
    try{
      const r=await fetch(EDIT_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update',id:current.id,password:editPassword,title,summary,body})});
      let d=null;try{d=await r.json()}catch{}
      if(!r.ok||!d?.page){
        if(d?.error==='password')throw new Error('비밀번호가 올바르지 않습니다.');
        throw new Error(d?.error||'저장에 실패했습니다.');
      }
      current={...current,...d.page};
      status('저장 완료');
      document.querySelector('#publicPageEditor')?.classList.add('hidden');
      document.body.style.overflow='';
      editPassword='';
      if(typeof window.KPTURenderPublicPage==='function')window.KPTURenderPublicPage(current,false);
      else location.reload();
    }catch(e){
      status(e?.message||'저장에 실패했습니다.',true);
    }finally{
      saving=false;
      if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='저장'}
    }
  }

  function setPage(page,secure=false){
    current=page||null;
    secureMode=!!secure;
    editPassword='';
    const b=btn();
    if(!b)return;
    b.onclick=null;
    if(secureMode||!current?.id){b.classList.add('hidden');return}
    b.classList.remove('hidden');
    b.onclick=e=>{e.preventDefault();open()};
  }

  ensureStyle();
  window.KPTUPublicPageEditor={setPage,open,close};
})();
