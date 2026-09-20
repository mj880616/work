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
  assert.match(oneShot, /EXPECTED_SHA256/);
  assert.doesNotMatch(oneShot, /upload-artifact|db pull|db push|supabase link/);
  assert.doesNotMatch(oneShot, /["']\$\{\{\s*inputs\.expected_sha256/);
  const scan = oneShot.indexOf('node supabase/local-verify/scan-schema.mjs');
  const compare = oneShot.indexOf('node supabase/local-verify/schema-hash.mjs');
  const setup = oneShot.indexOf('supabase/setup-cli@v3');
  const staticTests = oneShot.indexOf('node --test tests/security/');
  const bootstrapStep = oneShot.indexOf('bash supabase/local-verify/bootstrap-ci.sh');
  assert.ok(scan >= 0 && scan < compare && compare < setup && setup < staticTests && staticTests < bootstrapStep,
    'raw scan and canonical hash gate must precede all verification work');
});

test('CI inputs exist and the local seed precedes pending migrations', () => {
  for (const path of [
    '.github/workflows/web2-one-shot-schema-authz.yml',
    '.github/workflows/web2-local-supabase-authz.yml',
    'supabase/local-verify/schema-hash.mjs',
    'supabase/local-verify/scan-schema.mjs',
    'supabase/local-verify/check-baseline.mjs',
    'supabase/local-verify/bootstrap-ci.sh',
    'supabase/local-verify/custom-auth-trigger.sql',
    'supabase/local-verify/create-local-auth.mjs',
    'supabase/local-verify/seed-before-cutover.sql',
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
  const seed = bootstrap.indexOf('seed-before-cutover.sql');
  const prepare = bootstrap.indexOf('20260920120000_public_single_post_prepare.sql');
  const cutover = bootstrap.indexOf('20260920121000_public_single_post_cutover.sql');
  const project = bootstrap.indexOf('20260920122000_project_public_view.sql');
  const sql = bootstrap.indexOf('authz_public_snapshot.sql');
  const http = bootstrap.indexOf('http-authz.test.mjs');
  assert.ok(auth >= 0 && auth < seed && seed < prepare && prepare < cutover &&
    cutover < project && project < sql && sql < http);
  assert.match(load('supabase/local-verify/seed-before-cutover.sql'),
    /app\.local_verification.*is distinct from 'on'/s);
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
