import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as m from '../../supabase/functions/meeting-transcribe/model.mjs';

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
 assert.doesNotMatch(index,/OPENAI|localStorage|\.delete\(\)|transcript_text|admin\.from\('app_meetings'\)|admin\.from\('app_documents'\)/);
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
