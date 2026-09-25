import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const ROOT=new URL('../../',import.meta.url);
const sql=readFileSync(new URL('supabase/migrations/20260921050000_public_workspace_forward_repair.sql',ROOT),'utf8');
const ownerOnly=readFileSync(new URL('supabase/migrations/20260923074619_web2_project_owner_only.sql',ROOT),'utf8');
const loader=readFileSync(new URL('app/loader-v2.js',ROOT),'utf8');
const publicPost=readFileSync(new URL('p/public-post.js',ROOT),'utf8');

test('retired anonymous workspace clients are absent from the Web2 runtime',()=>{
  for(const path of ['app/public-workspace.js','app/public-workspace-extras.js','app/public-workspace.css']){
    assert.equal(existsSync(new URL(path,ROOT)),false,`${path} must stay retired`);
  }
  assert.doesNotMatch(loader,/public-workspace|app_public_workspace_index/);
});

test('historical repair preserved posts/documents and the owner-only cutover retired projects',()=>{
  assert.match(sql,/p\.status='published' and p\.visibility='public'/);
  assert.match(sql,/d\.visibility='public'/);
  assert.match(sql,/grant execute on function public\.app_public_workspace_index\(\) to anon/);
  assert.match(ownerOnly,/'projects','\[\]'::jsonb/);
  assert.match(ownerOnly,/revoke execute on function public\.app_public_project\(text\) from public,anon,authenticated/);
  assert.match(ownerOnly,/revoke execute on function public\.app_public_projects_snapshot\(\) from public,anon,authenticated/);
  assert.match(ownerOnly,/grant execute on function public\.app_public_workspace_index\(\) to anon/);
});

test('Web1 public post remains independent from the retired workspace client',()=>{
  assert.match(publicPost,/rpc\/app_public_post/);
  assert.doesNotMatch(publicPost,/app_public_workspace_index|app_public_project/);
});
