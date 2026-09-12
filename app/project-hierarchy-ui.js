const PH_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const PH_KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const PH_SESSION='kptu_collab_session_v1';
let phWorkspace=null,phSpaces=[];

function phSession(){try{return JSON.parse(localStorage.getItem(PH_SESSION)||'null')}catch{return null}}
async function phApi(path){const s=phSession();if(!s?.access_token)throw new Error('로그인이 필요합니다.');const r=await fetch(PH_SB+path,{headers:{apikey:PH_KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'}});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||d?.hint||d?.error_description||('요청 실패 '+r.status));return d}
function phEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function phChildren(id){return phSpaces.filter(x=>x.parent_id===id&&x.status!=='archived')}
function phProject(id){return phSpaces.find(x=>x.id===id)}

function phInstallStyle(){if(document.querySelector('#phStyle'))return;const s=document.createElement('style');s.id='phStyle';s.textContent=`
#projectChecks{display:none!important}#projectChecks+*{display:none!important}
#projectChecksSection{display:none!important}
.ph-hidden-checklist{display:none!important}
.subchips{gap:6px!important}.subchips .ph-subproject{display:inline-flex;align-items:center;max-width:100%;font-size:11px!important;font-weight:750!important;background:#eef3f8!important;color:#315f95!important;padding:6px 8px!important;border-radius:8px!important;cursor:pointer!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.subchips .ph-subproject:hover{background:#e2ebf4!important}
.ph-children-section{margin:4px 0 18px;padding:14px 0 16px;border-bottom:1px solid #e8ecef}.ph-children-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px}.ph-children-head h3{margin:0!important;font-size:14px}.ph-children-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.ph-child-card,.ph-parent-card{border:1px solid #e4e9ee;background:#fff;border-radius:11px;padding:10px 11px;text-align:left;color:inherit}.ph-child-card:hover,.ph-parent-card:hover{border-color:#b9c9da;background:#f8fafc}.ph-child-card b,.ph-parent-card b{display:block;font-size:13px}.ph-child-card span,.ph-parent-card span{display:block;margin-top:3px;font-size:11px;color:#7b8793;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ph-parent-wrap{margin-bottom:9px}.ph-empty{font-size:12px;color:#8a949f;padding:4px 0}@media(max-width:700px){.ph-children-list{grid-template-columns:1fr}}
`;document.head.appendChild(s)}

function phHideChecklist(){const checks=document.querySelector('#projectChecks');const section=checks?.closest('section');if(section){section.id='projectChecksSection';section.classList.add('ph-hidden-checklist')}const desc=document.querySelector('#projectsView .section-head p');if(desc)desc.textContent='사업별 현황·하위 프로젝트·할 일·의견·자료를 한곳에서 봅니다.'}

function phEnhanceGrid(){const grid=document.querySelector('#projectGrid');if(!grid)return;for(const card of grid.querySelectorAll('[data-project]')){const id=card.dataset.project;if(!id)continue;const children=phChildren(id),area=card.querySelector('.subchips');if(!area)continue;const sig=children.map(x=>x.id+':'+x.name).join('|');if(area.dataset.phSig===sig)continue;area.dataset.phSig=sig;area.innerHTML=children.map(c=>`<span class="ph-subproject" data-ph-project="${c.id}" title="${phEsc(c.name)}">↳ ${phEsc(c.name)}</span>`).join('')}}

function phEnsureModalSection(){const card=document.querySelector('#projectModal .modal-card');if(!card)return null;let sec=document.querySelector('#projectChildrenSection');if(!sec){sec=document.createElement('section');sec.id='projectChildrenSection';sec.className='ph-children-section';const grid=card.querySelector('.project-detail-grid');if(grid)grid.insertAdjacentElement('beforebegin',sec);else card.querySelector('.modal-head')?.insertAdjacentElement('afterend',sec)}return sec}

function phRenderModal(id){const sec=phEnsureModalSection();if(!sec)return;const project=phProject(id);if(!project){sec.innerHTML='';return}const parent=project.parent_id?phProject(project.parent_id):null,children=phChildren(id);sec.innerHTML=`${parent?`<div class="ph-parent-wrap"><button type="button" class="ph-parent-card" data-ph-project="${parent.id}"><b>↑ ${phEsc(parent.name)}</b><span>상위 프로젝트로 이동</span></button></div>`:''}<div class="ph-children-head"><h3>하위 프로젝트</h3><span class="updated">${children.length}개</span></div>${children.length?`<div class="ph-children-list">${children.map(c=>`<button type="button" class="ph-child-card" data-ph-project="${c.id}"><b>${phEsc(c.name)}</b><span>${phEsc(c.description||'설명 없음')}</span></button>`).join('')}</div>`:'<div class="ph-empty">등록된 하위 프로젝트가 없습니다.</div>'}`}
}

function phOpenExistingProject(id){if(!id)return;const temp=document.createElement('button');temp.type='button';temp.dataset.project=id;temp.hidden=true;document.body.appendChild(temp);temp.click();temp.remove()}

function phBind(){document.addEventListener('click',e=>{const sub=e.target.closest?.('[data-ph-project]');if(sub){e.preventDefault();e.stopImmediatePropagation();phOpenExistingProject(sub.dataset.phProject);return}const project=e.target.closest?.('[data-project]');if(project?.dataset.project)setTimeout(()=>phRenderModal(project.dataset.project),90)},true);const grid=document.querySelector('#projectGrid');if(grid)new MutationObserver(()=>phEnhanceGrid()).observe(grid,{childList:true,subtree:true});const modal=document.querySelector('#projectModal');if(modal)new MutationObserver(()=>{if(!modal.classList.contains('hidden')){const title=document.querySelector('#projectModalTitle')?.textContent||'';const p=phSpaces.find(x=>x.name===title);if(p)phRenderModal(p.id)}}).observe(modal,{attributes:true,attributeFilter:['class']})}

async function phInit(){for(let i=0;i<50;i++){if(document.querySelector('#projectModal')&&document.querySelector('#projectGrid'))break;await new Promise(r=>setTimeout(r,100))}phInstallStyle();phHideChecklist();try{const s=phSession();if(!s?.access_token)return;const u=await fetch(PH_SB+'/auth/v1/user',{headers:{apikey:PH_KEY,Authorization:'Bearer '+s.access_token}});if(!u.ok)return;const user=await u.json();const ms=await phApi('/rest/v1/app_workspace_members?user_id=eq.'+encodeURIComponent(user.id)+'&select=workspace_id&limit=1');if(!ms?.length)return;phWorkspace=ms[0].workspace_id;phSpaces=await phApi('/rest/v1/app_spaces?workspace_id=eq.'+encodeURIComponent(phWorkspace)+'&select=id,name,description,parent_id,status,sort_order&order=sort_order.asc,created_at.asc');phEnhanceGrid();phBind()}catch(e){console.error('project hierarchy ui init',e)}}

phInit();
