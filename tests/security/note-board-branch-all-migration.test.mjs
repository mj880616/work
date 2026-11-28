// S71-51 노트 보드 모든 칸 가지(migration 20261126230000_note_board_branch_all) 정적 검사:
// 승인형 DB workflow 확장 규칙이 받는 모양(짝 파일 5개·full 흐름), 권한을 넓히지 않음(anon·PUBLIC 없음, 새 칸에만 칸 권한),
// 카드 부모는 같은 작업공간 노트만(restrictive 정책), 부모는 둘 중 하나만, 노트를 지우면 가지는 비움(set null), rollback은 쓰는 가지가 있으면 멈춤.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration } from '../../scripts/ops/db-migration-plan.mjs';

const V = '20261126230000', N = 'note_board_branch_all';
const sql = readFileSync(`supabase/migrations/${V}_${N}.sql`, 'utf8');
const body = sql.replace(/--.*$/gm, '');
const rollback = readFileSync(`docs/${V}_${N}.rollback.sql`, 'utf8');

test('확장 규칙으로 받고 짝 파일이 모두 있어 승인 한 번 흐름(full)이다', () => {
  const plan = prepareMigration({ mode: 'apply', version: V, runId: '1', root: process.cwd() });
  assert.equal(plan.rules, 'expanded'); assert.equal(plan.flow, 'full');
  assert.deepEqual(plan.targets, ['app_note_board_texts']);
});

test('권한을 넓히지 않는다: anon·PUBLIC 없음, 새 칸 parent_note에만 authenticated 칸 권한, 기존 owner 정책은 그대로', () => {
  assert.doesNotMatch(body, /\bto\s+(anon|public)\b/i);
  assert.doesNotMatch(body, /drop policy|alter policy|disable row level security/i);
  const grants = body.match(/grant [^;]+;/gi) || [];
  assert.deepEqual(grants.map(g => g.replace(/\s+/g, ' ')), [
    'grant insert (parent_note) on table public.app_note_board_texts to authenticated;',
    'grant update (parent_note) on table public.app_note_board_texts to authenticated;']);
  assert.match(body, /create policy note_board_texts_parent_note_own on public\.app_note_board_texts as restrictive for all to authenticated/);
  assert.match(body, /n\.workspace_id = app_note_board_texts\.workspace_id/);
});

test('부모는 하나만, 노트 지우면 비움, 글자·도형 부모 금지 줄만 빠짐, 기록 1행이 마지막', () => {
  assert.match(body, /add column parent_note uuid references public\.app_notes\(id\) on delete set null/);
  assert.match(body, /check \(parent_id is null or parent_note is null\)/);
  const decor = body.slice(body.indexOf('add constraint app_note_board_texts_decor_check'));
  assert.doesNotMatch(decor.slice(0, decor.indexOf(';')), /parent_id is null/);
  assert.match(body, /insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s+values \('20261126230000', 'note_board_branch_all'/);
  assert.match(body.trim(), /commit;$/);
});

test('rollback은 카드·글자·도형 가지가 있으면 지우지 않고 멈추고, 옛 검사(글자·도형은 부모 없음)를 되살린다', () => {
  assert.match(rollback, /parent_note is not null or \(kind in \('label', 'shape'\) and parent_id is not null\)/);
  assert.match(rollback, /and \(kind not in \('label', 'shape'\) or parent_id is null\)\);/);
  assert.match(rollback, /drop policy note_board_texts_parent_note_own on public\.app_note_board_texts;/);
  assert.match(rollback, /drop column parent_note;/);
});
