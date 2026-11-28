// MCP-Claude쓰기 ③ 파일 첨부 migration 정적 시험(설계 docs/design/mcp-claude-write.md 11절). 동작 시험은 tests/auth-handoff/mcp-claude-write-db.test.mjs ③ 절.
// 지키는 것: 새 anon·PUBLIC 권한 없음, 저장 함수(commit)만 service_role이고 authenticated는 못 부름, 확인·되돌림 표시는 authenticated만,
// 확인·되돌림 함수는 작업공간·사용자 값을 받지 않음, 닿는 표는 노트·쓰기 기록(그리고 1판 되돌리기 본문 그대로), 원장·가족·통화·텔레그램 표 이름 없음,
// 문지기·1판 되돌리기는 1판 본문과 같고(이름 목록 +2 / attach 거절 한 줄만 다름), L1 파일은 목록에 attach_check 하나만 더함.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const strip = (sql) => sql.replace(/^[ \t]*--.*\n/gm, '').replace(/--.*$/gm, '');
const mig = read('supabase/migrations/20261128120000_mcp_claude_attach.sql');
const code = strip(mig);
const first = strip(read('supabase/migrations/20261128100000_mcp_claude_write.sql'));
const fn = (src, head) => { const a = src.indexOf(head); assert.ok(a >= 0, head); return src.slice(a, src.indexOf('\n$$;', a)); };

test('권한: commit만 service_role, 확인·되돌림 표시는 authenticated만, anon·PUBLIC 없음', () => {
  const grants = [...code.matchAll(/^grant [^;]*;/gim)].map((m) => m[0].replace(/\s+/g, ' '));
  assert.deepEqual(grants.sort(), [
    'grant execute on function private.app_mcp_write_gate(text) to authenticated;',
    'grant execute on function public.app_mcp_attach_check(text, jsonb) to authenticated;',
    'grant execute on function public.app_mcp_attach_commit(uuid, uuid, timestamptz, jsonb) to service_role;',
    'grant execute on function public.app_mcp_attach_undone(uuid) to authenticated;',
    'grant execute on function public.app_mcp_write_undo(uuid) to authenticated;',
  ]);
  assert.match(code, /revoke all on function public\.app_mcp_attach_commit\(uuid, uuid, timestamptz, jsonb\) from public, anon, authenticated;/);
  assert.doesNotMatch(code, /\bto (anon|public)\b|alter role|db_pre_request|storage\.|disable row level security|grant (select|insert|update|delete)/i);
  assert.match(fn(code, 'create function public.app_mcp_attach_commit('), /security definer\s+set search_path = ''/);
  for (const head of ['create function public.app_mcp_attach_check(', 'create function public.app_mcp_attach_undone(']) {
    const body = fn(code, head);
    assert.match(body, /security invoker\s+set search_path = ''/, head);
    assert.doesNotMatch(body.slice(0, body.indexOf(')')), /workspace|user/i, head);
  }
  assert.match(fn(code, 'create function public.app_mcp_attach_check('), /v_ws := private\.app_mcp_write_gate\(p_tool\);/);
  assert.match(fn(code, 'create function public.app_mcp_attach_undone('), /client_id', ''\) <> ''/);
});

test('범위: 원장·가족·통화·텔레그램·공유·다른 제품 표 이름 없음, 기록에 파일 이름을 넣지 않음', () => {
  assert.doesNotMatch(code, /app_ledger_|app_family_|app_feed_|app_call_|app_tg_|app_outside_|rtw_|app_collab_/);
  const attach = [fn(code, 'create function public.app_mcp_attach_check('), fn(code, 'create function public.app_mcp_attach_commit('), fn(code, 'create function public.app_mcp_attach_undone(')].join('\n');
  const writes = [...attach.matchAll(/\b(?:insert into|update|delete from)\s+public\.(app_[a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(writes)].sort(), ['app_mcp_write_log', 'app_notes']);
  assert.doesNotMatch(attach, /delete from/);
  const logSet = fn(code, 'create function public.app_mcp_attach_commit(').match(/update public\.app_mcp_write_log l\s+set ([\s\S]*?)where/)[1];
  assert.doesNotMatch(logSet, /file_name/);
  assert.match(code, /n\.kind = case v_kind when 'note' then 'note' else 'basket' end/);
  assert.match(code, /v_kind not in \('note', 'update'\)/);
  assert.match(code, /8388608/); assert.match(code, /104857600/); assert.match(code, />= 20/); assert.match(code, />= 30/); assert.match(code, /1073741824/);
});

test('1판 함수 다시 만들기: 문지기는 이름 목록 +2만, 되돌리기는 attach 거절 한 줄만 다르다', () => {
  const gate1 = fn(first, 'create function private.app_mcp_write_gate(');
  const gate2 = fn(code, 'create or replace function private.app_mcp_write_gate(');
  assert.equal(gate2.replace('create or replace function', 'create function').replace(",\n      'web2_attach_file', 'web2_attach_drive_file')", ')'), gate1);
  const undo1 = fn(first, 'create function public.app_mcp_write_undo(');
  const undo2 = fn(code, 'create or replace function public.app_mcp_write_undo(');
  const extra = "  if v_log.action = 'attach' then\n    raise exception using errcode = 'P0002', message = 'NOT_FOUND';\n  end if;\n";
  assert.ok(undo2.includes(extra));
  assert.equal(undo2.replace('create or replace function', 'create function').replace(extra, ''), undo1);
  // 되돌리기 파일은 1판 본문으로 되돌린다.
  const rb = strip(read('docs/20261128120000_mcp_claude_attach.rollback.sql'));
  assert.equal(fn(rb, 'create or replace function private.app_mcp_write_gate(').replace('create or replace function', 'create function'), gate1);
  assert.equal(fn(rb, 'create or replace function public.app_mcp_write_undo(').replace('create or replace function', 'create function'), undo1);
});

test('L1 파일: 1판 목록에 attach_check 하나만 더하고, 되돌리기는 1판 목록으로', () => {
  const list = (sql) => sql.match(/\^\/rpc\/app_mcp_\(([^)]*)\)\$/)[1].split('|');
  const write = list(read('docs/ops/mcp-claude-write-guard.apply.sql'));
  const apply = list(read('docs/ops/mcp-claude-attach-guard.apply.sql'));
  assert.deepEqual(apply, [...write, 'attach_check']);
  assert.deepEqual(list(read('docs/ops/mcp-claude-attach-guard.rollback.sql')), write);
  assert.doesNotMatch(apply.join('|'), /commit|undone|undo/);
  const strip2 = (s) => s.slice(s.indexOf('create or replace function'), s.indexOf("notify pgrst"));
  assert.equal(strip2(read('docs/ops/mcp-claude-attach-guard.apply.sql')).replace('|attach_check)', ')'), strip2(read('docs/ops/mcp-claude-write-guard.apply.sql')));
});
