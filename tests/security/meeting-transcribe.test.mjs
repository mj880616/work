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

// S60-9 REC-전사모델바꾸기: gemini-2.5-flash generateContent(공식 REST 모양). 아래 답은 그 모양을 흉내 낸 것(글은 모두 지어냄).
const ans=(text,finish='STOP',extra={})=>({candidates:[{content:{role:'model',parts:[{text}]},finishReason:finish}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:50},modelVersion:'gemini-2.5-flash',...extra});
const code=j=>{try{m.readTranscript(j);return 'ok'}catch(e){return e.code}};

test('S60-9 request: generateContent with uploaded file + verbatim Korean prompt, thinking off, low temperature, max output 65,536',()=>{
 assert.equal(m.TRANSCRIBE_MODEL,'gemini-3.5-flash-lite');
 assert.equal(m.transcribePath(),'/v1beta/models/gemini-3.5-flash-lite:generateContent');
 assert.equal(m.transcribePath('gemini-2.5-flash-lite'),'/v1beta/models/gemini-2.5-flash-lite:generateContent');
 const r=m.transcriptionRequest('https://generativelanguage.googleapis.com/v1beta/files/x','audio/ogg');
 assert.deepEqual(r,{
  contents:[{role:'user',parts:[{fileData:{mimeType:'audio/ogg',fileUri:'https://generativelanguage.googleapis.com/v1beta/files/x'}},{text:m.TRANSCRIBE_PROMPT}]}],
  generationConfig:{temperature:0.2,maxOutputTokens:65536},
 });
 assert.equal(m.TRANSCRIBE_MAX_OUTPUT_TOKENS,65536);assert.ok(m.TRANSCRIBE_TEMPERATURE>0&&m.TRANSCRIBE_TEMPERATURE<=0.3);
 // 지시문: 그대로 받아 적기(요약·의역 금지) · 화자 줄 · 안 들림 표시 · 머리말 없음.
 for(const re of [/한국어 회의/,/그대로 받아 적/,/요약·의역/,/'화자1: ', '화자2: '/,/처음 말한 순서대로 1부터/,/'\(안 들림\)'/,/마크다운 없이/])assert.match(m.TRANSCRIBE_PROMPT,re);
 // 모델 이름은 한 곳: Edge는 TRANSCRIBE_MODEL로만 부르고, 옛 전사 전용 길(interactions·화자 구분 거절 뒤 다시)은 없다.
 assert.match(index,/fetch\(`\$\{GEM\}\$\{transcribePath\(TRANSCRIBE_MODEL\)\}`/);
 // S60-11: 출력 상한은 조각 길이에 맞추고(outputCap), 기다림은 남은 예산(answerWindow, 최대 380초)만큼.
 assert.match(index,/body: JSON\.stringify\(transcriptionRequest\(uri, mime, seconds\)\), signal: AbortSignal\.timeout\(wait\),/);
 assert.equal(m.transcriptionRequest('u','audio/mp4',1229).generationConfig.maxOutputTokens,40967);
 assert.doesNotMatch(index,/v1beta\/interactions|diariz|wantsDiarize|gemini-[0-9]/);
 assert.match(index,/geminiTranscribe\(key, file\.uri, file\.mimeType \|\| mime, duration \?\? null, audio\.deadline\)/);
 assert.equal((index.match(/await transcribeLoaded\(/g)||[]).length,3,'세 길(화면·구간·회의자료 파일) 모두 같은 전사 한 곳');
 assert.equal((index.match(/await runTranscription\(/g)||[]).length,1);
 assert.doesNotMatch(index,/body\.segment_seconds|body\.model|body\.prompt/,'화면이 보낸 모델·지시문은 쓰지 않는다');
});

test('S60-9 reading: text parts joined, speaker heads tidied, thought parts skipped, cause by finishReason/block',()=>{
 assert.deepEqual(m.readTranscript(ans('화자1: 안녕하세요.\n화자2: 네.\n화자1: 시작할게요.')),{text:'화자1: 안녕하세요.\n화자2: 네.\n화자1: 시작할게요.',speakerSplit:true});
 // 한 답 안의 text 조각은 이어진 글(줄바꿈을 끼우지 않음), 생각 조각(thought:true)은 전사 글이 아님.
 const split={candidates:[{content:{parts:[{text:'생각 요약',thought:true},{text:'화자1: 앞부분 '},{text:'뒷부분\n화자2: 네'}]},finishReason:'STOP'}]};
 assert.deepEqual(m.readTranscript(split),{text:'화자1: 앞부분 뒷부분\n화자2: 네',speakerSplit:true});
 // 머리를 조금 다르게 써도 '화자N: '로 맞춘다. 한 사람뿐이면 speakerSplit false(실패 아님).
 assert.equal(m.readTranscript(ans('**화자 1:** 가\n화자02： 나\n  화자3 :다')).text,'화자1: 가\n화자2: 나\n화자3: 다');
 assert.deepEqual(m.readTranscript(ans('화자1: 혼자 말함')),{text:'화자1: 혼자 말함',speakerSplit:false});
 assert.deepEqual(m.readTranscript(ans('머리 없는 글 (안 들림) 이어서')),{text:'머리 없는 글 (안 들림) 이어서',speakerSplit:false});
 assert.equal(m.readTranscript(ans('화자1: 가','FINISH_REASON_UNSPECIFIED')).text,'화자1: 가');
 assert.equal(m.readTranscript({candidates:[{content:{parts:[{text:'화자1: 가'}]}}]}).text,'화자1: 가','끝난 이유가 없으면 글로 받음');
 // 잘림(MAX_TOKENS) → gemini_incomplete(반으로 나눠 다시), 차단·그 밖 멈춤 → gemini_failed, 끝까지 왔는데 글 없음 → gemini_empty.
 assert.equal(code(ans('화자1: 길게 이어지다','MAX_TOKENS')),'gemini_incomplete');
 assert.equal(code(ans('','MAX_TOKENS')),'gemini_incomplete');
 for(const f of ['SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII','OTHER','LANGUAGE','MALFORMED_FUNCTION_CALL','weird','설마'])assert.equal(code(ans('화자1: 글',f)),'gemini_failed',f);
 assert.equal(code({promptFeedback:{blockReason:'SAFETY'}}),'gemini_failed');
 assert.equal(code({promptFeedback:{blockReason:'OTHER'},candidates:[]}),'gemini_failed');
 assert.equal(code(ans(' \n ')),'gemini_empty');
 assert.equal(code({candidates:[]}),'gemini_empty');assert.equal(code({}),'gemini_empty');
 assert.equal(code({candidates:[{content:{parts:[{text:'생각만',thought:true}]},finishReason:'STOP'}]}),'gemini_empty');
 assert.equal(code({candidates:[{content:{parts:[{inlineData:{mimeType:'audio/ogg',data:'x'}}]},finishReason:'STOP'}]}),'gemini_empty');
 assert.equal(code(null),'gemini_failed');assert.equal(code([]),'gemini_failed');assert.equal(code('x'),'gemini_failed');
 // 코드마다 서버 문구·HTTP 상태·화면 갈래(전사 서비스)가 있다.
 for(const c of ['gemini_empty','gemini_incomplete','gemini_repeat']){assert.ok(m.MESSAGES[c],c);assert.equal(m.STATUS[c],502,c);assert.equal(m.FAIL_KIND[c],'gemini',c);assert.match(m.MESSAGES[c],/녹음은 그대로 있어요/);}
 assert.equal(new Set(['gemini_empty','gemini_incomplete','gemini_repeat','gemini_failed','empty_transcript'].map(c=>m.MESSAGES[c])).size,5,'원인마다 다른 글');
});

test('S60-9 repeat detection: abnormal loops fail as gemini_repeat (before MAX_TOKENS), ordinary meeting talk passes',()=>{
 const lines=(n,f)=>Array.from({length:n},(_,i)=>f(i)).join('\n');
 // 받아들임: 보통 회의 말 · 짧은 맞장구 몇 번 · 같은 줄 몇 번 · 표결처럼 같은 말이 이어져도 기준 아래.
 const normal=lines(400,i=>`화자${i%3+1}: ${i}번째 안건은 예산 ${i*7}만 원과 일정 ${i%12+1}월을 함께 보자는 말입니다.`);
 assert.equal(m.repeatRun(normal),null);assert.equal(code(ans(normal)),'ok');
 assert.equal(m.repeatRun('화자1: 네 네 네 네 네 맞아요.\n화자2: 네.\n화자1: 네.\n화자2: 네.'),null);
 assert.equal(m.repeatRun(lines(29,i=>`화자${i+1}: 찬성.`)),null,'1낱말 29번 연속은 받음');
 assert.equal(m.repeatRun(lines(9,()=>'화자1: 오늘 회의는 여기까지 하겠습니다 수고하셨습니다.')),null,'한 문장 9번은 받음');
 assert.equal(m.repeatRun(''),null);
 // 실패: 1~3낱말 30번 · 4~15낱말 10번 · 16~80낱말 5번 연속(화자 머리·문장부호는 떼고 본다 — 화자를 번갈아도 같은 말이면 되풀이).
 assert.deepEqual(m.repeatRun(lines(30,i=>`화자${i%2+1}: 찬성.`)),{words:1,times:30});
 assert.deepEqual(m.repeatRun('그래서 '.repeat(200)),{words:1,times:200});
 assert.deepEqual(m.repeatRun(lines(10,()=>'화자1: 오늘 회의는 여기까지 하겠습니다 수고하셨습니다.')),{words:5,times:10});
 const block=Array.from({length:20},(_,i)=>`말${i}`).join(' ');
 assert.equal(m.repeatRun(Array(4).fill(block).join('\n')),null);
 assert.deepEqual(m.repeatRun(Array(5).fill(block).join('\n')),{words:20,times:5});
 // 앞부분이 멀쩡해도 끝에서 되풀이에 빠지면 그 조각은 실패(반으로 나눠 다시) — 잘림(MAX_TOKENS)보다 되풀이를 먼저 본다.
 const loop=normal+'\n'+lines(60,()=>'화자2: 그 부분은 다시 확인해 보겠습니다.');
 assert.equal(code(ans(loop)),'gemini_repeat');assert.equal(code(ans(loop,'MAX_TOKENS')),'gemini_repeat');
 assert.deepEqual(m.REPEAT_RULES.map(r=>[r.maxWords,r.times]),[[3,30],[15,10],[80,5]]);
 assert.ok(Object.isFrozen(m.REPEAT_RULES));
 // 끝없이 나누지 않는다: 되풀이·잘림 둘 다 같은 반 나누기(MIN_CHUNK_SECONDS에서 멈춤)를 탄다.
 assert.deepEqual([...m.HALVE_CODES],['gemini_incomplete','gemini_repeat','gemini_timeout']);assert.ok(Object.isFrozen(m.HALVE_CODES));
 assert.doesNotMatch(index,/const HALVE_CODES/,'반 나눔 코드는 model.mjs 한 곳');
 assert.match(index,/if \(answerError instanceof Fail && HALVE_CODES\.includes\(answerError\.code\)\) \{\n\s*const halves = halvesOf\(answerError\.code\);/);
 assert.match(index,/const halves = audio\.opened \? halveRange\(range, audio\.opened\.seconds\) : \[\];/);
 // 긴 답에서도 빠르다(출력 상한 65,536토큰 ≈ 12만 자 이상).
 const big='화자1: '+Array.from({length:40000},(_,i)=>`낱말${i}`).join(' ');
 const t0=Date.now();assert.equal(m.repeatRun(big),null);assert.ok(Date.now()-t0<2000,'2초 안');
});

test('S60-9 answer shape log line has names and counts only — never transcript, block text or file address',()=>{
 const secret='비밀회의내용';
 const shape=m.answerShape({candidates:[{content:{parts:[{text:`화자1: ${secret}\n화자2: 네`},{text:secret,thought:true},{fileData:{fileUri:`files/${secret}`}}]},finishReason:'MAX_TOKENS',safetyRatings:[{category:secret}]}],
  usageMetadata:{promptTokenCount:78720,candidatesTokenCount:65536,thoughtsTokenCount:0},modelVersion:secret,[secret]:1});
 assert.doesNotMatch(shape,new RegExp(secret));assert.doesNotMatch(shape,/files\//);
 assert.equal(shape,`finish=MAX_TOKENS block=- keys=?,candidates,modelVersion,usageMetadata cands=1 parts=text:1,thought:1,fileData:1 chars=${`화자1: ${secret}\n화자2: 네`.length} blank=0 lines=2 speakers=2 repeat=- out_tokens=65536 thought_tokens=0`);
 assert.equal(m.answerShape({promptFeedback:{blockReason:'SAFETY'}}),'finish=- block=SAFETY keys=promptFeedback cands=0 parts=- chars=0 blank=0 lines=0 speakers=0 repeat=- out_tokens=- thought_tokens=-');
 assert.match(m.answerShape({promptFeedback:{blockReason:secret}}),/ block=\? /);
 assert.match(m.answerShape(ans('그래서 '.repeat(50),'MAX_TOKENS')),/ repeat=1x50 /);
 assert.match(m.answerShape(ans('x','설마')),/^finish=\? /);
 assert.equal(m.answerShape(null),'type=null');assert.equal(m.answerShape([]),'type=array');assert.equal(m.answerShape('x'),'type=string');
 // 서버는 답을 못 읽으면 이 모양을 한 줄 남긴다. 사용량은 답이 왔으면 쓴 만큼 기록(못 읽은 시도는 실패 머리로, 월 상한 밖).
 assert.match(index,/function readAnswer\(d: unknown\) \{\n\s*try \{ return readTranscript\(d\); \} catch \(e\) \{\n\s*if \(e instanceof Fail\) console\.warn\('meeting-transcribe: gemini answer', e\.code, answerShape\(d\)\);\n\s*throw e;/);
 assert.match(index,/try \{ result = readAnswer\(response\); \} catch \(e\) \{ answerError = e; \}/);
 assert.equal((index.match(/readTranscript\(/g)||[]).length,1,'답 읽기는 readAnswer 한 곳');
 assert.ok(index.indexOf('readUsage(response, duration)')<index.indexOf('readAnswer(response)'));
 // 답 몸통을 받다가 기다림 상한이 지나면 늦음, 끊김·JSON 아님은 실패 — 둘 다 상태·길이만 로그(내용 없음).
 const gt=index.slice(index.indexOf('async function geminiTranscribe'),index.indexOf('function readAnswer'));
 assert.match(gt,/try \{ raw = await r\.text\(\); \} catch \(e\) \{/);
 assert.match(gt,/throw new Fail\(late \? 'gemini_timeout' : 'gemini_failed'\)/);
 assert.match(gt,/console\.warn\('meeting-transcribe: gemini answer not json', r\.status, raw\.length\);/);
 assert.doesNotMatch(gt,/console\.warn\([^;]*raw\)/);assert.doesNotMatch(gt,/r\.json\(\)\.catch/);
 assert.match(gt,/if \(!r\.ok\) \{ await geminiWarn\('transcribe', r\); throw new Fail\(geminiCode\(r\.status\)\); \}/);
 // 녹음 구간 길이는 서버가 rec_start 답으로 알려 준다(폰 앱은 이 값을 따른다).
 assert.equal(rec.REC_SEGMENT_SECONDS,29*60);
 assert.match(index,/segment_seconds: REC_SEGMENT_SECONDS/);
 assert.match(index,/duration_sec: seg\.duration_sec \?\? null/);
});

test('S60-9 usage: usageMetadata tokens, audio modality, thinking counted as output, fallback estimate; month sum only mtg- rows; limit',()=>{
 assert.deepEqual(m.readUsage({modelVersion:'gemini-2.5-flash',usageMetadata:{promptTokenCount:1000,candidatesTokenCount:300,thoughtsTokenCount:20,totalTokenCount:1320,promptTokensDetails:[{modality:'TEXT',tokenCount:100},{modality:'AUDIO',tokenCount:900}]}},60),
  {model:'gemini-2.5-flash',calls:1,input_tokens:1000,audio_tokens:900,output_tokens:320});
 assert.deepEqual(m.readUsage({modelVersion:'models/gemini-2.5-flash-lite',usageMetadata:{promptTokenCount:10,candidatesTokenCount:2}},1),{model:'gemini-2.5-flash-lite',calls:1,input_tokens:10,audio_tokens:10,output_tokens:2});
 assert.deepEqual(m.readUsage({},100),{model:m.TRANSCRIBE_MODEL,calls:1,input_tokens:3200,audio_tokens:3200,output_tokens:0});
 assert.equal(m.readUsage({modelVersion:'이상한 이름'},1).model,m.TRANSCRIBE_MODEL);
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

test('회의 전사 모델 가격은 가격표에 있다(단가 미확인으로 세지 않음) — CC V60 3.5 Flash-Lite(2.5 Flash는 404·퇴역), 지난 기록 모델 줄도 그대로', async () => {
 const p = await import('../../supabase/functions/_shared/ai-prices.mjs');
 const base = p.geminiPrice(m.TRANSCRIBE_MODEL);
 assert.ok(base, '전사 모델이 가격표에 있어야 함');
 assert.equal(base.prefix, 'gemini-3.5-flash-lite');
 // 100만 음성 토큰 + 100만 출력 토큰(생각 포함) = 0.30달러 + 2.5달러(1달러 1,400원)
 assert.equal(p.geminiKrw(m.TRANSCRIBE_MODEL, 1_000_000, 1_000_000, 1_000_000), 3920);
 // 2.5 Flash 줄도 그대로(지난 사용량·수집기 셈)
 assert.equal(p.geminiPrice('gemini-2.5-flash').prefix, 'gemini-2.5-flash');
 // 지난 사용량 행(gemini-3.5-transcribe)은 옛 단가 그대로 센다(이번 달 합계가 바뀌지 않음).
 assert.equal(p.geminiPrice('gemini-3.5-transcribe').prefix, 'gemini-3.5-transcribe');
 assert.equal(p.geminiPrice('gemini-3.5-transcribe-live').prefix, 'gemini-3.5-transcribe-live');
 assert.equal(p.geminiKrw('gemini-3.5-transcribe', 1_000_000, 1_000_000, 1_000_000), 19600);
 // 비교용 Flash-Lite도 표에 있다(모델 이름만 바꾸면 가격 셈도 따라감).
 assert.equal(p.geminiPrice('gemini-2.5-flash-lite').prefix, 'gemini-2.5-flash-lite');
 // 41분 녹음 예상: 음성 78,720토큰 + 출력 45,000토큰 ≈ 191원(3.5 Flash-Lite, 옛 전사 모델 ≈ 976원).
 const audio=41*60*m.AUDIO_TOKENS_PER_SECOND;
 assert.equal(audio,78720);
 assert.equal(Math.round(p.geminiKrw(m.TRANSCRIBE_MODEL,audio,audio,45000)),191);
 assert.equal(Math.round(p.geminiKrw('gemini-3.5-transcribe',audio,audio,45000)),976);
});

test('글을 못 받은 시도는 월 상한에 넣지 않는다(실패 머리 mtgfail-)', () => {
 const id='11111111-2222-4333-8444-555555555555', at=new Date(Date.UTC(2026,10,12));
 const ok=m.usageRef(id,at), bad=m.usageRef(id,at,true);
 assert.ok(ok.startsWith('mtg-'));
 assert.ok(bad.startsWith('mtgfail-'));
 assert.ok(!bad.startsWith(m.USAGE_REF_PREFIX), '실패 머리는 월 상한 셈(mtg-)과 겹치면 안 됨');
 assert.match(bad,/^[A-Za-z0-9_.:-]{8,80}$/, 'DB ref 규칙 안');
 const row=ref=>({ref,model:m.TRANSCRIBE_MODEL,input_tokens:1_000_000,audio_tokens:1_000_000,output_tokens:0});
 assert.equal(m.monthKrw([row(ok),row(bad)]),420,'실패 머리 행은 빼고 성공 행만(3.5 Flash-Lite 음성 100만 토큰 = 420원)');
 // 서버는 답을 읽은 뒤 성공 여부로 머리를 정하고, 실패면 기록한 다음 원래 오류를 다시 던진다.
 const index=readFileSync(new URL('../../supabase/functions/meeting-transcribe/index.ts',import.meta.url),'utf8');
 // 긴 소리를 나눠 동시에 전사하는 조각은 조각 번호를 붙여 겹치지 않게(REC-긴녹음나눠전사).
 assert.match(index,/ref: usageRef\(job\.id, at, !result, piece\)/);
 assert.match(index,/if \(!result\) \{[\s\S]{0,400}?throw answerError;/);
 assert.match(m.usageRef(id,at,true,3),/^mtgfail-.*-c3$/);
 assert.match(index,/\.like\('ref', `\$\{USAGE_REF_PREFIX\}%`\)/);
});

// REC-긴녹음나눠전사(S60-7): 11/12 41분 녹음이 출력 상한(32,768토큰)에서 잘림(gemini_incomplete) → 시간 조각으로 나눠 전사.
test('REC-긴녹음나눠전사: 세 길(화면 transcribe·서버 정리 구간·회의자료 파일) 모두 나눔, 진행·이어하기는 parts 안, 로그는 수만', async () => {
 const sp=await import('../../supabase/functions/meeting-transcribe/split.mjs');
 // 조각은 한 번 요청 상한 안. 메모리에 담는 크기는 올리기 상한 안. 녹음 구간(29분 + 넘길 때 1분 조각)은 나누지 않는다(S60-9).
 assert.ok(sp.CHUNK_SECONDS<m.MAX_SECONDS);assert.ok(rec.REC_SEGMENT_SECONDS+rec.REC_PIECE_SECONDS<=sp.CHUNK_SECONDS);
 assert.ok(sp.MIN_CHUNK_SECONDS*2<=sp.CHUNK_SECONDS);
 assert.ok(sp.SPLIT_MAX_BYTES<=m.MAX_BYTES);
 assert.match(index,/import \{ CHUNK_SECONDS, SPLIT_MAX_BYTES, chunkRanges, halveRange, openAudio, readRange \} from '\.\/split\.mjs';/);
 // 크면 담지 않고 지금처럼 흘려 보낸다(나누지 않음).
 assert.match(index,/if \(!fix && !\(size > 0 && size <= SPLIT_MAX_BYTES\)\) \{/);
 // 길면 전사하지 않고 나눌 구간부터, 답이 잘리거나 되풀이하면(HALVE_CODES) 그 조각만 반으로.
 assert.match(index,/if \(!range && audio\.opened && audio\.opened\.seconds > CHUNK_SECONDS\) return \{ split: chunkRanges\(audio\.opened\.seconds\) \};/);
 // 서버 정리: 한 단계에 조각 하나, 나누면 parts만 바꾸고(표 칸 추가 없음) 진행 수는 조각 수.
 assert.match(index,/const next = splitPart\(parts, i, got\.split\);/);
 assert.match(index,/parts: next, step_no: doneParts\(next\), step_total: partTotal\(next\)/);
 assert.match(index,/transcribeFile\(key, job, p\.file, range, cutBefore\) : await transcribeSegment\(key, p\.job, range, more, cutBefore\)/);
 // 구간 행은 마지막 조각 뒤에만 '끝'(그 전엔 '올림' — 이어서 정리·붙이기가 끝난 녹음으로 보지 않음).
 assert.match(index,/if \('split' in out \|\| more\) await setJob\(job\.id, \{ status: 'uploaded', error_code: null, finished_at: null \}\);/);
 // 화면 transcribe: 한 번 읽은 소리를 조각마다 동시에(상한 있음), 조각 길이로 머리 줄을 붙여 잇는다.
 assert.match(index,/const PARALLEL_CHUNKS = 3;/);
 assert.match(index,/mapLimit\(got\.split, PARALLEL_CHUNKS, run\)/);
 // 새 로그: 형식·분·크기 수만(글·이름·주소 없음).
 for(const line of index.match(/console\.warn\('meeting-transcribe: (audio|split[^']*)'[^;]*;/g)||[]){
  assert.doesNotMatch(line,/text|file_name|drive_file_id|uri|name/,line);
 }
 assert.equal((index.match(/console\.warn\('meeting-transcribe: (audio|split skipped|split after)'/g)||[]).length,3);
 assert.match(index,/console\.warn\('meeting-transcribe: split after', why, Math\.round\(\(span \|\| 0\) \/ 60\)\)/);
});

// S60-11 REC-m4a뒤조각멈춤: 11/12 41분 녹음 두 번째 조각이 로그 없이 두 번 멈춤(Edge 실행 시간 안에 Gemini 단계가 끝나지 않아 끊김 → step_cut).
test('S60-11 Gemini 단계마다 시간 상한(남은 예산 안), 넘으면 로그 한 줄(상태·걸린 초)과 기존 실패 코드, 끊긴 조각은 반으로',()=>{
 const T=m.GEMINI_TIME;assert.ok(Object.isFrozen(T));
 // 소리 읽기부터 답까지 예산 + 뒷정리 여유 < Edge 벽시계 약 400초(docs/design/meeting-transcript-server.md). 답 기다림 상한은 전과 같은 380초.
 assert.ok(T.stepMs+50000<=400000);assert.equal(T.answerMaxMs,380000);
 assert.ok(T.uploadMs+T.activeMs+T.answerMinMs<=T.stepMs);
 // 답 기다림: 남은 예산만큼(최대 380초), 남은 예산이 짧으면 묻지 않음(0)
 assert.equal(m.answerWindow(1_000_000,1_000_000-400000),380000);
 assert.equal(m.answerWindow(1_000_000,1_000_000-200000),200000);
 assert.equal(m.answerWindow(1_000_000,1_000_000-T.answerMinMs+1),0);
 assert.equal(m.answerWindow(NaN,0),0);
 assert.equal(m.phaseWindow(120000,1_000_000,1_000_000-30000),30000);assert.equal(m.phaseWindow(120000,1_000_000,2_000_000),1000);
 // 출력 상한: 길이에 맞춤(최소 8,192, 최대 65,536), 길이를 모르면 모델 상한
 assert.equal(m.outputCap(null),65536);assert.equal(m.outputCap(60),8192);assert.equal(m.outputCap(20*60),40000);assert.equal(m.outputCap(3600),65536);
 assert.equal(m.stateTag('PROCESSING'),'PROCESSING');assert.equal(m.stateTag('files/abc'),'-');assert.equal(m.stateTag(undefined),'-');
 // 예산은 소리 읽기 시작에서 한 번 정하고, 올리기·파일 준비·답 모두 그 안에서.
 assert.match(index,/async function loadAudio\(job: Job\): Promise<Loaded> \{\n\s*const deadline = Date\.now\(\) \+ GEMINI_TIME\.stepMs;/);
 assert.match(index,/await geminiUpload\(key, job\.id, mime, body, size, audio\.deadline\)/);
 assert.match(index,/await geminiActive\(key, file\.name, file\.state, audio\.deadline\)/);
 // Gemini로 가는 fetch는 모두 시간 상한(signal)을 단다.
 const gem=index.slice(index.indexOf('async function geminiUpload('),index.indexOf('// 전사 답 → 글(model.mjs readTranscript).'));
 const calls=[...gem.matchAll(/await fetch\(/g)].length;
 assert.equal(calls,5,'올리기 시작·몸통·상태·지우기·답');
 assert.equal([...gem.matchAll(/signal(: AbortSignal\.timeout\(|,)/g)].length,5,'다섯 곳 모두 시간 상한');
 assert.match(gem,/method: 'DELETE', headers: \{ 'x-goog-api-key': key \}, signal: AbortSignal\.timeout\(GEMINI_TIME\.deleteMs\)/);
 // 파일 준비가 안 되면 상태 이름·걸린 초 한 줄 + 기존 코드 gemini_timeout(화면 문구표에 이미 있음, 새 코드 없음).
 assert.match(gem,/console\.warn\('meeting-transcribe: gemini file stuck', stateTag\(s\), secSince\(t0\)\); throw new Fail\('gemini_timeout'\);/);
 assert.match(gem,/console\.warn\('meeting-transcribe: gemini upload', isLate\(e\) \? 'late' : 'error', Math\.round\(size \/ 1048576\), secSince\(t0\)\);/);
 assert.match(gem,/console\.warn\('meeting-transcribe: gemini answer', isLate\(e\) \? 'late' : 'cut', secSince\(t0\), Math\.round\(wait \/ 1000\)\);/);
 assert.match(index,/console\.warn\('meeting-transcribe: gemini timing', /);
 for(const l of index.matchAll(/console\.warn\('meeting-transcribe: gemini (upload|file|answer|timing)[^;]*;/g))assert.doesNotMatch(l[0],/uri|file\.name|text|raw\)|key\b/,l[0]);
 const screen=readFileSync(new URL('../../app/meeting-server-job.mjs',import.meta.url),'utf8');
 for(const c of ['gemini_timeout','gemini_upload','gemini_file_failed']){assert.ok(m.MESSAGES[c],c);assert.match(screen,new RegExp(`\\b${c}:`),c);}
 // 답이 늦으면(gemini_timeout) 그 조각을 반으로. 앞 실행이 이 조각에서 끊겼으면(cutBefore) 묻지 않고 반으로(요약 단계와 같은 규칙).
 assert.match(index,/if \(e instanceof Fail && e\.code === 'gemini_timeout'\) \{ const halves = halvesOf\(e\.code\); if \(halves\.length\) return \{ split: halves \}; \}/);
 assert.match(index,/if \(halveFirst\) \{ const halves = halvesOf\('step_cut'\); if \(halves\.length\) return \{ split: halves \}; \}/);
 assert.match(index,/transcribeFile\(key, job, p\.file, range, cutBefore\) : await transcribeSegment\(key, p\.job, range, more, cutBefore\)/);
 assert.match(index,/next = await stepOnce\(job, take\.cut === 1\);/);
});
