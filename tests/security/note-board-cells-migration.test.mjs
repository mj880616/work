// S71-56 노트 보드 표·파일 칸(migration 20261127050000_note_board_cells) 정적 검사:
// 승인형 DB workflow 확장 규칙이 받는 모양(짝 파일 5개·full 흐름), 권한을 넓히지 않음(anon·PUBLIC 없음, 새 칸에만 칸 권한, 파일이 가리키는 곳은 고치기 권한 없음),
// 파일 칸은 같은 작업공간 자료·노트만(restrictive 정책), 넣을 때는 그 노트에 실제 있는 첨부만, rollback은 쓰는 칸이 있으면 멈춤.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration } from '../../scripts/ops/db-migration-plan.mjs';

const V = '20261127050000', N = 'note_board_cells';
const sql = readFileSync(`supabase/migrations/${V}_${N}.sql`, 'utf8');
const body = sql.replace(/--.*$/gm, '');
const rollback = readFileSync(`docs/${V}_${N}.rollback.sql`, 'utf8');

test('확장 규칙으로 받고 짝 파일이 모두 있어 승인 한 번 흐름(full)이다', () => {
  const plan = prepareMigration({ mode: 'apply', version: V, runId: '1', root: process.cwd() });
  assert.equal(plan.rules, 'expanded'); assert.equal(plan.flow, 'full');
  assert.deepEqual(plan.targets, ['app_note_board_texts']);
});

test('권한을 넓히지 않는다: anon·PUBLIC 없음, 새 칸에만 authenticated 칸 권한, 파일이 가리키는 곳은 넣기만', () => {
  assert.doesNotMatch(body, /\bto\s+(anon|public)\b/i);
  assert.doesNotMatch(body, /drop policy|alter policy|disable row level security|security definer|create (or replace )?function|create trigger/i);
  const grants = body.match(/grant [^;]+;/gi) || [];
  assert.deepEqual(grants.map(g => g.replace(/\s+/g, ' ')), [
    'grant insert (cells, file_doc, file_note, file_drive) on table public.app_note_board_texts to authenticated;',
    'grant update (cells) on table public.app_note_board_texts to authenticated;']);
  assert.match(body, /create policy note_board_texts_file_own on public\.app_note_board_texts as restrictive for all to authenticated/);
  assert.match(body, /d\.workspace_id = app_note_board_texts\.workspace_id/);
  assert.match(body, /n\.workspace_id = app_note_board_texts\.workspace_id/);
  // 넣을 때(with check)만 그 노트의 첨부 목록에 그 드라이브 번호가 있는지 본다
  const check = body.slice(body.indexOf('with check ((file_doc'));
  assert.match(check.slice(0, check.indexOf(';')), /n\.attachments @> jsonb_build_array\(jsonb_build_object\('drive_file_id', app_note_board_texts\.file_drive\)\)/);
});

test('종류 둘·표 모양·파일 하나 검사, 자료·노트를 지우면 칸도 함께, 기록 1행이 마지막', () => {
  assert.match(body, /kind in \('topic', 'sticky', 'label', 'shape', 'table', 'file'\)/);
  assert.match(body, /add column file_doc uuid references public\.app_documents\(id\) on delete cascade/);
  assert.match(body, /add column file_note uuid references public\.app_notes\(id\) on delete cascade/);
  assert.match(body, /jsonb_array_length\(cells\) not between 1 and 30/);
  assert.match(body, /jsonb_array_length\(cells -> 0\) not between 1 and 12/);
  assert.match(body, /octet_length\(cells::text\) <= 20000/);
  assert.match(body, /num_nonnulls\(file_doc, file_note\) = 1/);
  assert.match(body, /file_drive ~ '\^\[A-Za-z0-9_-\]\{1,255\}\$'/);
  assert.match(body, /insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s+values \('20261127050000', 'note_board_cells'/);
  assert.match(body.trim(), /commit;$/);
});

test('rollback은 표·파일 칸이 있으면 지우지 않고 멈추고, 옛 종류·글 검사를 되살린다', () => {
  assert.match(rollback, /kind in \('table', 'file'\) or cells is not null or file_doc is not null or file_note is not null or file_drive is not null/);
  assert.match(rollback, /kind in \('topic', 'sticky', 'label', 'shape'\)\n/);
  assert.match(rollback, /drop policy note_board_texts_file_own on public\.app_note_board_texts;/);
  assert.match(rollback, /drop column cells;/);
});
