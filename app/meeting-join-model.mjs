// REC-한회의로잇기 PR-3(설계 docs/design/rec-join.md 3-3·3-4·3-5절): 두 번 녹음한 회의를 한 보고로 — 화면의 순수 규칙.
// 물음·잇기·진행 줄·끝 줄·보고 상세 되돌리기의 주인은 meeting-join.js 하나이고, 이 파일은 DOM·네트워크 없이 그 규칙만 갖는다(단위 시험 tests/meeting-join-model.test.mjs).
// - 어느 보고에 이을지는 늘 사람이 고른다. 이 파일의 '가장 가까운 보고'는 물음에 먼저 보일 한 건일 뿐, 저절로 잇지 않는다.
// - AI 요약의 할 일은 후보로만(MTG-할일자동생성금지와 같은 규칙): 그 보고에 이미 붙은 할 일과 제목이 같은 것은 뺀다.
// - 이름·시각은 화면이 자기 보고 목록(로그인으로 읽은 행)에서 붙인다. 서버는 보고 id와 녹음 길이만 준다.
// - PR-4(보고 ⋯ [다른 보고에 합치기]): 합치기 줄은 시각을 붙인 이름(labelWhen)과 휴지통으로 옮긴 보고(doneText from)를 쓴다.
// - PR-5 (라) 입력 창의 전사 글 물음은 S61-24(REC-요약단추삭제)에서 화면과 함께 뺐다.
import {normalizeDraft,actionRows} from './meeting-transcript-model.mjs';

const KST=9*3600000;
const two=n=>String(n).padStart(2,'0');

// 보고 일시 등 → ms. 시간대 표시가 없으면 서울 시각으로 본다(Edge join-job.mjs atMs와 같은 규칙). 읽지 못하면 NaN.
export function atMs(v){
  if(typeof v!=='string')return NaN;
  const s=v.trim();
  if(!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s))return NaN;
  const zoned=/(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/.test(s.slice(16));
  const t=Date.parse(zoned?s:`${s}+09:00`);
  return Number.isFinite(t)?t:NaN;
}
function seoul(ms){const d=new Date(ms+KST);return {y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate(),h:d.getUTCHours(),min:d.getUTCMinutes()}}
export const seoulDayKey=ms=>{if(!Number.isFinite(ms))return '';const s=seoul(ms);return `${s.y}-${two(s.m)}-${two(s.d)}`};
export const seoulHm=ms=>{if(!Number.isFinite(ms))return '';const s=seoul(ms);return `${two(s.h)}:${two(s.min)}`};
// 다른 날이면 '11.4. 10:00', 같은 날이면 '10:02'.
export function whenText(ms,dayMs=NaN){
  if(!Number.isFinite(ms))return '';
  if(Number.isFinite(dayMs)&&seoulDayKey(ms)===seoulDayKey(dayMs))return seoulHm(ms);
  const s=seoul(ms);return `${s.m}.${s.d}. ${seoulHm(ms)}`;
}

// 두 전사 사이 줄(Edge join-job.mjs joinMark '― 이어서 · HH:MM 녹음 ―' / '― 이어서 ―'). 이 줄이 있는 회의록 전문만 잇기 기록을 읽는다
// (그 밖의 보고를 열 때는 요청을 더하지 않는다).
export const hasJoinMark=notes=>/^― 이어서(?: · \d{2}:\d{2} 녹음)? ―$/m.test(String(notes||''));

// [회의] 칸인가(Edge isMeetingReport와 같은 기준 — activity_kind가 없거나 'meeting').
export const isMeetingReport=m=>!!m&&(m.activity_kind==null||m.activity_kind==='meeting');
// 보고 이름: 회의명(+ 차수). 비면 '사업 보고'.
export function reportName(m){
  const name=String(m?.series_name||m?.title||'').trim()||'사업 보고';
  const r=Number(m?.round_no);
  return Number.isInteger(r)&&r>0?`${name} ${r}차`:name;
}
export function minutesText(seconds){const s=Number(seconds)||0;return s>0?`녹음 ${Math.max(1,Math.round(s/60))}분`:''}

// 서버 후보([{meeting_id, seconds}]) + 화면이 로그인으로 읽은 보고 행 → 보이는 후보(읽은 [회의] 보고만, 서버가 준 순서).
export function mergeCandidates(list,rows){
  const byId=new Map((Array.isArray(rows)?rows:[]).filter(r=>r?.id).map(r=>[String(r.id),r]));
  const out=[],seen=new Set();
  for(const c of Array.isArray(list)?list:[]){
    const id=String(c?.meeting_id||''),m=byId.get(id);
    if(!id||seen.has(id)||!m||m.deleted_at||!isMeetingReport(m))continue;
    seen.add(id);out.push({id,seconds:Number(c.seconds)||0,meeting:m});
  }
  return out;
}
// [다른 보고 선택] 줄: 같은 날 녹음으로 쓴 보고(서버 후보, 녹음 시작에 가까운 순)부터, 그다음 내 목록의 다른 [회의] 보고(최근 순, limit까지).
export const PICK_OTHERS=8;
export function pickRows(cands,others,{startMs=NaN,dayMs=NaN,limit=PICK_OTHERS}={}){
  const first=(Array.isArray(cands)?cands:[]).slice().sort((a,b)=>{
    const da=Math.abs(atMs(a.meeting?.meeting_at)-startMs),db=Math.abs(atMs(b.meeting?.meeting_at)-startMs);
    return (Number.isFinite(da)?da:Infinity)-(Number.isFinite(db)?db:Infinity);
  });
  const ids=new Set(first.map(c=>c.id));
  const rest=(Array.isArray(others)?others:[]).filter(m=>m?.id&&!ids.has(String(m.id))&&!m.deleted_at&&isMeetingReport(m)&&Number.isFinite(atMs(m.meeting_at)))
    .sort((a,b)=>atMs(b.meeting_at)-atMs(a.meeting_at)).slice(0,Math.max(0,limit));
  return [
    ...first.map(c=>({value:c.id,label:reportName(c.meeting),note:[whenText(atMs(c.meeting.meeting_at),dayMs),minutesText(c.seconds)].filter(Boolean).join(' · ')})),
    ...rest.map(m=>({value:String(m.id),label:reportName(m),note:whenText(atMs(m.meeting_at),dayMs)})),
  ];
}

// ---- 진행 줄·끝 줄(맨 위 알림 줄 손님, 녹음 띠와 따로) ----
export const ACTIVE=Object.freeze(['queued','running']);
// 줄 종류: running(잇는 중) · done(끝, 아직 안 닫음) · failed(멈춤, 아직 안 닫음) · ''(줄 없음 — 닫았거나 통째로 되돌림).
export function lineState(job){
  if(!job?.id)return '';
  if(ACTIVE.includes(job.status))return 'running';
  if(job.seen_at)return '';
  if(job.status==='done')return 'done';
  if(job.status==='failed')return 'failed';
  return '';
}
export function progressText(name,job){
  const step=job?.stage==='summary'&&Number(job.step_total)>1?` ${Math.min(Number(job.step_no)+1,Number(job.step_total))}/${job.step_total}`:'';
  const what=job?.mode==='report'?'합치는 중':'잇는 중';
  return `${name}에 ${what} · 전체 다시 요약${step} · 화면을 옮겨도 계속돼요`;
}
// from = 합치기(mode report)에서 휴지통으로 옮긴 보고(시안 ④ '10:02 보고에 합쳤어요. 이 보고는 휴지통으로 옮겼어요'). 모르면 뺀다.
export const doneText=(name,job,from='')=>job?.mode==='report'?`${name} 보고에 합쳤어요${from?`. ${from} 보고는 휴지통으로 옮겼어요`:''}`:`${name} 보고에 이어 붙였어요`;
// 멈춘 줄: '○○에 잇지 못했어요. 이유' / 합치기면 '○○에 합치지 못했어요. 이유'.
export const stopText=(name,job,reason)=>`${name}에 ${job?.mode==='report'?'합치지':'잇지'} 못했어요. ${reason}`;
// 합치기 줄·고르기의 보고 이름: 시각 + 이름(같은 이름 보고가 하루에 둘일 때 가르려고, 시안 ④ '10:02 보고에 합쳤어요'). 같은 날이면 시:분만.
export function labelWhen(m,dayMs=NaN){return [whenText(atMs(m?.meeting_at),dayMs),reportName(m)].filter(Boolean).join(' ')}

// ---- 보고 상세: [합치기 전 글로 되돌리기] / [이은 글로 다시] ----
// job = 그 보고에 마지막으로 적용된 잇기 작업 행(주인 읽기). 지금 '회의 결과' 글이 이은 글이면 before, 합치기 전 글이면 joined.
// 둘 다 아니면(사람이 수정함) before + edited(누르기 전에 한 번 묻는다 — 서버는 수정한 글을 따로 남겨 둔다). 두 원본이 같으면 버튼 없음.
export function undoChoice(current,job){
  if(!job?.id||job.status!=='done'||!job.applied_at||job.undone_at)return null;
  const now=String(current??''),before=String(job.before_result??''),joined=String(job.result_text??'');
  if(before===joined)return null;
  if(now===joined)return {scope:'before',edited:false};
  if(now===before)return {scope:'joined',edited:false};
  return {scope:'before',edited:true};
}
export const UNDO_LABEL=Object.freeze({before:'합치기 전 글로 되돌리기',joined:'이은 글로 다시'});

// ---- 새 할 일 후보(3-4절, MTG-할일자동생성금지와 같은 규칙) ----
// 제목 비교 열쇠(todo-radar-data.js normalizeTitle과 같은 방법: 소문자·NFKC·빈칸·문장부호 뺌).
export const titleKey=v=>String(v??'').toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu,'').slice(0,80);
// 잇기 작업의 요약(draft) → 후보 줄({title,due}). 그 보고에 이미 붙은 할 일과 제목이 같은 것·같은 제목 두 번은 뺀다.
export function candidateItems(draft,taskTitles=[]){
  const d=normalizeDraft({draft});
  if(!d)return [];
  const have=new Set((Array.isArray(taskTitles)?taskTitles:[]).map(titleKey).filter(Boolean)),seen=new Set(),out=[];
  for(const row of actionRows(d)){
    const k=titleKey(row.title);
    if(!k||have.has(k)||seen.has(k))continue;
    seen.add(k);out.push(row);
  }
  return out;
}

// ---- 잇기 작업 하나를 끝까지 지켜보기(join_read). 녹음 정리의 watchServerJob(meeting-server-job.mjs)과 같은 간격·같은 끊김 규칙. ----
// deps: {call(action,body,extra), sleep(ms), hidden()→bool, alive()→bool, onProgress(job)}
// 돌려줌: {kind:'done'|'failed'|'undone', job} | {kind:'gone', job}
export const JOIN_POLL_MS=5000,JOIN_POLL_HIDDEN_MS=30000;
export async function watchJoin(deps,{job=null,jobId=''}={}){
  const sleep=deps.sleep||(ms=>new Promise(r=>setTimeout(r,ms)));
  const alive=deps.alive||(()=>true);
  const id=job?.id||jobId;
  if(!id)throw new Error('');
  let cur=job,misses=0;
  for(;;){
    if(!alive())return {kind:'gone',job:cur};
    if(cur){
      deps.onProgress?.(cur);
      if(cur.status==='done')return {kind:'done',job:cur};
      if(cur.status==='failed')return {kind:'failed',job:cur};
      if(cur.status==='undone')return {kind:'undone',job:cur};
    }
    await sleep(deps.hidden?.()?JOIN_POLL_HIDDEN_MS:JOIN_POLL_MS);
    if(!alive())return {kind:'gone',job:cur};
    try{cur=(await deps.call('join_read',{job_id:id},{timeoutMs:30000}))?.job||cur;misses=0}
    catch(e){
      // 잠깐 끊김은 다시 본다(서버는 계속). 로그인 만료·권한·없음은 그대로 던진다.
      if(e?.code==='session_required'||e?.status===401||e?.status===403||e?.status===404)throw e;
      if(++misses>=60)throw e;
    }
  }
}

// 편집 저장 조건: 읽었을 때의 updated_at 그대로일 때만 덮는다(3-5절). 값이 없으면(읽은 칸에 없음) 조건을 걸지 않는다.
export function sameVersionFilter(updatedAt){
  if(updatedAt===undefined)return '';
  if(updatedAt===null)return '&updated_at=is.null';
  return `&updated_at=eq.${encodeURIComponent(String(updatedAt))}`;
}
