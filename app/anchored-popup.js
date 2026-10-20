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
export function placeAnchored(panel,anchor,{maxWidth=360,maxHeight=480,gap=4,edge=8,minHeight=160}={}){
  if(!anchorable(anchor))return '';
  const t=anchor.getBoundingClientRect(),vw=document.documentElement.clientWidth,vh=window.innerHeight;
  const width=Math.min(maxWidth,vw-edge*2),below=vh-t.bottom-gap-edge,above=t.top-gap-edge;
  let side,left,top='auto',bottom='auto',height;
  if(Math.max(below,above)>=minHeight){
    side=below>=Math.min(maxHeight,above)?'below':'above';
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
  return side;
}
export function clearAnchored(panel){
  for(const key of ['inset','margin','width','left','top','bottom','maxHeight'])panel.style[key]='';
  if(!panel.getAttribute('style'))panel.removeAttribute('style');
  delete panel.dataset.anchorSide;
}

// Keeps an open anchored popup with its anchor: a window resize or any scroll outside the popup calls place() again on the
// next frame; when the anchor is gone (removed, hidden, or scrolled fully out of the window) lost() is called instead, and
// the caller closes the popup. Returns stop(), to call when the popup closes.
export function followAnchor(panel,anchor,{place,lost}){
  let frame=0;
  const check=()=>{
    frame=0;
    if(!anchorable(anchor)||('isConnected' in anchor&&!anchor.isConnected)){lost();return;}
    const r=anchor.getBoundingClientRect();
    if(!r.width&&!r.height||r.bottom<0||r.top>window.innerHeight||r.right<0||r.left>document.documentElement.clientWidth){lost();return;}
    place();
  };
  const queue=e=>{if(e?.type==='scroll'&&e.target instanceof Node&&panel.contains(e.target))return;if(!frame)frame=requestAnimationFrame(check);};
  window.addEventListener('resize',queue);window.addEventListener('scroll',queue,{capture:true,passive:true});
  return ()=>{if(frame)cancelAnimationFrame(frame);frame=0;window.removeEventListener('resize',queue);window.removeEventListener('scroll',queue,{capture:true});};
}
