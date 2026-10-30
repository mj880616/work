// MTG-노트북녹음 2단계: 노트북 [녹음] 순수 규칙(형식·구간 넘김·조각 대기열·재시도·글 합치기·띠 글자)과 화면 연결(정적) 검사.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PIECE_SECONDS,SEGMENT_SECONDS,AUDIO_BITS,pickMime,baseMime,shouldRoll,retryDelay,pieceOutcome,nextStep,queuedPieces,clockText,minuteText,joinSegmentTexts,stepParts,seoulLocal,pendingText,pendingOthers,transcribePlan} from '../app/meeting-recorder-model.mjs';
import {REC_PIECE_SECONDS,REC_SEGMENT_SECONDS,REC_MESSAGES} from '../supabase/functions/meeting-transcribe/recording.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('간격은 서버 규칙과 같다(조각 1분·구간 59분), 32kbps',()=>{
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

test('구간 넘김: 녹음한 초가 59분이 되면',()=>{
  assert.equal(shouldRoll(3539),false);
  assert.equal(shouldRoll(3540),true);
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

test('구간 글 합치기: 둘째부터 머리 줄, 빈 구간은 건너뛰고, 이미 끝난 구간은 한 줄 안내',()=>{
  assert.equal(joinSegmentTexts([{no:1,seconds:3540,text:'첫 구간'}]),'첫 구간');
  assert.equal(joinSegmentTexts([{no:2,seconds:600,text:'둘'},{no:1,seconds:3540,text:'하나'}]),'하나\n\n― 59분부터 ―\n둘');
  assert.equal(joinSegmentTexts([{no:1,seconds:3540,text:''},{no:2,seconds:3540,text:'둘'},{no:3,seconds:10,text:'셋'}]),'― 59분부터 ―\n둘\n\n― 1시간 58분부터 ―\n셋');
  assert.match(joinSegmentTexts([{no:1,seconds:3540,text:null},{no:2,seconds:1,text:'둘'}]),/^― 처음부터 ―\n\(이 구간 글은 이미 전사가 끝나/);
  assert.equal(joinSegmentTexts([]),'');
});

test('띠 진행 한 줄: 올림 › 전사 › 요약 › 초안 열림',()=>{
  assert.deepEqual(stepParts('전사').map(p=>p.state),['done','now','todo','todo']);
  assert.deepEqual(stepParts('초안 열림').map(p=>p.state),['done','done','done','now']);
  assert.deepEqual(stepParts('').map(p=>p.state),['todo','todo','todo','todo']);
});

test('일시·이어서 정리 글자(서울 시각)',()=>{
  assert.equal(seoulLocal('2026-10-29T05:30:00Z'),'2026-10-29T14:30');
  assert.equal(seoulLocal('x'),'');
  assert.equal(pendingText({started_at:'2026-10-29T05:30:00Z',duration_sec:1920}),'10/29 14:30 녹음 · 32분');
  assert.equal(pendingText({}),'녹음');
  assert.deepEqual(pendingOthers([{session_id:'a'},{session_id:'b'},{}],'a').map(s=>s.session_id),['b']);
});

test('전사 계획: 합친 구간만 전사, 이미 끝난 것은 gone, 빈·실패는 건너뜀',()=>{
  const plan=transcribePlan([
    {segment_no:3,status:'combined',job_id:'j3',duration_sec:30},
    {segment_no:1,status:'combined',job_id:'j1',duration_sec:3540,job_status:'done'},
    {segment_no:2,status:'failed',job_id:null,duration_sec:3540},
    {segment_no:4,status:'empty'},
  ]);
  assert.deepEqual(plan.map(p=>[p.no,p.action]),[[1,'gone'],[2,'skip'],[3,'transcribe']]);
  assert.equal(plan[1].failed,true);
});

test('화면 연결(정적): 앱 껍데기 한 곳이 주인, 기기 저장 없음, PC에서만',()=>{
  const src=read('app/meeting-recorder.js');
  const code=src.split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
  // 브라우저 저장 공간 이름(시험 파일이 저장 감사에 걸리지 않게 조각으로 만든다).
  const deviceStore=new RegExp(['local','session'].map(k=>k+'Storage').concat('indexed'+'DB').join('|'),'i');
  assert.doesNotMatch(code,deviceStore);
  assert.match(src,/matchMedia\?\.\('\(min-width:761px\)'\)/);
  for(const action of ['rec_start','rec_piece','rec_finish','rec_pending','transcribe'])assert.ok(src.includes(`'${action}'`),action);
  assert.match(src,/beforeunload/);
  assert.match(src,/KPTUMeetingTranscriptDraft/);
  const loader=read('app/loader-v2.js');
  assert.match(loader,/import\('\.\/meeting-recorder\.js'\)/);
  const html=read('app/index.html');
  assert.match(html,/<div class="report-head-actions"><button id="reportRecordBtn" class="secondary" type="button" hidden>녹음<\/button><button id="newMeetingBtn"/);
  assert.match(html,/id="recPendingLine"[^>]*hidden/);
  const draft=read('app/meeting-transcript-draft.js');
  assert.match(draft,/window\.KPTUMeetingTranscriptDraft=\{fill\}/);
  assert.doesNotMatch(read('app/meeting-recorder-model.mjs'),/document\.|fetch\(/);
  assert.doesNotMatch(read('app/meeting-recorder-model.mjs'),deviceStore);
});
