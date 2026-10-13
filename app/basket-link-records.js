import {formatSeoulTime} from './meeting-time.js?v=2';

const PAGE_SIZE=100;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const contextFor=rt=>typeof rt.context?.read==='function'?(rt.context.read()||{}):(globalThis.window?.__KPTU_BOOT_CONTEXT__||{});
const scope=rt=>{const c=contextFor(rt);return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
const changed=()=>new Error('업무 공간이나 로그인이 바뀌었어요. 다시 확인해 주세요.');
// Match the applied PostgreSQL btrim character set, including NEL and BOM.
const onlyWhitespace=/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/u;
export function validateLinkSummary(value){
  if(typeof value!=='string'||onlyWhitespace.test(value))throw Error('기록 요약을 입력해 주세요.');
  if(value.includes('\0')||value.isWellFormed?.()===false)throw Error('기록 요약의 글자를 확인해 주세요.');
  if([...value].length>2000)throw Error('기록 요약은 2,000자까지 쓸 수 있어요.');
  return value;
}
export async function readRecordPages(path,rt=window.KPTURuntime){
  const owner=scope(rt),rows=[];
  for(let offset=0;;offset+=PAGE_SIZE){
    const page=await rt.api(`${path}&limit=${PAGE_SIZE}&offset=${offset}`);
    if(owner!==scope(rt))throw changed();
    if(!Array.isArray(page))throw Error('기록을 확인하지 못했어요. 다시 시도해 주세요.');
    rows.push(...page);if(page.length<PAGE_SIZE)return rows;
  }
}
export async function readLinkRecords({kind,targetIds,linkId,weekStart,weekEnd,dateOnly=false}={},rt=window.KPTURuntime){
  const context=contextFor(rt),workspaceId=context?.workspace?.id;
  if(!context?.user?.id||!workspaceId)throw changed();
  if(kind&&!['organization','project'].includes(kind))throw Error('연결할 곳을 확인해 주세요.');
  if(targetIds&&!targetIds.length)return [];
  const owner=scope(rt),encode=encodeURIComponent,target=kind==='organization'?'organization_id':'project_id';
  const fields=dateOnly?'id,workspace_id,note_id,organization_id,project_id,status,note:app_notes!inner(id,workspace_id,occurred_at)':'id,workspace_id,summary,note_id,organization_id,project_id,status,note:app_notes!inner(id,workspace_id,occurred_at,raw_text)';
  const base=`/rest/v1/app_record_links?workspace_id=eq.${encode(workspaceId)}&note.workspace_id=eq.${encode(workspaceId)}&status=eq.confirmed&note_id=not.is.null&or=(organization_id.not.is.null,project_id.not.is.null)&select=${fields}&order=id.asc`;
  const batches=targetIds?Array.from({length:Math.ceil(targetIds.length/PAGE_SIZE)},(_,i)=>targetIds.slice(i*PAGE_SIZE,(i+1)*PAGE_SIZE)):[null];
  const rows=[];
  for(const ids of batches){
    const path=base+(ids?`&${target}=in.(${ids.map(encode).join(',')})`:'')+(linkId?`&id=eq.${encode(linkId)}`:'')+(weekStart?`&note.occurred_at=gte.${encode(weekStart)}`:'')+(weekEnd?`&note.occurred_at=lt.${encode(weekEnd)}`:'');
    const page=await readRecordPages(path,rt);
    if(owner!==scope(rt))throw changed();
    for(const row of page){
      const note=row.note;
      if(row.workspace_id!==workspaceId||row.status!=='confirmed'||!row.note_id||!note||note.workspace_id!==workspaceId||note.id!==row.note_id||(!row.organization_id&&!row.project_id))continue;
      if(linkId&&row.id!==linkId||kind&&!row[target]||targetIds&&!targetIds.includes(row[target]))continue;
      if(weekStart&&Date.parse(note.occurred_at)<Date.parse(weekStart)||weekEnd&&Date.parse(note.occurred_at)>=Date.parse(weekEnd))continue;
      rows.push({id:row.id,...(dateOnly?{}:{summary:row.summary??null,raw_text:note.raw_text}),note_id:row.note_id,organization_id:row.organization_id,project_id:row.project_id,occurred_at:note.occurred_at,type:'basket'});
    }
  }
  return rows;
}
export const SUMMARY_ERROR_TEXT=Object.freeze({
  NOT_FOUND:'이 연결 기록을 찾거나 열 수 없어요.',
  PERMISSION_DENIED:'이 기록 요약을 고칠 권한이 없어요.',
  FUNCTION_UNAVAILABLE:'요약 수정 기능이 아직 준비되지 않았어요.',
  INVALID_INPUT:'기록 요약의 글자와 길이를 확인해 주세요.',
  SUMMARY_CHANGED:'다른 곳에서 요약이 바뀌었어요. 최신 내용을 확인해 주세요.',
  RESULT_UNKNOWN:'결과를 확인하지 못했어요. 최신 내용을 확인해 주세요.',
});
export async function updateLinkSummary(id,expected,summary,rt=window.KPTURuntime){
  validateLinkSummary(summary);
  try{
    const result=await rt.api('/rest/v1/rpc/app_basket_update_link_summary',{method:'POST',body:{p_link_id:id,p_expected_summary:expected,p_summary:summary}});
    return result?.ok===true||result?.ok===false&&SUMMARY_ERROR_TEXT[result.error]?result:{ok:false,error:'RESULT_UNKNOWN'};
  }catch(error){
    const message=error?.message||'';
    if(error?.status===404||/PGRST202|Could not find the function|function .*app_basket_update_link_summary.*does not exist/i.test(message))return {ok:false,error:'FUNCTION_UNAVAILABLE'};
    if([401,403].includes(Number(error?.status))||error?.code==='42501')return {ok:false,error:'PERMISSION_DENIED'};
    return {ok:false,error:'RESULT_UNKNOWN'};
  }
}
export function linkRecordHtml(row){
  const date=Number.isFinite(Date.parse(row.occurred_at))?formatSeoulTime(row.occurred_at,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric'}):'';
  return `<div class="basket-link-record" data-basket-link="${escape(row.id)}"><small>바구니 연결 · <time>${escape(date)}</time></small><p data-link-summary-text>${escape(row.summary??'요약 없음')}</p>${row.summary===null?`<p class="muted" data-link-original-excerpt>${escape([...String(row.raw_text||'')].slice(0,120).join(''))}</p>`:''}<div class="basket-link-actions"><a href="?view=basket&amp;note=${escape(encodeURIComponent(row.note_id))}">원문 열기</a><button type="button" class="secondary" data-link-summary-edit="${escape(row.id)}">요약 수정</button></div></div>`;
}

// One delegated editor per detail host; drafts and exact previous strings are
// memory-only. A conflict/unknown result always needs explicit user confirmation.
export function mountLinkSummaryEditor(host,{getRecord,isCurrent=()=>true,onUpdated=()=>{}},rt=window.KPTURuntime){
  const states=new Map();let epoch=0;
  const valid=(state,run,owner)=>run===epoch&&states.get(state.id)===state&&owner===scope(rt)&&isCurrent()&&host.isConnected;
  function clear(){epoch++;states.clear();host.querySelectorAll('[data-link-summary-form]').forEach(form=>form.remove());host.querySelectorAll('[data-link-summary-edit]').forEach(button=>button.disabled=false);}
  function formFor(id){return [...host.querySelectorAll('[data-link-summary-form]')].find(form=>form.dataset.linkSummaryForm===id);}
  function open(id){
    if(!isCurrent())return;const record=getRecord(id);if(!record)return;
    const existing=formFor(id);if(existing){existing.querySelector('textarea')?.focus();return;}
    const row=[...host.querySelectorAll('[data-basket-link]')].find(row=>row.dataset.basketLink===id);if(!row)return;
    const state={id,expected:record.summary??null,busy:false,needsReview:false,latest:null};states.set(id,state);
    row.insertAdjacentHTML('beforeend',`<form data-link-summary-form="${escape(id)}"><details data-link-summary-original><summary>원문 전체 보기</summary><pre class="basket-link-original">${escape(record.raw_text??'')}</pre></details><label>기록 요약<textarea data-link-summary-input rows="3"></textarea></label><p data-link-summary-status role="status" aria-live="polite"></p><div data-link-summary-latest hidden></div><button type="button" class="secondary" data-link-summary-current hidden>최신 요약 확인</button><div class="basket-link-actions"><button type="submit" class="primary" data-link-summary-save>저장</button><button type="button" class="ghost" data-link-summary-cancel>취소</button></div></form>`);
    const form=formFor(id),input=form.querySelector('textarea');input.value=record.summary??'';input.focus();
  }
  async function latest(state,form,run,owner){
    try{
      const records=await readLinkRecords({linkId:state.id},rt);if(!valid(state,run,owner))return;
      const fresh=records[0];if(!fresh){form.querySelector('[data-link-summary-status]').textContent=SUMMARY_ERROR_TEXT.NOT_FOUND;return;}
      state.latest=fresh;const box=form.querySelector('[data-link-summary-latest]');box.hidden=false;box.textContent=`최신 요약: ${fresh.summary??'요약 없음'}`;
      form.querySelector('[data-link-summary-current]').hidden=false;
    }catch{if(valid(state,run,owner)){const box=form.querySelector('[data-link-summary-latest]');box.hidden=false;box.textContent='최신 요약을 불러오지 못했어요. 다시 저장을 눌러 확인해 주세요.';}}
  }
  async function save(form){
    const state=states.get(form.dataset.linkSummaryForm);if(!state||state.busy||!isCurrent())return;
    const run=epoch,owner=scope(rt),input=form.querySelector('textarea'),status=form.querySelector('[data-link-summary-status]');
    if(state.needsReview){await latest(state,form,run,owner);return;}
    let summary;try{summary=validateLinkSummary(input.value);}catch(error){status.textContent=error.message;input.focus();return;}
    const invalidate=()=>{if(owner===scope(rt))window.dispatchEvent(new Event('kptu:basket-links-changed'));};
    let acknowledged=false;
    state.busy=true;form.querySelectorAll('button,textarea').forEach(el=>el.disabled=true);status.textContent='저장 중…';
    try{
      const result=await updateLinkSummary(state.id,state.expected,summary,rt);acknowledged=result.ok===true;if(!valid(state,run,owner)){if(acknowledged||result.error==='RESULT_UNKNOWN')invalidate();return;}
      if(!result.ok){status.textContent=SUMMARY_ERROR_TEXT[result.error]||SUMMARY_ERROR_TEXT.RESULT_UNKNOWN;
        if(['SUMMARY_CHANGED','RESULT_UNKNOWN'].includes(result.error)){state.needsReview=true;await latest(state,form,run,owner);}
        if(result.error==='RESULT_UNKNOWN')invalidate();
        return;
      }
      const fresh=(await readLinkRecords({linkId:state.id},rt))[0];if(!valid(state,run,owner)){invalidate();return;}
      if(!fresh){status.textContent=SUMMARY_ERROR_TEXT.NOT_FOUND;state.needsReview=true;invalidate();return;}
      await onUpdated(fresh);if(!valid(state,run,owner)){invalidate();return;}
      states.delete(state.id);form.remove();window.dispatchEvent(new Event('kptu:basket-links-changed'));
    }catch{
      if(!valid(state,run,owner)){if(acknowledged)invalidate();return;}
      if(valid(state,run,owner)){status.textContent=SUMMARY_ERROR_TEXT.RESULT_UNKNOWN;state.needsReview=true;await latest(state,form,run,owner);invalidate();}
    }finally{
      if(valid(state,run,owner)){state.busy=false;form.querySelectorAll('button,textarea').forEach(el=>el.disabled=false);}
    }
  }
  function click(event){
    const button=event.target.closest?.('button');if(!button||!host.contains(button))return;
    if(button.dataset.linkSummaryEdit){open(button.dataset.linkSummaryEdit);return;}
    const form=button.closest('[data-link-summary-form]'),state=form&&states.get(form.dataset.linkSummaryForm);if(!state||state.busy)return;
    if(button.hasAttribute('data-link-summary-cancel')){states.delete(state.id);form.remove();}
    if(button.hasAttribute('data-link-summary-current')&&state.latest){state.expected=state.latest.summary;state.needsReview=false;form.querySelector('[data-link-summary-status]').textContent='최신 요약을 확인했어요. 작성 중인 글을 저장하려면 저장을 눌러 주세요.';button.hidden=true;form.querySelector('textarea').focus();}
  }
  function submit(event){const form=event.target.closest?.('[data-link-summary-form]');if(form&&host.contains(form)){event.preventDefault();void save(form);}}
  host.addEventListener('click',click);host.addEventListener('submit',submit);
  return {clear,hasDraft:()=>states.size>0,dispose(){clear();host.removeEventListener('click',click);host.removeEventListener('submit',submit);}};
}
