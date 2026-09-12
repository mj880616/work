const PUA_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const PUA_KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const PUA_SESSION='kptu_collab_session_v1';
const PUA_PREFIX='__KPTU_PROJECT_UPDATE_V2__';
const PUA_LEGACY_KIND={update:'진행',decision:'결정',issue:'쟁점',note:'메모'};
let puaProjectId=null,puaUserId=null,puaRole=null,puaWorkspace=null,puaProfiles=[],puaRows=[],puaLabels=[],puaLoading=false,puaTimer=null;

function puaSession(){try{return JSON.parse(localStorage.getItem(PUA_SESSION)||'null')}catch{return null}}
async function puaApi(path,{method='GET',body=null}={}){
  const s=puaSession();
  if(!s?.access_token)throw new Error('로그인이 필요합니다.');
  const r=await fetch(PUA_SB+path,{method,headers:{apikey:PUA_KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:body===null?null:JSON.stringify(body),cache:'no-store'});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok)throw new Error(d?.message||d?.error_description||d?.hint||('요청 실패 '+r.status));
  return d;
}
function puaEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function puaName(id){return puaProfiles.find(x=>x.user_id===id)?.display_name||id?.slice(0,8)||'작성자'}
function puaCanEdit(row){return row?.author_id===puaUserId||['owner','admin'].includes(puaRole)}
function puaSchedule(delay=80){clearTimeout(puaTimer);puaTimer=setTimeout(puaLoadAndRender,delay)}
function puaDate(v){if(!v)return '';try{return new Date(v).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}catch{return ''}}
function puaDecode(body){
  const raw=String(body||'');
  if(raw.startsWith(PUA_PREFIX)){
    try{const d=JSON.parse(raw.slice(PUA_PREFIX.length));return{title:String(d.title||'진척상황'),content:String(d.content||'')}}catch{}
  }
  return{title:'진척상황',content:raw};
}
function puaEncode(title,content){return PUA_PREFIX+JSON.stringify({title:String(title||'').trim(),content:String(content||'').trim()})}
function puaKindForLabel(id){return id?`label:${id}`:''}
function puaLabelIdFromKind(kind){const s=String(kind||'');return s.startsWith('label:')?s.slice(6):''}
function puaLabelName(kind){
  if(!kind)return '';
  const id=puaLabelIdFromKind(kind);
  if(id){const l=puaLabels.find(x=>x.id===id);return l?.name||''}
  return PUA_LEGACY_KIND[kind]||kind;
}
function puaActiveLabels(){return puaLabels.filter(x=>!x.deleted_at)}
function puaSelectHtml(selectedKind=''){
  const active=puaActiveLabels();
  return `<option value="" ${!selectedKind?'selected':''}>말머리 없음</option>`+active.map(l=>{const v=puaKindForLabel(l.id);return `<option value="${puaEsc(v)}" ${selectedKind===v?'selected':''}>${puaEsc(l.name)}</option>`}).join('');
}
function puaRefreshSelects(){
  const main=document.querySelector('#projectUpdateKind');if(main)main.innerHTML=puaSelectHtml(main.value||'');
  document.querySelectorAll('.pua-kind-select').forEach(sel=>{const v=sel.dataset.current||sel.value||'';sel.innerHTML=puaSelectHtml(v);sel.value=v});
}
function puaRenderLabelManager(){
  const box=document.querySelector('#puaLabelManager');if(!box)return;
  const active=puaActiveLabels();
  box.innerHTML=`<div class="pua-label-manager-head"><strong>말머리 관리</strong><button type="button" class="pua-label-close">닫기</button></div><div class="pua-label-add"><input id="puaNewLabelName" type="text" maxlength="40" placeholder="새 말머리"><button type="button" id="puaAddLabel">추가</button></div><div class="pua-label-list">${active.length?active.map(l=>`<div class="pua-label-row" data-pua-label-row="${l.id}"><span>${puaEsc(l.name)}</span><div><button type="button" data-pua-label-edit="${l.id}">수정</button><button type="button" class="danger" data-pua-label-delete="${l.id}">삭제</button></div></div>`).join(''):'<div class="pua-label-empty">등록된 말머리가 없습니다.</div>'}</div>`;
}
function puaToggleLabelManager(force){
  const box=document.querySelector('#puaLabelManager');if(!box)return;
  const next=typeof force==='boolean'?force:box.hidden;
  box.hidden=!next;if(next)puaRenderLabelManager();
}

function puaPrepareSection(){
  const root=document.querySelector('#projectUpdates');
  const modal=document.querySelector('#projectModal .modal-card');
  if(!root||!modal)return false;
  const section=root.closest('section');if(!section)return false;
  section.classList.add('pua-progress-section');
  const h=section.querySelector('h3');if(h)h.textContent='진척상황';
  const head=modal.querySelector('.modal-head');if(head&&section.previousElementSibling!==head)head.insertAdjacentElement('afterend',section);
  const form=section.querySelector('.inline-form');
  if(form){
    form.classList.add('pua-add-form');
    const body=document.querySelector('#projectUpdateBody');
    if(body){body.rows=3;body.placeholder='내용';if(!document.querySelector('#projectUpdateTitle')){const input=document.createElement('input');input.id='projectUpdateTitle';input.type='text';input.placeholder='제목';input.maxLength=120;form.insertBefore(input,body)}}
    const select=document.querySelector('#projectUpdateKind');if(select){select.setAttribute('aria-label','말머리');select.innerHTML=puaSelectHtml(select.value||'')}
    if(!document.querySelector('#puaManageLabels')){const manage=document.createElement('button');manage.id='puaManageLabels';manage.type='button';manage.className='pua-manage-labels';manage.textContent='말머리 관리';select?.insertAdjacentElement('afterend',manage)}
    if(!document.querySelector('#puaLabelManager')){const mgr=document.createElement('div');mgr.id='puaLabelManager';mgr.hidden=true;mgr.className='pua-label-manager';form.insertAdjacentElement('afterend',mgr)}
    const btn=document.querySelector('#addProjectUpdate');if(btn)btn.textContent='등록';
  }
  return true;
}

function puaCard(row){
  const d=puaDecode(row.body),can=puaCanEdit(row),label=puaLabelName(row.kind);
  return `<article class="pua-card" data-project-update-id="${row.id}"><div class="pua-card-top"><div><strong>${puaEsc(d.title)}</strong>${label?`<span class="pua-kind">${puaEsc(label)}</span>`:''}</div></div><div class="pua-card-content">${puaEsc(d.content)}</div><div class="pua-card-foot"><small>${puaEsc(puaName(row.author_id))} · ${puaEsc(puaDate(row.created_at))}</small>${can?`<div class="pua-actions"><button type="button" class="pua-edit" data-pua-edit="${row.id}">수정</button><button type="button" class="pua-delete" data-pua-delete="${row.id}">삭제</button></div>`:''}</div></article>`;
}
function puaRender(){const root=document.querySelector('#projectUpdates');if(root)root.innerHTML=puaRows.length?puaRows.map(puaCard).join(''):'<div class="empty compact">등록된 진척상황이 없습니다.</div>'}
async function puaLoadAndRender(){
  if(!puaPrepareSection()||!puaProjectId||puaLoading)return;
  puaLoading=true;
  try{
    [puaRows,puaLabels]=await Promise.all([
      puaApi('/rest/v1/app_project_updates?project_id=eq.'+encodeURIComponent(puaProjectId)+'&select=id,author_id,kind,body,created_at&order=created_at.desc'),
      puaApi('/rest/v1/app_project_update_labels?project_id=eq.'+encodeURIComponent(puaProjectId)+'&select=id,name,sort_order,deleted_at,created_at&order=sort_order.asc,created_at.asc')
    ]);
    puaRefreshSelects();puaRender();if(!document.querySelector('#puaLabelManager')?.hidden)puaRenderLabelManager();
  }catch(e){const root=document.querySelector('#projectUpdates');if(root)root.innerHTML=`<div class="status error">${puaEsc(e.message||String(e))}</div>`}
  finally{puaLoading=false}
}
async function puaAdd(){
  if(!puaProjectId)return;
  const title=document.querySelector('#projectUpdateTitle')?.value.trim()||'';
  const content=document.querySelector('#projectUpdateBody')?.value.trim()||'';
  const kind=document.querySelector('#projectUpdateKind')?.value||'';
  if(!title){alert('제목을 입력해 주세요.');document.querySelector('#projectUpdateTitle')?.focus();return}
  if(!content){alert('내용을 입력해 주세요.');document.querySelector('#projectUpdateBody')?.focus();return}
  const btn=document.querySelector('#addProjectUpdate');if(btn)btn.disabled=true;
  try{await puaApi('/rest/v1/app_project_updates',{method:'POST',body:{project_id:puaProjectId,author_id:puaUserId,kind,body:puaEncode(title,content)}});const ti=document.querySelector('#projectUpdateTitle'),bo=document.querySelector('#projectUpdateBody');if(ti)ti.value='';if(bo)bo.value='';await puaLoadAndRender()}catch(e){alert(e.message||String(e))}finally{if(btn)btn.disabled=false}
}
function puaStartEdit(id){
  const row=puaRows.find(x=>x.id===id),item=document.querySelector(`#projectUpdates [data-project-update-id="${CSS.escape(id)}"]`);if(!row||!item||item.querySelector('.pua-editor'))return;
  const d=puaDecode(row.body);
  item.innerHTML=`<div class="pua-editor"><input class="pua-title" type="text" maxlength="120" placeholder="제목"><textarea class="pua-body" rows="4" placeholder="내용"></textarea><div class="pua-edit-row"><select class="pua-kind-select"></select><button type="button" class="pua-cancel">취소</button><button type="button" class="pua-save">저장</button></div><div class="pua-status"></div></div>`;
  item.querySelector('.pua-title').value=d.title||'';item.querySelector('.pua-body').value=d.content||'';const ks=item.querySelector('.pua-kind-select');ks.dataset.current=row.kind||'';ks.innerHTML=puaSelectHtml(row.kind||'');ks.value=row.kind||'';
  item.querySelector('.pua-cancel').onclick=()=>puaRender();
  item.querySelector('.pua-save').onclick=async()=>{const title=item.querySelector('.pua-title').value.trim(),content=item.querySelector('.pua-body').value.trim(),kind=ks.value||'',status=item.querySelector('.pua-status');if(!title){status.textContent='제목을 입력해 주세요.';return}if(!content){status.textContent='내용을 입력해 주세요.';return}const save=item.querySelector('.pua-save');save.disabled=true;status.textContent='저장 중…';try{await puaApi('/rest/v1/app_project_updates?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{kind,body:puaEncode(title,content),updated_at:new Date().toISOString()}});row.kind=kind;row.body=puaEncode(title,content);puaRender()}catch(e){status.textContent=e.message||String(e)}finally{save.disabled=false}};
  item.querySelector('.pua-title').focus();
}
async function puaDelete(id){const row=puaRows.find(x=>x.id===id);if(!row||!puaCanEdit(row))return;if(!confirm('이 진척상황을 삭제할까요?'))return;const btn=document.querySelector(`[data-pua-delete="${CSS.escape(id)}"]`);if(btn)btn.disabled=true;try{await puaApi('/rest/v1/app_project_updates?id=eq.'+encodeURIComponent(id),{method:'DELETE'});puaRows=puaRows.filter(x=>x.id!==id);puaRender()}catch(e){alert(e.message||String(e));if(btn)btn.disabled=false}}
async function puaAddLabel(){const input=document.querySelector('#puaNewLabelName');const name=input?.value.trim()||'';if(!name||!puaProjectId)return;if(input)input.disabled=true;try{const max=Math.max(0,...puaActiveLabels().map(x=>Number(x.sort_order)||0));await puaApi('/rest/v1/app_project_update_labels',{method:'POST',body:{project_id:puaProjectId,name,sort_order:max+10,created_by:puaUserId}});if(input)input.value='';await puaLoadAndRender()}catch(e){alert(e.message||String(e))}finally{if(input)input.disabled=false}}
async function puaEditLabel(id){const l=puaLabels.find(x=>x.id===id);if(!l||l.deleted_at)return;const name=prompt('말머리 이름을 수정합니다.',l.name);if(name===null)return;const v=name.trim();if(!v)return alert('말머리 이름을 입력해 주세요.');try{await puaApi('/rest/v1/app_project_update_labels?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{name:v,updated_at:new Date().toISOString()}});l.name=v;puaRefreshSelects();puaRender();puaRenderLabelManager()}catch(e){alert(e.message||String(e))}}
async function puaDeleteLabel(id){const l=puaLabels.find(x=>x.id===id);if(!l||l.deleted_at)return;if(!confirm(`“${l.name}” 말머리를 삭제할까요?\n기존 진척상황 기록의 말머리 표시는 유지됩니다.`))return;try{await puaApi('/rest/v1/app_project_update_labels?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{deleted_at:new Date().toISOString(),updated_at:new Date().toISOString()}});l.deleted_at=new Date().toISOString();puaRefreshSelects();puaRender();puaRenderLabelManager()}catch(e){alert(e.message||String(e))}}
async function puaInitContext(){const s=puaSession();if(!s?.access_token)return;const u=await fetch(PUA_SB+'/auth/v1/user',{headers:{apikey:PUA_KEY,Authorization:'Bearer '+s.access_token},cache:'no-store'});if(!u.ok)return;const user=await u.json();puaUserId=user.id;const ms=await puaApi('/rest/v1/app_workspace_members?user_id=eq.'+encodeURIComponent(user.id)+'&select=workspace_id,role&limit=1');puaWorkspace=ms?.[0]?.workspace_id||null;puaRole=ms?.[0]?.role||null;try{puaProfiles=await puaApi('/rest/v1/app_profiles?select=user_id,display_name')}catch{puaProfiles=[]}}
function puaInstall(){
  puaPrepareSection();
  const root=document.querySelector('#projectUpdates');if(root)new MutationObserver(()=>{if(root.querySelector(':scope > .list-item'))puaSchedule(30)}).observe(root,{childList:true});
  document.addEventListener('click',e=>{
    const add=e.target.closest?.('#addProjectUpdate');if(add){e.preventDefault();e.stopImmediatePropagation();puaAdd();return}
    const project=e.target.closest?.('[data-project]');if(project){puaProjectId=project.dataset.project;setTimeout(()=>puaSchedule(0),80);setTimeout(()=>puaSchedule(0),300)}
    const edit=e.target.closest?.('[data-pua-edit]');if(edit){e.preventDefault();e.stopPropagation();puaStartEdit(edit.dataset.puaEdit);return}
    const del=e.target.closest?.('[data-pua-delete]');if(del){e.preventDefault();e.stopPropagation();puaDelete(del.dataset.puaDelete);return}
    if(e.target.closest?.('#puaManageLabels')){e.preventDefault();puaToggleLabelManager();return}
    if(e.target.closest?.('.pua-label-close')){puaToggleLabelManager(false);return}
    if(e.target.closest?.('#puaAddLabel')){puaAddLabel();return}
    const le=e.target.closest?.('[data-pua-label-edit]');if(le){puaEditLabel(le.dataset.puaLabelEdit);return}
    const ld=e.target.closest?.('[data-pua-label-delete]');if(ld){puaDeleteLabel(ld.dataset.puaLabelDelete);return}
  },true);
  document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target?.id==='puaNewLabelName'){e.preventDefault();puaAddLabel()}},true);
  const style=document.createElement('style');style.id='puaStyle';style.textContent=`
.pua-progress-section{margin:18px 0 20px;padding:16px 0 18px;border-top:1px solid #e8ecef;border-bottom:1px solid #e8ecef}.pua-progress-section>h3{margin:0 0 12px;font-size:18px}.pua-progress-section #projectUpdates{display:grid;gap:10px}.pua-card{border:1px solid #dfe5eb;border-radius:13px;background:#fff;padding:13px 14px}.pua-card-top>div{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.pua-card-top strong{font-size:14px;line-height:1.45;color:#202b37}.pua-kind{font-size:10px;font-weight:800;color:#5f7184;background:#f0f4f7;border-radius:999px;padding:3px 7px}.pua-card-content{margin-top:7px;font-size:13px;line-height:1.65;color:#4f5d6b;white-space:pre-wrap;word-break:break-word}.pua-card-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:11px;padding-top:9px;border-top:1px solid #eef1f4}.pua-card-foot small{font-size:10px;color:#8a949f}.pua-actions{display:flex;justify-content:flex-end;gap:6px}.pua-actions button,.pua-edit-row button,.pua-manage-labels,.pua-label-manager button{border:1px solid #dce2e8;background:#fff;border-radius:8px;padding:5px 9px;font-size:11px;font-weight:750;color:#607080}.pua-actions .pua-delete,.pua-label-manager .danger{color:#a33b45;border-color:#ead2d5}.pua-add-form{display:grid!important;grid-template-columns:minmax(0,1fr) 150px auto auto!important;gap:8px!important;margin-top:12px}.pua-add-form #projectUpdateTitle,.pua-add-form #projectUpdateBody{grid-column:1/-1}.pua-add-form #projectUpdateTitle{font-weight:700}.pua-add-form #projectUpdateBody{min-height:88px}.pua-add-form #projectUpdateKind{grid-column:1/2}.pua-add-form #puaManageLabels{grid-column:3}.pua-add-form #addProjectUpdate{grid-column:4}.pua-label-manager{margin-top:8px;padding:11px;border:1px solid #e1e6eb;border-radius:11px;background:#f8fafb}.pua-label-manager-head,.pua-label-row{display:flex;align-items:center;justify-content:space-between;gap:8px}.pua-label-manager-head{margin-bottom:8px}.pua-label-add{display:grid;grid-template-columns:1fr auto;gap:6px;margin-bottom:8px}.pua-label-list{display:grid;gap:5px}.pua-label-row{padding:7px 0;border-top:1px solid #e9edf1}.pua-label-row>div{display:flex;gap:5px}.pua-label-empty{font-size:11px;color:#7b8792;padding:5px 0}.pua-editor{display:grid;gap:8px}.pua-editor .pua-title{font-weight:700}.pua-editor textarea{width:100%;margin:0;min-height:92px}.pua-edit-row{display:grid;grid-template-columns:1fr auto auto;gap:6px}.pua-edit-row select{margin:0}.pua-edit-row .pua-save{background:#315f95;color:#fff;border-color:#315f95}.pua-status{font-size:11px;color:#a33b45}@media(max-width:700px){.pua-progress-section{margin-top:12px}.pua-card{padding:12px}.pua-card-foot{align-items:flex-start;flex-direction:column}.pua-actions{width:100%;justify-content:flex-start}.pua-add-form{grid-template-columns:1fr 1fr!important}.pua-add-form #projectUpdateKind{grid-column:1}.pua-add-form #puaManageLabels{grid-column:2}.pua-add-form #addProjectUpdate{grid-column:1/-1}.pua-edit-row{grid-template-columns:1fr 1fr}.pua-edit-row .pua-kind-select{grid-column:1/-1}}
`;document.head.appendChild(style);
}
(async()=>{await puaInitContext();puaInstall()})();
