// MTG-노트북녹음 2단계: 노트북 [녹음]의 순수 규칙(형식 고르기·구간 넘김·조각 대기열·녹음 저장·띠 글자).
// 화면·마이크·네트워크는 meeting-recorder.js가 맡는다. 여기서는 DOM·네트워크를 쓰지 않는다(단위 시험 대상, app-smoke-check).
// 설계: docs/design/laptop-recording.md 8절. 서버 규칙(조각 1분·구간 29분)은 supabase/functions/meeting-transcribe/recording.mjs와 같다.

export const PIECE_SECONDS=60;          // 조각 간격(서버 REC_PIECE_SECONDS). 실제 간격은 rec_start 답의 piece_seconds를 따른다(pieceSecondsOf).
export const ROLL_PIECES=60;            // 조각이 이만큼 쌓이면 새 구간(서버 REC_ROLL_PIECES, rec_start 답 max_pieces)
export const SEGMENT_SECONDS=29*60;     // 새 구간으로 넘어가는 길이(서버 REC_SEGMENT_SECONDS). 발언자 구분이 30분까지라 구간마다 '화자n:' 줄이 나오게 29분(REC-발언자구분)
export const AUDIO_BITS=32000;          // 32kbps 안팎: 29분 ≈ 7MB(전사 100MB 상한 안)
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

// 서버가 알려 준 조각 간격(초). 30초~5분만 받고, 없거나 이상하면 PIECE_SECONDS.
// 옛 서버(5분 조각·한 구간 16조각)는 piece_seconds 300을 주므로 화면이 먼저 배포돼도 그 서버에 맞춰 5분으로 보낸다.
export function pieceSecondsOf(res){const n=Number(res?.piece_seconds);return Number.isInteger(n)&&n>=30&&n<=300?n:PIECE_SECONDS}
// 서버가 알려 준 한 구간 조각 수 한도. 없으면(옛 서버) 옛 상한 16에서 여유 4를 뺀 12.
export function rollPiecesOf(res){const n=Number(res?.max_pieces);return Number.isInteger(n)&&n>=4&&n<=1000?n:12}

// 지금 구간이 새 구간으로 넘어갈 때인지(녹음한 초 기준, 일시정지는 세지 않음).
// pieces·maxPieces를 주면 조각 수로도 넘어간다(일시정지 중에도 조각이 나오는 브라우저에서 구간 조각 한도를 넘지 않게).
export const shouldRoll=(segmentSeconds,limit=SEGMENT_SECONDS,pieces=0,maxPieces=Infinity)=>Number(segmentSeconds)>=limit||Number(pieces)>=maxPieces;

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

// 띠 진행 한 줄: 올림 › 저장. 지금 단계는 strong으로 표시(화면이 그린다).
// S61-5 REC-전사삭제(명진 11/13): 전사·요약·초안 단계는 없다. 멈추면 녹음 파일을 자료실 '회의 녹음' 폴더에 저장하는 것까지.
export const STEPS=Object.freeze(['올림','저장']);
export function stepParts(current){
  const at=STEPS.indexOf(current);
  return STEPS.map((label,i)=>({label,state:at<0?'todo':i<at?'done':i===at?'now':'todo'}));
}

// 녹음 저장(노트북·폰 공용): 열린 구간을 닫고 조각을 합친 뒤(rec_finish, more면 다시) 합친 파일을 자료실 자료로 남긴다(rec_save).
// call(action, body, extra)는 화면의 서버 호출. meetingId가 있으면 그 회의 자료로도 붙는다. 전사·요약은 부르지 않는다.
export async function saveRecording(call,sessionId,{meetingId='',onStep=()=>{}}={}){
  onStep('올림');
  for(let i=0;i<30;i++){const r=await call('rec_finish',{session_id:sessionId},{timeoutMs:260000});if(!r?.more)break}
  onStep('저장');
  const r=await call('rec_save',{session_id:sessionId,...(meetingId?{meeting_id:meetingId}:{})},{timeoutMs:60000});
  const files=savedFiles(r);
  if(!files.length)throw Object.assign(new Error(''),{code:'no_recording'});
  return {files,folder:String(r?.folder_name||'회의 녹음')};
}
// rec_save 답 → 띠에 보일 파일 줄(이름·자료 번호·Drive 번호·주소만).
export function savedFiles(res){
  return (Array.isArray(res?.files)?res.files:[]).filter(f=>f&&typeof f.document_id==='string'&&f.document_id).map(f=>({
    documentId:f.document_id,name:String(f.file_name||'녹음'),driveId:typeof f.drive_file_id==='string'?f.drive_file_id:'',
    driveUrl:typeof f.drive_url==='string'?f.drive_url:'',mime:typeof f.mime_type==='string'?f.mime_type:'',
  }));
}
// 저장이 멈춘 이유(띠 한 줄). 녹음은 서버(Drive)에 그대로 있으므로 [다시]로 다시 저장한다.
export function saveFailText(e,step=''){
  const code=e?.code||'';
  if(code==='session_required'||e?.status===401)return '로그인이 만료됐어요. 다시 로그인한 뒤 [다시]를 누르세요.';
  if(code==='drive_not_connected')return 'Google Drive가 아직 연결되지 않았어요. 자료실에서 Drive를 연결해 주세요.';
  if(code==='no_recording')return '녹음에서 저장할 소리를 찾지 못했어요.';
  return step==='저장'?'자료실에 저장하지 못했어요. 녹음은 Drive에 그대로 있어요. [다시]를 누르세요.':'녹음을 합치지 못했어요. 올린 소리는 Drive에 그대로 있어요. [다시]를 누르세요.';
}

// 저장 끝 띠의 파일 줄(노트북·폰 같은 모양). 파일마다 이름 · [내려받기] · [Drive에서 열기]. attr = 버튼 data 속성 머리(노트북 'rec', 폰 'prec').
export function savedFilesHtml(files,attr='rec'){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return (Array.isArray(files)?files:[]).map((f,i)=>`<span class="rec-file"><span class="rec-file-name">${esc(f.name)}</span><button type="button" class="rec-btn" data-${attr}-down="${i}" aria-label="${esc(f.name)} 내려받기">내려받기</button><button type="button" class="rec-btn" data-${attr}-open="${i}" aria-label="${esc(f.name)} Drive에서 열기">Drive에서 열기</button></span>`).join('');
}
// 저장 끝 띠 높이(파일이 여럿이면 한 줄씩 늘림, px). 한 개면 기본 높이.
export const savedBandHeight=n=>n>1?Math.min(n,6)*28+8:0;

// 녹음 시작 시각 → 사업 보고 창 일시('YYYY-MM-DDTHH:mm', 서울).
export function seoulLocal(at){
  const d=new Date(at);if(!Number.isFinite(d.getTime()))return '';
  const k=new Date(d.getTime()+9*3600000).toISOString();
  return `${k.slice(0,10)}T${k.slice(11,16)}`;
}
// '이어서 저장' 한 줄 글자: '10/29 14:30 녹음 · 32분'
export function pendingText(session){
  const at=seoulLocal(session?.started_at);
  const day=at?`${Number(at.slice(5,7))}/${Number(at.slice(8,10))} ${at.slice(11,16)}`:'';
  const minutes=Math.round((Number(session?.duration_sec)||0)/60);
  return [day?`${day} 녹음`:'녹음',minutes?minuteText(minutes):''].filter(Boolean).join(' · ');
}
// REC-새로고침(S49-7): 맨 위 띠에 보일 '끝나지 않은 녹음' 목록.
// pending = 서버 rec_pending sessions(열린 구간이 7분 넘게 조용하거나 닫힌 것), live = 같은 답의 live(열린 구간이 아직 조용하지 않음 = 방금 새로고침·창 닫기로 끊겼거나 다른 곳에서 녹음 중).
// 띠에는 하루 안쪽 녹음만 보이고(새로고침 직후 이어 녹음하려는 것), 더 오래된 것은 사업 보고 위 한 줄에만 남긴다.
export const LIVE_FRESH_SEC=100;            // 마지막 조각 뒤 이 초 안쪽이면 다른 곳에서 지금 녹음 중일 수 있다(조각 1분 + 여유).
export const BAND_RECENT_MS=24*3600*1000;
export function resumables(pending,live,activeSessionId='',nowMs=Date.now()){
  const seen=new Set(activeSessionId?[activeSessionId]:[]),all=[];
  for(const [list,isLive] of [[live,true],[pending,false]]){
    for(const s of Array.isArray(list)?list:[]){
      if(!s?.session_id||seen.has(s.session_id))continue;
      seen.add(s.session_id);all.push({...s,live:isLive});
    }
  }
  const recent=s=>{
    if(s.live)return true;
    const t=Date.parse(s.started_at||'');
    return Number.isFinite(t)&&nowMs-(t+(Number(s.duration_sec)||0)*1000)<BAND_RECENT_MS;
  };
  const byStart=(a,b)=>String(b.started_at).localeCompare(String(a.started_at));
  return {top:all.filter(recent).sort(byStart),old:all.filter(s=>!recent(s)).sort(byStart)};
}
// 이 녹음을 이어받으면 다른 곳의 지금 녹음이 멈출 수 있는지(확인창을 띄울지).
export function takeOverRisk(item,nowMs=Date.now()){
  if(!item?.live)return false;
  const idle=Number(item.idle_sec);
  if(!Number.isFinite(idle))return true;
  const waited=Number.isFinite(item.fetched)?Math.max(0,(nowMs-item.fetched)/1000):0;
  return idle+waited<LIVE_FRESH_SEC;
}

// 이어서 정리할 녹음 중 지금 이 창이 녹음 중인 것은 뺀다.
export const pendingOthers=(sessions,activeSessionId)=>(Array.isArray(sessions)?sessions:[]).filter(s=>s?.session_id&&s.session_id!==activeSessionId);
