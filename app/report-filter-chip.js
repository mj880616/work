// S67-75 UI-걸러보기칩하나(2026-11-21 명진 18:33 A안, 16:18 "사업영역 전체 박스 짤림" → PR 2847 흐림은 18:27 "이게 의도된 거라고?"로 걷어냄).
// 폰(~760px) 사업 관리 윗줄 = [아이콘][사업 관리][걸러보기 칩 하나 ▾] … [+][⋯]. 고르기 상자 네 개(종류·사업영역·기간·보기)가 그 줄에
// 다 들어가지 않을 때만 칩 하나로 묶고, 다 들어가면(폴드 펼침 등) 지금처럼 네 개 그대로다. 넓은 화면(761px~)은 늘 네 개.
// - 상태 주인은 그대로 team.js다: 값은 네 <select>(#reportKindSelect·#reportAreaSelect·#reportPeriodPick 안 [data-report-period]·#reportViewSelect)에
//   있고, 고르면 그 상자의 change → team.js가 반영·저장한다. 이 모듈은 상자를 읽어 칩 글자를 쓰고(team.js가 상자를 그린 뒤 paint()를 부름),
//   칩을 누르면 그 상자 줄(.report-kind-bar) 자체를 칩 바로 아래 작은 창으로 띄울 뿐이다(새 상태·복사한 상자 없음).
// - 작은 창 자리는 공용 placeAnchored·followAnchor(anchored-popup.js — 하단바·자판 위에서 끝남), 맨 위 층은 popover(열린 동안만).
//   하나를 고르면 바로 반영되고 창은 닫힌다(공용 고르기 창과 같음, [기간 정하기]·[주차 선택]이 아래 기간 줄에 여는 작은 창도 가리지 않음).
//   바깥 누르기·Esc·뒤로 가기로도 닫히고, 상자의 작은 목록(select-menu.js)이 떠 있는 동안은 그 목록이 먼저다.
import {isWide,placeAnchored,followAnchor,clearAnchored,bottomInset} from './anchored-popup.js';
import {filterChipText,selectedLabel,FILTER_CHIP_ALL} from './report-filter-chip-model.mjs';

const KEY='kptuReportFilter';
const $=s=>document.querySelector(s);
const topEl=()=>$('#meetingsView .report-top'),barEl=()=>$('#meetingsView .report-kind-bar'),chipEl=()=>$('#reportFilterChip');
let open=null,seq=0,lastWidth=-1;

const shownSel=s=>!!s&&!s.hidden&&!s.closest('[hidden]');
function parts(){
  const view=$('#reportViewSelect');
  return [$('#reportKindSelect'),$('#reportAreaSelect'),$('#reportPeriodPick [data-report-period]')].map(s=>({label:selectedLabel(s),on:!!s?.classList.contains('is-on'),shown:shownSel(s)}))
    .concat([{label:selectedLabel(view),on:!!view&&view.value!=='list',shown:shownSel(view)}]);
}

// 상자 네 개가 이 줄에 다 들어가는지 실제로 재고(칩을 숨기고 네 개를 놓아 봄) 칩 하나 / 네 개를 정한다. 같은 틀 안 계산이라 깜빡임 없음.
// S71-10(명진 11/26 14:41 '한 줄에 우겨넣고 싶어'): 주 줄(‹ 날짜 › · n건)도 모든 폭에서 이 첫 줄 안에 선다. 줄이 넘치면 차례로
// ① 요일을 뺀 날짜(is-week-short, '11.23~11.29') ② 건수를 짧게(is-week-tight, '3건', 줄 안 틈·‹ › 폭도 좁힘) ③ 그래도 넘치면 고르기 칩·상자가 줄어 끝 말줄임(is-week-squeeze).
// 단계는 같은 틀 안에서 실제 폭을 재어 정한다(깜빡임 없음). 기간 정하기·주차 고르기 창이 열려 있으면 그 창이 아래 한 줄을 다 쓰므로 재지 않는다.
const WEEK_STEPS=['is-week-short','is-week-tight','is-week-squeeze'];
function fitWeek(top){
  const week=top.querySelector(':scope > .report-week-bar');
  if(!week||week.hidden||!week.getClientRects().length)return;
  for(const step of WEEK_STEPS){if(top.scrollWidth<=top.clientWidth+1)return;top.classList.add(step)}
}
function layout(){
  const top=topEl(),bar=barEl(),chip=chipEl();if(!top||!bar||!chip)return;
  if(open){if(isWide())close(false,false);else place();return}
  // 기간 정하기·주차 고르기 창이 열려 있는 동안은 연 순간의 모양(칩 하나/상자 네 개, 줄인 단계)을 그대로 둔다 — 주 줄이 아래로 내려가
  // 고르기 자리가 넓어졌다고 칩이 상자 네 개로 바뀌면 누른 자리가 움직인다. 창이 닫히면(team.js가 다시 그림) 다시 잰다.
  if(top.querySelector(':scope > .report-week-bar .report-period-panel'))return;
  top.classList.remove('is-filter-one',...WEEK_STEPS);chip.hidden=true;
  if(!isWide()&&bar.getClientRects().length&&bar.scrollWidth>bar.clientWidth+1){top.classList.add('is-filter-one');chip.hidden=false}
  fitWeek(top);
}
function place(){const bar=barEl(),chip=chipEl();if(open&&bar&&chip)placeAnchored(bar,chip,{maxWidth:280,maxHeight:360,minHeight:120,bottomInset:bottomInset()})}

function openPanel(){
  const bar=barEl(),chip=chipEl();if(open||!bar||!chip||chip.hidden)return;
  open={id:'filter-'+(++seq),unfollow:null};
  bar.classList.add('is-filter-panel');bar.setAttribute('popover','manual');bar.showPopover?.();
  chip.setAttribute('aria-expanded','true');place();
  open.unfollow=followAnchor(bar,chip,{place,lost:()=>close(false,false)});
  history.pushState({...history.state,[KEY]:open.id},'',location.href);
  [...bar.querySelectorAll('select')].find(shownSel)?.focus({preventScroll:true});
}
function close(fromBack=false,focusChip=true){
  const was=open,bar=barEl(),chip=chipEl();if(!was)return;open=null;was.unfollow?.();
  if(bar){if(bar.matches(':popover-open'))bar.hidePopover();bar.removeAttribute('popover');bar.classList.remove('is-filter-panel');clearAnchored(bar)}
  chip?.setAttribute('aria-expanded','false');
  if(!fromBack&&history.state?.[KEY]===was.id)history.back();
  layout();if(focusChip&&chip&&!chip.hidden)chip.focus({preventScroll:true});
}

function bind(){
  const chip=chipEl(),bar=barEl(),top=topEl();if(!chip||!bar||!top||chip.dataset.bound)return;chip.dataset.bound='1';
  chip.addEventListener('click',()=>{if(open)close();else openPanel()});
  // 고르는 동안 뜨는 상자 목록(select-menu.js #kptuSelectMenu)이 떠 있으면 그 목록이 바깥 누르기를 먼저 받는다(목록만 닫힘).
  document.addEventListener('pointerdown',e=>{if(!open||window.KPTUSelectMenu?.active)return;const t=e.target instanceof Element?e.target:null;if(t&&(bar.contains(t)||chip.contains(t)||t.closest('#kptuSelectMenu')))return;close(false,false)},true);
  bar.addEventListener('keydown',e=>{if(open&&e.key==='Escape'&&!window.KPTUSelectMenu?.active){e.preventDefault();close()}});
  // 고르면(상자의 change — team.js가 먼저 받아 반영) 창을 닫는다. select-menu는 제 목록을 닫은 뒤에 change를 보내므로 뒤로 가기 기록이 겹치지 않는다.
  bar.addEventListener('change',()=>{if(open)queueMicrotask(()=>close())});
  window.addEventListener('popstate',e=>{if(open&&e.state?.[KEY]!==open.id)close(true,false)});
  window.matchMedia('(min-width:761px)').addEventListener?.('change',layout);
  // 줄 폭이 바뀌거나(폴드 접기·펴기·창 크기) 사업 관리가 다시 보일 때 다시 잰다. 폭만 보고(높이 무시) 다음 그림 차례에 한 번.
  let frame=0;
  new ResizeObserver(([entry])=>{const w=Math.round(entry.contentRect.width);if(w===lastWidth)return;lastWidth=w;if(!frame)frame=requestAnimationFrame(()=>{frame=0;layout()})}).observe(top);
  document.fonts?.ready?.then(()=>layout(),()=>{});
}

// team.js가 상자(종류·사업영역·기간·보기)를 그린 뒤 부른다.
export function paintReportFilterChip(){
  const chip=chipEl();if(!chip)return;bind();
  const text=filterChipText(parts()),label=chip.querySelector('.report-filter-chip-text');
  if(label&&label.textContent!==text)label.textContent=text;
  chip.classList.toggle('is-on',text!==FILTER_CHIP_ALL);chip.setAttribute('aria-label',`걸러보기: ${text}`);
  layout();
}
