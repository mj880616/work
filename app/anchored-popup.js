// UI-PC팝업위치: on a wide screen (761px~) a small popup opens right below the button that was pressed (above it when there is
// no room below, beside it when neither has room) instead of rising from the bottom of the screen. Phones keep their bottom
// sheets; callers decide with isWide(). Used by the shared choice sheet (choice-sheet.js); a ⋯ menu or any other small popup
// can use the same two calls: placeAnchored() for the position and followAnchor() to keep it there while the page moves.
export const WIDE_QUERY='(min-width:761px)';
export const isWide=()=>window.matchMedia(WIDE_QUERY).matches;
const anchorable=anchor=>typeof anchor?.getBoundingClientRect==='function';

// Sets the panel's inline position (position:fixed is the caller's CSS) from the anchor's box and returns the side it took
// ('below' | 'above' | 'side'), or '' when the anchor cannot be measured. The panel never leaves the window (edge px margin)
// and never grows past maxHeight; its own content scrolls inside.
// beside:'up' (UI-자주가는링크, a sidebar row): open to the right of the anchor and grow upward, the panel's bottom edge on the
// anchor's bottom edge ('beside-up'); when the window above is too short, the panel slides down only as far as the window allows.
// UI-창잘림·끌어옮기기: after placing, the box the panel was really drawn at (its CSS may make it wider or taller than asked) is
// measured and pushed back inside the window, so no popup is cut at the right or bottom edge. A wider popup asks for it here
// (maxWidth), never with its own CSS min-width. A panel the user dragged by its title (dragByTitle) keeps its spot: it is only
// kept inside the window (a resize, a new width or height), never moved back to the anchor until it closes (clearAnchored).
export function placeAnchored(panel,anchor,{maxWidth=360,maxHeight=480,gap=4,edge=8,minHeight=160,beside=''}={}){
  if(!anchorable(anchor))return '';
  const vw=document.documentElement.clientWidth,vh=window.innerHeight,width=Math.min(maxWidth,vw-edge*2);
  if(panel.dataset.anchorMoved&&panel.dataset.anchorSide){
    Object.assign(panel.style,{width:width+'px',maxHeight:Math.max(0,Math.min(maxHeight,vh-edge*2))+'px'});
    keepInside(panel,edge);
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
    bottom=Math.max(edge,vh-want)+'px';
  }else if(Math.max(below,above)>=minHeight){
    side=below>=Math.min(maxHeight,above)?'below':'above';
    // UI-메뉴잘림: 고른 쪽에 내용이 다 들어가지 않는데 반대쪽에는 다 들어가면 반대쪽으로(⋯ 메뉴 끝 항목이 안쪽 스크롤에 숨지 않게).
    const want=Math.min(maxHeight,panel.scrollHeight||0);
    if(want&&side==='below'&&below<want&&above>=want)side='above';else if(want&&side==='above'&&above<want&&below>=want)side='below';
    left=Math.max(edge,Math.min(t.left,vw-width-edge));
    height=Math.min(maxHeight,side==='below'?below:above);
    if(side==='below')top=t.bottom+gap+'px';else bottom=vh-t.top+gap+'px';
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
  keepInside(panel,edge);
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
export function keepInside(panel,edge=8){
  const r=panel.getBoundingClientRect();if(!r.width&&!r.height)return;
  const vw=document.documentElement.clientWidth,vh=window.innerHeight;
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
export function dragByTitle(panel,selector,{edge=8}={}){
  let drag=null;
  panel.addEventListener('pointerdown',e=>{
    if(e.button!==0||!isWide()||!panel.dataset.anchorSide)return;
    const handle=e.target instanceof Element?e.target.closest(selector):null;
    if(!handle||!panel.contains(handle)||e.target.closest('button,a,input,select,textarea,label,[contenteditable]'))return;
    const r=panel.getBoundingClientRect();
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top,moved:false,handle};
    try{handle.setPointerCapture(e.pointerId);}catch{}
  });
  panel.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.moved&&Math.abs(dx)+Math.abs(dy)<4)return;
    if(!drag.moved){drag.moved=true;panel.dataset.anchorMoved='1';panel.classList.add('anchored-dragging');}
    e.preventDefault();
    const r=panel.getBoundingClientRect(),vw=document.documentElement.clientWidth,vh=window.innerHeight;
    Object.assign(panel.style,{left:clamp(drag.left+dx,edge,vw-edge-r.width)+'px',top:clamp(drag.top+dy,edge,vh-edge-r.height)+'px',bottom:'auto'});
  });
  const end=e=>{
    if(!drag||e.pointerId!==drag.id)return;
    try{drag.handle.releasePointerCapture(e.pointerId);}catch{}
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
  window.addEventListener('resize',queue);window.addEventListener('scroll',queue,{capture:true,passive:true});
  return ()=>{if(frame)cancelAnimationFrame(frame);frame=0;window.removeEventListener('resize',queue);window.removeEventListener('scroll',queue,{capture:true});};
}
