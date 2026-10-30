import { viewPrefs } from './view-prefs.js';
// UI-칸폭조절(2026-10-22 사용자 요청·승인): the draggable boundaries between the columns of a PC screen (a left list and its right detail pane).
// Shared part: the 할 일·프로젝트·담당조직 screens mount it now, and later screens (공유 페이지 편집 폭) reuse it as is.
// MTG-3칸폭끌기(2026-10-26): the same part now takes any number of columns (`columns`), one boundary between each pair; the 사업 보고
// 3단 (회의 종류 | 차수 | 결과) mounts three. Without `columns` it is the two-column part it always was (`list`/`pane`).
// - The grid stays owned by each screen's CSS (grid-template-columns uses one var(--ds-split-*) per column, theme-tokens.css). This part
//   only sets those variables on the container as fr values, so the ratio is kept when the container grows or shrinks (PC sidebar
//   hidden/shown, UI-상단줄) and nothing else of the layout changes.
// - Default 1/3 : 2/3 for two columns (a screen may give its own default shares). Each column keeps a minimum width (a CSS variable
//   per column, e.g. --ds-split-list-min / --ds-split-detail-min); a stored ratio that no longer fits is only clamped for drawing and
//   stays stored. A boundary moves only the two columns next to it.
// - The chosen ratio is remembered per screen on the server (view-prefs.js, profile view_prefs.split_ratio.<name>; SET-보기선택서버저장).
//   An unread or missing value only means the default ratio. The server accepts one number per screen name, so a three-column screen
//   keeps its two boundaries in that one number (pair codec below); no new name or device storage is used.
// - Mouse/pen drag, double click (double tap) returns that boundary to its default, keyboard: focus a boundary, ←/→ (Home/End = ends).
//   role=separator with aria-valuenow (the share left of the boundary, in %).
const DEFAULT_RATIO=1/3,STEP=0.02;
const mounted=new WeakMap();
// Screens asked to mount while not in the multi-column layout; retried when the window reaches PC width.
const pending=new Map();let pcQuery=null;
function waitForPc(o){
  pending.set(o.container,o);
  if(pcQuery||!window.matchMedia)return;
  pcQuery=window.matchMedia('(min-width:761px)');
  pcQuery.addEventListener?.('change',()=>{if(!pcQuery.matches)return;requestAnimationFrame(()=>{for(const [c,cfg] of [...pending]){if(!c.isConnected){pending.delete(c);continue}mountSplitResize(cfg)}})});
}
let sheet=false;

// ── Pure helpers (also used by tests/split-resize-math.test.mjs) ──
const sum=(a,from=0,to=a.length)=>{let t=0;for(let i=from;i<to;i++)t+=a[i];return t};
/**
 * Shares (fractions that add up to 1) as they can be drawn: every column at least its minimum (also a fraction of the shared width),
 * the rest kept in the stored proportion. Columns under their minimum are pinned to it and the others share what is left.
 * When the minimums alone do not fit, the columns split the width in proportion to their minimums.
 */
export function fitShares(shares,mins){
  const n=shares.length,total=sum(mins);
  if(total>=1)return mins.map(m=>m/total);
  const s=shares.slice(),locked=new Array(n).fill(false);
  for(let pass=0;pass<n;pass++){
    let changed=false;
    for(let i=0;i<n;i++)if(!locked[i]&&s[i]<mins[i]){s[i]=mins[i];locked[i]=true;changed=true}
    if(!changed)break;
    let fixed=0,base=0,free=0;
    for(let i=0;i<n;i++){if(locked[i])fixed+=s[i];else{base+=shares[i];free++}}
    for(let i=0;i<n;i++)if(!locked[i])s[i]=base>0?shares[i]/base*(1-fixed):(1-fixed)/free;
  }
  return s;
}
/** Move boundary `i` (between columns i and i+1) so the shares left of it add up to `cum`; the other columns keep their share. */
export function moveBoundary(shares,mins,i,cum){
  const pair=shares[i]+shares[i+1],lo=mins[i],hi=pair-mins[i+1];
  if(lo>hi)return shares.slice();
  const si=Math.min(hi,Math.max(lo,cum-sum(shares,0,i))),next=shares.slice();
  next[i]=si;next[i+1]=pair-si;return next;
}
// Three columns in the one number the server keeps per screen (0 < v < 1): v = (L·1000 + K)/1e6 with L = share left of the second
// boundary and K = share of the first column inside L, both in thousandths. A two-column value (rounded to 4 decimals) has K a
// multiple of 100, so such a K means "no K stored" (default); a stored K is nudged off the multiples of 100.
export function encodeTriple(shares){
  const L=shares[0]+shares[1],Lq=Math.min(998,Math.max(1,Math.round(L*1000)));
  let Kq=Math.min(998,Math.max(1,Math.round(shares[0]/L*1000)));if(Kq%100===0)Kq+=1;
  return (Lq*1000+Kq)/1e6;
}
export function decodeTriple(v,defaults){
  if(!(v>0&&v<1))return null;
  const n=Math.round(v*1e6),Lq=Math.floor(n/1000),Kq=n%1000;if(Lq<1)return null;
  const L=Lq/1000,K=Kq===0||Kq%100===0?defaults[0]/(defaults[0]+defaults[1]):Kq/1000;
  return [L*K,L*(1-K),1-L];
}

// The stored value of a screen as shares (null = default). Two columns: the left share itself; three: the pair above.
// UI-작은결정묶음 ④: a screen that used to share another screen's value (o.inherit) starts from that value until its own is saved;
// it only ever writes its own name.
function readShares(name,n,defaults,inherit){
  let v=viewPrefs.getSplit(name);if(!(v>0&&v<1)&&inherit)v=viewPrefs.getSplit(inherit);if(!(v>0&&v<1))return null;
  if(n===2)return [v,1-v];
  if(n===3)return decodeTriple(v,defaults);
  return null;
}
function writeShares(name,n,shares){
  if(n===2)viewPrefs.setSplit(name,shares==null?null:Math.round(shares[0]*10000)/10000);
  else if(n===3)viewPrefs.setSplit(name,shares==null?null:encodeTriple(shares));
}
const px=(el,prop,fallback)=>{const v=parseFloat(getComputedStyle(el).getPropertyValue(prop));return Number.isFinite(v)?v:fallback};

// The handle's look lives here so every screen that mounts it gets the same boundary without loading another stylesheet.
function ensureStyle(){
  if(sheet)return;sheet=true;
  const style=document.createElement('style');style.dataset.kptuSplitResize='';
  style.textContent=`.split-resize-handle{position:absolute;z-index:3;box-sizing:border-box;margin:0;padding:0;border:0;background:transparent;cursor:col-resize;touch-action:none;outline:none}
.split-resize-handle[hidden]{display:none}
@media(max-width:760px){.split-resize-handle{display:none!important}}
.split-resize-handle::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:2px;margin-left:-1px;border-radius:2px;background:transparent;transition:background-color .12s}
.split-resize-handle:hover::before,.split-resize-handle.is-dragging::before{background:var(--kptu-border-strong)}
.split-resize-handle:focus-visible::before{background:var(--kptu-info);width:3px;margin-left:-1.5px}
html.split-resizing,html.split-resizing *{cursor:col-resize!important;user-select:none!important}`;
  document.head.append(style);
}

/**
 * Mount (or refresh) the boundaries on a column grid. Calling it again on the same container only refreshes it, so a screen
 * may call it from every render (a container emptied by innerHTML gets new handles).
 * @param {object} o
 * @param {HTMLElement} o.container grid whose columns use one variable each
 * @param {string} o.name screen name, also the storage key part
 * @param {string} [o.inherit] screen name whose stored value is used until this screen saves its own (UI-작은결정묶음 ④)
 * @param {() => Element|null} [o.list] two columns: left column element (its top is where the boundary starts)
 * @param {() => Element|null} [o.pane] two columns: right column element (its left edge is where the boundary sits)
 * @param {Array<{el:() => Element|null, varName:string, minVar?:string, minFallback?:number, share?:number, id?:string}>} [o.columns]
 *   two or more columns left to right instead of list/pane: the element, the grid variable set as fr, the minimum-width variable and
 *   its fallback in px, the default share (relative to the others) and the id for aria-controls
 * @param {() => boolean} o.active true while the multi-column layout is shown
 * @param {string} [o.label] accessible name
 * @param {string} [o.controls] id of the left column, for aria-controls (two columns)
 */
export function mountSplitResize(o){
  const {container}=o;if(!container)return null;
  const known=mounted.get(container);
  if(known){
    if(known.handles[0].isConnected&&known.handles[0].parentElement===container){known.update();return known.api}
    known.dispose();
  }
  // Nothing is added to the page until the multi-column layout is shown (phones and middle widths stay untouched); a later
  // widening to PC width mounts it then.
  if(!o.active?.()){waitForPc(o);return null}
  pending.delete(container);
  ensureStyle();
  const cols=o.columns||[
    {el:o.list,varName:o.listVar||'--ds-split-list',minVar:'--ds-split-list-min',minFallback:240,share:1,id:o.controls},
    {el:o.pane,varName:o.detailVar||'--ds-split-detail',minVar:'--ds-split-detail-min',minFallback:360,share:2},
  ];
  const n=cols.length;if(n<2)return null;
  const weight=cols.reduce((t,c)=>t+(c.share||1),0),defaults=cols.map(c=>(c.share||1)/weight);
  const handles=[];
  for(let i=0;i<n-1;i++){
    const handle=document.createElement('div');
    handle.className='split-resize-handle';handle.tabIndex=0;handle.hidden=true;
    handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');
    handle.setAttribute('aria-label',n===2?(o.label||'목록과 상세 칸 폭 조절'):`${o.label||'칸 폭 조절'} ${i+1}`);
    handle.setAttribute('aria-valuemin','0');handle.setAttribute('aria-valuemax','100');
    if(cols[i].id)handle.setAttribute('aria-controls',cols[i].id);
    handle.title=n===2?'끌어서 폭 조절 · 두 번 누르면 기본(1/3)':'끌어서 폭 조절 · 두 번 누르면 기본';
    container.append(handle);handles.push(handle);
  }
  if(getComputedStyle(container).position==='static')container.style.position='relative';
  let shares=readShares(o.name,n,defaults,o.inherit)??defaults.slice(),drag=null,frame=0;

  const gap=()=>{const v=parseFloat(getComputedStyle(container).columnGap);return Number.isFinite(v)?v:0};
  // Width the columns share: the content box minus the gaps between them.
  const width=()=>{const s=getComputedStyle(container);return container.clientWidth-(parseFloat(s.paddingLeft)||0)-(parseFloat(s.paddingRight)||0)-gap()*(n-1)};
  const mins=w=>cols.map(c=>px(container,c.minVar,c.minFallback??0)/w);
  // Shares as drawn at the current width; the minimum widths win over the stored shares.
  const fitted=()=>{const w=width();return w>0?fitShares(shares,mins(w)):shares.slice()};
  function apply(){
    const s=fitted();
    // fr values that add up to 100 (a sum below 1 would leave part of the row empty).
    cols.forEach((c,k)=>container.style.setProperty(c.varName,`${(s[k]*100).toFixed(2)}fr`));
    handles.forEach((h,i)=>{const pct=Math.round(sum(s,0,i+1)*100);h.setAttribute('aria-valuenow',String(pct));h.setAttribute('aria-valuetext',`왼쪽 ${pct}%`)});
  }
  function position(){
    const on=!!o.active?.();handles.forEach(h=>{h.hidden=!on});if(!on)return;
    const box=container.getBoundingClientRect(),g=gap(),w=Math.max(g,12);
    handles.forEach((h,i)=>{
      const right=cols[i+1].el?.(),left=cols[i].el?.();if(!right)return;
      const p=right.getBoundingClientRect();
      const top=Math.max(0,((left||right).getBoundingClientRect().top-box.top));
      // Left as a share of the grid width, so a position left over from a wider layout (before the next frame hides it) can never
      // reach past the grid's right edge and make the page scroll sideways.
      const share=box.width>0?Math.min(0.98,Math.max(0,(p.left-box.left-g/2)/box.width)):0;
      h.style.left=`calc(${(share*100).toFixed(3)}% - ${w/2}px)`;h.style.width=`${w}px`;
      h.style.top=`${top}px`;h.style.height=`${Math.max(0,box.height-top)}px`;
    });
  }
  function update(){apply();position();cols.forEach(c=>watch(c.el?.()))}
  let disposed=false;
  const schedule=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;if(!container.isConnected){dispose();return}update()})};
  // Move boundary i so `cum` (share left of it) is reached; the other boundaries keep their place.
  function move(i,cum){const w=width();if(!(w>0))return;shares=moveBoundary(fitted(),mins(w),i,cum);update()}
  // Back to the default place of boundary i, whatever the width allows right now (a stored default is simply "nothing stored").
  function resetBoundary(i){
    const pair=shares[i]+shares[i+1],si=Math.min(pair-0.0005,Math.max(0.0005,sum(defaults,0,i+1)-sum(shares,0,i))),next=shares.slice();
    next[i]=si;next[i+1]=pair-si;shares=next;update();
  }
  const persist=()=>writeShares(o.name,n,shares.every((v,k)=>Math.abs(v-defaults[k])<1e-6)?null:shares);
  function set(r,{save=true}={}){
    if(n===2){const w=width(),m=w>0?mins(w):[0,0];shares=r==null?defaults.slice():fitShares([r,1-r],m)}
    else if(r==null)shares=defaults.slice();
    update();if(save)writeShares(o.name,n,r==null?null:shares);
  }

  handles.forEach((handle,i)=>{
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
      drag.moved=true;move(i,(e.clientX-drag.left-gap()*(i+0.5))/w);
    });
    const end=e=>{
      if(!drag||(e&&e.pointerId!==drag.id))return;
      const moved=drag.moved;drag=null;
      handle.classList.remove('is-dragging');document.documentElement.classList.remove('split-resizing');
      if(moved)persist();
    };
    handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);
    // Double click: this boundary goes back to its default place (the others stay).
    handle.addEventListener('dblclick',e=>{e.preventDefault();resetBoundary(i);persist()});
    handle.addEventListener('keydown',e=>{
      const w=width();if(!(w>0))return;
      const s=fitted(),m=mins(w),cur=sum(s,0,i+1),before=sum(s,0,i);let next=null;
      if(e.key==='ArrowLeft')next=cur-STEP;else if(e.key==='ArrowRight')next=cur+STEP;
      else if(e.key==='Home')next=before+m[i];else if(e.key==='End')next=before+s[i]+s[i+1]-m[i+1];
      if(next==null)return;e.preventDefault();move(i,next);persist();
    });
  });

  // Size changes (window, PC sidebar hidden/shown, a pane appearing) only move the handles; the screen calls mount again after
  // its own render, which refreshes them too. No observer rewrites the screen's content.
  const ro=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null,watched=new Set();
  const watch=el=>{if(ro&&el&&!watched.has(el)){watched.add(el);ro.observe(el)}};
  watch(container);
  window.addEventListener('resize',schedule);
  // A container the screen emptied and drew again is a new element with its own handles; the old one stops listening here.
  function dispose(){if(disposed)return;disposed=true;window.removeEventListener('resize',schedule);ro?.disconnect();if(mounted.get(container)?.handles===handles)mounted.delete(container)}
  const api={set,reset:()=>set(null),get ratio(){return fitted()[0]},get shares(){return fitted()},update,handle:handles[0],handles};
  mounted.set(container,{handles,update,api,dispose});
  update();
  return api;
}
export const SPLIT_DEFAULT_RATIO=DEFAULT_RATIO;
