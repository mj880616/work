import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as r from '../../supabase/functions/meeting-transcribe/recording.mjs';
import {MAX_BYTES,MAX_SECONDS,parseUpload} from '../../supabase/functions/meeting-transcribe/model.mjs';

// MTG-노트북녹음 1단계 Edge meeting-transcribe rec_*: 구간·조각 규칙 + 코드 모양(소유자·순서·Drive 폴더·저장 안 함).
const index=readFileSync('supabase/functions/meeting-transcribe/index.ts','utf8');
const code=f=>{try{f();return 'ok'}catch(e){return e.code}};
const ID='11111111-2222-4333-8444-555555555555';

test('segment fits one transcription request; DB limits match',()=>{
 assert.ok(r.REC_SEGMENT_SECONDS<MAX_SECONDS);assert.equal(r.REC_PIECE_SECONDS,300);
 assert.ok(Math.ceil(r.REC_SEGMENT_SECONDS/r.REC_PIECE_SECONDS)+1<=r.REC_MAX_PIECES);
 const sql=readFileSync('supabase/migrations/20261029200000_meeting_recordings.sql','utf8');
 assert.match(sql,new RegExp(`cardinality\\(piece_ids\\) <= ${r.REC_MAX_PIECES}\\b`));
 assert.match(sql,new RegExp(`segment_no between 1 and ${r.REC_MAX_SEGMENTS}\\b`));
 assert.match(sql,new RegExp(`size_bytes between 0 and ${MAX_BYTES}\\b`));
 assert.deepEqual(Object.keys(r.REC_MIME).sort(),['audio/mp4','audio/ogg','audio/webm']);
 for(const m of Object.keys(r.REC_MIME))assert.match(sql,new RegExp(`'${m}'`));
});

test('mime and piece headers',()=>{
 assert.equal(r.recMime('audio/webm;codecs=opus'),'audio/webm');assert.equal(r.recMime('AUDIO/MP4'),'audio/mp4');
 assert.equal(code(()=>r.recMime('video/webm')),'bad_type');assert.equal(code(()=>r.recMime('toString')),'bad_type');
 assert.deepEqual(r.parsePiece({recordingId:ID,seq:'2',length:'1000',seconds:'600.2'}),{recordingId:ID,seq:2,size:1000,duration:601});
 assert.equal(r.parsePiece({recordingId:ID,seq:'1',length:'5',seconds:null}).duration,null);
 assert.equal(code(()=>r.parsePiece({recordingId:'x',seq:'1',length:'5'})),'bad_request');
 assert.equal(code(()=>r.parsePiece({recordingId:ID,seq:'0',length:'5'})),'bad_request');
 assert.equal(code(()=>r.parsePiece({recordingId:ID,seq:String(r.REC_MAX_PIECES+1),length:'5'})),'bad_request');
 assert.equal(code(()=>r.parsePiece({recordingId:ID,seq:'1',length:'0'})),'bad_request');
 assert.equal(code(()=>r.parsePiece({recordingId:ID,seq:'1',length:String(MAX_BYTES+1)})),'too_large');
 assert.equal(code(()=>r.parsePiece({recordingId:ID,seq:'1',length:'5',seconds:'3601'})),'too_long');
});

test('piece order: already, gap with expected, closed, full, size; append keeps order and duration grows',()=>{
 const rec={status:'recording',piece_ids:['aaaaaaaaaa1','aaaaaaaaaa2'],size_bytes:10,duration_sec:600};
 assert.equal(r.pieceDecision(rec,2,5).action,'already');
 assert.equal(r.pieceDecision({...rec,status:'closed'},1,5).action,'already');
 assert.equal(r.pieceDecision(rec,3,5).action,'append');
 let e;try{r.pieceDecision(rec,4,5)}catch(x){e=x}
 assert.equal(e.code,'piece_gap');assert.deepEqual(e.extra,{expected_seq:3});
 assert.deepEqual(r.recFailBody(e.code,e.extra),{ok:false,code:'piece_gap',error:r.REC_MESSAGES.piece_gap,expected_seq:3});
 assert.equal(r.REC_STATUS.piece_gap,409);
 assert.equal(code(()=>r.pieceDecision({...rec,status:'closed'},3,5)),'rec_closed');
 assert.equal(code(()=>r.pieceDecision({status:'recording',piece_ids:Array(r.REC_MAX_PIECES).fill('aaaaaaaaaa1'),size_bytes:1},r.REC_MAX_PIECES+1,1)),'rec_full');
 assert.equal(code(()=>r.pieceDecision({...rec,size_bytes:MAX_BYTES},3,1)),'too_large');
 const now=new Date('2026-10-29T05:00:00Z');
 const p=r.appendPatch(rec,'bbbbbbbbbb3',5,900,now);
 assert.deepEqual(p,{piece_ids:['aaaaaaaaaa1','aaaaaaaaaa2','bbbbbbbbbb3'],size_bytes:15,duration_sec:900,updated_at:now.toISOString()});
 assert.equal(r.appendPatch(rec,'bbbbbbbbbb3',5,300,now).duration_sec,600);
 assert.equal(r.appendPatch({...rec,duration_sec:null},'bbbbbbbbbb3',5,null,now).duration_sec,null);
 assert.equal(code(()=>r.appendPatch(rec,'bad id',5,null,now)),'drive_failed');
});

test('close, next segment, quiet open segment, file names',()=>{
 const now=new Date('2026-10-29T05:00:00Z');
 assert.equal(r.closePatch({piece_ids:[]},now).status,'empty');assert.equal(r.closePatch({piece_ids:['aaaaaaaaaa1']},now).status,'closed');
 assert.equal(r.nextSegment([{segment_no:1},{segment_no:3}]),4);assert.equal(r.nextSegment([]),1);
 assert.equal(code(()=>r.nextSegment([{segment_no:r.REC_MAX_SEGMENTS}])),'rec_too_many');
 assert.equal(r.isQuiet({status:'recording',updated_at:'2026-10-29T04:50:00Z'},now),false);
 assert.equal(r.isQuiet({status:'recording',updated_at:'2026-10-29T04:40:00Z'},now),true);
 assert.equal(r.isQuiet({status:'closed',updated_at:'2026-10-29T00:00:00Z'},now),false);
 const name=r.segmentFileName('2026-10-29T05:30:00Z',2,'audio/mp4');
 assert.equal(name,'녹음 2026-10-29 1430 구간2.m4a');
 // 합친 파일 이름은 기존 전사 길의 파일 규칙(확장자·길이)을 지킨다.
 for(const m of Object.keys(r.REC_MIME))assert.equal(parseUpload({name:encodeURIComponent(r.segmentFileName(now.toISOString(),24,m)),length:'1'}).fileName.endsWith(r.REC_MIME[m]),true);
 assert.equal(r.pieceFileName(ID,3,'audio/webm'),`rec-${ID}-03.webm`);
 assert.deepEqual(r.toCombine([{status:'closed',segment_no:2},{status:'combined',segment_no:1},{status:'closed',segment_no:1}]).map(x=>x.segment_no),[1,2]);
});

test('pending sessions: unfinished only, live recording hidden, newest first',()=>{
 const now=new Date('2026-10-29T05:00:00Z');
 const rows=[
  {session_id:'s1',segment_no:1,status:'combined',job_id:'j1',duration_sec:3540,created_at:'2026-10-29T01:00:00Z'},
  {session_id:'s1',segment_no:2,status:'recording',job_id:null,duration_sec:600,created_at:'2026-10-29T02:00:00Z',updated_at:'2026-10-29T02:10:00Z'},
  {session_id:'s2',segment_no:1,status:'combined',job_id:'j2',duration_sec:100,created_at:'2026-10-29T03:00:00Z'},
  {session_id:'s3',segment_no:1,status:'recording',job_id:null,duration_sec:60,created_at:'2026-10-29T04:55:00Z',updated_at:'2026-10-29T04:58:00Z'},
  {session_id:'s4',segment_no:1,status:'combined',job_id:'j4',duration_sec:100,created_at:'2026-10-29T04:00:00Z'},
  {session_id:'s4',segment_no:2,status:'empty',job_id:null,duration_sec:null,created_at:'2026-10-29T04:10:00Z'},
 ];
 const out=r.pendingSessions(rows,[{id:'j1',status:'done'},{id:'j2',status:'done'},{id:'j4',status:'failed'}],now);
 assert.deepEqual(out.map(s=>s.session_id),['s4','s1']);
 assert.equal(out[1].duration_sec,4140);assert.deepEqual(out[1].segments.map(s=>s.status),['combined','recording']);
 assert.deepEqual(out[0].segments,[{segment_no:1,status:'combined',job_id:'j4',job_status:'failed',duration_sec:100}]);
 assert.equal(r.pendingSince(now),'2026-09-29T05:00:00.000Z');
});

test('code shape: owner + own rows, ordered optimistic append, Drive folders fixed, trash only in piece/recording folders, no sound/text in rows or logs',()=>{
 for(const a of ['rec_start','rec_piece','rec_finish','rec_pending'])assert.match(index,new RegExp(`action === '${a}'`));
 assert.match(index,/async function ownRecording[\s\S]*?await requireOwner\(userId, data\.workspace_id\);\s*if \(data\.created_by !== userId\) throw new Fail\('not_found'\);/);
 assert.match(index,/async function ownSession[\s\S]*?const ws = ownRows\(data, userId\);[\s\S]*?await requireOwner\(userId, ws\);/);
 assert.match(index,/update\(patch\)\.eq\('id', rec\.id\)\.eq\('status', 'recording'\)\.eq\('updated_at', rec\.updated_at\)/);
 assert.match(index,/setRec\(seg\.id, \{ status: 'combined', error_code: null, job_id: job\.id \}, \{ status: 'closed' \}\)/);
 assert.match(index,/childFolder\(token, recordings, PIECE_FOLDER, create\)/);assert.equal(r.PIECE_FOLDER,'녹음 조각');
 for(const m of index.matchAll(/moveDriveFileToTrash\(fetch, ([a-zA-Z.]+), ([a-zA-Z]+), token\)/g))assert.ok(['folder','target'].includes(m[2]),m[0]);
 // 전사 작업 표에는 기존 칸만 넣는다(권한이 있는 8칸).
 const ins=index.match(/admin\.from\(TABLE\)\.insert\(\{\s*workspace_id: seg\.workspace_id[\s\S]*?\}\)/)[0];
 for(const k of ins.matchAll(/(\w+):/g))assert.ok(['workspace_id','created_by','status','drive_file_id','file_name','mime_type','size_bytes','duration_sec'].includes(k[1]),k[1]);
 // 구간 표에 넣는 칸도 권한이 있는 5칸만.
 const recIns=index.match(/admin\.from\(REC_TABLE\)\.insert\(\{[\s\S]*?\}\)/)[0];
 for(const k of recIns.matchAll(/(\w+):/g))assert.ok(['workspace_id','created_by','session_id','segment_no','mime_type'].includes(k[1]),k[1]);
 assert.doesNotMatch(index,/from\(REC_TABLE\)\.delete|from\(REC_TABLE\)\.upsert/);
 for(const l of index.matchAll(/console\.(?:log|warn|error)\(([^;]*)\);/g))assert.doesNotMatch(l[1],/name|piece|text|body|value/i,l[0]);
 assert.doesNotMatch(index,new RegExp(['local','session'].map(x=>x+'Storage').join('|')));
 assert.match(index,/x-recording-id, x-piece-seq'/);
 assert.match(index,/if \(e instanceof RecFail\) return json\(recFailBody\(e\.code, e\.extra\)/);
});
