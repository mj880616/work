import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ROOT=new URL('../../',import.meta.url);
const main=readFileSync(new URL('app/public-workspace.js',ROOT),'utf8');
const extras=readFileSync(new URL('app/public-workspace-extras.js',ROOT),'utf8');
const sql=readFileSync(new URL('supabase/migrations/20260921050000_public_workspace_forward_repair.sql',ROOT),'utf8');

test('anonymous workspace clients no longer reference the broad snapshot',()=>{
  assert.doesNotMatch(main,/app_public_projects_snapshot/);
  assert.doesNotMatch(extras,/app_public_projects_snapshot/);
  assert.match(main,/app_public_workspace_index/);
  assert.match(extras,/app_public_workspace_index/);
});

test('public workspace index is narrow and keeps legacy snapshots closed',()=>{
  assert.match(sql,/join public\.app_project_publications pp on pp\.project_id=s\.id and pp\.published/);
  assert.match(sql,/p\.status='published' and p\.visibility='public'/);
  assert.match(sql,/d\.visibility='public'/);
  assert.doesNotMatch(sql,/'tasks'/);
  assert.doesNotMatch(sql,/'events'/);
  assert.match(sql,/grant execute on function public\.app_public_workspace_index\(\) to anon/);
  assert.match(sql,/grant execute on function public\.app_public_project\(text\) to anon/);
  assert.match(sql,/revoke execute on function public\.app_public_projects_snapshot\(\) from anon/);
  assert.doesNotMatch(sql,/grant execute on function public\.app_public_projects_snapshot\(\) to anon/);
});

test('public project cards use the existing single-project route',()=>{
  assert.match(main,/\.\.\/p\/\?slug=/);
  assert.match(main,/state\.tasks=\[\]/);
  assert.match(main,/state\.events=\[\]/);
});
