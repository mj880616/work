// REC-서버정리(S49-2, 설계 docs/design/meeting-transcript-server.md 8절): 녹음 정리를 서버 작업으로 돌리고 진행을 지켜보는 순서.
// 노트북 녹음(meeting-recorder.js)·폰 녹음(phone-recorder-core.mjs)·회의자료 그 자리 전사가 같이 쓴다. DOM·네트워크는 부른 쪽이 준다(단위 시험 대상).
// - 서버(Edge meeting-transcribe job_start)가 합치기 → 구간 전사 → 요약을 화면과 상관없이 이어 한다. 화면은 job_read로 진행만 본다.
// - 화면을 닫거나 다른 앱으로 가도 서버는 계속하고, 끝나면 폰 알림 '회의 요약이 준비됐어요'. 다시 열면 job_list로 띠를 이어 그린다.
// - 서버가 아직 이 길을 모르면(옛 Edge·표 적용 전) 'unavailable'을 돌려주고, 부른 쪽은 지금까지의 화면 정리 길로 간다.

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
  monthly_limit:'이번 달 녹음 전사 한도에 닿았어요.',
  too_long:'녹음은 구간마다 1시간까지 전사할 수 있어요.',
  too_large:'녹음 파일은 100MB까지 전사할 수 있어요.',
  bad_type:'녹음 파일(m4a·mp3·wav 등)만 전사할 수 있어요.',
  not_found:'녹음을 찾지 못했어요.',
  not_ready:'녹음 전사는 준비 중이에요.',
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
};
// 실패 코드 → 띠 글(두 줄까지). 위 표에 없는 이유(서버 안 오류 등)만 일반 문구 + 소리는 남아 있음.
export function failText(code){
  return FAIL_TEXT[code]||`서버에서 정리하다 멈췄어요. ${KEEP} [다시]를 누르세요.`;
}
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
