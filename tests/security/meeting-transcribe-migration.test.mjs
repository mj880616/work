import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// MTG-녹음초안 2단계 DB: 전사 작업 표(진행 상태·녹음 Drive 위치만, 전사 글 없음).
const stem='20261029070000_meeting_transcribe_jobs';
const code=readFileSync(`supabase/migrations/${stem}.sql`,'utf8').replace(/--.*$/gm,'');

test('migration: new table only, owner read RLS, no anon/PUBLIC, service_role column grants, record row, expanded rules',()=>{
 assert.doesNotMatch(code,/to\s+(?:anon|public)\b|security definer|disable row level|alter policy|drop policy|rtw_|grant delete|grant all/i);
 assert.match(code,/revoke all on table public\.app_meeting_transcribe_jobs from public, anon, authenticated, service_role;/);
 assert.match(code,/grant select on table public\.app_meeting_transcribe_jobs to authenticated;/);
 assert.doesNotMatch(code,/grant (?:insert|update)[^;]*to authenticated/i);
 assert.match(code,/grant update \(status, error_code, model, meeting_id, started_at, finished_at, trashed_at, updated_at\)/);
 assert.match(code,/using \(private\.app_is_workspace_owner\(workspace_id\)\)/);
 assert.match(code,/create unique index app_meeting_transcribe_jobs_one_running_idx[^;]*where status = 'running';/);
 assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261029070000', 'meeting_transcribe_jobs'/);
 for(const mode of ['apply','dry-run']){
  const plan=prepareMigration({mode,version:'20261029070000',runId:'1',root:process.cwd()});
  assert.equal(plan.rules,'expanded');assert.equal(plan.summaryLines.length,3);
 }
 for(const f of ['snapshot','precheck','postcheck','rollback'])assert.match(readFileSync(`docs/${stem}.${f}.sql`,'utf8'),/20261029070000/);
});

test('no transcript text column: the original text lives only in the meeting record',()=>{
 const table=code.match(/create table public\.app_meeting_transcribe_jobs \(([\s\S]*?)\n\);/)[1];
 assert.doesNotMatch(table,/transcript|text_body|output_text|summary/i);
 const cols=[...table.matchAll(/^\s{2}([a-z_]+) (?:uuid|text|bigint|integer|timestamptz)/gm)].map(m=>m[1]);
 assert.deepEqual(cols,['id','workspace_id','created_by','status','error_code','drive_file_id','file_name','mime_type','size_bytes','duration_sec','model','meeting_id','started_at','finished_at','trashed_at','created_at','updated_at']);
});

test('rollback drops only the new table and the record row',()=>{
 const rollback=readFileSync(`docs/${stem}.rollback.sql`,'utf8').replace(/--.*$/gm,'');
 assert.equal((rollback.match(/drop table/g)||[]).length,1);
 assert.match(rollback,/drop table public\.app_meeting_transcribe_jobs;/);
 assert.match(rollback,/delete from supabase_migrations\.schema_migrations\s+where version = '20261029070000' and name = 'meeting_transcribe_jobs';\s*commit;\s*$/);
});
