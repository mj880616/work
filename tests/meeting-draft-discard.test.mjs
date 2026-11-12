// REC-초안버리기(S60-20): 정리 끝 띠 [삭제] → 서버 '버림' 표시(job_discard)·되돌리기(job_restore), job_list에서 빠짐, 잇기에서 막음.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as sj from '../supabase/functions/meeting-transcribe/server-job.mjs';
import {DISCARD_ASK,discardDoneText,meetingDoneNotice} from '../app/meeting-server-job.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const done={status:'done',error_code:null,opened_at:null};

test('버림 표시: 끝난 결과에만, error_code 한 칸(새 칸 없음)·열었음과 따로',()=>{
  assert.equal(sj.DISCARDED,'discarded');
  assert.deepEqual(sj.jobDiscardPatch(done),{patch:{error_code:'discarded'}});
  assert.deepEqual(sj.jobDiscardPatch({...done,error_code:'discarded'}),{patch:null},'이미 버림 = 그대로');
  for(const status of ['queued','running'])assert.deepEqual(sj.jobDiscardPatch({status,error_code:null}),{error:'not_done'},status);
  // 멈춘 작업은 REC-멈춤띠계속뜸(S60-26)의 '닫음'(discarded_+이유) — tests/meeting-stop-band-close.test.mjs
  assert.deepEqual(sj.jobDiscardPatch(null),{error:'not_done'});
  assert.equal('opened_at' in sj.jobDiscardPatch(done).patch,false,'열었음은 건드리지 않음');
  assert.equal(sj.isDiscarded({...done,error_code:'discarded'}),true);
  assert.equal(sj.isDiscarded({status:'failed',error_code:'discarded'}),false,'실패 작업의 코드와 섞이지 않음');
  assert.deepEqual(sj.jobRestorePatch({...done,error_code:'discarded'}),{error_code:null});
  assert.equal(sj.jobRestorePatch(done),null);
  assert.equal(sj.jobView({...done,id:'x',parts:[],error_code:'discarded'}).discarded,true);
  assert.equal(sj.jobView({...done,id:'x',parts:[]}).discarded,false);
});

test('Edge: job_discard·job_restore는 소유 확인(ownServerJob) 뒤 그 상태 그대로인 행만, 지우기 없음, job_list에서 뺌',()=>{
  const src=read('supabase/functions/meeting-transcribe/index.ts');
  for(const a of ['job_discard','job_restore'])assert.ok(src.includes(`action === '${a}'`),a);
  const body=name=>{const i=src.indexOf(`async function ${name}(`);return src.slice(i,src.indexOf('\n}\n',i))};
  const d=body('jobDiscard'),r=body('jobRestore');
  assert.match(d,/await ownServerJob\(user\.id, body\.job_id\)/);
  assert.match(r,/await ownServerJob\(user\.id, body\.job_id\)/);
  // 읽은 상태·코드 그대로인 행만(끝난 결과 = done·빈 코드, 멈춤 = failed·그 이유)
  assert.match(d,/\.eq\('id', job\.id\)\.eq\('status', job\.status\)/);
  assert.match(d,/job\.error_code \? q\.eq\('error_code', job\.error_code\) : q\.is\('error_code', null\)/);
  assert.match(r,/\.eq\('id', job\.id\)\.eq\('status', job\.status\)\.eq\('error_code', job\.error_code\)/);
  assert.doesNotMatch(d+r,/delete|opened_at|transcript_text|draft|trash/i,'소리·글·초안·열었음은 그대로');
  const list=body('jobList');
  assert.match(list,/\.or\('error_code\.is\.null,error_code\.neq\.discarded'\)/);
  assert.match(list,/filter\(\(j\) => !isDiscarded\(j\) \|\| j\.status === 'failed'\)/,'버린 초안은 빼고, 닫은 멈춤은 녹음 줄용으로 싣는다');
  assert.match(read('supabase/functions/meeting-transcribe/join-job.mjs'),/job\.error_code === 'discarded'\) throw notFound\(\)/,'버린 결과는 잇지 않음');
  assert.equal(src.includes('discarded_at'),false,'새 칸 없음(DB 변경 없음)');
});

// S61-5 REC-전사삭제(명진 11/13): 녹음 띠에 '정리 끝 [초안 열기] [삭제]'는 지금은 없다(초안을 만들지 않음). 버림 표시 서버 규칙·글자는 지난 결과용으로 남는다.
test('지금은 없음: 녹음 띠에 [초안 열기]·초안 [삭제]가 없고, 저장 끝 띠는 파일 줄 + [닫기]',()=>{
  const src=read('app/meeting-recorder.js');
  for(const gone of ["state==='ready'",'초안 열기','data-rec="drop"','job_discard','markNoticeOpened'])assert.ok(!src.includes(gone),gone);
  const saved=src.slice(src.indexOf("}else if(state==='saved'){"),src.indexOf("}else if(state==='error'){"));
  assert.match(saved,/savedFilesHtml\(savedFiles,'rec'\)/);
  assert.match(saved,/data-rec="close">닫기/);
  const error=src.slice(src.indexOf("}else if(state==='error'){"),src.indexOf('setText(label,l)'));
  assert.match(error,/data-rec="close">닫기/);
  assert.deepEqual({...DISCARD_ASK},{text:'이 초안을 삭제할까요?',note:'녹음 소리는 Drive에 남아요.',ok:'삭제',cancel:'취소'});
  assert.equal(discardDoneText({seconds:1500}),'25분 녹음 초안을 삭제했어요');
  assert.deepEqual(meetingDoneNotice({finished_at:'2026-11-12T15:30:00Z'}),{kind:'meeting_done',ref_key:'d2026-11-13'},'서울 날짜');
  assert.equal(meetingDoneNotice({}),null);
});
