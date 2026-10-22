// UI-칸폭조절(2026-10-22 사용자 요청·승인): the one draggable boundary between a PC left list and its right detail pane.
// Shared part: the 할 일·프로젝트·담당조직 screens mount it now, and later screens (공유 페이지 편집 폭) reuse it as is.
// - The grid stays owned by each screen's CSS (grid-template-columns uses var(--ds-split-list) / var(--ds-split-detail),
//   theme-tokens.css). This part only sets those two variables on the container as fr values, so the ratio is kept when the
//   container grows or shrinks (PC sidebar hidden/shown, UI-상단줄) and nothing else of the layout changes.
// - Default 1/3 : 2/3. Each pane keeps a minimum width (--ds-split-list-min / --ds-split-detail-min); a stored ratio that no
//   longer fits is only clamped for drawing and stays stored.
// - The chosen ratio is remembered per screen on this device only (a screen setting, not user content): key
//   kptu-split-ratio:<name>. Blocked or missing storage only means the default ratio.
// - Mouse/pen drag, double click (double tap) returns to the default, keyboard: focus the boundary, ←/→ (Home/End = ends).
//   role=separator with aria-valuenow (left pane share in %).
const STORE_PREFIX='kptu-split-ratio:';
const DEFAULT_RATIO=1/3,STEP=0.02;
const storeKey=name=>STORE_PREFIX+name;
const mounted=new WeakMap();
let sheet=false;

function readRatio(name){try{const v=Number(localStorage.getItem(storeKey(name)));return v>0&&v<1?v:null}catch{return null}}
function writeRatio(name,ratio){try{if(ratio==null)localStorage.removeItem(storeKey(name));else localStorage.setItem(storeKey(name),String(Math.round(ratio*10000)/10000))}catch{}}
const px=(el,prop,fallback)=>{const v=parseFloat(getComputedStyle(el).getPropertyValue(prop));return Number.isFinite(v)?v:fallback};

// The handle's look lives here so every screen that mounts it gets the same boundary without loading another stylesheet.
function ensureStyle(){
  if(sheet)return;sheet=true;
  const style=document.createElement('style');style.dataset.kptuSplitResize='';
  style.textContent=`.split-resize-handle{position:absolute;z-index:3;box-sizing:border-box;margin:0;padding:0;border:0;background:transparent;cursor:col-resize;touch-action:none;outline:none}
.split-resize-handle[hidden]{display:none}
@media(max-width:1023px){.split-resize-handle{display:none!important}}
.split-resize-handle::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:2px;margin-left:-1px;border-radius:2px;background:transparent;transition:background-color .12s}
.split-resize-handle:hover::before,.split-resize-handle.is-dragging::before{background:var(--kptu-border-strong)}
.split-resize-handle:focus-visible::before{background:var(--kptu-info);width:3px;margin-left:-1.5px}
html.split-resizing,html.split-resizing *{cursor:col-resize!important;user-select:none!important}`;
  document.head.append(style);
}

/**
 * Mount (or refresh) the boundary on a two-column grid. Calling it again on the same container only refreshes it, so a screen
 * may call it from every render (a container emptied by innerHTML gets a new handle).
 * @param {object} o
 * @param {HTMLElement} o.container grid whose columns use the two variables
 * @param {string} o.name screen name, also the storage key part
 * @param {() => Element|null} o.list left column element (its top is where the boundary starts)
 * @param {() => Element|null} o.pane right column element (its left edge is where the boundary sits)
 * @param {() => boolean} o.active true while the two-column layout is shown
 * @param {string} [o.label] accessible name
 * @param {string} [o.controls] id of the left column, for aria-controls
 */
export function mountSplitResize(o){
  const {container}=o;if(!container)return null;
  const known=mounted.get(container);
  if(known&&known.handle.isConnected&&known.handle.parentElement===container){known.update();return known.api}
  ensureStyle();
  const listVar=o.listVar||'--ds-split-list',detailVar=o.detailVar||'--ds-split-detail';
  const handle=document.createElement('div');
  handle.className='split-resize-handle';handle.tabIndex=0;handle.hidden=true;
  handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');
  handle.setAttribute('aria-label',o.label||'목록과 상세 칸 폭 조절');
  handle.setAttribute('aria-valuemin','0');handle.setAttribute('aria-valuemax','100');
  if(o.controls)handle.setAttribute('aria-controls',o.controls);
  handle.title='끌어서 폭 조절 · 두 번 누르면 기본(1/3)';
  container.append(handle);
  if(getComputedStyle(container).position==='static')container.style.position='relative';
  let ratio=readRatio(o.name)??DEFAULT_RATIO,drag=null,frame=0;

  const gap=()=>{const v=parseFloat(getComputedStyle(container).columnGap);return Number.isFinite(v)?v:0};
  const width=()=>{const s=getComputedStyle(container);return container.clientWidth-(parseFloat(s.paddingLeft)||0)-(parseFloat(s.paddingRight)||0)-gap()};
  // Allowed share of the left pane at the current width; the minimum widths win over the stored ratio.
  function range(){
    const w=width();if(!(w>0))return [0.05,0.95];
    const minL=px(container,'--ds-split-list-min',240),minD=px(container,'--ds-split-detail-min',360);
    let lo=Math.min(minL/w,0.9),hi=Math.max(1-minD/w,0.1);if(lo>hi){const mid=(lo+hi)/2;lo=hi=mid}
    return [lo,hi];
  }
  const clamp=r=>{const [lo,hi]=range();return Math.min(hi,Math.max(lo,r))};
  function apply(){
    const r=clamp(ratio);
    // fr values that add up to 100 (a sum below 1 would leave part of the row empty).
    container.style.setProperty(listVar,`${(r*100).toFixed(2)}fr`);container.style.setProperty(detailVar,`${((1-r)*100).toFixed(2)}fr`);
    handle.setAttribute('aria-valuenow',String(Math.round(r*100)));
    handle.setAttribute('aria-valuetext',`왼쪽 ${Math.round(r*100)}%`);
  }
  function position(){
    const on=!!o.active?.();handle.hidden=!on;if(!on)return;
    const pane=o.pane?.(),list=o.list?.();if(!pane)return;
    const box=container.getBoundingClientRect(),p=pane.getBoundingClientRect(),g=gap(),w=Math.max(g,12);
    const top=Math.max(0,((list||pane).getBoundingClientRect().top-box.top));
    // Left as a share of the grid width, so a position left over from a wider layout (before the next frame hides it) can never
    // reach past the grid's right edge and make the page scroll sideways.
    const share=box.width>0?Math.min(0.98,Math.max(0,(p.left-box.left-g/2)/box.width)):0;
    handle.style.left=`calc(${(share*100).toFixed(3)}% - ${w/2}px)`;handle.style.width=`${w}px`;
    handle.style.top=`${top}px`;handle.style.height=`${Math.max(0,box.height-top)}px`;
  }
  function update(){apply();position();watch(o.pane?.());watch(o.list?.())}
  const schedule=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;update()})};
  function set(r,{save=true}={}){ratio=r==null?DEFAULT_RATIO:clamp(r);update();if(save)writeRatio(o.name,r==null?null:ratio)}

  handle.addEventListener('pointerdown',e=>{
    if(e.button!==0||handle.hidden)return;e.preventDefault();
    const box=container.getBoundingClientRect(),s=getComputedStyle(container);
    drag={id:e.pointerId,left:box.left+(parseFloat(s.paddingLeft)||0),moved:false};
    try{handle.setPointerCapture(e.pointerId)}catch{}
    handle.classList.add('is-dragging');document.documentElement.classList.add('split-resizing');handle.focus({preventScroll:true});
  });
  handle.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const w=width();if(!(w>0))return;
    drag.moved=true;ratio=clamp((e.clientX-drag.left-gap()/2)/w);update();
  });
  const end=e=>{
    if(!drag||(e&&e.pointerId!==drag.id))return;
    const moved=drag.moved;drag=null;
    handle.classList.remove('is-dragging');document.documentElement.classList.remove('split-resizing');
    if(moved)writeRatio(o.name,ratio);
  };
  handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);
  handle.addEventListener('dblclick',e=>{e.preventDefault();set(null)});
  handle.addEventListener('keydown',e=>{
    const [lo,hi]=range(),cur=clamp(ratio);let next=null;
    if(e.key==='ArrowLeft')next=cur-STEP;else if(e.key==='ArrowRight')next=cur+STEP;
    else if(e.key==='Home')next=lo;else if(e.key==='End')next=hi;
    if(next==null)return;e.preventDefault();set(next);
  });

  // Size changes (window, PC sidebar hidden/shown, a pane appearing) only move the handle; the screen calls mount again after
  // its own render, which refreshes it too. No observer rewrites the screen's content.
  const ro=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null,watched=new Set();
  const watch=el=>{if(ro&&el&&!watched.has(el)){watched.add(el);ro.observe(el)}};
  watch(container);
  window.addEventListener('resize',schedule);
  const api={set,reset:()=>set(null),get ratio(){return clamp(ratio)},update,handle};
  mounted.set(container,{handle,update,api});
  update();
  return api;
}
export const SPLIT_DEFAULT_RATIO=DEFAULT_RATIO;
