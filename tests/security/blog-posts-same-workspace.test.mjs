import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// BLOG ① 9절 '남의 게시판·페이지·노트로 글 짝을 못 만듦, 고치기는 두 칸만'. 정책 모양 정적 검사.
// 실제 거절(42501)·두 칸 고치기·글 남은 게시판 지우기 막힘은 tests/auth-handoff/blog-tables-db.test.mjs가 로컬 PostgreSQL에서 확인한다.
const sql=readFileSync('supabase/migrations/20261125113100_blog_tables.sql','utf8').replace(/--.*$/gm,'');
const policy=name=>{const m=sql.match(new RegExp(`create policy ${name} [\\s\\S]*?;`));assert.ok(m,name);return m[0].replace(/\s+/g,' ');};
test('post insert: same-workspace board, share page and kind note; note required',()=>{
 const p=policy('blog_posts_owner_insert');
 assert.match(p,/note_id is not null/);
 assert.match(p,/exists \(select 1 from public\.app_blog_boards g where g\.id = board_id and g\.workspace_id = app_blog_posts\.workspace_id\)/);
 assert.match(p,/exists \(select 1 from public\.app_share_pages p where p\.id = page_id and p\.workspace_id = app_blog_posts\.workspace_id\)/);
 assert.match(p,/exists \(select 1 from public\.app_notes n where n\.id = note_id and n\.workspace_id = app_blog_posts\.workspace_id and n\.kind = 'note'\)/);
 assert.match(policy('blog_posts_owner_update'),/exists \(select 1 from public\.app_blog_boards g where g\.id = board_id and g\.workspace_id = app_blog_posts\.workspace_id\)/);
 assert.match(policy('blog_boards_owner_insert'),/exists \(select 1 from public\.app_blogs b where b\.id = blog_id and b\.workspace_id = app_blog_boards\.workspace_id\)/);
});
test('column grants: post update = board_id and republished_at only; keys and times are made by the database',()=>{
 assert.match(sql,/grant update \(board_id, republished_at\) on table public\.app_blog_posts to authenticated;/);
 assert.match(sql,/grant insert \(workspace_id, board_id, page_id, note_id\) on table public\.app_blog_posts to authenticated;/);
 assert.match(sql,/grant insert \(workspace_id, blog_id, name, sort\) on table public\.app_blog_boards to authenticated;/);
 assert.match(sql,/grant update \(name, sort\) on table public\.app_blog_boards to authenticated;/);
 assert.equal((sql.match(/grant (?:insert|update) \([^)]*public_key[^)]*\)/g)||[]).length,0);
 assert.match(sql,/constraint app_blog_posts_page_key unique \(page_id\)/);
 assert.match(sql,/constraint app_blog_posts_note_key unique \(note_id\)/);
 assert.match(sql,/board_id uuid not null references public\.app_blog_boards\(id\),/);
});
test('the database test runs in CI',()=>{
 const pkg=JSON.parse(readFileSync('tests/auth-handoff/package.json','utf8'));
 assert.match(pkg.scripts.test,/ blog-tables-db\.test\.mjs\b/);
});
