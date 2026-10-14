import {validateLinkSummary,updateLinkSummary,SUMMARY_ERROR_TEXT} from './basket-link-records.js?v=4';
import { parseAIAnswer, readClassificationSnapshot, previewClassification, confirmLinks, selectableProjects, ERROR_TEXT } from './basket-classification.js?v=8';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={organization:'담당조직',project:'프로젝트',library:'자료실',write_request_candidate:'쓰기요청 후보',google_task:'Google 할 일'};
export function mountClassification(host,{onOpen,onClose,onBusy,onConfirmed,isBlocked}) {
  host.innerHTML=`<section data-classification-panel hidden aria-labelledby="basketClassificationTitle"><div class="basket-head"><h3 id="basketClassificationTitle">AI 정리 결과</h3><button type="button" class="quick-pill-button" data-classification-close>목록으로</button></div><label class="basket-text-label">AI 답 붙여넣기<textarea data-classification-input rows="6" spellcheck="false" placeholder="답 전체 또는 복사용 블록을 넣으세요."></textarea></label><p>선택된 조직·프로젝트와 요약을 고친 뒤 마지막에 확정하세요.</p><div data-classification-rows></div><div class="modal-action-footer basket-approval-footer"><p data-classification-status class="status" role="status" aria-live="polite"></p><div class="basket-actions basket-compact-actions"><button type="button" class="quick-pill-button" data-classification-preview>확인</button><button type="button" class="quick-pill-button quick-pill-primary" data-classification-confirm disabled>선택 확정</button></div></div></section>`;
  const panel=host.querySelector('[data-classification-panel]'),input=host.querySelector('textarea'),status=host.querySelector('[role="status"]'),rows=host.querySelector('[data-classification-rows]'),button=host.querySelector('[data-classification-confirm]');
  let proposal=null,snapshot=null,preview=[],busy=false,epoch=0,missing=false,uncertain=false;
  const states=new Map();let destinationChoices=[];
  const scope=()=>{const c=window.KPTURuntime.context.read();return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
  let currentScope=scope();
  const selected=()=>[...states.entries()].filter(([,s])=>s.checked&&!s.done&&!s.error&&!s.target?.error);
  const editedProposal=()=>({...proposal,items:proposal.items.map((item,i)=>({...item,destinations:item.destinations.map((target,j)=>{const s=states.get(`${i}:${j}`);return s?{...target,kind:s.kind,target_id:s.targetId}:target;})}))});
  function controls(){panel.querySelector('[data-classification-close]').disabled=busy;input.disabled=busy;panel.querySelector('[data-classification-preview]').disabled=busy;button.disabled=busy||missing||uncertain||!selected().length;button.textContent='선택 확정';if(uncertain)button.textContent='현재 결과 확인 필요';if(missing)button.textContent='연결 기능 준비 중';rows.querySelectorAll('select').forEach(el=>el.disabled=busy);}
  function refreshPreview(live){snapshot=live;const visible=selectableProjects(live.projects.filter(p=>p.workspace_id===live.workspaceId&&p.owner_id===live.userId));destinationChoices=[...live.organizations.filter(o=>o.workspace_id===live.workspaceId).map(o=>({kind:'organization',id:o.id,name:o.name})),...live.projects.filter(p=>visible.has(p.id)).map(p=>({kind:'project',id:p.id,name:p.name}))];preview=previewClassification(editedProposal(),live);for(let i=0;i<preview.length;i++)for(let j=0;j<preview[i].destinations.length;j++){const key=`${i}:${j}`,target=preview[i].destinations[j];let s=states.get(key);if(!s){s={summary:target.reason,kind:target.kind,targetId:target.target_id,checked:!target.error,touched:false,done:false,error:null};states.set(key,s);}else if(s.target?.error&&!target.error&&!s.touched&&!s.done&&!s.error)s.checked=true;s.target=target;}}
  function paint(){
    rows.innerHTML=preview.map((row,i)=>`<article data-classification-note class="basket-classification-note"><h4>${escape([...String(row.note?.raw_text||'메모 '+(i+1)).split(/\r?\n/).find(line=>line.trim())||'메모 '+(i+1)].slice(0,80).join(''))}</h4><details data-classification-original><summary>원문 전체 보기</summary><pre class="basket-classification-original">${escape(row.note?.raw_text??'메모 없음 또는 접근 불가')}</pre></details>${row.error?`<p class="basket-classification-error">${escape(ERROR_TEXT[row.error])}</p>`:''}${row.destinations.map((t,j)=>{
      const key=`${i}:${j}`,s=states.get(key),supported=['organization','project'].includes(t.kind);s.key=key;const error=s.error||t.error;
      const summary=supported?`<label class="basket-text-label basket-summary-label">기록 요약<textarea data-classification-summary="${key}" rows="3" spellcheck="false" ${s.done?'disabled':''}>${escape(s.summary)}</textarea></label>`:'';
      const select=supported&&!s.done?`<label class="basket-target-picker">연결할 곳<select data-classification-target-select="${key}" ${busy?'disabled':''}><option value="${escape(s.kind+':'+s.targetId)}">${escape(names[s.kind]+' · '+t.name)}</option>${destinationChoices.filter(o=>o.kind!==s.kind||o.id!==s.targetId).map(o=>`<option value="${escape(o.kind+':'+o.id)}">${escape(names[o.kind]+' · '+o.name)}</option>`).join('')}</select></label>`:'';
      return `<div class="basket-classification-destination"><label class="basket-classification-target"><input type="checkbox" data-classification-choice="${key}" ${error||s.done?'disabled':''} ${s.checked&&!error&&!s.done?'checked':''}><span><b>${escape(names[t.kind])}${supported?' · '+escape(t.name):''}</b>${supported?`<span>${s.done?escape(s.done):t.action==='update'?'기존 연결 · 요약 수정':'새 연결'}</span>`:''}${error?`<span class="basket-classification-error">${escape(ERROR_TEXT[error]||SUMMARY_ERROR_TEXT[error]||'다시 확인해 주세요.')}</span>`:''}${supported&&t.action==='update'?`<span>현재 요약: ${escape(t.expectedSummary??'요약 없음')}</span>`:''}</span></label>${select}${summary}</div>`;
    }).join('')}</article>`).join('');controls();
  }
  function clear(){++epoch;const wasBusy=busy;busy=false;if(wasBusy)onBusy(false);proposal=null;snapshot=null;preview=[];missing=false;uncertain=false;states.clear();input.value='';rows.replaceChildren();status.textContent='';panel.hidden=true;controls();}
  function close(){if(busy)return;panel.hidden=true;onClose();}
  async function inspect(){
    if(busy||isBlocked())return;const run=++epoch,owner=scope();busy=true;onBusy(true);missing=false;uncertain=false;status.textContent='확인 중…';controls();
    try{
      const parsed=parseAIAnswer(input.value);if(!proposal)proposal=parsed;
      const live=await readClassificationSnapshot(editedProposal());if(run!==epoch||owner!==scope())return;
      // An explicit read resolves uncertain writes; successful items stay completed.
      for(const s of states.values()){if(s.error==='RESULT_UNKNOWN'){
        const index=Number(s.key.split(':')[0]),key=s.kind==='project'?'project_id':'organization_id';
        const link=live.links.find(l=>l.note_id===proposal.items[index].note_id&&l.status==='confirmed'&&l[key]===s.targetId);
        if(link&&link.summary===s.summary){s.done='저장 확인됨';s.checked=false;}
      }s.error=null;}
      refreshPreview(live);paint();status.textContent=`${preview.length}개 메모 · 선택과 요약을 확인해 주세요.`;
    }catch(e){if(run===epoch&&owner===scope()){status.textContent=proposal?'메모와 연결할 곳을 확인하지 못했어요. 다시 눌러 주세요.':e.message;status.scrollIntoView({block:'nearest'});}}
    finally{if(run===epoch){busy=false;onBusy(false);controls();}}
  }
  async function confirm(){
    if(busy||isBlocked()||missing||uncertain||!proposal||!selected().length)return;
    const choices=selected(),approvals=new Map(choices.map(([,state])=>[state,{...state.target,summary:state.summary}]));const destinations=new Set();
    for(const [key,s] of choices){try{validateLinkSummary(s.summary);}catch(error){status.textContent=error.message;rows.querySelector(`[data-classification-summary="${key}"]`)?.focus();return;}
      const identity=`${key.split(':')[0]}:${s.kind}:${s.targetId}`;if(destinations.has(identity)){status.textContent='같은 연결할 곳은 한 번만 선택해 주세요.';return;}destinations.add(identity);
    }
    const run=++epoch,owner=scope(),current=()=>run===epoch&&owner===scope();busy=true;onBusy(true);controls();rows.querySelectorAll('input,textarea,select').forEach(el=>el.disabled=true);status.textContent='저장 중…';let created=0,updated=0,existing=0,inFlight=[];const messages=[];
    const changed=()=>window.dispatchEvent(new Event('kptu:basket-links-changed'));
    const fail=(s,code)=>{s.error=code;s.checked=false;messages.push(ERROR_TEXT[code]||SUMMARY_ERROR_TEXT[code]||'저장하지 못했어요. 다시 확인해 주세요.');if(code==='FUNCTION_UNAVAILABLE')missing=true;if(code==='RESULT_UNKNOWN')uncertain=true;};
    try{
      const live=await readClassificationSnapshot(editedProposal());if(!current())return;
      const fresh=previewClassification(editedProposal(),live);
      for(const [key,s] of choices){const [i,j]=key.split(':').map(Number),t=fresh[i].destinations[j],approved=approvals.get(s);
        if(t.error){fail(s,t.error);continue;}
        if(t.action!==approved.action||t.linkId!==approved.linkId){fail(s,'ALREADY_CONFIRMED');continue;}
        if(t.action==='update'&&t.expectedSummary!==approved.expectedSummary){fail(s,'SUMMARY_CHANGED');continue;}
      }
      for(let i=0;i<preview.length;i++){
        const row=preview[i],group=choices.filter(([key,s])=>Number(key.split(':')[0])===i&&!s.error),creates=group.filter(([,s])=>approvals.get(s).action==='create');
        if(creates.length){
          inFlight=creates.map(([,s])=>s);const targets=inFlight.map(s=>approvals.get(s));
          const result=await confirmLinks(row.item.note_id,row.item.note_updated_at,targets);if(!current()){if(owner===scope()&&(result?.ok||!result))changed();return;}
          if(!result||typeof result.ok!=='boolean')throw Error('unknown');
          if(!result.ok){inFlight.forEach(s=>fail(s,result.error||'PERMISSION_DENIED'));inFlight=[];}
          else{created+=result.created||0;existing+=result.existing||0;changed();
            // Existing links were not summary writes. Require an explicit recheck.
            for(const s of inFlight){s.checked=false;if(result.existing)s.error='ALREADY_CONFIRMED';else s.done='연결 완료';}
            inFlight=[];if(result.existing){const actual=await readClassificationSnapshot(editedProposal());if(!current())return;refreshPreview(actual);}
            const warning=await onConfirmed(row.item.note_id,targets);if(warning)messages.push(warning);if(!current())return;
          }
          inFlight=[];
        }
        for(const [,s] of group.filter(([,s])=>approvals.get(s).action==='update')){
          if(s.error)continue;const approved=approvals.get(s);
          // Summary RPC has no note-version argument: this read is a guard,
          // not an atomic check with the following database summary write.
          const check=await readClassificationSnapshot({items:[row.item]});if(!current())return;
          const checked=previewClassification({items:[{...row.item,destinations:[{kind:approved.kind,target_id:approved.target_id,reason:approved.summary}]}]},check)[0].destinations[0];
          if(checked.error){fail(s,checked.error);continue;}if(checked.linkId!==approved.linkId||checked.expectedSummary!==approved.expectedSummary){fail(s,'SUMMARY_CHANGED');continue;}
          inFlight=[s];const result=await updateLinkSummary(approved.linkId,approved.expectedSummary,approved.summary);if(!current()){if(owner===scope()&&(result.ok||result.error==='RESULT_UNKNOWN'))changed();return;}
          if(!result.ok){fail(s,result.error);if(result.error==='RESULT_UNKNOWN')changed();}
          else{updated++;s.done='요약 저장 완료';s.checked=false;s.target.expectedSummary=s.summary;changed();}
          inFlight=[];
          if(uncertain||missing)break;
        }
        if(uncertain||missing)break;
      }
      status.textContent=[`${created}개 연결했어요 · ${updated}개 요약 저장했어요 · ${existing}개는 이미 연결돼 있어요`,...messages].join(' · ');
    }catch{
      if(!current()){if(owner===scope()&&inFlight.length)changed();return;}
      if(inFlight.length){for(const s of inFlight)fail(s,'RESULT_UNKNOWN');changed();}
      status.textContent=[`${created}개 연결했어요 · ${updated}개 요약 저장했어요`,...messages,inFlight.length?'다시 확인을 눌러 현재 결과를 확인해 주세요.':(created||updated)?'저장은 확인됐지만 최신 목록을 불러오지 못했어요. 다시 확인해 주세요.':'메모와 연결할 곳을 확인하지 못했어요. 다시 확인해 주세요.'].join(' · ');
    }finally{if(run===epoch){busy=false;onBusy(false);if(owner===scope())paint();controls();}}
  }
  host.addEventListener('click',e=>{const el=e.target.closest('button');if(!el)return;if(el.hasAttribute('data-classification-close'))close();else if(el.hasAttribute('data-classification-preview'))void inspect();else if(el.hasAttribute('data-classification-confirm'))void confirm();});
  input.addEventListener('input',()=>{++epoch;proposal=null;snapshot=null;preview=[];missing=false;uncertain=false;states.clear();rows.replaceChildren();status.textContent='내용이 바뀌었습니다. 다시 확인해 주세요.';controls();});
  rows.addEventListener('input',event=>{const key=event.target.dataset.classificationSummary;if(key!==undefined)states.get(key).summary=event.target.value;});
  rows.addEventListener('change',event=>{
    const choice=event.target.dataset.classificationChoice;if(choice!==undefined){states.get(choice).checked=event.target.checked;states.get(choice).touched=true;controls();}
    const key=event.target.dataset.classificationTargetSelect;if(key!==undefined){const opened=[...rows.querySelectorAll('[data-classification-original]')].map(el=>el.open);const s=states.get(key),[kind,id]=event.target.value.split(':');s.kind=kind;s.targetId=id;s.error=null;refreshPreview(snapshot);paint();rows.querySelectorAll('[data-classification-original]').forEach((el,i)=>el.open=opened[i]);rows.querySelector(`[data-classification-target-select="${key}"]`)?.focus();}
  });
  host.addEventListener('keydown',e=>{if(e.key==='Escape'&&!busy){e.preventDefault();close();}});
  window.addEventListener('kptu:view-changed',event=>{if(!event.detail?.retainBasketDraft&&event.detail?.view!=='basket'&&(busy||proposal||input.value||!panel.hidden))clear();});
  window.addEventListener('kptu:session-changed',()=>{const next=scope();if(next===currentScope)return;currentScope=next;clear();});
  return {open(){if(busy||isBlocked()||onOpen()===false)return;panel.hidden=false;input.focus();},isOpen:()=>!panel.hidden,hasDraft:()=>!!input.value,clear};
}
