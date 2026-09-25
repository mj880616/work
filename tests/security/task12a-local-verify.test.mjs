import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const ROOT=new URL('../../',import.meta.url);

test('Task 12A no-cost workflow has every local verification dependency',()=>{
  const workflow=readFileSync(new URL('.github/workflows/web2-one-shot-schema-authz.yml',ROOT),'utf8');
  const required=[
    'supabase/local-verify/bootstrap-ci.sh',
    'supabase/local-verify/check-baseline.mjs',
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
  assert.match(workflow,/WEB2_TASK12A:\s*'1'/,'workflow must select the focused Task 12A mode');
});

test('Task 12A local mode rehearses forward, actor matrix, rollback, fingerprint, and reapply',()=>{
  const script=readFileSync(new URL('supabase/local-verify/bootstrap-ci.sh',ROOT),'utf8');
  for(const token of [
    '20260925084844_task12a_sole_owner_db.sql',
    'authz_sole_owner.sql',
    'authz_project_owner_only.sql',
    'task12a-fingerprint.sql',
    'cmp -s',
    'TASK12A_ROLLBACK_PASSED',
    'TASK12A_REAPPLY_PASSED'
  ]) assert.match(script,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),`local rehearsal is missing ${token}`);
  assert.match(script,/unset PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD PGOPTIONS PGSSLMODE PGSSLROOTCERT/,'production connection variables must be cleared before local startup');
  assert.match(script,/127\.0\.0\.1|localhost/,'local endpoints must be loopback-only');
});
