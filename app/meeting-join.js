// REC-한회의로잇기 PR-3(설계 docs/design/rec-join.md 3-3·3-4·3-5절, 시안 docs/design/mockups/rec-join.html ①②③): 두 번 녹음한 회의를 한 보고로.
// 이 모듈 하나가 아래의 주인이자 유일한 렌더러다(AGENTS.md 5절 one state owner).
// - 물음: 녹음 정리 결과를 열기 직전(meeting-recorder.js openServerResult가 ask를 부름), 같은 날 녹음으로 쓴 보고가 있을 때만 한 번
//   '오늘 녹음으로 쓴 보고가 있어요. 같은 회의인가요? · 10:02 ○○ · 녹음 38분' [다른 보고 선택] [새로 만들기] [그 보고에 잇기].
//   어느 보고에 이을지는 늘 사람이 고른다(서버·AI가 저절로 잇지 않음). 서버가 잇기를 모르면(표·Edge 적용 전) 묻지 않고 지금 길(초안 창).
// - [그 보고에 잇기] = Edge meeting-transcribe join_start(고른 보고 id + 녹음 결과 id만 — 작업공간·소유는 서버가 로그인으로 정함). 창은 뜨지 않고
//   녹음 띠는 바로 닫히며(다음 녹음을 바로 시작할 수 있게), 진행·끝은 맨 위 알림 줄(notice-bar.js 손님)에 '○○에 잇는 중' → '○○ 보고에 이어 붙였어요
//   [열기] [되돌리기]'. [되돌리기] = 통째로 되돌리기(명진 결정 '둠' — 회의 결과·전문·붙인 녹음까지, 녹음 결과는 띠 [초안 열기]로 돌아감).
//   앱을 다시 열면 join_list로 줄을 이어 그리고, 폰 알림 주소(?join_job=)면 그 보고를 연다.
// - 새 할 일은 저절로 만들지 않는다(MTG-할일자동생성금지와 같은 규칙·같은 부품): 잇기 요약의 할 일은 그 보고의 챙길 것 후보(todo-radar-data.js
//   addMeetingCandidates)로만 올리고, 보고 상세 '후속 할 일' 칸의 후보 줄에서 [할 일로]를 눌러야 생긴다. 이미 붙은 할 일과 제목이 같은 것은 뺀다.
// - 보고 상세 '회의 결과' 머리 옆 [합치기 전 글로 되돌리기] / [이은 글로 다시](join_undo before·joined). 회의록 전문에 이은 줄('― 이어서 …')이
//   있는 [회의] 보고만 잇기 기록을 읽는다(그 밖의 보고를 열 때 요청을 더하지 않음).
// - PR-4(설계 4절 PR-4 줄·3-5절, 시안 ④): 보고 ⋯ [다른 보고에 합치기] — 이미 따로 저장한 두 보고를 하나로. 메뉴 항목은 meeting-round-detail.js
//   mrdEnsureMoreMenu 한 곳(목록·달력·상세 세 곳에 같이 뜸)이고, 고르기·시작·줄·되돌리기의 주인은 여기다. 이 보고(없어질 보고)를 고른 보고에 합치고
//   (join_start {target_meeting_id, source:{meeting_id}}), 끝나면 이 보고는 휴지통으로 간다(서버 DB 함수가 한 트랜잭션으로). 어느 보고에 합칠지는 사람이 고른다.
//   끝 줄 [되돌리기]와 합친 보고 ⋯ [두 보고로 되돌리기] = 통째로 되돌리기(all: 두 글·옮긴 자료·할 일 연결을 제자리로, 휴지통의 보고를 꺼냄).
//   서버가 잇기를 모르면(join_list 답이 없음·옛 Edge) 메뉴 항목을 그리지 않는다.
// - PR-5(설계 3-3절 (다)(라)): 나머지 두 길에도 같은 물음. 어느 길이든 고르는 것은 사람이고, 서버가 잇기를 모르면 묻지 않고 지금 길.
//   (다) 회의자료 그 자리 전사(녹음 띠 kind attached): 어느 보고인지 이미 정해진 길 — 그 회의에 회의록 전문이 이미 있을 때만 [수정 창에 넣기] /
//        [그 보고에 잇기](join_start + 그 전사 작업 id). 안 고르면 지금처럼 그 회의 [수정] 창에 넣고 저장은 사람이.
//   (라) [회의] 입력 창의 전사 글 물음은 S61-24(REC-요약단추삭제)에서 화면과 함께 뺐다.
// 글 내용은 서버로 다시 보내지 않고(잇기는 id만), 기기에 저장하지 않는다. 바깥 행동(할 일·일정·공유·삭제)을 저절로 하지 않는다(3-6절).
import {askChoice,askConfirm,notify} from './small-notice.js';
import {putNotice,removeNotice} from './notice-bar.js';
import {joinFailText,joinCanRetry,joinErrorCode,joinUnknown,undoFailText} from './meeting-server-job.mjs';
import {atMs,seoulDayKey,whenText,mergeCandidates,pickRows,lineState,progressText,doneText,stopText,labelWhen,reportName,undoChoice,UNDO_LABEL,candidateItems,hasJoinMark,isMeetingReport,watchJoin} from './meeting-join-model.mjs';

(()=>{
'use strict';
if(window.KPTUMeetingJoin)return;
const FN='/functions/v1/meeting-transcribe';
const PRIORITY=30; // 알림 줄 순서(docs/design/in-app-notices.md 4절): 뒤에서 끝난 일 30
const MEETING_FIELDS='id,workspace_id,title,series_name,round_no,meeting_at,activity_kind,project_id';
const JOIN_ROW_FIELDS='id,mode,status,target_meeting_id,source_job_id,source_meeting_id,applied_at,undone_at,before_result,result_text,candidates_closed_at';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if(!document.querySelector('link[data-rec-join-style]')){const l=document.createElement('link');l.rel='stylesheet';l.href='./meeting-join.css';l.dataset.recJoinStyle='1';document.head.appendChild(l)}

const rt=()=>window.KPTURuntime;
const ws=()=>rt()?.context?.read?.()?.workspace?.id||'';
const enc=encodeURIComponent;
const call=(action,body,extra={})=>rt().api(`${FN}?action=${action}`,{method:'POST',body,singleFlight:false,...extra});
const rows=new Map();        // 보고 id → 로그인으로 읽은 행(이름·일시·사업영역)
const asked=new Set();       // 이름을 읽어 본 보고 id(한 번만)
const lines=new Map();       // 잇기 작업 id → {job, el, sig}
const watching=new Map();    // 잇기 작업 id → 세대
const settling=new Set();    // 후보를 올리는 중인 잇기 작업 id
const joinedNow=new Set();   // 이 창에서 이어 붙인 보고 id(수정 저장이 막혔을 때 '녹음을 이어 붙였어요'로 알림)
const lastRows=new Map();    // 보고 id → 그 보고에 마지막으로 적용된 잇기 작업 행(보고 상세 되돌리기·⋯ [두 보고로 되돌리기])
// 서버가 잇기를 아는가(join_list 답): true · false(모름 — 옛 Edge·표 적용 전, 메뉴 항목을 그리지 않음) · null(아직 모름·잠깐 끊김)
let known=null,probing=false;
let epoch=0,loadedFor='';

// ---- 보고 행(이름) ----
async function readMeetings(ids){
  const want=[...new Set((ids||[]).map(String).filter(id=>UUID.test(id)))];
  if(!want.length)return [];
  const w=ws();
  const got=await rt().api(`/rest/v1/app_meetings?id=in.(${want.map(enc).join(',')})${w?`&workspace_id=eq.${enc(w)}`:''}&select=${MEETING_FIELDS}`,{singleFlight:false});
  const list=Array.isArray(got)?got.filter(r=>r?.id):[];
  for(const r of list)rows.set(String(r.id),r);
  return list;
}
const listed=()=>{const l=window.KPTUTeamData?.meetings?.();return Array.isArray(l)?l:[]};
function rowOf(id){const key=String(id||'');return rows.get(key)||listed().find(m=>String(m.id)===key)||null}
const nameOf=id=>{const m=rowOf(id);return m?reportName(m):'그 보고'};
const whenName=id=>{const m=rowOf(id);return m?labelWhen(m,Date.now()):'그 보고'};
// 합치기에서 휴지통으로 옮긴 보고: 합친 보고와 같은 날이면 시:분, 아니면 날짜·시각(합칠 때 읽어 둔 행 — 휴지통 보고는 다시 읽을 수 없음). 모르면 ''.
function fromName(sourceId,targetId){const s=rowOf(sourceId);if(!s)return '';return whenText(atMs(s.meeting_at),atMs(rowOf(targetId)?.meeting_at))||reportName(s)}

// ---- 물음(3-3절) ----
// S61-5 REC-전사삭제(명진 11/13): 녹음 정리 결과를 열기 전에 묻던 길(ask·회의자료 그 자리 전사·join_start {job_id})은 뺐다.
//   녹음은 전사하지 않으므로 새 녹음 결과가 없다. 지난 잇기 줄·되돌리기, 보고 합치기는 그대로다.
// S61-24 REC-요약단추삭제(명진 11/13 '빼자'): [회의] 입력 창의 전사 글 요약 전 물음((라), 글로 잇기)도 화면과 함께 뺐다.
// ---- 진행 줄·끝 줄(맨 위 알림 줄 손님) ----
const lineKey=id=>`join:${id}`;
function dropLine(id){if(lines.has(id)){lines.delete(id);removeNotice(lineKey(id))}}
function button(text,cls,run){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=text;b.onclick=()=>run(b);return b}
function paintLine(job){
  if(!job?.id)return;
  const st=lineState(job),cur=lines.get(job.id);
  if(!st){dropLine(job.id);return}
  const target=String(job.target_meeting_id||'');
  if(target&&!rowOf(target)&&!asked.has(target)){asked.add(target);void readMeetings([target]).then(()=>{const l=lines.get(job.id);if(l)paintLine(l.job)},()=>{})}
  // 합치기는 시각을 붙인 이름(같은 이름 보고가 하루에 둘일 때)과 휴지통으로 옮긴 보고의 시각(시안 ④).
  const name=job.mode==='report'?whenName(target):nameOf(target),from=job.mode==='report'?fromName(job.source_meeting_id,target):'';
  const text=st==='running'?progressText(name,job):st==='done'?doneText(name,job,from):stopText(name,job,joinFailText(job.error_code));
  const retry=st==='failed'&&joinCanRetry(job.error_code);
  const sig=[st,text,retry].join('|');
  const el=cur?.el||Object.assign(document.createElement('aside'),{className:'kptu-notice-line'});
  lines.set(job.id,{job,el,sig});
  if(cur?.sig===sig)return;
  el.dataset.notice='join';el.dataset.joinState=st;el.setAttribute('aria-label','보고 잇기');
  if(st==='failed')el.dataset.tone='warn';else delete el.dataset.tone;
  const say=document.createElement('span');say.setAttribute('role','status');say.textContent=text;
  const parts=[say];
  const close=()=>button('✕','kptu-notice-line-close',()=>{void seen(lines.get(job.id)?.job||job);dropLine(job.id)});
  if(st==='done'){
    parts.push(button('열기','kptu-notice-line-action',()=>{const j=lines.get(job.id)?.job||job;void seen(j);dropLine(job.id);void openReport(j.target_meeting_id)}));
    parts.push(button('되돌리기','kptu-notice-line-action',b=>void undoAll(lines.get(job.id)?.job||job,b)));
    parts.push(close());
  }else if(st==='failed'){
    if(retry)parts.push(button('다시','kptu-notice-line-action',b=>void retryJoin(lines.get(job.id)?.job||job,b)));
    parts.push(close());
  }
  el.replaceChildren(...parts);
  const x=el.querySelector('.kptu-notice-line-close');if(x)x.setAttribute('aria-label','닫기');
  putNotice(lineKey(job.id),{priority:PRIORITY,element:el});
}
const seen=job=>job?.id?call('join_seen',{job_id:job.id}).catch(()=>{}):Promise.resolve();
// 지켜보기: 진행 중이면 join_read로 끝까지(녹음 정리와 같은 간격), 끝났으면 후보를 올린다.
function follow(job){
  if(!job?.id)return;
  paintLine(job);
  if(lineState(job)==='running')watch(job);
  else if(job.status==='done'&&job.applied_at&&!job.candidates_closed_at)void settleCandidates(job);
}
function watch(job){
  if(watching.has(job.id))return;
  const mine=epoch;watching.set(job.id,mine);
  const alive=()=>epoch===mine&&watching.get(job.id)===mine;
  watchJoin({call,hidden:()=>document.visibilityState==='hidden',alive,onProgress:j=>{if(alive())paintLine(j)}},{job})
    .then(r=>{if(!alive())return;watching.delete(job.id);paintLine(r.job);if(r.kind==='done')afterDone(r.job)})
    .catch(e=>{
      if(!alive())return;
      watching.delete(job.id);console.warn('meeting join watch failed',e?.status||'');
      // 작업이 없어졌거나(보고를 영구 삭제) 내 것이 아니면 줄을 걷는다. 잠깐 끊김이 길었던 것이면 줄은 그대로, 다음에 앱을 열면 이어 본다.
      if(e?.status===404||e?.status===403)dropLine(job.id);
    });
}
function afterDone(job){
  joinedNow.add(String(job.target_meeting_id));
  lastRows.delete(String(job.target_meeting_id));
  changed(job.target_meeting_id,'joined',job.id);
  // 합치기: 없어진 보고(휴지통)를 보던 창은 닫는다(meeting-round-detail.js — 수정 중이면 입력을 남기고 알림).
  if(job.mode==='report'&&UUID.test(String(job.source_meeting_id||'')))window.dispatchEvent(new CustomEvent('kptu:meeting-join-changed',{detail:{meeting_id:String(job.source_meeting_id),job_id:job.id,reason:'merged'}}));
  void settleCandidates(job);
}
// 이은 보고가 바뀌었음: 보고 상세(열려 있으면 다시 읽거나, 수정 중이면 알림)·목록·자료를 맞춘다.
function changed(meetingId,reason,jobId=''){
  const id=String(meetingId||'');if(!id)return;
  window.dispatchEvent(new CustomEvent('kptu:meeting-join-changed',{detail:{meeting_id:id,job_id:jobId,reason}}));
  void Promise.resolve(window.__KPTU_RELOAD_MEETINGS__?.()).catch(()=>{}).then(()=>window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:id}})));
  window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:rowOf(id)?.project_id||null,meeting_id:id}}));
}

// [열기]: 사업 보고 화면으로 가서 그 보고를 연다(PC는 오른쪽 칸, 폰은 창).
async function openReport(id){
  const loader=window.KPTUDeferredFeatures?.loadView||window.KPTUViewLoader?.load;
  try{
    if(loader)await loader('meetings');
    const router=window.KPTURouter;if(router?.go&&router.current!=='meetings')router.go('meetings',{source:'delegated'});
    await window.__KPTU_MEETING_ROUND_DETAIL_READY__;
    await window.KPTUMeetingRoundDetail?.open?.(String(id));
  }catch(e){console.warn('meeting join open failed',e?.name||'');notify('그 보고를 열지 못했어요.',{error:true})}
}
// 끝 줄 [되돌리기] = 통째로 되돌리기(all): 두 글을 잇기 전으로, 붙인 녹음을 뗀다.
async function undoAll(job,b){
  if(!job?.id||b?.disabled)return;
  if(b)b.disabled=true;
  try{
    await call('join_undo',{job_id:job.id,scope:'all'},{timeoutMs:30000});
    dropLine(job.id);joinedNow.delete(String(job.target_meeting_id));lastRows.delete(String(job.target_meeting_id));
    notify(job.mode==='report'?'두 보고로 되돌렸어요':'잇기 전으로 되돌렸어요',{note:job.mode==='report'?'휴지통에 있던 보고를 꺼냈어요.':job.mode==='text'?'이어 붙였던 전사 글은 새 보고에 다시 넣어 주세요.':''});
    changed(job.target_meeting_id,'undone',job.id);
    if(job.mode==='report'&&UUID.test(String(job.source_meeting_id||'')))window.dispatchEvent(new CustomEvent('kptu:meeting-join-changed',{detail:{meeting_id:String(job.source_meeting_id),job_id:job.id,reason:'restored'}}));
  }catch(e){if(b)b.disabled=false;notify(undoFailText(joinErrorCode(e)),{error:true})}
}
// 멈춘 줄 [다시]: 멈춘 단계부터, 그 사이 보고를 수정해서 멈췄으면 처음부터(새 작업 — 앞 줄은 닫힘).
async function retryJoin(job,b){
  if(!job?.id||b?.disabled)return;
  if(b)b.disabled=true;
  try{
    const r=await call('join_retry',{job_id:job.id},{timeoutMs:60000});
    if(r?.job?.id&&r.job.id!==job.id)dropLine(job.id);
    if(r?.job?.id)follow(r.job);
  }catch(e){if(b)b.disabled=false;notify(joinFailText(joinErrorCode(e)),{error:true})}
}

// ---- 새 할 일 후보(3-4절) ----
async function settleCandidates(job){
  const id=String(job?.id||''),target=String(job?.target_meeting_id||'');
  if(!UUID.test(id)||!UUID.test(target)||job.candidates_closed_at||settling.has(id)||!rt()?.api)return;
  settling.add(id);
  try{
    const row=(await rt().api(`/rest/v1/app_meeting_join_jobs?id=eq.${enc(id)}&select=id,target_meeting_id,status,applied_at,draft,candidates_closed_at&limit=1`,{singleFlight:false}))?.[0];
    if(!row||row.status!=='done'||!row.applied_at||row.candidates_closed_at)return;
    const m=rowOf(target)||(await readMeetings([target]))[0];
    if(!m)return;
    let titles=[];
    try{titles=((await rt().api(`/functions/v1/google-tasks?action=linked&meeting_id=${enc(target)}`))?.tasks||[]).map(t=>t?.title)}catch{}
    const items=candidateItems(row.draft,titles);
    if(items.length){
      const {addMeetingCandidates}=await import('./todo-radar-data.js');
      const r=await addMeetingCandidates(target,items,{day:seoulDayKey(atMs(m.meeting_at))||seoulDayKey(Date.now()),projectId:m.project_id||null});
      if(!r?.ok)return; // 못 올렸으면 닫지 않는다(다음에 보고를 열 때 다시)
      if(r.added)window.dispatchEvent(new CustomEvent('kptu:todo-radar-changed',{detail:{reload:true}}));
    }
    await call('join_seen',{job_id:id,candidates:true});
  }catch(e){console.warn('meeting join todo candidates failed',e?.status||'')}
  finally{settling.delete(id)}
}

// ---- 보고 상세: [합치기 전 글로 되돌리기] / [이은 글로 다시] (slot은 meeting-round-detail.js가 둔 자리, 그리는 것은 여기 하나) ----
async function paintDetail(slot,meeting){
  if(!slot)return;
  const key=meeting?.id?[meeting.id,meeting.updated_at||'',String(meeting.transcript_text??'').length,String(meeting.notes??'').length].join('|'):'';
  if(key&&slot.dataset.joinKey===key)return;
  slot.dataset.joinKey=key;slot.hidden=true;slot.replaceChildren();
  if(!key||!rt()?.api||!isMeetingReport(meeting)||!hasJoinMark(meeting.notes)){if(meeting?.id)remember(meeting.id,null);return}
  let row=null;
  try{row=(await rt().api(`/rest/v1/app_meeting_join_jobs?target_meeting_id=eq.${enc(meeting.id)}&status=eq.done&applied_at=not.is.null&select=${JOIN_ROW_FIELDS}&order=applied_at.desc&limit=1`,{singleFlight:false}))?.[0]||null}
  catch{return} // 표가 없거나(적용 전) 못 읽으면 버튼 없음
  if(slot.dataset.joinKey!==key)return;
  remember(meeting.id,row);
  if(row&&!row.candidates_closed_at)void settleCandidates(row);
  const choice=undoChoice(meeting.transcript_text,row);
  if(!choice)return;
  slot.append(button(UNDO_LABEL[choice.scope],'row-act',b=>void undoText(row,choice,meeting,b)));
  slot.querySelector('button').dataset.joinUndo=choice.scope;
  slot.hidden=false;
}
// 되돌린 뒤 보고 상세는 kptu:meeting-join-changed를 듣고 다시 읽는다(그리는 주인 하나).
async function undoText(row,choice,meeting,b){
  if(b.disabled)return;
  if(choice.edited&&!(await askConfirm(b,{text:'수정한 회의 결과 글이 합치기 전 글로 바뀌어요. 되돌릴까요?',ok:'되돌리기'})))return;
  b.disabled=true;
  try{
    await call('join_undo',{job_id:row.id,scope:choice.scope},{timeoutMs:30000});
    notify(choice.scope==='before'?'회의 결과를 합치기 전 글로 되돌렸어요':'회의 결과를 이은 글로 다시 바꿨어요');
    changed(meeting.id,'text',row.id);
  }catch(e){b.disabled=false;notify(undoFailText(joinErrorCode(e)),{error:true})}
}

// ---- PR-4: 보고 ⋯ [다른 보고에 합치기] / 합친 보고 ⋯ [두 보고로 되돌리기] (메뉴 항목은 meeting-round-detail.js mrdEnsureMoreMenu 한 곳) ----
// 서버가 잇기를 아는지 한 번 더 묻는다(앱을 열 때 join_list가 잠깐 끊겼으면). 답은 다음에 메뉴를 열 때 쓴다.
function probe(){
  if(known!==null||probing||!rt()?.api||!ws())return;
  probing=true;
  call('join_list',{}).then(r=>{known=r?.ok===true&&Array.isArray(r.jobs)},e=>{if(joinUnknown(e))known=false}).finally(()=>{probing=false});
}
// 메뉴에 [다른 보고에 합치기]를 그릴까: 서버가 잇기를 알고 [회의] 칸 보고일 때만(설계 3-3 — 모르면 그리지 않음).
function canMerge(m){
  if(!m?.id||!UUID.test(String(m.id))||m.deleted_at||!isMeetingReport(m))return false;
  if(known===null)probe();
  return known===true;
}
// 이 보고를 다른 보고에 합친다(이 보고 = 없어질 보고). 고르기는 같은 날 녹음으로 쓴 보고(서버 join_candidates)부터, 그다음 내 목록의 다른 [회의] 보고.
async function merge(source,trigger=null){
  const sid=String(source?.id||'');
  if(!UUID.test(sid)||!isMeetingReport(source)||!rt()?.api)return;
  rows.set(sid,source);
  const fail=e=>{if(joinUnknown(e))known=false;notify(joinUnknown(e)?'지금은 보고를 합칠 수 없어요. 바뀐 것은 없어요.':joinFailText(joinErrorCode(e)),{error:true})};
  let list;
  try{list=(await call('join_candidates',{meeting_id:sid},{timeoutMs:20000}))?.candidates}
  catch(e){console.warn('meeting merge candidates failed',e?.status||'');fail(e);return}
  list=Array.isArray(list)?list:[];
  let cands=[];
  try{cands=mergeCandidates(list,await readMeetings(list.map(c=>c?.meeting_id))).filter(c=>c.id!==sid)}catch{cands=[]}
  const startMs=atMs(source.meeting_at);
  const others=listed().filter(m=>m?.id&&String(m.id)!==sid);
  for(const m of others)if(!rows.has(String(m.id)))rows.set(String(m.id),m);
  const choices=pickRows(cands,others,{startMs,dayMs:startMs});
  if(!choices.length){notify('합칠 수 있는 다른 [회의] 보고가 없어요.');return}
  const target=await askChoice(trigger?.isConnected?trigger:null,{text:'어느 보고에 합칠까요? · 같은 날 보고부터',choices,
    foot:'합치면 이 보고는 휴지통으로 옮기고, 두 전사 전체로 회의 결과를 다시 요약해요. 끝 줄 [되돌리기]로 두 보고로 되돌릴 수 있어요.'});
  if(!target)return;
  let r;
  try{r=await call('join_start',{target_meeting_id:String(target),source:{meeting_id:sid}},{timeoutMs:60000})}
  catch(e){console.warn('meeting merge start failed',e?.status||'');fail(e);return}
  if(!r?.job?.id){notify('합치기를 시작하지 못했어요. 바뀐 것은 없어요.',{error:true});return}
  follow(r.job);
}
// 그 보고에 마지막으로 적용된 잇기 작업 행(보고 상세가 읽은 것, 창 밖 메뉴는 prepareMenu가 읽은 것).
function remember(id,row){const key=String(id||'');if(!key)return;if(row?.id)lastRows.set(key,row);else lastRows.delete(key)}
// 합친 보고 ⋯ [두 보고로 되돌리기]: 마지막 적용이 합치기(mode report)이고 아직 되돌리지 않았을 때(설계 3-5 '합친 보고 ⋯').
function unmergeRow(m){const row=lastRows.get(String(m?.id||''));return row&&row.mode==='report'&&row.status==='done'&&row.applied_at&&!row.undone_at&&isMeetingReport(m)?row:null}
async function unmerge(m,trigger=null){const row=unmergeRow(m);if(row)await undoAll(row,null)}
// 창 밖 줄(달력·사진)에서 메뉴를 열기 전: 이은 줄이 있는 [회의] 보고면 마지막 잇기 행을 읽어 둔다(그 밖의 보고는 요청을 더하지 않음).
async function prepareMenu(m){
  if(known!==true||!m?.id||!isMeetingReport(m)||!hasJoinMark(m.notes)||!rt()?.api)return;
  try{remember(m.id,(await rt().api(`/rest/v1/app_meeting_join_jobs?target_meeting_id=eq.${enc(m.id)}&status=eq.done&applied_at=not.is.null&select=${JOIN_ROW_FIELDS}&order=applied_at.desc&limit=1`,{singleFlight:false}))?.[0]||null)}
  catch{}
}

// ---- 앱을 다시 열 때: 진행 중·끝·멈춘 잇기 줄을 이어 그린다. 폰 알림 주소(?join_job=)면 그 보고를 연다. ----
async function loadJoins(tries=0){
  const id=ws();
  if(!id||!rt()?.api){if(tries<5)setTimeout(()=>void loadJoins(tries+1),1000);return}
  if(loadedFor===id)return;
  loadedFor=id;
  let wanted='';
  try{const u=new URL(location.href);wanted=u.searchParams.get('join_job')||'';if(wanted){u.searchParams.delete('join_job');history.replaceState(history.state,'',u.pathname+u.search+u.hash)}}catch{}
  let jobs=[];
  // 답이 {ok, jobs}이면 서버가 잇기를 안다(메뉴 [다른 보고에 합치기]를 그림). 모름(적용 전·옛 Edge)이면 줄 없음, 잠깐 끊김이면 다음에 메뉴를 열 때 다시 묻는다.
  try{const r=await call('join_list',{});known=r?.ok===true&&Array.isArray(r.jobs);jobs=known?r.jobs:[]}
  catch(e){known=joinUnknown(e)?false:null;jobs=[]}
  for(const j of jobs)follow(j);
  if(!UUID.test(wanted))return;
  let job=jobs.find(j=>j?.id===wanted)||null;
  if(!job){try{job=(await call('join_read',{job_id:wanted},{timeoutMs:30000}))?.job||null}catch{job=null}}
  if(job?.status==='done'&&job.applied_at){void seen(job);dropLine(job.id);void openReport(job.target_meeting_id)}
}
window.addEventListener('kptu:session-changed',e=>{
  if(e.detail?.session){void loadJoins();return}
  // 로그아웃: 지켜보기를 멈추고 줄·기억한 이름을 비운다(서버 작업은 계속, 다음 로그인 때 이어 그림).
  epoch++;watching.clear();for(const id of [...lines.keys()])dropLine(id);rows.clear();asked.clear();joinedNow.clear();lastRows.clear();known=null;loadedFor='';
});

// REC-정리상태확인못함(S60-3): 잠깐 끊김이 길어 지켜보기를 놓친 '잇는 중' 줄은 화면이 다시 보이거나 연결이 돌아오면 다시 본다(읽기만).
function rewatch(){if(document.visibilityState==='hidden')return;for(const l of [...lines.values()])if(l?.job?.id&&lineState(l.job)==='running'&&!watching.has(l.job.id))watch(l.job)}
document.addEventListener('visibilitychange',rewatch);
window.addEventListener('online',rewatch);
window.KPTUMeetingJoin={paintDetail,follow,joinedRecently:id=>joinedNow.has(String(id||'')),canMerge,merge,unmergeRow,unmerge,prepareMenu};
// 첫 화면 요청과 겹치지 않게 2.5초 뒤 한 번 묻는다.
setTimeout(()=>void loadJoins(),2500);
})();
