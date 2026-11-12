// MTG-노트북녹음 2단계(요청함 10/29 14:26): 노트북(PC 761px~) 사업 보고 위쪽 줄 [녹음] → 화면 맨 위 녹음 띠 → [멈추고 저장] → 자료실 '회의 녹음' 폴더.
// 설계: docs/design/laptop-recording.md 8절. 서버: Edge meeting-transcribe의 rec_start·rec_piece·rec_finish·rec_save·rec_pending·rec_discard·rec_restore.
// S61-5 REC-전사삭제(명진 11/13 '회의 전사 기능은 아예 웹2에서 삭제, 그냥 파일만 제공'): 전사·요약·회의 기록 초안은 하지 않는다.
//   멈추면 녹음 파일(29분 구간마다 하나)을 자료실 '회의 녹음' 폴더에 저장하고, 띠에 파일 이름 · [내려받기] · [Drive에서 열기]를 바로 보인다.
// - 주인: 이 모듈 하나가 녹음기·녹음 띠(#recBand)·[녹음](#reportRecordBtn)·'끝나지 않은 녹음' 줄(#recPendingLine)을 그린다(AGENTS.md 5절 one state owner).
//   loader-v2.js가 첫 화면 뒤 한 번 불러오고, 화면 전환에 다시 그리지 않으므로 다른 메뉴로 옮겨도 녹음은 계속된다.
// - 기기 저장 없음: 녹음 조각은 1분마다(서버가 rec_start로 알려 준 간격) 서버(명진 Drive)로 가고, 보내지 못한 조각은 메모리에만 두고 같은 번호로 다시 보낸다.
//   브라우저 저장 공간을 쓰지 않는다(Browser storage audit). 창을 닫으면 마지막 1분 안쪽만 잃고, 다시 열면 '이어서 저장'(rec_pending).
// - [삭제](요청함 10/30 10:01): 녹음을 바로 멈추고 마이크를 끈 뒤, 이미 녹음된 것만 마저 올리고(최대 DISCARD_DRAIN_MS) rec_discard로
//   올린 조각을 모두 Drive 휴지통으로 옮긴다. 올리지 못한 조각은 메모리에서 버린다. 위쪽 작은 알림 [되돌리기](10초)는
//   rec_restore로 휴지통에서 꺼내 '끝나지 않은 녹음' 줄로 돌린다(마이크는 꺼졌으므로 녹음을 이어 하지는 않음). 그 줄에도 같은 [삭제].
// - 29분(SEGMENT_SECONDS)마다 같은 마이크 흐름으로 새 녹음기를 먼저 켜고 앞 녹음기를 멈춘다(앞 구간 마지막 조각 → rec_start 같은 session_id → 새 구간 조각).
// - [멈추고 저장]: 마지막 조각 → rec_finish(more면 반복) → rec_save(자료실 자료 + '회의 녹음' 폴더) → 띠 '저장됨'.
import {PIECE_SECONDS,SEGMENT_SECONDS,AUDIO_BITS,pieceSecondsOf,rollPiecesOf,pickMime,baseMime,shouldRoll,retryDelay,pieceOutcome,nextStep,queuedPieces,clockText,stepParts,pendingText,resumables,takeOverRisk,saveRecording,saveFailText,savedFilesHtml,savedBandHeight} from './meeting-recorder-model.mjs';
import {notify} from './small-notice.js';
import {downloadFile,openInDrive} from './file-actions.js';

(()=>{
'use strict';
if(window.KPTUMeetingRecorder)return;
const $=s=>document.querySelector(s);
const FN='/functions/v1/meeting-transcribe';
const PC=window.matchMedia?.('(min-width:761px)');
const MR=window.MediaRecorder;
const MIME=pickMime(MR?.isTypeSupported?.bind(MR));
const supported=()=>!!(MIME&&navigator.mediaDevices?.getUserMedia);
// 띠·버튼 모양(모든 화면 공통이라 화면별 묶음이 아니라 여기서 한 번 붙인다).
if(!document.querySelector('link[data-rec-style]')){const l=document.createElement('link');l.rel='stylesheet';l.href='./meeting-recorder.css';l.dataset.recStyle='1';document.head.appendChild(l)}

// 상태: idle → starting → recording ⇄ paused → finishing → saved | error
// suspended = 마이크가 끊겨(덮개 닫기·잠자기·마이크 빠짐) 일시 정지됨. 올린 조각은 그대로, [이어 녹음]을 사람이 눌러야 마이크를 다시 쥔다(브라우저 규칙).
let state='idle',step='',note='',errorText='',canRetry=false;
let stream=null,current=null,segments=[],sessionId='',workspaceId='',startedAt='';
let rollingStops=[],accum=0,runSince=0,ticker=0,pumping=false,fails=0,retryTimer=0,drainWaiters=[],stopReason='';
let takeover=null,pending=[],live=[],pendingFor='',pendingFlight=null,discarding=false,livePolls=0,livePollTimer=0;
// 저장 끝 띠의 파일들(rec_save 답, 메모리에만)·그 녹음을 붙일 회의(start({meetingId})로 받은 경우만).
let savedFiles=[],meetingId='';
let pieceMs=PIECE_SECONDS*1000,rollPieces=rollPiecesOf(null); // 이 녹음의 조각 간격·구간 조각 한도(rec_start 답, 녹음 내내 같음)
const DISCARD_DRAIN_MS=20000,DISCARD_NOTICE_MS=10000;
const SUSPEND_NOTE='마이크는 브라우저 규칙상 직접 눌러야 다시 켜져요. 지금까지 녹음은 서버에 있어요.';

const rt=()=>window.KPTURuntime;
const ws=()=>rt()?.context?.read?.()?.workspace?.id||'';
const elapsed=()=>accum+(runSince?performance.now()-runSince:0);
const active=()=>state==='starting'||state==='recording'||state==='paused'||state==='suspended';
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
// REC-새로고침(S49-7): 녹음 중이 아닐 때 끝나지 않은 녹음(방금 새로고침·창 닫기로 끊긴 것 포함)이 있으면 어느 화면에서든 맨 위 띠에 보인다.
function bandList(){return PC?.matches&&supported()&&state==='idle'&&!discarding?resumables(pending,live,sessionId):{top:[],old:[]}}
function paint(){
  const el=band(),list=bandList().top,showPending=!!list.length,on=state!=='idle'||showPending;
  el.hidden=!on;
  document.body.classList.toggle('rec-on',on);
  el.dataset.state=showPending?'pending':state;
  const tall=!showPending&&state==='saved'?savedBandHeight(savedFiles.length):0;
  el.classList.toggle('rec-tall',!!tall);
  if(tall)document.body.style.setProperty('--rec-band-height',`${tall}px`);else document.body.style.removeProperty('--rec-band-height');
  const label=el.querySelector('.rec-label'),time=el.querySelector('.rec-time'),msg=el.querySelector('.rec-note'),act=el.querySelector('.rec-actions');
  const sec=elapsed()/1000;
  let l='',t='',m='',a='';
  if(showPending&&takeover&&list.some(s=>s.session_id===takeover.id)){
    l='확인';
    m=escapeText('다른 곳에서 지금 녹음 중이면 그쪽 녹음은 멈춰요.');
    a='<button type="button" class="rec-btn" data-rec-takeover="go">계속</button><button type="button" class="rec-btn" data-rec-takeover="cancel">취소</button>';
  }else if(showPending){
    takeover=null;
    const first=list[0],id=escapeText(first.session_id);
    l='일시 정지됨';
    m=escapeText(`${pendingText(first)}${list.length>1?` 외 ${list.length-1}건`:''}`);
    a=`<button type="button" class="rec-btn" data-rec-continue="${id}">이어 녹음</button><button type="button" class="rec-btn" data-rec-resume="${id}">이어서 저장</button><button type="button" class="rec-btn rec-discard" data-rec-discard="${id}">삭제</button>`;
  }else if(state==='starting'){l='녹음 준비 중';m=escapeText('마이크를 허락해 주세요.')}
  else if(state==='suspended'){
    l='일시 정지됨';
    t=clockText(sec);
    const q=queuedPieces(segments);
    m=escapeText(SUSPEND_NOTE+(q?` (조각 ${q}개 올리는 중)`:''));
    a='<button type="button" class="rec-btn" data-rec="resume">이어 녹음</button><button type="button" class="rec-btn rec-stop" data-rec="stop">멈추고 저장</button><button type="button" class="rec-btn rec-discard" data-rec="discard">삭제</button>';
  }
  else if(state==='recording'||state==='paused'){
    l=state==='paused'?'일시정지':'녹음 중';
    t=clockText(sec);
    const q=queuedPieces(segments);
    m=fails&&q?escapeText(`조각 ${q}개 올리기 다시 시도 중`):'';
    a=`<button type="button" class="rec-btn" data-rec="pause">${state==='paused'?'이어 녹음':'일시정지'}</button><button type="button" class="rec-btn rec-stop" data-rec="stop">멈추고 저장</button><button type="button" class="rec-btn rec-discard" data-rec="discard">삭제</button>`;
  }else if(state==='finishing'){
    l='저장 중';
    t=sec?clockText(sec):'';
    m=stepParts(step).map(p=>p.state==='now'?`<strong>${p.label}</strong>`:`<span class="rec-step-${p.state}">${p.label}</span>`).join('<span aria-hidden="true"> › </span>')+(note?` <span class="rec-sub">${escapeText(note)}</span>`:'');
  }else if(state==='saved'){
    // 저장 끝: 자료실 '회의 녹음' 폴더에 들어간 파일 이름 · [내려받기] · [Drive에서 열기]. [닫기]를 누를 때까지 둔다.
    l='저장됨';
    t=sec?clockText(sec):'';
    m=savedFilesHtml(savedFiles,'rec');
    a='<button type="button" class="rec-btn" data-rec="close">닫기</button>';
  }else if(state==='error'){
    l='녹음 저장 멈춤';
    m=escapeText(errorText);
    a=`${canRetry?'<button type="button" class="rec-btn" data-rec="retry">다시</button>':''}<button type="button" class="rec-btn" data-rec="close">닫기</button>`;
  }
  setText(label,l);setText(time,t);setHtml(msg,m);setHtml(act,a);
  paintButton();
  paintOldLine();
}
const escapeText=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function paintButton(){
  const btn=$('#reportRecordBtn');if(!btn)return;
  btn.hidden=!(supported()&&PC?.matches);
  btn.disabled=state!=='idle'||discarding;
  btn.textContent=active()?'녹음 중':'녹음';
  btn.setAttribute('aria-pressed',String(active()));
}
// 하루가 지난 끝나지 않은 녹음은 맨 위 띠에 두지 않고 사업 보고 목록 위 한 줄에만 남긴다.
function paintOldLine(){
  const line=$('#recPendingLine');if(!line)return;
  const list=bandList().old;
  line.hidden=!list.length;
  if(line.hidden){setHtml(line,'');return}
  const first=list[0];
  setHtml(line,`<span class="rec-pending-text">끝나지 않은 녹음 · ${escapeText(pendingText(first))}${list.length>1?` 외 ${list.length-1}건`:''}</span><button type="button" class="rec-btn" data-rec-continue="${escapeText(first.session_id)}">이어 녹음</button><button type="button" class="rec-btn" data-rec-resume="${escapeText(first.session_id)}">이어서 저장</button><button type="button" class="rec-btn rec-discard" data-rec-discard="${escapeText(first.session_id)}">삭제</button>`);
}
function onBandClick(e){
  const f=e.target.closest('[data-rec-down],[data-rec-open]');
  if(f){
    const file=savedFiles[Number(f.dataset.recDown??f.dataset.recOpen)];if(!file)return;
    const onError=text=>notify(text,{error:true});
    if(f.dataset.recDown!==undefined)void downloadFile(file,{onError});else openInDrive(file,{onError});
    return;
  }
  const b=e.target.closest('[data-rec]');if(!b)return;
  const what=b.dataset.rec;
  if(what==='pause')togglePause();
  else if(what==='resume')void resumeSuspended();
  else if(what==='stop')void stopAndFinish();
  else if(what==='discard')void discardLive();
  else if(what==='retry'){if(state==='error')void finishSession()}
  else if(what==='close')closeBand();
}
function closeBand(){if(active()||state==='finishing')return;state='idle';step='';note='';errorText='';accum=0;runSince=0;savedFiles=[];paint()}
function startTicker(){clearInterval(ticker);ticker=setInterval(tick,1000)}
function tick(){
  if(state==='recording'&&current&&!current.rolling){
    const segSec=(elapsed()-current.seg.base)/1000;
    if(shouldRoll(segSec,SEGMENT_SECONDS,current.seg.seq,rollPieces))roll();
  }
  if(active())paint();
}

// ---- 녹음기 ----
function makeRecorder(seg){
  const rec=new MR(stream,{mimeType:MIME,audioBitsPerSecond:AUDIO_BITS});
  let done=()=>{};
  const holder={rec,seg,rolling:false,wanted:false,stopped:new Promise(r=>{done=r})};
  holder.end=()=>{seg.ended=true;done();void pump()};
  // 끝낸 적 없는데 녹음기가 멈추면(마이크 끊김·잠자기) 마지막 조각은 stop 직전 dataavailable로 이미 대기열에 들어갔다 → 일시 정지됨.
  const lost=()=>{holder.end();if(!holder.wanted&&!holder.rolling&&current===holder&&(state==='recording'||state==='paused'))suspend()};
  rec.addEventListener('dataavailable',e=>{
    if(!e.data||!e.data.size)return;
    const seconds=Math.max(1,Math.ceil((elapsed()-seg.base)/1000));
    seg.pieces.push({seq:++seg.seq,blob:e.data,seconds:Math.min(seconds,3600)});
    void pump();
  });
  rec.addEventListener('stop',lost);
  rec.addEventListener('error',lost);
  // 마이크 트랙이 끝나면(잠자기·장치 빠짐) 브라우저가 녹음기를 멈추지만, 안 멈추는 브라우저를 위해 직접 멈춘다.
  for(const tr of stream?.getTracks?.()||[])tr.addEventListener?.('ended',()=>{if(holder.wanted||rec.state==='inactive')return;try{rec.stop()}catch{lost()}});
  return holder;
}
// 구간 넘김(29분): 새 녹음기를 먼저 켜고(조각은 메모리 대기열에) 앞 녹음기를 멈춘다. 대기열이 앞 구간 마지막 조각 → rec_start → 새 구간 순서를 지킨다.
function roll(){
  const old=current;if(!old||old.rolling)return;
  old.rolling=true;
  const seg={no:old.seg.no+1,id:null,ended:false,stopped:false,seq:0,pieces:[],base:elapsed()};
  segments.push(seg);
  try{current=makeRecorder(seg);current.rec.start(pieceMs)}
  catch(e){console.warn('recorder roll failed',e?.name||'');segments.pop();current=old;old.rolling=false;return}
  rollingStops.push(old.stopped);
  old.wanted=true;
  try{old.rec.stop()}catch{old.end()}
}
// from = 끝나지 않은 녹음(rec_pending/live 한 건)이면 [이어서 녹음]: 같은 session_id의 다음 구간으로 새로 녹음한다(REC-새로고침, S49-7).
// 새로고침·창 닫기로 끊긴 마이크는 되살릴 수 없으므로(브라우저 한계) 이미 올라간 조각은 그대로 두고 마이크만 다시 켠다. 띠 시간은 앞 녹음 길이에서 이어 센다.
// opts.meetingId: 회의(회차)에서 녹음하면 그 회의 자료로도 붙인다(rec_save meeting_id). 사업 보고 목록 [녹음]은 회의 없이 자료실에만.
async function start(from=null,opts={}){
  if(state!=='idle'&&state!=='saved'&&state!=='error')return;
  if(!supported()||discarding)return;
  workspaceId=ws();
  if(!rt()?.api||!workspaceId){fail('로그인 상태를 확인하지 못했어요.',false);return}
  const before=from?Math.max(0,Number(from.duration_sec)||0)*1000:0;
  state='starting';step='';note='';errorText='';savedFiles=[];meetingId=from?'':String(opts?.meetingId||'');accum=before;runSince=0;segments=[];rollingStops=[];sessionId=from?.session_id||'';if(from)startedAt=from.started_at||new Date().toISOString();fails=0;stopReason='';paint();
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
  }catch(e){
    console.warn('microphone denied',e?.name||'');
    fail(e?.name==='NotAllowedError'?'마이크를 쓸 수 없어요. 주소창 왼쪽 표시를 눌러 마이크를 허용해 주세요.':'마이크를 찾지 못했어요.',false);return;
  }
  try{
    const r=await call('rec_start',{workspace_id:workspaceId,mime:baseMime(MIME),...(from?{session_id:from.session_id}:{})});
    if(!r?.recording_id||!r?.session_id)throw new Error('');
    sessionId=r.session_id;
    pieceMs=pieceSecondsOf(r)*1000;rollPieces=rollPiecesOf(r);
    const seg={no:r.segment_no||1,id:r.recording_id,ended:false,stopped:false,seq:0,pieces:[],base:before};
    segments=[seg];
    current=makeRecorder(seg);
    current.rec.start(pieceMs);
    if(!from)startedAt=new Date().toISOString();
    state='recording';runSince=performance.now();startTicker();paint();
  }catch(e){
    console.warn('recording start failed',e?.status||'',e?.code||'');
    releaseStream();
    sessionId='';accum=0;
    fail(e?.code==='session_required'?'로그인이 만료됐어요. 다시 로그인해 주세요.':from?'이어서 녹음하지 못했어요. 올린 소리는 그대로 있어요. [이어서 저장]으로 저장할 수 있어요.':'녹음을 시작하지 못했어요. 잠시 뒤 다시 눌러 주세요.',false);
    if(from)void loadPending(true);
  }
}
function togglePause(){
  const rec=current?.rec;if(!rec)return;
  if(state==='recording'){try{rec.pause()}catch{return}accum=elapsed();runSince=0;state='paused'}
  else if(state==='paused'){try{rec.resume()}catch{return}runSince=performance.now();state='recording'}
  paint();
}
// 일시 정지됨: 지금까지 길이를 굳히고 마이크를 놓는다. 대기열의 조각은 그대로 올린다(pump). 같은 녹음(session_id)을 [이어 녹음]으로 잇는다.
function suspend(){
  if(state!=='recording'&&state!=='paused')return;
  accum=elapsed();runSince=0;
  state='suspended';current=null;releaseStream();paint();
}
// 새 구간을 같은 session_id로 연다(구간 넘김과 같은 방식). 앞 조각은 이미 대기열/서버에 있다.
async function resumeSuspended(){
  if(state!=='suspended')return;
  state='starting';errorText='';paint();
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
  }catch(e){
    console.warn('microphone denied',e?.name||'');
    state='suspended';
    notify(e?.name==='NotAllowedError'?'마이크를 쓸 수 없어요. 주소창 왼쪽 표시를 눌러 마이크를 허용해 주세요.':'마이크를 찾지 못했어요.',{error:true});
    paint();return;
  }
  const last=segments[segments.length-1];
  const seg={no:(last?.no||0)+1,id:null,ended:false,stopped:false,seq:0,pieces:[],base:accum};
  segments.push(seg);
  try{
    current=makeRecorder(seg);current.rec.start(pieceMs);
  }catch(e){
    console.warn('recorder resume failed',e?.name||'');
    segments.pop();current=null;releaseStream();state='suspended';notify('녹음을 다시 켜지 못했어요.',{error:true});paint();return;
  }
  state='recording';runSince=performance.now();startTicker();paint();void pump();
}
// 화면이 숨겨질 때(탭 숨김·덮개 닫기 직전) 아직 조각이 안 된 소리를 바로 대기열로 내보낸다. 돌아왔을 때 마이크가 죽어 있으면 일시 정지됨.
function onHiddenFlush(){
  if(state!=='recording'||!current)return;
  try{if(current.rec.state==='recording')current.rec.requestData()}catch{}
}
function onVisibleCheck(){
  if(state!=='recording'&&state!=='paused')return;
  const dead=!current||current.rec.state==='inactive'||(stream&&stream.getTracks().every(t=>t.readyState==='ended'));
  if(!dead)return;
  if(current&&current.rec.state!=='inactive'){try{current.rec.stop();return}catch{}} // stop 이벤트가 suspend를 부른다
  suspend();
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
          if(active()){stopReason='다른 곳에서 녹음 구간이 닫혀 녹음을 멈췄어요. 지금까지 올린 것은 저장해요.';void stopAndFinish()}
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

// ---- 멈추고 저장 ----
async function stopAndFinish(){
  if(!active()||(!current&&state!=='suspended'))return;
  accum=elapsed();runSince=0;
  state='finishing';step='올림';note=stopReason;clearInterval(ticker);paint();
  const holder=current;
  if(holder){holder.wanted=true;try{if(holder.rec.state!=='inactive')holder.rec.stop();else holder.end()}catch{holder.end()}}
  // 구간 넘김 중이던 앞 녹음기도 끝난 뒤(마지막 조각이 대기열에 들어간 뒤) 마이크를 놓는다.
  await Promise.all([holder?.stopped,...rollingStops]);
  rollingStops=[];current=null;releaseStream();
  await drained();
  note='';
  await finishSession();
}

// ---- 버리기 ----
// 녹음 띠의 [버리기]: 띠는 바로 사라지고 마이크도 바로 끈다. 녹음기가 내놓는 마지막 조각까지 마저 올린 뒤(되돌리기로 살릴 수 있게,
// 최대 DISCARD_DRAIN_MS) 서버에 버리기를 부른다. 시간 안에 못 올린 조각은 메모리에서 버린다.
async function discardLive(){
  if(!active()||(!current&&state!=='suspended')||discarding)return;
  const sid=sessionId,holder=current,stops=[holder?.stopped,...rollingStops];
  discarding=true;clearInterval(ticker);
  state='idle';step='';note='';errorText='';accum=0;runSince=0;sessionId='';
  if(holder){holder.wanted=true;try{if(holder.rec.state!=='inactive')holder.rec.stop();else holder.end()}catch{holder.end()}}
  releaseStream();
  paint();
  let timer=0;
  const wait=new Promise(r=>{timer=setTimeout(r,DISCARD_DRAIN_MS)});
  await Promise.race([Promise.all(stops).then(()=>drained()),wait]);
  clearTimeout(timer);
  current=null;rollingStops=[];segments=[];clearTimeout(retryTimer);retryTimer=0;fails=0;stopReason='';
  await discardSession(sid);
}
// 서버에 버리기(띠·'끝나지 않은 녹음' 줄 공통) → 위쪽 작은 알림 '녹음을 버렸어요 [되돌리기]' 10초.
async function discardSession(sid){
  discarding=true;paint();
  let ok=false;
  try{await call('rec_discard',{session_id:sid});ok=true}
  catch(e){
    console.warn('recording discard failed',e?.status||'',e?.code||'');
    // 서버에 올라간 조각이 없었다(1분 안쪽 녹음을 못 올림 등) = 버릴 것이 없음.
    if(e?.status===404||e?.code==='not_found'){discarding=false;pending=pending.filter(s=>s.session_id!==sid);paint();notify('녹음을 삭제했어요');return}
  }finally{discarding=false}
  pending=pending.filter(s=>s.session_id!==sid);
  paint();
  if(!ok){notify('녹음을 삭제하지 못했어요. 끝나지 않은 녹음 줄에서 다시 삭제해 주세요.',{error:true});void loadPending(true);return}
  notify('녹음을 삭제했어요',{label:'녹음 삭제',ms:DISCARD_NOTICE_MS,undo:async()=>{
    try{await call('rec_restore',{session_id:sid})}
    catch(e){console.warn('recording restore failed',e?.status||'',e?.code||'');return {status:'failed',message:'녹음을 되돌리지 못했어요.'}}
    await loadPending(true);
    return {status:'restored'};
  }});
}
// 끝나지 않은 녹음 [버리기]: 버린 뒤 10초 [되돌리기]가 있어 확인창은 없다(앞 결정). 다른 곳에서 지금 녹음 중일 수 있는 것만 띠에서 한 번 더 묻는다.
function discardPending(id){
  if(active()||state==='finishing'||discarding)return;
  if(!allResumable().some(s=>s.session_id===id))return;
  void discardSession(id);
}
const allResumable=()=>{const r=resumables(pending,live,sessionId);return [...r.top,...r.old]};

// 저장 흐름(멈추고 저장·이어서 저장·[다시] 공통): rec_finish(합치기) → rec_save(자료실 '회의 녹음' 폴더, 회의가 있으면 그 회의 자료로도).
// 실패하면 멈춤 띠 + [다시](녹음은 서버 Drive에 그대로라 다시 불러도 같은 파일·같은 자료 행 하나).
async function finishSession(){
  if(!sessionId||active())return; // 멈추고 저장은 이미 'finishing'으로 들어온다(마지막 조각을 올린 뒤)
  state='finishing';step='올림';errorText='';canRetry=false;paint();
  try{
    const r=await saveRecording(call,sessionId,{meetingId,onStep:s=>{step=s;paint()}});
    savedFiles=r.files;note='';step='';state='saved';
    pending=pending.filter(s=>s.session_id!==sessionId);
    paint();
    notify(`자료실 '${r.folder}' 폴더에 저장했어요`);
    void loadPending(true);
  }catch(e){
    console.warn('recording save failed',e?.status||'',e?.code||'');
    fail(saveFailText(e,step),e?.code!=='no_recording');
  }
}
function fail(text,retry){state='error';errorText=text;canRetry=!!retry&&!!sessionId;step='';note='';clearInterval(ticker);paint()}

// ---- 이어서 저장 ----
const onMeetings=()=>{const v=window.KPTURouter?.current;return v==='meetings'||v==='reports'};
async function loadPending(force=false,tries=0){
  const id=ws();
  if(!PC?.matches||!supported())return;
  // 첫 화면 직후 로그인 정보가 아직 없으면 잠깐 뒤 다시(최대 5번).
  if(!id||!rt()?.api){if(tries<5)setTimeout(()=>void loadPending(force,tries+1),1000);return}
  if(!force&&(pendingFor===id||pendingFlight))return;
  pendingFor=id;
  const flight=call('rec_pending',{workspace_id:id}).then(r=>{if(ws()===id){
      pending=Array.isArray(r?.sessions)?r.sessions:[];
      const at=Date.now();live=(Array.isArray(r?.live)?r.live:[]).map(s=>({...s,fetched:at}));
      paint();watchLive();
    }})
    .catch(e=>{console.warn('recording pending failed',e?.status||'');if(pendingFor===id)pendingFor=''});
  pendingFlight=flight;
  try{await flight}finally{if(pendingFlight===flight)pendingFlight=null}
}
// 방금 끊긴 것일 수도, 다른 창·기기에서 지금 녹음 중일 수도 있다(live, 마지막 조각 뒤 100초 안쪽). 후자면 이어받거나 버리는 순간 그쪽이 멈추므로
// 띠에서 [계속][취소]로 한 번 묻는다(브라우저 확인창은 쓰지 않는다).
function askTakeOver(kind,id){
  const item=allResumable().find(s=>s.session_id===id);if(!item)return;
  if(!takeOverRisk(item)){runTakeOver(kind,id);return}
  takeover={kind,id};paint();
}
function runTakeOver(kind,id){
  takeover=null;
  if(kind==='continue')continueRecording(id);
  else if(kind==='resume')resume(id);
  else discardPending(id);
  paint();
}
// 이어서 보이는 live가 있는 동안 30초마다 다시 물어 다른 곳에서 끝난 녹음을 정리한다(최대 10번).
function watchLive(){
  clearTimeout(livePollTimer);
  if(!live.length||state!=='idle'||livePolls>=10){if(!live.length)livePolls=0;return}
  livePollTimer=setTimeout(()=>{livePolls++;void loadPending(true)},30000);
}
function continueRecording(id){
  if(active()||state==='finishing'||discarding)return;
  const item=allResumable().find(s=>s.session_id===id);if(!item)return;
  void start(item);
}
function resume(id){
  if(active()||state==='finishing')return;
  const session=allResumable().find(s=>s.session_id===id);if(!session)return;
  sessionId=session.session_id;startedAt=session.started_at||new Date().toISOString();workspaceId=ws();meetingId='';
  accum=(Number(session.duration_sec)||0)*1000;runSince=0;
  paint();
  void finishSession();
}

// ---- 연결 ----
document.addEventListener('click',e=>{
  if(e.target.closest('#reportRecordBtn')){e.preventDefault();void start();return}
  const t=e.target.closest('[data-rec-takeover]');
  if(t){e.preventDefault();const w=takeover;if(t.dataset.recTakeover==='go'&&w)runTakeOver(w.kind,w.id);else{takeover=null;paint()}return}
  const c=e.target.closest('[data-rec-continue]');
  if(c){e.preventDefault();askTakeOver('continue',c.dataset.recContinue);return}
  const r=e.target.closest('[data-rec-resume]');
  if(r){e.preventDefault();askTakeOver('resume',r.dataset.recResume);return}
  const d=e.target.closest('[data-rec-discard]');
  if(d){e.preventDefault();askTakeOver('discard',d.dataset.recDiscard)}
});
// 녹음 중(아직 올리지 못한 조각이 있을 때 포함)에만 창 닫기 경고.
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')onHiddenFlush();else onVisibleCheck()});
window.addEventListener('pagehide',onHiddenFlush);
window.addEventListener('beforeunload',e=>{
  if(state==='suspended'&&!queuedPieces(segments))return;
  if(!(active()||(state==='finishing'&&step==='올림')))return;
  e.preventDefault();e.returnValue='';
});
window.addEventListener('kptu:session-changed',e=>{
  if(e.detail?.session)return;
  // 로그아웃: 녹음을 멈추고 메모리의 조각을 버린다(서버에 올린 것은 다음 로그인 때 '이어서 저장').
  if(current){current.wanted=true;try{current.rec.stop()}catch{}}
  current=null;releaseStream();clearInterval(ticker);clearTimeout(retryTimer);retryTimer=0;segments=[];pending=[];live=[];clearTimeout(livePollTimer);pendingFor='';
  state='idle';sessionId='';savedFiles=[];meetingId='';paint();
});
window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view==='meetings'){paintButton();void loadPending()}});
PC?.addEventListener?.('change',()=>{paintButton();paint();if(PC.matches&&onMeetings())void loadPending()});

window.KPTUMeetingRecorder={state:()=>state,mime:MIME,start:(opts={})=>start(null,opts),files:()=>savedFiles.map(f=>({...f}))};
paint();
// 끝나지 않은 녹음 띠는 어느 화면에서든 보이므로(새로고침 직후 PC에서 바로 이어 녹음), 첫 화면 요청과 겹치지 않게 조금 뒤 한 번 묻는다. 폰 폭에서는 부르지 않는다.
setTimeout(()=>void loadPending(),3500);
})();
