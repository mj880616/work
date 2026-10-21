import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {formatSeoulTime} from './meeting-time.js';
import {disconnectWithUndo,deleteNoteOriginal} from './basket-record-delete.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {aiSummaryAllowed,aiSummaryMarkup,newAiState,placeAiSummary,requestLinkSummary} from './basket-ai-summary.js';

const PAGE_SIZE=100;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const contextFor=rt=>typeof rt.context?.read==='function'?(rt.context.read()||{}):(globalThis.window?.__KPTU_BOOT_CONTEXT__||{});
const scope=rt=>{const c=contextFor(rt);return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
const changed=()=>new Error('업무 공간이나 로그인이 바뀌었어요. 다시 확인해 주세요.');
// Match the applied PostgreSQL btrim character set, including NEL and BOM.
const onlyWhitespace=/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/u;
// BASKET-연결요약선택: a blank summary on connect is allowed; the database keeps NULL and screens show the note's opening text.
export const isBlankLinkSummary=value=>value===undefined||value===null||(typeof value==='string'&&onlyWhitespace.test(value));
export const EXCERPT_LENGTH=120;
export const noteExcerpt=text=>{const chars=[...String(text||'').replace(/\s+/g,' ').trim()];return chars.length>EXCERPT_LENGTH?chars.slice(0,EXCERPT_LENGTH).join('')+'…':chars.join('');};
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
// UI-기록아이콘: noteKinds ['basket','note'] also returns links made from a note (app_notes kind=note, linked by the same
// app_basket_confirm_links through the note's [연결하기]); each row then carries note_kind and the note's title. The default stays
// basket updates only, so every other reader (journal, drive summary, dates) is unchanged. No new table, policy or RPC.
export async function readLinkRecords({kind,targetIds,linkId,weekStart,weekEnd,dateOnly=false,noteKinds=['basket']}={},rt=window.KPTURuntime){
  const context=contextFor(rt),workspaceId=context?.workspace?.id;
  if(!context?.user?.id||!workspaceId)throw changed();
  if(kind&&!['organization','project'].includes(kind))throw Error('연결할 곳을 확인해 주세요.');
  if(targetIds&&!targetIds.length)return [];
  const kinds=noteKinds.filter(k=>['basket','note'].includes(k));if(!kinds.length)return [];const withNotes=kinds.includes('note');
  const owner=scope(rt),encode=encodeURIComponent,target=kind==='organization'?'organization_id':'project_id';
  const fields=dateOnly?'id,workspace_id,note_id,organization_id,project_id,status,note:app_notes!inner(id,workspace_id,occurred_at)':`id,workspace_id,summary,note_id,organization_id,project_id,status,note:app_notes!inner(id,workspace_id,occurred_at,raw_text${withNotes?',kind,title':''})`;
  const base=`/rest/v1/app_record_links?workspace_id=eq.${encode(workspaceId)}&note.workspace_id=eq.${encode(workspaceId)}&note.kind=${kinds.length===1?'eq.'+kinds[0]:'in.('+kinds.join(',')+')'}&status=eq.confirmed&note_id=not.is.null&or=(organization_id.not.is.null,project_id.not.is.null)&select=${fields}&order=id.asc`;
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
      const noteKind=withNotes&&note.kind==='note'?'note':'basket';if(!kinds.includes(noteKind))continue;
      rows.push({id:row.id,...(dateOnly?{}:{summary:row.summary??null,raw_text:note.raw_text}),note_id:row.note_id,organization_id:row.organization_id,project_id:row.project_id,occurred_at:note.occurred_at,type:'basket',...(withNotes?{note_kind:noteKind,title:note.title??null}:{})});
    }
  }
  return rows;
}
// UI-연결요약수정: clearing a saved summary back to NULL is not possible yet (app_basket_update_link_summary needs 1+ characters).
export const SUMMARY_BLANK_TEXT='요약을 비워 저장하는 기능은 아직 준비 중이에요. 글을 남기거나 [취소]를 눌러 주세요.';
// UI-연결요약수정: in a multi-line box Enter is a new line and Ctrl+Enter (Cmd+Enter on a Mac) saves. An Enter that only ends a
// Korean IME composition is ignored. The coming common Enter-save rule (UI-엔터저장) uses the same keys.
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
// UI-기록아이콘(2026-10-18 결정): the mark in front of a linked record tells an update (바구니 업데이트) from a note (노트).
// Two small line icons drawn in the text color replace the old 🧺; other marks (e.g. a meeting result's 🗒) stay as they are.
const UPDATE_ICON='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 6.5h6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const NOTE_ICON='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3.5 2.5h6l3 3v8h-9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9.5 2.5v3h3M5.5 8.5h5M5.5 11h3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const isNoteRecord=row=>row?.note_kind==='note';
export function recordMark(row,className='record-mark'){const note=isNoteRecord(row);return `<span class="${className}" data-record-mark="${note?'note':'update'}" role="img" aria-label="${note?'노트':'바구니 업데이트'}">${note?NOTE_ICON:UPDATE_ICON}</span>`;}
// A note record shows the summary written when it was linked, else the note's title, else its opening text.
export const recordText=row=>row.summary??(isNoteRecord(row)&&String(row.title||'').trim()?row.title:noteExcerpt(row.raw_text));
// BUG-바구니연결해제: the whole line opens the original note; the ⋯ at its end holds
// [메모 열기]·[연결 해제]·[요약 수정] and, for an update in organization detail, [원문 삭제].
export function linkRecordHtml(row){
  const date=Number.isFinite(Date.parse(row.occurred_at))?formatSeoulTime(row.occurred_at,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric'}):'';
  const kind=row.organization_id?'organization':'project',note=isNoteRecord(row),href=note?'./?view=basket':`./?view=basket&note=${encodeURIComponent(row.note_id)}`;
  return `<div class="basket-link-record" data-basket-link="${escape(row.id)}" data-basket-link-note="${escape(row.note_id)}" data-basket-link-kind="${kind}" data-basket-link-note-kind="${note?'note':'basket'}"><div class="basket-link-line"><a class="basket-link-open" href="${escape(href)}" data-basket-link-open="${escape(row.note_id)}"><small>${recordMark(row,'basket-link-mark')} ${note?'노트 연결':'바구니 연결'} · <time>${escape(date)}</time></small><p data-link-summary-text>${escape(recordText(row)||'요약 없음')}</p></a><button type="button" class="basket-link-more" data-basket-link-menu="${escape(row.id)}" aria-label="바구니 기록 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="basketLinkMenu"><span aria-hidden="true">⋯</span></button></div><p data-link-action-status role="status" aria-live="polite" hidden></p></div>`;
}

// One menu panel for every mounted record host (created on first use inside the open dialog).
const mountedHosts=new Map();let linkMenu=null;
const hostOf=trigger=>[...mountedHosts.keys()].find(host=>host.contains(trigger));
function recordMenu(host){
  if(linkMenu)return linkMenu;
  linkMenu=createAnchoredMenu({id:'basketLinkMenu',className:'basket-link-menu',label:'바구니 기록 관리',historyKey:'kptuBasketLinkMenu',parent:host.closest('.modal')||document.body,
    key:trigger=>trigger.dataset.basketLinkMenu,canOpen:trigger=>!!hostOf(trigger)&&!trigger.disabled,
    // UI-기록아이콘: a note's line offers [노트 열기]·[연결 해제]·[요약 수정] (the note itself is managed on the note screen, so no
    // [원문 삭제]). UI-연결요약수정: [요약 수정] changes only this link's summary, never the note.
    render:id=>[...document.querySelectorAll('[data-basket-link]')].find(el=>el.dataset.basketLink===id)?.dataset.basketLinkNoteKind==='note'?'<button type="button" data-basket-link-action="open">노트 열기</button><button type="button" data-basket-link-action="disconnect">연결 해제</button><button type="button" data-basket-link-action="summary">요약 수정</button>':'<button type="button" data-basket-link-action="open">업데이트 열기</button><button type="button" data-basket-link-action="disconnect">연결 해제</button><button type="button" data-basket-link-action="summary">요약 수정</button><button type="button" class="basket-link-danger" data-basket-link-action="note-delete">원문 삭제</button>',
    onAction:(button,active)=>{const host=hostOf(active.trigger);mountedHosts.get(host)?.(button.dataset.basketLinkAction,active.id);}});
  return linkMenu;
}

// One delegated editor per detail host; drafts and exact previous strings are
// memory-only. A conflict/unknown result always needs explicit user confirmation.
// UI-연결요약수정: organization detail (#wdUpdates) and project detail (the record list) both mount this one editor; project
// detail opens it from its own ⋯ menu through edit(id). Rows are re-read with both note kinds so a note link saves too.
// Overwrite rule (D11, docs/design/ai-server.md): the only summary writer is app_basket_update_link_summary, a compare-and-set
// on the exact previous summary. [AI 요약] never saves and never replaces typed text without [이걸로 바꾸기]; any automatic
// filler must send expected NULL, so a summary a person saved (non-NULL) makes it fail with SUMMARY_CHANGED instead of overwriting.
const LINK_KINDS=['basket','note'];
export function mountLinkSummaryEditor(host,{getRecord,getName=()=>'',isCurrent=()=>true,onUpdated=()=>{},onRemoved=()=>{},onOpenNote=null},rt=window.KPTURuntime){
  const states=new Map();let epoch=0;
  const valid=(state,run,owner)=>run===epoch&&states.get(state.id)===state&&owner===scope(rt)&&isCurrent()&&host.isConnected;
  function clear(){epoch++;states.clear();host.querySelectorAll('[data-link-summary-form]').forEach(form=>form.remove());host.querySelectorAll('.basket-link-record [data-basket-link-menu]').forEach(button=>button.disabled=false);host.querySelectorAll('[data-link-action-status]').forEach(status=>{status.textContent='';status.hidden=true;});}
  function formFor(id){return [...host.querySelectorAll('[data-link-summary-form]')].find(form=>form.dataset.linkSummaryForm===id);}
  function open(id){
    if(!isCurrent())return;const record=getRecord(id);if(!record)return;
    const existing=formFor(id);if(existing){existing.querySelector('textarea')?.focus();return;}
    const row=[...host.querySelectorAll('[data-basket-link]')].find(row=>row.dataset.basketLink===id);if(!row)return;
    const state={id,expected:record.summary??null,busy:false,needsReview:false,latest:null,ai:newAiState(),aiTarget:null};states.set(id,state);
    row.insertAdjacentHTML('beforeend',`<form data-enter-save data-link-summary-form="${escape(id)}"><details data-link-summary-original><summary>원문 전체 보기</summary><pre class="basket-link-original">${escape(record.raw_text??'')}</pre></details><label>기록 요약<textarea data-link-summary-input rows="3"></textarea></label><p data-link-summary-status role="status" aria-live="polite"></p><div data-link-summary-latest hidden></div><button type="button" class="secondary" data-link-summary-current hidden>최신 요약 확인</button><div class="basket-link-actions"><button type="submit" class="primary" data-link-summary-save aria-keyshortcuts="Control+Enter" title="Ctrl+Enter로 저장">저장</button><button type="button" class="ghost" data-link-summary-cancel>취소</button></div></form>`);
    const form=formFor(id),input=form.querySelector('textarea');input.value=record.summary??'';input.focus();
    void aiGate(state,form,record);
  }
  // AI-서버연동 S4: [AI 요약] appears only for a note the server would summarize (not archived, not AI-excluded, not a diary).
  async function aiGate(state,form,record){
    const run=epoch,owner=scope(rt),workspaceId=contextFor(rt)?.workspace?.id,target=record.organization_id?{kind:'organization',id:record.organization_id}:record.project_id?{kind:'project',id:record.project_id}:null;
    if(!target||!record.note_id||!workspaceId)return;
    let note=null;
    try{const rows=await rt.api(`/rest/v1/app_notes?id=eq.${encodeURIComponent(record.note_id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,kind,archived_at,ai_export_allowed&limit=1`);note=Array.isArray(rows)&&rows.length===1&&rows[0]?.id===record.note_id?rows[0]:null;}catch{note=null;}
    if(!note||!valid(state,run,owner)||!form.isConnected||!aiSummaryAllowed({...note,raw_text:record.raw_text}))return;
    state.aiTarget={noteId:record.note_id,...target};
    const box=document.createElement('div');box.dataset.linkSummaryAiBox='';form.querySelector('label')?.after(box);paintAi(state,form);
  }
  function paintAi(state,form,focus=''){
    const box=form.querySelector('[data-link-summary-ai-box]');if(!box)return;
    box.innerHTML=aiSummaryMarkup(state.ai,state.id,'data-link-summary',escape);
    box.querySelectorAll('button').forEach(el=>{el.disabled=state.busy||(el.hasAttribute('data-link-summary-ai-run')&&state.ai.busy);});
    if(focus)(focus==='input'?form.querySelector('textarea'):box.querySelector(`[data-link-summary-ai-${focus}]`))?.focus();
  }
  async function runAi(state,form){
    if(state.ai.busy||!state.aiTarget)return;
    const run=epoch,owner=scope(rt),seq=++state.ai.run;
    Object.assign(state.ai,{busy:true,status:'',retry:false,proposal:''});paintAi(state,form);
    const result=await requestLinkSummary({noteId:state.aiTarget.noteId,targetKind:state.aiTarget.kind,targetId:state.aiTarget.id},{rt});
    if(!valid(state,run,owner)||state.ai.run!==seq||!form.isConnected)return;
    state.ai.busy=false;
    const keep=!document.activeElement||document.activeElement===document.body||form.contains(document.activeElement);
    if(!result.ok){state.ai.status=result.message;state.ai.retry=result.retry;paintAi(state,form,keep?'run':'');return;}
    const input=form.querySelector('textarea'),placed=placeAiSummary(input.value,result.summary,'저장');
    if(placed.fill!==null)input.value=placed.fill;
    state.ai.proposal=placed.proposal;state.ai.status=placed.status;paintAi(state,form,keep?(placed.fill!==null?'input':'apply'):'');
  }
  function applyAi(state,form,use){
    if(!state.ai.proposal)return;
    if(use){form.querySelector('textarea').value=state.ai.proposal;state.ai.status='제안으로 바꿨어요. 아직 저장 전이에요. 고친 뒤 [저장]을 눌러 주세요.';}else state.ai.status='';
    state.ai.proposal='';paintAi(state,form,use?'input':'run');
  }
  async function latest(state,form,run,owner){
    try{
      const records=await readLinkRecords({linkId:state.id,noteKinds:LINK_KINDS},rt);if(!valid(state,run,owner))return;
      const fresh=records[0];if(!fresh){form.querySelector('[data-link-summary-status]').textContent=SUMMARY_ERROR_TEXT.NOT_FOUND;return;}
      state.latest=fresh;const box=form.querySelector('[data-link-summary-latest]');box.hidden=false;box.textContent=`최신 요약: ${fresh.summary??'요약 없음'}`;
      form.querySelector('[data-link-summary-current]').hidden=false;
    }catch{if(valid(state,run,owner)){const box=form.querySelector('[data-link-summary-latest]');box.hidden=false;box.textContent='최신 요약을 불러오지 못했어요. 다시 저장을 눌러 확인해 주세요.';}}
  }
  async function save(form){
    const state=states.get(form.dataset.linkSummaryForm);if(!state||state.busy||!isCurrent())return;
    const run=epoch,owner=scope(rt),input=form.querySelector('textarea'),status=form.querySelector('[data-link-summary-status]');
    if(state.needsReview){await latest(state,form,run,owner);return;}
    if(isBlankLinkSummary(input.value)){status.textContent=SUMMARY_BLANK_TEXT;input.focus();return;}
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
      const fresh=(await readLinkRecords({linkId:state.id,noteKinds:LINK_KINDS},rt))[0];if(!valid(state,run,owner)){invalidate();return;}
      if(!fresh){status.textContent=SUMMARY_ERROR_TEXT.NOT_FOUND;state.needsReview=true;invalidate();return;}
      await onUpdated(fresh);if(!valid(state,run,owner)){invalidate();return;}
      states.delete(state.id);form.remove();window.dispatchEvent(new Event('kptu:basket-links-changed'));
    }catch{
      if(!valid(state,run,owner)){if(acknowledged)invalidate();return;}
      if(valid(state,run,owner)){status.textContent=SUMMARY_ERROR_TEXT.RESULT_UNKNOWN;state.needsReview=true;await latest(state,form,run,owner);invalidate();}
    }finally{
      if(valid(state,run,owner)){state.busy=false;form.querySelectorAll('button,textarea').forEach(el=>el.disabled=false);paintAi(state,form);}
    }
  }
  // Disconnect removes one link row; deleting the original removes the note and,
  // by cascade, every row that shares it. Results never paint after clear/dispose.
  const acting=new Set();
  const rowsFor=(attr,value)=>[...host.querySelectorAll('[data-basket-link]')].filter(row=>row.dataset[attr]===value);
  function setRowBusy(rows,value){rows.forEach(row=>row.querySelectorAll('[data-basket-link-menu]').forEach(el=>el.disabled=value));}
  function say(id,message){const status=rowsFor('basketLink',id)[0]?.querySelector('[data-link-action-status]');if(status){status.textContent=message||'';status.hidden=!message;}}
  async function act(id,note){
    const row=rowsFor('basketLink',id)[0];if(!row||!isCurrent())return;
    const rows=note?rowsFor('basketLinkNote',row.dataset.basketLinkNote):[row],key=note?`note:${row.dataset.basketLinkNote}`:`link:${id}`;
    if(acting.has(key)||rows.some(el=>acting.has(`link:${el.dataset.basketLink}`)||acting.has(`note:${el.dataset.basketLinkNote}`)))return;
    if(rows.some(el=>formFor(el.dataset.basketLink))){say(id,'요약 수정을 먼저 저장하거나 취소해 주세요.');return;}
    const record=getRecord(id);if(!note&&!record)return;
    const run=epoch,owner=scope(rt),valid=()=>run===epoch&&owner===scope(rt)&&isCurrent()&&host.isConnected;
    acting.add(key);setRowBusy(rows,true);say(id,'처리 중…');
    let result;
    try{result=note?await deleteNoteOriginal(row.dataset.basketLinkNote,{rt,isCurrent:valid}):await disconnectWithUndo(record,{name:getName(),rt,isCurrent:valid});}
    catch{result={status:'unknown',message:'결과를 확인하지 못했어요. 목록을 다시 불러와 실제 상태를 확인해 주세요.'};}
    finally{acting.delete(key);}
    if(!valid()||result.status==='stale')return;
    const live=note?rowsFor('basketLinkNote',row.dataset.basketLinkNote):rowsFor('basketLink',id);
    if(['deleted','missing'].includes(result.status)){
      const next=live.at(-1)?.nextElementSibling?.querySelector?.('[data-basket-link-open],button');
      live.forEach(el=>{states.delete(el.dataset.basketLink);el.remove();});
      onRemoved({status:result.status,linkId:note?null:id,noteId:note?row.dataset.basketLinkNote:null});
      if(next)next.focus();
      return;
    }
    setRowBusy(live,false);say(id,result.status==='cancelled'?'':result.message);
    live[0]?.querySelector('[data-basket-link-menu]')?.focus();
  }
  function action(name,id){
    const row=rowsFor('basketLink',id)[0];if(!row||!isCurrent())return;
    const noteRow=row.dataset.basketLinkNoteKind==='note';
    if(name==='open'){openNote(row.dataset.basketLinkNote,noteRow?'note':'basket');return;}
    if(noteRow&&!['disconnect','summary'].includes(name))return;
    if(name==='summary'){open(id);return;}
    if(name==='disconnect'||name==='note-delete')void act(id,name==='note-delete');
  }
  // UI-모바일업데이트겹쳐보기: a tap on the line itself passes {line,linkId,trigger}, so a phone can show the record over the detail
  // (record-sheet.js) instead of leaving; the ⋯ [업데이트 열기]/[노트 열기] passes nothing and still opens the full view.
  function openNote(noteId,kind='basket',info=null){if(onOpenNote&&noteId)onOpenNote(noteId,kind,info);else if(noteId)location.href=kind==='note'?'./?view=basket':`./?view=basket&note=${encodeURIComponent(noteId)}`;}
  function click(event){
    const link=event.target.closest?.('a[data-basket-link-open]');
    if(link&&host.contains(link)){
      if(!onOpenNote||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();const row=link.closest('[data-basket-link]');if(isCurrent())openNote(link.dataset.basketLinkOpen,row?.dataset.basketLinkNoteKind==='note'?'note':'basket',{line:true,linkId:row?.dataset.basketLink||null,trigger:link});return;
    }
    const button=event.target.closest?.('button');if(!button||!host.contains(button))return;
    if(button.dataset.basketLinkMenu){if(!button.disabled)recordMenu(host).open(button);return;}
    const form=button.closest('[data-link-summary-form]'),state=form&&states.get(form.dataset.linkSummaryForm);if(!state||state.busy)return;
    if(button.hasAttribute('data-link-summary-ai-run')){void runAi(state,form);return;}
    if(button.hasAttribute('data-link-summary-ai-apply')||button.hasAttribute('data-link-summary-ai-dismiss')){applyAi(state,form,button.hasAttribute('data-link-summary-ai-apply'));return;}
    if(button.hasAttribute('data-link-summary-cancel')){states.delete(state.id);form.remove();}
    if(button.hasAttribute('data-link-summary-current')&&state.latest){state.expected=state.latest.summary;state.needsReview=false;form.querySelector('[data-link-summary-status]').textContent='최신 요약을 확인했어요. 작성 중인 글을 저장하려면 저장을 눌러 주세요.';button.hidden=true;form.querySelector('textarea').focus();}
  }
  function submit(event){const form=event.target.closest?.('[data-link-summary-form]');if(form&&host.contains(form)){event.preventDefault();void save(form);}}
  host.addEventListener('click',click);host.addEventListener('submit',submit);mountedHosts.set(host,action);
  return {clear,hasDraft:()=>states.size>0,edit:id=>open(id),dispose(){clear();if(linkMenu?.active&&host.contains(linkMenu.active.trigger))linkMenu.close(()=>{},false);if(mountedHosts.get(host)===action)mountedHosts.delete(host);host.removeEventListener('click',click);host.removeEventListener('submit',submit);}};
}
