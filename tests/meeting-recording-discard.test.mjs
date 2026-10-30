import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as r from '../supabase/functions/meeting-transcribe/recording.mjs';

// 노트북 녹음 [버리기]·[되돌리기](요청함 10/30 10:01): Edge meeting-transcribe rec_discard·rec_restore 규칙과 코드 모양(소유자·남의 녹음 거절·휴지통만).
const index=readFileSync('supabase/functions/meeting-transcribe/index.ts','utf8');
const recorder=readFileSync('app/meeting-recorder.js','utf8');
const code=f=>{try{f();return 'ok'}catch(e){return e.code}};
const ME='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',WS='33333333-3333-4333-8333-333333333333';
const row=(o={})=>({id:'r1',workspace_id:WS,created_by:ME,session_id:'s',segment_no:1,status:'closed',error_code:null,piece_ids:['aaaaaaaaaa1'],job_id:null,closed_at:null,updated_at:'2026-10-30T01:00:00Z',...o});
const fnBody=name=>{const m=index.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n}\\n`));assert.ok(m,name);return m[0]};

test('own rows: only this person in one workspace; other people\'s recording is not found',()=>{
 assert.equal(r.ownRows([row(),row({id:'r2',segment_no:2})],ME),WS);
 assert.equal(code(()=>r.ownRows([row({created_by:OTHER})],ME)),'not_found');
 assert.equal(code(()=>r.ownRows([row(),row({id:'r2',created_by:OTHER})],ME)),'not_found');
 assert.equal(code(()=>r.ownRows([row(),row({id:'r2',workspace_id:OTHER})],ME)),'not_found');
 assert.equal(code(()=>r.ownRows([],ME)),'not_found');
 assert.equal(code(()=>r.ownRows([row()],'')),'not_found');
});

test('discard plan: open/closed pieces, unfinished combined file; never done, attached, running or empty',()=>{
 const rows=[
  row({id:'a',status:'recording'}),
  row({id:'b',status:'closed',segment_no:2}),
  row({id:'c',status:'combined',segment_no:3,job_id:'j1'}),
  row({id:'d',status:'combined',segment_no:4,job_id:'j2'}),
  row({id:'e',status:'combined',segment_no:5,job_id:'j3'}),
  row({id:'f',status:'empty',segment_no:6,piece_ids:[]}),
  row({id:'g',status:'recording',segment_no:7,piece_ids:[]}),
  row({id:'h',status:'failed',segment_no:8,error_code:'expired'}),
 ];
 const jobs=[{id:'j1',status:'uploaded',meeting_id:null,trashed_at:null},{id:'j2',status:'done',meeting_id:null},{id:'j3',status:'failed',meeting_id:'m1'}];
 const plan=r.discardPlan(rows,jobs);
 assert.deepEqual(plan.map(p=>[p.row.id,p.kind]),[['a','pieces'],['b','pieces'],['c','combined'],['g','close']]);
 assert.equal(plan[2].job.id,'j1');
 assert.equal(code(()=>r.discardPlan([row({status:'combined',job_id:'j1'})],[{id:'j1',status:'running'}])),'busy');
 // 버릴 것(조각·합친 파일)이 없으면 not_found(빈 열린 구간만 있으면 닫기만 할 일이라 버린 것이 없다).
 assert.equal(code(()=>r.discardPlan([row({status:'recording',piece_ids:[]})],[])),'not_found');
 assert.equal(code(()=>r.discardPlan([row({status:'failed',error_code:'discarded_closed'})],[])),'not_found');
});

test('discard patch keeps the way back; restore plan only for discarded rows',()=>{
 const now=new Date('2026-10-30T01:10:00Z');
 assert.deepEqual(r.discardPatch(row({status:'recording'}),'pieces',now),{status:'failed',error_code:'discarded_closed',closed_at:now.toISOString(),updated_at:now.toISOString()});
 assert.equal(r.discardPatch(row({closed_at:'2026-10-30T01:05:00Z'}),'pieces',now).closed_at,'2026-10-30T01:05:00Z');
 assert.equal(r.discardPatch(row({status:'combined',job_id:'j1'}),'combined',now).error_code,'discarded_combined');
 assert.equal(r.discardPatch(row({status:'recording',piece_ids:[]}),'close',now).status,'empty');
 // DB 제약(error_code ^[a-z_]{1,40}$, status 5가지) 안의 값만 쓴다(칸·제약 추가 없음).
 const sql=readFileSync('supabase/migrations/20261029200000_meeting_recordings.sql','utf8');
 assert.match(sql,/status in \('recording', 'closed', 'combined', 'empty', 'failed'\)/);
 for(const c of ['discarded_closed','discarded_combined'])assert.match(c,/^[a-z_]{1,40}$/);
 const plan=r.restorePlan([row({id:'a',status:'failed',error_code:'discarded_closed'}),row({id:'b',status:'failed',error_code:'discarded_combined',job_id:'j1'}),
  row({id:'c',status:'failed',error_code:'expired'}),row({id:'d',status:'closed'}),row({id:'e',status:'failed',error_code:'discarded_combined',job_id:null})]);
 assert.deepEqual(plan.map(p=>[p.row.id,p.to]),[['a','closed'],['b','combined'],['e','closed']]);
 assert.equal(code(()=>r.restorePlan([row({status:'failed',error_code:'expired'})])),'not_found');
 // 버린 녹음은 '이어서 정리'에서 빠지고, 되돌린 녹음은 다시 나온다.
 const at=new Date('2026-10-30T02:00:00Z');
 assert.deepEqual(r.pendingSessions([row({status:'failed',error_code:'discarded_closed',created_at:'2026-10-30T01:00:00Z'})],[],at),[]);
 assert.equal(r.pendingSessions([row({status:'closed',created_at:'2026-10-30T01:00:00Z'})],[],at).length,1);
});

test('code shape: owner check first, guarded writes, Drive trash/untrash only in fixed folders, no delete, sweep does not undo the mark',()=>{
 for(const a of ['rec_discard','rec_restore'])assert.match(index,new RegExp(`action === '${a}'\\) return await rec(Discard|Restore)\\(user, body\\)`));
 const discard=fnBody('recDiscard'),restore=fnBody('recRestore');
 // 소유자 확인(requireOwner)과 남의 녹음 거절(ownRows)은 ownSession 한 곳: 두 동작 모두 첫 읽기가 ownSession.
 assert.match(index,/async function ownSession[\s\S]*?const ws = ownRows\(data, userId\);[\s\S]*?await requireOwner\(userId, ws\);/);
 assert.match(discard,/^async function recDiscard[^\n]*\n(?:\s*\/\/[^\n]*\n)*[\s\S]{0,200}?await ownSession\(user\.id, body\.session_id\)/);
 assert.match(restore,/^async function recRestore[^\n]*\n\s*const rows = await ownSession\(user\.id, body\.session_id\);/);
 // 작업공간 id를 몸통에서 받지 않는다(행의 작업공간만).
 assert.doesNotMatch(discard+restore,/body\.workspace_id/);
 // 상태 바꾸기는 읽은 그대로일 때만(동시에 붙는 조각을 놓치지 않음), 되돌리기는 버림 표시일 때만.
 assert.match(discard,/setRec\(p\.row\.id, discardPatch\(p\.row, p\.kind, at\), \{ status: p\.row\.status, updated_at: p\.row\.updated_at \}\)/);
 assert.match(restore,/\{ status: 'failed', error_code: p\.row\.error_code \}/g);
 // 휴지통만(영구 삭제 없음), 정한 폴더만.
 assert.doesNotMatch(discard+restore,/method: 'DELETE'|\.delete\(/);
 assert.match(discard,/moveDriveFileToTrash\(fetch, job\.drive_file_id, target, token\)/);
 assert.match(discard,/trashPieces\(p\.row, token, folder\)/);
 assert.match(restore,/untrashDriveFile\(job\.drive_file_id, target, token\)/);
 assert.match(restore,/untrashDriveFile\(id, folder, token\)/);
 const untrash=fnBody('untrashDriveFile');
 assert.match(untrash,/meta\.ownedByMe !== true \|\| meta\.mimeType === FOLDER \|\| !Array\.isArray\(meta\.parents\) \|\| meta\.parents\.length !== 1 \|\| meta\.parents\[0\] !== folder\) return 'not_ours'/);
 assert.match(untrash,/JSON\.stringify\(\{ trashed: false \}\)/);
 // 전사·요약·초안을 부르지 않는다.
 assert.doesNotMatch(discard+restore,/[^-]transcribe\(|Gemini|GEM\b|combineSegment/);
 // 30일 정리: 버린 구간은 휴지통 넣기만 다시 하고 상태는 그대로(expired로 덮지 않음).
 const sweep=fnBody('sweepRecordings');
 assert.match(sweep,/\.eq\('status', 'failed'\)\s*\.like\('error_code', 'discarded%'\)\.is\('pieces_trashed_at', null\)/);
 assert.match(sweep,/for \(const seg of dropped \|\| \[\]\) await trashPieces\(seg, token, folder\);/);
 assert.match(sweep,/seg\.status === 'failed' \? \{\} :/);
 for(const l of index.matchAll(/console\.(?:log|warn|error)\(([^;]*)\);/g))assert.doesNotMatch(l[1],/name|piece|text|body|value/i,l[0]);
});

test('screen: [버리기] after [멈추고 정리] in the band and in the pending line, red, small notice with undo (no browser dialogs, no device storage)',()=>{
 assert.match(recorder,/data-rec="stop">멈추고 정리<\/button><button type="button" class="rec-btn rec-discard" data-rec="discard">버리기<\/button>/);
 assert.match(recorder,/data-rec-resume="[^"]*">이어서 정리<\/button><button type="button" class="rec-btn rec-discard" data-rec-discard="/);
 assert.match(readFileSync('app/meeting-recorder.css','utf8'),/\.rec-btn\.rec-discard\{color:var\(--kptu-danger\)\}/);
 assert.match(recorder,/import \{notify\} from '\.\/small-notice\.js';/);
 assert.match(recorder,/notify\('녹음을 버렸어요',\{label:'녹음 버리기',ms:DISCARD_NOTICE_MS,undo:/);
 assert.match(recorder,/DISCARD_NOTICE_MS=10000/);
 assert.match(recorder,/call\('rec_discard',\{session_id:sid\}\)/);assert.match(recorder,/call\('rec_restore',\{session_id:sid\}\)/);
 assert.doesNotMatch(recorder,/\b(?:alert|confirm)\(/);
 assert.doesNotMatch(recorder,new RegExp(['local','session'].map(x=>x+'Storage').join('|')));
 // 띠의 [버리기]: 마이크를 바로 끄고, 정리 흐름(finishSession·openDraft)을 부르지 않는다.
 const live=recorder.match(/async function discardLive\(\)\{[\s\S]*?\n\}/)[0];
 assert.match(live,/releaseStream\(\);/);
 assert.doesNotMatch(live,/finishSession|openDraft|transcribe/);
});
