// MTG-프로젝트합치기 2단계: 사업 보고 화면 위 [사업요약표 미리보기] (docs/design/project-into-report.md 5절).
// 기간(기본 이번 주, 서울 월~일)의 사업 보고로 한글 문서 모양 미리보기: 위 '1) 요약' 표(사업영역 | 세부 과제 | 진행 상황 및 이후 계획 | 담당),
// 아래 '2) 세부 내용 — 회의·활동 결과'(날짜순). 줄 세우기는 주간보고 ②와 같은 placeRecords, 보고 한 줄은 주간보고 meetingLine.
// 진행 = 그 사업영역 보고 한 줄들(AI 한 줄 요약은 ai-assist 별도 PR 뒤), 이후 계획 = '다음 할 일'. 담당 칸은 비움(결정 ③).
// 서버에 새로 저장하는 것은 없다(계산만). [HWP로 내려받기]는 그 주 [주간 정리]의 기존 한글 파일 상자를 연다.
import {previewRecords,weekOf,shiftDays,nextPlanLines} from './business-area-model.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todaySeoul=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
const shortDay=day=>{const [,m,d]=day.split('-');return `${Number(m)}.${Number(d)}`};
let dialog=null,state=null;

function ensureDialog(){
  if(dialog)return dialog;
  dialog=document.createElement('dialog');dialog.id='reportPreviewDialog';dialog.className='biz-preview';dialog.setAttribute('aria-labelledby','reportPreviewTitle');
  dialog.innerHTML=`<header class="biz-preview-head"><h2 id="reportPreviewTitle">사업요약표 미리보기</h2><button type="button" class="icon-btn" data-bp-close aria-label="닫기">×</button></header>
<div class="biz-preview-bar"><button type="button" class="mini" data-bp-week="-1" aria-label="지난 주">‹</button><span data-bp-period></span><button type="button" class="mini" data-bp-week="1" aria-label="다음 주">›</button>
<details class="biz-preview-range"><summary>기간 바꾸기</summary><label>시작<input type="date" data-bp-from></label><label>끝<input type="date" data-bp-to></label><button type="button" class="mini" data-bp-apply>적용</button></details></div>
<div class="biz-preview-scroll"><div class="biz-paper" data-bp-paper></div></div>
<footer class="biz-preview-foot"><p class="status" data-bp-status role="status" aria-live="polite"></p><button type="button" class="mini secondary" data-bp-hwpx>HWP로 내려받기</button></footer>`;
  document.body.append(dialog);
  dialog.addEventListener('click',onClick);
  dialog.addEventListener('cancel',e=>{e.preventDefault();close()});
  return dialog;
}
function close(){if(dialog?.open)dialog.close();state?.trigger?.focus?.({preventScroll:true});state=null}
function say(text){const el=dialog?.querySelector('[data-bp-status]');if(el)el.textContent=text||''}

async function onClick(e){
  if(!state)return;
  if(e.target===dialog||e.target.closest('[data-bp-close]'))return close();
  const week=e.target.closest('[data-bp-week]');if(week){const n=Number(week.dataset.bpWeek)*7;state.from=shiftDays(state.from,n);state.to=shiftDays(state.to,n);return paint()}
  if(e.target.closest('[data-bp-apply]')){const from=dialog.querySelector('[data-bp-from]').value,to=dialog.querySelector('[data-bp-to]').value;if(!from||!to||from>to)return say('시작과 끝 날짜를 확인해 주세요.');state.from=from;state.to=to;dialog.querySelector('.biz-preview-range').open=false;return paint()}
  const open=e.target.closest('[data-bp-open]');if(open){const id=open.dataset.bpOpen;close();const mod=await import('./report-open.js');return mod.openReport(id)}
  if(e.target.closest('[data-bp-hwpx]')){const day=state.from;close();window.KPTURouter?.go?.('journal',{source:'delegated'});return waitJournal().then(j=>j?.showWeek?.(day,{hwpx:true}))}
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
    paper.innerHTML=paperHtml(placed,records,untagged,all,lineOf);
  }catch(err){if(state&&run===state.run)paper.innerHTML=`<p class="journal-muted">${esc(err?.message||'미리보기를 만들지 못했어요.')}</p>`}
}
// 표의 한 칸: 진행(보고 줄, 누르면 그 보고) + 이후 계획(다음 할 일, 중복 없이).
function cellHtml(items,records){
  const progress=items.map(item=>{const rec=records.find(r=>r.day===item.day&&r.text===item.text&&!r.used);if(rec)rec.used=true;return {item,rec}});
  const plans=[...new Set(progress.flatMap(p=>p.rec?.requests||[]))];
  return `${progress.map(({item,rec})=>`<button type="button" class="biz-cell-line" ${rec?`data-bp-open="${esc(rec.meeting)}"`:''}>- ${esc(item.label&&item.issue?item.label.split(' › ').at(-1)+': ':'')}${esc(item.text)}</button>`).join('')}${plans.length?`<p class="biz-cell-plan">→ 이후: ${plans.map(esc).join(' / ')}</p>`:''}`;
}
function paperHtml(placed,records,untagged,all,lineOf){
  const rows=[];
  for(const area of placed.areas)area.rows.forEach((row,i)=>rows.push(`<tr>${i===0?`<th scope="rowgroup" rowspan="${area.rows.length}">${esc(area.name)}</th>`:''}<td>${esc(row.task?.name||'')}</td><td>${cellHtml(row.items,records)}</td><td></td></tr>`));
  for(const other of placed.others)rows.push(`<tr><th scope="row">${esc(other.name==='미분류'?'보관된 사업영역':other.name)}</th><td></td><td>${cellHtml(other.items,records)}</td><td></td></tr>`);
  const table=rows.length?`<table class="biz-sum-table"><thead><tr><th scope="col">사업영역</th><th scope="col">세부 과제</th><th scope="col">진행 상황 및 이후 계획</th><th scope="col">담당</th></tr></thead><tbody>${rows.join('')}</tbody></table>`:'<p class="journal-muted">이 기간에 사업영역 꼬리표를 단 사업 보고가 없어요.</p>';
  const miss=untagged.length?`<details class="biz-untagged"><summary>사업영역 안 단 보고 ${untagged.length}건 — 눌러서 달기</summary>${untagged.map(m=>`<button type="button" class="biz-cell-line" data-bp-open="${esc(m.id)}">${esc(lineOf(m))}</button>`).join('')}</details>`:'';
  const details=all.length?all.map(m=>{const day=new Date(Date.parse(m.meeting_at)+9*3600e3).toISOString().slice(0,10),plan=nextPlanLines(m.next_plan);return `<li><button type="button" class="biz-cell-line" data-bp-open="${esc(m.id)}"><span class="biz-day">${shortDay(day)}</span> ${esc(lineOf(m))}</button>${plan.length?`<p class="biz-cell-plan">→ 이후: ${plan.map(esc).join(' / ')}</p>`:''}</li>`}).join(''):'<li class="journal-muted">(이 기간 사업 보고 없음)</li>';
  return `<h3>1) 요약</h3>${table}${miss}<h3>2) 세부 내용 — 회의·활동 결과</h3><ul class="biz-detail-list">${details}</ul>`;
}

// meetings(): 사업 보고 화면이 읽어 둔 사업 보고 전체(select=*). 화면의 읽기를 그대로 쓰고 따로 읽지 않는다.
export function openReportPreview(trigger,{meetings}){
  ensureDialog();const week=weekOf(todaySeoul());
  state={trigger,meetings,from:week.from,to:week.to,run:0};
  if(!dialog.open)dialog.showModal();void paint();
  dialog.querySelector('[data-bp-close]').focus({preventScroll:true});
}
