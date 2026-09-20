import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonicalSchemaHash} from '../../supabase/local-verify/schema-hash.mjs';

const root = new URL('../../', import.meta.url);
const load = path => readFileSync(new URL(path, root), 'utf8');
const workflow = load('.github/workflows/web2-local-supabase-authz.yml');
const oneShot = load('.github/workflows/web2-one-shot-schema-authz.yml');
const bootstrap = load('supabase/local-verify/bootstrap-ci.sh');
const checker = new URL('../../supabase/local-verify/check-baseline.mjs', import.meta.url);
const createAuth = new URL('../../supabase/local-verify/create-local-auth.mjs', import.meta.url);
const scanner = new URL('../../supabase/local-verify/scan-schema.mjs', import.meta.url);
const diagnostics = new URL('../../supabase/local-verify/diagnose-start.mjs', import.meta.url);
const baselineReview = new URL('../../supabase/local-verify/analyze-baseline.mjs', import.meta.url);
const roleDiagnostics = new URL('../../supabase/local-verify/role-diagnostics.mjs', import.meta.url);
const definerDiagnostics = new URL('../../supabase/local-verify/definer-diagnostics.mjs', import.meta.url);
const sqlFailure = new URL('../../supabase/local-verify/analyze-sql-failure.mjs', import.meta.url);

const restricted = (sql, key) => `\\restrict ${key}\n${sql}\\unrestrict ${key}\n`;

test('canonical schema hash ignores only the matching pg_dump restrict key', () => {
  const schema = 'CREATE TABLE public.app_spaces (id uuid);\n';
  assert.equal(canonicalSchemaHash(restricted(schema, 'randomA')),
    canonicalSchemaHash(restricted(schema, 'randomB')));
  assert.notEqual(canonicalSchemaHash(restricted(schema, 'randomA')),
    canonicalSchemaHash(restricted(schema.replace('uuid', 'text'), 'randomB')));
  assert.throws(() => canonicalSchemaHash(restricted(schema, 'randomA').replace('unrestrict randomA', 'unrestrict randomB')));
  assert.throws(() => canonicalSchemaHash(`${restricted(schema, 'randomA')}\\restrict extra\n`));
});

test('CI job is manual, local-only, and has no hosted credential or artifact path', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request):/m);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /secrets\.|upload-artifact|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD/);
  assert.match(bootstrap, /check-baseline\.mjs/);
  assert.match(bootstrap, /scan-schema\.mjs/);
  assert.match(bootstrap, /supabase start/);
  assert.match(bootstrap, /supabase stop --no-backup/);
  assert.doesNotMatch(bootstrap, /supabase\s+(?:link|db\s+(?:pull|push|reset\s+--linked))/);
});

test('one-shot workflow keeps DB credential in extraction step and raw dump off artifacts', () => {
  assert.match(oneShot, /workflow_dispatch:/);
  assert.match(oneShot, /environment: web2-schema-verification/);
  assert.match(oneShot, /secrets\.WEB2_SCHEMA_DB_PASSWORD/);
  assert.match(oneShot, /pg_dump .*--schema-only --schema=public --schema=private --no-comments/s);
  assert.match(oneShot, /scan-schema\.mjs/);
  assert.match(oneShot, /analyze-baseline\.mjs inventory/);
  assert.match(oneShot, /EXPECTED_SHA256/);
  assert.doesNotMatch(oneShot, /upload-artifact|db pull|db push|supabase link/);
  assert.doesNotMatch(oneShot, /["']\$\{\{\s*inputs\.expected_sha256/);
  const scan = oneShot.indexOf('node supabase/local-verify/scan-schema.mjs');
  const compare = oneShot.indexOf('node supabase/local-verify/schema-hash.mjs');
  const setup = oneShot.indexOf('supabase/setup-cli@v3');
  const verifyInventory = oneShot.lastIndexOf('node supabase/local-verify/analyze-baseline.mjs inventory');
  const staticTests = oneShot.lastIndexOf('node --test tests/security/');
  const bootstrapStep = oneShot.lastIndexOf('bash supabase/local-verify/bootstrap-ci.sh');
  assert.ok(scan >= 0 && scan < compare && compare < setup && setup < staticTests && staticTests < bootstrapStep,
    'raw scan and canonical hash gate must precede all verification work');
  assert.ok(setup < verifyInventory && verifyInventory < staticTests,
    'verified dump inventory must precede local authorization work');
});

test('CI inputs exist and the local seed precedes pending migrations', () => {
  for (const path of [
    '.github/workflows/web2-one-shot-schema-authz.yml',
    '.github/workflows/web2-local-supabase-authz.yml',
    'supabase/local-verify/schema-hash.mjs',
    'supabase/local-verify/scan-schema.mjs',
    'supabase/local-verify/check-baseline.mjs',
    'supabase/local-verify/bootstrap-ci.sh',
    'supabase/local-verify/diagnose-start.mjs',
    'supabase/local-verify/analyze-baseline.mjs',
    'supabase/local-verify/role-diagnostics.mjs',
    'supabase/local-verify/role-catalog.sql',
    'supabase/local-verify/definer-diagnostics.mjs',
    'supabase/local-verify/compat-default-acl.mjs',
    'supabase/local-verify/analyze-sql-failure.mjs',
    'supabase/local-verify/custom-auth-trigger.sql',
    'supabase/local-verify/create-local-auth.mjs',
    'supabase/local-verify/seed-before-cutover.sql',
    'supabase/local-verify/seed-catalog.sql',
    'supabase/local-verify/seed-catalog.mjs',
    'supabase/local-verify/http-authz.test.mjs',
    'supabase/tests/authz_public_snapshot.sql',
    'supabase/tests/authz_project_public_view.sql',
    'supabase/migrations/20260920120000_public_single_post_prepare.sql',
    'supabase/migrations/20260920121000_public_single_post_cutover.sql',
    'supabase/migrations/20260920122000_project_public_view.sql',
    'supabase/functions/meeting-ai-draft/index.ts',
    'supabase/functions/meeting-ai-draft/parse.mjs',
    'supabase/functions/meeting-ai-ingest/index.ts',
    'supabase/functions/meeting-files/index.ts',
  ]) assert.ok(existsSync(new URL(path, root)), `${path} absent from checkout`);

  const auth = bootstrap.indexOf('create-local-auth.mjs');
  const start = bootstrap.indexOf('supabase start --network-id');
  const baseline = bootstrap.indexOf('> "$ci_root/baseline-apply.log"');
  const seed = bootstrap.indexOf('-f "$repo_root/supabase/local-verify/seed-before-cutover.sql"');
  const prepare = bootstrap.indexOf('20260920120000_public_single_post_prepare.sql');
  const cutover = bootstrap.indexOf('20260920121000_public_single_post_cutover.sql');
  const project = bootstrap.indexOf('20260920122000_project_public_view.sql');
  const sql = bootstrap.indexOf('authz_public_snapshot.sql');
  const http = bootstrap.indexOf('http-authz.test.mjs');
  assert.ok(start >= 0 && start < baseline && baseline < auth && auth < seed && seed < prepare && seed < cutover &&
    cutover < project && project < sql && sql < http);
  assert.match(bootstrap, /unset PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD PGOPTIONS PGSSLMODE PGSSLROOTCERT/);
  assert.match(bootstrap, /VERBOSITY=sqlstate/);
  assert.match(bootstrap, /analyze-baseline\.mjs" failure/);
  assert.match(load('supabase/local-verify/seed-before-cutover.sql'),
    /app\.local_verification.*is distinct from 'on'/s);
});

test('synthetic seed failure reports SQLSTATE and first table without printing literals', () => {
  const directory = mkdtempSync(join(tmpdir(), 'web2-seed-error-'));
  try {
    const sql = join(directory, 'seed.sql');
    const error = join(directory, 'error.log');
    const secret = 'dont-print-this-value';
    writeFileSync(sql, `insert into public.app_workspaces(id,name)\nvalues ('id','${secret}');\n`);
    writeFileSync(error, `psql:${sql}:2: ERROR:  P0001: failing ${secret}\nCONTEXT: PL/pgSQL function private.app_task_child_project_guard() line 17 at RAISE\n`);
    const run = spawnSync(process.execPath,
      [fileURLToPath(sqlFailure), 'SYNTHETIC_SEED', sql, error], {encoding: 'utf8'});
    assert.equal(run.status, 0);
    assert.match(run.stdout, /LOCAL_SQLSTATE=P0001/);
    assert.match(run.stdout, /LOCAL_SQL_LINE=2/);
    assert.match(run.stdout, /LOCAL_SQL_STATEMENT=INSERT_INTO/);
    assert.match(run.stdout, /LOCAL_SQL_OBJECT=public\.app_workspaces/);
    assert.match(run.stdout, /LOCAL_SQL_TRIGGER_FUNCTION=private\.app_task_child_project_guard/);
    assert.match(run.stdout, /LOCAL_SQL_TRIGGER_ACTION=RAISE/);
    assert.ok(!`${run.stdout}${run.stderr}`.includes(secret));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('local compatibility moves only reviewed admin default ACLs and preserves source lines', async () => {
  const {splitAdminDefaultAcl} = await import('../../supabase/local-verify/compat-default-acl.mjs');
  const sql = [
    'CREATE TABLE public.before_acl (id uuid);',
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO anon;',
    ...Array.from({length: 12}, (_, i) =>
      `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ${i % 3 === 0 ? 'SELECT ON TABLES' : i % 3 === 1 ? 'USAGE ON SEQUENCES' : 'EXECUTE ON FUNCTIONS'} TO postgres;`),
    'GRANT SELECT ON TABLE public.before_acl TO anon;',
  ].join('\n');
  const result = splitAdminDefaultAcl(sql);
  assert.equal(result.movedLines.length, 12);
  assert.equal(result.mainSql.split('\n').length, sql.split('\n').length);
  assert.match(result.mainSql, /FOR ROLE postgres/);
  assert.doesNotMatch(result.mainSql, /FOR ROLE supabase_admin/);
  assert.equal((result.adminSql.match(/FOR ROLE supabase_admin/g) ?? []).length, 12);
  assert.throws(() => splitAdminDefaultAcl(sql.replace('FOR ROLE supabase_admin', 'FOR ROLE other_role')));
});

test('security definer triage reports flags but withholds function bodies', () => {
  const directory = mkdtempSync(join(tmpdir(), 'web2-definer-review-'));
  try {
    const dump = join(directory, 'dump.sql');
    const secret = 'sensitive-body-literal';
    writeFileSync(dump, [
      '-- Name: app_public_project(uuid); Type: FUNCTION; Schema: public; Owner: postgres',
      'CREATE FUNCTION public.app_public_project(p_id uuid) RETURNS boolean AS $$',
      `SELECT auth.uid() IS NOT NULL AND private.app_can_edit_space(p_id) AND '${secret}' IS NOT NULL;`,
      '$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public;',
      '-- Name: app_public_project(uuid); Type: ACL; Schema: public; Owner: postgres',
      'REVOKE ALL ON FUNCTION public.app_public_project(uuid) FROM PUBLIC;',
      'GRANT EXECUTE ON FUNCTION public.app_public_project(uuid) TO anon, authenticated;',
    ].join('\n'));
    const run = spawnSync(process.execPath, [fileURLToPath(definerDiagnostics), dump], {encoding: 'utf8'});
    assert.equal(run.status, 0);
    assert.match(run.stdout, /DEFINER_REVIEW_COUNT=1/);
    assert.match(run.stdout, /search_path:true id_input:true identity_ref:true permission_helper_ref:true/);
    assert.ok(!`${run.stdout}${run.stderr}`.includes(secret));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('target default privilege statement is classified without leaking custom roles or SQL literals', () => {
  const directory = mkdtempSync(join(tmpdir(), 'web2-role-review-'));
  try {
    const dump = join(directory, 'dump.sql');
    const hosted = join(directory, 'hosted.json');
    const local = join(directory, 'local.json');
    const custom = 'person-secret-name';
    writeFileSync(dump, [
      '-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres',
      `ALTER DEFAULT PRIVILEGES FOR ROLE "${custom}" IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;`,
      '',
    ].join('\n'));
    writeFileSync(hosted, JSON.stringify({currentUser: 'postgres', roles: [
      {name: 'postgres', superuser: false}, {name: custom, superuser: false},
    ], memberships: [{member: 'postgres', role: custom}], schemaOwners: [{schema: 'public', owner: 'postgres'}]}));
    writeFileSync(local, JSON.stringify({currentUser: 'postgres', roles: [
      {name: 'postgres', superuser: false},
    ], memberships: [], schemaOwners: [{schema: 'public', owner: 'pg_database_owner'}]}));
    const run = spawnSync(process.execPath,
      [fileURLToPath(roleDiagnostics), 'compare', dump, '2', hosted, local], {encoding: 'utf8'});
    assert.equal(run.status, 0);
    assert.match(run.stdout, /TARGET_KIND=ALTER_DEFAULT_PRIVILEGES/);
    assert.match(run.stdout, /TARGET_SCHEMA=public/);
    assert.match(run.stdout, /TARGET_RECIPIENTS=anon,authenticated/);
    assert.match(run.stdout, /DEFAULT_ACL_CENSUS=role_[a-f0-9]{12}:public:FUNCTIONS:1/);
    assert.match(run.stdout, /ROLE_hostedCurrentMemberOfTarget=true/);
    assert.match(run.stdout, /ROLE_localTargetExists=false/);
    assert.ok(!`${run.stdout}${run.stderr}`.includes(custom));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('baseline inventory reports review candidates without printing literals or function bodies', () => {
  const directory = mkdtempSync(join(tmpdir(), 'web2-baseline-review-'));
  try {
    const file = join(directory, 'baseline.sql');
    const credential = 'postgresql://person:do-not-print@private.invalid/db';
    writeFileSync(file, [
      '-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres',
      'CREATE SCHEMA public;',
      '-- Name: app_spaces; Type: TABLE; Schema: public; Owner: postgres',
      `CREATE TABLE public.app_spaces (id uuid DEFAULT 'private-literal-${credential}');`,
      'ALTER TABLE public.app_spaces OWNER TO postgres;',
      '-- Name: app_can_edit_space(uuid); Type: FUNCTION; Schema: private; Owner: postgres',
      'CREATE FUNCTION private.app_can_edit_space(uuid) RETURNS boolean AS $$',
      `SELECT '${credential}'::text IS NOT NULL FROM auth.users;`,
      '$$ LANGUAGE sql SECURITY DEFINER SET search_path = private, public;',
      '-- Name: unsafe_function(); Type: FUNCTION; Schema: private; Owner: postgres',
      'CREATE FUNCTION private.unsafe_function() RETURNS void AS $$',
      'EXECUTE some_statement;',
      '$$ LANGUAGE plpgsql SECURITY DEFINER;',
      '-- Name: app_spaces; Type: ACL; Schema: public; Owner: postgres',
      'GRANT SELECT ON TABLE public.app_spaces TO anon, authenticated;',
      '',
    ].join('\n'));
    const result = spawnSync(process.execPath, [fileURLToPath(baselineReview), 'inventory', file], {encoding: 'utf8'});
    assert.equal(result.status, 0);
    assert.match(result.stdout, /LOCAL_SCHEMA_COLLISION_CANDIDATE.*public/);
    assert.match(result.stdout, /SECURITY_DEFINER.*private\.app_can_edit_space/);
    assert.match(result.stdout, /SEARCH_PATH.*private\.app_can_edit_space/);
    assert.match(result.stdout, /ROLE_REFERENCE.*authenticated/);
    assert.match(result.stdout, /ROLE_REFERENCE.*anon/);
    assert.match(result.stdout, /SECURITY_DEFINER_NO_SEARCH_PATH.*private\.unsafe_function/);
    assert.match(result.stdout, /DYNAMIC_SQL_REVIEW.*private\.unsafe_function/);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(credential));
    assert.ok(!`${result.stdout}${result.stderr}`.includes('private-literal'));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('baseline failure reports first SQLSTATE, dump line and object without SQL text', () => {
  const directory = mkdtempSync(join(tmpdir(), 'web2-baseline-error-'));
  try {
    const dump = join(directory, 'baseline.sql');
    const error = join(directory, 'stderr.log');
    const secret = 'sk-this-must-not-appear-12345678901234567890';
    writeFileSync(dump, [
      '-- Name: app_spaces; Type: TABLE; Schema: public; Owner: postgres',
      'CREATE TABLE public.app_spaces (id uuid);',
      'ALTER TABLE public.app_spaces OWNER TO postgres;',
      '',
    ].join('\n'));
    writeFileSync(error, `psql:/verify/baseline.sql:3: ERROR:  42704: role \'${secret}\' does not exist\nDETAIL: ${secret}\n`);
    const result = spawnSync(process.execPath,
      [fileURLToPath(baselineReview), 'failure', dump, error], {encoding: 'utf8'});
    assert.equal(result.status, 0);
    assert.match(result.stdout, /BASELINE_SQLSTATE=42704/);
    assert.match(result.stdout, /BASELINE_DUMP_LINE=3/);
    assert.match(result.stdout, /BASELINE_STAGE=GRANTS_OWNERSHIP/);
    assert.match(result.stdout, /BASELINE_OBJECT_TYPE=TABLE/);
    assert.match(result.stdout, /BASELINE_OBJECT=public\.app_spaces/);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('startup diagnostics classify failure without echoing log secrets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'web2-start-log-'));
  try {
    const file = join(directory, 'start.log');
    const credential = 'postgresql://user:password@production.invalid/db';
    writeFileSync(file, `supabase_auth_web2 is unhealthy\n${credential}\nOPENAI_API_KEY=secret-token\n`);
    const result = spawnSync(process.execPath, [fileURLToPath(diagnostics), 'classify', file], {encoding: 'utf8'});
    assert.equal(result.status, 0);
    assert.match(result.stdout, /LOCAL_START_CATEGORY=HEALTH_CHECK_FAILED/);
    assert.match(result.stdout, /LOCAL_START_SERVICE=auth/);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(credential));
    assert.ok(!`${result.stdout}${result.stderr}`.includes('secret-token'));
    writeFileSync(file, 'Error: no space left on device during image extraction\n');
    assert.match(spawnSync(process.execPath, [fileURLToPath(diagnostics), 'classify', file], {encoding: 'utf8'}).stdout,
      /LOCAL_START_CATEGORY=RUNNER_DISK/);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('baseline checker requires reviewed hash and rejects row data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'web2-ci-schema-'));
  try {
    const file = join(directory, 'baseline.sql');
    const objects = [
      'app_workspaces', 'app_pages', 'app_spaces', 'app_documents',
      'app_meetings', 'app_tasks', 'app_project_updates',
      'app_ai_workspace_settings', 'public_policy_drive_config',
    ];
    const safe = restricted(objects.map(name => `CREATE TABLE public.${name} (id uuid);`).join('\n') +
      '\nCREATE FUNCTION private.app_can_edit_space(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;\n', 'randomA');
    writeFileSync(file, safe);
    const hash = canonicalSchemaHash(safe);
    const run = supplied => spawnSync(process.execPath, [fileURLToPath(checker), file, supplied], {encoding: 'utf8'});
    assert.equal(run(hash).status, 0);
    assert.notEqual(run('0'.repeat(64)).status, 0);
    const unsafe = safe + 'COPY public.app_pages (id) FROM stdin;\n';
    writeFileSync(file, unsafe);
    assert.notEqual(run(canonicalSchemaHash(unsafe)).status, 0);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test('local Auth fixture refuses a non-loopback Supabase URL before networking', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(createAuth), 'unused.json'], {
    encoding: 'utf8',
    env: {...process.env, API_URL: 'https://example.invalid', ANON_KEY: 'fake', SERVICE_ROLE_KEY: 'fake'},
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /loopback/);
});

test('schema scanner reports secret locations without printing values', () => {
  const directory = mkdtempSync(join(tmpdir(), 'web2-ci-scan-'));
  try {
    const file = join(directory, 'dump.sql');
    const safe = 'CREATE TABLE public.app_spaces (id uuid);\nCREATE FUNCTION private.app_can_edit_space(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;\n';
    writeFileSync(file, safe);
    const run = () => spawnSync(process.execPath, [fileURLToPath(scanner), file], {encoding: 'utf8'});
    assert.equal(run().status, 0);
    const secret = 'postgresql://user:do-not-print@example.invalid/postgres';
    writeFileSync(file, safe + `SELECT '${secret}';\n`);
    const unsafe = run();
    assert.notEqual(unsafe.status, 0);
    assert.match(unsafe.stderr, /line 3, database connection string/);
    assert.ok(!`${unsafe.stdout}${unsafe.stderr}`.includes(secret));
    writeFileSync(file, safe + 'COPY public.app_pages (id) FROM stdin;\n');
    assert.match(run().stderr, /row-data COPY/);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
