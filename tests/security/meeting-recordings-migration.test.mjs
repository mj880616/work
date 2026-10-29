import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// MTG-노트북녹음 1단계 DB: 녹음 구간 표(조각 Drive 위치·순서·길이·진행 상태만, 소리·전사 글 없음).
const stem='20261029200000_meeting_recordings';
const code=readFileSync(`supabase/migrations/${stem}.sql`,'utf8').replace(/--.*$/gm,'');

test('migration: new table only, owner read RLS, no anon/PUBLIC, service_role column grants, record row, expanded rules',()=>{
 assert.doesNotMatch(code,/to\s+(?:anon|public)\b|security definer|disable row level|alter policy|drop policy|alter table public\.app_meeting_transcribe_jobs|rtw_|grant delete|grant all/i);
 assert.match(code,/revoke all on table public\.app_meeting_recordings from public, anon, authenticated, service_role;/);
 assert.match(code,/grant select on table public\.app_meeting_recordings to authenticated;/);
 assert.doesNotMatch(code,/grant (?:insert|update)[^;]*to authenticated/i);
 assert.match(code,/grant insert \(workspace_id, created_by, session_id, segment_no, mime_type\)/);
 assert.match(code,/grant update \(status, error_code, piece_ids, size_bytes, duration_sec, job_id, pieces_trashed_at, closed_at, updated_at\)/);
 // 기존 표에는 권한을 더하지 않는다(참조만).
 for(const g of code.matchAll(/grant [^;]*;/g))assert.match(g[0],/on table public\.app_meeting_recordings to (?:authenticated|service_role);$/);
 assert.match(code,/using \(private\.app_is_workspace_owner\(workspace_id\)\)/);
 assert.match(code,/create unique index app_meeting_recordings_one_open_idx[^;]*where status = 'recording';/);
 assert.match(code,/constraint app_meeting_recordings_segment_unique unique \(session_id, segment_no\)/);
 assert.match(code,/size_bytes between 0 and 104857600/);
 assert.match(code,/duration_sec between 1 and 3600/);
 assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261029200000', 'meeting_recordings'/);
 for(const mode of ['apply','dry-run']){
  const plan=prepareMigration({mode,version:'20261029200000',runId:'1',root:process.cwd()});
  assert.equal(plan.rules,'expanded');assert.equal(plan.flow,'full');assert.equal(plan.summaryLines.length,3);
 }
 for(const f of ['snapshot','precheck','postcheck','rollback'])assert.match(readFileSync(`docs/${stem}.${f}.sql`,'utf8'),/20261029200000/);
});

test('no sound or transcript column: sound lives in Drive, text only in the meeting record',()=>{
 const table=code.match(/create table public\.app_meeting_recordings \(([\s\S]*?)\n\);/)[1];
 assert.doesNotMatch(table,/transcript|text_body|output_text|summary|bytea|audio_data/i);
 const cols=[...table.matchAll(/^\s{2}([a-z_]+) (?:uuid|text\[\]|text|bigint|integer|timestamptz)/gm)].map(m=>m[1]);
 assert.deepEqual(cols,['id','workspace_id','created_by','session_id','segment_no','status','error_code','mime_type','piece_ids','size_bytes','duration_sec','job_id','pieces_trashed_at','closed_at','created_at','updated_at']);
});

test('pair checks read the catalog only; rollback drops only the new table and the record row',()=>{
 for(const f of ['snapshot','precheck','postcheck'])assert.doesNotMatch(readFileSync(`docs/${stem}.${f}.sql`,'utf8'),/information_schema|from public\.app_/i);
 const rollback=readFileSync(`docs/${stem}.rollback.sql`,'utf8').replace(/--.*$/gm,'');
 assert.equal((rollback.match(/drop table/g)||[]).length,1);
 assert.match(rollback,/drop table public\.app_meeting_recordings;/);
 assert.match(rollback,/delete from supabase_migrations\.schema_migrations\s+where version = '20261029200000' and name = 'meeting_recordings';\s*commit;\s*$/);
});
