import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// SEC-기능PIN잠금 노트 폴더 잠금(20261119233000_note_folder_lock): 새 표 app_note_folder_locks는 API 역할에 닫히고,
// 읽기·쓰기는 authenticated만 실행하는 SECURITY DEFINER 함수 2개로만 한다. 앞 단계(20261119200000_feature_pin_lock)의 표·함수는
// 고치지 않고 부르기만 한다(같은 PIN·같은 틀린 횟수). 실제 동작은 tests/auth-handoff/note-folder-lock-db.test.mjs.
const version = '20261119233000';
const name = 'note_folder_lock';
const publicFns = ['app_lock_note_folders', 'app_lock_note_folder_set'];
const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
const code = sql.replace(/--.*$/gm, '');
const bodyOf = fn => { const at = code.indexOf(`create function public.${fn}(`); assert.ok(at >= 0, fn); return code.slice(at, code.indexOf('\n$$;', at)); };

test('note folder lock approval files pass the expanded rules and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.equal(plan.rules, 'expanded');
    assert.equal(plan.functions.length, 3);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
  }
  assert.match(toDryRun(sql), /rollback;\s*$/);
});

test('folder lock table: RLS on, every API role revoked, no policy, no table grant, one table only, cascades with the folder', () => {
  assert.match(code, /create table public\.app_note_folder_locks \(/);
  assert.match(code, /folder_id uuid not null references public\.app_note_folders\(id\) on delete cascade/);
  assert.match(code, /alter table public\.app_note_folder_locks enable row level security;/);
  assert.match(code, /revoke all on table public\.app_note_folder_locks from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(code, /create policy|alter policy|drop policy|grant [^;]* on table|disable row level security/i);
  assert.equal((code.match(/^create table /gm) || []).length, 1);
});

test('functions: definer with empty search_path, auth.uid() required, revoke before grant, authenticated only', () => {
  const grants = [...code.matchAll(/^grant [^;]*;/gim)].map(m => m[0]);
  assert.equal(grants.length, publicFns.length);
  assert.equal((code.match(/^create function /gm) || []).length, publicFns.length + 1);
  for (const fn of publicFns) {
    const body = bodyOf(fn);
    assert.match(body, /security definer\s+set search_path = ''/, fn);
    assert.match(body, /v_uid uuid := \(select auth\.uid\(\)\);[\s\S]*if v_uid is null then\s+raise exception using errcode = '42501', message = 'LOCK_AUTH_REQUIRED';/, fn);
    const at = code.indexOf(`create function public.${fn}(`);
    const revoke = code.indexOf(`revoke all on function public.${fn}(`), grant = code.indexOf(`grant execute on function public.${fn}(`);
    assert.ok(revoke > at && grant > revoke, fn);
    assert.match(code.slice(revoke, code.indexOf(';', revoke)), /from public, anon, authenticated, service_role$/, fn);
    assert.match(code.slice(grant, code.indexOf(';', grant) + 1), /to authenticated;$/, fn);
    // 돌려주는 목록은 한 도우미(내 줄만·지금도 내 작업공간 폴더만).
    assert.match(body, /private\.app_lock_note_folder_list\(v_uid\)/, fn);
  }
  assert.doesNotMatch(code, /\bto (anon|public|service_role)\b/i);
  const at = code.indexOf('create function private.app_lock_note_folder_list(');
  const helper = code.slice(at, code.indexOf('\n$$;', at));
  assert.match(helper, /security invoker\s+set search_path = ''/);
  assert.match(helper, /where l\.user_id = p_uid and private\.app_is_workspace_owner\(f\.workspace_id\)/);
  assert.match(helper, /join covered p on c\.parent_id = p\.id and c\.workspace_id = p\.workspace_id/);
  assert.match(code, /revoke all on function private\.app_lock_note_folder_list\(uuid\) from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(code, /grant execute on function private\./);
});

test('no user or workspace id from the client; folder owner checked before the PIN try; same PIN path as feature lock', () => {
  for (const m of code.matchAll(/create function public\.app_lock_\w+\(([^)]*)\)/g))
    assert.doesNotMatch(m[1], /\bp_(user|uid|workspace|owner)/i, m[0]);
  const body = bodyOf('app_lock_note_folder_set');
  const owner = body.indexOf('private.app_is_workspace_owner(v_ws)'), tryAt = body.indexOf('private.app_lock_try(v_uid, p_pin)');
  assert.ok(owner > 0 && tryAt > owner, 'folder owner checked first');
  assert.match(body, /if not \(v_try->>'ok'\)::boolean then\s+return v_try;/);
  assert.match(body, />= 50 then\s+raise exception using errcode = '22023', message = 'LOCK_FOLDER_LIMIT'/);
  assert.match(body, /message = 'LOCK_FOLDER_FORBIDDEN'/);
  // PIN을 직접 다루지 않는다(해시·소금·대조는 앞 단계 도우미만).
  assert.doesNotMatch(code, /extensions\.crypt|gen_salt|pin_hash|raise (notice|info|warning|log)/i);
});

test('earlier steps untouched; rollback drops only what this file made', () => {
  assert.doesNotMatch(code, /(create or replace|alter|drop) (function|table) (public|private)\.app_(lock_(read|setup|check|save|pin_change|pin_renew|try|pin_shape|clean_features)|feature_locks|note_folders)\b/i);
  assert.doesNotMatch(code, /alter table public\.app_(workspaces|workspace_members|profiles|note_folders|feature_locks)\b|(insert into|update|delete from) public\.app_(workspace_members|feature_locks|note_folders)\b|function private\.app_is_workspace_owner|rtw_|create extension/i);
  const others = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql') && f !== `${version}_${name}.sql`
    && /app_note_folder_locks|function (public|private)\.app_lock_note_folder/.test(readFileSync(`supabase/migrations/${f}`, 'utf8')));
  assert.deepEqual(others, []);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.equal((rollback.match(/^drop table public\.app_note_folder_locks;/gm) || []).length, 1);
  assert.equal((rollback.match(/^drop function (public|private)\.app_lock_note_folder\w*\([^)]*\);/gm) || []).length, 3);
  assert.equal((rollback.match(/^drop /gm) || []).length, 4);
  assert.doesNotMatch(rollback, /cascade|app_profiles|app_workspace|app_feature_locks|grant /i);
});
