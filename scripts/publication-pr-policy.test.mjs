import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  classifyPublicationPaths,
  isTrustedPublicationAuthor,
  readPullRequestSnapshot,
  verifyNecessaryChecks,
} from './publication-pr-policy.mjs';

const workflow = name => readFileSync(fileURLToPath(new URL(`../.github/workflows/${name}`, import.meta.url)), 'utf8');

test('publication decisions use base-controlled pull_request_target workflows', () => {
  for (const name of ['publication-auto-merge.yml', 'publication-gate.yml']) {
    const source = workflow(name);
    assert.match(source, /\bon:\s*\n\s+pull_request_target:/);
    assert.doesNotMatch(source, /\n\s+pull_request:/);
  }
  assert.match(workflow('publication-gate.yml'), /  content-check:\s*\n[\s\S]*?permissions:\s*\n\s+contents: read/);
  assert.match(workflow('publication-gate.yml'), /  publication-gate:\s*\n\s+needs: \[classify, content-check\]\s*\n\s+if: always\(\) &&/);
  const reserve = workflow('publication-auto-merge.yml');
  assert.match(reserve, /Repository auto-merge is not enabled; no reservation made\.[\s\S]*?exit 0/);
  assert.match(reserve, /node scripts\/publication-pr-policy\.mjs ruleset-ready/);
});

test('only the established press content paths qualify', () => {
  const paths = [
    'press/archive.json',
    'press/index.html',
    'press/2026-09-29-private-rail-forum-followup/index.html',
    'press/2026-09-29-private-rail-forum-followup/배포.hwp',
  ];
  assert.deepEqual(classifyPublicationPaths(paths), { publication: true, outside: [] });
});

test('test, CSS, script, unrelated and malformed paths all block publication classification', () => {
  const outside = [
    'tests/app-e2e/web1-press.spec.mjs',
    'press/press-archive.css',
    'press/2026-09-29-article/script.js',
    'press/statement-checklist/index.html',
    'press/2026-09-29-article/../script.js',
    'app/index.html',
    '.github/workflows/publication-gate.yml',
    '.github/CODEOWNERS',
  ];
  assert.deepEqual(classifyPublicationPaths(['press/archive.json', ...outside]), {
    publication: false,
    outside,
  });
  assert.equal(classifyPublicationPaths([]).publication, false);
});

test('every sampled .github path blocks automatic publication merge even beside allowed content', () => {
  for (const path of ['.github/workflows/publication-gate.yml', '.github/workflows/new.yml', '.github/actions/check/action.yml', '.github/CODEOWNERS']) {
    assert.equal(classifyPublicationPaths(['press/archive.json', path]).publication, false, path);
  }
});

test('automatic merge is limited to owner-authored branches in this repository', () => {
  const owner = {
    user: { login: 'mj880616' },
    head: { repo: { full_name: 'mj880616/work' } },
    base: { repo: { full_name: 'mj880616/work' }, ref: 'main' },
  };
  assert.equal(isTrustedPublicationAuthor(owner, 'mj880616/work'), true);
  assert.equal(isTrustedPublicationAuthor({ ...owner, user: { login: 'external' } }, 'mj880616/work'), false);
  assert.equal(isTrustedPublicationAuthor({ ...owner, head: { repo: { full_name: 'external/work' } } }, 'mj880616/work'), false);
});

test('API inventory fails closed when a page is missing or the head changed', async () => {
  const pr = {
    head: { sha: 'expected', repo: { full_name: 'mj880616/work' } },
    base: { ref: 'main', repo: { full_name: 'mj880616/work' } },
    user: { login: 'mj880616' },
    changed_files: 2,
  };
  const fakeFetch = async url => ({
    ok: true,
    json: async () => url.includes('/files?') ? [{ filename: 'press/archive.json' }] : pr,
  });
  await assert.rejects(readPullRequestSnapshot({ repository: 'mj880616/work', number: 7, expectedHead: 'expected', token: 'test', fetchImpl: fakeFetch }), /file count/);
  await assert.rejects(readPullRequestSnapshot({ repository: 'mj880616/work', number: 7, expectedHead: 'stale', token: 'test', fetchImpl: fakeFetch }), /head changed/);
});

test('renaming a file from outside press into an allowed press path is not publication-only', async () => {
  const pr = {
    head: { sha: 'expected' },
    changed_files: 1,
  };
  const fetchImpl = async url => ({
    ok: true,
    json: async () => url.includes('/files?')
      ? [{ filename: 'press/2026-09-30-example/file.pdf', previous_filename: 'docs/old.md', status: 'renamed' }]
      : pr,
  });
  const snapshot = await readPullRequestSnapshot({ repository: 'mj880616/work', number: 7, expectedHead: 'expected', token: 'test', fetchImpl });
  assert.deepEqual(classifyPublicationPaths(snapshot.paths), { publication: false, outside: ['docs/old.md'] });
});

test('publication waits for the existing cache and HTML audit checks and rejects a failure', async () => {
  const checkRuns = [
    { id: 10, name: 'loader-cache', status: 'completed', conclusion: 'success' },
    { id: 11, name: 'audit', status: 'completed', conclusion: 'failure' },
  ];
  await assert.rejects(verifyNecessaryChecks({
    repository: 'mj880616/work', head: 'abc', token: 'test', htmlChanged: true,
    maxAttempts: 1,
    fetchImpl: async () => ({ ok: true, json: async () => ({ check_runs: checkRuns }) }),
  }), /audit failed/);
  checkRuns[1].conclusion = 'success';
  await verifyNecessaryChecks({
    repository: 'mj880616/work', head: 'abc', token: 'test', htmlChanged: true,
    maxAttempts: 1,
    fetchImpl: async () => ({ ok: true, json: async () => ({ check_runs: checkRuns }) }),
  });
});
