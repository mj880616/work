// MTG-노트북녹음 2단계: 노트북 [녹음] 순수 규칙(형식·구간 넘김·조각 대기열·재시도·녹음 저장·띠 글자)과 화면 연결(정적) 검사.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PIECE_SECONDS,SEGMENT_SECONDS,AUDIO_BITS,pickMime,baseMime,shouldRoll,retryDelay,pieceOutcome,nextStep,queuedPieces,clockText,minuteText,stepParts,STEPS,seoulLocal,pendingText,pendingOthers,resumables,takeOverRisk,LIVE_FRESH_SEC,saveRecording,savedFiles,saveFailText,savedFilesHtml,savedBandHeight} from '../app/meeting-recorder-model.mjs';
import {REC_PIECE_SECONDS,REC_SEGMENT_SECONDS,REC_MESSAGES} from '../supabase/functions/meeting-transcribe/recording.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('간격은 서버 규칙과 같다(조각 1분·구간 29분), 32kbps',()=>{
  assert.equal(PIECE_SECONDS,REC_PIECE_SECONDS);
  assert.equal(SEGMENT_SECONDS,REC_SEGMENT_SECONDS);
  assert.equal(AUDIO_BITS,32000);
});

test('형식: mp4 → ogg → webm 순으로 되는 첫 것, 없으면 빈 글자',()=>{
  assert.equal(pickMime(t=>true),'audio/mp4');
  assert.equal(pickMime(t=>t.startsWith('audio/ogg')||t.startsWith('audio/webm')),'audio/ogg;codecs=opus');
  assert.equal(pickMime(t=>t==='audio/webm'),'audio/webm');
  assert.equal(pickMime(()=>false),'');
  assert.equal(pickMime(null),'');
  assert.equal(pickMime(()=>{throw new Error('x')}),'');
  assert.equal(baseMime('audio/webm;codecs=opus'),'audio/webm');
  assert.equal(baseMime('audio/mp4'),'audio/mp4');
  assert.equal(baseMime('video/mp4'),'');
});

test('구간 넘김: 녹음한 초가 29분이 되면',()=>{
  assert.equal(SEGMENT_SECONDS,29*60);
  assert.equal(shouldRoll(1739),false);
  assert.equal(shouldRoll(1740),true);
  assert.equal(shouldRoll(10,10),true);
});

test('재시도 간격은 늘다가 1분에서 멈춘다',()=>{
  assert.deepEqual([1,2,3,4,9].map(retryDelay),[3000,10000,30000,60000,60000]);
});

test('조각 답 갈래: 성공은 빼고, 닫힘·가득·권한은 멈추고, 나머지는 같은 번호로 다시',()=>{
  assert.equal(pieceOutcome({ok:true}),'done');
  assert.equal(pieceOutcome({status:409,message:REC_MESSAGES.rec_closed}),'stop');
  assert.equal(pieceOutcome({status:413,message:REC_MESSAGES.rec_full}),'stop');
  assert.equal(pieceOutcome({status:409,message:REC_MESSAGES.piece_gap}),'retry');
  assert.equal(pieceOutcome({status:0,message:'Failed to fetch'}),'retry');
  assert.equal(pieceOutcome({status:503}),'retry');
  assert.equal(pieceOutcome({status:401,code:'session_required'}),'retry');
  assert.equal(pieceOutcome({status:403}),'stop');
  assert.equal(pieceOutcome({status:404}),'stop');
});

const seg=(no,{id=`r${no}`,ended=false,stopped=false,pieces=0}={})=>({no,id,ended,stopped,pieces:Array.from({length:pieces},(_,i)=>({seq:i+1}))});
test('대기열: 한 구간씩 순서대로, 앞 구간이 끝나야 다음 구간을 연다',()=>{
  assert.deepEqual(nextStep([seg(1)]),{kind:'idle'});
  assert.deepEqual(nextStep([seg(1,{pieces:2})]),{kind:'piece',index:0});
  // 59분 넘김: 새 구간(id 없음)에 조각이 먼저 쌓여도 앞 구간이 멈추고 마지막 조각을 보낼 때까지 기다린다.
  assert.deepEqual(nextStep([seg(1),seg(2,{id:null,pieces:1})]),{kind:'idle'});
  assert.deepEqual(nextStep([seg(1,{ended:true,pieces:1}),seg(2,{id:null,pieces:1})]),{kind:'piece',index:0});
  assert.deepEqual(nextStep([seg(1,{ended:true}),seg(2,{id:null,pieces:1})]),{kind:'start',index:1});
  assert.deepEqual(nextStep([seg(1,{ended:true}),seg(2,{pieces:1})]),{kind:'piece',index:1});
  assert.deepEqual(nextStep([seg(1,{ended:true}),seg(2,{ended:true})]),{kind:'drained'});
  // 조각 없이 끝난 새 구간은 서버에 열지 않는다.
  assert.deepEqual(nextStep([seg(1,{ended:true}),seg(2,{id:null,ended:true})]),{kind:'drained'});
  // 서버가 닫은 구간의 남은 조각은 건너뛴다.
  assert.deepEqual(nextStep([seg(1,{stopped:true,pieces:3})]),{kind:'drained'});
  assert.deepEqual(nextStep([]),{kind:'idle'});
  assert.equal(queuedPieces([seg(1,{pieces:2}),seg(2,{id:null,pieces:1}),seg(3,{stopped:true,pieces:4})]),3);
});

test('실패한 조각은 같은 번호로 남는다(대기열 흉내: 실패 2번 뒤 성공)',()=>{
  const segments=[seg(1,{pieces:2})];
  const sent=[];let failLeft=2;
  for(let i=0;i<10;i++){
    const step=nextStep(segments);
    if(step.kind!=='piece')break;
    const piece=segments[step.index].pieces[0];
    sent.push(piece.seq);
    if(failLeft>0){failLeft--;continue}
    segments[step.index].pieces.shift();
  }
  assert.deepEqual(sent,[1,1,1,2]);
  segments[0].ended=true;
  assert.equal(nextStep(segments).kind,'drained');
});

test('시간·분 글자',()=>{
  assert.equal(clockText(5),'00:05');
  assert.equal(clockText(65.9),'01:05');
  assert.equal(clockText(3723),'1:02:03');
  assert.equal(minuteText(59),'59분');
  assert.equal(minuteText(118),'1시간 58분');
  assert.equal(minuteText(120),'2시간');
});

// S61-5 REC-전사삭제(명진 11/13): 구간 글 합치기·전사 계획은 지금은 없다(전사를 하지 않음). 그 자리에 녹음 저장 규칙.
test('지금은 없음: 전사 계획·구간 글 합치기 함수가 모델에 없다',async()=>{
  const m=await import('../app/meeting-recorder-model.mjs');
  assert.equal(m.transcribePlan,undefined);
  assert.equal(m.joinSegmentTexts,undefined);
});
test('띠 진행 한 줄: 올림 › 저장(전사·요약·초안 단계 없음)',()=>{
  assert.deepEqual([...STEPS],['올림','저장']);
  assert.deepEqual(stepParts('올림').map(p=>p.state),['now','todo']);
  assert.deepEqual(stepParts('저장').map(p=>p.state),['done','now']);
  assert.deepEqual(stepParts('').map(p=>p.state),['todo','todo']);
});
test('녹음 저장: rec_finish를 more가 끝날 때까지 → rec_save 한 번, 전사 호출 0번',async()=>{
  const calls=[],steps=[];let more=2;
  const call=async(action,body)=>{calls.push([action,body]);
    if(action==='rec_finish')return {ok:true,more:more-->0};
    if(action==='rec_save')return {ok:true,folder_name:'회의 녹음',files:[{document_id:'d1',file_name:'회의 녹음 1.webm',drive_file_id:'f1',drive_url:'https://drive.google.com/file/d/f1/view',mime_type:'audio/webm'},{file_name:'번호 없음'}]};
    throw new Error('unexpected '+action)};
  const r=await saveRecording(call,'s1',{onStep:s=>steps.push(s)});
  assert.deepEqual(calls.map(c=>c[0]),['rec_finish','rec_finish','rec_finish','rec_save']);
  assert.deepEqual(calls[3][1],{session_id:'s1'});
  assert.deepEqual(steps,['올림','저장']);
  assert.equal(r.folder,'회의 녹음');
  assert.deepEqual(r.files,[{documentId:'d1',name:'회의 녹음 1.webm',driveId:'f1',driveUrl:'https://drive.google.com/file/d/f1/view',mime:'audio/webm'}]);
  assert.ok(!calls.some(c=>/transcribe|job_/.test(c[0])));
  // 회의에서 녹음했으면 rec_save에 그 회의 id
  const c2=[];await saveRecording(async(a,b)=>{c2.push([a,b]);return a==='rec_save'?{files:[{document_id:'d'}]}:{more:false}},'s2',{meetingId:'m1'});
  assert.deepEqual(c2[1],['rec_save',{session_id:'s2',meeting_id:'m1'}]);
  // 저장할 파일이 없으면 no_recording
  await assert.rejects(saveRecording(async a=>a==='rec_save'?{files:[]}:{more:false},'s3'),e=>e.code==='no_recording');
});
test('저장 띠 글자: 파일 줄(이름·내려받기·Drive에서 열기, 이름은 글자로), 멈춘 이유, 높이',()=>{
  const html=savedFilesHtml([{name:'<b>a</b>.webm'},{name:'b.webm'}],'rec');
  assert.match(html,/data-rec-down="0"[^>]*>내려받기<\/button>/);
  assert.match(html,/data-rec-open="1"[^>]*>Drive에서 열기<\/button>/);
  assert.match(html,/&lt;b&gt;a&lt;\/b&gt;\.webm/);
  assert.doesNotMatch(html,/<b>/);
  assert.match(savedFilesHtml([{name:'x'}],'prec'),/data-prec-down="0"/);
  assert.equal(savedBandHeight(1),0);
  assert.equal(savedBandHeight(2),64);
  assert.match(saveFailText({code:'no_recording'}),/찾지 못했어요/);
  assert.match(saveFailText({},'저장'),/자료실에 저장하지 못했어요/);
  assert.match(saveFailText({},'올림'),/합치지 못했어요/);
  assert.match(saveFailText({status:401}),/로그인/);
  assert.deepEqual(savedFiles(null),[]);
});

test('일시·이어서 저장 글자(서울 시각)',()=>{
  assert.equal(seoulLocal('2026-10-29T05:30:00Z'),'2026-10-29T14:30');
  assert.equal(seoulLocal('x'),'');
  assert.equal(pendingText({started_at:'2026-10-29T05:30:00Z',duration_sec:1920}),'10/29 14:30 녹음 · 32분');
  assert.equal(pendingText({}),'녹음');
  assert.deepEqual(pendingOthers([{session_id:'a'},{session_id:'b'},{}],'a').map(s=>s.session_id),['b']);
});

test('화면 연결(정적): 앱 껍데기 한 곳이 주인, 기기 저장 없음, PC에서만',()=>{
  const src=read('app/meeting-recorder.js');
  const code=src.split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
  // 브라우저 저장 공간 이름(시험 파일이 저장 감사에 걸리지 않게 조각으로 만든다).
  const deviceStore=new RegExp(['local','session'].map(k=>k+'Storage').concat('indexed'+'DB').join('|'),'i');
  assert.doesNotMatch(code,deviceStore);
  assert.match(src,/matchMedia\?\.\('\(min-width:761px\)'\)/);
  for(const action of ['rec_start','rec_piece','rec_pending','rec_discard'])assert.ok(src.includes(`'${action}'`),action);
  assert.match(src,/saveRecording\(call,sessionId/);
  // S61-5 REC-전사삭제: 전사·서버 정리·초안 길이 없다.
  for(const gone of ["'transcribe'",'job_start','job_list','job_read','job_retry','KPTUMeetingTranscriptDraft','KPTUReportEntry','초안 열기','멈추고 정리'])assert.ok(!code.includes(gone),gone);
  assert.match(src,/멈추고 저장/);
  assert.match(src,/beforeunload/);
  const loader=read('app/loader-v2.js');
  assert.match(loader,/import\('\.\/meeting-recorder\.js'\)/);
  const html=read('app/index.html');
  assert.match(html,/<div class="report-head-actions"><button id="reportRecordBtn" class="secondary" type="button" hidden>녹음<\/button><button id="newMeetingBtn"/);
  assert.match(html,/id="recPendingLine"[^>]*hidden/);
  assert.doesNotMatch(read('app/meeting-recorder-model.mjs'),/document\.|fetch\(/);
  assert.doesNotMatch(read('app/meeting-recorder-model.mjs'),deviceStore);
});

// REC-새로고침(S49-7): 맨 위 띠에 보일 끝나지 않은 녹음, 이어받기 확인.
test('resumables: live(방금 끊김)는 늘 띠, 닫힌 것은 하루 안쪽만 띠·나머지는 한 줄, 지금 녹음 중인 session은 뺀다',()=>{
  const now=Date.parse('2026-11-03T12:00:00Z');
  const live=[{session_id:'L',started_at:'2026-11-03T11:00:00Z',duration_sec:3000,idle_sec:20}];
  const pending=[
    {session_id:'P1',started_at:'2026-11-03T03:00:00Z',duration_sec:600},
    {session_id:'P2',started_at:'2026-10-30T03:00:00Z',duration_sec:600},
    {session_id:'ME',started_at:'2026-11-03T11:30:00Z',duration_sec:60},
    {session_id:'L',started_at:'2026-11-03T11:00:00Z',duration_sec:60},
  ];
  const r=resumables(pending,live,'ME',now);
  assert.deepEqual(r.top.map(s=>s.session_id),['L','P1']);
  assert.equal(r.top[0].live,true);assert.equal(r.top[1].live,false);
  assert.deepEqual(r.old.map(s=>s.session_id),['P2']);
  assert.deepEqual(resumables(null,undefined,'',now),{top:[],old:[]});
});
test('takeOverRisk: live이고 마지막 조각 뒤 100초 안쪽이면 묻는다(조회 뒤 흐른 시간 포함)',()=>{
  assert.equal(LIVE_FRESH_SEC,100);
  assert.equal(takeOverRisk({live:false,idle_sec:1}),false);
  assert.equal(takeOverRisk({live:true,idle_sec:20,fetched:1000},1000+30000),true);
  assert.equal(takeOverRisk({live:true,idle_sec:20,fetched:1000},1000+90000),false);
  assert.equal(takeOverRisk({live:true,idle_sec:300,fetched:1000},1000),false);
  assert.equal(takeOverRisk({live:true}),true); // 모르면 묻는다
});
test('meeting-recorder.js: 이어서 녹음은 같은 session으로 rec_start, 띠는 어느 화면에서나, 다른 곳에서 녹음 중일 수 있으면 띠에서 한 번 묻는다(확인창 없음)',()=>{
  const js=readFileSync(new URL('../app/meeting-recorder.js',import.meta.url),'utf8');
  assert.match(js,/rec_start',\{workspace_id:workspaceId,mime:baseMime\(MIME\),\.\.\.\(from\?\{session_id:from\.session_id\}:meetingId\?\{meeting_id:meetingId\}:\{\}\)\}/);
  // S61-36 REC-상세녹음: 이어 녹음·이어서 저장은 서버가 그 녹음에 남긴 회의(rec_pending meeting_id)를 쓴다(기기 저장 없음).
  assert.match(js,/meetingId=String\(\(from\?from\.meeting_id:opts\?\.meetingId\)\|\|''\)/);
  assert.match(js,/meetingId=String\(session\.meeting_id\|\|''\)/);
  assert.doesNotMatch(js,/meetingId='';\n\s*accum=/);
  assert.match(js,/data-rec-continue/);
  assert.match(js,/data-rec-takeover="go">계속/);
  assert.doesNotMatch(js,/\b(?:alert|confirm)\(/);
  assert.match(js,/setTimeout\(\(\)=>void loadPending\(\),3500\)/);
  assert.doesNotMatch(js,new RegExp(['local','session'].map(x=>x+'Storage').join('|')));
});

// REC-노트북이어하기(S49-29): 마이크가 끊기면 일시 정지됨 → [이어 녹음]은 같은 session_id의 새 구간(자동 재시작 없음).
test('meeting-recorder.js: 끊김은 일시 정지됨으로, 이어 녹음은 사람이 눌러야 하고 같은 녹음의 새 구간이다',()=>{
  const js=readFileSync(new URL('../app/meeting-recorder.js',import.meta.url),'utf8');
  assert.match(js,/state='suspended'/);
  assert.match(js,/data-rec="resume">이어 녹음/);
  assert.match(js,/requestData\(\)/);
  assert.match(js,/visibilitychange/);
  assert.match(js,/no:\(last\?\.no\|\|0\)\+1/);
  assert.doesNotMatch(js,/visibilityState==='visible'[^\n]*getUserMedia/);
});
