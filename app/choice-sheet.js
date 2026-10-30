import {emptyHtml} from './wait-state.js';
// Shared native selection sheet, originally the home quick-input sheet (PR 428).
import {WIDE_QUERY,isWide,placeAnchored,clearAnchored,followAnchor} from './anchored-popup.js';
// UI-고르기창개선 B: one project per line. A child is indented by its depth (no "↳"); on a PC list (anchored) it is also lighter and
// every row has a small check box, green when chosen. Phones keep the plain rows. extra: more attributes for the button.
// PRJ-3단: a third-level row given x.path (its parents, "1단 › 2단") shows that path in small gray text only while the search box
// filters the list, when the indentation no longer tells where it sits (the text is added while searching and removed after, so the
// row's text stays its name otherwise). The search still matches the name only.
export function projectRow(x,selected,esc,{value=x.project.id,extra=''}={}){
  const name=x.project.name||'이름 없는 사업영역',path=x.depth>=2&&x.path?` data-sheet-path="${esc(x.path)}"`:'';
  return `<button type="button" class="home-choice-row home-choice-pick" style="--home-choice-depth:${x.depth}" data-depth="${x.depth}" data-sheet-value="${esc(value)}"${path} aria-pressed="${value===selected}" title="${esc(name)}" ${extra}><span class="home-choice-check" aria-hidden="true"></span><span class="home-choice-name">${esc(name)}</span></button>`;
}
export function projectRows(rows,selected,esc){
  return [{project:{id:'',name:'사업영역 없음'},depth:0},...rows].map(x=>projectRow(x,selected,esc)).join('');
}
// UI-고르기창개선 A → UPD-여러곳고르기 ①: organizations by group (organization-order.js), the same look as the project list: the
// group name is a small heading and its organizations follow one per line (a row with a check box, drawn by row(o)). When no
// organization falls in a named group (only the "그 외" tail), the rows are one plain group with no heading.
export function orgRow(o,pressed,esc,{extra=''}={}){
  const name=o.name||'이름 없는 조직';
  return `<button type="button" class="home-choice-row home-choice-pick" style="--home-choice-depth:0" data-depth="0" data-sheet-value="${esc(o.id)}" aria-pressed="${!!pressed}" title="${esc(name)}" ${extra}><span class="home-choice-check" aria-hidden="true"></span><span class="home-choice-name">${esc(name)}</span></button>`;
}
export function orgGroupRows(groups,row){
  const order=window.KPTUOrganizationOrder,list=(groups||[]).filter(g=>g.length);
  const tail=order?.GROUP_NAMES?.at(-1),named=!!order&&!(list.length===1&&order.groupName(list[0][0])===tail);
  return list.map(g=>{
    const name=named?order.groupName(g[0]):'';
    return `<div class="home-choice-org-group${name?'':' home-choice-group-plain'}" data-sheet-section${name?` data-sheet-group="${name}"`:''}>${name?`<p class="home-choice-group-name">${name}</p>`:''}<div class="home-choice-org-items">${g.map(row).join('')}</div></div>`;
  }).join('');
}
const SPLIT_QUERY='(min-width:761px)';
const searchText=value=>String(value||'').toLowerCase().replace(/\s+/g,'');
// UI-PC팝업위치: on a wide screen (761px~, anchored-popup.js) every choice sheet opens as a small list right below the button that
// was pressed (above or beside it when there is no room), with no dimming; phones keep the bottom sheet. anchored(kind) is
// optional: return false to keep a bottom sheet on a wide screen too. open(kind, trigger, anchor) takes the box to open by when
// it is not the trigger (the trigger is where focus goes back); without a box that can be measured the sheet stays a bottom sheet.
// UPD-여러곳고르기 ②③: multi(kind) may return {pressed(value), label} for a sheet where many choices are kept: a press only
// toggles (onSelect, then the marks and the count are synced in place), the sheet stays open, and the footer shows the count
// (label) left and [취소] [저장] right. Only [저장] (onCommit) keeps the choice; [취소], ×, Esc, Back or a press outside drop it
// (the caller starts its pending choice again on the next open).
export function createChoiceSheet({id,titleId,historyKey,canOpen,choices,render,onSelect,onError,anchored,multi=()=>null,onCommit=()=>{}}){
  const sheet=document.createElement('dialog');sheet.className='home-choice-sheet';sheet.id=id;sheet.setAttribute('aria-labelledby',titleId);
  // render() may return search (the box's label): the box sits above the list, outside its scroll, and filters the choices by name
  // (PC list only; phones keep the sheet as it was).
  sheet.innerHTML=`<header><h2 id="${titleId}"></h2><button type="button" data-sheet-close aria-label="선택판 닫기">×</button></header><div class="home-choice-search-box" data-sheet-search-box hidden><input type="search" class="home-choice-search" data-sheet-search autocomplete="off" spellcheck="false">${emptyHtml('맞는 항목 없음', {attrs: 'data-sheet-empty hidden'})}</div><div data-sheet-content></div><footer class="home-choice-foot" data-sheet-foot hidden><span class="home-choice-count" data-sheet-count role="status"></span><button type="button" class="home-choice-cancel" data-sheet-cancel>취소</button><button type="button" class="home-choice-save" data-sheet-save>저장</button></footer>`;
  document.body.append(sheet);
  let active=null,closing=null,epoch=0,unfollow=null;
  const search=sheet.querySelector('[data-sheet-search]'),searchBox=sheet.querySelector('[data-sheet-search-box]'),empty=sheet.querySelector('[data-sheet-empty]');
  // Hides the choices whose name does not hold the typed text, then any group or section left without a choice. The box is shown
  // only on the PC list; on a phone (bottom sheet) nothing is filtered.
  function filter(){
    const content=sheet.querySelector('[data-sheet-content]'),q=searchBox.hidden||!sheet.classList.contains('home-choice-anchored')?'':searchText(search.value);let shown=0;
    const visible=root=>!!root?.querySelector('[data-sheet-value]:not([hidden]),[data-sheet-item]:not([hidden])');
    content.querySelectorAll('[data-sheet-value],[data-sheet-item]').forEach(el=>{const hit=!q||searchText((el.querySelector('.home-choice-name')||el).textContent).includes(q);el.hidden=!hit;if(hit)shown++;});
    content.querySelectorAll('[data-sheet-path]').forEach(el=>{let tag=el.querySelector('.home-choice-path');if(!q){tag?.remove();return}if(!tag){tag=document.createElement('span');tag.className='home-choice-path';tag.textContent=el.dataset.sheetPath;el.append(tag)}});
    content.querySelectorAll('[data-sheet-hide-on-search]').forEach(el=>{el.hidden=!!q;});
    content.querySelectorAll('[data-sheet-section]').forEach(el=>{el.hidden=!!q&&!visible(el);});
    content.querySelectorAll('[data-sheet-label-of]').forEach(el=>{el.hidden=!!q&&!visible(content.querySelector(`[data-sheet-part="${el.dataset.sheetLabelOf}"]`));});
    empty.hidden=!q||shown>0;
  }
  search.addEventListener('input',filter);
  // ↓ from the box goes to the first choice still shown.
  search.addEventListener('keydown',e=>{if(e.key!=='ArrowDown')return;const first=sheet.querySelector('[data-sheet-content] button[data-sheet-value]:not([hidden])');if(first){e.preventDefault();first.focus();}});
  const wantAnchor=kind=>anchored?!!anchored(kind):isWide();
  function place(){
    if(!active)return;
    const anchor=active.anchor||active.trigger;
    // Chip lists (organizations, many per line) get a wider list than one-per-line rows so fewer lines need scrolling.
    const chips=!!sheet.querySelector('[data-sheet-content] .home-choice-chip');
    // UI-기록할곳창PC: a sheet whose render() asks for split, on a wide PC (761px~), is one wide list with its columns
    // (data-sheet-col) side by side, as tall as the window allows below the button; each column scrolls on its own.
    const split=!!active.split&&window.matchMedia(SPLIT_QUERY).matches;
    if(!wantAnchor(active.kind)||!placeAnchored(sheet,anchor,split?{maxWidth:880,maxHeight:760,minHeight:320}:{maxWidth:chips?480:360,maxHeight:chips?560:480})){unplace();filter();return;}
    sheet.classList.add('home-choice-anchored');sheet.classList.toggle('home-choice-split',split);moveSearch(split);filter();
    unfollow||=followAnchor(sheet,anchor,{place,lost:()=>{if(active)void close();}});
  }
  // In a split sheet the search box sits in the header, right of the title (before ×, so Tab order follows what is seen).
  function moveSearch(split){const head=sheet.querySelector('header'),home=split?head:searchBox;if(search.parentElement===home)return;if(split)head.insertBefore(search,sheet.querySelector('[data-sheet-close]'));else searchBox.prepend(search);}
  function unplace(){unfollow?.();unfollow=null;sheet.classList.remove('home-choice-split');moveSearch(false);if(!sheet.classList.contains('home-choice-anchored'))return;sheet.classList.remove('home-choice-anchored');clearAnchored(sheet);}
  function paint(){
    if(!active)return;const view=render(active.kind);active.split=!!view.split;sheet.querySelector('h2').textContent=view.title;sheet.dataset.kind=active.kind;
    searchBox.hidden=!view.search;if(view.search){search.placeholder=view.search;search.setAttribute('aria-label',view.search);}else search.value='';
    const content=sheet.querySelector('[data-sheet-content]');content.innerHTML=view.html;sync();place();
    const focus=content.querySelector('[aria-pressed="true"]:not([hidden])')||content.querySelector('button:not([hidden])')||sheet.querySelector('[data-sheet-close]');focus.focus({preventScroll:true});focus.scrollIntoView({block:'nearest'});
  }
  // Marks every choice of a multi sheet (the 최근 chip and the list row of one place share its value) and its count.
  function sync(){
    const state=active&&multi(active.kind),foot=sheet.querySelector('[data-sheet-foot]');sheet.classList.toggle('home-choice-multi',!!state);foot.hidden=!state;if(!state)return;
    sheet.querySelectorAll('[data-sheet-content] button[data-sheet-value]').forEach(b=>b.setAttribute('aria-pressed',String(!!state.pressed(b.dataset.sheetValue))));
    sheet.querySelector('[data-sheet-count]').textContent=state.label;
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
    active={kind,trigger,anchor,id:kind+'-'+run};search.value='';history.pushState({...history.state,[historyKey]:active.id},'',location.href);trigger.setAttribute('aria-expanded','true');sheet.showModal();paint();
  }
  function dismiss(){if(active&&history.state?.[historyKey]===active.id){const state={...history.state};delete state[historyKey];history.replaceState(state,'',location.href);}void close(true);}
  sheet.querySelector('[data-sheet-close]').onclick=()=>void close();sheet.addEventListener('cancel',e=>{e.preventDefault();void close();});
  sheet.querySelector('[data-sheet-cancel]').onclick=()=>void close();
  sheet.querySelector('[data-sheet-save]').onclick=()=>{if(!active)return;onCommit(active.kind);void close();};
  sheet.addEventListener('click',e=>{const b=e.target.closest('[data-sheet-value]');if(b&&active){const kind=active.kind,many=!!multi(kind);onSelect(kind,b.dataset.sheetValue);if(many){if(active)sync();return;}void close();return;}if(e.target===sheet){const r=sheet.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)void close();}});
  sheet.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();void close();return;}if(e.key!=='Tab')return;e.stopPropagation();const buttons=[...sheet.querySelectorAll('button,input')].filter(el=>el.getClientRects().length),i=buttons.indexOf(document.activeElement);if(e.shiftKey&&i===0){e.preventDefault();buttons.at(-1).focus();}else if(!e.shiftKey&&i===buttons.length-1){e.preventDefault();buttons[0].focus();}});
  // A wide↔phone switch while open moves the sheet between the two forms.
  window.matchMedia(WIDE_QUERY).addEventListener?.('change',place);window.matchMedia(SPLIT_QUERY).addEventListener?.('change',place);
  window.addEventListener('popstate',e=>{if(active&&e.state?.[historyKey]!==active.id)void close(true);});
  return {open,close,dismiss,render:paint,sync};
}
