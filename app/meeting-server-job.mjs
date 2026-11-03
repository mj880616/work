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

const FAIL_TEXT={
  empty_transcript:'녹음에서 글을 찾지 못했어요.',
  draft_failed:'전사는 끝났는데 요약을 만들지 못했어요. [다시]를 누르세요.',
  daily_limit:'오늘의 AI 사용 한도에 닿아 요약을 만들지 못했어요. 내일 [다시]를 누르세요.',
  monthly_limit:'이번 달 녹음 전사 한도에 닿았어요.',
  too_long:'녹음은 구간마다 1시간까지 전사할 수 있어요.',
  too_large:'녹음 파일은 100MB까지 전사할 수 있어요.',
  bad_type:'녹음 파일(m4a·mp3·wav 등)만 전사할 수 있어요.',
  not_found:'녹음을 찾지 못했어요.',
  not_ready:'녹음 전사는 준비 중이에요.',
  too_many_steps:'정리가 너무 오래 걸려 멈췄어요. [다시]를 누르세요.',
};
// 실패 코드 → 띠 글(두 줄까지). 전사 서비스 실패 등 그 밖은 일반 문구 + 소리는 남아 있음.
export function failText(code){
  return FAIL_TEXT[code]||'서버에서 정리하다 멈췄어요. 소리는 Drive에 남아 있어요. [다시]를 누르세요.';
}
// 다시 눌러서 될 수 있는 실패인가.
export const canRetry=code=>!['empty_transcript','not_found','bad_type','too_large','too_long'].includes(code);

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
