// LIB-조직프로젝트자료종류: 자료 종류 칩 줄(여러 개를 함께 켜고 끄는 알약). 자료실의 종류 칩 코드를 그대로 꺼내 온 것이며,
// 자료실·담당조직 상세·프로젝트 상세의 [자료]가 모두 이 모듈 하나를 쓴다(새 칩 코드를 따로 만들지 않음).
// 칩은 '꺼 둔 종류 이름 모음(off)'으로 상태를 말한다: 꺼진 이름이 아닌 종류가 보인다. 저장은 이 모듈이 하지 않는다(부른 쪽이 정함).
import {allState,afterAllTap} from './library-view-pref.js';
import {fitChipRows} from './chip-rows.js';
import {pickedToggles} from './chip-rows-model.mjs';
import {documentCategories,subcategoriesOf,categoryParent,categoryLeaf,topCategoryOf,LOCKED_CATEGORY} from './document-categories.js';

// 담당조직·프로젝트 상세 [자료]가 처음 열릴 때 꺼 둘 종류(2026-10-24 명진 결정: '회의' 기본 켜짐).
// 자료실은 '회의'만 꺼진 채 열리지만(library-upload.js LU_DEFAULT_OFF, 서버에 기억한 설정이 있으면 그것), 상세 두 곳은
// 그 조직·프로젝트에 붙은 회의자료도 자료의 일부라 아무 종류도 끄지 않는다. 상세의 칩 상태는 저장하지 않으므로(열어 둔 동안만)
// 자료실에 기억한 설정은 상세에 쓰이지 않고, 상세를 새로 열 때마다 이 기본값에서 시작한다.
export const DETAIL_DEFAULT_OFF=Object.freeze([]);
export const detailDefaultOff=()=>new Set(DETAIL_DEFAULT_OFF);

// 칩 하나를 눌렀을 때의 새 off 모음. 'all'은 [전체]: 모두 켜졌으면 모두 끄고, 일부만 켜졌거나 모두 꺼졌으면 모두 켠다.
export function toggleCategoryOff(names,off,value){
  if(value==='all')return afterAllTap(names,off);
  const next=new Set(off);
  if(next.has(value))next.delete(value);else next.add(value);
  return next;
}

// LIB-소분류: 칩 줄은 큰 분류만 보이고(names = topDocumentCategories()), 큰 분류가 하나만 켜져 있으면 그 아래에 작은 소분류 줄
// '(큰 분류) 전체 · 소분류들 · + 소분류'를 그린다. 소분류는 하나만 고르며(''이면 그 큰 분류 전체), 고른 소분류는 상세를 열어 둔 동안·자료실을
// 보는 동안만 기억한다(서버에 기억하는 건 큰 분류 칩 상태뿐). 아래 셋은 부른 쪽 세 곳이 같은 규칙으로 거르도록 함께 쓴다.
// 켜진 큰 분류가 하나뿐이면 그 이름, 아니면 ''.
export function soleParent(names,off){const on=names.filter(name=>!off.has(name));return on.length===1?on[0]:'';}
// 지금 실제로 거르는 소분류: 고른 소분류가 켜진 유일한 큰 분류의 소분류이고 목록에 있을 때만, 아니면 ''.
export function activeSubcategory(names,off,sub){
  if(!sub)return '';
  const parent=soleParent(names,off);
  return parent&&categoryParent(sub)===parent&&subcategoriesOf(parent).includes(sub)?sub:'';
}
// 숨길 분류(전체 이름) 모음: 큰 분류가 꺼졌거나, 소분류를 골랐을 때 그 소분류가 아닌 것. 자료는 !hidden.has(categoryOf(값))로 거른다.
export function hiddenCategories(names,off,sub=''){
  const active=activeSubcategory(names,off,sub),hidden=new Set();
  for(const name of documentCategories()){
    if(off.has(categoryParent(name))||(active&&name!==active))hidden.add(name);
  }
  return hidden;
}

// LIB-맨위다듬기(S53-18, 시안 docs/design/mockups/library-top-bar.html): 칩 줄에 보이는 순서. '기타'는 늘 맨 끝(분류 수정 창과 같은 순서).
// 저장된 목록 순서는 바꾸지 않는다(보이는 순서만). 거르기·저장은 이름 모음(off)으로 하므로 순서와 상관없다.
export function chipOrder(names){
  const list=Array.isArray(names)?names:[...(names||[])];
  return [...list.filter(name=>name!==LOCKED_CATEGORY),...list.filter(name=>name===LOCKED_CATEGORY)];
}
// LIB-맨위다듬기: 색을 채울 칩(고른 칩만 채움). 모두 켜졌으면 [전체] 하나, 일부만 켰으면 '고른 칩'(켠 칩과 끈 칩 중 적은 쪽, chip-rows-model.mjs)이
// 켠 쪽일 때만 그 칩들. 몇 개만 꺼 둔 상태(처음 자료실: '회의'만 꺼짐)는 아무것도 채우지 않고 꺼진 칩만 흐리게 보인다.
// 켜짐·꺼짐 자체(aria-pressed)는 그대로이고, 이것은 보이는 색만 정한다.
export function filledChips(names,off){
  const state=allState(names,off);
  if(state==='all')return new Set(['all']);
  if(state==='none')return new Set();
  const picked=pickedToggles(names,off);
  return [...picked].every(name=>!off.has(name))?picked:new Set();
}

// LIB-맨위다듬기: 칩에 붙일 자료 수. 큰 분류마다(소분류 자료 포함) 0부터 센다. 부른 쪽 세 곳(자료실·담당조직·프로젝트 상세)이 같은 함수로 센다.
export function categoryCounts(names,docs){
  const counts=new Map([...(names||[])].map(name=>[name,0]));
  for(const d of docs||[]){const top=topCategoryOf(d?.category);if(counts.has(top))counts.set(top,counts.get(top)+1);}
  return counts;
}

// host 안에 [전체]+종류 칩을 그린다. 종류 이름이 같으면 단추를 다시 만들지 않아 초점·터치가 유지된다.
// key = 단추의 data 속성 이름(camelCase, 예 'luCategory' → data-lu-category). onToggle(value)는 누를 때마다 부른다('all'은 [전체]).
// 소분류 줄(LIB-소분류): onSub(value)를 주면 그린다(value ''은 큰 분류 전체). onAddSub(parent)를 주면 끝에 [+ 소분류].
// 켜진 큰 분류가 하나이고 그 큰 분류에 소분류가 있을 때만 보인다.
// subAfter: 소분류 줄을 붙일 자리(이 요소 바로 뒤, 기본 host). 줄은 host와 같은 렌더러가 그리고 지운다.
// counts(LIB-맨위다듬기): 큰 분류 이름 → 자료 수 Map. 주면 칩마다 작은 숫자(0도)를 붙인다(data-cc-count, 글자는 CSS가 그림 — 칩 이름은 그대로).
export function renderCategoryChips(host,{names,off,label,controls,key,onToggle,extraClass='',sub='',onSub=null,onAddSub=null,subAfter=null,counts=null}={}){
  if(!host)return;
  names=chipOrder(names);
  renderSubRow(host,{names,off,sub,onSub,onAddSub,subAfter,controls,key});
  const state=allState(names,off);
  host.classList.add('filter-chips','quick-mode-group','filter-chips-small');
  if(extraClass)host.classList.add(extraClass);
  host.setAttribute('role','group');host.setAttribute('aria-label',label);
  if(controls)host.setAttribute('aria-controls',controls);
  host._ccToggle=onToggle;
  const signature=JSON.stringify(names);
  if(host._ccSignature!==signature){
    const focused=host.contains(document.activeElement)?document.activeElement?.dataset[key]:null;
    host.replaceChildren(...['all',...names].map(value=>{const b=document.createElement('button');b.type='button';b.className='quick-pill-button';b.dataset[key]=value;b.textContent=value==='all'?'전체':value;return b}));
    host._ccSignature=signature;
    if(focused)[...host.children].find(b=>b.dataset[key]===focused)?.focus({preventScroll:true});
  }
  const fill=filledChips(names,off);
  for(const b of host.children){
    const value=b.dataset[key];
    if(value===undefined)continue;
    b.setAttribute('aria-pressed',value==='all'?(state==='all'?'true':state==='none'?'false':'mixed'):String(!off.has(value)));
    b.toggleAttribute('data-cc-fill',fill.has(value));
    const count=value!=='all'&&counts?.get?counts.get(value):undefined;
    if(count===undefined)delete b.dataset.ccCount;else b.dataset.ccCount=String(count||0);
  }
  if(!host._ccBound){
    host._ccBound=true;
    host.addEventListener('click',e=>{const b=e.target.closest('button');if(b?.parentElement===host&&b.dataset[host._ccKey]!==undefined)host._ccToggle?.(b.dataset[host._ccKey])});
  }
  host._ccKey=key;
  // UI-칩줄두줄: 두 줄 + [더보기 ▾](공용 chip-rows.js). 접혀도 [전체]와 고른 칩(켠 것·끈 것 중 적은 쪽)은 보인다.
  const picked=pickedToggles(names,off);
  fitChipRows(host,{keep:b=>b.dataset[key]==='all'||picked.has(b.dataset[key])});
}

// 칩 줄을 그리지 않고 숨길 때(자료 없음 등) 그 아래 소분류 줄을 걷는다.
export function clearCategorySubRow(host){if(host?._ccSubRow){host._ccSubRow.remove();host._ccSubRow=null;}}

function renderSubRow(host,{names,off,sub,onSub,onAddSub,subAfter,controls,key}){
  const parent=onSub?soleParent(names,off):'',subs=parent?subcategoriesOf(parent):[];
  let row=host._ccSubRow;
  // 소분류가 있는 큰 분류일 때만 줄을 그린다(첫 소분류는 [편집] 창의 큰 분류 줄 [+ 소분류]로 만든다).
  if(!parent||!subs.length){if(row){row.remove();host._ccSubRow=null;}return;}
  if(!row){
    row=document.createElement('div');row.className='cc-sub-row';row.setAttribute('role','group');
    row.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b||b.parentElement!==row)return;
      if(b.dataset.ccAddSub!==undefined)row._add?.(b.dataset.ccAddSub);
      else if(b.dataset.ccSub!==undefined)row._pick?.(b.dataset.ccSub);
    });
    host._ccSubRow=row;
  }
  const anchor=subAfter||host;
  if(row.previousElementSibling!==anchor)anchor.insertAdjacentElement('afterend',row);
  row._pick=onSub;row._add=onAddSub;row.hidden=host.hidden;
  row.setAttribute('aria-label',`${parent} 소분류`);
  if(controls)row.setAttribute('aria-controls',controls);
  const active=activeSubcategory(names,off,sub),signature=JSON.stringify([parent,subs,!!onAddSub]);
  if(row._ccSignature!==signature){
    const focused=row.contains(document.activeElement)?document.activeElement?.dataset.ccSub:null;
    const make=(value,text)=>{const b=document.createElement('button');b.type='button';b.className='cc-sub-chip';b.dataset.ccSub=value;b.textContent=text;return b};
    const items=[make('',`${parent} 전체`),...subs.map(name=>make(name,categoryLeaf(name)))];
    if(onAddSub){const b=document.createElement('button');b.type='button';b.className='cc-sub-add';b.dataset.ccAddSub=parent;b.textContent='+ 소분류';b.setAttribute('aria-label',`${parent}에 소분류 만들기`);items.push(b);}
    row.replaceChildren(...items);row._ccSignature=signature;
    if(focused!=null)[...row.children].find(b=>b.dataset.ccSub===focused)?.focus({preventScroll:true});
  }
  for(const b of row.children)if(b.dataset.ccSub!==undefined)b.setAttribute('aria-pressed',String(b.dataset.ccSub===active));
  row.dataset.ccSubFor=key||'';
  // UI-칩줄두줄: 소분류 줄도 같은 두 줄 + [더보기]. '(큰 분류) 전체'·고른 소분류·[+ 소분류]는 접혀도 보인다.
  fitChipRows(row,{keep:b=>b.dataset.ccSub===''||b.getAttribute('aria-pressed')==='true'||b.dataset.ccAddSub!==undefined});
}
