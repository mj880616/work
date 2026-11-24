import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// S69-12 자료실 옮긴 기록 DB(20261124090000_library_move_log). 정적 검사: 새 표 하나, RLS, owner 정책 하나(authenticated만, 자료·두 폴더 같은 작업공간),
// anon·PUBLIC·service_role 권한 없음, 고치기 권한 없음, 기존 표(자료·폴더·폴더 연결)·rtw_*·공유 함수는 건드리지 않음, 짝 파일 5개.
const V='20261124090000',N='library_move_log';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const code=read(`supabase/migrations/${V}_${N}.sql`).split('\n').filter(l=>!l.trim().startsWith('--')).join('\n').replace(/\s+/g,' ').toLowerCase();

test('one new table with RLS, everything revoked first, one owner policy checking document and both folders',()=>{
  assert.equal((code.match(/create table /g)||[]).length,1);
  assert.ok(code.includes('create table public.app_library_move_log ('));
  assert.ok(code.includes('alter table public.app_library_move_log enable row level security;'));
  assert.ok(code.includes('revoke all on table public.app_library_move_log from public, anon, authenticated, service_role;'));
  assert.equal((code.match(/create policy /g)||[]).length,1);
  assert.ok(code.includes('create policy library_move_log_owner_all on public.app_library_move_log for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check ( private.app_is_workspace_owner(workspace_id) and exists ('));
  assert.ok(code.includes('where d.id = document_id and d.workspace_id = app_library_move_log.workspace_id'));
  assert.ok(code.includes('where f.id = to_folder_id and f.workspace_id = app_library_move_log.workspace_id'));
  assert.ok(code.includes('where f.id = from_folder_id and f.workspace_id = app_library_move_log.workspace_id'));
  assert.ok(!/using \(true\)|with check \(true\)|disable row level security/.test(code));
});

test('grants: authenticated select/delete and named insert columns only; no update, anon, PUBLIC or existing tables',()=>{
  const grants=[...code.matchAll(/grant [^;]*;/g)].map(m=>m[0]);
  assert.deepEqual(grants,[
    'grant select, delete on table public.app_library_move_log to authenticated;',
    'grant insert (workspace_id, batch_id, kind, document_id, from_folder_id, to_folder_id) on table public.app_library_move_log to authenticated;']);
  assert.ok(!/\balter table public\.app_(documents|library_folders|library_folder_items)\b|rtw_|app_collab|security definer|create (or replace )?function|create trigger/.test(code));
});

test('pair files exist and the plan is accepted',()=>{
  for(const k of ['precheck.sql','snapshot.sql','postcheck.sql','rollback.sql','summary.md'])assert.ok(read(`docs/${V}_${N}.${k}`).length>0,k);
  const plan=prepareMigration({mode:'apply',version:V,runId:'1',root:root.pathname});
  assert.ok(['strict','expanded'].includes(plan.rules));
});
