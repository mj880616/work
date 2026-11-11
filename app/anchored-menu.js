// D-3e anchored menu: shared history, focus, outside-click replay and positioning.
import {markScrollMore} from './anchored-popup.js';
// actDetached: 메뉴가 열린 동안 화면이 다시 그려져 누른 칸이 바뀌어도 고른 항목을 실행한다(부르는 쪽이 새 칸을 찾는다).
// open(trigger,{at:{x,y}}): 누른 자리(PC 우클릭·Shift+F10) 바로 옆에 둔다. 이때 trigger(날짜 칸·일정 줄)는 메뉴 주인일 뿐이라 그 안을 다시 눌러도 바깥 누름으로 닫힌다(S51-27).
// S51-31 UI-⋯작은메뉴: 폰·폴드·PC 모두 같은 작은 상자. 화면 아래를 덮는 판(옛 sheet)은 없앴다.
// row(trigger): 그 ⋯가 속한 줄. 주면 상자를 그 줄 바로 아래(모자라면 바로 위)에 두어 줄을 가리지 않는다. boxWidth: 상자 폭(기본 200px).
// 아래쪽 끝은 하단바(--kptu-mobile-tab-height)·전환 줄(--kptu-switch-dock) 위라 상자가 아래 바에 가리지 않는다.
export function createAnchoredMenu({id,className,label,historyKey,parent=document.body,key,render,onAction,onClose=()=>{},onOpen=()=>{},canOpen=()=>true,row=()=>null,boxWidth=200,actDetached=false}){
  let active=null,closing=null;
  const panel=document.createElement('div');panel.id=id;panel.className=className;panel.hidden=true;panel.setAttribute('role','group');panel.setAttribute('aria-label',label);
  let popover=typeof panel.showPopover==='function'&&typeof panel.hidePopover==='function'&&'popover' in panel;
  // parent may be a function of the trigger (TASK-바로처리통일: a list inside an open dialog keeps its menu inside that dialog).
  const host=trigger=>typeof parent==='function'?parent(trigger)||document.body:parent;
  if(popover)panel.setAttribute('popover','manual');(typeof parent==='function'?document.body:parent).append(panel);
  panel.addEventListener('click',e=>{const button=e.target.closest('button'),previous=active;if(!button||!previous)return;close(()=>{if(actDetached||previous.trigger.isConnected)onAction(button,previous)});});
function close(then,fromBack=false){
  const previous=active;if(!previous){if(then){if(closing)closing.then(then);else then()}return closing||Promise.resolve()}
  active=null;if(popover)panel.hidePopover();panel.hidden=true;previous.trigger.setAttribute('aria-expanded','false');
  let release;const pending=new Promise(resolve=>{release=resolve});closing=pending;
  const finish=()=>queueMicrotask(()=>{if(closing===pending)closing=null;release();if(then)then();else if(previous.trigger.isConnected)previous.trigger.focus({preventScroll:true});onClose()});
  if(!fromBack&&history.state?.[historyKey]===previous.id){window.addEventListener('popstate',finish,{once:true});history.back()}else finish();return pending;
}
function dock(){const cs=getComputedStyle(document.documentElement),v=n=>parseFloat(cs.getPropertyValue(n))||0;return v('--kptu-mobile-tab-height')+v('--kptu-switch-dock')}
function position(){
  if(!active)return;
  // UI-창잘림·끌어옮기기: the left edge comes from the width the menu was really drawn at (its CSS may make it wider than boxWidth),
  // so a menu opened from a button at the window's right edge is never cut. Menus have no title row and are not dragged.
  const at=active.at,margin=12,gap=at?2:4,vw=document.documentElement.clientWidth||innerWidth,floor=innerHeight-dock()-8;
  const t=at?{top:at.y,bottom:at.y,left:at.x,right:at.x}:active.trigger.getBoundingClientRect();
  let own=!at&&active.row?.isConnected?active.row.getBoundingClientRect():null;if(own&&own.height>160)own=null; // 줄이 아니라 큰 칸이면 ⋯ 자리 그대로
  const rect=own?{top:Math.min(t.top,own.top),bottom:Math.max(t.bottom,own.bottom),left:t.left,right:t.right}:t;
  panel.style.width=Math.min(boxWidth,vw-margin*2)+'px';
  const below=floor-rect.bottom-gap,above=rect.top-gap-margin,down=below>=panel.scrollHeight||below>=above; // UI-메뉴잘림: 아래에 다 들어갈 때만 아래로, 아니면 더 넓은 쪽(끝 항목이 안쪽 스크롤에 숨지 않게)
  panel.style.maxHeight=Math.max(0,down?below:above)+'px';const box=panel.getBoundingClientRect(),width=box.width,height=box.height;
  panel.style.left=Math.max(margin,Math.min(at?rect.left:rect.right-width,vw-width-margin))+'px';
  panel.style.top=Math.max(margin,Math.min(down?rect.bottom+gap:rect.top-gap-height,floor-height))+'px';
  markScrollMore(panel);
}
function open(trigger,{at=null}={}){
  if(trigger.disabled||!canOpen(trigger))return;
  const point=at&&Number.isFinite(at.x)&&Number.isFinite(at.y)?{x:at.x,y:at.y}:null;
  if(closing){closing.then(()=>{if(trigger.isConnected)open(trigger,{at:point})});return}
  if(active){close(active.trigger===trigger&&!point?null:()=>open(trigger,{at:point}));return}
  const id=key(trigger),to=host(trigger);if(panel.parentElement!==to)to.append(panel);active={trigger,id,at:point,row:point?null:row(trigger)||null};
  panel.innerHTML=render(id);
  panel.hidden=false;if(popover){try{panel.showPopover()}catch{popover=false;panel.removeAttribute('popover')}}
  position();trigger.setAttribute('aria-expanded','true');history.pushState({...history.state,[historyKey]:id},'',location.href);onOpen(trigger,panel);panel.querySelector('button')?.focus({preventScroll:true});
}
  document.addEventListener('click',e=>{if((!active&&!closing)||panel.contains(e.target)||(active&&!active.at&&active.trigger.contains(e.target)))return;const target=e.target,forward=new MouseEvent('click',e);e.preventDefault();e.stopImmediatePropagation();close(()=>{if(target.isConnected)target.dispatchEvent(forward)})},true);
  document.addEventListener('keydown',e=>{if(!active)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close()}else if(e.key==='Tab'){const buttons=[...panel.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);e.preventDefault();e.stopImmediatePropagation();buttons[(index+(e.shiftKey?-1:1)+buttons.length)%buttons.length].focus()}},true);
  window.addEventListener('popstate',e=>{if(active&&e.state?.[historyKey]!==active.id)close(null,true)},true);
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true);new ResizeObserver(position).observe(panel);
  // LIB-다시그리기메뉴닫힘: 메뉴 주인(그 목록을 그리는 쪽)이 목록을 다시 그린 직후 부른다. 누른 칸이 떨어졌으면 find(id,옛 칸)가
  // 돌려준 새 칸으로 메뉴를 그대로 옮겨 붙이고(자리·항목 실행이 새 칸을 따름), 새 칸이 없거나 화면에 안 보이면 닫는다.
  function follow(find){
    if(!active||active.trigger.isConnected)return;
    const next=find(active.id,active.trigger);
    if(!next||!next.isConnected||!next.getClientRects().length){close();return}
    moveMenuTrigger(active.trigger,next);active.trigger=next;if(!active.at)active.row=row(next)||null;position();
  }
  return {open,close,follow,get active(){return active}};
}
// 열린 메뉴의 주인을 다시 그려진 새 칸으로 옮긴다: 펼침 표시를 옮기고, PC 우클릭으로 연 메뉴(context-menu.js가 누른 자리에 고정)면 새 칸도 같은 자리에 고정한다.
export function moveMenuTrigger(old,next){
  if(Object.prototype.hasOwnProperty.call(old,'getBoundingClientRect')){const r=old.getBoundingClientRect();window.KPTUContextMenu?.pinAt?.(next,r.left,r.top)}
  next.setAttribute('aria-expanded','true');
}
