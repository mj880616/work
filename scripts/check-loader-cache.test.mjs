import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCacheVersions } from './check-loader-cache.mjs';

const baseline = {
  'app/index.html': '<link rel="modulepreload" href="./loader.js?v=1"><script src="./app.js?v=1"></script>',
  'app/app.js': "import('./loader.js?v=1');",
  'app/loader.js': "import('./views.js?v=1');",
  'app/views.js': "const routes={tasks:['./tasks.js?v=1','./tasks.css?v=1']};",
  'app/tasks.js': 'window.tasks=1;',
  'app/tasks.css': 'body{color:black}',
  'app/inactive.js': 'window.inactive=1;',
  'tests/fixture.html': '<script src="../app/inactive.js?v=1"></script>',
  'docs/readme.md': 'Documentation',
  'index.html': '<link rel="icon" href="./icon.svg?v=1">',
  'icon.svg': '<svg>\n</svg>\n',
};
const run = (changes, base = baseline) => checkCacheVersions(base, { ...base, ...changes });
const bumpChain = {
  'app/index.html': baseline['app/index.html'].replaceAll('v=1', 'v=2'),
  'app/app.js': baseline['app/app.js'].replaceAll('v=1', 'v=2'),
  'app/loader.js': baseline['app/loader.js'].replaceAll('v=1', 'v=2'),
  'app/views.js': baseline['app/views.js'].replaceAll('v=1', 'v=2'),
};

test('changed loaded file with all parent versions bumped passes', () => {
  assert.deepEqual(run({ ...bumpChain, 'app/tasks.js': 'window.tasks=2;' }).errors, []);
});
test('changed loaded file without a bump names the file and version owner', () => {
  const result = run({ 'app/tasks.js': 'window.tasks=2;' });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /app\/tasks\.js.*app\/views\.js.*v=/);
});
test('leaf bump does not excuse an unchanged upper loader version', () => {
  const result = run({ 'app/tasks.js': 'window.tasks=2;', 'app/views.js': bumpChain['app/views.js'] });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /app\/views\.js.*app\/loader\.js/);
});
test('inactive files referenced only by test fixtures pass', () => {
  assert.deepEqual(run({ 'app/inactive.js': 'window.inactive=2;' }).errors, []);
});
test('documentation-only changes pass', () => {
  assert.deepEqual(run({ 'docs/readme.md': 'Updated documentation' }).errors, []);
});
test('every remaining reference must change, including duplicate preloads', () => {
  const result = run({ ...bumpChain, 'app/index.html': baseline['app/index.html'].replace('app.js?v=1', 'app.js?v=2') });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /app\/loader\.js.*app\/index\.html/);
});
test('Web1 root URLs and transitive script assignments are checked', () => {
  const base = {
    'index.html': '<script src="/work/assets/main.js?v=abc"></script>',
    'assets/main.js': "s.src='/work/assets/tools.js?v=date-1';",
    'assets/tools.js': 'old();',
  };
  assert.match(run({ 'assets/tools.js': 'newer();' }, base).errors[0], /assets\/tools\.js.*assets\/main\.js/);
  assert.deepEqual(run({
    'assets/tools.js': 'newer();',
    'assets/main.js': "s.src='/work/assets/tools.js?v=date-2';",
    'index.html': '<script src="/work/assets/main.js?v=def"></script>',
  }, base).errors, []);
});
test('CSS imports in login styles are checked through their parent', () => {
  const base = {
    'app/login/index.html': '<link rel="stylesheet" href="../styles.css?v=1">',
    'app/styles.css': '@import url(./tasks.css?v=1);',
    'app/tasks.css': 'body{color:black}',
  };
  assert.match(run({ 'app/tasks.css': 'body{color:red}' }, base).errors[0], /app\/tasks\.css.*app\/styles\.css/);
});
test('comments and external URL lookalikes do not activate local files', () => {
  const base = { ...baseline, 'app/views.js': `// import('./inactive.js?v=1');
    /* import('./inactive.js?v=2') */
    import('https://cdn.example/app/inactive.js?v=1');`,
    'index.html': '<!-- <script src="app/inactive.js?v=1"></script> -->',
  };
  assert.deepEqual(run({ 'app/inactive.js': 'newer();' }, base).errors, []);
});
test('removing v is not a cache bump and one stale duplicate still fails', () => {
  assert.match(run({ ...bumpChain, 'app/tasks.js': 'newer();', 'app/views.js': "import('./tasks.js');" }).errors[0], /tasks\.js/);
  assert.match(run({ ...bumpChain, 'app/tasks.js': 'newer();', 'app/views.js': "import('./tasks.js?v=2');import('./tasks.js?v=1');" }).errors[0], /tasks\.js/);
});
test('removed dependency passes but a deleted file still referenced fails', () => {
  const base = { 'index.html': '<script src="./main.js?v=1"></script>', 'main.js': 'old();' };
  assert.deepEqual(checkCacheVersions(base, { 'index.html': '' }).errors, []);
  assert.match(checkCacheVersions(base, { 'index.html': base['index.html'] }).errors[0], /main\.js/);
});
test('new files, unversioned references and line ending changes do not demand old versions', () => {
  const base = { 'index.html': '<script src="./main.js"></script>', 'main.js': 'old();\n' };
  assert.deepEqual(run({ 'main.js': 'newer();' }, base).errors, []);
  assert.deepEqual(run({ 'main.js': 'old();\r\n' }, base).errors, []);
  assert.deepEqual(run({ 'new.js': 'newer();', 'index.html': '<script src="./new.js?v=1"></script>' }, base).errors, []);
});
test('CLI compares real Git revisions, working tree, and fails for invalid base', t => {
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
  assert.equal(invoke('--base', base).status, 0, 'Windows checkout line endings must not report icon changes');
  writeFileSync(join(dir, 'app/tasks.js'), 'newer();');
  assert.equal(invoke('--base', base).status, 1);
  git('add', '.'); git('commit', '-qm', 'missing bump');
  const result = invoke('--base', base, '--head', 'HEAD');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /app\/tasks\.js.*app\/views\.js/);
  assert.equal(invoke('--base', 'missing-ref', '--head', 'HEAD').status, 2);
  for (const [file, source] of Object.entries(bumpChain)) writeFileSync(join(dir, file), source);
  assert.equal(invoke('--base', base).status, 0);
  git('add', '.'); git('commit', '-qm', 'complete bumps');
  assert.equal(invoke('--base', base, '--head', 'HEAD').status, 0);
});
