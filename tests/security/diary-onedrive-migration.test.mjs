import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// JOURNAL-일기원드라이브 1단계 DB: 새 표 2개만. 연결 표는 authenticated·anon·PUBLIC 권한 없음(토큰 보관), 별표 표는 owner 정책 하나.
const stem='20261026140000_diary_onedrive_db';
test('migration: two new tables, token table closed to every client role, stars owner-only, no anon/PUBLIC, record row, expanded rules',()=>{
 const code=readFileSync(`supabase/migrations/${stem}.sql`,'utf8').replace(/--.*$/gm,'');
 assert.doesNotMatch(code,/to\s+(?:anon|public)\b|security definer|disable row level|alter policy|drop policy|create (?:or replace )?function|rtw_/i);
 assert.equal((code.match(/create table/gi)||[]).length,2);
 assert.match(code,/revoke all on table public\.app_onedrive_connections from public, anon, authenticated, service_role;/);
 assert.match(code,/revoke all on table public\.app_diary_stars from public, anon, authenticated, service_role;/);
 // 연결 표에 authenticated로 주는 권한은 없다.
 assert.doesNotMatch(code,/on table public\.app_onedrive_connections to authenticated/);
 assert.doesNotMatch(code,/create policy [^;]*app_onedrive_connections/);
 assert.match(code,/folder_id is not null and folder_name is not null and folder_path is not null/);
 // 2026-10-27: 사진 지우기를 위해 Files.ReadWrite는 받는다. 전체 범위(.All)·앱 폴더·선택 범위만 거절한다.
 const rule=code.match(/scope !~\* '([^']+)'/);
 assert.ok(rule,'scope rule');assert.equal(rule[1],'\\.all|appfolder|selected');
 const refused=new RegExp(rule[1],'i');
 for(const ok of ['files.readwrite offline_access user.read','Files.ReadWrite User.Read'])assert.ok(!refused.test(ok),ok);
 for(const bad of ['files.readwrite.all','files.read.all','Files.ReadWrite.AppFolder','files.readwrite.selected','sites.read.all'])assert.ok(refused.test(bad),bad);
 // 별표 표: 고치기 권한 없음, service_role 권한 없음, 정책 하나.
 assert.doesNotMatch(code,/grant update[^;]*app_diary_stars|app_diary_stars to service_role/i);
 assert.equal((code.match(/create policy/gi)||[]).length,1);
 assert.match(code,/using \(private\.app_is_workspace_owner\(workspace_id\)\)\s+with check \(private\.app_is_workspace_owner\(workspace_id\)\)/);
 assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261026140000', 'diary_onedrive_db'/);
 for(const mode of ['apply','dry-run']){
  const plan=prepareMigration({mode,version:'20261026140000',runId:'1',root:process.cwd()});
  assert.equal(plan.rules,'expanded');
  assert.equal(plan.summaryLines.length,3);
 }
 const rollback=readFileSync(`docs/${stem}.rollback.sql`,'utf8').replace(/--.*$/gm,'');
 assert.match(rollback,/exists \(select 1 from public\.app_diary_stars\) then\s+raise exception/);
 assert.match(rollback,/drop table public\.app_diary_stars;\s+drop table public\.app_onedrive_connections;/);
 for(const f of ['snapshot','precheck','postcheck','rollback'])assert.match(readFileSync(`docs/${stem}.${f}.sql`,'utf8'),/20261026140000/);
});
