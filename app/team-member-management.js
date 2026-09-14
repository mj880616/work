const tmmRt=window.KPTURuntime;
const TMM_ROLE={owner:'소유자',admin:'관리자',editor:'편집자',author:'작성자',viewer:'열람자'};
let tmmUser=null,tmmWorkspace=null,tmmActorRole=null,tmmTarget=null,tmmTimer=null;
const tmmApi=(p,o={})=>tmmRt.api(p,o);
const tmmRpc=(name,body={})=>tmmApi('/rest/v1/rpc/'+name,{method:'POST',body});
const tmmE=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function tmmStyle(){if(document.querySelector('#tmmStyle'))return;const s=document.createElement('style');s.id='tmmStyle';s.textContent=`
.tmm-box{background:#fbfcfd}.tmm-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end}.tmm-row label{margin:0}.tmm-row select{margin:5px 0 0}.tmm-help{margin:8px 0 0;color:#7c8790;font-size:10px;line-height:1.55}.tmm-danger{margin-top:10px;padding-top:10px;border-top:1px solid #edf0f3;display:flex;align-items:center;justify-content:space-between;gap:10px}.tmm-danger span{font-size:10px;color:#7c8790}.tmm-remove{color:#a33b45!important;border-color:#e6c4c8!important}.tmm-state{font-size:11px;color:#6e7a86}.tmm-status{min-height:17px;margin-top:7px;font-size:10px}.tmm-status.error{color:#a33b45}.tmm-status.success{color:#2f6e4f}@media(max-width:650px){.tmm-row{grid-template-columns:1fr}.tmm-row button{width:100%}.tmm-danger{align-items:flex-start;flex-direction:column}.tmm-danger button{width:100%}}
`;document.head.appendChild(s)}

async function tmmContext(){if(!tmmRt||!(await tmmRt.session.ensure()))return false;tmmUser=await tmmApi('/auth/v1/user');const rows=await tmmApi(`/rest/v1/app_workspace_members?user_id=eq.${tmmUser.id}&select=workspace_id,role&limit=1`);if(!rows?.length)return false;tmmWorkspace=rows[0].workspace_id;tmmActorRole=rows[0].role;return ['owner','admin'].includes(tmmActorRole)}

function tmmOptions(targetRole){const allowed=tmmActorRole==='owner'?['admin','editor','author','viewer']:['editor','author','viewer'];return allowed.map(r=>`<option value="${r}" ${r===targetRole?'selected':''}>${TMM_ROLE[r]}</option>`).join('')}
function tmmCanEdit(target){if(!target||target.user_id===tmmUser?.id||target.role==='owner')return false;if(tmmActorRole==='owner')return true;if(tmmActorRole==='admin'&&target.role!=='admin')return true;return false}

async function tmmRender(){clearTimeout(tmmTimer);const body=document.querySelector('#tpvBody');if(!body||!tmmTarget||document.querySelector('#tpvModal')?.classList.contains('hidden'))return;document.querySelector('#tmmSection')?.remove();let rows=[];try{rows=await tmmApi(`/rest/v1/app_workspace_members?workspace_id=eq.${tmmWorkspace}&user_id=eq.${tmmTarget}&select=user_id,role&limit=1`)}catch{return}const target=rows?.[0];if(!target)return;const sec=document.createElement('section');sec.id='tmmSection';sec.className='tpv-section tmm-box';const editable=tmmCanEdit(target);let inner='<h3>구성원 관리</h3>';
  if(target.user_id===tmmUser?.id)inner+=`<div class="tmm-state">본인 계정의 권한은 이 화면에서 변경하지 않습니다.</div>`;
  else if(target.role==='owner')inner+=`<div class="tmm-state">소유자 계정은 권한 변경·팀 제외 대상에서 보호됩니다.</div>`;
  else if(tmmActorRole==='admin'&&target.role==='admin')inner+=`<div class="tmm-state">관리자 지정·해제는 소유자만 할 수 있습니다.</div>`;
  else if(editable)inner+=`<div class="tmm-row"><label>Workspace 권한<select id="tmmRole">${tmmOptions(target.role)}</select></label><button id="tmmSave" class="secondary" type="button">권한 저장</button></div><p class="tmm-help">${tmmActorRole==='owner'?'관리자·편집자·작성자·열람자로 변경할 수 있습니다.':'편집자·작성자·열람자 사이에서만 변경할 수 있습니다.'}</p>`;
  if(tmmActorRole==='owner'&&target.user_id!==tmmUser?.id&&target.role!=='owner')inner+=`<div class="tmm-danger"><span>팀에서 제외하면 Workspace 접근 권한을 잃습니다.</span><button id="tmmRemove" class="mini tmm-remove" type="button">팀에서 제외</button></div>`;
  inner+='<div id="tmmStatus" class="tmm-status"></div>';sec.innerHTML=inner;body.prepend(sec);
  document.querySelector('#tmmSave')?.addEventListener('click',()=>tmmSave(target));
  document.querySelector('#tmmRemove')?.addEventListener('click',()=>tmmRemove(target));
}

async function tmmSave(target){const select=document.querySelector('#tmmRole'),status=document.querySelector('#tmmStatus');if(!select)return;const role=select.value;if(role===target.role){status.textContent='변경된 권한이 없습니다.';return}if(!confirm(`${TMM_ROLE[target.role]||target.role} → ${TMM_ROLE[role]||role} 권한으로 변경할까요?`))return;status.textContent='변경 중…';status.className='tmm-status';try{await tmmRpc('app_set_workspace_member_role',{p_user:target.user_id,p_role:role});status.textContent='권한을 변경했습니다.';status.className='tmm-status success';window.dispatchEvent(new CustomEvent('kptu:team-members-changed',{detail:{user_id:target.user_id,role}}));setTimeout(()=>tmmRender(),80)}catch(e){status.textContent=e.message||String(e);status.className='tmm-status error'}}

async function tmmRemove(target){const name=document.querySelector('#tpvName')?.textContent||'이 구성원';if(!confirm(`${name} 님을 팀에서 제외할까요?\n\nWorkspace 접근 권한이 즉시 해제됩니다.`))return;const status=document.querySelector('#tmmStatus');status.textContent='처리 중…';status.className='tmm-status';try{
    await Promise.allSettled([
      tmmApi(`/rest/v1/app_suborganization_assignees?user_id=eq.${target.user_id}`,{method:'DELETE'}),
      tmmApi(`/rest/v1/app_profile_workplaces?user_id=eq.${target.user_id}`,{method:'DELETE'})
    ]);
    await tmmApi(`/rest/v1/app_workspace_members?workspace_id=eq.${tmmWorkspace}&user_id=eq.${target.user_id}`,{method:'DELETE'});
    document.querySelector('#tpvClose')?.click();
    window.dispatchEvent(new CustomEvent('kptu:team-members-changed',{detail:{user_id:target.user_id,removed:true}}));
    window.dispatchEvent(new CustomEvent('kptu:suborganization-updated'));
  }catch(e){status.textContent=e.message||String(e);status.className='tmm-status error'}}

function tmmSchedule(uid,ms=120){if(uid)tmmTarget=uid;clearTimeout(tmmTimer);tmmTimer=setTimeout(()=>tmmRender().catch(console.error),ms)}
function tmmBind(){document.addEventListener('click',e=>{const b=e.target.closest?.('[data-tpv-open]');if(b?.dataset.tpvOpen)tmmSchedule(b.dataset.tpvOpen,180)},true);const body=document.querySelector('#tpvBody');if(body)new MutationObserver(()=>{if(tmmTarget&&!document.querySelector('#tmmSection'))tmmSchedule(null,30)}).observe(body,{childList:true,subtree:false});window.addEventListener('kptu:team-members-changed',()=>tmmSchedule(null,40))}

(async()=>{if(!(await tmmContext()))return;tmmStyle();tmmBind()})().catch(console.error);
