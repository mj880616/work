import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// NOTE-읽생기아이디어 1단계 DB(20261102203000_note_comments). 정적 검사: 새 표 하나, RLS, owner 정책 하나(authenticated만),
// anon·PUBLIC·service_role 권한 없음, 고치기 권한 없음, 기존 표(app_notes 등)·rtw_*는 건드리지 않음, 짝 파일 5개.
const V='20261102203000',N='note_comments';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const code=read(`supabase/migrations/${V}_${N}.sql`).split('\n').filter(l=>!l.trim().startsWith('--')).join('\n').replace(/\s+/g,' ').toLowerCase();

test('one new table with RLS, everything revoked first, one owner policy for authenticated',()=>{
  assert.equal((code.match(/create table /g)||[]).length,1);
  assert.ok(code.includes('create table public.app_note_comments ('));
  assert.ok(code.includes('alter table public.app_note_comments enable row level security;'));
  assert.ok(code.includes('revoke all on table public.app_note_comments from public, anon, authenticated, service_role;'));
  assert.equal((code.match(/create policy /g)||[]).length,1);
  assert.ok(code.includes('create policy note_comments_owner_all on public.app_note_comments for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check ( private.app_is_workspace_owner(workspace_id) and exists ('));
  assert.ok(!/using \(true\)|with check \(true\)|disable row level security/.test(code));
});

test('grants: authenticated select/delete and named insert columns only; no update, anon, PUBLIC or existing tables',()=>{
  const grants=[...code.matchAll(/grant [^;]*;/g)].map(m=>m[0]);
  assert.deepEqual(grants,[
    'grant select, delete on table public.app_note_comments to authenticated;',
    'grant insert (workspace_id, note_id, kind, quote, body) on table public.app_note_comments to authenticated;']);
  assert.ok(!/\balter table public\.app_notes\b|rtw_|security definer|create (or replace )?function|create trigger/.test(code));
});

test('pair files exist and the plan uses the expanded rules',()=>{
  for(const k of ['precheck.sql','snapshot.sql','postcheck.sql','rollback.sql','summary.md'])assert.ok(read(`docs/${V}_${N}.${k}`).length>0,k);
  assert.equal(prepareMigration({mode:'apply',version:V,runId:'1',root:root.pathname}).rules,'expanded');
});
