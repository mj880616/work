// MTG-녹음1분조각: 조각 1분(한 구간 약 60조각) 이어 붙이기·옛 5분 조각과 섞인 녹음·rec_finish more 반복·Drive 호출 나눠 하기.
// 운영 서버·Drive는 쓰지 않는다(가짜 Response). recording.mjs는 Edge meeting-transcribe가 그대로 쓰는 모듈이다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as r from '../supabase/functions/meeting-transcribe/recording.mjs';
import {PIECE_SECONDS,ROLL_PIECES,SEGMENT_SECONDS,pieceSecondsOf,rollPiecesOf,shouldRoll} from '../app/meeting-recorder-model.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const enc=new TextEncoder();
// 조각 하나 = 몇 덩이로 나뉘어 오는 Response(실제 Drive처럼 여러 번 읽힘).
function piece(text,{ok=true,chunks=3}={}){
  const bytes=enc.encode(text),step=Math.max(1,Math.ceil(bytes.length/chunks));
  let i=0;
  const body=new ReadableStream({pull(c){if(i>=bytes.length){c.close();return}c.enqueue(bytes.slice(i,i+step));i+=step}});
  return {ok,body};
}
async function readAll(stream){
  const reader=stream.getReader(),parts=[];
  for(;;){const {value,done}=await reader.read();if(done)break;parts.push(...value)}
  return new TextDecoder().decode(new Uint8Array(parts));
}
const ids=(n,prefix='p')=>Array.from({length:n},(_,i)=>`${prefix}${String(i+1).padStart(2,'0')}aaaaaaaaaa`);

test('간격: 화면·서버 모두 1분, 구간 59분, 조각 한도 60(상한 64 안)',()=>{
  assert.equal(PIECE_SECONDS,r.REC_PIECE_SECONDS);assert.equal(PIECE_SECONDS,60);
  assert.equal(ROLL_PIECES,r.REC_ROLL_PIECES);
  assert.equal(SEGMENT_SECONDS,r.REC_SEGMENT_SECONDS);
  assert.ok(r.REC_ROLL_PIECES+1<=r.REC_MAX_PIECES);
  // 59분 = 1분 조각 59개 + 넘길 때 1개 = 60: 시간이 먼저 넘긴다(조각 수 한도는 일시정지 중 조각이 나오는 브라우저용).
  assert.ok(Math.ceil(SEGMENT_SECONDS/PIECE_SECONDS)+1<=ROLL_PIECES);
});

test('화면은 서버가 알려 준 간격을 따른다: 새 서버 60초, 옛 서버 300초, 이상한 값은 1분',()=>{
  assert.equal(pieceSecondsOf({piece_seconds:60}),60);
  assert.equal(pieceSecondsOf({piece_seconds:300}),300); // 옛 서버(5분·16조각): 화면이 먼저 배포돼도 5분으로
  for(const bad of [null,{},{piece_seconds:0},{piece_seconds:5},{piece_seconds:3600},{piece_seconds:'60x'},{piece_seconds:60.5}])assert.equal(pieceSecondsOf(bad),60);
  assert.equal(rollPiecesOf({max_pieces:60}),60);
  assert.equal(rollPiecesOf({}),12); // 옛 서버: 16조각 상한 안(5분 × 12 = 60분이라 59분이 먼저)
  assert.equal(rollPiecesOf({max_pieces:2}),12);
});

test('구간 넘김: 59분이 되거나 조각이 한도에 닿으면(일시정지가 길어도 상한을 넘지 않음)',()=>{
  assert.equal(shouldRoll(3539,SEGMENT_SECONDS,59,60),false);
  assert.equal(shouldRoll(3540,SEGMENT_SECONDS,59,60),true);
  assert.equal(shouldRoll(1200,SEGMENT_SECONDS,60,60),true);
  assert.equal(shouldRoll(1200,SEGMENT_SECONDS,59,60),false);
  assert.equal(shouldRoll(3539),false);assert.equal(shouldRoll(3540),true); // 조각 수를 안 주면 시간만
});

test('60조각 구간을 서버가 모두 받는다(61번째부터 rec_full·64까지 순서 강제)',()=>{
  let rec={status:'recording',piece_ids:[],size_bytes:0,duration_sec:null};
  const now=new Date('2026-10-30T03:00:00Z');
  for(let seq=1;seq<=60;seq++){
    const p=r.parsePiece({recordingId:'11111111-2222-4333-8444-555555555555',seq:String(seq),length:'240000',seconds:String(seq*60)});
    assert.equal(r.pieceDecision(rec,p.seq,p.size).action,'append');
    rec={...rec,...r.appendPatch(rec,`piece${String(seq).padStart(2,'0')}aaaaaaaa`,p.size,p.duration,now)};
  }
  assert.equal(rec.piece_ids.length,60);assert.equal(rec.duration_sec,3600);assert.equal(rec.size_bytes,60*240000);
  assert.equal(r.pieceDecision(rec,61,1).action,'append');
  assert.equal(r.pieceDecision(rec,30,1).action,'already');
  const full={...rec,piece_ids:ids(r.REC_MAX_PIECES)};
  assert.throws(()=>r.pieceDecision(full,r.REC_MAX_PIECES+1,1),{code:'rec_full'});
  assert.throws(()=>r.parsePiece({recordingId:'11111111-2222-4333-8444-555555555555',seq:String(r.REC_MAX_PIECES+1),length:'5'}),{code:'bad_request'});
});

test('이어 붙이기: 60조각을 순서대로 한 흐름으로, 다음 조각은 미리 요청(동시 2개까지)',async()=>{
  const list=ids(60),opened=[];let open=0,peak=0;
  const stream=r.joinPieces(async id=>{opened.push(id);open++;peak=Math.max(peak,open);await new Promise(x=>setTimeout(x,1));
    const res=piece(`[${id}]`);const inner=res.body.getReader();
    return {ok:true,body:new ReadableStream({async pull(c){const {value,done}=await inner.read();if(done){open--;c.close()}else c.enqueue(value)}})};
  },list);
  assert.equal(await readAll(stream),list.map(id=>`[${id}]`).join(''));
  assert.deepEqual(opened,list);
  assert.ok(peak<=2,`peak ${peak}`);
});

test('이어 붙이기: 옛 5분 조각(큼)과 1분 조각(작음)이 섞여도 길이를 가정하지 않고 그대로 잇는다',async()=>{
  const big=ids(12,'b'),small=ids(20,'s'),list=[...big,...small];
  const body=id=>(id.startsWith('b')?'B':'s').repeat(id.startsWith('b')?5000:1000)+`|${id}|`;
  const out=await readAll(r.joinPieces(async id=>piece(body(id),{chunks:id.startsWith('b')?7:2}),list));
  assert.equal(out,list.map(body).join(''));
  assert.equal(out.length,12*5000+20*1000+list.reduce((n,id)=>n+id.length+2,0));
});

test('이어 붙이기: 조각 하나가 없으면 drive_failed로 멈춘다(반쪽 파일을 만들지 않음)',async()=>{
  const list=ids(5);
  const stream=r.joinPieces(async id=>id===list[3]?{ok:false,body:null}:piece(id),list);
  await assert.rejects(readAll(stream),{code:'drive_failed'});
  const thrown=r.joinPieces(async id=>{if(id===list[1])throw new Error('net');return piece(id)},list);
  await assert.rejects(readAll(thrown),{code:'drive_failed'});
  assert.equal(await readAll(r.joinPieces(async()=>piece('x'),[])),'');
});

test('Drive 호출 나눠 하기: 60개를 6개씩 동시에, 결과는 원래 순서, 하나라도 실패하면 그 오류',async()=>{
  let open=0,peak=0;
  const out=await r.mapLimit(ids(60),r.REC_DRIVE_PARALLEL,async(id,i)=>{open++;peak=Math.max(peak,open);await new Promise(x=>setTimeout(x,(i*7)%5));open--;return i});
  assert.deepEqual(out,Array.from({length:60},(_,i)=>i));
  assert.equal(peak,r.REC_DRIVE_PARALLEL);
  let started=0;
  await assert.rejects(r.mapLimit(ids(60),6,async(id,i)=>{started++;await new Promise(x=>setTimeout(x,1));if(i===3)throw Object.assign(new Error('x'),{code:'drive_failed'});return i}),{code:'drive_failed'});
  assert.ok(started<60,'실패 뒤 남은 것은 시작하지 않음');
  assert.deepEqual(await r.mapLimit([],6,async()=>1),[]);
});

test('rec_finish more 반복: 시간 안에 못 끝낸 구간은 다음 부름에, 한 번에 적어도 한 구간, 모두 하면 more 없음',async()=>{
  // 3시간 녹음 = 59분 구간 3개 + 짧은 끝 구간 1개(각 60·60·60·5조각). 구간 하나 합치기 = 가짜 시계 70초.
  const segs=[1,2,3,4].map(n=>({segment_no:n,status:'closed',piece_ids:ids(n===4?5:60)}));
  let clock=0;const combined=[];
  const combine=async seg=>{clock+=70*1000;combined.push(seg.segment_no);seg.status='combined'};
  const calls=[];
  for(let i=0;i<10;i++){
    const started=clock;
    const res=await r.combineWithin(r.toCombine(segs),combine,started,{now:()=>clock});
    calls.push(res);
    if(!res.more)break;
  }
  assert.deepEqual(combined,[1,2,3,4]);
  // 예산 120초: 첫 부름 = 1·2(140초째에 멈춤), 둘째 = 3·4.
  assert.deepEqual(calls,[{more:true,done:2},{more:false,done:2}]);
  // 시작부터 예산을 넘겨도 한 구간은 한다(끝없이 more만 돌지 않음).
  const late=[{segment_no:1,status:'closed'},{segment_no:2,status:'closed'}];
  assert.deepEqual(await r.combineWithin(late,async s=>{s.status='combined'},0,{now:()=>10**9}),{more:true,done:1});
  assert.deepEqual(await r.combineWithin([],async()=>{},0),{more:false,done:0});
  // 한 구간 실패는 그대로 올라간다(화면 [다시]).
  await assert.rejects(r.combineWithin(late,async()=>{throw Object.assign(new Error('x'),{code:'drive_failed'})},0,{now:()=>0}),{code:'drive_failed'});
});

test('섞인 녹음: 옛 5분 조각 구간 + 1분 조각 구간이 한 녹음이어도 이어서 정리·버리기·되돌리기 규칙이 같다',()=>{
  const now=new Date('2026-10-30T05:00:00Z');
  const rows=[
    {session_id:'S',segment_no:1,status:'closed',piece_ids:ids(12,'b'),duration_sec:3540,created_at:'2026-10-30T02:00:00Z',updated_at:'2026-10-30T02:59:00Z',workspace_id:'W',created_by:'U'},
    {session_id:'S',segment_no:2,status:'recording',piece_ids:ids(37,'s'),duration_sec:2220,created_at:'2026-10-30T02:59:00Z',updated_at:'2026-10-30T03:36:00Z',workspace_id:'W',created_by:'U'},
  ];
  const [p]=r.pendingSessions(rows,[],now);
  assert.equal(p.duration_sec,3540+2220);
  assert.deepEqual(p.segments.map(s=>s.segment_no),[1,2]);
  const plan=r.discardPlan(rows,[]);
  assert.deepEqual(plan.map(x=>[x.row.segment_no,x.kind]),[[1,'pieces'],[2,'pieces']]);
  const gone=rows.map((row,i)=>({...row,...r.discardPatch(row,plan[i].kind,now)}));
  assert.deepEqual(r.restorePlan(gone).map(x=>[x.row.segment_no,x.to]),[[1,'closed'],[2,'closed']]);
  // 1분 조각 녹음이 창 닫힘으로 끊기면 7분 뒤 '이어서 정리'에 보인다(지금 녹음 중은 빼고).
  const live={...rows[1],updated_at:new Date(now.getTime()-6*60000).toISOString()};
  assert.equal(r.pendingSessions([rows[0],live],[],now).length,0);
  const quiet={...rows[1],updated_at:new Date(now.getTime()-8*60000).toISOString()};
  assert.equal(r.pendingSessions([rows[0],quiet],[],now).length,1);
});

test('Edge: 조각 길이를 고정으로 쓰는 곳 없음, 공용 이어 붙이기·나눠 호출·more 반복을 쓴다, rec_start가 간격·한도를 알려 준다',()=>{
  const index=read('supabase/functions/meeting-transcribe/index.ts');
  assert.match(index,/joinPieces\(pieceMedia\(token\), seg\.piece_ids\)/);
  assert.doesNotMatch(index,/function joinPieces/);
  assert.match(index,/mapLimit\(ids, REC_DRIVE_PARALLEL/);
  assert.match(index,/mapLimit\(seg\.piece_ids \|\| \[\], REC_DRIVE_PARALLEL/);
  assert.match(index,/mapLimit\(p\.row\.piece_ids \|\| \[\], REC_DRIVE_PARALLEL, \(id: string\) => untrashDriveFile\(id, folder, token\)\)/);
  assert.match(index,/combineWithin\(pending, \(seg: Job\) => combineSegment\(user\.id, seg, token, pieces, target\), started\)/);
  assert.match(index,/piece_seconds: REC_PIECE_SECONDS, segment_seconds: REC_SEGMENT_SECONDS, max_pieces: REC_ROLL_PIECES/);
  // REC_PIECE_SECONDS는 화면에 알려 주는 데만 쓴다(계산에 쓰지 않음).
  assert.equal([...index.matchAll(/REC_PIECE_SECONDS/g)].length,2);
  const rec=read('supabase/functions/meeting-transcribe/recording.mjs');
  assert.equal([...rec.matchAll(/REC_PIECE_SECONDS(?! =)/g)].length,0);
  // 화면: 녹음기 timeslice는 서버 간격, 구간 넘김은 시간 + 조각 수.
  const js=read('app/meeting-recorder.js');
  assert.match(js,/pieceMs=pieceSecondsOf\(r\)\*1000;rollPieces=rollPiecesOf\(r\);/);
  assert.equal([...js.matchAll(/rec\.start\(pieceMs\)/g)].length,2);
  assert.doesNotMatch(js,/rec\.start\(PIECE_SECONDS/);
  assert.match(js,/shouldRoll\(segSec,SEGMENT_SECONDS,current\.seg\.seq,rollPieces\)/);
});
