import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { buildPages } from './build-pages.mjs';
import { checkBuild } from './check-pages-build.mjs';

// The repository as it is now (numbered ?v=) is a valid build input; the output is not deployed.
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const source = /\.(?:html|js|mjs|css)$/i;
const input = Object.fromEntries(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(file => file && existsSync(`${root}/${file}`))
  // Git and GitHub Pages hold LF; a Windows checkout may hold CRLF.
  .map(file => [file, source.test(file) ? readFileSync(`${root}/${file}`, 'utf8').replace(/\r\n/g, '\n') : readFileSync(`${root}/${file}`)]));

test('the repository builds into hashed references, a matching manifest and Worker-pinnable assets', async () => {
  const output = buildPages(input);
  const result = await checkBuild(output);
  assert.deepEqual(result.errors, []);
  assert.ok(result.references > 300 && result.assets > 100 && result.workerChecked > 100, JSON.stringify(result));
  assert.match(output['app/index.html'], /<script src="\.\/app\.js\?v=[0-9a-f]{10}" defer><\/script>/);
  // A hash may happen to be all digits, so compare with the repository's own number instead.
  const number = input['app/app.js'].match(/loader-v2\.js\?v=([^'"]+)/)[1];
  assert.ok(!output['app/app.js'].includes(`loader-v2.js?v=${number}'`), number);
});

test('the build is deterministic for the same repository input', () => {
  assert.deepEqual(buildPages(input), buildPages(input));
});

test('an unbuilt tree fails the hash check, so the check cannot pass by accident', async () => {
  const { errors } = await checkBuild(input);
  assert.ok(errors.some(error => error.startsWith('(a) app/index.html: ./app.js?v=')), errors.slice(0, 3).join('\n'));
});
