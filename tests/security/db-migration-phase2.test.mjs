import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const version = '20261011120000';
const name = 'notes_example';
const runId = '12345';
const secret = 'synthetic-secret-never-print';
const summary = '무엇이 바뀌나: 메모에 시험 칸을 추가합니다.\n잘못되면: 저장이 실패할 수 있습니다.\n되돌리는 법: 사용 전 rollback으로 시험 칸을 제거합니다.\n';
const insert = `insert into supabase_migrations.schema_migrations (version,name,statements) values ('${version}','${name}',array['test']);`;
const sql = `begin;\nalter table public.app_notes add column example int;\n${insert}\ncommit;\n`;
const rollback = `begin;\nalter table public.app_notes drop column example;\ndelete from supabase_migrations.schema_migrations where version='${version}' and name='${name}';\ncommit;\n`;
const planner = () => import('../../scripts/ops/db-migration-plan.mjs');
const runner = () => import('../../scripts/ops/db-migration-run.mjs');

async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'db-phase2-'));
  mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, `supabase/migrations/${version}_${name}.sql`), sql);
  writeFileSync(join(root, `docs/${version}_${name}.rollback.sql`), rollback);
  writeFileSync(join(root, `docs/${version}_${name}.summary.md`), summary);
  const plan = async (mode = 'apply', v = version) => (await planner()).prepareMigration({ mode, version: v, runId, root });
  try { return await fn({ root, plan }); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('new modes require a 14 digit version; check/probe require blank version and preserve their SQL', async () => {
  const { makePlan } = await import('../../scripts/ops/db-workflow.mjs');
  for (const mode of ['check', 'tx-probe']) {
    assert.equal(makePlan(mode, runId, 'refs/heads/main', '').mode, mode);
    assert.throws(() => makePlan(mode, runId, 'refs/heads/main', version));
  }
  await fixture(async ({ root }) => {
    for (const mode of ['apply', 'dry-run', 'rollback']) assert.equal(makePlan(mode, runId, 'refs/heads/main', version, root).mode, mode);
    for (const v of ['', '20261011', '2026101112000x', '../20261011120000', '202610111200000']) {
      assert.throws(() => makePlan('apply', runId, 'refs/heads/main', v, root));
    }
  });
});

test('plan requires exactly one migration and matching rollback/three-line summary, with no symlink traversal', async () => {
  await fixture(async ({ root, plan }) => {
    const valid = await plan();
    assert.equal(valid.file.path, `supabase/migrations/${version}_${name}.sql`);
    assert.match(valid.file.sha256, /^[a-f0-9]{64}$/);
    assert.equal(valid.summaryLines.length, 3);
    await assert.rejects(plan('apply', '20261012120000'));
    writeFileSync(join(root, `supabase/migrations/${version}_other.sql`), sql);
    await assert.rejects(plan());
    rmSync(join(root, `supabase/migrations/${version}_other.sql`));
    rmSync(join(root, `docs/${version}_${name}.summary.md`));
    await assert.rejects(plan());
    writeFileSync(join(root, `docs/${version}_${name}.summary.md`), summary);
    rmSync(join(root, `docs/${version}_${name}.rollback.sql`));
    await assert.rejects(plan('rollback'));
    symlinkSync(join(root, `supabase/migrations/${version}_${name}.sql`), join(root, `docs/${version}_${name}.rollback.sql`));
    await assert.rejects(plan('rollback'));
  });
});

test('transaction boundaries and migration history row must match version/name exactly once', async () => {
  const { validateSQL } = await planner();
  const options = { mode: 'apply', version, name };
  assert.doesNotThrow(() => validateSQL(sql, options));
  for (const bad of ['\n' + sql, sql.replace('begin;', ''), sql.replace('commit;', ''), sql.replace(version, '20261011120001'),
    sql.replace(`'${name}'`, "'wrong'"), sql.replace(insert, ''), sql.replace(insert, `${insert}\n${insert}`),
    sql.replace('alter table', 'commit; begin; alter table'), sql.replace("array['test']", "array['test']), ('20261011120001','other',array['test']")]) {
    assert.throws(() => validateSQL(bad, options));
  }
});

test('risk rules block each command despite comments/case/space, nested WHERE and unsafe history writes', async () => {
  const { validateSQL } = await planner();
  const commands = [
    'DrOp /* gap */ TABLE public.app_notes;', 'drop\n schema public;', 'truncate public.app_notes;',
    'delete from public.app_notes;', 'update public.app_notes set example=(select 1 where true);',
    "delete from public.app_notes where exists(select 1); update public.app_notes set example=1;",
    'alter role authenticated superuser;', 'create extension db_bad;', 'alter extension plpgsql update;', 'drop extension plpgsql;',
    'grant select on public.app_notes to anon;', 'grant select on public.app_notes to PUBLIC;', 'grant select on public.app_notes to "authenticated";', 'grant select on public.app_notes to anon, "to";',
    'alter table public.rtw_notes add column x int;', "select 'rtw_notes';", 'update supabase_migrations.schema_migrations set name=\'x\' where true;',
    'delete from supabase_migrations.schema_migrations where true;', 'drop table supabase_migrations.schema_migrations;',
    "do $$ begin execute 'drop table public.app_notes'; end $$;", 'copy public.app_notes to program \'echo bad\';',
  ];
  for (const mode of ['apply', 'dry-run', 'rollback']) for (const command of commands) {
    const history = mode === 'rollback' ? rollback.split('\n')[2] : insert;
    assert.throws(() => validateSQL(`begin;\n${command}\n${history}\ncommit;\n`, { mode, version, name }), command);
  }
  assert.doesNotThrow(() => validateSQL(sql.replace('alter table', '-- drop table public.rtw_notes;\nalter table'), { mode: 'apply', version, name }));
});

test('rollback allows only paired destructive objects and exact history deletion; BASKET-1 rollback passes unchanged', async () => {
  const { validateSQL } = await planner();
  assert.doesNotThrow(() => validateSQL(rollback, { mode: 'rollback', version, name }));
  const basket = readFileSync(new URL('../../docs/20261010120000_basket1_notes_links.rollback.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => validateSQL(basket, { mode: 'rollback', version: '20261010120000', name: 'basket1_notes_links' }));
  for (const bad of [rollback.replace(version, '20261011120001'), rollback.replace("and name='notes_example'", "or name='notes_example'"),
    rollback.replace('drop column example', 'drop column example cascade')]) {
    assert.throws(() => validateSQL(bad, { mode: 'rollback', version, name }));
  }
});

test('real BASKET-1 migration/rollback, precheck and baseline postcheck can be planned together', async () => fixture(async ({ root }) => {
  const v = '20261010120000', n = 'basket1_notes_links';
  for (const [folder, suffix] of [['supabase/migrations', 'sql'], ['docs', 'rollback.sql'], ['docs', 'precheck.sql'], ['docs', 'postcheck.sql']]) {
    writeFileSync(join(root, `${folder}/${v}_${n}.${suffix}`), readFileSync(new URL(`../../${folder}/${v}_${n}.${suffix}`, import.meta.url)));
  }
  writeFileSync(join(root, `docs/${v}_${n}.summary.md`), summary);
  for (const mode of ['apply', 'rollback']) {
    const p = (await planner()).prepareMigration({ mode, version: v, runId, root });
    assert.deepEqual(p.targets, ['app_notes', 'app_record_links']);
    assert.equal(p.checks.postcheck.baselineNull, true);
  }
}));

test('quoted-case targets, escaped grant roles and side-effect DO calls are rejected', async () => {
  const { validateSQL } = await planner();
  for (const command of ['alter table public."App_Notes" add column x int;',
    'grant select on public.app_notes to U&"a\\006eon";',
    'do $$ begin perform public.dangerous_fn(); end $$;',
    'do $$ begin if (select public.dangerous_fn()) then raise exception \'stop\'; end if; end $$;']) {
    assert.throws(() => validateSQL(`begin;\n${command}\n${insert}\ncommit;`, { mode: 'apply', version, name }));
  }
});

test('dry-run replaces only the final commit and backups name the exact public write targets', async () => {
  const { toDryRun } = await planner();
  const { buildBackup } = await runner();
  const text = sql.replace("array['test']", "array['commit; must stay literal']");
  assert.equal(toDryRun(text), text.replace(/commit;\n$/, 'rollback;\n'));
  await fixture(async ({ plan }) => {
    const backup = buildBackup(await plan());
    assert.deepEqual(backup.tables, [{ source: 'app_notes', name: `${version}_app_notes_${runId}` }]);
    assert.match(backup.sql, /create schema if not exists ops_backup/);
    assert.match(backup.sql, /revoke all on schema ops_backup from public, anon, authenticated/i);
    assert.match(backup.sql, /as select \* from public\.app_notes/);
    assert.match(backup.sql, /revoke all on table ops_backup\./);
    assert.doesNotMatch(backup.sql, /drop|insert|update|delete|grant/i);
  });
});

test('all same-version filenames count, and readonly checks reject hidden writes', async () => {
  await fixture(async ({ root, plan }) => {
    writeFileSync(join(root, `supabase/migrations/${version}_Other.sql`), sql);
    await assert.rejects(plan());
  });
  await fixture(async ({ root, plan }) => {
    writeFileSync(join(root, `docs/${version}_Other.rollback.sql`), rollback);
    await assert.rejects(plan('rollback'));
  });
  const { checkSQL } = await planner();
  for (const bad of ['select 1; delete from public.app_notes where true;',
    'with gone as (delete from public.app_notes returning *) select * from gone;',
    "select set_config('x','y',false);", 'select * into public.copy from public.app_notes;']) assert.throws(() => checkSQL(bad));
  const { buildBackup } = await runner();
  assert.throws(() => buildBackup({ version, runId, targets: ['x'.repeat(60)] }));
});

async function fake(responses, fn) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push(JSON.parse(body));
    const answer = responses[calls.length - 1] ?? { status: 500, body: { error: secret } };
    if (answer.disconnect) { req.socket.destroy(); return; }
    res.writeHead(answer.status ?? 201, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer.body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { createQueryClient } = await import('../../scripts/ops/db-query.mjs');
    const query = createQueryClient({ token: secret, projectRef: 'abcdefghijklmnopqrst', endpoint: `http://127.0.0.1:${server.address().port}` });
    return await fn(query, calls);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const count = n => ({ body: [{ count: n }] });
const ok = { body: [] };

test('dry-run executes once with rollback and verifies absence without backup or data output', async () => fixture(async ({ plan }) => {
  const p = await plan('dry-run');
  await fake([count(0), ok, count(0)], async (query, calls) => {
    const result = await (await runner()).runMigrationPlan(p, query);
    assert.equal(result.ok, true);
    assert.match(result.summary, /dry-run: 성공/);
    assert.equal(calls.length, 3);
    assert.match(calls[1].query, /rollback;\n$/);
    assert.equal(calls[0].read_only, true);
    assert.equal(calls[2].read_only, true);
    assert.doesNotMatch(result.summary, /alter table|synthetic-secret/);
  });
  await fake([count(0), ok, count(1)], async query => assert.equal((await (await runner()).runMigrationPlan(p, query)).ok, false));
}));

test('existing apply/dry-run and absent rollback are refused before any writes', async () => fixture(async ({ plan }) => {
  for (const mode of ['apply', 'dry-run', 'rollback']) await fake([count(mode === 'rollback' ? 0 : 1)], async (query, calls) => {
    assert.equal((await (await runner()).runMigrationPlan(await plan(mode), query)).ok, false);
    assert.equal(calls.length, 1);
  });
}));

test('apply/rollback back up before the original SQL once and verify history, displaying names/counts only', async () => fixture(async ({ plan }) => {
  for (const mode of ['apply', 'rollback']) {
    const p = await plan(mode);
    await fake([count(mode === 'apply' ? 0 : 1), ok,
      { body: [{ table_name: `${version}_app_notes_${runId}`, row_count: '2' }] }, ok, count(mode === 'apply' ? 1 : 0)], async (query, calls) => {
      const result = await (await runner()).runMigrationPlan(p, query);
      assert.equal(result.ok, true);
      assert.equal(calls[3].query, p.file.sql);
      assert.equal(calls.filter(c => c.query === p.file.sql).length, 1);
      assert.match(result.summary, new RegExp(`${version}_app_notes_${runId}`));
      assert.match(result.summary, /2/);
      assert.doesNotMatch(result.summary, /as select|alter table|synthetic-secret/);
    });
  }
}));

test('backup errors, SQL errors and transport failure stop mutations without retries or raw SQL/data/messages', async () => fixture(async ({ plan }) => {
  const p = await plan();
  for (const failure of [{ status: 400, body: { code: '42501', error: `${secret} secret row contents ${sql}` } }, { disconnect: true }]) {
    await fake([count(0), failure], async (query, calls) => {
      const result = await (await runner()).runMigrationPlan(p, query);
      assert.equal(result.ok, false);
      assert.equal(calls.length, 2);
      assert.doesNotMatch(result.summary, /synthetic-secret|secret row|alter table/);
      if (!failure.disconnect) assert.match(result.summary, /42501/);
    });
  }
}));

test('precheck prints only bounded aggregate item/value; baseline NULL postcheck is skipped', async () => fixture(async ({ root, plan }) => {
  writeFileSync(join(root, `docs/${version}_${name}.precheck.sql`), "select 'row count' as item, count(*)::text as value from public.app_notes;");
  writeFileSync(join(root, `docs/${version}_${name}.postcheck.sql`), "with baseline(n) as (values(null::bigint)) select 'rows' as item, '예' as expected;");
  const p = await plan('dry-run');
  await fake([count(0), { body: [{ item: 'row count', value: '2' }] }, ok, count(0)], async (query, calls) => {
    const result = await (await runner()).runMigrationPlan(p, query);
    assert.equal(result.ok, true);
    assert.match(result.summary, /수동 확인 필요/);
    assert.equal(calls.length, 4);
    assert.equal(calls[1].read_only, true);
  });
  for (const body of [[{ item: 'rows', value: secret }], [{ item: 'rows', value: '2', raw: secret }], [{ item: 'rows', value: '1'.repeat(257) }]]) {
    await fake([count(0), { body }], async (query, calls) => {
      const result = await (await runner()).runMigrationPlan(p, query, { secretValues: [secret] });
      assert.equal(result.ok, false); assert.equal(calls.length, 2);
      assert.doesNotMatch(result.summary, /synthetic-secret/);
    });
  }
}));

test('invalid backup counts or mutation SQL/transport errors fail without retries or raw output', async () => fixture(async ({ plan }) => {
  const p = await plan();
  for (const response of [{ body: [{ table_name: secret, row_count: '2' }] }, { body: [{ table_name: `${version}_app_notes_${runId}`, row_count: '2', raw: secret }] }]) {
    await fake([count(0), ok, response], async (query, calls) => {
      const result = await (await runner()).runMigrationPlan(p, query);
      assert.equal(result.ok, false); assert.equal(calls.length, 3);
      assert.doesNotMatch(result.summary, /synthetic-secret/);
    });
  }
  for (const failure of [{ body: [{ code: '23514', message: `${secret} raw data ${sql}` }] }, { disconnect: true }]) {
    await fake([count(0), ok, { body: [{ table_name: `${version}_app_notes_${runId}`, row_count: '2' }] }, failure], async (query, calls) => {
      const result = await (await runner()).runMigrationPlan(p, query);
      assert.equal(result.ok, false); assert.equal(calls.length, 4);
      assert.equal(calls.filter(c => c.query === sql).length, 1);
      assert.doesNotMatch(result.summary, /synthetic-secret|raw data|alter table/);
      if (!failure.disconnect) assert.match(result.summary, /SQLSTATE 23514/);
    });
  }
}));

test('postcheck only prints yes/no and a negative verdict fails after the one execution', async () => fixture(async ({ root, plan }) => {
  writeFileSync(join(root, `docs/${version}_${name}.postcheck.sql`), "select 'structure' as item, true as ok;");
  const p = await plan('dry-run');
  for (const verdict of [true, false, secret]) await fake([count(0), ok, count(0), { body: [{ item: 'structure', ok: verdict }] }], async (query, calls) => {
    const result = await (await runner()).runMigrationPlan(p, query);
    assert.equal(result.ok, verdict === true); assert.equal(calls.length, 4);
    assert.equal(calls[3].read_only, true);
    assert.doesNotMatch(result.summary, /synthetic-secret/);
    if (typeof verdict === 'boolean') assert.match(result.summary, verdict ? /예/ : /아니오/);
  });
  const { planSummary } = await import('../../scripts/ops/db-workflow.mjs');
  const output = planSummary(await plan());
  assert.match(output, /실행 SQL 전문/); assert.match(output, /create table ops_backup/);
  assert.match(output, /postcheck/); assert.match(output, /select 'structure'/);
}));

test('a filled baseline never skips a postcheck because another expression contains IS NULL', async () => fixture(async ({ root, plan }) => {
  const { checkSQL } = await planner();
  const filled = "with baseline(n) as (values(2)) select 'check' as item, (1 is null) as ok;";
  assert.equal(checkSQL(filled).baselineNull, false);
  assert.equal(checkSQL(filled.replace('values(2)', 'values(null::bigint)')).baselineNull, true);
  const basket = readFileSync(new URL('../../docs/20261010120000_basket1_notes_links.postcheck.sql', import.meta.url), 'utf8');
  assert.equal(checkSQL(basket).baselineNull, true);
  assert.equal(checkSQL(basket.replace('values (null::bigint,null::bigint,null::text,null::text)', "values (2::bigint,3::bigint,'1:hash'::text,'1:hash'::text)")).baselineNull, false);
  writeFileSync(join(root, `docs/${version}_${name}.postcheck.sql`), filled);
  await fake([count(0), ok, count(0), { body: [{ item: 'check', ok: false }] }], async (query, calls) => {
    const result = await (await runner()).runMigrationPlan(await plan('dry-run'), query);
    assert.equal(result.ok, false); assert.equal(calls.length, 4);
    assert.doesNotMatch(result.summary, /수동 확인 필요/);
  });
}));
