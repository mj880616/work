import {basketOcrFor} from './basket-ocr-runtime.js?v=2';
import {effectiveOcrText} from './basket-ocr-text.mjs?v=1';
import { mountQuick } from './home-quick.js?v=20';
import { mountHandoff, selectHandoffNotes } from './basket-ai-handoff.js?v=19';
import { mountClassification } from './basket-classification-ui.js?v=17';
import { readBasket, updateNote, noteState, visibleNotes, moveToNote, suggestNoteTitle, validateNoteTitle } from './basket-data.js?v=7';
import { mountNotes } from './basket-notes.js?v=3';
import { noteTasks, requestTaskOpen, takeBasketNoteRequest } from './basket-note-tasks.js?v=3';
import { deleteNoteOriginal } from './basket-record-delete.js?v=2';
import { mountManualLink } from './basket-manual-link.js?v=10';
import { sendAttachmentToLibrary, requestLibraryDocument, libraryHref } from './basket-library-send.js?v=2';
import { isHwpName, requestHwpEdit } from './hwp-drive.js?v=1';
import { renderMarkdownInto, showPlainText, preloadMarkdown, renderShareCards } from './markdown-view.js?v=2';
import { openBasketHtml, mountHtmlFrame, HTML_FRAME_TEXT } from './html-frame.js?v=1';
import { CHATGPT_HTML_REQUEST, HTML_MAX_BYTES, isHtmlName } from './chatgpt-html.mjs?v=1';
import { openMarkdownEditor } from './md-editor.js?v=4';

import { createUploadBatch, uploadBatch, mountBasketPicker, driveFileUrl, fileSize } from './basket-upload.js?v=7';

const root = document.querySelector('#basketView'), rt = window.KPTURuntime;
let notes = [], links = [], filter = 'unclassified', selected = null, editing = false, busy = false, epoch = 0, rawView = false;
const scope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
let upload = createUploadBatch(), pickerFiles = null, handoffBusy = false;
let quick=null, bigWriter=null;
let currentScope = scope(), retainedForTraversal = false;
// BUG-뒤로가기: an opened memo is one router layer, so Back returns to the list at the same scroll.
let noteLayer = null, listScroll = 0;
const initialUrl = new URL(location.href);
// A source-note link from the task view hands its note over in-app; a full load reads ?note=.
let requestedNote = (initialUrl.searchParams.get('view') === 'basket' ? initialUrl.searchParams.get('note') : null) || takeBasketNoteRequest(rt);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = note => { const d = new Date(note.occurred_at); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(d); };
root.innerHTML = `<div class="basket-head"><h2>바구니</h2><div class="basket-toolbar basket-more" data-basket-more-wrap><button type="button" class="basket-more-trigger" data-basket-more aria-label="더보기" aria-expanded="false" aria-controls="basketMoreMenu"><span aria-hidden="true">⋯</span><span class="basket-more-label" aria-hidden="true"> 더보기</span></button><div id="basketMoreMenu" class="basket-more-menu" role="group" aria-label="바구니 더보기" hidden><button type="button" data-handoff-copy>AI 분류 요청</button><button type="button" data-chatgpt-request-copy>GPT 답변 가져오기</button></div></div></div><div class="basket-kind-switch" role="group" aria-label="메모·노트 보기" data-basket-kind-switch><button type="button" data-basket-kind="memo" aria-pressed="true">메모</button><button type="button" data-basket-kind="note" aria-pressed="false">노트</button></div><p data-basket-handoff-scope role="status" hidden></p><div data-handoff-host></div><div data-basket-list><div class="home-quick-placeholder" aria-hidden="true"></div><div class="basket-filters quick-mode-group" role="group" aria-label="바구니 보기"><button type="button" class="quick-pill-button" data-basket-filter="unclassified">미분류<span class="basket-filter-count" data-basket-filter-count></span></button><button type="button" class="quick-pill-button" data-basket-filter="all">전체</button><button type="button" class="quick-pill-button" data-basket-filter="archived">보관</button></div><p data-basket-list-status role="status"></p><button type="button" data-basket-retry hidden>다시 시도</button><div data-basket-rows></div></div><div data-basket-detail hidden></div><div data-classification-host></div><div class="note-host" data-note-host hidden></div>`;
// Keep the basket heading available to assistive navigation; the shell owns
// the visible mobile title at the same 760px breakpoint as the shared header.
const basketTitle=root.querySelector('.basket-head > h2'),mobileTitle=window.matchMedia('(max-width:760px)');
const syncTitle=()=>basketTitle.classList.toggle('a11y-only',mobileTitle.matches);
mobileTitle.addEventListener('change',syncTitle);syncTitle();
// [⋯] opens a small menu under itself (it does not push the list). Esc, a tap outside,
// leaving it by keyboard or choosing an item closes it.
const moreWrap=root.querySelector('[data-basket-more-wrap]'),moreButton=root.querySelector('[data-basket-more]'),moreMenu=root.querySelector('#basketMoreMenu');
function setMore(open,{focus=false}={}){
  if(moreMenu.hidden===!open)return;
  moreMenu.hidden=!open;moreButton.setAttribute('aria-expanded',String(open));
  if(open)moreMenu.querySelector('button:not(:disabled)')?.focus();else if(focus)moreButton.focus();
}
moreButton.addEventListener('click',()=>setMore(moreMenu.hidden));
moreWrap.addEventListener('keydown',e=>{if(e.key==='Escape'&&!moreMenu.hidden){e.preventDefault();e.stopPropagation();setMore(false,{focus:true});}});
moreWrap.addEventListener('focusout',e=>{if(e.relatedTarget&&!moreWrap.contains(e.relatedTarget))setMore(false);});
document.addEventListener('click',e=>{if(!moreMenu.hidden&&!moreWrap.contains(e.target))setMore(false);});
// UI-디자인손질 6: the list menu ([AI 분류 요청]·[GPT 답변 가져오기]) belongs to the list only. An open note has its
// own [⋯] (수정·원문 그대로 보기·보관·삭제) in its head row, with the same small-menu behavior.
const listHead=root.querySelector('.basket-head');
const noteMenu=()=>root.querySelector('#basketNoteMenu');
function setNoteMenu(open,{focus=false}={}){
  const menu=noteMenu(),button=root.querySelector('[data-basket-note-more]');
  if(!menu||menu.hidden===!open)return;
  menu.hidden=!open;button.setAttribute('aria-expanded',String(open));
  if(open)menu.querySelector('button:not(:disabled):not([hidden])')?.focus();else if(focus)button.focus();
}
root.addEventListener('focusout',e=>{const wrap=root.querySelector('[data-basket-note-more-wrap]');if(wrap?.contains(e.target)&&e.relatedTarget&&!wrap.contains(e.relatedTarget))setNoteMenu(false);});
document.addEventListener('click',e=>{const wrap=root.querySelector('[data-basket-note-more-wrap]');if(wrap&&noteMenu()&&!noteMenu().hidden&&!wrap.contains(e.target))setNoteMenu(false);});
// The scope guidance shows only after [분류 요청]; once copied it becomes one line.
const handoffLine=root.querySelector('[data-basket-handoff-scope]');
let handoffNotice=null;
const list = root.querySelector('[data-basket-list]'), detail = root.querySelector('[data-basket-detail]'), listStatus = root.querySelector('[data-basket-list-status]');
const ocrViews=new Map();
// Per scope, note and file: the last send result shown on the read view. A send
// in flight keeps that attachment's button off; a sent or unknown result is a
// status badge, not a button, so nothing resends.
const librarySends=new Map();
const libraryKey=fileId=>`${scope()}:${selected?.id}:${fileId}`;
const libraryBadge={created:['published','자료실에 있어요'],exists:['published','자료실에 있어요'],unknown:['review','자료실에서 확인해 주세요']};
let ocrFlight=null,ocrViewScope=null,ocrGeneration=0;
const captureOcrScope=()=>({scope:scope(),owner:rt.context.read()?.user?.id,sessionEpoch:rt.session.epoch()});
const currentOcrScope=value=>{const session=rt.session.read();return !!value&&value.scope===scope()&&value.sessionEpoch===rt.session.epoch()&&session?.user?.id===value.owner&&!!session?.access_token;};
const ocrKey=fileId=>`${selected?.id}:${fileId}`;
function guardOcrPrivacy(){
  if(!ocrViewScope||currentOcrScope(ocrViewScope))return true;
  detail.querySelectorAll('[data-basket-ocr]').forEach(node=>node.replaceChildren());ocrViews.clear();
  if(ocrFlight){ocrFlight=null;busy=false;}
  return false;
}
// This facade reads presentation only; native operations bind their own token.
const ocr=basketOcrFor({rt,isCurrent:()=>window.KPTURouter.current==='basket'&&(!ocrViewScope||currentOcrScope(ocrViewScope))});
const recognition={unread:'읽기 전',reading:'읽는 중',done:'읽기 완료',empty:'글자 없음',failed:'읽기 실패'};
const cleanupLabel={none:'',create_pending:'임시 문서 생성 확인 중',create_unknown:'임시 문서 생성 결과 불명',created:'임시 문서 정리 필요',delete_pending:'임시 문서 정리 중',deleted:'임시 문서 정리 완료',delete_failed:'임시 문서 정리 실패'};
function ocrNotice(value,action=value.action){
  if(value.result_unknown)return '글자 읽기 결과를 확인하지 못했습니다. 상태를 확인해 주세요. 다시 읽지는 않습니다.';
  if(value.code==='OCR_SOURCE_CHANGED')return '원본 사진이 변경되어 이 결과를 반영할 수 없습니다.';
  if(value.code==='NOTE_CHANGED')return '메모가 변경되었습니다. 저장된 메모를 확인해 주세요.';
  if(value.code==='OCR_ATTEMPT_UNRESOLVED')return '현재 시도의 상태를 먼저 확인해 주세요.';
  if(action==='cleanup'&&value.ok)return '임시 문서를 정리했습니다. 사진 속 글자 상태는 그대로 유지됩니다.';
  if(value.ocr_saved||value.ok&&['done','empty'].includes(value.recognitionState||value.attachment?.ocr?.state))return (value.cleanup_state||value.attachment?.ocr?.cleanup_state)==='delete_failed'?'글자는 저장했습니다. 임시 문서 정리는 다시 확인해 주세요.':'사진 속 글자를 확인했습니다.';
  if(value.ok)return '현재 시도의 상태를 확인했습니다.';
  return '글자를 읽지 못했습니다. 저장된 사진은 그대로 유지됩니다.';
}
function ocrMarkup(file){
  if(!String(file.mime_type||'').startsWith('image/')&&!Object.hasOwn(file,'ocr'))return '';
  let text;try{text=effectiveOcrText(file);}catch{return '<div data-basket-ocr>사진 속 글자 상태를 확인할 수 없습니다.</div>';}
  const saved=file.ocr,outcome=ocr.outcome?.(selected.id,file.drive_file_id)||(ocrViews.get(ocrKey(file.drive_file_id))?.outcome?.result_unknown?null:ocrViews.get(ocrKey(file.drive_file_id))?.outcome);
  return `<div data-basket-ocr="${esc(file.drive_file_id)}"><details><summary>사진 속 글자</summary><p>${esc(recognition[saved?.state||'unread'])}</p>${text?`<div class="basket-ocr-text">${esc(text)}</div>`:''}${cleanupLabel[saved?.cleanup_state]?`<p class="basket-ocr-cleanup">${esc(cleanupLabel[saved.cleanup_state])}</p>`:''}<p data-basket-ocr-notice role="status">${esc(outcome?ocrNotice(outcome):'')}</p><div class="basket-actions"><button type="button" data-basket-ocr-read="${esc(file.drive_file_id)}" disabled>글자 읽기</button><button type="button" data-basket-ocr-status="${esc(file.drive_file_id)}" disabled>상태 확인</button>${saved?.attempt_id?`<button type="button" data-basket-ocr-reconcile="${esc(file.drive_file_id)}" disabled>읽은 글 반영</button><button type="button" data-basket-ocr-cleanup="${esc(file.drive_file_id)}" disabled>임시 문서 정리</button>`:''}</div>${!['image/jpeg','image/png'].includes(file.mime_type)?'<p>이 파일 형식은 글자 읽기를 지원하지 않습니다.</p>':!ocr.enabled?'<p>새 글자 읽기는 아직 사용할 수 없습니다.</p>':''}</details></div>`;
}
function paintOcrControls(){
  if(!selected||!guardOcrPrivacy())return;
  const state=ocr.state;
  for(const file of selected.attachments||[]){
    const node=detail.querySelector(`[data-basket-ocr="${CSS.escape(file.drive_file_id)}"]`);if(!node?.querySelector('[data-basket-ocr-read]'))continue;
    const view=ocrViews.get(ocrKey(file.drive_file_id)),saved=file.ocr;
    const enabled=state.enabled&&!busy&&!state.busy&&['image/jpeg','image/png'].includes(file.mime_type);
    const outcome=ocr.outcome?.(selected.id,file.drive_file_id);
    const unresolved=outcome?.result_unknown||['reading'].includes(saved?.state)||!['none','deleted'].includes(saved?.cleanup_state||'none');
    node.querySelector('[data-basket-ocr-read]').disabled=!enabled||!!unresolved;
    node.querySelector('[data-basket-ocr-status]').disabled=!enabled;
    for(const action of ['reconcile','cleanup']){const button=node.querySelector(`[data-basket-ocr-${action}]`);if(button)button.disabled=!enabled||view?.checkedAttempt!==saved?.attempt_id||(action==='reconcile'&&view?.sourceChanged);}
  }
}
function applyOcrSnapshot(value){
  if(value?.note_id!==selected?.id||!Array.isArray(value.attachments))return;
  for(const old of selected.attachments||[]){
    const fresh=value.attachments.find(file=>file.drive_file_id===old.drive_file_id),view=ocrViews.get(ocrKey(old.drive_file_id));
    if(!view)continue;
    if(view.checkedAttempt!==fresh?.ocr?.attempt_id||view.stamp!==value.updated_at||!fresh||['file_name','mime_type','size_bytes'].some(key=>old[key]!==fresh[key])){delete view.checkedAttempt;delete view.stamp;}
    if(view.conflictAttempt!==fresh?.ocr?.attempt_id)view.sourceChanged=false;
  }
  selected.attachments=value.attachments;upload.attachments=value.attachments;
  if(value.updated_at!==selected.updated_at)detail.querySelector('[data-basket-reload]').hidden=false;
  renderList();paintAttachments();
}
function applyOcrOutcome(value,action='read'){
  if(value?.note_id!==selected?.id||!value.drive_file_id)return;
  const key=ocrKey(value.drive_file_id),view=ocrViews.get(key)||{};
  // A refusal cannot erase an earlier owned lost-write outcome.
  if(!view.outcome?.result_unknown||value.result_unknown||value.ok)view.outcome={ok:value.ok,code:value.code,result_unknown:value.result_unknown,ocr_saved:value.ocr_saved,cleanup_state:value.cleanup_state,recognitionState:value.attachment?.ocr?.state,action};
  if(value.code==='OCR_SOURCE_CHANGED'){view.sourceChanged=true;view.conflictAttempt=selected.attachments.find(file=>file.drive_file_id===value.drive_file_id)?.ocr?.attempt_id;}
  ocrViews.set(key,view);
  if(value.attachment){selected.attachments=(selected.attachments||[]).map(file=>file.drive_file_id===value.drive_file_id?value.attachment:file);upload.attachments=selected.attachments;}
  if(value.ok&&value.updated_at&&selected.updated_at===value.requestStartUpdatedAt)selected.updated_at=value.updated_at;
  else if(value.updated_at&&value.updated_at!==selected.updated_at)detail.querySelector('[data-basket-reload]').hidden=false;
  renderList();paintAttachments();
}
async function runOcr(action,fileId){
  if(busy||!selected||!guardOcrPrivacy()||!ocr.enabled)return;
  const id=selected.id,view=ocrViews.get(ocrKey(fileId));
  const recovery=['reconcile','cleanup'].includes(action);
  const consent={attempt:selected.attachments.find(file=>file.drive_file_id===fileId)?.ocr?.attempt_id,checked:view?.checkedAttempt,stamp:view?.stamp};
  if(recovery&&(!consent.attempt||consent.checked!==consent.attempt||!consent.stamp))return;
  const run=++epoch,captured=captureOcrScope(),generation=ocrGeneration;
  const token={current:()=>ocrFlight===token&&generation===ocrGeneration&&run===epoch&&selected?.id===id&&currentOcrScope(captured)&&window.KPTURouter.current==='basket'};
  ocrFlight=token;
  const operation=basketOcrFor({rt,isCurrent:token.current,onChange:()=>{if(token.current()&&guardOcrPrivacy())paintOcrControls();}});
  busy=true;detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=true);
  const status=detail.querySelector('[data-basket-status]');status.textContent='사진 속 글자 확인 중…';
  try{
    const capability=await operation.capabilities();if(!token.current())return;
    if(!capability.ok){status.textContent='지금은 사진 속 글자 읽기를 사용할 수 없습니다.';return;}
    {
      const snapshot=await operation.status(id);if(!token.current())return;
      if(!snapshot.ok){status.textContent=ocrNotice(snapshot);return;}
      applyOcrSnapshot(snapshot);
      if(action==='status'){
        const file=snapshot.attachments.find(source=>source.drive_file_id===fileId);
        const view=ocrViews.get(ocrKey(fileId))||{};view.checkedAttempt=file?.ocr?.attempt_id;view.stamp=snapshot.updated_at;if(view.conflictAttempt!==view.checkedAttempt)view.sourceChanged=false;ocrViews.set(ocrKey(fileId),view);
        status.textContent='저장된 시도를 확인했습니다. 반영 또는 정리를 직접 선택해 주세요.';return;
      }
      if(recovery&&(snapshot.attachments.find(file=>file.drive_file_id===fileId)?.ocr?.attempt_id!==consent.attempt||snapshot.updated_at!==consent.stamp)){status.textContent='현재 시도가 변경되었습니다. 상태를 다시 확인한 후 선택해 주세요.';return;}
      if(action==='read'&&snapshot.updated_at!==selected.updated_at){status.textContent='메모가 변경되었습니다. 메모를 다시 불러온 후 읽어 주세요.';return;}
    }
    let options;
    if(action==='reconcile'){
      const view=ocrViews.get(ocrKey(fileId));
      if(!view?.checkedAttempt)return;
      if(view.stamp!==selected.updated_at||view.outcome?.code==='NOTE_CHANGED'){
        if(!window.confirm('저장된 메모가 변경되었습니다. 수정 중인 글은 유지하고 현재 저장된 메모에 이 시도의 글자를 반영할까요?'))return;
        options={confirmCurrentNoteVersion:view.stamp};
      }
    }
    const result=action==='read'?await operation.read(id,fileId):action==='reconcile'?await operation.reconcile(id,fileId,options):await operation.cleanup(id,fileId);
    if(!token.current())return;
    applyOcrSnapshot(operation.state.snapshot);
    applyOcrOutcome(result,action);status.textContent=ocrNotice(result,action);
  }catch{if(token.current())status.textContent='글자 읽기 결과를 확인하지 못했습니다. 상태를 확인해 주세요.';}
  finally{if(ocrFlight===token){ocrFlight=null;busy=false;if(currentOcrScope(captured)&&selected?.id===id){detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=false);pickerFiles?.render();paintOcrControls();}else guardOcrPrivacy();}}
}
quick=mountQuick({root,esc,basketOnly:true,view:'basket',idPrefix:'basket',onSaved:()=>void refresh()});
const handoff = mountHandoff(root.querySelector('[data-handoff-host]'),{getRequest:()=>{
  if(!selected){if(quick.hasDraft())return {error:'입력 중인 메모와 첨부를 먼저 저장한 뒤 분류 요청해 주세요.'};return {};}
  if(dirty())return {error:'수정 중인 글과 첨부를 먼저 저장한 뒤 분류 요청해 주세요.'};
  if(selected.archived_at||selected.ai_export_allowed!==true)return {error:'이 메모는 지금 분류 요청할 수 없어요. 보관 또는 AI 제외 상태를 확인해 주세요.'};
  return {noteId:selected.id};
},onPrepared:(count,request)=>{handoffNotice=request.noteId?'현재 메모 1개를 분류 요청합니다.':`최근 4주 · 미분류 · AI 허용 메모 ${count}개를 분류 요청합니다(최대 100개).`;paintHandoffScope();},isBlocked:()=>busy,onBusy:value=>{handoffBusy=value;busy=value;root.querySelector('[data-handoff-copy]').disabled=value;},onClose:()=>{hideHandoffNotice();moreButton.focus();},
  // Ledger decision (PR 577): the copy is quiet (one line), then the result sheet opens right away for the answer.
  onCopied:(count,request)=>{handoffNotice=!count?'분류 요청할 메모가 없어요':`${request.noteId?'메모 1개':`미분류 메모 ${count}개`} AI 분류 요청을 복사했어요. ChatGPT에 붙여 넣고, 받은 답을 아래 [분류 결과 입력]에 붙여 넣으세요.`;paintHandoffScope();classification.open();}});
function requestClassification(){handoffNotice='scope';paintHandoffScope();void handoff.copy();}
function hideHandoffNotice(){handoffNotice=null;paintHandoffScope();}
const classification = mountClassification(root.querySelector('[data-classification-host]'), {
  isBlocked:()=>busy, onBusy:value=>{busy=value;if(value)++epoch;},
  onOpen:()=>{handoff.close();closeDetail();if(selected)return false;list.hidden=true;return true;},
  onClose:()=>{handoff.close();hideHandoffNotice();list.hidden=false;moreButton.focus();},
  onConfirmed:async(noteId,targets)=>{
    const result=await linksConfirmed(noteId,targets);
    if(!result.ok&&!result.stale)return '연결했어요. 목록 새로고침은 다시 시도해 주세요.';
  }
});
// Shared by 분류 결과 입력 and the manual link panel: show the confirmed
// destinations at once, then replace them with one fresh read.
async function linksConfirmed(noteId,targets){
  for(const target of targets){const key=target.kind==='project'?'project_id':'organization_id';
    if(!links.some(l=>l.note_id===noteId&&l[key]===target.target_id&&l.status==='confirmed'))
      links.push({note_id:noteId,status:'confirmed',[key]:target.target_id,[target.kind]:{name:target.name}});
  }
  renderList();if(selected?.id===noteId)paintDetailState();
  const owner=scope();
  try { const current=await readBasket();if(owner!==scope())return {ok:false,stale:true};notes=current.notes;links=current.links;renderList();
    if(selected?.id===noteId){selected=notes.find(n=>n.id===noteId)||selected;paintDetailState();}
    return {ok:true}; }
  catch { return {ok:false}; }
}
const manual = mountManualLink({esc,rt,getNote:()=>selected,getLinks:()=>links,isBusy:()=>busy,
  setBusy:setDetailBusy,onLinked:linksConfirmed,onNoteChanged:()=>reloadDetail(),onModeChange:()=>paintMode(),onTaskRecorded:noteMetadataSaved});
function setDetailBusy(value){busy=value;detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=value);if(!value){pickerFiles?.render();paintOcrControls();}manual.controls();}
// Only metadata changed: the original's version (updated_at), text and attachments stay as they are.
function noteMetadataSaved(saved){
  if(!saved?.id)return;
  for(const note of new Set([notes.find(n=>n.id===saved.id),selected?.id===saved.id?selected:null]))if(note)note.metadata=saved.metadata;
  renderList();
  if(selected?.id===saved.id){paintNoteTasks();paintStateLine();}
}
const manualDraft=()=>!!selected&&manual.hasDraft();
// MEMO-노트: [메모 | 노트] at the top of the basket tab. basket.js owns this switch; basket-notes.js owns the note side.
const kindSwitch=root.querySelector('[data-basket-kind-switch]'),noteHost=root.querySelector('[data-note-host]');
let kind='memo';
const noteDocs=mountNotes(noteHost,{esc,rt,onOpenChange:open=>{kindSwitch.hidden=open;listHead.hidden=open;},onMovedToBasket:()=>void refresh()});
function showKind(next,{openId=null}={}){
  kind=next;kindSwitch.querySelectorAll('[data-basket-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.basketKind===kind)));
  const memo=kind==='memo';
  list.hidden=!memo||!!selected;moreWrap.hidden=!memo;noteHost.hidden=memo;if(!memo){setMore(false);hideHandoffNotice();}
  if(!memo)noteDocs.show({openId});
}
function setKind(next,{openId=null}={}){
  if(next===kind||busy||noteDocs.isBusy()||classification.isOpen())return;
  if(kind==='memo'){if(selected)closeDetail({focus:false});if(selected)return;handoff.close();}
  else if(!noteDocs.close({focus:false}))return;
  showKind(next,{openId});
  if(next==='memo'){renderList();void refresh();}
  kindSwitch.querySelector(`[data-basket-kind="${next}"]`)?.focus();
}
// [노트로 옮기기]: a title form under the read text, filled with the memo's first line.
const toNoteForm=()=>detail.querySelector('[data-basket-to-note-form]');
const toNoteOpen=()=>!!toNoteForm()&&toNoteForm().dataset.open==='1';
function openToNote(){
  if(!selected||editing||busy||manual.isOpen())return;
  const form=toNoteForm();form.dataset.open='1';form.querySelector('[data-basket-to-note-title]').value=suggestNoteTitle(selected);
  detail.querySelector('[data-basket-status]').textContent='';paintMode();form.querySelector('[data-basket-to-note-title]').focus();
}
function closeToNote(){const form=toNoteForm();if(!form)return;delete form.dataset.open;paintMode();detail.querySelector('[data-basket-note-more]')?.focus();}
async function saveToNote(){
  if(!selected||busy||!toNoteOpen())return;
  const title=toNoteForm().querySelector('[data-basket-to-note-title]').value,status=detail.querySelector('[data-basket-status]');
  try{validateNoteTitle(title);}catch(error){status.textContent=error.message;toNoteForm().querySelector('[data-basket-to-note-title]').focus();return;}
  const id=selected.id,run=++epoch,owner=scope();busy=true;
  detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=true);status.textContent='노트로 옮기는 중…';
  try{
    await moveToNote(id,title);
    if(run!==epoch||owner!==scope())return;
    notes=notes.filter(n=>n.id!==id);links=links.filter(l=>l.note_id!==id);busy=false;
    closeDetail({force:true,focus:false});renderList();showKind('note',{openId:id});
  }catch{
    if(run!==epoch||owner!==scope())return;
    status.textContent='노트로 옮기지 못했어요. 다시 시도해 주세요.';
  }finally{if(busy){busy=false;detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=false);paintOcrControls();}}
}
const stateLabel=state=>({확정:'연결됨', '분류 제안됨':'정리 제안 있음'})[state]||state;
function paintHandoffScope(){
  handoffLine.hidden=!handoffNotice;
  if(handoffNotice!=='scope'){handoffLine.textContent=handoffNotice||'';return;}
  handoffLine.textContent=selected?'현재 메모 1개 · 연결된 메모도 다시 분류 요청할 수 있어요.':`최근 4주 · 미분류 · AI 허용 메모 ${selectHandoffNotes(notes,links,new Date()).length}개(최대 100개).`;
  const photos=(selected?[selected]:selectHandoffNotes(notes,links,new Date())).flatMap(note=>note.attachments||[]).filter(file=>String(file.mime_type||'').startsWith('image/'));
  if(photos.length){let stored=false;for(const file of photos){try{stored ||= !!effectiveOcrText(file);}catch{/* Copy validation will refuse malformed OCR. */}}handoffLine.textContent+=stored?' 저장된 사진 속 글자도 함께 분류 요청합니다.':'사진 속 글자는 아직 저장되지 않았습니다.';}
}
function renderList() {
  paintHandoffScope();
  root.querySelectorAll('[data-basket-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.basketFilter === filter)));
  const visible = visibleNotes(notes, links, filter);
  root.querySelector('[data-basket-rows]').innerHTML = visible.map(note => {
    const state = noteState(note, links);
    const lines=String(note.raw_text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean),file=note.attachments?.[0];
    const title=lines[0]||(file?`${String(file.mime_type||'').startsWith('image/')?'사진':'파일'} · ${file.file_name||'첨부'}`:'메모');
    return `<button type="button" class="basket-row" data-basket-row="${esc(note.id)}"><b class="basket-title">${esc([...title].slice(0,80).join(''))}</b>${lines.length>1?`<span class="basket-preview">${esc([...lines.slice(1).join(' ')].slice(0,120).join(''))}</span>`:''}<time>${esc(time(note))}</time><span>${stateLabel(state.status)}${note.attachments?.length ? ' · 첨부 ' + note.attachments.length + '개' : ''}</span>${state.destinations.map(d => `<span class="basket-destination">${esc(d)}</span>`).join('')}</button>`;
  }).join('');
  listStatus.textContent = visible.length ? `${visible.length}개 메모` : '아직 메모가 없어요';
  listStatus.toggleAttribute('data-basket-empty', !visible.length);
  root.querySelector('[data-basket-filter-count]').textContent = ' ' + visibleNotes(notes, links, 'unclassified').length;
}
const textDirty = () => selected && detail.querySelector('[data-basket-text]')?.value !== selected.raw_text.replace(/\r\n?/g, '\n');
const dirty = () => textDirty() || upload.entries.some(e=>e.kind!=='success');
function clearNoteAddress(){
  requestedNote=null;
  const url=new URL(location.href);
  if(!url.searchParams.has('note'))return;
  url.searchParams.delete('note');
  history.replaceState(history.state,'',url.pathname+url.search+url.hash);
}
function closeDetail({focus = true, force = false, cleanAddress = true, fromBack = false} = {}) {
  if (!force && dirty() && !window.confirm('수정 중인 글을 버리고 목록으로 돌아갈까요?')) return false;
  if (!force && !dirty() && manualDraft() && !window.confirm('작성 중인 연결·할 일 입력을 버리고 목록으로 돌아갈까요?')) return false;
  handoff.close();
  bigWriter?.close({silent:true});
  const id = selected?.id; if(id&&cleanAddress)clearNoteAddress(); ++epoch; selected = null;editing=false;setNoteMenu(false);manual.reset();ocrViewScope=null; upload=createUploadBatch();pickerFiles=null; detail.replaceChildren(); detail.hidden = true; list.hidden = false; listHead.hidden = false;kindSwitch.hidden = false;paintHandoffScope();
  const layer = noteLayer; noteLayer = null; if (!fromBack) layer?.close();
  if (id && window.KPTURouter.current === 'basket') window.scrollTo({top:listScroll, behavior:'instant'});
  if (focus) (root.querySelector(`[data-basket-row="${CSS.escape(id || '')}"]`) || root.querySelector(`[data-basket-filter="${filter}"]`))?.focus({preventScroll:true});
  return true;
}
function openNoteLayer({adoptOnly = false} = {}) {
  if (noteLayer || !selected) return;
  noteLayer = window.KPTURouter.layer?.open('basket-note', {adoptOnly, close: () => !busy && closeDetail({fromBack:true})}) || null;
}
// UI-디자인손질 6: one line under the text — each confirmed link as a colored-dot chip (or the state when
// there is none), then the date. The stored write_request metadata is kept as is and no longer shown.
const chipKinds=[['project','프로젝트'],['organization','담당조직'],['meeting','회의'],['document','자료실']];
function paintStateLine() {
  const state = noteState(selected, links), box = detail.querySelector('[data-basket-state]');
  const chips = links.filter(l => l.note_id === selected.id && l.status === 'confirmed').map(link => {
    const [kind, label] = chipKinds.find(([key]) => link[key + '_id']) || ['other', '연결'];
    const name = link[kind]?.name || link[kind]?.title || link[kind]?.series_name || '연결 대상 없음';
    return `<span class="basket-chip" data-chip-kind="${esc(kind)}"><span class="basket-chip-dot" aria-hidden="true"></span><span class="a11y-only">${esc(label)}: </span>${esc(name)}</span>`;
  });
  box.innerHTML = chips.length ? `<span class="a11y-only">${esc(stateLabel(state.status))}: </span>${chips.join('')}` : `<span class="basket-state-text">${esc(stateLabel(state.status))}</span>`;
}
function paintDetailState() {
  if (!selected) return;
  paintStateLine();
  paintAttachments();paintNoteTasks();
  detail.querySelector('[data-basket-archive]').textContent = selected.archived_at ? '보관 해제' : '보관';
}
function paintAttachments() {
  const openIds=new Set(Array.from(detail.querySelectorAll('[data-basket-ocr] details[open]'),node=>node.parentElement.dataset.basketOcr));
  detail.querySelector('[data-basket-attachments]').innerHTML = (selected?.attachments || []).map(file=>{const url=driveFileUrl(file.drive_file_id);return `<div class="library-selected-file"><div class="library-selected-file-main"><b>${esc(file.file_name)}</b><small>${esc(fileSize(file.size_bytes))}</small></div>${url?`<a href="${url}" target="_blank" rel="noopener noreferrer">Drive에서 열기</a>`:'<span>링크를 확인할 수 없습니다.</span>'}${libraryMarkup(file)}${hwpEditMarkup(file)}${ocrMarkup(file)}</div>${libraryResult(file)}`;}).join('');
  detail.querySelectorAll('[data-basket-ocr] details').forEach(node=>{node.open=openIds.has(node.parentElement.dataset.basketOcr);});
  paintOcrControls();paintHtmlViews();
}
// MD-표시보완: each .html attachment (pasted ChatGPT HTML) shows in a sandboxed frame under the read text.
// Read once per opened note through document-actions `html-view`; never sent again on its own.
function paintHtmlViews() {
  const host=detail.querySelector('[data-basket-html-views]');if(!host||!selected)return;
  const files=(selected.attachments||[]).filter(file=>isHtmlName(file.file_name)&&typeof file.drive_file_id==='string'&&file.drive_file_id);
  const wanted=new Set(files.map(file=>file.drive_file_id));
  host.querySelectorAll('[data-basket-html-view]').forEach(box=>{if(!wanted.has(box.dataset.basketHtmlView))box.remove();});
  const shown=new Set(Array.from(host.querySelectorAll('[data-basket-html-view]'),box=>box.dataset.basketHtmlView));
  for(const file of files){
    if(shown.has(file.drive_file_id))continue;
    const box=document.createElement('section');
    box.className='basket-html-view';box.dataset.basketHtmlView=file.drive_file_id;box.setAttribute('aria-label',`${file.file_name||'HTML'} 화면`);
    host.append(box);void loadHtmlView(box,file);
  }
}
async function loadHtmlView(box,file){
  const noteId=selected.id,owner=scope(),live=()=>box.isConnected&&owner===scope()&&selected?.id===noteId;
  const say=text=>{const p=document.createElement('p');p.className='basket-html-message';p.setAttribute('role','status');p.textContent=`${file.file_name||'HTML'}: ${text}`;box.replaceChildren(p);};
  if(Number(file.size_bytes)>HTML_MAX_BYTES)return say(HTML_FRAME_TEXT.tooLarge);
  say('불러오는 중…');
  try{const {html}=await openBasketHtml(noteId,file.drive_file_id,{rt});if(live())mountHtmlFrame(box,html,{title:file.file_name||'ChatGPT HTML'});}
  catch(err){if(live())say(err?.message||HTML_FRAME_TEXT.failed);}
}
// MD-표시보완: copy the request that asks ChatGPT for one self-contained HTML file.
async function copyChatgptRequest(){
  let ok=false;
  try{await navigator.clipboard.writeText(CHATGPT_HTML_REQUEST);ok=true;}
  catch{
    const area=document.createElement('textarea');area.value=CHATGPT_HTML_REQUEST;area.setAttribute('readonly','');area.className='a11y-only';document.body.append(area);area.select();
    try{ok=document.execCommand('copy');}catch{}area.remove();
  }
  const toast=document.querySelector('#toast');if(!toast)return;
  toast.textContent=ok?'GPT 답변 가져오기 요청을 복사했어요. ChatGPT 답변 아래에 붙여 넣고, 받은 HTML을 바구니 입력에 붙여 넣으세요.':'복사하지 못했어요. 이 문구를 직접 복사해 주세요: '+CHATGPT_HTML_REQUEST;
  toast.classList.remove('hidden');clearTimeout(copyChatgptRequest.timer);copyChatgptRequest.timer=setTimeout(()=>toast.classList.add('hidden'),ok?4200:9000);
}
function libraryMarkup(file) {
  const id=String(file?.drive_file_id||'');if(!id)return '';
  const sent=librarySends.get(libraryKey(id)),name=esc(file.file_name||'첨부'),badge=libraryBadge[sent?.kind];
  let body;
  if(badge){
    const doc=sent.document?.id;
    body=`<span class="badge ${badge[0]} basket-library-badge" data-basket-library-badge>${esc(badge[1])}</span>${doc?`<a href="${esc(libraryHref)}" data-basket-library-open="${esc(doc)}" aria-label="${name} 자료실에서 보기">자료실에서 보기</a>`:''}`;
  }else{
    const label=sent?.kind==='sending'?'보내는 중…':'자료실로 보내기';
    body=`<button type="button" data-basket-library-send="${esc(id)}" aria-label="${name} ${esc(label)}"${sent?.kind==='sending'?' disabled':''}>${esc(label)}</button>`;
  }
  return `<div class="basket-library-send" data-basket-library="${esc(id)}"${editing?' hidden':''}>${body}</div>`;
}
// HWP-편집기 2단계: HWP·HWPX 첨부는 편집기 화면(hwp-lab.js)에서 연다. 저장은 그 화면이 같은 메모에 새 첨부로 더한다.
function hwpEditMarkup(file) {
  const id=String(file?.drive_file_id||'');if(!id||!isHwpName(file.file_name))return '';
  return `<div class="basket-library-send" data-basket-hwp="${esc(id)}"${editing?' hidden':''}><button type="button" data-basket-hwp-edit="${esc(id)}" aria-label="${esc(file.file_name||'첨부')} 편집">편집</button></div>`;
}
// The send result reads as one line under its attachment card.
function libraryResult(file) {
  const id=String(file?.drive_file_id||''),message=id&&librarySends.get(libraryKey(id))?.message;
  return message?`<p class="basket-library-result" role="status" data-basket-library-status="${esc(id)}">${esc(message)}</p>`:'';
}
async function sendToLibrary(fileId) {
  if (!selected || editing || busy) return;
  const key=libraryKey(fileId),prior=librarySends.get(key)?.kind;if(['sending','created','exists','unknown'].includes(prior))return;
  if(!(selected.attachments||[]).some(file=>file.drive_file_id===fileId))return;
  const noteId=selected.id,run=epoch,owner=scope(),sessionEpoch=rt.session.epoch();
  librarySends.set(key,{kind:'sending',message:''});paintAttachments();
  const outcome=await sendAttachmentToLibrary(noteId,fileId,{rt,expectedSessionEpoch:sessionEpoch});
  // A result for another account or workspace is never kept or shown.
  if(owner!==scope()||rt.session.epoch()!==sessionEpoch){librarySends.delete(key);return;}
  librarySends.set(key,outcome);
  if(outcome.kind==='created')window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:null,meeting_id:null}}));
  if(run===epoch&&selected?.id===noteId)paintAttachments();
}
function paintNoteTasks() {
  const box = detail.querySelector('[data-basket-note-tasks]'); if (!box || !selected) return;
  const tasks = noteTasks(selected);
  box.hidden = !tasks.length;
  box.innerHTML = tasks.length ? `<h3 id="basketNoteTasksTitle">이 메모로 만든 할 일 ${tasks.length}</h3><ul>${tasks.map(t => `<li><span class="basket-note-task-title">${esc(t.title)}</span><button type="button" data-basket-note-task="${esc(t.task_id)}" aria-label="${esc(t.title)} 할 일 화면에서 보기">할 일 화면에서 보기</button></li>`).join('')}</ul>` : '';
  if (busy) box.querySelectorAll('button').forEach(el => el.disabled = true);
}
// MD-표시: the read text shows the original as formatted markdown; [원문 그대로 보기] shows it exactly as stored.
// The stored text never changes here, and the choice is not remembered (each opened note starts formatted).
// Task checkboxes inside the formatted text stay disabled, so the busy toggles below skip input.md-task.
const readShown = new WeakMap();
function paintReadText() {
  const text = detail.querySelector('[data-basket-read-text]'), toggle = detail.querySelector('[data-basket-read-raw]'), raw = selected.raw_text || '';
  toggle.hidden = !raw; toggle.textContent = rawView ? '정리해서 보기' : '원문 그대로 보기';
  text.classList.toggle('basket-read-empty', !raw); text.classList.toggle('basket-read-raw', !!raw && rawView);
  const key = `${raw && rawView ? 'raw' : 'md'}:${raw}`;
  if (readShown.get(text) === key) return;
  readShown.set(text, key);
  renderShareCards(detail.querySelector('[data-basket-share]'), raw);
  if (!raw) return showPlainText(text, '글 없이 첨부만 있는 메모입니다.');
  showPlainText(text, raw);
  if (rawView) return;
  const owner = scope();
  void renderMarkdownInto(text, raw, {isCurrent: () => owner === scope()}).then(result => { if (!result.ok && readShown.get(text) === key) readShown.delete(text); });
}
function paintMode() {
  if (!selected) return;
  paintReadText();
  // The link panel and the task form bring their own buttons; the read actions return when they close.
  detail.querySelector('[data-basket-read]').hidden = editing; detail.querySelector('[data-basket-read-actions]').hidden = editing || manual.isOpen() || toNoteOpen();
  detail.querySelector('[data-basket-to-note-form]').hidden = editing || !toNoteOpen();
  // The note menu is for reading; while editing the edit buttons and Esc take over.
  detail.querySelector('[data-basket-note-more-wrap]').hidden = editing; if (editing) setNoteMenu(false);
  detail.querySelector('.basket-editor').hidden = !editing; detail.querySelector('[data-basket-edit-actions]').hidden = !editing;
  detail.querySelectorAll('[data-basket-library],[data-basket-hwp]').forEach(box => { box.hidden = editing; });
}
function openDetail(id, {edit = false} = {}) {
  handoff.close();
  if (!selected) listScroll = window.scrollY;
  selected = notes.find(n => n.id === id); if (!selected) return;
  // Keep the opened note attached to this list snapshot until an explicit reload.
  ++epoch;ocrViewScope=captureOcrScope();editing=edit;rawView=false;
  for(const file of selected.attachments||[]){const view=ocrViews.get(ocrKey(file.drive_file_id));if(view){delete view.checkedAttempt;delete view.stamp;}}
  upload=createUploadBatch(selected.id,selected.attachments||[]);list.hidden = true; detail.hidden = false;
  listHead.hidden = true; kindSwitch.hidden = true;
  detail.innerHTML = `<div class="basket-detail-head"><button type="button" class="basket-back" data-basket-close aria-label="바구니 목록으로"><span aria-hidden="true">‹</span> 바구니</button><div class="basket-note-more" data-basket-note-more-wrap><button type="button" class="basket-more-trigger" data-basket-note-more aria-label="이 메모 메뉴" aria-expanded="false" aria-controls="basketNoteMenu"><span aria-hidden="true">⋯</span></button><div id="basketNoteMenu" class="basket-more-menu" role="group" aria-label="이 메모" hidden><button type="button" data-basket-edit>수정</button><button type="button" data-basket-to-note>노트로 옮기기</button><button type="button" data-basket-read-raw>원문 그대로 보기</button><button type="button" data-basket-archive>보관</button><button type="button" class="basket-menu-danger" data-basket-delete>삭제</button></div></div></div><div class="basket-read" data-basket-read><div class="md-share-cards" data-basket-share hidden></div><div class="basket-read-text" data-basket-read-text tabindex="-1" role="region" aria-label="메모 원문"></div><div class="basket-html-views" data-basket-html-views></div><p class="basket-note-meta"><span class="basket-note-state" data-basket-state></span><time>${esc(time(selected))}</time></p></div><div class="basket-editor" hidden><label class="basket-text-label">메모 원문<textarea data-basket-text rows="12"></textarea></label><div class="basket-editor-tools"><div data-basket-file-picker></div><button type="button" data-basket-upload>첨부 저장</button><button type="button" class="secondary" data-basket-big-write>큰 창에서 수정</button></div><div data-basket-file-selection></div></div><div data-basket-attachments class="library-selected-files"></div><section class="basket-note-tasks" data-basket-note-tasks aria-labelledby="basketNoteTasksTitle" hidden></section><button type="button" data-basket-reload hidden>메모 다시 불러오기</button><div class="basket-to-note" data-basket-to-note-form hidden><label class="basket-text-label">노트 제목<input type="text" data-basket-to-note-title autocomplete="off"></label><p class="basket-to-note-help">연결·첨부·할 일은 그대로 노트로 옮겨져요.</p><div class="basket-actions"><button type="button" class="primary" data-basket-to-note-save>노트로 옮기기</button><button type="button" data-basket-to-note-cancel>취소</button></div></div><div class="basket-actions basket-read-actions" data-basket-read-actions><button type="button" class="primary" data-basket-link-open>연결하기</button><button type="button" class="primary" data-basket-task-open>할 일 만들기</button></div><div data-basket-manual hidden></div><div class="basket-actions" data-basket-edit-actions hidden><button type="button" data-basket-save>수정 저장</button><button type="button" data-basket-cancel>취소</button></div><p data-basket-status role="status"></p>`;
  detail.querySelector('[data-basket-text]').value = selected.raw_text;
  manual.attach(detail.querySelector('[data-basket-manual]'));
  pickerFiles=mountBasketPicker(detail.querySelector('[data-basket-file-picker]'),{id:'detailBasketFiles',filesHost:detail.querySelector('[data-basket-file-selection]'),dropTarget:detail.querySelector('.basket-editor'),getBatch:()=>upload,isActive:()=>editing,isBusy:()=>busy,onError:message=>detail.querySelector('[data-basket-status]').textContent=message});
  paintDetailState();paintMode();paintHandoffScope();
  // A note address (?note=) opens the note once; the list entry under it stays the plain list.
  if (!noteLayer) { clearNoteAddress(); openNoteLayer(); }
  // Reading never opens the on-screen keyboard; only an explicit edit focuses the text.
  detail.querySelector(editing ? '[data-basket-text]' : '[data-basket-read-text]').focus();
}
// MD-편집기: [크게 쓰기] opens the shared full-screen editor on the edit field's text. Every change goes straight
// back into the field, so [수정 저장]·취소·leaving the screen see the same text; saving stays the existing flow.
function openBigWriter() {
  const field = detail.querySelector('[data-basket-text]'), id = selected?.id;
  if (!selected || !editing || busy || !field) return;
  const same = () => editing && selected?.id === id && field.isConnected;
  bigWriter = openMarkdownEditor({
    text: field.value, title: '큰 창에서 수정',
    onInput: value => { if (same()) field.value = value; },
    onClose: value => { bigWriter = null; if (!same()) return; field.value = value; field.focus(); },
  });
}
function startEdit() {
  if (!selected || editing) return;
  editing = true; detail.querySelector('[data-basket-text]').value = selected.raw_text; detail.querySelector('[data-basket-status]').textContent = '';
  paintMode(); pickerFiles?.render(); detail.querySelector('[data-basket-text]').focus();
}
function finishEdit({force = false} = {}) {
  if (!selected || !editing) return;
  if (!force && dirty() && !window.confirm('수정 중인 글과 첨부 선택을 버리고 읽기 화면으로 돌아갈까요?')) return;
  editing = false; detail.querySelector('[data-basket-text]').value = selected.raw_text;
  // Cancelling discards the selection the same way leaving the note does.
  if (upload.blocked || upload.entries.some(e => e.kind !== 'success')) upload = createUploadBatch(selected.id, selected.attachments || []);
  if (!force) detail.querySelector('[data-basket-status]').textContent = '';
  paintMode(); pickerFiles?.render(); detail.querySelector('[data-basket-read-text]').focus();
}
async function refresh() {
  if (busy) return;
  const run = ++epoch, owner = scope();
  listStatus.textContent = '불러오는 중…'; root.querySelector('[data-basket-retry]').hidden = true;
  try {
    const result = await readBasket();
    if (run !== epoch || owner !== scope()) return;
    notes = result.notes; links = result.links; renderList();
    if (requestedNote) {
      const id = requestedNote; requestedNote = null;
      if (notes.some(note => note.id === id)) openDetail(id);
      else listStatus.textContent = '메모를 찾을 수 없습니다. 접근 권한과 메모를 확인해 주세요.';
    }
  } catch (e) {
    if (run !== epoch || owner !== scope()) return;
    notes = []; links = []; root.querySelector('[data-basket-rows]').replaceChildren();
    listStatus.textContent = '메모를 불러오지 못했어요. 다시 시도해 주세요.';
    root.querySelector('[data-basket-retry]').hidden = false;
  }
}
async function patch(changes, message, {read = false} = {}) {
  if (busy || !selected) return;
  const id = selected.id, run = ++epoch, owner = scope(); busy = true;
  detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el => el.disabled = true);
  detail.querySelector('[data-basket-status]').textContent = '저장 중…';
  try {
    const note = await updateNote(id, changes);
    if (run !== epoch || owner !== scope()) return;
    notes = notes.map(n => n.id === id ? note : n); selected = note;upload.attachments=note.attachments||[];
    renderList(); paintDetailState(); detail.querySelector('[data-basket-status]').textContent = message;
    if (!editing) detail.querySelector('[data-basket-text]').value = note.raw_text;
    if (read) finishEdit({force:true}); else paintMode();
  } catch (e) {
    if (run !== epoch || owner !== scope()) return;
    paintDetailState(); detail.querySelector('[data-basket-status]').textContent = '저장하지 못했어요. 다시 시도해 주세요.';
  } finally {
    busy = false; detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el => el.disabled = false);paintOcrControls();
  }
}
// Read view only: the delete button lives in the read actions hidden while editing.
async function deleteSelected() {
  if (busy || !selected || editing) return;
  const id = selected.id, run = ++epoch, owner = scope(); busy = true;
  const status = detail.querySelector('[data-basket-status]');
  detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el => el.disabled = true);
  status.textContent = '';
  const current = () => run === epoch && owner === scope() && selected?.id === id && window.KPTURouter.current === 'basket';
  let result;
  try { result = await deleteNoteOriginal(id, {rt, isCurrent:current}); }
  catch { result = {status:'unknown', message:'결과를 확인하지 못했어요. 메모 다시 불러오기로 실제 상태를 확인해 주세요.'}; }
  finally { busy = false; }
  if (!current() || result.status === 'stale') return;
  if (['deleted', 'missing'].includes(result.status)) {
    notes = notes.filter(n => n.id !== id); links = links.filter(l => l.note_id !== id);
    closeDetail({force:true}); renderList(); listStatus.textContent = result.message;
    return;
  }
  detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el => el.disabled = false); paintOcrControls();
  if (result.status === 'cancelled') { detail.querySelector('[data-basket-note-more]').focus(); return; }
  status.textContent = result.message;
  if (result.status === 'unknown') detail.querySelector('[data-basket-reload]').hidden = false;
  detail.querySelector('[data-basket-note-more]').focus();
}
async function saveAttachments() {
  if(busy||!selected)return;
  let batch=upload;const id=selected.id,owner=scope();const isCurrent=()=>scope()===owner&&selected?.id===id&&upload===batch&&run===epoch;
  const status=detail.querySelector('[data-basket-status]');
  if(!batch.entries.length){status.textContent='파일을 선택해 주세요.';return;}
  // A read started before this write must not restore stale attachment counts.
  const run=++epoch,captured=ocr.enabled?captureOcrScope():null,generation=ocrGeneration;
  const token={current:()=>ocrFlight===token&&generation===ocrGeneration&&isCurrent()&&currentOcrScope(captured)&&window.KPTURouter.current==='basket'};
  if(ocr.enabled)ocrFlight=token;
  const operation=ocr.enabled?basketOcrFor({rt,isCurrent:token.current,onChange:()=>{if(token.current()&&guardOcrPrivacy())paintOcrControls();}}):ocr;
  busy=true;detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=true);pickerFiles.render();status.textContent='업로드 중…';
  const paint=()=>{if(!isCurrent())return;selected.attachments=batch.attachments;renderList();paintAttachments();pickerFiles.render();};
  try{await uploadBatch(batch,{isCurrent,onChange:paint,ocr:operation,onOcrChange:value=>{if(token.current()&&guardOcrPrivacy())applyOcrOutcome(value);}});if(isCurrent()){upload=batch=createUploadBatch(id,batch.attachments);status.textContent='첨부를 저장했습니다.';}}
  catch(e){if(isCurrent()){status.textContent='메모를 다시 불러오지 못했어요. 다시 시도해 주세요.';detail.querySelector('[data-basket-reload]').hidden=!batch.blocked;}}
  finally{if(ocrFlight===token){ocrFlight=null;busy=false;}else if(!ocr.enabled)busy=false;if(isCurrent()&&!busy){detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=false);pickerFiles.render();paintOcrControls();}}
}
async function reloadDetail() {
  if(busy||!selected)return;
  if(dirty()&&!window.confirm('저장된 메모를 다시 불러올까요? 수정 중인 글과 미완료 파일 선택은 비워집니다.'))return;
  const id=selected.id,owner=scope(),run=++epoch;busy=true;
  detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=true);
  try{const result=await readBasket();if(run!==epoch||owner!==scope())return;notes=result.notes;links=result.links;renderList();if(notes.some(n=>n.id===id))openDetail(id,{edit:editing});else closeDetail({force:true});}
  catch(e){if(run===epoch&&owner===scope())detail.querySelector('[data-basket-status]').textContent='메모를 다시 불러오지 못했어요. 다시 시도해 주세요.';}
  finally{busy=false;detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=false);pickerFiles?.render();paintOcrControls();}
}
root.addEventListener('click', e => {
  // The note side handles its own buttons (basket-notes.js).
  if(noteHost.contains(e.target))return;
  if(!guardOcrPrivacy())return;
  const b = e.target.closest('button'); if (!b||b.disabled) return;
  // Navigation cancels this handoff's read, but never releases another operation's lock.
  if (moreMenu.contains(b)) setMore(false, {focus:true});
  if (b.hasAttribute('data-basket-note-more')) { setNoteMenu(noteMenu()?.hidden ?? false); return; }
  const fromNoteMenu = !!noteMenu()?.contains(b); if (fromNoteMenu) setNoteMenu(false, {focus:true});
  if (b.matches('[data-basket-filter],[data-basket-row],[data-basket-close],[data-basket-edit]')) { handoff.close(); hideHandoffNotice(); }
  if (b.hasAttribute('data-basket-read-raw')) { rawView = !rawView; paintReadText(); return; }
  if (b.hasAttribute('data-chatgpt-request-copy')) { void copyChatgptRequest(); return; }
  if (busy) return;
  if (b.hasAttribute('data-handoff-copy')) requestClassification();
  else if(b.hasAttribute('data-basket-library-send'))void sendToLibrary(b.dataset.basketLibrarySend);
  else if(b.hasAttribute('data-basket-hwp-edit'))openHwpEditor(b.dataset.basketHwpEdit);
  else if(b.hasAttribute('data-basket-ocr-read'))void runOcr('read',b.dataset.basketOcrRead);
  else if(b.hasAttribute('data-basket-ocr-status'))void runOcr('status',b.dataset.basketOcrStatus);
  else if(b.hasAttribute('data-basket-ocr-reconcile'))void runOcr('reconcile',b.dataset.basketOcrReconcile);
  else if(b.hasAttribute('data-basket-ocr-cleanup'))void runOcr('cleanup',b.dataset.basketOcrCleanup);
  else if (b.hasAttribute('data-basket-row')) openDetail(b.dataset.basketRow);
  else if (b.hasAttribute('data-basket-filter')) { handoff.close(); filter = b.dataset.basketFilter; renderList(); }
  else if (b.hasAttribute('data-basket-close')) closeDetail();
  else if (b.hasAttribute('data-basket-edit')) startEdit();
  else if (b.hasAttribute('data-basket-to-note')) openToNote();
  else if (b.hasAttribute('data-basket-to-note-cancel')) closeToNote();
  else if (b.hasAttribute('data-basket-to-note-save')) void saveToNote();
  else if (b.hasAttribute('data-basket-kind')) setKind(b.dataset.basketKind);
  else if (b.hasAttribute('data-basket-big-write')) openBigWriter();
  else if (b.hasAttribute('data-basket-link-open')||b.hasAttribute('data-basket-task-open')) { const message = manual.open(b.hasAttribute('data-basket-link-open') ? 'link' : 'task'); detail.querySelector('[data-basket-status]').textContent = message || ''; }
  else if (b.hasAttribute('data-basket-cancel')) finishEdit();
  else if (b.hasAttribute('data-basket-retry')) void refresh();
  else if (b.hasAttribute('data-basket-note-task')) { requestTaskOpen(b.dataset.basketNoteTask, rt); window.KPTURouter.go('tasks', {source:'delegated'}); }
  else if (b.hasAttribute('data-basket-save')) {
    // textarea normalizes CR/CRLF on display; do not rewrite an unchanged original.
    // Selected files stay in the editor until they are saved or cancelled.
    const pendingFiles = upload.entries.some(e => e.kind !== 'success');
    if (!textDirty()) { detail.querySelector('[data-basket-status]').textContent = pendingFiles ? '저장된 글입니다. 선택한 첨부는 ‘첨부 저장’을 눌러 주세요.' : '저장된 글입니다.'; if (!pendingFiles) finishEdit({force:true}); }
    else void patch({raw_text:detail.querySelector('[data-basket-text]').value}, pendingFiles ? '수정한 글을 저장했습니다. 선택한 첨부는 ‘첨부 저장’을 눌러 주세요.' : '수정한 글을 저장했습니다.', {read:!pendingFiles});
  }
  else if (b.hasAttribute('data-basket-upload')) void saveAttachments();
  else if (b.hasAttribute('data-basket-reload')) void reloadDetail();
  else if (b.hasAttribute('data-basket-delete')) void deleteSelected();
  else if (b.hasAttribute('data-basket-archive')) void patch({archived_at:selected.archived_at ? null : new Date().toISOString()}, selected.archived_at ? '보관을 해제했습니다.' : '보관했습니다.');
});
function openHwpEditor(fileId){
  const file=selected?.attachments?.find(item=>item.drive_file_id===fileId);
  if(!file||editing)return;
  if(!requestHwpEdit({kind:'basket',noteId:selected.id,fileId,fileName:file.file_name},rt)){detail.querySelector('[data-basket-status]').textContent='로그인 정보를 확인하지 못했습니다. 다시 시도해 주세요.';return}
  window.KPTURouter.go('hwp-lab',{source:'delegated'});
}
// [자료실에서 보기] keeps a plain link for new tabs; in place it hands the
// document to the library view, which shows its row once loaded.
root.addEventListener('click', e => {
  const a = e.target.closest('a[data-basket-library-open]'); if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault(); if (busy || editing) return;
  requestLibraryDocument(a.dataset.basketLibraryOpen, rt); window.KPTURouter.go('library', {source:'delegated'});
});
window.addEventListener('storage',()=>guardOcrPrivacy());
root.addEventListener('keydown', e => { if (noteHost.contains(e.target)) return; guardOcrPrivacy(); if (e.key === 'Escape' && selected && !busy) { e.preventDefault(); if (noteMenu() && !noteMenu().hidden) setNoteMenu(false, {focus:true}); else if (manual.isOpen()) manual.cancel(); else if (toNoteOpen()) closeToNote(); else closeDetail(); } });
window.addEventListener('kptu:before-reload', e => {
  if (busy||quick?.isBusy()||noteDocs.isBusy()) e.preventDefault();
  else if (quick?.hasDraft()||noteDocs.hasDraft()) e.detail.otherDraft=true;
  else if (dirty() || manualDraft() || classification.hasDraft()) e.detail.otherDraft = true;
});
window.addEventListener('kptu:session-changed', () => {
  guardOcrPrivacy();
  const next = scope(); if (next === currentScope) return;
  currentScope = next; retainedForTraversal=false; requestedNote = null; epoch++; notes = []; links = []; closeDetail({focus:false,force:true,cleanAddress:false}); noteDocs.reset(); showKind('memo'); renderList();
});
window.addEventListener('kptu:before-view-change',e=>{
  if(retainedForTraversal&&((busy&&!handoffBusy)||quick?.isBusy()||quick?.hasDraft()||dirty()||manualDraft()||classification.isOpen()))e.detail.retainBasketDraft=true;
  if(window.KPTURouter.current!=='basket'||e.detail?.view==='basket')return;
  // Without a native entry position, honor the traversal and retain the draft
  // in this mounted view. Never guess its direction or rewrite the destination.
  if(e.detail?.source==='popstate'&&!e.detail.canRestoreHistory&&((busy&&!handoffBusy)||quick?.isBusy()||quick?.hasDraft()||dirty()||manualDraft())){
    e.detail.retainBasketDraft=true;return;
  }
  const blockedBusy=quick?.isBusy()||noteDocs.isBusy()||busy&&!handoffBusy&&(!classification.isOpen()||e.detail?.source==='popstate');
  if(blockedBusy||(noteDocs.hasDraft()&&!window.confirm('고치던 노트를 버리고 다른 화면으로 갈까요?'))||(quick?.hasDraft()&&!window.confirm('저장하지 않은 입력이 있어요. 다른 화면으로 갈까요? 입력은 이 탭에 남아요.'))||(dirty()&&!window.confirm('수정 중인 글을 버리고 다른 화면으로 갈까요?'))||(!dirty()&&manualDraft()&&!window.confirm('작성 중인 연결·할 일 입력을 버리고 다른 화면으로 갈까요?'))){
    e.preventDefault();
  }
});
window.addEventListener('kptu:view-changed',e=>{
  if(e.detail?.view==='basket'){retainedForTraversal=false;return;}
  setMore(false);if(!classification.isOpen())hideHandoffNotice();
  ocrGeneration++;
  if(e.detail?.retainBasketDraft){retainedForTraversal=true;return;}
  retainedForTraversal=false;clearNoteAddress();closeDetail({focus:false,force:true});noteDocs.close({focus:false,force:true});showKind('memo');
});
window.KPTURouter.on('basket', () => {
  void preloadMarkdown();
  const wanted = takeBasketNoteRequest(rt);
  if (busy || classification.isOpen() || noteDocs.isBusy() || noteDocs.hasDraft()) return;
  noteDocs.close({focus:false,force:true}); showKind('memo');
  filter = 'unclassified'; renderList();
  // Keep the same editor and its unsaved text when returning from another view.
  if (dirty() || manualDraft()) { openNoteLayer({adoptOnly:true}); return; }
  closeDetail({focus:false}); if (wanted) requestedNote = wanted; renderList(); void refresh();
});
// UI-디자인손질 8: a note saved from the menu [쓰기] shows up here without leaving the current screen.
window.addEventListener('kptu:basket-note-created',()=>{if(window.KPTURouter.current==='basket'&&!selected&&!busy&&!classification.isOpen())void refresh();});
renderList(); void refresh();
