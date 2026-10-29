// MTG-프로젝트합치기 ①(명진 10/29 시안 승인): [사업영역 관리]는 따로 된 화면이 아니라 사업 보고 위에 뜨는 창이다.
// - 그릇: index.html의 #areaWindow(공용 .modal·.modal-card·.modal-head). 이 모듈은 창을 여닫기만 한다. 안의 목록·상세·⋯ 메뉴는
//   지금 사업영역 부품(project-system-v3.js, #projectsView·#projectGrid·#ps3DetailModal)이 그대로 그린다(한 영역 한 그리는 곳).
// - 열기: KPTUAreaWindow.open({id}) 하나. 사업 보고 ⋯ › 사업영역 관리, 다른 곳의 사업영역 연결(바구니 칩·홈·검색·원장·업무일지·할 일 레이더),
//   옛 주소(?view=projects·?project=, loader-v2·app-router의 detail.areas)가 모두 이 길로 연다. 지금 보던 화면은 그대로 둔다.
// - 닫기: ✕(PC)·‹ 사업 보고(폰)·Esc·뒤로가기. 닫으면 밑의 화면(사업 보고의 주·거르기)이 그대로 보인다. 폰 뒤로가기 기록은 공용
//   mobile-modal-history.js가 .modal에 붙이는 것 그대로다(상세 창 → 이 창 → 사업 보고 순서). 다른 화면으로 옮기면 기록을 남긴 채 조용히 닫는다.
// - 서버·기기 저장 없음.
import {hasBasketReturn} from './basket-note-tasks.js';
const $=s=>document.querySelector(s);
const win=()=>$('#areaWindow');
const PHONE=window.matchMedia?.('(max-width:760px)');
let seq=0;
const isOpen=()=>{const w=win();return !!w&&!w.classList.contains('hidden')};

// 넓은 화면(761px~): 앱 메뉴(왼쪽 세로·위쪽 한 줄)와 위쪽 줄은 덮지 않고 그 옆·아래 본문 자리에만 뜬다(쓰기 창 ed-window.js와 같은 방식).
// 메뉴를 누르면 그 화면으로 가며 이 창은 닫힌다. 폰은 하단바 위까지 전체 높이(CSS).
function place(){
  const w=win();if(!w)return;
  const nav=PHONE?.matches?null:document.querySelector('#appView>.app-nav'),top=PHONE?.matches?null:document.querySelector('#appView>.app-topline');
  const n=nav?.getClientRects().length?nav.getBoundingClientRect():null,t=top?.getClientRects().length?top.getBoundingClientRect():null;
  const side=!!n&&n.height>n.width;
  w.style.setProperty('--area-window-left',side?Math.max(0,Math.ceil(n.right))+'px':'0px');
  w.style.setProperty('--area-window-top',Math.max(0,Math.ceil(Math.max(!side&&n?n.bottom:0,t?t.bottom:0)))+'px');
}
window.addEventListener('resize',()=>{if(isOpen())place()});
// 사이드바 접기·펴기처럼 창 크기 없이 메뉴 폭만 바뀌어도 자리를 다시 잰다.
const navSize=typeof ResizeObserver==='function'?new ResizeObserver(()=>{if(isOpen())place()}):null;
const watchNav=()=>{const nav=document.querySelector('#appView>.app-nav');if(nav)navSize?.observe(nav)};
// PC 오른쪽 칸에 연 사업영역 이름: 위쪽 줄은 밑의 화면(사업 보고)을 가리키므로, 창 머리줄 '사업영역 관리 › 이름'이 그 자리다(project-system-v3.js의 kptu:where-item).
window.addEventListener('kptu:where-item',e=>{if(e.detail?.view!=='projects'||e.detail?.kind)return;const el=$('#areaWindow [data-area-window-item]');if(!el)return;const name=String(e.detail?.name??'').trim();el.textContent=name;el.hidden=!name});
function show(trigger){
  const w=win();if(!w)return false;if(isOpen())return true;
  watchNav();place();
  // 새로고침해도 창이 다시 뜨게 사업 보고 주소에 자리 하나(?view=reports&areas=1, app-router PLACE_PARAMS). 기기 저장 없음.
  if(window.KPTURouter?.current==='meetings')window.KPTURouter.setPlace?.('meetings',{areas:'1'});
  w.classList.remove('hidden');w.setAttribute('aria-hidden','false');document.documentElement.classList.add('area-window-open');
  window.KPTUA11y?.dialog.activate(w,{trigger,initialFocus:PHONE?.matches?'.area-window-back':'.area-window-close',onRequestClose:()=>{close()}});
  return true;
}

// 여는 길 하나. id가 있으면 창을 연 뒤 그 사업영역 상세를 연다(PC는 오른쪽 칸, 폰·중간 폭은 창 위의 상세 창).
async function open({id=null,trigger=document.activeElement}={}){
  const run=++seq;
  const after=async()=>{
    if(run!==seq)return;
    const was=isOpen();if(!show(trigger))return;
    // 다른 화면의 연결로 그 사업영역을 바로 연 창(direct): 폰에서 뒤로가기로 상세를 닫으면 창도 닫혀 한 번에 원래 자리로 돌아간다.
    if(!was){const direct=!!id&&window.KPTURouter?.current!=='meetings';win().dataset.areaDirect=direct?'1':'';
      // 연결로 바로 연 창은 PC에서도 뒤로가기 기록을 둔다(뒤로가기 한 번에 원래 자리). 사업 보고 ⋯로 연 창은 PC에서 기록 없이(폰만).
      if(direct)win().dataset.kptuHistoryAll='1';else delete win().dataset.kptuHistoryAll}
    if(!was)window.dispatchEvent(new CustomEvent('kptu:area-window',{detail:{open:true}}));
    const p=window.KPTUProjects;
    if(!was)await p?.shown?.();
    if(id&&run===seq&&isOpen())await p?.open?.(id);
  };
  const load=window.KPTUDeferredFeatures?.withView;
  if(load)return load('projects',after);
  await window.KPTUViewLoader?.load('projects');return after();
}

// silent: 다른 화면으로 옮겨 가며 닫을 때(뒤로가기 기록을 되돌리지 않음 — 그 사이 새 화면 기록이 이미 쌓였다).
// 저장 안 한 사업영역 글이 있어 그대로 두기로 하면 false.
function close({silent=false}={}){
  const w=win();if(!w||!isOpen())return true;
  seq++;
  if(window.KPTUProjects?.hide?.(silent)===false)return false;
  if(silent&&w.dataset.kptuHistoryOpen==='1')w.dataset.kptuHistoryClosing='pop';
  const dropPlace=()=>{if(!isOpen()&&window.KPTURouter?.current==='meetings')window.KPTURouter.setPlace?.('meetings',{areas:null})};
  // ✕·‹로 닫으면 공용 기록이 한 칸 되돌아간다(mobile-modal-history.js) — 돌아간 칸의 자리도 지운다.
  if(!silent&&w.dataset.kptuHistoryOpen==='1'&&history.state?.kptuOverlay==='areaWindow')window.addEventListener('popstate',()=>queueMicrotask(dropPlace),{once:true});
  if(!silent)queueMicrotask(dropPlace);
  w.classList.add('hidden');w.setAttribute('aria-hidden','true');document.documentElement.classList.remove('area-window-open');
  window.KPTUA11y?.dialog.deactivate(w,{restoreFocus:!silent,fallbackFocus:'#reportMore'});
  window.KPTUProjects?.place?.(); // 창이 닫힌 뒤에 상세를 칸에서 내린다(칸은 창이 떠 있을 때만)
  window.dispatchEvent(new CustomEvent('kptu:area-window',{detail:{open:false}}));
  return true;
}

// ✕·‹ 사업 보고(그리고 뒤로가기 때 mobile-modal-history.js가 누르는 같은 버튼). 공용 [data-close] 처리보다 먼저 받는다.
document.addEventListener('click',e=>{
  const b=e.target.closest?.('[data-close="areaWindow"]');if(!b)return;
  e.preventDefault();e.stopImmediatePropagation();close();
},true);
// 라우터: go('projects')·옛 주소는 detail.areas로 창을 연다. 그 밖의 화면 이동(아래 탭·메뉴)은 창을 닫는다.
window.addEventListener('kptu:dialog-closed',e=>{
  const m=e.detail?.modal;if(m?.id!=='ps3DetailModal'||!isOpen()||win().dataset.areaDirect!=='1'||m.dataset.ps3Docked==='1'||!m.classList.contains('hidden'))return;
  if(history.state?.kptuOverlay==='areaWindow')close(); // 뒤로가기로 닫힌 때만(× 로 닫으면 목록이 남는다)
});
window.addEventListener('kptu:view-changed',e=>{
  // 사업영역 상세에서 연 메모에서 돌아오면(← 돌아가기·뒤로가기) 창을 다시 열고, 그 사업영역·스크롤은 project-system-v3.js가 되살린다.
  if(e.detail?.areas||(e.detail?.view==='meetings'&&hasBasketReturn('projects'))){void open();return}
  if(isOpen())close({silent:true});
});

window.KPTUAreaWindow=Object.freeze({open,close,isOpen});
