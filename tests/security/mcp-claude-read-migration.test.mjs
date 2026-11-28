import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// MCP-Claude읽기 M-3(20261120090000_mcp_claude_read, docs/design/mcp-claude-read.md 7절).
// 새 표 2개·문지기·읽기 함수 7개는 승인형 workflow 확장 규칙을 통과하고, 권한은 authenticated만,
// 읽기 함수는 입구(mcp-read)의 도구와 이름·인자가 같다. 실제 동작·거절은 tests/auth-handoff/mcp-claude-read-db.test.mjs(로컬 PostgreSQL).
const version = '20261120090000';
const name = 'mcp_claude_read';
const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
const code = sql.replace(/--.*$/gm, '');
// 입구 도구 → DB 함수 인자(입구 core.mjs rpcArguments: 입력 칸 앞에 p_).
const TOOLS = {
  web2_org_status: ['app_mcp_org_status', ['organization']],
  web2_business_reports: ['app_mcp_business_reports', ['from', 'to', 'project']],
  web2_project_status: ['app_mcp_project_status', ['project']],
  ledger_search: ['app_mcp_ledger_search', ['query', 'organization', 'topic', 'from', 'to', 'limit']],
  ledger_get: ['app_mcp_ledger_get', ['ledger_id']],
  web2_notes_search: ['app_mcp_notes_search', ['query', 'folder', 'limit']],
  google_where: ['app_mcp_google_where', []],
};
const params = fn => {
  const m = new RegExp(`create function public\\.${fn}\\(([^)]*)\\)`).exec(code);
  assert.ok(m, fn);
  return m[1].split(',').map(s => s.trim()).filter(Boolean).map(s => s.split(/\s+/)[0]);
};

test('mcp claude read approval files pass the expanded rules and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.equal(plan.rules, 'expanded');
    assert.equal(plan.flow, 'full');
    assert.equal(plan.functions.length, 12);
    assert.deepEqual(plan.review.definer.sort(), ['private.app_mcp_gate', 'private.app_mcp_gate_done', 'private.app_mcp_note_locks']);
    assert.equal(plan.summaryLines.length, 3);
  }
  assert.match(toDryRun(sql), /rollback;\s*$/);
});

test('read functions match the mcp-read tools by name and arguments', () => {
  for (const [tool, [fn, args]] of Object.entries(TOOLS)) {
    assert.deepEqual(params(fn), args.map(a => `p_${a}`), tool);
    assert.match(code, new RegExp(`private\\.app_mcp_gate\\('${tool}'\\)`), tool);
  }
  assert.equal((code.match(/^create function public\./gm) || []).length, 7);
  // 문지기·기록 표가 받는 도구 이름도 같은 7개.
  for (const tool of Object.keys(TOOLS)) assert.ok((code.match(new RegExp(`'${tool}'`, 'g')) || []).length >= 3, tool);
  // 입구 코드가 main에 들어온 뒤에는 그 도구 정의와 직접 대조한다.
  const core = 'supabase/functions/mcp-read/core.mjs';
  if (existsSync(core)) {
    const text = readFileSync(core, 'utf8');
    for (const [tool, [fn, args]] of Object.entries(TOOLS)) {
      assert.match(text, new RegExp(`name: '${tool}', rpc: '${fn}'`), tool);
      for (const a of args) assert.match(text, new RegExp(`\\b${a}(:| *[,}])`), `${tool}.${a}`);
    }
  }
});

test('grants: authenticated only; tables RLS on with owner policies; no anon, PUBLIC or service_role', () => {
  const grants = [...code.matchAll(/^grant [^;]*;/gim)].map(m => m[0].replace(/\s+/g, ' '));
  assert.equal(grants.length, 15);
  for (const g of grants) assert.match(g, / to authenticated;$/, g);
  assert.doesNotMatch(code, /\bto (anon|public|service_role)\b|with grant option/i);
  for (const t of ['app_mcp_settings', 'app_mcp_read_log']) {
    assert.match(code, new RegExp(`alter table public\\.${t} enable row level security;`));
    assert.match(code, new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated, service_role;`));
  }
  assert.match(code, /grant update \(enabled, revoked_before, updated_at\) on table public\.app_mcp_settings to authenticated;/);
  assert.doesNotMatch(code, /grant (insert|delete|all)[^;]*app_mcp_/i);
  for (const m of code.matchAll(/create function (public|private)\.(app_mcp_\w+)\(/g)) {
    const at = m.index, body = code.slice(at, code.indexOf('\n$$;', at));
    const definer = /security definer/.test(body);
    assert.equal(definer, ['app_mcp_gate', 'app_mcp_gate_done', 'app_mcp_note_locks'].includes(m[2]), m[2]);
    assert.match(body, /set search_path = ''/, m[2]);
    if (m[1] === 'public') assert.match(body, /security invoker/, m[2]);
    assert.match(code, new RegExp(`revoke all on function ${m[1]}\\.${m[2]}\\([^)]*\\) from public, anon, service_role;`), m[2]);
  }
  // 설정 행(허용 클라이언트)은 공개 저장소에 넣지 않는다.
  assert.doesNotMatch(code, /insert into public\.app_mcp_settings/);
});

test('excluded forever: no function names diary, basket, work journal, call, transcript, telegram, outside, family or other product data', () => {
  const fam = 'app_' + 'family';
  assert.doesNotMatch(code, new RegExp(`app_call_|app_tg_|app_feed_|app_outside_|app_meeting|transcript_text|${fam}|rtw_|year_summary|decision_reason|counterparty|drive_file_id|locator`, 'i'));
  assert.equal((code.match(/from public\.app_notes\b/g) || []).length, 1);
  assert.match(code, /n\.kind = 'note' and n\.deleted_at is null and n\.ai_export_allowed is true/);
  // 원장은 민감도 상한·범위를 함수가 고정한다.
  assert.match(code, /public\.app_ledger_search\(v_q, null, v_org, v_topic, p_from, p_to, 'S2', 'work', false, v_limit\)/);
  for (const m of code.matchAll(/create function (public|private)\.app_mcp_\w+\(([^)]*)\)/g)) assert.doesNotMatch(m[2], /workspace|user/i, m[0]);
  // app_mcp_ 함수는 이 migration과 3판 영역 migration(20261127120000_mcp_claude_read_areas, 설계 15절 — 시험은
  // tests/security/mcp-claude-read-areas-migration.test.mjs)과 쓰기 1판 migration(20261128100000_mcp_claude_write, 설계 docs/design/mcp-claude-write.md —
  // 시험은 tests/security/mcp-claude-write-migration.test.mjs·tests/auth-handoff/mcp-claude-write-db.test.mjs)에서만 만든다.
  const others = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql') && f !== `${version}_${name}.sql`
    && f !== '20261127120000_mcp_claude_read_areas.sql' && f !== '20261128100000_mcp_claude_write.sql'
    && /function (public|private)\.app_mcp_/.test(readFileSync(`supabase/migrations/${f}`, 'utf8')));
  assert.deepEqual(others, []);
});

test('L1 pre-request and L2 storage stay in the SQL Editor guard file; rollbacks drop only what they made', () => {
  assert.doesNotMatch(code, /alter role|db_pre_request|storage\.|notify /i);
  const guard = readFileSync('docs/ops/mcp-claude-read-guard.apply.sql', 'utf8').replace(/--.*$/gm, '');
  assert.match(guard, /^begin;/); assert.match(guard, /commit;\s*$/);
  assert.match(guard, /alter role authenticator set pgrst\.db_pre_request = 'public\.app_mcp_pre_request';\s*notify pgrst, 'reload config';/);
  assert.match(guard, /\^\/rpc\/app_mcp_\(org_status\|business_reports\|project_status\|ledger_search\|ledger_get\|notes_search\|google_where\)\$/);
  assert.match(guard, /revoke all on function public\.app_mcp_pre_request\(\) from public;\s*grant execute on function public\.app_mcp_pre_request\(\) to anon, authenticated, service_role;/);
  assert.equal((guard.match(/as restrictive for all to authenticated/g) || []).length, 2);
  assert.doesNotMatch(guard, /as permissive|using \(true\)|disable row level|rtw_/i);
  const guardRollback = readFileSync('docs/ops/mcp-claude-read-guard.rollback.sql', 'utf8').replace(/--.*$/gm, '');
  assert.match(guardRollback, /alter role authenticator reset pgrst\.db_pre_request;\s*notify pgrst, 'reload config';\s*commit;/);
  const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8').replace(/--.*$/gm, '');
  assert.equal((rollback.match(/^drop table public\.app_mcp_\w+;/gm) || []).length, 2);
  assert.equal((rollback.match(/^drop function (public|private)\.app_mcp_\w+\([^)]*\);/gm) || []).length, 12);
  assert.doesNotMatch(rollback, /cascade|grant |app_ledger_search|app_lock_note|app_is_workspace_owner\(/i);
});
