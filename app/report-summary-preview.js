import {emptyHtml} from './wait-state.js';
// MTG-프로젝트합치기 2단계: 사업 보고 화면 위 [사업요약표 미리보기] (docs/design/project-into-report.md 5절).
// 기간(기본 이번 주, 서울 월~일)의 사업 보고로 한글 문서 모양 미리보기: 위 '1) 요약' 표(사업영역 | 세부 과제 | 진행 상황 및 이후 계획 | 담당),
// 아래 '2) 세부 내용 — 회의·활동 결과'(날짜순). 줄 세우기는 주간보고 ②와 같은 placeRecords, 보고 한 줄은 주간보고 meetingLine.
// WEEKLY-요약표수기(S49-39, 요청함 11/04 16:38 · 명진 16:45 "아예 지우자"):
//  - 내부 정례 회의(노조 상집·중집, 본부 집행위, 궤도 집행국)와 내가 '늘 빼기'로 정한 회의 종류는 표·세부 내용 어디에도 안 나온다. 목록은
//    journal-meeting-kinds.js reportsMeeting 한 곳(주간 정리와 같음). '뺀 n건' 안내 없음.
//  - AI 제안은 없다(AI 한 줄·[고치기]·(고침) 삭제). 표에는 명진이 쓴 글 + 그 주 사업 보고 제목(사실 기록)만. 예전에 저장된 AI 값은 보이지 않게만 두고 지우지 않는다.
//  - '진행 상황 및 이후 계획'·'담당' 칸을 누르면 글 칸(Ctrl+Enter 저장). 진행 칸은 홈 [주간 정리] 1) 요약의 같은 칸(그 주 임시저장 summary 칸)에 저장되어 두 곳이 같다.
//    담당은 그 주 임시저장 owners 칸(한글 파일 담당 칸에 그대로 들어감). 보고가 없는 사업영역·세부 과제 줄도 쓸 수 있다. 한 주(월~일)를 볼 때만 쓸 수 있다.
//  - 한 줄 업데이트(칸 oneline)는 쓴 문장 그대로 칸 맨 위, 2) 세부 내용에는 넣지 않는다(MTG-한줄업데이트).
// [HWP로 내려받기]는 그 주 [주간 정리]의 기존 한글 파일 상자를 연다. 기기에 아무것도 저장하지 않는다. 글은 로그에 쓰지 않는다.
import {previewRecords,weekOf,shiftDays,nextPlanLines,fullTable} from './business-area-model.mjs';
import {summaryCellKey} from './weekly-summary-hand.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todaySeoul=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
const shortDay=day=>{const [,m,d]=day.split('-');return `${Number(m)}.${Number(d)}`};
let dialog=null,state=null;

function ensureDialog(){
  if(dialog)return dialog;
  dialog=document.createElement('dialog');dialog.id='reportPreviewDialog';dialog.className='biz-preview';dialog.setAttribute('aria-labelledby','reportPreviewTitle');
  dialog.innerHTML=`<header class="biz-preview-head"><h2 id="reportPreviewTitle">사업요약표 미리보기</h2><button type="button" class="icon-btn" data-bp-close aria-label="닫기">×</button></header>
<div class="biz-preview-bar"><button type="button" class="mini" data-bp-week="-1" aria-label="지난 주">‹</button><span data-bp-period></span><button type="button" class="mini" data-bp-week="1" aria-label="다음 주">›</button></div>
<details class="biz-preview-range"><summary>기간 바꾸기</summary><label>시작<input type="date" data-bp-from></label><label>끝<input type="date" data-bp-to></label><button type="button" class="mini" data-bp-apply>적용</button></details>
<div class="biz-preview-scroll"><div class="biz-paper" data-bp-paper></div></div>
<footer class="biz-preview-foot"><p class="status" data-bp-status role="status" aria-live="polite"></p><button type="button" class="mini secondary" data-bp-hwpx>HWP로 내려받기</button></footer>`;
  document.body.append(dialog);
  dialog.addEventListener('click',onClick);
  dialog.addEventListener('cancel',e=>{e.preventDefault();if(state?.editing){state.editing=null;renderPaper();return}close()});
  // 글 칸: Ctrl+Enter(맥은 ⌘+Enter) = 저장, 담당 한 줄 칸은 Enter = 저장(Esc는 위 cancel이 쓰기만 닫는다).
  dialog.addEventListener('keydown',e=>{
    if(e.key!=='Enter'||e.isComposing||!state?.editing)return;
    const field=e.target.closest?.('[data-bp-field]');if(!field)return;
    if(field.tagName==='TEXTAREA'&&!(e.ctrlKey||e.metaKey))return;
    e.preventDefault();void saveEdit();
  });
  return dialog;
}
// UI-뒤로가기겹규칙: 맨 <dialog>라 라우터 겹 하나를 연다(뒤로가기 = 쓰던 칸이 있으면 그것만, 아니면 이 창 닫기).
// 닫고 다른 화면으로 갈 때는 겹의 뒤로가기가 도착한 뒤 간다(늦게 온 뒤로가기가 새 화면 기록을 지우지 않게).
let layer=null;
function close(){
  const l=layer;layer=null;
  const done=Promise.resolve(l?.close());
  if(dialog?.open)dialog.close();state?.trigger?.focus?.({preventScroll:true});state=null;
  return done;
}
function say(text){const el=dialog?.querySelector('[data-bp-status]');if(el)el.textContent=text||''}

async function onClick(e){
  if(!state)return;
  if(e.target===dialog||e.target.closest('[data-bp-close]'))return close();
  const week=e.target.closest('[data-bp-week]');if(week){const n=Number(week.dataset.bpWeek)*7;state.from=shiftDays(state.from,n);state.to=shiftDays(state.to,n);return paint()}
  if(e.target.closest('[data-bp-apply]')){const from=dialog.querySelector('[data-bp-from]').value,to=dialog.querySelector('[data-bp-to]').value;if(!from||!to||from>to)return say('시작과 끝 날짜를 확인해 주세요.');state.from=from;state.to=to;dialog.querySelector('.biz-preview-range').open=false;return paint()}
  if(e.target.closest('[data-bp-edit-cancel]')){state.editing=null;return renderPaper()}
  if(e.target.closest('[data-bp-edit-save]'))return saveEdit();
  const open=e.target.closest('[data-bp-open]');if(open){const id=open.dataset.bpOpen;await close();const mod=await import('./report-open.js');return mod.openReport(id)}
  if(e.target.closest('[data-bp-hwpx]')){const day=state.from;await close();window.KPTURouter?.go?.('journal',{source:'delegated'});return waitJournal().then(j=>j?.showWeek?.(day,{hwpx:true}))}
  // 칸을 누르면 글 칸(보고 줄 버튼·쓰는 중인 칸 안은 빼고).
  const cell=e.target.closest('[data-bp-cell]');
  if(cell&&!e.target.closest('[data-bp-field],[data-bp-open],summary,details'))return startEdit(cell.dataset.bpCell,Number(cell.dataset.bpRow));
}
// 업무일지 부품이 아직 안 불러와졌으면 잠깐(최대 5초) 기다린다.
async function waitJournal(){for(let i=0;i<50&&!window.KPTUJournal?.showWeek;i++)await new Promise(r=>setTimeout(r,100));return window.KPTUJournal}

const isWeek=(from,to)=>weekOf(from).from===from&&shiftDays(from,6)===to;
async function paint(){
  const paper=dialog.querySelector('[data-bp-paper]'),{from,to}=state;
  dialog.querySelector('[data-bp-period]').textContent=`${shortDay(from)} ~ ${shortDay(to)}`;
  dialog.querySelector('[data-bp-from]').value=from;dialog.querySelector('[data-bp-to]').value=to;say('');
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
  dialog.querySelector('[data-bp-paper]').innerHTML=paperHtml(placed,records,untagged,all,lineOf);
  const field=dialog.querySelector('[data-bp-field]');if(field){field.focus({preventScroll:true});if(field.select&&field.tagName==='INPUT')field.select()}
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
  if(!state?.editable){say(dialog.querySelector('[data-bp-status]')?.textContent||'지금은 쓸 수 없어요.');return}
  const ref=rowRefs()[row];if(!ref)return;
  state.editing={kind,row};renderPaper();
}
async function saveEdit(){
  const ed=state?.editing;if(!ed)return;
  const field=dialog.querySelector('[data-bp-field]'),ref=rowRefs()[ed.row];if(!field||!ref)return;
  const text=String(field.value||''),run=state.run,week=state.from;
  for(const b of dialog.querySelectorAll('[data-bp-edit-save],[data-bp-edit-cancel]'))b.disabled=true;
  say('저장 중…');
  try{
    const store=state.store;
    const r=ed.kind==='owner'?await store.changeWeekOwner({start:week,area:ref.area,task:ref.task,text}):await store.changeWeekSummaryText({start:week,area:ref.area,task:ref.task,text});
    if(!state||run!==state.run)return;
    if(r.missing){say('저장 칸이 아직 준비 중이에요.');state.editing=null;return renderPaper()}
    state.draft=r.row?.draft??state.draft;state.editing=null;say('저장했어요.');renderPaper();
  }catch(err){if(state&&run===state.run){say(err?.code==='too_long'?err.message:'저장하지 못했어요. 잠시 뒤 다시 해 주세요.');for(const b of dialog.querySelectorAll('[data-bp-edit-save],[data-bp-edit-cancel]'))b.disabled=false}}
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
  return `${body}${state.editable?`<button type="button" class="biz-write-open" data-bp-cell="progress" data-bp-row="${row}" aria-label="${esc(`${ref.area} ${ref.task} 진행 상황 쓰기`)}">${saved.length||items.length?'고치기':'쓰기'}</button>`:''}`;
}
function ownerCell(ref,row){
  const ed=state.editing,mine=ed&&ed.kind==='owner'&&ed.row===row,value=savedOwner(ref.area,ref.task);
  if(mine)return editBox('owner',value,`${ref.area} ${ref.task} 담당`);
  return `${esc(value)}${state.editable?`<button type="button" class="biz-write-open" data-bp-cell="owner" data-bp-row="${row}" aria-label="${esc(`${ref.area} ${ref.task} 담당 쓰기`)}">${value?'고치기':'쓰기'}</button>`:''}`;
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
  return `<h3>1) 요약</h3>${table}${miss}<h3>2) 세부 내용 — 회의·활동 결과</h3><ul class="biz-detail-list">${details}</ul>`;
}

// meetings(): 사업 보고 화면이 읽어 둔 사업 보고 전체(select=*). 화면의 읽기를 그대로 쓰고 따로 읽지 않는다.
export function openReportPreview(trigger,{meetings}){
  ensureDialog();const week=weekOf(todaySeoul());
  state={trigger,meetings,from:week.from,to:week.to,run:0,view:null,draft:null,editable:false,store:null,editing:null,rowRefs:[]};
  if(!dialog.open)dialog.showModal();void paint();
  if(!layer)layer=window.KPTURouter?.layer?.open('report-preview',{close:()=>{if(state?.editing){state.editing=null;renderPaper();return false}layer=null;close();return true}})||null;
  dialog.querySelector('[data-bp-close]').focus({preventScroll:true});
}
