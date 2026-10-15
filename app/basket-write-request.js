// BASKET-4b-2: a basket note can be marked as a write-request candidate for the
// Drive ledger. Web2 never writes the ledger: it keeps one candidate per note in
// app_notes.metadata.write_request and builds plain text the person copies to
// ChatGPT themselves. Same owner-RLS REST PATCH as BASKET-할일출처 (metadata only,
// updated_at untouched). No new table, policy, RPC or Edge function.
import {noteTaskGuard} from './basket-note-tasks.js?v=2';

export const WRITE_REQUEST_REASON_LIMIT=500;
const plainObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const isTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));

export function validWriteRequest(value){
  if(!plainObject(value))return false;
  if(typeof value.reason!=='string'||[...value.reason].length>WRITE_REQUEST_REASON_LIMIT)return false;
  if(!isTime(value.marked_at))return false;
  return value.handed_off_at===null||isTime(value.handed_off_at);
}
// The candidate on this note, or null. A malformed value is never shown.
export function noteWriteRequest(note){
  const value=plainObject(note?.metadata)?note.metadata.write_request:null;
  return validWriteRequest(value)?{reason:value.reason,marked_at:value.marked_at,handed_off_at:value.handed_off_at}:null;
}
// The reason is optional; it is kept as plain text, trimmed, within the limit.
export function writeRequestReasonProblem(reason){
  return [...String(reason??'').trim()].length>WRITE_REQUEST_REASON_LIMIT?`이유는 ${WRITE_REQUEST_REASON_LIMIT}자까지 쓸 수 있어요.`:'';
}
export function writeRequestEntry(reason,now=new Date()){
  const entry={reason:String(reason??'').trim(),marked_at:now.toISOString(),handed_off_at:null};
  if(!validWriteRequest(entry))throw Error(`이유는 ${WRITE_REQUEST_REASON_LIMIT}자까지 쓸 수 있어요.`);
  return entry;
}
// Every other metadata key (tasks and the rest) is kept as it is.
export function withWriteRequest(metadata,entry){
  const base=plainObject(metadata)?{...metadata}:{};
  if(entry)base.write_request={reason:entry.reason,marked_at:entry.marked_at,handed_off_at:entry.handed_off_at};
  else delete base.write_request;
  return base;
}
// The original's version, the first listed task and this candidate must all be
// as the screen read them, so no writer drops another writer's change.
// noteTaskGuard already carries the updated_at, tasks and marked_at conditions.
export function writeRequestGuard(note,{empty=false}={}){
  const guard=noteTaskGuard(note);
  return empty?guard.replace(/&metadata->write_request->>marked_at=[^&]*/,'')+'&metadata->write_request=is.null':guard;
}

// Text for the person to paste into ChatGPT. It says plainly that this is only
// a candidate; it carries no instruction to write the ledger or run anything.
export function writeRequestCopyText(note,request,{origin=location.href}={}){
  const link=new URL(`./?view=basket&note=${encodeURIComponent(note.id)}`,origin).href;
  return [
    '[쓰기요청 후보 · 미제출]',
    '이 글은 Web2 바구니 메모의 쓰기요청 후보예요. 아직 원장에 기록되지 않았어요.',
    '',
    `이유: ${request?.reason||'(적지 않음)'}`,
    `메모 링크: ${link}`,
    '',
    '메모 원문:',
    note.raw_text||'(글 없이 첨부만 있는 메모)',
  ].join('\n');
}

function workspaceId(rt){
  const id=rt.context.read()?.workspace?.id;
  if(!id)throw Error('업무 공간을 확인할 수 없어요.');
  return encodeURIComponent(id);
}
// One conditional PATCH, never resent. Zero rows or an unclear result is
// settled by one fresh read. Returns {status,note?} where status is
// ok | already | changed | not_saved | unknown.
async function applyWriteRequest(note,{metadata,guard,done,onZero},{rt,expectedSessionEpoch}){
  const options=expectedSessionEpoch==null?{}:{expectedSessionEpoch};
  let base;try{base=`/rest/v1/app_notes?id=eq.${encodeURIComponent(note.id)}&workspace_id=eq.${workspaceId(rt)}`;}catch{return {status:'unknown'};}
  const select='select=id,updated_at,metadata';
  const reread=async()=>{
    try{const rows=await rt.api(`${base}&${select}`,{singleFlight:false,...options});return Array.isArray(rows)&&rows.length<=1?{ok:true,note:rows[0]||null}:{ok:false};}
    catch{return {ok:false};}
  };
  let saved;
  try{saved=await rt.api(`${base}&${guard}&${select}`,{method:'PATCH',prefer:'return=representation',body:{metadata},...options});}
  catch{saved=undefined;}
  if(Array.isArray(saved)&&saved.length===1&&done(saved[0]))return {status:'ok',note:saved[0]};
  const fresh=await reread();
  if(!fresh.ok)return {status:'unknown'};
  if(fresh.note&&done(fresh.note))return {status:'ok',note:fresh.note};
  // Nothing matched the guard: someone else changed the note first.
  if(Array.isArray(saved)&&!saved.length)return {status:onZero(fresh.note),note:fresh.note};
  return {status:'not_saved',note:fresh.note};
}
export function markWriteRequest(note,reason,{rt=window.KPTURuntime,expectedSessionEpoch=null,now=new Date()}={}){
  const entry=writeRequestEntry(reason,now);
  return applyWriteRequest(note,{
    metadata:withWriteRequest(note.metadata,entry),
    guard:writeRequestGuard(note,{empty:true}),
    done:fresh=>noteWriteRequest(fresh)?.marked_at===entry.marked_at,
    onZero:fresh=>noteWriteRequest(fresh)?'already':'changed',
  },{rt,expectedSessionEpoch});
}
export function handOffWriteRequest(note,{rt=window.KPTURuntime,expectedSessionEpoch=null,now=new Date()}={}){
  const current=noteWriteRequest(note);
  if(!current)return Promise.resolve({status:'changed'});
  return applyWriteRequest(note,{
    metadata:withWriteRequest(note.metadata,{...current,handed_off_at:current.handed_off_at||now.toISOString()}),
    guard:writeRequestGuard(note),
    done:fresh=>{const value=noteWriteRequest(fresh);return value?.marked_at===current.marked_at&&!!value.handed_off_at;},
    onZero:()=> 'changed',
  },{rt,expectedSessionEpoch});
}
export function cancelWriteRequest(note,{rt=window.KPTURuntime,expectedSessionEpoch=null}={}){
  const current=noteWriteRequest(note);
  if(!current)return Promise.resolve({status:'ok',note});
  return applyWriteRequest(note,{
    metadata:withWriteRequest(note.metadata,null),
    guard:writeRequestGuard(note),
    // Only this candidate is removed; a newer one marked elsewhere is kept.
    done:fresh=>noteWriteRequest(fresh)?.marked_at!==current.marked_at,
    onZero:()=> 'changed',
  },{rt,expectedSessionEpoch});
}

const RESULT_TEXT={
  mark:{ok:'쓰기요청 후보로 표시했어요. 원장에는 아직 기록되지 않았어요.',already:'이미 쓰기요청 후보예요.'},
  handoff:{ok:'ChatGPT에 넘겼다고 표시했어요. 원장에 기록됐는지는 Web2가 알 수 없어요.'},
  cancel:{ok:'쓰기요청 후보를 취소했어요.'},
  changed:'메모가 바뀌었어요. [메모 다시 불러오기]로 다시 열어 주세요.',
  not_saved:'저장되지 않았어요. 다시 눌러 주세요.',
  unknown:'확인하지 못했어요. 다시 보내지 않아요. [메모 다시 불러오기]로 확인해 주세요.',
};
// One reason form and one candidate box inside the basket read view. basket.js
// keeps owning the detail; this controller owns only what it draws in its host.
export function mountWriteRequest({esc,rt=window.KPTURuntime,getNote,isBusy,setBusy,onSaved,onUnknown,onModeChange,copy=text=>navigator.clipboard.writeText(text)}){
  const scope=()=>{const c=rt.context.read();return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
  let host=null,noteId=null,form=null,status='',unknown=false,manual=null,seq=0;
  const note=()=>{const n=getNote();return n&&n.id===noteId?n:null;};
  function boxMarkup(n,request){
    const handed=!!request.handed_off_at;
    return `<section class="basket-write-request" data-write-request-box aria-labelledby="basketWriteRequestTitle"><h3 id="basketWriteRequestTitle">쓰기요청 후보(${handed?'ChatGPT에 넘김':'미제출'})</h3>
<p class="basket-write-request-reason">${request.reason?`이유: ${esc(request.reason)}`:'이유: 적지 않음'}</p>
<p class="basket-manual-hint">원장에는 아직 기록되지 않았어요. 복사한 글을 ChatGPT에 직접 넘겨 주세요.</p>
<div class="basket-actions basket-write-request-actions"><button type="button" class="primary" data-write-request-copy>ChatGPT에 넘길 글 복사</button>${handed?'':'<button type="button" class="secondary" data-write-request-handoff>넘겼어요</button>'}<button type="button" class="secondary" data-write-request-cancel>후보 취소</button></div>
${manual===null?'':`<label class="basket-text-label">복사할 글(길게 눌러 직접 복사해 주세요)<textarea data-write-request-manual readonly rows="8">${esc(manual)}</textarea></label>`}
<p data-write-request-status role="status">${esc(status)}</p></section>`;
  }
  function formMarkup(){
    return `<section class="basket-write-request" data-write-request-form aria-labelledby="basketWriteRequestFormTitle"><h3 id="basketWriteRequestFormTitle">쓰기요청 후보로 표시</h3>
<label class="basket-text-label">왜 원장에 남길까요?(선택)<textarea data-write-request-reason rows="3" maxlength="${WRITE_REQUEST_REASON_LIMIT}" spellcheck="false">${esc(form.reason)}</textarea></label>
<p class="basket-manual-hint">후보로 표시해도 원장에는 기록되지 않아요. 메모 하나에 후보는 하나예요.</p>
<p data-write-request-status role="status">${esc(status)}</p>
<div class="basket-actions basket-write-request-actions"><button type="button" class="primary" data-write-request-save>후보로 표시</button><button type="button" class="secondary" data-write-request-form-cancel>취소</button></div></section>`;
  }
  function paint(){
    if(!host)return;
    const n=getNote();
    if(!n){host.replaceChildren();host.hidden=true;onModeChange?.();return;}
    if(n.id!==noteId){noteId=n.id;form=null;status='';unknown=false;manual=null;}
    const request=noteWriteRequest(n);
    if(request)form=null;
    const focusKey=document.activeElement&&host.contains(document.activeElement)?[...document.activeElement.attributes].find(a=>a.name.startsWith('data-write-request'))?.name:null;
    host.hidden=!form&&!request&&!status;
    host.innerHTML=form?formMarkup():request?boxMarkup(n,request):status?`<p data-write-request-status role="status">${esc(status)}</p>`:'';
    controls();
    if(focusKey){const next=host.querySelector(`[${focusKey}]`);if(next&&!next.disabled)next.focus({preventScroll:true});}
    onModeChange?.();
  }
  function controls(){
    if(!host)return;const off=isBusy()||unknown;
    host.querySelectorAll('button,textarea:not([readonly])').forEach(el=>{el.disabled=off;});
    // Copying is not a write: it stays available after an unclear result.
    const copyButton=host.querySelector('[data-write-request-copy]');if(copyButton)copyButton.disabled=isBusy();
  }
  function open(){
    const n=getNote();if(!n||isBusy())return;
    if(n.id!==noteId){noteId=n.id;status='';unknown=false;manual=null;}
    if(noteWriteRequest(n)){status=RESULT_TEXT.mark.already;form=null;paint();return;}
    form={reason:''};status='';paint();
    host?.querySelector('[data-write-request-reason]')?.focus();
  }
  function cancelForm(){
    if(!form||isBusy())return false;
    if(form.reason.trim()&&!window.confirm('쓰던 이유를 버리고 닫을까요?'))return false;
    form=null;status='';paint();
    host?.ownerDocument.querySelector('[data-basket-write-request-open]')?.focus();
    return true;
  }
  async function run(kind){
    const n=note();if(!n||isBusy()||unknown)return;
    if(kind==='mark'){const problem=writeRequestReasonProblem(form?.reason);if(problem){status=problem;paint();return;}}
    if(kind==='cancel'&&!window.confirm('쓰기요청 후보를 취소할까요? 원장에는 원래 기록되지 않은 상태예요.'))return;
    const mine=++seq,owner=scope(),epoch=rt.session.epoch(),id=n.id;
    // A result that lands after an account, workspace or note change is never shown or applied.
    const current=()=>mine===seq&&owner===scope()&&rt.session.epoch()===epoch&&note()?.id===id&&window.KPTURouter.current==='basket';
    setBusy(true);status=kind==='mark'?'표시하는 중…':kind==='handoff'?'기록하는 중…':'취소하는 중…';manual=null;paint();
    let result;
    try{
      const options={rt,expectedSessionEpoch:epoch};
      result=kind==='mark'?await markWriteRequest(n,form?.reason,options):kind==='handoff'?await handOffWriteRequest(n,options):await cancelWriteRequest(n,options);
    }catch{result={status:'unknown'};}
    setBusy(false);
    if(!current())return;
    if(result.note&&['ok','already'].includes(result.status))onSaved?.(result.note);
    if(result.status==='ok'||result.status==='already'){form=null;status=result.status==='ok'?RESULT_TEXT[kind].ok:RESULT_TEXT.mark.already;}
    else{status=RESULT_TEXT[result.status]||RESULT_TEXT.unknown;if(result.status!=='not_saved')onUnknown?.();unknown=result.status==='unknown';}
    paint();
    const focus=host?.querySelector(kind==='mark'&&result.status==='ok'?'[data-write-request-copy]':'[data-write-request-status]');
    if(kind==='cancel'&&result.status==='ok')host?.ownerDocument.querySelector('[data-basket-write-request-open]')?.focus();else focus?.focus?.();
  }
  async function copyText(){
    const n=note(),request=noteWriteRequest(n);if(!n||!request||isBusy())return;
    const text=writeRequestCopyText(n,request),mine=seq,id=n.id;
    let copied=false;try{await copy(text);copied=true;}catch{copied=false;}
    if(mine!==seq||note()?.id!==id)return;
    // Copying never marks the candidate as handed off or recorded.
    manual=copied?null:text;
    status=copied?'복사했어요. ChatGPT에 붙여 넣은 뒤 [넘겼어요]를 눌러 주세요.':'복사하지 못했어요. 아래 글을 길게 눌러 직접 복사해 주세요.';
    paint();
  }
  function attach(next){
    host=next;unknown=false;
    host.addEventListener('click',event=>{
      const b=event.target.closest('button');if(!b||b.disabled||isBusy())return;
      if(b.hasAttribute('data-write-request-save'))void run('mark');
      else if(b.hasAttribute('data-write-request-form-cancel'))cancelForm();
      else if(b.hasAttribute('data-write-request-copy'))void copyText();
      else if(b.hasAttribute('data-write-request-handoff'))void run('handoff');
      else if(b.hasAttribute('data-write-request-cancel'))void run('cancel');
    });
    host.addEventListener('input',event=>{if(form&&event.target.hasAttribute('data-write-request-reason'))form.reason=event.target.value;});
    // Reopening the same note (for example after a reload) keeps a reason being written.
    const n=getNote();if(!n||n.id!==noteId){noteId=null;form=null;}
    status='';manual=null;paint();
  }
  function reset(){++seq;noteId=null;form=null;status='';unknown=false;manual=null;if(host){host.replaceChildren();host.hidden=true;}}
  return {attach,open,cancel:cancelForm,reset,paint,controls,isOpen:()=>!!form,hasDraft:()=>!!form?.reason?.trim(),hasCandidate:()=>!!noteWriteRequest(getNote())};
}
