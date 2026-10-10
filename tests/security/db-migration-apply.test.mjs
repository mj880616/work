import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';

const workflow = new URL('../../.github/workflows/db-migration-apply.yml', import.meta.url);
const source = existsSync(workflow) ? readFileSync(workflow, 'utf8') : '';
const runner = new URL('../../scripts/ops/db-workflow.mjs', import.meta.url);
const helper = new URL('../../scripts/ops/db-query.mjs', import.meta.url);
const load = () => import(runner);
const token = 'synthetic-secret-for-tests';
const projectRef = 'abcdefghijklmnopqrst';

test('DB workflow exposes only manual check/tx-probe, main, approved run, fixed permissions and concurrency', () => {
  assert.match(source, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(source, /^  (push|schedule|pull_request|pull_request_target|workflow_call):/m);
  assert.match(source, /options: \[check, tx-probe\]/);
  assert.doesNotMatch(source, /dry-run|rollback:|apply:|inputs\.ref/);
  assert.match(source, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(source, /^\s+[\w-]+:\s*write\s*$/m);
  const plan = source.split('  plan:\n')[1].split('  run:\n')[0];
  assert.doesNotMatch(plan, /secrets\.|environment:/);
  assert.match(plan, /ref: main/);
  assert.match(source, /needs: plan\n[\s\S]*?environment: production-edge/);
  assert.match(source, /ref: \$\{\{ needs\.plan\.outputs\.source_sha \}\}/);
  assert.match(source, /group: supabase-production-db\n  cancel-in-progress: false/);
  assert.equal([...source.matchAll(/timeout-minutes: /g)].length, 2);
  assert.match(source, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(source, /SUPABASE_PROJECT_REF: \$\{\{ vars\.SUPABASE_PROJECT_REF \}\}/);
  assert.equal([...source.matchAll(/persist-credentials: false/g)].length, 2);
  for (const action of [...source.matchAll(/uses: (\S+)/g)]) assert.match(action[1], /@[a-f0-9]{40}$/);
  assert.doesNotMatch(source, /set -x|upload-artifact|\$\{\{ inputs\.[^\n]*\n[^\n]*run:/);
});

test('only two modes, main dispatch and numeric run IDs are accepted; probe cannot target another schema/table', async () => {
  const { makePlan } = await load();
  for (const mode of ['check', 'tx-probe']) assert.equal(makePlan(mode, '12345', 'refs/heads/main').mode, mode);
  for (const mode of ['', 'apply', 'dry-run', 'rollback', 'CHECK', 'check;echo injected']) {
    assert.throws(() => makePlan(mode, '12345', 'refs/heads/main'));
  }
  for (const id of ['', '-1', '1;drop table public.app_notes', '../1', '1.5', '1\n', 'a', '0', '1'.repeat(21)]) {
    assert.throws(() => makePlan('tx-probe', id, 'refs/heads/main'));
  }
  assert.throws(() => makePlan('check', '12345', 'refs/heads/codex/ops-db-approve'));
  const plan = makePlan('tx-probe', '12345', 'refs/heads/main');
  assert.equal(plan.probe, 'private.ops_tx_probe_12345');
  assert.deepEqual(plan.sql, {
    cancel: 'begin; create table private.ops_tx_probe_12345(x int); rollback;',
    verify: "select to_regclass('private.ops_tx_probe_12345') is null as rolled_back;",
    cleanup: 'drop table if exists private.ops_tx_probe_12345;',
    error: 'begin; create table private.ops_tx_probe_12345(x int); select 1/0; commit;',
  });
  assert.doesNotMatch(Object.values(plan.sql).join('\n'), /\b(insert|update|delete|truncate|alter|grant|revoke|copy|call)\b/i);
  assert.equal(makePlan('check', '12345', 'refs/heads/main').sql.check,
    'select version,name from supabase_migrations.schema_migrations order by version desc limit 3;');
});

async function fakeServer(responses, run) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: JSON.parse(body) });
    const next = responses[calls.length - 1] ?? { status: 599, body: 'unexpected call' };
    if (next.delay) await new Promise(resolve => setTimeout(resolve, next.delay));
    res.writeHead(next.status ?? 201, { 'content-type': 'application/json', ...next.headers });
    res.end(typeof next.body === 'string' ? next.body : JSON.stringify(next.body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { createQueryClient } = await import(helper);
    const query = createQueryClient({ token, projectRef, endpoint: `http://127.0.0.1:${server.address().port}/query` });
    return await run(query, calls, `http://127.0.0.1:${server.address().port}/query`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
const absent = { body: [{ rolled_back: true }] };
const present = { body: [{ rolled_back: false }] };
const ok = { body: [] };
const division = { status: 400, body: { code: '22012', message: `division by zero ${token}` } };
const planFor = async mode => (await load()).makePlan(mode, '12345', 'refs/heads/main');

test('check sends exactly one read-only query and prints at most three validated migration metadata rows', async () => {
  const plan = await planFor('check');
  await fakeServer([{ body: [{ version: '20261010120000', name: 'basket1_notes_links', private_data: token }] }], async (query, calls) => {
    const result = await (await load()).runPlan(plan, query);
    assert.equal(result.ok, true);
    assert.match(result.summary, /20261010120000.*basket1_notes_links/);
    assert.doesNotMatch(result.summary, /synthetic-secret|private_data/);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { query: plan.sql.check, read_only: true });
    assert.equal(calls[0].authorization, `Bearer ${token}`);
  });
  for (const body of [[{ version: 'bad', name: token }], Array(4).fill({ version: '20261010120000', name: 'test' }), { data: token }]) {
    await fakeServer([{ body }], async query => assert.equal((await (await load()).runPlan(plan, query)).ok, false));
  }
});

test('both probe judgments pass only after expected SQL error and absent-table verifications, with no data logged', async () => {
  const plan = await planFor('tx-probe');
  await fakeServer([ok, absent, division, absent], async (query, calls) => {
    const result = await (await load()).runPlan(plan, query);
    assert.equal(result.ok, true);
    assert.match(result.summary, /취소 보장: 예/);
    assert.match(result.summary, /오류 시 전체 취소: 예/);
    assert.doesNotMatch(result.summary, /synthetic-secret|division by zero/);
    assert.deepEqual(calls.map(c => c.body), [
      { query: plan.sql.cancel, read_only: false }, { query: plan.sql.verify, read_only: true },
      { query: plan.sql.error, read_only: false }, { query: plan.sql.verify, read_only: true },
    ]);
  });
});

test('rollback persistence is cleaned up once, fails the job and never starts the second probe', async () => {
  const plan = await planFor('tx-probe');
  await fakeServer([ok, present, ok], async (query, calls) => {
    const result = await (await load()).runPlan(plan, query);
    assert.equal(result.ok, false);
    assert.match(result.summary, /취소 보장: 아니오/);
    assert.match(result.summary, /트랜잭션 취소 미보장/);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].body.query, plan.sql.cleanup);
  });
});

test('error persistence is cleaned up and fails; unrelated HTTP errors or unexpected success never prove cancellation', async () => {
  const plan = await planFor('tx-probe');
  for (const response of [division, { status: 401, body: { message: token } }, { status: 500, body: { error: token } }, ok]) {
    await fakeServer([ok, absent, response, present, ok], async (query, calls) => {
      const result = await (await load()).runPlan(plan, query);
      assert.equal(result.ok, false);
      assert.match(result.summary, /오류 시 전체 취소: 아니오/);
      assert.doesNotMatch(result.summary, /synthetic-secret/);
      assert.equal(calls.length, 5);
      assert.equal(calls[4].body.query, plan.sql.cleanup);
    });
  }
  await fakeServer([ok, absent, { status: 500, body: { error: token } }, absent], async query => {
    assert.equal((await (await load()).runPlan(plan, query)).ok, false);
  });
});

test('malformed verification and failed cleanup remain failures with manual cleanup notice and no raw error', async () => {
  const plan = await planFor('tx-probe');
  for (const verification of [{ body: [{ rolled_back: 'true' }] }, { body: [] }, { status: 500, body: token }]) {
    await fakeServer([ok, verification, { status: 403, body: token }], async (query, calls) => {
      const result = await (await load()).runPlan(plan, query);
      assert.equal(result.ok, false);
      assert.match(result.summary, /수동 정리 필요/);
      assert.doesNotMatch(result.summary, /synthetic-secret/);
      assert.equal(calls.length, 3);
    });
  }
});

test('HTTP helper rejects unsafe config, errors, malformed/oversized JSON and redirects without retries or secret-bearing errors', async () => {
  const { createQueryClient } = await import(helper);
  for (const ref of ['', '../other', 'a'.repeat(19), 'a'.repeat(21)]) assert.throws(() => createQueryClient({ token, projectRef: ref }));
  assert.throws(() => createQueryClient({ token: '', projectRef }));
  for (const response of [
    { status: 401, body: { message: token } }, { status: 500, body: { error: token } },
    { body: { error: token } }, { body: [{ error: token }] }, { body: `not JSON ${token}` },
    { body: ' '.repeat(65537) }, { status: 302, body: token, headers: { location: 'http://127.0.0.1:1' } },
  ]) {
    await fakeServer([response], async (query, calls) => {
      await assert.rejects(query('select 1;', { readOnly: true }), error => {
        assert.doesNotMatch(String(error), /synthetic-secret|not JSON/);
        return true;
      });
      assert.equal(calls.length, 1);
      assert.doesNotMatch(JSON.stringify(calls[0].body), /synthetic-secret/);
    });
  }
});

test('plan CLI works without secrets, prints every approved SQL and rejects branch/mode injection', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ops-db-plan-'));
  try {
    const env = { PATH: process.env.PATH, DB_MODE: 'tx-probe', GITHUB_RUN_ID: '12345', GITHUB_REF: 'refs/heads/main', GITHUB_STEP_SUMMARY: join(cwd, 'summary') };
    const run = extra => spawnSync(process.execPath, [runner.pathname, 'plan'], { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
    assert.equal(run({}).status, 0);
    const summary = readFileSync(join(cwd, 'summary'), 'utf8');
    for (const sql of ['begin;', 'rollback;', 'select 1/0;', 'drop table if exists', 'to_regclass']) assert.ok(summary.includes(sql));
    assert.notEqual(run({ GITHUB_REF: 'refs/heads/other' }).status, 0);
    assert.notEqual(run({ DB_MODE: 'apply' }).status, 0);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('transport errors and timeouts use sanitized errors and never retry', async () => {
  const { createQueryClient } = await import(helper);
  const disconnected = createQueryClient({ token, projectRef, endpoint: 'http://127.0.0.1:1/query' });
  await assert.rejects(disconnected('select 1;'), error => {
    assert.doesNotMatch(String(error), /synthetic-secret|127\.0\.0\.1|select 1/);
    assert.equal(error.cause, undefined);
    return true;
  });
  await fakeServer([{ delay: 100, body: [] }], async (_query, calls, endpoint) => {
    const timed = createQueryClient({ token, projectRef, endpoint, timeoutMs: 20 });
    await assert.rejects(timed('select 1;'), /DB query failed/);
    assert.ok(calls.length <= 1);
  });
});

test('secret-like migration names are suppressed; masking escapes workflow commands and scripts never dump errors or data', async () => {
  const { maskValue, runPlan } = await load();
  assert.equal(maskValue('test%\r\n::warning::synthetic'), '::add-mask::test%25%0D%0A::warning::synthetic');
  await fakeServer([{ body: [{ version: '20261010120000', name: token }] }], async query => {
    const result = await runPlan(await planFor('check'), query, { secretValues: [token] });
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.summary, /synthetic-secret/);
  });
  const scripts = readFileSync(runner, 'utf8') + readFileSync(helper, 'utf8');
  assert.doesNotMatch(scripts, /console\.|\.stack|JSON\.stringify\((?:payload|rows|response|error)|appendFileSync\([^\n]*(?:payload|rows|response|error)/);
  assert.match(scripts, /redirect: 'error'/);
  assert.doesNotMatch(scripts, /process\.env\.(?:ENDPOINT|QUERY|SQL|DB_URL)/);
});

test('SQL error arrays and unexpected DDL results cannot prove rollback or successful cleanup', async () => {
  const plan = await planFor('tx-probe');
  for (const body of [[{ code: '42501', message: `permission denied ${token}` }], [{ message: token }], [null], ['unexpected']]) {
    await fakeServer([{ body }, absent, division, absent], async (query, calls) => {
      const result = await (await load()).runPlan(plan, query);
      assert.equal(result.ok, false);
      assert.match(result.summary, /취소 보장: 아니오/);
      assert.doesNotMatch(result.summary, /synthetic-secret/);
      assert.equal(calls.length, 2); // failed initial DDL, then best-effort cleanup only
    });
    await fakeServer([ok, present, { body }], async query => {
      const result = await (await load()).runPlan(plan, query);
      assert.equal(result.ok, false);
      assert.match(result.summary, /수동 정리 필요/);
    });
  }
});
