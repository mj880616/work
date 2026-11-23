import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// S68-38c 노트 보드 글 상자·선 곡선 DB(20261123120000_note_board_texts). 정적 검사: 새 표 하나(RLS·owner 정책 하나·authenticated만),
// 연결선 표는 칸·제약·색인 추가와 같은 이름 정책 교체뿐(권한 넓히지 않음), anon·PUBLIC·service_role 권한 없음, 작업공간·보드는 못 고침,
// 기존 표(app_notes 등)·rtw_*·공유 함수는 건드리지 않음, 짝 파일 5개, 되돌리기가 옛 정책을 되살림.
const V='20261123120000',N='note_board_texts';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const strip=sql=>sql.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n').replace(/\s+/g,' ').toLowerCase();
const code=strip(read(`supabase/migrations/${V}_${N}.sql`));
const rollback=strip(read(`docs/${V}_${N}.rollback.sql`));

test('one new table with RLS, everything revoked first, one owner policy for authenticated',()=>{
  assert.equal((code.match(/create table /g)||[]).length,1);
  assert.ok(code.includes('create table public.app_note_board_texts ('));
  assert.ok(code.includes('alter table public.app_note_board_texts enable row level security;'));
  assert.ok(code.includes('revoke all on table public.app_note_board_texts from public, anon, authenticated, service_role;'));
  assert.ok(code.includes('create policy note_board_texts_owner_all on public.app_note_board_texts for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));'));
  assert.ok(!/using \(true\)|with check \(true\)|disable row level security|security definer|create (or replace )?function|create trigger|rtw_|app_collab|\balter table public\.app_notes\b|\bto (anon|public)\b/.test(code));
});

test('links: ends note|text exactly one, text end tied to same workspace and board, bend pair, same-name policy replacement keeps owner and note checks',()=>{
  assert.ok(code.includes('check (num_nonnulls(from_note, from_text) = 1 and num_nonnulls(to_note, to_text) = 1)'));
  assert.ok(code.includes('foreign key (from_text, workspace_id, board_id) references public.app_note_board_texts(id, workspace_id, board_id) on delete cascade'));
  assert.ok(code.includes('foreign key (to_text, workspace_id, board_id) references public.app_note_board_texts(id, workspace_id, board_id) on delete cascade'));
  assert.ok(code.includes("(bend_x is null) = (bend_y is null) and (bend_x is null or (shape = 'curve' and bend_x between -5 and 5 and bend_y between -5 and 5))"));
  assert.equal((code.match(/drop policy /g)||[]).length,1);
  assert.equal((code.match(/create policy /g)||[]).length,2);
  assert.ok(code.includes('drop policy note_board_links_owner_all on public.app_note_board_links; create policy note_board_links_owner_all on public.app_note_board_links for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check ( private.app_is_workspace_owner(workspace_id) and (from_note is null or exists ('));
  assert.ok(code.includes("where n.id = from_note and n.workspace_id = app_note_board_links.workspace_id and n.kind = 'note'))"));
  assert.ok(code.includes("where n.id = to_note and n.workspace_id = app_note_board_links.workspace_id and n.kind = 'note')));"));
  // 되돌리기는 옛 정의(양쪽 노트 필수)를 그대로 되살린다.
  assert.ok(rollback.includes('drop policy note_board_links_owner_all on public.app_note_board_links; create policy note_board_links_owner_all on public.app_note_board_links for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check ( private.app_is_workspace_owner(workspace_id) and exists ('));
  assert.ok(rollback.includes('alter table public.app_note_board_links alter column from_note set not null;'));
  assert.ok(rollback.includes("alter table public.app_note_board_links alter column shape set default 'curve';"));
  assert.ok(!/\bgrant |app_notes where|truncate/.test(rollback));
});

test('grants: texts select/delete + named columns; links only the four new columns; workspace and board fixed; nothing for anon or PUBLIC',()=>{
  const grants=[...code.matchAll(/grant [^;]*;/g)].map(m=>m[0]);
  assert.deepEqual(grants,[
    'grant select, delete on table public.app_note_board_texts to authenticated;',
    'grant insert (workspace_id, board_id, body, x, y) on table public.app_note_board_texts to authenticated;',
    'grant update (body, x, y) on table public.app_note_board_texts to authenticated;',
    'grant insert (from_text, to_text, bend_x, bend_y) on table public.app_note_board_links to authenticated;',
    'grant update (from_text, to_text, bend_x, bend_y) on table public.app_note_board_links to authenticated;']);
});

test('pair files exist; approved workflow refuses only because of column grants on the existing table (SQL Editor path)',()=>{
  for(const k of ['precheck.sql','snapshot.sql','postcheck.sql','rollback.sql','summary.md'])assert.ok(read(`docs/${V}_${N}.${k}`).length>0,k);
  assert.throws(()=>prepareMigration({mode:'apply',version:V,runId:'1',root:root.pathname}),/grant-existing/);
  assert.match(read(`supabase/migrations/${V}_${N}.sql`),/SQL Editor/);
});
