import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createQueryClient, DbQueryError } from '../../scripts/ops/db-query.mjs';
import { runMigrationPlan } from '../../scripts/ops/db-migration-run.mjs';
import { runPlan, makePlan } from '../../scripts/ops/db-workflow.mjs';

const secret = 'synthetic-secret-never-print';
const beforeSQL = "select 'rows' as item, '2' as value;";
const appliedSQL = "select 'applied' as item, false as ok;";
const drySQL = "select 'prior function' as item, true as ok;";
const observation = [{ item: 'rows', value: '2' }, { item: 'hash', value: 'a'.repeat(32) }];
const plan = (checks = {}, mode = 'dry-run') => ({ mode, version: '20261011120000', name: 'notes_example', runId: '12345',
  targets: [], file: { sql: 'begin;\ncommit;\n' }, checks });
const history = [{ count: 0 }];

async function http(answer, fn) {
  let calls = 0;
  const server = createServer((req, res) => {
    calls++;
    req.resume();
    if (answer.disconnect) { req.socket.destroy(); return; }
    if (answer.timeout) return;
    res.writeHead(answer.status, { 'content-type': 'application/json', 'x-secret': secret });
    res.end(answer.raw ?? JSON.stringify(answer.body));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const query = createQueryClient({ token: secret, projectRef: 'abcdefghijklmnopqrst', timeoutMs: answer.timeout ? 100 : 5000,
    endpoint: `http://127.0.0.1:${server.address().port}` });
  try { await fn(query); assert.equal(calls, 1); }
  finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
}

test('observed HTTP status survives API, JSON and response-limit failures with bounded kind and no secrets', async () => {
  for (const status of [200, 201, 400, 401, 403, 422, 429, 500, 503]) {
    await http({ status, body: { code: '42501', error: `${secret} select confidential` } }, async query => {
      await assert.rejects(query('select confidential'), error => {
        assert.equal(error.status, status);
        assert.equal(error.kind, 'API');
        assert.doesNotMatch(JSON.stringify(error) + error.message, /synthetic-secret|confidential|x-secret/);
        assert.equal(Object.hasOwn(error, 'cause'), false);
        return true;
      });
    });
  }
  for (const status of [401, 500, 503]) for (const [raw, kind] of [[secret, 'invalid JSON'], ['x'.repeat(65_537), 'response limit']]) {
    await http({ status, raw }, async query => assert.rejects(query('select confidential'), error => {
      assert.equal(error.status, status); assert.equal(error.kind, kind);
      assert.doesNotMatch(JSON.stringify(error) + error.message, /synthetic-secret|confidential/);
      return true;
    }));
  }
  for (const answer of [{ disconnect: true }, { timeout: true }]) await http(answer, async query => {
    await assert.rejects(query('select confidential'), error => {
      assert.equal(error.status, undefined); assert.equal(error.kind, 'transport'); return true;
    });
  });
});

test('only integer HTTP 100..599 and fixed internal kinds survive constructor input', () => {
  for (const status of [100, 200, 399, 599]) assert.equal(new DbQueryError('API', { status }).status, status);
  for (const status of ['401', 99, 600, NaN, Infinity, 401.5, `503\n${secret}`]) {
    const error = new DbQueryError(secret, { status, sqlState: secret });
    assert.equal(error.status, undefined);
    assert.equal(error.kind, 'unknown');
    assert.doesNotMatch(error.message + JSON.stringify(error), /synthetic-secret/);
  }
});

test('all workflow catch paths use bounded HTTP reasons while SQL errors with HTTP 200 still fail', async () => {
  await http({ status: 200, body: [{ code: '42501', message: secret }] }, async query => {
    const result = await runPlan(makePlan('check', '12345', 'refs/heads/main'), query);
    assert.equal(result.ok, false); assert.match(result.summary, /HTTP 200.*API.*SQLSTATE 42501/);
    assert.doesNotMatch(result.summary, /synthetic-secret/);
  });
  const probe = makePlan('tx-probe', '12345', 'refs/heads/main');
  for (const failAt of [0, 1, 2, 3]) {
    let calls = 0;
    const result = await runPlan(probe, async sql => {
      const call = calls++;
      if (call === failAt || sql === probe.sql.cleanup) throw new DbQueryError('API', { status: 503 });
      if (sql === probe.sql.verify) return [{ rolled_back: true }];
      if (sql === probe.sql.error) throw new DbQueryError('API', { status: 400, divisionByZero: true, sqlState: '22012' });
      return [];
    });
    assert.equal(result.ok, false);
    assert.match(result.summary, /HTTP 503/);
  }
});

test('generic dry-run rereads the same precheck read-only and never executes applied-state postcheck', async () => {
  const calls = [];
  const replies = [history, observation, [], history, observation.toReversed()];
  const result = await runMigrationPlan(plan({ precheck: { sql: beforeSQL }, postcheck: { sql: appliedSQL } }), async (sql, opts) => {
    calls.push({ sql, opts }); return replies[calls.length - 1];
  });
  assert.equal(result.ok, true); assert.equal(result.verification, 'complete');
  assert.deepEqual(calls.filter(c => c.sql === beforeSQL).map(c => c.opts), [{ readOnly: true }, { readOnly: true }]);
  assert.equal(calls.some(c => c.sql === appliedSQL), false);
  assert.match(result.summary, /사전 집계 관측값 보존: 예/);
  assert.doesNotMatch(result.summary, /DB 전체.*동일합니다|자동 취소하지/);
  assert.match(result.summary, /DB 전체 자료의 동일성을 증명하지 않습니다/);
});

test('changed/missing/extra/duplicate observations fail without leaking malformed rows', async () => {
  for (const after of [[{ item: 'rows', value: '3' }, observation[1]], observation.slice(1), [...observation, { item: 'extra', value: '1' }],
    [observation[0], observation[0]], [{ item: 'rows', value: secret }], [{ item: secret, value: '1' }]]) {
    let calls = 0;
    const replies = [history, observation, [], history, after];
    const result = await runMigrationPlan(plan({ precheck: { sql: beforeSQL } }), async () => replies[calls++], { secretValues: [secret] });
    assert.equal(result.ok, false); assert.equal(calls, 5);
    assert.doesNotMatch(result.summary, /synthetic-secret|자동 취소하지/);
    assert.match(result.summary, /dry-run SQL 취소: 완료/);
  }
  let calls = 0;
  const result = await runMigrationPlan(plan({ precheck: { sql: beforeSQL } }), async () => [history, [observation[0], observation[0]]][calls++]);
  assert.equal(result.ok, false); assert.equal(calls, 2);
});

test('missing/NULL baseline preserves manual verification path without inventing restoration', async () => {
  for (const checks of [{}, { precheck: { sql: beforeSQL, baselineNull: true } },
    { postcheck: { sql: appliedSQL, baselineNull: true } }]) {
    let calls = 0;
    const result = await runMigrationPlan(plan(checks), async () => [history, [], history][calls++]);
    assert.equal(result.ok, true); assert.equal(result.verification, 'incomplete');
    assert.equal(calls, 3); assert.match(result.summary, /수동.*snapshot/);
    assert.doesNotMatch(result.summary, /원래 상태 보존: 예|사전 집계 관측값 보존: 예|dry-run: 성공/);
  }
});

test('explicit dry-run prior-schema check supplements observation comparison and rejects negative verdict', async () => {
  for (const verdict of [true, false, secret]) {
    const calls = [];
    const replies = [history, observation, [], history, observation, [{ item: 'prior function', ok: verdict }]];
    const result = await runMigrationPlan(plan({ precheck: { sql: beforeSQL }, postcheck: { sql: appliedSQL }, dryRunPostcheck: { sql: drySQL } }), async (sql, opts) => {
      calls.push({ sql, opts }); return replies[calls.length - 1];
    }, { secretValues: [secret] });
    assert.equal(result.ok, verdict === true);
    assert.equal(calls.at(-1).sql, drySQL); assert.deepEqual(calls.at(-1).opts, { readOnly: true });
    assert.equal(calls.some(c => c.sql === appliedSQL), false);
    assert.doesNotMatch(result.summary, /synthetic-secret|자동 취소하지/);
  }
});

test('migration failure reports actual phase and distinguishes backup write from migration request', async () => {
  for (const failAt of [0, 1, 2]) {
    let calls = 0;
    const result = await runMigrationPlan(plan({}, 'apply'), async () => {
      if (calls++ === failAt) throw new DbQueryError('API', { status: 500 });
      return calls === 1 ? history : [];
    });
    assert.equal(result.ok, false); assert.match(result.summary, /HTTP 500/);
    assert.match(result.summary, new RegExp(`실행 요청 전송: ${failAt === 2 ? '예' : '아니오'}`));
    assert.match(result.summary, new RegExp(`쓰기 요청 전송: ${failAt === 0 ? '아니오' : '예'}`));
  }
});
