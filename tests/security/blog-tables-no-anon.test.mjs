import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';
// BLOG ① 9절 '사본 표에 익명 직접 권한 없음'. migration 정적 검사 + 짝 postcheck SQL 항목. 실제 권한은 tests/auth-handoff/blog-tables-db.test.mjs.
const stem='20261125113100_blog_tables';
const raw=readFileSync('supabase/migrations/'+stem+'.sql','utf8'),sql=raw.replace(/--.*$/gm,'');
const tables=['app_blogs','app_blog_boards','app_blog_posts'];

test('RLS on, hosted defaults revoked, no anon/PUBLIC grant or policy, no definer, existing share/note tables untouched',()=>{
 for(const t of tables)assert.match(sql,new RegExp(`alter table public\\.${t} enable row level security;`));
 assert.match(sql,/revoke all on table public\.app_blogs, public\.app_blog_boards, public\.app_blog_posts from public, anon, authenticated, service_role;/);
 assert.doesNotMatch(sql,/\bto\s+(?:anon|public)\b|disable row level|security definer|force row level|grant [^;]* to [^;]*\b(?:anon|public)\b/i);
 assert.doesNotMatch(sql,/alter table public\.(?:app_share_pages|app_notes|app_share_page_links|app_share_page_media)|create policy \w+ on public\.(?:app_share|app_notes)|drop policy|rtw_/i);
 const grants=[...sql.matchAll(/grant ([^;]+) on table ([^;]+) to (\w+);/g)].map(m=>[m[1],m[2],m[3]]);
 for(const [,,role] of grants)assert.ok(['authenticated','service_role'].includes(role),role);
 const service=grants.filter(g=>g[2]==='service_role');
 assert.deepEqual(service.map(g=>g[0]+' '+g[1]),[
  'select (id, workspace_id, title, intro, enabled, indexable) public.app_blogs',
  'select (id, blog_id, name, sort, public_key) public.app_blog_boards',
  'select (board_id, page_id, note_id, public_key, published_at, republished_at) public.app_blog_posts']);
});
test('approved DB workflow accepts it under the expanded rules with all five pair files; postcheck covers the no-anon items',()=>{
 const plan=prepareMigration({mode:'apply',version:'20261125113100',runId:'1',root:process.cwd()});
 assert.equal(plan.rules,'expanded');assert.deepEqual([...plan.createdTables].sort(),[...tables].sort());
 assert.equal(plan.review.definer.length,0);
 for(const ext of ['precheck.sql','snapshot.sql','postcheck.sql','rollback.sql','summary.md'])assert.ok(readFileSync('docs/'+stem+'.'+ext,'utf8').length>100,ext);
 const post=readFileSync('docs/'+stem+'.postcheck.sql','utf8');
 for(const item of ['new tables RLS enabled','new tables four owner policies each','new tables no anon or public privilege','service_role reads only'])assert.ok(post.includes(`'${item}'`),item);
 assert.doesNotMatch(readFileSync('docs/'+stem+'.snapshot.sql','utf8').replace(/--.*$/gm,''),/from public\.app_/);
 // 마이그레이션 안의 사후 확인도 같은 조건으로 전체 취소한다.
 assert.match(raw,/BLOG_TABLES_POSTCHECK_FAILED/);
 assert.match(raw,/insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s*values \('20261125113100', 'blog_tables'/);
});
