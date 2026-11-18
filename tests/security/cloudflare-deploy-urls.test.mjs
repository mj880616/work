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
// DOMAIN-주소이전 ①-D1: bokdoong.com is the only Web2 host; desk and work redirect there.
const base = 'https://bokdoong.com/work/app/';
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
  for (const args of [[undefined], [fixture(t), ['extra']], [fixture(t), ['--host']], [fixture(t), ['--host', 'work.bokdoong.com']], [fixture(t), ['--host', 'desk.bokdoong.com']],
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
  assert.doesNotMatch(workflow, /https:\/\/(?:desk\.)?bokdoong\.com\/work\/app\/(?:app\.js|loader-v2\.js|pwa\.js|sw\.js|app-icon\.svg)\?v=[^\s'"$]+/);
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
    'https://*"|$expected_code"',
    'local expected_code="${2:-200}"',
    "check_icon 'https://bokdoong.com/favicon.png' 'image/png'",
    "check_icon 'https://bokdoong.com/favicon.ico' 'image/x-icon'",
  ]) assert.ok(workflow.includes(expected), `preserves ${expected}`);
});

// DOMAIN-주소이전 ①-D1: Web2 is on bokdoong.com only; `--host bokdoong.com` gives the same five URLs, desk is refused.
test('--host bokdoong.com gives the same five URLs as the default', t => {
  const result = run(fixture(t), ['--host', 'bokdoong.com']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\t'),
    refs.map(([, asset, version]) => `https://bokdoong.com/work/app/${asset}?v=${version}`));
});

test('workflow checks Web2 on bokdoong.com and the 302 moves from desk, work and the old portal root', () => {
  assert.doesNotMatch(workflow, /WEB2_[A-Z_]*URL|--host desk/);
  assert.ok(workflow.includes("check_200 'https://bokdoong.com/work/app/' 'text/html'"));
  assert.ok(workflow.includes('https://bokdoong.com/work/app/__missing-cache-probe__.js?v=$GITHUB_SHA'));
  assert.ok(!workflow.includes('https://desk.bokdoong.com/work/app/__missing-cache-probe__'));
  assert.ok(workflow.includes("--write-out '%{http_code}|%{redirect_url}'"));
  assert.ok(workflow.includes('local status="${3:-302}"'));
  assert.ok(workflow.includes('if [[ "$result" == "$status|$expected" ]]; then'));
  for (const [from, to] of [
    ['https://bokdoong.com/', 'https://bokdoong.com/work/app/'],
    ['https://desk.bokdoong.com/', 'https://bokdoong.com/work/app/'],
    ['https://desk.bokdoong.com/work/app/?view=library&drive=connected', 'https://bokdoong.com/work/app/?view=library&drive=connected'],
    ['https://desk.bokdoong.com/work/app/onedrive-return.html?probe=1', 'https://bokdoong.com/work/app/onedrive-return.html?probe=1'],
    ['https://work.bokdoong.com/work/app/?view=calendar', 'https://bokdoong.com/work/app/?view=calendar']
  ]) assert.ok(workflow.includes(`check_redirect '${from}' '${to}'`), from);
});

// DOMAIN-nojoplus 1단계: the deploy also checks the new address and its www 301.
test('workflow checks nojoplus.com on its own host and www.nojoplus.com with 301', () => {
  assert.ok(workflow.includes("check_redirect 'https://nojoplus.com/' 'https://nojoplus.com/work/app/'"));
  assert.ok(workflow.includes("check_redirect 'https://www.nojoplus.com/work/app/?view=calendar' 'https://nojoplus.com/work/app/?view=calendar' 301"));
  assert.ok(workflow.includes("check_200 'https://nojoplus.com/work/app/' 'text/html'"));
  assert.ok(workflow.includes("check_200 'https://nojoplus.com/work/about/' 'text/html'"));
});

// WEB1-페이지삭제 D1: work.bokdoong.com answers Web1 paths with the 410 one-line notice; share·about·favicon.svg stay 200.
test('workflow checks the Web1 closed notice on work and keeps the share and about pages', () => {
  assert.ok(workflow.includes('check_https_upgrade work.bokdoong.com 410'));
  assert.ok(workflow.includes('if [[ "$code" == "410" ]]'));
  assert.ok(workflow.includes("grep -q '더 이상 운영하지 않는 페이지입니다'"));
  for (const url of ['https://work.bokdoong.com/', 'https://work.bokdoong.com/work/', 'https://work.bokdoong.com/work/press/',
    'https://work.bokdoong.com/work/p/', 'https://work.bokdoong.com/work/private-rail/']) {
    assert.ok(workflow.includes(`            ${url} \\\n`) || workflow.includes(`            ${url}\n`), url);
  }
  assert.ok(workflow.includes('check_web1_closed "$url"'));
  for (const kept of ["check_200 'https://work.bokdoong.com/work/share/' 'text/html'",
    "check_200 'https://work.bokdoong.com/work/about/' 'text/html'",
    "check_200 'https://work.bokdoong.com/work/favicon.svg'",
    'https://work.bokdoong.com/work/share/share.css \\']) assert.ok(workflow.includes(kept), kept);
  // Web1 files are not used as deploy probes any more (they are removed in C1-b).
  assert.doesNotMatch(workflow, /work\/assets\/|mj880616\.github\.io\/work\/ \\/);
});
