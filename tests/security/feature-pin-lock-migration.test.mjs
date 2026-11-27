import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// SEC-기능PIN잠금 ①(20261119200000_feature_pin_lock): 새 표 app_feature_locks는 API 역할에 닫히고,
// 읽기·쓰기는 authenticated만 실행하는 SECURITY DEFINER 함수로만 한다(docs/design/feature-pin-lock.md, AGENTS.md 3절).
// PIN 원문은 저장하지 않고 bcrypt 해시만, 어떤 함수도 해시를 돌려주지 않는다. 실제 동작은 tests/auth-handoff/feature-pin-lock-db.test.mjs.
const version = '20261119200000';
const name = 'feature_pin_lock';
const publicFns = ['app_lock_read', 'app_lock_setup', 'app_lock_check', 'app_lock_save', 'app_lock_pin_change', 'app_lock_pin_renew'];
const privateFns = ['app_lock_pin_shape', 'app_lock_clean_features', 'app_lock_try'];
const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
const code = sql.replace(/--.*$/gm, '');
const bodyOf = (schema, fn) => { const at = code.indexOf(`create function ${schema}.${fn}(`); assert.ok(at >= 0, fn); return code.slice(at, code.indexOf('\n$$;', at)); };

test('pin lock approval files pass the expanded rules and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.equal(plan.rules, 'expanded');
    assert.equal(plan.functions.length, 9);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
  }
  assert.match(toDryRun(sql), /rollback;\s*$/);
});

test('lock table: RLS on, every API role revoked, no policy, no table grant, one table only', () => {
  assert.match(code, /create table public\.app_feature_locks \(/);
  assert.match(code, /alter table public\.app_feature_locks enable row level security;/);
  assert.match(code, /revoke all on table public\.app_feature_locks from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(code, /create policy|alter policy|drop policy|grant [^;]* on table|disable row level security/i);
  assert.equal((code.match(/^create table /gm) || []).length, 1);
  // PIN 칸은 없다. 해시 칸은 bcrypt 모양만 받는다.
  assert.doesNotMatch(code, /\bpin text\b|\bpin_plain\b|\bpin_code\b/);
  assert.match(code, /check \(char_length\(pin_hash\) = 60 and pin_hash like '\$2%'\)/);
});

test('functions: definer with empty search_path, auth.uid() required, revoke before grant, authenticated only', () => {
  const grants = [...code.matchAll(/^grant [^;]*;/gim)].map(m => m[0]);
  assert.equal(grants.length, publicFns.length);
  for (const fn of publicFns) {
    const body = bodyOf('public', fn);
    assert.match(body, /security definer\s+set search_path = ''/, fn);
    assert.match(body, /v_uid uuid := \(select auth\.uid\(\)\);[\s\S]*if v_uid is null then\s+raise exception using errcode = '42501', message = 'LOCK_AUTH_REQUIRED';/, fn);
    const at = code.indexOf(`create function public.${fn}(`);
    const revoke = code.indexOf(`revoke all on function public.${fn}(`), grant = code.indexOf(`grant execute on function public.${fn}(`);
    assert.ok(revoke > at && grant > revoke, fn);
    assert.match(code.slice(revoke, code.indexOf(';', revoke)), /from public, anon, authenticated, service_role$/, fn);
    assert.match(code.slice(grant, code.indexOf(';', grant) + 1), /to authenticated;$/, fn);
  }
  for (const fn of privateFns) {
    assert.match(bodyOf('private', fn), /security invoker\s+set search_path = ''/, fn);
    assert.doesNotMatch(code, new RegExp(`grant execute on function private\\.${fn}`));
  }
  assert.doesNotMatch(code, /\bto (anon|public|service_role)\b/i);
});

test('no user id from the client; hash never returned; PIN only hashed with bcrypt and a fresh salt', () => {
  for (const m of code.matchAll(/create function public\.app_lock_\w+\(([^)]*)\)/g))
    assert.doesNotMatch(m[1], /user|uid|workspace/i, m[0]);
  for (const fn of publicFns) assert.doesNotMatch(bodyOf('public', fn).replace(/extensions\.crypt\([^)]*\)/g, ''), /'pin_hash'|to_jsonb\(v_row\)|row_to_json/, fn);
  // 저장되는 값은 crypt(PIN, gen_salt('bf', 10))뿐(처음·바꾸기·새로 정하기 3곳).
  assert.equal((code.match(/extensions\.crypt\((p_pin|p_new_pin), extensions\.gen_salt\('bf', 10\)\)/g) || []).length, 3);
  assert.doesNotMatch(code, /pin_hash\s*=\s*p_|values \(v_uid, p_pin|digest\(|md5\(p_/);
  assert.doesNotMatch(code, /raise (notice|info|warning|log)/i, 'nothing printed');
});

test('wrong tries are counted on the server and never rolled back by an exception', () => {
  const body = bodyOf('private', 'app_lock_try');
  assert.match(body, /for update/);
  assert.match(body, /if v_row\.blocked_until is not null and v_row\.blocked_until > now\(\) then\s+return/);
  assert.match(body, /if v_row\.fail_count \+ 1 >= 5 then/);
  // 틀림 길에는 raise가 없다(횟수 증가가 취소되지 않게): raise는 줄이 없을 때 하나뿐.
  assert.equal((body.match(/raise exception/g) || []).length, 1);
  // PIN을 잊었을 때 새로 정하기는 최근 로그인(amr 시각)만.
  assert.match(bodyOf('public', 'app_lock_pin_renew'), /auth\.jwt\(\)\) -> 'amr'[\s\S]*interval '10 minutes'[\s\S]*LOCK_RECENT_LOGIN_REQUIRED/);
});

test('existing structures untouched; rollback drops only what this file made', () => {
  assert.doesNotMatch(code, /alter table public\.app_(workspaces|workspace_members|profiles)\b|(insert into|update|delete from) public\.app_workspace_members|function private\.app_is_workspace_owner|rtw_|create extension/i);
  // 뒤 단계 노트 폴더 잠금(20261119233000_note_folder_lock)은 이 표·함수를 고치지 않고 부르기만 한다(그 파일의 시험이 본다).
  // S69-08 앱 전체 잠금(20261124080000_app_lock_whole_app)은 features 검사와 목록 도우미 두 곳만 고친다(tests/security/app-lock-whole-app-migration.test.mjs가 본다).
  // S69 STORE-계정삭제(20261124130000_account_delete)는 본인 줄만 지운다(user_id = 부른 사람, tests/security/account-delete-migration.test.mjs가 본다).
  // MCP-Claude읽기 3판(20261127120000_mcp_claude_read_areas)은 잠금 영역 이름(features 중 diary·calls)만 DEFINER 도우미로 읽는다 — 비밀번호 칸·쓰기 없음
  // (tests/auth-handoff/mcp-claude-read-areas-db.test.mjs·tests/security/mcp-claude-read-areas-migration.test.mjs가 본다).
  const later = new Set(['20261119233000_note_folder_lock.sql', '20261124080000_app_lock_whole_app.sql', '20261124130000_account_delete.sql',
    '20261127120000_mcp_claude_read_areas.sql']);
  const others = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql') && f !== `${version}_${name}.sql` && !later.has(f)
    && /function (public|private)\.app_lock_|app_feature_locks/.test(readFileSync(`supabase/migrations/${f}`, 'utf8')));
  assert.deepEqual(others, []);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.equal((rollback.match(/^drop table public\.app_feature_locks;/gm) || []).length, 1);
  assert.equal((rollback.match(/^drop function (public|private)\.app_lock_\w+\([^)]*\);/gm) || []).length, 9);
  assert.doesNotMatch(rollback, /cascade|app_profiles|app_workspace|grant /i);
});
