// S52-01 UI-사업영역조직고르기창 (요청함 11/06 23:57, 시안 docs/design/mockups/area-org-picker.html): 사업영역·조직을 고르는 칸.
// 평소에는 '사업영역'·'조직' 두 줄만 보인다. 고른 것은 꼬리표(✕로 빼기, 하위는 '상위 › 하위'), 없으면 '없음'.
// [+ 고르기]를 누르면 공용 고르기 창(choice-sheet.js) 하나가 뜬다: PC는 그 줄 바로 아래 작은 창, 폰은 아래에서 올라오는 창
// (아래 탭에 가리지 않음, choice-sheet.css). 창 위에 찾기 칸(폰도), '자주 쓴 것' 꼬리표 몇 개, 그 아래 큰 묶음만 보이고 꺾쇠로
// 그 묶음 하위를 펼친다(고른 것이 든 묶음은 처음부터 펼침). 여러 개를 고르고 [넣기]를 눌러야 반영되며 ✕·바깥 누르기·Esc·뒤로 키는 취소다.
// 이 부품은 화면만 그린다. 값은 부르는 쪽의 열쇠(key) 묶음 그대로이고 저장·연결 구조는 부르는 쪽이 지금처럼 한다.
// '자주 쓴 것'은 이미 저장된 연결(app_record_links, 작업공간 주인 RLS)에서 센다(loadUsedKeys). 기기에는 아무것도 저장하지 않는다.
// S52-01 ② 전수: 하나만 고르는 곳(빠른 입력·일정 추가 [할 일] 사업영역 등)은 같은 창을 여러 개 고르기 없이 연다(openAreaOrgPicker
// multi:false: 줄을 누르면 바로 고르고 닫힘, none으로 '없음' 줄). 다른 창 안에 같은 접는 목록을 그리는 곳(업데이트 '기록할 곳')은
// areaListHtml·orgListHtml·openKeysFor로 같은 모양·같은 찾기를 쓴다(꺾쇠 펼침은 모든 고르기 창이 한다: choice-sheet.js).
import {createChoiceSheet} from './choice-sheet.js';
import {emptyHtml} from './wait-state.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KINDS={area:{label:'사업영역',title:'사업영역 선택'},org:{label:'조직',title:'조직 선택'}};
const RECENT_MAX=4;
// The first row of a one-choice sheet that picks nothing ('사업영역 없음' / '조직 없음').
const noneLabel=kind=>`${KINDS[kind].label} 없음`;
let sheet=null,current=null;
// The sheet's look (choice-sheet.css) and this file's (area-org-picker.css) are put in once, whatever screen mounts the lines
// (a screen's own list may have them already: matched by file name).
const STYLES=['./choice-sheet.css','./area-org-picker.css'];
export function ensureStyles(){
  if(typeof document==='undefined')return;
  const have=new Set([...document.querySelectorAll('link[rel="stylesheet"]')].map(l=>(l.getAttribute('href')||'').split('?')[0].split('/').at(-1)));
  for(const path of STYLES){if(have.has(path.split('/').at(-1)))continue;const link=document.createElement('link');link.rel='stylesheet';link.href=path;link.dataset.kptuViewStyle='1';document.head.append(link)}
}

// areas: [{key,name,depth}] in tree order → nodes with parent links and kids.
export function areaTree(areas){
  const roots=[],stack=[],byKey=new Map();
  for(const a of areas||[]){
    const depth=Math.max(0,Number(a.depth)||0),node={key:String(a.key),name:String(a.name||'이름 없는 사업영역'),depth,kids:[],parent:null};
    while(stack.length&&stack.at(-1).depth>=depth)stack.pop();
    node.parent=stack.at(-1)||null;(node.parent?node.parent.kids:roots).push(node);stack.push(node);byKey.set(node.key,node);
  }
  return {roots,byKey};
}
const pathOf=n=>{const out=[];for(let p=n.parent;p;p=p.parent)out.unshift(p.name);return out.join(' › ')};
// '상위 › 하위': a child shows its parent's name before its own.
const chipText=n=>n.parent?`${n.parent.name} › ${n.name}`:n.name;
// The tag text of one area key in a tree ('' when it is not there).
export const areaChipText=(tree,key)=>{const n=tree?.byKey?.get(String(key));return n?chipText(n):''};

// Counts the targets of saved links, newest first (the caller's rows), and keeps the most used ones (ties: the newer first).
export function frequentKeys(keys,known,max=RECENT_MAX){
  const count=new Map();
  (keys||[]).forEach((k,i)=>{if(!known.has(k))return;const c=count.get(k);if(c)c.n++;else count.set(k,{n:1,i});});
  return [...count.entries()].sort((a,b)=>b[1].n-a[1].n||a[1].i-b[1].i).slice(0,max).map(([k])=>k);
}

// The saved links of this workspace (notes and tasks alike), newest first, as 'p:<project>' / 'o:<organization>' keys.
// One small read per workspace while the page is open; a link saved anywhere drops it so the next open reads again.
const usedCache=new Map();
export function loadUsedKeys(rt,workspaceId){
  if(!rt?.api||!workspaceId)return Promise.resolve([]);
  if(!usedCache.has(workspaceId))usedCache.set(workspaceId,rt.api(`/rest/v1/app_record_links?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.confirmed&select=project_id,organization_id&order=created_at.desc&limit=300`)
    .then(rows=>(Array.isArray(rows)?rows:[]).map(r=>r.project_id?'p:'+r.project_id:r.organization_id?'o:'+r.organization_id:'').filter(Boolean))
    .catch(()=>{usedCache.delete(workspaceId);return []}));
  return usedCache.get(workspaceId);
}
export function forgetUsedKeys(){usedCache.clear()}
if(typeof window!=='undefined')['kptu:google-tasks-changed','kptu:basket-links-changed'].forEach(n=>window.addEventListener(n,forgetUsedKeys));

const check='<span class="home-choice-check" aria-hidden="true"></span>';
// S52-01 ③: a place that cannot be chosen again (already linked, locked = Map key → '이미 연결됨' …) stays in the list as gray text
// (searchable, not pressable), so the tree and the groups keep their shape.
const rowHtml=(key,name,depth,{path='',pressed=false,locked=''}={})=>locked?`<span class="home-choice-row aop-done" style="--home-choice-depth:${depth}" data-depth="${depth}" data-sheet-item data-aop-done="${esc(key)}"${path?` data-sheet-path="${esc(path)}"`:''} title="${esc(name)}"><span class="home-choice-name">${esc(name)}</span><span class="aop-done-note"> · ${esc(locked)}</span></span>`:`<button type="button" class="home-choice-row home-choice-pick" style="--home-choice-depth:${depth}" data-depth="${depth}" data-sheet-value="${esc(key)}"${path?` data-sheet-path="${esc(path)}"`:''} aria-pressed="${!!pressed}" title="${esc(name)}">${check}<span class="home-choice-name">${esc(name)}</span></button>`;
const foldHtml=(label,n,open)=>`<button type="button" class="aop-fold" data-aop-toggle aria-expanded="${open}" aria-label="${esc(label)} 하위 ${n}개 ${open?'접기':'펼치기'}"><span class="aop-fold-n">${n}</span><span class="aop-fold-mark" aria-hidden="true"></span></button>`;
function areaNodeHtml(n,open,pressed,locked){
  const row=rowHtml(n.key,n.name,n.depth,{path:n.depth?pathOf(n):'',pressed:pressed(n.key),locked:locked(n.key)});
  if(!n.kids.length)return `<div class="aop-node" data-sheet-section><div class="aop-line">${row}</div></div>`;
  const isOpen=open.has(n.key);
  return `<div class="aop-node${isOpen?' is-open':''}" data-sheet-section><div class="aop-line">${row}${foldHtml(n.name,n.kids.length,isOpen)}</div><div class="aop-kids">${n.kids.map(k=>areaNodeHtml(k,open,pressed,locked)).join('')}</div></div>`;
}
// The folding area list: the top areas only, a chevron opens one's children. tree: areaTree(); open: keys of open areas.
const noLock=()=>'';
export function areaListHtml(tree,{open=new Set(),pressed=()=>false,locked=noLock}={}){return (tree?.roots||[]).map(n=>areaNodeHtml(n,open,pressed,locked)).join('')}
// The folding organization list: each group (organization-order.js) is one big line, a press opens its organizations. When no
// organization falls in a named group (only the "그 외" tail) the organizations are plain rows. groups: [[{key,name,group}]].
export function orgListHtml(groups,{open=new Set(),pressed=()=>false,locked=noLock}={}){
  const list=(groups||[]).filter(g=>g?.length),named=list.length>1||!!(list[0]?.[0]?.group&&list[0][0].group!==window.KPTUOrganizationOrder?.GROUP_NAMES?.at(-1));
  if(!named)return list.flat().map(o=>`<div class="aop-node aop-org" data-sheet-section><div class="aop-line">${rowHtml(o.key,o.name,0,{pressed:pressed(o.key),locked:locked(o.key)})}</div></div>`).join('');
  return list.map((g,i)=>{const name=g[0].group||'그 외',id='g'+i,isOpen=open.has(id);
    return `<div class="aop-node aop-group${isOpen?' is-open':''}" data-sheet-section data-aop-group="${id}"><div class="aop-line"><button type="button" class="aop-group-name" data-aop-toggle aria-expanded="${isOpen}"><span class="aop-group-label">${esc(name)}</span><span class="aop-fold-n">${g.length}</span><span class="aop-fold-mark" aria-hidden="true"></span></button></div><div class="aop-kids aop-org-items">${g.map(o=>rowHtml(o.key,o.name,0,{pressed:pressed(o.key),locked:locked(o.key)})).join('')}</div></div>`}).join('');
}
// Which areas and organization groups start open: the ones holding a chosen key.
export function openKeysFor(tree,groups,keys){
  const open=new Set(),chosen=new Set([...(keys||[])].map(String));
  for(const k of chosen){let n=tree?.byKey?.get(k)?.parent;while(n){open.add(n.key);n=n.parent}}
  (groups||[]).filter(g=>g?.length).forEach((g,i)=>{if(g.some(o=>chosen.has(String(o.key))))open.add('g'+i)});
  return open;
}
// What the open sheet shows: current = {kind, multi, none, pending:Set, tree, orgGroups, areaKnown, orgKnown, used, host, commit(set)}.
function render(kind){
  const c=current,t=KINDS[kind];if(!c)return {title:t.title,html:''};
  const known=kind==='area'?c.areaKnown:c.orgKnown,pressed=k=>c.pending.has(k),locked=k=>c.locked?.get(k)||'';
  const recent=frequentKeys(c.used,new Map([...known].filter(([k])=>!locked(k)))).map(k=>`<button type="button" class="home-choice-chip" data-sheet-value="${esc(k)}" aria-pressed="${pressed(k)}">${esc(known.get(k))}</button>`);
  const open=openKeysFor(c.tree,c.orgGroups,c.pending);
  const body=kind==='area'?areaListHtml(c.tree,{open,pressed,locked}):orgListHtml(c.orgGroups,{open,pressed,locked});
  // A one-choice sheet may start with rows of its own (top: [{key,name,attrs}], e.g. '고르지 않음' and a gray '없음'); none:true is the
  // usual single '사업영역 없음' row. A row keyed '' is pressed when nothing is chosen.
  const tops=!c.multi?(c.top?.length?c.top:c.none?[{key:'',name:typeof c.none==='string'?c.none:noneLabel(kind)}]:[]):[];
  const none=tops.map(x=>`<div class="aop-node" data-sheet-section${x.attrs?' '+x.attrs:''}><div class="aop-line">${rowHtml(x.key,x.name,0,{pressed:x.key?c.pending.has(x.key):!c.pending.size})}</div></div>`).join('');
  return {title:c.title||t.title,search:'찾기',searchAlways:true,
    html:`${recent.length?`<div class="aop-recent" data-sheet-hide-on-search><p class="home-choice-label">자주 쓴 것</p><div class="home-choice-group home-choice-group-plain">${recent.join('')}</div></div>`:''}<div class="aop-list">${none}${body||(none?'':emptyHtml(`${t.label} 없음`,{attrs:'data-aop-empty'}))}</div>${createHtml(c)}`};
}
// CALL-상대표시정리 ④: 하나만 고르는 조직 창 맨 아래 [직접 쓰기] 칸(부르는 쪽이 create를 줄 때만). [만들기]를 누르면 비슷한 이름의 조직이 있으면
// 먼저 그 줄들을 보여 주고(누르면 그 조직을 고름), [그래도 새로 만들기]로만 새로 만든다. 만들기·저장은 부르는 쪽(create.make)이 한다.
// create = {make:async name → {key,name}, similar:name → [{key,name}]}.
function createHtml(c){
  const k=c?.create;if(!k||c.multi||c.kind!=='org')return '';
  const busy=k.busy?' disabled':'',ph='직접 쓰기 — 조직 이름';
  const similar=k.similar?.length?`<p class="aop-create-note">비슷한 조직이 있어요. 맞으면 눌러 선택하세요.</p>${k.similar.map(x=>rowHtml(x.key,x.name,0,{pressed:false})).join('')}<button type="button" class="row-act aop-create-force" data-aop-create-force${busy}>'${esc(k.text)}' 새로 만들기</button>`:'';
  return `<div class="aop-create" data-aop-create-box><div class="aop-create-row"><input type="text" class="aop-create-input" data-aop-create-input maxlength="120" autocomplete="off" placeholder="${ph}" aria-label="${ph}" value="${esc(k.text||'')}"${busy}><button type="button" class="row-act aop-create-go" data-aop-create${busy}>만들기</button></div>${similar}<p class="aop-create-note" data-aop-create-status role="status">${esc(k.status||'')}</p></div>`;
}
async function runCreate(force){
  const c=current,k=c?.create,box=sheet&&document.getElementById('areaOrgPickSheet');if(!k||k.busy||!box)return;
  const input=box.querySelector('[data-aop-create-input]'),name=String(input?.value??k.text??'').replace(/\s+/g,' ').trim();k.text=name;
  const paintKeep=focus=>{if(current!==c)return;sheet.render();box.querySelector(focus)?.focus({preventScroll:true})};
  if(!name){k.status='조직 이름을 써 주세요.';k.similar=null;paintKeep('[data-aop-create-input]');return}
  if(!force){const like=(k.find?.(name)||[]).filter(x=>x?.key);if(like.length){k.similar=like;k.status='';paintKeep('[data-aop-create-box] [data-sheet-value]');return}}
  k.busy=true;k.similar=null;k.status='만드는 중…';paintKeep('[data-aop-create-status]');
  try{const made=await k.make(name);if(current!==c)return;k.busy=false;c.pending=new Set([made.key]);c.commit(c.pending);void sheet.close()}
  catch(error){if(current!==c)return;k.busy=false;k.status=error?.message||'조직을 만들지 못했어요. 다시 눌러 주세요.';paintKeep('[data-aop-create-input]')}
}

function ensureSheet(){
  if(sheet)return sheet;
  sheet=createChoiceSheet({id:'areaOrgPickSheet',titleId:'areaOrgPickTitle',historyKey:'kptuAreaOrgPick',saveLabel:'넣기',width:360,
    canOpen:()=>!!current?.host?.isConnected,choices:async()=>{},render,onError:()=>{},
    onSelect:(kind,value)=>{const c=current;if(!c)return;
      // One choice: a press picks it (or '' = none) and the sheet closes on its own (choice-sheet.js, no multi).
      if(!c.multi){c.pending=new Set(value?[value]:[]);c.commit(c.pending);return}
      if(c.locked?.has(value))return;
      c.full=false;if(c.pending.has(value))c.pending.delete(value);else if(c.max&&c.pending.size>=c.max)c.full=true;else c.pending.add(value)},
    // max: how many may be kept at once (a press past it keeps the choice and says so in the count).
    multi:kind=>current?.multi?{pressed:v=>current.pending.has(v),label:current.full?`한 번에 ${current.max}곳까지`:current.pending.size?`${current.pending.size}개 선택됨`:''}:null,
    onCommit:kind=>{const c=current;if(c?.multi)c.commit(c.pending)}});
  const box=document.getElementById('areaOrgPickSheet');
  box?.addEventListener('click',e=>{const b=e.target.closest('[data-aop-create],[data-aop-create-force]');if(!b||!box.contains(b))return;e.stopPropagation();void runCreate(b.hasAttribute('data-aop-create-force'))});
  box?.addEventListener('input',e=>{if(e.target.matches?.('[data-aop-create-input]')&&current?.create){current.create.text=e.target.value;current.create.similar=null}});
  box?.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches?.('[data-aop-create-input]')&&!e.isComposing){e.preventDefault();void runCreate(false)}});
  return sheet;
}
function choiceState({areas=[],orgGroups=[],used=[]}){
  const tree=areaTree(areas),groups=(orgGroups||[]).map(g=>(g||[]).map(o=>({key:String(o.key),name:String(o.name||o.label||'이름 없는 조직'),group:o.group||''})));
  return {tree,orgGroups:groups,areaKnown:new Map([...tree.byKey.values()].map(n=>[n.key,n.name])),orgKnown:new Map(groups.flat().map(o=>[o.key,o.name])),used:[...(used||[])]};
}

// Opens the shared sheet straight from a screen's own button (a one-line field or a toolbar button), the same sheet as the lines.
// kind: 'area' | 'org'. areas / orgGroups / used as in the lines' set(). selected: the chosen keys. multi:false = one choice (a press
// picks and closes); none:true adds a first row that picks nothing (one choice only: '사업영역 없음' / '조직 없음').
// onCommit(keys:Set) runs on [넣기] (or the one press); cancelling runs nothing.
// locked: Map key → short text ('이미 연결됨') for places shown but not choosable. max: the most keys kept at once (multi only).
// title: the sheet's title when the screen names it otherwise (default '사업영역 고르기' / '조직 고르기').
// top: one-choice rows above the list ([{key,name,attrs}]); none: true or a label for the one '… 없음' row (top wins when given).
// create: (조직·하나만 고르기만) 맨 아래 [직접 쓰기] 칸 {make:async name → {key,name}, similar:name → [{key,name}]} (createHtml).
export function openAreaOrgPicker({kind='area',trigger,anchor=null,areas=[],orgGroups=[],selected=[],used=[],multi=true,none='',top=null,locked=null,max=0,title='',create=null,onCommit=()=>{}}={}){
  if(!trigger)return;ensureStyles();
  const st=choiceState({areas,orgGroups,used}),known=kind==='area'?st.areaKnown:st.orgKnown,topKeys=new Set((top||[]).map(x=>String(x.key)).filter(Boolean));
  current={...st,kind,multi:!!multi,none,top:Array.isArray(top)?top.map(x=>({key:String(x.key||''),name:String(x.name||''),attrs:x.attrs||''})):null,locked:locked instanceof Map?locked:null,max:Math.max(0,Number(max)||0),title,full:false,host:trigger,create:create&&typeof create.make==='function'?{make:create.make,find:typeof create.similar==='function'?create.similar:null,text:'',status:'',similar:null,busy:false}:null,pending:new Set([...selected].map(String).filter(k=>known.has(k)||(!multi&&topKeys.has(k)))),commit:keys=>onCommit(new Set(keys))};
  return ensureSheet().open(kind,trigger,anchor);
}

// Settles once the sheet has closed and given focus back (a screen that moves focus elsewhere after [넣기] waits for it).
export const areaOrgPickerClosed=()=>sheet?sheet.closed():Promise.resolve();
// Organization groups (organization-order.js groups()) of {id,name} as the picker's orgGroups, keyed 'o:<id>'.
export const orderedOrgGroups=(groups,order=typeof window!=='undefined'?window.KPTUOrganizationOrder:null)=>(groups||[]).map(g=>(g||[]).map(o=>({key:'o:'+o.id,name:o.name||'이름 없는 조직',group:order?.groupName?.(o)||''})));
// Closes the sheet (as a Back press would) when it was opened for this trigger (or any, with none given): a screen left behind.
export function dismissAreaOrgPicker(trigger=null){if(sheet&&current&&(!trigger||current.host===trigger))sheet.dismiss()}
// The keys of the saved links of the signed-in workspace (loadUsedKeys), for a screen that has no workspace id at hand.
export function usedKeysNow(rt=window.KPTURuntime){const ctx=rt?.context?.read?.();return loadUsedKeys(rt,ctx?.workspace?.id||ctx?.workspaceId||'')}
// Rows of the shared project catalog's tree ({project, depth}) as the picker's areas, keyed 'p:<id>'.
export const catalogAreas=rows=>(rows||[]).map(x=>({key:'p:'+x.project.id,name:x.project.name||'이름 없는 사업영역',depth:x.depth||0}));

// host: an empty box. onChange(): after [넣기] or a ✕ changed the choice. Returns {set, value, known, focus, disable(on, kind?)}.
// set({areas:[{key,name,depth}], orgGroups:[[{key,name,group}]], selected:Set|keys, used:[keys newest first]}).
// value(): the chosen keys among the offered ones; known(): every offered key (the caller keeps links it did not offer).
// kinds: which lines to show (default both, e.g. ['area'] for a screen that only takes a 사업영역). multi:false keeps one choice
// per line (the sheet picks and closes on a press, as openAreaOrgPicker).
// labels: a line's own name when the screen calls it otherwise (e.g. {org:'관련 담당조직'}).
export function mountAreaOrgLines(host,{onChange=()=>{},kinds=['area','org'],multi=true,labels={}}={}){
  if(!host)return null;
  ensureStyles();host.classList.add('aop-lines');
  const shown=Object.entries(KINDS).filter(([k])=>kinds.includes(k));
  host.innerHTML=shown.map(([k,t])=>{const label=esc(labels?.[k]||t.label);return `<div class="aop-row" data-aop-line="${k}"><span class="aop-label${labels?.[k]?' is-long':''}">${label}</span><span class="aop-chips" data-aop-chips="${k}"></span><button type="button" class="aop-add" data-aop-add="${k}" aria-haspopup="dialog" aria-expanded="false" aria-label="${label} 선택"></button></div>`}).join('');
  let state={...choiceState({}),selected:new Set()};
  function commit(kind,pending){const known=kind==='area'?state.areaKnown:state.orgKnown;for(const k of known.keys()){if(pending.has(k))state.selected.add(k);else state.selected.delete(k)}paint();onChange()}
  function chipLabel(kind,k){return kind==='area'?chipText(state.tree.byKey.get(k)):state.orgKnown.get(k)}
  function paint(){
    for(const [kind] of shown){
      const known=kind==='area'?state.areaKnown:state.orgKnown,keys=[...known.keys()].filter(k=>state.selected.has(k)),box=host.querySelector(`[data-aop-chips="${kind}"]`);
      box.innerHTML=keys.length?keys.map(k=>{const t=chipLabel(kind,k);return `<span class="aop-chip" data-aop-chip="${esc(k)}"><span class="aop-chip-text">${esc(t)}</span><button type="button" class="aop-chip-x" data-aop-remove="${esc(k)}" aria-label="${esc(t)} 빼기">✕</button></span>`}).join(''):emptyHtml('없음',{attrs:'data-aop-none'});
      const add=host.querySelector(`[data-aop-add="${kind}"]`);add.textContent=keys.length?'+':'+ 선택';add.classList.toggle('is-short',!!keys.length);
    }
  }
  host.addEventListener('click',e=>{
    const rm=e.target.closest('[data-aop-remove]');
    if(rm&&!rm.disabled){const k=rm.dataset.aopRemove,row=rm.closest('[data-aop-line]');state.selected.delete(k);paint();onChange();(row?.querySelector('[data-aop-remove]')||row?.querySelector('[data-aop-add]'))?.focus({preventScroll:true});return}
    const add=e.target.closest('[data-aop-add]');
    if(add&&!add.disabled){const kind=add.dataset.aopAdd,known=kind==='area'?state.areaKnown:state.orgKnown;
      current={...state,kind,multi,none:'',host,pending:new Set([...state.selected].filter(k=>known.has(k))),commit:keys=>commit(kind,keys)};
      void ensureSheet().open(kind,add,add.closest('[data-aop-line]'))}
  });
  paint();
  return {
    set({areas=[],orgGroups=[],selected=[],used=[]}={}){state={...choiceState({areas,orgGroups,used}),selected:new Set([...selected].map(String))};paint()},
    used(keys){state.used=[...(keys||[])]},
    value(){return new Set([...state.selected].filter(k=>state.areaKnown.has(k)||state.orgKnown.has(k)))},
    known(){return new Set([...state.areaKnown.keys(),...state.orgKnown.keys()])},
    focus(){host.querySelector('[data-aop-add]')?.focus({preventScroll:true})},
    // kind: only that line ('area' | 'org'), e.g. a line whose saved choice could not be read.
    disable(on,kind=''){host.querySelectorAll(kind?`[data-aop-line="${kind}"] button`:'button').forEach(b=>{b.disabled=!!on})},
  };
}
