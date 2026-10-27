// PRJ-화면다듬기: the one 4-line text clamp for record lists (project progress, organization records).
// CSS lives in base-ui.css (.kptu-clamp). Two ways to open a clamped text, one rule: only the clamped text itself opens.
//  - tapExpand(e,root): the text is inside a tappable row (project progress); the first tap on a cut text opens it and is not
//    passed on, any later tap behaves as before.
//  - syncMoreToggle(host,selector): a [더보기]/[접기] button under each cut text (organization records); opens only that record.
export const CLAMP_LINES=4;
export const clampCut=el=>!!el&&!el.classList.contains('is-open')&&el.scrollHeight>el.clientHeight+1;
export function tapExpand(e,root){
  const el=e.target.closest?.(root);if(!el||!clampCut(el))return false;
  e.preventDefault();e.stopImmediatePropagation();el.classList.add('is-open');return true;
}
const owners=new WeakMap();
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
export function syncMoreToggle(host,selector){
  if(!host)return;
  host.querySelectorAll(selector).forEach(el=>{
    el.classList.add('kptu-clamp');
    const anchor=el.closest('.basket-link-line')||el,next=anchor.nextElementSibling;
    let btn=next?.classList.contains('kptu-clamp-more')?next:null;
    const needs=clampCut(el)||el.classList.contains('is-open');
    if(needs&&!btn){btn=document.createElement('button');btn.type='button';btn.className='kptu-clamp-more';owners.set(btn,el);anchor.after(btn)}
    else if(!needs&&btn){btn.remove();return}
    if(btn){const open=el.classList.contains('is-open');btn.textContent=open?'접기':'더보기';btn.setAttribute('aria-expanded',String(open))}
  });
}
export function bindMoreToggle(host,selector){
  if(!host||host.dataset.clampBound==='1')return;host.dataset.clampBound='1';
  host.addEventListener('click',e=>{
    const btn=e.target.closest?.('.kptu-clamp-more');if(!btn||!host.contains(btn))return;
    e.preventDefault();e.stopPropagation();
    const el=owners.get(btn);if(!el?.isConnected)return;
    el.classList.toggle('is-open');syncMoreToggle(host,selector);void showMarkdown(el);
  });
  if(typeof ResizeObserver==='function'){let w=host.clientWidth;new ResizeObserver(()=>{if(host.clientWidth!==w){w=host.clientWidth;syncMoreToggle(host,selector)}}).observe(host)}
}
