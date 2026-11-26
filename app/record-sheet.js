import {emptyHtml} from './wait-state.js';
// UI-모바일업데이트겹쳐보기: on a phone (760px or less) tapping a linked note in project or organization
// detail does not leave the screen. The record comes up as a card (sheet) over the detail; ✕, a tap outside the card, swiping
// the card's top down, Esc and the phone's back button close it, and the detail stays where it was (nothing under it changes).
// The sheet is a .modal, so mobile-modal-history.js gives it its one history entry (back closes it first, BUG-뒤로가기).
// [노트 열기] closes the sheet and then hands over to the screen's existing full open (the PC behaviour).
// It only shows what the detail already read (readLinkRecords: summary, original text, date); it reads and writes nothing.
import {formatSeoulTime} from './meeting-time.js';
import {noteMark,recordText,isNoteRecord,shownRecord} from './basket-link-records.js';
import {markdownSource} from './note-preview.mjs';
import {partStyles} from './part-styles.js';
// S67-41: 이 부품의 모양 파일(part-styles.js 표)을 부품이 열리기 전에 붙인다 — 화면 모양 목록에 없어도 꾸밈 없이 그려지지 않게.
await partStyles('record-sheet');

const ID='kptuRecordSheet';
const phone=()=>typeof window.matchMedia==='function'&&window.matchMedia('(max-width:760px)').matches;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null;

export const recordSheetWanted=()=>phone();
export const recordSheetOpen=()=>!!state;

function install(){
  let sheet=document.getElementById(ID);
  if(!sheet){
    sheet=document.createElement('div');sheet.id=ID;sheet.className='modal record-sheet hidden';
    sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');sheet.setAttribute('aria-hidden','true');sheet.setAttribute('aria-labelledby',ID+'Title');
    sheet.innerHTML=`<div class="modal-card record-sheet-card" data-record-sheet-card><div class="record-sheet-head" data-record-sheet-grab><span class="record-sheet-grip" aria-hidden="true"></span><div class="record-sheet-titlebar"><h2 id="${ID}Title" data-record-sheet-title></h2><button type="button" class="icon-btn record-sheet-close" data-record-sheet-close aria-label="닫기">×</button></div><small data-record-sheet-meta></small></div><div class="record-sheet-body" data-record-sheet-body></div><div class="record-sheet-foot"><button type="button" class="secondary" data-record-sheet-full></button></div></div>`;
    sheet.addEventListener('click',onClick);sheet.addEventListener('keydown',onKey);
    const grab=sheet.querySelector('[data-record-sheet-grab]');
    grab.addEventListener('pointerdown',onDown);grab.addEventListener('pointermove',onMove);grab.addEventListener('pointerup',onUp);grab.addEventListener('pointercancel',onCancel);
    // Closed from outside (the shared back handling hides it directly): finish here.
    new MutationObserver(()=>{if(state&&sheet.classList.contains('hidden'))finish()}).observe(sheet,{attributes:true,attributeFilter:['class']});
  }
  // Last in the document so it sits over the detail it was opened from (same z-index, later wins) and back closes it first.
  if(!sheet.isConnected||sheet.nextElementSibling)document.body.append(sheet);
  return sheet;
}

// row: a readLinkRecords row. place: the project or organization name. trigger: the tapped line (focus returns there).
// onOpenFull: the existing full open (basket note or note view), run once the sheet's history entry is gone.
// S71-57 RECORD-잊지말기연결표시삭제: 노트가 아닌 기록은 제목 '기록'·표시 아이콘 없음·머리말에 출처 표시 없음(잊지 말기에서 왔어도 같다).
// RECORD-한줄: title·meta·summaryLabel = 조직 기록 [원문 보기](record-raw-view.js)처럼 연결 기록이 아닌 글을 같은 창으로 볼 때(표시 아이콘 없음).
// S69-95 NOTE-메모넓히기: memo = {type,id,title}이면 글 아래에 같은 메모 칸(memo-thread.js)을 붙인다(자료실 자료 창·담당조직 기록 창).
// 글이 비었고 메모 칸이 있으면 '없음' 대신 글 칸을 뺀다. fullLabel = 아래 [열기] 단추 글자(주면 그 글자, 없으면 기록 종류에 따른 옛 글자).
let memoThread=null;
export function openRecordSheet({row,place='',trigger=null,onOpenFull=null,title:ownTitle=null,meta=null,summaryLabel='기록 요약',memo=null,fullLabel=null}={}){
  if(!row)return false;
  row=shownRecord(row); // S69 보드잠금가림 전수: 잠긴 폴더 노트면 제목·요약·원문 대신 '잠김'만
  const sheet=install();if(state)close({focus:false,immediate:true});
  const note=isNoteRecord(row),summary=recordText(row)||'',raw=String(row.raw_text??''),title=note&&String(row.title||'').trim()?row.title:(note?'노트':'기록');
  const date=Number.isFinite(Date.parse(row.occurred_at))?formatSeoulTime(row.occurred_at,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric'}):'';
  sheet.querySelector('[data-record-sheet-title]').innerHTML=ownTitle!=null?`<span>${escape(ownTitle)}</span>`:(note?`${noteMark('record-sheet-mark')} <span>${escape(title)}</span>`:`<span>${escape(title)}</span>`);
  sheet.querySelector('[data-record-sheet-meta]').textContent=meta!=null?meta:[note?'노트 연결':'',date,place].filter(Boolean).join(' · ');
  const showSummary=row.summary!=null&&String(row.summary).trim()&&String(row.summary).trim()!==raw.trim();
  sheet.querySelector('[data-record-sheet-body]').innerHTML=`${showSummary?`<p class="record-sheet-summary"><b>${escape(summaryLabel)}</b> ${escape(summary)}</p>`:''}${memo&&!raw.trim()?'':`<div class="record-sheet-text" data-record-sheet-text>${raw.trim()?escape(raw):emptyHtml()}</div>`}${memo?'<section class="memo-th record-sheet-memos" data-record-sheet-memos aria-label="메모"></section>':''}`;
  // BUG-미리보기기호: the opened sheet shows the written text as headings and tables (the plain text stays until the view is ready).
  const textBox=sheet.querySelector('[data-record-sheet-text]');
  if(textBox&&raw.trim()&&markdownSource(raw))import('./markdown-view.js').then(view=>view.renderMarkdownInto(textBox,raw,{isCurrent:()=>state?.row===row})).catch(()=>{});
  const full=sheet.querySelector('[data-record-sheet-full]');full.textContent=fullLabel||(note?'노트 열기':'열기');full.hidden=typeof onOpenFull!=='function';full.closest('.record-sheet-foot').hidden=full.hidden; // 여는 곳이 없으면(RECORD-한줄 [원문 보기]) 아래 줄째 감춘다(record-sheet.css [hidden])
  state={row,trigger,onOpenFull,drag:null};
  const card=sheet.querySelector('[data-record-sheet-card]');card.style.transform='';card.scrollTop=0;
  sheet.classList.remove('hidden');sheet.setAttribute('aria-hidden','false');
  sheet.querySelector('[data-record-sheet-close]').focus({preventScroll:true});
  if(memo){const host=sheet.querySelector('[data-record-sheet-memos]'),mine=state;void import('./memo-thread.js').then(m=>{if(state!==mine||!host.isConnected)return;memoThread||=m.createMemoThread();memoThread.attach(host,memo)}).catch(()=>{if(host.isConnected)host.textContent='메모를 읽지 못했어요.'})}
  return true;
}

function finish(){
  const sheet=document.getElementById(ID),s=state;state=null;if(!sheet||!s)return s;
  memoThread?.detach();
  sheet.classList.add('hidden');sheet.setAttribute('aria-hidden','true');
  const card=sheet.querySelector('[data-record-sheet-card]');if(card){card.style.transform='';card.classList.remove('dragging')}
  if(s.focus!==false&&s.trigger?.isConnected)s.trigger.focus({preventScroll:true});
  return s;
}
// then: runs after the sheet's history entry (if any) has been popped, so the next step starts from the detail's own entry.
export function closeRecordSheet({focus=true,then=null,immediate=false}={}){return close({focus,then,immediate})}
function close({focus=true,then=null}={}){
  const sheet=document.getElementById(ID);if(!state||!sheet){then?.();return}
  state.focus=focus;
  const waitBack=sheet.dataset.kptuHistoryOpen==='1'&&history.state?.kptuOverlay===ID;
  if(then&&waitBack)window.addEventListener('popstate',()=>queueMicrotask(then),{once:true});
  finish();
  if(then&&!waitBack)then();
}

function onClick(e){
  const sheet=e.currentTarget;
  if(e.target===sheet){close();return}
  if(e.target.closest('[data-record-sheet-close]')){close();return}
  if(e.target.closest('[data-record-sheet-full]')){const go=state?.onOpenFull;close({focus:false,then:go?()=>go():null})}
}
function onKey(e){
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return}
  if(e.key!=='Tab')return;
  const items=[...e.currentTarget.querySelectorAll('button:not([hidden]):not([disabled]),a[href],textarea:not([disabled])')].filter(el=>el.getClientRects().length);
  if(!items.length)return;e.stopPropagation();
  const first=items[0],last=items[items.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
}
// Swipe down on the card's top (grip, title, date) to close. Short pulls snap back.
const CLOSE_PULL=80;
function card(){return document.querySelector(`#${ID} [data-record-sheet-card]`)}
function onDown(e){if(!state||e.button>0||e.target.closest('button'))return;state.drag={id:e.pointerId,y:e.clientY,dy:0,t:performance.now()};try{e.currentTarget.setPointerCapture(e.pointerId)}catch{}card()?.classList.add('dragging')}
function onMove(e){const d=state?.drag;if(!d||d.id!==e.pointerId)return;d.dy=Math.max(0,e.clientY-d.y);const c=card();if(c)c.style.transform=d.dy?`translateY(${d.dy}px)`:''}
function onUp(e){const d=state?.drag;if(!d||d.id!==e.pointerId)return;state.drag=null;const c=card();c?.classList.remove('dragging');const fast=d.dy>40&&d.dy/(Math.max(1,performance.now()-d.t))>0.6;if(d.dy>=CLOSE_PULL||fast){close();return}if(c)c.style.transform=''}
function onCancel(e){const d=state?.drag;if(!d||d.id!==e.pointerId)return;state.drag=null;const c=card();if(c){c.classList.remove('dragging');c.style.transform=''}}

// The detail under the sheet is gone (another tab, sign-out): the sheet goes with it.
window.addEventListener('kptu:view-changed',()=>{if(state)close({focus:false})});
window.addEventListener('kptu:session-changed',()=>{if(state)close({focus:false})});
