import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// CI-버전자동화 2단계: the Pages deploy workflow must never deploy unchecked output, and must not
// change production while Settings → Pages → Source is still the branch deployment.
const read = name => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const source = read('pages-deploy.yml');
const job = name => source.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:\\n|(?![\\s\\S]))`, 'm'))?.[1] ?? '';

test('runs on main push and manual dispatch only, one release at a time', () => {
  assert.match(source, /^on:\n  push:\n    branches: \[main\]\n  workflow_dispatch:/m);
  assert.doesNotMatch(source, /pull_request/);
  assert.match(source, /concurrency:\n  group: pages-production\n  cancel-in-progress: false/);
  assert.match(source, /^permissions:\n  contents: read\n/m);
});

test('build checks the hashed output before uploading it', () => {
  const build = job('build');
  const order = [
    'actions/jekyll-build-pages@',
    'node scripts/build-pages.mjs _site "$RUNNER_TEMP/pages-out"',
    'node scripts/check-pages-build.mjs "$RUNNER_TEMP/pages-out"',
    'node scripts/cloudflare-check-urls.mjs "$RUNNER_TEMP/pages-out"',
    'actions/upload-pages-artifact@',
  ].map(text => build.indexOf(text));
  assert.ok(order.every(index => index >= 0), `${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(build, /continue-on-error|\|\| true/);
  assert.doesNotMatch(build, /pages: write|id-token/);
});

test('deploy runs only after build and only when Pages Source is GitHub Actions', () => {
  const deploy = job('deploy');
  assert.match(deploy, /^    needs: build$/m);
  assert.match(deploy, /^    if: needs\.build\.outputs\.build_type == 'workflow' && !\(github\.event_name == 'workflow_dispatch' && inputs\.skip_deploy\)$/m);
  assert.match(deploy, /permissions:\n      pages: write\n      id-token: write\n/);
  assert.match(deploy, /name: github-pages/);
  assert.match(deploy, /actions\/deploy-pages@[0-9a-f]{40} /);
  assert.match(job('build'), /gh api "repos\/\$GITHUB_REPOSITORY\/pages" --jq \.build_type/);
});

test('every action is pinned to a full commit SHA', () => {
  for (const name of ['pages-deploy.yml', 'cloudflare-worker-deploy.yml']) {
    for (const [, ref] of read(name).matchAll(/uses: [\w./-]+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/, name);
  }
});

test('Worker deploy accepts Pages from the branch files or this commit\'s build output, never a mix', () => {
  const worker = read('cloudflare-worker-deploy.yml');
  assert.match(worker, /node scripts\/build-pages\.mjs _site "\$RUNNER_TEMP\/pages-out"/);
  assert.match(worker, /node scripts\/check-pages-build\.mjs "\$RUNNER_TEMP\/pages-out"/);
  for (const file of ['index.html', 'app.js', 'loader-v2.js', 'app-icon.svg', 'pwa.js', 'windows-manifest.json', 'asset-manifest.json']) {
    assert.ok(worker.includes(`            app/${file}\n`), file);
  }
  assert.match(worker, /count_matches "\$RUNNER_TEMP\/pages-out"\) == \$\{#files\[@\]\}/);
  assert.match(worker, /count_matches "\$GITHUB_WORKSPACE"\) == \$\{#files\[@\]\}/);
  assert.ok(worker.indexOf('Wait for Web2 release on GitHub Pages') < worker.indexOf('- name: Deploy Worker'));
});
