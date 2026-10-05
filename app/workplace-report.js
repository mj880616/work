(()=>{
'use strict';
const rt=window.KPTURuntime;if(!rt)return;
let currentOrgId=null,reports=[],editingReport=null;
const api=(path,options={})=>rt.api(path,options);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function modal(open){
  const element=document.querySelector('#warDraftModal');
  if(!element)return;
  element.classList.toggle('hidden',!open);
  element.setAttribute('aria-hidden',open?'false':'true');
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

async function load(){
  if(!currentOrgId)return;
  reports=await api(`/rest/v1/app_suborganization_weekly_reports?organization_id=eq.${currentOrgId}&select=*&order=week_of.desc&limit=30`);
  render();
}

function detail(id){
  editingReport=reports.find(report=>report.id===id)||null;
  if(!editingReport)return;
  document.querySelector('#warSummary').value=editingReport.summary||'';
  document.querySelector('#warDetail').value=editingReport.detail||'';
  document.querySelector('#warDraftState').textContent='';
  modal(true);
}

async function saveReport(finalize){
  if(!editingReport)return;
  const summary=document.querySelector('#warSummary').value.trim();
  const detailText=document.querySelector('#warDetail').value.trim();
  const status=document.querySelector('#warDraftState');
  if(!summary){status.textContent='요약을 입력해 주세요.';status.className='status error';return}
  const body={summary,detail:detailText||null,updated_at:new Date().toISOString()};
  if(finalize){body.status='final';body.finalized_at=editingReport.finalized_at||new Date().toISOString()}
  try{
    await api(`/rest/v1/app_suborganization_weekly_reports?id=eq.${encodeURIComponent(editingReport.id)}`,{method:'PATCH',body});
    status.textContent=finalize?'주간보고를 확정했습니다.':'주간보고를 수정했습니다.';
    status.className='status ok';
    await load();
    if(finalize)modal(false);
  }catch(error){status.textContent=error.message||String(error);status.className='status error'}
}

function select(id){if(!id)return;currentOrgId=id;install();load().catch(console.error)}
function bind(){
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
