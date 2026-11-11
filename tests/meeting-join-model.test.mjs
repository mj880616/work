// REC-한회의로잇기 PR-3(설계 docs/design/rec-join.md 3-3·3-4·3-5절): 화면의 순수 규칙(app/meeting-join-model.mjs)·잇기 문구 표(app/meeting-server-job.mjs)와
// 화면 연결(물음 자리·띠·보고 상세·두 글 칸 저장 조건)을 글자로 고정한다. 화면 동작은 tests/app-e2e/rec-join-ask.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as jm from '../app/meeting-join-model.mjs';
import {joinFailText,joinCanRetry,joinErrorCode,joinUnknown,undoFailText,JOIN_SERVER_TEXT,failText} from '../app/meeting-server-job.mjs';
import {MESSAGES,STATUS} from '../supabase/functions/meeting-transcribe/model.mjs';
import * as edge from '../supabase/functions/meeting-transcribe/join-job.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const M=n=>`00000000-0000-4000-8000-0000000000c${n}`;

test('서울 시각: 시간대 없는 일시는 서울로, 같은 날이면 시:분만', ()=>{
  assert.equal(jm.atMs('2026-11-11T10:02'),Date.parse('2026-11-11T01:02:00Z'));
  assert.equal(jm.atMs('2026-11-11T01:02:00+00:00'),Date.parse('2026-11-11T01:02:00Z'));
  assert.ok(Number.isNaN(jm.atMs('어제')));
  const day=Date.parse('2026-11-11T03:00:00Z');
  assert.equal(jm.whenText(Date.parse('2026-11-11T01:02:00Z'),day),'10:02');
  assert.equal(jm.whenText(Date.parse('2026-11-04T01:00:00Z'),day),'11.4. 10:00');
  assert.equal(jm.seoulDayKey(Date.parse('2026-11-10T15:30:00Z')),'2026-11-11','서울 자정 넘김');
});

test('이은 줄 알아보기: Edge가 만드는 줄(시각 있음·없음)만, 보통 글은 아님', ()=>{
  const merged=edge.joinTranscripts({targetText:'첫 녹음',targetAt:Date.parse('2026-11-11T01:00:00Z'),sourceText:'둘째 녹음',sourceAt:Date.parse('2026-11-11T02:05:00Z')});
  assert.equal(jm.hasJoinMark(merged),true);
  assert.equal(jm.hasJoinMark(`가\n\n${edge.joinMark(null)}\n나`),true);
  assert.equal(jm.hasJoinMark('― 60분부터 ―\n글'),false,'구간 구분 줄은 잇기 줄이 아님');
  assert.equal(jm.hasJoinMark('이어서 회의'),false);
  assert.equal(jm.hasJoinMark(null),false);
});

test('보고 이름·물음 글: 회의명(+차수), 오늘이면 "오늘", 녹음 길이', ()=>{
  assert.equal(jm.reportName({series_name:'예시 집행위',round_no:8}),'예시 집행위 8차');
  assert.equal(jm.reportName({title:'간담회'}),'간담회');
  assert.equal(jm.reportName({}),'사업 보고');
  assert.equal(jm.minutesText(2280),'녹음 38분');assert.equal(jm.minutesText(0),'');assert.equal(jm.minutesText(20),'녹음 1분');
  const now=Date.parse('2026-11-11T05:00:00Z');
  assert.equal(jm.askText(Date.parse('2026-11-11T02:00:00Z'),now),'오늘 녹음으로 쓴 보고가 있어요. 같은 회의인가요?');
  assert.equal(jm.askText(Date.parse('2026-11-10T02:00:00Z'),now),'11월 10일 녹음으로 쓴 보고가 있어요. 같은 회의인가요?');
  const c={id:M(1),seconds:2280,meeting:{id:M(1),series_name:'예시 집행위',meeting_at:'2026-11-11T01:02:00Z'}};
  assert.equal(jm.whoText(c,Date.parse('2026-11-11T02:05:00Z')),'10:02 예시 집행위 · 녹음 38분','시안 ①');
});

test('후보: 로그인으로 읽은 [회의] 보고만(남의 것·다른 칸·없는 것은 빠짐), 가장 가까운 앞 보고를 먼저', ()=>{
  const list=[{meeting_id:M(1),seconds:600},{meeting_id:M(2),seconds:0},{meeting_id:M(3),seconds:300},{meeting_id:M(4),seconds:1}];
  const rows=[{id:M(1),series_name:'아침',meeting_at:'2026-11-11T00:00:00Z'},{id:M(2),series_name:'점심',meeting_at:'2026-11-11T03:00:00Z',activity_kind:'meeting'},
    {id:M(3),series_name:'행사',meeting_at:'2026-11-11T01:00:00Z',activity_kind:'event'}];
  const c=jm.mergeCandidates(list,rows);
  assert.deepEqual(c.map(x=>x.id),[M(1),M(2)]);
  assert.equal(jm.nearest(c,Date.parse('2026-11-11T04:00:00Z')).id,M(2),'녹음 시작 전 가장 늦은 보고');
  assert.equal(jm.nearest(c,Date.parse('2026-11-11T01:00:00Z')).id,M(1));
  assert.equal(jm.nearest(c,Date.parse('2026-11-10T23:00:00Z')).id,M(1),'모두 뒤면 가장 이른 것');
  assert.equal(jm.nearest([],0),null);
});

test('[다른 보고 선택] 줄: 같은 날 후보(가까운 순) 다음에 내 목록의 다른 [회의] 보고(최근 순, 한도까지)', ()=>{
  const day=Date.parse('2026-11-11T05:00:00Z');
  const c=jm.mergeCandidates([{meeting_id:M(1),seconds:600},{meeting_id:M(2),seconds:0}],[{id:M(1),series_name:'아침',meeting_at:'2026-11-11T00:00:00Z'},{id:M(2),series_name:'점심',meeting_at:'2026-11-11T04:30:00Z'}]);
  const others=[{id:M(1),series_name:'아침',meeting_at:'2026-11-11T00:00:00Z'},{id:M(5),series_name:'지난주',meeting_at:'2026-11-04T01:00:00Z'},
    {id:M(6),series_name:'행사',meeting_at:'2026-11-09T01:00:00Z',activity_kind:'event'},{id:M(7),series_name:'어제',meeting_at:'2026-11-10T01:00:00Z'}];
  const rows=jm.pickRows(c,others,{startMs:day,dayMs:day});
  assert.deepEqual(rows.map(r=>r.value),[M(2),M(1),M(7),M(5)]);
  assert.equal(rows[1].note,'09:00 · 녹음 10분');
  assert.equal(rows[2].note,'11.10. 10:00');
  assert.equal(jm.pickRows(c,others,{startMs:day,dayMs:day,limit:1}).length,3);
});

test('알림 줄: 진행 중 → 잇는 중, 끝·멈춤은 닫기 전까지, 통째로 되돌린 것은 줄 없음', ()=>{
  assert.equal(jm.lineState({id:'a',status:'queued'}),'running');
  assert.equal(jm.lineState({id:'a',status:'running',seen_at:'x'}),'running','진행 중은 닫히지 않음');
  assert.equal(jm.lineState({id:'a',status:'done'}),'done');
  assert.equal(jm.lineState({id:'a',status:'done',seen_at:'x'}),'');
  assert.equal(jm.lineState({id:'a',status:'failed'}),'failed');
  assert.equal(jm.lineState({id:'a',status:'undone'}),'');
  assert.equal(jm.progressText('예시 집행위',{stage:'summary',step_no:1,step_total:4}),'예시 집행위에 잇는 중 · 전체 다시 요약 2/4 · 화면을 옮겨도 계속돼요','시안 ②');
  assert.equal(jm.progressText('가',{stage:'apply'}),'가에 잇는 중 · 전체 다시 요약 · 화면을 옮겨도 계속돼요');
  assert.equal(jm.doneText('예시 집행위',{mode:'job'}),'예시 집행위 보고에 이어 붙였어요');
  assert.equal(jm.doneText('가',{mode:'report'}),'가 보고에 합쳤어요');
});

test('보고 상세 되돌리기 버튼: 이은 글이면 합치기 전으로, 합치기 전 글이면 이은 글로, 수정했으면 묻고 합치기 전으로', ()=>{
  const job={id:'j',status:'done',applied_at:'t',before_result:'앞 글',result_text:'새 요약'};
  assert.deepEqual(jm.undoChoice('새 요약',job),{scope:'before',edited:false});
  assert.deepEqual(jm.undoChoice('앞 글',job),{scope:'joined',edited:false});
  assert.deepEqual(jm.undoChoice('직접 수정',job),{scope:'before',edited:true});
  assert.deepEqual(jm.undoChoice('',{...job,before_result:null}),{scope:'joined',edited:false},'앞 글이 비어 있던 보고');
  assert.equal(jm.undoChoice('새 요약',{...job,before_result:'새 요약'}),null,'두 원본이 같으면 버튼 없음');
  assert.equal(jm.undoChoice('새 요약',{...job,undone_at:'t'}),null);
  assert.equal(jm.undoChoice('새 요약',null),null);
  assert.equal(jm.UNDO_LABEL.before,'합치기 전 글로 되돌리기');
  assert.equal(jm.UNDO_LABEL.joined,'이은 글로 다시');
});

test('새 할 일 후보: 요약의 할 일 가운데 이미 붙은 할 일·같은 제목 두 번은 뺀다(저절로 만들지 않음 — 후보 줄만)', ()=>{
  const draft={decisions:'',information:'',actions:[{task:'자료 돌리기',assignee:'박간사',due:'2026-11-13'},{task:'회의실 잡기',due:''},{task:'회의실  잡기!'},'예산 확인']};
  assert.deepEqual(jm.candidateItems(draft,['자료 돌리기 (박간사)']),[{title:'회의실 잡기',due:''},{title:'예산 확인',due:''}]);
  assert.deepEqual(jm.candidateItems(null,[]),[]);
  assert.deepEqual(jm.candidateItems({actions:[]},[]),[]);
});

test('잇기 지켜보기: 끝·멈춤·되돌림에서 멈추고, 잠깐 끊김은 다시 보며, 없음·권한은 그대로 던진다', async()=>{
  const sleep=async()=>{};
  const seq=[{id:'j',status:'running',stage:'summary'},{id:'j',status:'done',stage:'done'}];
  const seen=[];let n=0;
  const r=await jm.watchJoin({sleep,call:async(a,b)=>{assert.equal(a,'join_read');assert.deepEqual(b,{job_id:'j'});if(n===0){n++;const e=new Error('');e.status=503;throw e}return {job:seq.shift()}},onProgress:j=>seen.push(j.status)},{job:{id:'j',status:'queued'}});
  assert.equal(r.kind,'done');assert.deepEqual(seen,['queued','queued','running','done'],'끊긴 한 번은 앞 상태 그대로 다시 그림');
  assert.equal((await jm.watchJoin({sleep,call:async()=>({job:{id:'j',status:'failed',error_code:'report_changed'}})},{jobId:'j'})).kind,'failed');
  assert.equal((await jm.watchJoin({sleep,call:async()=>({job:{id:'j',status:'undone'}})},{jobId:'j'})).kind,'undone');
  let alive=true;
  assert.equal((await jm.watchJoin({sleep:async()=>{alive=false},alive:()=>alive,call:async()=>({job:{id:'j',status:'running'}})},{jobId:'j'})).kind,'gone');
  await assert.rejects(jm.watchJoin({sleep,call:async()=>{const e=new Error('');e.status=404;throw e}},{jobId:'j'}));
});

test('두 글 칸 저장 조건: 읽은 updated_at 그대로일 때만(값 없으면 조건 없음)', ()=>{
  assert.equal(jm.sameVersionFilter('2026-11-11T01:02:03.456789+00:00'),'&updated_at=eq.2026-11-11T01%3A02%3A03.456789%2B00%3A00');
  assert.equal(jm.sameVersionFilter(null),'&updated_at=is.null');
  assert.equal(jm.sameVersionFilter(undefined),'');
});

test('잇기 문구 표: 서버 글로 실패 코드를 되찾고(서버 표와 글자 그대로), 모름은 지금 길, 이유마다 일상어', ()=>{
  for(const [code,text] of Object.entries(JOIN_SERVER_TEXT))assert.equal(text,MESSAGES[code],`${code}: Edge model.mjs MESSAGES와 같아야 한다`);
  for(const code of ['report_changed','report_gone','source_changed','source_gone','already_joined','no_first_transcript','bad_target','not_applied','text_too_long','busy'])
    assert.equal(joinErrorCode({status:STATUS[code],code:`http_${STATUS[code]}`,message:MESSAGES[code]}),code,code);
  assert.equal(joinErrorCode({status:401,code:'session_required',message:''}),'session_required');
  assert.equal(joinErrorCode({status:503,code:'http_503',message:'다른 글'}),'jobs_unavailable');
  assert.equal(joinUnknown({status:400,code:'http_400',message:'요청 실패 400'}),true,'옛 Edge: 모르는 action');
  assert.equal(joinUnknown({status:503,code:'http_503',message:MESSAGES.jobs_unavailable}),true,'표 적용 전');
  assert.equal(joinUnknown({status:409,code:'http_409',message:MESSAGES.busy}),false);
  assert.match(joinFailText('busy'),/그 보고는 지금 잇는 중이에요/);
  assert.doesNotMatch(joinFailText('busy'),/전사/,'녹음 정리 글이 아님');
  assert.equal(joinFailText('daily_limit'),failText('daily_limit'),'요약 한도 등은 녹음 정리와 같은 글');
  assert.match(joinFailText('__x__'),/보고는 그대로예요/);
  for(const c of ['report_gone','source_gone','already_joined','no_first_transcript','bad_target','not_found'])assert.equal(joinCanRetry(c),false,c);
  for(const c of ['report_changed','source_changed','draft_failed','interrupted','daily_limit'])assert.equal(joinCanRetry(c),true,c);
  assert.match(undoFailText('report_changed'),/통째로는 되돌릴 수 없어요/);
  assert.match(undoFailText('__x__'),/바뀐 것은 없어요/);
});

test('화면 연결: 물음은 정리 결과를 열기 직전 한 곳, 잇기는 id만 보내고, 할 일은 후보로만', ()=>{
  const rec=read('app/meeting-recorder.js'),join=read('app/meeting-join.js'),loader=read('app/loader-v2.js');
  const open=rec.slice(rec.indexOf('async function openServerResult'),rec.indexOf('// 입력 창을 연다.'));
  assert.ok(open.indexOf('KPTUMeetingJoin.ask(job')>0&&open.indexOf('KPTUMeetingJoin.ask(job')<open.indexOf('openEntry(began'),'물음은 openEntry 앞(설계 3-3절)');
  assert.ok(open.indexOf("kind==='attached'")<open.indexOf('KPTUMeetingJoin.ask'),'그 자리 전사(attached)는 이번 PR 밖(PR-5)');
  assert.match(open,/how==='joined'[^\n]*state='idle'/,'잇기를 고르면 띠를 바로 닫는다');
  assert.match(rec,/window\.KPTUMeetingRecorder=\{state:\(\)=>state,mime:MIME,watch,transcribeAttached,ready\}/);
  assert.match(loader,/import\('\.\/meeting-join\.js'\)/);
  // 잇기 요청 몸통: 고른 보고 id + 녹음 결과 id만(작업공간·소유 값은 서버가 로그인으로 정함, 설계 3-7절)
  assert.match(join,/call\('join_start',\{target_meeting_id:String\(targetId\),source:\{job_id:job\.id\}\}/);
  assert.doesNotMatch(join,/workspace_id:/,'join_* 몸통에 작업공간 값을 싣지 않는다');
  // 할 일은 후보로만(MTG-할일자동생성금지와 같은 부품) — Google 할 일을 직접 만들지 않는다
  assert.match(join,/addMeetingCandidates\(target,items/);
  assert.doesNotMatch(join,/google-tasks\?action=create|createGoogleTask|candidateToTask/);
  assert.doesNotMatch(join,/\?v=/);
  // 어느 보고에 이을지는 사람이 고른다: join_start는 물음의 [그 보고에 잇기]·[다른 보고 선택] 뒤에서만
  assert.equal((join.match(/call\('join_start'/g)||[]).length,1);
  assert.ok(join.indexOf("call('join_start'")>join.indexOf('async function start('));
});

test('두 글 칸을 쓰는 저장 길 전수에 "읽었을 때 그대로일 때만" 조건(설계 3-5절)', ()=>{
  const d=read('app/meeting-round-detail.js'),f=read('app/meeting-from-files.js');
  const save=d.slice(d.indexOf('async function mrdSaveEdit('),d.indexOf('function mrdEditConflict('));
  assert.match(save,/method:'PATCH'/);
  assert.match(save,/&select=\*\$\{sameVersionFilter\(e\.base\)\}`,\{method:'PATCH'/,'수정 저장');
  assert.match(save,/!rows\.length&&e\.base!==undefined\)\{a\.state='conflict'/,'0행이면 덮지 않고 묻는다');
  assert.match(d,/base:mrdCurrent\.updated_at\}/,'수정을 시작할 때 읽은 판');
  const append=d.slice(d.indexOf('async function mrdAppendResult('),d.indexOf('// ---- MTG-고치기바로'));
  assert.match(append,/sameVersionFilter\(cur\.updated_at\)/,'보는 중 결과 본문 더하기');
  assert.match(f,/sameVersionFilter\(current\.updated_at\)/,'파일·글로 만들기의 기존 회의 더하기');
  // app_meetings의 transcript_text·notes를 PATCH로 쓰는 곳이 위 셋뿐인지(로더에 없는 옛 workflow-ai-v3.js 제외)
  const writers=[];
  for(const file of ['app/meeting-round-detail.js','app/meeting-from-files.js','app/team.js','app/report-links.js','app/report-kind-sheet.js','app/report-area-tag.js','app/report-calendar-actions.js']){
    const t=read(file);for(const m of t.matchAll(/app_meetings\?[^`]*`,\{method:'PATCH'[^)]*?body:\{([^}]*)\}/g))if(/transcript_text|notes/.test(m[1]))writers.push(file);
  }
  assert.deepEqual(writers.sort(),['app/meeting-from-files.js','app/meeting-round-detail.js']);
  // 보고 상세: 잇기가 끝나면 다시 읽거나(보는 중) 바로 알린다(수정 중)
  assert.match(d,/addEventListener\('kptu:meeting-join-changed'/);
  assert.match(d,/<span id="mrdJoinTools" class="mrd-join-tools" hidden><\/span>/);
});
