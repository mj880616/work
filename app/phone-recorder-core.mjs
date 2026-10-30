// MTG-폰녹음(요청함 10/30 10:56): 폰 앱(웹2 앱 0.3.3+)의 [녹음] 흐름. 화면(DOM)은 phone-recorder.js, 여기는 순서·서버 호출만(단위 시험 대상).
// - 녹음은 앱이 한다(RecorderService, 화면이 꺼져도 계속). 앱은 1분마다 조각을 자르고 앱 전용 공간에만 둔다.
// - 서버 호출(rec_start·rec_piece·rec_finish·transcribe·rec_pending·rec_discard·rec_restore)은 이 화면이 웹2 로그인 세션(runtime api)으로 한다.
//   앱은 토큰을 보지 않는다. 조각 내용은 ./__rec/<한 번 번호>를 fetch하면 앱이 WebView 안에서 흘려준다(서버로 나가지 않음).
// - 정리 흐름(rec_finish → 구간마다 transcribe → 글 합치기 → 사업 보고 › 회의 입력 창 [초안 채우기])은 노트북 녹음(meeting-recorder.js)과 같은
//   규칙(meeting-recorder-model.mjs)을 쓴다. 노트북 모듈은 고치지 않는다(같은 시간 다른 작업과 겹치지 않게, PR 본문 참고).
import {retryDelay,pieceOutcome,transcribePlan,joinSegmentTexts,seoulLocal,pendingOthers} from './meeting-recorder-model.mjs';
import {cleanTranscript,transcribeFailText} from './meeting-transcript-model.mjs';

export const MIME='audio/ogg';
export const DISCARD_DRAIN_MS=20000;
export const IDLE_POLL_MS=10000;
const FULL='이 녹음 구간이 가득 찼어요. 새 구간으로 이어 주세요.';

// 앱이 보낸 글 → {kind, data}. 'rec:state:{…}' / 'rec:next:{…}' / 'rec:wait:3000' / 'rec:ready' 등. 녹음 소식이 아니면 null.
export function readMessage(text){
  if(typeof text!=='string'||!text.startsWith('rec:'))return null;
  const body=text.slice(4),i=body.indexOf(':');
  const kind=i<0?body:body.slice(0,i),rest=i<0?'':body.slice(i+1);
  if(kind==='state'||kind==='next'){try{const data=JSON.parse(rest);return data&&typeof data==='object'?{kind,data}:null}catch{return null}}
  if(kind==='wait'){const n=Number(rest);return Number.isFinite(n)&&n>=0?{kind,data:Math.min(n,120000)}:null}
  if(['ready','denied','busy'].includes(kind)&&!rest)return {kind,data:null};
  if(kind==='error'&&rest==='start')return {kind:'error',data:'start'};
  return null;
}

// 올리기 실패 → 앱에 알릴 갈래(retry|stop|full). 노트북 규칙(pieceOutcome)에 '가득 참'만 따로 뗀다(앱이 새 구간으로 넘김).
export function failWire(e){
  const message=e?.message||'',status=e?.status||0,code=e?.code||'';
  if(message===FULL||code==='rec_full')return 'full';
  return pieceOutcome({status,message,code})==='stop'?'stop':'retry';
}

// '이어서 정리' 목록: 이 폰에 남은 녹음(앱이 죽음·정리 전) 먼저, 그다음 서버 목록(같은 녹음·지금 녹음 중인 것은 뺌).
export function pendingList(native,server,activeId=''){
  const out=[];
  const local=native&&(native.state==='interrupted'||(native.state==='stopped'&&!native.auto_finish))&&native.session_id;
  if(local)out.push({session_id:native.session_id,started_at:native.started_at,duration_sec:Math.round((Number(native.elapsed_ms)||0)/1000),local:true});
  for(const s of pendingOthers(server,activeId))if(s.session_id!==native?.session_id)out.push(s);
  return out;
}

// 조각 올리기 머리글(노트북과 같은 rec_piece 규칙).
export const pieceHeaders=p=>({'Content-Type':MIME,'x-recording-id':p.id,'x-piece-seq':String(p.seq),'x-duration-sec':String(p.seconds)});

/**
 * deps: {send(text), call(action,body,extra), fetchPiece(token)→Blob, openDraft({text,jobs,startedAt,minutes}), notify(text,opts),
 *        workspace()→id, sleep(ms, wake?)→Promise, paint(view), now()}
 * 앱이 보낸 글은 receive(text)로 넣는다.
 */
export function createPhoneRecorder(deps){
  const sleep=deps.sleep||((ms)=>new Promise(r=>setTimeout(r,ms)));
  const now=deps.now||(()=>Date.now());
  const view={state:'idle',step:'',note:'',error:'',canRetry:false,native:null,nativeAt:0,pending:[],supported:false,busy:false};
  const waiters=[];
  let wakers=[],pumping=null,startFails=0,serverPending=[],sessionId='',startedAt='',knownMinutes=0;
  const doneTexts=new Map();

  const paint=()=>{view.pending=view.state==='idle'&&!view.busy?pendingList(view.native,serverPending,activeId()):[];deps.paint?.(view)};
  const activeId=()=>['recording','paused'].includes(view.native?.state)?view.native.session_id:'';
  const wake=()=>{const w=wakers;wakers=[];w.forEach(f=>f())};
  const nap=ms=>new Promise(resolve=>{let done=false;const fin=()=>{if(!done){done=true;resolve()}};wakers.push(fin);sleep(ms).then(fin)});

  function receive(text){
    const m=readMessage(text);if(!m)return;
    if(m.kind==='state')applyNative(m.data);
    for(const w of waiters.slice())if(w.kinds.includes(m.kind)&&(!w.test||w.test(m))){waiters.splice(waiters.indexOf(w),1);w.resolve(m)}
  }
  // 앱에 묻고 맞는 답을 기다린다. 답이 없으면(옛 앱 등) 시간이 지나 null.
  function ask(text,kinds,ms=10000,test=null){
    return new Promise(resolve=>{
      const w={kinds,test,resolve};waiters.push(w);
      sleep(ms).then(()=>{const i=waiters.indexOf(w);if(i>=0){waiters.splice(i,1);resolve(null)}});
      if(text)deps.send(text);
    });
  }
  function applyNative(st){
    const first=!view.supported;
    view.supported=true;view.native=st;view.nativeAt=now();
    const s=st?.state;
    if((s==='recording'||s==='paused')&&!view.busy&&!['finishing','starting'].includes(view.state)){view.state=s;sessionId=st.session_id;startedAt=st.started_at;void pump()}
    else if(s!=='recording'&&s!=='paused'&&(view.state==='recording'||view.state==='paused'))view.state='idle';
    if(s==='stopped'&&st.auto_finish&&view.state!=='finishing'){void finishLocal()}
    else if(st?.want_start&&s==='idle'&&view.state==='idle')void start();
    wake();paint();
    if(first)void loadPending();
  }
  const elapsedMs=()=>{const n=view.native;if(!n)return 0;const base=Number(n.elapsed_ms)||0;return n.state==='recording'?base+(now()-view.nativeAt):base};

  async function hello(){return ask('rec:hello',['state'],5000)}

  // ---- 시작 ----
  async function start(){
    if(!['idle','done','error'].includes(view.state)||view.busy)return;
    const st=view.native?.state;
    if(st&&st!=='idle'){deps.notify?.('끝나지 않은 폰 녹음이 있어요. 먼저 [이어서 정리]하거나 [버리기]를 눌러 주세요.',{error:true});return}
    const ws=deps.workspace();
    if(!ws){fail('로그인 상태를 확인하지 못했어요.',false);return}
    view.state='starting';view.step='';view.note='';view.error='';doneTexts.clear();paint();
    const ok=await ask('rec:prepare',['ready','denied'],120000);
    if(ok?.kind!=='ready'){fail(ok?'마이크를 쓸 수 없어요. 폰 설정 › 애플리케이션 › 웹2 › 권한에서 마이크를 허용해 주세요.':'앱이 답하지 않아요. 앱을 다시 열어 주세요.',false);return}
    let r;
    try{
      r=await deps.call('rec_start',{workspace_id:ws,mime:MIME});
      if(!r?.recording_id||!r?.session_id)throw new Error('');
    }catch(e){fail(e?.code==='session_required'?'로그인이 만료됐어요. 다시 로그인해 주세요.':'녹음을 시작하지 못했어요. 잠시 뒤 다시 눌러 주세요.',false);return}
    const begin={session_id:r.session_id,recording_id:r.recording_id,segment_no:r.segment_no||1,workspace_id:ws,
      started_at:new Date(now()).toISOString(),piece_seconds:r.piece_seconds??null,segment_seconds:r.segment_seconds??null};
    const ans=await ask(`rec:begin:${JSON.stringify(begin)}`,['state','error','busy','denied'],15000,m=>m.kind!=='state'||m.data?.state==='recording');
    if(ans?.kind!=='state'){
      fail(ans?.kind==='busy'?'끝나지 않은 폰 녹음이 있어요. 먼저 정리하거나 버려 주세요.':ans?.kind==='denied'?'마이크를 쓸 수 없어요.':'마이크를 켜지 못했어요. 다른 앱이 마이크를 쓰는지 확인해 주세요.',false);
      return;
    }
    sessionId=r.session_id;startedAt=begin.started_at;view.state='recording';paint();void pump();
  }

  // ---- 조각 올리기(한 번에 하나, 순서대로). 앱이 대기열·재시도 간격을 정한다 ----
  function pump(){
    if(pumping)return pumping;
    pumping=(async()=>{
      try{
        for(;;){
          const ans=await ask('rec:next',['next'],10000);
          const n=ans?.data;
          if(!n||n.kind==='none'||n.kind==='drained')return n?.kind||'none';
          if(n.kind==='idle'){
            if(!['recording','paused'].includes(view.native?.state))return 'idle';
            await nap(IDLE_POLL_MS);continue;
          }
          if(n.kind==='start'){
            try{
              const r=await deps.call('rec_start',{workspace_id:view.native?.workspace_id||deps.workspace(),mime:MIME,session_id:view.native?.session_id||sessionId});
              if(!r?.recording_id)throw new Error('');
              deps.send(`rec:opened:${n.no}:${r.recording_id}`);
            }catch(e){
              const wire=failWire(e);
              if(wire!=='retry'){await ask(`rec:failed:${n.no}:1:stop`,['wait'],3000);continue}
              await nap(retryDelay(++startFails));
              continue;
            }
            startFails=0;continue;
          }
          if(n.kind==='piece'){
            let blob=null;
            try{blob=await deps.fetchPiece(n.token)}catch{blob=null}
            if(!blob||!blob.size){await nap(1000);continue}
            try{
              await deps.call('rec_piece',null,{body:blob,timeoutMs:180000,headers:pieceHeaders(n)});
              deps.send(`rec:sent:${n.no}:${n.seq}`);
              view.note='';
            }catch(e){
              const w=await ask(`rec:failed:${n.no}:${n.seq}:${failWire(e)}`,['wait'],5000);
              const ms=w?.data??3000;
              if(ms)view.note=`조각 올리기 다시 시도 중`;
              paint();
              await nap(ms);
            }
            continue;
          }
          return 'none';
        }
      }finally{pumping=null;paint()}
    })();
    return pumping;
  }
  // 남은 조각을 모두 올릴 때까지(앱이 멈춘 뒤). ms가 있으면 그 시간까지만.
  async function drain(ms=0){
    const go=(async()=>{for(;;){const r=await pump();if(r==='drained'||r==='none')return r;await nap(1000)}})();
    if(!ms)return go;
    return Promise.race([go,sleep(ms).then(()=>'timeout')]);
  }
  async function waitStopped(){
    for(let i=0;i<20;i++){
      const s=view.native?.state;
      if(s==='stopped'||s==='interrupted'||s==='idle')return s;
      await ask('',['state'],1000);
    }
    return view.native?.state;
  }

  function pause(){if(view.state==='recording')deps.send('rec:pause');else if(view.state==='paused')deps.send('rec:resume')}

  // ---- 멈추고 정리 ----
  async function stopAndFinish(){
    if(!['recording','paused'].includes(view.state))return;
    view.state='finishing';view.step='올림';paint();
    deps.send('rec:stop');
    await waitStopped();
    await finishLocal();
  }
  // 이 폰에 남은 녹음을 다 올리고 정리한다(멈추고 정리·알림 [멈추고 정리]·'이어서 정리' 공통).
  async function finishLocal(){
    const n=view.native;
    if(!n?.session_id)return;
    view.state='finishing';view.step='올림';view.error='';paint();
    deps.send('rec:finishing');
    sessionId=n.session_id;startedAt=n.started_at;knownMinutes=Math.round(elapsedMs()/60000);
    await drain();
    await finishSession(null,true);
  }

  // 서버 정리(노트북 finishSession과 같은 순서). clearLocal: rec_finish가 끝나면 앱의 임시 파일·상태를 지운다.
  async function finishSession(known=null,clearLocal=false){
    if(!sessionId)return;
    view.state='finishing';view.step='올림';view.error='';view.canRetry=false;paint();
    try{
      let res=null;
      for(let i=0;i<30;i++){res=await deps.call('rec_finish',{session_id:sessionId},{timeoutMs:260000});if(!res?.more)break}
      if(clearLocal&&view.native?.session_id===sessionId)deps.send('rec:clear');
      const status=new Map((known?.segments||[]).map(s=>[s.segment_no,s.job_status]));
      const plan=transcribePlan((res?.segments||[]).map(s=>({...s,job_status:s.job_status??status.get(s.segment_no)??null})));
      const todo=plan.filter(p=>p.action==='transcribe');
      if(!todo.length&&!plan.some(p=>p.action==='gone'))throw stopError('녹음에서 정리할 소리를 찾지 못했어요.',false);
      view.step='전사';
      const parts=[],jobs=[];let k=0;
      for(const p of plan){
        if(p.action==='skip'){parts.push({no:p.no,seconds:p.seconds,text:''});continue}
        if(p.action==='gone'&&!doneTexts.has(p.job)){parts.push({no:p.no,seconds:p.seconds,text:null});jobs.push(p.job);continue}
        k++;
        if(!doneTexts.has(p.job)){
          view.note=todo.length>1?`${k}/${todo.length}`:'';paint();
          const done=await deps.call('transcribe',{job_id:p.job},{timeoutMs:420000});
          doneTexts.set(p.job,cleanTranscript(String(done?.text||'')));
        }
        parts.push({no:p.no,seconds:p.seconds,text:doneTexts.get(p.job)});jobs.push(p.job);
      }
      view.note='';
      const text=joinSegmentTexts(parts);
      if(!text.replace(/^―.*―$/gm,'').trim())throw stopError(transcribeFailText('empty_transcript'),false);
      view.step='요약';paint();
      const minutes=knownMinutes||Math.round(plan.reduce((s,p)=>s+p.seconds,0)/60);
      await deps.openDraft({text,jobs,startedAt:seoulLocal(startedAt),minutes});
      view.step='초안 열림';view.state='done';paint();
      serverPending=serverPending.filter(s=>s.session_id!==sessionId);
      void loadPending(true);
    }catch(e){
      const text=e?.recText||(e?.code==='session_required'?'로그인이 만료됐어요. 다시 로그인한 뒤 [이어서 정리]를 눌러 주세요.':view.step==='전사'?transcribeFailText(e):view.step==='요약'?'초안 창을 열지 못했어요. [다시]를 누르세요.':'녹음을 합치지 못했어요. 올린 소리는 Drive에 남아 있어요.');
      fail(text,e?.recRetry!==false);
    }
  }
  function stopError(text,retry){const e=new Error('');e.recText=text;e.recRetry=retry;return e}
  function fail(text,retry){view.state='error';view.error=text;view.canRetry=!!retry&&!!sessionId;view.step='';view.note='';paint()}
  function retry(){if(view.state==='error'&&view.canRetry)void finishSession()}
  function close(){if(['done','error'].includes(view.state)){view.state='idle';view.step='';view.error='';paint()}}

  // ---- 버리기 ----
  async function discardLive(){
    if(!['recording','paused'].includes(view.state))return;
    const sid=view.native?.session_id||sessionId;
    view.state='idle';view.busy=true;paint();
    deps.send('rec:discard');
    await waitStopped();
    await discardLocal(sid);
  }
  // 이 폰의 녹음: 남은 조각을 잠깐(20초) 마저 올린 뒤(되돌리기로 살릴 수 있게) 서버에 버리기, 앱의 임시 파일은 지운다.
  async function discardLocal(sid){
    view.busy=true;paint();
    await drain(DISCARD_DRAIN_MS);
    deps.send('rec:clear');
    await discardSession(sid);
  }
  async function discardSession(sid){
    view.busy=true;paint();
    let ok=false,none=false;
    try{await deps.call('rec_discard',{session_id:sid});ok=true}
    catch(e){if(e?.status===404||e?.code==='not_found')none=true}
    finally{view.busy=false}
    serverPending=serverPending.filter(s=>s.session_id!==sid);
    paint();
    if(none){deps.notify?.('녹음을 버렸어요');return}
    if(!ok){deps.notify?.('녹음을 버리지 못했어요. 끝나지 않은 녹음 줄에서 다시 버려 주세요.',{error:true});void loadPending(true);return}
    deps.notify?.('녹음을 버렸어요',{label:'녹음 버리기',ms:10000,undo:async()=>{
      try{await deps.call('rec_restore',{session_id:sid})}catch{return {status:'failed',message:'녹음을 되돌리지 못했어요.'}}
      await loadPending(true);
      return {status:'restored'};
    }});
  }

  // ---- 이어서 정리 ----
  let pendingFlight=null;
  async function loadPending(force=false){
    const ws=deps.workspace();
    if(!ws||(pendingFlight&&!force))return pendingFlight;
    pendingFlight=deps.call('rec_pending',{workspace_id:ws}).then(r=>{serverPending=Array.isArray(r?.sessions)?r.sessions:[];paint()}).catch(()=>{}).finally(()=>{pendingFlight=null});
    return pendingFlight;
  }
  function resume(id){
    if(view.state==='finishing'||['recording','paused','starting'].includes(view.state)||view.busy)return;
    const item=view.pending.find(s=>s.session_id===id);if(!item)return;
    if(item.local){void finishLocal();return}
    sessionId=item.session_id;startedAt=item.started_at||new Date(now()).toISOString();knownMinutes=Math.round((Number(item.duration_sec)||0)/60);doneTexts.clear();
    void finishSession(item);
  }
  function discardPending(id){
    if(view.state==='finishing'||['recording','paused','starting'].includes(view.state)||view.busy)return;
    const item=view.pending.find(s=>s.session_id===id);if(!item)return;
    if(item.local)void discardLocal(id);else void discardSession(id);
  }
  function reset(){waiters.splice(0);serverPending=[];view.state='idle';view.native=null;view.supported=false;paint()}

  return {view,receive,hello,start,pause,stopAndFinish,discardLive,retry,close,resume,discardPending,loadPending,elapsedMs,reset,_drain:drain};
}
