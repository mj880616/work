import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// S69-08 앱 전체 잠금(20261124080000_app_lock_whole_app): 잠글 수 있는 목록에 'app' 하나를 더한다.
// 앞 단계(20261119200000_feature_pin_lock)의 features 검사와 private 목록 도우미만 고치고, 표 권한·RLS·정책·공개 함수는 건드리지 않는다.
// 실제 동작(받는 이름·거절·되돌리기)은 tests/auth-handoff/app-lock-whole-app-db.test.mjs.
const version = '20261124080000';
const name = 'app_lock_whole_app';
const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
const code = sql.replace(/--.*$/gm, '');
const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
const FIVE = "array['app', 'diary', 'photos', 'calls', 'telegram']::text[]";
const FOUR = "array['diary', 'photos', 'calls', 'telegram']::text[]";

test('app lock approval files pass the expanded rules and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.equal(plan.rules, 'expanded');
    assert.deepEqual([...plan.functions], ['private.app_lock_clean_features']);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
    assert.equal(plan.review.definer.length, 0);
    assert.equal(plan.review.grants, 0);
    assert.equal(plan.review.policies, 0);
  }
  assert.match(toDryRun(sql), /rollback;\s*$/);
});

test('only the features check and the private list helper change; no grant, policy, RLS or public function', () => {
  // migration 기록 1행(설명 글)은 빼고 본다.
  const ddl = code.slice(0, code.indexOf('insert into supabase_migrations.schema_migrations'));
  assert.doesNotMatch(ddl, /\bgrant\b|policy|row level security|security definer|create table|drop table|rtw_/i);
  assert.doesNotMatch(code, /function public\./);
  const alters = [...code.matchAll(/^alter table [^;]*;/gims)].map(m => m[0].replace(/\s+/g, ' '));
  assert.deepEqual(alters, [
    'alter table public.app_feature_locks drop constraint app_feature_locks_features_check;',
    `alter table public.app_feature_locks add constraint app_feature_locks_features_check check ( cardinality(features) <= 5 and features <@ ${FIVE});`,
  ]);
  assert.equal((code.match(/^create or replace function /gm) || []).length, 1);
  const at = code.indexOf('create or replace function private.app_lock_clean_features(p_features text[])');
  assert.ok(at >= 0);
  const body = code.slice(at, code.indexOf('\n$$;', at));
  assert.match(body, /returns text\[\]\s+language sql\s+immutable\s+security invoker\s+set search_path = ''/);
  assert.ok(body.includes(`not (f = any (${FIVE}))`));
  assert.match(code, /revoke all on function private\.app_lock_clean_features\(text\[\]\) from public, anon, authenticated, service_role;/);
  // 앞 단계 정의와 'app' 하나만 다르다.
  const base = readFileSync('supabase/migrations/20261119200000_feature_pin_lock.sql', 'utf8').replace(/--.*$/gm, '');
  const b0 = base.indexOf('create function private.app_lock_clean_features(p_features text[])');
  const baseBody = base.slice(b0, base.indexOf('\n$$;', b0)).replace('create function', 'create or replace function');
  assert.equal(body.replace(FIVE, FOUR), baseBody);
  assert.match(code, /insert into supabase_migrations\.schema_migrations \(version, name, statements\)\s+values \('20261124080000', 'app_lock_whole_app',/);
});

test('rollback restores the four names and drops only app from rows; no other change', () => {
  assert.ok(rollback.includes(`cardinality(features) <= 4 and features <@ ${FOUR}`));
  assert.ok(rollback.includes(`not (f = any (${FOUR}))`));
  assert.match(rollback, /update public\.app_feature_locks\s+set features = pg_catalog\.array_remove\(features, 'app'\), updated_at = now\(\)\s+where 'app' = any \(features\);/);
  assert.match(rollback, /revoke all on function private\.app_lock_clean_features\(text\[\]\) from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(rollback, /\bgrant\b|cascade|drop table|drop function|policy/i);
  assert.match(rollback, /delete from supabase_migrations\.schema_migrations\s+where version = '20261124080000' and name = 'app_lock_whole_app';\s+commit;\s*$/);
});

test('screen sends only names the server knows', () => {
  const lock = readFileSync('app/feature-lock.js', 'utf8');
  const names = Object.keys(Function(`return ${lock.match(/export const FEATURE_NAMES = (\{[^}]*\})/)[1]}`)()).sort();
  assert.deepEqual(names, ['app', 'calls', 'diary', 'photos', 'telegram']);
  const later = readdirSync('supabase/migrations').filter(f => f > `${version}_${name}.sql` && /app_lock_clean_features|app_feature_locks_features_check/.test(readFileSync(`supabase/migrations/${f}`, 'utf8')));
  assert.deepEqual(later, []);
});
