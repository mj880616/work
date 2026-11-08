import {emptyHtml} from './wait-state.js';
// WEEKLY-메뉴짝짓기 P5(요청함 11/04 16:48 결정 B, 설계 docs/design/weekly-menu-pairing.md 3.2): 사업 보고 화면 위 접는 칸 '이번 주 주간보고'(팝업이 아님).
// (전 report-summary-preview.js — MTG-프로젝트합치기 2단계 [사업요약표 미리보기] 팝업을 이 칸으로 옮김. 팝업·기간 바꾸기·[HWP로 내려받기]는 없앴다.)
// - 주 고르기는 공용 부품 week-pick.js(월~일, 담당조직 '이번 주 조직보고'와 같은 모양). 한글 파일은 홈 [주간 정리] 한 곳에서만 만든다 → 맨 아래 [주간 정리에서 보기 ›].
// - 1) 사업요약표: 사업영역 | 세부 과제 | 진행 상황 및 이후 계획 | 담당. '진행'·'담당' 칸을 누르면 글 칸(진행은 Ctrl+Enter, 담당은 Enter 저장, Esc 취소).
//   진행 = 그 주 임시저장 summary 칸(홈 [주간 정리] 1) 요약과 같은 칸), 담당 = 그 주 임시저장 owners 칸(한글 파일 담당 칸) — 저장 자리 하나(weekly-draft-store.js).
//   칸 아래 그 주 사업 보고 제목(사실 기록)은 누르면 그 보고가 열린다. AI 제안 없음(WEEKLY-요약표수기 S49-39). 예전에 저장된 AI 값은 보이지 않게만 두고 지우지 않는다.
// - 2) 주요 사업·회의결과: 그 주 사업 보고 줄(날짜순). 내부 정례 회의와 내가 '늘 빼기'로 정한 종류는 journal-meeting-kinds.js reportsMeeting 한 곳으로 뺀다(주간 정리와 같음).
//   한 줄 업데이트(칸 oneline)는 표 칸 맨 위, 세부 내용에는 넣지 않는다(MTG-한줄업데이트).
// - 기기에 아무것도 저장하지 않는다. 글은 로그에 쓰지 않는다.
import {previewRecords,weekOf,shiftDays,nextPlanLines,fullTable} from './business-area-model.mjs';
import {summaryCellKey} from './weekly-summary-hand.mjs';
import {weekPickHtml,bindWeekPick,currentWeek} from './week-pick.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortDay=day=>{const [,m,d]=day.split('-');return `${Number(m)}.${Number(d)}`};
let box=null,state=null;
const $in=sel=>box?.querySelector(sel);

function ensureBox(el){
  if(box===el)return box;
  box=el;
  box.querySelector('[data-bw-body]').innerHTML=`<div class="biz-week-bar btn-row" data-bw-bar></div><div class="biz-paper biz-week-paper" data-bp-paper></div>
<p class="status biz-week-status" data-bp-status role="status" aria-live="polite"></p><div class="biz-week-foot"><button type="button" class="biz-week-go" data-bw-journal>주간 정리에서 보기 ›</button></div>`;
  box.addEventListener('click',onClick);
  bindWeekPick(box.querySelector('[data-bw-bar]'),()=>state?.from,week=>{if(!state)return;state.from=week;state.to=shiftDays(week,6);void paint()});
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
  const recs=e.target.closest('[data-bp-recs]');if(recs)return toggleRecs(recs.dataset.bpRecs);
  const open=e.target.closest('[data-bp-open]');if(open){const mod=await import('./report-open.js');return mod.openReport(open.dataset.bpOpen)}
  if(e.target.closest('[data-bw-journal]')){const day=state.from;window.KPTURouter?.go?.('journal',{source:'delegated'});return waitJournal().then(j=>j?.showWeek?.(day))}
  // 칸을 누르면 글 칸(보고 줄 버튼·쓰는 중인 칸 안은 빼고).
  const cell=e.target.closest('[data-bp-cell]');
  const inner=e.target.closest('summary,details');
  if(cell&&!e.target.closest('[data-bp-field],[data-bp-open]')&&(!inner||inner===box))return startEdit(cell.dataset.bpCell,Number(cell.dataset.bpRow));
}
// 업무일지 부품이 아직 안 불러와졌으면 잠깐(최대 5초) 기다린다.
async function waitJournal(){for(let i=0;i<50&&!window.KPTUJournal?.showWeek;i++)await new Promise(r=>setTimeout(r,100));return window.KPTUJournal}

const isWeek=(from,to)=>weekOf(from).from===from&&shiftDays(from,6)===to;
async function paint(){
  const paper=$in('[data-bp-paper]'),{from,to}=state;
  $in('[data-bw-bar]').innerHTML=weekPickHtml(from);say('');
  const run=++state.run;state.editing=null;
  try{
    const [{placeRecords},{meetingLine},sheet,kinds,store]=await Promise.all([import('./journal-weekly.js'),import('./journal-data.js'),import('./report-places-sheet.js'),import('./journal-meeting-kinds.js'),import('./weekly-draft-store.js')]);
    const kit=await nowKit();
    const places=await sheet.loadReportPlaces().catch(()=>null);
    // 늘 빼는 회의 종류: 내부 정례 회의는 목록을 못 읽어도 빠진다(reportsMeeting). 주간 정리와 같은 한 곳.
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
    let now=null;
    if(fresh){
      now=await loadNow({kit,store,from,areas,tree:places?.projects||null});
      if(!state||run!==state.run)return;
      editable=now.status==='ready';
      if(now.status==='missing')note='저장 칸이 아직 준비되지 않아 지금은 쓸 수 없어요.';
      else if(now.status==='error')note='지금 상황을 불러오지 못해 지금은 쓸 수 없어요.';
      else if(now.recsFailed)note='이번 주 기록을 불러오지 못했어요.';
      if(now.status!=='ready')now=null;
    }
    state.view={placed:{...placed,areas},records,untagged,all,lineOf};
    state.draft=draft;state.editable=editable;state.store=store;state.now=now;state.kit=kit;
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
  if(state.now)return saveNowEdit(ed,field,ref);
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
function editBox(kind,value,label,max=kind==='owner'?60:2000){
  const input=kind==='owner'?`<input type="text" maxlength="${max}" value="${esc(value)}" data-bp-field aria-label="${esc(label)}">`
    :`<textarea rows="4" maxlength="${max}" data-bp-field aria-label="${esc(label)}">${esc(value)}</textarea>`;
  return `<div class="biz-write">${input}<span class="biz-write-btns"><button type="button" class="mini" data-bp-edit-save>저장</button><button type="button" class="mini secondary" data-bp-edit-cancel>취소</button></span><span class="biz-write-hint">${kind==='owner'?'Enter':'Ctrl+Enter'} 저장 · Esc 취소</span></div>`;
}
function progressCell(ref,row,items,records){
  if(state.now)return nowProgressCell(ref,row,items,records);
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
  if(state.now)return nowOwnerCell(ref,row);
  const ed=state.editing,mine=ed&&ed.kind==='owner'&&ed.row===row,value=savedOwner(ref.area,ref.task);
  if(mine)return editBox('owner',value,`${ref.area} ${ref.task} 담당`);
  return `${esc(value)}${state.editable?`<button type="button" class="biz-write-open" data-bp-cell="owner" data-bp-row="${row}" aria-label="${esc(`${ref.area} ${ref.task} 담당 쓰기`)}">${value?'수정':'쓰기'}</button>`:''}`;
}
// ---- BIZ-기록하나로 B-3: 진행 칸 = 사업 '지금 상황'(설계 docs/design/record-one.md 2-4·2-7·3-1) ----
// 그 주에 보이는 글 = 같은 사업의 week_start ≤ 그 주인 가장 나중 행(지난주 글이 이번 주에 이어 보임). 이번 주에 고치면 이번 주 행(지난주 행은 그대로).
// 처음 한 번 채우기: 지금 상황 행이 하나도 없는 사업만 전환 주 행으로 — 전환 주(없으면 그 앞 주) 임시저장의 같은 칸 글(명진이 그 주에 직접 쓴 줄,
// 없으면 weekly-base.js가 그 주에 깔아 둔 한글 파일 바탕 칸 글)·담당. 둘 다 없으면 '—'. 사람이 쓴 행은 덮지 않는다(DB 고유 색인 + 건너뛰기).
// 칸 아래 흐린 '이번 주 기록 n' = 그 주 사업 보고 줄 + 그 주에 걸친 사업 기록(읽기만, 누르면 펼침, 보고 줄은 누르면 그 보고가 열림).
const nowKit=()=>Promise.all([import('./business-now-model.mjs'),import('./business-now-data.js'),import('./fold-chevron.mjs')]).then(([NM,ND,F])=>({NM,ND,chev:F.chevHtml}));
let filledWs='',listening=false;
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
    window.addEventListener(ND.BIZ_NOW_EVENT,e=>{if(e.detail?.records&&state?.now&&!state.editing&&box?.isConnected)void paint()});
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
function recsHtml(ref,items,records){
  const {NM,chev}=state.kit,recs=state.now.recs.get(ref.space)||[],n=items.length+recs.length;
  if(!n)return '';
  const open=!!state.openRecs?.has(ref.space);
  const btn=`<button type="button" class="row-act biz-rec-n" data-bp-recs="${esc(ref.space)}" aria-expanded="${open}" aria-label="${esc(`${ref.area} ${ref.task} 이번 주 기록 ${n}`)}">이번 주 기록 ${n} ${chev(open)}</button>`;
  return open?`${btn}<div class="biz-rec-list" data-bp-rec-list>${factsHtml(items,records)}${recs.map(r=>`<p class="biz-rec-line">${esc(NM.recordLine(r))}</p>`).join('')}</div>`:btn;
}
function nowProgressCell(ref,row,items,records){
  const {NM}=state.kit,ed=state.editing,v=NM.nowView(state.now.rows,ref.space,state.from);
  if(ed&&ed.kind==='progress'&&ed.row===row)return editBox('progress',v.body,`${ref.area} ${ref.task} 지금 상황`,NM.NOW_BODY_MAX);
  const lines=v.body?v.body.split('\n'):[];
  const body=lines.length?lines.map(l=>`<p class="biz-hand-line">${esc(l)}</p>`).join(''):'<span class="biz-now-empty">—</span>';
  const btn=state.editable?`<button type="button" class="row-act biz-write-open" data-bp-cell="progress" data-bp-row="${row}" aria-label="${esc(`${ref.area} ${ref.task} 지금 상황 쓰기`)}">${lines.length?'수정':'쓰기'}</button>`:'';
  return `${body}<div class="biz-now-foot">${recsHtml(ref,items,records)}${btn}</div>`;
}
function nowOwnerCell(ref,row){
  const {NM}=state.kit,ed=state.editing,v=NM.nowView(state.now.rows,ref.space,state.from);
  if(ed&&ed.kind==='owner'&&ed.row===row)return editBox('owner',v.owner,`${ref.area} ${ref.task} 담당`,NM.OWNER_MAX);
  return `${esc(v.owner)}${state.editable?`<button type="button" class="row-act biz-write-open" data-bp-cell="owner" data-bp-row="${row}" aria-label="${esc(`${ref.area} ${ref.task} 담당 쓰기`)}">${v.owner?'수정':'쓰기'}</button>`:''}`;
}
async function saveNowEdit(ed,field,ref){
  const {NM,ND}=state.kit,owner=ed.kind==='owner';
  const v=owner?NM.checkOwner(field.value):NM.checkNowBody(field.value);
  if(!v.ok){field.setAttribute('aria-invalid','true');say(`${owner?'담당':'지금 상황'}은 ${v.max}자까지 쓸 수 있어요.`);return}
  const run=state.run,week=state.from;
  for(const b of box.querySelectorAll('[data-bp-edit-save],[data-bp-edit-cancel]'))b.disabled=true;
  say('저장 중…');
  try{
    const rows=await ND.writeNow(window.KPTURuntime,{rows:state.now.rows,spaceId:ref.space,week,change:owner?{owner_text:v.value}:{body:v.value}});
    if(!state||run!==state.run||!state.now)return;
    state.now.rows=rows;state.editing=null;say('저장했어요.');renderPaper();
  }catch{if(state&&run===state.run){say('저장하지 못했어요. 잠시 뒤 다시 해 주세요.');for(const b of box.querySelectorAll('[data-bp-edit-save],[data-bp-edit-cancel]'))b.disabled=false}}
}
function paperHtml(placed,records,untagged,all,lineOf){
  const rows=[],refs=[];
  for(const r of records)delete r.used; // 다시 그릴 때마다 보고 줄을 처음부터 짝지음(전에는 두 번째 그림부터 보고 열기 버튼이 빠졌음)
  for(const area of placed.areas)area.rows.forEach((row,i)=>{
    const ref={area:area.name,task:row.task?.name||'',space:String(row.task?.id??area.id)},n=refs.push(ref)-1;
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
// el = 사업 보고 화면의 접는 칸 #bizWeekBox(<details>). 처음 펼칠 때 이번 주로 그린다.
export function mountWeekSummary(el,{meetings}){
  ensureBox(el);
  if(!state){const week=weekOf(currentWeek());state={meetings,from:week.from,to:week.to,run:0,view:null,draft:null,editable:false,store:null,editing:null,rowRefs:[]};}
  else state.meetings=meetings;
  void paint();
}
// 사업 보고가 바뀌면(펼쳐 있고 쓰는 칸이 없을 때만) 다시 그린다.
export function refreshWeekSummary(){if(box?.open&&state&&!state.editing)void paint()}
