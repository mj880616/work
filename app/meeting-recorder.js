// MTG-노트북녹음 2단계(요청함 10/29 14:26): 노트북(PC 1024px~) 사업 보고 위쪽 줄 [녹음] → 화면 맨 위 녹음 띠 → [멈추고 정리] → 회의 기록 초안.
// 설계: docs/design/laptop-recording.md 8절. 서버: Edge meeting-transcribe의 rec_start·rec_piece·rec_finish·rec_pending(PR 1511)과 기존 transcribe·attach.
// - 주인: 이 모듈 하나가 녹음기·녹음 띠(#recBand)·[녹음](#reportRecordBtn)·'이어서 정리' 줄(#recPendingLine)을 그린다(AGENTS.md 5절 one state owner).
//   loader-v2.js가 첫 화면 뒤 한 번 불러오고, 화면 전환에 다시 그리지 않으므로 다른 메뉴로 옮겨도 녹음은 계속된다.
// - 기기 저장 없음: 녹음 조각은 5분마다 서버(명진 Drive)로 가고, 보내지 못한 조각은 메모리에만 두고 같은 번호로 다시 보낸다.
//   브라우저 저장 공간을 쓰지 않는다(Browser storage audit). 창을 닫으면 마지막 5분 안쪽만 잃고, 다시 열면 '이어서 정리'(rec_pending).
// - [버리기](요청함 10/30 10:01): 녹음을 바로 멈추고 마이크를 끈 뒤, 이미 녹음된 것만 마저 올리고(최대 DISCARD_DRAIN_MS) rec_discard로
//   올린 조각을 모두 Drive 휴지통으로 옮긴다(전사·요약·초안 없음). 올리지 못한 조각은 메모리에서 버린다. 위쪽 작은 알림 [되돌리기](10초)는
//   rec_restore로 휴지통에서 꺼내 '이어서 정리' 줄로 돌린다(마이크는 꺼졌으므로 녹음을 이어 하지는 않음). '이어서 정리' 줄에도 같은 [버리기].
// - 59분마다 같은 마이크 흐름으로 새 녹음기를 먼저 켜고 앞 녹음기를 멈춘다(앞 구간 마지막 조각 → rec_start 같은 session_id → 새 구간 조각).
// - [멈추고 정리]: 마지막 조각 → rec_finish(more면 반복) → 구간마다 transcribe → 글 합치기 → 사업 보고 › 회의 입력 창 + 기존 [초안 채우기]
//   (meeting-transcript-draft.js). 저장은 명진이 [사업 보고 저장]으로 하고, 그 뒤 구간마다 attach(기존 [이 회의에 녹음 붙이기]).
import {PIECE_SECONDS,AUDIO_BITS,pickMime,baseMime,shouldRoll,retryDelay,pieceOutcome,nextStep,queuedPieces,clockText,joinSegmentTexts,stepParts,seoulLocal,pendingText,pendingOthers,transcribePlan} from './meeting-recorder-model.mjs';
import {cleanTranscript,transcribeFailText} from './meeting-transcript-model.mjs';
import {notify} from './small-notice.js';

(()=>{
'use strict';
if(window.KPTUMeetingRecorder)return;
const $=s=>document.querySelector(s);
const FN='/functions/v1/meeting-transcribe';
const PC=window.matchMedia?.('(min-width:1024px)');
const MR=window.MediaRecorder;
const MIME=pickMime(MR?.isTypeSupported?.bind(MR));
const supported=()=>!!(MIME&&navigator.mediaDevices?.getUserMedia);
// 띠·버튼 모양(모든 화면 공통이라 화면별 묶음이 아니라 여기서 한 번 붙인다).
if(!document.querySelector('link[data-rec-style]')){const l=document.createElement('link');l.rel='stylesheet';l.href='./meeting-recorder.css';l.dataset.recStyle='1';document.head.appendChild(l)}

// 상태: idle → starting → recording ⇄ paused → finishing → done | error
let state='idle',step='',note='',errorText='',canRetry=false;
let stream=null,current=null,segments=[],sessionId='',workspaceId='',startedAt='';
let rollingStops=[],accum=0,runSince=0,ticker=0,pumping=false,fails=0,retryTimer=0,drainWaiters=[],stopReason='';
let pending=[],pendingFor='',pendingFlight=null,discarding=false;
const DISCARD_DRAIN_MS=20000,DISCARD_NOTICE_MS=10000;
const doneTexts=new Map(); // 이 창에서 전사가 끝난 구간 글(job id → 글). 서버는 전사 글을 저장하지 않으므로 다시 시도할 때 쓴다(메모리에만).

const rt=()=>window.KPTURuntime;
const ws=()=>rt()?.context?.read?.()?.workspace?.id||'';
const elapsed=()=>accum+(runSince?performance.now()-runSince:0);
const active=()=>state==='starting'||state==='recording'||state==='paused';
const call=(action,body,extra={})=>rt().api(`${FN}?action=${action}`,{method:'POST',body,singleFlight:false,...extra});

// ---- 그리기(이 모듈만) ----
// 1초마다 다시 그리므로 글이 같으면 건드리지 않는다(누르는 중인 버튼이 바뀌지 않게).
const drawn=new WeakMap();
const setHtml=(el,html)=>{if(drawn.get(el)!==html){el.innerHTML=html;drawn.set(el,html)}};
const setText=(el,text)=>{if(el.textContent!==text)el.textContent=text};
function band(){
  let el=$('#recBand');
  if(el)return el;
  el=document.createElement('div');
  el.id='recBand';el.className='rec-band';el.setAttribute('role','region');el.setAttribute('aria-label','녹음');el.hidden=true;
  el.innerHTML='<span class="rec-dot" aria-hidden="true"></span><span class="rec-label"></span><time class="rec-time"></time><span class="rec-note" role="status" aria-live="polite"></span><span class="rec-actions"></span>';
  el.addEventListener('click',onBandClick);
  document.body.prepend(el);
  return el;
}
function paint(){
  const el=band(),on=state!=='idle';
  el.hidden=!on;
  document.body.classList.toggle('rec-on',on);
  el.dataset.state=state;
  const label=el.querySelector('.rec-label'),time=el.querySelector('.rec-time'),msg=el.querySelector('.rec-note'),act=el.querySelector('.rec-actions');
  const sec=elapsed()/1000;
  let l='',t='',m='',a='';
  if(state==='starting'){l='녹음 준비 중';m=escapeText('마이크를 허락해 주세요.')}
  else if(state==='recording'||state==='paused'){
    l=state==='paused'?'일시정지':'녹음 중';
    t=clockText(sec);
    const q=queuedPieces(segments);
    m=fails&&q?escapeText(`조각 ${q}개 올리기 다시 시도 중`):'';
    a=`<button type="button" class="rec-btn" data-rec="pause">${state==='paused'?'이어 녹음':'일시정지'}</button><button type="button" class="rec-btn rec-stop" data-rec="stop">멈추고 정리</button><button type="button" class="rec-btn rec-discard" data-rec="discard">버리기</button>`;
  }else if(state==='finishing'||state==='done'){
    l=state==='done'?'정리 끝':'정리 중';
    t=sec?clockText(sec):'';
    m=stepParts(step).map(p=>p.state==='now'?`<strong>${p.label}</strong>`:`<span class="rec-step-${p.state}">${p.label}</span>`).join('<span aria-hidden="true"> › </span>')+(note?` <span class="rec-sub">${escapeText(note)}</span>`:'');
    a=state==='done'?'<button type="button" class="rec-btn" data-rec="close">닫기</button>':'';
  }else if(state==='error'){
    l='녹음 정리 멈춤';
    m=escapeText(errorText);
    a=`${canRetry?'<button type="button" class="rec-btn" data-rec="retry">다시</button>':''}<button type="button" class="rec-btn" data-rec="close">닫기</button>`;
  }
  setText(label,l);setText(time,t);setHtml(msg,m);setHtml(act,a);
  paintButton();
  paintPending();
}
const escapeText=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function paintButton(){
  const btn=$('#reportRecordBtn');if(!btn)return;
  btn.hidden=!(supported()&&PC?.matches);
  btn.disabled=state!=='idle'||discarding;
  btn.textContent=active()?'녹음 중':'녹음';
  btn.setAttribute('aria-pressed',String(active()));
}
function paintPending(){
  const line=$('#recPendingLine');if(!line)return;
  const list=PC?.matches&&state==='idle'&&!discarding?pendingOthers(pending,sessionId):[];
  line.hidden=!list.length;
  if(!list.length){setHtml(line,'');return}
  const first=list[0];
  setHtml(line,`<span class="rec-pending-text">끝나지 않은 녹음 · ${escapeText(pendingText(first))}${list.length>1?` 외 ${list.length-1}건`:''}</span><button type="button" class="rec-btn" data-rec-resume="${escapeText(first.session_id)}">이어서 정리</button><button type="button" class="rec-btn rec-discard" data-rec-discard="${escapeText(first.session_id)}">버리기</button>`);
}
function onBandClick(e){
  const b=e.target.closest('[data-rec]');if(!b)return;
  const what=b.dataset.rec;
  if(what==='pause')togglePause();
  else if(what==='stop')void stopAndFinish();
  else if(what==='discard')void discardLive();
  else if(what==='retry')void finishSession();
  else if(what==='close')closeBand();
}
function closeBand(){if(active()||state==='finishing')return;state='idle';step='';note='';errorText='';accum=0;runSince=0;paint();paintPending()}
function startTicker(){clearInterval(ticker);ticker=setInterval(tick,1000)}
function tick(){
  if(state==='recording'&&current&&!current.rolling){
    const segSec=(elapsed()-current.seg.base)/1000;
    if(shouldRoll(segSec))roll();
  }
  if(active())paint();
}

// ---- 녹음기 ----
function makeRecorder(seg){
  const rec=new MR(stream,{mimeType:MIME,audioBitsPerSecond:AUDIO_BITS});
  let done=()=>{};
  const holder={rec,seg,rolling:false,stopped:new Promise(r=>{done=r})};
  holder.end=()=>{seg.ended=true;done();void pump()};
  rec.addEventListener('dataavailable',e=>{
    if(!e.data||!e.data.size)return;
    const seconds=Math.max(1,Math.ceil((elapsed()-seg.base)/1000));
    seg.pieces.push({seq:++seg.seq,blob:e.data,seconds:Math.min(seconds,3600)});
    void pump();
  });
  rec.addEventListener('stop',holder.end);
  rec.addEventListener('error',holder.end);
  return holder;
}
// 59분: 새 녹음기를 먼저 켜고(조각은 메모리 대기열에) 앞 녹음기를 멈춘다. 대기열이 앞 구간 마지막 조각 → rec_start → 새 구간 순서를 지킨다.
function roll(){
  const old=current;if(!old||old.rolling)return;
  old.rolling=true;
  const seg={no:old.seg.no+1,id:null,ended:false,stopped:false,seq:0,pieces:[],base:elapsed()};
  segments.push(seg);
  try{current=makeRecorder(seg);current.rec.start(PIECE_SECONDS*1000)}
  catch(e){console.warn('recorder roll failed',e?.name||'');segments.pop();current=old;old.rolling=false;return}
  rollingStops.push(old.stopped);
  try{old.rec.stop()}catch{old.end()}
}
async function start(){
  if(state!=='idle'&&state!=='done'&&state!=='error')return;
  if(!supported()||discarding)return;
  workspaceId=ws();
  if(!rt()?.api||!workspaceId){fail('로그인 상태를 확인하지 못했어요.',false);return}
  state='starting';step='';note='';errorText='';accum=0;runSince=0;segments=[];rollingStops=[];sessionId='';fails=0;stopReason='';doneTexts.clear();paint();
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
  }catch(e){
    console.warn('microphone denied',e?.name||'');
    fail(e?.name==='NotAllowedError'?'마이크를 쓸 수 없어요. 주소창 왼쪽 표시를 눌러 마이크를 허용해 주세요.':'마이크를 찾지 못했어요.',false);return;
  }
  try{
    const r=await call('rec_start',{workspace_id:workspaceId,mime:baseMime(MIME)});
    if(!r?.recording_id||!r?.session_id)throw new Error('');
    sessionId=r.session_id;
    const seg={no:r.segment_no||1,id:r.recording_id,ended:false,stopped:false,seq:0,pieces:[],base:0};
    segments=[seg];
    current=makeRecorder(seg);
    current.rec.start(PIECE_SECONDS*1000);
    startedAt=new Date().toISOString();
    state='recording';runSince=performance.now();startTicker();paint();paintPending();
  }catch(e){
    console.warn('recording start failed',e?.status||'',e?.code||'');
    releaseStream();
    fail(e?.code==='session_required'?'로그인이 만료됐어요. 다시 로그인해 주세요.':'녹음을 시작하지 못했어요. 잠시 뒤 다시 눌러 주세요.',false);
  }
}
function togglePause(){
  const rec=current?.rec;if(!rec)return;
  if(state==='recording'){try{rec.pause()}catch{return}accum=elapsed();runSince=0;state='paused'}
  else if(state==='paused'){try{rec.resume()}catch{return}runSince=performance.now();state='recording'}
  paint();
}
function releaseStream(){try{stream?.getTracks?.().forEach(t=>t.stop())}catch{}stream=null}

// ---- 조각 대기열(한 번에 하나, 순서대로) ----
async function pump(){
  if(pumping)return;pumping=true;
  try{
    for(;;){
      const next=nextStep(segments);
      if(next.kind==='drained'){const w=drainWaiters;drainWaiters=[];w.forEach(f=>f());break}
      if(next.kind==='idle'||retryTimer)break;
      const seg=segments[next.index];
      try{
        if(next.kind==='start'){
          const r=await call('rec_start',{workspace_id:workspaceId,mime:baseMime(MIME),session_id:sessionId});
          if(!r?.recording_id)throw new Error('');
          seg.id=r.recording_id;
        }else{
          const piece=seg.pieces[0];
          await call('rec_piece',null,{body:piece.blob,timeoutMs:180000,headers:{
            'Content-Type':baseMime(MIME),'x-recording-id':seg.id,'x-piece-seq':String(piece.seq),'x-duration-sec':String(piece.seconds)
          }});
          seg.pieces.shift();
        }
        fails=0;
      }catch(e){
        const outcome=pieceOutcome({status:e?.status||0,message:e?.message||'',code:e?.code||''});
        console.warn('recording piece failed',e?.status||'',outcome);
        if(outcome==='stop'){
          // 서버가 이 구간을 닫았다(다른 창에서 새 녹음 등) → 남은 조각은 버리고 녹음을 멈춘다.
          seg.stopped=true;seg.pieces=[];
          if(active()){stopReason='다른 곳에서 녹음 구간이 닫혀 녹음을 멈췄어요. 지금까지 올린 것은 정리할 수 있어요.';void stopAndFinish()}
          continue;
        }
        fails++;
        const wait=retryDelay(fails);
        retryTimer=setTimeout(()=>{retryTimer=0;void pump()},wait);
        break;
      }
    }
  }finally{pumping=false;if(active()||state==='finishing')paint()}
}
const drained=()=>nextStep(segments).kind==='drained'?Promise.resolve():new Promise(resolve=>{drainWaiters.push(resolve);void pump()});

// ---- 멈추고 정리 ----
async function stopAndFinish(){
  if(!active()||!current)return;
  accum=elapsed();runSince=0;
  state='finishing';step='올림';note=stopReason;clearInterval(ticker);paint();
  const holder=current;
  try{if(holder.rec.state!=='inactive')holder.rec.stop();else holder.end()}catch{holder.end()}
  // 59분 넘김 중이던 앞 녹음기도 끝난 뒤(마지막 조각이 대기열에 들어간 뒤) 마이크를 놓는다.
  await Promise.all([holder.stopped,...rollingStops]);
  rollingStops=[];current=null;releaseStream();
  await drained();
  note='';
  await finishSession();
}

// ---- 버리기 ----
// 녹음 띠의 [버리기]: 띠는 바로 사라지고 마이크도 바로 끈다. 녹음기가 내놓는 마지막 조각까지 마저 올린 뒤(되돌리기로 살릴 수 있게,
// 최대 DISCARD_DRAIN_MS) 서버에 버리기를 부른다. 시간 안에 못 올린 조각은 메모리에서 버린다. 전사·요약·초안은 하지 않는다.
async function discardLive(){
  if(!active()||!current||discarding)return;
  const sid=sessionId,holder=current,stops=[holder.stopped,...rollingStops];
  discarding=true;clearInterval(ticker);
  state='idle';step='';note='';errorText='';accum=0;runSince=0;sessionId='';
  try{if(holder.rec.state!=='inactive')holder.rec.stop();else holder.end()}catch{holder.end()}
  releaseStream();
  paint();
  let timer=0;
  const wait=new Promise(r=>{timer=setTimeout(r,DISCARD_DRAIN_MS)});
  await Promise.race([Promise.all(stops).then(()=>drained()),wait]);
  clearTimeout(timer);
  current=null;rollingStops=[];segments=[];clearTimeout(retryTimer);retryTimer=0;fails=0;stopReason='';doneTexts.clear();
  await discardSession(sid);
}
// 서버에 버리기(띠·'이어서 정리' 줄 공통) → 위쪽 작은 알림 '녹음을 버렸어요 [되돌리기]' 10초.
async function discardSession(sid){
  discarding=true;paint();
  let ok=false;
  try{await call('rec_discard',{session_id:sid});ok=true}
  catch(e){
    console.warn('recording discard failed',e?.status||'',e?.code||'');
    // 서버에 올라간 조각이 없었다(1분 안쪽 녹음을 못 올림 등) = 버릴 것이 없음.
    if(e?.status===404||e?.code==='not_found'){discarding=false;pending=pending.filter(s=>s.session_id!==sid);paint();notify('녹음을 버렸어요');return}
  }finally{discarding=false}
  pending=pending.filter(s=>s.session_id!==sid);
  paint();
  if(!ok){notify('녹음을 버리지 못했어요. 끝나지 않은 녹음 줄에서 다시 버려 주세요.',{error:true});void loadPending(true);return}
  notify('녹음을 버렸어요',{label:'녹음 버리기',ms:DISCARD_NOTICE_MS,undo:async()=>{
    try{await call('rec_restore',{session_id:sid})}
    catch(e){console.warn('recording restore failed',e?.status||'',e?.code||'');return {status:'failed',message:'녹음을 되돌리지 못했어요.'}}
    await loadPending(true);
    return {status:'restored'};
  }});
}
function discardPending(id){
  if(active()||state==='finishing'||discarding)return;
  if(!pending.some(s=>s.session_id===id))return;
  void discardSession(id);
}

// 정리 흐름(멈추고 정리·이어서 정리·[다시] 공통). sessionId·startedAt은 이 창의 녹음 또는 '이어서 정리'로 고른 녹음.
async function finishSession(known=null){
  if(!sessionId)return;
  state='finishing';step='올림';errorText='';canRetry=false;paint();
  try{
    let res=null;
    for(let i=0;i<30;i++){
      res=await call('rec_finish',{session_id:sessionId},{timeoutMs:260000});
      if(!res?.more)break;
    }
    const status=new Map((known?.segments||[]).map(s=>[s.segment_no,s.job_status]));
    const plan=transcribePlan((res?.segments||[]).map(s=>({...s,job_status:s.job_status??status.get(s.segment_no)??null})));
    const todo=plan.filter(p=>p.action==='transcribe');
    if(!todo.length&&!plan.some(p=>p.action==='gone'))throw stopError('녹음에서 정리할 소리를 찾지 못했어요.',false);
    step='전사';
    const parts=[],jobs=[];
    let n=0;
    for(const p of plan){
      if(p.action==='skip'){parts.push({no:p.no,seconds:p.seconds,text:''});continue}
      if(p.action==='gone'&&!doneTexts.has(p.job)){parts.push({no:p.no,seconds:p.seconds,text:null});jobs.push(p.job);continue}
      n++;
      if(!doneTexts.has(p.job)){
        note=todo.length>1?`${n}/${todo.length}`:'';paint();
        const done=await call('transcribe',{job_id:p.job},{timeoutMs:420000});
        doneTexts.set(p.job,cleanTranscript(String(done?.text||'')));
      }
      parts.push({no:p.no,seconds:p.seconds,text:doneTexts.get(p.job)});
      jobs.push(p.job);
    }
    note='';
    const text=joinSegmentTexts(parts);
    if(!text.replace(/^―.*―$/gm,'').trim())throw stopError(transcribeFailText('empty_transcript'),false);
    step='요약';paint();
    await openDraft(text,jobs);
    step='초안 열림';state='done';paint();
    setTimeout(()=>{if(state==='done')closeBand()},8000);
    pending=pending.filter(s=>s.session_id!==sessionId);
    void loadPending(true);
  }catch(e){
    console.warn('recording finish failed',e?.status||'',e?.code||'');
    const text=e?.recText||(e?.code==='session_required'?'로그인이 만료됐어요. 다시 로그인한 뒤 [이어서 정리]를 눌러 주세요.':step==='전사'?transcribeFailText(e?.message):step==='요약'?'초안 창을 열지 못했어요. [다시]를 누르세요.':'녹음을 합치지 못했어요. 소리는 Drive에 남아 있어요.');
    fail(text,e?.recRetry!==false);
  }
}
function stopError(text,retry){const e=new Error('');e.recText=text;e.recRetry=retry;return e}
function fail(text,retry){state='error';errorText=text;canRetry=!!retry&&!!sessionId;step='';note='';clearInterval(ticker);paint()}

// 사업 보고 › 회의 입력 창을 열고 기존 [초안 채우기] 흐름에 글을 넣는다(meeting-transcript-draft.js).
async function openDraft(text,jobs){
  const loader=window.KPTUDeferredFeatures?.loadView||window.KPTUViewLoader?.load;
  if(loader)await loader('meetings');
  const entry=window.KPTUReportEntry;
  if(!entry?.open)throw stopError('사업 보고 화면을 열지 못했어요. [다시]를 누르세요.',true);
  const opened=await entry.open({kind:'meeting',at:seoulLocal(startedAt),trigger:$('#reportRecordBtn')||document.activeElement});
  if(opened===false)throw stopError('사업 보고 창을 열지 못했어요. [다시]를 누르세요.',true);
  const draft=window.KPTUMeetingTranscriptDraft;
  if(!draft?.fill)throw stopError('초안 칸을 찾지 못했어요. [다시]를 누르세요.',true);
  const minutes=Math.round(elapsed()/60000);
  await draft.fill({text,jobs,name:`노트북 녹음${minutes?` · ${minutes}분`:''}`});
}

// ---- 이어서 정리 ----
const onMeetings=()=>{const v=window.KPTURouter?.current;return v==='meetings'||v==='reports'};
async function loadPending(force=false,tries=0){
  const id=ws();
  if(!PC?.matches||!supported())return;
  // 첫 화면 직후 로그인 정보가 아직 없으면 잠깐 뒤 다시(최대 5번).
  if(!id||!rt()?.api){if(tries<5)setTimeout(()=>void loadPending(force,tries+1),1000);return}
  if(!force&&(pendingFor===id||pendingFlight))return;
  pendingFor=id;
  const flight=call('rec_pending',{workspace_id:id}).then(r=>{if(ws()===id){pending=Array.isArray(r?.sessions)?r.sessions:[];paintPending()}})
    .catch(e=>{console.warn('recording pending failed',e?.status||'');if(pendingFor===id)pendingFor=''});
  pendingFlight=flight;
  try{await flight}finally{if(pendingFlight===flight)pendingFlight=null}
}
function resume(id){
  if(active()||state==='finishing')return;
  const session=pending.find(s=>s.session_id===id);if(!session)return;
  sessionId=session.session_id;startedAt=session.started_at||new Date().toISOString();workspaceId=ws();
  accum=(Number(session.duration_sec)||0)*1000;runSince=0;doneTexts.clear();
  paintPending();
  void finishSession(session);
}

// ---- 연결 ----
document.addEventListener('click',e=>{
  if(e.target.closest('#reportRecordBtn')){e.preventDefault();void start();return}
  const r=e.target.closest('[data-rec-resume]');
  if(r){e.preventDefault();resume(r.dataset.recResume);return}
  const d=e.target.closest('[data-rec-discard]');
  if(d){e.preventDefault();discardPending(d.dataset.recDiscard)}
});
// 녹음 중(아직 올리지 못한 조각이 있을 때 포함)에만 창 닫기 경고.
window.addEventListener('beforeunload',e=>{
  if(!(active()||(state==='finishing'&&step==='올림')))return;
  e.preventDefault();e.returnValue='';
});
window.addEventListener('kptu:session-changed',e=>{
  if(e.detail?.session)return;
  // 로그아웃: 녹음을 멈추고 메모리의 조각을 버린다(서버에 올린 것은 다음 로그인 때 '이어서 정리').
  if(current){try{current.rec.stop()}catch{}}
  current=null;releaseStream();clearInterval(ticker);clearTimeout(retryTimer);retryTimer=0;segments=[];pending=[];pendingFor='';
  state='idle';sessionId='';paint();paintPending();
});
window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view==='meetings'){paintButton();void loadPending()}});
PC?.addEventListener?.('change',()=>{paintButton();paintPending();if(PC.matches&&onMeetings())void loadPending()});

window.KPTUMeetingRecorder={state:()=>state,mime:MIME};
paint();
// '이어서 정리' 줄은 사업 보고 화면에만 있으므로, 그 화면을 열 때만 서버에 묻는다(다른 화면의 첫 요청을 늘리지 않음).
if(onMeetings())void loadPending();
})();
