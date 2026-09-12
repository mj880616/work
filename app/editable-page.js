(()=>{
  const pathKey=location.pathname
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .slice(0,170);

  const isQuestion0912=location.pathname.includes('/private-rail/question-0912/');
  const oldQuestionTitle='민자철도 안전인력 기준 및 철도안전관리체계 실효성';
  const newQuestionTitle='국토교통부 장관 인사청문회 구두 질의 요청';
  const ensureQuestionTitle=()=>{
    if(!isQuestion0912)return;
    document.title=newQuestionTitle;
    const el=document.querySelector('[data-edit="title"]');
    if(el&&el.textContent.trim()===oldQuestionTitle)el.textContent=newQuestionTitle;
  };
  ensureQuestionTitle();
  if(isQuestion0912){
    const titleEl=document.querySelector('[data-edit="title"]');
    if(titleEl)new MutationObserver(ensureQuestionTitle).observe(titleEl,{childList:true,subtree:true,characterData:true});
  }

  const cfg={
    api:'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/pc0921-board?board=private_rail',
    itemKey:'page_edit_'+pathKey,
    editSelector:'[data-edit]',
    deleteSelector:isQuestion0912?'.summary,.priority>.card,.card .q,main>.section':'',
    toggleId:'editToggle',saveId:'editSave',cancelId:'editCancel',statusId:'editStatus',
    ...(window.EDITABLE_PAGE_CONFIG||{})
  };

  const els=[...document.querySelectorAll(cfg.editSelector)];
  const toggle=document.getElementById(cfg.toggleId),save=document.getElementById(cfg.saveId),cancel=document.getElementById(cfg.cancelId),status=document.getElementById(cfg.statusId);
  if(!els.length||!toggle||!save||!cancel) return;

  const deletables=cfg.deleteSelector?[...document.querySelectorAll(cfg.deleteSelector)]:[];
  const localKey='editable-page-backup:'+cfg.itemKey;
  let editing=false,snapshot={},snapshotDeleted=[];

  const setStatus=(t)=>{if(status)status.textContent=t};
  const collect=()=>Object.fromEntries(els.map(el=>[el.dataset.edit,el.innerHTML]));
  const apply=(fields)=>{if(!fields||typeof fields!=='object')return;els.forEach(el=>{if(Object.prototype.hasOwnProperty.call(fields,el.dataset.edit))el.innerHTML=fields[el.dataset.edit]});ensureQuestionTitle()};

  const usedDeleteKeys=new Set();
  deletables.forEach((el,i)=>{
    let base=el.dataset.deleteKey||el.dataset.edit||el.querySelector('[data-edit]')?.dataset.edit||('block_'+i);
    let key=base,n=2;
    while(usedDeleteKeys.has(key))key=base+'_'+n++;
    usedDeleteKeys.add(key);
    el.dataset.deleteKey=key;
  });

  const collectDeleted=()=>deletables.filter(el=>el.classList.contains('deleted-block')).map(el=>el.dataset.deleteKey);
  const applyDeleted=(keys)=>{
    const set=new Set(Array.isArray(keys)?keys:[]);
    deletables.forEach(el=>el.classList.toggle('deleted-block',set.has(el.dataset.deleteKey)));
  };

  const style=document.createElement('style');
  style.textContent=`
    [data-delete-key]{position:relative}
    .block-delete-btn{display:none;position:absolute;top:8px;right:8px;width:28px;height:28px;border:0;border-radius:999px;background:#fff;color:#9b2c2c;box-shadow:0 2px 9px rgba(0,0,0,.14);font-size:20px;line-height:1;align-items:center;justify-content:center;cursor:pointer;z-index:50}
    .editing .block-delete-btn{display:flex}
    .block-delete-btn:hover{background:#fff0f0}
    .deleted-block{display:none!important}
  `;
  document.head.appendChild(style);

  deletables.forEach(el=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='block-delete-btn';
    btn.setAttribute('aria-label','이 칸 삭제');
    btn.title='이 칸 삭제';
    btn.textContent='×';
    btn.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();
      el.classList.add('deleted-block');
      setStatus('칸 삭제됨 · 페이지 수정 완료를 누르면 저장');
    });
    el.appendChild(btn);
  });

  if(deletables.length){
    toggle.textContent='페이지 수정';
    save.textContent='페이지 수정 완료';
  }

  const backup=(fields,deleted,savedAt,serverSaved=false)=>{try{localStorage.setItem(localKey,JSON.stringify({fields,deleted,savedAt,serverSaved}))}catch{}};
  const readBackup=()=>{try{return JSON.parse(localStorage.getItem(localKey)||'null')}catch{return null}};
  const sameFields=(a,b)=>{
    if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
    const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
    if(ak.length!==bk.length)return false;
    for(let i=0;i<ak.length;i++){
      if(ak[i]!==bk[i])return false;
      if(String(a[ak[i]])!==String(b[bk[i]]))return false;
    }
    return true;
  };
  const sameDeleted=(a,b)=>{
    const aa=[...(Array.isArray(a)?a:[])].sort(),bb=[...(Array.isArray(b)?b:[])].sort();
    return aa.length===bb.length&&aa.every((v,i)=>v===bb[i]);
  };

  const enter=()=>{
    snapshot=collect();
    snapshotDeleted=collectDeleted();
    editing=true;
    document.body.classList.add('editing');
    els.forEach(el=>el.contentEditable='true');
    toggle.hidden=true;save.hidden=false;cancel.hidden=false;
    setStatus('수정 중');
  };

  const exit=(restore=false)=>{
    if(restore){apply(snapshot);applyDeleted(snapshotDeleted)}
    editing=false;
    document.body.classList.remove('editing');
    els.forEach(el=>el.removeAttribute('contenteditable'));
    toggle.hidden=false;save.hidden=true;cancel.hidden=true;
    setStatus('읽기 모드');
  };

  const errorText=(body,statusCode)=>{
    const code=body&&body.error;
    if(code==='password')return '비밀번호가 올바르지 않습니다.';
    if(code==='key')return '페이지 저장키가 서버 규칙과 맞지 않습니다.';
    if(code==='value')return '수정 내용이 저장 허용 크기를 넘었습니다.';
    if(code)return String(code);
    return '서버 응답 '+statusCode;
  };

  async function load(){
    let server=null;
    try{
      const r=await fetch(cfg.api,{cache:'no-store'});
      if(!r.ok)throw new Error('GET '+r.status);
      const rows=await r.json();
      const row=Array.isArray(rows)?rows.find(x=>x&&x.item_key===cfg.itemKey):null;
      if(row&&row.value&&typeof row.value==='object')server=row.value;
    }catch(e){console.warn('editable load failed',e)}
    const local=readBackup();
    const sTime=server?.savedAt||''; const lTime=local?.savedAt||'';
    if(local&&local.fields&&(!server||lTime>sTime)){
      apply(local.fields);applyDeleted(local.deleted||[]);
      setStatus(local.serverSaved?'저장본 불러옴':'임시백업 불러옴');
    }else if(server?.fields){
      apply(server.fields);applyDeleted(server.deleted||[]);
      backup(server.fields,server.deleted||[],server.savedAt||new Date().toISOString(),true);
      setStatus('저장본 불러옴');
    }
    ensureQuestionTitle();
  }

  async function persist(){
    const pw=prompt('마스터 비밀번호를 입력하세요.');
    if(pw===null)return;
    ensureQuestionTitle();
    const fields=collect(),deleted=collectDeleted(),savedAt=new Date().toISOString();
    backup(fields,deleted,savedAt,false);
    save.disabled=true;setStatus('저장 중…');
    try{
      const r=await fetch(cfg.api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item_key:cfg.itemKey,value:{fields,deleted,savedAt},master_password:pw.trim()})});
      let body=null;try{body=await r.json()}catch{}
      if(!r.ok)throw new Error(errorText(body,r.status));
      const vr=await fetch(cfg.api,{cache:'no-store'});
      if(!vr.ok)throw new Error('저장 확인 실패');
      const rows=await vr.json();
      const row=Array.isArray(rows)?rows.find(x=>x&&x.item_key===cfg.itemKey):null;
      if(!row?.value?.fields)throw new Error('저장 확인 데이터 없음');
      if(!sameFields(fields,row.value.fields)||!sameDeleted(deleted,row.value.deleted||[]))throw new Error('저장 확인 불일치');
      backup(row.value.fields,row.value.deleted||[],row.value.savedAt||savedAt,true);
      exit(false);setStatus('저장 완료');
      setTimeout(()=>{if(!editing)setStatus('읽기 모드')},1400);
    }catch(e){
      console.error(e);setStatus('서버 저장 실패 · 임시백업 보관');
      alert('서버 저장에 실패했습니다.\n수정 내용은 이 브라우저에 임시백업해 두었습니다.\n\n'+(e?.message||''));
    }finally{save.disabled=false}
  }

  toggle.addEventListener('click',enter);
  cancel.addEventListener('click',()=>exit(true));
  save.addEventListener('click',persist);
  window.addEventListener('beforeunload',()=>{if(editing)backup(collect(),collectDeleted(),new Date().toISOString(),false)});
  load();
})();