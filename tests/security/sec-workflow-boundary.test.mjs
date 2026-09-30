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
