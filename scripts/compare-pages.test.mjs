import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compareTrees, compareLive } from './compare-pages.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');

test('folder comparison lists files on one side only and files whose bytes differ', () => {
  const a = new Map([['index.html', '1'], ['a.css', '2'], ['README.md', '3']]);
  const b = new Map([['index.html', '1'], ['a.css', '9'], ['README.html', '4']]);
  assert.deepEqual(compareTrees(a, b), { onlyA: ['README.md'], onlyB: ['README.html'], changed: ['a.css'], same: 1 });
});

test('live comparison fetches each file under the base URL and reports missing or different bytes', async () => {
  const served = { 'https://pages.example/work/index.html': 'home', 'https://pages.example/work/app/a%20b.js': 'old' };
  const tree = new Map([['index.html', sha('home')], ['app/a b.js', sha('new')], ['gone.css', sha('x')]]);
  const seen = [];
  const result = await compareLive(tree, 'https://pages.example/work/', {
    fetchImpl: async (url, init) => {
      seen.push([String(url), init.redirect]);
      return Object.hasOwn(served, String(url)) ? new Response(served[String(url)]) : new Response('', { status: 404 });
    }
  });
  assert.deepEqual(result, { missing: ['gone.css (HTTP 404)'], changed: ['app/a b.js'], same: 1 });
  assert.ok(seen.every(([, redirect]) => redirect === 'manual'));
});
