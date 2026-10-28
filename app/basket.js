import {waitInlineHtml} from './wait-state.js';
import {holdToast as kptuHoldToast} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {basketOcrFor} from './basket-ocr-runtime.js';
import {seoulInputValue, formatSeoulTime} from './meeting-time.js';
import {effectiveOcrText} from './basket-ocr-text.mjs';
import { mountQuick } from './home-quick.js';
import { readBasket, updateNote, saveUpdateDoc, readBasketNote, noteState, visibleNotes, filedProjects, filedOrganizations, moveToNote, suggestNoteTitle, BASKET_PLACES, noteClassified, placeSubOptions, canKeepInJournal } from './basket-data.js';
import { noteJournalAt, setNoteJournal } from './update-journal.js';
import { noteRequests, requestTagsHtml } from './update-requests.js';
import { renderFilterChips } from './filter-chips.js';
import { mountNotes } from './basket-notes.js';
import { mountInboxTodos } from './inbox-todos.js';
import { openSource as openTodoSource, radarPromises, radarFindState, radarFindAgain, radarClock } from './todo-radar.js';
import { noteTasks, requestTaskOpen, takeBasketNoteRequest, takeNoteDocRequest, takeBasketKindRequest, basketNoteOrigin, basketReturnHtml } from './basket-note-tasks.js';
import { deleteNoteOriginal, disconnectWithUndo, disconnectLabel, offerUndoNotice } from './basket-record-delete.js';
import { mountManualLink } from './basket-manual-link.js';
import { sendAttachmentToLibrary, requestLibraryDocument, libraryHref } from './basket-library-send.js';
import { fillLibraryDocument } from './library-ai-fill.js';
import { readAttachmentDocuments, putFilesIntoTargets } from './basket-file-docs.js';
import { loadDocumentCategories } from './document-categories.js';
import { isHwpName, requestHwpEdit } from './hwp-drive.js';
import { renderMarkdownInto, showPlainText, preloadMarkdown, renderShareCards } from './markdown-view.js';
import { paintHtmlAttachments } from './html-frame.js';
import { copyText } from './copy-text.js';
import { flashDone } from './press-feedback.js'; // UI-눌림느낌: the pressed [복사] turns into '✓' for 1.5s
// ED③ 업데이트: an update saved in the new editor reads its saved form (ed-render) and copies from it; its big window is update-window.js.
import { hasDoc } from './note-doc.mjs';
import { paintDoc, docCopy } from './note-body.js';
import { toTelegram } from './md-telegram.mjs';
import { photoElement } from './diary-data.js';
import { openPhotoView, closePhotoView } from './photo-view.js';
import { pressFile, downloadFile, driveDownloadUrl } from './file-actions.js';
import { fileKind } from './meeting-compact.js';
import { attachmentName } from './attachment-name.mjs';

import { createUploadBatch, uploadBatch, mountBasketPicker, driveFileUrl, fileSize } from './basket-upload.js';
import { placeAnchored, followAnchor, clearAnchored, isWide } from './anchored-popup.js';

const root = document.querySelector('#basketView'), rt = window.KPTURuntime;
// STAB-간헐3: the refresh run whose list read is still pending (0 = none). Until it answers, an empty list is "loading",
// not "no updates" (a segment click repaints the list meanwhile).
let loadingRun = 0;
let notes = [], links = [], docs = [], filter = 'unclassified', place = 'all', sub = 'all', selected = null, editing = false, busy = false, epoch = 0, rawView = false;
const scope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
let upload = createUploadBatch(), pickerFiles = null;
let quick=null, bigWriter=null, bigPicker=null, bigOpening=false;
let currentScope = scope(), retainedForTraversal = false;
// BUG-뒤로가기: an opened memo is one router layer, so Back returns to the list at the same scroll.
let noteLayer = null, listScroll = 0;
const initialUrl = new URL(location.href);
// A source-note link from the task view hands its note over in-app; a full load reads ?note=.
let requestedNote = (initialUrl.searchParams.get('view') === 'basket' ? initialUrl.searchParams.get('note') : null) || takeBasketNoteRequest(rt);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// UI-바구니상세개편: results ("저장했습니다", "복사했습니다") are one short notice on the app's shared #toast that goes
// away by itself (same element and timing as the other screens); errors and guidance stay in the screen's status line.
function showToast(message) {
  const toast = document.querySelector('#toast'); if (!toast) return;
  toast.textContent = message; kptuHoldToast(toast);
}
// [복사]: the same conversion as the write window's [텔레그램용 복사] (md-telegram.mjs), on a copy only.
async function copyNote(note, button = null) {
  const text = String(note?.raw_text || '');
  if (!text.trim()) { showToast('복사할 글이 없어요.'); return; }
  // ED③ 업데이트: an update with a saved form copies from it (ed-text), as the note does; the others keep the old conversion.
  const copy = docCopy(note);
  const ok = await copyText(copy ? copy.text : toTelegram(text));
  if (ok && button) flashDone(button); // UI-눌림느낌: the pressed [복사] says '✓' itself; the toast stays as the second hint
  showToast(ok ? '복사했습니다' : '복사하지 못했어요. 다시 눌러 주세요.');
}
const COPY_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const RAW_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LINK_ICONS = {
  drive: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  library: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M2.5 5.5h11v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1zM1.5 2.5h13v3h-13zM6.5 8.5h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  download: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M2.5 13.5h11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M10.5 2.5l3 3-8 8h-3v-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
};
const time = note => { const d = new Date(note.occurred_at); return Number.isNaN(d.getTime()) ? '' : formatSeoulTime(d, {year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}); };
root.innerHTML = `<div class="basket-head"><h2>정리함</h2><p class="inbox-summary" data-inbox-summary role="status"></p><button type="button" class="inbox-find" data-inbox-find>다시 찾기</button></div><section class="inbox-section" data-inbox-todo-section aria-labelledby="inboxTodoTitle"><div class="inbox-section-head"><h3 id="inboxTodoTitle">챙길 것<span class="inbox-pane-count" data-inbox-pane-count="todo"></span></h3><div class="inbox-chips" role="group" aria-label="챙길 것 보기" data-inbox-todo-chips><button type="button" class="inbox-chip" data-inbox-chip="open" aria-pressed="true">처리 전</button><button type="button" class="inbox-chip" data-inbox-chip="tasked" aria-pressed="false">보냄</button><button type="button" class="inbox-chip" data-inbox-chip="dismissed" aria-pressed="false">무시</button></div></div><div class="inbox-todo-host" data-inbox-todo-host></div></section><div class="basket-switch-row inbox-section-head"><h3 id="inboxUpdateTitle">업데이트<span class="inbox-pane-count" data-inbox-pane-count="update"></span></h3><div class="basket-filters quick-mode-group" role="group" aria-label="업데이트 보기" data-update-filters><button type="button" class="quick-pill-button" data-basket-filter="unclassified">미분류<span class="basket-filter-count" data-basket-filter-count></span></button><button type="button" class="quick-pill-button" data-basket-filter="classified">분류 완료</button><button type="button" class="quick-pill-button" data-basket-filter="archived">보류</button></div></div><div class="basket-place-filter" data-basket-place-filter hidden></div><div class="basket-place-filter basket-sub-filter" data-basket-sub-filter hidden></div><button type="button" class="quick-text-link basket-ref-open" data-basket-ref-open data-goto="reference" hidden>참고 묶음 화면 ›</button><div data-basket-list><div class="home-quick-placeholder" aria-hidden="true"></div><p data-basket-list-status role="status"></p><button type="button" data-basket-retry hidden>다시 시도</button><div data-basket-rows id="basketRows"></div><div id="basketRowMenu" class="basket-more-menu basket-row-pop-menu" role="group" aria-label="업데이트 메뉴" hidden></div></div><div data-basket-detail hidden></div><div class="note-host" data-note-host hidden></div>`;
// Keep the basket heading available to assistive navigation; the shell owns
// the visible mobile title at the same 760px breakpoint as the shared header, and from 1024px the PC top line
// ('정리함' / '노트') names the screen (UI-화면정리 B ①), so the body title is visible only at 761~1023px.
const basketTitle=root.querySelector('.basket-head > h2'),mobileTitle=window.matchMedia('(max-width:760px),(min-width:1024px)');
const syncTitle=()=>basketTitle.classList.toggle('a11y-only',mobileTitle.matches);
mobileTitle.addEventListener('change',syncTitle);syncTitle();
// UI-디자인손질 6: an open note has its own [⋯] (수정·원문 그대로 보기·보관·삭제) in its head row, with the same small-menu behavior.
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
// UI-업데이트목록메뉴: each update row has [⋯] beside [복사] (same look and behavior as the note rows, basket-notes.js):
// 수정 · 연결하기 · 할 일 만들기 · 노트로 옮기기 · 업무일지에 남기기(또는 업무일지에서 빼기) · 삭제. It opens right under the pressed ⋯ (anchored-popup.js, PC and phone),
// one at a time, and closes on Esc (focus back to the ⋯), an outside press, leaving it by keyboard or choosing an item.
// Each item reuses the detail's own path (openDetail and its buttons); an item the detail would refuse is left out.
const rowMenuEl=root.querySelector('#basketRowMenu');
let rowMenu=null;
// UI-모바일노트복사메뉴: on a phone the row has no [복사] button; [복사] is the first item of this menu (PC keeps the button).
function rowMenuItems(note){
  return [...(!isWide()&&String(note.raw_text||'').trim()?[['copy','복사']]:[]),['edit','수정'],...(note.archived_at||note.ai_export_allowed!==true?[]:[['link','연결하기']]),['task','할 일 만들기'],['to-note','노트로 옮기기'],['to-report','사업 보고로 옮기기'],...journalItem(note),note.archived_at?['unhold','보류 해제']:['hold','보류로'],['delete','삭제','basket-menu-danger']];
}
// BASKET-일지로남기기: [업무일지에 남기기] for an update that went to no organization and no project; [업무일지에서 빼기] once kept.
function journalItem(note){
  if(noteJournalAt(note))return [['unjournal','업무일지에서 빼기']];
  return canKeepInJournal(note,links,docs)?[['journal','업무일지에 남기기']]:[];
}
function closeRowMenu({focus=false}={}){
  if(!rowMenu)return null;
  const closed=rowMenu;rowMenu=null;closed.stop();
  rowMenuEl.hidden=true;clearAnchored(rowMenuEl);
  closed.trigger.setAttribute('aria-expanded','false');
  if(focus&&closed.trigger.isConnected)closed.trigger.focus({preventScroll:true});
  return closed;
}
function openRowMenu(trigger){
  const note=notes.find(n=>n.id===trigger.dataset.basketRowMore);
  if(rowMenu?.trigger===trigger){closeRowMenu({focus:true});return;}
  closeRowMenu();if(!note||busy||selected)return;
  rowMenuEl.innerHTML=rowMenuItems(note).map(([act,label,cls])=>`<button type="button" data-basket-row-act="${act}"${cls?` class="${cls}"`:''}>${label}</button>`).join('');
  rowMenuEl.hidden=false;
  const place=()=>placeAnchored(rowMenuEl,trigger,{maxWidth:220,maxHeight:320});
  place();
  rowMenu={noteId:note.id,trigger,stop:followAnchor(rowMenuEl,trigger,{place,lost:()=>closeRowMenu()})};
  trigger.setAttribute('aria-expanded','true');
  rowMenuEl.querySelector('button')?.focus({preventScroll:true});
}
root.addEventListener('keydown',e=>{if(e.key==='Escape'&&rowMenu){e.preventDefault();e.stopPropagation();closeRowMenu({focus:true});}});
root.addEventListener('focusout',e=>{if(rowMenu&&e.relatedTarget&&!rowMenuEl.contains(e.relatedTarget)&&e.relatedTarget!==rowMenu.trigger)closeRowMenu();});
document.addEventListener('click',e=>{if(rowMenu&&!rowMenuEl.contains(e.target)&&!rowMenu.trigger.contains(e.target))closeRowMenu();});
const list = root.querySelector('[data-basket-list]'), detail = root.querySelector('[data-basket-detail]'), listStatus = root.querySelector('[data-basket-list-status]');
const ocrViews=new Map();
// Per scope, note and file: the last send result shown on the read view. A send
// in flight keeps that attachment's button off; a sent or unknown result is a
// status badge, not a button, so nothing resends.
const librarySends=new Map();
const libraryKey=fileId=>`${scope()}:${selected?.id}:${fileId}`;
// UI-바구니첨부메모: which attachments are already library documents (read when a note opens), per scope and file.
const libraryDocs=new Map();
const docKey=fileId=>`${scope()}:${fileId}`;
function knownDocs(){const out=new Map();for(const file of selected?.attachments||[]){const doc=libraryDocs.get(docKey(file.drive_file_id));if(doc)out.set(file.drive_file_id,doc);}return out;}
const librarySent=fileId=>librarySends.get(libraryKey(fileId))||(libraryDocs.get(docKey(fileId))?{kind:'exists',document:{id:libraryDocs.get(docKey(fileId)).id}}:null);
// Written text decides the screen: a memo with only attachments puts its files first (①~⑥).
// Reading focus: the text, or the files of a memo without text (never the keyboard).
const readFocus=()=>detail.querySelector(filesOnly(selected)?'[data-basket-attachments]':'[data-basket-read-text]');
const filesOnly=note=>!!note&&!String(note.raw_text||'').trim()&&(note.attachments||[]).length>0;
async function loadLibraryDocs(){
  const note=selected,owner=scope();if(!note?.attachments?.length)return;
  let found;try{found=await readAttachmentDocuments(note.attachments,{rt});}catch{return;}
  if(owner!==scope())return;
  for(const [id,doc] of found)libraryDocs.set(`${owner}:${id}`,doc);
  if(selected?.id===note.id)paintAttachments();
}
async function putFiles({projectId=null,organizationId=null,projectName='',organizationName=''},isCurrent){
  const note=selected,owner=scope();
  const result=await putFilesIntoTargets({noteId:note.id,files:note.attachments||[],projectId,organizationId,known:knownDocs(),rt,expectedSessionEpoch:rt.session.epoch(),isCurrent:()=>isCurrent()&&owner===scope()});
  if(owner===scope()){
    for(const [id,doc] of result.docs||[])libraryDocs.set(`${owner}:${id}`,doc);
    // BUG-자료넣기미분류: placed files make this memo classified ("○○ · 자료") at once; the documents-changed re-read confirms it.
    for(const [fileId,doc] of result.docs||[]){
      const before=docs.find(d=>d.file_id===fileId);
      docs=[...docs.filter(d=>d.file_id!==fileId),{id:doc.id,file_id:fileId,project_id:doc.project_id||null,organization_id:doc.organization_id||null,category:before?.category??doc.category??null,
        project:{name:doc.project_id&&doc.project_id===projectId?projectName||'사업영역':before?.project?.name||''},
        organization:{name:doc.organization_id&&doc.organization_id===organizationId?organizationName||'조직':before?.organization?.name||''}}];
    }
    renderList();
    if(selected?.id===note.id)paintStateLine();
  }
  if(selected?.id===note.id)paintAttachments();
  return result;
}
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
  if(value.code==='NOTE_CHANGED')return '업데이트가 변경되었습니다. 저장된 업데이트를 확인해 주세요.';
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
      if(action==='read'&&snapshot.updated_at!==selected.updated_at){status.textContent='업데이트가 변경되었습니다. 업데이트를 다시 불러온 후 읽어 주세요.';return;}
    }
    let options;
    if(action==='reconcile'){
      const view=ocrViews.get(ocrKey(fileId));
      if(!view?.checkedAttempt)return;
      if(view.stamp!==selected.updated_at||view.outcome?.code==='NOTE_CHANGED'){
        if(!window.confirm('저장된 업데이트가 변경되었습니다. 수정 중인 글은 유지하고 현재 저장된 업데이트에 이 시도의 글자를 반영할까요?'))return;
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
// The manual link panel: show the confirmed
// destinations at once, then replace them with one fresh read.
async function linksConfirmed(noteId,targets){
  // REF-참고묶음: a reference target is the link column bundle_id and its name object 'bundle' (as basket-data.js reads it).
  for(const target of targets){const key=target.kind==='project'?'project_id':target.kind==='reference'?'bundle_id':'organization_id',named=target.kind==='reference'?'bundle':target.kind;
    if(!links.some(l=>l.note_id===noteId&&l[key]===target.target_id&&l.status==='confirmed'))
      links.push({note_id:noteId,status:'confirmed',[key]:target.target_id,[named]:{name:target.name}});
  }
  renderList();if(selected?.id===noteId)paintDetailState();
  const owner=scope();
  try { const current=await readBasket(undefined, {doc:true});if(owner!==scope())return {ok:false,stale:true};notes=current.notes;links=current.links;docs=current.docs;renderList();
    if(selected?.id===noteId){selected=notes.find(n=>n.id===noteId)||selected;paintDetailState();}
    return {ok:true}; }
  catch { return {ok:false}; }
}
const manual = mountManualLink({esc,rt,getNote:()=>selected,getLinks:()=>links,isBusy:()=>busy,
  setBusy:setDetailBusy,onLinked:linksConfirmed,onNoteChanged:()=>reloadDetail(),onModeChange:()=>paintMode(),onTaskRecorded:noteMetadataSaved,
  files:{read:()=>({files:selected?.attachments||[],docs:knownDocs()}),put:putFiles}});
function setDetailBusy(value){busy=value;detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=value);if(!value){pickerFiles?.render();paintOcrControls();}manual.controls();}
// Only metadata changed: the original's version (updated_at), text and attachments stay as they are.
function noteMetadataSaved(saved){
  if(!saved?.id)return;
  for(const note of new Set([notes.find(n=>n.id===saved.id),selected?.id===saved.id?selected:null]))if(note)note.metadata=saved.metadata;
  renderList();
  if(selected?.id===saved.id){paintNoteTasks();paintStateLine();paintJournalButton();}
}
const manualDraft=()=>!!selected&&manual.hasDraft();
// BASKET-정리함한화면: one screen, two boxes — '챙길 것' above, '업데이트' below (never one merged list), under one top line
// '챙길 것 n · 업데이트 n · 마지막 찾기 hh:mm' with a small [다시 찾기]. [노트] is its own menu item that opens this same panel on
// the note side (kind = 'note', written to #basketView[data-kind] for the menu marks).
// basket.js owns kind and the top line; basket-notes.js owns the note side, inbox-todos.js what is inside the '챙길 것' box.
const noteHost=root.querySelector('[data-note-host]');
let kind='memo';
root.dataset.kind=kind;
const switchRow=root.querySelector('.basket-switch-row');
const todoSection=root.querySelector('[data-inbox-todo-section]'),todoHost=root.querySelector('[data-inbox-todo-host]'),todoChips=root.querySelector('[data-inbox-todo-chips]');
const summaryLine=root.querySelector('[data-inbox-summary]'),findButton=root.querySelector('[data-inbox-find]');
// UI-일기손질 ⑥: the [메모 | 노트] row and the list head have one painter. They show only while a list is on screen;
// an open memo or note draws its own "‹ 바구니" head (a note: its title and ⋯, no back button) in that place instead.
// BASKET-드롭제목: a memo's title is its first line; a memo with only files is titled by its first file (a name cut by the old upload reader shows cleaned,
// and one with nothing left is just "파일"/"사진", attachment-name.mjs). The list row and the PC top line (UI-상단줄제목) use this one function.
const memoLines=note=>String(note.raw_text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
function memoTitle(note){
  const lines=memoLines(note),file=note.attachments?.[0];
  const fileTitle=file?[String(file.mime_type||'').startsWith('image/')?'사진':'파일',attachmentName(file,'')].filter(Boolean).join(' · '):'';
  return lines[0]||fileTitle||'업데이트';
}
// UI-상단줄제목: the open update's title goes to the PC top line's place (kptu:where-item, topbar-actions.js); null drops it. Notes send their own (basket-notes.js).
// The place is keyed by screen, so the update's and the note's titles are told apart by the side that is open (only one detail is open at a time).
const sendMemoWhere=name=>window.dispatchEvent(new CustomEvent('kptu:where-item',{detail:{view:'basket',name,kind:'memo'}}));
function paintListChrome(){const open=!!selected||noteDocs.isOpen(),notes=kind==='note';switchRow.hidden=open||notes;listHead.hidden=open;todoSection.hidden=open||notes;summaryLine.hidden=notes;findButton.hidden=notes;}
const noteDocs=mountNotes(noteHost,{esc,rt,onOpenChange:()=>paintListChrome(),onMovedToBasket:()=>void refresh()});
// The menu marks ([정리함] / [노트] in the sidebar, tabs and menu sheet) follow the side shown: the router reads #basketView[data-kind].
function paintNavKind(){
  const on=window.KPTURouter?.current==='basket';
  window.dispatchEvent(new CustomEvent('kptu:basket-kind',{detail:{kind:on?kind:null}}));
  window.KPTURouter?.syncNavigation?.();
}
window.addEventListener('kptu:view-changed',paintNavKind);
// The two numbers (챙길 것: 처리 전, 업데이트: 미분류) are drawn by this one painter: each box's title and the top line. Unknown (loading) draws nothing.
const counts={todo:null,update:null};
function paintSummary(){
  const state=radarFindState();
  const parts=[counts.todo===null?null:`챙길 것 ${counts.todo}`,counts.update===null?null:`업데이트 ${counts.update}`,
    state.checkedAt?`마지막 찾기 ${radarClock(state.checkedAt)}`:null].filter(Boolean);
  summaryLine.textContent=parts.join(' · ');
  findButton.disabled=state.finding||state.missing;findButton.toggleAttribute('aria-busy',state.finding);
}
const paintPaneCount=(which,value)=>{
  counts[which]=value===undefined?null:value;
  const el=root.querySelector(`[data-inbox-pane-count="${which}"]`);if(el)el.textContent=value===null||value===undefined?'':' '+value;
  paintSummary();
};
const todo=mountInboxTodos(todoHost,{rt,esc,chips:todoChips,onCount:value=>paintPaneCount('todo',value),openSource:openTodoSource,radarPromises});
todo.show(true);
// [다시 찾기]: the same finder as the work journal and home box (todo-radar.js); its change event makes the '챙길 것' box read again.
async function findAgain(){
  paintSummary();
  try{await radarFindAgain();}catch{/* the finder keeps its own status line */}
  paintSummary();
  const {status}=radarFindState();if(status)showToast(status);
}
window.addEventListener('kptu:todo-radar-changed',()=>paintSummary());
// NAV-새로고침제자리: the note side is written to the address (?view=basket&pane=note); the 정리함 itself has no parameter.
// BASKET-정리함한화면: the old address of the '챙길 것' side (?view=basket&pane=todo) opens this screen at the '챙길 것' box.
const paneSub=()=>kind==='note'?'note':null;
const showTodoBox=()=>{if(kind==='memo'&&!selected)todoSection.scrollIntoView?.({block:'start'});};
// Back / forward between the sides of this screen (kptu:sub-changed from the router). A step the screen has to refuse (busy, open record) puts the address back.
window.addEventListener('kptu:sub-changed',e=>{
  if(e.detail?.view!=='basket')return;
  const wantedKind=e.detail.sub==='note'?'note':'memo';
  if(e.detail.sub==='todo'){window.KPTURouter?.setSub?.('basket',paneSub(),{replace:true});if(wantedKind===kind){showTodoBox();return;}}
  if(wantedKind===kind)return;
  if(busy||selected||noteDocs.isBusy()||noteDocs.isOpen()){window.KPTURouter?.setSub?.('basket',paneSub(),{replace:true});return;}
  closeRowMenu();
  // NAV-새로고침제자리: a reload on the note side arrives here (the screen was shown before this module loaded, so its view hook did not
  // run): the open note and the folder entered come from the address, like the view hook reads them.
  const written=wantedKind==='note'?window.KPTURouter?.place?.('basket')||{}:{};showKind(wantedKind,{address:false,openId:written.doc||null,folder:written.folder||null});
  if(e.detail.sub==='todo')showTodoBox();
});
// address: how the side reaches the address — 'replace' corrects it to the side shown (entering the screen), 'push' is a step of its
// own (an update moved to the notes), false leaves it (a back/forward step already wrote it, or the screen is being left).
function showKind(next,{openId=null,folder=null,address='replace'}={}){
  closeRowMenu();kind=next;root.dataset.kind=kind;
  basketTitle.textContent=kind==='note'?'노트':'정리함';
  const memo=kind==='memo';
  paintListChrome();
  list.hidden=!memo||!!selected;noteHost.hidden=memo;
  if(memo)renderList();
  paintNavKind();
  if(address&&window.KPTURouter?.current==='basket')window.KPTURouter.setSub?.('basket',paneSub(),{replace:address==='replace'});
  if(!memo)noteDocs.show({openId,folder});
}
// UI-업데이트목록메뉴: a list row's menu item. 수정 opens the detail in edit mode; 연결하기·할 일 만들기 open the detail with that
// panel already open (the detail's own button path); 노트로 옮기기 asks once (the row's text is not on screen), then runs the
// detail's own move; 삭제 is the detail's delete (same confirmation from basket-record-delete.js), reported on the list.
function rowMenuAction(act,noteId){
  const note=notes.find(n=>n.id===noteId);if(!note||busy||selected)return;
  if(act==='copy'){void copyNote(note,()=>root.querySelector(`[data-basket-row-copy="${CSS.escape(noteId)}"]`));return;}
  
  if(act==='delete'){void deleteFromList(noteId);return;}
  if(act==='journal'||act==='unjournal'){void keepInJournal(noteId,act==='journal');return;}
  if(act==='hold'||act==='unhold'){void holdFromList(noteId,act==='hold');return;}
  if(act==='to-report'){void moveToReport(note,rowMenuEl.querySelector('button')||root);return;}
  if(act==='to-note'&&!window.confirm(`‘${[...suggestNoteTitle(note).replace(/[\r\n]+/g,' ').trim()||'이 업데이트'].slice(0,40).join('')}’을(를) 노트로 옮길까요?`))return;
  openDetail(noteId,{edit:act==='edit'});
  if(selected?.id!==noteId)return;
  if(act==='link'||act==='task'){const message=manual.open(act);detail.querySelector('[data-basket-status]').textContent=message||'';}
  else if(act==='to-note')void saveToNote();
}
// MTG-사업보고 7단계 [사업 보고로 옮기기]: 칸 고르기 → 일시=업데이트 날짜, 결과=업데이트 글이 채워진 사업 보고 입력 창. 저장되면 업데이트 → 사업 보고 연결 한 줄을
// 소유자 RLS 아래 REST 로 더한다(새 DB 변경 없음). 업데이트는 지우지 않아 첨부도 그대로이고, 바구니에서는 '분류됨'으로 칩에 사업 보고 이름이 보인다.
async function moveToReport(note,trigger){
  try{
    await window.KPTUViewLoader?.prepare?.('meetings');
    if(!window.KPTUReportEntry)throw new Error('missing');
    const workspaceId=rt.context.read()?.workspace?.id;
    await window.KPTUReportEntry.open({text:String(note.raw_text||''),at:seoulInputValue(note.occurred_at||note.created_at),trigger,
      onSaved:async meeting=>{await rt.api('/rest/v1/app_record_links',{method:'POST',body:{workspace_id:workspaceId,note_id:note.id,meeting_id:meeting.id,status:'confirmed'}});window.dispatchEvent(new Event('kptu:basket-links-changed'));void refresh()}});
  }catch(error){console.error('basket to report',error);listStatus.textContent='사업 보고 입력 창을 열지 못했어요. 다시 시도해 주세요.'}
}
// UPD-보류이름통일: [보류로] / [보류 해제] from the list menu. Same stored field as the detail's button (archived_at); the row leaves this
// list at once and the 미분류 number follows (renderList counts again).
async function holdFromList(noteId,on){
  if(busy||selected)return;
  const run=++epoch,owner=scope();busy=true;listStatus.textContent='';
  let saved=null;
  try{saved=await updateNote(noteId,{archived_at:on?new Date().toISOString():null});}catch{saved=null;}
  finally{busy=false;}
  if(owner!==scope()||run!==epoch||selected)return;
  if(!saved){listStatus.textContent=on?'보류로 보내지 못했어요. 다시 시도해 주세요.':'보류를 해제하지 못했어요. 다시 시도해 주세요.';root.querySelector(`[data-basket-row-more="${CSS.escape(noteId)}"]`)?.focus({preventScroll:true});return;}
  notes=notes.map(n=>n.id===noteId?saved:n);
  renderList();showToast(on?'보류로 보냈어요.':'보류를 해제했어요.');
  root.querySelector(`[data-basket-filter="${filter}"]`)?.focus({preventScroll:true});
}
async function deleteFromList(id){
  if(busy||selected)return;
  const run=++epoch,owner=scope();busy=true;listStatus.textContent='';
  const current=()=>run===epoch&&owner===scope()&&!selected&&window.KPTURouter.current==='basket';
  const more=()=>root.querySelector(`[data-basket-row-more="${CSS.escape(id)}"]`);
  let result;
  try{result=await deleteNoteOriginal(id,{rt,isCurrent:current,trash:true});}
  catch{result={status:'unknown',message:'결과를 확인하지 못했어요. 업데이트 다시 불러오기로 실제 상태를 확인해 주세요.'};}
  finally{busy=false;}
  if(!current()||result.status==='stale')return;
  if(['deleted','missing'].includes(result.status)){
    notes=notes.filter(n=>n.id!==id);links=links.filter(l=>l.note_id!==id);
    renderList();if(result.message)listStatus.textContent=result.message;
    root.querySelector(`[data-basket-filter="${filter}"]`)?.focus({preventScroll:true});
    return;
  }
  if(result.status!=='cancelled')listStatus.textContent=result.message;
  more()?.focus({preventScroll:true});
}
// [노트로 옮기기] (UI-바구니상세개편): one press, no title form. The database requires a one-line title on a note
// (app_notes_title_check), so the memo's first line (or its first file name) is saved as the title, as the old form
// pre-filled it. The same row changes kind; links, attachments and tasks stay with it. Then a short notice and the note opens.
async function saveToNote(){
  if(!selected||busy||editing||manual.isOpen())return;
  const status=detail.querySelector('[data-basket-status]'),title=suggestNoteTitle(selected).replace(/[\r\n]+/g,' ').trim()||'노트';
  const id=selected.id,run=++epoch,owner=scope();busy=true;
  detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=true);status.textContent='노트로 옮기는 중…';
  try{
    await moveToNote(id,title);
    if(run!==epoch||owner!==scope())return;
    notes=notes.filter(n=>n.id!==id);links=links.filter(l=>l.note_id!==id);busy=false;
    closeDetail({force:true,focus:false});renderList();showKind('note',{openId:id,address:'push'});showToast('노트로 옮겼어요.');
  }catch{
    if(run!==epoch||owner!==scope())return;
    status.textContent='노트로 옮기지 못했어요. 다시 시도해 주세요.';
  }finally{if(busy){busy=false;detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=false);paintOcrControls();}}
}
// 보류 = archived_at. noteState keeps the stored word '보관' (the Drive copy in drive-summary says the same, a server contract); the screen shows 보류.
const stateLabel=state=>({확정:'분류 완료', '분류 제안됨':'정리 제안 있음', 보관:'보류'})[state]||state;
// UI-바구니거르기: a memo with no link but a Google task made from it is classified ([분류]·[할 일]), not 미분류.
// BASKET-일지로남기기: one kept as a work-journal memo says so (it can have a task too).
const rowState=(note,state)=>state.status==='미분류'&&noteClassified(note,links,docs)?(noteJournalAt(note)?'업무일지 메모':'할 일 만듦'):stateLabel(state.status);
// UI-디자인손질 6: each confirmed link is a colored-dot chip. BUG-바구니연결해제: organization and project
// chips get × (disconnect, 44px target); on the note screen the chip itself opens that place.
// Meeting and library chips stay plain: their links cannot be put back by the existing link path.
// REF-참고묶음 화면 2: a reference chip ("참고: ○○") gets × too (restoreRecordLink takes kind 'reference'), and on the note screen
// it opens that bundle on the 참고 묶음 screen.
const chipKinds=[['project','사업영역'],['organization','담당조직'],['meeting','사업 보고'],['document','자료실'],['bundle','참고']];
const confirmedLinks = noteId => links.filter(l => l.note_id === noteId && l.status === 'confirmed');
function chipInfo(link) {
  const [kind, label] = chipKinds.find(([key]) => link[key + '_id']) || ['other', '연결'];
  return {kind, label, name: link[kind]?.name || link[kind]?.title || link[kind]?.series_name || '연결 대상 없음', removable: !!link.id && (kind === 'organization' || kind === 'project' || kind === 'bundle')};
}
function linkChip(link, {open = false} = {}) {
  const {kind, label, name, removable} = chipInfo(link);
  const body = `<span class="basket-chip-dot" aria-hidden="true"></span><span class="a11y-only">${esc(label)}: </span>${esc(name)}`;
  const main = open && removable ? `<button type="button" class="basket-chip-open" data-basket-chip-open="${esc(link.id)}">${body}</button>` : `<span class="basket-chip-name">${body}</span>`;
  const remove = removable ? `<button type="button" class="basket-chip-x" data-basket-unlink="${esc(link.id)}" aria-label="${esc(disconnectLabel(name))}"><span aria-hidden="true">×</span></button>` : '';
  return `<span class="basket-chip" data-chip-kind="${esc(kind)}"${removable ? ` data-basket-chip="${esc(link.id)}"` : ''}>${main}${remove}</span>`;
}
// BUG-자료넣기미분류: a project holding this memo's files ([자료로 넣기]) is one plain chip "○○ · 자료".
// Moving or removing the documents elsewhere changes it on the next read; there is nothing to undo here.
function filedChips(note) {
  const chip = (kind, id, name, label) => `<span class="basket-chip" data-chip-kind="${kind}" data-basket-filed${kind === 'organization' ? '-org' : ''}="${esc(id)}"><span class="basket-chip-name"><span class="basket-chip-dot" aria-hidden="true"></span><span class="a11y-only">${label} 자료: </span>${esc(name)} · 자료</span></span>`;
  return [...filedOrganizations(note, docs).map(o => chip('organization', o.organization_id, o.name, '담당조직')), ...filedProjects(note, docs).map(p => chip('project', p.project_id, p.name, '사업영역'))];
}
// UI-바구니거르기: under [분류], one row of place chips (shared filter-chips.js) narrows by where the memo went.
// The choice lives only in this module's memory; entering the basket starts again at [미분류]·[전체].
const placeFilter = root.querySelector('[data-basket-place-filter]');
function paintPlaceFilter() {
  placeFilter.hidden = filter !== 'classified';
  if (placeFilter.hidden) return;
  renderFilterChips(placeFilter, {label:'분류된 곳', controls:'basketRows', value:place, options:BASKET_PLACES.map(([value, label]) => ({value, label})), onChange:value => {place = value; sub = 'all'; renderList(); }});
}
// UI-바구니거르기2: [담당조직]/[프로젝트] → one row of names ([모든 ○○ N] + places holding a memo, most first),
// [자료실] → the 7 document categories. [전체]·[할 일] have none. Same shared chips, same memory-only choice.
const subFilter = root.querySelector('[data-basket-sub-filter]');
const SUB_LABELS = {organization:'조직', project:'사업영역', reference:'참고 묶음', library:'자료 분류'};
function paintSubFilter() {
  // REF-참고묶음 화면 2: [분류] › [참고] also offers the 참고 묶음 screen (a text link under the bundle names).
  root.querySelector('[data-basket-ref-open]').hidden = !(filter === 'classified' && place === 'reference');
  const options = filter === 'classified' ? placeSubOptions(notes, links, docs, place) : null;
  subFilter.hidden = !options;
  if (!options) { sub = 'all'; return; }
  // A chosen name that is gone after a refresh (unlinked, moved) falls back to [모든 ○○].
  if (!options.some(o => o.value === sub)) sub = 'all';
  renderFilterChips(subFilter, {label:SUB_LABELS[place], controls:'basketRows', value:sub, options, onChange:value => {sub = value; renderList(); }});
}
// Tasks made from the memo have no link chip; the row names them in the same chip row ("할 일 N개").
function taskPlaceLine(note) {
  const count = noteTasks(note).length;
  return count ? `<span class="basket-chip" data-chip-kind="task"><span class="basket-chip-name"><span class="basket-chip-dot" aria-hidden="true"></span>할 일 ${count}개</span></span>` : '';
}
function renderList() {
  closeRowMenu();
  
  root.querySelectorAll('[data-basket-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.basketFilter === filter)));
  paintPlaceFilter(); paintSubFilter();
  const visible = visibleNotes(notes, links, filter, docs, place, sub);
  root.querySelector('[data-basket-rows]').innerHTML = visible.map(note => {
    const state = noteState(note, links, docs);
    const lines=memoLines(note),title=memoTitle(note);
    // BUG-바구니연결해제: links are chips under the row button (a button cannot hold the × button).
    const chips = [...confirmedLinks(note.id).map(link => linkChip(link)), ...filedChips(note)].join('') + taskPlaceLine(note);
    return `<div class="basket-row-item" data-basket-row-item="${esc(note.id)}"><button type="button" class="basket-row-copy" data-basket-row-copy="${esc(note.id)}" aria-label="${esc([...title].slice(0,40).join(''))} 복사"${String(note.raw_text||'').trim()?'':' hidden'}>${COPY_ICON}</button><button type="button" class="basket-row-more" data-basket-row-more="${esc(note.id)}" aria-label="${esc([...title].slice(0,40).join(''))} 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="basketRowMenu"><span class="more-dots" aria-hidden="true">⋯</span></button><button type="button" class="basket-row" data-basket-row="${esc(note.id)}"><b class="basket-title">${esc([...title].slice(0,80).join(''))}</b>${lines.length>1?`<span class="basket-preview">${esc([...lines.slice(1).join(' ')].slice(0,120).join(''))}</span>`:''}<time>${esc(time(note))}</time><span>${esc(rowState(note, state))}${note.attachments?.length ? ' · 첨부 ' + note.attachments.length + '개' : ''}</span>${requestTagsHtml(noteRequests(note), esc)}</button>${chips ? `<div class="basket-row-links" role="group" aria-label="연결된 곳">${chips}</div>` : ''}</div>`;
  }).join('');
  if (!visible.length && loadingRun) listStatus.innerHTML = waitInlineHtml(); else listStatus.textContent = visible.length ? `${visible.length}개 업데이트` : '업데이트 없음';
  listStatus.toggleAttribute('data-basket-empty', !visible.length && !loadingRun);
  const unclassifiedCount = visibleNotes(notes, links, 'unclassified', docs).length;
  root.querySelector('[data-basket-filter-count]').textContent = ' ' + unclassifiedCount;
  // BASKET-정리함한화면: the '업데이트' box title and the top line count what is not handled yet (미분류, not 보류). Unknown while the first read is pending.
  paintPaneCount('update', loadingRun && !notes.length ? null : unclassifiedCount);
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
  
  bigWriter?.close({silent:true}); closePhoto({restore:false});
  const id = selected?.id; if(id&&cleanAddress)clearNoteAddress(); ++epoch; selected = null;sendMemoWhere(null);editing=false;setNoteMenu(false);manual.reset();ocrViewScope=null; upload=createUploadBatch();pickerFiles=null; detail.replaceChildren(); detail.hidden = true; list.hidden = false; paintListChrome();
  const layer = noteLayer; noteLayer = null; if (!fromBack) layer?.close();
  if (id && window.KPTURouter.current === 'basket') window.scrollTo({top:listScroll, behavior:'instant'});
  if (focus) (root.querySelector(`[data-basket-row="${CSS.escape(id || '')}"]`) || root.querySelector(`[data-basket-filter="${filter}"]`))?.focus({preventScroll:true});
  return true;
}
function openNoteLayer({adoptOnly = false} = {}) {
  if (noteLayer || !selected) return;
  noteLayer = window.KPTURouter.layer?.open('basket-note', {adoptOnly, close: () => !busy && closeDetail({fromBack:true})}) || null;
}
function paintStateLine() {
  const state = noteState(selected, links, docs), box = detail.querySelector('[data-basket-state]');
  const chips = [...confirmedLinks(selected.id).map(link => linkChip(link, {open:true})), ...filedChips(selected)];
  box.innerHTML = chips.length ? `<span class="a11y-only">${esc(stateLabel(state.status))}: </span>${chips.join('')}` : `<span class="basket-state-text">${esc(rowState(selected, state))}</span>`;
}
function paintDetailState() {
  if (!selected) return;
  sendMemoWhere(memoTitle(selected));
  paintStateLine();
  paintAttachments();paintNoteTasks();
  detail.querySelector('[data-basket-archive]').textContent = selected.archived_at ? '보류 해제' : '보류로';
  paintJournalButton();
}
// BASKET-일지로남기기: the detail ⋯'s [업무일지에 남기기] / [업무일지에서 빼기] (the same choice as the list row's menu).
// The item is in the menu only while it is offered (before 삭제), so the menu lists exactly what can be pressed.
function paintJournalButton() {
  const menu = noteMenu(); if (!menu || !selected) return;
  const kept = !!noteJournalAt(selected), offer = kept || canKeepInJournal(selected, links, docs);
  let button = menu.querySelector('[data-basket-journal]');
  if (!offer) { if (button?.contains(document.activeElement)) detail.querySelector('[data-basket-note-more]')?.focus({preventScroll:true}); button?.remove(); return; }
  if (!button) { button = document.createElement('button'); button.type = 'button'; menu.querySelector('[data-basket-delete]').before(button); button.disabled = busy; }
  button.textContent = kept ? '업무일지에서 빼기' : '업무일지에 남기기';
  button.dataset.basketJournal = kept ? 'off' : 'on';
}
// One guarded metadata write (update-journal.js); the text is not copied. Kept → it leaves 미분류 and shows on the work journal
// under 기타 메모; removed → back to 미분류. Then 5 seconds to undo (the shared notice of basket-record-delete.js).
async function keepInJournal(noteId, on, {undo = false} = {}) {
  if (busy) return {status:'busy', message:'지금은 바꿀 수 없어요. 잠시 뒤 다시 눌러 주세요.'};
  const owner = scope(), inDetail = selected?.id === noteId;
  const say = message => { const box = selected?.id === noteId ? detail.querySelector('[data-basket-status]') : listStatus; if (box) box.textContent = message || ''; };
  busy = true; if (inDetail) setDetailBusy(true);
  let saved = null, failure = '';
  try { saved = await setNoteJournal(noteId, on, rt); }
  catch (error) { failure = error?.code === 'note_changed' ? error.message : on ? '업무일지에 남기지 못했어요. 다시 시도해 주세요.' : '업무일지에서 빼지 못했어요. 다시 시도해 주세요.'; }
  finally { busy = false; if (inDetail && selected?.id === noteId) setDetailBusy(false); }
  if (owner !== scope()) return {status:'stale'};
  if (!saved) { if (!undo) say(failure); return {status:'failed', message:failure}; }
  noteMetadataSaved(saved);
  const message = on ? '업무일지에 남겼어요. 기타 메모에서 보여요.' : '업무일지에서 뺐어요. 다시 미분류로 보여요.';
  if (undo) return {status:'restored', message:on ? '업무일지에 다시 남겼어요.' : '업무일지에서 다시 뺐어요.'};
  say('');
  offerUndoNotice({text:message, onUndo:async () => owner !== scope() ? {status:'stale'} : keepInJournal(noteId, !on, {undo:true})});
  if (inDetail && selected?.id === noteId) detail.querySelector('[data-basket-note-more]')?.focus({preventScroll:true});
  else if (!selected) (root.querySelector(`[data-basket-row-more="${CSS.escape(noteId)}"]`) || root.querySelector(`[data-basket-filter="${filter}"]`))?.focus({preventScroll:true});
  return {status:'done', message};
}
function paintAttachments() {
  const openIds=new Set(Array.from(detail.querySelectorAll('[data-basket-ocr] details[open]'),node=>node.parentElement.dataset.basketOcr));
  const box=detail.querySelector('[data-basket-attachments]');
  box.innerHTML=(selected?.attachments||[]).map(fileRow).join('');
  detail.querySelectorAll('[data-basket-ocr] details').forEach(node=>{node.open=openIds.has(node.parentElement.dataset.basketOcr);});
  // Photos: a small preview through the owner-only basket-files photo view (the diary's path; never a public address).
  for(const thumb of detail.querySelectorAll('[data-basket-photo]')){
    const file=selected.attachments.find(f=>f.drive_file_id===thumb.dataset.basketPhoto);
    if(file)thumb.append(photoElement(selected,file,'small',{label:'',link:false,rt,retry:false}));
  }
  paintOcrControls();paintHtmlViews();
}
// MD-표시보완: each .html attachment (pasted ChatGPT HTML) shows in a sandboxed frame under the read text.
// The shared painter (html-frame.js) also serves the note read view.
function paintHtmlViews() {
  if(!selected)return;
  const noteId=selected.id,owner=scope();
  paintHtmlAttachments(detail.querySelector('[data-basket-html-views]'),{noteId,attachments:selected.attachments,rt,isCurrent:()=>owner===scope()&&selected?.id===noteId});
}
// UI-바구니상세개편: one row per attachment inside the update card. A photo shows a small preview (press it for the large
// view); any other file shows its kind. Under the name and size, small text links with icons: [Drive에서 열기],
// [자료실로 보내기] (or [자료실에서 보기] once it is there) and, for HWP, [편집]. The send result reads as one line under it.
const PHOTO_TYPES=/^image\/(jpeg|png|webp|gif)$/i;
const isPhoto=file=>PHOTO_TYPES.test(String(file?.mime_type||''));
function fileRow(file){
  const id=String(file?.drive_file_id||''),name=attachmentName(file),url=driveFileUrl(id),sent=librarySent(id),doc=sent?.document?.id;
  const inLibrary=['created','exists'].includes(sent?.kind),meta=[fileSize(file.size_bytes),inLibrary?'자료실에 있음 ✓':sent?.kind==='unknown'?'자료실에서 확인해 주세요':''].filter(Boolean).join(' · ');
  const link=(icon,label)=>`${LINK_ICONS[icon]}<span>${label}</span>`;
  const open=url?`<a class="basket-file-link" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${esc(name)} Drive에서 열기">${link('drive','Drive에서 열기')}</a>`:'<span class="basket-file-link-off">링크를 확인할 수 없습니다.</span>';
  const save=driveDownloadUrl(id)?`<button type="button" class="basket-file-link" data-basket-file-download="${esc(id)}" aria-label="${esc(name)} 내려받기">${link('download','내려받기')}</button>`:'';
  const sending=sent?.kind==='sending';
  const library=!id?'':inLibrary?(doc?`<a class="basket-file-link" href="${esc(libraryHref)}" data-basket-library-open="${esc(doc)}" aria-label="${esc(name)} 자료실에서 보기">${link('library','자료실에서 보기')}</a>`:'')
    :sent?.kind==='unknown'?'':`<button type="button" class="basket-file-link" data-basket-library-send="${esc(id)}" aria-label="${esc(name)} ${sending?'보내는 중…':'자료실로 보내기'}"${sending?' disabled':''}>${link('library',sending?'보내는 중…':'자료실로 보내기')}</button>`;
  const hwp=id&&isHwpName(name)?`<button type="button" class="basket-file-link" data-basket-hwp-edit="${esc(id)}" aria-label="${esc(name)} 편집">${link('edit','편집')}</button>`:'';
  const kind=fileKind(name);
  const thumb=isPhoto(file)&&id?`<button type="button" class="basket-file-thumb" data-basket-photo="${esc(id)}" aria-label="${esc(name)} 크게 보기"></button>`
    :`<span class="basket-file-thumb basket-file-kind file-kind" data-kind="${esc(kind.key)}" aria-hidden="true">${esc(kind.label)}</span>`;
  // A sent or already-there result is a short notice (sendToLibrary); a refusal or an unknown result stays as one line here.
  const message=sent?.message&&!inLibrary?`<p class="basket-library-result" role="status" data-basket-library-status="${esc(id)}">${esc(sent.message)}</p>`:'';
  return `<div class="basket-file" data-basket-file-card="${esc(id)}">${thumb}<div class="basket-file-body"><b class="basket-file-name" role="button" tabindex="0" data-basket-file-press="${esc(id)}">${esc(name)}</b><small class="basket-file-meta">${esc(meta)}</small><div class="basket-file-links" data-basket-library="${esc(id)}"${editing?' hidden':''}>${open}${save}${library}${hwp}</div></div>${ocrMarkup(file)}${message}</div>`;
}
// The large photo: shared view (photo-view.js) with ×, Esc and phone Back (one router layer), as the diary does.
function openPhoto(fileId,trigger){
  const file=selected?.attachments?.find(f=>f.drive_file_id===fileId);if(!file)return;
  openPhotoView({row:selected,file,trigger,rt});
}
const closePhoto=closePhotoView;
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
  // LIB-AI자동분류 ⑤: 바구니에서 보낸 자료도 빈 칸을 AI가 채운다(기다리지 않음, 표시 없음, 실패해도 보내기 결과 그대로).
  if(outcome.kind==='created')void fillLibraryDocument(outcome.document.id,{rt}).catch(()=>{});
  if(['created','exists'].includes(outcome.kind)&&!libraryDocs.has(`${owner}:${fileId}`))libraryDocs.set(`${owner}:${fileId}`,{id:outcome.document.id,title:outcome.document.title,project_id:undefined});
  if(['created','exists'].includes(outcome.kind)&&run===epoch&&selected?.id===noteId)showToast(outcome.message);
  if(run===epoch&&selected?.id===noteId)paintAttachments();
}
function paintNoteTasks() {
  const box = detail.querySelector('[data-basket-note-tasks]'); if (!box || !selected) return;
  const tasks = noteTasks(selected);
  box.hidden = !tasks.length;
  box.innerHTML = tasks.length ? `<h3 id="basketNoteTasksTitle">이 업데이트로 만든 할 일 ${tasks.length}</h3><ul>${tasks.map(t => `<li><span class="basket-note-task-title">${esc(t.title)}</span><button type="button" data-basket-note-task="${esc(t.task_id)}" aria-label="${esc(t.title)} 할 일 화면에서 보기">할 일 화면에서 보기</button></li>`).join('')}</ul>` : '';
  if (busy) box.querySelectorAll('button').forEach(el => el.disabled = true);
}
// MD-표시: the read text shows the original as formatted markdown; [원문 그대로 보기] shows it exactly as stored.
// The stored text never changes here, and the choice is not remembered (each opened note starts formatted).
// Task checkboxes inside the formatted text stay disabled, so the busy toggles below skip input.md-task.
const readShown = new WeakMap();
function paintReadText() {
  const text = detail.querySelector('[data-basket-read-text]'), toggle = detail.querySelector('[data-basket-read-raw]'), raw = selected.raw_text || '';
  // The toggle is a small icon near the text: pressed = the stored text exactly; not pressed (default) = formatted.
  toggle.hidden = !raw; toggle.setAttribute('aria-pressed', String(rawView)); toggle.setAttribute('aria-label', rawView ? '정리해서 보기' : '원문 그대로 보기'); toggle.title = toggle.getAttribute('aria-label');
  detail.querySelector('[data-basket-copy]').hidden = !raw.trim();
  text.classList.toggle('basket-read-empty', !raw); text.classList.toggle('basket-read-raw', !!raw && rawView);
  // ①: a memo with only attachments has no text box; its files lead the screen.
  text.hidden = filesOnly(selected);
  const asDoc = !!raw && !rawView && hasDoc(selected);
  const key = `${raw && rawView ? 'raw' : asDoc ? 'doc:' + selected.updated_at : 'md'}:${raw}`;
  if (readShown.get(text) === key) return;
  readShown.set(text, key);
  renderShareCards(detail.querySelector('[data-basket-share]'), raw);
  if (!raw) return showPlainText(text, filesOnly(selected) ? '' : '글 없이 첨부만 있는 업데이트입니다.');
  showPlainText(text, raw);
  if (rawView) return;
  // ED③ 업데이트: the saved form is drawn instead of the letters (the 원문 toggle still shows the letters).
  if (asDoc && paintDoc(text, selected, {rt})) return;
  const owner = scope();
  void renderMarkdownInto(text, raw, {isCurrent: () => owner === scope()}).then(result => { if (!result.ok && readShown.get(text) === key) readShown.delete(text); });
}
function paintMode() {
  if (!selected) return;
  paintReadText();
  // The link panel and the task form bring their own buttons; the read actions return when they close.
  detail.querySelector('[data-basket-read]').hidden = editing; detail.querySelector('[data-basket-read-actions]').hidden = editing || manual.isOpen();
  // The note menu is for reading; while editing the edit buttons and Esc take over.
  detail.querySelector('[data-basket-note-more-wrap]').hidden = editing; if (editing) setNoteMenu(false);
  detail.querySelector('.basket-editor').hidden = !editing; detail.querySelector('[data-basket-edit-actions]').hidden = !editing;
  detail.querySelector('[data-basket-text]').readOnly = hasDoc(selected);
  detail.querySelectorAll('.basket-file-links').forEach(box => { box.hidden = editing; });
  detail.querySelector('.basket-card-tools').hidden = !String(selected.raw_text || '').trim();
  // ⑥: "미분류 · 날짜" sits under the files of an update with only attachments, else under the text.
  const meta = detail.querySelector('.basket-note-meta');
  if (filesOnly(selected) && !editing) detail.querySelector('[data-basket-attachments]').after(meta); else detail.querySelector('[data-basket-read]').append(meta);
}
function openDetail(id, {edit = false} = {}) {
 closeRowMenu();
  if (!selected) listScroll = window.scrollY;
  selected = notes.find(n => n.id === id); if (!selected) return;
  // Keep the opened note attached to this list snapshot until an explicit reload.
  ++epoch;ocrViewScope=captureOcrScope();editing=edit;rawView=false;
  for(const file of selected.attachments||[]){const view=ocrViews.get(ocrKey(file.drive_file_id));if(view){delete view.checkedAttempt;delete view.stamp;}}
  upload=createUploadBatch(selected.id,selected.attachments||[]);list.hidden = true; detail.hidden = false;
  paintListChrome();
  // UI-업데이트편집한줄: the edit screen's buttons are one row like the note's — [📎 첨부] [큰 창에서 수정] [수정 저장] [취소].
  // [첨부 저장] (the existing separate attachment save) sits by the chosen files and shows only while files are chosen.
  // UI-바구니상세개편: the whole update is one card — text (with [복사] and the 원문 toggle beside it), state·time,
  // attachments (photo previews, file kinds, small links, 사진 속 글자), then [연결하기]·[할 일 만들기]·[노트로 옮기기] in one row.
  // The ⋯ keeps 수정·보관·삭제 (BASKET-일지로남기기: and [업무일지에 남기기]/[업무일지에서 빼기] before 삭제, so the row stays three buttons).
  // UI-엔터저장: the edit box saves with Ctrl+Enter on PC (shared rule, enter-save.js); [연결하기]·[할 일 만들기] forms are their own roots.
  detail.dataset.enterSave = '[data-basket-save]';
  detail.innerHTML = `<div class="basket-detail-head"><button type="button" class="basket-back" data-basket-close aria-label="정리함 목록으로"><span aria-hidden="true">‹</span> 정리함</button><div class="basket-note-more" data-basket-note-more-wrap><button type="button" class="basket-more-trigger" data-basket-note-more data-ctx="area" aria-label="이 업데이트 메뉴" aria-expanded="false" aria-controls="basketNoteMenu"><span class="more-dots" aria-hidden="true">⋯</span></button><div id="basketNoteMenu" class="basket-more-menu" role="group" aria-label="이 업데이트" hidden><button type="button" data-basket-edit>수정</button><button type="button" data-basket-archive>보류로</button><button type="button" class="basket-menu-danger" data-basket-delete>삭제</button></div></div></div><article class="basket-card" data-basket-card aria-label="업데이트"><div class="basket-read" data-basket-read><div class="basket-card-tools"><button type="button" class="basket-icon-button" data-basket-read-raw aria-pressed="false" aria-label="원문 그대로 보기" title="원문 그대로 보기">${RAW_ICON}</button><button type="button" class="basket-icon-button" data-basket-copy aria-label="복사" title="복사">${COPY_ICON}</button></div><div class="md-share-cards" data-basket-share hidden></div><div class="basket-read-text" data-basket-read-text tabindex="-1" role="region" aria-label="업데이트 원문"></div><div class="basket-html-views" data-basket-html-views></div><p class="basket-note-meta"><span class="basket-note-state" data-basket-state></span><time>${esc(time(selected))}</time></p></div><div class="basket-editor" hidden><label class="basket-text-label">업데이트 원문<textarea data-basket-text rows="12"></textarea></label><div class="basket-editor-files"><div data-basket-file-selection></div><button type="button" data-basket-upload>첨부 저장</button></div></div><div data-basket-attachments class="basket-files" tabindex="-1" role="region" aria-label="첨부 파일"></div><section class="basket-note-tasks" data-basket-note-tasks aria-labelledby="basketNoteTasksTitle" hidden></section><button type="button" data-basket-reload hidden>업데이트 다시 불러오기</button><div class="basket-actions basket-read-actions" data-basket-read-actions><button type="button" data-basket-link-open>연결하기</button><button type="button" data-basket-task-open>할 일 만들기</button><button type="button" data-basket-to-note>노트로 옮기기</button></div><div data-basket-manual hidden></div><div class="basket-actions basket-edit-actions save-row save-row-sticky" data-basket-edit-actions hidden><div class="save-row-start" data-basket-file-picker></div><button type="button" class="secondary save-row-start" data-basket-big-write>큰 창에서 수정</button><button type="button" class="secondary" data-basket-cancel>취소</button><button type="button" data-basket-save>수정 저장</button></div><p data-basket-status role="status"></p></article>`;
  // UI-PC프로젝트좌우: opened from a project's or organization's 🧺 record → "← (name)으로 돌아가기" under the head.
  detail.querySelector('.basket-detail-head')?.insertAdjacentHTML('afterend', basketReturnHtml(selected.id, rt));
  detail.querySelector('[data-basket-text]').value = selected.raw_text;
  manual.attach(detail.querySelector('[data-basket-manual]'));
  pickerFiles=mountBasketPicker(detail.querySelector('[data-basket-file-picker]'),{id:'detailBasketFiles',filesHost:detail.querySelector('[data-basket-file-selection]'),dropTarget:detail.querySelector('.basket-editor'),getBatch:()=>upload,isActive:()=>editing,isBusy:()=>busy,onError:message=>detail.querySelector('[data-basket-status]').textContent=message});
  paintDetailState();paintMode();void loadLibraryDocs();
  // A note address (?note=) opens the note once; the list entry under it stays the plain list.
  // Opened from a project's or organization's record, the note has no entry of its own: one back returns to that project.
  if (!noteLayer) { clearNoteAddress(); if (!basketNoteOrigin(selected.id, rt)) openNoteLayer(); }
  // NAV-새로고침제자리: the open update is written on its own entry (?note=), so a reload reopens it; closing drops it (clearNoteAddress).
  if (noteLayer) window.KPTURouter.setPlace?.('basket', {note:selected.id});
  // Reading never opens the on-screen keyboard; only an explicit edit focuses the text.
  (editing ? detail.querySelector('[data-basket-text]') : readFocus()).focus();
  openDocEdit();
}
// ED③ 업데이트: [큰 창에서 수정] opens the update in the new editor (update-window.js). It starts from the saved form (doc), else from the
// edit field's letters converted in memory (nothing is written by opening). The window's save icon is this view's own save (saveEdit):
// the letters and the saved form go in one PATCH that applies only while the update is still the version read now (saveUpdateDoc), so an
// update changed in another tab or device is refused. It saves and closes, and stays with a message on failure.
async function openBigWriter() {
  const field = detail.querySelector('[data-basket-text]'), id = selected?.id;
  if (!selected || !editing || busy || !field || bigOpening) return;
  const same = () => editing && selected?.id === id && field.isConnected;
  const status = detail.querySelector('[data-basket-status]');
  bigOpening = true;
  try {
    const [{openUpdateEditWindow}, fresh] = await Promise.all([import('./update-window.js'), readBasketNote(id, rt)]);
    if (!same()) return;
    const letters = value => String(value ?? '').replace(/\r\n?/g, '\n');
    if (!fresh) { status.textContent = '업데이트를 찾지 못했어요. 목록을 다시 불러와 주세요.'; return; }
    if (letters(fresh.raw_text) !== letters(selected.raw_text) || JSON.stringify(fresh.doc || null) !== JSON.stringify(selected.doc || null)) {
      status.textContent = '다른 곳에서 바뀐 업데이트예요. 다시 불러온 뒤 고쳐 주세요.'; detail.querySelector('[data-basket-reload]').hidden = false; return;
    }
    const version = fresh.updated_at, withDoc = hasDoc(selected);
    bigWriter = openUpdateEditWindow({
      doc: withDoc ? selected.doc : null, text: field.value,
      save: ({value, text}) => same() ? saveEdit({doc: value, text, version}) : Promise.resolve({ok: false, message: '수정 화면이 바뀌어 저장하지 못했어요.'}),
      // UI-크게첨부: [📎 첨부] under the text is the same picker part on this screen's own file batch (upload), so a file chosen
      // in the window is the same selection as on the edit screen and is saved by the existing attachment path.
      attach: {getBatch: () => upload, isBusy: () => busy},
      onClose: ({text, saved}) => { bigWriter = null; if (!same()) return; if (!saved && !withDoc) field.value = text; pickerFiles?.render(); field.focus(); },
    });
  } catch { if (same()) status.textContent = '큰 창을 열지 못했어요. 다시 눌러 주세요.'; }
  finally { bigOpening = false; }
}
function startEdit() {
  if (!selected || editing) return;
  editing = true; detail.querySelector('[data-basket-text]').value = selected.raw_text; detail.querySelector('[data-basket-status]').textContent = '';
  paintMode(); pickerFiles?.render(); detail.querySelector('[data-basket-text]').focus();
  openDocEdit();
}
// ED③ 업데이트: an update with a saved form is edited in the new editor only (the letters box would drop its formats): the big window opens
// at once, and the box under it is read-only (paintMode).
function openDocEdit() {
  if (!selected || !editing || !hasDoc(selected)) return;
  detail.querySelector('[data-basket-status]').textContent = '서식이 있는 글이에요. 큰 창에서 고쳐 주세요.';
  void openBigWriter();
}
function finishEdit({force = false} = {}) {
  if (!selected || !editing) return;
  if (!force && dirty() && !window.confirm('수정 중인 글과 첨부 선택을 버리고 읽기 화면으로 돌아갈까요?')) return;
  editing = false; detail.querySelector('[data-basket-text]').value = selected.raw_text;
  // Cancelling discards the selection the same way leaving the note does.
  if (upload.blocked || upload.entries.some(e => e.kind !== 'success')) upload = createUploadBatch(selected.id, selected.attachments || []);
  if (!force) detail.querySelector('[data-basket-status]').textContent = '';
  paintMode(); pickerFiles?.render(); readFocus().focus();
}
async function refresh() {
  if (busy) return;
  const run = ++epoch, owner = scope();
  loadingRun = run;
  listStatus.innerHTML = waitInlineHtml(); root.querySelector('[data-basket-retry]').hidden = true;
  // UI-바구니첨부메모 PR 3: 자료실 분류 칩은 내 분류 목록을 따른다(목록이 오면 'kptu:document-categories-changed'로 다시 그린다).
  void loadDocumentCategories();
  try {
    const result = await readBasket(undefined, {doc:true});
    if (run !== epoch || owner !== scope()) return;
    loadingRun = 0;
    notes = result.notes; links = result.links; docs = result.docs; renderList();
    if (requestedNote) {
      const id = requestedNote; requestedNote = null;
      if (notes.some(note => note.id === id)) openDetail(id);
      else listStatus.textContent = '업데이트를 찾을 수 없습니다. 접근 권한과 업데이트를 확인해 주세요.';
    }
  } catch (e) {
    if (run !== epoch || owner !== scope()) return;
    loadingRun = 0;
    notes = []; links = []; docs = []; root.querySelector('[data-basket-rows]').replaceChildren();
    listStatus.textContent = '업데이트를 불러오지 못했어요. 다시 시도해 주세요.';
    root.querySelector('[data-basket-retry]').hidden = false;
  } finally {
    if (loadingRun === run) loadingRun = 0;
  }
}
// Resolves true when the change was saved, false when it was not (busy, no note, or the save failed).
let patchFail = '';
async function patch(changes, message, {read = false, keep = false} = {}) {
  if (busy || !selected) return false;
  const id = selected.id, run = ++epoch, owner = scope(); busy = true; patchFail = '';
  detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el => el.disabled = true);
  detail.querySelector('[data-basket-status]').textContent = '저장 중…';
  try {
    // ED③ 업데이트: with a saved form the letters and the form go together, only while the update is still the version the editor opened.
    const note = changes.doc ? await saveUpdateDoc(id, {raw_text:changes.raw_text, doc:changes.doc, version:changes.version}) : await updateNote(id, changes);
    if (run !== epoch || owner !== scope()) return false;
    notes = notes.map(n => n.id === id ? note : n); selected = note;upload.attachments=note.attachments||[];
    // UI-바구니상세개편: a plain result is a short notice that goes away; guidance (what to press next) stays on the screen.
    renderList(); paintDetailState(); detail.querySelector('[data-basket-status]').textContent = keep ? message : ''; if (!keep) showToast(message);
    if (!editing) detail.querySelector('[data-basket-text]').value = note.raw_text;
    if (read) finishEdit({force:true}); else paintMode();
    return true;
  } catch (e) {
    if (run !== epoch || owner !== scope()) return false;
    patchFail = e?.code === 'note_changed' ? e.message : '저장하지 못했어요. 다시 시도해 주세요.';
    paintDetailState(); detail.querySelector('[data-basket-status]').textContent = patchFail;
    return false;
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
  try { result = await deleteNoteOriginal(id, {rt, isCurrent:current, trash:true}); }
  catch { result = {status:'unknown', message:'결과를 확인하지 못했어요. 업데이트 다시 불러오기로 실제 상태를 확인해 주세요.'}; }
  finally { busy = false; }
  if (!current() || result.status === 'stale') return;
  if (['deleted', 'missing'].includes(result.status)) {
    notes = notes.filter(n => n.id !== id); links = links.filter(l => l.note_id !== id);
    closeDetail({force:true}); renderList(); if (result.message) listStatus.textContent = result.message;
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
  try{await uploadBatch(batch,{isCurrent,onChange:paint,ocr:operation,onOcrChange:value=>{if(token.current()&&guardOcrPrivacy())applyOcrOutcome(value);}});if(isCurrent()){upload=batch=createUploadBatch(id,batch.attachments);status.textContent='';showToast('첨부를 저장했습니다.');}}
  catch(e){if(isCurrent()){status.textContent='업데이트를 다시 불러오지 못했어요. 다시 시도해 주세요.';detail.querySelector('[data-basket-reload]').hidden=!batch.blocked;}}
  finally{if(ocrFlight===token){ocrFlight=null;busy=false;}else if(!ocr.enabled)busy=false;if(isCurrent()&&!busy){detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=false);pickerFiles.render();paintOcrControls();}}
}
async function reloadDetail() {
  if(busy||!selected)return;
  if(dirty()&&!window.confirm('저장된 업데이트를 다시 불러올까요? 수정 중인 글과 미완료 파일 선택은 비워집니다.'))return;
  const id=selected.id,owner=scope(),run=++epoch;busy=true;
  detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=true);
  try{const result=await readBasket(undefined, {doc:true});if(run!==epoch||owner!==scope())return;notes=result.notes;links=result.links;docs=result.docs;renderList();if(notes.some(n=>n.id===id))openDetail(id,{edit:editing});else closeDetail({force:true});}
  catch(e){if(run===epoch&&owner===scope())detail.querySelector('[data-basket-status]').textContent='업데이트를 다시 불러오지 못했어요. 다시 시도해 주세요.';}
  finally{busy=false;detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=false);pickerFiles?.render();paintOcrControls();}
}
// FILE-누르면동작: 파일 이름을 누르면 종류별 동작(file-actions.js), [내려받기]는 종류와 상관없이 내려받기.
function basketFile(fileId){
  const f=selected?.attachments?.find(x=>x.drive_file_id===fileId);
  return f?{name:attachmentName(f),mime:f.mime_type,driveId:fileId,noteId:selected.id}:null;
}
const fileFail=text=>showToast(text);
function pressBasketFile(el){
  const file=basketFile(el.dataset.basketFilePress);if(!file)return;
  void pressFile(file,{viewPhoto:()=>openPhoto(file.driveId,el),onError:fileFail});
}
root.addEventListener('keydown', e => {
  const el=e.target.closest?.('[data-basket-file-press]');
  if(el&&!noteHost.contains(el)&&(e.key==='Enter'||e.key===' ')){e.preventDefault();pressBasketFile(el);}
});
root.addEventListener('click', e => {
  // The note side handles its own buttons (basket-notes.js).
  if(noteHost.contains(e.target))return;
  const press=e.target.closest('[data-basket-file-press]');
  if(press){pressBasketFile(press);return;}
  const save=e.target.closest('[data-basket-file-download]');
  if(save){const file=basketFile(save.dataset.basketFileDownload);if(file)void downloadFile(file,{onError:fileFail});return;}
  if(!guardOcrPrivacy())return;
  const b = e.target.closest('button'); if (!b||b.disabled) return;
  if (b.hasAttribute('data-basket-note-more')) { setNoteMenu(noteMenu()?.hidden ?? false); return; }
  if (b.hasAttribute('data-basket-row-more')) { openRowMenu(b); return; }
  if (rowMenuEl.contains(b)) { const from = closeRowMenu({focus:true}); if (from) rowMenuAction(b.dataset.basketRowAct, from.noteId); return; }
  const fromNoteMenu = !!noteMenu()?.contains(b); if (fromNoteMenu) setNoteMenu(false, {focus:true});
  if (b.hasAttribute('data-basket-read-raw')) { rawView = !rawView; paintReadText(); return; }
  if (b.hasAttribute('data-basket-row-copy')) { void copyNote(notes.find(n => n.id === b.dataset.basketRowCopy), b); return; }
  if (b.hasAttribute('data-basket-copy')) { void copyNote(selected, b); return; }
  if (b.hasAttribute('data-basket-photo')) { openPhoto(b.dataset.basketPhoto, b); return; }
  if (busy) return;
  if (b.hasAttribute('data-basket-unlink')) void unlinkChip(b.dataset.basketUnlink);
  else if (b.hasAttribute('data-basket-chip-open')) void openChipPlace(b.dataset.basketChipOpen);
  else if(b.hasAttribute('data-basket-library-send'))void sendToLibrary(b.dataset.basketLibrarySend);
  else if(b.hasAttribute('data-basket-hwp-edit'))openHwpEditor(b.dataset.basketHwpEdit);
  else if(b.hasAttribute('data-basket-ocr-read'))void runOcr('read',b.dataset.basketOcrRead);
  else if(b.hasAttribute('data-basket-ocr-status'))void runOcr('status',b.dataset.basketOcrStatus);
  else if(b.hasAttribute('data-basket-ocr-reconcile'))void runOcr('reconcile',b.dataset.basketOcrReconcile);
  else if(b.hasAttribute('data-basket-ocr-cleanup'))void runOcr('cleanup',b.dataset.basketOcrCleanup);
  else if (b.hasAttribute('data-basket-row')) openDetail(b.dataset.basketRow);
  else if (b.hasAttribute('data-basket-filter')) {filter = b.dataset.basketFilter; place = 'all'; sub = 'all'; renderList(); }
  else if (b.hasAttribute('data-basket-close')) closeDetail();
  else if (b.hasAttribute('data-basket-edit')) startEdit();
  else if (b.hasAttribute('data-basket-to-note')) void saveToNote();
  else if (b.hasAttribute('data-basket-journal')) void keepInJournal(selected?.id, b.dataset.basketJournal === 'on');
  else if (b.hasAttribute('data-inbox-find')) void findAgain();
  else if (b.hasAttribute('data-basket-big-write')) openBigWriter();
  else if (b.hasAttribute('data-basket-link-open')||b.hasAttribute('data-basket-task-open')) { const message = manual.open(b.hasAttribute('data-basket-link-open') ? 'link' : 'task'); detail.querySelector('[data-basket-status]').textContent = message || ''; }
  else if (b.hasAttribute('data-basket-cancel')) finishEdit();
  else if (b.hasAttribute('data-basket-retry')) void refresh();
  else if (b.hasAttribute('data-basket-note-task')) { requestTaskOpen(b.dataset.basketNoteTask, rt); window.KPTURouter.go('tasks', {source:'delegated'}); }
  else if (b.hasAttribute('data-basket-save')) void saveEdit();
  else if (b.hasAttribute('data-basket-upload')) void saveAttachments();
  else if (b.hasAttribute('data-basket-reload')) void reloadDetail();
  else if (b.hasAttribute('data-basket-delete')) void deleteSelected();
  else if (b.hasAttribute('data-basket-archive')) void patch({archived_at:selected.archived_at ? null : new Date().toISOString()}, selected.archived_at ? '보류를 해제했어요.' : '보류로 보냈어요.');
});
// [수정 저장] (and the big window's save icon): one path. Resolves {ok:true} or {ok:false, message}.
// extra: {doc, text, version} from the big window (the saved form and its letters); without it, the letters box is saved as before.
async function saveEdit(extra = null) {
  if (!selected || !editing || busy) return {ok:false, message:'지금은 저장할 수 없어요.'};
  // textarea normalizes CR/CRLF on display; do not rewrite an unchanged original.
  // Selected files stay in the editor until they are saved or cancelled.
  const pendingFiles = upload.entries.some(e => e.kind !== 'success');
  if (extra?.doc) {
    const done = await patch({raw_text:extra.text, doc:extra.doc, version:extra.version}, pendingFiles ? '수정한 글을 저장했습니다. 선택한 첨부는 ‘첨부 저장’을 눌러 주세요.' : '수정한 글을 저장했습니다.', {read:!pendingFiles, keep:pendingFiles});
    return done ? {ok:true} : {ok:false, message:patchFail || '저장하지 못했어요. 다시 눌러 주세요.'};
  }
  if (!textDirty()) { if (pendingFiles) detail.querySelector('[data-basket-status]').textContent = '저장된 글입니다. 선택한 첨부는 ‘첨부 저장’을 눌러 주세요.'; else { showToast('저장된 글입니다.'); finishEdit({force:true}); } return {ok:true}; }
  const saved = await patch({raw_text:detail.querySelector('[data-basket-text]').value}, pendingFiles ? '수정한 글을 저장했습니다. 선택한 첨부는 ‘첨부 저장’을 눌러 주세요.' : '수정한 글을 저장했습니다.', {read:!pendingFiles, keep:pendingFiles});
  return saved ? {ok:true} : {ok:false, message:'저장하지 못했어요. 다시 눌러 주세요.'};
}
// BUG-바구니연결해제: × on a chip — one confirmation, one owner-RLS row delete (basket-record-delete.js),
// then 5 seconds to undo. The shared event re-reads this list and the open detail screens.
const unlinking = new Set();
async function unlinkChip(linkId) {
  const link = links.find(l => l.id === linkId); if (!link || unlinking.has(linkId)) return;
  const {name} = chipInfo(link), owner = scope(), noteId = link.note_id, inDetail = selected?.id === noteId;
  const say = message => { const box = inDetail && selected?.id === noteId ? detail.querySelector('[data-basket-status]') : listStatus; if (box) box.textContent = message || ''; };
  const button = () => root.querySelector(`[data-basket-unlink="${CSS.escape(linkId)}"]`);
  unlinking.add(linkId); if (button()) button().disabled = true;
  let result;
  try { result = await disconnectWithUndo(link, {name, rt, isCurrent: () => owner === scope()}); }
  catch { result = {status:'unknown', message:'결과를 확인하지 못했어요. 목록을 다시 불러와 실제 상태를 확인해 주세요.'}; }
  finally { unlinking.delete(linkId); }
  if (owner !== scope() || result.status === 'stale') return;
  if (['deleted', 'missing'].includes(result.status)) {
    // Focus stays on the same note: its next chip, else the row (list) or the text (note screen).
    links = links.filter(l => l.id !== linkId); renderList();
    if (selected?.id === noteId) paintStateLine();
    const scopeBox = selected?.id === noteId ? detail.querySelector('[data-basket-state]') : root.querySelector(`[data-basket-row-item="${CSS.escape(noteId)}"]`);
    (scopeBox?.querySelector('[data-basket-unlink]') || (selected?.id === noteId ? detail.querySelector('[data-basket-read-text]') : root.querySelector(`[data-basket-row="${CSS.escape(noteId)}"]`)))?.focus();
    if (result.status === 'missing') say(result.message);
    return;
  }
  if (button()) { button().disabled = false; button().focus(); }
  if (result.status !== 'cancelled') say(result.message);
}
// Note screen chip: open that organization or project over the basket, as home does.
async function openChipPlace(linkId) {
  const link = links.find(l => l.id === linkId); if (!link) return;
  if (link.bundle_id) {
    try { await window.KPTUViewLoader.load('reference'); await window.KPTUReference.open(link.bundle_id); }
    catch { if (selected?.id === link.note_id) detail.querySelector('[data-basket-status]').textContent = '참고 묶음을 열지 못했어요. 다시 시도해 주세요.'; }
    return;
  }
  const project = !!link.project_id;
  try {
    await window.KPTUViewLoader.load(project ? 'projects' : 'team');
    await (project ? window.KPTUProjects.open(link.project_id) : window.KPTUWorkplace.open(link.organization_id));
  } catch { if (selected?.id === link.note_id) detail.querySelector('[data-basket-status]').textContent = project ? '사업영역을 열지 못했어요. 다시 시도해 주세요.' : '담당조직을 열지 못했어요. 다시 시도해 주세요.'; }
}
// Another screen (or this one) changed links or documents: re-read them only, keeping any open note and its drafts.
let linkReadRun = 0;
async function rereadLinks() {
  if (window.KPTURouter.current !== 'basket') return;
  const run = ++linkReadRun, owner = scope();
  try {
    const result = await readBasket(undefined, {doc:true});
    if (run !== linkReadRun || owner !== scope()) return;
    // A repaint keeps focus on the same row or chip (or that note's row when its chip is gone).
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const attr = active && ['data-basket-row', 'data-basket-row-more', 'data-basket-unlink', 'data-basket-chip-open'].find(name => active.hasAttribute(name));
    const value = attr && active.getAttribute(attr), noteId = active?.closest('[data-basket-row-item]')?.dataset.basketRowItem;
    // renderList writes the note count; a result message already on that line (delete, disconnect) stays.
    const said = listStatus.textContent, counted = /^(\d+개 업데이트|업데이트 없음)?$/.test(said);
    links = result.links; docs = result.docs; renderList(); if (selected) { paintStateLine(); paintJournalButton(); }
    if (!counted) listStatus.textContent = said;
    if (attr && !active.isConnected) (root.querySelector(`[${attr}="${CSS.escape(value)}"]`) || (noteId && root.querySelector(`[data-basket-row="${CSS.escape(noteId)}"]`)) || (selected && detail.querySelector('[data-basket-read-text]')))?.focus({preventScroll:true});
  } catch {}
}
window.addEventListener('kptu:basket-links-changed', rereadLinks);
window.addEventListener('kptu:documents-changed', rereadLinks);
window.addEventListener('kptu:document-categories-changed', () => { if (root.isConnected) renderList(); });
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
root.addEventListener('keydown', e => { if (noteHost.contains(e.target)) return; guardOcrPrivacy(); if (e.key === 'Escape' && selected && !busy) { e.preventDefault(); if (noteMenu() && !noteMenu().hidden) setNoteMenu(false, {focus:true}); else if (manual.isOpen()) manual.cancel(); else closeDetail(); } });
window.addEventListener('kptu:before-reload', e => {
  if (busy||quick?.isBusy()||noteDocs.isBusy()) e.preventDefault();
  else if (quick?.hasDraft()||noteDocs.hasDraft()) e.detail.otherDraft=true;
  else if (dirty() || manualDraft()) e.detail.otherDraft = true;
});
window.addEventListener('kptu:session-changed', () => {
  guardOcrPrivacy();
  const next = scope(); if (next === currentScope) return;
  currentScope = next; retainedForTraversal=false; requestedNote = null; epoch++; notes = []; links = []; docs = []; closeDetail({focus:false,force:true,cleanAddress:false}); noteDocs.reset(); showKind('memo',{address:false}); renderList();
});
window.addEventListener('kptu:before-view-change',e=>{
  if(retainedForTraversal&&(busy||quick?.isBusy()||quick?.hasDraft()||dirty()||manualDraft()))e.detail.retainBasketDraft=true;
  if(window.KPTURouter.current!=='basket'||e.detail?.view==='basket')return;
  // Without a native entry position, honor the traversal and retain the draft
  // in this mounted view. Never guess its direction or rewrite the destination.
  if(e.detail?.source==='popstate'&&!e.detail.canRestoreHistory&&(busy||quick?.isBusy()||quick?.hasDraft()||dirty()||manualDraft())){
    e.detail.retainBasketDraft=true;return;
  }
  const blockedBusy=quick?.isBusy()||noteDocs.isBusy()||busy;
  if(blockedBusy||(noteDocs.hasDraft()&&!window.confirm('고치던 노트를 버리고 다른 화면으로 갈까요?'))||(quick?.hasDraft()&&!window.confirm('저장하지 않은 입력이 있어요. 다른 화면으로 갈까요? 입력은 이 탭에 남아요.'))||(dirty()&&!window.confirm('수정 중인 글을 버리고 다른 화면으로 갈까요?'))||(!dirty()&&manualDraft()&&!window.confirm('작성 중인 연결·할 일 입력을 버리고 다른 화면으로 갈까요?'))){
    e.preventDefault();
  }
});
window.addEventListener('kptu:view-changed',e=>{
  if(e.detail?.view==='basket'){retainedForTraversal=false;return;}
  ocrGeneration++;
  if(e.detail?.retainBasketDraft){retainedForTraversal=true;return;}
  retainedForTraversal=false;clearNoteAddress();closeDetail({focus:false,force:true});noteDocs.close({focus:false,force:true});showKind('memo',{address:false});
});
window.KPTURouter.on('basket', detail => {
  void preloadMarkdown();
  const wanted = takeBasketNoteRequest(rt), wantedDoc = takeNoteDocRequest(rt), wantedKind = takeBasketKindRequest(rt);
  // NAV-새로고침제자리: the place written in the address (an open note, the folder entered) — read before anything below closes it.
  const written = window.KPTURouter.place?.('basket') || {};
  if (busy || noteDocs.isBusy() || noteDocs.hasDraft()) { window.KPTURouter.setSub('basket', paneSub(), {replace:true}); return; }
  const noteSide = detail?.sub === 'note' || wantedKind === 'note' || !!wantedDoc;
  noteDocs.close({focus:false,force:true}); showKind('memo',{address:false}); void todo.refresh();
  filter = 'unclassified'; place = 'all'; sub = 'all'; renderList();
  // Keep the same editor and its unsaved text when returning from another view.
  if (dirty() || manualDraft()) { openNoteLayer({adoptOnly:true}); return; }
  closeDetail({focus:false}); if (wanted) requestedNote = wanted; renderList(); void refresh();
  // BASKET-정리함한화면: the old '챙길 것' address opens the one screen at that box (the address drops the old side).
  if (detail?.sub === 'todo' && !noteSide) { window.KPTURouter.setSub('basket', null, {replace:true}); requestAnimationFrame(showTodoBox); }
  if (noteSide) showKind('note', {openId:wantedDoc || written.doc || null, folder:wantedDoc ? null : written.folder || null});
});
// UI-디자인손질 8: a note saved from the menu [쓰기] shows up here without leaving the current screen.
// TRASH-다른삭제 5단계: 휴지통에서 되돌린 업데이트·노트가 이 화면 목록에 다시 나타나게 한다(지금 보고 있는 화면이고 작업 중이 아닐 때만. 아니면 다음에 열 때 다시 읽는다).
window.addEventListener('kptu:basket-notes-restored',()=>{if(window.KPTURouter.current==='basket'&&!selected&&!busy)void refresh();noteDocs.reload();});
window.addEventListener('kptu:basket-note-created',()=>{if(window.KPTURouter.current==='basket'&&!selected&&!busy)void refresh();});
renderList(); void refresh();
