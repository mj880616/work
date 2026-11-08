import {emptyHtml} from './wait-state.js';
// WEEKLY-메뉴짝짓기 P5(요청함 11/04 16:48 결정 B, 설계 docs/design/weekly-menu-pairing.md 3.2): 사업 보고 화면 위 접는 칸 '이번 주 주간보고'(팝업이 아님).
// (전 report-summary-preview.js — MTG-프로젝트합치기 2단계 [사업요약표 미리보기] 팝업을 이 칸으로 옮김. 팝업·기간 바꾸기·[HWP로 내려받기]는 없앴다.)
// - BIZ-위쪽정돈(B안, 11/09): 이 칸은 접는 칸이 아니라 늘 펼쳐 둔 칸이고 안쪽 주 고르기는 없다 — 사업 보고 화면 위의 주 고르기(‹ 11.9(월)~11.15(일) ›) 하나를 따른다(team.js가 week를 넘긴다). 한글 파일은 홈 [주간 정리] 한 곳에서만 만든다 → 맨 아래 [주간 정리에서 보기 ›].
// - 1) 사업요약표: 사업영역 | 세부 과제 | 진행 상황 및 이후 계획 | 담당. '진행'·'담당' 칸을 누르면 글 칸(진행은 Ctrl+Enter, 담당은 Enter 저장, Esc 취소).
//   진행 = 그 주 임시저장 summary 칸(홈 [주간 정리] 1) 요약과 같은 칸), 담당 = 그 주 임시저장 owners 칸(한글 파일 담당 칸) — 저장 자리 하나(weekly-draft-store.js).
//   칸 아래 그 주 사업 보고 제목(사실 기록)은 누르면 그 보고가 열린다. AI 제안 없음(WEEKLY-요약표수기 S49-39). 예전에 저장된 AI 값은 보이지 않게만 두고 지우지 않는다.
// - 2) 주요 사업·회의결과: 그 주 사업 보고 줄(날짜순). 내부 정례 회의와 내가 '늘 빼기'로 정한 종류는 journal-meeting-kinds.js reportsMeeting 한 곳으로 뺀다(주간 정리와 같음).
//   한 줄 업데이트(칸 oneline)는 표 칸 맨 위, 세부 내용에는 넣지 않는다(MTG-한줄업데이트).
// - 기기에 아무것도 저장하지 않는다. 글은 로그에 쓰지 않는다.
import {previewRecords,weekOf,shiftDays,nextPlanLines,fullTable} from './business-area-model.mjs';
import {summaryCellKey} from './weekly-summary-hand.mjs';
import {weekLabel} from './weekly-org-lines-model.mjs';
import {seoulDateKey} from './meeting-time.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortDay=day=>{const [,m,d]=day.split('-');return `${Number(m)}.${Number(d)}`};
let box=null,state=null;
const $in=sel=>box?.querySelector(sel);

function ensureBox(el){
  if(box===el)return box;
  box=el;
  box.querySelector('[data-bw-body]').innerHTML=`<div class="biz-paper biz-week-paper" data-bp-paper></div>
<p class="status biz-week-status" data-bp-status role="status" aria-live="polite"></p><div class="biz-week-foot"><button type="button" class="biz-week-go" data-bw-journal>주간 정리에서 보기 ›</button></div>`;
  box.addEventListener('click',onClick);
  // 글 칸: 진행 = Ctrl+Enter(맥은 ⌘+Enter), 담당 한 줄 칸 = Enter 저장. Esc = 쓰던 칸만 닫기(저장 안 함).
  box.addEventListener('keydown',e=>{
    if(!state?.editing)return;
    const field=e.target.closest?.('[data-bp-field]');if(!field)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();state.editing=null;renderPaper();return}
    if(e.key!=='Enter'||e.isComposing)return;
    if(field.tagName==='TEXTAREA'&&!(e.ctrlKey||e.metaKey))return;
    e.preventDefault();void saveEdit();
  });
  return box;
}
function say(text){const el=$in('[data-bp-status]');if(el)el.textContent=text||''}

async function onClick(e){
  if(!state)return;
  if(e.target.closest('[data-bp-edit-cancel]')){state.editing=null;return renderPaper()}
  if(e.target.closest('[data-bp-edit-save]'))return saveEdit();
  const open=e.target.closest('[data-bp-open]');if(open){const mod=await import('./report-open.js');return mod.openReport(open.dataset.bpOpen)}
  if(e.target.closest('[data-bw-journal]')){const day=state.from;window.KPTURouter?.go?.('journal',{source:'delegated'});return waitJournal().then(j=>j?.showWeek?.(day))}
  // 칸을 누르면 글 칸(보고 줄 버튼·쓰는 중인 칸 안은 빼고).
  const cell=e.target.closest('[data-bp-cell]');
  const inner=e.target.closest('summary,details');
  if(cell&&!e.target.closest('[data-bp-field],[data-bp-open]')&&(!inner||inner===box))return startEdit(cell.dataset.bpCell,Number(cell.dataset.bpRow));
}
// 업무일지 부품이 아직 안 불러와졌으면 잠깐(최대 5초) 기다린다.
async function waitJournal(){for(let i=0;i<50&&!window.KPTUJournal?.showWeek;i++)await new Promise(r=>setTimeout(r,100));return window.KPTUJournal}

// 칸 이름: 이번 주면 '이번 주 주간보고', 위에서 다른 주를 골랐으면 그 주 이름을 붙인다(이름과 보이는 주가 어긋나지 않게).
function setTitle(from){const h=box?.querySelector('.biz-week-title');if(!h)return;const now=weekOf(seoulDateKey(Date.now())).from;h.textContent=from===now?'이번 주 주간보고':`${weekLabel(from)} 주간보고`;box.setAttribute('aria-label',h.textContent)}
const isWeek=(from,to)=>weekOf(from).from===from&&shiftDays(from,6)===to;
async function paint(){
  const paper=$in('[data-bp-paper]'),{from,to}=state;
  setTitle(from);say('');
  const run=++state.run;state.editing=null;
  try{
    const [{placeRecords},{meetingLine},sheet,kinds,store]=await Promise.all([import('./journal-weekly.js'),import('./journal-data.js'),import('./report-places-sheet.js'),import('./journal-meeting-kinds.js'),import('./weekly-draft-store.js')]);
    const places=await sheet.loadReportPlaces().catch(()=>null);
    // 늘 빼는 회의 종류: 내부 정례 회의는 목록을 못 읽어도 빠진다(reportsMeeting). 주간 정리와 같은 한 곳.
    const read=await kinds.readKinds().catch(()=>({status:'unknown'}));
    const hidden=read?.status==='ok'?read.list:null;
    // 이 주 임시저장(홈 [주간 정리]와 같은 칸): 한 주(월~일)를 볼 때만 읽는다. 칸이 없거나 못 읽으면 쓰기만 막고 표는 그대로.
    let draft=null,editable=false,note='';
    if(isWeek(from,to)){
      try{const d=await store.readWeekDraft(from);if(d.missing)note='저장 칸이 아직 준비되지 않아 지금은 쓸 수 없어요.';else{draft=d.row?.draft??null;editable=true}}
      catch{note='저장 칸을 불러오지 못해 지금은 쓸 수 없어요.'}
    }else note='한 주(월~일)를 볼 때 칸에 직접 쓸 수 있어요.';
    if(!state||run!==state.run)return;
    const meetings=state.meetings().filter(m=>kinds.reportsMeeting(m,hidden));
    const lineOf=mt=>meetingLine({...mt,meeting_at:null}); // 표·세부 줄은 시각 없이(날짜는 세부 줄 앞에 따로)
    const {records,untagged,all}=previewRecords(meetings,{from,to,lineOf});
    const placed=placeRecords(records,places?.projects||null);
    state.view={placed:{...placed,areas:fullTable(placed.areas,places?.projects||null)},records,untagged,all,lineOf};
    state.draft=draft;state.editable=editable;state.store=store;
    renderPaper();say(note);
  }catch(err){if(state&&run===state.run)paper.innerHTML=`<p class="journal-muted">${esc(err?.message||'미리보기를 만들지 못했어요.')}</p>`}
}
function renderPaper(){
  if(!state?.view)return;
  const {placed,records,untagged,all,lineOf}=state.view;
  $in('[data-bp-paper]').innerHTML=paperHtml(placed,records,untagged,all,lineOf);
  const field=$in('[data-bp-field]');if(field){field.focus({preventScroll:true});if(field.select&&field.tagName==='INPUT')field.select()}
}

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
async function saveEdit(){
  const ed=state?.editing;if(!ed)return;
  const field=$in('[data-bp-field]'),ref=rowRefs()[ed.row];if(!field||!ref)return;
  const text=String(field.value||''),run=state.run,week=state.from;
  for(const b of box.querySelectorAll('[data-bp-edit-save],[data-bp-edit-cancel]'))b.disabled=true;
  say('저장 중…');
  try{
    const store=state.store;
    const r=ed.kind==='owner'?await store.changeWeekOwner({start:week,area:ref.area,task:ref.task,text}):await store.changeWeekSummaryText({start:week,area:ref.area,task:ref.task,text});
    if(!state||run!==state.run)return;
    if(r.missing){say('저장 칸이 아직 준비 중이에요.');state.editing=null;return renderPaper()}
    state.draft=r.row?.draft??state.draft;state.editing=null;say('저장했어요.');renderPaper();
  }catch(err){if(state&&run===state.run){say(err?.code==='too_long'?err.message:'저장하지 못했어요. 잠시 뒤 다시 해 주세요.');for(const b of box.querySelectorAll('[data-bp-edit-save],[data-bp-edit-cancel]'))b.disabled=false}}
}

// 표의 한 칸: 쓴 글이 있으면 그 줄들, 없으면 그 주 사업 보고 제목(사실 기록)들 + 이후 계획(다음 할 일, 중복 없이). 한 줄 업데이트는 맨 위.
function factsHtml(items,records){
  const progress=items.map(item=>{const rec=records.find(r=>r.day===item.day&&r.text===item.text&&!r.used);if(rec)rec.used=true;return {item,rec}});
  const plans=[...new Set(progress.flatMap(p=>p.rec?.requests||[]))];
  const lineHtml=({item,rec})=>`<button type="button" class="biz-cell-line" ${rec?`data-bp-open="${esc(rec.meeting)}"`:''}>- ${esc(item.label&&item.issue?item.label.split(' › ').at(-1)+': ':'')}${esc(item.text)}</button>`;
  const ones=progress.filter(p=>p.rec?.oneline),rest=progress.filter(p=>!p.rec?.oneline);
  return `${[...ones,...rest].map(lineHtml).join('')}${plans.length?`<p class="biz-cell-plan">→ 이후: ${plans.map(esc).join(' / ')}</p>`:''}`;
}
function editBox(kind,value,label){
  const input=kind==='owner'?`<input type="text" maxlength="60" value="${esc(value)}" data-bp-field aria-label="${esc(label)}">`
    :`<textarea rows="4" maxlength="2000" data-bp-field aria-label="${esc(label)}">${esc(value)}</textarea>`;
  return `<div class="biz-write">${input}<span class="biz-write-btns"><button type="button" class="mini" data-bp-edit-save>저장</button><button type="button" class="mini secondary" data-bp-edit-cancel>취소</button></span><span class="biz-write-hint">${kind==='owner'?'Enter':'Ctrl+Enter'} 저장 · Esc 취소</span></div>`;
}
function progressCell(ref,row,items,records){
  const ed=state.editing,mine=ed&&ed.kind==='progress'&&ed.row===row;
  const saved=savedProgress(ref.area,ref.task),facts=factsHtml(items,records);
  if(mine){
    const value=saved.length?saved.join('\n'):items.map(it=>`- ${it.label&&it.issue?it.label.split(' › ').at(-1)+': ':''}${it.text}`).join('\n');
    return editBox('progress',value,`${ref.area} ${ref.task} 진행 상황 및 이후 계획`);
  }
  const body=saved.length?saved.map(l=>`<p class="biz-hand-line">${esc(l)}</p>`).join(''):facts;
  return `${body}${state.editable?`<button type="button" class="biz-write-open" data-bp-cell="progress" data-bp-row="${row}" aria-label="${esc(`${ref.area} ${ref.task} 진행 상황 쓰기`)}">${saved.length||items.length?'수정':'쓰기'}</button>`:''}`;
}
function ownerCell(ref,row){
  const ed=state.editing,mine=ed&&ed.kind==='owner'&&ed.row===row,value=savedOwner(ref.area,ref.task);
  if(mine)return editBox('owner',value,`${ref.area} ${ref.task} 담당`);
  return `${esc(value)}${state.editable?`<button type="button" class="biz-write-open" data-bp-cell="owner" data-bp-row="${row}" aria-label="${esc(`${ref.area} ${ref.task} 담당 쓰기`)}">${value?'수정':'쓰기'}</button>`:''}`;
}
function paperHtml(placed,records,untagged,all,lineOf){
  const rows=[],refs=[];
  for(const area of placed.areas)area.rows.forEach((row,i)=>{
    const ref={area:area.name,task:row.task?.name||''},n=refs.push(ref)-1;
    rows.push(`<tr>${i===0?`<th scope="rowgroup" rowspan="${area.rows.length}">${esc(area.name)}</th>`:''}<td>${esc(ref.task)}</td><td data-bp-box="progress">${progressCell(ref,n,row.items,records)}</td><td data-bp-box="owner">${ownerCell(ref,n)}</td></tr>`);
  });
  state.rowRefs=refs;
  // 사업영역을 못 찾은 보고(보관된 사업영역 등)는 읽기만(칸 이름이 없어 직접 쓰기 없음).
  for(const other of placed.others){const lines=factsHtml(other.items,records);rows.push(`<tr><th scope="row">${esc(other.name==='미분류'?'보관된 사업영역':other.name)}</th><td></td><td>${lines}</td><td></td></tr>`)}
  const table=rows.length?`<table class="biz-sum-table"><thead><tr><th scope="col">사업영역</th><th scope="col">세부 과제</th><th scope="col">진행 상황 및 이후 계획</th><th scope="col">담당</th></tr></thead><tbody>${rows.join('')}</tbody></table>`:emptyHtml('사업영역 없음');
  const miss=untagged.length?`<details class="biz-untagged"><summary>사업영역 안 단 보고 ${untagged.length}건</summary>${untagged.map(m=>`<button type="button" class="biz-cell-line" data-bp-open="${esc(m.id)}">${esc(lineOf(m))}</button>`).join('')}</details>`:'';
  const details=all.length?all.map(m=>{const day=new Date(Date.parse(m.meeting_at)+9*3600e3).toISOString().slice(0,10),plan=nextPlanLines(m.next_plan);return `<li><button type="button" class="biz-cell-line" data-bp-open="${esc(m.id)}"><span class="biz-day">${shortDay(day)}</span> ${esc(lineOf(m))}</button>${plan.length?`<p class="biz-cell-plan">→ 이후: ${plan.map(esc).join(' / ')}</p>`:''}</li>`}).join(''):`<li>${emptyHtml('사업 보고 없음')}</li>`;
  return `<h3>1) 사업요약표</h3>${table}${miss}<h3>2) 주요 사업·회의결과</h3><ul class="biz-detail-list">${details}</ul>`;
}

// meetings(): 사업 보고 화면이 읽어 둔 사업 보고 전체(select=*). 화면의 읽기를 그대로 쓰고 따로 읽지 않는다.
// el = 사업 보고 화면의 늘 펼친 칸 #bizWeekBox. week = 위 주 고르기의 주(월요일 날짜). 화면이 다시 그려질 때마다 불린다.
export function mountWeekSummary(el,{meetings,week}){
  ensureBox(el);
  const from=weekOf(week||seoulDateKey(Date.now())).from;
  if(!state)state={meetings,from,to:shiftDays(from,6),run:0,view:null,draft:null,editable:false,store:null,editing:null,rowRefs:[]};
  else{
    // 같은 주이고 사업 보고 자료(화면이 읽어 둔 배열)도 그대로면 이미 그린 것을 다시 읽지 않는다(화면이 다시 그려질 때마다·[+] 창을 열 때마다 서버를 부르지 않게).
    const same=state.from===from&&state.seen===meetings()&&!!state.view;
    state.meetings=meetings;
    if(same)return;
    if(state.editing&&state.from===from)return; // 쓰는 칸이 있으면 같은 주에서는 다시 그리지 않는다(쓰던 글 보호)
    state.from=from;state.to=shiftDays(from,6);
  }
  state.seen=meetings();
  void paint();
}
