const PUA_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const PUA_KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const PUA_SESSION='kptu_collab_session_v1';
let puaProjectId=null,puaUserId=null,puaRole=null,puaRows=[],puaLoading=false,puaTimer=null;

function puaSession(){try{return JSON.parse(localStorage.getItem(PUA_SESSION)||'null')}catch{return null}}
async function puaApi(path,{method='GET',body=null}={}){
  const s=puaSession();
  if(!s?.access_token)throw new Error('로그인이 필요합니다.');
  const r=await fetch(PUA_SB+path,{method,headers:{apikey:PUA_KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:body===null?null:JSON.stringify(body)});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok)throw new Error(d?.message||d?.error_description||d?.hint||('요청 실패 '+r.status));
  return d;
}
function puaCanEdit(row){return row?.author_id===puaUserId||['owner','admin'].includes(puaRole)}
function puaSchedule(){clearTimeout(puaTimer);puaTimer=setTimeout(puaDecorate,80)}
function puaButtons(id){const wrap=document.createElement('div');wrap.className='pua-actions';wrap.innerHTML=`<button type="button" class="pua-edit" data-pua-edit="${id}">수정</button><button type="button" class="pua-delete" data-pua-delete="${id}">삭제</button>`;return wrap}
async function puaDecorate(){
  const root=document.querySelector('#projectUpdates');
  if(!root||!puaProjectId||puaLoading)return;
  puaLoading=true;
  try{
    puaRows=await puaApi('/rest/v1/app_project_updates?project_id=eq.'+encodeURIComponent(puaProjectId)+'&select=id,author_id,kind,body,created_at&order=created_at.desc');
    const items=[...root.querySelectorAll(':scope > .list-item')];
    items.forEach((item,i)=>{
      const row=puaRows[i];
      item.querySelector('.pua-actions,.pua-editor')?.remove();
      if(!row)return;
      item.dataset.projectUpdateId=row.id;
      if(puaCanEdit(row))item.appendChild(puaButtons(row.id));
    });
  }catch(_){ }
  finally{puaLoading=false}
}
function puaStartEdit(id){
  const row=puaRows.find(x=>x.id===id),item=document.querySelector(`#projectUpdates .list-item[data-project-update-id="${CSS.escape(id)}"]`);
  if(!row||!item||item.querySelector('.pua-editor'))return;
  item.querySelector('.pua-actions')?.remove();
  const body=item.querySelector(':scope > span');
  if(body)body.style.display='none';
  const editor=document.createElement('div');editor.className='pua-editor';
  editor.innerHTML=`<textarea class="pua-body" rows="4"></textarea><div class="pua-edit-row"><select class="pua-kind"><option value="update">진행</option><option value="decision">결정</option><option value="issue">쟁점</option><option value="note">메모</option></select><button type="button" class="pua-cancel">취소</button><button type="button" class="pua-save">저장</button></div><div class="pua-status"></div>`;
  editor.querySelector('.pua-body').value=row.body||'';
  editor.querySelector('.pua-kind').value=row.kind||'update';
  item.appendChild(editor);
  editor.querySelector('.pua-cancel').onclick=()=>{if(body)body.style.display='';editor.remove();item.appendChild(puaButtons(id))};
  editor.querySelector('.pua-save').onclick=async()=>{
    const text=editor.querySelector('.pua-body').value.trim(),kind=editor.querySelector('.pua-kind').value,status=editor.querySelector('.pua-status');
    if(!text){status.textContent='내용을 입력해 주세요.';return}
    const save=editor.querySelector('.pua-save');save.disabled=true;status.textContent='저장 중…';
    try{
      await puaApi('/rest/v1/app_project_updates?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{kind,body:text}});
      row.kind=kind;row.body=text;
      const meta=item.querySelector(':scope > b');if(meta)meta.textContent=kind+' · '+meta.textContent.split('·').slice(1).join('·').trim();
      if(body){body.textContent=text;body.style.display=''}
      editor.remove();item.appendChild(puaButtons(id));
    }catch(e){status.textContent=e.message||String(e)}finally{save.disabled=false}
  };
  editor.querySelector('.pua-body').focus();
}
async function puaDelete(id){
  const row=puaRows.find(x=>x.id===id);if(!row||!puaCanEdit(row))return;
  if(!confirm('이 업데이트를 삭제할까요?'))return;
  const item=document.querySelector(`#projectUpdates .list-item[data-project-update-id="${CSS.escape(id)}"]`);
  const btn=item?.querySelector('[data-pua-delete]');if(btn)btn.disabled=true;
  try{
    await puaApi('/rest/v1/app_project_updates?id=eq.'+encodeURIComponent(id),{method:'DELETE'});
    puaRows=puaRows.filter(x=>x.id!==id);item?.remove();
    const root=document.querySelector('#projectUpdates');
    if(root&&!root.querySelector('.list-item'))root.innerHTML='<div class="empty compact">업데이트가 없습니다.</div>';
  }catch(e){alert(e.message||String(e));if(btn)btn.disabled=false}
}
async function puaInitContext(){
  const s=puaSession();if(!s?.access_token)return;
  const u=await fetch(PUA_SB+'/auth/v1/user',{headers:{apikey:PUA_KEY,Authorization:'Bearer '+s.access_token}});if(!u.ok)return;
  const user=await u.json();puaUserId=user.id;
  const ms=await puaApi('/rest/v1/app_workspace_members?user_id=eq.'+encodeURIComponent(user.id)+'&select=role&limit=1');puaRole=ms?.[0]?.role||null;
}
function puaInstall(){
  const root=document.querySelector('#projectUpdates');
  if(root)new MutationObserver(()=>puaSchedule()).observe(root,{childList:true});
  document.addEventListener('click',e=>{
    const project=e.target.closest?.('[data-project]');if(project){puaProjectId=project.dataset.project;setTimeout(puaSchedule,100)}
    const edit=e.target.closest?.('[data-pua-edit]');if(edit){e.preventDefault();e.stopPropagation();puaStartEdit(edit.dataset.puaEdit);return}
    const del=e.target.closest?.('[data-pua-delete]');if(del){e.preventDefault();e.stopPropagation();puaDelete(del.dataset.puaDelete)}
  },true);
  const style=document.createElement('style');style.textContent='.pua-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}.pua-actions button,.pua-edit-row button{border:1px solid #dce2e8;background:#fff;border-radius:8px;padding:5px 9px;font-size:11px;font-weight:750;color:#607080}.pua-actions .pua-delete{color:#a33b45;border-color:#ead2d5}.pua-editor{margin-top:8px}.pua-editor textarea{width:100%;margin:0;min-height:86px}.pua-edit-row{display:grid;grid-template-columns:1fr auto auto;gap:6px;margin-top:6px}.pua-edit-row select{margin:0}.pua-edit-row .pua-save{background:#315f95;color:#fff;border-color:#315f95}.pua-status{font-size:11px;color:#a33b45;margin-top:5px}';document.head.appendChild(style);
}

(async()=>{await puaInitContext();puaInstall()})();
