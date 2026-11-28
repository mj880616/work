import {emptyHtml,waitHtml} from './wait-state.js';
import {paperSkeletonHtml,weekBodyHtml} from './biz-week-skeleton.mjs';
// WEEKLY-메뉴짝짓기 P5(요청함 11/04 16:48 결정 B, 설계 docs/design/weekly-menu-pairing.md 3.2): 사업 보고 화면 위 접는 칸 '이번 주 주간보고'(팝업이 아님).
// (전 report-summary-preview.js — MTG-프로젝트합치기 2단계 [사업요약표 미리보기] 팝업을 이 칸으로 옮김. 팝업·기간 바꾸기·[HWP로 내려받기]는 없앴다.)
// - BIZ-위쪽정돈(B안, 11/09): 이 칸은 접는 칸이 아니라 늘 펼쳐 둔 칸이고 안쪽 주 고르기는 없다 — 사업 보고 화면 위의 주 고르기(‹ 11.9(월)~11.15(일) ›) 하나를 따른다(team.js가 week를 넘긴다). 한글 파일은 홈 [주간 정리] 한 곳에서만 만든다 → 맨 아래 [주간 정리에서 보기 ›].
// - 1) 사업요약표: 사업영역 | 세부 과제 | 진행 상황 및 이후 계획 | 담당. WEEKLY-화면정돈 ②(STD C10): '진행'·'담당' 칸마다 PC 우클릭·폰 꾹 누르기 → [수정][비우기]
//   (+ 홈 묶음 표 사업영역 줄은 [줄 빼기]), PC 두 번 누르기·칸에 초점 두고 Enter = [수정]. [수정]은 그 칸 자리에서 글상자(칸 크기, 글 따라 늘어남) + 오른쪽 위
//   '취소'·[저장]. Ctrl/⌘+Enter(담당은 Enter) 저장 · Esc 취소. 바깥을 눌러도 닫지 않고 쓰던 글을 둔다(다시 그려도 그대로). 칸 한 번 누르기는 아무 일 없음.
//   진행 = 그 주 임시저장 summary 칸(홈 [주간 정리] 1) 요약과 같은 칸), 담당 = 그 주 임시저장 owners 칸(한글 파일 담당 칸) — 저장 자리 하나(weekly-draft-store.js).
//   칸 아래 그 주 사업 보고 제목(사실 기록)은 누르면 그 보고가 열린다. AI 제안 없음(WEEKLY-요약표수기 S49-39). 예전에 저장된 AI 값은 보이지 않게만 두고 지우지 않는다.
// - 2) 주요 사업·회의결과: 전환 주부터는 주요 사업 창(biz-detail-window.js, 홈 [주간 정리] 2. 2)와 같은 부품). 그 앞 주는 그 주 사업 보고 줄(날짜순). 내가 '늘 빼기'로 정한 종류·단어(내 프로필 목록)는 journal-meeting-kinds.js reportsMeeting 한 곳으로 뺀다(주간 정리와 같음).
//   한 줄 업데이트(칸 oneline)는 표 칸 맨 위, 세부 내용에는 넣지 않는다(MTG-한줄업데이트).
// - BIZ-주간표이번주 ⑥(11/09): 사업 보고가 전체 기간·정한 기간이면(fold) 이 칸은 접힌 한 줄 '이번 주 주간보고 11.9~11.15 ⌄'로 시작하고 누르면 펼친다.
//   접힌 동안은 서버를 부르지 않고, 접힘은 기억하지 않는다(접는 보기로 들어올 때마다 접힘). 주 단위에서는 늘 펼침.
// - BIZ-주간보고접기(요청함 11/09 18:16, 위 '늘 펼침'을 바꿈): 어느 종류·어느 기간에서든 제목 줄이 접고 펴는 버튼이다.
//   펼침 = 손으로 고른 것(hand, 이 화면에 머무는 동안 — 종류를 바꿔도 유지, 화면을 떠났다 오거나(visit) 기간 보기(주 단위 ↔ 여러 주)를 바꾸면 잊음) > 자동(auto = 사업 보고 하나를 직접 열었음 → 접힘)
//   > 기본(주 단위 펼침, 여러 주 접힘). 접힌 동안은 표를 그리지 않고(서버 안 부름) 펼 때 그린다. 펼침이 바뀌면 onFold(open)으로 화면에 알린다
//   (위 띠 '사업영역 안 단 보고 n건'도 같이 접게).
// - BIZ-주간보고접힘기억(S56-13, 요청함 11/10 10:00 '기기별로 기억', 위 '화면에 머무는 동안만'을 바꿈): 제목 줄로 손으로 접고 펴면 서버 view_prefs에 기기 종류별로 기억한다(biz-week-fold.js).
//   펼침 = 보고를 연 동안 손으로 고른 것(hand — 보고를 닫거나 화면을 떠나면 잊음) > 자동(auto = 보고 하나를 열었음 → 접힘, 기억은 안 바꿈)
//   > 기억한 값(어느 종류·어느 기간·다시 들어와도·새로 고침 뒤에도) > 기본(주 단위 펼침, 여러 주 접힘). 보고를 닫으면 기억한 값으로 돌아간다.
// - 기기에 아무것도 저장하지 않는다(접힘 기억도 서버 view_prefs). 글은 로그에 쓰지 않는다.
// - ORG/BIZ-기록하나로 O-4 ②·B-3 ②(설계 docs/design/record-one.md 4절): 같은 부품을 사업 보고와 홈 [주간 정리] 2. 1)이 함께 쓴다
//   (createBizSummaryBox — 1) 사업요약표만). 어느 화면에서 지금 상황을 고쳐도 같은 자료(app_business_now)라 다른 화면 표도 다시 읽어 같은 글이 된다.
//   부품 하나가 한 화면 상자의 상태 주인이고 그리는 곳도 그 하나다(화면마다 따로 만든 표 없음).
import {previewRecords,weekOf,shiftDays,nextPlanLines,fullTable} from './business-area-model.mjs';
import {summaryCellKey} from './weekly-summary-hand.mjs';
import {weekLabel} from './weekly-org-lines-model.mjs';
import {seoulDateKey} from './meeting-time.js';
import {chevHtml} from './fold-chevron.mjs';
import {bizWeekOpen,setBizWeekOpen} from './biz-week-fold.js';
import {layoutAreas} from './weekly-area-layout.mjs'; // S67-30: 주간보고 칸 빼기·다른 칸 안으로(홈 [주간 정리] 2. 1)만)
import {rowMore} from './row-more.js';
import {askConfirm,notify} from './small-notice.js';
import {word} from './brand/brand.mjs';
import {partStyles} from './part-styles.js';
import {bindCellMenu} from './cell-menu.js'; // WEEKLY-화면정돈 ②: 칸 우클릭·꾹 누르기 메뉴(STD C10)
import {areaCellParts,cellText,splitCellText} from './weekly-area-cell.mjs'; // 0순위: 묶음 칸 줄 목록 한 곳(화면·고치기·한글 파일)
// S67-41: 이 부품의 모양 파일(part-styles.js 표)을 부품이 열리기 전에 붙인다 — 화면 모양 목록에 없어도 꾸밈 없이 그려지지 않게.
await partStyles('weekly-summary-table');

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortDay=day=>{const [,m,d]=day.split('-');return `${Number(m)}.${Number(d)}`};
// 지금 상황을 쓰는 부품(다른 부품은 그 글을 다시 읽는다 — 자기가 쓴 것은 다시 읽지 않음).
let writing=null,filledWs=''; // filledWs: 처음 한 번 채우기를 끝낸 작업공간(부품끼리 함께 — 한 번만 채움)
function createBizSummary({compact=false}={}){
let box=null,state=null,listening=false;
const self={};
// BIZ-주간칸밀림(11/09): 표가 다 그려지기 전에도 표 모양 자리(기다림 회색 줄)를 처음부터 차지해 아래가 밀리지 않게 한다.
// 큰 칸은 진짜 표와 같은 머리글·제목 글자·칸 폭의 표 모양(biz-week-skeleton.mjs, 사업 과제 4줄), 홈 작은 상자는 기다림 줄. 그리는 곳은 이 부품 하나(자리 → renderPaper가 같은 칸을 표로 바꿈).
const skeletonHtml=()=>compact?waitHtml({rows:4,h:51}):paperSkeletonHtml();
const $in=sel=>box?.querySelector(sel);
const JOURNAL_FOOT='<button type="button" class="biz-week-go" data-bw-journal>주간 보고에서 보기 ›</button>';

function ensureBox(el){
  if(box===el)return box;
  box=el;box.dataset.bpMounted='';
  // 기억한 접힘은 서버 화면 기억(view_prefs)이 늦게 오면 그때 다시 맞춘다(손으로 고른 것이 없을 때만 바뀜). 펼쳐지면 그때 그린다.
  if(!compact)window.addEventListener('kptu:view-prefs-ready',()=>{if(!state||state.none)return;applyFold(state.from);if(isOpen()&&(state.dirty||!state.view)&&state.seen){state.dirty=false;void paint()}});
  // 큰 칸(사업 보고)의 안은 mount가 사업영역 수를 보고 그린다(drawNone 또는 drawPaper) — 여기서 표 모양을 미리 그리지 않는다(BIZ-빈표잠깐보임다시).
  if(compact)box.innerHTML='<div class="biz-paper biz-week-paper biz-paper-compact" data-bp-paper>'+skeletonHtml()+'</div><p class="status biz-week-status" data-bp-status role="status" aria-live="polite"></p>';
  box.addEventListener('click',onClick);
  // WEEKLY-사업영역묶음 ②: 묶음 표의 [수정] 글 칸 위 '수정할 칸' 고르기(사업영역 자기 칸 · ◦ 세부 과제 칸).
  box.addEventListener('change',e=>{const p=e.target.closest?.('[data-bp-into-pick]');if(p){if(p.value)void layoutAct(p.dataset.bpIntoPick,{into:p.value},p);return}});
  // WEEKLY-화면정돈 ②: 칸 메뉴(우클릭·꾹 누르기)·두 번 누르기·Enter = [수정]. 쓰는 글은 칸을 다시 그려도 남게 상태에 둔다.
  bindCellMenu(box,{cell:'td[data-bp-cell]',skip:'button,summary,a',items:cellMenuItems,run:cellMenuRun});
  box.addEventListener('dblclick',e=>{const c=e.target.closest?.('td[data-bp-cell]');if(!c||e.target.closest('button,summary,a,[data-bp-field]'))return;startEdit(c.dataset.bpCell,Number(c.dataset.bpRow))});
  box.addEventListener('input',e=>{if(state?.editing&&e.target.matches?.('[data-bp-field]'))state.editing.value=e.target.value});
  // 글 칸: 진행 = Ctrl+Enter(맥은 ⌘+Enter), 담당 한 줄 칸 = Enter 저장. Esc = 쓰던 칸만 닫기(저장 안 함).
  box.addEventListener('keydown',e=>{
    const c=e.target.matches?.('td[data-bp-cell]')?e.target:null;
    if(c&&e.key==='Enter'&&!e.isComposing){e.preventDefault();startEdit(c.dataset.bpCell,Number(c.dataset.bpRow));return}
    if(!state?.editing)return;
    const field=e.target.closest?.('[data-bp-field]');if(!field)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();state.editing=null;renderPaper();return}
    if(e.key!=='Enter'||e.isComposing)return;
    if(field.tagName==='TEXTAREA'&&!(e.ctrlKey||e.metaKey))return;
    e.preventDefault();void saveEdit();
  });
  return box;
}
// 사업영역 없음 안내 한 줄(설계 2-4 글 그대로). [+ 사업 만들기]는 사업 보고 ⋯ [사업영역 관리]와 같은 창(area-window.js)을 연다.
function drawNone(){
  const body=box.querySelector('[data-bw-body]');
  body.innerHTML=word('<p class="biz-week-none">사업(예: 임단협, 조직 확대)을 만들면 회의·결과가 사업별로 모여요 <button type="button" class="row-act biz-week-new" data-bw-area-new>+ 사업 만들기</button></p>');
  box.dataset.bpReady='';box.dataset.bpBody='none';
}
// 사업영역이 있다고 확인된 칸: 표 모양 자리(BIZ-주간칸밀림) → paint가 같은 자리를 표로 바꾼다. 이미 표 자리면 그대로.
function drawPaper(){
  if(box.dataset.bpBody==='paper')return;
  box.querySelector('[data-bw-body]').innerHTML=weekBodyHtml(JOURNAL_FOOT);box.dataset.bpBody='paper';delete box.dataset.bpReady;
  if(state){if(state.none)state.freshPlaces=true;state.none=false;state.view=null;state.dirty=true} // 안내 → 표: 막 만든 사업영역이 표에 오게 연결할 곳 기억을 한 번 새로 읽는다
}
function say(text){const el=$in('[data-bp-status]');if(el)el.textContent=text||''}

async function onClick(e){
  if(!state)return;
  const areaNew=e.target.closest('[data-bw-area-new]');if(areaNew)return void window.KPTUAreaWindow?.open?.({trigger:areaNew});
  if(e.target.closest('[data-bw-fold],[data-bw-fold-end]')){const next=!isOpen();setBizWeekOpen(next);state.hand=state.auto?next:null;applyFold(state.from);if(next&&(state.dirty||!state.view)){state.dirty=false;void paint()}return}
  if(e.target.closest('[data-bp-edit-cancel]')){state.editing=null;return renderPaper()}
  if(e.target.closest('[data-bp-edit-save]'))return saveEdit();
  const recs=e.target.closest('[data-bp-recs]');if(recs)return toggleRecs(recs.dataset.bpRecs);
  // S67-30: 사업영역 줄 ⋯ — 다른 칸 안으로(고르기 칸 열기)·따로 두기·이 칸 빼기, 표 아래 [다시 넣기].
  const lay=e.target.closest('[data-bp-into],[data-bp-apart],[data-bp-hide],[data-bp-show],[data-bp-into-cancel]');
  if(lay){
    const d=lay.dataset,anchor=lay.closest('details')?.querySelector('summary')||lay;
    if('bpIntoCancel' in d){state.moving=null;renderPaper();return}
    if(d.bpInto){state.moving=d.bpInto;renderPaper();$in(`[data-bp-into-pick="${CSS.escape(d.bpInto)}"]`)?.focus({preventScroll:true});return}
    if(d.bpApart)return layoutAct(d.bpApart,{},anchor);
    if(d.bpHide)return layoutAct(d.bpHide,{hide:true},anchor);
    if(d.bpShow)return layoutAct(d.bpShow,{},anchor);
  }
  // RECORD-한줄: 사업 기록은 한 줄만 보이고, 한 줄이 원문과 다르면 누르면 원문이 그대로(작은 창, 읽기만).
  const raw=e.target.closest('[data-bp-raw]');if(raw){const r=findRec(raw.dataset.bpRaw);if(!r)return;const mod=await import('./record-raw-view.js');return mod.openRawRecord({text:r.full,day:state.kit.NM.dayText(r.day,r.end_day),line:r.text,trigger:raw})}
  const open=e.target.closest('[data-bp-open]');if(open){const mod=await import('./report-open.js');return mod.openReport(open.dataset.bpOpen)}
  if(e.target.closest('[data-bw-journal]')){const day=state.from;window.KPTURouter?.go?.('journal',{source:'delegated'});return waitJournal().then(j=>j?.showWeek?.(day))}
  // 칸 한 번 누르기는 아무 일도 하지 않는다(WEEKLY-화면정돈 ② — 고치기는 칸 메뉴·두 번 누르기·Enter).
}
// 업무일지 부품이 아직 안 불러와졌으면 잠깐(최대 5초) 기다린다.
async function waitJournal(){for(let i=0;i<50&&!window.KPTUJournal?.showWeek;i++)await new Promise(r=>setTimeout(r,100));return window.KPTUJournal}

// 칸 이름: 이번 주면 '이번 주 주간보고', 위에서 다른 주를 골랐으면 그 주 이름을 붙인다(이름과 보이는 주가 어긋나지 않게).
// 제목 줄 전체가 접고 펴는 버튼(공용 꺾쇠)이다(BIZ-주간보고접기 — 어느 보기에서든). 이번 주면 접혔을 때(또는 위 주 고르기가 없는 여러 주 보기에서) 이름 뒤에
// 날짜('11.9~11.15')를 붙인다 — 주 단위로 펼쳐 있으면 위 주 고르기와 겹치는 날짜를 또 쓰지 않는다.
// 홈 [주간 정리] 2. 1) 작은 상자(compact)는 제목 줄이 없고 늘 펼침이라 하지 않는다.
// BIZ-머리한줄(S71-23, 사용자 11/26 "시안 한줄 좋아"): 사업 관리가 주 단위로 볼 때는 주 넘기기 ‹ 11.23~11.29 ›가 이 제목 줄에 선다(첫 줄에서 옮김).
// 주 상태의 주인은 그대로 team.js(renderReportWeek가 nav 글자를 만들어 mount로 넘기고, 누름도 team.js가 받는다). 이 부품은 그 글자를 제목 줄에 놓기만 한다.
// nav가 있으면 날짜는 nav에만 있고(이름 뒤 날짜를 또 쓰지 않음), 이번 주가 아니면 이름은 '주간 보고'. 접고 펴기는 이름 단추 하나(aria-expanded), 줄 끝 꺾쇠 칸은 마우스·손가락 누름 자리만(같은 동작, 읽기 프로그램·Tab에는 없음).
const isOpen=()=>compact||!state?true:state.hand??(state.auto?false:bizWeekOpen()??!state.fold);
function applyFold(from){
  if(compact)return;
  const h=box?.querySelector('.biz-week-title'),body=box?.querySelector('[data-bw-body]');if(!h||!body)return;
  const now=weekOf(seoulDateKey(Date.now())).from;
  // MULTI-사업보고빈화면 ①: 사업영역이 없는 계정은 제목 줄·표 없이 안내 한 줄만(아래 drawNone). 접고 펴기도 없다.
  const nav=state.nav||'',navHtml=nav?`<span class="biz-week-nav" role="group" aria-label="주 넘기기">${nav}</span>`:'';
  // 사업영역이 없는 계정(안내 한 줄)도 주 단위면 주 넘기기만 남긴다(목록이 그 주를 따르므로).
  h.hidden=!!state.none&&!nav;
  if(state.none){box.setAttribute('aria-label',word('사업 만들기 안내'));body.hidden=false;h.innerHTML=navHtml;return}
  const name=nav?(from===now?`이번 주 ${word('주간 보고')}`:word('주간 보고')):from===now?`이번 주 ${word('주간 보고')}`:`${weekLabel(from)} ${word('주간 보고')}`;
  box.setAttribute('aria-label',name);
  const open=isOpen();
  body.hidden=!open;
  if(state.told!==open){state.told=open;state.onFold?.(open)}
  h.classList.toggle('has-nav',!!nav);
  h.innerHTML=nav
    ?`<button type="button" class="row-act biz-week-fold" data-bw-fold aria-expanded="${open}">${esc(name)}</button>${navHtml}<span class="biz-week-fold-end" data-bw-fold-end aria-hidden="true">${chevHtml(open)}</span>`
    :`<button type="button" class="row-act biz-week-fold" data-bw-fold aria-expanded="${open}">${esc(name)}${from===now&&(state.fold||!open)?` <span class="biz-week-range">${esc(weekLabel(from))}</span>`:''} ${chevHtml(open)}</button>`;
}
const isWeek=(from,to)=>weekOf(from).from===from&&shiftDays(from,6)===to;
async function paint(){
  const paper=$in('[data-bp-paper]'),{from,to}=state;
  applyFold(from);say('');
  const run=++state.run;state.editing=null;
  try{
    const [{placeRecords},{meetingLine},sheet,kinds,store]=await Promise.all([import('./journal-weekly.js'),import('./journal-data.js'),import('./report-places-sheet.js'),import('./journal-meeting-kinds.js'),import('./weekly-draft-store.js')]);
    const kit=await nowKit();
    if(state.freshPlaces){state.freshPlaces=false;sheet.forgetReportPlaces()}
    // 사업 나무: 화면이 이미 읽은 나무를 넘겨주면 그것(홈 — 따로 읽지 않음), 아니면 사업 보고의 연결할 곳 읽기.
    const places=state.tree?{projects:state.treeSeen||null}:await sheet.loadReportPlaces().catch(()=>null);
    // 늘 빼는 회의 종류·'빼기' 단어(내 프로필 목록, 못 읽으면 아무것도 빼지 않음 — reportsMeeting). 주간 정리와 같은 한 곳.
    const read=await kinds.readKinds().catch(()=>({status:'unknown'}));
    const hidden=read?.status==='ok'?read.list:null;
    // BIZ-기록하나로 B-3: 전환 주(RECORD_ONE_FROM)부터 진행·담당 칸 = 사업 '지금 상황'(app_business_now, 이어 씀). 그 앞 주는 옛 임시저장 칸을 읽기만(옛 보고).
    const fresh=isWeek(from,to)&&!kit.NM.isOldWeek(from);
    let draft=null,editable=false,note='';
    if(fresh){/* 아래에서 지금 상황을 읽는다 */}
    else if(isWeek(from,to)){
      try{const d=await store.readWeekDraft(from);if(!d.missing)draft=d.row?.draft??null}catch{/* 옛 보고를 못 읽으면 사업 보고 줄만 */}
      note='옛 보고라 수정할 수 없어요.';
    }else note='한 주(월~일)를 볼 때 칸에 직접 쓸 수 있어요.';
    if(!state||run!==state.run)return;
    const meetings=state.meetings().filter(m=>kinds.reportsMeeting(m,hidden));
    const lineOf=mt=>meetingLine({...mt,meeting_at:null}); // 표·세부 줄은 시각 없이(날짜는 세부 줄 앞에 따로)
    const {records,untagged,all}=previewRecords(meetings,{from,to,lineOf});
    const placed=placeRecords(records,places?.projects||null);
    const areas=fullTable(placed.areas,places?.projects||null);
    let now=null,nowStatus='';
    if(fresh){
      now=await loadNow({kit,store,from,areas,tree:places?.projects||null});nowStatus=now.status;
      if(!state||run!==state.run)return;
      editable=now.status==='ready';
      if(now.status==='missing')note='저장 칸이 아직 준비되지 않아 지금은 쓸 수 없어요.';
      else if(now.status==='error')note='지금 상황을 불러오지 못해 지금은 쓸 수 없어요.';
      else if(now.recsFailed)note='이번 주 기록을 불러오지 못했어요.';
      if(now.status!=='ready')now=null;
    }
    // BIZ-기록하나로 B-4 ②: 전환 주부터 2) 주요 사업·회의결과 = 홈 [주간 정리] 2. 2)와 같은 주요 사업 창 부품(biz-detail-window.js, 상자마다 하나).
    if(fresh&&!compact){const mod=await import('./biz-detail-window.js');if(!state||run!==state.run)return;state.detail||=mod.createBizDetailBox({onReady:()=>placeDetail()});await state.detail.update({week:from,meetings:state.meetings,hidden,tree:()=>places?.projects||null});if(!state||run!==state.run)return} // 2) 상자가 그 주를 다 읽은 뒤 1) 표와 한 번에 그린다(아래 목록이 한 번만 밀리게)
    state.view={placed:{...placed,areas},records,untagged,all,lineOf,detail:fresh&&!compact};
    state.draft=draft;state.editable=editable;state.store=store;state.now=now;state.kit=kit;
    state.done={run,from,now:fresh?nowStatus:''}; // 한글 파일(fileRows)이 '그 주를 다 그렸나'를 본다
    renderPaper();say(note);
  }catch(err){if(state&&run===state.run){state.done={run,from,now:'error'};paper.innerHTML=`<p class="journal-muted">${esc(err?.message||'미리보기를 만들지 못했어요.')}</p>`;box.dataset.bpReady=''}}
}
function renderPaper(){
  if(!state?.view)return;
  const {placed,records,untagged,all,lineOf}=state.view;
  $in('[data-bp-paper]').innerHTML=paperHtml(laidOut(placed),records,untagged,all,lineOf);
  for(const slot of box.querySelectorAll('[data-bp-more]')){let spec=null;try{spec=JSON.parse(slot.dataset.bpMore)}catch{/* 깨진 자리표는 ⋯ 없이 */}if(spec)slot.replaceWith(rowMore(document,spec));else slot.remove()}
  placeDetail();
  box.dataset.bpReady=''; // 표가 처음 그려짐 — 이제부터 자리 잡기(CSS min-height)를 풀고 표 높이를 따른다
  const field=$in('[data-bp-field]');if(field){field.focus({preventScroll:true});if(field.select&&field.tagName==='INPUT')field.select();else if(field.setSelectionRange){const n=field.value.length;field.setSelectionRange(n,n)}} // 글 칸은 기존 글 끝에 커서
}

// 2) 주요 사업 창 상자는 그 주를 다 읽은 뒤에만 자리 줄(표 모양 자리와 같은 한 줄)과 바꿔 붙인다 — 아래 목록이 두 번 밀리지 않게(BIZ-주간칸밀림).
// 이미 붙어 있으면 그대로 옮겨 붙인다(쓰던 칸 그대로).
function placeDetail(){const slot=$in('[data-bp-detail]'),d=state?.detail;if(slot&&d&&d.ready(state.from))slot.replaceWith(d.el)}
// ---- 직접 쓰기(진행 상황 및 이후 계획 · 담당) ----
// 표의 한 줄 = 사업영역 이름 + 세부 과제 이름. 칸 이름은 홈 [주간 정리]와 같은 규칙(weekly-summary-hand.mjs)으로 맞춘다.
function rowRefs(){return state.rowRefs||[]}
// 이 주 임시저장의 칸(홈 [주간 정리] 1) 요약의 같은 칸)에 쓴 줄 / 담당.
const cellKeyOf=(area,task)=>summaryCellKey(state.store.summaryKeys(state.draft),area,task);
function savedProgress(area,task){
  if(!state.draft||!state.store)return [];
  return state.store.cellVisibleLines(state.draft,{section:'summary',key:cellKeyOf(area,task),n:0});
}
function savedOwner(area,task){
  if(!state.draft||!state.store)return '';
  return state.store.draftOwners(state.draft)[cellKeyOf(area,task)]||'';
}
function startEdit(kind,row){
  if(!state?.editable){say($in('[data-bp-status]')?.textContent||'지금은 쓸 수 없어요.');return}
  const ref=rowRefs()[row];if(!ref)return;
  state.editing={kind,row};renderPaper();
}
// ---- WEEKLY-화면정돈 ②(STD C10): 칸 메뉴 ----
function cellMenuItems(cell){
  if(!state?.editable||state.editing)return [];
  const kind=cell.dataset.bpCell,row=Number(cell.dataset.bpRow),ref=rowRefs()[row];if(!ref)return [];
  const empty=!cellHasText(kind,row);
  const area=cell.closest('tr[data-bp-area]')?.dataset.bpArea;
  return [{id:'edit',label:'수정'},{id:'clear',label:'비우기',off:empty},
    ...(kind==='progress'&&area&&canLayout()?[{id:'hide',label:'줄 빼기',last:true}]:[])];
}
function cellMenuRun(id,cell){
  const kind=cell.dataset.bpCell,row=Number(cell.dataset.bpRow);
  if(id==='edit')return startEdit(kind,row);
  if(id==='clear'){if(!cellHasText(kind,row)){say('비울 글이 없어요.');return}return clearCell(kind,row,cell)}
  if(id==='hide'){const area=cell.closest('tr[data-bp-area]')?.dataset.bpArea;if(area)return layoutAct(area,{hide:true},cell)}
}
// 칸 하나가 고치는 칸들(묶음 표 진행 칸 = 사업영역 자기 칸 + 세부 과제 칸들, 그 밖에는 그 칸 하나).
function cellSpaces(kind,row){
  const ref=rowRefs()[row];if(!ref)return [];
  const g=kind==='progress'?state.groupRefs?.get(row):null;
  return g?[g.own,...g.subs]:[ref];
}
function cellHasText(kind,row){
  if(!state?.now)return false;
  const {NM}=state.kit;
  return cellSpaces(kind,row).some(r=>{const v=NM.nowView(state.now.rows,r.space,state.from);return !!(kind==='owner'?v.owner:v.body).trim()});
}
async function saveEdit(){
  const ed=state?.editing;if(!ed)return;
  const field=$in('[data-bp-field]'),ref=rowRefs()[ed.row];if(!field||!ref)return;
  // 쓸 수 있는 칸은 전환 주의 '지금 상황'뿐이다(RECORD-한줄 B-5: 옛 주 임시저장 칸 쓰기 길·지금 상황 표 404 때 옛 칸으로 가는 길은 지움).
  if(state.now)return ed.kind==='progress'&&state.groupRefs?.get(ed.row)?saveAreaCell(ed,field):saveNowEdit(ed,field,ref);
  state.editing=null;renderPaper();say('지금은 쓸 수 없어요.');
}

// 표의 한 칸: 쓴 글이 있으면 그 줄들, 없으면 그 주 사업 보고 제목(사실 기록)들 + 이후 계획(다음 할 일, 중복 없이). 한 줄 업데이트는 맨 위.
function factsHtml(items,records){
  const progress=items.map(item=>{const rec=records.find(r=>r.day===item.day&&r.text===item.text&&!r.used);if(rec)rec.used=true;return {item,rec}});
  const plans=[...new Set(progress.flatMap(p=>p.rec?.requests||[]))];
  const lineHtml=({item,rec})=>`<button type="button" class="biz-cell-line" ${rec?`data-bp-open="${esc(rec.meeting)}"`:''}>- ${esc(item.label&&item.issue?item.label.split(' › ').at(-1)+': ':'')}${esc(item.text)}</button>`;
  const ones=progress.filter(p=>p.rec?.oneline),rest=progress.filter(p=>!p.rec?.oneline);
  return `${[...ones,...rest].map(lineHtml).join('')}${plans.length?`<p class="biz-cell-plan">→ 이후: ${plans.map(esc).join(' / ')}</p>`:''}`;
}
// WEEKLY-화면정돈 ②: 칸 자리 글상자 — 칸 크기 그대로(글 따라 높이 늘어남), 오른쪽 위 글자 '취소' + 작은 [저장]. 안내 줄·칸 고르기·삭제 단추 없음.
// 쓰던 글(state.editing.value)이 있으면 그것(다시 그려도 그대로).
function editBox(kind,value,label,max=kind==='owner'?60:2000){
  const v=state?.editing?.value??value;
  const input=kind==='owner'?`<input type="text" maxlength="${max}" value="${esc(v)}" data-bp-field aria-label="${esc(label)}">`
    :`<textarea data-autogrow rows="2" maxlength="${max}" data-bp-field aria-label="${esc(label)}">${esc(v)}</textarea>`;
  return `<div class="cell-edit"><span class="cell-edit-acts"><button type="button" class="cell-edit-cancel" data-bp-edit-cancel>취소</button><button type="button" class="mini" data-bp-edit-save>저장</button></span>${input}</div>`;
}
function progressCell(ref,row,items,records){
  if(state.now)return nowProgressCell(ref,row,items,records);
  const ed=state.editing,mine=ed&&ed.kind==='progress'&&ed.row===row;
  const saved=savedProgress(ref.area,ref.task),facts=factsHtml(items,records);
  if(mine){
    const value=saved.length?saved.join('\n'):items.map(it=>`- ${it.label&&it.issue?it.label.split(' › ').at(-1)+': ':''}${it.text}`).join('\n');
    return editBox('progress',value,`${ref.area} ${ref.task} 진행 상황 및 이후 계획`);
  }
  return saved.length?saved.map(l=>`<p class="biz-hand-line">${esc(l)}</p>`).join(''):facts;
}
function ownerCell(ref,row){
  if(state.now)return nowOwnerCell(ref,row);
  const ed=state.editing,mine=ed&&ed.kind==='owner'&&ed.row===row,value=savedOwner(ref.area,ref.task);
  if(mine)return editBox('owner',value,`${ref.area} ${ref.task} 담당`);
  return esc(value);
}
// 고칠 수 있는 칸 표시(STD C10): 칸 메뉴·두 번 누르기·Enter가 이 표시로 칸을 찾는다. 쓸 수 없으면(옛 주·읽는 중) 표시 없음.
function cellAttrs(kind,row,label){
  if(!state?.editable)return '';
  return ` data-bp-cell="${kind}" data-bp-row="${row}" data-cell-key="${kind}:${row}" data-cell-label="${esc(label)}" tabindex="0"`;
}
// ---- BIZ-기록하나로 B-3: 진행 칸 = 사업 '지금 상황'(설계 docs/design/record-one.md 2-4·2-7·3-1) ----
// 그 주에 보이는 글 = 같은 사업의 week_start ≤ 그 주인 가장 나중 행(지난주 글이 이번 주에 이어 보임). 이번 주에 고치면 이번 주 행(지난주 행은 그대로).
// 처음 한 번 채우기: 지금 상황 행이 하나도 없는 사업만 전환 주 행으로 — 전환 주(없으면 그 앞 주) 임시저장의 같은 칸 글(명진이 그 주에 직접 쓴 줄,
// 없으면 weekly-base.js가 그 주에 깔아 둔 한글 파일 바탕 칸 글)·담당. 둘 다 없으면 '—'. 사람이 쓴 행은 덮지 않는다(DB 고유 색인 + 건너뛰기).
// 칸 아래 흐린 '이번 주 기록 n' = 그 주 사업 보고 줄 + 그 주에 걸친 사업 기록(읽기만, 누르면 펼침, 보고 줄은 누르면 그 보고가 열림).
const nowKit=()=>Promise.all([import('./business-now-model.mjs'),import('./business-now-data.js'),import('./fold-chevron.mjs')]).then(([NM,ND,F])=>({NM,ND,chev:F.chevHtml}));
const spacesOf=areas=>areas.flatMap(a=>a.rows.map(r=>({id:String(r.task?.id??a.id),area:a.name,task:r.task?.name||''})));
async function fillSource(NM,store){
  let draft=null;
  for(const w of [NM.RECORD_ONE_FROM,NM.shiftWeek(NM.RECORD_ONE_FROM,-1)]){
    const d=await store.readWeekDraft(w);
    if(d.missing)break;
    const dr=d.row?.draft??null;
    if(dr&&(store.summaryKeys(dr).length||Object.keys(store.draftOwners(dr)).length)){draft=dr;break}
  }
  return ({area,task})=>{
    if(!draft)return null;
    const key=summaryCellKey(store.summaryKeys(draft),area,task);
    // WEEKLY-화면정돈 ② 0순위: 세부 과제 칸은 그 이름의 칸 글만 받는다. 이름이 맞는 칸이 없어 사업영역 칸('사업영역 › —')으로 돌아온 이름이면
    // 받지 않는다 — 전에는 새로 만든 세부 과제마다 사업영역 칸 글을 그대로 받아, 자기 칸과 세부 과제 칸에 같은 글이 두 번 들어갔다.
    if(task&&!String(key).split('›')[1]?.trim())return null;
    return {lines:store.cellVisibleLines(draft,{section:'summary',key,n:0}),owner:store.draftOwners(draft)[key]||''};
  };
}
async function loadNow({kit,store,from,areas,tree}){
  const {NM,ND}=kit,rt=window.KPTURuntime,ws=rt?.context?.read?.()?.workspace?.id||'';
  let now,recs;
  try{[now,recs]=await Promise.all([ND.readNow(rt),ND.readWeekRecords(rt,from).catch(()=>({missing:false,items:[],failed:true}))])}
  catch{return {status:'error'}}
  if(now.missing)return {status:'missing'};
  let rows=now.rows;
  if(filledWs!==ws){
    try{
      const need=spacesOf(areas).filter(sp=>!rows.some(r=>String(r.space_id)===sp.id));
      if(need.length){
        const list=NM.fillRows({spaces:need,rows,cellOf:await fillSource(NM,store)});
        if(list.length){await ND.fillNow(rt,list);rows=(await ND.readNow(rt)).rows}
      }
      filledWs=ws;
    }catch{/* 못 채우면 다음에 다시(빈 칸으로 그림). 글은 로그에 쓰지 않는다 */}
  }
  if(!listening){
    listening=true;
    // 다른 화면(업데이트·소식 [사업])이 사업 기록을 더하면 펼쳐 보이는 이 칸의 '이번 주 기록 n'을 다시 읽는다(쓰는 칸이 있으면 그대로).
    // 다른 화면의 이 부품(홈 [주간 정리]·업무일지·사업 보고)이 지금 상황을 고쳐도 다시 읽는다. 보이지 않을 때 바뀌면 다음에 붙일 때 다시 읽는다.
    window.addEventListener(ND.BIZ_NOW_EVENT,e=>{if(writing===self||!state?.now)return;if(!e.detail?.records&&!e.detail?.week)return;if(state.editing||!box?.isConnected){state.stale=true;return}void paint()});
  }
  return {status:'ready',rows,recs:NM.weekRecords(recs.items,from,NM.rowSpaceMap(tree)),recsFailed:!!recs.failed};
}
function toggleRecs(space){
  if(!state?.now)return;
  const set=state.openRecs||(state.openRecs=new Set());
  if(set.has(space))set.delete(space);else set.add(space);
  renderPaper();
  box?.querySelector(`[data-bp-recs="${CSS.escape(space)}"]`)?.focus({preventScroll:true});
}
const findRec=key=>{for(const list of state?.now?.recs?.values?.()||[])for(const r of list)if(r.key===key)return r;return null};
const recLineHtml=(NM,r)=>`<p class="biz-rec-line">${esc(NM.recordLine(r))}${r.full&&r.full.replace(/\s+/g,' ').trim()!==r.text?` <button type="button" class="row-act" data-bp-raw="${esc(r.key)}" aria-label="${esc(`원문 보기: ${r.text}`)}">원문</button>`:''}</p>`;
function recsHtml(ref,items,records){
  const {NM,chev}=state.kit,recs=state.now.recs.get(ref.space)||[],n=items.length+recs.length;
  if(!n)return '';
  const open=!!state.openRecs?.has(ref.space);
  const btn=`<button type="button" class="row-act biz-rec-n" data-bp-recs="${esc(ref.space)}" aria-expanded="${open}" aria-label="${esc(`${ref.area} ${ref.task} 이번 주 기록 ${n}`)}">이번 주 기록 ${n} ${chev(open)}</button>`;
  return open?`${btn}<div class="biz-rec-list" data-bp-rec-list>${factsHtml(items,records)}${recs.map(r=>recLineHtml(NM,r)).join('')}</div>`:btn;
}
function nowProgressCell(ref,row,items,records){
  const {NM}=state.kit,ed=state.editing,v=NM.nowView(state.now.rows,ref.space,state.from);
  if(ed&&ed.kind==='progress'&&ed.row===row)return editBox('progress',v.body,`${ref.area} ${ref.task} 지금 상황`,NM.NOW_BODY_MAX);
  const lines=v.body?v.body.split('\n'):[];
  const body=lines.length?lines.map(l=>`<p class="biz-hand-line">${esc(l)}</p>`).join(''):'<span class="biz-now-empty">—</span>';
  const recs=recsHtml(ref,items,records);
  return `${body}${recs?`<div class="biz-now-foot">${recs}</div>`:''}`;
}
function nowOwnerCell(ref,row){
  const {NM}=state.kit,ed=state.editing,v=NM.nowView(state.now.rows,ref.space,state.from);
  if(ed&&ed.kind==='owner'&&ed.row===row)return editBox('owner',v.owner,`${ref.area} ${ref.task} 담당`,NM.OWNER_MAX);
  return esc(v.owner);
}
async function saveNowEdit(ed,field,ref){
  const {NM,ND}=state.kit,owner=ed.kind==='owner';
  const v=owner?NM.checkOwner(field.value):NM.checkNowBody(field.value);
  if(!v.ok){field.setAttribute('aria-invalid','true');say(`${owner?'담당':'지금 상황'}은 ${v.max}자까지 쓸 수 있어요.`);return}
  const run=state.run,week=state.from;
  for(const b of box.querySelectorAll('[data-bp-edit-save],[data-bp-edit-cancel]'))b.disabled=true;
  say('저장 중…');
  try{
    let rows;
    writing=self;
    try{rows=await ND.writeNow(window.KPTURuntime,{rows:state.now.rows,spaceId:ref.space,week,change:owner?{owner_text:v.value}:{body:v.value}})}finally{if(writing===self)writing=null}
    if(!state||run!==state.run||!state.now)return;
    state.now.rows=rows;state.editing=null;say('저장했어요.');renderPaper();
  }catch{if(state&&run===state.run){say('저장하지 못했어요. 잠시 뒤 다시 해 주세요.');for(const b of box.querySelectorAll('[data-bp-edit-save],[data-bp-edit-cancel]'))b.disabled=false}}
}
// ---- WEEKLY-사업영역묶음 ②(시안 docs/design/mockups/weekly-tidy.html ①): 홈 [주간 정리] 2. 1) 첫 칸 = 내 양식의 자리 ----
// groups = Map(사업영역 이름 → 양식 첫 칸 이름, journal-hwpx.js areaGroups — 한글 파일과 같은 자리 찾기). 양식이 없으면 null → 지금 모양.
// 한 줄 = 사업영역 하나: 첫 칸 = 양식 자리(같은 자리는 세로로 합침, 자리를 못 찾은 사업영역은 자기 이름), 둘째 칸 = 사업영역 이름,
// 셋째 칸 = 사업영역 자기 칸 지금 상황 + '◦ 세부 과제' 소제목과 그 칸 지금 상황(지금 상황·이번 주 기록이 없는 세부 과제는 줄을 만들지 않음 — 팀 완성본 모양),
// 담당 = 사업영역 자기 칸. [수정]은 글 칸 위에서 수정할 칸(사업영역 자기 칸·세부 과제 칸)을 고른다. 저장 자리는 그대로(칸마다 app_business_now).
// ---- S67-30 WEEKLY-칸빼기합치기: 홈 [주간 정리] 2. 1) 사업영역 줄 ⋯ [다른 칸 안으로]·[이 칸 빼기], 표 아래 '뺀 칸' 한 줄 [다시 넣기] ----
// 모양은 그 주 바탕(한글 파일 상자)이 들고 있는 draft.places 표시(weekly-area-layout.mjs). 바탕을 아직 안 열었으면(layout() null) 지금 모양·⋯ 없음.
// 바꾸기는 화면(journal.js onLayout)이 상자에 맡기고 다시 그린다 — 이 부품은 사업영역·지금 상황을 바꾸지 않는다.
// 한 번 그리는 동안 같은 값(state.lay, laidOut이 읽어 둠) — 칸마다 다시 읽지 않는다.
const readLayout=()=>(compact&&typeof state?.layout==='function'?state.layout()||null:null);
const layoutNow=()=>state?.lay??null;
function laidOut(placed){state.lay=readLayout();const r=layoutAreas(placed.areas,state.lay);return {...placed,areas:r.areas,hidden:r.hidden,moved:r.moved}}
const canLayout=()=>!!(layoutNow()&&typeof state?.onLayout==='function'&&state.editable);
function areaMoreHtml(area,placed){
  if(!canLayout())return '';
  const kids=(placed.moved||[]).filter(m=>m.into===area.name);
  const spec={label:`${area.name} 칸 메뉴`,data:{bpAreaMore:area.name},items:[
    {text:'다른 칸 안으로',data:{bpInto:area.name},aria:`${area.name}을(를) 다른 칸 안으로`},
    ...kids.map(k=>({text:`${k.name} 따로 두기`,data:{bpApart:k.name},aria:`${k.name}을(를) ${area.name} 칸에서 따로 두기`})),
    {text:'이 칸 빼기',data:{bpHide:area.name},danger:true,aria:`${area.name} 칸을 주간 보고에서 빼기`}]};
  return `<span data-bp-more="${esc(JSON.stringify(spec))}"></span>`;
}
// [다른 칸 안으로]를 누른 줄: 둘째 칸에 '넣을 칸' 고르기(보이는 다른 사업영역) + [취소].
function intoPickHtml(area,placed){
  if(state.moving!==area.name)return '';
  const others=placed.areas.filter(a=>a.name!==area.name);
  return `<span class="biz-into-pick"><label class="biz-write-target">넣을 칸 <select data-bp-into-pick="${esc(area.name)}" aria-label="${esc(`${area.name}을(를) 넣을 칸`)}"><option value="">선택</option>${others.map(a=>`<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('')}</select></label> <button type="button" class="row-act" data-bp-into-cancel>취소</button></span>`;
}
function hiddenLineHtml(placed){
  const list=placed.hidden||[];
  if(!list.length||!layoutNow())return '';
  const btn=h=>canLayout()?` <button type="button" class="row-act" data-bp-show="${esc(h.name)}" aria-label="${esc(`${h.name} 칸 다시 넣기`)}">다시 넣기</button>`:'';
  return `<p class="biz-hidden-line" data-bp-hidden-line>주간 보고에서 뺀 칸: ${list.map(h=>`<span class="biz-hidden-item">${esc(h.name)}${btn(h)}</span>`).join(' · ')}</p>`;
}
// 이번 주에 그 사업영역(세부 과제 포함)에 지금 상황 글이나 이번 주 기록이 있으면 true — [이 칸 빼기] 전에 한 번 묻는다.
function areaHasWeek(name){
  const area=(state?.view?.placed?.areas||[]).find(a=>a.name===name);if(!area||!state.now)return false;
  const {NM}=state.kit;
  return area.rows.some(r=>{const sp=String(r.task?.id??area.id);return !!NM.nowView(state.now.rows,sp,state.from).body||(r.items||[]).length>0||(state.now.recs.get(sp)||[]).length>0});
}
async function layoutAct(name,change,anchor){
  if(!canLayout()||state.layoutBusy)return;
  if(change.hide&&areaHasWeek(name)&&!(await askConfirm(anchor,{text:`${name} 칸에 이번 주 글이 있어요. 주간 보고에서 뺄까요?`,ok:'빼기',note:word('사업영역과 쓴 글은 그대로 남아요. 표 아래 [다시 넣기]로 되돌려요.')})))return;
  state.layoutBusy=true;state.moving=null;say('저장 중…');
  let ok=false;
  try{ok=await state.onLayout(name,change)!==false}catch{ok=false}
  if(!state)return;
  state.layoutBusy=false;
  say(ok?(change.hide?`${name} 칸을 주간 보고에서 뺐어요.`:change.into?`${name}을(를) ${change.into} 칸 안에 넣었어요.`:`${name} 칸을 다시 넣었어요.`):'저장하지 못했어요. 잠시 뒤 다시 해 주세요.');
  renderPaper();
}
// 묶음 칸 줄 목록(지금 상황 글 → weekly-area-cell.mjs). 화면·고치기·한글 파일이 같은 것.
function areaParts(ownRef,subRefs){
  const {NM}=state.kit,body=ref=>NM.nowView(state.now.rows,ref.space,state.from).body;
  return areaCellParts({own:{space:ownRef.space,body:body(ownRef)},subs:subRefs.map(r=>({space:r.space,name:r.task,body:body(r)}))});
}
// 묶음 칸 글상자 저장: '◦ 이름' 줄로 칸마다 나눠, 바뀐 칸만 차례로 쓴다(사업 기록은 그대로).
async function saveAreaCell(ed,field){
  const g=state.groupRefs?.get(ed.row);if(!g)return;
  const {NM}=state.kit,parts=areaParts(g.own,g.subs),{bodies,unknown}=splitCellText(field.value,parts);
  const list=[g.own,...g.subs].map(ref=>({ref,body:bodies.get(ref.space)??''}));
  for(const x of list){const v=NM.checkNowBody(x.body);if(!v.ok){field.setAttribute('aria-invalid','true');say(`${x.ref.task||x.ref.area} 칸은 ${v.max}자까지 쓸 수 있어요.`);return}x.body=v.value}
  const changed=list.filter(x=>x.body!==NM.nowView(state.now.rows,x.ref.space,state.from).body);
  if(!changed.length){state.editing=null;renderPaper();return}
  const ok=await writeBodies(changed);
  if(ok)say(unknown.length?word(`저장했어요. ◦ ${unknown.join(', ')} 칸을 찾지 못해 사업영역 칸에 그대로 넣었어요(확인 필요).`):'저장했어요.');
}
// 칸 글 여러 개를 차례로 쓴다(성공하면 글상자를 닫고 다시 그림). 실패하면 글상자·쓰던 글 그대로.
async function writeBodies(changed,{close=true}={}){
  const {ND}=state.kit,run=state.run,week=state.from;
  for(const b of box.querySelectorAll('[data-bp-edit-save],[data-bp-edit-cancel]'))b.disabled=true;
  say('저장 중…');
  writing=self;
  try{
    let rows=state.now.rows;
    for(const x of changed)rows=await ND.writeNow(window.KPTURuntime,{rows,spaceId:x.ref.space,week,change:'owner' in x?{owner_text:x.owner}:{body:x.body}});
    if(!state||run!==state.run||!state.now)return false;
    state.now.rows=rows;if(close)state.editing=null;renderPaper();return true;
  }catch{if(state&&run===state.run){say('저장하지 못했어요. 잠시 뒤 다시 해 주세요.');for(const b of box.querySelectorAll('[data-bp-edit-save],[data-bp-edit-cancel]'))b.disabled=false}return false}
  finally{if(writing===self)writing=null}
}
// [비우기]: 칸 하나(묶음 진행 칸이면 그 칸의 모든 줄)를 비운다. 확인 뒤 비우고 [되돌리기]로 원래 글을 다시 쓴다.
async function clearCell(kind,row,anchor){
  if(!state?.now||state.editing)return;
  const {NM}=state.kit,owner=kind==='owner';
  const before=cellSpaces(kind,row).map(ref=>{const v=NM.nowView(state.now.rows,ref.space,state.from);return {ref,text:owner?v.owner:v.body}}).filter(x=>x.text.trim());
  if(!before.length)return;
  if(!(await askConfirm(anchor,{text:'이 칸의 글을 비울까요?',ok:'비우기',danger:true,note:word('비운 뒤 [되돌리기]로 다시 살려요.')})))return;
  if(!state?.now||state.editing)return;
  const as=(x,text)=>owner?{ref:x.ref,owner:text}:{ref:x.ref,body:text};
  const ok=await writeBodies(before.map(x=>as(x,'')),{close:false});
  if(!ok)return;
  say('');
  notify('칸을 비웠어요.',{label:'비운 글',undo:async()=>{if(state?.now)await writeBodies(before.map(x=>as(x,x.text)),{close:false})}});
}
function groupsNow(){const g=state?.groups?.();return state?.now&&g instanceof Map&&g.size?g:null}
const ownRow=area=>area.rows.find(r=>!r.task)||{task:null,items:[]};
function groupedHtml(placed,records){
  const g=groupsNow(),{NM}=state.kit,refs=[],order=[],byGroup=new Map(),groups=new Map();
  for(const area of placed.areas){const k=g.get(area.name)||area.name;if(!byGroup.has(k)){byGroup.set(k,[]);order.push(k)}byGroup.get(k).push(area)}
  const rows=[];
  for(const k of order){
    const list=byGroup.get(k);
    list.forEach((area,i)=>{
      const own=ownRow(area),ownRef={area:area.name,task:'',space:String(area.id)},ownAt=refs.push(ownRef)-1;
      const subs=area.rows.filter(r=>r.task).map(r=>({row:r,ref:{area:area.name,task:r.task.name||'',space:String(r.task.id)}}));
      for(const x of subs)x.at=refs.push(x.ref)-1;
      // WEEKLY-화면정돈 ② 0순위: 칸 하나 = 줄 목록 하나(weekly-area-cell.mjs — 한글 파일 fileRows와 같은 것). 자기 칸 줄이 세부 과제 칸에도 있으면 한 번만,
      // 고치기는 칸 전체를 한 글상자로(자기 칸 줄 + '◦ 세부 과제' 줄) — 보이는 줄은 모두 고치고 지울 수 있다.
      const parts=areaParts(ownRef,subs.map(x=>x.ref));
      groups.set(ownAt,{own:ownRef,subs:subs.map(x=>x.ref),parts});
      const ed=state.editing,editing=ed&&ed.kind==='progress'&&ed.row===ownAt;
      let cell;
      if(editing)cell=editBox('progress',cellText(parts),`${area.name} 진행 상황 및 이후 계획`,NM.NOW_BODY_MAX*(1+subs.length));
      else{
        const lineHtml=l=>`<p class="biz-hand-line">${esc(l)}</p>`;
        const recN=(ref,items)=>items.length+(state.now.recs.get(ref.space)||[]).length;
        const ownBody=parts.own.lines.map(lineHtml).join(''),ownRecs=recsHtml(ownRef,own.items||[],records);
        const subHtml=subs.map((x,j)=>{const ls=parts.subs[j].lines;if(!ls.length&&!recN(x.ref,x.row.items||[]))return '';return `<p class="biz-sub-head">◦ ${esc(x.ref.task)}</p>${ls.map(lineHtml).join('')}${recsHtml(x.ref,x.row.items||[],records)}`}).join('');
        cell=`${ownBody}${subHtml}${ownBody||subHtml?'':'<span class="biz-now-empty">—</span>'}${ownRecs?`<div class="biz-now-foot">${ownRecs}</div>`:''}`;
      }
      rows.push(`<tr data-bp-area="${esc(area.name)}">${i===0?`<th scope="rowgroup" rowspan="${list.length}">${esc(k)}</th>`:''}<td>${k===area.name&&list.length===1?'':esc(area.name)}${intoPickHtml(area,placed)}</td><td data-bp-box="progress"${cellAttrs('progress',ownAt,`${area.name} 진행 상황`)}>${cell}</td><td data-bp-box="owner"${cellAttrs('owner',ownAt,`${area.name} 담당`)}>${ownerCell(ownRef,ownAt)}${areaMoreHtml(area,placed)}</td></tr>`);
    });
  }
  state.rowRefs=refs;state.groupRefs=groups;
  for(const other of placed.others){const lines=factsHtml(other.items,records);rows.push(`<tr><th scope="row">${esc(other.name==='미분류'?word('보관된 사업영역'):other.name)}</th><td></td><td>${lines}</td><td></td></tr>`)}
  return (rows.length?word`<table class="biz-sum-table biz-sum-grouped" data-bp-grouped><thead><tr><th scope="col">사업영역</th><th scope="col">세부 과제</th><th scope="col">진행 상황 및 이후 계획</th><th scope="col">담당</th></tr></thead><tbody>${rows.join('')}</tbody></table>`:emptyHtml(word('사업영역 없음')))+hiddenLineHtml(placed);
}
function paperHtml(placed,records,untagged,all,lineOf){
  const rows=[],refs=[];
  for(const r of records)delete r.used; // 다시 그릴 때마다 보고 줄을 처음부터 짝지음(전에는 두 번째 그림부터 보고 열기 버튼이 빠졌음)
  if(compact&&groupsNow())return groupedHtml(placed,records);
  for(const area of placed.areas)area.rows.forEach((row,i)=>{
    const ref={area:area.name,task:row.task?.name||'',space:String(row.task?.id??area.id)},n=refs.push(ref)-1;
    rows.push(`<tr${i===0?` data-bp-area="${esc(area.name)}"`:''}>${i===0?`<th scope="rowgroup" rowspan="${area.rows.length}">${esc(area.name)}${compact?intoPickHtml(area,placed):''}</th>`:''}<td>${esc(ref.task)}</td><td data-bp-box="progress"${cellAttrs('progress',n,`${ref.area}${ref.task?' '+ref.task:''} 진행 상황`)}>${progressCell(ref,n,row.items,records)}</td><td data-bp-box="owner"${cellAttrs('owner',n,`${ref.area}${ref.task?' '+ref.task:''} 담당`)}>${ownerCell(ref,n)}${i===0&&compact?areaMoreHtml(area,placed):''}</td></tr>`);
  });
  state.rowRefs=refs;state.groupRefs=null;
  // 사업영역을 못 찾은 보고(보관된 사업영역 등)는 읽기만(칸 이름이 없어 직접 쓰기 없음).
  for(const other of placed.others){const lines=factsHtml(other.items,records);rows.push(`<tr><th scope="row">${esc(other.name==='미분류'?word('보관된 사업영역'):other.name)}</th><td></td><td>${lines}</td><td></td></tr>`)}
  const table=rows.length?word`<table class="biz-sum-table"><thead><tr><th scope="col">사업영역</th><th scope="col">세부 과제</th><th scope="col">진행 상황 및 이후 계획</th><th scope="col">담당</th></tr></thead><tbody>${rows.join('')}</tbody></table>`:emptyHtml(word('사업영역 없음'));
  if(compact)return table+hiddenLineHtml(placed);
  const miss=untagged.length?word`<details class="biz-untagged"><summary>사업영역 안 단 보고 ${untagged.length}건</summary>${untagged.map(m=>`<button type="button" class="biz-cell-line" data-bp-open="${esc(m.id)}">${esc(lineOf(m))}</button>`).join('')}</details>`:'';
  if(state.view?.detail)return `<h3>1) 사업요약표</h3>${table}${miss}<h3>2) 주요 사업·회의결과</h3><ul class="biz-detail-list" data-bp-detail aria-hidden="true"><li><p class="biz-skel-line"></p></li></ul>`;
  const details=all.length?all.map(m=>{const day=new Date(Date.parse(m.meeting_at)+9*3600e3).toISOString().slice(0,10),plan=nextPlanLines(m.next_plan);return `<li><button type="button" class="biz-cell-line" data-bp-open="${esc(m.id)}"><span class="biz-day">${shortDay(day)}</span> ${esc(lineOf(m))}</button>${plan.length?`<p class="biz-cell-plan">→ 이후: ${plan.map(esc).join(' / ')}</p>`:''}</li>`}).join(''):`<li>${emptyHtml(word('사업 보고 없음'))}</li>`;
  return `<h3>1) 사업요약표</h3>${table}${miss}<h3>2) 주요 사업·회의결과</h3><ul class="biz-detail-list">${details}</ul>`;
}

// BIZ-기록하나로 B-4 ①(설계 4절 '한글 파일'): 한글 파일 2. 1) = 이 상자가 그 주에 그린 표 그대로(지금 상황 줄 + 담당, 화면 순서).
// 그 주를 다 그렸을 때만 {status:'ready', rows:[{space, area, task, lines, owner}]}(space = 사진 줄 id, B-4 ④). 그리는 중·다른 주·접힘 = 'loading', 지금 상황 표가 아직 없음 = 'missing',
// 읽지 못함 = 'error'. 사업영역을 못 찾은 보고 줄(보관된 사업영역)은 칸이 없어 넣지 않는다. 쓰는 중인 칸은 저장된 값.
self.fileRows=week=>{
  const d=state?.done;
  if(!state||!d||d.run!==state.run||d.from!==week||state.from!==week||state.dirty||state.stale||!state.view)return {status:'loading'};
  if(d.now!=='ready'||!state.now)return {status:d.now==='missing'?'missing':d.now==='error'?'error':'loading'};
  const {NM}=state.kit,rows=[],grouped=compact&&!!groupsNow();
  for(const area of laidOut(state.view.placed).areas){
    // 묶음 표(②)는 세부 과제가 있는 사업영역에도 자기 칸이 있다 — 그 칸 글도 한글 파일 그 자리 맨 위 줄로(applyBizWindow head).
    // WEEKLY-화면정돈 ② 0순위: 줄은 화면 칸과 같은 줄 목록(areaParts — 자기 칸 줄이 세부 과제 칸에도 있으면 한 번만).
    if(grouped){
      const ownRef={area:area.name,task:'',space:String(area.id)},subRefs=area.rows.filter(r=>r.task).map(r=>({area:area.name,task:r.task.name||'',space:String(r.task.id)}));
      const parts=areaParts(ownRef,subRefs);
      rows.push({space:ownRef.space,area:area.name,task:'',lines:parts.own.lines,owner:NM.nowView(state.now.rows,ownRef.space,week).owner});
      subRefs.forEach((r,j)=>rows.push({space:r.space,area:area.name,task:r.task,lines:parts.subs[j].lines,owner:NM.nowView(state.now.rows,r.space,week).owner}));
      continue;
    }
    for(const row of area.rows){
    const space=String(row.task?.id??area.id),v=NM.nowView(state.now.rows,space,week);
    rows.push({space,area:area.name,task:row.task?.name||'',lines:v.body?v.body.split('\n').map(l=>l.trim()).filter(Boolean):[],owner:v.owner});
  }}
  return {status:'ready',rows};
};
// meetings(): 사업 보고 화면이 읽어 둔 사업 보고 전체(select=*). 화면의 읽기를 그대로 쓰고 따로 읽지 않는다.
// el = 사업 보고 화면의 늘 펼친 칸 #bizWeekBox. week = 위 주 고르기의 주(월요일 날짜). 화면이 다시 그려질 때마다 불린다.
// fold = 사업 보고가 여러 주(전체 기간·정한 기간)를 보는 중 → 접힌 한 줄로 시작(BIZ-주간표이번주 ⑥). 홈 작은 상자는 늘 펼침.
// auto = 사업 보고 하나를 직접 열어 보는 중 → 접힘(BIZ-주간보고접기). visit = 화면에 들어온 횟수(바뀌면 손으로 고른 접힘을 잊음).
self.mount=(el,{meetings,week,tree=null,groups=null,layout=null,onLayout=null,fold=false,auto=false,visit=0,onFold=null,areas=null,nav=''})=>{
  // BIZ-빈표잠깐보임다시: 사업영역 수를 모르면(null) 아무것도 그리지 않는다 — 표 모양은 사업영역이 있다고 확인된 뒤에만(화면도 그동안 칸을 보이지 않음).
  if(!compact&&typeof areas==='function'&&areas()==null)return;
  ensureBox(el);
  const from=weekOf(week||seoulDateKey(Date.now())).from,first=!state;
  // MULTI-사업보고빈화면(설계 docs/design/new-user-start.md 2-4): 사업영역이 0개로 읽힌 계정(areas() === 0)은 표·자리 잡기 표를 그리지 않고
  // 안내 한 줄 + [+ 사업 만들기]만 그린다(서버를 부르지 않음). 모르면(null) 위에서 그리지 않고 돌아간다. 사업영역이 생기면 다음 mount에서 표로 돌아간다.
  const none=!compact&&typeof areas==='function'&&areas()===0;
  if(none){
    if(first)state={meetings,tree,from,to:shiftDays(from,6),run:0,view:null,draft:null,editable:false,store:null,editing:null,rowRefs:[],fold:false,hand:null,auto:false,visit,told:null,dirty:true};
    state.nav=nav;state.run++;state.editing=null;state.meetings=meetings;state.from=from;state.to=shiftDays(from,6);state.view=null;state.done=null;state.dirty=true;
    if(!state.none){state.none=true;drawNone()}
    applyFold(from);return;
  }
  if(!compact)drawPaper();
  if(first)state={meetings,tree,from,to:shiftDays(from,6),run:0,view:null,draft:null,editable:false,store:null,editing:null,rowRefs:[],fold:false,hand:null,auto:false,visit,told:null,dirty:false};
  const foldNow=!compact&&!!fold;
  // 보고를 연 동안 손으로 고른 것(hand)은 화면을 떠났다 오거나(visit) 보고를 닫거나 새로 열면(auto가 바뀜) 잊는다 — 그다음은 기억한 값(BIZ-주간보고접힘기억).
  const autoNow=!compact&&!!auto;
  if(state.visit!==visit||state.auto!==autoNow){state.visit=visit;state.hand=null}
  state.fold=foldNow;state.auto=autoNow;state.onFold=onFold;state.nav=compact?'':nav;
  // ② 묶음(양식 자리)이 바뀌면 다시 읽지 않고 표만 다시 그린다(쓰는 칸이 있으면 그대로).
  state.groups=groups;state.layout=compact?layout:null;state.onLayout=compact?onLayout:null;const gk=groupKey(groups)+layoutKey(state.layout);const regroup=state.groupKey!==gk;state.groupKey=gk;
  if(!first){
    // 같은 주이고 사업 보고 자료(화면이 읽어 둔 배열)도 그대로면 이미 그린 것을 다시 읽지 않는다(화면이 다시 그려질 때마다·[+] 창을 열 때마다 서버를 부르지 않게).
    const same=state.from===from&&state.seen===meetings()&&!!state.view&&!state.stale&&!state.dirty&&(!tree||state.treeSeen===tree());
    state.meetings=meetings;state.tree=tree;
    if(same||(state.editing&&state.from===from)){applyFold(state.from);if(same&&regroup&&!state.editing)renderPaper();return} // 쓰는 칸이 있으면 같은 주에서는 다시 그리지 않는다(쓰던 글 보호)
    state.from=from;state.to=shiftDays(from,6);
  }
  state.seen=meetings();state.stale=false;state.treeSeen=tree?tree():null;
  applyFold(from);
  if(!isOpen()){state.dirty=true;return} // 접힌 동안은 읽지 않고, 펼칠 때 읽는다
  state.dirty=false;
  void paint();
};
return self;
}
const groupKey=groups=>{const g=groups?.();return g instanceof Map&&g.size?JSON.stringify([...g]):''};
const layoutKey=layout=>{const l=layout?.();return l?JSON.stringify([l.hide,[...l.into]]):''};
// 사업 보고 화면의 늘 펼친 칸(#bizWeekBox) — 상자마다 부품 하나.
const boxes=new WeakMap();
export function mountWeekSummary(el,{meetings,week,fold=false,auto=false,visit=0,onFold=null,areas=null,nav=''}){
  let inst=boxes.get(el);
  if(!inst){inst=createBizSummary();boxes.set(el,inst)}
  inst.mount(el,{meetings,week,fold,auto,visit,onFold,areas,nav});
}
// 홈 [주간 정리] 2. 1): 같은 부품의 1) 사업요약표만. el은 부품이 가진 상자 하나 — 화면이 다시 그려도 그 자리에 옮겨 붙인다
// (다시 읽지 않고 쓰던 칸도 그대로). update({meetings, week, tree}): meetings() = 그 화면이 이미 읽은 그 주 사업 보고, tree() = 이미 읽은 활성 사업 나무
// ([{project, depth}], 아직 없으면 null — 오면 다시 그림). 둘 다 따로 읽지 않는다.
export function createBizSummaryBox(){
  const el=document.createElement('div');el.className='biz-week-box biz-week-compact';el.dataset.bizSummaryBox='';
  const inst=createBizSummary({compact:true});
  return {el,update:({meetings,week,tree,groups=null,layout=null,onLayout=null})=>inst.mount(el,{meetings,week,tree,groups,layout,onLayout}),fileRows:week=>inst.fileRows(week)};
}
