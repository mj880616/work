import {waitInlineHtml} from './wait-state.js';
import {holdToast as kptuHoldToast,askConfirm} from './small-notice.js'; // UI-작은알림자리: #toast도 위쪽·2초·올려 두면 멈춤(시계 하나)
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
import { mountForgetList } from './forget-list.js';
import { plainText } from './notice-box.mjs';
import { radarFindState, radarFindAgain, radarClock, radarPromises, openSource as openTodoSource } from './todo-radar.js';
import { noteTasks, requestTaskOpen, takeBasketNoteRequest, takeNoteDocRequest, takeBasketKindRequest, basketNoteOrigin, basketBackHtml } from './basket-note-tasks.js';
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
import { renameHostAttrs, renameButtonHtml, applyRenamedNote } from './file-rename.js'; // ATT-이름고치기: 첨부 이름 그 자리에서 고치기(공용 부품)

import { createUploadBatch, uploadBatch, readNewPhotos, updateFileLine, mountBasketPicker, driveFileUrl, fileSize } from './basket-upload.js';
import { mountUploadRows, setUploadRetry, announceDock } from './upload-progress.js';
import { announceUploaded } from './upload-done.js';
import { placeAnchored, followAnchor, clearAnchored } from './anchored-popup.js';
import { bindRowSwipe } from './row-swipe.js';
import { SPLIT_QUERY } from './screen-width.mjs';
import { followPane } from './follow-pane.js';

const root = document.querySelector('#basketView'), rt = window.KPTURuntime;
// STAB-간헐3: the refresh run whose list read is still pending (0 = none). Until it answers, an empty list is "loading",
// not "no updates" (a segment click repaints the list meanwhile).
let loadingRun = 0;
let forget = null; // S52-20: the one list (forget-list.js), mounted below
let notes = [], links = [], docs = [], filter = 'unclassified', place = 'all', sub = 'all', selected = null, editing = false, busy = false, epoch = 0, rawView = false;
const scope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
let upload = createUploadBatch(), pickerFiles = null;
// UX-먼저묻고뒤에처리 3차 (2): 업데이트 첨부의 뒤 줄(아래 saveAttachments), 그 업데이트를 볼 때의 올리는 줄, 읽는 사이 첨부가 저장된 목록 읽기 표시.
// BIZ-저장먼저닫기 2차(S59-10): 줄은 basket-upload.js의 업데이트 줄 하나 — 새 업데이트 [저장]·[추가]의 사진·파일도 같은 줄에 선다
// (그 업데이트를 열면 올리는 줄이 보이고, 같은 잠금 attachGoing이 걸린다).
const attachQueue = updateFileLine;
let sentRows = null, staleRead = false;
let quick=null, bigWriter=null, bigPicker=null, bigOpening=false;
let currentScope = scope(), retainedForTraversal = false;
// BUG-뒤로가기: an opened memo is one router layer, so Back returns to the list at the same scroll.
let noteLayer = null, listScroll = 0, layerNoteId = ''; // layerNoteId: 그 겹이 지금 보이는 업데이트(폴드 펼침에서 줄을 바꾸면 따라 바뀐다)
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
const LINK_ICONS = {
  drive: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  library: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M2.5 5.5h11v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1zM1.5 2.5h13v3h-13zM6.5 8.5h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  download: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M2.5 13.5h11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M10.5 2.5l3 3-8 8h-3v-3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
};
const time = note => { const d = new Date(note.occurred_at); return Number.isNaN(d.getTime()) ? '' : formatSeoulTime(d, {year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}); };
root.innerHTML = `<div class="basket-head"><h2>잊지 말기</h2></div><div class="basket-switch-row forget-head"><button type="button" class="secondary forget-view" data-forget-view-open aria-haspopup="true" aria-expanded="false" aria-label="목록 보기 선택">처리 전 ▾</button><button type="button" class="row-act inbox-find" data-inbox-find>최신화</button></div><div class="basket-place-filter" data-basket-place-filter hidden></div><div class="basket-place-filter basket-sub-filter" data-basket-sub-filter hidden></div><button type="button" class="quick-text-link basket-ref-open" data-basket-ref-open data-goto="reference" hidden>참고 묶음 화면 ›</button><div data-basket-list><div class="home-quick-placeholder" aria-hidden="true"></div><p data-basket-list-status role="status"></p><button type="button" data-basket-retry hidden>다시 시도</button><section class="nbx fam-remind" data-nbx-tone="forget" data-fam-remind aria-label="가족 기억할 것" hidden></section><section class="nbx forget-list" data-nbx-tone="list" data-forget-section aria-label="잊지 말기 목록"><ul class="nbx-list" data-basket-rows id="basketRows"></ul><p class="nbx-status" role="status" aria-live="polite" data-forget-status></p></section><div id="basketRowMenu" class="basket-more-menu basket-row-pop-menu" role="group" aria-label="업데이트 메뉴" hidden></div></div><div data-basket-detail hidden></div><div class="note-host" data-note-host hidden></div>`;
// Keep the basket heading available to assistive navigation only: the phone header (~760px) and the PC top line (761px~,
// '정리함' / '노트', UI-화면정리 B ①·UI-폴드PC틀) already name the screen at every width.
const basketTitle=root.querySelector('.basket-head > h2');basketTitle.classList.add('a11y-only');
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
// 수정 · 연결하기 · 할 일로 · 노트로 · 업무일지에 남기기(또는 업무일지에서 빼기) · 삭제. It opens right under the pressed ⋯ (anchored-popup.js, PC and phone),
// one at a time, and closes on Esc (focus back to the ⋯), an outside press, leaving it by keyboard or choosing an item.
// Each item reuses the detail's own path (openDetail and its buttons); an item the detail would refuse is left out.
const rowMenuEl=root.querySelector('#basketRowMenu');
let rowMenu=null;
// UI-모바일노트복사메뉴: on a phone the row has no [복사] button; [복사] is the first item of this menu.
// UI-화면정리 C4(요청함 10/28 20:03, S48-46): PC도 같다 — 줄마다 늘 보이던 복사 아이콘을 없애고 [복사]는 ⋯·우클릭 메뉴 맨 위(노트 줄 17:45 ③과 같게).
// UI-잊지말기줄단추(11/10 명진 '추천대로'): 줄 버튼과 메뉴 이름을 하나로 — [할 일로]·[노트로](옛 '할 일 만들기'·'노트로 옮기기').
// 줄에 처리 버튼이 있는 줄(처리 전, acts)은 폰에서 접힌 [일정으로]·[조직]·[사업]도 줄 버튼과 같은 이름·같은 길(updateAct)로 여기 둔다. ×는 [보류로].
function rowMenuItems(note,acts=false){
  return [...(String(note.raw_text||'').trim()?[['copy','복사']]:[]),['edit','수정'],...(note.archived_at||note.ai_export_allowed!==true?[]:[['link','연결하기']]),['task','할 일로'],...(acts?[['event','일정으로']]:[]),['to-note','노트로'],...(acts?[['org','조직'],['area','사업']]:[]),['to-report','사업 보고로 옮기기'],...journalItem(note),note.archived_at?['unhold','보류 해제']:['hold','보류로'],['delete','삭제','basket-menu-danger']];
}
// BASKET-일지로남기기: [업무일지에 남기기] for an update that went to no organization and no project; [업무일지에서 빼기] once kept.
function journalItem(note){
  if(noteJournalAt(note))return [['unjournal','업무일지에서 빼기']];
  return canKeepInJournal(note,links,docs)?[['journal','업무일지에 남기기']]:[];
}
// UI-뒤로가기겹규칙: 줄 ⋯ 메뉴가 열려 있으면 라우터 겹 하나 — 뒤로가기 = 메뉴만 닫기(이전 탭으로 건너뛰지 않음).
// 목록을 다시 그리며 같은 메뉴를 다시 붙일 때(keepRowMenu)는 겹을 그대로 둔다.
let rowLayer=null;
function dropRowLayer(){const l=rowLayer;rowLayer=null;return Promise.resolve(l?.close())}
function closeRowMenu({focus=false,keepLayer=false}={}){
  if(!keepLayer&&!rowMenu)dropRowLayer();
  if(!rowMenu)return null;
  const closed=rowMenu;rowMenu=null;closed.stop();
  closed.released=keepLayer?Promise.resolve():dropRowLayer();
  rowMenuEl.hidden=true;clearAnchored(rowMenuEl);
  closed.trigger.setAttribute('aria-expanded','false');
  if(focus&&closed.trigger.isConnected)closed.trigger.focus({preventScroll:true});
  return closed;
}
function openRowMenu(trigger){
  const note=notes.find(n=>n.id===trigger.dataset.basketRowMore);
  if(rowMenu?.trigger===trigger){closeRowMenu({focus:true});return;}
  closeRowMenu();if(!note||busy||(selected&&!isSplit()))return;
  attachRowMenu(note,trigger);
  rowLayer||=window.KPTURouter?.layer?.open('basket-row-menu',{close:()=>{rowLayer=null;closeRowMenu();return true}})||null;
  rowMenuEl.querySelector('button')?.focus({preventScroll:true});
}
// S48-56: [일기로 보내기]는 [노트로 옮기기] 바로 아래(위 목록 줄은 다른 작업과 겹치지 않게 그대로 두고 여기서 끼운다).
const withDiaryItem=items=>items.flatMap(item=>item[0]==='to-note'?[item,['to-diary','일기로 보내기']]:[item]);
const rowMenuHtml=(note,acts)=>withDiaryItem(rowMenuItems(note,acts)).map(([act,label,cls])=>`<button type="button" data-basket-row-act="${act}"${cls?` class="${cls}"`:''}>${label}</button>`).join('');
// Shows the menu under this ⋯ and follows it. The items are rewritten only when they differ, so a press already on an item is not lost.
function attachRowMenu(note,trigger){
  const html=rowMenuHtml(note,!!trigger.closest('.nbx-acts'));
  if(rowMenuEl.innerHTML!==html)rowMenuEl.innerHTML=html;
  rowMenuEl.hidden=false;
  // UI-메뉴잘림: 높이를 320px로 묶으면 [보류로]·[삭제]가 표시 없는 안쪽 스크롤에 숨었다. 창 높이까지 다 보이고, 정말 길 때만 스크롤 + 아래 흐림.
  const place=()=>placeAnchored(rowMenuEl,trigger,{maxWidth:220,maxHeight:window.innerHeight});
  place();
  rowMenu={noteId:note.id,trigger,stop:followAnchor(rowMenuEl,trigger,{place,lost:()=>closeRowMenu()})};
  trigger.setAttribute('aria-expanded','true');
}
// STAB-E2E(10/30): a list redraw that arrives while a row's ⋯ menu is open (the screen's own re-read finishing late, links or
// categories arriving) used to close the menu, so the item the person was about to press vanished under the finger. The redraw
// now keeps the menu open on the same update's new ⋯ (same items unless they changed, focus kept on the same item); it closes
// only when that update is no longer in the list, or the list is not shown (a detail opened, work in progress).
function keepRowMenu(kept){
  if(!kept||busy||(selected&&!isSplit())||list.hidden)return;
  const note=notes.find(n=>n.id===kept.noteId),trigger=root.querySelector(`[data-basket-row-more="${CSS.escape(kept.noteId)}"]`);
  if(!note||!trigger)return;
  attachRowMenu(note,trigger);
  if(kept.focusAct)(rowMenuEl.querySelector(`[data-basket-row-act="${CSS.escape(kept.focusAct)}"]`)||rowMenuEl.querySelector('button'))?.focus({preventScroll:true});
}
// UI-목록밀기: 폰 업데이트 줄 — 왼쪽으로 밀기 [삭제](휴지통 + 위쪽 '지웠어요 [되돌리기]', 묻지 않음: 되돌릴 수 있으므로), 오른쪽으로 밀기 [보류로]/[보류 해제].
// 분류 완료는 갈 곳을 골라야 해서 한 번에 끝나는 처리가 아니므로, 목록에서 한 번에 끝나는 대표 처리인 보류를 둔다. 기존 목록 ⋯의 길 그대로.
bindRowSwipe(root.querySelector('[data-basket-rows]'),{row:'[data-basket-row-item]',enabled:()=>!busy&&(!selected||isSplit())&&!rowMenu,
  actions:el=>{const note=notes.find(n=>n.id===el.dataset.basketRowItem);if(!note)return null;return {start:note.archived_at?{key:'unhold',label:'보류 해제',tone:'warning'}:{key:'hold',label:'보류로',tone:'warning'},end:{key:'delete',label:'삭제',tone:'danger'}};},
  run:async(key,el)=>{const id=el.dataset.basketRowItem;if(busy||!notes.some(n=>n.id===id))return;if(selected&&!(await releaseDetail(el)))return;if(busy||selected||!notes.some(n=>n.id===id))return;if(key==='delete')void deleteFromList(id,{confirmed:true});else void holdFromList(id,key==='hold');}});
root.addEventListener('keydown',e=>{if(e.key==='Escape'&&rowMenu){e.preventDefault();e.stopPropagation();closeRowMenu({focus:true});}});
root.addEventListener('focusout',e=>{if(rowMenu&&e.relatedTarget&&!rowMenuEl.contains(e.relatedTarget)&&e.relatedTarget!==rowMenu.trigger)closeRowMenu();});
document.addEventListener('click',e=>{if(rowMenu&&!rowMenuEl.contains(e.target)&&!rowMenu.trigger.contains(e.target))closeRowMenu();});
const list = root.querySelector('[data-basket-list]'), detail = root.querySelector('[data-basket-detail]'), listStatus = root.querySelector('[data-basket-list-status]');
// FOLD-넓은화면 ④(S57-21, 요청함 11/06 01:18 ④ · 11/11 결정 '시안 없이 바로 개발'): 폴드 펼침(600~1199px, 홈 두 단과 같은 폭)의 잊지 말기는 '왼쪽 목록 | 오른쪽 상세'.
// 업데이트 줄을 누르면 목록은 그대로 두고 오른쪽 칸에 바로 열리고(고른 줄 표시), 다른 줄을 누르면 같은 칸에서 바뀐다(뒤로가기 한 걸음 그대로). ✕·Esc·뒤로 = 상세 닫기.
// 아무것도 고르지 않았으면 오른쪽 칸이 없다(목록이 화면 폭 전체 — 할 일 TASK-넓게쓰기와 같은 규칙). 접은 폰(600px 미만)·PC(1200px~)는 지금처럼 상세가 목록 자리를 대신한다.
// 상태 주인은 여기 하나다: #basketView.basket-split(상세가 열린 동안만)과 목록 hidden. 모양은 basket.css, 화면에 붙어 따라오는 칸은 공용 follow-pane.js(할 일 상세 칸과 같은 부품).
const SPLIT = window.matchMedia?.(`${SPLIT_QUERY} and (max-width:1199px)`), SPLIT_FRAME_PC = window.matchMedia?.('(min-width:761px)');
const splitWide = () => !!SPLIT?.matches;
const isSplit = () => root.classList.contains('basket-split');
const BASKET_CLOSE_X = '<button type="button" class="icon-btn basket-icon-button basket-close-x" data-basket-close aria-label="닫기">✕</button>';
// 폴드 펼침 폰 틀(600~760px): 아래에 입력칸·하단바가 떠 있으므로 그 높이만큼 칸 최대 높이를 줄인다(할 일과 같은 값).
function splitBottomDock(){const cs=getComputedStyle(document.documentElement),v=n=>parseFloat(cs.getPropertyValue(n))||0;return v('--kptu-mobile-tab-height')+v('--kptu-switch-dock')+v('--kptu-quick-dock')}
function followDetail(reset){followPane(detail,SPLIT_FRAME_PC?.matches?{reset}:{reset,narrow:true,bottom:splitBottomDock})}
function unfollowDetail(){detail.classList.remove('kptu-follow-pane','kptu-follow-narrow')}
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
  if(value.result_unknown)return '글자 읽기 결과를 확인하지 못했어요. 상태를 확인해 주세요. 다시 읽지는 않아요.';
  if(value.code==='OCR_SOURCE_CHANGED')return '원본 사진이 변경되어 이 결과를 반영할 수 없어요.';
  if(value.code==='NOTE_CHANGED')return '업데이트가 변경되었습니다. 저장된 업데이트를 확인해 주세요.';
  if(value.code==='OCR_ATTEMPT_UNRESOLVED')return '현재 시도의 상태를 먼저 확인해 주세요.';
  if(action==='cleanup'&&value.ok)return '임시 문서를 정리했습니다. 사진 속 글자 상태는 그대로 유지됩니다.';
  if(value.ocr_saved||value.ok&&['done','empty'].includes(value.recognitionState||value.attachment?.ocr?.state))return (value.cleanup_state||value.attachment?.ocr?.cleanup_state)==='delete_failed'?'글자는 저장했습니다. 임시 문서 정리는 다시 확인해 주세요.':'사진 속 글자를 확인했습니다.';
  if(value.ok)return '현재 시도의 상태를 확인했습니다.';
  return '글자를 읽지 못했어요. 저장된 사진은 그대로 유지됩니다.';
}
function ocrMarkup(file){
  if(!String(file.mime_type||'').startsWith('image/')&&!Object.hasOwn(file,'ocr'))return '';
  let text;try{text=effectiveOcrText(file);}catch{return '<div data-basket-ocr>사진 속 글자 상태를 확인할 수 없어요.</div>';}
  const saved=file.ocr,outcome=ocr.outcome?.(selected.id,file.drive_file_id)||(ocrViews.get(ocrKey(file.drive_file_id))?.outcome?.result_unknown?null:ocrViews.get(ocrKey(file.drive_file_id))?.outcome);
  return `<div data-basket-ocr="${esc(file.drive_file_id)}"><details><summary>사진 속 글자</summary><p>${esc(recognition[saved?.state||'unread'])}</p>${text?`<div class="basket-ocr-text">${esc(text)}</div>`:''}${cleanupLabel[saved?.cleanup_state]?`<p class="basket-ocr-cleanup">${esc(cleanupLabel[saved.cleanup_state])}</p>`:''}<p data-basket-ocr-notice role="status">${esc(outcome?ocrNotice(outcome):'')}</p><div class="basket-actions"><button type="button" data-basket-ocr-read="${esc(file.drive_file_id)}" disabled>글자 읽기</button><button type="button" data-basket-ocr-status="${esc(file.drive_file_id)}" disabled>상태 확인</button>${saved?.attempt_id?`<button type="button" data-basket-ocr-reconcile="${esc(file.drive_file_id)}" disabled>읽은 글 반영</button><button type="button" data-basket-ocr-cleanup="${esc(file.drive_file_id)}" disabled>임시 문서 정리</button>`:''}</div>${!['image/jpeg','image/png'].includes(file.mime_type)?'<p>이 파일 형식은 글자 읽기를 지원하지 않아요.</p>':!ocr.enabled?'<p>새 글자 읽기는 아직 사용할 수 없어요.</p>':''}</details></div>`;
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
async function runOcr(action,fileId,anchor=null){
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
    if(!capability.ok){status.textContent='지금은 사진 속 글자 읽기를 사용할 수 없어요.';return;}
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
        if(!(await askConfirm(anchor,{text:'저장된 업데이트가 변경되었습니다. 수정 중인 글은 유지하고 현재 저장된 업데이트에 이 시도의 글자를 반영할까요?',ok:'반영'}))||!token.current())return;
        options={confirmCurrentNoteVersion:view.stamp};
      }
    }
    const result=action==='read'?await operation.read(id,fileId):action==='reconcile'?await operation.reconcile(id,fileId,options):await operation.cleanup(id,fileId);
    if(!token.current())return;
    applyOcrSnapshot(operation.state.snapshot);
    applyOcrOutcome(result,action);status.textContent=ocrNotice(result,action);
  }catch{if(token.current())status.textContent='글자 읽기 결과를 확인하지 못했어요. 상태를 확인해 주세요.';}
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
// S52-20 HOME-잊지말기한목록(시안 docs/design/mockups/forget-one-list.html): one list, one row form — 텔레그램 요청·챙길 것·가족·업데이트 together
// (newest first, forget-list.js is the list's one renderer). The top row is [처리 전 ▾] (views and sources) and a small [다시 찾기]. This file
// still owns the updates (read, filters, detail, row ⋯ menu, swipe) and hands their rows to the list. [노트] is its own menu item that opens
// this same panel on the note side (kind = 'note', written to #basketView[data-kind] for the menu marks).
const noteHost=root.querySelector('[data-note-host]');
let kind='memo';
root.dataset.kind=kind;
const switchRow=root.querySelector('.basket-switch-row');
const findButton=root.querySelector('[data-inbox-find]');
// UI-일기손질 ⑥: the [메모 | 노트] row and the list head have one painter. They show only while a list is on screen;
// an open memo or note draws its own "‹ 바구니" head (a note: its title and ⋯, no back button) in that place instead.
// BASKET-드롭제목: a memo's title is its first line; a memo with only files is titled by its first file (a name cut by the old upload reader shows cleaned,
// and one with nothing left is just "파일"/"사진", attachment-name.mjs). The list row and the PC top line (UI-상단줄제목) use this one function.
const memoLines=note=>String(note.raw_text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
function memoTitle(note){
  const lines=memoLines(note),file=note.attachments?.[0];
  const fileTitle=file?[String(file.mime_type||'').startsWith('image/')?'사진':'파일',attachmentName(file,'')].filter(Boolean).join(' · '):'';
  return plainText(lines[0]||'')||fileTitle||'업데이트'; // S59-20: 첫 줄의 ** 같은 표시는 걷고 제목으로 쓴다(줄·위 줄·일정 창 제목 모두 이 함수 하나)
}
// UI-상단줄제목: the open update's title goes to the PC top line's place (kptu:where-item, topbar-actions.js); null drops it. Notes send their own (basket-notes.js).
// The place is keyed by screen, so the update's and the note's titles are told apart by the side that is open (only one detail is open at a time).
const sendMemoWhere=name=>window.dispatchEvent(new CustomEvent('kptu:where-item',{detail:{view:'basket',name,kind:'memo'}}));
function paintListChrome(){const open=(!!selected&&!isSplit())||noteDocs.isOpen(),notes=kind==='note';switchRow.hidden=open||notes;listHead.hidden=open;}
const noteDocs=mountNotes(noteHost,{esc,rt,onOpenChange:()=>paintListChrome(),onMovedToBasket:()=>void refresh()});
// The menu marks ([정리함] / [노트] in the sidebar, tabs and menu sheet) follow the side shown: the router reads #basketView[data-kind].
function paintNavKind(){
  const on=window.KPTURouter?.current==='basket';
  window.dispatchEvent(new CustomEvent('kptu:basket-kind',{detail:{kind:on?kind:null}}));
  window.KPTURouter?.syncNavigation?.();
}
window.addEventListener('kptu:view-changed',paintNavKind);
// [다시 찾기] sits in the top row beside [처리 전 ▾]; the last find time is its tooltip.
function paintSummary(){
  const state=radarFindState();
  findButton.title=state.checkedAt?`마지막 찾기 ${radarClock(state.checkedAt)}`:'';
  findButton.disabled=state.finding||state.missing;findButton.toggleAttribute('aria-busy',state.finding);
}
paintSummary();
// The list's views map to the update filters: 처리 전 = 미분류, 연결 완료 = 분류 완료, 무시 = 보류. 보냄·이미 함 hold no updates.
const UPDATE_FILTER={open:'unclassified',linked:'classified',dismissed:'archived'};
forget=mountForgetList(root.querySelector('[data-basket-rows]'),{rt,statusEl:root.querySelector('[data-forget-status]'),viewButton:root.querySelector('[data-forget-view-open]'),
  updates:()=>({loading:!!loadingRun&&!notes.length,items:updateItems()}),
  onUpdateAct:(id,act,button)=>void updateAct(id,act,button),radarPromises,openSource:openTodoSource,
  updateCount:()=>loadingRun&&!notes.length?null:visibleNotes(notes,links,'unclassified',docs).length,
  onView:view=>{filter=UPDATE_FILTER[view]||'none';place='all';sub='all';renderList();}});
void forget.refresh();
// FAMILY-기억알림: 맨 위 '가족 · 기억할 것' 칸(family-remind.js가 유일한 renderer — 가족 노트가 없거나 비면 칸 없음). 이 파일은 칸 자리만 둔다.
let famRemind=null;
const refreshFamRemind=()=>import('./family-remind.js').then(m=>{famRemind||=m.mountFamilyRemind(root.querySelector('[data-fam-remind]'),{rt});return famRemind.refresh();}).catch(()=>{});
void refreshFamRemind();
// [다시 찾기]: the same finder as the work journal (todo-radar.js); its change event makes the list read its 챙길 것 rows again.
async function findAgain(){
  paintSummary();
  try{await radarFindAgain();}catch{/* the finder keeps its own status line */}
  paintSummary();
  const {status}=radarFindState();if(status)showToast(status);
}
window.addEventListener('kptu:todo-radar-changed',()=>paintSummary());
// NAV-새로고침제자리: the note side is written to the address (?view=basket&pane=note); the 정리함 itself has no parameter.
// BASKET-정리함한화면: the old address of the '챙길 것' side (?view=basket&pane=todo) opens this screen (the one list).
const paneSub=()=>kind==='note'?'note':null;
const showTodoBox=()=>{if(kind==='memo'&&!selected)list.scrollIntoView?.({block:'start'});};
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
  basketTitle.textContent=kind==='note'?'노트':'잊지 말기';
  const memo=kind==='memo';
  paintListChrome();
  if(!memo&&isSplit()){root.classList.remove('basket-split');unfollowDetail();}
  list.hidden=!memo||(!!selected&&!isSplit());noteHost.hidden=memo;
  if(memo)renderList();
  paintNavKind();
  if(address&&window.KPTURouter?.current==='basket')window.KPTURouter.setSub?.('basket',paneSub(),{replace:address==='replace'});
  if(!memo)noteDocs.show({openId,folder});
}
// UI-업데이트목록메뉴: a list row's menu item. 수정 opens the detail in edit mode; 연결하기·할 일 만들기 open the detail with that
// panel already open (the detail's own button path); 노트로 옮기기 asks once (the row's text is not on screen), then runs the
// detail's own move; 삭제 is the detail's delete (same confirmation from basket-record-delete.js), reported on the list.
function rowMenuAction(act,noteId){
  const note=notes.find(n=>n.id===noteId);if(!note||busy)return;
  // FOLD-넓은화면 ④: 폴드 펼침에서 상세가 열린 채 줄 메뉴의 [복사]는 그대로 된다. 나머지는 부른 쪽이 열린 상세를 먼저 닫는다(releaseDetail).
  if(act==='copy'){void copyNote(note);return;} // 메뉴 안 [복사]: 알림('복사했습니다')만 — ⋯ 글자를 '✓'로 바꾸지 않는다(⋯ 모양 그대로).
  if(selected)return;
  // 첨부를 올리는 중인 업데이트: 그 글을 바꾸는 줄 메뉴만 잠근다(열기·수정·복사·연결은 그대로, 아래 attachGoing).
  if(['delete','journal','unjournal','hold','unhold','to-report','to-note','to-diary'].includes(act)&&attachGoing(noteId))return;
  
  if(act==='delete'){void deleteFromList(noteId);return;}
  if(act==='journal'||act==='unjournal'){void keepInJournal(noteId,act==='journal');return;}
  if(act==='hold'||act==='unhold'){void holdFromList(noteId,act==='hold');return;}
  if(act==='to-report'){void moveToReport(note,rowMenuEl.querySelector('button')||root);return;}
  if(act==='to-note'){void rowToNote(note);return;}
  if(act==='to-diary'){void toDiary(noteId,root.querySelector(`[data-basket-row-more="${CSS.escape(noteId)}"]`));return;}
  openDetail(noteId,{edit:act==='edit'});
  if(selected?.id!==noteId)return;
  if(act==='link'||act==='task'){const id=noteId;void manual.open(act).then(message=>{if(selected?.id===id)detail.querySelector('[data-basket-status]').textContent=message||'';});}
}
// S48-56 [일기로 보내기](줄 ⋯·상세 ⋯): 날짜를 묻고(기본 = 업데이트를 쓴 날) 그날 일기에 글·사진을 더한 뒤 업데이트는 휴지통(알림의 [되돌리기]).
async function toDiary(noteId,anchor){
  if(busy||!noteId||attachGoing(noteId))return;
  const run=++epoch,owner=scope();busy=true;
  let result;
  try{const {askSendToDiary}=await import('./diary-send.js');result=await askSendToDiary(anchor?.isConnected?anchor:root,noteId,{rt,isCurrent:()=>run===epoch&&owner===scope()});}
  catch{result={status:'failed'};}
  finally{busy=false;}
  if(run!==epoch||owner!==scope())return;
  if(result.status==='sent'&&result.trash==='deleted'){if(selected?.id===noteId)closeDetail({force:true,focus:false});notes=notes.filter(n=>n.id!==noteId);renderList();}
}
// S48-28: [노트로 옮기기]는 공용 작은 확인창으로 한 번 묻는다(그 줄의 ⋯ 근처). 기다리는 사이 다른 일이 시작됐거나 줄이 없어졌으면 멈춘다.
async function rowToNote(note){
  const noteId=note.id,anchor=root.querySelector(`[data-basket-row-more="${CSS.escape(noteId)}"]`);
  if(attachGoing(noteId))return; // 줄 ⋯ 말고 줄 단추(잊지 말기 [노트로])로 와도 같은 잠금
  const text=`‘${[...suggestNoteTitle(note).replace(/[\r\n]+/g,' ').trim()||'이 업데이트'].slice(0,40).join('')}’을(를) 노트로 옮길까요?`;
  if(!(await askConfirm(anchor,{text,ok:'옮기기'}))||busy||selected||window.KPTURouter?.current!=='basket'||!notes.some(n=>n.id===noteId)||attachGoing(noteId))return;
  openDetail(noteId,{edit:false});
  if(selected?.id===noteId)void saveToNote();
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
async function holdFromList(noteId,on,{undo=''}={}){
  if(busy||selected||attachGoing(noteId))return;
  const run=++epoch,owner=scope();busy=true;listStatus.textContent='';
  let saved=null;
  try{saved=await updateNote(noteId,{archived_at:on?new Date().toISOString():null});}catch{saved=null;}
  finally{busy=false;}
  if(owner!==scope()||run!==epoch||selected)return;
  if(!saved){listStatus.textContent=on?'보류로 보내지 못했어요. 다시 시도해 주세요.':'보류를 해제하지 못했어요. 다시 시도해 주세요.';root.querySelector(`[data-basket-row-more="${CSS.escape(noteId)}"]`)?.focus({preventScroll:true});return;}
  notes=notes.map(n=>n.id===noteId?saved:n);
  renderList();
  // S52-20: [이미 함]·[×] from the one list say it on the shared undo notice ([되돌리기] = 보류 해제, the same field).
  if(undo)offerUndoNotice({text:undo,onUndo:async()=>{
    if(owner!==scope())return {status:'failed',message:'되돌리지 못했어요. 다시 시도해 주세요.'};
    let back=null;try{back=await updateNote(noteId,{archived_at:null});}catch{back=null;}
    if(!back)return {status:'failed',message:'되돌리지 못했어요. 다시 시도해 주세요.'};
    if(owner===scope()){notes=notes.map(n=>n.id===noteId?back:n);renderList();}
    return {status:'done',message:'다시 보이게 했어요.'};
  }});
  else showToast(on?'보류로 보냈어요.':'보류를 해제했어요.');
  root.querySelector('[data-forget-view-open]')?.focus({preventScroll:true});
}
async function deleteFromList(id,{confirmed=false}={}){
  if(busy||selected||attachGoing(id))return;
  const run=++epoch,owner=scope();busy=true;listStatus.textContent='';
  const current=()=>run===epoch&&owner===scope()&&!selected&&window.KPTURouter.current==='basket';
  const more=()=>root.querySelector(`[data-basket-row-more="${CSS.escape(id)}"]`);
  let result;
  try{result=await deleteNoteOriginal(id,{rt,isCurrent:current,trash:true,confirmed});}
  catch{result={status:'unknown',message:'결과를 확인하지 못했어요. [업데이트 최신화]로 실제 상태를 확인해 주세요.'};}
  finally{busy=false;}
  if(!current()||result.status==='stale')return;
  if(['deleted','missing'].includes(result.status)){
    notes=notes.filter(n=>n.id!==id);links=links.filter(l=>l.note_id!==id);
    renderList();if(result.message)listStatus.textContent=result.message;
    root.querySelector('[data-forget-view-open]')?.focus({preventScroll:true});
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
  const body = `<span class="basket-chip-dot ui-color-dot" aria-hidden="true"></span><span class="a11y-only">${esc(label)}: </span>${esc(name)}`;
  const main = open && removable ? `<button type="button" class="basket-chip-open" data-basket-chip-open="${esc(link.id)}">${body}</button>` : `<span class="basket-chip-name">${body}</span>`;
  const remove = removable ? `<button type="button" class="basket-chip-x" data-basket-unlink="${esc(link.id)}" aria-label="${esc(disconnectLabel(name))}"><span aria-hidden="true">×</span></button>` : '';
  return `<span class="basket-chip" data-chip-kind="${esc(kind)}"${removable ? ` data-basket-chip="${esc(link.id)}"` : ''}>${main}${remove}</span>`;
}
// BUG-자료넣기미분류: a project holding this memo's files ([자료로 넣기]) is one plain chip "○○ · 자료".
// Moving or removing the documents elsewhere changes it on the next read; there is nothing to undo here.
function filedChips(note) {
  const chip = (kind, id, name, label) => `<span class="basket-chip" data-chip-kind="${kind}" data-basket-filed${kind === 'organization' ? '-org' : ''}="${esc(id)}"><span class="basket-chip-name"><span class="basket-chip-dot ui-color-dot" aria-hidden="true"></span><span class="a11y-only">${label} 자료: </span>${esc(name)} · 자료</span></span>`;
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
  return count ? `<span class="basket-chip" data-chip-kind="task"><span class="basket-chip-name"><span class="basket-chip-dot ui-color-dot" aria-hidden="true"></span>할 일 ${count}개</span></span>` : '';
}
// S52-20: the update rows the one list draws (forget-list.js renders them with the shared row; this file keeps their data and actions).
// The title opens the update ([data-basket-row]), the small line says when and how many files, the chips under it say where it went,
// and the row's ⋯ (the existing update menu) stays at the end: copy, edit, 일기로·사업 보고로·업무일지·삭제 live there.
function updateItems() {
  const visible = filter === 'none' ? [] : visibleNotes(notes, links, filter, docs, place, sub);
  return visible.map(note => {
    const state = noteState(note, links, docs), title = [...memoTitle(note)].slice(0, 80).join('');
    const chips = [...confirmedLinks(note.id).map(link => linkChip(link)), ...filedChips(note)].join('') + taskPlaceLine(note) + requestTagsHtml(noteRequests(note), esc);
    const label = rowState(note, state);
    return {id: note.id, at: note.occurred_at || note.created_at || '', body: title, busy,
      open: {attrs: `data-basket-row="${esc(note.id)}"${isSplit() && selected?.id === note.id ? ' aria-current="true"' : ''}`, label: title},
      meta: [time(note), note.attachments?.length ? '첨부 ' + note.attachments.length + '개' : '', filter === 'unclassified' && label !== '미분류' ? label : ''].filter(Boolean).join(' · '),
      done: note.archived_at ? '보류' : label,
      attrs: `data-basket-row-item="${esc(note.id)}"${isSplit() && selected?.id === note.id ? ' data-basket-selected' : ''}`, // FOLD-넓은화면 ④: 오른쪽 칸에 연 줄
      tail: `<button type="button" class="icon-btn nbx-more" data-basket-row-more="${esc(note.id)}" aria-label="${esc([...title].slice(0,40).join(''))} 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="basketRowMenu"><span class="more-dots" aria-hidden="true">⋯</span></button>`,
      below: chips ? `<div class="nbx-below" role="group" aria-label="연결된 곳">${chips}</div>` : ''};
  });
}
function renderList() {
  const active=document.activeElement,kept=rowMenu&&{noteId:rowMenu.noteId,focusAct:rowMenuEl.contains(active)?active.dataset.basketRowAct||'':null};
  closeRowMenu({keepLayer:true});
  paintPlaceFilter(); paintSubFilter();
  forget?.paint();
  if (!loadingRun && listStatus.querySelector('[data-wait]')) listStatus.textContent = '';
  keepRowMenu(kept);
  if(!rowMenu)dropRowLayer();
}
// S52-20: the update row's buttons in the one list. Each reuses the update's own path: [조직]·[사업] open the update with its
// 연결하기 panel and that kind's shared picker (UI-영역조직고르기, basket-manual-link.js — the same link records as before; once linked
// the update leaves 처리 전), [할 일로] the detail's 할 일 만들기, [노트로] 노트로 옮기기, [일정으로] the event window with the text,
// [이미 함]·[×] 보류(archived_at, the same field as 보류로) with '되돌리기'.
async function updateAct(id, act, button) {
  const note = notes.find(n => n.id === id); if (!note || busy) return;
  // FOLD-넓은화면 ④: 폴드 펼침에서 상세가 열린 채 줄 버튼을 누르면 열린 상세를 먼저 닫고(쓰던 글이 있으면 묻는다) 목록만 있을 때와 같은 길로 간다.
  if (selected && !(await releaseDetail(button))) return;
  if (busy || selected || !notes.some(n => n.id === id)) return;
  if (act === 'org' || act === 'area') {
    openDetail(id); if (selected?.id !== id) return;
    const message = await manual.open('link', button);
    if (selected?.id !== id) return;
    if (message) { detail.querySelector('[data-basket-status]').textContent = message; return; }
    detail.querySelector(`[data-manual-pick="${act === 'org' ? 'organization' : 'project'}"]`)?.click();
    return;
  }
  if (act === 'task') { rowMenuAction('task', id); return; }
  if (act === 'note') { void rowToNote(note); return; }
  if (act === 'event') {
    if (!window.KPTUEventCreate?.open) { showToast('일정 창을 열지 못했어요'); return; }
    window.KPTUEventCreate.open({title: [...memoTitle(note)].slice(0, 100).join(''), memo: ['업데이트', time(note)].filter(Boolean).join(' · '), onCreated: () => showToast('일정으로 만들었어요')});
    return;
  }
  if (act === 'done' || act === 'dismissed') void holdFromList(id, true, {undo: act === 'done' ? '이미 한 일로 보류에 넣었어요.' : '보류로 보냈어요.'});
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
const closeDetailText = () => dirty() ? '수정 중인 글을 저장하지 않고 목록으로 돌아갈까요?' : manualDraft() ? '작성 중인 연결·할 일 입력을 삭제하고 목록으로 돌아갈까요?' : '';
// S48-28: 화면 안 버튼·Esc로 닫을 때는 공용 작은 확인창으로 묻는다. 기다리는 사이 다른 업데이트가 열렸거나 작업이 시작됐으면 그대로 둔다.
async function askCloseDetail(anchor) {
  const text = closeDetailText(), id = selected?.id;
  if (!text) return closeDetail();
  if (!(await askConfirm(anchor, {text, ok:dirty() ? '저장 안 함' : '삭제', danger:true})) || busy || !selected || selected.id !== id) return false;
  return closeDetail({force:true});
}
// FOLD-넓은화면 ④: 목록 줄 누르기. 상세가 없으면 연다. 폴드 펼침에서 상세가 열려 있으면 같은 칸에서 그 줄로 바꾼다(쓰던 글이 있으면 지금처럼 묻고, 뒤로가기 한 걸음은 그대로).
async function openRow(id, anchor) {
  if (!selected) { openDetail(id); return; }
  if (!isSplit() || selected.id === id || !notes.some(n => n.id === id)) return;
  const text = closeDetailText(), from = selected.id;
  if (text && !(await askConfirm(anchor, {text, ok:dirty() ? '저장 안 함' : '삭제', danger:true}))) return;
  if (busy || selected?.id !== from || !isSplit() || !notes.some(n => n.id === id)) return;
  closeDetail({force:true, focus:false, cleanAddress:false, keepLayer:true});
  openDetail(id);
}
// FOLD-넓은화면 ④: 폴드 펼침에서 상세가 열린 채 목록의 줄 버튼·줄 메뉴·밀기를 쓰면, 열린 상세를 먼저 닫고(쓰던 글이 있으면 묻는다) 그 겹의 뒤로가기가 도착한 뒤에 이어 간다.
// 돌려주는 값: 목록만 남았으면 true. 폴드 펼침이 아니면(목록이 안 보이는 폭) 지금처럼 아무 일도 하지 않는다(false).
async function releaseDetail(anchor) {
  if (!selected) return true;
  if (!isSplit()) return false;
  const text = closeDetailText(), from = selected.id;
  if (text && !(await askConfirm(anchor, {text, ok:dirty() ? '저장 안 함' : '삭제', danger:true}))) return false;
  if (busy || selected?.id !== from) return !selected;
  const layer = noteLayer;
  closeDetail({force:true, focus:false, keepLayer:true});
  noteLayer = null; renderList();
  await Promise.resolve(layer?.close());
  return !selected;
}
// 상세 머리의 닫기 단추 하나: 오른쪽 칸이면 ✕(목록이 옆에 보이므로), 목록 자리를 대신하면 지금처럼 '‹ 잊지 말기'. 담당조직·사업에서 열어 돌아갈 곳이 있는 줄(‹ 이름)은 그대로 둔다.
function paintCloseButton() {
  const close = detail.querySelector(':scope > .basket-detail-head > [data-basket-close]');
  if (close && close.classList.contains('basket-close-x') !== isSplit()) close.outerHTML = isSplit() ? BASKET_CLOSE_X : BASKET_BACK;
}
// 폴드를 접고 펴거나 창 폭이 바뀌면: 열린 상세의 자리(오른쪽 칸 ↔ 목록 자리)와 닫기 단추(✕ ↔ ‹ 잊지 말기)를 그 폭에 맞춘다.
function paintSplit() {
  if (!selected || kind !== 'memo') return;
  const on = splitWide();
  if (on === isSplit()) return;
  root.classList.toggle('basket-split', on); list.hidden = !on;
  paintCloseButton();
  paintListChrome(); renderList();
  if (on) followDetail(false); else unfollowDetail();
}
SPLIT?.addEventListener?.('change', paintSplit);
// 뒤로가기(겹 닫기)·화면 들어오기는 라우터가 그 자리에서 답을 받아야 해서 브라우저 기본 확인창을 그대로 쓴다(S48-28 예외).
// keepLayer(FOLD-넓은화면 ④): 폴드 펼침에서 다른 줄로 바꿀 때 — 뒤로가기 한 걸음(겹)은 그대로 두고 칸 안만 비운다(바로 다음 openDetail이 같은 겹을 쓴다).
function closeDetail({focus = true, force = false, cleanAddress = true, fromBack = false, keepLayer = false} = {}) {
  if (!force) { const text = closeDetailText(); if (text && !window.confirm(text)) return false; }
  
  bigWriter?.close({silent:true}); closePhoto({restore:false});
  const wasSplit = isSplit();
  const id = selected?.id; if(id&&cleanAddress)clearNoteAddress(); ++epoch; selected = null;sendMemoWhere(null);editing=false;setNoteMenu(false);manual.reset();ocrViewScope=null; upload=createUploadBatch();pickerFiles=null;sentRows?.destroy();sentRows=null; detail.replaceChildren(); detail.hidden = true; list.hidden = false;
  root.classList.remove('basket-split'); unfollowDetail(); paintListChrome();
  if (wasSplit && !keepLayer) renderList(); // 고른 줄 표시를 지운다(목록이 다시 화면 폭 전체)
  if (!keepLayer) { const layer = noteLayer; noteLayer = null; if (!fromBack) layer?.close(); }
  // 폴드 펼침은 목록이 내내 보였으므로 스크롤 자리를 되돌릴 일이 없다.
  if (id && !wasSplit && window.KPTURouter.current === 'basket') window.scrollTo({top:listScroll, behavior:'instant'});
  if (focus) (root.querySelector(`[data-basket-row="${CSS.escape(id || '')}"]`) || root.querySelector('[data-forget-view-open]'))?.focus({preventScroll:true});
  return true;
}
function openNoteLayer({adoptOnly = false} = {}) {
  if (noteLayer || !selected) return;
  // NAV-PC앞뒤통일: › (or the browser's forward) over this update's entry opens the same update again (reopen).
  layerNoteId = selected.id;
  noteLayer = window.KPTURouter.layer?.open('basket-note', {adoptOnly, close: () => !busy && closeDetail({fromBack:true}), reopen: () => openDetail(layerNoteId)}) || null;
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
  else if (!selected) (root.querySelector(`[data-basket-row-more="${CSS.escape(noteId)}"]`) || root.querySelector('[data-forget-view-open]'))?.focus({preventScroll:true});
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
  const open=url?`<a class="basket-file-link" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${esc(name)} Drive에서 열기">${link('drive','Drive에서 열기')}</a>`:'<span class="basket-file-link-off">링크를 확인할 수 없어요.</span>';
  const save=driveDownloadUrl(id)?`<button type="button" class="basket-file-link" data-basket-file-download="${esc(id)}" aria-label="${esc(name)} 내려받기">${link('download','내려받기')}</button>`:'';
  const sending=sent?.kind==='sending';
  const library=!id?'':inLibrary?(doc?`<a class="basket-file-link" href="${esc(libraryHref)}" data-basket-library-open="${esc(doc)}" aria-label="${esc(name)} 자료실에서 보기">${link('library','자료실에서 보기')}</a>`:'')
    :sent?.kind==='unknown'?'':`<button type="button" class="basket-file-link" data-basket-library-send="${esc(id)}" aria-label="${esc(name)} ${sending?'보내는 중…':'자료실로 보내기'}"${sending?' disabled':''}>${link('library',sending?'보내는 중…':'자료실로 보내기')}</button>`;
  const hwp=id&&isHwpName(name)?`<button type="button" class="basket-file-link" data-basket-hwp-edit="${esc(id)}" aria-label="${esc(name)} 수정">${link('edit','수정')}</button>`:'';
  const kind=fileKind(name),renameSpec={target:'note',id:selected?.id,driveId:id,name:String(file?.file_name||'')};
  const thumb=isPhoto(file)&&id?`<button type="button" class="basket-file-thumb" data-basket-photo="${esc(id)}" aria-label="${esc(name)} 크게 보기"></button>`
    :`<span class="basket-file-thumb basket-file-kind file-kind" data-kind="${esc(kind.key)}" aria-hidden="true">${esc(kind.label)}</span>`;
  // A sent or already-there result is a short notice (sendToLibrary); a refusal or an unknown result stays as one line here.
  const message=sent?.message&&!inLibrary?`<p class="basket-library-result" role="status" data-basket-library-status="${esc(id)}">${esc(sent.message)}</p>`:'';
  return `<div class="basket-file" data-basket-file-card="${esc(id)}">${thumb}<div class="basket-file-body"><span class="basket-file-namebox" data-fr-row><b class="basket-file-name" role="button" tabindex="0" data-basket-file-press="${esc(id)}"${editing?'':renameHostAttrs(renameSpec)}>${esc(name)}</b>${editing?'':renameButtonHtml(renameSpec)}</span><small class="basket-file-meta">${esc(meta)}</small><div class="basket-file-links" data-basket-library="${esc(id)}"${editing?' hidden':''}>${open}${save}${library}${hwp}</div></div>${ocrMarkup(file)}${message}</div>`;
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
  toggle.textContent = rawView ? '서식' : '원문'; // S48-64: <> 아이콘 대신 글자 [원문]/[서식]
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
  if (asDoc && paintDoc(text, selected, {rt, onOpen:(file, el) => openPhoto(file.drive_file_id, el)})) return;
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
// UI-돌아가기머리줄: the head's back is "‹ 정리함" from the list, "‹ (name)" when opened from another screen (basketBackHtml).
const BASKET_BACK = '<button type="button" class="basket-back" data-basket-close aria-label="잊지 말기 목록으로"><span aria-hidden="true">‹</span> 잊지 말기</button>';
function openDetail(id, {edit = false} = {}) {
 closeRowMenu();
  if (!selected) listScroll = window.scrollY;
  selected = notes.find(n => n.id === id); if (!selected) return;
  // Keep the opened note attached to this list snapshot until an explicit reload.
  ++epoch;ocrViewScope=captureOcrScope();editing=edit;rawView=false;
  for(const file of selected.attachments||[]){const view=ocrViews.get(ocrKey(file.drive_file_id));if(view){delete view.checkedAttempt;delete view.stamp;}}
  upload=createUploadBatch(selected.id,selected.attachments||[]);
  // FOLD-넓은화면 ④: 폴드 펼침이면 목록을 그대로 두고 오른쪽 칸에 연다(그 밖의 폭은 지금처럼 목록 자리를 대신).
  root.classList.toggle('basket-split', splitWide() && kind === 'memo'); list.hidden = !isSplit(); detail.hidden = false;
  paintListChrome();
  // UI-업데이트편집한줄: the edit screen's buttons are one row like the note's — [📎 첨부] [큰 창에서 수정] [수정 저장] [취소].
  // [첨부 저장] (the existing separate attachment save) sits by the chosen files and shows only while files are chosen.
  // UI-바구니상세개편: the whole update is one card — text (with [복사] and the 원문 toggle beside it), state·time,
  // attachments (photo previews, file kinds, small links, 사진 속 글자), then [연결하기]·[할 일 만들기]·[노트로 옮기기] in one row.
  // The ⋯ keeps 수정·보관·삭제 (BASKET-일지로남기기: and [업무일지에 남기기]/[업무일지에서 빼기] before 삭제, so the row stays three buttons).
  // UI-엔터저장: the edit box saves with Ctrl+Enter on PC (shared rule, enter-save.js); [연결하기]·[할 일 만들기] forms are their own roots.
  detail.dataset.enterSave = '[data-basket-save]';
  detail.innerHTML = `<div class="basket-detail-head">${basketBackHtml(selected.id, BASKET_BACK, rt)}<div class="basket-note-more" data-basket-note-more-wrap><button type="button" class="basket-more-trigger" data-basket-note-more data-ctx="area" aria-label="이 업데이트 메뉴" aria-expanded="false" aria-controls="basketNoteMenu"><span class="more-dots" aria-hidden="true">⋯</span></button><div id="basketNoteMenu" class="basket-more-menu" role="group" aria-label="이 업데이트" hidden><button type="button" data-basket-edit>수정</button><button type="button" data-basket-archive>보류로</button><button type="button" data-basket-to-diary>일기로 보내기</button><button type="button" class="basket-menu-danger" data-basket-delete>삭제</button></div></div></div><article class="basket-card" data-basket-card aria-label="업데이트"><div class="basket-read" data-basket-read><div class="basket-card-tools"><button type="button" class="basket-icon-button" data-basket-read-raw aria-pressed="false" aria-label="원문 그대로 보기" title="원문 그대로 보기">원문</button><button type="button" class="basket-icon-button" data-basket-copy aria-label="복사" title="복사">${COPY_ICON}</button></div><div class="md-share-cards" data-basket-share hidden></div><div class="basket-read-text" data-basket-read-text tabindex="-1" role="region" aria-label="업데이트 원문"></div><div class="basket-html-views" data-basket-html-views></div><p class="basket-note-meta"><span class="basket-note-state" data-basket-state></span><time>${esc(time(selected))}</time></p></div><div class="basket-editor" hidden><label class="basket-text-label">업데이트 원문<textarea data-basket-text rows="12"></textarea></label><div class="basket-editor-files"><div data-basket-file-selection></div><button type="button" data-basket-upload>첨부 저장</button></div></div><div data-basket-sent></div><div data-basket-attachments class="basket-files" tabindex="-1" role="region" aria-label="첨부 파일"></div><section class="basket-note-tasks" data-basket-note-tasks aria-labelledby="basketNoteTasksTitle" hidden></section><button type="button" data-basket-reload hidden>업데이트 최신화</button><div class="basket-actions basket-read-actions" data-basket-read-actions><button type="button" data-basket-link-open>연결하기</button><button type="button" data-basket-task-open>할 일 만들기</button><button type="button" data-basket-to-note>노트로 옮기기</button></div><div data-basket-manual hidden></div><div class="basket-actions basket-edit-actions save-row save-row-sticky" data-basket-edit-actions hidden><div class="save-row-start" data-basket-file-picker></div><button type="button" class="secondary save-row-start" data-basket-big-write>큰 창에서 수정</button><button type="button" class="secondary" data-basket-cancel>취소</button><button type="button" class="primary" data-basket-save>수정 저장</button></div><p data-basket-status role="status"></p></article>`;
  detail.querySelector('[data-basket-text]').value = selected.raw_text;
  manual.attach(detail.querySelector('[data-basket-manual]'));
  sentRows?.destroy();{const sentId=selected.id;sentRows=mountUploadRows(detail.querySelector('[data-basket-sent]'),{has:job=>attachQueue.has(sentId,job.file)});}
  pickerFiles=mountBasketPicker(detail.querySelector('[data-basket-file-picker]'),{id:'detailBasketFiles',filesHost:detail.querySelector('[data-basket-file-selection]'),dropTarget:detail.querySelector('.basket-editor'),pasteTarget:detail.querySelector('.basket-editor'),getBatch:()=>upload,isActive:()=>editing,isBusy:()=>busy,onError:message=>detail.querySelector('[data-basket-status]').textContent=message});
  paintDetailState();paintMode();void loadLibraryDocs();
  // A note address (?note=) opens the note once; the list entry under it stays the plain list.
  // Opened from a project's or organization's record, the note has no entry of its own: one back returns to that project.
  if (!noteLayer) { clearNoteAddress(); if (!basketNoteOrigin(selected.id, rt)) openNoteLayer(); }
  // NAV-새로고침제자리: the open update is written on its own entry (?note=), so a reload reopens it; closing drops it (clearNoteAddress).
  if (noteLayer) { layerNoteId = selected.id; window.KPTURouter.setPlace?.('basket', {note:selected.id}); }
  paintCloseButton();
  if (isSplit()) { renderList(); followDetail(true); } else unfollowDetail();
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
  // 첨부를 올리는 중에는 열지 않는다: 큰 창은 연 때의 판(updated_at)으로만 저장하는데, 올리기가 끝나면 판이 바뀌어 그 저장이 거절된다.
  if (!selected || !editing || busy || !field || bigOpening || attachGoing(id)) return;
  const same = () => editing && selected?.id === id && field.isConnected;
  const status = detail.querySelector('[data-basket-status]');
  bigOpening = true;
  try {
    const [{openUpdateEditWindow}, fresh] = await Promise.all([import('./update-window.js'), readBasketNote(id, rt)]);
    if (!same()) return;
    const letters = value => String(value ?? '').replace(/\r\n?/g, '\n');
    if (!fresh) { status.textContent = '업데이트를 찾지 못했어요. 목록을 다시 불러와 주세요.'; return; }
    if (letters(fresh.raw_text) !== letters(selected.raw_text) || JSON.stringify(fresh.doc || null) !== JSON.stringify(selected.doc || null)) {
      status.textContent = '다른 곳에서 바뀐 업데이트예요. [업데이트 최신화] 뒤 수정해 주세요.'; detail.querySelector('[data-basket-reload]').hidden = false; return;
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
  detail.querySelector('[data-basket-status]').textContent = '서식이 있는 글이에요. 큰 창에서 수정해 주세요.';
  void openBigWriter();
}
async function finishEdit({force = false, anchor = null} = {}) {
  if (!selected || !editing) return;
  if (!force && dirty()) {
    const id = selected.id;
    if (!(await askConfirm(anchor, {text:'수정 중인 글과 첨부 선택을 저장하지 않고 읽기 화면으로 돌아갈까요?', ok:'저장 안 함', danger:true})) || busy || !editing || selected?.id !== id) return;
  }
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
  listStatus.innerHTML = waitInlineHtml(); root.querySelector('[data-basket-retry]').hidden = true; forget?.paint(); // the read's wait stays on the list's line (rows already shown stay)
  // UI-바구니첨부메모 PR 3: 자료실 분류 칩은 내 분류 목록을 따른다(목록이 오면 'kptu:document-categories-changed'로 다시 그린다).
  void loadDocumentCategories();
  try {
    const result = await readBasket(undefined, {doc:true});
    if (run !== epoch || owner !== scope()) return;
    loadingRun = 0;
    notes = result.notes; links = result.links; docs = result.docs; renderList();
    // 이 읽기가 도는 사이 뒤에서 첨부가 저장됐으면 방금 읽은 줄이 그 전 모습일 수 있다: 한 번 더 읽는다.
    if (staleRead && !busy) { staleRead = false; void refresh(); return; }
    staleRead = false;
    if (requestedNote) {
      const id = requestedNote; requestedNote = null;
      if (notes.some(note => note.id === id)) openDetail(id);
      else listStatus.textContent = '업데이트를 찾을 수 없어요. 접근 권한과 업데이트를 확인해 주세요.';
    }
  } catch (e) {
    if (run !== epoch || owner !== scope()) return;
    loadingRun = 0;
    notes = []; links = []; docs = []; renderList();
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
  if (attachGoing(selected.id)) { patchFail = '첨부를 올리는 중이에요. 다 올라간 뒤에 저장해 주세요.'; return false; }
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
  catch { result = {status:'unknown', message:'결과를 확인하지 못했어요. [업데이트 최신화]로 실제 상태를 확인해 주세요.'}; }
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
// UX-먼저묻고뒤에처리 3차 (2): [첨부 저장] hands the chosen files to that update's line (attachQueue, memory only) and frees the screen at
// once: the update can be closed, another one or another screen opened, and files saved meanwhile wait in the same line. They go up by
// the id of the update they were chosen for. Progress is the shared upload line (this update's row while it is shown, else the line above
// the bottom bar); the end and a failure are the shared small notice ([다시] sends only what did not go up). Only another account or
// workspace stops it. The photo text reading (OCR) is tied to the screen that shows the update, so it runs after the upload only while
// that update is still shown (locked for that moment, as [글자 읽기]); elsewhere it is left to the photo's own [글자 읽기].
// 올리는 동안에도 잠그는 것: 같은 업데이트를 바꾸는 일(수정 저장·삭제·보류·옮기기·글자 읽기). 서버는 올리는 사이 글이 바뀌면 그 올리기를 거절한다
// (updated_at·attachments 맞춤). 닫기·다른 업데이트·다른 화면·더 붙이기는 잠그지 않는다.
function attachGoing(id) {
  if (!id || !attachQueue.going(id)) return false;
  const text = '첨부를 올리는 중이에요. 다 올라간 뒤에 할 수 있어요.';
  if (selected) detail.querySelector('[data-basket-status]').textContent = text; else listStatus.textContent = text;
  return true;
}
const GOING_LOCKED = '[data-basket-save],[data-basket-delete],[data-basket-archive],[data-basket-to-note],[data-basket-to-diary],[data-basket-journal],[data-basket-unlink],[data-basket-ocr-read],[data-basket-ocr-status],[data-basket-ocr-reconcile],[data-basket-ocr-cleanup],[data-basket-reload]';
function saveAttachments() {
  if(busy||!selected)return;
  const batch=upload,id=selected.id,status=detail.querySelector('[data-basket-status]');
  if(!batch.entries.some(e=>e.kind!=='success')){status.textContent='파일을 선택해 주세요.';return;}
  // 결과를 알 수 없거나 글이 바뀐 묶음은 다시 보내지 않는다(예전과 같음): [업데이트 최신화] 뒤 다시 고른다.
  if(batch.blocked){status.textContent='업데이트를 다시 불러오지 못했어요. 다시 시도해 주세요.';detail.querySelector('[data-basket-reload]').hidden=false;return;}
  // A read started before this write must not restore stale attachment counts.
  ++epoch;
  upload=createUploadBatch(id,batch.attachments);pickerFiles?.render();status.textContent='';
  sendAttachments(id,batch);
}
function sendAttachments(id,batch){
  const owner=scope(),here=()=>scope()===owner,shown=()=>here()&&selected?.id===id&&window.KPTURouter.current==='basket';
  const count=()=>batch.entries.filter(e=>e.kind==='success').length;
  void attachQueue.add(id,batch,async()=>{
    if(!here()||!batch.entries.some(e=>e.kind!=='success'))return;
    // 차례가 왔을 때의 첨부 목록에서 시작한다: 줄 서 있는 동안(또는 [다시]까지 기다리는 동안) 앞 묶음이 붙인 파일이 있다.
    // 고를 때의 목록으로 그리면 앞서 올라간 파일이 화면에서 사라지고, 그 사진의 글자 읽기도 한 번 더 돈다.
    {const now=selected?.id===id?selected:notes.find(n=>n.id===id);if(Array.isArray(now?.attachments))batch.attachments=now.attachments;}
    const before=count(),mine=batch.entries.filter(e=>e.kind!=='success'),sent=()=>mine.filter(e=>e.kind==='success').map(e=>e.file?.name||''),originalIds=new Set(batch.attachments.map(file=>file.drive_file_id));
    const files=mine.map(e=>e.file); // 끝 알림이 맡는 파일(올라가면 entry.file은 이름·크기만 남으므로 지금 잡아 둔다)
    // 올라간 만큼 그 업데이트의 줄(목록)과, 보고 있으면 상세를 그린다. 다른 업데이트를 보고 있으면 그 화면은 건드리지 않는다.
    const paint=()=>{
      if(!here())return;
      if(loadingRun&&loadingRun===epoch)staleRead=true; // 지금 도는 목록 읽기는 이 저장 전 모습일 수 있다
      const row=notes.find(n=>n.id===id);if(row)row.attachments=batch.attachments;
      if(selected?.id===id){selected.attachments=batch.attachments;if(upload.note_id===id&&upload!==batch)upload.attachments=batch.attachments;}
      renderList();if(shown()){paintAttachments();pickerFiles?.render();}
    };
    let error=null;
    try{await uploadBatch(batch,{isCurrent:here,onChange:paint,ocr:{enabled:false}});}catch(e){error=e;}
    if(!here())return; // 다른 계정·작업공간 화면에는 아무것도 그리지도 알리지도 않는다
    paint();
    const done=count()-before,left=batch.entries.filter(e=>e.kind!=='success').length;
    if(!error){
      if(upload===batch){upload=createUploadBatch(id,batch.attachments);if(shown())pickerFiles?.render();} // 되돌려 둔 묶음이 다 올라갔으면 새 묶음으로
      // UX-알림하나로(S59-21): 끝은 하단바 위 한 줄 하나(보고 있든 아니든 같은 자리 — 위쪽 작은 알림·상태 줄로 또 알리지 않는다).
      announceUploaded({done,names:sent(),where:'업데이트',files});
      if(shown()){detail.querySelector('[data-basket-status]').textContent='';await readSentPhotos(id,batch,originalIds,owner);}
      return;
    }
    if(error.code==='upload_cancelled')return;
    // [다시]: 못 올린 파일만 같은 업데이트로 다시 줄 세운다. 결과를 알 수 없거나 글이 바뀐 실패(batch.blocked)는 [다시]를 두지 않는다.
    const retry=batch.blocked||!left?null:()=>sendAttachments(id,batch);
    if(retry)for(const entry of batch.entries.filter(e=>e.kind==='error'))setUploadRetry(entry.file,retry);
    if(shown()){
      // 그 업데이트를 고치는 중이고 새로 고른 파일이 없으면 못 올린 묶음을 고른 파일 줄에 되돌려 둔다([첨부 저장]으로도 다시 보낼 수 있게, 예전과 같음).
      if(editing&&upload.note_id===id&&!upload.entries.length){upload=batch;pickerFiles?.render();}
      // 못 올린 까닭·[다시 올리기]는 아래 한 줄이 말한다. 상세에는 결과를 알 수 없을 때의 [업데이트 최신화] 단추만 둔다.
      detail.querySelector('[data-basket-status]').textContent='';
      detail.querySelector('[data-basket-reload]').hidden=!batch.blocked;
    }
    if(done)announceUploaded({done,names:sent(),failed:left,where:'업데이트',retry,note:error.message||'',files});
    else announceDock({text:`업데이트 첨부 ${left}개 못 올렸어요`,note:error.message||'',error:true,ms:0,files,actions:retry?[{label:'다시 올리기',aria:'못 올린 파일 다시 올리기',run:retry}]:[]});
  });
}
// 방금 올린 사진의 글자 읽기: 그 업데이트를 보고 있을 때만, 읽는 동안은 예전처럼 상세를 잠근다([글자 읽기]와 같은 잠금).
async function readSentPhotos(id,batch,originalIds,owner){
  if(!ocr.enabled||busy||!batch.attachments.some(file=>!originalIds.has(file.drive_file_id)&&['image/jpeg','image/png'].includes(file.mime_type)))return;
  const captured=captureOcrScope(),generation=ocrGeneration,run=epoch;
  const isCurrent=()=>scope()===owner&&selected?.id===id&&run===epoch;
  const token={current:()=>ocrFlight===token&&generation===ocrGeneration&&isCurrent()&&currentOcrScope(captured)&&window.KPTURouter.current==='basket'};
  ocrFlight=token;
  const operation=basketOcrFor({rt,isCurrent:token.current,onChange:()=>{if(token.current()&&guardOcrPrivacy())paintOcrControls();}});
  busy=true;detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=true);pickerFiles?.render();
  try{
    await readNewPhotos(batch,originalIds,{rt,isCurrent,ocr:operation,onOcrChange:value=>{if(token.current()&&guardOcrPrivacy())applyOcrOutcome(value);}});
    if(isCurrent()){selected.attachments=batch.attachments;if(upload.note_id===id)upload.attachments=batch.attachments;renderList();paintAttachments();}
  }catch{/* The stored files stay stored; the photo's own [글자 읽기] can read it again. */}
  finally{if(ocrFlight===token){ocrFlight=null;busy=false;}if(isCurrent()&&!busy){detail.querySelectorAll('button,input:not(.md-task),textarea').forEach(el=>el.disabled=false);pickerFiles?.render();paintOcrControls();}}
}
async function reloadDetail(anchor=detail.querySelector('[data-basket-reload]:not([hidden])')) {
  if(busy||!selected)return;
  if(dirty()){const id=selected.id;if(!(await askConfirm(anchor,{text:'저장된 업데이트를 다시 불러올까요?',note:'수정 중인 글과 미완료 파일 선택은 비워집니다.',ok:'최신화',danger:true}))||busy||selected?.id!==id)return;}
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
  if (rowMenuEl.contains(b)) {
    const from = closeRowMenu({focus:true}), act = b.dataset.basketRowAct;
    // 복사는 누른 그 순간에(클립보드 권한), 나머지는 메뉴 겹의 뒤로가기가 도착한 뒤에 한다(그다음 여는 창·화면 기록을 지우지 않게).
    // FOLD-넓은화면 ④: 폴드 펼침에서 상세가 열려 있으면 그 상세를 먼저 닫은 뒤(releaseDetail) 목록만 있을 때와 같은 길로 간다.
    if (from) { if (act === 'copy') rowMenuAction(act, from.noteId); else if (act === 'event' || act === 'org' || act === 'area') from.released.then(() => updateAct(from.noteId, act, from.trigger)); else from.released.then(async () => { if (selected && !(await releaseDetail(from.trigger))) return; rowMenuAction(act, from.noteId); }); }
    return;
  }
  const fromNoteMenu = !!noteMenu()?.contains(b); if (fromNoteMenu) setNoteMenu(false, {focus:true});
  if (b.hasAttribute('data-basket-read-raw')) { rawView = !rawView; paintReadText(); return; }
  if (b.hasAttribute('data-basket-copy')) { void copyNote(selected, b); return; }
  if (b.hasAttribute('data-basket-photo')) { openPhoto(b.dataset.basketPhoto, b); return; }
  if (busy) return;
  if (selected && b.matches(GOING_LOCKED) && attachGoing(selected.id)) return;
  if (b.hasAttribute('data-basket-unlink')) void unlinkChip(b.dataset.basketUnlink);
  else if (b.hasAttribute('data-basket-chip-open')) void openChipPlace(b.dataset.basketChipOpen);
  else if(b.hasAttribute('data-basket-library-send'))void sendToLibrary(b.dataset.basketLibrarySend);
  else if(b.hasAttribute('data-basket-hwp-edit'))openHwpEditor(b.dataset.basketHwpEdit);
  else if(b.hasAttribute('data-basket-ocr-read'))void runOcr('read',b.dataset.basketOcrRead);
  else if(b.hasAttribute('data-basket-ocr-status'))void runOcr('status',b.dataset.basketOcrStatus);
  else if(b.hasAttribute('data-basket-ocr-reconcile'))void runOcr('reconcile',b.dataset.basketOcrReconcile,b);
  else if(b.hasAttribute('data-basket-ocr-cleanup'))void runOcr('cleanup',b.dataset.basketOcrCleanup);
  else if (b.hasAttribute('data-basket-row')) void openRow(b.dataset.basketRow, b);
  else if (b.hasAttribute('data-basket-close')) void askCloseDetail(b);
  else if (b.hasAttribute('data-basket-edit')) startEdit();
  else if (b.hasAttribute('data-basket-to-note')) void saveToNote();
  else if (b.hasAttribute('data-basket-to-diary')) void toDiary(selected?.id, detail.querySelector('[data-basket-note-more]'));
  else if (b.hasAttribute('data-basket-journal')) void keepInJournal(selected?.id, b.dataset.basketJournal === 'on');
  else if (b.hasAttribute('data-inbox-find')) void findAgain();
  else if (b.hasAttribute('data-basket-big-write')) openBigWriter();
  else if (b.hasAttribute('data-basket-link-open')||b.hasAttribute('data-basket-task-open')) { const id = selected?.id; void manual.open(b.hasAttribute('data-basket-link-open') ? 'link' : 'task', b).then(message => { if (selected?.id === id) detail.querySelector('[data-basket-status]').textContent = message || ''; }); }
  else if (b.hasAttribute('data-basket-cancel')) void finishEdit({anchor:b});
  else if (b.hasAttribute('data-basket-retry')) void refresh();
  else if (b.hasAttribute('data-basket-note-task')) { requestTaskOpen(b.dataset.basketNoteTask, rt); window.KPTURouter.go('tasks', {source:'delegated'}); }
  else if (b.hasAttribute('data-basket-save')) void saveEdit();
  else if (b.hasAttribute('data-basket-upload')) void saveAttachments();
  else if (b.hasAttribute('data-basket-reload')) void reloadDetail(b);
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
    // MTG-프로젝트합치기 ①: 사업영역은 사업영역 관리 창(area-window.js)으로 정리함 위에 연다.
    if (project) await window.KPTUAreaWindow.open({ id: link.project_id });
    else { await window.KPTUViewLoader.load('team'); await window.KPTUWorkplace.open(link.organization_id); }
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
    // A result message already on the list's line (delete, disconnect) stays (renderList does not write that line).
    links = result.links; docs = result.docs; renderList(); if (selected) { paintStateLine(); paintJournalButton(); }
    if (attr && !active.isConnected) (root.querySelector(`[${attr}="${CSS.escape(value)}"]`) || (noteId && root.querySelector(`[data-basket-row="${CSS.escape(noteId)}"]`)) || (selected && detail.querySelector('[data-basket-read-text]')))?.focus({preventScroll:true});
  } catch {}
}
window.addEventListener('kptu:basket-links-changed', rereadLinks);
// ATT-이름고치기: 첨부 이름을 고치면(서버가 Drive 원본·Web2 줄을 함께 바꿈) 들고 있는 노트 값을 고치고 첨부 줄을 다시 그린다.
window.addEventListener('kptu:file-renamed', e => {
  const d = e.detail; if (!d?.drive_file_id) return;
  let hit = false;
  for (const n of notes) if (applyRenamedNote(n, d)) hit = true;
  if (selected && !notes.includes(selected) && applyRenamedNote(selected, d)) hit = true;
  if (hit && selected && root.isConnected && !editing) paintAttachments();
});
window.addEventListener('kptu:documents-changed', rereadLinks);
window.addEventListener('kptu:document-categories-changed', () => { if (root.isConnected) renderList(); });
function openHwpEditor(fileId){
  const file=selected?.attachments?.find(item=>item.drive_file_id===fileId);
  if(!file||editing)return;
  if(!requestHwpEdit({kind:'basket',noteId:selected.id,fileId,fileName:file.file_name},rt)){detail.querySelector('[data-basket-status]').textContent='로그인 정보를 확인하지 못했어요. 다시 시도해 주세요.';return}
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
root.addEventListener('keydown', e => { if (noteHost.contains(e.target)) return; guardOcrPrivacy(); if (e.key === 'Escape' && selected && !busy) { e.preventDefault(); if (noteMenu() && !noteMenu().hidden) setNoteMenu(false, {focus:true}); else if (manual.isOpen()) void manual.cancel({anchor:e.target instanceof Element ? e.target : null}); else void askCloseDetail(e.target instanceof Element ? e.target : null); } });
window.addEventListener('kptu:before-reload', e => {
  // 뒤에서 올리는 중(업데이트·노트 첨부 줄)에도 예전 잠금 때처럼 막는다: 새로 고치면 줄에 선 파일이 알림 없이 사라진다(줄은 메모리뿐).
  if (busy||quick?.isBusy()||noteDocs.isBusy()||attachQueue.any()||noteDocs.isUploading()) e.preventDefault();
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
  if(blockedBusy||(noteDocs.hasDraft()&&!window.confirm('수정하던 노트를 저장하지 않고 다른 화면으로 갈까요?'))||(quick?.hasDraft()&&!window.confirm('저장하지 않은 입력이 있어요. 다른 화면으로 갈까요? 입력은 이 탭에 남아요.'))||(dirty()&&!window.confirm('수정 중인 글을 저장하지 않고 다른 화면으로 갈까요?'))||(!dirty()&&manualDraft()&&!window.confirm('작성 중인 연결·할 일 입력을 삭제하고 다른 화면으로 갈까요?'))){
    e.preventDefault();
  }
});
// FORGET-원문열기·뒤로가기: whether this step enters the 정리함 from another screen (a step inside it, e.g. a source opened on it, is not).
let basketShown=false,basketEntered=false;
window.addEventListener('kptu:view-changed',e=>{
  basketEntered=e.detail?.view==='basket'&&!basketShown;basketShown=e.detail?.view==='basket';
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
  noteDocs.close({focus:false,force:true}); showKind('memo',{address:false});
  // FORGET-원문열기·뒤로가기: coming back by Back (from a source opened on another screen) keeps the list's view and filter as left;
  // the router gives the scroll position back. A step from a menu starts at 처리 전.
  if (basketEntered && detail?.source !== 'popstate') forget.setView('open');
  void forget.refresh(); void refreshFamRemind();
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
// BIZ-저장먼저닫기 2차(S59-10): 새 업데이트의 사진·파일이 뒤에서 다 올라가면(업데이트 큰 창·빠른 입력칸·조직 기록 입력칸) 그 업데이트의
// 목록 줄과 열린 상세의 첨부를 맞춘다([첨부 저장]이 올라간 만큼 그리는 것과 같다). 목록이 아직 도는 중이면 한 번 더 읽는다(staleRead).
window.addEventListener('kptu:update-files-sent',e=>{
  const id=e.detail?.id,list=e.detail?.attachments;if(!id||!Array.isArray(list))return;
  if(loadingRun&&loadingRun===epoch)staleRead=true;
  const row=notes.find(n=>n.id===id);if(row)row.attachments=list;
  if(selected?.id===id){selected.attachments=list;if(upload.note_id===id)upload.attachments=list;}
  if(row||selected?.id===id){renderList();if(selected?.id===id){paintAttachments();pickerFiles?.render();}}
});
renderList(); void refresh();
