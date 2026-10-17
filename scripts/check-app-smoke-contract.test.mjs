import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkAppSmokeContract } from './check-app-smoke-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = Object.fromEntries(readdirSync(join(root, 'app'), { withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => [`app/${entry.name}`, readFileSync(join(root, 'app', entry.name), 'utf8')]));
const run = changes => checkAppSmokeContract({ ...baseline, ...changes });
const change = (file, before, after) => {
  assert.ok(baseline[file].includes(before), `fixture marker exists: ${file}: ${before}`);
  return { [file]: baseline[file].replace(before, after) };
};
// The repository writes exact paths; the Pages build adds ?v= (CI-버전자동화 3단계).
const versioned = (file, name) => { assert.ok(baseline[file].includes(`./${name}`), `${file} references ${name}`); return `./${name}`; };

test('current operational tree satisfies the module and cache contracts', () => {
  assert.deepEqual(run({}).errors, []);
});
test('a hand-written ?v= on a checked reference fails; the build adds it', () => {
  assert.match(run(change('app/app.js', "'./loader-v2.js'", "'./loader-v2.js?v=1'")).errors.join('\n'), /app\.js.*loader-v2\.js.*without \?v=/);
});
test('missing app to loader import cannot be replaced by a comment', () => {
  const url = versioned('app/app.js', 'loader-v2.js');
  assert.match(run(change('app/app.js', `import('${url}')`, `Promise.resolve() /* import('${url}') */`)).errors.join('\n'), /app\.js.*loader-v2/);
});
test('missing loader to view-loader import cannot be replaced by arbitrary text', () => {
  const url = versioned('app/loader-v2.js', 'view-loader.js');
  assert.match(run(change('app/loader-v2.js', `import('${url}')`, `Promise.resolve('import("${url}")')`)).errors.join('\n'), /loader-v2.*view-loader/);
});
test('required READY must be the second argument of the same route module call', () => {
  assert.match(run(change('app/view-loader.js', "'__KPTU_CALENDAR_MONTH_VIEW_READY__'", "'WRONG_READY'")).errors.join('\n'), /calendar-month-view.*READY/);
});
test('correct READY elsewhere does not excuse the missing call argument', () => {
  const url = versioned('app/view-loader.js', 'calendar-month-view.js');
  assert.match(run(change('app/view-loader.js', `module('${url}','__KPTU_CALENDAR_MONTH_VIEW_READY__')`, `module('${url}'); const text='__KPTU_CALENDAR_MONTH_VIEW_READY__'`)).errors.join('\n'), /calendar-month-view.*READY/);
});
test('module moved into another route does not satisfy its owner', () => {
  const url = versioned('app/view-loader.js', 'web1-board.js');
  const source = baseline['app/view-loader.js'].replace(`await module('${url}');`, '').replace('async function home(){', `async function home(){ await module('${url}');`);
  assert.match(run({ 'app/view-loader.js': source }).errors.join('\n'), /pages.*web1-board/);
});
test('duplicate startup and route registration fail', () => {
  const url = versioned('app/app.js', 'loader-v2.js');
  assert.match(run({ 'app/app.js': baseline['app/app.js'] + `\nimport('${url}');` }).errors.join('\n'), /loader-v2.*1/);
  const board = versioned('app/view-loader.js', 'web1-board.js');
  assert.match(run(change('app/view-loader.js', `await module('${board}');`, `await module('${board}'); await module('${board}');`)).errors.join('\n'), /web1-board.*1/);
});
for (const invalid of ['?v=', '?v=1', '?v=2&v=3', '?v=2#fragment', '?other=2', '#fragment', '?v=0123abcdef']) {
  test(`module cache URL rejects ${JSON.stringify(invalid)}`, () => {
    const url = versioned('app/view-loader.js', 'web1-board.js');
    assert.match(run(change('app/view-loader.js', url, `./web1-board.js${invalid}`)).errors.join('\n'), /web1-board/);
  });
}
test('external URL cannot satisfy a local module requirement', () => {
  const url = versioned('app/view-loader.js', 'web1-board.js');
  assert.match(run(change('app/view-loader.js', url, `https://example.invalid/${url}`)).errors.join('\n'), /web1-board/);
});
test('missing module target fails even if its import remains', () => {
  const files = { ...baseline }; delete files['app/web1-board.js'];
  assert.match(checkAppSmokeContract(files).errors.join('\n'), /web1-board.*missing/);
});
test('loader preload must use the same exact path as the actual import', () => {
  const url = versioned('app/index.html', 'loader-v2.js');
  assert.match(run(change('app/index.html', `href="${url}"`, 'href="./loader-v2.js?v=999999"')).errors.join('\n'), /loader-v2.*exact local path/);
});
test('a duplicate preload cannot hide one stale version', () => {
  assert.match(run({ 'app/index.html': baseline['app/index.html'] + '<link rel="modulepreload" href="./loader-v2.js?v=999999">' }).errors.join('\n'), /loader-v2/);
});
test('app script must be an actual deferred resource, not a comment', () => {
  const url = versioned('app/index.html', 'app.js');
  const tag = `<script src="${url}" defer></script>`;
  assert.match(run(change('app/index.html', tag, `<!-- ${tag} -->`)).errors.join('\n'), /index\.html.*app\.js/);
  assert.match(run(change('app/index.html', tag, `<script src="${url}"></script>`)).errors.join('\n'), /app\.js.*defer/);
});
test('defer text in another attribute does not defer the script', () => {
  const url = versioned('app/index.html', 'app.js');
  assert.match(run(change('app/index.html', `<script src="${url}" defer>`, `<script src="${url}" data-note=" defer ">`)).errors.join('\n'), /app\.js.*defer/);
});
test('duplicate source attributes cannot mask the browser-selected URL', () => {
  const url = versioned('app/index.html', 'app.js');
  assert.match(run(change('app/index.html', `<script src="${url}" defer>`, `<script src="./other.js?v=1" src="${url}" defer>`)).errors.join('\n'), /duplicate.*src/);
});
test('script href does not replace the actual src attribute', () => {
  const url = versioned('app/index.html', 'app.js');
  assert.match(run(change('app/index.html', `<script src="${url}" defer>`, `<script href="${url}" defer>`)).errors.join('\n'), /index\.html.*app\.js/);
});
for (const attribute of ['type="application/json"', 'type="module"', 'nomodule', 'async']) {
  test(`app startup script rejects ${attribute}`, () => {
    const url = versioned('app/index.html', 'app.js');
    assert.match(run(change('app/index.html', `<script src="${url}" defer>`, `<script src="${url}" defer ${attribute}>`)).errors.join('\n'), /app\.js.*deferred classic/);
  });
}
test('link src does not replace the actual href attribute', () => {
  const url = versioned('app/index.html', 'critical.css');
  assert.match(run(change('app/index.html', `href="${url}"`, `src="${url}"`)).errors.join('\n'), /index\.html.*critical\.css/);
});
test('required stylesheet must belong to its route', () => {
  const url = versioned('app/view-loader.js', 'calendar-ui.css');
  assert.match(run(change('app/view-loader.js', `'${url}'`, "'./not-calendar-ui.css'")).errors.join('\n'), /calendar.*calendar-ui/);
});
test('CSS imports inside comments cannot satisfy required styles', () => {
  const url = versioned('app/styles.css', 'team.css');
  assert.match(run(change('app/styles.css', `@import url('${url}');`, `/* @import url('${url}'); */`)).errors.join('\n'), /styles\.css.*team/);
});
test('CSS and HTML preload references to the same asset must agree', () => {
  const url = versioned('app/styles.css', 'topbar-actions.css');
  assert.match(run(change('app/styles.css', `'${url}'`, "'./topbar-actions.css?v=999999'")).errors.join('\n'), /topbar-actions.*exact local path/);
});
test('manifest must be an actual manifest link with the exact path', () => {
  const url = versioned('app/index.html', 'windows-manifest.json');
  assert.match(run(change('app/index.html', `"${url}"`, '"./windows-manifest.json?v=8"')).errors.join('\n'), /windows-manifest/);
  assert.match(run(change('app/index.html', 'rel="manifest"', 'rel="other"')).errors.join('\n'), /windows-manifest/);
});
test('any global startup stylesheet version stays forbidden', () => {
  assert.match(run({ 'app/loader-v2.js': baseline['app/loader-v2.js'] + "\nimport('./styles.css?v=999999');" }).errors.join('\n'), /startup.*styles\.css/);
});
test('malformed JS throws rather than silently succeeding', () => {
  assert.throws(() => run({ 'app/app.js': 'const broken = ;' }), /Unexpected token/);
});
test('CLI reports contract failures and read/parse errors with distinct exit codes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'app-smoke-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'app'));
  for (const [name, source] of Object.entries(baseline)) writeFileSync(join(dir, name), source);
  const cli = fileURLToPath(new URL('./check-app-smoke-contract.mjs', import.meta.url));
  const invoke = () => spawnSync(process.execPath, [cli], { cwd: dir, encoding: 'utf8' });
  assert.equal(invoke().status, 0);
  writeFileSync(join(dir, 'app/app.js'), 'const noLoader=1;');
  assert.equal(invoke().status, 1);
  writeFileSync(join(dir, 'app/app.js'), 'const broken=;');
  assert.equal(invoke().status, 2);
  rmSync(join(dir, 'app/app.js'));
  assert.equal(invoke().status, 2);
});
