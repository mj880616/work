// PRJ-화면다듬기 → UI-기록줄균일(S70-85, 명진 11/26 09:29 "어떤건 위아래로 길고 어떤건 짧아 … 펼치기가 차지하는 공간 때문"):
// 기록 목록(조직 관리 기록·사업 관리 기록) 줄 접기·펼치기 공용 부품 하나. 모양은 base-ui.css '.kptu-clamp'·'.kptu-rec-fold'.
// - 접힌 줄은 본문 두 줄 높이로 고정(한 줄짜리도 같은 높이, 넘치면 말줄임). 따로 줄을 차지하던 [펼치기] 글자 줄은 없다.
// - 잘린 줄(또는 접힌 동안 감춘 것이 있는 줄)만 ⋯ 아래에 작은 꺾쇠(⌄/⌃, 공용 fold-chevron.mjs) — 같은 줄 높이 안. 버튼이라 키보드(Enter·Space)로도 된다.
// - 본문 글자를 누르면 그 자리에서 펼치고, 다시 누르면 접는다(펼칠 것이 있는 줄만 — 없는 줄은 누르면 지금처럼 그 줄을 연다).
// 상태 하나: 본문 글자(el)의 .is-open. 줄 모양(두 줄 높이·펼친 뒤 아래 띠)은 CSS가 그 상태로 정한다. 저장하지 않는다(화면 메모리).
import {chevHtml} from './fold-chevron.mjs';

export const CLAMP_LINES=2;
export const clampCut=el=>!!el&&!el.classList.contains('is-open')&&el.scrollHeight>el.clientHeight+1;
// BUG-미리보기기호: a clamped line is plain letters (marks removed). When the text carries data-md-raw, opening it shows the written
// text as headings and tables (the shared markdown view); closing puts the plain line back. The stored text is never changed.
const plainKids=new WeakMap();
let mdView=null;
const restorePlain=el=>{const kids=plainKids.get(el);if(!kids)return;plainKids.delete(el);if(el.dataset.writtenRaw)el.textContent='';else mdView?.showPlainText(el,'');el.replaceChildren(...kids);};
async function showMarkdown(el){
  if(!el.isConnected)return;
  // EDIT-번호모양보존: a text with no markdown marks opens as written (the line's own text box keeps its line breaks), never read as markdown.
  if(el.dataset.writtenRaw&&!el.dataset.mdRaw){
    if(!el.classList.contains('is-open')){restorePlain(el);return;}
    if(plainKids.has(el))return;
    plainKids.set(el,[...el.childNodes]);el.textContent=el.dataset.writtenRaw;return;
  }
  if(!el.dataset.mdRaw)return;
  if(!el.classList.contains('is-open')){restorePlain(el);return;}
  if(plainKids.has(el))return;
  try{
    mdView=mdView||await import('./markdown-view.js');
    if(!el.classList.contains('is-open')||plainKids.has(el))return;
    plainKids.set(el,[...el.childNodes]);
    const res=await mdView.renderMarkdownInto(el,el.dataset.mdRaw,{isCurrent:()=>el.classList.contains('is-open')});
    if(!res.ok&&!el.classList.contains('md-body'))restorePlain(el);
  }catch{restorePlain(el);}
}

// opts: {row:'줄 선택자', text:'줄 안 본문 글자 선택자', slot:row=>꺾쇠를 넣을 칸(없으면 줄), extra:row=>접힌 동안 감춘 것이 있는지}
// 접힌 동안 감추는 공용 것: 기록 띠의 파일 이름 줄(record-files.js — 사진 작은 그림은 줄 안에 그대로 보인다).
const hiddenFiles=row=>!!row.querySelector('[data-record-files] .record-file, [data-record-files] .record-files-more');
const BTN='data-rec-fold';
const textOf=(row,opts)=>row.querySelector(opts.text);
const btnOf=row=>row.querySelector(`[${BTN}]`);
export function syncRecordFold(host,opts){
  if(!host)return;
  host.querySelectorAll(opts.row).forEach(row=>{
    const el=textOf(row,opts);let btn=btnOf(row);
    if(!el){btn?.remove();row.removeAttribute('data-rec-foldable');return;}
    el.classList.add('kptu-clamp');row.classList.add('kptu-rec-fold');
    const open=el.classList.contains('is-open');
    // RECORD-한줄: data-oneline = 한 줄만 보이는 기록(원문은 data-md-raw·data-written-raw) — 잘리지 않아도 펼치면 원문을 연다.
    const needs=open||clampCut(el)||el.dataset.oneline==='1'||hiddenFiles(row)||!!opts.extra?.(row);
    row.toggleAttribute('data-rec-foldable',needs);row.toggleAttribute('data-rec-open',open);
    if(needs&&!btn){btn=document.createElement('button');btn.type='button';btn.className='kptu-rec-fold-btn';btn.setAttribute(BTN,'');btn.innerHTML=chevHtml();(opts.slot?.(row)||row).append(btn);}
    else if(!needs&&btn){btn.remove();return;}
    if(btn){btn.setAttribute('aria-expanded',String(open));btn.setAttribute('aria-label',open?'접기':'펼치기');}
  });
}
function toggle(host,row,opts){
  const el=textOf(row,opts);if(!el)return;
  el.classList.toggle('is-open');syncRecordFold(host,opts);void showMarkdown(el);
}
// 누름 하나를 본다: 꺾쇠, 또는 펼칠 것이 있는 줄의 본문 글자면 그 줄을 펴고 접은 뒤 true(그 누름은 줄을 열지 않는다).
// 줄이 먼저 누름을 받는 화면(사업 관리 — 문서 단계에서 줄 열기를 본다)은 그 처리 맨 앞에서 부른다. 나머지는 bindRecordFold가 부른다.
export function foldClick(e,host,opts){
  if(!host)return false;
  const btn=e.target.closest?.(`[${BTN}]`);
  if(btn&&host.contains(btn)){const row=btn.closest(opts.row);if(!row)return false;e.preventDefault();e.stopImmediatePropagation();toggle(host,row,opts);return true;}
  const el=e.target.closest?.(opts.text);if(!el||!host.contains(el))return false;
  const row=el.closest(opts.row);if(!row||!btnOf(row)||e.button>0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return false;
  // 펼친 글 안의 진짜 링크(마크다운)는 그대로 열리고, 글자를 끌어 고른 뒤의 누름은 접지 않는다.
  const a=e.target.closest('a[href]');if(a&&el.contains(a))return false;
  if(String(globalThis.getSelection?.()||'').trim()&&el.classList.contains('is-open'))return false;
  e.preventDefault();e.stopImmediatePropagation();toggle(host,row,opts);return true;
}
// click:false = 그 화면이 누름을 먼저 받아 foldClick을 직접 부른다(사업 관리). 폭이 바뀌거나 접힌 묶음을 펴면 다시 잰다.
export function bindRecordFold(host,opts,{click=true}={}){
  if(!host||host.dataset.recFoldBound==='1')return;host.dataset.recFoldBound='1';
  if(click)host.addEventListener('click',e=>{foldClick(e,host,opts);},true);
  // 접힌 '지난 기록 n'을 펴면 그 안 줄도 잘렸는지 다시 잰다(접혀 있는 동안은 높이가 없어 잴 수 없다).
  host.addEventListener('toggle',e=>{if(e.target instanceof HTMLDetailsElement&&e.target.open)syncRecordFold(host,opts)},true);
  if(typeof ResizeObserver==='function'){let w=host.clientWidth;new ResizeObserver(()=>{if(host.clientWidth!==w){w=host.clientWidth;syncRecordFold(host,opts)}}).observe(host)}
}
