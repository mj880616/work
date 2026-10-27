// LIB-조직프로젝트자료종류: 자료 종류 칩 줄(여러 개를 함께 켜고 끄는 알약). 자료실의 종류 칩 코드를 그대로 꺼내 온 것이며,
// 자료실·담당조직 상세·프로젝트 상세의 [자료]가 모두 이 모듈 하나를 쓴다(새 칩 코드를 따로 만들지 않음).
// 칩은 '꺼 둔 종류 이름 모음(off)'으로 상태를 말한다: 꺼진 이름이 아닌 종류가 보인다. 저장은 이 모듈이 하지 않는다(부른 쪽이 정함).
import {allState,afterAllTap} from './library-view-pref.js';

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

// host 안에 [전체]+종류 칩을 그린다. 종류 이름이 같으면 단추를 다시 만들지 않아 초점·터치가 유지된다.
// key = 단추의 data 속성 이름(camelCase, 예 'luCategory' → data-lu-category). onToggle(value)는 누를 때마다 부른다('all'은 [전체]).
export function renderCategoryChips(host,{names,off,label,controls,key,onToggle,extraClass=''}={}){
  if(!host)return;
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
  for(const b of host.children){
    const value=b.dataset[key];
    b.setAttribute('aria-pressed',value==='all'?(state==='all'?'true':state==='none'?'false':'mixed'):String(!off.has(value)));
  }
  if(!host._ccBound){
    host._ccBound=true;
    host.addEventListener('click',e=>{const b=e.target.closest('button');if(b?.parentElement===host&&b.dataset[host._ccKey]!==undefined)host._ccToggle?.(b.dataset[host._ccKey])});
  }
  host._ccKey=key;
}
