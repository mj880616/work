// REC-서버정리(S49-2, 설계 docs/design/meeting-transcript-server.md 8절): 녹음 정리를 서버 작업으로 돌리고 진행을 지켜보는 순서.
// 노트북 녹음(meeting-recorder.js)·폰 녹음(phone-recorder-core.mjs)·회의자료 그 자리 전사가 같이 쓴다. DOM·네트워크는 부른 쪽이 준다(단위 시험 대상).
// - 서버(Edge meeting-transcribe job_start)가 합치기 → 구간 전사 → 요약을 화면과 상관없이 이어 한다. 화면은 job_read로 진행만 본다.
// - 화면을 닫거나 다른 앱으로 가도 서버는 계속하고, 끝나면 폰 알림 '회의 요약이 준비됐어요'. 다시 열면 job_list로 띠를 이어 그린다.
// - 서버가 아직 이 길을 모르면(옛 Edge·표 적용 전) 'unavailable'을 돌려주고, 부른 쪽은 지금까지의 화면 정리 길로 간다.
// - REC-한회의로잇기 PR-3(예외 하나): 정리 결과를 사람이 고른 보고에 [그 보고에 잇기]하면 서버가 뒤에서 그 보고에 저장한다(join_*, meeting-join.js).
//   그 밖의 정리 결과는 지금처럼 입력 창에 채우기만 하고 저장은 사람이 누른다.

export const POLL_MS=5000;
export const POLL_HIDDEN_MS=30000;
// 서버 단계 → 녹음 띠 단계 이름(stepParts: 올림 › 전사 › 요약 › 초안 열림).
export const STAGE_STEP=Object.freeze({combine:'올림',transcribe:'전사',summary:'요약',done:'초안 열림'});

// 이 서버가 서버 정리를 모름: 옛 함수(모르는 action = bad_request)·표 없음(jobs_unavailable).
export function unavailable(e){
  const code=e?.code||'',status=e?.status||0;
  return code==='jobs_unavailable'||(status===400&&(code==='bad_request'||!code));
}

// 띠 옆 작은 글: 전사 n/m, 요약 n/m.
export function progressNote(job){
  if(!job)return '';
  if(job.stage==='transcribe'&&job.parts_total>1)return `${Math.min(job.parts_done+1,job.parts_total)}/${job.parts_total}`;
  if(job.stage==='summary'&&job.step_total>1)return `${Math.min(job.step_no+1,job.step_total)}/${job.step_total}`;
  return '';
}

// 띠 글은 실패 이유마다 일상어로 나눈다(REC-정리멈춤반복 11/09: 이유 없이 '그 밖' 문구만 떠 왜 멈췄는지 알 수 없었음).
// 서버 정리(Edge meeting-transcribe runStep)가 남기는 error_code를 모두 적는다. 새 코드를 서버에 더하면 여기에도 더한다(시험이 서버 코드 목록과 맞춰 본다).
const KEEP='소리는 Drive에 남아 있어요.';
const AGAIN='[다시]를 누르면 멈춘 곳부터 이어요.';
const FAIL_TEXT={
  empty_transcript:'녹음에서 글을 찾지 못했어요.',
  // REC-글못찾음: 전사 서비스 답이 글 없이 옴 · 끝까지 못 만듦(같은 소리도 다시 하면 될 수 있음).
  gemini_empty:`전사 서비스가 글 없이 답했어요. ${KEEP} ${AGAIN}`,
  gemini_incomplete:`전사 서비스가 끝까지 옮기지 못했어요. ${KEEP} ${AGAIN}`,
  draft_failed:'전사는 끝났는데 요약을 만들지 못했어요. 전사한 글은 남아 있어요. [다시]를 누르세요.',
  draft_cut:'회의가 길어 요약이 중간에 잘렸어요. 전사한 글은 남아 있어요. [다시]를 누르세요.',
  draft_timeout:'요약이 오래 걸려 멈췄어요. 전사한 글은 남아 있어요. [다시]를 누르면 멈춘 곳부터 이어요.',
  draft_step_cut:'요약이 서버 시간 안에 끝나지 않아 끊겼어요. 전사한 글은 남아 있어요. [다시]를 누르면 멈춘 곳부터 이어요.',
  daily_limit:'오늘의 AI 사용 한도에 닿아 요약을 만들지 못했어요. 내일 [다시]를 누르세요.',
  // 한도·준비 중은 [다시]를 눌러도 같은 답이다(REC-정리상태확인못함). 폰 띠는 두 줄에서 잘리므로 그 말을 앞에 둔다. 한도가 풀리거나 준비가 끝나면 [다시]로 이어진다.
  monthly_limit:`이번 달 녹음 전사 한도에 닿았어요. 한도가 풀리기 전엔 [다시]도 같아요. ${KEEP}`,
  too_long:'녹음은 구간마다 1시간까지 전사할 수 있어요.',
  too_large:'녹음 파일은 100MB까지 전사할 수 있어요.',
  bad_type:'녹음 파일(m4a·mp3·wav 등)만 전사할 수 있어요.',
  not_found:'녹음을 찾지 못했어요.',
  not_ready:`녹음 전사는 준비 중이에요. 준비가 끝나기 전엔 [다시]도 같아요. ${KEEP}`,
  too_many_steps:`정리가 너무 오래 걸려 멈췄어요. ${AGAIN}`,
  gemini_timeout:`전사가 오래 걸려 멈췄어요. ${KEEP} ${AGAIN}`,
  step_cut:`한 구간이 서버 시간 안에 끝나지 않아 끊겼어요. ${KEEP} ${AGAIN}`,
  interrupted:`정리가 중간에 끊겼어요. ${KEEP} ${AGAIN}`,
  busy:`정리가 중간에 끊겼어요. ${KEEP} ${AGAIN}`,
  gemini_failed:`전사 서비스가 잠깐 실패했어요. ${KEEP} ${AGAIN}`,
  gemini_upload:`전사 서비스에 소리를 올리지 못했어요. ${KEEP} ${AGAIN}`,
  gemini_file_failed:`전사 서비스가 소리 파일을 읽지 못했어요. ${KEEP}`,
  gemini_rejected:`전사 서비스가 소리 파일을 받지 않았어요. ${KEEP}`,
  bad_format:`소리 파일이 깨져 읽지 못했어요. ${KEEP}`,
  drive_failed:`Drive에서 소리를 읽지 못했어요. ${KEEP} ${AGAIN}`,
  drive_not_connected:'Google Drive 연결이 끊겼어요. 자료실에서 Drive를 연결한 뒤 [다시]를 누르세요.',
  usage_unavailable:`이번 달 사용량을 확인하지 못했어요. ${AGAIN}`,
  // REC-한회의로잇기(PR-2): 잇기·합치기 작업이 멈춘 이유(Edge meeting-transcribe join_*). 어느 경우에도 보고는 그대로다. 쓰는 화면은 meeting-join.js(joinFailText).
  report_changed:'그 사이 보고를 수정해서 잇지 않았어요. [다시]를 누르면 수정한 글로 처음부터 이어요.',
  report_gone:'그 보고를 찾지 못했어요. 바뀐 것은 없어요.',
  source_changed:'그 사이 합칠 보고를 수정해서 합치지 않았어요. [다시]를 누르세요.',
  source_gone:'합칠 보고나 녹음을 찾지 못했어요. 바뀐 것은 없어요.',
  already_joined:'이미 다른 보고에 들어간 녹음이에요.',
  no_first_transcript:'회의록 전문이 없는 보고에는 이어 붙일 수 없어요.',
  bad_target:'[회의] 보고에만 이어 붙일 수 있어요.',
  not_applied:'되돌릴 내용을 찾지 못했어요.',
  text_too_long:'글이 너무 길어 이어 붙일 수 없어요.',
};
// REC-정리상태확인못함(S60-3): 정리 입구(job_start·job_retry·job_read)가 요청을 거절한 이유 → 띠 글. 작업 행의 실패 코드(위 표)와
// 뜻이 다른 것만 따로 둔다(busy는 요청에서는 '다른 정리가 도는 중', not_found는 '작업 없음'). 나머지 코드는 위 표 글 그대로.
const REQUEST_FAIL_TEXT={
  busy:'다른 녹음을 정리하는 중이에요. 그 정리가 끝난 뒤 [다시]를 누르세요.',
  not_found:'정리 작업을 찾지 못했어요. 삭제한 녹음일 수 있어요.',
  forbidden:'이 녹음 정리를 볼 권한이 없어요. 다시 로그인해 주세요.',
  session_required:'로그인이 만료됐어요. 다시 로그인한 뒤 [다시]를 눌러 주세요.',
  daily_limit:'오늘의 AI 사용 한도에 닿았어요. 내일 [다시]를 누르세요.',
};
// 진짜 잠깐 끊김(연결 끊김·시간 초과·서버 앞단 502·503·504·546에 정해진 서버 글 없음): 서버는 계속 정리 중일 수 있다.
export const OFFLINE_TEXT='연결이 끊겨 정리 상태를 확인하지 못했어요. 연결되면 저절로 다시 확인해요.';
// 시작(job_start)의 답을 못 받음: 서버가 받았는지 모른다 — 저절로 다시 하지 않고(같은 녹음을 두 번 정리할 수 있음) 사람이 [다시].
export const OFFLINE_START_TEXT='연결이 끊겨 정리를 맡겼는지 확인하지 못했어요. 소리는 Drive에 남아 있어요. [다시]를 누르세요.';
// 정리는 끝났는데 결과(초안)를 화면에 열지 못함 — 상태 확인 실패와 다른 일. 띠는 '정리 끝 [초안 열기]'로 남는다.
export const OPEN_FAIL_TEXT='정리는 끝났는데 초안을 열지 못했어요. [초안 열기]를 다시 누르세요.';
const GATE_STATUS=[0,502,503,504,546];
/**
 * 정리 입구 요청이 실패한 오류 → {code, text, retry, auto}.
 * - auto: 잠깐 끊김. 화면이 다시 보이거나 연결이 돌아오면 저절로 다시 확인한다(부른 쪽).
 * - 서버가 이유(code)를 줬으면 그 이유 글. 표에 없는 이유는 'HTTP 상태'를 붙여 사실대로.
 */
export function requestFail(e){
  const code=serverErrorCode(e),status=Number(e?.status)||0,msg=String(e?.message||'').trim();
  const known=Object.values(SERVER_TEXT).includes(msg);
  if(code==='timeout'||code==='network_error'||(!known&&GATE_STATUS.includes(status)&&!['session_required','forbidden'].includes(code)))
    return {code:code==='timeout'?'timeout':'network_error',text:OFFLINE_TEXT,retry:true,auto:true};
  const text=REQUEST_FAIL_TEXT[code]||FAIL_TEXT[code]||`서버가 정리 요청을 처리하지 못했어요(${status?`HTTP ${status}`:code}). ${KEEP} [다시]를 누르세요.`;
  return {code,text,retry:!['not_found','forbidden'].includes(code)&&canRetry(code),auto:false};
}
// 실패 코드 → 띠 글(두 줄까지). 위 표에 없는 이유(서버 안 오류 등)만 일반 문구 + 소리는 남아 있음.
export function failText(code){
  return FAIL_TEXT[code]||`서버에서 정리하다 멈췄어요. ${KEEP} [다시]를 누르세요.`;
}
// REC-한회의로잇기 PR-3: 잇기·합치기(join_*)가 멈추거나 시작하지 못한 이유 → 알림 줄·작은 알림 글. 녹음 정리와 뜻이 다른 코드만 따로 두고
// (같은 코드라도 잇기에서는 '소리는 Drive에…'·'정리가…'가 맞지 않음), 나머지(요약 실패·한도 등)는 위 표 그대로. 어느 경우에도 보고는 그대로다.
const JOIN_FAIL_TEXT={
  busy:'그 보고는 지금 잇는 중이에요. 끝난 뒤 다시 해 주세요.',
  not_found:'그 보고나 녹음을 찾지 못했어요. 바뀐 것은 없어요.',
  not_done:'녹음 정리가 아직 끝나지 않았어요.',
  empty_transcript:'녹음에서 글을 찾지 못해 잇지 않았어요.',
  interrupted:'잇다가 중간에 끊겼어요. 보고는 그대로예요. [다시]를 누르세요.',
  too_many_steps:'잇기가 너무 오래 걸려 멈췄어요. 보고는 그대로예요. [다시]를 누르세요.',
  draft_failed:'전체 글로 요약을 다시 만들지 못했어요. 보고는 그대로예요. [다시]를 누르세요.',
  // REC-정리상태확인못함(S60-3): 답을 못 받음 — 서버가 받았는지 모르므로 '보고는 그대로'라고 하지 않는다.
  network_error:'연결이 끊겨 잇기를 확인하지 못했어요. 잠시 뒤 그 보고를 열어 확인해 주세요.',
  timeout:'연결이 끊겨 잇기를 확인하지 못했어요. 잠시 뒤 그 보고를 열어 확인해 주세요.',
};
export function joinFailText(code){
  return JOIN_FAIL_TEXT[code]||FAIL_TEXT[code]||'잇다가 멈췄어요. 보고는 그대로예요. [다시]를 누르세요.';
}
// 공용 요청(runtime api)은 실패 답의 code를 넘기지 않고 status('http_429')와 서버 글(error)만 남긴다. 서버 글은 code마다 정해진 글
// (Edge meeting-transcribe model.mjs MESSAGES)이라 그 글로 code를 되찾는다. 시험(tests/meeting-join-model.test.mjs·meeting-server-job.test.mjs)이 서버 표와 글자 그대로 맞춰 본다.
// REC-정리상태확인못함(S60-3): 녹음 정리 입구(job_start·job_retry·job_read)도 이 표로 code를 되찾는다 — 전에는 잇기 입구 글만 있어
// 한도(429 monthly_limit) 거절이 '정리 상태를 확인하지 못했어요'로 뭉개졌다. 서버 MESSAGES에 코드를 더하면 여기에도 더한다(시험이 빠짐을 잡는다).
export const SERVER_TEXT=Object.freeze({
  not_ready:'녹음 전사는 준비 중이에요.',
  monthly_limit:'이번 달 녹음 전사 한도에 닿았어요.',
  busy:'다른 녹음을 전사하는 중이에요. 끝난 뒤 다시 눌러 주세요.',
  too_large:'녹음 파일은 100MB까지 전사할 수 있어요.',
  too_long:'녹음은 1시간까지 전사할 수 있어요.',
  bad_type:'녹음 파일(m4a·mp3·wav 등)만 전사할 수 있어요.',
  bad_request:'요청을 확인하지 못했어요.',
  not_found:'전사 작업을 찾지 못했어요.',
  not_done:'전사가 끝난 녹음만 붙일 수 있어요.',
  drive_failed:'녹음 파일을 Drive에서 읽거나 저장하지 못했어요.',
  drive_not_connected:'Google Drive가 아직 연결되지 않았어요. 자료실에서 Drive를 연결해 주세요.',
  gemini_failed:'전사 서비스(Gemini)가 실패했어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  gemini_upload:'전사 서비스(Gemini)에 녹음을 올리지 못했어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  gemini_timeout:'전사 서비스(Gemini) 응답이 늦어 멈췄어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  gemini_file_failed:'전사 서비스가 녹음 파일 형식을 읽지 못했어요. 녹음은 Drive에 그대로 있어요.',
  gemini_rejected:'전사 서비스가 녹음 파일을 받지 않았어요(파일 형식). 녹음은 Drive에 그대로 있어요.',
  bad_format:'녹음 파일이 깨져 읽지 못했어요(파일 형식). 녹음은 Drive에 그대로 있어요.',
  empty_transcript:'녹음에서 글을 찾지 못했어요.',
  gemini_empty:'전사 서비스(Gemini)가 글 없이 답했어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  gemini_incomplete:'전사 서비스(Gemini)가 녹음 끝까지 글로 옮기지 못했어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  usage_unavailable:'이번 달 사용량을 확인하지 못했어요. 잠시 뒤 다시 눌러 주세요.',
  failed:'처리하지 못했어요. 잠시 뒤 다시 눌러 주세요.',
  step_cut:'한 구간이 서버 시간 안에 끝나지 않아 끊겼어요. 소리는 Drive에 남아 있어요.',
  draft_cut:'회의가 길어 요약이 중간에 잘렸어요. 전사한 글은 남아 있어요.',
  draft_failed:'전사는 끝났는데 요약을 만들지 못했어요. [다시]를 누르세요.',
  daily_limit:'오늘의 AI 사용 한도에 닿아 요약을 만들지 못했어요. 전사 전문은 남아 있어요.',
  jobs_unavailable:'서버 정리를 아직 쓸 수 없어요.',
  too_many_steps:'정리가 너무 오래 걸려 멈췄어요. [다시]를 누르세요.',
  draft_timeout:'요약이 오래 걸려 멈췄어요. 전사한 글은 남아 있어요. [다시]를 누르세요.',
  draft_step_cut:'요약이 서버 시간 안에 끝나지 않아 끊겼어요. 전사한 글은 남아 있어요. [다시]를 누르세요.',
  report_changed:'그 사이 보고를 수정해서 잇지 않았어요. [다시]를 누르면 수정한 글로 처음부터 이어요.',
  report_gone:'그 보고를 찾지 못했어요. 바뀐 것은 없어요.',
  source_changed:'그 사이 합칠 보고를 수정해서 합치지 않았어요. [다시]를 누르세요.',
  source_gone:'합칠 보고나 녹음을 찾지 못했어요. 바뀐 것은 없어요.',
  already_joined:'이미 다른 보고에 들어간 녹음이에요.',
  no_first_transcript:'회의록 전문이 없는 보고에는 이어 붙일 수 없어요.',
  bad_target:'[회의] 보고에만 이어 붙일 수 있어요.',
  not_applied:'되돌릴 내용을 찾지 못했어요.',
  text_too_long:'글이 너무 길어 이어 붙일 수 없어요.',
});
export const JOIN_SERVER_TEXT=SERVER_TEXT;
// 화면이 받은 오류 → 이유 코드. 서버 code(글로 되찾음) · 화면 쪽 이유(session_required·timeout·network_error) · 모름이면 HTTP 상태로.
export function serverErrorCode(e){
  const c=String(e?.code||'');
  if(c&&!/^http_\d+$/.test(c)&&c!=='request_failed')return c; // session_required·timeout·network_error 등 화면 쪽 이유
  const msg=String(e?.message||'').trim();
  for(const [code,text] of Object.entries(SERVER_TEXT))if(text===msg)return code;
  const s=Number(e?.status)||0;
  if(s===401)return 'session_required';
  if(s===403)return 'forbidden';
  return s===503?'jobs_unavailable':s===400?'bad_request':s===0&&!c?'network_error':'failed';
}
export const joinErrorCode=serverErrorCode;
// 이 서버가 잇기를 모름: 표·함수 적용 전(503 jobs_unavailable) 또는 옛 Edge(모르는 action = 400 bad_request). 화면은 묻지 않고 지금 길로 간다.
export const joinUnknown=e=>['jobs_unavailable','bad_request'].includes(joinErrorCode(e));
// 되돌리기(join_undo)가 거절된 이유 → 작은 알림 글(3-5절).
const UNDO_FAIL_TEXT={
  report_changed:'이은 뒤 보고를 수정했거나 그 뒤에 또 이어서, 통째로는 되돌릴 수 없어요. 회의 결과 글은 보고에서 [합치기 전 글로 되돌리기]로 되돌릴 수 있어요.',
  source_gone:'뒤에 한 잇기·합치기부터 되돌려 주세요.',
  report_gone:'그 보고를 찾지 못했어요. 바뀐 것은 없어요.',
  not_applied:'되돌릴 내용을 찾지 못했어요.',
};
export const undoFailText=code=>UNDO_FAIL_TEXT[code]||'되돌리지 못했어요. 바뀐 것은 없어요. 잠시 뒤 다시 해 주세요.';
// 잇기 [다시]가 뜻이 있는 실패인가. 찾지 못함·이미 다른 보고에 들어감·전문 없음·칸 다름·글 너무 김은 다시 해도 같다.
export const joinCanRetry=code=>!['report_gone','source_gone','already_joined','no_first_transcript','bad_target','not_found','text_too_long','not_applied'].includes(code);
// 다시 눌러서 될 수 있는 실패인가. REC-글못찾음: empty_transcript도 [다시]를 둔다 — 11/11 전엔 전사 서비스의 빈 답도 이 코드였고
// (같은 41분 구간이 한 번은 실패, 한 번은 빈 답), 구간 없음·말 없음이면 [다시]가 전사를 다시 부르지 않고 바로 같은 이유로 멈춘다.
export const canRetry=code=>!['not_found','bad_type','too_large','too_long'].includes(code);

/**
 * 서버 정리 하나를 끝까지 지켜본다. 시작(start) 또는 이어 보기(jobId).
 * deps: {call(action,body,extra)→Promise, sleep(ms)→Promise, hidden()→bool, onProgress(job), alive()→bool}
 * 돌려줌: {kind:'done', job} | {kind:'failed', job} | {kind:'unavailable'} | {kind:'gone'}(부른 쪽이 그만둠)
 */
export async function watchServerJob(deps,{start=null,jobId='',retry=false}={}){
  const sleep=deps.sleep||(ms=>new Promise(r=>setTimeout(r,ms)));
  const alive=deps.alive||(()=>true);
  let job=null;
  try{
    if(start)job=(await deps.call('job_start',start,{timeoutMs:60000}))?.job;
    else if(retry)job=(await deps.call('job_retry',{job_id:jobId},{timeoutMs:60000}))?.job;
  }catch(e){
    if(start&&unavailable(e))return {kind:'unavailable'};
    throw e;
  }
  // 시작했는데 작업이 없다 = 서버 정리를 모르는 서버(옛 판이 모르는 action에 {ok:true}만 준 경우 등).
  if(start&&!job?.id)return {kind:'unavailable'};
  const id=job?.id||jobId;
  if(!id)throw new Error('');
  let misses=0;
  for(;;){
    if(!alive())return {kind:'gone',job};
    if(job){
      deps.onProgress?.(job);
      if(job.status==='done'&&job.transcript_text!==undefined)return {kind:'done',job};
      if(job.status==='failed')return {kind:'failed',job};
    }
    await sleep(deps.hidden?.()?POLL_HIDDEN_MS:POLL_MS);
    if(!alive())return {kind:'gone',job};
    try{job=(await deps.call('job_read',{job_id:id},{timeoutMs:30000}))?.job||job;misses=0}
    catch(e){
      // 잠깐 끊김은 다시 본다(서버는 계속 정리 중). 로그인 만료·권한은 그대로 던진다.
      if(e?.code==='session_required'||e?.status===401||e?.status===403||e?.status===404)throw e;
      if(++misses>=60)throw e;
    }
  }
}
