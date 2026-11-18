// LIB-조직프로젝트자료종류: 자료 종류 칩 줄(여러 개를 함께 켜고 끄는 알약). 자료실의 종류 칩 코드를 그대로 꺼내 온 것이며,
// 자료실·담당조직 상세·프로젝트 상세의 [자료]가 모두 이 모듈 하나를 쓴다(새 칩 코드를 따로 만들지 않음).
// 칩은 '꺼 둔 종류 이름 모음(off)'으로 상태를 말한다: 꺼진 이름이 아닌 종류가 보인다. 저장은 이 모듈이 하지 않는다(부른 쪽이 정함).
import {allState,afterAllTap} from './library-view-pref.js';
import {pickedToggles} from './chip-rows-model.mjs';
import {documentCategories,subcategoriesOf,categoryParent,categoryLeaf,topCategoryOf,categoryOf,LOCKED_CATEGORY} from './document-categories.js';

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

// ---- ORG-자료칩드롭다운(요청함 11/14 "조직 자료 버튼 드롭다운 화"): 상세 [자료]의 종류는 [종류 전체 ▾] 고르기 상자 하나 ----
// 담당조직·프로젝트 상세가 같이 쓴다(전에는 칩 13개가 폰에서 두 줄). 상자는 사업 보고 [종류 전체 ▾]와 같은 공용 <select>이고, 열리는 작은 목록은
// select-menu.js(UI-모바일고르기칸)가 그린다: 줄마다 종류 이름 + 오른쪽 작은 건수(option data-count), 0건 종류는 흐리게(고를 수 없음) 맨 뒤.
// 고른 종류는 상자 글자에 그대로('교섭·합의 ▾'). 하나만 고른다. 고른 값은 상세를 열어 둔 동안만(저장 안 함, 부른 화면이 상태 주인).
// 값: 'all'(종류 전체) | 'k:큰 분류' | 's:소분류 전체 이름'(그 큰 분류 바로 아래 줄) | 'photo'(사진 n — LIB-사진숨김).
export const KIND_ALL='all',KIND_PHOTO='photo';
// 고른 값 → 거르기 상태 {off(꺼 둔 큰 분류), sub, photos}. 모르는 값(목록이 바뀜)은 전체.
export function kindPickState(names,value){
  const list=[...(names||[])],v=String(value||KIND_ALL);
  if(v===KIND_PHOTO)return {off:new Set(),sub:'',photos:true};
  if(v.startsWith('k:')){const n=v.slice(2);if(list.includes(n))return {off:new Set(list.filter(x=>x!==n)),sub:'',photos:false}}
  if(v.startsWith('s:')){const sub=v.slice(2),parent=categoryParent(sub);if(list.includes(parent)&&subcategoriesOf(parent).includes(sub))return {off:new Set(list.filter(x=>x!==parent)),sub,photos:false}}
  return {off:new Set(),sub:'',photos:false};
}
// 목록 줄: [{value,label,count,disabled}]. docs = 줄로 보이는 자료(사진 뺌), photos = 사진 수(0이면 줄 없음).
export function kindPickOptions(names,docs,{photos=0}={}){
  const order=chipOrder(names),top=categoryCounts(order,docs),each=new Map(),live=[],dead=[];
  for(const d of docs||[]){const c=categoryOf(d?.category);each.set(c,(each.get(c)||0)+1)}
  for(const name of order){
    const n=top.get(name)||0;
    if(!n){dead.push({value:'k:'+name,label:name,count:0,disabled:true});continue}
    live.push({value:'k:'+name,label:name,count:n,disabled:false});
    for(const sub of subcategoriesOf(name)){const k=each.get(sub)||0;if(k)live.push({value:'s:'+sub,label:`${name} › ${categoryLeaf(sub)}`,count:k,disabled:false})}
  }
  return [{value:KIND_ALL,label:'종류 전체',count:(docs||[]).length,disabled:false},...live,...(photos?[{value:KIND_PHOTO,label:'사진',count:photos,disabled:false}]:[]),...dead];
}
const escHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// host 안에 고르기 상자 하나를 그린다(목록이 같으면 option을 다시 만들지 않아 초점 유지). onPick(value)는 고를 때마다.
// 돌려주는 값 = 실제로 고른 값(목록에 없는 값이면 'all').
export function renderKindPick(host,{names,docs,photos=0,value=KIND_ALL,label='자료 종류',controls='',onPick}={}){
  if(!host)return KIND_ALL;
  const options=kindPickOptions(names,docs,{photos});
  if(!options.some(o=>o.value===value))value=KIND_ALL;
  let sel=host.querySelector(':scope > select[data-kind-pick]');
  if(!sel){
    host.innerHTML='<select class="cc-kind-select" data-kind-pick></select>';
    sel=host.firstElementChild;
    sel.addEventListener('change',()=>host._kindPick?.(sel.value));
  }
  host._kindPick=onPick;
  sel.setAttribute('aria-label',label);
  if(controls)sel.setAttribute('aria-controls',controls);
  const sig=JSON.stringify(options);
  if(sel._kindSig!==sig){sel.innerHTML=options.map(o=>`<option value="${escHtml(o.value)}" data-count="${o.count}"${o.disabled?' disabled':''}>${escHtml(o.label)}</option>`).join('');sel._kindSig=sig}
  sel.value=value;
  sel.classList.toggle('is-on',value!==KIND_ALL);
  return value;
}
