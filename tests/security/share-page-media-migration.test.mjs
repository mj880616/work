import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// ED-통합편집기 ②: DB part only (share photo records table).
test('migration: new table only, owner RLS, no anon/PUBLIC, service_role three columns, record row, expanded rules',()=>{
 const stem='20261023110000_share_page_media';
 const code=readFileSync(`supabase/migrations/${stem}.sql`,'utf8').replace(/--.*$/gm,'');
 assert.doesNotMatch(code,/to\s+(?:anon|public)\b|security definer|disable row level|alter policy|drop policy|rtw_/i);
 assert.match(code,/revoke all on table public\.app_share_page_media from public, anon, authenticated, service_role;/);
 assert.match(code,/grant select \(id, page_id, storage_path\) on table public\.app_share_page_media to service_role;/);
 assert.match(code,/using \(private\.app_is_workspace_owner\(workspace_id\)\)/);
 assert.match(code,/storage_path = page_id::text \|\| '\/' \|\| id::text \|\| '\.jpg'/);
 assert.doesNotMatch(code,/grant update/i);
 assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261023110000', 'share_page_media'/);
 for(const mode of ['apply','dry-run']){
  const plan=prepareMigration({mode,version:'20261023110000',runId:'1',root:process.cwd()});
  assert.equal(plan.rules,'expanded');assert.equal(plan.summaryLines.length,3);
 }
 const rollback=readFileSync(`docs/${stem}.rollback.sql`,'utf8').replace(/--.*$/gm,'');
 assert.match(rollback,/exists \(select 1 from public\.app_share_page_media\) then\s+raise exception/);
 for(const f of ['snapshot','precheck','postcheck','rollback'])assert.match(readFileSync(`docs/${stem}.${f}.sql`,'utf8'),/20261023110000/);
});
