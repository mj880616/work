import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const ROOT=new URL('../../',import.meta.url);

test('Task 12A no-cost workflow has every local verification dependency',()=>{
  const workflow=readFileSync(new URL('.github/workflows/web2-one-shot-schema-authz.yml',ROOT),'utf8');
  const required=[
    'supabase/local-verify/bootstrap-ci.sh',
    'supabase/local-verify/check-baseline.mjs',
    'supabase/local-verify/schema-hash.mjs',
    'supabase/local-verify/compat-default-acl.mjs',
    'supabase/local-verify/diagnose-start.mjs',
    'supabase/local-verify/analyze-baseline.mjs',
    'supabase/local-verify/analyze-sql-failure.mjs',
    'supabase/local-verify/task12a-fingerprint.sql'
  ];
  for(const path of required) assert.equal(existsSync(new URL(path,ROOT)),true,`workflow dependency is missing: ${path}`);
  assert.match(workflow,/version:\s*2\.84\.2/,'workflow must pin the reviewed Supabase CLI');
  assert.match(workflow,/refs\/heads\/security\/task12a-sole-owner-db/,'feature branch dispatch must be explicit');
  assert.match(workflow,/EXPECTED_COMMIT_SHA/,'verify must bind to the reviewed feature-branch commit');
  assert.match(workflow,/WEB2_TASK12A:[^\n]*task12a-sole-owner-db/,
    'workflow must select the focused Task 12A mode on the Task 12A branch');
});

test('Task 12A local mode rehearses forward, actor matrix, rollback, fingerprint, and reapply',()=>{
  const script=readFileSync(new URL('supabase/local-verify/bootstrap-ci.sh',ROOT),'utf8');
  for(const token of [
    '20260925084844_task12a_sole_owner_db.sql',
    'authz_sole_owner.sql',
    'authz_project_owner_only.sql',
    'task12a-fingerprint.sql',
    'TASK12A_BASELINE_NORMALIZED',
    'cmp -s',
    'TASK12A_ROLLBACK_PASSED',
    'TASK12A_REAPPLY_PASSED'
  ]) assert.match(script,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),`local rehearsal is missing ${token}`);
  assert.match(script,/unset PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD PGOPTIONS PGSSLMODE PGSSLROOTCERT/,'production connection variables must be cleared before local startup');
  assert.match(script,/127\.0\.0\.1|localhost/,'local endpoints must be loopback-only');
});

test('Task 12A inspect and verify use the same canonical schema hash',()=>{
  const scanner=readFileSync(new URL('supabase/local-verify/scan-schema.mjs',ROOT),'utf8');
  assert.match(scanner,/import\s*\{canonicalSchemaHash\}\s*from\s*['"]\.\/schema-hash\.mjs['"]/,
    'inspect must share the canonical hash implementation used by verify');
  assert.match(scanner,/canonicalSchemaHash\(sql\)/,
    'inspect must print the canonical hash that verify compares');
  assert.doesNotMatch(scanner,/createHash\(['"]sha256['"]\)\.update\(sql\)/,
    'inspect must not hash the raw pg_dump restriction key');
});

test('Task 12A baseline accepts the deployed Web1 public projection',()=>{
  const checker=readFileSync(new URL('supabase/local-verify/check-baseline.mjs',ROOT),'utf8');
  assert.doesNotMatch(checker,/Baseline already includes a pending publication migration/,
    'deployed public projection objects must not be treated as pending');
  assert.match(checker,/app_public_post/,
    'baseline must require the deployed single-post projection');
  assert.match(checker,/app_project_publications/,
    'baseline must require the deployed public-project schema used by Web1 regressions');
});
