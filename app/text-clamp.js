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
    el.classList.toggle('is-open');syncMoreToggle(host,selector);
  });
  if(typeof ResizeObserver==='function'){let w=host.clientWidth;new ResizeObserver(()=>{if(host.clientWidth!==w){w=host.clientWidth;syncMoreToggle(host,selector)}}).observe(host)}
}
