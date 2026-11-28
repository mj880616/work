import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareMigration } from '../../scripts/ops/db-migration-plan.mjs';
import { WRITE_TOOLS } from '../../supabase/functions/mcp-read/core.mjs';

// MCP-Claude쓰기 1판(20261128100000_mcp_claude_write, docs/design/mcp-claude-write.md).
// 입구(mcp-read) 쓰기 도구 11개와 DB 쓰기 함수의 도구·입력 칸 목록이 같고, 기록 표 검사·문지기 목록도 같다.
// 승인형 workflow 확장 규칙 통과, 권한은 authenticated만, 요청 전 함수(L1) 허용 목록은 쓰기 RPC 둘만 더하고 되돌리기 함수는 넣지 않는다.
// 실제 동작·거절은 tests/auth-handoff/mcp-claude-write-db.test.mjs(로컬 PostgreSQL).
const version = '20261128100000';
const name = 'mcp_claude_write';
const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
const code = sql.replace(/--.*$/gm, '');
const rollback = readFileSync(`docs/${version}_${name}.rollback.sql`, 'utf8');
const guard = (f) => readFileSync(`docs/ops/mcp-claude-write-guard.${f}.sql`, 'utf8');
const names = WRITE_TOOLS.map((t) => t.name).sort();
const quoted = (list) => list.map((n) => `'${n}'`).join(', ');

test('plan: expanded rules accept the file; every grant is to authenticated only', () => {
  for (const mode of ['apply', 'dry-run']) {
    const plan = prepareMigration({ mode, version, runId: '1', root: process.cwd() + '/' });
    assert.equal(plan.rules, 'expanded');
    assert.equal(plan.functions.length, 11);
  }
  for (const g of [...code.matchAll(/^grant [^;]*;/gim)].map((m) => m[0].replace(/\s+/g, ' '))) assert.match(g, / to authenticated;$/, g);
  assert.doesNotMatch(code, /\bto (anon|public|service_role)\b/i);
  assert.doesNotMatch(code, /insert into public\.app_mcp_settings/);
});

test('edge tools = db tools: names and argument keys match; log check and gate list the same names', () => {
  const cases = [...code.matchAll(/when '(web2_[a-z_]+)' then array\[([^\]]*)\]/g)].map((m) => [m[1], m[2].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1)).sort()]);
  assert.deepEqual(cases.map((c) => c[0]).sort(), names);
  for (const [tool, keys] of cases) assert.deepEqual(keys, Object.keys(WRITE_TOOLS.find((t) => t.name === tool).inputSchema.properties).sort(), tool);
  const inList = (text) => [...text.matchAll(/'(web2_[a-z_]+)'/g)].map((m) => m[1]);
  const logCheck = /app_mcp_write_log_tool_check check \(tool in \(([^)]*)\)\)/.exec(code)[1];
  assert.deepEqual(inList(logCheck).sort(), names);
  const gate = code.slice(code.indexOf('create function private.app_mcp_write_gate'), code.indexOf('$$;', code.indexOf('create function private.app_mcp_write_gate')));
  assert.deepEqual(inList(gate).sort(), names);
});

test('scope: only five record tables are written; ledger, family, call, telegram, diary and other products never appear', () => {
  const writes = new Set([...code.matchAll(/\b(?:insert into|update|delete from)\s+public\.(app_[a-z_]+)/g)].map((m) => m[1]));
  assert.deepEqual([...writes].sort(), ['app_business_records', 'app_mcp_write_before', 'app_mcp_write_log', 'app_notes', 'app_operator_features', 'app_suborganization_updates']);
  assert.doesNotMatch(code, new RegExp(`app_ledger_|app_${'family'}_|app_feed_|app_call_|app_tg_|app_outside_|rtw_|app_collab_|storage\\.|drive_file_id`, 'i'));
  // 지우기는 휴지통만: app_notes delete는 노트·업데이트 휴지통 트리거 길(그 뒤 안 보이는지 확인)뿐, 휴지통 비우기 함수는 부르지 않는다.
  assert.doesNotMatch(code, /app_trash_purge|\btruncate (table )?public/i);
  for (const m of code.matchAll(/create function (public|private)\.(app_mcp_w\w*)\(([^)]*)\)/g)) {
    const at = code.indexOf(m[0]);
    const body = code.slice(at, code.indexOf('\n$$;', at));
    assert.match(body, /set search_path = ''/, m[2]);
    if (m[1] === 'public') assert.match(body, /security invoker/, m[2]);
    assert.match(code, new RegExp(`revoke all on function ${m[1]}\\.${m[2]}\\([^)]*\\) from public, anon, service_role;`), m[2]);
  }
  // 되돌리기는 위임 열쇠를 거절한다.
  const undo = code.slice(code.indexOf('create function public.app_mcp_write_undo'));
  assert.match(undo, /client_id', ''\) <> ''/);
});

test('L1 guard: adds app_mcp_write and app_mcp_write_tools only; rollback returns to the 17 read names; main rollback waits for it', () => {
  const list = (text) => /app_mcp_\(([^)]*)\)\$'/.exec(text)[1].split('|');
  const after = list(guard('apply'));
  const before = list(guard('rollback'));
  assert.equal(before.length, 17);
  assert.deepEqual(after, [...before, 'write', 'write_tools']);
  assert.doesNotMatch(guard('apply').replace(/--.*$/gm, ''), /write_undo/);
  assert.match(rollback, /undo docs\/ops\/mcp-claude-write-guard first/);
  for (const fn of ['app_mcp_write_undo(uuid)', 'app_mcp_write(text, jsonb)', 'app_mcp_write_tools()', 'app_mcp_write_gate(text)', 'app_mcp_write_check(boolean)'])
    assert.ok(rollback.includes(fn), fn);
  assert.match(rollback, /drop table public\.app_mcp_write_before;\s*drop table public\.app_mcp_write_log;/);
  assert.match(rollback, /check \(feature in \(([^)]*)\)\)/);
  assert.doesNotMatch(/check \(feature in \(([^)]*)\)\)/.exec(rollback)[1], /mcp_write/);
});
