// REC-서버정리 · MTG-첨부녹음전사(S49-2): 서버 정리 작업 규칙(Edge server-job.mjs)·요약 지시문 공용 모듈·화면 지켜보기·DB migration 모양.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as sj from '../supabase/functions/meeting-transcribe/server-job.mjs';
import * as prompt from '../supabase/functions/_shared/meeting-draft-prompt.mjs';
import * as appModel from '../app/meeting-transcript-model.mjs';
import {joinSegmentTexts} from '../app/meeting-recorder-model.mjs';
import {watchServerJob,unavailable,progressNote,failText,canRetry,STAGE_STEP} from '../app/meeting-server-job.mjs';
import {createPhoneRecorder} from '../app/phone-recorder-core.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ID='3f0c8a52-6a1e-4d6b-9b8e-2a6f1c0d9e11',WS='7b1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',SID='0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

test('job_tick 열쇠: 서버 키로 서명, 작업 id·기한에 묶이고 고정 길이 비교',async()=>{
  const now=1_800_000_000_000,exp=now+60000;
  const sig=await sj.tickSign('server-key',ID,exp);
  assert.match(sig,/^[0-9a-f]{64}$/);
  assert.equal(await sj.tickCheck('server-key',{job_id:ID,exp},sig,now),true);
  assert.equal(await sj.tickCheck('other-key',{job_id:ID,exp},sig,now),false,'다른 키');
  assert.equal(await sj.tickCheck('server-key',{job_id:ID,exp:exp+1},sig,now),false,'기한 바꿈');
  assert.equal(await sj.tickCheck('server-key',{job_id:WS,exp},sig,now),false,'다른 작업');
  assert.equal(await sj.tickCheck('server-key',{job_id:ID,exp},sig,exp+1),false,'기한 지남');
  assert.equal(await sj.tickCheck('server-key',{job_id:ID,exp:now+sj.TICK_TTL_MS*3},await sj.tickSign('server-key',ID,now+sj.TICK_TTL_MS*3),now),false,'너무 먼 기한');
  assert.equal(await sj.tickCheck('server-key',{job_id:ID,exp,x:1},sig,now),false,'다른 칸');
  assert.equal(await sj.tickCheck('',{job_id:ID,exp},sig,now),false,'키 없음');
  assert.equal(await sj.tickCheck('server-key',{job_id:ID,exp},null,now),false,'서명 없음');
});

test('시작 몸통: 녹음(session) 또는 회의자료(document)만, 칸이 정확해야 한다',()=>{
  assert.deepEqual(sj.parseStart({workspace_id:WS,kind:'recording',session_id:SID}),{workspaceId:WS,kind:'recording',sessionId:SID});
  assert.deepEqual(sj.parseStart({workspace_id:WS,kind:'attached',document_id:ID}),{workspaceId:WS,kind:'attached',documentId:ID});
  for(const bad of [null,[],{workspace_id:WS,kind:'recording'},{workspace_id:WS,kind:'recording',session_id:SID,extra:1},{workspace_id:'x',kind:'recording',session_id:SID},
    {workspace_id:WS,kind:'attached',document_id:ID,session_id:SID},{workspace_id:WS,kind:'other',session_id:SID}])assert.equal(sj.parseStart(bad),null,JSON.stringify(bad));
});

test('회의자료 소리 파일 판정(B): 소리 형식·이름, Drive id, 100MB',()=>{
  const ok=sj.audioDocument({file_id:'1AbCdEfGhIjKlMn',file_name:'녹음 2026-11-03 1024 구간1.m4a',mime_type:'audio/mp4',file_size:38365*1024},100*1024*1024);
  assert.deepEqual(ok,{ok:true,fileId:'1AbCdEfGhIjKlMn',name:'녹음 2026-11-03 1024 구간1.m4a'});
  assert.equal(sj.audioDocument({file_id:'1AbCdEfGhIjKlMn',file_name:'회의.pdf',mime_type:'application/pdf'},1e9).code,'bad_type');
  assert.equal(sj.audioDocument({file_id:'1AbCdEfGhIjKlMn',file_name:'a.mp3',file_size:2e9},1e8).code,'too_large');
  assert.equal(sj.audioDocument({file_id:'../x',file_name:'a.mp3'},1e8).code,'not_found');
});

test('구간 → 전사할 조각, 글 합치기는 화면 joinSegmentTexts와 같은 머리 줄',()=>{
  const parts=sj.recordingParts([
    {segment_no:2,status:'combined',job_id:WS,duration_sec:1200},{segment_no:1,status:'combined',job_id:ID,duration_sec:3540},
    {segment_no:3,status:'empty'},{segment_no:4,status:'failed',duration_sec:60},
  ]);
  assert.deepEqual(parts.map(p=>[p.no,p.job,p.text]),[[1,ID,null],[2,WS,null],[4,null,'']]);
  assert.equal(sj.partTotal(parts),2);assert.equal(sj.nextPart(parts),0);
  parts[0].text='화자1: 처음';parts[1].text='화자2: 뒤';
  assert.equal(sj.nextPart(parts),-1);assert.equal(sj.doneParts(parts),2);
  assert.equal(sj.joinParts(parts),joinSegmentTexts(parts));
  assert.match(sj.joinParts(parts),/― 59분부터 ―\n화자2: 뒤/);
  assert.equal(sj.hasWords('― 1시간부터 ―'),false);
  assert.equal(sj.cleanText('a  \r\n\n\n\nb\u0000'),'a\n\nb');
});

test('요약 계획: 3만 자까지 한 번, 넘으면 조각마다 + 합치기(화면과 같은 나누기)',()=>{
  assert.deepEqual(sj.summaryPlan('짧은 회의',[]).kind,'one');
  const long=Array.from({length:4000},(_,i)=>`화자${i%3+1}: ${'가'.repeat(15)} ${i}`).join('\n');
  assert.ok(long.length>30000);
  assert.deepEqual(prompt.splitTranscript(long),appModel.splitTranscript(long),'Edge 사본 = 화면 나누기');
  const plan=sj.summaryPlan(long,[]);
  assert.equal(plan.kind,'part');assert.equal(plan.total,plan.pieces.length+1);assert.equal(plan.next,0);
  assert.equal(sj.summaryPlan(long,new Array(plan.pieces.length).fill(null)).kind,'merge');
  const raw={decisions:'1. 집행 확정',information:'- 경과 공유',actions:[{task:'자료 정리',assignee:'[확인 필요]',due:'2026-11-10'}],meeting_date:'2026-11-03',attendees:['김','화자1 [확인 필요]']};
  const a=prompt.normalizeDraft(raw),b=appModel.normalizeDraft({draft:raw});
  assert.deepEqual(a,b,'Edge 정리 = 화면 정리');
  assert.equal(prompt.partsText([a,a]),appModel.partsText([b,b]),'합치기 재료 글이 같다');
  assert.equal(prompt.normalizeDraft({decisions:'',information:'',actions:[],attendees:[]}),null);
});

test('요약 지시문은 한 곳: meeting-ai-draft와 서버 정리가 같은 모듈을 쓴다',()=>{
  const draft=read('supabase/functions/meeting-ai-draft/index.ts'),server=read('supabase/functions/meeting-transcribe/index.ts');
  for(const src of [draft,server]){
    assert.match(src,/from '\.\.\/_shared\/meeting-draft-prompt\.mjs'/);
    assert.match(src,/meetingDraftDeveloper\(AI_TONE_RULE\)/);
    assert.match(src,/meetingDraftPrompt\(\{/);assert.match(src,/meetingDraftRequest\(\{/);
    assert.doesNotMatch(src,/회의결과 정리 AI다/,'지시문 원문은 공용 모듈에만');
  }
  assert.match(read('supabase/functions/_shared/meeting-draft-prompt.mjs'),/회의결과 정리 AI다/);
  const req=prompt.meetingDraftRequest({model:'m',maxOutput:9000,headroom:1500,developer:'d',prompt:'p'});
  assert.equal(req.max_output_tokens,3500+1500);assert.equal(req.store,false);assert.equal(req.text.format.strict,true);
});

test('Edge: job_tick은 로그인 확인보다 먼저 가르고 HMAC만 받는다, 작업 표 쓰기는 정한 칸·지우기 없음',()=>{
  const src=read('supabase/functions/meeting-transcribe/index.ts');
  const tick=src.indexOf("if (action === 'job_tick') return await jobTick(req);"),user=src.indexOf('const user = await userOf(req);',src.indexOf('Deno.serve('));
  assert.ok(tick>0&&user>tick,'job_tick 가름이 userOf보다 앞');
  assert.match(src,/tickCheck\(SERVICE, body, req\.headers\.get\(TICK_HEADER\), Date\.now\(\)\)\)\) return json\(\{ ok: false \}, 401\)/);
  assert.match(src,/Authorization: `Bearer \$\{ANON\}`/,'게이트는 anon 열쇠로 지나고 코드가 HMAC 확인');
  assert.doesNotMatch(src,/from\(SERVER_JOB_TABLE\)\.delete/);
  // CORS 허용 머리에 열쇠 머리가 없다(브라우저는 보낼 수 없음).
  assert.doesNotMatch(src.match(/'Access-Control-Allow-Headers': '[^']*'/)[0],/x-meeting-job-tick/);
  // 회의·회의자료는 부른 사람 로그인으로만 읽는다.
  assert.match(src,/userDb\.from\('app_documents'\)\.select\('id,workspace_id,meeting_id,file_id/);
  for(const a of ['job_start','job_read','job_list','job_opened','job_retry'])assert.ok(src.includes(`action === '${a}'`),a);
  // 같은 파일 두 번이면 앞 결과 재사용(AI 비용 없음).
  assert.match(src,/eq\('source_md5', md5\)\.eq\('status', 'done'\)/);
});

test('DB migration: 새 표 1개, owner 읽기만, anon·PUBLIC 없음, service_role 지우기 없음, 짝 파일 5개',()=>{
  const sql=read('supabase/migrations/20261103170000_meeting_server_jobs.sql');
  assert.match(sql,/^begin;/);assert.match(sql.trim(),/commit;$/);
  assert.match(sql,/revoke all on table public\.app_meeting_server_jobs from public, anon, authenticated, service_role;/);
  assert.match(sql,/grant select on table public\.app_meeting_server_jobs to authenticated;/);
  assert.doesNotMatch(sql,/grant[^;]*(delete|truncate)[^;]*app_meeting_server_jobs/i);
  assert.doesNotMatch(sql,/to anon|to public/i);
  assert.match(sql,/for select to authenticated\s+using \(private\.app_is_workspace_owner\(workspace_id\)\)/);
  assert.match(sql,/values \('20261103170000', 'meeting_server_jobs'/);
  for(const ext of ['precheck.sql','snapshot.sql','postcheck.sql','rollback.sql','summary.md'])assert.ok(read(`docs/20261103170000_meeting_server_jobs.${ext}`).length>50,ext);
  // 서버가 쓰는 칸 = 표 칸(이름 틀림 막기)
  for(const col of sj.SERVER_JOB_COLUMNS.split(','))assert.match(sql,new RegExp(`\\n  ${col} `),col);
});

test('화면 지켜보기: 시작 → 진행 → 끝(결과 포함)',async()=>{
  const calls=[],seen=[];
  const answers=[{job:{id:ID,status:'queued',stage:'combine'}},{job:{id:ID,status:'running',stage:'transcribe',parts_done:0,parts_total:2}},
    {job:{id:ID,status:'done',stage:'done',transcript_text:'글',draft:{decisions:'x'}}}];
  const r=await watchServerJob({call:async(a,b)=>{calls.push([a,b]);return answers.shift()},sleep:async()=>{},onProgress:j=>seen.push(j.stage)},{start:{workspace_id:WS,kind:'recording',session_id:SID}});
  assert.equal(r.kind,'done');assert.equal(r.job.transcript_text,'글');
  assert.deepEqual(calls.map(c=>c[0]),['job_start','job_read','job_read']);
  assert.deepEqual(seen,['combine','transcribe','done']);
  assert.equal(progressNote({stage:'transcribe',parts_done:0,parts_total:2}),'1/2');
  assert.equal(STAGE_STEP.summary,'요약');
});
test('화면 지켜보기: 옛 서버(모르는 action)·표 없음이면 화면 정리 길로, 실패는 이유별 글',async()=>{
  const fail=e=>async()=>{throw e};
  assert.equal((await watchServerJob({call:fail({status:400,code:'bad_request'}),sleep:async()=>{}},{start:{}})).kind,'unavailable');
  assert.equal((await watchServerJob({call:fail({status:503,code:'jobs_unavailable'}),sleep:async()=>{}},{start:{}})).kind,'unavailable');
  await assert.rejects(watchServerJob({call:fail({status:429,code:'monthly_limit'}),sleep:async()=>{}},{start:{}}));
  const r=await watchServerJob({call:async()=>({job:{id:ID,status:'failed',error_code:'draft_failed'}}),sleep:async()=>{}},{jobId:ID,retry:true});
  assert.equal(r.kind,'failed');
  assert.match(failText('draft_failed'),/요약을 만들지 못했어요/);assert.equal(canRetry('draft_failed'),true);assert.equal(canRetry('empty_transcript'),false);
  assert.match(failText('gemini_failed'),/소리는 Drive에 남아 있어요/);
  assert.equal(unavailable({status:409,code:'busy'}),false);
});

test('폰 녹음: 서버에 정리를 맡기면 rec_finish·transcribe를 부르지 않고 앱 임시 파일을 지운 뒤 진행 띠를 넘긴다',async()=>{
  const calls=[],sent=[],watched=[];
  const core=createPhoneRecorder({
    send:t=>sent.push(t),workspace:()=>WS,sleep:async()=>{},paint:()=>{},
    call:async(a,b)=>{calls.push(a);if(a==='job_start')return {job:{id:ID,status:'queued',stage:'combine',session_id:b.session_id}};if(a==='rec_pending')return {sessions:[]};return {}},
    watchServer:j=>watched.push(j.id),openDraft:async()=>{throw new Error('화면 정리 길로 가면 안 됨')},
  });
  core.receive(`rec:state:${JSON.stringify({state:'interrupted',session_id:SID,started_at:'2026-11-03T01:24:00Z',elapsed_ms:3000000,queued:0})}`);
  core.resume(SID);
  for(let i=0;i<20&&!watched.length;i++)await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(watched,[ID]);
  assert.ok(calls.includes('job_start'));assert.ok(!calls.includes('rec_finish'));assert.ok(!calls.includes('transcribe'));
  assert.ok(sent.includes('rec:clear'));
  assert.equal(core.view.state,'idle');
});

test('끝 알림은 내 폰 알림 설정을 따른다(회의 요약 끔·조용한 시간)',()=>{
  const at=h=>Date.UTC(2026,10,3,h-9,30); // 서울 h시 30분
  assert.equal(sj.pushDecision(null,at(14)),'send');
  assert.equal(sj.pushDecision(null,at(23)),'held_quiet');
  assert.equal(sj.pushDecision(null,at(6)),'held_quiet');
  assert.equal(sj.pushDecision({kinds:{meeting_done:false}},at(14)),'skipped_off');
  assert.equal(sj.pushDecision({quiet:{from:'12:00',to:'13:00'}},at(12)),'held_quiet');
  assert.equal(sj.pushDecision({quiet:{from:'12:00',to:'13:00'}},at(23)),'send');
});

test('회의자료 소리 파일 ⋯ [전사해서 결과에 넣기](B): 고칠 수 있는 회의의 소리 파일에만, 서버 정리로 맡기고 결과는 그 회의 [수정] 창에',()=>{
  const detail=read('app/meeting-round-detail.js'),rec=read('app/meeting-recorder.js'),cols=read('app/meeting-columns.js');
  assert.match(cols,/export function fileMoreHtml\(d,name=d\?\.file_name\|\|d\?\.title\|\|'파일',extra=''\)/);
  assert.match(detail,/\$\{fileMoreHtml\(d,name,mrdTranscribeItem\(d\)\)\}/);
  assert.match(detail,/!mrdCanEdit\(mrdCurrent\)\|\|!isAudioFile\(/,'고칠 수 있는 회의·소리 파일만');
  assert.match(detail,/data-mrd-transcribe="\$\{mrdEsc\(d\.id\)\}">전사해서 결과에 넣기<\/button>/);
  assert.match(detail,/fillTranscript:mrdFillTranscript/);
  assert.match(detail,/keepTranscript\(notes\.value,full\)/,'이미 쓴 회의록 전문은 지우지 않고 아래에');
  assert.doesNotMatch(detail.slice(detail.indexOf('async function mrdFillTranscript'),detail.indexOf('window.KPTUMeetingRoundDetail=')),/mrdSaveEdit\(/,'자동 저장 없음');
  assert.match(rec,/kind:'attached',document_id:documentId/);
  assert.match(rec,/window\.KPTUMeetingRoundDetail\?\.fillTranscript\?\.\(job\.meeting_id/);
  assert.match(rec,/window\.KPTUMeetingRecorder=\{state:\(\)=>state,mime:MIME,watch,transcribeAttached\}/);
});
