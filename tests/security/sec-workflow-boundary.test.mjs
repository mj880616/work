import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const workflowsDir = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
const workflow = name => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');

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

test('base changes rerun named publication and dropzone checks', () => {
  const gate = workflow('publication-gate.yml');
  const dropzone = workflow('web1-file-dropzone.yml');
  for (const source of [gate, dropzone]) {
    assert.match(source, /types: \[opened, synchronize, reopened, edited\]/);
    assert.match(source, /github\.event\.changes\.base != null/);
  }
  assert.match(gate, /^  publication-gate:/m);
  assert.match(dropzone, /^  dropzone:/m);
  assert.match(gate, /pull_request_target:\s*\n\s+branches: \[main\]/);
  assert.match(gate, /changes\.base == null && 'description' \|\| 'decision'/);
  assert.match(gate, /content-check:[\s\S]*?permissions:\s*\n\s+contents: read/);
});

test('checks awaited by the publication gate rerun on base changes only', () => {
  const policy = readFileSync(new URL('../../scripts/publication-pr-policy.mjs', import.meta.url), 'utf8');
  assert.match(policy, /\['loader-cache', 'audit'\] : \['loader-cache'\]/);
  for (const [name, job] of [['loader-cache-check.yml', 'loader-cache'], ['browser-storage-audit.yml', 'audit']]) {
    const source = workflow(name);
    assert.match(source, /pull_request:\s*\n\s+branches: \[main\]\s*\n\s+types: \[opened, synchronize, reopened, edited\]/, name);
    assert.match(source, new RegExp(`^  ${job}:\\r?\\n    if: github\\.event\\.action != 'edited' \\|\\| github\\.event\\.changes\\.base != null\\r?\\n`, 'm'), name);
    assert.doesNotMatch(source, /pull_request_target/, name);
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
  assert.deepEqual(required, ['publication-gate', 'dropzone']);
});

test('Actions policy 6065 workflow paths keep their names', () => {
  const names = readdirSync(workflowsDir);
  assert.ok(names.includes('publication-gate.yml'));
  assert.ok(names.includes('publication-auto-merge.yml'));
});

test('auto merge only reserves for main and cancels departures from main', () => {
  const source = workflow('publication-auto-merge.yml');
  assert.match(source, /pull_request_target:\s*\n\s+types: \[opened, synchronize, reopened, edited\]/);
  assert.match(source, /cancel-departed-main:[\s\S]*?changes\.base\.ref\.from == 'main'/);
  assert.match(source, /\.base\.ref' <<< "\$pr"\)" != main/);
  assert.match(source, /--disable-auto/);
  assert.match(source, /reserve:\s*\n\s+if: github\.event\.pull_request\.base\.ref == 'main'/);
  assert.match(source, /changes\.base == null && 'description' \|\| 'decision'/);
  assert.match(source, /PR head or base changed; no reservation made/);
  assert.match(source, /--match-head-commit/);
});
