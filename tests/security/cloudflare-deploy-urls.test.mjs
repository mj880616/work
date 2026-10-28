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
// CI-버전자동화 3단계: the repository writes plain paths and the Pages build adds content hashes,
// so these fixtures stand in for a build output: the real app files with a ?v= added per asset.
const refs = [
  ['index.html', 'app.js', '0a1b2c3d4e'],
  ['app.js', 'loader-v2.js', '1b2c3d4e5f'],
  ['loader-v2.js', 'pwa.js', '2c3d4e5f60'],
  ['pwa.js', 'sw.js', '3d4e5f6071'],
  ['index.html', 'app-icon.svg', '4e5f607182'],
];
const base = 'https://desk.bokdoong.com/work/app/';
const built = (file, content) => {
  for (const [owner, asset, version] of refs) {
    if (file !== owner) continue;
    assert.ok(content.includes(`./${asset}`), `${owner} references ${asset}`);
    content = content.replace(new RegExp(`\\./${asset.replaceAll('.', '\\.')}(?=['"])`, 'g'), `./${asset}?v=${version}`);
  }
  return content;
};

function run(dir, extra = []) {
  return spawnSync(process.execPath, [script, ...(dir === undefined ? [] : [dir]), ...extra], { cwd: root, encoding: 'utf8' });
}

function fixture(t, change = (file, content) => content) {
  const dir = mkdtempSync(resolve(tmpdir(), 'cloudflare-urls-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(resolve(dir, 'app'));
  for (const file of sources) {
    const content = built(file, readFileSync(resolve(root, 'app', file), 'utf8'));
    const changed = change(file, content);
    if (changed !== null) writeFileSync(resolve(dir, 'app', file), changed);
  }
  return dir;
}

test('extracts all five exact URLs from a build output of the current release chain', t => {
  const result = run(fixture(t));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.trim().split('\t'), refs.map(([, asset, version]) => `${base}${asset}?v=${version}`));
});

test('the repository checkout itself has no ?v= and is refused, so it cannot stand in for the build', () => {
  const result = run(root);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /FAIL.*app\.js\?v=/);
});

test('the Pages tree is a required single argument', t => {
  for (const args of [[undefined], [fixture(t), ['extra']], [fixture(t), ['--host']], [fixture(t), ['--host', 'work.bokdoong.com']],
    [fixture(t), ['--host', 'evil.example']], [fixture(t), ['--host', 'bokdoong.com', 'extra']], ['--host', ['bokdoong.com']]]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
});

test('tracks other version spellings in their owning files', t => {
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
  assert.match(workflow, /asset_urls="\$\(node scripts\/cloudflare-check-urls\.mjs "\$PAGES_TREE"\)"/);
  assert.match(workflow, /PAGES_TREE: \$\{\{ steps\.pages\.outputs\.tree \}\}/);
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

// DOMAIN-주소이전 ①-E5: Web2 also opens on bokdoong.com, so the deploy checks the same five assets there.
test('--host bokdoong.com gives the same five URLs on bokdoong.com', t => {
  const result = run(fixture(t), ['--host', 'bokdoong.com']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\t'),
    refs.map(([, asset, version]) => `https://bokdoong.com/work/app/${asset}?v=${version}`));
  const desk = run(fixture(t), ['--host', 'desk.bokdoong.com']);
  assert.deepEqual(desk.stdout.trim().split('\t'), refs.map(([, asset, version]) => `${base}${asset}?v=${version}`));
});

test('workflow checks Web2 on bokdoong.com with the same rules as desk', () => {
  assert.match(workflow, /web2_urls="\$\(node scripts\/cloudflare-check-urls\.mjs "\$PAGES_TREE" --host bokdoong\.com\)"/);
  assert.match(workflow, /read -r WEB2_APP_URL WEB2_LOADER_URL WEB2_PWA_URL WEB2_SW_URL WEB2_APP_ICON_URL <<< "\$web2_urls"/);
  for (const name of ['WEB2_APP_URL', 'WEB2_LOADER_URL', 'WEB2_PWA_URL', 'WEB2_SW_URL', 'WEB2_APP_ICON_URL']) {
    assert.ok(workflow.includes(`check_200 "$${name}"`), `${name} has a 200 check`);
  }
  assert.ok(workflow.includes('"$WEB2_APP_URL" \\\n            "$WEB2_LOADER_URL" \\\n            "$WEB2_APP_ICON_URL"'), 'bokdoong.com immutable URL list');
  assert.ok(workflow.includes('"$WEB2_SW_URL" \\'), 'bokdoong.com service worker no-cache check');
  assert.ok(workflow.includes("check_200 'https://bokdoong.com/work/app/' 'text/html'"));
  assert.ok(workflow.includes('https://bokdoong.com/work/app/__missing-cache-probe__.js?v=$GITHUB_SHA'));
});
