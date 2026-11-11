import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as m from '../../supabase/functions/meeting-transcribe/model.mjs';
import * as rec from '../../supabase/functions/meeting-transcribe/recording.mjs';

// MTG-녹음초안 2단계 Edge meeting-transcribe: 순수 규칙 + 코드 모양(소유자·저장 안 함·verify_jwt 표).
const index=readFileSync('supabase/functions/meeting-transcribe/index.ts','utf8');

test('upload headers: audio only, 100MB, 1 hour, safe file name',()=>{
 const ok=m.parseUpload({name:encodeURIComponent('음성 261029_101500.m4a'),length:'1234',type:'audio/x-m4a',seconds:'1800.4'});
 assert.deepEqual(ok,{fileName:'음성 261029_101500.m4a',mime:'audio/x-m4a',size:1234,duration:1801});
 assert.equal(m.parseUpload({name:'a.m4a',length:'10',type:'',seconds:null}).mime,'audio/mp4');
 assert.equal(m.parseUpload({name:'a.mp3',length:'10',type:'application/octet-stream'}).mime,'audio/mpeg');
 assert.equal(m.parseUpload({name:'a%2F..%2Fb.wav',length:'10'}).fileName,'a .. b.wav');
 const code=f=>{try{f();return 'ok'}catch(e){return e.code}};
 assert.equal(code(()=>m.parseUpload({name:'a.txt',length:'10'})),'bad_type');
 assert.equal(code(()=>m.parseUpload({name:'a.m4a',length:String(m.MAX_BYTES+1)})),'too_large');
 assert.equal(code(()=>m.parseUpload({name:'a.m4a',length:'0'})),'bad_request');
 assert.equal(code(()=>m.parseUpload({name:'a.m4a',length:'10',seconds:'3601'})),'too_long');
 assert.equal(code(()=>m.parseUpload({name:'a.m4a',length:'10',seconds:'abc'})),'bad_request');
 assert.equal(code(()=>m.parseUpload({name:'%E0%A4%A',length:'10'})),'bad_request');
 assert.equal(m.MAX_BYTES,100*1024*1024);assert.equal(m.MAX_SECONDS,3600);
});

test('request matches the call transcription script: ko-KR verbatim, speaker diarization up to 30 min, store false',()=>{
 const r=m.transcriptionRequest('files/x','audio/mp4',true);
 assert.deepEqual(r,{model:m.TRANSCRIBE_MODEL,input:[{type:'audio',uri:'files/x',mime_type:'audio/mp4'}],generation_config:{transcription_config:{language_codes:['ko-KR'],mode:{type:'verbatim',diarization_mode:'speaker'}}},store:false});
 assert.deepEqual(m.transcriptionRequest('u','audio/mp4',false).generation_config.transcription_config.mode,{type:'verbatim'});
 assert.equal(m.wantsDiarize(1800),true);assert.equal(m.wantsDiarize(1801),false);assert.equal(m.wantsDiarize(null),false);
 // 400이면 화자 구분 없이 한 번 더(통화 전사와 같은 규칙)
 assert.match(index,/if \(diarize && r\.status === 400\) \{[^}]*r = await send\(false\); \}/);
});

test('transcript reading: speaker lines like the call script, plain text fallback, incomplete/empty fail',()=>{
 const words=(...w)=>({status:'completed',output_text:'전체 글',steps:[{type:'model_output',content:[{type:'text',text:'전체 글',annotations:w.map(([speaker,text])=>({type:'word_info',speaker,text}))}]}]});
 assert.deepEqual(m.readTranscript(words(['spk_1','안녕하세요'],['spk_1','.'],['spk_2','네'],['spk_1','시작'])),{text:'화자1: 안녕하세요.\n화자2: 네\n화자1: 시작',speakerSplit:true});
 assert.deepEqual(m.readTranscript(words(['spk_1','혼자'])),{text:'전체 글',speakerSplit:false});
 assert.deepEqual(m.readTranscript({steps:[{content:[{type:'text',text:'  a '},{type:'text',text:'b'}]}]}),{text:'a \nb',speakerSplit:false});
 assert.equal(m.readTranscript({interaction:{output_text:'x'}}).text,'x');
 const code=j=>{try{m.readTranscript(j);return 'ok'}catch(e){return e.code}};
 // REC-글못찾음: 완료 아닌 답·빈 답은 원인별 코드(전엔 모두 gemini_failed / '녹음에 글 없음'과 같은 empty_transcript).
 assert.equal(code({status:'in_progress',output_text:'x'}),'gemini_timeout');
 assert.equal(code({status:'completed',output_text:'  '}),'gemini_empty');
 assert.equal(code(null),'gemini_failed');
});

// REC-글못찾음(S59-2): 11/11 41분 구간이 한 번은 gemini_failed(완료 아닌 답·못 읽은 답, 로그 없음), 한 번은 empty_transcript(완료인데 글 못 찾음).
// 공식 Interactions REST 답 모양(2026-11-11 확인): steps[type model_output].content[type text].text, output_text는 SDK 편의 값,
// status in_progress·requires_action·completed·failed·cancelled·incomplete. 아래 답은 그 모양을 흉내 낸 것(글은 지어냄).
test('REC-글못찾음: long-audio answer shapes — many model_output steps/parts, thought steps, wrapped answers, status by cause',()=>{
 const code=j=>{try{m.readTranscript(j);return 'ok'}catch(e){return e.code}};
 // 긴 소리: 글이 model_output 단계 여러 개·text 조각 여러 개로 온다(output_text 없음) → 모두 잇는다.
 const chunk=i=>({type:'text',text:`구간 ${i} 말`});
 const long={id:'i-1',status:'completed',steps:[
  {type:'thought',summary:[{type:'text',text:'생각'}],signature:'sig'},
  {type:'model_output',content:[chunk(1),chunk(2),chunk(3)]},
  {type:'model_output',content:[chunk(4),{type:'text',text:''},chunk(5)]},
 ],usage:{total_input_tokens:79456,total_output_tokens:9000}};
 assert.deepEqual(m.readTranscript(long),{text:'구간 1 말\n구간 2 말\n구간 3 말\n구간 4 말\n\n구간 5 말',speakerSplit:false});
 // 생각(thought)·입력(user_input) 단계의 글은 전사 글이 아니다.
 assert.equal(code({status:'completed',steps:[{type:'thought',content:[{type:'text',text:'생각만'}]},{type:'user_input',content:[{type:'text',text:'지시'}]}]}),'gemini_empty');
 // 감싼 답(interaction 안에 status·steps)도 같은 규칙.
 assert.equal(m.readTranscript({interaction:{status:'completed',steps:[{type:'model_output',content:[chunk(9)]}]}}).text,'구간 9 말');
 assert.equal(code({interaction:{status:'incomplete',steps:[{type:'model_output',content:[chunk(9)]}]}}),'gemini_incomplete');
 // 완료 아님: 진행 중 = 한 번 요청 안에 안 끝남(늦음), 일부만 = 따로, 나머지 = 전사 서비스 실패. 글이 있어도 일부만인 답은 받지 않는다.
 assert.equal(code({...long,status:'in_progress'}),'gemini_timeout');
 assert.equal(code({...long,status:'incomplete'}),'gemini_incomplete');
 for(const s of ['failed','cancelled','requires_action','done','x'])assert.equal(code({...long,status:s}),'gemini_failed',s);
 // 완료인데 글 없음: 단계 없음 · 빈 text 조각뿐 · 다른 종류 조각뿐 → gemini_empty(소리 탓으로 단정하지 않음, [다시] 가능).
 assert.equal(code({status:'completed',steps:[]}),'gemini_empty');
 assert.equal(code({status:'completed'}),'gemini_empty');
 assert.equal(code({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:' \n '}]}]}),'gemini_empty');
 assert.equal(code({status:'completed',steps:[{type:'model_output',content:[{type:'audio',uri:'x'}]}]}),'gemini_empty');
 assert.equal(code([]),'gemini_failed');assert.equal(code('x'),'gemini_failed');
 // 코드마다 서버 문구·HTTP 상태·화면 갈래(전사 서비스)가 있다.
 for(const c of ['gemini_empty','gemini_incomplete']){assert.ok(m.MESSAGES[c],c);assert.equal(m.STATUS[c],502,c);assert.equal(m.FAIL_KIND[c],'gemini',c);assert.match(m.MESSAGES[c],/녹음은 그대로 있어요/);}
 assert.notEqual(m.MESSAGES.gemini_empty,m.MESSAGES.empty_transcript);assert.notEqual(m.MESSAGES.gemini_incomplete,m.MESSAGES.gemini_failed);
});

test('REC-글못찾음: answer shape log line has names and counts only — never transcript, error text or file address',()=>{
 const secret='비밀회의내용';
 const shape=m.answerShape({id:'i-1',status:'completed',steps:[
  {type:'thought',summary:[{type:'text',text:secret}]},
  {type:'model_output',content:[{type:'text',text:'  ',annotations:[{type:'word_info',text:secret,speaker:'spk_1'},{type:'word_info',text:secret,speaker:'spk_2'}]},{type:'audio',uri:`files/${secret}`}]},
  {type:'Weird-Type',content:[{type:'text',text:secret}]},
 ],errors:[{code:'RESOURCE_EXHAUSTED',message:secret},{code:13,message:secret},{code:secret}],usage:{total_output_tokens:0},[secret]:1});
 assert.doesNotMatch(shape,new RegExp(secret));assert.doesNotMatch(shape,/files\//);
 assert.equal(shape,'status=completed wrap=- keys=?,errors,id,status,steps,usage steps=3(thought:1,model_output:1,?:1) parts=text:1,audio:1 chars=0 blank=1 words=2 speakers=2 output_text=- errors=resource_exhausted:1,13:1,?:1 out_tokens=0');
 assert.match(m.answerShape({interaction:{status:'incomplete',steps:[{type:'model_output',content:[{type:'text',text:'가나다'}]}],usage:{total_output_tokens:32000}}}),/^status=incomplete wrap=interaction keys=status,steps,usage steps=1\(model_output:1\) parts=text:1 chars=3 blank=0 words=0 speakers=0 output_text=- errors=- out_tokens=32000$/);
 assert.equal(m.answerShape({status:'completed',output_text:' 가나 '}).includes('output_text=2'),true);
 assert.equal(m.answerShape({status:'설마'}).startsWith('status=? '),true);
 assert.equal(m.answerShape(null),'type=null');assert.equal(m.answerShape([]),'type=array');assert.equal(m.answerShape('x'),'type=string');
 // 서버는 답을 못 읽으면(완료 아님·글 없음) 이 모양을 한 줄 남긴다. 사용량은 답이 왔으면 쓴 만큼 기록(못 읽은 시도는 실패 머리로, 월 상한 밖).
 assert.match(index,/function readAnswer\(d: unknown\) \{\n\s*try \{ return readTranscript\(d\); \} catch \(e\) \{\n\s*if \(e instanceof Fail\) console\.warn\('meeting-transcribe: gemini answer', e\.code, answerShape\(d\)\);\n\s*throw e;/);
 assert.match(index,/try \{ result = readAnswer\(response\); \} catch \(e\) \{ answerError = e; \}/);
 assert.equal((index.match(/readTranscript\(/g)||[]).length,1,'답 읽기는 readAnswer 한 곳');
 assert.ok(index.indexOf('readUsage(response, job.duration_sec)')<index.indexOf('readAnswer(response)'));
 // 답 몸통을 받다가 기다림 상한이 지나면 늦음, 끊김·JSON 아님은 실패 — 둘 다 상태·길이만 로그(내용 없음).
 const gt=index.slice(index.indexOf('async function geminiTranscribe'),index.indexOf('function readAnswer'));
 assert.match(gt,/try \{ raw = await r\.text\(\); \} catch \(e\) \{/);
 assert.match(gt,/throw new Fail\(late \? 'gemini_timeout' : 'gemini_failed'\)/);
 assert.match(gt,/console\.warn\('meeting-transcribe: gemini answer not json', r\.status, raw\.length\);/);
 assert.doesNotMatch(gt,/console\.warn\([^;]*raw\)/);assert.doesNotMatch(gt,/r\.json\(\)\.catch/);
});

// REC-발언자구분(S58-6): 녹음 구간을 29분으로 줄여 긴 회의도 구간마다 발언자 구분이 켜진다. 글은 모두 지어낸 것.
test('REC-발언자구분: 29-minute recording segments turn diarization on; old 59-minute segments stay plain text',()=>{
 // 구간 길이는 서버가 rec_start 답으로 알려 준다(폰 앱은 이 값을 따른다).
 assert.equal(rec.REC_SEGMENT_SECONDS,29*60);
 assert.match(index,/segment_seconds: REC_SEGMENT_SECONDS/);
 // 구간(넘김이 조각 하나만큼 늦어도)은 발언자 구분 상한 안, 옛 59분 구간·길이 모름은 구분 없이 보낸다(전사는 그대로 됨).
 assert.equal(m.DIARIZE_MAX_SECONDS,30*60);
 for(const s of [1,60,29*60,29*60+rec.REC_PIECE_SECONDS,30*60])assert.equal(m.wantsDiarize(s),true,`${s}초`);
 for(const s of [30*60+1,59*60,3600,0,-1,NaN,Infinity,null,undefined,'1740'])assert.equal(m.wantsDiarize(s),false,`${s}`);
 assert.ok(59*60<=m.MAX_SECONDS);
 // 구분을 켜는 조건은 한 곳뿐이다: 화면 정리(transcribe)·서버 정리(구간·회의자료 파일) 모두 runTranscription 한 길.
 assert.equal((index.match(/wantsDiarize\(/g)||[]).length,1);
 assert.match(index,/geminiTranscribe\(key, file\.uri, file\.mimeType \|\| job\.mime_type, wantsDiarize\(job\.duration_sec \?\? audio\.seconds\)\)/);
 assert.equal((index.match(/await runTranscription\(/g)||[]).length,3);
 // 합친 구간의 길이는 녹음 구간 행의 길이 그대로(조각 머리글 x-duration-sec) — 화면이 보낸 작업공간·소유 값은 쓰지 않는다.
 assert.match(index,/duration_sec: seg\.duration_sec \?\? null/);
});

test('REC-발언자구분: speaker lines are numbered by first appearance; rejected (400) or one-speaker answers are plain text, not a failure',()=>{
 const answer=(text,...w)=>({status:'completed',output_text:text,steps:[{type:'model_output',content:[{type:'text',text,annotations:w.map(([speaker,word])=>({type:'word_info',speaker,text:word}))}]}]});
 // 세 사람: 처음 말한 순서대로 화자1·2·3(서버 표시 이름 spk_7 같은 값은 글에 남지 않는다), 같은 사람이 이어 말하면 한 줄.
 const three=answer('가 나 다 라 마',['spk_7','가'],['spk_7','나'],['spk_2','다'],['spk_9','라'],['spk_7','마'],['spk_7','.']);
 assert.equal(m.speakerLines(three),'화자1: 가 나\n화자2: 다\n화자3: 라\n화자1: 마.');
 assert.deepEqual(m.readTranscript(three),{text:'화자1: 가 나\n화자2: 다\n화자3: 라\n화자1: 마.',speakerSplit:true});
 for(const line of m.readTranscript(three).text.split('\n'))assert.match(line,/^화자[1-9]\d*: \S/);
 assert.doesNotMatch(m.readTranscript(three).text,/spk_/);
 // 한 명뿐·표시 없음(구분을 거절해 구분 없이 다시 받은 답)·빈 낱말: 통글 그대로, 실패 아님.
 assert.equal(m.speakerLines(answer('혼자 말함',['spk_1','혼자'],['spk_1','말함'])),'');
 assert.deepEqual(m.readTranscript(answer('혼자 말함',['spk_1','혼자'],['spk_1','말함'])),{text:'혼자 말함',speakerSplit:false});
 assert.deepEqual(m.readTranscript(answer('구분 없이 받은 글')),{text:'구분 없이 받은 글',speakerSplit:false});
 assert.equal(m.speakerLines({status:'completed',output_text:'x',steps:[{content:[{type:'text',text:'x',annotations:[{type:'word_info',text:'x'},{type:'word_info',speaker:'',text:'y'},{type:'word_info',speaker:'spk_1',text:'  '}]}]}]}),'');
 assert.equal(m.speakerLines(null),'');assert.equal(m.speakerLines({}),'');
 // 거절(400)은 구분 없이 한 번 더 보낸다 — 두 번째 답이 실패일 때만 실패다.
 assert.match(index,/let r = await send\(diarize\);\s*\n[^\n]*\n\s*if \(diarize && r\.status === 400\) \{ await geminiWarn\('transcribe_diarize', r\); r = await send\(false\); \}\s*\n\s*if \(!r\.ok\)/);
 assert.deepEqual(m.transcriptionRequest('u','audio/mp4',false).generation_config.transcription_config.mode,{type:'verbatim'});
 // 인증 경계는 그대로: verify_jwt 표 값·소유자 확인(아래 code shape 시험)에 더해, 구간 길이를 화면 값으로 정하지 않는다.
 assert.doesNotMatch(index,/body\.segment_seconds|body\.diariz/);
});

test('usage: reported tokens, audio modality, fallback estimate from duration; month sum only mtg- rows; limit',()=>{
 assert.deepEqual(m.readUsage({model:'models/gemini-3.5-transcribe',usage:{total_input_tokens:1000,total_output_tokens:300,total_thought_tokens:20,input_tokens_by_modality:[{modality:'AUDIO',tokens:900}]}},60),
  {model:'gemini-3.5-transcribe',calls:1,input_tokens:1000,audio_tokens:900,output_tokens:320});
 assert.deepEqual(m.readUsage({},100),{model:m.TRANSCRIBE_MODEL,calls:1,input_tokens:3200,audio_tokens:3200,output_tokens:0});
 const ref=m.usageRef('11111111-2222-4333-8444-555555555555',new Date(Date.UTC(2026,9,29)));
 assert.match(ref,/^mtg-11111111-2222-4333-8444-555555555555-[0-9a-z]+$/);assert.match(ref,/^[A-Za-z0-9_.:-]{8,80}$/);
 const krw=m.monthKrw([{ref:'mtg-a',model:'gemini-2.5-flash',input_tokens:1_000_000,audio_tokens:1_000_000,output_tokens:0},{ref:'call-1',model:'gemini-2.5-flash',input_tokens:9_000_000,audio_tokens:0,output_tokens:0}]);
 assert.equal(krw,1400);
 assert.equal(m.overLimit(14999),false);assert.equal(m.overLimit(15000),true);assert.equal(m.MONTHLY_LIMIT_KRW,15000);assert.equal(m.overLimit(NaN),true);
 assert.equal(m.seoulDay(new Date('2026-10-28T15:30:00Z')),'2026-10-29');assert.equal(m.monthStart(new Date('2026-10-31T15:30:00Z')),'2026-11-01');
});

test('job states: retry after failure, stale running, 30-day trash line, attach row is a private link',()=>{
 const now=new Date('2026-10-29T00:00:00Z');
 assert.equal(m.canStart({status:'uploaded'},now),true);assert.equal(m.canStart({status:'failed'},now),true);
 assert.equal(m.canStart({status:'done'},now),false);
 assert.equal(m.canStart({status:'running',started_at:'2026-10-28T23:50:00Z'},now),false);
 assert.equal(m.canStart({status:'running',started_at:'2026-10-28T23:40:00Z'},now),true);
 assert.equal(m.trashBefore(now),'2026-09-29T00:00:00.000Z');
 const doc=m.attachDocument({job:{file_name:'음성 1.m4a',drive_file_id:'abcdefghij12',mime_type:'audio/mp4',size_bytes:5},meeting:{id:'m',workspace_id:'w',project_id:null},userId:'u'});
 assert.equal(doc.visibility,'private');assert.equal(doc.meeting_id,'m');assert.equal(doc.title,'음성 1');assert.equal(doc.category,'회의자료');
 assert.equal(doc.drive_url,'https://drive.google.com/file/d/abcdefghij12/view');
});

test('code shape: owner only, key name only, no transcript stored, no prune/delete of jobs, Drive trash only in recording folder',()=>{
 assert.match(index,/if \(data\?\.role !== 'owner'\) throw new AuthError\(403\)/);
 assert.match(index,/if \(data\.created_by !== userId\) throw new Fail\('not_found'\)/);
 assert.match(index,/Deno\.env\.get\(GEMINI_KEY_NAME\)/);assert.equal(m.GEMINI_KEY_NAME,'GEMINI_API_KEY');
 assert.doesNotMatch(index,new RegExp(['local','session'].map(x=>x+'Storage').join('|')));
 assert.doesNotMatch(index,/\.delete\(\)|admin\.from\('app_meetings'\)|admin\.from\('app_documents'\)/);
 // S49-2(명진 11/03 11:34 '전사 전문 저장해도돼'): 전사 전문·요약은 서버 정리 작업 표(app_meeting_server_jobs)에만 둔다.
 // 파일 전사 작업 표(TABLE)에는 여전히 글을 넣지 않는다(아래 줄). 회의·회의자료는 부른 사람 로그인(userDb)으로만 읽는다.
 for(const m2 of index.matchAll(/transcript_text/g)){const before=index.slice(Math.max(0,m2.index-400),m2.index);assert.match(before,/SERVER_JOB_TABLE|stage: 'summary'|prev\[0\]|v\.transcript_text|withResult/,'transcript_text only in server job rows');}
 assert.match(index,/const OPENAI = \(\) => \(Deno\.env\.get\('WEB2_OPENAI_API_KEY'\)/); // 결정 D2: Web2 전용 열쇠만(REC-정리멈춤반복)
 assert.doesNotMatch(index,/Deno\.env\.get\('OPENAI_API_KEY'\)/);
 // 작업 표에 글을 넣지 않는다: setJob·insert 몸통에 text 칸 없음
 for(const call of index.matchAll(/(?:setJob\([^;]*|from\(TABLE\)\.(?:insert|update)\([^;]*)/g))assert.doesNotMatch(call[0],/\btext\b|result\./);
 assert.match(index,/userDb\.from\('app_ai_external_usage'\)\.select/);
 assert.match(index,/moveDriveFileToTrash\(fetch, job\.drive_file_id, folder, token\)/);
 assert.match(index,/if \(!GEMINI\(\)\) throw new Fail\('not_ready'\)/);
 assert.equal(m.failBody('not_ready').error,'녹음 전사는 준비 중이에요.');assert.equal(m.STATUS.not_ready,503);
 const doc=readFileSync('docs/web2-env6b-edge-source.md','utf8');
 const rows=doc.split('\n').filter(l=>/^\|\s*\d+\s*\|\s*`meeting-transcribe`/.test(l));
 assert.equal(rows.length,1);assert.equal(rows[0].split('|')[6].replace(/[*\s]/g,''),'true');
 assert.match(index,/verify_jwt=true/);
});

// REC-한회의로잇기 PR-2(설계 docs/design/rec-join.md 3-7절 보안 확인표): 잇기 입구의 인증 경계. 흐름 시험은 tests/meeting-join-job.test.mjs.
const joinSrc=readFileSync('supabase/functions/meeting-transcribe/join-job.mjs','utf8');
test('REC-한회의로잇기: join_* 는 로그인 뒤에만, join_tick만 서버 키 HMAC — verify_jwt·CORS·비로그인 401은 그대로',()=>{
 const serve=index.indexOf('Deno.serve('),user=index.indexOf('const user = await userOf(req);',serve);
 const jobTick=index.indexOf("if (action === 'job_tick') return await jobTick(req);",serve),joinTick=index.indexOf('if (action === JOIN_TICK_ACTION) return await joinTick(req);',serve);
 assert.ok(serve>0&&jobTick>serve&&joinTick>jobTick&&user>joinTick,'로그인 없이 받는 입구는 job_tick·join_tick 둘뿐이고 userOf보다 앞');
 // 사용자 입구 8개는 모두 userOf(비로그인 401) 뒤에 있다.
 for(const a of ['join_text','join_start','join_candidates','join_read','join_list','join_retry','join_seen','join_undo']){
  const at=index.indexOf(`if (action === '${a}')`,serve);assert.ok(at>user,`${a}는 로그인 확인 뒤`);
  assert.equal(index.split(`action === '${a}'`).length,2,`${a} 입구는 한 곳`);
 }
 // userOf는 지금 그대로: 토큰 없음·확인 실패 = 401.
 assert.match(index,/if \(!token\) throw new AuthError\(401\);\n\s*const \{ data, error \} = await admin\.auth\.getUser\(token\);\n\s*if \(error \|\| !data\?\.user\) throw new AuthError\(401\);/);
 assert.match(index,/if \(e instanceof AuthError\) return json\(\{ ok: false, code: e\.message, error: e\.status === 401 \? '로그인이 필요합니다\.' : '접근 권한이 없습니다\.' \}, e\.status\);/);
 // join_tick: 몸통 512자·서명 확인 실패는 401, 열쇠 머리는 CORS 허용 목록에 없다(브라우저는 보낼 수 없음).
 const tick=index.slice(index.indexOf('async function joinTick('),serve);
 assert.match(tick,/if \(raw\.length > 512\) return json\(\{ ok: false \}, 401\);/);
 assert.match(tick,/tickCheck\(SERVICE, body, req\.headers\.get\(TICK_HEADER\), Date\.now\(\), 'join'\)\)\) return json\(\{ ok: false \}, 401\);\n\s*inBackground\(runStep\(body\.job_id as string, 'join'\)\);/);
 const allow=index.match(/'Access-Control-Allow-Headers': '([^']*)'/)[1].split(', ');
 assert.deepEqual(allow,['authorization','x-client-info','apikey','content-type','x-workspace-id','x-file-name','x-duration-sec','x-target-meeting-id','x-record-jobs','x-recording-id','x-piece-seq']);
 assert.match(index,/'Access-Control-Allow-Methods': 'POST, OPTIONS'/);
 assert.match(index,/if \(req\.method === 'OPTIONS'\) return new Response\('ok', \{ headers: cors \}\);/);
 // verify_jwt 표 값은 true 그대로(위 code shape 시험과 같은 표 줄).
 const row=readFileSync('docs/web2-env6b-edge-source.md','utf8').split('\n').filter(l=>/^\|\s*\d+\s*\|\s*`meeting-transcribe`/.test(l));
 assert.equal(row.length,1);assert.equal(row[0].split('|')[6].replace(/[*\s]/g,''),'true');
});

test('REC-한회의로잇기: 작업공간은 서버가 정한다 — 보고는 부른 사람 로그인으로만 읽고, 보고를 쓰는 곳은 DB 함수 두 개뿐(id만 넘김)',()=>{
 const join=index.slice(index.indexOf('// ---- REC-한회의로잇기 PR-2: 잇기 작업 입구'),index.indexOf('Deno.serve('));
 // 화면이 보낸 작업공간·소유 값에 기대지 않는다: 잇기 입구는 몸통·머리글에서 그 값을 읽지 않는다.
 assert.doesNotMatch(join,/body\.workspace_id|x-workspace-id|body\.created_by|body\.owner|body\.user_id/);
 assert.doesNotMatch(joinSrc,/\bb\.workspace_id|\bbody\??\.workspace_id|want\.workspace|\.created_by\s*=[^=]/);
 // 고른 보고·합칠 보고·보고 목록·녹음 자료 행·잇기 작업 행은 userDb(owner RLS·휴지통 숨김)로 읽는다. 서비스 권한으로 보고·자료를 읽거나 쓰지 않는다.
 assert.match(join,/userDb\.from\('app_meetings'\)\.select\(JOIN_MEETING_COLUMNS\)\.eq\('id', id\)\.maybeSingle\(\)/);
 assert.match(join,/userDb\.from\('app_meetings'\)\.select\(JOIN_DAY_COLUMNS\)\.eq\('workspace_id', workspaceId\)/);
 assert.match(join,/userDb\.from\('app_documents'\)\.select\('meeting_id'\)\.eq\('workspace_id', workspaceId\)/);
 assert.match(join,/userDb\.from\(JOIN_JOB_TABLE\)\.select\(columns\)\.eq\('id', id\)\.maybeSingle\(\)/);
 assert.doesNotMatch(index,/admin\.from\('app_meetings'\)|admin\.from\('app_documents'\)/);
 assert.doesNotMatch(index,/from\('app_meetings'\)\s*\.(insert|update|upsert|delete)\(/,'Edge는 보고 행을 직접 쓰지 않는다');
 assert.doesNotMatch(index,/from\('app_record_links'\)|google-tasks/,'할 일·연결은 Edge가 만들지 않는다(후보만)');
 // 서비스 권한 읽기는 작업공간으로 거른다(녹음 길이·연결된 작업·진행 중 잇기).
 for(const name of ['recordJobs','linkedRecordJobs','linkedServerJobs','linkedTranscripts','activeJoins','joinSourceText','sourceJoined']){
  const body=join.slice(join.indexOf(`    ${name}: async (`));
  assert.match(body.slice(0,body.indexOf('\n    },')),/\.eq\('workspace_id', workspaceId\)/,name);
 }
 // DB 함수는 둘, id(와 범위)만 넘긴다. 행 모양·글·작업공간·사용자 값을 넘기지 않는다.
 assert.deepEqual([...index.matchAll(/admin\.rpc\(([^)]*)\)/g)].map(m=>m[1]),["'app_meeting_join_apply', { p_job: job.id }","'app_meeting_join_undo', { p_job: id, p_scope: scope }"]);
 // owner 기준은 한 곳(requireOwner). 잇기 입구는 그것을 그대로 쓴다.
 assert.match(join,/async function isOwner\(userId: string, workspaceId: string\) \{\n\s*try \{ await requireOwner\(userId, workspaceId\); return true; \} catch \(e\) \{ if \(e instanceof AuthError\) return false; throw e; \}/);
 assert.match(join,/\.eq\('user_id', userId\)\.eq\('role', 'owner'\)/);
 // 순서는 join-job.mjs: 고른 보고를 로그인으로 읽기 → owner 확인 → 그 뒤 재료·작업 표.
 const start=joinSrc.slice(joinSrc.indexOf('export async function startJoin('),joinSrc.indexOf('// join_read:'));
 const order=['await io.userMeeting(want.targetId)','await io.isOwner(userId, workspaceId)','isMeetingReport(target)','await readMaterial(io, userId, want, target)','await io.activeJoins(workspaceId)','await io.insertJoin('].map(x=>start.indexOf(x));
 assert.ok(order.every((v,i)=>v>0&&(i===0||v>order[i-1])),'시작 순서');
 assert.match(start,/const workspaceId = target\.workspace_id;/);
});

test('REC-한회의로잇기: 글 내용은 로그·오류·응답에 싣지 않는다 — 오류는 고정 코드만',()=>{
 // 규칙 파일은 로그를 쓰지 않고, 던지는 오류는 고정 코드뿐이다.
 assert.doesNotMatch(joinSrc,/console\./);
 for(const m of joinSrc.matchAll(/new Fail\(([^)]*)\)/g))assert.match(m[1],/^('[a-z_]+'|joined \? 'already_joined' : 'busy')$/,m[1]);
 assert.deepEqual([...joinSrc.matchAll(/new Error\(([^)]*)\)/g)].map(m=>m[1]),["'join_patch_column'"]);
 assert.doesNotMatch(joinSrc,/new (Fail|Error)\(`/);
 // Edge 쪽 잇기 로그는 오류 코드뿐(오류 글·details·hint·글 칸 없음).
 const join=index.slice(index.indexOf('// ---- REC-한회의로잇기 PR-2: 잇기 작업 입구'),index.indexOf('Deno.serve('))+index.slice(index.indexOf('async function applyJoin('),index.indexOf('async function stepOnce('));
 const logs=[...join.matchAll(/console\.(?:warn|error|log)\(([^;]*)\);/g)].map(m=>m[1]);
 assert.deepEqual(logs,["'meeting-transcribe: join undo', error.code || '-'","'meeting-transcribe: join apply', error.code || '-'"]);
 assert.doesNotMatch(join,/error\.message|error\.details|error\.hint|JSON\.stringify\(/);
 // 응답: 화면에 줄 모양(joinView)과 후보(id·초)뿐. 전문·회의 결과·합치기 전 글은 싣지 않는다.
 for(const m of join.matchAll(/return json\((\{[^;]*)\);/g))assert.doesNotMatch(m[1],/transcript|notes|result_text|before_|draft|source_text/,m[1]);
 const view=joinSrc.slice(joinSrc.indexOf('export function joinView('),joinSrc.indexOf('// DB 함수(apply·undo)의 오류'));
 assert.doesNotMatch(view,/transcript_text|result_text|before_|draft|source_text|notes|workspace_id|created_by/);
 // 폰 알림에는 종류·짧은 고정 제목·여는 주소만(지금 notifyDone과 같음).
 assert.match(index,/sender\.send\(d\.fcm_token, \{ kind: 'meeting_done', title: kind === 'join' \? '보고에 이어 붙였어요' : '회의 요약이 준비됐어요', open, urgent: true \}\)/);
});

test('회의 전사 모델 가격은 가격표에 있다(단가 미확인으로 세지 않음)', async () => {
 const p = await import('../../supabase/functions/_shared/ai-prices.mjs');
 const base = p.geminiPrice(m.TRANSCRIBE_MODEL);
 assert.ok(base, '전사 모델이 가격표에 있어야 함');
 assert.equal(base.prefix, 'gemini-3.5-transcribe');
 assert.equal(p.geminiPrice('gemini-3.5-transcribe-live').prefix, 'gemini-3.5-transcribe-live');
 // 100만 음성 토큰 + 100만 출력 토큰 = 2달러 + 12달러(1달러 1,400원)
 assert.equal(p.geminiKrw(m.TRANSCRIBE_MODEL, 1_000_000, 1_000_000, 1_000_000), 19600);
});

test('글을 못 받은 시도는 월 상한에 넣지 않는다(실패 머리 mtgfail-)', () => {
 const id='11111111-2222-4333-8444-555555555555', at=new Date(Date.UTC(2026,10,12));
 const ok=m.usageRef(id,at), bad=m.usageRef(id,at,true);
 assert.ok(ok.startsWith('mtg-'));
 assert.ok(bad.startsWith('mtgfail-'));
 assert.ok(!bad.startsWith(m.USAGE_REF_PREFIX), '실패 머리는 월 상한 셈(mtg-)과 겹치면 안 됨');
 assert.match(bad,/^[A-Za-z0-9_.:-]{8,80}$/, 'DB ref 규칙 안');
 const row=ref=>({ref,model:m.TRANSCRIBE_MODEL,input_tokens:1_000_000,audio_tokens:1_000_000,output_tokens:0});
 assert.equal(m.monthKrw([row(ok),row(bad)]),2800);
 // 서버는 답을 읽은 뒤 성공 여부로 머리를 정하고, 실패면 기록한 다음 원래 오류를 다시 던진다.
 const index=readFileSync(new URL('../../supabase/functions/meeting-transcribe/index.ts',import.meta.url),'utf8');
 assert.match(index,/ref: usageRef\(job\.id, at, !result\)/);
 assert.match(index,/if \(!result\) throw answerError;/);
 assert.match(index,/\.like\('ref', `\$\{USAGE_REF_PREFIX\}%`\)/);
});
