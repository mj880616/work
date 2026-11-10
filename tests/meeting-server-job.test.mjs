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

test('REC-정리멈춤반복: 끊긴 단계 알아보기 — 기한 지난 잡기가 남아 있으면 한 번은 다시, 같은 단계에서 또 끊기면 step_cut',()=>{
  const now=Date.parse('2026-11-09T04:30:00Z');
  const past=new Date(now-60000).toISOString(),future=new Date(now+60000).toISOString();
  assert.deepEqual(sj.leaseTake({status:'queued',lease_until:null},now),{ok:true,cut:0},'정상: 앞 단계가 잡기를 비우고 끝남');
  assert.equal(sj.leaseTake({status:'running',lease_until:future},now).ok,false,'다른 실행이 잡고 있음');
  assert.equal(sj.leaseTake({status:'failed',lease_until:null},now).ok,false);
  assert.equal(sj.leaseTake({status:'done',lease_until:null},now).ok,false);
  assert.deepEqual(sj.leaseTake({status:'running',lease_until:past,error_code:null},now),{ok:true,cut:1},'처음 끊김: 한 번 더');
  assert.deepEqual(sj.leaseTake({status:'running',lease_until:past,error_code:'step_cut'},now),{ok:true,cut:sj.MAX_STEP_CUTS},'두 번째 끊김: 실패');
  // 서버 코드에 실제로 쓰였는지(잡기 조건·실패 코드).
  const src=read('supabase/functions/meeting-transcribe/index.ts');
  assert.match(src,/leaseTake\(before, now\.getTime\(\)\)/);
  assert.match(src,/if \(take\.cut >= 2\) throw new Fail\('step_cut'\)/);
  assert.match(src,/q\.eq\('lease_until', before\.lease_until\) : q\.is\('lease_until', null\)/,'읽은 잡기 그대로일 때만 바꿈(동시에 두 번 와도 한 번)');
});

test('REC-정리멈춤반복: 끊긴 앞 실행이 남긴 구간 \'진행 중\'은 넘겨받는다(전엔 15분 안이라 busy로 실패)',()=>{
  const now=Date.parse('2026-11-09T04:30:00Z');
  const ago=ms=>new Date(now-ms).toISOString();
  assert.equal(sj.segmentRun({status:'done'},now),'free');
  assert.equal(sj.segmentRun({status:'running',started_at:ago(30000)},now),'busy','막 시작한 실행은 그대로');
  // 서버 정리는 앞 잡기(9분)가 지난 뒤에만 같은 단계를 다시 잡는다: 그때 남은 '진행 중'은 끊긴 흔적.
  assert.ok(sj.SEGMENT_DEAD_MS<sj.LEASE_MS);
  assert.equal(sj.segmentRun({status:'running',started_at:ago(sj.LEASE_MS)},now),'dead');
  assert.equal(sj.segmentRun({status:'running',started_at:ago(10*60000)},now),'dead','15분이 안 됐어도 넘겨받음');
  assert.equal(sj.segmentRun({status:'running'},now),'dead','시각 모름');
  const src=read('supabase/functions/meeting-transcribe/index.ts');
  const body=src.slice(src.indexOf('async function transcribeSegment('),src.indexOf('async function transcribeFile('));
  assert.match(body,/segmentRun\(job, now\.getTime\(\)\)/);
  assert.doesNotMatch(body,/isStale/,'서버 정리 구간 전사는 15분 기준을 쓰지 않는다');
});

test('REC-정리멈춤반복: 요약 답이 잘리면(draft_cut) 조각을 반으로 나눠 요약하고, 한 조각 회의는 두 반쪽을 합친다',()=>{
  assert.deepEqual(sj.draftResult({status:'completed'}),{code:'',why:'completed'});
  assert.equal(sj.draftResult({status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}).code,'draft_cut');
  assert.equal(sj.draftResult({status:'incomplete',incomplete_details:{reason:'content_filter'}}).code,'draft_failed');
  assert.equal(sj.draftResult({status:'failed'}).code,'draft_failed');
  assert.equal(sj.draftResult(null).code,'draft_failed');
  assert.equal(sj.draftResult({status:'incomplete',incomplete_details:{reason:'비밀 <글>'}}).why,'incomplete:-','로그에는 이유 이름만');
  // 반으로 나누기: 줄바꿈에서, 너무 짧으면 나누지 않음.
  assert.equal(sj.halves('짧은 글'),null);
  const text=Array.from({length:600},(_,i)=>`화자${i%2+1}: ${'나'.repeat(20)} ${i}`).join('\n');
  const [a,b]=sj.halves(text);
  assert.ok(a.length>sj.MIN_HALF_CHARS&&b.length>sj.MIN_HALF_CHARS);
  assert.equal(`${a}\n${b}`,text,'글이 빠지거나 겹치지 않음');
  assert.ok(Math.abs(a.length-b.length)<200);
  assert.ok(sj.halves('가'.repeat(5000)),'줄바꿈이 없어도 가운데에서');
  // 두 반쪽 요약 잇기(합치기 단계 AI가 겹침 정리).
  const d1={decisions:'결정1',information:'정보1',actions:[{task:'일1',assignee:'',due:''}],attendees:['김'],meetingDate:''};
  const d2={decisions:'결정2',information:'',actions:[{task:'일2',assignee:'이',due:'2026-11-10'}],attendees:['김','이'],meetingDate:'2026-11-09'};
  assert.deepEqual(sj.combineDrafts([d1,null,d2]),{decisions:'결정1\n결정2',information:'정보1',actions:[...d1.actions,...d2.actions],attendees:['김','이'],meetingDate:'2026-11-09'});
  assert.equal(sj.combineDrafts([null]),null);
  // 한 조각 회의가 잘려 반쪽 요약 둘을 남겼으면 다음 단계는 합치기.
  assert.equal(sj.summaryPlan('짧은 회의',[d1]).kind,'one');
  const merge=sj.summaryPlan('짧은 회의',[d1,d2]);
  assert.deepEqual([merge.kind,merge.count,merge.total],['merge',2,3]);
  const long=Array.from({length:4000},(_,i)=>`화자${i%3+1}: ${'가'.repeat(15)} ${i}`).join('\n');
  const p=sj.summaryPlan(long,[]);assert.equal(p.count,p.pieces.length);
  const src=read('supabase/functions/meeting-transcribe/index.ts');
  assert.match(src,/const result = draftResult\(d\);/);
  // 한 단계에 AI 요청 한 번(REC-정리멈춤반복-긴구간): 잘리면 반 나눔 표시를 남기고 다음 단계들이 반씩 한다.
  assert.doesNotMatch(src,/async function draftPiece\(/);
  assert.doesNotMatch(src,/serverDraft\(job, h\[[01]\]/);
  assert.match(src,/summary_parts: \[halfMark\(\)\]/);
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
  assert.equal((await watchServerJob({call:async()=>({ok:true}),sleep:async()=>{}},{start:{}})).kind,'unavailable','작업 없이 {ok:true}만 = 모르는 서버');
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

test('REC-정리멈춤반복: 서버가 남길 수 있는 실패 코드는 모두 이유별 띠 글이 있고, 그 밖 문구는 표에 없는 이유에만',async()=>{
  const {MESSAGES}=await import('../supabase/functions/meeting-transcribe/model.mjs');
  const generic=failText('__unknown__');
  assert.match(generic,/서버에서 정리하다 멈췄어요/);
  // 요청 모양·서버 안 오류(작업 행에는 남지 않거나 원인을 모름)만 그 밖 문구를 쓴다.
  const requestOnly=new Set(['bad_request','not_done','failed','jobs_unavailable']);
  for(const code of Object.keys(MESSAGES)){
    if(requestOnly.has(code))continue;
    assert.notEqual(failText(code),generic,`${code} 띠 글 없음`);
  }
  for(const code of ['interrupted','step_cut','draft_cut','gemini_timeout','busy'])assert.notEqual(failText(code),generic,code);
  // 이유가 서로 구분된다: 시간 초과 · 끊김 · 서버 시간 · 요약.
  assert.match(failText('gemini_timeout'),/전사가 오래 걸려 멈췄어요/);
  assert.match(failText('interrupted'),/중간에 끊겼어요/);
  assert.match(failText('busy'),/중간에 끊겼어요/);
  assert.match(failText('step_cut'),/서버 시간 안에 끝나지 않아/);
  assert.match(failText('draft_failed'),/요약을 만들지 못했어요/);
  assert.match(failText('draft_cut'),/요약이 중간에 잘렸어요/);
  // 다시 하면 될 수 있는 이유는 [다시]·소리 남음 안내를 그대로 둔다.
  for(const code of ['gemini_timeout','interrupted','busy','step_cut','gemini_failed','gemini_upload','drive_failed']){
    assert.match(failText(code),/소리는 Drive에 남아 있어요/,code);
    assert.match(failText(code),/\[다시\]/,code);
    assert.equal(canRetry(code),true,code);
  }
  // 띠는 두 줄까지: 글이 너무 길지 않게.
  for(const code of [...Object.keys(MESSAGES),'interrupted','step_cut','draft_cut'])assert.ok(failText(code).length<=70,`${code} ${failText(code).length}자`);
});
