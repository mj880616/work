import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// S69 STORE-계정삭제(20261124130000_account_delete). 실제 동작(본인만·남 그대로·거절·되돌리기)은 tests/auth-handoff/account-delete-db.test.mjs.
// 여기서는 파일 모양만 본다: 확장 규칙 통과, 함수가 id를 받지 않음, 지우는 표 목록 = 확인 SQL 목록, Auth·다른 서비스 표를 건드리지 않음.
const version = '20261124130000';
const name = 'account_delete';
const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
const code = sql.replace(/--.*$/gm, '');
const pair = suffix => readFileSync(`docs/${version}_${name}.${suffix}`, 'utf8');

test('account delete approval files pass the expanded rules and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.equal(plan.rules, 'expanded');
    assert.deepEqual([...plan.functions].sort(), ['private.app_account_delete_run', 'public.app_account_delete', 'public.app_account_delete_check']);
    assert.equal(plan.summaryLines.length, 3);
    assert.equal(plan.review.policies, 0);
    assert.equal(plan.review.triggers, 1);
    assert.equal(plan.review.grants, 2);
  }
  assert.match(toDryRun(sql), /rollback;\s*$/);
});

test('only two execute grants, both to authenticated; functions take no workspace or user id', () => {
  const grants = [...code.matchAll(/^grant [^;]*;/gim)].map(m => m[0].replace(/\s+/g, ' '));
  assert.deepEqual(grants, [
    'grant execute on function public.app_account_delete_check() to authenticated;',
    'grant execute on function public.app_account_delete(text) to authenticated;',
  ]);
  const signatures = [...code.matchAll(/create function (public|private)\.(app_account_delete\w*)\(([^)]*)\)/g)].map(m => `${m[1]}.${m[2]}(${m[3]})`);
  assert.deepEqual(signatures, ['private.app_account_delete_run()', 'public.app_account_delete_check()', 'public.app_account_delete(p_confirm text)']);
  assert.doesNotMatch(code, /\buuid\s*[,)]\s*(?:returns|language)/i);
  for (const fn of ['app_account_delete_run', 'app_account_delete_check', 'app_account_delete(']) {
    const at = code.indexOf(`function ${fn.startsWith('app_account_delete_run') ? 'private.' : 'public.'}${fn}`);
    assert.ok(at >= 0, fn);
    assert.match(code.slice(at, at + 400), /security definer\s+set search_path = ''/, fn);
  }
  // 새 표는 API 역할에 열지 않고, 기존 표의 정책·권한·RLS는 건드리지 않는다.
  assert.match(code, /revoke all on table public\.app_account_delete_runs from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(code, /create policy|alter table public\.app_(?!account_delete_runs)|disable row level security|\bto (anon|public)\b/i);
});

test('delete targets are exactly the check list; user rows by caller id, workspace rows by the caller workspace only', () => {
  const at = code.indexOf('create function private.app_account_delete_run()');
  const body = code.slice(at, code.indexOf('\n$$;', at));
  const targets = [...body.matchAll(/delete from public\.(app_\w+) (\w+)\s+where ([^;]+);/g)].map(m => ({ table: m[1], where: m[3].replace(/\s+/g, ' ') }));
  for (const { table, where } of targets) {
    assert.match(where, /= v_(uid|ws)\b/, table);
    assert.doesNotMatch(where, /\$|current_setting|\bp_confirm\b/, table);
  }
  const listed = pair('precheck.sql').match(/listed\(tbl,col\) as \(values([\s\S]*?\))\),/)[1];
  const pairs = [...listed.matchAll(/\('(app_\w+)','(\w+)'\)/g)].map(m => `${m[1]}.${m[2]}`);
  assert.equal(new Set(pairs).size, pairs.length);
  // 확인 SQL의 목록(표.칸)이 함수가 지우는 표·칸과 같다(남는 표 검사가 함수와 같은 기준으로 돈다).
  const deleted = new Set();
  for (const { table, where } of targets) if (table !== 'app_collab_groups') for (const m of where.matchAll(/\b\w+\.(\w+) = v_(?:uid|ws)\b/g)) deleted.add(`${table}.${m[1]}`);
  deleted.add('app_collab_groups.id'); // 혼자인 묶음(g.id in …)
  assert.deepEqual([...deleted].sort(), [...pairs].sort());
  assert.equal(pair('postcheck.sql').match(/listed\(tbl,col\) as \(values([\s\S]*?\))\),/)[1], listed);
  // 작업공간 행은 맨 끝, 작업공간 연결 줄 바로 앞.
  const order = targets.map(t => t.table);
  assert.deepEqual(order.slice(-2), ['app_workspace_members', 'app_workspaces']);
  assert.ok(order.indexOf('app_record_links') < order.indexOf('app_spaces'));
});

test('never touches Auth users, other products, secrets or storage rows directly', () => {
  assert.doesNotMatch(sql, /rtw|auth\.users|storage\.objects|vault\.|execute format|set_config/i);
  assert.doesNotMatch(code, /delete from (?!public\.)/i);
  // 확인 글자는 서버도 본다(화면만 믿지 않음).
  assert.match(code, /if p_confirm is distinct from '삭제' then/);
  // 위임 열쇠 거절은 DB에도 있다(Edge를 거치지 않는 RPC 호출 대비).
  assert.match(code, /auth\.jwt\(\)\) ->> 'client_id'/);
  // 되돌리기: 새 것만 지우고 기록 1행.
  const rollback = pair('rollback.sql').replace(/--.*$/gm, '');
  assert.deepEqual([...rollback.matchAll(/^drop [^;]*;/gim)].map(m => m[0]), [
    'drop trigger app_account_delete_runs_run on public.app_account_delete_runs;',
    'drop function public.app_account_delete(text);',
    'drop function public.app_account_delete_check();',
    'drop function private.app_account_delete_run();',
    'drop table public.app_account_delete_runs;',
  ]);
});
