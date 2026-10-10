import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const path = new URL('../../.github/workflows/edge-function-deploy.yml', import.meta.url);
const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
const script = name => {
  const block = source.split(`      - name: ${name}\n`)[1]?.split('\n      - name:')[0];
  assert.ok(block, `missing step: ${name}`);
  return block.split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
};

test('Edge deployment is manual, production-approved, serialized and read-only in GitHub', () => {
  assert.match(source, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(source, /^  (push|schedule|pull_request|pull_request_target|workflow_call):/m);
  assert.match(source, /environment: production-edge/);
  assert.match(source, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(source, /^\s+[\w-]+:\s*write\s*$/m);
  assert.match(source, /group: supabase-production-edge\n  cancel-in-progress: false/);
  assert.match(source, /expect_unauth_401:[\s\S]*?type: boolean\n        default: true/);
});

test('deployment pins actions and CLI and forbids other production mutations or token logging', () => {
  const actions = [...source.matchAll(/uses: (\S+)/g)].map(m => m[1]);
  assert.deepEqual(actions, ['actions/checkout@11d5960a326750d5838078e36cf38b85af677262']);
  assert.match(source, /npx --yes supabase@2\.120\.0/);
  assert.doesNotMatch(source, /functions\s+delete|secrets\s+set|\bsupabase(?:@[\w.]+)?\s+(?:db|login)\b|--prune|set -x/);
  assert.match(source, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(source, /SUPABASE_PROJECT_REF: \$\{\{ vars\.SUPABASE_PROJECT_REF \}\}/);
  assert.doesNotMatch(source, /(?:echo|printf)[^\n]*(?:SUPABASE_ACCESS_TOKEN|secrets\.)/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /ref: \$\{\{ inputs\.ref \}\}/);
  assert.doesNotMatch(source, /run:.*\$\{\{ inputs\./);
  assert.equal([...source.matchAll(/npx --yes supabase@/g)].length, 3);
  assert.equal([...source.matchAll(/\(cd "\$DEPLOY_DIR" && npx --yes supabase@2\.120\.0/g)].length, 3);
  assert.match(source, /NPM_CONFIG_USERCONFIG=%s\/\.npmrc/);
  assert.match(source, /NPM_CONFIG_REGISTRY=https:\/\/registry\.npmjs\.org\//);
});

function sandbox(run) {
  const cwd = mkdtempSync(join(tmpdir(), 'edge-deploy-test-'));
  try {
    mkdirSync(join(cwd, 'supabase/functions/example'), { recursive: true });
    writeFileSync(join(cwd, 'supabase/functions/example/index.ts'), '// fixture');
    return run(cwd);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
const shell = (name, cwd, env = {}) => spawnSync('bash', ['-c', script(name)], {
  cwd, encoding: 'utf8', env: { ...process.env, FUNCTION_NAME: 'example', EXPECT_UNAUTH_401: 'true', GITHUB_OUTPUT: join(cwd, 'output'), ...env },
});

test('input validation accepts a real function and rejects traversal, hidden/shared or missing functions', () => sandbox(cwd => {
  assert.equal(shell('Validate inputs', cwd).status, 0);
  for (const name of ['_shared', '_hidden', '../example', 'example/child', 'example;echo injected', '', 'missing']) {
    assert.notEqual(shell('Validate inputs', cwd, { FUNCTION_NAME: name }).status, 0, name);
  }
  assert.notEqual(shell('Validate inputs', cwd, { EXPECT_UNAUTH_401: 'invalid' }).status, 0);
}));

test('metadata validation rejects missing, duplicate and malformed records before deployment', () => sandbox(cwd => {
  const valid = { slug: 'example', version: 7, verify_jwt: false, updated_at: 1700000000000 };
  const check = rows => {
    writeFileSync(join(cwd, 'before-list.json'), JSON.stringify(rows));
    return shell('Validate before metadata', cwd);
  };
  assert.equal(check([valid]).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'before.json'), 'utf8')), { version: 7, verify_jwt: false, updated_at: valid.updated_at });
  for (const rows of [[], [valid, valid], [{ ...valid, verify_jwt: 'false' }], [{ ...valid, version: null }], [{ ...valid, updated_at: null }]]) {
    assert.notEqual(check(rows).status, 0, JSON.stringify(rows));
  }
}));

test('post-deploy validation requires an increased version and unchanged JWT policy', () => sandbox(cwd => {
  writeFileSync(join(cwd, 'before.json'), JSON.stringify({ version: 7, verify_jwt: true, updated_at: 1 }));
  for (const [version, jwt, expected] of [[8, true, 0], [7, true, 1], [6, true, 1], [8, false, 1]]) {
    writeFileSync(join(cwd, 'after-list.json'), JSON.stringify([{ slug: 'example', version, verify_jwt: jwt, updated_at: 2 }]));
    assert.equal(shell('Validate after metadata', cwd).status === 0, expected === 0);
  }
}));

test('probe sends only empty unauthenticated POST when requested and always checks OPTIONS', () => {
  const code = script('Verify unauthenticated HTTP');
  assert.match(code, /if \[\[ "\$EXPECT_UNAUTH_401" == true \]\]/);
  assert.match(code, /--request POST --header 'Content-Type: application\/json' --data '\{\}'/);
  assert.match(code, /post_status" == 401/);
  assert.match(code, /--request OPTIONS/);
  assert.match(code, /options_status" == 200/);
  assert.match(code, /\[\[ "\$options_status" == 200 \|\| "\$options_status" == 204 \]\] \|\| \{ echo 'OPTIONS did not return 200 or 204'; exit 1; \}/);
  assert.ok(code.includes("printf 'OPTIONS: %s\\n' \"$options_status\" >> \"$GITHUB_STEP_SUMMARY\""));
  assert.doesNotMatch(code, /Authorization|apikey|--location/);
});

test('deployment passes exactly one function and keeps false and true policies despite source config', () => sandbox(cwd => {
  const bin = join(cwd, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'npx'), '#!/bin/bash\nprintf "%s\\n" "$@" > "$CALL_LOG"\n', { mode: 0o755 });
  for (const jwt of [false, true]) {
    writeFileSync(join(cwd, 'before.json'), JSON.stringify({ verify_jwt: jwt }));
    writeFileSync(join(cwd, 'supabase/config.toml'), `[functions.example]\nverify_jwt = ${!jwt}\n`);
    const result = shell('Deploy preserving JWT policy', cwd, { PATH: `${bin}:${process.env.PATH}`, DEPLOY_DIR: cwd, CALL_LOG: join(cwd, 'call'), SUPABASE_PROJECT_REF: 'synthetic-project' });
    assert.equal(result.status, 0, result.stderr);
    const args = readFileSync(join(cwd, 'call'), 'utf8').trim().split('\n');
    assert.deepEqual(args, ['--yes', 'supabase@2.120.0', 'functions', 'deploy', 'example', '--project-ref', 'synthetic-project', '--workdir', cwd, '--use-api', ...(!jwt ? ['--no-verify-jwt'] : [])]);
    assert.match(readFileSync(join(cwd, 'supabase/config.toml'), 'utf8'), new RegExp(`verify_jwt = ${jwt}\\n`));
  }
}));

test('HTTP verification handles success, public skip, wrong status and transport failure without network', () => sandbox(cwd => {
  const bin = join(cwd, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'curl'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$CALL_LOG"\n[[ "${FAIL_TRANSPORT:-false}" == true ]] && exit 7\nif [[ "$*" == *"--request POST"* ]]; then printf "%s" "$POST_STATUS"; else printf "%s" "$OPTIONS_STATUS"; fi\n', { mode: 0o755 });
  for (const [expect, post, options, transport, success, methods] of [
    ['true', '401', '200', 'false', true, ['POST', 'OPTIONS']],
    ['false', '200', '200', 'false', true, ['OPTIONS']],
    ['true', '401', '204', 'false', true, ['POST', 'OPTIONS']],
    ['false', '200', '204', 'false', true, ['OPTIONS']],
    ['true', '200', '200', 'false', false, ['POST']],
    ['true', '401', '403', 'false', false, ['POST', 'OPTIONS']],
    ['true', '401', '404', 'false', false, ['POST', 'OPTIONS']],
    ['true', '401', '500', 'false', false, ['POST', 'OPTIONS']],
    ['true', '401', '200', 'true', false, ['POST']],
  ]) {
    writeFileSync(join(cwd, 'call'), '');
    writeFileSync(join(cwd, 'summary'), '');
    const result = shell('Verify unauthenticated HTTP', cwd, { PATH: `${bin}:${process.env.PATH}`, CALL_LOG: join(cwd, 'call'), GITHUB_STEP_SUMMARY: join(cwd, 'summary'), EXPECT_UNAUTH_401: expect, POST_STATUS: post, OPTIONS_STATUS: options, FAIL_TRANSPORT: transport, SUPABASE_PROJECT_REF: 'synthetic-project' });
    assert.equal(result.status === 0, success, result.stderr);
    const calls = readFileSync(join(cwd, 'call'), 'utf8');
    assert.deepEqual([...calls.matchAll(/--request (POST|OPTIONS)/g)].map(m => m[1]), methods);
    assert.doesNotMatch(calls, /Authorization|apikey/);
    if (transport === 'false' && methods.includes('OPTIONS')) {
      assert.ok(readFileSync(join(cwd, 'summary'), 'utf8').includes(`OPTIONS: ${options}\n`));
      if (!success) assert.match(result.stdout, /OPTIONS did not return 200 or 204/);
    }
  }
}));

const firstEnv = jwt => ({ FIRST_DEPLOY: 'true', VERIFY_JWT: jwt });
function policyDoc(cwd, jwt = 'false') {
  mkdirSync(join(cwd, 'docs'), { recursive: true });
  writeFileSync(join(cwd, 'docs/web2-env6b-edge-source.md'), `## 5. production 함수 전체 verify_jwt\n\n| # | 이름 | 제품 | 버전 | 마지막 배포(KST) | verify_jwt | 원본 |\n| --- | --- | --- | --- | --- | --- | --- |\n| 1 | \`example\` | Web2 | 배포 대기 | 없음 | ${jwt} | work |\n\n### 5.1 other records\n`);
}

test('first-deploy inputs default off and keep; explicit policy is restricted to the new path', () => sandbox(cwd => {
  assert.match(source, /first_deploy:[\s\S]*?type: boolean\n        default: false/);
  assert.match(source, /verify_jwt:[\s\S]*?type: choice\n        options:\n          - keep\n          - 'true'\n          - 'false'\n        default: keep/);
  policyDoc(cwd);
  assert.equal(shell('Validate inputs', cwd, { FIRST_DEPLOY: 'false', VERIFY_JWT: 'keep' }).status, 0);
  for (const jwt of ['true', 'false', 'invalid', '']) {
    assert.notEqual(shell('Validate inputs', cwd, { FIRST_DEPLOY: 'false', VERIFY_JWT: jwt }).status, 0);
  }
  for (const jwt of ['true', 'false']) {
    policyDoc(cwd, jwt);
    assert.equal(shell('Validate inputs', cwd, firstEnv(jwt)).status, 0);
  }
  for (const env of [firstEnv('keep'), firstEnv('invalid'), { FIRST_DEPLOY: 'invalid', VERIFY_JWT: 'keep' }]) {
    assert.notEqual(shell('Validate inputs', cwd, env).status, 0);
  }
  assert.notEqual(shell('Validate inputs', cwd, { ...firstEnv('false'), FUNCTION_NAME: 'missing' }).status, 0);
}));

test('new policy must match exactly one row in the section 5 deployment table', () => sandbox(cwd => {
  const path = join(cwd, 'docs/web2-env6b-edge-source.md');
  assert.notEqual(shell('Validate inputs', cwd, firstEnv('false')).status, 0);
  policyDoc(cwd, '**true**');
  assert.equal(shell('Validate inputs', cwd, firstEnv('true')).status, 0);
  assert.notEqual(shell('Validate inputs', cwd, firstEnv('false')).status, 0);
  const doc = readFileSync(path, 'utf8');
  const row = doc.split('\n').find(line => line.includes('`example`'));
  for (const bad of [
    doc.replace('`example`', '`different`'),
    doc.replace('## 5.', '## 2.'),
    doc.replace(row, '').concat(`\n${row}\n`),
    doc.replace(row, `${row}\n${row}`),
    doc.replace('**true**', 'trueish'),
    doc.replace('verify_jwt | 원본', 'other | 원본'),
    doc.replace(row, '').replace('### 5.1', `${row}\n\n### 5.1`),
    doc.replace(row, '').replace('### 5.1', `\`\`\`markdown\n${row}\n\`\`\`\n\n### 5.1`),
    doc.replace(row, '').replace('### 5.1', doc.slice(doc.indexOf('| #'), doc.indexOf('### 5.1')) + '### 5.1'),
    doc.replace('| #', '```markdown\n| #').replace('### 5.1', '```\n### 5.1'),
  ]) {
    writeFileSync(path, bad);
    assert.notEqual(shell('Validate inputs', cwd, firstEnv('true')).status, 0, bad);
  }
}));

test('first deployment requires zero existing functions and validates positive integer version and requested JWT afterward', () => sandbox(cwd => {
  const valid = { slug: 'example', version: 1, verify_jwt: false, updated_at: 2 };
  for (const jwt of [false, true]) {
    const env = firstEnv(String(jwt));
    writeFileSync(join(cwd, 'before-list.json'), JSON.stringify([{ ...valid, slug: 'other' }]));
    assert.equal(shell('Validate before metadata', cwd, env).status, 0);
    assert.equal(JSON.parse(readFileSync(join(cwd, 'before.json'), 'utf8')).verify_jwt, jwt);
    for (const rows of [[valid], [valid, valid]]) {
      writeFileSync(join(cwd, 'before-list.json'), JSON.stringify(rows));
      assert.notEqual(shell('Validate before metadata', cwd, env).status, 0);
    }
    // Restore a successful plan before exercising post-deploy validation.
    writeFileSync(join(cwd, 'before-list.json'), '[]');
    assert.equal(shell('Validate before metadata', cwd, env).status, 0);
    const record = { ...valid, verify_jwt: jwt };
    for (const rows of [[record], [{ ...record, version: 4 }]]) {
      writeFileSync(join(cwd, 'after-list.json'), JSON.stringify(rows));
      assert.equal(shell('Validate after metadata', cwd, env).status, 0);
    }
    for (const rows of [[], [record, record], [{ ...record, verify_jwt: !jwt }], [{ ...record, verify_jwt: String(jwt) }], ...[0, -1, 1.5, null, '1'].map(version => [{ ...record, version }]), [{ ...record, updated_at: null }]]) {
      writeFileSync(join(cwd, 'after-list.json'), JSON.stringify(rows));
      assert.notEqual(shell('Validate after metadata', cwd, env).status, 0);
    }
  }
}));

test('first deployment fake CLI and HTTP path deploys one function with explicit policy without printing tokens', () => sandbox(cwd => {
  const bin = join(cwd, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'npx'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [[ "$*" == *"functions list"* ]]; then if [[ -f "$DEPLOY_DIR/deployed" ]]; then cat "$AFTER_FIXTURE"; else printf "[]"; fi; else touch "$DEPLOY_DIR/deployed"; fi\n', { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), '#!/bin/bash\nif [[ "$*" == *"--request POST"* ]]; then printf "401"; else printf "204"; fi\n', { mode: 0o755 });
  for (const jwt of [false, true]) {
    rmSync(join(cwd, 'deployed'), { force: true });
    writeFileSync(join(cwd, 'call'), '');
    writeFileSync(join(cwd, 'summary'), '');
    policyDoc(cwd, String(jwt));
    writeFileSync(join(cwd, 'after-fixture'), JSON.stringify([{ slug: 'example', version: 1, verify_jwt: jwt, updated_at: 2 }]));
    const env = { ...firstEnv(String(jwt)), PATH: `${bin}:${process.env.PATH}`, DEPLOY_DIR: cwd, CALL_LOG: join(cwd, 'call'), AFTER_FIXTURE: join(cwd, 'after-fixture'), SUPABASE_ACCESS_TOKEN: 'synthetic-secret-never-print', SUPABASE_PROJECT_REF: 'a'.repeat(20), DEPLOY_SHA: 'synthetic-source', GITHUB_STEP_SUMMARY: join(cwd, 'summary'), JOB_STATUS: 'success' };
    let output = '';
    for (const step of ['Validate inputs', 'Read before metadata', 'Validate before metadata', 'Record deployment plan', 'Deploy preserving JWT policy', 'Read after metadata', 'Validate after metadata', 'Verify unauthenticated HTTP', 'Report final metadata and outcome']) {
      const result = shell(step, cwd, env);
      assert.equal(result.status, 0, `${step}: ${result.stderr}`);
      output += result.stdout + result.stderr;
    }
    const calls = readFileSync(join(cwd, 'call'), 'utf8');
    const deploy = calls.split('\n').filter(line => line.includes('functions deploy'));
    assert.equal(deploy.length, 1);
    assert.equal(deploy[0], `--yes supabase@2.120.0 functions deploy example --project-ref ${'a'.repeat(20)} --workdir ${cwd} --use-api${jwt ? '' : ' --no-verify-jwt'}`);
    assert.match(readFileSync(join(cwd, 'supabase/config.toml'), 'utf8'), new RegExp(`verify_jwt = ${jwt}\\n`));
    const summary = readFileSync(join(cwd, 'summary'), 'utf8');
    assert.match(summary, /화면이 아직 이 함수를 쓰지 않는 상태 유지/);
    assert.match(summary, /OPTIONS: 204/);
    assert.doesNotMatch(output + calls + summary, /synthetic-secret-never-print/);
  }
}));

test('first-deploy failure summary requires manual dashboard decision even without valid after metadata', () => sandbox(cwd => {
  for (const rows of [null, [], [{ slug: 'example', version: 1, verify_jwt: true, updated_at: 2 }]]) {
    rmSync(join(cwd, 'after-list.json'), { force: true });
    if (rows) writeFileSync(join(cwd, 'after-list.json'), JSON.stringify(rows));
    writeFileSync(join(cwd, 'summary'), '');
    const result = shell('Report final metadata and outcome', cwd, { ...firstEnv('false'), JOB_STATUS: 'failure', GITHUB_STEP_SUMMARY: join(cwd, 'summary') });
    assert.equal(result.status, 0, result.stderr);
    const summary = readFileSync(join(cwd, 'summary'), 'utf8');
    assert.match(summary, /수동 확인·삭제 판단 필요/);
    assert.match(summary, /사용자 대시보드/);
    assert.doesNotMatch(summary, /Rollback uses the same button/);
  }
}));
