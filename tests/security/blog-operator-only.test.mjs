import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {store,handler,read,WS_OP,WS_OTHER,KEYS} from './blog-read-harness.mjs';
// BLOG ① 9절 '운영자 아닌 사람의 블로그 게시 요청 서버 거절'. 쓰기 거절은 RLS(정책 12개가 모두 blog 허용을 요구 — 아래 정적 검사, 실제 거절은
// tests/auth-handoff/blog-tables-db.test.mjs가 로컬 PostgreSQL에서 확인). 읽기는 서버 허용 표가 정한 작업공간 하나만 내주고 요청 값으로 못 고른다.
const sql=readFileSync('supabase/migrations/20261125113100_blog_tables.sql','utf8').replace(/--.*$/gm,'');

test('every blog policy requires the owner and the blog allow row (12 policies, authenticated only)',()=>{
 const policies=[...sql.matchAll(/create policy (\w+) on public\.(app_blog\w*) for (\w+) to (\w+)([\s\S]*?);/g)];
 assert.equal(policies.length,12);
 for(const [,name,table,cmd,role,body] of policies){
  assert.equal(role,'authenticated',name);
  const parts=[...body.matchAll(/(using|with check) \(/g)].length;
  assert.equal(parts,cmd==='update'?2:1,name);
  assert.equal((body.match(/private\.app_is_workspace_owner\(workspace_id\) and private\.app_workspace_has_feature\(workspace_id, 'blog'\)/g)||[]).length,parts,name);
  assert.ok(['app_blogs','app_blog_boards','app_blog_posts'].includes(table));
 }
 // 허용 행은 calls 작업공간 하나에만(이름·메일·고정 id 없음), 화면·API로 넣는 길 없음.
 assert.match(sql,/insert into public\.app_operator_features \(workspace_id, feature\)\s*select f\.workspace_id, 'blog' from public\.app_operator_features f where f\.feature = 'calls';/);
 assert.doesNotMatch(sql,/security definer|create function|grant [^;]*app_operator_features/i);
});
test('reader serves only the single allowed workspace; request values cannot pick a workspace or a person',async()=>{
 const s=store(),h=handler(s);
 const home=JSON.parse((await read(h,{blog:'home'})).text);
 assert.equal(home.blog.title,'명진 블로그');
 assert.deepEqual(home.boards.map(b=>b.key),[KEYS.boardA,KEYS.boardB]);
 assert.ok(s.calls.filter(c=>c[0]==='blogByWorkspace').every(c=>c[1]===WS_OP));
 for(const body of [{blog:'home',workspace:WS_OTHER},{blog:'home',workspace_id:WS_OTHER},{blog:'home',user:'x'},{blog:'board',board:KEYS.boardOther},{blog:'post',post:KEYS.postOther}]){
  const r=await read(h,body);assert.equal(r.status,404,JSON.stringify(body));assert.equal(r.text,'{"error":"not_found"}');
 }
 assert.ok(!s.calls.some(c=>c[0]==='blogByWorkspace'&&c[1]===WS_OTHER),'other workspace never read');
});
test('no allow row, or more than one allowed workspace: every blog request is 404',async()=>{
 for(const allow of [[],[{workspace_id:WS_OP,feature:'blog'},{workspace_id:WS_OTHER,feature:'blog'}],[{workspace_id:WS_OP,feature:'calls'}]]){
  const s=store();s.allow=allow;const h=handler(s);
  for(const body of [{blog:'home'},{blog:'board',board:KEYS.boardA},{blog:'post',post:KEYS.postA}])assert.equal((await read(h,body)).status,404);
  assert.ok(!s.calls.some(c=>c[0]==='blogByWorkspace'));
 }
 // 어느 작업공간을 볼지는 언제나 서버 허용 표(SQL로만 바뀜)가 정한다 — 요청과 무관.
 const s=store();s.allow=[{workspace_id:WS_OTHER,feature:'blog'}];
 await read(handler(s),{blog:'home'});
 assert.ok(s.calls.filter(c=>c[0]==='blogByWorkspace').every(c=>c[1]===WS_OTHER));
});
test('a reader without the blog part answers 404 (older deploy safety)',async()=>{
 const r=reader0();
 const {createShareReadHandler}=await import('../../supabase/functions/share-page-read/handler.ts');
 const h=createShareReadHandler(r,{log:()=>{}});
 assert.equal((await read(h,{blog:'home'})).status,404);
 function reader0(){return {async linkByHash(){return null;},async pageById(){return null;}};}
});
