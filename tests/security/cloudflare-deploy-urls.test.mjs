import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const script = resolve(root, 'scripts/cloudflare-check-urls.mjs');
const workflow = readFileSync(resolve(root, '.github/workflows/cloudflare-worker-deploy.yml'), 'utf8');
const sources = ['index.html', 'app.js', 'loader-v2.js', 'pwa.js'];
const refs = [
  ['index.html', 'app.js'],
  ['app.js', 'loader-v2.js'],
  ['loader-v2.js', 'pwa.js'],
  ['pwa.js', 'sw.js'],
  ['index.html', 'app-icon.svg'],
].map(([owner, asset]) => {
  // Compute exact expectations independently from the source, so future app
  // releases do not require editing a second set of version numbers here.
  const content = readFileSync(resolve(root, 'app', owner), 'utf8');
  const start = content.indexOf(`./${asset}?v=`);
  assert.ok(start >= 0, `${owner} references ${asset}`);
  const version = content.slice(start + `./${asset}?v=`.length).match(/^[A-Za-z0-9._-]+/);
  assert.ok(version, `${asset} has a nonempty version`);
  return [owner, asset, version[0]];
});
const base = 'https://desk.bokdoong.com/work/app/';

function run(cwd = root) {
  return spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
}

function fixture(t, change) {
  const dir = mkdtempSync(resolve(tmpdir(), 'cloudflare-urls-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(resolve(dir, 'app'));
  for (const file of sources) {
    const content = readFileSync(resolve(root, 'app', file), 'utf8');
    const changed = change(file, content);
    if (changed !== null) writeFileSync(resolve(dir, 'app', file), changed);
  }
  return dir;
}

test('extracts all five exact URLs from the current repository reference chain', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.trim().split('\t'), refs.map(([, asset, version]) => `${base}${asset}?v=${version}`));
});

test('tracks future versions in their owning files, including nonnumeric icon versions', t => {
  const dir = fixture(t, (file, content) => {
    for (const [owner, asset, version] of refs) {
      if (file === owner) content = content.replaceAll(`${asset}?v=${version}`, `${asset}?v=next-release_9`);
    }
    return content;
  });
  const result = run(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\t'), refs.map(([, asset]) => `${base}${asset}?v=next-release_9`));
});

for (const file of sources) {
  test(`fails loudly with no partial output when app/${file} cannot be read`, t => {
    const result = run(fixture(t, (name, content) => name === file ? null : content));
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /FAIL/);
    assert.ok(result.stderr.includes(`app/${file}`));
  });
}

for (const [owner, asset, version] of refs) {
  for (const replacement of [`${asset}`, `${asset}?v=`, `${asset}?v=bad&value`]) {
    test(`fails loudly for ${owner}: ${replacement}`, t => {
      const result = run(fixture(t, (file, content) => file === owner
        ? content.replaceAll(`${asset}?v=${version}`, replacement) : content));
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /FAIL/);
      assert.ok(result.stderr.includes(asset));
    });
  }
}

test('rejects conflicting repeated icon references instead of picking a stale version', t => {
  const result = run(fixture(t, (file, content) => file === 'index.html'
    ? content.replace(`app-icon.svg?v=${refs[4][2]}`, 'app-icon.svg?v=conflicting') : content));
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /FAIL.*app-icon\.svg/);
});

test('gets sw.js only from the service worker registration URL', t => {
  const result = run(fixture(t, (file, content) => file === 'pwa.js'
    ? content.replace(`register('./sw.js?v=${refs[3][2]}'`, "register('./other.js?v=unused'") + "\nconst unrelated='./sw.js?v=999';\n"
    : content));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL.*sw\.js/);
});

test('workflow consumes extracted URLs without fixed version addresses or a silent fallback', () => {
  assert.doesNotMatch(workflow, /https:\/\/desk\.bokdoong\.com\/work\/app\/(?:app\.js|loader-v2\.js|pwa\.js|sw\.js|app-icon\.svg)\?v=[^\s'"$]+/);
  assert.match(workflow, /asset_urls="\$\(node scripts\/cloudflare-check-urls\.mjs\)"/);
  assert.match(workflow, /read -r APP_URL LOADER_URL PWA_URL SW_URL APP_ICON_URL <<< "\$asset_urls"/);
  for (const name of ['APP_URL', 'LOADER_URL', 'PWA_URL', 'SW_URL', 'APP_ICON_URL']) {
    assert.ok(workflow.includes(`check_200 "$${name}"`), `${name} retains its 200 check`);
  }
  assert.ok(workflow.includes('"$APP_URL" \\\n            "$LOADER_URL" \\\n            "$APP_ICON_URL"'), 'immutable URL list retains all three assets');
  assert.ok(workflow.includes('"$SW_URL" \\'), 'service worker retains no-cache check');
  for (const expected of [
    'cache-control: public, max-age=31536000, immutable',
    'cache-control: no-cache, must-revalidate',
    '"$missing_code" != "404"',
    "https://*'|200'",
    "check_icon 'https://bokdoong.com/favicon.png' 'image/png'",
    "check_icon 'https://bokdoong.com/favicon.ico' 'image/x-icon'",
  ]) assert.ok(workflow.includes(expected), `preserves ${expected}`);
});
