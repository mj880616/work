import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// PHOTO-사진메뉴 ②단계 DB: 앨범(#태그) 표 2개(이름·대표 / 사진 열쇠만, 사진 파일 없음).
const stem='20261029150000_photo_tags';
const code=readFileSync(`supabase/migrations/${stem}.sql`,'utf8').replace(/--.*$/gm,'');

test('migration: two new tables only, owner RLS, no anon/PUBLIC/service_role, record row, expanded rules',()=>{
 assert.doesNotMatch(code,/to\s+(?:anon|public|service_role)\b|security definer|disable row level|alter policy|drop policy|rtw_|grant all|create (?:or replace )?function|create trigger/i);
 for(const t of ['app_photo_tags','app_photo_tag_items']){
  assert.match(code,new RegExp(`alter table public\\.${t} enable row level security;`));
  assert.match(code,new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated, service_role;`));
  assert.match(code,new RegExp(`grant select, delete on table public\\.${t} to authenticated;`));
 }
 assert.match(code,/grant insert \(workspace_id, name, cover_key\) on table public\.app_photo_tags to authenticated;/);
 assert.match(code,/grant update \(name, cover_key, updated_at\) on table public\.app_photo_tags to authenticated;/);
 assert.match(code,/grant insert \(tag_id, workspace_id, source, item_key, taken_day\) on table public\.app_photo_tag_items to authenticated;/);
 assert.doesNotMatch(code,/grant update[^;]*app_photo_tag_items/i,'items are never updated');
 assert.equal((code.match(/using \(private\.app_is_workspace_owner\(workspace_id\)\)/g)||[]).length,2);
 assert.equal((code.match(/with check \(private\.app_is_workspace_owner\(workspace_id\)\)/g)||[]).length,2);
 assert.match(code,/foreign key \(tag_id, workspace_id\) references public\.app_photo_tags\(id, workspace_id\) on delete cascade/);
 assert.match(code,/create unique index app_photo_tags_name_idx on public\.app_photo_tags\(workspace_id, lower\(name\)\);/);
 assert.match(code,/name !~ '\[#\[:space:\]\]'/);
 assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261029150000', 'photo_tags'/);
 for(const mode of ['apply','dry-run']){
  const plan=prepareMigration({mode,version:'20261029150000',runId:'1',root:process.cwd()});
  assert.equal(plan.rules,'expanded');assert.equal(plan.summaryLines.length,3);
 }
 for(const f of ['snapshot','precheck','postcheck','rollback'])assert.match(readFileSync(`docs/${stem}.${f}.sql`,'utf8'),/20261029150000/);
});

test('no photo bytes, address or location column: tags hold names and photo keys only',()=>{
 for(const t of ['app_photo_tags','app_photo_tag_items']){
  const body=code.match(new RegExp(`create table public\\.${t} \\(([\\s\\S]*?)\\n\\);`))[1];
  assert.doesNotMatch(body,/url|bytes|blob|lat|lon|location|path/i);
 }
});

test('rollback drops only the two new tables and the record row',()=>{
 const rollback=readFileSync(`docs/${stem}.rollback.sql`,'utf8').replace(/--.*$/gm,'');
 assert.equal((rollback.match(/drop table/g)||[]).length,2);
 assert.match(rollback,/drop table public\.app_photo_tag_items;\s*drop table public\.app_photo_tags;/);
 assert.match(rollback,/delete from supabase_migrations\.schema_migrations\s+where version = '20261029150000' and name = 'photo_tags';\s*commit;\s*$/);
});
