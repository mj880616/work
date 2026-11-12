import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';
import { validateExpanded } from '../../scripts/ops/db-migration-expanded.mjs';

// S61-11 FORGET-요청방향 2단계: app_journal_memorable_picks.kind CHECK에 'promise'(상대 약속)만 더한다.
// 표·칸·정책·권한·함수·트리거·기존 줄 변경 없음. 엄격 규칙으로 apply·dry-run·rollback 모두 workflow를 탄다.
const version = '20261112221000';
const name = 'journal_memorable_pick_promise';
const FIVE = ['task', 'event', 'note', 'org', 'area'];
const strip = s => s.replace(/--.*$/gm, '');

test('promise kind migration passes strict workflow checks in every mode', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.equal(plan.rules, 'strict');
    assert.deepEqual(plan.targets, ['app_journal_memorable_picks']);
    assert.deepEqual(plan.functions, []);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
    if (mode !== 'rollback') assert.equal(plan.flow, 'full');
  }
  const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
  const expanded = validateExpanded(sql, { version, name });
  assert.deepEqual(expanded.review, { definer: [], policies: 0, restrictive: 0, grants: 0, triggers: 0, revokes: 0 });
  assert.match(toDryRun(sql), /rollback;\s*$/);
});

test('promise kind migration only widens the kind CHECK, and rollback refuses while promise rows exist', () => {
  const code = strip(readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8')).replace(/insert into supabase_migrations[\s\S]*$/, '');
  assert.doesNotMatch(code, /\bgrant\b|\brevoke\b|(?:create|alter|drop) policy|row level security|security definer|create (?:or replace )?function|create trigger|\bupdate public\.|\bdelete from public\.|\binsert into public\.|add column|drop column/i);
  assert.match(code, new RegExp(`add constraint app_journal_memorable_picks_kind_check check \\(kind in \\(${[...FIVE, 'promise'].map(k => `'${k}'`).join(',')}\\)\\);`));
  // PostgreSQL 16·17 check_clause 두 글자만 받는다(#980): 앞 단계 다섯 종류, 사후 여섯 종류.
  assert.equal((code.match(/'\(\(kind = ANY \(ARRAY\[/g) || []).length, 2);
  assert.equal((code.match(/'\(kind = ANY \(ARRAY\[/g) || []).length, 2);
  const rollback = strip(readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8'));
  assert.match(rollback, /exists \(select 1 from public\.app_journal_memorable_picks where kind = 'promise'\)/);
  assert.match(rollback, new RegExp(`add constraint app_journal_memorable_picks_kind_check check \\(kind in \\(${FIVE.map(k => `'${k}'`).join(',')}\\)\\);`));
  assert.doesNotMatch(rollback, /\bgrant\b|policy|\bupdate public\.|drop table/i);
  for (const kind of ['precheck', 'postcheck', 'snapshot']) {
    const check = strip(readFileSync(`docs/${version}_${name}.${kind}.sql`, 'utf8'));
    assert.doesNotMatch(check, /information_schema|\binsert into\b|\bupdate public\.|\bdelete from\b|\balter\b|\bcreate\b|\bdrop\b/i, kind);
  }
  assert.match(readFileSync('docs/migration-history.md', 'utf8'), /`20261112221000_journal_memorable_pick_promise\.sql` \| 미적용/);
});
