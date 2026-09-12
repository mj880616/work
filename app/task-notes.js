const TN_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const TN_KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const TN_SESSION='kptu_collab_session_v1';
let tnNotes=new Map(),tnEditing=null,tnTimer=null,tnLoading=false;

function tnSession(){try{return JSON.parse(localStorage.getItem(TN_SESSION)||'null')}catch{return null}}
async function tnApi(path,{method='GET',body=null}={}){const s=tnSession();if(!s?.access_token)throw new Error('로그인이 필요합니다.');const r=await fetch(TN_SB+path,{method,headers:{apikey:TN_KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:body==null?null:JSON.stringify(body),cache:'no-store'});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}if(!r.ok)throw new Error(d?.message||d?.hint||d?.error_description||('요청 실패 '+r.status));return d}
function tnEsc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function tnRows(){return [...document.querySelectorAll('[data-tl-task-row],[data-pt-task-row]')]}
function tnId(row){return row.dataset.tlTaskRow||row.dataset.ptTaskRow||''}
function tnEditor(id,note){return `<div class="tn-editor" data-tn-wrap="${id}" data-tn-editing="true" data-tn-value="${tnEsc(note||'')}"><textarea class="tn-input" maxlength="1000" placeholder="처리 결과, 섭외 결과, 완료 방식 등을 메모하세요.">${tnEsc(note||'')}</textarea><div class="tn-editor-actions"><button class="mini" data-tn-save="${id}" type="button">저장</button><button class="mini" data-tn-cancel="${id}" type="button">취소</button></div><div class="tn-status"></div></div>`}
function tnDecorate(){
  for(const row of tnRows()){
    const id=tnId(row);if(!id)continue;
    const note=tnNotes.get(id)||'';
    row.querySelectorAll('[data-tn-action],[data-tn-inline],:scope > [data-tn-wrap]').forEach(x=>x.remove());
    const actions=row.querySelector('.tl-task-actions');
    if(actions){const b=document.createElement('button');b.className='mini tn-action';b.type='button';b.dataset.tnAction=id;b.dataset.tnEdit=id;b.textContent='메모';actions.appendChild(b)}
    const content=row.querySelector('.tl-task-content');
    if(content&&String(note).trim()){
      const p=document.createElement('div');p.className='tn-inline-note';p.dataset.tnInline=id;p.innerHTML=`<span>메모</span>${tnEsc(note)}`;content.appendChild(p)
    }
    if(tnEditing===id){const box=document.createElement('div');box.innerHTML=tnEditor(id,note);const node=box.firstElementChild;if(node)row.appendChild(node)}
  }
}
async function tnRefresh(){clearTimeout(tnTimer);tnTimer=setTimeout(async()=>{if(tnLoading)return;const ids=[...new Set(tnRows().map(tnId).filter(Boolean))];if(!ids.length)return;tnLoading=true;try{const rows=await tnApi(`/rest/v1/app_tasks?id=in.(${ids.join(',')})&select=id,note`);tnNotes=new Map(rows.map(x=>[x.id,x.note||'']));tnDecorate()}catch(e){console.error('task notes load',e)}finally{tnLoading=false}},70)}
function tnStartEdit(id){tnEditing=id;tnDecorate();setTimeout(()=>{const input=document.querySelector(`[data-tn-wrap="${CSS.escape(id)}"] .tn-input`);if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length)}},0)}
function tnCancel(){tnEditing=null;tnDecorate()}
async function tnSave(id){const wrap=document.querySelector(`[data-tn-wrap="${CSS.escape(id)}"]`),input=wrap?.querySelector('.tn-input'),status=wrap?.querySelector('.tn-status'),btn=wrap?.querySelector('[data-tn-save]');if(!input)return;const note=input.value.trim();if(btn)btn.disabled=true;if(status)status.textContent='저장 중…';try{await tnApi(`/rest/v1/app_tasks?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{note:note||null,updated_at:new Date().toISOString()}});tnNotes.set(id,note);tnEditing=null;tnDecorate()}catch(e){if(status)status.textContent='저장 실패 · '+(e.message||String(e));if(btn)btn.disabled=false}}
function tnInstallStyle(){if(document.querySelector('#tnStyle'))return;const s=document.createElement('style');s.id='tnStyle';s.textContent=`
.tn-inline-note{margin-top:4px;color:#68737e;font-size:11px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.tn-inline-note span{font-weight:850;color:#46515c;margin-right:6px}.tn-action{white-space:nowrap}.tl-task-row>.tn-editor{grid-column:1/-1;margin-top:2px}.tn-editor{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;align-items:start;padding-top:6px;border-top:1px dashed #e4e8ec}.tn-input{grid-column:1/-1;width:100%;min-height:58px;resize:vertical;padding:7px 9px;border:1px solid #aeb6bf;border-radius:8px;background:#fff;font:inherit;font-size:12px;line-height:1.5}.tn-editor-actions{display:flex;gap:5px}.tn-status{font-size:10px;color:#a33b45;align-self:center}
@media(max-width:700px){
  .tl-task-section{padding:9px!important}.tl-section-head{margin-bottom:6px!important}.tl-task-row{gap:5px!important;padding:8px 2px!important}.tl-task-content b{font-size:13px!important;line-height:1.35}.tl-task-content small,.tl-task-content em{display:inline!important;font-size:10.5px!important;margin-top:2px!important;margin-right:6px}.tl-task-meta{display:flex!important;flex-wrap:wrap!important;gap:5px 12px!important;background:transparent!important;border-radius:0!important;padding:0!important}.tl-task-meta span{font-size:11px!important;color:#65717d}.tl-task-meta i{display:inline!important;font-size:10px!important;margin-right:3px!important}.tl-task-actions{gap:4px!important;justify-content:flex-start!important}.tl-task-actions .mini{padding:5px 7px!important;font-size:10.5px!important;min-height:29px!important}.tn-inline-note{margin-top:3px;font-size:10.5px;line-height:1.4}.tn-editor{grid-template-columns:1fr;padding-top:5px}.tn-input{min-height:56px}.tn-editor-actions{grid-column:1}.tn-status{grid-column:1}.pt-form{gap:6px!important;margin-top:8px!important;padding-top:8px!important}
}
`;document.head.appendChild(s)}
function tnBind(){document.addEventListener('click',e=>{const edit=e.target.closest?.('[data-tn-edit]');if(edit){e.preventDefault();e.stopPropagation();tnStartEdit(edit.dataset.tnEdit);return}const save=e.target.closest?.('[data-tn-save]');if(save){e.preventDefault();e.stopPropagation();tnSave(save.dataset.tnSave);return}const cancel=e.target.closest?.('[data-tn-cancel]');if(cancel){e.preventDefault();e.stopPropagation();tnCancel()}},true);document.addEventListener('keydown',e=>{const input=e.target.closest?.('.tn-input');if(!input)return;const wrap=input.closest('[data-tn-wrap]');if(e.key==='Escape'){e.preventDefault();tnCancel()}if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();tnSave(wrap?.dataset.tnWrap)}},true);for(const root of [document.querySelector('#tlTaskSections'),document.querySelector('#projectTaskList')])if(root)new MutationObserver(()=>tnRefresh()).observe(root,{childList:true,subtree:true});const bodyObs=new MutationObserver(()=>{const a=document.querySelector('#tlTaskSections'),b=document.querySelector('#projectTaskList');if(a&&!a.dataset.tnObs){a.dataset.tnObs='1';new MutationObserver(()=>tnRefresh()).observe(a,{childList:true,subtree:true})}if(b&&!b.dataset.tnObs){b.dataset.tnObs='1';new MutationObserver(()=>tnRefresh()).observe(b,{childList:true,subtree:true})}tnRefresh()});bodyObs.observe(document.body,{childList:true,subtree:true})}

(async()=>{tnInstallStyle();tnBind();await tnRefresh()})();
