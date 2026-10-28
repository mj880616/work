import {askConfirm} from './small-notice.js'; // UI-알림창정리: 브라우저 기본 확인창 대신 공용 작은 확인창
// REF-참고묶음 화면 2 (docs/design/ref-bundle.md 6절, 질문 1~7 추천안): the 참고 묶음 screen (?view=reference). This module is the
// only renderer of #referenceView: the bundle list (name · linked count · last date, head ⋯ [묶음 더하기]·[순서 바꾸기]) and one
// bundle's detail (its linked updates and notes, newest first; a row opens the original, its ⋯ [업데이트 열기]·[연결 해제];
// head ⋯ [이름 바꾸기]·[묶음 지우기] — the latter only for an empty bundle). PC (1024px~) shows list and detail side by side
// (split-resize.js); a phone shows the list, then the detail over it (one router layer, so Back returns to the list).
// Reads and writes are the owner's own: app_reference_bundles REST (reference-bundles-data.js) and the confirmed links to bundles
// (basket-link-records.js readLinkRecords({kind:'bundle'})). Disconnect is the shared disconnectWithUndo (5 seconds to undo).
// Loaded only when the screen is first opened (view-loader.js); no tab or sidebar item of its own.
import './enter-save.js';
import {readLinkRecords,noteExcerpt} from './basket-link-records.js';
import {disconnectWithUndo} from './basket-record-delete.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {mountSplitResize} from './split-resize.js';
import {requestBasketNote,requestNoteDocOpen} from './basket-note-tasks.js';
import {readReferenceBundles,createReferenceBundle,renameReferenceBundle,deleteReferenceBundle,saveBundleOrder,bundleStats,bundleErrorText,BUNDLE_NAME_MAX,sortBundles} from './reference-bundles-data.js';

const rt=window.KPTURuntime;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=sel=>document.querySelector(sel);
const scope=()=>{const c=rt.context.read();return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
const pc=window.matchMedia('(min-width:1024px)');
const md=value=>{const t=Date.parse(value);if(Number.isNaN(t))return '';const p=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'}).formatToParts(new Date(t));const get=k=>p.find(x=>x.type===k)?.value||'';return `${get('month')}.${get('day')}`;};
const MORE='<span class="more-dots" aria-hidden="true">⋯</span>';

let state=freshState(),run=0,layer=null,pendingOpen=null;
function freshState(){return {owner:'',loaded:false,loading:false,error:'',bundles:[],links:[],selected:null,mode:'',draft:'',order:null,status:'',detailStatus:'',busy:false};}

function install(){
  if($('#referenceView'))return;
  $('#appView')?.insertAdjacentHTML('beforeend',`<section id="referenceView" class="view-panel hidden" aria-labelledby="rbTitle"><h2 id="rbTitle" class="a11y-only">참고 묶음</h2><div class="rb-split" id="rbSplit"><div class="rb-list" id="rbList"></div><section class="rb-pane" id="rbDetail" aria-label="참고 묶음 상세"></section></div></section>`);
}
install();
const view=()=>$('#referenceView');

// ---------- data
async function load({keepSelection=true}={}){
  const owner=scope(),me=++run;state.loading=true;if(!state.loaded)paint();
  try{
    const [bundles,links]=await Promise.all([readReferenceBundles(rt),readLinkRecords({kind:'bundle',noteKinds:['basket','note']},rt)]);
    if(me!==run||owner!==scope())return;
    Object.assign(state,{owner,loaded:true,loading:false,error:'',bundles,links});
    if(!keepSelection||!bundles.some(b=>b.id===state.selected))state.selected=null;
  }catch(error){
    if(me!==run||owner!==scope())return;
    Object.assign(state,{loading:false,error:'참고 묶음을 불러오지 못했어요.'});
  }
  if(pendingOpen&&state.loaded){const id=pendingOpen;pendingOpen=null;if(state.bundles.some(b=>b.id===id)){select(id);return;}}
  paint();
}
const bundleOf=id=>state.bundles.find(b=>b.id===id)||null;
const linksOf=id=>state.links.filter(l=>l.bundle_id===id).sort((a,b)=>String(b.occurred_at||'').localeCompare(String(a.occurred_at||''))||String(b.id).localeCompare(String(a.id)));
const lineOf=l=>noteExcerpt(l.summary)||(l.note_kind==='note'&&l.title?String(l.title):'')||noteExcerpt(l.raw_text)||'(빈 업데이트)';

// ---------- paint (the only renderer of #referenceView)
function paint(){
  const root=view();if(!root)return;
  const wide=pc.matches,selected=bundleOf(state.selected);
  root.classList.toggle('rb-has-detail',!!selected);
  paintList();paintDetail();
  // Phone: list, or the chosen bundle's detail in its place. PC: both.
  $('#rbList').hidden=!wide&&!!selected;$('#rbDetail').hidden=!wide&&!selected;
  window.dispatchEvent(new CustomEvent('kptu:where-item',{detail:{view:'reference',name:wide&&selected?selected.name:null}}));
  // The ratio is the 담당조직 screen's (view_prefs split_ratio.team): the DB check accepts only tasks·projects·team·reports, and this
  // screen is entered from the organization list.
  mountSplitResize({container:$('#rbSplit'),name:'team',label:'참고 묶음 목록과 상세 칸 폭 조절',list:()=>$('#rbList'),pane:()=>$('#rbDetail'),active:()=>pc.matches&&!view()?.classList.contains('hidden')});
}
function paintList(){
  const box=$('#rbList'),stats=bundleStats(state.links);
  const head=`<div class="rb-list-head"><span class="rb-label">묶음</span><button type="button" class="rb-more" data-rb-list-more data-ctx="off" aria-haspopup="true" aria-expanded="false" aria-label="참고 묶음 메뉴"${state.order||state.busy?' disabled':''}>${MORE}</button></div>`;
  if(!state.loaded){box.innerHTML=head+`<p class="rb-empty" role="status">${esc(state.error||'불러오는 중…')}</p>${state.error?'<button type="button" class="rb-text-btn" data-rb-retry>다시 시도</button>':''}`;return;}
  const rows=(state.order||state.bundles).map((b,i,all)=>{
    const s=stats.get(b.id)||{count:0,last:''},meta=`${s.count}${s.last?' · '+md(s.last):''}`;
    if(state.order)return `<div class="rb-row rb-order-row" data-rb-order-row="${esc(b.id)}"><span class="rb-name">${esc(b.name)}</span><button type="button" class="rb-icon-btn" data-rb-up="${esc(b.id)}" aria-label="${esc(b.name)} 위로"${i===0?' disabled':''}>↑</button><button type="button" class="rb-icon-btn" data-rb-down="${esc(b.id)}" aria-label="${esc(b.name)} 아래로"${i===all.length-1?' disabled':''}>↓</button></div>`;
    const on=b.id===state.selected;
    return `<button type="button" class="rb-row${on?' is-selected':''}" data-rb-bundle="${esc(b.id)}"${on?' aria-current="true"':''}><span class="rb-name">${esc(b.name)}</span><span class="rb-meta">${esc(meta)}</span><span class="rb-chevron" aria-hidden="true">›</span></button>`;
  }).join('');
  const order=state.order?`<div class="rb-actions"><button type="button" class="rb-small" data-rb-order-cancel>취소</button><button type="button" class="rb-small primary" data-rb-order-save data-enter-save-submit>저장</button></div>`:'';
  const add=state.mode==='add'?`<div class="rb-inline" data-rb-add-form data-enter-save><input type="text" class="rb-input" data-rb-add-input maxlength="${BUNDLE_NAME_MAX}" aria-label="새 묶음 이름" placeholder="새 묶음 이름" value="${esc(state.draft)}"><button type="button" class="rb-small" data-rb-add-cancel>취소</button><button type="button" class="rb-small primary" data-rb-add-save data-enter-save-submit>저장</button></div>`:'';
  box.innerHTML=head+`<div class="rb-rows"${state.order?' data-enter-save':''}>${rows||'<p class="rb-empty">묶음이 없어요.</p>'}${order}</div>${add}<p class="rb-status" data-rb-status role="status">${esc(state.status)}</p>`;
}
function paintDetail(){
  const box=$('#rbDetail'),b=bundleOf(state.selected);
  if(!b){box.innerHTML='<p class="rb-empty rb-pane-empty">왼쪽에서 묶음을 고르면 붙인 소식이 보여요.</p>';return;}
  const rows=linksOf(b.id),count=rows.length;
  const title=state.mode==='rename'?`<div class="rb-inline" data-rb-rename-form data-enter-save><input type="text" class="rb-input" data-rb-rename-input maxlength="${BUNDLE_NAME_MAX}" aria-label="묶음 이름" value="${esc(state.draft)}"><button type="button" class="rb-small" data-rb-rename-cancel>취소</button><button type="button" class="rb-small primary" data-rb-rename-save data-enter-save-submit>저장</button></div>`
    :`<h3 class="rb-detail-name" id="rbDetailName">${esc(b.name)}</h3><span class="rb-meta">${count}개</span><button type="button" class="rb-more" data-rb-detail-more data-ctx="area" aria-haspopup="true" aria-expanded="false" aria-label="${esc(b.name)} 메뉴"${state.busy?' disabled':''}>${MORE}</button>`;
  const back=pc.matches?'':'<button type="button" class="back-text rb-back" data-rb-back>‹ 참고 묶음</button>';
  const list=count?`<ul class="rb-items">${rows.map(l=>{const kind=l.note_kind==='note'?'노트':'업데이트',line=lineOf(l);return `<li class="rb-item" data-rb-link="${esc(l.id)}"><button type="button" class="rb-item-open" data-rb-open="${esc(l.id)}"><span class="rb-date">${esc(md(l.occurred_at))}</span><span class="rb-line">${esc(line)}</span><span class="rb-kind">${kind}</span></button><button type="button" class="rb-more" data-rb-item-more="${esc(l.id)}" aria-haspopup="true" aria-expanded="false" aria-label="${esc([...line].slice(0,30).join(''))} 메뉴">${MORE}</button></li>`;}).join('')}</ul>`:'<p class="rb-empty">붙인 소식이 없어요. 정리함 [연결하기] › [참고 ▾]로 붙일 수 있어요.</p>';
  box.innerHTML=`${back}<div class="rb-detail-head">${title}</div><p class="rb-status" data-rb-detail-status role="status">${esc(state.detailStatus)}</p>${list}`;
}

// ---------- actions
function select(id,{focus=true}={}){
  if(state.mode||state.order){if(!confirmDrop())return;}
  state.selected=id;state.detailStatus='';
  if(!pc.matches&&id)layer||=window.KPTURouter?.layer?.open('reference-bundle',{close:()=>{layer=null;closeDetail({fromBack:true});return true;}})||null;
  paint();
  if(focus)(pc.matches?$(`#rbList [data-rb-bundle="${CSS.escape(id)}"]`):$('#rbDetail [data-rb-back]')||$('#rbDetail .rb-detail-name'))?.focus({preventScroll:true});
}
function closeDetail({fromBack=false}={}){
  const id=state.selected;state.selected=null;state.mode='';state.draft='';state.detailStatus='';
  const l=layer;layer=null;if(!fromBack)l?.close();
  paint();$(`#rbList [data-rb-bundle="${CSS.escape(id||'')}"]`)?.focus({preventScroll:true});
}
function confirmDrop(){const changed=state.order||(state.mode&&state.draft.trim());if(changed&&!window.confirm('바꾸던 내용을 버릴까요?'))return false;state.mode='';state.draft='';state.order=null;return true;}
const say=(text,detail=false)=>{if(detail)state.detailStatus=text;else state.status=text;const el=$(detail?'#rbDetail [data-rb-detail-status]':'#rbList [data-rb-status]');if(el)el.textContent=text;};

async function guarded(fn){
  if(state.busy)return;const owner=scope();state.busy=true;
  view()?.querySelectorAll('button,input').forEach(el=>el.disabled=true);
  try{await fn(()=>owner===scope());}finally{state.busy=false;if(owner===scope())paint();}
}
function startAdd(){state.mode='add';state.draft='';state.status='';paint();$('#rbList [data-rb-add-input]')?.focus();}
function addBundle(){
  const name=state.draft;
  return guarded(async current=>{
    try{const saved=await createReferenceBundle(name,state.bundles,rt);if(!current())return;state.bundles=sortBundles([...state.bundles,saved]);state.mode='';state.draft='';state.status=`'${saved.name}' 묶음을 더했어요.`;}
    catch(error){if(current())state.status=bundleErrorText(error);}
  }).then(()=>{(state.mode==='add'?$('#rbList [data-rb-add-input]'):$('#rbList [data-rb-list-more]'))?.focus();});
}
function startRename(){const b=bundleOf(state.selected);if(!b)return;state.mode='rename';state.draft=b.name;state.detailStatus='';paint();const input=$('#rbDetail [data-rb-rename-input]');input?.focus();input?.select();}
function renameBundle(){
  const b=bundleOf(state.selected);if(!b)return;const name=state.draft;
  if(name.trim()===b.name){state.mode='';state.draft='';paint();$('#rbDetail [data-rb-detail-more]')?.focus();return;}
  return guarded(async current=>{
    try{
      const saved=await renameReferenceBundle(b,name,rt);if(!current())return;
      if(!saved){state.detailStatus='그사이 이 묶음이 바뀌었어요. 최신 이름을 다시 불러왔어요.';state.mode='';await load();return;}
      state.bundles=state.bundles.map(x=>x.id===saved.id?saved:x);state.mode='';state.draft='';state.detailStatus='이름을 바꿨어요.';
      window.dispatchEvent(new Event('kptu:basket-links-changed'));
    }catch(error){if(current())state.detailStatus=bundleErrorText(error);}
  }).then(()=>{(state.mode==='rename'?$('#rbDetail [data-rb-rename-input]'):$('#rbDetail [data-rb-detail-more]'))?.focus();});
}
async function removeBundle(){
  const b=bundleOf(state.selected);if(!b||linksOf(b.id).length)return;
  if(!(await askConfirm(document.activeElement,{text:`'${b.name}' 묶음을 지울까요? 붙은 소식이 없는 빈 묶음이에요.`,ok:"지우기",danger:true})))return;
  return guarded(async current=>{
    try{const gone=await deleteReferenceBundle(b.id,rt);if(!current())return;
      if(!gone){state.detailStatus='지우지 못했어요. 목록을 다시 불러와 확인해 주세요.';await load();return;}
      state.bundles=state.bundles.filter(x=>x.id!==b.id);state.selected=null;state.status=`'${b.name}' 묶음을 지웠어요.`;const l=layer;layer=null;l?.close();
    }catch(error){if(current())state.detailStatus=bundleErrorText(error,'delete');}
  }).then(()=>$('#rbList [data-rb-list-more]')?.focus());
}
function startOrder(){state.order=[...state.bundles];state.mode='';state.status='';paint();$('#rbList [data-rb-up]:not([disabled]),#rbList [data-rb-down]:not([disabled])')?.focus();}
function move(id,step){
  const list=state.order,i=list.findIndex(b=>b.id===id),j=i+step;if(i<0||j<0||j>=list.length)return;
  [list[i],list[j]]=[list[j],list[i]];paint();
  ($(`#rbList [data-rb-${step<0?'up':'down'}="${CSS.escape(id)}"]:not([disabled])`)||$(`#rbList [data-rb-${step<0?'down':'up'}="${CSS.escape(id)}"]`))?.focus();
}
function saveOrder(){
  const ordered=state.order;if(!ordered)return;
  return guarded(async current=>{
    try{await saveBundleOrder(ordered,rt);if(!current())return;state.order=null;state.status='순서를 저장했어요.';await load();}
    catch(error){if(current()){state.status=bundleErrorText(error);}}
  }).then(()=>$('#rbList [data-rb-list-more]')?.focus());
}
function openOriginal(linkId){
  const l=state.links.find(x=>x.id===linkId);if(!l)return;
  if(l.note_kind==='note')requestNoteDocOpen(l.note_id,rt);else requestBasketNote(l.note_id,rt);
  window.KPTURouter?.go('basket',{source:'delegated'});
}
async function disconnect(linkId){
  const l=state.links.find(x=>x.id===linkId),b=l&&bundleOf(l.bundle_id);if(!l||state.busy)return;
  const owner=scope();state.busy=true;
  let result;
  try{result=await disconnectWithUndo(l,{name:b?.name||'참고 묶음',rt,isCurrent:()=>owner===scope(),onRestored:()=>{if(owner===scope())void load();}});}
  catch{result={status:'unknown',message:'결과를 확인하지 못했어요. 목록을 다시 불러와 실제 상태를 확인해 주세요.'};}
  finally{state.busy=false;}
  if(owner!==scope()||result.status==='stale')return;
  if(['deleted','missing'].includes(result.status)){
    const rows=linksOf(l.bundle_id),at=rows.findIndex(x=>x.id===linkId);
    state.links=state.links.filter(x=>x.id!==linkId);if(result.status==='missing')state.detailStatus=result.message||'';paint();
    const next=linksOf(l.bundle_id)[Math.min(Math.max(at,0),rows.length-2)];
    (next?$(`#rbDetail [data-rb-open="${CSS.escape(next.id)}"]`):$('#rbDetail [data-rb-detail-more]'))?.focus();return;
  }
  paint();if(result.status!=='cancelled'&&result.message)say(result.message,true);
  $(`#rbDetail [data-rb-item-more="${CSS.escape(linkId)}"]`)?.focus();
}

// ---------- menus (shared anchored menu: history, focus, outside click)
const menu=createAnchoredMenu({id:'rbMenu',className:'rb-menu',label:'참고 묶음 메뉴',historyKey:'kptuReferenceMenu',
  key:t=>t.dataset.rbItemMore?'item:'+t.dataset.rbItemMore:t.hasAttribute('data-rb-detail-more')?'detail':'list',
  render:id=>{
    if(id==='list')return '<button type="button" data-rb-act="add">묶음 더하기</button><button type="button" data-rb-act="order">순서 바꾸기</button>';
    if(id==='detail'){const b=bundleOf(state.selected);return '<button type="button" data-rb-act="rename">이름 바꾸기</button>'+(b&&!linksOf(b.id).length?'<button type="button" class="rb-menu-danger" data-rb-act="delete">묶음 지우기</button>':'');}
    return '<button type="button" data-rb-act="open">업데이트 열기</button><button type="button" class="rb-menu-danger" data-rb-act="disconnect">연결 해제</button>';
  },
  onAction:(button,active)=>{
    const act=button.dataset.rbAct,item=active.id.startsWith('item:')?active.id.slice(5):null;
    if(act==='add')startAdd();else if(act==='order')startOrder();else if(act==='rename')startRename();else if(act==='delete')void removeBundle();
    else if(act==='open'&&item)openOriginal(item);else if(act==='disconnect'&&item)void disconnect(item);
  }});

function bind(){
  const root=view();if(!root||root.dataset.rbBound)return;root.dataset.rbBound='1';
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b||b.disabled||!root.contains(b))return;
    const d=b.dataset;
    if(d.rbBundle)select(d.rbBundle);
    else if(b.hasAttribute('data-rb-back'))closeDetail();
    else if(b.hasAttribute('data-rb-retry'))void load();
    else if(b.hasAttribute('data-rb-list-more')||b.hasAttribute('data-rb-detail-more')||d.rbItemMore)menu.open(b);
    else if(d.rbOpen)openOriginal(d.rbOpen);
    else if(b.hasAttribute('data-rb-add-save'))void addBundle();
    else if(b.hasAttribute('data-rb-add-cancel')){state.mode='';state.draft='';paint();$('#rbList [data-rb-list-more]')?.focus();}
    else if(b.hasAttribute('data-rb-rename-save'))void renameBundle();
    else if(b.hasAttribute('data-rb-rename-cancel')){state.mode='';state.draft='';paint();$('#rbDetail [data-rb-detail-more]')?.focus();}
    else if(d.rbUp)move(d.rbUp,-1);else if(d.rbDown)move(d.rbDown,1);
    else if(b.hasAttribute('data-rb-order-save'))void saveOrder();
    else if(b.hasAttribute('data-rb-order-cancel')){state.order=null;paint();$('#rbList [data-rb-list-more]')?.focus();}
  });
  root.addEventListener('input',e=>{if(e.target.matches('[data-rb-add-input],[data-rb-rename-input]'))state.draft=e.target.value;});
  root.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(e.target.matches('[data-rb-add-input]')){e.preventDefault();state.mode='';state.draft='';paint();$('#rbList [data-rb-list-more]')?.focus();}else if(e.target.matches('[data-rb-rename-input]')){e.preventDefault();state.mode='';state.draft='';paint();$('#rbDetail [data-rb-detail-more]')?.focus();}});
}
bind();

// Shown: read once per owner (and again after links changed elsewhere). Left: the phone layer and any edit are dropped.
window.addEventListener('kptu:view-changed',e=>{
  if(e.detail?.view==='reference'){if(!state.loaded||state.owner!==scope())void load();else paint();return;}
  layer=null;if(state.mode||state.order){state.mode='';state.draft='';state.order=null;}
  menu.close?.(null,true);
  window.dispatchEvent(new CustomEvent('kptu:where-item',{detail:{view:'reference',name:null}}));
});
window.addEventListener('kptu:basket-links-changed',()=>{if(state.loaded&&state.owner===scope()&&!view()?.classList.contains('hidden'))void load();else if(state.loaded)state.loaded=false;});
window.addEventListener('kptu:session-changed',()=>{run++;layer=null;state=freshState();pendingOpen=null;if(view())paint();});
pc.addEventListener?.('change',()=>{if(view()&&!view().classList.contains('hidden')){if(pc.matches&&layer){const l=layer;layer=null;l.close();}paint();}});

// open(id): the screen with that bundle chosen (entries: the basket's "참고: ○○" chip, the organization list's 참고 묶음 ›).
async function open(id=null){
  if(window.KPTURouter?.current!=='reference')window.KPTURouter?.go('reference',{source:'delegated'});
  if(!id)return true;
  if(state.loaded&&state.owner===scope()&&state.bundles.some(b=>b.id===id)){select(id,{focus:false});return true;}
  pendingOpen=id;if(!state.loading||state.owner!==scope())await load();
  return true;
}
paint();
window.KPTUReference={open,reload:()=>load()};
