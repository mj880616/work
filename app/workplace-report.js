(()=>{
'use strict';
const rt=window.KPTURuntime;if(!rt)return;
let currentOrgId=null,reports=[],editingReport=null,reportSequence=0,reportView=0,reportRead=0,reportEditor=null,reportObservedScope=null;const reportAttempts=new Map();
const api=(path,options={})=>rt.api(path,options);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function modal(open){
  if(!open){reportSequence++;reportEditor=null}
  const element=document.querySelector('#warDraftModal');
  if(!element)return;
  const wasHidden=element.classList.contains('hidden'),trigger=document.activeElement;
  element.classList.toggle('hidden',!open);
  element.setAttribute('aria-hidden',open?'false':'true');
  if(open&&wasHidden)window.KPTUA11y?.dialog.activate(element,{trigger,initialFocus:'#warSummary',onRequestClose:()=>modal(false)});
  else if(!open&&!wasHidden)window.KPTUA11y?.dialog.deactivate(element,{restoreFocus:true});
}

function install(){
  const slot=document.querySelector('#wdReportSlot');
  if(!slot||document.querySelector('#warPanel'))return;
  slot.insertAdjacentHTML('beforeend','<div id="warPanel"><div class="wd-head"><h4>주간보고 기록</h4></div><div id="warReports"></div></div>');
  document.body.insertAdjacentHTML('beforeend',`<div id="warDraftModal" class="modal hidden" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="warDraftTitle"><div class="modal-card medium-card"><div class="modal-head"><h2 id="warDraftTitle">주간보고 수정</h2><button id="warDraftClose" class="icon-btn" type="button" aria-label="닫기">×</button></div><label>요약 · 주간보고 본문<textarea id="warSummary" rows="7"></textarea></label><label>상세보고<textarea id="warDetail" rows="12"></textarea></label><div class="two-col"><button id="warSaveDraft" class="secondary" type="button">수정 저장</button><button id="warFinalize" class="primary" type="button">검수 후 확정</button></div><div id="warDraftState" class="status"></div></div></div>`);
  document.querySelector('#warDraftClose').onclick=()=>modal(false);
  document.querySelector('#warSaveDraft').onclick=()=>saveReport(false);
  document.querySelector('#warFinalize').onclick=()=>saveReport(true);
  const style=document.createElement('style');
  style.id='warStyle';
  style.textContent='.war-report{border:1px solid var(--kptu-border);border-radius:10px;padding:9px;margin-top:7px;background:var(--kptu-surface-subtle)}.war-report small{color:var(--kptu-muted)}.war-report p{white-space:pre-wrap;margin:5px 0 0;font-size:11px;line-height:1.5}.war-report button{margin-top:6px}';
  document.head.appendChild(style);
}

function render(){
  const box=document.querySelector('#warReports');
  if(!box)return;
  box.innerHTML=reports.length?reports.map(report=>`<div class="war-report"><small>${esc(report.week_of)} · ${report.status==='final'?'확정':'초안'}</small><p><b>${esc(report.summary||'요약 없음')}</b></p><button class="mini" type="button" data-war-detail="${esc(report.id)}">열기</button></div>`).join(''):'<div class="empty compact">주간보고 기록이 없습니다.</div>';
}

function reportScope(){const epoch=rt.session?.epoch?.(),context=rt.context?.read?.(),owner=rt.session?.read?.()?.user?.id;return Number.isInteger(epoch)&&epoch>=0&&owner&&context?.user?.id===owner&&context?.workspace?.id?{owner,workspace:context.workspace.id,epoch}:null}
function reportSameScope(scope){const now=reportScope();return !!scope&&!!now&&['owner','workspace','epoch'].every(k=>scope[k]===now[k])}
function reportCurrent(e){return reportEditor===e&&e.sequence===reportSequence&&e.view===reportView&&currentOrgId===e.orgId&&editingReport?.id===e.id&&reportSameScope(e.scope)&&!document.querySelector('#warDraftModal')?.classList.contains('hidden')}
function reportKey(e){return [e.scope.owner,e.scope.workspace,e.scope.epoch,e.orgId,e.id].join(':')}
function reportDraft(){return JSON.stringify([document.querySelector('#warSummary')?.value??'',document.querySelector('#warDetail')?.value??''])}
function reportPath(e){return `/rest/v1/app_suborganization_weekly_reports?id=eq.${encodeURIComponent(e.id)}&organization_id=eq.${encodeURIComponent(e.orgId)}&select=*`}
function reportRow(e,rows,body){const row=Array.isArray(rows)&&rows.length===1&&rows[0];if(!row||row.id!==e.id||row.organization_id!==e.orgId||!Object.entries(body).every(([k,v])=>k==='updated_at'?Number.isFinite(Date.parse(row[k])):k==='finalized_at'?Date.parse(row[k])===Date.parse(v):JSON.stringify(row[k])===JSON.stringify(v)))throw new Error('주간보고의 저장 결과를 확인하지 못했습니다.');return row}
function reportNotice(e,text,check=false){if(!reportCurrent(e))return;const st=document.querySelector('#warDraftState');st.textContent=text;st.className='status';if(check){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent='저장 결과 확인';b.onclick=()=>checkReport(e);st.append(document.createTextNode(' '),b)}}
function reportBusy(on){document.querySelector('#warSaveDraft').disabled=on;document.querySelector('#warFinalize').disabled=on}
async function checkReport(e){const key=reportKey(e),a=reportAttempts.get(key);if(!a||a.pending||a.reading||!reportCurrent(e))return;a.reading=true;const current=()=>reportCurrent(e)&&reportAttempts.get(key)===a;try{const rows=await api(reportPath(e),{expectedSessionEpoch:e.scope.epoch,singleFlight:false});if(!current())return;const row=reportRow(e,rows,a.body);Object.assign(editingReport,row);reportAttempts.delete(key);reportNotice(e,'제출한 주간보고는 확인했습니다. 현재 입력은 남겨두었습니다.')}catch{if(current())reportNotice(e,'저장 결과를 아직 확인하지 못했습니다. 입력을 유지했으며 다시 저장하지 않았습니다.',true)}finally{a.reading=false}}
async function load(){
  const orgId=currentOrgId,view=reportView,scope=reportScope(),read=++reportRead;if(!orgId)return;
  const rows=await api(`/rest/v1/app_suborganization_weekly_reports?organization_id=eq.${encodeURIComponent(orgId)}&select=*&order=week_of.desc&limit=30`,{expectedSessionEpoch:scope?.epoch??null,singleFlight:false});
  if(read!==reportRead||view!==reportView||orgId!==currentOrgId||(scope&&!reportSameScope(scope)))return;
  if(!Array.isArray(rows)||rows.some(r=>r.organization_id!==orgId))throw new Error('주간보고 목록을 확인하지 못했습니다.');reports=rows;render();
}

function detail(id){
  editingReport=reports.find(report=>report.id===id)||null;
  if(!editingReport||editingReport.organization_id!==currentOrgId)return;
  document.querySelector('#warSummary').value=editingReport.summary||'';
  document.querySelector('#warDetail').value=editingReport.detail||'';
  document.querySelector('#warDraftState').textContent='';
  const e={id:editingReport.id,orgId:editingReport.organization_id,scope:reportScope(),sequence:++reportSequence,view:reportView};reportEditor=e;if(e.scope)reportObservedScope={...e.scope};modal(true);
  const a=e.scope&&reportAttempts.get(reportKey(e));reportBusy(!!a?.pending);
  if(a?.pending){reportNotice(e,'앞선 저장 결과를 기다리는 중입니다.');a.done.then(()=>{if(reportCurrent(e)){reportBusy(false);reportNotice(e,'앞선 요청이 끝났습니다. 현재 입력은 유지했습니다.',a.state==='unknown')}})}else if(a)reportNotice(e,'앞선 저장 결과를 먼저 확인해 주세요.',true);
}

async function saveReport(finalize){
  const e=reportEditor;if(!editingReport||!e)return;
  if(!e.scope||!reportSameScope(e.scope)){const st=document.querySelector('#warDraftState');st.textContent='로그인 상태를 확인하지 못했습니다. 입력은 남겨두었습니다.';st.className='status error';return}if(!reportCurrent(e))return;
  const key=reportKey(e),old=reportAttempts.get(key);if(old?.pending||old?.state==='unknown'){reportNotice(e,'앞선 저장 결과를 먼저 확인해 주세요.',!old.pending);return}
  const summary=document.querySelector('#warSummary').value.trim(),detailText=document.querySelector('#warDetail').value.trim();if(!summary){reportNotice(e,'요약을 입력해 주세요.');return}
  const body={summary,detail:detailText||null,updated_at:new Date().toISOString()};if(finalize){body.status='final';body.finalized_at=editingReport.finalized_at||new Date().toISOString()}
  const a={body,draft:reportDraft(),pending:true,state:'pending'};a.done=new Promise(resolve=>a.finish=resolve);e.request=a;reportAttempts.set(key,a);reportBusy(true);reportNotice(e,'저장 중…');
  try{
    const rows=await api(reportPath(e),{method:'PATCH',body,prefer:'return=representation',expectedSessionEpoch:e.scope.epoch});const row=reportRow(e,rows,body);a.state='confirmed';
    if(!reportSameScope(e.scope))return;if(reportAttempts.get(key)===a)reportAttempts.delete(key);
    // The first confirmed finalization remains the baseline across editor lifetimes.
    if(currentOrgId===e.orgId){
      reports=reports.map(r=>r.id===row.id?structuredClone(row):r);
      if(editingReport?.id===e.id&&editingReport.organization_id===e.orgId)Object.assign(editingReport,row);
    }
    if(!reportCurrent(e))return;
    render();
    if(reportDraft()===a.draft){reportBusy(false);modal(false)}else reportNotice(e,'제출한 주간보고는 저장했습니다. 추가 입력은 남겨두었습니다.');
  }catch(err){a.state=[401,403].includes(err?.status)?'rejected':'unknown';if(a.state==='rejected'&&reportSameScope(e.scope)&&reportAttempts.get(key)===a)reportAttempts.delete(key);reportNotice(e,a.state==='rejected'?'주간보고 수정 권한을 확인해 주세요. 입력은 유지했습니다.':'저장 결과를 확인하지 못했습니다. 입력을 유지했습니다.',a.state==='unknown')}
  finally{a.pending=false;a.finish();if(e.request===a&&reportCurrent(e))reportBusy(false)}
}

function select(id){if(!id)return;if(id!==currentOrgId){reportView++;modal(false)}currentOrgId=id;install();load().catch(console.error)}
function bind(){
  window.addEventListener('kptu:session-changed',()=>{if(reportSameScope(reportObservedScope))return;reportObservedScope=null;reportAttempts.clear();reportView++;reportRead++;modal(false);editingReport=null;reports=[];currentOrgId=null;document.querySelector('#warSummary').value='';document.querySelector('#warDetail').value=''});
  window.addEventListener('kptu:view-changed',()=>{reportView++;modal(false)});
  window.addEventListener('kptu:dialog-closed',event=>{if(['warDraftModal','wdModal'].includes(event.detail?.modal?.id)){reportSequence++;reportEditor=null}});

  window.addEventListener('kptu:workplace-detail-rendered',event=>select(event.detail?.id));
  document.addEventListener('click',event=>{const button=event.target.closest?.('[data-war-detail]');if(button)detail(button.dataset.warDetail)});
}
async function init(){
  if(!(await rt.session.ensure()))return;
  install();bind();
  const modalElement=document.querySelector('#wdModal');
  if(modalElement?.dataset.orgId)select(modalElement.dataset.orgId);
}
init();
})();
