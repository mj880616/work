import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// COLLAB-묶인사람끼리공유 1단계 ①(20261118100000_collab_groups): 새 app_collab_* 표 6개는 API 역할에 닫히고,
// 읽기·쓰기는 authenticated만 실행하는 SECURITY DEFINER 함수로만 한다(docs/design/collab-sharing.md 3절, AGENTS.md 3절).
// 실제 동작·거절은 tests/auth-handoff/collab-groups-db.test.mjs(로컬 PostgreSQL)가 본다.
const version = '20261118100000';
const name = 'collab_groups';
const tables = ['app_collab_groups', 'app_collab_members', 'app_collab_invites', 'app_collab_join_requests',
  'app_collab_join_attempts', 'app_collab_member_log'];
const publicFns = ['app_collab_group_create', 'app_collab_invite_create', 'app_collab_invite_revoke_all', 'app_collab_invite_peek',
  'app_collab_invite_accept', 'app_collab_request_decide', 'app_collab_my_groups', 'app_collab_leave',
  'app_collab_member_remove', 'app_collab_admin_move'];
const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
const code = sql.replace(/--.*$/gm, '');

test('collab groups approval files pass the expanded rules and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.equal(plan.rules, 'expanded');
    assert.equal(plan.functions.length, 13);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.checks.precheck.baselineNull, false);
  }
  assert.match(toDryRun(sql), /rollback;\s*$/);
});

test('collab tables: RLS on, every API role revoked, no policy, no table grant', () => {
  for (const t of tables) {
    assert.match(code, new RegExp(`create table public\\.${t} \\(`));
    assert.match(code, new RegExp(`alter table public\\.${t} enable row level security;`));
    assert.match(code, new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated, service_role;`));
  }
  assert.doesNotMatch(code, /create policy|alter policy|drop policy|grant [^;]* on table|disable row level security/i);
  assert.equal((code.match(/^create table /gm) || []).length, 6);
});

test('collab functions: definer with empty search_path, auth.uid() required, revoke before grant, authenticated only', () => {
  const grants = [...code.matchAll(/^grant [^;]*;/gim)].map(m => m[0]);
  assert.equal(grants.length, publicFns.length);
  for (const fn of publicFns) {
    const at = code.indexOf(`create function public.${fn}(`);
    assert.ok(at >= 0, fn);
    const body = code.slice(at, code.indexOf('\n$$;', at));
    assert.match(body, /security definer\s+set search_path = ''/, fn);
    assert.match(body, /v_uid uuid := \(select auth\.uid\(\)\);[\s\S]*if v_uid is null then\s+raise exception using errcode = '42501', message = 'COLLAB_AUTH_REQUIRED';/, fn);
    const revoke = code.indexOf(`revoke all on function public.${fn}(`), grant = code.indexOf(`grant execute on function public.${fn}(`);
    assert.ok(revoke > at && grant > revoke, fn);
    assert.match(code.slice(revoke, code.indexOf(';', revoke)), /from public, anon, authenticated, service_role$/, fn);
    assert.match(code.slice(grant, code.indexOf(';', grant) + 1), /to authenticated;$/, fn);
  }
  // private 도우미는 invoker이고 실행권을 아무에게도 주지 않는다.
  for (const fn of ['app_collab_clean_name', 'app_collab_my_workspace', 'app_collab_my_role']) {
    const at = code.indexOf(`create function private.${fn}(`);
    assert.match(code.slice(at, code.indexOf('\n$$;', at)), /security invoker\s+set search_path = ''/, fn);
    assert.doesNotMatch(code, new RegExp(`grant execute on function private\\.${fn}`));
  }
  assert.doesNotMatch(code, /\bto (anon|public|service_role)\b/i);
});

test('collab functions never take a workspace or user id from the client', () => {
  for (const m of code.matchAll(/create function (?:public|private)\.app_collab_\w+\(([^)]*)\)/g))
    assert.doesNotMatch(m[1], /workspace|user/i, m[0]);
  // 내 작업공간은 owner 행에서 서버가 찾는다(읽기만).
  assert.match(code, /from public\.app_workspace_members m\s+where m\.user_id = \(select auth\.uid\(\)\) and m\.role = 'owner'/);
});

test('admin-only paths (decisions 6 and 7): invite create/revoke, request decide, remove, move check admin on the server', () => {
  for (const fn of ['app_collab_invite_create', 'app_collab_invite_revoke_all', 'app_collab_request_decide',
    'app_collab_member_remove', 'app_collab_admin_move']) {
    const at = code.indexOf(`create function public.${fn}(`);
    const body = code.slice(at, code.indexOf('\n$$;', at));
    assert.match(body, /private\.app_collab_my_role\([^)]*\) is distinct from 'admin' then\s+raise exception using errcode = '42501', message = 'COLLAB_ADMIN_REQUIRED';/, fn);
  }
});

test('same-name create answers one fixed line; invite tokens are stored only as sha256', () => {
  const at = code.indexOf('create function public.app_collab_group_create(');
  const body = code.slice(at, code.indexOf('\n$$;', at));
  const returns = [...body.matchAll(/return ([^;]*);/g)].map(m => m[1]);
  assert.deepEqual(returns, ["'COLLAB_GROUP_CREATED'", "'COLLAB_GROUP_CREATED'"]);
  assert.match(code, /token_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.doesNotMatch(code, /\btoken text\b/);
  assert.equal((code.match(/pg_catalog\.encode\(pg_catalog\.sha256\(pg_catalog\.convert_to\((v_token|p_token), 'UTF8'\)\), 'hex'\)/g) || []).length, 3);
});

test('existing structures untouched: no change to owner tables, old collaboration tables or other migrations', () => {
  assert.doesNotMatch(code, /alter table public\.app_(workspaces|workspace_members|profiles)\b|(insert into|update|delete from) public\.app_workspace_members|app_invites|app_event_attendees|app_project_members|function private\.app_is_workspace_owner|rtw_/i);
  // 공개 함수에서 남의 표를 owner_workspace_id로 읽는 길은 1단계에 없다(2단계 app_collab_read·write 전용).
  assert.doesNotMatch(code, /owner_workspace_id/);
  // app_collab_ 함수는 이 migration에서만 만든다.
  const others = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql') && f !== `${version}_${name}.sql`
    && /function (public|private)\.app_collab_/.test(readFileSync(`supabase/migrations/${f}`, 'utf8')));
  assert.deepEqual(others, []);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.equal((rollback.match(/^drop table public\.app_collab_\w+;/gm) || []).length, 6);
  assert.equal((rollback.match(/^drop function (public|private)\.app_collab_\w+\([^)]*\);/gm) || []).length, 13);
  assert.doesNotMatch(rollback, /cascade|app_profiles|app_workspace|grant /i);
});
