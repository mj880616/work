// D-3e anchored menu: shared history, focus, outside-click replay and positioning.
import {markScrollMore} from './anchored-popup.js';
export function createAnchoredMenu({id,className,label,historyKey,parent=document.body,key,render,onAction,onClose=()=>{},canOpen=()=>true}){
  let active=null,closing=null;
  const panel=document.createElement('div');panel.id=id;panel.className=className;panel.hidden=true;panel.setAttribute('role','group');panel.setAttribute('aria-label',label);
  let popover=typeof panel.showPopover==='function'&&typeof panel.hidePopover==='function'&&'popover' in panel;
  // parent may be a function of the trigger (TASK-바로처리통일: a list inside an open dialog keeps its menu inside that dialog).
  const host=trigger=>typeof parent==='function'?parent(trigger)||document.body:parent;
  if(popover)panel.setAttribute('popover','manual');(typeof parent==='function'?document.body:parent).append(panel);
  panel.addEventListener('click',e=>{const button=e.target.closest('button'),previous=active;if(!button||!previous)return;close(()=>{if(previous.trigger.isConnected)onAction(button,previous)});});
function close(then,fromBack=false){
  const previous=active;if(!previous){if(then){if(closing)closing.then(then);else then()}return closing||Promise.resolve()}
  active=null;if(popover)panel.hidePopover();panel.hidden=true;previous.trigger.setAttribute('aria-expanded','false');
  let release;const pending=new Promise(resolve=>{release=resolve});closing=pending;
  const finish=()=>queueMicrotask(()=>{if(closing===pending)closing=null;release();if(then)then();else if(previous.trigger.isConnected)previous.trigger.focus({preventScroll:true});onClose()});
  if(!fromBack&&history.state?.[historyKey]===previous.id){window.addEventListener('popstate',finish,{once:true});history.back()}else finish();return pending;
}
function position(){
  if(!active)return;
  // UI-창잘림·끌어옮기기: the left edge comes from the width the menu was really drawn at (its CSS may make it wider than 200px),
  // so a menu opened from a button at the window's right edge is never cut. Menus have no title row and are not dragged.
  const rect=active.trigger.getBoundingClientRect(),margin=12,gap=8,vw=document.documentElement.clientWidth||innerWidth;
  panel.style.width=Math.min(200,vw-margin*2)+'px';
  const below=innerHeight-rect.bottom-gap-margin,above=rect.top-gap-margin,down=below>=panel.scrollHeight||below>=above; // UI-메뉴잘림: 아래에 다 들어갈 때만 아래로, 아니면 더 넓은 쪽(끝 항목이 안쪽 스크롤에 숨지 않게)
  panel.style.maxHeight=Math.max(0,down?below:above)+'px';const box=panel.getBoundingClientRect(),width=box.width,height=box.height;
  panel.style.left=Math.max(margin,Math.min(rect.right-width,vw-width-margin))+'px';
  panel.style.top=Math.max(margin,Math.min(down?rect.bottom+gap:rect.top-gap-height,innerHeight-height-margin))+'px';
  markScrollMore(panel);
}
function open(trigger){
  if(trigger.disabled||!canOpen(trigger))return;
  if(closing){closing.then(()=>{if(trigger.isConnected)open(trigger)});return}
  if(active){close(active.trigger===trigger?null:()=>open(trigger));return}
  const id=key(trigger),to=host(trigger);if(panel.parentElement!==to)to.append(panel);active={trigger,id};
  panel.innerHTML=render(id);
  panel.hidden=false;if(popover){try{panel.showPopover()}catch{popover=false;panel.removeAttribute('popover')}}
  position();trigger.setAttribute('aria-expanded','true');history.pushState({...history.state,[historyKey]:id},'',location.href);panel.querySelector('button')?.focus({preventScroll:true});
}
  document.addEventListener('click',e=>{if((!active&&!closing)||panel.contains(e.target)||active?.trigger.contains(e.target))return;const target=e.target,forward=new MouseEvent('click',e);e.preventDefault();e.stopImmediatePropagation();close(()=>{if(target.isConnected)target.dispatchEvent(forward)})},true);
  document.addEventListener('keydown',e=>{if(!active)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close()}else if(e.key==='Tab'){const buttons=[...panel.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);e.preventDefault();e.stopImmediatePropagation();buttons[(index+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus()}},true);
  window.addEventListener('popstate',e=>{if(active&&e.state?.[historyKey]!==active.id)close(null,true)},true);
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true);new ResizeObserver(position).observe(panel);
  return {open,close,get active(){return active}};
}
