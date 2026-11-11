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
 assert.equal(code({status:'in_progress',output_text:'x'}),'gemini_failed');
 assert.equal(code({status:'completed',output_text:'  '}),'empty_transcript');
 assert.equal(code(null),'gemini_failed');
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
 assert.equal(m.overLimit(4999),false);assert.equal(m.overLimit(5000),true);assert.equal(m.overLimit(NaN),true);
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
