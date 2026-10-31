import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMigration } from '../../scripts/ops/db-migration-plan.mjs';
import { runFullPlan } from '../../scripts/ops/db-migration-run.mjs';
import { annotationCommand, ANNOTATION_MAX_BYTES, runPlan, makePlan } from '../../scripts/ops/db-workflow.mjs';
import { DbQueryError } from '../../scripts/ops/db-query.mjs';

// OPS-DB결과API: the run result must also reach check-run annotations (readable through the
// REST API), with only the text the summary already shows.
const root = fileURLToPath(new URL('../../', import.meta.url));
const version = '20261031000000';
const secret = 'synthetic-secret-annotation';
const projectRef = 'abcdefghijklmnopqrst';
const plan = mode => prepareMigration({ mode, version, runId: '12345', root });
const hash = 'a'.repeat(32);
const preRows = (override = {}) => [
  ['prerequisite recorded', '예'], ['new migration absent', '예'], ['new functions absent', '예'], ['no subcategory yet', '예'],
  ['merge profiles with separate parent', '0'], ['merge profiles', '1'], ['weekly documents to move', '3'], ['RLS enabled', '예'],
  ['policy counts', '예'], ['owner RLS grants hash', hash], ['policies hash', hash], ['constraints hash', hash],
  ['profiles rows', '1'], ['documents rows', '10'],
].map(([item, value]) => ({ item, value: override[item] ?? value }));
const fakeQuery = (p, { pre = preRows(), snapshot = [], fail = null } = {}) => async sql => {
  if (fail && fail.when(sql)) throw fail.error;
  if (sql === p.checks.precheck.sql) return pre;
  if (sql === p.snapshot.sql) return snapshot;
  if (sql.startsWith('select count(*)::int as count from supabase_migrations.schema_migrations')) return [{ count: 0 }];
  return [];
};
// Decode one workflow command line back to (level, title, message).
function decode(line) {
  const m = line.match(/^::(notice|error) title=([^:]*)::(.*)\n$/s);
  assert.ok(m, `not a workflow command: ${line}`);
  assert.equal(m[3].includes('\n') || m[3].includes('\r'), false);
  const data = v => v.replaceAll('%0A', '\n').replaceAll('%0D', '\r').replaceAll('%3A', ':').replaceAll('%2C', ',').replaceAll('%25', '%');
  return { level: m[1], title: data(m[2]), message: data(m[3]), raw: m[3] };
}
const annotate = (p, result) => decode(annotationCommand({ mode: p.mode, version: p.version, ok: result.ok,
  exitCode: result.ok && result.verification !== 'incomplete' ? 0 : 1, report: result.report }, [secret, projectRef]));

test('stop on precheck 아니오: error annotation names phase, reason and each failed item with value and expectation', async () => {
  const p = plan('dry-run');
  const result = await runFullPlan(p, fakeQuery(p, { pre: preRows({ 'merge profiles with separate parent': '1', 'policy counts': '아니오' }) }),
    { secretValues: [secret, projectRef] });
  assert.equal(result.ok, false);
  const a = annotate(p, result);
  assert.equal(a.level, 'error');
  assert.equal(a.title, `DB dry-run ${version} stopped`);
  assert.match(a.message, /^모드: dry-run · version: 20261031000000 · 결과: 멈춤$/m);
  assert.match(a.message, /^단계: 사전 확인\(precheck\)$/m);
  assert.match(a.message, /^이유: 사전 확인이 기대와 다릅니다/m);
  assert.match(a.message, /^아니오\(사전\): merge profiles with separate parent · 값 1 · 기대 0$/m);
  assert.match(a.message, /^아니오\(사전\): policy counts · 값 아니오 · 기대 예$/m);
  assert.doesNotMatch(a.message, /prerequisite recorded|select|app_profiles/);
  assert.match(a.message, /쓰기 요청 전송: 아니오/);
  // The same rows and reason are already in the public summary.
  assert.match(result.summary, /\| merge profiles with separate parent \| 1 \| 0 \| 아니오 \|/);
  assert.match(result.summary, /\| policy counts \| 아니오 \| 예 \| 아니오 \|/);
  assert.ok(result.summary.includes(result.report.reason));
});

test('SQL error: error annotation carries the bounded error summary only, never raw DB text or secrets', async () => {
  const p = plan('dry-run');
  const error = new DbQueryError('API', { status: 400, sqlState: '42883' });
  error.raw = `${secret} operator does not exist: text[] && jsonb in select from public.app_profiles`;
  const result = await runFullPlan(p, fakeQuery(p, { fail: { when: sql => sql === p.checks.precheck.sql, error } }),
    { secretValues: [secret, projectRef] });
  const a = annotate(p, result);
  assert.equal(a.level, 'error');
  assert.match(a.message, /결과: 오류/);
  assert.match(a.message, /^단계: 사전 확인\(precheck\)$/m);
  assert.match(a.message, /^오류: HTTP 400 · API · SQLSTATE 42883: DB 요청·응답 확인 실패/m);
  assert.doesNotMatch(a.message + a.title, /synthetic-secret|operator does not exist|app_profiles|abcdefghijklmnopqrst/);
});

test('runner validation error (oversized snapshot value) gets a fixed reason in both summary and annotation', async () => {
  const p = plan('dry-run');
  const long = [{ kind: 'constraint', name: 'public.app_profiles.x', definition: 'C'.repeat(9000) }];
  const result = await runFullPlan(p, fakeQuery(p, { snapshot: long }), { secretValues: [secret] });
  const a = annotate(p, result);
  assert.match(a.message, /^단계: 상태 저장\(snapshot\)$/m);
  assert.match(a.message, /원인 분류: snapshot 값이 8192자를 넘거나/);
  assert.match(result.summary, /원인 분류: snapshot 값이 8192자를 넘거나/);
  assert.doesNotMatch(a.message, /CCCC/);
});

test('success: notice annotation with mode, version and end phase', async () => {
  const p = plan('dry-run');
  const result = await runFullPlan(p, fakeQuery(p), { secretValues: [secret] });
  assert.equal(result.ok, true, result.summary);
  const a = annotate(p, result);
  assert.equal(a.level, 'notice');
  assert.equal(a.title, `DB dry-run ${version} ok`);
  assert.match(a.message, /결과: 성공\n단계: 끝/);
  assert.match(a.message, /적용 요청 전송: 예/);
  // check mode success too.
  const check = makePlan('check', '12345', 'refs/heads/main');
  const r = await runPlan(check, async () => [{ version, name: 'doc_subcategories' }], { secretValues: [secret] });
  const c = decode(annotationCommand({ mode: 'check', ok: r.ok, exitCode: 0, report: r.report }, [secret]));
  assert.equal(c.level, 'notice');
  assert.match(c.message, /최근 migration 1행 확인/);
});

test('encoding, size limit and final secret guard', () => {
  const failed = Array.from({ length: 400 }, (_, i) => ({ stage: '사전', item: `item ${i}`, value: '1%\r\n2', expected: '0' }));
  const line = annotationCommand({ mode: 'apply', version, exitCode: 1, report: { phase: 'x\ny', failed } }, [secret]);
  const a = decode(line);
  assert.ok(Buffer.byteLength(a.message, 'utf8') <= ANNOTATION_MAX_BYTES);
  assert.match(a.message, /줄 잘림, 나머지는 run 요약/);
  assert.match(a.message, /^단계: x y$/m);
  assert.doesNotMatch(a.raw, /%(?!0A|0D|25)/);
  const leaked = decode(annotationCommand({ mode: 'apply', version, exitCode: 1, report: { reason: `token ${secret}` } }, [secret]));
  assert.doesNotMatch(leaked.message, /synthetic-secret/);
  assert.match(leaked.message, /가릴 값이 있어 생략/);
  const bad = decode(annotationCommand({ mode: 'apply::x\n', version: '1; drop', exitCode: 1, report: {} }));
  assert.equal(bad.title, 'DB unknown stopped');
});

test('CLI run prints exactly one annotation command, masks first, and keeps secrets out of stdout', async () => {
  const p = plan('dry-run');
  const responses = [[{ count: 0 }], preRows({ 'no subcategory yet': '아니오' })];
  const server = createServer(async (req, res) => {
    for await (const _ of req);
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify(responses.shift() ?? []));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const dir = mkdtempSync(join(tmpdir(), 'db-annot-'));
  try {
    const bridge = join(dir, 'local-http-only.mjs');
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    writeFileSync(bridge, `const request = globalThis.fetch; globalThis.fetch = (_url, options) => request(${JSON.stringify(endpoint)}, options);`);
    const summary = join(dir, 'summary.md');
    const child = spawn(process.execPath, ['--import', bridge, join(root, 'scripts/ops/db-workflow.mjs'), 'run'], {
      cwd: root, env: { PATH: process.env.PATH, DB_MODE: 'dry-run', DB_VERSION: `${version}_doc_subcategories.sql`, GITHUB_REF: 'refs/heads/main',
        GITHUB_RUN_ID: '12345', GITHUB_STEP_SUMMARY: summary, SUPABASE_ACCESS_TOKEN: secret, SUPABASE_PROJECT_REF: projectRef },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', c => { stdout += c; }); child.stderr.on('data', c => { stderr += c; });
    const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(status, 1, stderr);
    const lines = stdout.split(/(?<=\n)/);
    assert.equal(lines.filter(l => l.startsWith('::add-mask::')).length, 2);
    const commands = lines.filter(l => /^::(notice|error) /.test(l));
    assert.equal(commands.length, 1);
    assert.ok(lines.indexOf(commands[0]) > 1, 'masks come before the annotation');
    const a = decode(commands[0]);
    assert.match(a.message, /아니오\(사전\): no subcategory yet · 값 아니오 · 기대 예/);
    assert.doesNotMatch(commands[0], /synthetic-secret|abcdefghijklmnopqrst/);
    assert.match(readFileSync(summary, 'utf8'), /no subcategory yet \| 아니오 \| 예 \| 아니오/);
  } finally {
    server.closeAllConnections(); await new Promise(done => server.close(done));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan rejection prints one fixed-text error annotation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'db-annot-'));
  try {
    const child = spawn(process.execPath, [join(root, 'scripts/ops/db-workflow.mjs'), 'plan'], {
      cwd: root, env: { PATH: process.env.PATH, DB_MODE: 'dry-run', DB_VERSION: '29991231000000', GITHUB_REF: 'refs/heads/main',
        GITHUB_RUN_ID: '12345', GITHUB_STEP_SUMMARY: join(dir, 'summary.md') }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; child.stdout.on('data', c => { stdout += c; }); child.stderr.resume();
    const status = await new Promise(resolve => child.once('close', resolve));
    assert.equal(status, 1);
    const a = decode(stdout);
    assert.equal(a.level, 'error');
    assert.match(a.message, /단계: plan 거절\(plan\)\n이유: /);
    assert.match(a.message, /DB 요청 전송: 아니오/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
