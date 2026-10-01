import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const workflowsDir = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
const workflow = name => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('workflow files contain no direct repository push path', () => {
  for (const name of readdirSync(workflowsDir).filter(name => /\.ya?ml$/.test(name))) {
    const source = workflow(name);
    assert.doesNotMatch(source, /\bgit\s+push\b|\bgit\s+commit\b|createCommit|createOrUpdateFileContents/, name);
    if (name !== 'publication-auto-merge.yml') assert.doesNotMatch(source, /^\s+contents:\s*write\s*$/m, name);
  }
});

test('metadata synchronization only compares PR and manual run output', () => {
  const source = workflow('sync-public-page-meta.yml');
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /pull_request:[\s\S]*?branches: \[main\][\s\S]*?['"]p\/\*\*['"]/);
  assert.doesNotMatch(source, /schedule:|^  push:/m);
  assert.match(source, /permissions:\s*\n\s+contents: read/);
  assert.match(source, /node scripts\/generate-public-pages\.mjs --check/);
  assert.match(source, /git diff --exit-code -- p/);
  assert.match(source, /git status --porcelain -- p/);
});

const REQUIRED_CHECK_JOBS = { 'publication-gate.yml': 'publication-gate', 'web1-file-dropzone.yml': 'dropzone' };
const NO_EDITED = ['publication-gate.yml', 'web1-file-dropzone.yml', 'publication-auto-merge.yml', 'loader-cache-check.yml', 'browser-storage-audit.yml'];

const jobBlocks = source => {
  const jobs = source.slice(source.indexOf('\njobs:\n'));
  return Object.fromEntries([...jobs.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|(?![\s\S]))/gm)].map(match => [match[1], match[2]]));
};

test('publication and gate-input workflows do not listen to PR edits', () => {
  for (const name of NO_EDITED) {
    const source = workflow(name);
    assert.doesNotMatch(source, /\bedited\b|changes\.base|github\.event\.action/, name);
  }
  for (const name of ['publication-gate.yml', 'web1-file-dropzone.yml', 'publication-auto-merge.yml']) {
    assert.match(workflow(name), /^    types: \[opened, synchronize, reopened\]$/m, name);
  }
});

test('required check jobs have no event-based skip and come from one workflow each', () => {
  for (const [name, job] of Object.entries(REQUIRED_CHECK_JOBS)) {
    const source = workflow(name);
    assert.doesNotMatch(source, /^\s+(paths|paths-ignore|branches-ignore):/m, name);
    const block = jobBlocks(source)[job];
    assert.ok(block, `${name} defines ${job}`);
    const condition = block.match(/^    if: (.+)$/m)?.[1];
    if (job === 'publication-gate') assert.equal(condition, 'always()');
    else assert.equal(condition, undefined, `${job} must not be conditional`);
  }
  assert.match(workflow('publication-gate.yml'), /^  classify:\n    runs-on:/m);
  for (const name of readdirSync(workflowsDir).filter(name => /\.ya?ml$/.test(name))) {
    const declared = Object.keys(jobBlocks(workflow(name))).filter(job => Object.values(REQUIRED_CHECK_JOBS).includes(job));
    assert.deepEqual(declared, REQUIRED_CHECK_JOBS[name] ? [REQUIRED_CHECK_JOBS[name]] : [], name);
  }
});

test('checks awaited by the publication gate run on every main PR open, push and reopen', () => {
  const policy = readFileSync(new URL('../../scripts/publication-pr-policy.mjs', import.meta.url), 'utf8');
  assert.match(policy, /\['loader-cache', 'audit'\] : \['loader-cache'\]/);
  for (const [name, job] of [['loader-cache-check.yml', 'loader-cache'], ['browser-storage-audit.yml', 'audit']]) {
    const source = workflow(name);
    assert.match(source, /pull_request:\n    branches: \[main\]\n(?!    types:)/, name);
    assert.doesNotMatch(source, /pull_request_target/, name);
    assert.doesNotMatch(jobBlocks(source)[job], /^    if:/m, name);
  }
});

test('auto merge confirms the main ruleset by content and fails loudly when it is not ready', () => {
  const source = workflow('publication-auto-merge.yml');
  assert.doesNotMatch(source, /Main PR gate|\.name ==/);
  const step = source.match(/- name: Require a main ruleset[\s\S]*?(?=\n      - name:)/)?.[0] ?? '';
  assert.match(step, /if: steps\.classify\.outputs\.auto_eligible == 'true'/);
  assert.match(step, /run: node scripts\/publication-pr-policy\.mjs ruleset-ready/);
  assert.doesNotMatch(step, /continue-on-error|\|\| true|exit 0/);
  assert.ok(source.indexOf('ruleset-ready') < source.indexOf('--auto --merge'));
  assert.match(source, /reserve:[\s\S]*?Check out trusted base policy only[\s\S]*?ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  const required = JSON.parse(readFileSync(new URL('../../docs/main-pr-gate-ruleset.json', import.meta.url), 'utf8'))
    .rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks.map(check => check.context);
  assert.deepEqual(required, Object.values(REQUIRED_CHECK_JOBS));
});

test('auto merge only reserves on main PR open, push and reopen', () => {
  const source = workflow('publication-auto-merge.yml');
  assert.match(source, /pull_request_target:\n    branches: \[main\]\n    types: \[opened, synchronize, reopened\]/);
  assert.match(source, /group: publication-auto-merge-\$\{\{ github\.event\.pull_request\.number \}\}\n/);
  assert.match(source, /reserve:\n    if: github\.event\.pull_request\.base\.ref == 'main'\n/);
  assert.doesNotMatch(source, /cancel-departed-main/);
  assert.match(source, /Remove an old reservation when scope expands[\s\S]*?--disable-auto/);
  assert.match(source, /PR head or base changed; no reservation made/);
  assert.match(source, /--match-head-commit/);
});

test('Actions policy 6065 workflow paths keep their names', () => {
  const names = readdirSync(workflowsDir);
  assert.ok(names.includes('publication-gate.yml'));
  assert.ok(names.includes('publication-auto-merge.yml'));
});
