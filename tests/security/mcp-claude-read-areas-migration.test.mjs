import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';

// MCP-Claude읽기 3판(20261127120000_mcp_claude_read_areas, docs/design/mcp-claude-read.md 15절).
// 영역 칸 5개·문지기 교체·도우미 7개·읽기 함수 10개는 승인형 workflow 확장 규칙을 통과하고, 권한은 authenticated만(잠금 영역 도우미는 아무도),
// 읽기 함수는 입구(mcp-read) 새 도구와 이름·인자가 같고, 요청 전 함수(L1) 허용 목록·되돌리기가 서로 맞는다.
// 실제 동작·거절은 tests/auth-handoff/mcp-claude-read-areas-db.test.mjs(로컬 PostgreSQL).
const version = '20261127120000';
const name = 'mcp_claude_read_areas';
const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
const code = sql.replace(/--.*$/gm, '');
const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8');
const old = readFileSync('supabase/migrations/20261120090000_mcp_claude_read.sql', 'utf8');
const guard = f => readFileSync(`docs/ops/mcp-claude-read-guard-areas.${f}.sql`, 'utf8');
const OLD_TOOLS = ['web2_org_status', 'web2_business_reports', 'web2_project_status', 'ledger_search', 'ledger_get', 'web2_notes_search', 'google_where'];
// 입구 도구 → DB 함수 인자(입구 core.mjs rpcArguments: 입력 칸 앞에 p_).
const AREA_TOOLS = {
  web2_day_list: ['app_mcp_day_list', ['from', 'to', 'query', 'limit']],
  web2_day_get: ['app_mcp_day_get', ['day', 'page']],
  web2_calls_list: ['app_mcp_calls_list', ['from', 'to', 'query', 'box', 'limit']],
  web2_call_get: ['app_mcp_call_get', ['call_id', 'page']],
  web2_recordings_list: ['app_mcp_recordings_list', ['from', 'to', 'query', 'limit']],
  web2_recording_get: ['app_mcp_recording_get', ['meeting_id', 'page']],
  web2_basket_search: ['app_mcp_basket_search', ['query', 'from', 'to', 'limit']],
  web2_basket_get: ['app_mcp_basket_get', ['item_id', 'page']],
  web2_family_list: ['app_mcp_family_list', ['status', 'limit']],
  web2_family_get: ['app_mcp_family_get', ['note_id', 'page']],
};
const params = fn => {
  const m = new RegExp(`create function public\\.${fn}\\(([^)]*)\\)`).exec(code);
  assert.ok(m, fn);
  return m[1].split(',').map(s => s.trim()).filter(Boolean).map(s => s.split(/\s+/)[0]);
};
const gateBody = text => {
  const at = text.search(/create (or replace )?function private\.app_mcp_gate\(p_tool text\)/);
  return text.slice(text.indexOf('returns uuid', at), text.indexOf('\n$$;', at));
};

test('areas approval files pass the expanded rules and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run']) {
    const plan = prepareMigration({ mode, version, runId: '12345', root: process.cwd() });
    assert.equal(plan.name, name);
    assert.equal(plan.rules, 'expanded');
    assert.equal(plan.flow, 'full');
    assert.equal(plan.functions.length, 18);
    assert.deepEqual(plan.review.definer.sort(), ['private.app_mcp_gate', 'private.app_mcp_locked_areas']);
    assert.equal(plan.summaryLines.length, 3);
  }
  assert.match(toDryRun(sql), /rollback;\s*$/);
});

test('area read functions match the planned mcp-read tools by name and arguments; gate and log check know all 17 tools', () => {
  for (const [tool, [fn, args]] of Object.entries(AREA_TOOLS)) {
    assert.deepEqual(params(fn), args.map(a => `p_${a}`), tool);
    assert.match(code, new RegExp(`v_ws := private\\.app_mcp_gate\\('${tool}'\\);`), tool);
  }
  assert.equal((code.match(/^create function public\./gm) || []).length, 10);
  for (const tool of [...OLD_TOOLS, ...Object.keys(AREA_TOOLS)]) {
    // 문지기 허용 목록 + 기록 표 검사 = 최소 2번.
    assert.ok((code.match(new RegExp(`'${tool}'`, 'g')) || []).length >= 2, tool);
  }
  // 가족 영역만 기본 꺼짐.
  assert.match(code, /add column area_family boolean not null default false/);
  for (const a of ['diary', 'calls', 'recordings', 'basket']) assert.match(code, new RegExp(`add column area_${a} boolean not null default true`));
  // 운영자 기능은 문지기가 calls·family로 확인한다.
  assert.match(code, /v_area = 'calls' and not private\.app_workspace_has_feature\(v_ws, 'calls'\)/);
  assert.match(code, /v_area = 'family' and not private\.app_workspace_has_feature\(v_ws, 'family'\)/);
});

test('grants: authenticated only, lock helper runs for nobody; no anon, PUBLIC or service_role; no new table', () => {
  for (const g of [...code.matchAll(/^grant [^;]*;/gim)].map(m => m[0].replace(/\s+/g, ' '))) assert.match(g, / to authenticated;$/, g);
  assert.doesNotMatch(code, /\bto (anon|public|service_role)\b|alter role|db_pre_request|storage\.|create table|disable row level security/i);
  assert.match(code, /revoke all on function private\.app_mcp_locked_areas\(\) from public, anon, authenticated, service_role;/);
  assert.doesNotMatch(code, /grant execute on function private\.app_mcp_locked_areas/);
  // 잠금 표에서는 user_id·features만 읽는다(비밀번호 칸 없음).
  assert.doesNotMatch(code, /pin_hash|fail_count|blocked_until/);
  for (const m of code.matchAll(/create (or replace )?function (public|private)\.app_mcp_\w+\(([^)]*)\)/g)) assert.doesNotMatch(m[3], /workspace|user/i, m[0]);
});

test('gate keeps every 2nd edition check; rollback restores the 2nd edition gate text exactly', () => {
  const now = gateBody(code), before = gateBody(old);
  for (const line of ["raise exception using errcode = 'PT403', message = 'NOT_ALLOWED';", "message = 'DISCONNECTED'", "message = 'RATE_LIMITED'",
    "l.called_at > pg_catalog.now() - interval '1 minute') >= 20", "l.called_at >= v_day_start) >= 300", 'for update;', 'v_started <= v_revoked',
    "insert into public.app_mcp_read_log(workspace_id, tool, status) values (v_ws, p_tool, 'ok');"]) {
    assert.ok(before.includes(line), line);
    assert.ok(now.includes(line), line);
  }
  assert.ok(now.indexOf("message = 'AREA_OFF'") > now.indexOf('v_started <= v_revoked'), 'area check after disconnect check');
  assert.ok(now.indexOf("message = 'AREA_OFF'") < now.indexOf("message = 'RATE_LIMITED'"), 'area check before limits');
  assert.equal(gateBody(rollback), before);
  const rb = rollback.replace(/--.*$/gm, '');
  assert.equal((rb.match(/^drop function (public|private)\.app_mcp_\w+\([^)]*\);/gm) || []).length, 17);
  assert.doesNotMatch(rb, /drop function (public|private)\.app_mcp_(org_status|business_reports|project_status|ledger_search|ledger_get|notes_search|google_where|gate_done|note_locks|clip|arg)\(/);
  assert.doesNotMatch(rb, /drop table/);
});

test('L1 widening file lists exactly the 17 read RPCs; its rollback lists the 2nd edition 7; nothing else in the body changes', () => {
  const list = text => /\^\/rpc\/app_mcp_\(([a-z_|]+)\)\$/.exec(text)[1].split('|');
  const tools = [...OLD_TOOLS, ...Object.keys(AREA_TOOLS)];
  const wanted = tools.map(t => t.replace(/^web2_/, ''));
  assert.deepEqual(list(guard('apply')).sort(), wanted.sort());
  assert.deepEqual(list(guard('rollback')).sort(), ['business_reports', 'google_where', 'ledger_get', 'ledger_search', 'notes_search', 'org_status', 'project_status']);
  const v2 = readFileSync('docs/ops/mcp-claude-read-guard.apply.sql', 'utf8');
  const body = text => text.slice(text.indexOf('returns void'), text.indexOf('\n$$;', text.indexOf('returns void'))).replace(/\(([a-z_|]+)\)\$/, '(LIST)$');
  assert.equal(body(guard('apply')), body(v2));
  assert.equal(body(guard('rollback')), body(v2));
  for (const f of ['apply', 'rollback']) {
    assert.match(guard(f), /revoke all on function public\.app_mcp_pre_request\(\) from public;\ngrant execute on function public\.app_mcp_pre_request\(\) to anon, authenticated, service_role;/);
    assert.doesNotMatch(guard(f), /alter role|storage\.|drop /i);
  }
  assert.doesNotMatch(guard('precheck').replace(/--.*$/gm, ''), /\b(insert|update|delete|alter|create|drop|grant|revoke)\b/i);
});
