let pweMode='idle';
let pwePendingAdd=new Map();
let pwePendingRemove=new Set();
let pweSaving=false;
let pweInternalToggle=false;
let pweObserved=null;
let pweRefreshQueued=false;

function pweEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function pweToast(msg){const t=document.querySelector('#toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');clearTimeout(pweToast.t);pweToast.t=setTimeout(()=>t.classList.add('hidden'),2400)}
function pweApi(path,opts={}){const rt=window.KPTURuntime;if(!rt)throw new Error('공용 런타임을 불러오지 못했습니다.');return rt.api(path,opts)}

function pweStyle(){if(document.querySelector('#pweStyle'))return;const s=document.createElement('style');s.id='pweStyle';s.textContent=`
#profileView .ps-workplace-button{font-size:13px!important;font-weight:700!important;line-height:1.25!important;padding:5px 9px!important;min-height:30px!important}
#profileView .ps-workplace-item .ps-workplace-chip{border-radius:999px!important}
#profileView .ps-workplace-remove{display:none!important;align-items:center;justify-content:center;min-width:29px!important;font-size:15px!important}
#profileView.pwe-delete-mode .ps-workplace-item:not(.pwe-pending-add) .ps-workplace-chip,#profileView.pwe-delete-mode .pwe-pending-add .ps-workplace-chip{border-radius:999px 0 0 999px!important}
#profileView.pwe-delete-mode .ps-workplace-remove{display:inline-flex!important}
#profileView .pwe-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
#profileView .pwe-actions button{white-space:nowrap}
#profileView .pwe-active{background:#eef4f8!important;border-color:#9fb0bf!important;color:#244f73!important}
#profileView .pwe-save[disabled]{opacity:.45;cursor:default}
#profileView .pwe-pending-remove{opacity:.48}
#profileView .pwe-pending-remove .ps-workplace-button{text-decoration:line-through}
#profileView .pwe-pending-remove .ps-workplace-remove{background:#fff2f3;color:#a33b45}
#profileView .pwe-pending-add .ps-workplace-chip{border-style:dashed!important;background:#f2f7fa!important;color:#315f87!important}
#profileView .pwe-pending-add .ps-workplace-chip::after{content:'추가 예정';margin-left:6px;font-size:9px;font-weight:700;color:#6f8597}
#profileView .ps-workplace-choice.pwe-selected{border-color:#9fb0bf;background:#eef4f8}
#profileView .ps-workplace-choice.pwe-selected b{color:#315f87}
#profileView .pwe-saving{pointer-events:none;opacity:.65}
@media(max-width:700px){#profileView .ps-workplace-button{font-size:12px!important;padding:5px 8px!important}.pwe-actions{width:100%;justify-content:flex-start!important}.pwe-actions button{flex:1 1 auto}}
`;document.head.appendChild(s)}

function pweEnsureControls(){const root=document.querySelector('#profileView'),add=document.querySelector('#psAddWorkplace');if(!root||!add)return false;let wrap=document.querySelector('#pweActions');if(!wrap){wrap=document.createElement('div');wrap.id='pweActions';wrap.className='pwe-actions';add.parentNode.insertBefore(wrap,add);wrap.appendChild(add);const del=document.createElement('button');del.id='psDeleteWorkplace';del.className='secondary';del.type='button';del.textContent='삭제';const save=document.createElement('button');save.id='psSaveWorkplaces';save.className='primary pwe-save';save.type='button';save.textContent='저장';save.disabled=true;wrap.append(del,save)}add.textContent='추가';add.classList.toggle('pwe-active',pweMode==='add');document.querySelector('#psDeleteWorkplace')?.classList.toggle('pwe-active',pweMode==='delete');root.classList.toggle('pwe-delete-mode',pweMode==='delete');const save=document.querySelector('#psSaveWorkplaces');if(save){save.disabled=pweSaving||(!pwePendingAdd.size&&!pwePendingRemove.size);save.textContent=pweSaving?'저장 중…':'저장'}const note=root.querySelector('.ps-workplace-note');if(note)note.textContent='조직명을 누르면 해당 조직의 정보와 현황을 확인할 수 있습니다. 추가·삭제할 항목을 선택한 뒤 저장하면 반영됩니다.';return true}

function pweApplyPending(){const root=document.querySelector('#profileView');if(!root)return;root.querySelectorAll('.pwe-pending-add').forEach(x=>x.remove());root.querySelectorAll('.pwe-pending-remove').forEach(x=>x.classList.remove('pwe-pending-remove'));for(const id of pwePendingRemove){const b=root.querySelector(`[data-ps-remove-workplace="${CSS.escape(id)}"]`);const item=b?.closest('.ps-workplace-item');if(item)item.classList.add('pwe-pending-remove')}
let chips=root.querySelector('#psWorkplaceList .ps-workplace-chips');if(pwePendingAdd.size&&!chips){const empty=root.querySelector('#psWorkplaceList .empty');if(empty)empty.style.display='none';chips=document.createElement('div');chips.className='ps-workplace-chips pwe-created-chips';root.querySelector('#psWorkplaceList')?.appendChild(chips)}else{const empty=root.querySelector('#psWorkplaceList .empty');if(empty)empty.style.display=''}
for(const [id,o] of pwePendingAdd){if(root.querySelector(`[data-ps-workplace-org="${CSS.escape(id)}"]`))continue;chips?.insertAdjacentHTML('beforeend',`<span class="ps-workplace-item pwe-pending-add" data-pwe-add-preview="${pweEsc(id)}"><button class="ps-workplace-chip ps-workplace-button" type="button" disabled>${pweEsc(o.name)}</button><button class="ps-workplace-remove" data-pwe-cancel-add="${pweEsc(id)}" type="button" aria-label="추가 취소">×</button></span>`)}
root.querySelectorAll('[data-ps-add-workplace]').forEach(b=>{const selected=pwePendingAdd.has(b.dataset.psAddWorkplace);b.classList.toggle('pwe-selected',selected);const mark=b.querySelector('b');if(mark)mark.textContent=selected?'선택됨':'추가'})}

function pweRefresh(){pweRefreshQueued=false;if(!pweEnsureControls())return;pweApplyPending()}
function pweSchedule(){if(pweRefreshQueued)return;pweRefreshQueued=true;requestAnimationFrame(pweRefresh)}

function pweClosePicker(){const picker=document.querySelector('#psWorkplacePicker');if(!picker||picker.classList.contains('hidden'))return;pweInternalToggle=true;document.querySelector('#psAddWorkplace')?.click();pweInternalToggle=false}
function pweSetMode(mode){if(pweSaving)return;if(mode==='delete')pweClosePicker();pweMode=pweMode===mode?'idle':mode;pweSchedule();if(pweMode==='add')setTimeout(()=>document.querySelector('#psWorkplaceSearch')?.focus(),0)}

function pweToggleAdd(btn){const id=btn.dataset.psAddWorkplace;if(!id)return;const name=btn.querySelector('span')?.textContent?.trim()||'조직',aliases=(btn.querySelector('small')?.textContent||'').split(' · ').map(x=>x.trim()).filter(Boolean);if(pwePendingAdd.has(id))pwePendingAdd.delete(id);else pwePendingAdd.set(id,{name,aliases});pweSchedule()}
function pweToggleRemove(btn){const id=btn.dataset.psRemoveWorkplace;if(!id)return;if(pwePendingRemove.has(id))pwePendingRemove.delete(id);else pwePendingRemove.add(id);pweSchedule()}

async function pweAddOrg(user,org,assignments,workplaces){let assignmentCreated=false;const existing=workplaces.find(x=>x.organization_id===org.id);if(!assignments.some(x=>x.organization_id===org.id)){await pweApi('/rest/v1/app_suborganization_assignees',{method:'POST',body:{organization_id:org.id,user_id:user.id,assigned_by:user.id}});assignmentCreated=true}try{if(existing)await pweApi(`/rest/v1/app_profile_workplaces?id=eq.${encodeURIComponent(existing.id)}`,{method:'PATCH',body:{full_name:org.name,aliases:org.aliases||[],updated_at:new Date().toISOString()}});else{const last=workplaces.reduce((m,x)=>Math.max(m,Number(x.sort_order)||0),-10);await pweApi('/rest/v1/app_profile_workplaces',{method:'POST',body:{user_id:user.id,organization_id:org.id,full_name:org.name,aliases:org.aliases||[],sort_order:last+10}})}}catch(e){if(assignmentCreated)try{await pweApi(`/rest/v1/app_suborganization_assignees?organization_id=eq.${encodeURIComponent(org.id)}&user_id=eq.${user.id}`,{method:'DELETE'})}catch{}throw e}}
async function pweRemoveOrg(user,id,assignments,workplaces){const backups=workplaces.filter(x=>x.organization_id===id).map(x=>({id:x.id,user_id:user.id,organization_id:id,full_name:x.full_name,aliases:x.aliases||[],sort_order:x.sort_order||0}));let mirrorDeleted=false;if(backups.length){await pweApi(`/rest/v1/app_profile_workplaces?user_id=eq.${user.id}&organization_id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});mirrorDeleted=true}try{if(assignments.some(x=>x.organization_id===id))await pweApi(`/rest/v1/app_suborganization_assignees?organization_id=eq.${encodeURIComponent(id)}&user_id=eq.${user.id}`,{method:'DELETE'})}catch(e){if(mirrorDeleted&&backups.length)try{await pweApi('/rest/v1/app_profile_workplaces',{method:'POST',body:backups})}catch{}throw e}}

async function pweSave(){if(pweSaving||(!pwePendingAdd.size&&!pwePendingRemove.size))return;const rt=window.KPTURuntime;if(!rt||!(await rt.session.ensure()))return;pweSaving=true;pweSchedule();try{const user=await pweApi('/auth/v1/user');const [assignments,workplaces]=await Promise.all([pweApi(`/rest/v1/app_suborganization_assignees?user_id=eq.${user.id}&select=organization_id,user_id,assigned_by,created_at`),pweApi(`/rest/v1/app_profile_workplaces?user_id=eq.${user.id}&select=id,organization_id,full_name,aliases,sort_order,created_at&order=sort_order.asc,created_at.asc`)]);for(const [id,meta] of pwePendingAdd){const rows=await pweApi(`/rest/v1/app_suborganizations?id=eq.${encodeURIComponent(id)}&select=id,name,aliases,active&limit=1`);const org=rows?.[0];if(!org||org.active===false)throw new Error(`${meta.name}은(는) 현재 추가할 수 없습니다.`);await pweAddOrg(user,org,assignments||[],workplaces||[])}for(const id of pwePendingRemove)await pweRemoveOrg(user,id,assignments||[],workplaces||[]);pwePendingAdd.clear();pwePendingRemove.clear();pweMode='idle';pweClosePicker();window.dispatchEvent(new CustomEvent('kptu:profile-updated'));window.dispatchEvent(new CustomEvent('kptu:suborganization-updated'));window.__KPTU_RELOAD_SUBORGANIZATIONS__?.();pweToast('담당 사업장 변경사항을 저장했습니다.')}catch(e){pwePendingAdd.clear();pwePendingRemove.clear();pweMode='idle';window.dispatchEvent(new CustomEvent('kptu:suborganization-updated'));pweToast(e.message||'담당 사업장을 저장하지 못했습니다.')}finally{pweSaving=false;pweSchedule()}}

document.addEventListener('click',e=>{const addTop=e.target.closest?.('#psAddWorkplace');if(addTop&&!pweInternalToggle){pweSetMode('add');setTimeout(pweSchedule,0);return}const delTop=e.target.closest?.('#psDeleteWorkplace');if(delTop){e.preventDefault();e.stopImmediatePropagation();pweSetMode('delete');return}const save=e.target.closest?.('#psSaveWorkplaces');if(save){e.preventDefault();e.stopImmediatePropagation();pweSave();return}const add=e.target.closest?.('[data-ps-add-workplace]');if(add&&!pweSaving){e.preventDefault();e.stopImmediatePropagation();pweToggleAdd(add);return}const rem=e.target.closest?.('[data-ps-remove-workplace]');if(rem&&!pweSaving){e.preventDefault();e.stopImmediatePropagation();if(pweMode==='delete')pweToggleRemove(rem);return}const cancel=e.target.closest?.('[data-pwe-cancel-add]');if(cancel&&!pweSaving){e.preventDefault();e.stopImmediatePropagation();pwePendingAdd.delete(cancel.dataset.pweCancelAdd);pweSchedule()}},true);

function pweObserve(){const root=document.querySelector('#profileView');if(!root)return false;if(pweObserved!==root){pweObserved=root;new MutationObserver(pweSchedule).observe(root,{childList:true,subtree:true});}pweSchedule();return true}
function pweBoot(){pweStyle();if(pweObserve())return;const obs=new MutationObserver(()=>{if(pweObserve())obs.disconnect()});obs.observe(document.documentElement,{childList:true,subtree:true})}
window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view==='profile')setTimeout(pweSchedule,0)});
window.addEventListener('kptu:session-changed',()=>{pweMode='idle';pwePendingAdd.clear();pwePendingRemove.clear();pweSchedule()});
pweBoot();
