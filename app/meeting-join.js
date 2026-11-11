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
// 글 내용은 서버로 다시 보내지 않고(잇기는 id만), 기기에 저장하지 않는다. 바깥 행동(할 일·일정·공유·삭제)을 저절로 하지 않는다(3-6절).
import {askActions,askChoice,askConfirm,notify} from './small-notice.js';
import {putNotice,removeNotice} from './notice-bar.js';
import {joinFailText,joinCanRetry,joinErrorCode,joinUnknown,undoFailText} from './meeting-server-job.mjs';
import {atMs,seoulDayKey,askText,whoText,mergeCandidates,nearest,pickRows,lineState,progressText,doneText,reportName,undoChoice,UNDO_LABEL,candidateItems,hasJoinMark,isMeetingReport,watchJoin} from './meeting-join-model.mjs';

(()=>{
'use strict';
if(window.KPTUMeetingJoin)return;
const FN='/functions/v1/meeting-transcribe';
const PRIORITY=30; // 알림 줄 순서(docs/design/in-app-notices.md 4절): 뒤에서 끝난 일 30
const MEETING_FIELDS='id,workspace_id,title,series_name,round_no,meeting_at,activity_kind,project_id';
const JOIN_ROW_FIELDS='id,mode,status,target_meeting_id,applied_at,undone_at,before_result,result_text,candidates_closed_at';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if(!document.querySelector('link[data-rec-join-style]')){const l=document.createElement('link');l.rel='stylesheet';l.href='./meeting-join.css';l.dataset.recJoinStyle='1';document.head.appendChild(l)}

const rt=()=>window.KPTURuntime;
const ws=()=>rt()?.context?.read?.()?.workspace?.id||'';
const enc=encodeURIComponent;
const call=(action,body,extra={})=>rt().api(`${FN}?action=${action}`,{method:'POST',body,singleFlight:false,...extra});
const rows=new Map();        // 보고 id → 로그인으로 읽은 행(이름·일시·사업영역)
const asked=new Set();       // 이름을 읽어 본 보고 id(한 번만)
const decided=new Map();     // 녹음 결과 id → 'new'([새로 만들기]·[새 보고로 열기]를 고름 — 다시 묻지 않음)
const lines=new Map();       // 잇기 작업 id → {job, el, sig}
const watching=new Map();    // 잇기 작업 id → 세대
const settling=new Set();    // 후보를 올리는 중인 잇기 작업 id
const joinedNow=new Set();   // 이 창에서 이어 붙인 보고 id(수정 저장이 막혔을 때 '녹음을 이어 붙였어요'로 알림)
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

// ---- 물음(3-3절) ----
const anchor=()=>{const b=document.querySelector('#recBand');return b&&!b.hidden?b:null};
// 돌려줌: 'new'(지금처럼 초안 창) · 'joined'(잇기 시작 — 띠를 닫음) · 'later'(물음을 닫음 — 결과는 띠 [초안 열기]에).
async function ask(job,{began=''}={}){
  if(!job?.id||(job.kind&&job.kind!=='recording'))return 'new';
  if(decided.get(job.id)==='new')return 'new';
  if(!rt()?.api)return 'new';
  let list;
  try{list=(await call('join_candidates',{job_id:job.id},{timeoutMs:20000}))?.candidates}
  catch(e){console.warn('meeting join candidates failed',e?.status||'');return 'new'} // 모름(적용 전·옛 Edge)·실패 → 묻지 않고 지금 길
  if(!Array.isArray(list)||!list.length)return 'new';
  let cands=[];
  try{cands=mergeCandidates(list,await readMeetings(list.map(c=>c?.meeting_id)))}catch{return 'new'}
  if(!cands.length)return 'new';
  const startMs=Date.parse(began);
  for(;;){
    const first=nearest(cands,startMs);
    const pick=await askActions(anchor(),{text:askText(startMs),note:whoText(first,startMs),className:'rec-join-ask',actions:[
      {value:'pick',label:'다른 보고 선택',kind:'row-act'},{value:'new',label:'새로 만들기',kind:'secondary'},{value:'join',label:'그 보고에 잇기',kind:'primary'}]});
    if(pick==null)return 'later';
    if(pick==='new'){decided.set(job.id,'new');return 'new'}
    let target=first.id;
    if(pick==='pick'){
      const others=listed();for(const m of others)if(m?.id&&!rows.has(String(m.id)))rows.set(String(m.id),m);
      target=await askChoice(anchor(),{text:'어느 보고에 이을까요? · 같은 날 보고부터',choices:pickRows(cands,others,{startMs,dayMs:startMs})});
      if(!target)continue; // 고르기를 닫으면 처음 물음으로
    }
    const out=await start(job,target);
    if(out==='joined')return 'joined';
    if(out==='unknown')return 'new';
    return 'later';
  }
}
async function start(job,targetId){
  let r;
  try{r=await call('join_start',{target_meeting_id:String(targetId),source:{job_id:job.id}},{timeoutMs:60000})}
  catch(e){
    if(joinUnknown(e))return 'unknown';
    console.warn('meeting join start failed',e?.status||'');
    notify(joinFailText(joinErrorCode(e)),{error:true,note:'녹음 정리 결과는 맨 위 [초안 열기]에 그대로 있어요.'});
    return 'failed';
  }
  if(!r?.job?.id)return 'unknown';
  follow(r.job);
  return 'joined';
}

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
  const name=nameOf(target);
  const text=st==='running'?progressText(name,job):st==='done'?doneText(name,job):`${name}에 잇지 못했어요. ${joinFailText(job.error_code)}`;
  const retry=st==='failed'&&joinCanRetry(job.error_code),fresh=st==='failed'&&job.mode==='job'&&UUID.test(String(job.source_job_id||''));
  const sig=[st,text,retry,fresh].join('|');
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
    if(fresh)parts.push(button('새 보고로 열기','kptu-notice-line-action',()=>{const j=lines.get(job.id)?.job||job;void seen(j);dropLine(job.id);toBand(j.source_job_id,{open:true})}));
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
  changed(job.target_meeting_id,'joined',job.id);
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
// 녹음 결과를 띠 [초안 열기]로 돌린다(open이면 묻지 않고 바로 초안 창 — [새 보고로 열기]). 띠가 다른 녹음을 하고 있으면 그대로 두고,
// 그 결과는 다음에 앱을 열 때 띠에 뜬다(서버 job_list — 잇지 못했거나 되돌린 녹음 결과는 다시 보인다).
function toBand(sourceJobId,{open=false}={}){
  const rec=window.KPTUMeetingRecorder;
  if(!UUID.test(String(sourceJobId||''))||!rec?.ready)return false;
  if(open)decided.set(sourceJobId,'new');
  if(rec.ready({id:sourceJobId},{open}))return true;
  if(open)decided.delete(sourceJobId);
  notify('지금 다른 녹음을 정리하는 중이에요. 끝난 뒤 맨 위 [초안 열기]로 열 수 있어요.');
  return false;
}
// 끝 줄 [되돌리기] = 통째로 되돌리기(all): 두 글을 잇기 전으로, 붙인 녹음을 떼고, 녹음 결과는 띠 [초안 열기]로.
async function undoAll(job,b){
  if(!job?.id||b?.disabled)return;
  if(b)b.disabled=true;
  try{
    await call('join_undo',{job_id:job.id,scope:'all'},{timeoutMs:30000});
    dropLine(job.id);joinedNow.delete(String(job.target_meeting_id));
    const back=job.mode==='job'&&toBand(job.source_job_id);
    notify(job.mode==='report'?'두 보고로 되돌렸어요':'잇기 전으로 되돌렸어요',{note:back?'녹음 정리 결과는 맨 위 [초안 열기]에 있어요.':''});
    changed(job.target_meeting_id,'undone',job.id);
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
  if(!key||!rt()?.api||!isMeetingReport(meeting)||!hasJoinMark(meeting.notes))return;
  let row=null;
  try{row=(await rt().api(`/rest/v1/app_meeting_join_jobs?target_meeting_id=eq.${enc(meeting.id)}&status=eq.done&applied_at=not.is.null&select=${JOIN_ROW_FIELDS}&order=applied_at.desc&limit=1`,{singleFlight:false}))?.[0]||null}
  catch{return} // 표가 없거나(적용 전) 못 읽으면 버튼 없음
  if(slot.dataset.joinKey!==key)return;
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

// ---- 앱을 다시 열 때: 진행 중·끝·멈춘 잇기 줄을 이어 그린다. 폰 알림 주소(?join_job=)면 그 보고를 연다. ----
async function loadJoins(tries=0){
  const id=ws();
  if(!id||!rt()?.api){if(tries<5)setTimeout(()=>void loadJoins(tries+1),1000);return}
  if(loadedFor===id)return;
  loadedFor=id;
  let wanted='';
  try{const u=new URL(location.href);wanted=u.searchParams.get('join_job')||'';if(wanted){u.searchParams.delete('join_job');history.replaceState(history.state,'',u.pathname+u.search+u.hash)}}catch{}
  let jobs=[];
  try{jobs=(await call('join_list',{}))?.jobs}catch{jobs=[]} // 모름(적용 전·옛 Edge)이면 줄 없음
  if(!Array.isArray(jobs))jobs=[];
  for(const j of jobs)follow(j);
  if(!UUID.test(wanted))return;
  let job=jobs.find(j=>j?.id===wanted)||null;
  if(!job){try{job=(await call('join_read',{job_id:wanted},{timeoutMs:30000}))?.job||null}catch{job=null}}
  if(job?.status==='done'&&job.applied_at){void seen(job);dropLine(job.id);void openReport(job.target_meeting_id)}
}
window.addEventListener('kptu:session-changed',e=>{
  if(e.detail?.session){void loadJoins();return}
  // 로그아웃: 지켜보기를 멈추고 줄·기억한 이름을 비운다(서버 작업은 계속, 다음 로그인 때 이어 그림).
  epoch++;watching.clear();for(const id of [...lines.keys()])dropLine(id);rows.clear();asked.clear();decided.clear();joinedNow.clear();loadedFor='';
});

window.KPTUMeetingJoin={ask,paintDetail,follow,joinedRecently:id=>joinedNow.has(String(id||''))};
// 녹음 정리 확인(meeting-recorder.js job_list, 2.5초 뒤)과 같은 때 한 번 묻는다.
setTimeout(()=>void loadJoins(),2500);
})();
