import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// JOURNAL-일기원드라이브 DB(1단계): three new tables only. Tokens and the photo index are server-only; stars are owner-RLS.
const stem='20261026090000_journal_onedrive';
const sql=readFileSync(`supabase/migrations/${stem}.sql`,'utf8').replace(/--.*$/gm,'');

test('migration: new tables only, no anon/PUBLIC, no policy on server-only tables, owner RLS on stars',()=>{
 assert.doesNotMatch(sql,/to\s+(?:anon|public)\b|security definer|disable row level|alter policy|drop policy|rtw_|create (?:or replace )?function|create trigger/i);
 assert.deepEqual((sql.match(/alter table [^;]+;/gi)||[]).map(x=>x.replace(/public\.app_\w+/,'T')),Array(3).fill('alter table T enable row level security;'));
 for(const t of ['app_onedrive_connections','app_onedrive_photos','app_diary_photo_stars']){
  assert.match(sql,new RegExp(`alter table public\\.${t} enable row level security;`));
  assert.match(sql,new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated, service_role;`));
 }
 // Only one policy exists in the whole file: the owner policy on stars.
 assert.equal((sql.match(/create policy/gi)||[]).length,1);
 assert.match(sql,/create policy diary_photo_stars_owner_all on public\.app_diary_photo_stars for all to authenticated\s+using \(private\.app_is_workspace_owner\(workspace_id\)\)\s+with check \(private\.app_is_workspace_owner\(workspace_id\)\)/);
 // authenticated never gets the token table or the index.
 assert.doesNotMatch(sql,/to authenticated[^;]*;[\s\S]*?on table public\.app_onedrive_(connections|photos)/);
 for(const grant of sql.match(/grant [^;]+;/gi)||[]){
  if(/app_onedrive_(connections|photos)/.test(grant))assert.match(grant,/to service_role;$/,grant);
  if(/app_diary_photo_stars/.test(grant))assert.match(grant,/to authenticated;$/,grant);
 }
 assert.match(sql,/grant select, delete on table public\.app_diary_photo_stars to authenticated;/);
 assert.match(sql,/grant insert \(workspace_id, source, photo_ref, day\) on table public\.app_diary_photo_stars to authenticated;/);
 assert.doesNotMatch(sql,/grant[^;]*\bupdate\b[^;]*app_diary_photo_stars/i);
 assert.match(sql,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261026090000', 'journal_onedrive'/);
 assert.match(sql,/commit;\s*$/);
});

test('migration: value limits that protect the server-only columns',()=>{
 assert.match(sql,/folder_id ~ '\^\[A-Za-z0-9!_\.:-\]\{1,255\}\$'/);
 assert.match(sql,/sync_cursor ~ '\^https:\/\/graph\\\.microsoft\\\.com\//);
 assert.match(sql,/oauth_state_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
 assert.match(sql,/taken_day = taken_at::date/);
 assert.match(sql,/day_source in \('taken', 'file'\)/);
 assert.match(sql,/source in \('onedrive', 'upload'\)/);
 assert.match(sql,/constraint app_diary_photo_stars_key unique \(workspace_id, source, photo_ref\)/);
 assert.match(sql,/mime_type ~ '\^image\//);
});

test('workflow: expanded rules accept it for apply and dry-run, five pair files exist',()=>{
 for(const mode of ['apply','dry-run']){
  const plan=prepareMigration({mode,version:'20261026090000',runId:'1',root:process.cwd()});
  assert.equal(plan.rules,'expanded');assert.equal(plan.summaryLines.length,3);
 }
 const docs=readdirSync('docs').filter(f=>f.startsWith(stem+'.')).sort();
 assert.deepEqual(docs,[`${stem}.postcheck.sql`,`${stem}.precheck.sql`,`${stem}.rollback.sql`,`${stem}.snapshot.sql`,`${stem}.summary.md`]);
 for(const f of ['snapshot','precheck','postcheck','rollback'])assert.match(readFileSync(`docs/${stem}.${f}.sql`,'utf8'),/20261026090000/);
});

test('rollback: stops when stars exist, drops only the three new tables and the record',()=>{
 const rollback=readFileSync(`docs/${stem}.rollback.sql`,'utf8').replace(/--.*$/gm,'');
 assert.match(rollback,/exists \(select 1 from public\.app_diary_photo_stars\) then\s+raise exception/);
 assert.deepEqual(rollback.match(/drop table [a-z_.]+/g),['drop table public.app_diary_photo_stars','drop table public.app_onedrive_photos','drop table public.app_onedrive_connections']);
 assert.doesNotMatch(rollback,/cascade|truncate|delete from public/i);
 assert.match(rollback,/delete from supabase_migrations\.schema_migrations\s+where version = '20261026090000' and name = 'journal_onedrive';/);
});
