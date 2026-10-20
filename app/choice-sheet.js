// Shared native selection sheet, originally the home quick-input sheet (PR 428).
import {WIDE_QUERY,isWide,placeAnchored,clearAnchored,followAnchor} from './anchored-popup.js';
export function projectRows(rows,selected,esc){
  return [{project:{id:'',name:'프로젝트 없음'},depth:0},...rows].map(x=>`<button type="button" class="home-choice-row" style="--home-choice-depth:${x.depth}" data-sheet-value="${esc(x.project.id)}" aria-pressed="${x.project.id===selected}" title="${esc(x.project.name)}">${esc(x.project.name)}</button>`).join('');
}
// UI-PC팝업위치: on a wide screen (761px~, anchored-popup.js) every choice sheet opens as a small list right below the button that
// was pressed (above or beside it when there is no room), with no dimming; phones keep the bottom sheet. anchored(kind) is
// optional: return false to keep a bottom sheet on a wide screen too. open(kind, trigger, anchor) takes the box to open by when
// it is not the trigger (the trigger is where focus goes back); without a box that can be measured the sheet stays a bottom sheet.
export function createChoiceSheet({id,titleId,historyKey,canOpen,choices,render,onSelect,onError,anchored}){
  const sheet=document.createElement('dialog');sheet.className='home-choice-sheet';sheet.id=id;sheet.setAttribute('aria-labelledby',titleId);
  sheet.innerHTML=`<header><h2 id="${titleId}"></h2><button type="button" data-sheet-close aria-label="선택판 닫기">×</button></header><div data-sheet-content></div>`;
  document.body.append(sheet);
  let active=null,closing=null,epoch=0,unfollow=null;
  const wantAnchor=kind=>anchored?!!anchored(kind):isWide();
  function place(){
    if(!active)return;
    const anchor=active.anchor||active.trigger;
    // Chip lists (organizations, many per line) get a wider list than one-per-line rows so fewer lines need scrolling.
    const chips=!!sheet.querySelector('[data-sheet-content] .home-choice-chip');
    if(!wantAnchor(active.kind)||!placeAnchored(sheet,anchor,{maxWidth:chips?480:360,maxHeight:chips?560:480})){unplace();return;}
    sheet.classList.add('home-choice-anchored');
    unfollow||=followAnchor(sheet,anchor,{place,lost:()=>{if(active)void close();}});
  }
  function unplace(){unfollow?.();unfollow=null;if(!sheet.classList.contains('home-choice-anchored'))return;sheet.classList.remove('home-choice-anchored');clearAnchored(sheet);}
  function paint(){
    if(!active)return;const view=render(active.kind);sheet.querySelector('h2').textContent=view.title;sheet.dataset.kind=active.kind;
    const content=sheet.querySelector('[data-sheet-content]');content.innerHTML=view.html;place();
    const focus=content.querySelector('[aria-pressed="true"]')||content.querySelector('button')||sheet.querySelector('[data-sheet-close]');focus.focus({preventScroll:true});focus.scrollIntoView({block:'nearest'});
  }
  function close(fromBack=false){
    epoch++;const previous=active;if(!previous)return closing||Promise.resolve();active=null;sheet.close();unplace();previous.trigger.setAttribute('aria-expanded','false');
    let release;const pending=new Promise(resolve=>release=resolve);closing=pending;
    const finish=()=>queueMicrotask(()=>{if(closing===pending)closing=null;if(canOpen()&&previous.trigger.isConnected&&!previous.trigger.hidden)previous.trigger.focus({preventScroll:true});release();});
    if(!fromBack&&history.state?.[historyKey]===previous.id){window.addEventListener('popstate',finish,{once:true});history.back();}else finish();return pending;
  }
  async function open(kind,trigger,anchor=null){
    if(!canOpen())return;if(active||closing)await close();const run=++epoch,owner=window.KPTURuntime.context.read()?.user?.id;
    document.activeElement?.blur();
    try{await choices();}catch(e){onError?.(e);return;}
    if(run!==epoch||owner!==window.KPTURuntime.context.read()?.user?.id||!canOpen())return;
    active={kind,trigger,anchor,id:kind+'-'+run};history.pushState({...history.state,[historyKey]:active.id},'',location.href);trigger.setAttribute('aria-expanded','true');sheet.showModal();paint();
  }
  function dismiss(){if(active&&history.state?.[historyKey]===active.id){const state={...history.state};delete state[historyKey];history.replaceState(state,'',location.href);}void close(true);}
  sheet.querySelector('[data-sheet-close]').onclick=()=>void close();sheet.addEventListener('cancel',e=>{e.preventDefault();void close();});
  sheet.addEventListener('click',e=>{const b=e.target.closest('[data-sheet-value]');if(b&&active){onSelect(active.kind,b.dataset.sheetValue);void close();return;}if(e.target===sheet){const r=sheet.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)void close();}});
  sheet.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();void close();return;}if(e.key!=='Tab')return;e.stopPropagation();const buttons=[...sheet.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(e.shiftKey&&i===0){e.preventDefault();buttons.at(-1).focus();}else if(!e.shiftKey&&i===buttons.length-1){e.preventDefault();buttons[0].focus();}});
  // A wide↔phone switch while open moves the sheet between the two forms.
  window.matchMedia(WIDE_QUERY).addEventListener?.('change',place);
  window.addEventListener('popstate',e=>{if(active&&e.state?.[historyKey]!==active.id)void close(true);});
  return {open,close,dismiss,render:paint};
}
