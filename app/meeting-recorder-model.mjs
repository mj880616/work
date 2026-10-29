// MTG-노트북녹음 2단계: 노트북 [녹음]의 순수 규칙(형식 고르기·구간 넘김·조각 대기열·글 합치기·띠 글자).
// 화면·마이크·네트워크는 meeting-recorder.js가 맡는다. 여기서는 DOM·네트워크를 쓰지 않는다(단위 시험 대상, app-smoke-check).
// 설계: docs/design/laptop-recording.md 8절. 서버 규칙(조각 5분·구간 59분)은 supabase/functions/meeting-transcribe/recording.mjs와 같다.

export const PIECE_SECONDS=5*60;        // 조각 간격(서버 REC_PIECE_SECONDS)
export const SEGMENT_SECONDS=59*60;     // 새 구간으로 넘어가는 길이(서버 REC_SEGMENT_SECONDS, 전사 1시간 상한 안)
export const AUDIO_BITS=32000;          // 32kbps 안팎: 59분 ≈ 14MB(전사 100MB 상한 안)
// Gemini 오디오 지원 목록에 webm이 없어 mp4(AAC)를 먼저, webm은 마지막(설계 6절 위험).
export const MIME_ORDER=Object.freeze(['audio/mp4','audio/ogg;codecs=opus','audio/webm;codecs=opus','audio/webm']);
export const RETRY_MS=Object.freeze([3000,10000,30000,60000]);

// 브라우저가 녹음할 수 있는 첫 형식. 없으면 ''(→ [녹음]을 보이지 않음).
export function pickMime(isTypeSupported){
  if(typeof isTypeSupported!=='function')return '';
  for(const type of MIME_ORDER){try{if(isTypeSupported(type))return type}catch{}}
  return '';
}
// 'audio/webm;codecs=opus' → 'audio/webm'(서버 recMime과 같은 세 가지).
export function baseMime(type){const b=String(type||'').toLowerCase().split(';')[0].trim();return ['audio/mp4','audio/ogg','audio/webm'].includes(b)?b:''}

// 지금 구간이 새 구간으로 넘어갈 때인지(녹음한 초 기준, 일시정지는 세지 않음).
export const shouldRoll=(segmentSeconds,limit=SEGMENT_SECONDS)=>Number(segmentSeconds)>=limit;

// 다음 재시도까지 기다릴 시간(실패 횟수 1부터).
export const retryDelay=fails=>RETRY_MS[Math.min(Math.max(1,fails)-1,RETRY_MS.length-1)];

// 서버 답 → 조각 처리 갈래. done: 대기열에서 뺌, retry: 메모리에 두고 같은 번호로 다시, stop: 이 구간은 더 못 보냄.
// 서버는 실패마다 정해진 한국어 한 줄을 준다(recording.mjs REC_MESSAGES). 화면 런타임 오류는 그 글을 message로 준다.
const CLOSED='이 녹음 구간은 이미 닫혔어요.';
const FULL='이 녹음 구간이 가득 찼어요. 새 구간으로 이어 주세요.';
export function pieceOutcome({ok=false,status=0,message='',code=''}={}){
  if(ok)return 'done';
  if(code==='session_required')return 'retry';
  if(message===CLOSED||message===FULL)return 'stop';
  if(status===401||status===403||status===404)return 'stop';
  if(status===413)return 'stop';
  return 'retry'; // 네트워크·5xx·409 순서(piece_gap)·busy: 같은 번호로 다시
}

// 녹음 구간 목록 → 대기열에서 다음에 할 일.
// segments: [{no, id|null, ended:bool, pieces:[{seq,blob,seconds}]}] (번호 순). 한 번에 한 가지만 한다(순서 강제).
// 'piece': 그 구간의 첫 조각 보내기, 'start': 앞 구간이 끝났으니 이 구간을 서버에 연다(rec_start), 'idle': 기다림, 'drained': 모두 보냄.
export function nextStep(segments){
  const list=Array.isArray(segments)?segments:[];
  for(let i=0;i<list.length;i++){
    const s=list[i];
    if(s.stopped)continue; // 서버가 닫은 구간(stop): 남은 조각은 버린다
    if(!s.id&&s.ended&&!s.pieces.length)continue; // 조각 없이 끝난 구간은 서버에 열지 않는다
    if(!s.id)return {kind:'start',index:i}; // 여기 왔으면 앞 구간은 모두 보냈다(아니면 위에서 돌아갔다)
    if(s.pieces.length)return {kind:'piece',index:i};
    if(!s.ended)return {kind:'idle'};
  }
  return list.length&&list.every(s=>s.stopped||(s.ended&&!s.pieces.length))?{kind:'drained'}:{kind:'idle'};
}

// 남은 조각 수(띠 글자용).
export const queuedPieces=segments=>(Array.isArray(segments)?segments:[]).reduce((n,s)=>n+(s.stopped?0:s.pieces.length),0);

// 00:05 / 1:02:03
export function clockText(seconds){
  const s=Math.max(0,Math.floor(Number(seconds)||0)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),r=s%60;
  const two=n=>String(n).padStart(2,'0');
  return h?`${h}:${two(m)}:${two(r)}`:`${two(m)}:${two(r)}`;
}
// 분 표시(구간 머리): 59 → '59분', 118 → '1시간 58분'
export function minuteText(minutes){
  const m=Math.max(0,Math.round(Number(minutes)||0)),h=Math.floor(m/60),r=m%60;
  return h?(r?`${h}시간 ${r}분`:`${h}시간`):`${r}분`;
}

// 구간 글을 순서대로 합친다. 둘째 구간부터 머리 '― 59분부터 ―' 한 줄. parts: [{no, seconds, text}] (seconds = 그 구간 길이)
// 이미 전사가 끝나 글이 서버에 없는 구간은 text가 null → '― 59분부터: 이 구간 글은 이미 정리됐어요 ―'.
export function joinSegmentTexts(parts){
  const list=(Array.isArray(parts)?parts:[]).slice().sort((a,b)=>a.no-b.no);
  let offset=0;const out=[];
  for(const p of list){
    const head=offset>0?`― ${minuteText(offset/60)}부터 ―`:'';
    const text=String(p.text??'').trim();
    if(p.text===null)out.push(`${head||'― 처음부터 ―'}\n(이 구간 글은 이미 전사가 끝나 다시 받을 수 없어요.)`);
    else if(text)out.push(head?`${head}\n${text}`:text);
    offset+=Math.max(0,Number(p.seconds)||0);
  }
  return out.join('\n\n');
}

// 띠 진행 한 줄: 올림 › 전사 › 요약 › 초안 열림. 지금 단계는 strong으로 표시(화면이 그린다).
export const STEPS=Object.freeze(['올림','전사','요약','초안 열림']);
export function stepParts(current){
  const at=STEPS.indexOf(current);
  return STEPS.map((label,i)=>({label,state:at<0?'todo':i<at?'done':i===at?'now':'todo'}));
}

// 녹음 시작 시각 → 사업 보고 창 일시('YYYY-MM-DDTHH:mm', 서울).
export function seoulLocal(at){
  const d=new Date(at);if(!Number.isFinite(d.getTime()))return '';
  const k=new Date(d.getTime()+9*3600000).toISOString();
  return `${k.slice(0,10)}T${k.slice(11,16)}`;
}
// '이어서 정리' 한 줄 글자: '10/29 14:30 녹음 · 32분'
export function pendingText(session){
  const at=seoulLocal(session?.started_at);
  const day=at?`${Number(at.slice(5,7))}/${Number(at.slice(8,10))} ${at.slice(11,16)}`:'';
  const minutes=Math.round((Number(session?.duration_sec)||0)/60);
  return [day?`${day} 녹음`:'녹음',minutes?minuteText(minutes):''].filter(Boolean).join(' · ');
}
// 이어서 정리할 녹음 중 지금 이 창이 녹음 중인 것은 뺀다.
export const pendingOthers=(sessions,activeSessionId)=>(Array.isArray(sessions)?sessions:[]).filter(s=>s?.session_id&&s.session_id!==activeSessionId);

// rec_finish 답의 구간 → 전사할 것·건너뛸 것. job_status는 rec_pending에서만 온다(없으면 아직 전사 전으로 본다).
export function transcribePlan(segments){
  const list=(Array.isArray(segments)?segments:[]).filter(s=>s&&s.status!=='empty').slice().sort((a,b)=>a.segment_no-b.segment_no);
  return list.map(s=>({no:s.segment_no,job:s.job_id||null,seconds:Number(s.duration_sec)||0,
    action:s.status==='combined'&&s.job_id?(s.job_status==='done'?'gone':'transcribe'):'skip',failed:s.status==='failed'}));
}
