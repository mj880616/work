// UI-PC팝업위치: on a wide screen (761px~) a small popup opens right below the button that was pressed (above it when there is
// no room below, beside it when neither has room) instead of rising from the bottom of the screen. Phones keep their bottom
// sheets; callers decide with isWide(). S54-04 UI-고르기창버튼아래(11/08 명진 결정 B): the shared folder/media picker
// (library-move-picker.js) opened from a button (place 'below') uses placeAnchored on phones too, with bottomInset = the
// bottom bars and keyboard, so it opens right under the pressed button and never covers the bottom tabs. Used by the shared choice sheet (choice-sheet.js); a ⋯ menu or any other small popup
// can use the same two calls: placeAnchored() for the position and followAnchor() to keep it there while the page moves.
import {dragStartOk,passedSlop,movedSpot} from './drag-move-model.mjs';
export const WIDE_QUERY='(min-width:761px)';
export const isWide=()=>window.matchMedia(WIDE_QUERY).matches;
// S54-04·S54-05: 아래 바(하단바·전환 줄)와 자판이 창 아래를 덮는 높이(px). 버튼 아래 창은 그 위에서 끝난다(placeAnchored의 bottomInset).
// S61-8 UI-고르기창넣기안보임: 하단바는 실제로 '48px + 시스템 바 자리(env(safe-area-inset-bottom))'만큼 덮는데(topbar-actions.css) 옛 값은 시스템 바 자리를
// 빼먹어, 화면 끝까지 그리는 폰(삼성 인터넷·크롬, 제스처 줄)에서 창 아래 끝([넣기]·[취소] 줄)이 하단바·시스템 바 밑으로 내려갔다.
// 그래서 ① 하단바 몫 = max(변수 + 시스템 바 자리, 보이는 하단바가 실제로 덮는 높이) ② 하단바가 숨은 때(쓰기 창·자판)도 시스템 바 자리는 늘 뺀다
// ③ 자판 몫 = max(--kptu-keyboard-inset, 화면 확대 없이 visualViewport가 창 아래를 가린 높이). 모든 버튼 아래 창(고르기 창·옮기기 창·⋯ 메뉴)이 이 한 값을 쓴다.
export function safeBottom(){
  const root=document.documentElement;
  // env()는 사용자 지정 속성에 넣으면 계산값에서 px로 풀린다(자판 높이 --kptu-keyboard-inset처럼 html 인라인 속성, 화면 상태만·저장 없음).
  if(!root.style.getPropertyValue('--kptu-safe-bottom'))root.style.setProperty('--kptu-safe-bottom','env(safe-area-inset-bottom, 0px)');
  return Math.max(0,parseFloat(getComputedStyle(root).getPropertyValue('--kptu-safe-bottom'))||0);
}
// S67-54 UI-자판이름칸가림: 자판이 창 아래를 덮는 높이만(px). 화면 높이가 자판만큼 줄어드는 곳(폰 앱 adjustResize·interactive-widget=resizes-content)에서는 0,
// 화면 위만 덮는 곳(보이는 화면 visualViewport만 줄어듦)에서는 그 높이. 화면 확대 중에는 0(손가락 확대를 자판으로 보지 않는다).
export function keyboardCover(){
  const v=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kptu-keyboard-inset'))||0;
  const vv=window.visualViewport,cover=vv&&Math.abs((vv.scale||1)-1)<0.01?Math.max(0,window.innerHeight-(vv.offsetTop+vv.height)):0;
  return Math.max(0,v,cover);
}
export function bottomInset(){
  const cs=getComputedStyle(document.documentElement),v=n=>parseFloat(cs.getPropertyValue(n))||0,vh=window.innerHeight;
  const tabs=document.querySelector('nav.mobile-tabs'),tr=tabs&&getComputedStyle(tabs).display!=='none'&&getComputedStyle(tabs).position==='fixed'?tabs.getBoundingClientRect():null;
  const bar=Math.max(v('--kptu-mobile-tab-height')+safeBottom(),tr&&tr.height&&tr.top<vh?vh-tr.top:0);
  return bar+v('--kptu-switch-dock')+keyboardCover();
}
// S67-54: 보이는 화면이 바뀔 때(창 크기·자판이 열리고 닫힘·보이는 화면 이동) 다음 그림 차례에 한 번 fn()을 부른다. 자판은 칸에 초점이 간 뒤에
// 올라오므로, 칸이 든 떠 있는 창은 이것으로 자리를 다시 잡는다(시간 맞춘 덧그리기 없이). 반환: 그만 듣기 stop().
export function onViewportChange(fn){
  let frame=0;const vv=window.visualViewport;
  const queue=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;fn();});};
  window.addEventListener('resize',queue);vv?.addEventListener('resize',queue);vv?.addEventListener('scroll',queue);
  return ()=>{if(frame)cancelAnimationFrame(frame);frame=0;window.removeEventListener('resize',queue);vv?.removeEventListener('resize',queue);vv?.removeEventListener('scroll',queue);};
}
const anchorable=anchor=>typeof anchor?.getBoundingClientRect==='function';

// Sets the panel's inline position (position:fixed is the caller's CSS) from the anchor's box and returns the side it took
// ('below' | 'above' | 'side'), or '' when the anchor cannot be measured. The panel never leaves the window (edge px margin)
// and never grows past maxHeight; its own content scrolls inside.
// beside:'up' (UI-자주가는링크, a sidebar row): open to the right of the anchor and grow upward, the panel's bottom edge on the
// anchor's bottom edge ('beside-up'); when the window above is too short, the panel slides down only as far as the window allows.
// UI-창잘림·끌어옮기기: after placing, the box the panel was really drawn at (its CSS may make it wider or taller than asked) is
// measured and pushed back inside the window, so no popup is cut at the right or bottom edge. A wider popup asks for it here
// (maxWidth), never with its own CSS min-width. bottomInset: px at the bottom of the window the panel must stay above
// (phone bottom tabs, switch row, keyboard); 0 = the whole window. A panel the user dragged by its title (dragByTitle) keeps its spot: it is only
// kept inside the window (a resize, a new width or height), never moved back to the anchor until it closes (clearAnchored).
export function placeAnchored(panel,anchor,{maxWidth=360,maxHeight=480,gap=4,edge=8,minHeight=160,beside='',bottomInset=0}={}){
  if(!anchorable(anchor))return '';
  // S67-54: 폰에서는 부른 쪽이 아래 여백을 주지 않았어도 자판이 덮는 높이만큼은 늘 비운다(자판 위에서 창이 끝난다). PC는 그대로.
  bottomInset=Math.max(0,bottomInset||0,isWide()?0:keyboardCover());
  const inset=bottomInset,vw=document.documentElement.clientWidth,vh=window.innerHeight-inset,width=Math.min(maxWidth,vw-edge*2);
  if(panel.dataset.anchorMoved&&panel.dataset.anchorSide){
    Object.assign(panel.style,{width:width+'px',maxHeight:Math.max(0,Math.min(maxHeight,vh-edge*2))+'px'});
    keepInside(panel,edge,bottomInset);
    return panel.dataset.anchorSide;
  }
  const t=anchor.getBoundingClientRect(),below=vh-t.bottom-gap-edge,above=t.top-gap-edge;
  let side,left,top='auto',bottom='auto',height;
  if(beside==='up'){
    side='beside-up';
    left=vw-t.right-gap-edge>=width?t.right+gap:Math.max(edge,vw-width-edge);
    height=Math.min(maxHeight,vh-edge*2);
    // Bottom on the anchor's bottom, but never below the window and never so low that the panel's top leaves the window.
    const want=Math.min(vh-edge,Math.max(t.bottom,edge+Math.min(height,panel.scrollHeight||height)));
    bottom=inset+Math.max(edge,vh-want)+'px'; // CSS bottom은 진짜 창 아래 끝에서 잰다
  }else if(Math.max(below,above)>=minHeight){
    side=below>=Math.min(maxHeight,above)?'below':'above';
    // UI-메뉴잘림: 고른 쪽에 내용이 다 들어가지 않는데 반대쪽에는 다 들어가면 반대쪽으로(⋯ 메뉴 끝 항목이 안쪽 스크롤에 숨지 않게).
    // 테두리 두께까지(box-sizing:border-box에서 max-height는 테두리를 포함한다).
    const want=panel.scrollHeight?Math.min(maxHeight,Math.ceil(panel.scrollHeight+Math.max(0,panel.offsetHeight-panel.clientHeight))):0;
    if(want&&side==='below'&&below<want&&above>=want)side='above';else if(want&&side==='above'&&above<want&&below>=want)side='below';
    left=Math.max(edge,Math.min(t.left,vw-width-edge));
    height=Math.min(maxHeight,side==='below'?below:above);
    if(side==='below')top=t.bottom+gap+'px';else bottom=inset+vh-t.top+gap+'px';
    // UI-메뉴잘림: 위·아래 어느 쪽에도 다 들어가지 않지만 창에는 다 들어가면, 창 안으로 밀어 올려(누른 줄 위에 조금 겹쳐) 끝 항목까지 다 보인다.
    if(want&&height<want&&want<=vh-edge*2){height=want;top=Math.max(edge,Math.min(t.bottom+gap,vh-edge-want))+'px';bottom='auto';side='below';}
  }else{
    // Neither below nor above has room (a button near the middle of a short window): open beside it, right side first.
    side='side';
    const right=vw-t.right-gap-edge;
    left=right>=width?t.right+gap:t.left-gap-edge>=width?t.left-gap-width:Math.max(edge,vw-width-edge);
    const y=Math.max(edge,Math.min(t.top,vh-edge-minHeight));
    top=y+'px';height=Math.min(maxHeight,vh-y-edge);
  }
  Object.assign(panel.style,{inset:'auto',margin:'0',width:width+'px',left:left+'px',top,bottom,maxHeight:Math.max(0,height)+'px'});
  panel.dataset.anchorSide=side;
  markScrollMore(panel);
  keepInside(panel,edge,bottomInset);
  return side;
}
// UI-메뉴잘림(2026-10-30): 창이 정말 내용보다 짧아 안쪽이 스크롤될 때만 아래 끝을 흐리게 해 '더 있음'을 보인다(data-scroll-below, base-ui.css).
// 끝까지 내리면 흐림이 사라진다. 다른 고정 판(⋯ 메뉴·우클릭 메뉴)도 같은 표시를 부를 수 있다. 화면 상태만, 저장 없음.
export function markScrollMore(panel){
  if(!panel)return;
  const paint=()=>{const more=panel.scrollHeight-panel.clientHeight>1&&panel.scrollTop+panel.clientHeight<panel.scrollHeight-1;if(more)panel.dataset.scrollBelow='1';else delete panel.dataset.scrollBelow;};
  if(!panel.dataset.scrollBelowBound){panel.dataset.scrollBelowBound='1';panel.addEventListener('scroll',paint,{passive:true});}
  paint();
}
const clamp=(value,min,max)=>Math.max(min,Math.min(value,max));
// Moves a fixed panel back inside the window by the box it was really drawn at (a hidden panel, 0×0, is left alone).
export function keepInside(panel,edge=8,bottomInset=0){
  const r=panel.getBoundingClientRect();if(!r.width&&!r.height)return;
  const vw=document.documentElement.clientWidth,vh=window.innerHeight-Math.max(0,bottomInset||0);
  if(r.left<edge||r.right>vw-edge)panel.style.left=clamp(r.left,edge,vw-edge-r.width)+'px';
  if(r.top<edge||r.bottom>vh-edge)Object.assign(panel.style,{top:clamp(r.top,edge,vh-edge-r.height)+'px',bottom:'auto'});
}
export function clearAnchored(panel){
  for(const key of ['inset','margin','width','left','top','bottom','maxHeight'])panel.style[key]='';
  if(!panel.getAttribute('style'))panel.removeAttribute('style');
  delete panel.dataset.anchorSide;delete panel.dataset.anchorMoved;delete panel.dataset.scrollBelow;panel.classList.remove('anchored-dragging');
}

// UI-창잘림·끌어옮기기: on a wide screen an anchored popup with a title row (selector, inside the panel) can be dragged by that
// row; buttons, links and boxes in the row still work as before. The panel never leaves the window. Once moved it stays where
// it was put while the page scrolls (followAnchor no longer follows the button) and is forgotten on close (clearAnchored); the
// spot is not kept anywhere. Phones (bottom sheets, no data-anchor-side) are left alone. Popups with no title row (⋯ menus) are
// not dragged, so a press on a menu line never turns into a drag. Call once per panel; the row may be redrawn.
// S70-12 UI-확인창끌기: 작은 확인창(small-notice.js askPanel)도 이 부품을 쓴다 — selector가 판 자체('.kptu-ask')라 빈 곳(글·여백) 어디서나 끈다.
// mouseOnly = 마우스 왼쪽 단추만(손가락은 지금처럼 그 자리). 끄는 동안은 글자가 골라지지 않는다(이미 골라진 것도 지운다). 계산은 drag-move-model.mjs.
export function dragByTitle(panel,selector,{edge=8,mouseOnly=false}={}){
  let drag=null;
  const doc=panel.ownerDocument||document;
  const noSelect=e=>{if(drag?.moved)e.preventDefault()};
  panel.addEventListener('pointerdown',e=>{
    if(!isWide()||!panel.dataset.anchorSide)return;
    const target=e.target instanceof Element?e.target:null;
    if(!dragStartOk({button:e.button,pointerType:e.pointerType,target},{mouseOnly}))return;
    const handle=target.closest(selector);
    if(!handle||!panel.contains(handle))return;
    const r=panel.getBoundingClientRect();
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top,moved:false,handle};
    try{handle.setPointerCapture(e.pointerId);}catch{}
  });
  panel.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.moved&&!passedSlop(dx,dy))return;
    if(!drag.moved){
      drag.moved=true;panel.dataset.anchorMoved='1';panel.classList.add('anchored-dragging');
      doc.documentElement.classList.add('anchored-drag-active');doc.addEventListener('selectstart',noSelect,true);
    }
    e.preventDefault();
    doc.getSelection?.()?.removeAllRanges();
    const r=panel.getBoundingClientRect();
    const spot=movedSpot({left:drag.left,top:drag.top,dx,dy,width:r.width,height:r.height,vw:doc.documentElement.clientWidth,vh:window.innerHeight,edge});
    Object.assign(panel.style,{left:spot.left+'px',top:spot.top+'px',bottom:'auto'});
  });
  const end=e=>{
    if(!drag||e.pointerId!==drag.id)return;
    try{drag.handle.releasePointerCapture(e.pointerId);}catch{}
    if(drag.moved){doc.getSelection?.()?.removeAllRanges();doc.documentElement.classList.remove('anchored-drag-active');doc.removeEventListener('selectstart',noSelect,true);}
    panel.classList.remove('anchored-dragging');drag=null;
  };
  panel.addEventListener('pointerup',end);panel.addEventListener('pointercancel',end);
}

// Keeps an open anchored popup with its anchor: a window resize or any scroll outside the popup calls place() again on the
// next frame; when the anchor is gone (removed, hidden, or scrolled fully out of the window) lost() is called instead, and
// the caller closes the popup. A popup the user dragged (data-anchor-moved) no longer follows the anchor: a scroll leaves it
// where it is and a resize only keeps it inside the window. Returns stop(), to call when the popup closes.
export function followAnchor(panel,anchor,{place,lost}){
  let frame=0;
  const check=()=>{
    frame=0;
    if(panel.dataset.anchorMoved){place();return;}
    if(!anchorable(anchor)||('isConnected' in anchor&&!anchor.isConnected)){lost();return;}
    const r=anchor.getBoundingClientRect();
    if(!r.width&&!r.height||r.bottom<0||r.top>window.innerHeight||r.right<0||r.left>document.documentElement.clientWidth){lost();return;}
    place();
  };
  const queue=e=>{if(e?.type==='scroll'&&(panel.dataset.anchorMoved||e.target instanceof Node&&panel.contains(e.target)))return;if(!frame)frame=requestAnimationFrame(check);};
  // S67-54: 화면 위만 덮는 자판은 창 크기(resize)를 바꾸지 않는다 — 보이는 화면(visualViewport)이 바뀔 때도 다시 잡는다.
  const stopView=onViewportChange(()=>{if(!frame)check();});
  window.addEventListener('scroll',queue,{capture:true,passive:true});
  return ()=>{if(frame)cancelAnimationFrame(frame);frame=0;stopView();window.removeEventListener('scroll',queue,{capture:true});};
}

// S69-13 UI-확인창누른자리: 작은 확인창(small-notice askPanel)이 기준으로 받은 칸이 쓸 수 없을 때(⋯ 메뉴 항목을 누르면 메뉴가 닫히며
// 그 항목이 숨고 초점이 body로 가서, 기준이 body·숨은 칸·떨어진 칸이 된다) 화면 오른쪽 위 구석에 뜨던 것을 고친다.
// 사람이 마지막으로 누른 칸(누를 때 잰 자리)을 기억했다가 그 옆에 띄운다. ⋯ 메뉴 항목이면 그 메뉴를 연 ⋯ 단추(우클릭이면 누른 점)를 기억한다(anchored-menu.js).
// 화면 상태만(저장 없음). 오래된 누름(PRESS_MS 뒤)은 쓰지 않는다 — 사람이 누르지 않고 뜬 물음은 그대로 화면 가운데 아래.
export const PRESS_MS=15000;
let lastPress=null;
const boxOf=el=>{if(!el?.getBoundingClientRect||!el.getClientRects?.().length)return null;const r=el.getBoundingClientRect();return r.width||r.height?{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null};
// 기준으로 쓸 수 있는 칸: 화면에 붙어 있고, 보이고, body·html이 아닌 것.
export function usableAnchor(el){
  if(!el||typeof Element==='undefined'||!(el instanceof Element)||!el.isConnected)return false;
  if(el===el.ownerDocument.body||el===el.ownerDocument.documentElement)return false;
  return !!boxOf(el);
}
// el: 누른 칸, at: 누른 점({x,y}, PC 우클릭 메뉴). 자리는 지금 잰다(곧 숨거나 다시 그려져도 남게).
export function notePressAnchor(el,{at=null}={}){
  const point=at&&Number.isFinite(at.x)&&Number.isFinite(at.y)?{left:at.x,top:at.y,right:at.x,bottom:at.y,width:0,height:0}:null;
  const box=point||boxOf(el);if(!box)return;
  lastPress={el:point?null:el,box,time:Date.now()};
}
// 지금 쓸 기준: 기억한 칸이 아직 보이면 그 칸(화면이 움직여도 따라감), 아니면 누를 때 잰 자리. 없거나 오래됐으면 null.
export function pressAnchor({now=Date.now(),maxAge=PRESS_MS}={}){
  if(!lastPress||now-lastPress.time>maxAge)return null;
  if(usableAnchor(lastPress.el))return lastPress.el;
  const b=lastPress.box;return {getBoundingClientRect:()=>({...b,x:b.left,y:b.top})};
}
const PRESSABLE='button,a[href],summary,[role="button"],[role="menuitem"],[role="option"],[role="tab"],input,select,label,[data-row-menu-row],[tabindex]';
// 펼친 작은 메뉴(aria-controls로 이어진 단추가 aria-expanded="true") 안을 누르면 그 메뉴를 연 단추를 기억한다 — 공용 메뉴가 아닌 화면 메뉴(노트 ⋯ 등)도 같다.
function openerOf(el){
  for(let n=el;n&&n.nodeType===1;n=n.parentElement){
    if(!n.id)continue;
    const opener=n.ownerDocument.querySelector(`[aria-expanded="true"][aria-controls~="${CSS.escape(n.id)}"]`);
    if(opener&&!n.contains(opener)&&usableAnchor(opener))return opener;
  }
  return null;
}
const pressSpot=el=>openerOf(el)||el;
const notePressEvent=e=>{const t=e.target instanceof Element?e.target:null;if(!t)return;const el=pressSpot(t.closest(PRESSABLE)||t);if(usableAnchor(el))notePressAnchor(el)};
if(typeof document!=='undefined'&&document.addEventListener){
  document.addEventListener('pointerdown',notePressEvent,true);
  document.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '||e.key==='Delete'||e.key==='F10'||e.key==='ContextMenu'){const el=document.activeElement&&pressSpot(document.activeElement);if(usableAnchor(el))notePressAnchor(el)}},true);
}
