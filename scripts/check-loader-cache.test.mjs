import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkSourceVersions } from './check-loader-cache.mjs';

// CI-버전자동화 3단계: the repository writes paths without ?v=; the Pages build adds hashes.
const baseline = {
  'app/index.html': '<link rel="modulepreload" href="./loader.js"><script src="./app.js"></script>',
  'app/app.js': "import('./loader.js');",
  'app/loader.js': "import('./views.js');",
  'app/views.js': "const routes={tasks:['./tasks.js','./tasks.css']};",
  'app/tasks.js': 'window.tasks=1;',
  'app/tasks.css': 'body{background:url(./bg.svg)}',
  'app/bg.svg': '<svg/>',
  'tests/fixture.html': '<script src="../app/tasks.js?v=1"></script>',
  'docs/readme.md': 'Documentation ./app.js?v=1',
  'index.html': '<link rel="icon" href="./icon.svg">',
  'icon.svg': '<svg>\n</svg>\n',
};
const run = (changes, base = baseline) => checkSourceVersions(base, { ...base, ...changes });

test('a tree without hand-written ?v= passes', () => {
  assert.deepEqual(run({}).errors, []);
});
test('a hand-written ?v= in HTML, JS or CSS names the file and the reference', () => {
  for (const [file, source, raw] of [
    ['app/index.html', '<script src="./app.js?v=2"></script>', './app.js?v=2'],
    ['app/views.js', "const routes={tasks:['./tasks.js?v=7','./tasks.css']};", './tasks.js?v=7'],
    ['app/tasks.css', 'body{background:url(./bg.svg?v=20261016-frame1)}', './bg.svg?v=20261016-frame1'],
    ['app/loader.js', "import('./views.js?x=1&v=3');", './views.js?x=1&v=3'],
  ]) {
    const { errors } = run({ [file]: source });
    assert.equal(errors.length, 1, file);
    assert.ok(errors[0].startsWith(`${file}: ${raw} — `), errors[0]);
  }
});
test('HTML &amp; spelling and Web1 /work/ URLs are checked', () => {
  const base = { 'p/index.html': '<script src="/work/app/tasks.js?x=1&amp;v=2"></script>', 'app/tasks.js': 'x();' };
  assert.match(checkSourceVersions(base, base).errors[0], /^p\/index\.html: \/work\/app\/tasks\.js\?x=1&v=2/);
});
test('files no page loads are checked too, so a retired module cannot carry a stale ?v=', () => {
  assert.match(run({ 'app/retired.js': "import('./tasks.js?v=2');" }).errors[0], /^app\/retired\.js/);
});
test('external URLs, files outside the repository, templates and vendored bundles may keep ?v=', () => {
  assert.deepEqual(run({
    'app/views.js': "import('https://cdn.example/app/tasks.js?v=1');const n=1;import(`./view-${n}.js?v=4`);",
    'index.html': '<link rel="icon" href="/favicon.ico?v=ad4b66941757"><script src="./lib/rhwp-0.8.7/index.js?v=1"></script>',
    'lib/rhwp-0.8.7/index.js': "import('./transport.js?v=1');",
    'lib/rhwp-0.8.7/transport.js': '',
  }).errors, []);
});
test('comments do not count as references', () => {
  assert.deepEqual(run({
    'app/views.js': "// import('./tasks.js?v=1');\n/* import('./tasks.js?v=2') */ const routes={};",
    'index.html': '<!-- <script src="app/tasks.js?v=1"></script> -->',
  }).errors, []);
});
for (const root of ['android-app', 'windows-app']) {
  test(`${root} tooling is not a deployed source`, () => {
    assert.deepEqual(run({ [`${root}/fixture.html`]: '<script src="../app/tasks.js?v=1"></script>' }).errors, []);
  });
  test(`${root}-public is not tooling and is checked`, () => {
    assert.match(run({ [`${root}-public/index.html`]: '<script src="../app/tasks.js?v=1"></script>' }).errors[0], /tasks\.js\?v=1/);
  });
}
test('removed dependency passes but a deleted file still referenced fails', () => {
  const base = { 'index.html': '<script src="./main.js"></script>', 'main.js': 'old();' };
  assert.deepEqual(checkSourceVersions(base, { 'index.html': '' }).errors, []);
  assert.match(checkSourceVersions(base, { 'index.html': base['index.html'] }).errors[0], /main\.js 파일을 삭제했지만 index\.html/);
});
test('CLI checks real Git revisions and the working tree, and fails for an invalid base', t => {
  const dir = mkdtempSync(join(tmpdir(), 'loader-cache-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Cache test');
  git('config', 'user.email', 'cache-test@example.invalid');
  for (const [file, source] of Object.entries(baseline)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), source);
  }
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  const cli = fileURLToPath(new URL('./check-loader-cache.mjs', import.meta.url));
  const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
  writeFileSync(join(dir, 'icon.svg'), '<svg>\r\n</svg>\r\n');
  assert.equal(invoke('--base', base).status, 0);
  writeFileSync(join(dir, 'app/views.js'), "const routes={tasks:['./tasks.js?v=2','./tasks.css']};");
  assert.equal(invoke('--base', base).status, 1);
  git('add', '.'); git('commit', '-qm', 'hand-written version');
  const result = invoke('--base', base, '--head', 'HEAD');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /app\/views\.js: \.\/tasks\.js\?v=2/);
  assert.equal(invoke('--base', 'missing-ref', '--head', 'HEAD').status, 2);
  writeFileSync(join(dir, 'app/views.js'), baseline['app/views.js']);
  assert.equal(invoke('--base', base).status, 0);
  git('add', '.'); git('commit', '-qm', 'path only');
  assert.equal(invoke('--base', base, '--head', 'HEAD').status, 0);
});
test('working-tree CLI follows a staged HTML rename', t => {
  const dir = mkdtempSync(join(tmpdir(), 'loader-cache-rename-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Cache test');
  git('config', 'user.email', 'cache-test@example.invalid');
  const html = '<p>Unchanged page content</p>\n'.repeat(30) + '<script src="./dep.js"></script>';
  writeFileSync(join(dir, 'old.html'), html);
  writeFileSync(join(dir, 'dep.js'), 'old();');
  git('add', '.'); git('commit', '-qm', 'base');
  git('mv', 'old.html', 'new.html');
  writeFileSync(join(dir, 'dep.js'), 'newer();');
  git('add', '.');
  const cli = fileURLToPath(new URL('./check-loader-cache.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--base', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(dir, 'new.html'), html.replace('./dep.js', './dep.js?v=2'));
  assert.equal(spawnSync(process.execPath, [cli, '--base', 'HEAD'], { cwd: dir, encoding: 'utf8' }).status, 1);
});
