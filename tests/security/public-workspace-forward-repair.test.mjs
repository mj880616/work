import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ROOT=new URL('../../',import.meta.url);
const main=readFileSync(new URL('app/public-workspace.js',ROOT),'utf8');
const extras=readFileSync(new URL('app/public-workspace-extras.js',ROOT),'utf8');
const sql=readFileSync(new URL('supabase/migrations/20260921050000_public_workspace_forward_repair.sql',ROOT),'utf8');
const ownerOnly=readFileSync(new URL('supabase/migrations/20260923074619_web2_project_owner_only.sql',ROOT),'utf8');

test('anonymous workspace clients no longer reference the broad snapshot',()=>{
  assert.doesNotMatch(main,/app_public_projects_snapshot/);
  assert.doesNotMatch(extras,/app_public_projects_snapshot/);
  assert.match(main,/app_public_workspace_index/);
  assert.match(extras,/app_public_workspace_index/);
});

test('public workspace keeps posts and documents while the owner-only cutover retires projects',()=>{
  assert.match(sql,/p\.status='published' and p\.visibility='public'/);
  assert.match(sql,/d\.visibility='public'/);
  assert.match(sql,/grant execute on function public\.app_public_workspace_index\(\) to anon/);
  assert.match(ownerOnly,/'projects','\[\]'::jsonb/);
  assert.match(ownerOnly,/revoke execute on function public\.app_public_project\(text\) from public,anon,authenticated/);
  assert.match(ownerOnly,/revoke execute on function public\.app_public_projects_snapshot\(\) from public,anon,authenticated/);
  assert.match(ownerOnly,/grant execute on function public\.app_public_workspace_index\(\) to anon/);
});

test('anonymous workspace has no project renderer or project route',()=>{
  assert.doesNotMatch(main,/data-public-project/);
  assert.doesNotMatch(main,/app_public_project/);
  assert.doesNotMatch(main,/\.\.\/p\/\?slug=/);
  assert.match(main,/const state=\{pages:\[\],documents:\[\],events:\[\]\}/);
  assert.match(main,/data-view="projects"/);
  assert.match(main,/classList\.add\('public-hidden'\)/);
});
