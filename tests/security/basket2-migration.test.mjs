import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMigration, toDryRun } from '../../scripts/ops/db-migration-plan.mjs';
import { readFileSync } from 'node:fs';

const version = '20261010180000';
test('BASKET-2 approval files pass risk checks and dry-run transformation', () => {
  for (const mode of ['apply', 'dry-run', 'rollback']) {
    const plan = prepareMigration({mode, version, runId:'12345', root:process.cwd()});
    assert.deepEqual(plan.targets,['app_drive_settings']);
    assert.equal(plan.summaryLines.length,3);
    assert.equal(plan.checks.postcheck.baselineNull,false);
    assert.match(plan.checks.precheck.sql,/workspace_id/);
    if(mode !== 'rollback') {
      assert.match(toDryRun(plan.file.sql),/rollback;\s*$/);
      assert.doesNotMatch(plan.file.sql,/grant |alter policy|row level security/i);
    }
  }
});
test('new function is pre-registered in the exact first-deploy policy table', async () => {
  const {mkdtempSync,writeFileSync,rmSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {spawnSync} = await import('node:child_process');
  const dir=mkdtempSync(join(tmpdir(),'basket-first-deploy-'));
  const workflow=readFileSync('.github/workflows/edge-function-deploy.yml','utf8');
  const script=name=>workflow.split(`      - name: ${name}\n`)[1].split('\n      - name:')[0]
    .split('        run: |\n')[1].split('\n').map(s=>s.replace(/^          /,'')).join('\n');
  const run=name=>spawnSync('bash',['-c',script(name)],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,
    FUNCTION_NAME:'basket-files',FIRST_DEPLOY:'true',VERIFY_JWT:'false',EXPECT_UNAUTH_401:'true',
    GITHUB_OUTPUT:join(dir,'output')}});
  try {
    let r=run('Validate inputs'); assert.equal(r.status,0,r.stdout+r.stderr);
    // Metadata step uses local files: run it in a temporary root containing the real source/doc.
    const {mkdirSync,copyFileSync}=await import('node:fs');
    mkdirSync(join(dir,'docs')); copyFileSync('docs/web2-env6b-edge-source.md',join(dir,'docs/web2-env6b-edge-source.md'));
    writeFileSync(join(dir,'before-list.json'),'[]');
    r=spawnSync('bash',['-c',script('Validate before metadata')],{cwd:dir,encoding:'utf8',env:{...process.env,
      FUNCTION_NAME:'basket-files',FIRST_DEPLOY:'true',VERIFY_JWT:'false',GITHUB_OUTPUT:join(dir,'output')}});
    assert.equal(r.status,0,r.stdout+r.stderr);
    assert.equal(JSON.parse(readFileSync(join(dir,'before.json'),'utf8')).verify_jwt,false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
