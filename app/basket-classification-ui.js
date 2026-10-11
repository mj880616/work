import { parseAIAnswer, readClassificationSnapshot, previewClassification, confirmLinks, ERROR_TEXT } from './basket-classification.js?v=3';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountClassification(host,{onOpen,onClose,onBusy,onConfirmed,isBlocked}) {
  host.innerHTML=`<section data-classification-panel hidden aria-labelledby="basketClassificationTitle"><div class="basket-head"><h3 id="basketClassificationTitle">AI 정리 결과 넣기</h3><button type="button" data-classification-close>목록으로</button></div><label class="basket-text-label">AI가 준 복사용 블록(답 전체를 넣어도 됨)<textarea data-classification-input rows="12" spellcheck="false" placeholder="ChatGPT나 Claude의 답을 여기에 붙여 넣으세요."></textarea></label><p>지금 저장된 메모와 연결할 곳을 확인해요. 체크한 담당조직·프로젝트만 연결해요.</p><div class="basket-actions"><button type="button" data-classification-preview>확인</button><button type="button" data-classification-confirm disabled>연결하기</button></div><p data-classification-status role="status" aria-live="polite"></p><div data-classification-rows></div></section>`;
  const panel=host.querySelector('[data-classification-panel]'),input=host.querySelector('textarea'),status=host.querySelector('[role="status"]'),rows=host.querySelector('[data-classification-rows]'),button=host.querySelector('[data-classification-confirm]');
  let proposal=null,snapshot=null,preview=[],busy=false,epoch=0,missing=false;
  const scope=()=>{const c=window.KPTURuntime.context.read();return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
  let currentScope=scope();
  const selected=()=>[...rows.querySelectorAll('[data-classification-choice]:checked:enabled')];
  function controls(){panel.querySelector('[data-classification-close]').disabled=busy;input.disabled=busy;panel.querySelector('[data-classification-preview]').disabled=busy;button.disabled=busy||missing||!selected().length;button.textContent=missing?'연결 기능 준비 중':'연결하기';}
  function paint(){
    rows.innerHTML=preview.map((row,i)=>`<article data-classification-note class="basket-classification-note"><h4>메모 ${i+1}</h4><pre class="basket-classification-original">${escape(row.note?.raw_text??'메모 없음 또는 접근 불가')}</pre>${row.error?`<p class="basket-classification-error">${escape(ERROR_TEXT[row.error])}</p>`:''}${row.destinations.map((t,j)=>`<label class="basket-classification-target"><input type="checkbox" data-classification-choice="${i}:${j}" ${t.error?'disabled':''}><span><b>${escape(({organization:'담당조직',project:'프로젝트',library:'자료실',write_request_candidate:'쓰기요청 후보',google_task:'Google 할 일'})[t.kind])}${['organization','project'].includes(t.kind)?' · '+escape(t.name):''}</b><span class="basket-classification-reason">${escape(t.reason)}</span>${t.error?`<span class="basket-classification-error">${escape(ERROR_TEXT[t.error])}</span>`:''}</span></label>`).join('')}</article>`).join('');controls();
  }
  function clear(){++epoch;busy=false;onBusy(false);proposal=null;snapshot=null;preview=[];missing=false;input.value='';rows.replaceChildren();status.textContent='';panel.hidden=true;controls();}
  function close(){if(busy)return;panel.hidden=true;onClose();}
  async function inspect(){
    if(busy||isBlocked())return;const run=++epoch,owner=scope();busy=true;onBusy(true);missing=false;proposal=null;preview=[];rows.replaceChildren();status.textContent='확인 중…';controls();
    let parsed;
    try{parsed=parseAIAnswer(input.value);}catch(e){status.textContent=e.message;busy=false;onBusy(false);controls();return;}
    try{const live=await readClassificationSnapshot(parsed);if(run!==epoch||owner!==scope())return;
      proposal=parsed;snapshot=live;preview=previewClassification(parsed,live);paint();status.textContent=`${preview.length}개 메모 · 연결할 곳을 골라 주세요.`;
    }catch{if(run===epoch&&owner===scope())status.textContent='메모와 연결할 곳을 확인하지 못했어요. 다시 눌러 주세요.';}
    finally{if(run===epoch){busy=false;onBusy(false);controls();}}
  }
  async function confirm(){
    if(busy||isBlocked()||missing||!proposal||!selected().length)return;
    const choices=selected().map(el=>el.dataset.classificationChoice.split(':').map(Number));
    const groups=preview.map((row,i)=>({row,targets:choices.filter(([index])=>index===i).map(([,j])=>row.destinations[j]).filter(t=>!t.error)})).filter(g=>g.targets.length);
    const run=++epoch,owner=scope();busy=true;onBusy(true);controls();rows.querySelectorAll('input').forEach(el=>el.disabled=true);status.textContent='연결 중…';let created=0,existing=0;const messages=[];
    try{
      for(const {row,targets} of groups){
        const result=await confirmLinks(row.item.note_id,row.item.note_updated_at,targets);
        if(run!==epoch||owner!==scope())return;
        if(!result?.ok){const code=result?.error||'PERMISSION_DENIED';messages.push(ERROR_TEXT[code]||'연결하지 못했어요. 다시 확인해 주세요.');
          if(code==='FUNCTION_UNAVAILABLE'){missing=true;break;}
          row.error=code;row.destinations.forEach(t=>t.error=code);continue;
        }
        created+=result.created||0;existing+=result.existing||0;
        for(const target of targets)snapshot.links.push({note_id:row.item.note_id,status:'confirmed',[target.kind==='project'?'project_id':'organization_id']:target.target_id});
        const warning=await onConfirmed(row.item.note_id,targets);if(warning)messages.push(warning);
        if(run!==epoch||owner!==scope())return;
        row.destinations=previewClassification({items:[row.item]},snapshot)[0].destinations;
      }
      status.textContent=[`${created}개 연결했어요 · ${existing}개는 이미 연결돼 있어요`,...messages].join(' · ');
    }catch(e){if(run===epoch&&owner===scope()){
      // A network failure may be an acknowledged write lost in transit. Never
      // retry automatically: an explicit fresh preview resolves current links.
      preview.forEach(row=>row.destinations.forEach(t=>{if(!t.error)t.error='PERMISSION_DENIED';}));
      status.textContent=`${created}개 연결했어요 · ${existing}개는 이미 연결돼 있어요 · 결과를 확인하지 못했어요. 다시 확인을 눌러 현재 연결을 확인해 주세요.`;
    }}finally{if(run===epoch){busy=false;onBusy(false);if(owner===scope())paint();controls();}}
  }
  host.addEventListener('click',e=>{const el=e.target.closest('button');if(!el)return;if(el.hasAttribute('data-classification-close'))close();else if(el.hasAttribute('data-classification-preview'))void inspect();else if(el.hasAttribute('data-classification-confirm'))void confirm();});
  input.addEventListener('input',()=>{++epoch;proposal=null;preview=[];missing=false;rows.replaceChildren();status.textContent='내용이 바뀌었습니다. 다시 확인해 주세요.';controls();});
  rows.addEventListener('change',controls);
  host.addEventListener('keydown',e=>{if(e.key==='Escape'&&!busy){e.preventDefault();close();}});
  window.addEventListener('kptu:session-changed',()=>{const next=scope();if(next===currentScope)return;currentScope=next;clear();});
  return {open(){if(busy||isBlocked()||onOpen()===false)return;panel.hidden=false;input.focus();},isOpen:()=>!panel.hidden,hasDraft:()=>!!input.value,clear};
}
