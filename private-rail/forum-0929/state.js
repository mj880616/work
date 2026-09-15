(()=>{
'use strict';
const CHECKLIST='private-rail-forum-0929';
const items=[...document.querySelectorAll('.item[data-key]')];
const status=document.querySelector('#stateStatus');
let workspaceId=null;
let ready=false;

function setStatus(message,type=''){
  if(!status)return;
  status.textContent=message;
  status.className='state-status'+(type?' '+type:'');
}
function setEditing(enabled){
  items.forEach(el=>{
    el.querySelector('input[type="checkbox"]').disabled=!enabled;
    el.querySelector('.memo').disabled=!enabled;
  });
  document.querySelector('#checkAllBtn').disabled=!enabled;
  document.querySelector('#resetBtn').disabled=!enabled;
}
function paint(el){el.classList.toggle('done',el.querySelector('input[type="checkbox"]').checked)}
function update(){
  items.forEach(paint);
  const done=items.filter(el=>el.querySelector('input[type="checkbox"]').checked).length,total=items.length,pct=total?Math.round(done*100/total):0;
  document.querySelector('#progressText').textContent=`${done} / ${total} 완료 · ${pct}%`;
  document.querySelector('#progressBar').style.width=pct+'%';
}
function rowFromElement(el){
  return {
    workspace_id:workspaceId,
    checklist:CHECKLIST,
    item_key:el.dataset.key,
    checked:el.querySelector('input[type="checkbox"]').checked,
    memo:el.querySelector('.memo').value.trim(),
    updated_at:new Date().toISOString()
  };
}
async function saveRows(rows){
  if(!ready||!workspaceId)return false;
  setStatus('서버에 저장 중…');
  try{
    await window.KPTURuntime.api('/rest/v1/app_internal_checklist_items?on_conflict=workspace_id,checklist,item_key',{
      method:'POST',
      body:rows,
      prefer:'resolution=merge-duplicates,return=minimal'
    });
    setStatus('서버에 저장됨','ok');
    return true;
  }catch(err){
    setStatus('저장 실패 · '+(err.message||String(err)),'error');
    return false;
  }
}
async function saveItem(el){update();await saveRows([rowFromElement(el)])}
function applyRows(rows){
  const map=new Map((rows||[]).map(row=>[row.item_key,row]));
  items.forEach(el=>{
    const row=map.get(el.dataset.key);
    el.querySelector('input[type="checkbox"]').checked=!!row?.checked;
    el.querySelector('.memo').value=row?.memo||'';
  });
  update();
}
async function init(){
  setEditing(false);
  update();
  const rt=window.KPTURuntime;
  if(!rt?.session||!rt?.api){setStatus('Web2 로그인 상태를 확인할 수 없습니다.','error');return}
  if(!(await rt.session.ensure())){setStatus('상태 저장·편집은 Web2 로그인이 필요합니다.','error');return}
  try{
    const user=await rt.api('/auth/v1/user');
    const memberships=await rt.api(`/rest/v1/app_workspace_members?user_id=eq.${encodeURIComponent(user.id)}&select=workspace_id&limit=1`);
    workspaceId=memberships?.[0]?.workspace_id||null;
    if(!workspaceId){setStatus('이 페이지를 편집할 Workspace 권한이 없습니다.','error');return}
    const rows=await rt.api(`/rest/v1/app_internal_checklist_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&checklist=eq.${encodeURIComponent(CHECKLIST)}&select=item_key,checked,memo,updated_at`);
    applyRows(rows);
    ready=true;
    setEditing(true);
    setStatus('서버에 저장 · 변경사항 자동 반영','ok');
  }catch(err){
    setStatus('서버 상태를 불러오지 못했습니다. · '+(err.message||String(err)),'error');
  }
}

items.forEach(el=>{
  el.querySelector('input[type="checkbox"]').addEventListener('change',()=>saveItem(el));
  el.querySelector('.memo').addEventListener('input',()=>{if(ready)setStatus('저장되지 않은 메모 변경사항 있음')});
  el.querySelector('.memo').addEventListener('change',()=>saveItem(el));
});
document.querySelector('#checkAllBtn').addEventListener('click',async()=>{
  if(!ready)return;
  items.forEach(el=>el.querySelector('input[type="checkbox"]').checked=true);
  update();
  await saveRows(items.map(rowFromElement));
});
document.querySelector('#resetBtn').addEventListener('click',async()=>{
  if(!ready||!confirm('현재 체크와 메모를 모두 초기화할까요?'))return;
  setStatus('서버 상태 초기화 중…');
  try{
    await window.KPTURuntime.api(`/rest/v1/app_internal_checklist_items?workspace_id=eq.${encodeURIComponent(workspaceId)}&checklist=eq.${encodeURIComponent(CHECKLIST)}`,{method:'DELETE'});
    items.forEach(el=>{el.querySelector('input[type="checkbox"]').checked=false;el.querySelector('.memo').value=''});
    update();
    setStatus('서버 상태를 초기화했습니다.','ok');
  }catch(err){setStatus('초기화 실패 · '+(err.message||String(err)),'error')}
});
document.querySelector('#copyBtn').addEventListener('click',async()=>{
  const lines=['9.29 민자철도 토론회 준비·점검',''];
  document.querySelectorAll('.section').forEach(sec=>{
    const h=sec.querySelector('h2')?.textContent;if(!h)return;
    const qs=[...sec.querySelectorAll('.item[data-key]')];if(!qs.length)return;
    lines.push(h);
    qs.forEach(el=>{
      const q=el.querySelector('.q').textContent.trim(),memo=el.querySelector('.memo').value.trim();
      lines.push(`${el.querySelector('input[type="checkbox"]').checked?'[완료]':'[ ]'} ${q}`);
      if(memo)lines.push(`  - ${memo.replace(/\n/g,' / ')}`);
    });
    lines.push('');
  });
  try{
    await navigator.clipboard.writeText(lines.join('\n'));
    const btn=document.querySelector('#copyBtn'),old=btn.textContent;btn.textContent='복사됨';setTimeout(()=>btn.textContent=old,1400);
  }catch{alert('복사하지 못했습니다.')}
});

init();
})();
