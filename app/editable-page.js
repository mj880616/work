(()=>{
  const pathKey=location.pathname
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .slice(0,170);
  const cfg={
    api:'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/pc0921-board?board=private_rail',
    itemKey:'page_edit_'+pathKey,
    editSelector:'[data-edit]',
    toggleId:'editToggle',saveId:'editSave',cancelId:'editCancel',statusId:'editStatus',
    ...(window.EDITABLE_PAGE_CONFIG||{})
  };
  const els=[...document.querySelectorAll(cfg.editSelector)];
  const toggle=document.getElementById(cfg.toggleId),save=document.getElementById(cfg.saveId),cancel=document.getElementById(cfg.cancelId),status=document.getElementById(cfg.statusId);
  if(!els.length||!toggle||!save||!cancel) return;
  const localKey='editable-page-backup:'+cfg.itemKey;
  let editing=false,snapshot={};
  const setStatus=(t)=>{if(status)status.textContent=t};
  const collect=()=>Object.fromEntries(els.map(el=>[el.dataset.edit,el.innerHTML]));
  const apply=(fields)=>{if(!fields||typeof fields!=='object')return;els.forEach(el=>{if(Object.prototype.hasOwnProperty.call(fields,el.dataset.edit))el.innerHTML=fields[el.dataset.edit]})};
  const backup=(fields,savedAt,serverSaved=false)=>{try{localStorage.setItem(localKey,JSON.stringify({fields,savedAt,serverSaved}))}catch{}};
  const readBackup=()=>{try{return JSON.parse(localStorage.getItem(localKey)||'null')}catch{return null}};
  const enter=()=>{snapshot=collect();editing=true;document.body.classList.add('editing');els.forEach(el=>el.contentEditable='true');toggle.hidden=true;save.hidden=false;cancel.hidden=false;setStatus('수정 중')};
  const exit=(restore=false)=>{if(restore)apply(snapshot);editing=false;document.body.classList.remove('editing');els.forEach(el=>el.removeAttribute('contenteditable'));toggle.hidden=false;save.hidden=true;cancel.hidden=true;setStatus('읽기 모드')};
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
    if(local&&local.fields&&(!server||lTime>sTime)){apply(local.fields);setStatus(local.serverSaved?'저장본 불러옴':'임시백업 불러옴')}
    else if(server?.fields){apply(server.fields);backup(server.fields,server.savedAt||new Date().toISOString(),true);setStatus('저장본 불러옴')}
  }
  async function persist(){
    const pw=prompt('마스터 비밀번호를 입력하세요.');
    if(pw===null)return;
    const fields=collect(),savedAt=new Date().toISOString();
    backup(fields,savedAt,false);
    save.disabled=true;setStatus('저장 중…');
    try{
      const r=await fetch(cfg.api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item_key:cfg.itemKey,value:{fields,savedAt},master_password:pw.trim()})});
      let body=null;try{body=await r.json()}catch{}
      if(!r.ok)throw new Error(errorText(body,r.status));
      const vr=await fetch(cfg.api,{cache:'no-store'});
      if(!vr.ok)throw new Error('저장 확인 실패');
      const rows=await vr.json();
      const row=Array.isArray(rows)?rows.find(x=>x&&x.item_key===cfg.itemKey):null;
      if(!row?.value?.fields)throw new Error('저장 확인 데이터 없음');
      const expected=JSON.stringify(fields),actual=JSON.stringify(row.value.fields);
      if(expected!==actual)throw new Error('저장 확인 불일치');
      backup(fields,row.value.savedAt||savedAt,true);
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
  window.addEventListener('beforeunload',()=>{if(editing)backup(collect(),new Date().toISOString(),false)});
  load();
})();
