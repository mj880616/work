import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// S68-38 노트 보드 연결선 DB(20261123090000_note_board_links). 정적 검사: 새 표 하나, RLS, owner 정책 하나(authenticated만, 양쪽 노트 같은 작업공간),
// anon·PUBLIC·service_role 권한 없음, 작업공간·보드는 못 고침, 기존 표(app_notes 등)·rtw_*·공유 함수는 건드리지 않음, 짝 파일 5개.
const V='20261123090000',N='note_board_links';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const code=read(`supabase/migrations/${V}_${N}.sql`).split('\n').filter(l=>!l.trim().startsWith('--')).join('\n').replace(/\s+/g,' ').toLowerCase();

test('one new table with RLS, everything revoked first, one owner policy checking both notes',()=>{
  assert.equal((code.match(/create table /g)||[]).length,1);
  assert.ok(code.includes('create table public.app_note_board_links ('));
  assert.ok(code.includes('alter table public.app_note_board_links enable row level security;'));
  assert.ok(code.includes('revoke all on table public.app_note_board_links from public, anon, authenticated, service_role;'));
  assert.equal((code.match(/create policy /g)||[]).length,1);
  assert.ok(code.includes('create policy note_board_links_owner_all on public.app_note_board_links for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check ( private.app_is_workspace_owner(workspace_id) and exists ('));
  assert.ok(code.includes('where n.id = from_note and n.workspace_id = app_note_board_links.workspace_id'));
  assert.ok(code.includes('where n.id = to_note and n.workspace_id = app_note_board_links.workspace_id'));
  assert.ok(code.includes('references public.app_notes(id) on delete cascade'));
  assert.ok(!/using \(true\)|with check \(true\)|disable row level security/.test(code));
});

test('grants: authenticated select/delete, named insert/update columns; workspace and board fixed; no anon, PUBLIC or existing tables',()=>{
  const grants=[...code.matchAll(/grant [^;]*;/g)].map(m=>m[0]);
  assert.deepEqual(grants,[
    'grant select, delete on table public.app_note_board_links to authenticated;',
    'grant insert (workspace_id, board_id, from_note, to_note, from_side, to_side, shape, dash, ends, label) on table public.app_note_board_links to authenticated;',
    'grant update (from_note, to_note, from_side, to_side, shape, dash, ends, label) on table public.app_note_board_links to authenticated;']);
  assert.ok(!/\balter table public\.app_notes\b|rtw_|app_collab|security definer|create (or replace )?function|create trigger/.test(code));
});

test('pair files exist and the plan uses the expanded rules',()=>{
  for(const k of ['precheck.sql','snapshot.sql','postcheck.sql','rollback.sql','summary.md'])assert.ok(read(`docs/${V}_${N}.${k}`).length>0,k);
  assert.equal(prepareMigration({mode:'apply',version:V,runId:'1',root:root.pathname}).rules,'expanded');
});
