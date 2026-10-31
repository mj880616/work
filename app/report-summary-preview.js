import {emptyHtml} from './wait-state.js';
// MTG-프로젝트합치기 2단계: 사업 보고 화면 위 [사업요약표 미리보기] (docs/design/project-into-report.md 5절).
// 기간(기본 이번 주, 서울 월~일)의 사업 보고로 한글 문서 모양 미리보기: 위 '1) 요약' 표(사업영역 | 세부 과제 | 진행 상황 및 이후 계획 | 담당),
// 아래 '2) 세부 내용 — 회의·활동 결과'(날짜순). 줄 세우기는 주간보고 ②와 같은 placeRecords, 보고 한 줄은 주간보고 meetingLine.
// 한 줄 업데이트(칸 oneline)는 쓴 문장 그대로 칸 맨 위, 2) 세부 내용에는 넣지 않는다(MTG-한줄업데이트).
// 진행 = 그 사업영역(꼬리표)의 AI 한 줄 요약(설계 12·13절) — 한 줄이 없거나 AI를 못 쓰면 보고 한 줄들. 이후 계획 = '다음 할 일'. 담당 칸은 비움(결정 ③).
// AI 한 줄: 기간이 월~일 한 주일 때만, 표를 그린 뒤 ai-assist area_week_summary 한 번(표에 나온 꼬리표 id, 20개까지). 서버가 그 주 임시저장 칸에 남긴다.
//   한 줄 옆 작은 [고치기] → 그 주 임시저장 칸에 고친 줄(edited)로 저장(결정 ⑤, weekly-draft-store.js changeWeekAreaSummary). 보고 줄은 접어 둔다.
//   한도·실패·준비 전이면 조용히 보고 줄 그대로 + 위 줄에 작은 안내. 기기에 아무것도 저장하지 않는다(같은 창을 다시 열 때만 메모리에서 다시 씀).
// [HWP로 내려받기]는 그 주 [주간 정리]의 기존 한글 파일 상자를 연다(② 표도 같은 임시저장 한 줄을 쓴다).
import {previewRecords,weekOf,shiftDays,nextPlanLines} from './business-area-model.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todaySeoul=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
const shortDay=day=>{const [,m,d]=day.split('-');return `${Number(m)}.${Number(d)}`};
let dialog=null,state=null;

function ensureDialog(){
  if(dialog)return dialog;
  dialog=document.createElement('dialog');dialog.id='reportPreviewDialog';dialog.className='biz-preview';dialog.setAttribute('aria-labelledby','reportPreviewTitle');
  dialog.innerHTML=`<header class="biz-preview-head"><h2 id="reportPreviewTitle">사업요약표 미리보기</h2><button type="button" class="icon-btn" data-bp-close aria-label="닫기">×</button></header>
<div class="biz-preview-bar"><button type="button" class="mini" data-bp-week="-1" aria-label="지난 주">‹</button><span data-bp-period></span><button type="button" class="mini" data-bp-week="1" aria-label="다음 주">›</button><span class="biz-ai-note" data-bp-ai role="status" aria-live="polite"></span>
<details class="biz-preview-range"><summary>기간 바꾸기</summary><label>시작<input type="date" data-bp-from></label><label>끝<input type="date" data-bp-to></label><button type="button" class="mini" data-bp-apply>적용</button></details></div>
<div class="biz-preview-scroll"><div class="biz-paper" data-bp-paper></div></div>
<footer class="biz-preview-foot"><p class="status" data-bp-status role="status" aria-live="polite"></p><button type="button" class="mini secondary" data-bp-hwpx>HWP로 내려받기</button></footer>`;
  document.body.append(dialog);
  dialog.addEventListener('click',onClick);
  dialog.addEventListener('cancel',e=>{e.preventDefault();if(state?.editing){state.editing='';paintAreas();return}close()});
  // 한 줄 고치기 칸: Enter = 저장(Esc는 위 cancel이 고치기만 닫는다).
  dialog.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.target.closest?.('[data-bp-edit-input]')&&state?.editing){e.preventDefault();void saveEdit(state.editing,false)}});
  return dialog;
}
// UI-뒤로가기겹규칙: 맨 <dialog>라 라우터 겹 하나를 연다(뒤로가기 = 고치던 줄이 있으면 그것만, 아니면 이 창 닫기).
// 닫고 다른 화면으로 갈 때는 겹의 뒤로가기가 도착한 뒤 간다(늦게 온 뒤로가기가 새 화면 기록을 지우지 않게).
let layer=null;
function close(){
  const l=layer;layer=null;
  const done=l?new Promise(ok=>{const t=setTimeout(ok,400);window.addEventListener('popstate',()=>{clearTimeout(t);queueMicrotask(ok)},{once:true})}):Promise.resolve();
  l?.close();
  if(dialog?.open)dialog.close();state?.trigger?.focus?.({preventScroll:true});state=null;
  return done;
}
function say(text){const el=dialog?.querySelector('[data-bp-status]');if(el)el.textContent=text||''}

async function onClick(e){
  if(!state)return;
  if(e.target===dialog||e.target.closest('[data-bp-close]'))return close();
  const week=e.target.closest('[data-bp-week]');if(week){const n=Number(week.dataset.bpWeek)*7;state.from=shiftDays(state.from,n);state.to=shiftDays(state.to,n);return paint()}
  if(e.target.closest('[data-bp-apply]')){const from=dialog.querySelector('[data-bp-from]').value,to=dialog.querySelector('[data-bp-to]').value;if(!from||!to||from>to)return say('시작과 끝 날짜를 확인해 주세요.');state.from=from;state.to=to;dialog.querySelector('.biz-preview-range').open=false;return paint()}
  const edit=e.target.closest('[data-bp-edit]');if(edit)return startEdit(edit.dataset.bpEdit);
  const cancel=e.target.closest('[data-bp-edit-cancel]');if(cancel){state.editing='';return paintAreas()}
  const saveBtn=e.target.closest('[data-bp-edit-save]');if(saveBtn)return saveEdit(saveBtn.dataset.bpEditSave,false);
  const reset=e.target.closest('[data-bp-edit-reset]');if(reset)return saveEdit(reset.dataset.bpEditReset,true);
  const open=e.target.closest('[data-bp-open]');if(open){const id=open.dataset.bpOpen;await close();const mod=await import('./report-open.js');return mod.openReport(id)}
  if(e.target.closest('[data-bp-hwpx]')){const day=state.from;await close();window.KPTURouter?.go?.('journal',{source:'delegated'});return waitJournal().then(j=>j?.showWeek?.(day,{hwpx:true}))}
}
// 업무일지 부품이 아직 안 불러와졌으면 잠깐(최대 5초) 기다린다.
async function waitJournal(){for(let i=0;i<50&&!window.KPTUJournal?.showWeek;i++)await new Promise(r=>setTimeout(r,100));return window.KPTUJournal}

async function paint(){
  const paper=dialog.querySelector('[data-bp-paper]'),{from,to}=state;
  dialog.querySelector('[data-bp-period]').textContent=`${shortDay(from)} ~ ${shortDay(to)}`;
  dialog.querySelector('[data-bp-from]').value=from;dialog.querySelector('[data-bp-to]').value=to;say('');
  const run=++state.run;
  try{
    const [{placeRecords},{meetingLine},sheet]=await Promise.all([import('./journal-weekly.js'),import('./journal-data.js'),import('./report-places-sheet.js')]);
    const places=await sheet.loadReportPlaces().catch(()=>null);if(!state||run!==state.run)return;
    const meetings=state.meetings();
    const lineOf=mt=>meetingLine({...mt,meeting_at:null}); // 표·세부 줄은 시각 없이(날짜는 세부 줄 앞에 따로)
    const {records,untagged,all}=previewRecords(meetings,{from,to,lineOf});
    const placed=placeRecords(records,places?.projects||null);
    state.areas=new Map();state.ai=null;state.editing='';aiNote('');
    paper.innerHTML=paperHtml(placed,records,untagged,all,lineOf);
    paintAreas();
    if(isWeek(from,to)&&state.areas.size)void loadAi(run,records);
  }catch(err){if(state&&run===state.run)paper.innerHTML=`<p class="journal-muted">${esc(err?.message||'미리보기를 만들지 못했어요.')}</p>`}
}
// ---- 사업영역 AI 한 줄 ----
const isWeek=(from,to)=>weekOf(from).from===from&&shiftDays(from,6)===to;
const MAX_AREAS=20; // 서버 AREA_SUMMARY_MAX_AREAS
const aiCache=new Map(); // 열쇠(주·꼬리표·보고 판) → 서버 답. 이 페이지 메모리에만(기기 저장 없음).
// 서버 오류 → 작은 안내(기다림·실패 모두 위 줄 한 곳).
const AI_NOTE={monthly_limit:'이번 달 AI 한도에 닿았어요',daily_limit:'오늘 AI 횟수를 다 썼어요',not_ready:'AI 한 줄은 준비 중이에요',offline:'인터넷 연결이 없어요',ai_not_configured:'지금은 AI를 쓸 수 없어요',session_required:'다시 로그인이 필요해요',not_found:'사업영역을 찾지 못했어요'};
function aiNote(text,busy=false){const el=dialog?.querySelector('[data-bp-ai]');if(!el)return;el.textContent=text||'';if(busy)el.setAttribute('aria-busy','true');else el.removeAttribute('aria-busy')}
async function loadAi(run,records){
  const ids=[...state.areas.keys()].slice(0,MAX_AREAS),week=state.from;
  const meetings=state.meetings(),byId=new Map(meetings.map(m=>[String(m.id),m]));
  const key=JSON.stringify([week,ids,records.map(r=>[r.meeting,byId.get(r.meeting)?.updated_at||''])]);
  let answer=aiCache.get(key);
  if(!answer){
    aiNote('AI 한 줄 만드는 중…',true);
    const {callAiAssist}=await import('./basket-ai-summary.js');
    const r=await callAiAssist({kind:'area_week_summary',week_start:week,area_ids:ids});
    if(!state||run!==state.run)return;
    if(!r.ok||!Array.isArray(r.data?.items)){aiNote(`${AI_NOTE[r.code]||'AI 한 줄을 만들지 못했어요'} · 보고 줄로 보여요`);return keepEdited(run,week)}
    answer={items:r.data.items,partial:!!r.data.partial};aiCache.set(key,answer);
  }
  if(!state||run!==state.run)return;
  state.ai=new Map(answer.items.filter(i=>i&&typeof i.summary==='string'&&state.areas.has(String(i.area_id).toLowerCase())).map(i=>[String(i.area_id).toLowerCase(),{text:i.summary,edited:i.from==='edited'}]));
  aiNote(answer.partial||state.areas.size>MAX_AREAS?'AI 한 줄은 일부 사업영역만이에요':'');
  paintAreas();
}
// AI를 못 쓸 때: 그 주 임시저장에 사람이 고친 줄이 있으면 그것만 보이고(AI 줄은 보고가 바뀌었을 수 있어 쓰지 않음), [한 줄 쓰기]는 열어 둔다.
async function keepEdited(run,week){
  let areas={};
  try{const store=await import('./weekly-draft-store.js'),read=await store.readWeekDraft(week);if(read.missing)return;areas=store.draftAreaSummaries(read.row?.draft)}catch{return}
  if(!state||run!==state.run)return;
  state.ai=new Map(Object.entries(areas).filter(([id,e])=>e.edited&&state.areas.has(id)).map(([id,e])=>[id,{text:e.text,edited:true}]));
  paintAreas();
}
// 꼬리표 칸 하나: AI 한 줄(+[고치기]) 위, 보고 줄은 접어서. 한 줄이 없으면 보고 줄 그대로.
function areaInner(id){
  const a=state.areas.get(id),line=state.ai?.get(id),pre=a.prefix?esc(a.prefix)+': ':'';
  if(state.editing===id){const v=line?.text||'';return `<div class="biz-ai-edit"><input type="text" maxlength="200" value="${esc(v)}" data-bp-edit-input aria-label="사업영역 한 줄 고치기"><button type="button" class="mini" data-bp-edit-save="${esc(id)}">저장</button><button type="button" class="mini secondary" data-bp-edit-cancel>취소</button>${line?.edited?`<button type="button" class="mini secondary" data-bp-edit-reset="${esc(id)}">AI 줄로</button>`:''}</div>${a.lines}`}
  if(!line)return `${a.lines}${state.ai?`<button type="button" class="biz-ai-add" data-bp-edit="${esc(id)}">한 줄 쓰기</button>`:''}`;
  return `<p class="biz-ai-line">- ${pre}${esc(line.text)}${line.edited?'<span class="optional"> (고침)</span>':''} <button type="button" class="biz-ai-add" data-bp-edit="${esc(id)}" aria-label="이 사업영역 한 줄 고치기">고치기</button></p><details class="biz-ai-more"><summary>보고 ${a.count}건</summary>${a.lines}</details>`;
}
function paintAreas(){for(const el of dialog.querySelectorAll('[data-bp-area]')){const id=el.dataset.bpArea;if(state.areas.has(id))el.innerHTML=areaInner(id)}}
function startEdit(id){state.editing=id;paintAreas();const input=dialog.querySelector('[data-bp-edit-input]');input?.focus();input?.select?.()}
async function saveEdit(id,reset){
  const input=dialog.querySelector('[data-bp-edit-input]'),text=reset?'':String(input?.value||'').trim(),run=state.run,week=state.from;
  for(const b of dialog.querySelectorAll('[data-bp-edit-save],[data-bp-edit-reset]'))b.disabled=true;
  say('저장 중…');
  try{
    const {changeWeekAreaSummary}=await import('./weekly-draft-store.js');
    const r=await changeWeekAreaSummary({start:week,areaId:id,text});
    if(!state||run!==state.run)return;
    if(r.missing){say('임시저장 칸이 아직 준비 중이에요.');state.editing='';return paintAreas()}
    aiCache.clear();state.editing='';
    if(text){state.ai=state.ai||new Map();state.ai.set(id,{text,edited:true});say('한 줄을 고쳐 저장했어요.');return paintAreas()}
    say('AI 줄로 되돌렸어요.');return paint();
  }catch(err){if(state&&run===state.run){say(err?.code==='too_long'?err.message:'저장하지 못했어요. 잠시 뒤 다시 해 주세요.');for(const b of dialog.querySelectorAll('[data-bp-edit-save],[data-bp-edit-reset]'))b.disabled=false}}
}
// 표의 한 칸: 꼬리표마다 진행(AI 한 줄 또는 보고 줄, 누르면 그 보고) + 이후 계획(다음 할 일, 중복 없이).
// 꼬리표 묶음은 state.areas(id → {lines(보고 줄 html), count, prefix})에 두고 paintAreas가 [data-bp-area] 칸을 채운다.
function cellHtml(items,records){
  const progress=items.map(item=>{const rec=records.find(r=>r.day===item.day&&r.text===item.text&&!r.used);if(rec)rec.used=true;return {item,rec}});
  const plans=[...new Set(progress.flatMap(p=>p.rec?.requests||[]))];
  const lineHtml=({item,rec})=>`<button type="button" class="biz-cell-line" ${rec?`data-bp-open="${esc(rec.meeting)}"`:''}>- ${esc(item.label&&item.issue?item.label.split(' › ').at(-1)+': ':'')}${esc(item.text)}</button>`;
  // MTG-한줄업데이트: 한 줄 업데이트는 쓴 문장 그대로 칸 맨 위에(AI 한 줄 묶음에 넣지 않음). 누르면 그 보고로.
  const groups=new Map(),loose=[],ones=[];
  for(const p of progress){if(p.rec?.oneline){ones.push(p);continue}const id=String(p.rec?.id||'').toLowerCase();if(!id){loose.push(p);continue}if(!groups.has(id))groups.set(id,[]);groups.get(id).push(p)}
  for(const [id,list] of groups){const first=list[0].item;state.areas.set(id,{lines:list.map(lineHtml).join(''),count:list.length,prefix:first.label&&first.issue?first.label.split(' › ').at(-1):''})}
  return `${ones.map(lineHtml).join('')}${[...groups.keys()].map(id=>`<div class="biz-cell-area" data-bp-area="${esc(id)}"></div>`).join('')}${loose.map(lineHtml).join('')}${plans.length?`<p class="biz-cell-plan">→ 이후: ${plans.map(esc).join(' / ')}</p>`:''}`;
}
function paperHtml(placed,records,untagged,all,lineOf){
  const rows=[];
  for(const area of placed.areas)area.rows.forEach((row,i)=>rows.push(`<tr>${i===0?`<th scope="rowgroup" rowspan="${area.rows.length}">${esc(area.name)}</th>`:''}<td>${esc(row.task?.name||'')}</td><td>${cellHtml(row.items,records)}</td><td></td></tr>`));
  for(const other of placed.others)rows.push(`<tr><th scope="row">${esc(other.name==='미분류'?'보관된 사업영역':other.name)}</th><td></td><td>${cellHtml(other.items,records)}</td><td></td></tr>`);
  const table=rows.length?`<table class="biz-sum-table"><thead><tr><th scope="col">사업영역</th><th scope="col">세부 과제</th><th scope="col">진행 상황 및 이후 계획</th><th scope="col">담당</th></tr></thead><tbody>${rows.join('')}</tbody></table>`:emptyHtml('꼬리표 단 보고 없음');
  const miss=untagged.length?`<details class="biz-untagged"><summary>사업영역 안 단 보고 ${untagged.length}건 — 눌러서 달기</summary>${untagged.map(m=>`<button type="button" class="biz-cell-line" data-bp-open="${esc(m.id)}">${esc(lineOf(m))}</button>`).join('')}</details>`:'';
  const details=all.length?all.map(m=>{const day=new Date(Date.parse(m.meeting_at)+9*3600e3).toISOString().slice(0,10),plan=nextPlanLines(m.next_plan);return `<li><button type="button" class="biz-cell-line" data-bp-open="${esc(m.id)}"><span class="biz-day">${shortDay(day)}</span> ${esc(lineOf(m))}</button>${plan.length?`<p class="biz-cell-plan">→ 이후: ${plan.map(esc).join(' / ')}</p>`:''}</li>`}).join(''):`<li>${emptyHtml('사업 보고 없음')}</li>`;
  return `<h3>1) 요약</h3>${table}${miss}<h3>2) 세부 내용 — 회의·활동 결과</h3><ul class="biz-detail-list">${details}</ul>`;
}

// meetings(): 사업 보고 화면이 읽어 둔 사업 보고 전체(select=*). 화면의 읽기를 그대로 쓰고 따로 읽지 않는다.
export function openReportPreview(trigger,{meetings}){
  ensureDialog();const week=weekOf(todaySeoul());
  state={trigger,meetings,from:week.from,to:week.to,run:0,areas:new Map(),ai:null,editing:''};
  if(!dialog.open)dialog.showModal();void paint();
  if(!layer)layer=window.KPTURouter?.layer?.open('report-preview',{close:()=>{if(state?.editing){state.editing='';paintAreas();return false}layer=null;close();return true}})||null;
  dialog.querySelector('[data-bp-close]').focus({preventScroll:true});
}
