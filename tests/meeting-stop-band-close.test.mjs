// REC-멈춤띠계속뜸(S60-26): 멈춤 띠 [닫기] → 서버 '닫음' 표시(job_discard, 'discarded_'+이유) → 다시 열어도·다른 기기·폰에서도 띠에 안 뜸,
// 녹음 줄 [다시]로 살림, 같은 이유로 또 멈추면 닫은 그대로(띠 한 번만). DB 변경 없음(error_code 검사 ^[a-z_]{1,40}$ 안).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as sj from '../supabase/functions/meeting-transcribe/server-job.mjs';
import {stoppedLineText,STOP_CLOSED_TEXT,failText,canRetry} from '../app/meeting-server-job.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const CHECK=/^[a-z_]{1,40}$/; // migration 20261103170000 app_meeting_server_jobs_error_check
const failed=code=>({status:'failed',error_code:code});

test('닫음 표시: 멈춘 이유를 품은 한 칸, DB 검사 안, 되돌리면 이유로',()=>{
  const codes=read('supabase/functions/meeting-transcribe/model.mjs').match(/^\s+([a-z_]+):/gm).map(s=>s.trim().slice(0,-1));
  for(const code of [...new Set([...codes,'daily_limit','monthly_limit','gemini_empty','failed'])]){
    const {patch}=sj.jobDiscardPatch(failed(code));
    assert.match(patch.error_code,CHECK,code);
    assert.equal(patch.error_code,`discarded_${code}`);
    const closed=failed(patch.error_code);
    assert.equal(sj.isDiscarded(closed),true,code);
    assert.equal(sj.failReason(closed),code,'이유 그대로');
    assert.deepEqual(sj.jobRestorePatch(closed),{error_code:code},'되돌리면 멈춘 이유로');
    assert.deepEqual(sj.jobDiscardPatch(closed),{patch:null},'이미 닫음 = 그대로');
  }
  assert.equal(sj.jobDiscardPatch(failed(null)).patch.error_code,'discarded_failed','이유 없으면 일반');
  assert.equal(sj.jobDiscardPatch(failed('x'.repeat(31))).patch.error_code,'discarded_failed','길면 일반(검사 안)');
  assert.equal(sj.isDiscarded(failed('daily_limit')),false);
  assert.equal(sj.isDiscarded({status:'running',error_code:'discarded_daily_limit'}),false,'다시 하는 중은 닫힌 것 아님(띠에 진행 보임)');
  assert.equal(sj.isDiscarded({status:'done',error_code:'discarded_daily_limit'}),false,'초안 버림(done·discarded)과 섞이지 않음');
  const v=sj.jobView({id:'a',status:'failed',error_code:'discarded_daily_limit',parts:[]});
  assert.equal(v.error_code,'daily_limit','화면에는 이유만');
  assert.equal(v.discarded,true);
});

test('같은 작업이 같은 이유로 또 멈추면 닫은 그대로, 다른 이유면 새 멈춤, 끝나면 빈 값',()=>{
  assert.equal(sj.carryClosed('discarded_daily_limit'),'discarded_daily_limit');
  assert.equal(sj.carryClosed('daily_limit'),null);
  assert.equal(sj.carryClosed(null),null);
  assert.equal(sj.failedCode('discarded_daily_limit','daily_limit'),'discarded_daily_limit');
  assert.equal(sj.failedCode('discarded_daily_limit','gemini_empty'),'gemini_empty');
  assert.equal(sj.failedCode(null,'daily_limit'),'daily_limit');
  assert.equal(sj.failedCode('step_cut','step_cut'),'step_cut');
});

test('Edge: 다시·단계·실패가 닫음 표시를 이어 가고, job_list는 닫은 멈춤을 discarded로 싣는다',()=>{
  const src=read('supabase/functions/meeting-transcribe/index.ts');
  const body=name=>{const i=src.indexOf(`async function ${name}(`);return src.slice(i,src.indexOf('\n}\n',i))};
  const retry=body('jobRetry');
  assert.match(retry,/error_code: carryClosed\(job\.error_code\)/);
  assert.match(retry,/SPLIT_CODES\.includes\(failReason\(job\)\)/,'나눠 잇기는 이유로 판단');
  const step=body('runStep');
  assert.match(step,/kind === 'job' \? failedCode\(job\.error_code as string \| null, code\) : code/);
  assert.match(step,/kind === 'job' && next\.status !== 'done' \? carryClosed\(job\.error_code as string \| null\) : null/);
  const discard=body('jobDiscard');
  assert.match(discard,/await ownServerJob\(user\.id, body\.job_id\)/,'소유 확인 그대로');
  assert.doesNotMatch(discard,/delete|trash|transcript_text|draft|opened_at/i,'소리·글은 그대로');
  assert.doesNotMatch(src,/discarded_at|dismissed_at/,'새 칸 없음');
});

test('화면: 멈춤 띠 [닫기] → job_discard·[되돌리기] job_restore, 다시 열 때 닫은 멈춤은 띠 아닌 녹음 줄 [다시]',()=>{
  const src=read('app/meeting-recorder.js');
  assert.match(src,/what==='close'\)\{if\(state==='error'\)void closeStopped\(\);else closeBand\(\)\}/);
  const fn=src.slice(src.indexOf('async function closeStopped('),src.indexOf('function retryStopped('));
  assert.match(fn,/jobId&&!recheck/,'잠깐 끊긴 띠·화면 정리 멈춤은 띠만 닫음');
  assert.match(fn,/call\('job_discard',\{job_id:job\.id\}\)/);
  assert.match(fn,/call\('job_restore',\{job_id:job\.id\}\)/);
  assert.match(fn,/notify\(STOP_CLOSED_TEXT/);
  const load=src.slice(src.indexOf('async function loadServerJobs('),src.indexOf('// 서버가 서버 정리를 아직 모를 때'));
  assert.match(load,/closedStops=jobs\.filter\(j=>j\?\.discarded&&j\.status==='failed'\)/);
  assert.match(load,/jobs=jobs\.filter\(j=>!j\?\.discarded\)/,'닫은 멈춤은 띠 후보에서 뺌');
  const retry=src.slice(src.indexOf('function retryStopped('),src.indexOf('function closeBand('));
  assert.match(retry,/serverFinish\(\{jobId:job\.id,retry:true\}\)/,'같은 job_retry 길');
  assert.match(src,/data-rec-stopped="\$\{escapeText\(stop\.id\)\}">다시<\/button>/);
  assert.match(src,/const st=e\.target\.closest\('\[data-rec-stopped\]'\)/);
});

test('녹음 줄 글·닫은 뒤 알림 글',()=>{
  assert.equal(stoppedLineText({created_at:'2026-11-12T06:34:00Z',seconds:1500,error_code:'daily_limit'}),'멈춘 녹음 정리 · 11/12 15:34 · 25분 · 오늘 AI 한도');
  assert.equal(stoppedLineText({created_at:'2026-11-12T15:10:00Z',seconds:20,error_code:'gemini_empty'}),'멈춘 녹음 정리 · 11/13 00:10','서울 날짜, 1분 안쪽·짧은 이유 없음은 뺌');
  assert.equal(stoppedLineText({}),'멈춘 녹음 정리');
  assert.match(STOP_CLOSED_TEXT,/녹음 줄에서 \[다시\]/);
  assert.match(failText('daily_limit'),/한도/);
  assert.equal(canRetry('daily_limit'),true);
});
