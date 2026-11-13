import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// BRIEF-브리핑룸 PR ①(DB만, 설계 docs/design/brief-room.md 3절): 브리핑 작업 표 1개. 함수·트리거 없음.
// 정적 검사만 한다(권한을 넓히지 않는지, 짝 파일이 다 있는지).
const version='20261113220000',name='document_briefs',stem=`${version}_${name}`;
const code=readFileSync(`supabase/migrations/${stem}.sql`,'utf8').replace(/--.*$/gm,'');
const T='public\\.app_document_briefs';

test('migration: one new table, owner read RLS, no anon/PUBLIC, service_role listed columns only, no delete',()=>{
 assert.doesNotMatch(code,/\bto\s+(?:anon|public)\b|disable row level|alter policy|drop policy|create trigger|create (?:or replace )?function|security definer|rtw_|grant delete|grant all|cron\./i);
 assert.deepEqual(code.match(/alter table[^;]*;/g),['alter table public.app_document_briefs enable row level security;']);
 assert.equal((code.match(/create table/g)||[]).length,1);
 assert.equal((code.match(/create policy/g)||[]).length,1);
 assert.match(code,new RegExp(`create policy document_briefs_owner_read on ${T} for select to authenticated\\s+using \\(private\\.app_is_workspace_owner\\(workspace_id\\)\\);`));
 assert.match(code,new RegExp(`revoke all on table ${T} from public, anon, authenticated, service_role;`));
 assert.doesNotMatch(code,/grant (?:insert|update|execute)[^;]*to authenticated/i);
 const grants=code.match(/grant [^;]*;/g);
 assert.equal(grants.length,4);
 for(const g of grants)assert.match(g,new RegExp(`on table ${T} to (?:authenticated|service_role);$`));
 // 서버가 넣을 때도 결과(brief)·글(source_text)은 넣지 못하고, 주인·자료 칸은 고치지 못한다.
 const ins=code.match(/grant insert \(([^)]*)\)/)[1].split(',').map(s=>s.trim());
 const upd=code.match(/grant update \(([^)]*)\)/)[1].split(',').map(s=>s.trim());
 for(const c of ['id','brief','source_text','created_at'])assert.ok(!ins.includes(c),c);
 for(const c of ['id','workspace_id','created_by','document_id','source_file_id','source_md5','created_at'])assert.ok(!upd.includes(c),c);
 for(const mode of ['apply','dry-run']){
  const plan=prepareMigration({mode,version,runId:'1',root:process.cwd()});
  assert.equal(plan.rules,'expanded');assert.equal(plan.summaryLines.length,3);
  assert.deepEqual(plan.createdTables,['app_document_briefs']);
  assert.deepEqual(plan.targets,[]);
  assert.deepEqual(plan.review.definer,[]);
  assert.equal(plan.review.policies,1);assert.equal(plan.review.triggers,0);
 }
 for(const ext of ['precheck.sql','snapshot.sql','postcheck.sql','rollback.sql','summary.md'])assert.ok(existsSync(`docs/${stem}.${ext}`),ext);
 assert.match(code,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261113220000', 'document_briefs'/);
 assert.match(code,/\ncommit;\s*$/);
});

test('rollback: drops only the new table and its history row',()=>{
 const rb=readFileSync(`docs/${stem}.rollback.sql`,'utf8').replace(/--.*$/gm,'');
 assert.deepEqual(rb.match(/drop [^;]*;/g),['drop table public.app_document_briefs;']);
 assert.match(rb,/delete from supabase_migrations\.schema_migrations\s+where version = '20261113220000' and name = 'document_briefs';/);
});
