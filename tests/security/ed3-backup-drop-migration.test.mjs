import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {prepareMigration} from '../../scripts/ops/db-migration-plan.mjs';

// ED③ 백업 표 삭제 (명진 결정 2026-10-25). DROP TABLE은 승인형 DB workflow가 차단하므로 SQL Editor 전용이다.
// 이 시험은 (1) 삭제 대상이 백업 표 하나뿐인지, (2) workflow가 계속 거절하는지(규칙을 풀지 않았다는 증거), (3) 앱·Edge가 표를 참조하지 않는지,
// (4) 짝 파일이 갖춰졌는지를 본다.
const stem = '20261025191000_ed3_backup_drop';
const strip = s => s.replace(/--.*$/gm, '');
const walk = dir => readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);

test('ed3 backup drop migration: drops only the backup table, guarded, records itself', () => {
  const raw = strip(readFileSync(`supabase/migrations/${stem}.sql`, 'utf8')), code = raw.replace(/'[^']*'/g, "''");
  assert.deepEqual([...code.matchAll(/\bdrop\s+\w+(?:\s+if\s+exists)?\s+[\w.]+/gi)].map(m => m[0].replace(/\s+/g, ' ')), ['drop table public.app_ed3_text_backups']);
  assert.doesNotMatch(code, /cascade|truncate|\bgrant\b|disable row level|rtw_|\bto\s+(?:anon|public)\b|security definer|create (?:or replace )?function|(?:update|delete from|insert into) public\./i);
  assert.match(raw, /ED3_BACKUP_DROP_PREREQUISITE_CHANGED/);
  assert.match(raw, /ED3_BACKUP_DROP_POSTCHECK_FAILED/);
  assert.match(raw, /insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s+values \('20261025191000', 'ed3_backup_drop'/);
  assert.match(raw.trim(), /commit;$/);
});

test('ed3 backup drop migration: approved DB workflow still rejects DROP TABLE (SQL Editor path only)', () => {
  for (const mode of ['apply', 'dry-run']) {
    assert.throws(() => prepareMigration({mode, version: '20261025191000', runId: '1', root: process.cwd()}), /blocked-command|drop table|차단|blocked/i);
  }
});

test('ed3 backup drop: no app, Edge or script reads the backup table', () => {
  const files = ['app', 'supabase/functions', 'scripts', 'index.html', 'p'].filter(p => { try { readdirSync(p); return true; } catch { return p.endsWith('.html'); } })
    .flatMap(p => p.endsWith('.html') ? [p] : walk(p)).filter(f => /\.(?:m?js|html|ts|css)$/.test(f));
  const users = files.filter(f => /app_ed3_text_backups/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(users, []);
});

test('ed3 backup drop: companion files exist; summary says the text cannot be restored; rollback recreates structure only', () => {
  for (const f of ['snapshot', 'precheck', 'postcheck', 'rollback']) assert.match(readFileSync(`docs/${stem}.${f}.sql`, 'utf8'), /app_ed3_text_backups/);
  const summary = readFileSync(`docs/${stem}.summary.md`, 'utf8');
  assert.equal(summary.trim().split('\n').filter(l => /^(무엇이 바뀌나|잘못되면|되돌리는 법):/.test(l)).length, 3);
  assert.match(summary, /되돌릴 수 없음|다시 볼 수 없습니다/);
  const rollback = readFileSync(`docs/${stem}.rollback.sql`, 'utf8');
  assert.match(rollback, /원문(?:\(.*?\))?은 돌아오지 않는다/);
  const code = strip(rollback);
  assert.match(code, /create table public\.app_ed3_text_backups/);
  assert.match(code, /enable row level security/);
  assert.match(code, /grant select \(id, workspace_id, source, row_id, row_updated_at, backed_up_at\) on table public\.app_ed3_text_backups to authenticated;/);
  assert.match(code, /create policy ed3_text_backups_owner_read/);
  assert.doesNotMatch(code, /\binsert into public\.|drop table/i);
  assert.match(code, /delete from supabase_migrations\.schema_migrations\s+where version = '20261025191000' and name = 'ed3_backup_drop';/);
  assert.doesNotMatch(code, /version = '20261024190000'\s+and name = 'ed3_text_backup';\s*commit/);
});
