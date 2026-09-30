import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyPublicationPaths,
  isTrustedPublicationAuthor,
  readPullRequestSnapshot,
  verifyNecessaryChecks,
} from './publication-pr-policy.mjs';

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
  ];
  assert.deepEqual(classifyPublicationPaths(['press/archive.json', ...outside]), {
    publication: false,
    outside,
  });
  assert.equal(classifyPublicationPaths([]).publication, false);
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
