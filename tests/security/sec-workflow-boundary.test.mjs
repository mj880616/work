import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const workflowsDir = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
const workflow = name => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('workflow files contain no direct repository push path', () => {
  for (const name of readdirSync(workflowsDir).filter(name => /\.ya?ml$/.test(name))) {
    const source = workflow(name);
    assert.doesNotMatch(source, /\bgit\s+push\b|\bgit\s+commit\b|createCommit|createOrUpdateFileContents/, name);
    if (!['publication-auto-merge.yml', 'basket-pc-release.yml'].includes(name)) assert.doesNotMatch(source, /^\s+contents:\s*write\s*$/m, name);
  }
});

test('Basket PC release workflow only runs for approved basket-pc-v tags and keeps its write access to one job', () => {
  const source = workflow('basket-pc-release.yml');
  // trigger: only a tag push of the app's own tag pattern, nothing a pull request or a branch push could start
  assert.match(source, /^on:\n  push:\n    tags:\n      - 'basket-pc-v\*'\n\npermissions:/m);
  assert.doesNotMatch(source, /pull_request|workflow_dispatch|schedule:|branches:|workflow_run/);
  // default permission is read; write permissions exist only in the release job
  assert.match(source, /^permissions:\n  contents: read\n/m);
  const writes = source.match(/^\s+contents:\s*write\s*$/gm) ?? [];
  assert.equal(writes.length, 1);
  // the read-only verify job checks the tag shape and main before anyone is asked to approve; release depends on it
  assert.match(source, /^  verify:\n(?:(?!^  release:)[\s\S])*?^  release:\n    needs: verify\n/m);
  const verifyJob = source.slice(source.indexOf('\n  verify:\n'), source.indexOf('\n  release:\n'));
  assert.doesNotMatch(verifyJob, /environment:|permissions:|write/);
  assert.match(source, /^  release:\n[\s\S]*?^    permissions:\n      contents: write\n      id-token: write\n      attestations: write\n/m);
  // reviewer approval, tag check, main check
  assert.match(source, /^    environment: basket-pc-release$/m);
  assert.match(source, /\^basket-pc-v\[0-9\]\{1,4\}\\\.\[0-9\]\{1,4\}\\\.\[0-9\]\{1,4\}\$/);
  assert.match(source, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  // no secrets besides the run's own token, no production access, no repository push
  assert.doesNotMatch(source, /secrets\./);
  assert.doesNotMatch(source, /SUPABASE|CLOUDFLARE|production-edge/i);
  assert.equal([...source.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map(m => m[1]).join(','), 'github.token');
  // every action pinned to a commit, the packaging tool pinned to a version
  for (const use of source.matchAll(/uses:\s*(\S+)/g)) assert.match(use[1], /@[0-9a-f]{40}$/, use[1]);
  assert.match(source, /dotnet tool install vpk --version \d+\.\d+\.\d+ /);
  // installer id differs from the data folder name, and releases are created as draft first, never as "latest"
  assert.match(source, /PACK_ID: BasketDropApp$/m);
  assert.match(source, /gh release create[\s\S]*--verify-tag --draft --latest=false/);
  // a release made by hand with the tag is hidden (pre-release) while it is filled, a published one that already has files is refused
  assert.match(source, /gh release edit "\$TAG" --prerelease --latest=false\n\s+gh release upload "\$TAG" releases\/\*/);
  assert.match(source, /already has files\. Use a new version number/);
  assert.match(source, /gh release edit "\$TAG" --draft=false --prerelease=false --latest=false/);
  assert.match(source, /actions\/attest-build-provenance@/);
});

test('metadata synchronization only compares PR and manual run output', () => {
  const source = workflow('sync-public-page-meta.yml');
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /pull_request:[\s\S]*?branches: \[main\][\s\S]*?['"]p\/\*\*['"]/);
  assert.doesNotMatch(source, /schedule:|^  push:/m);
  assert.match(source, /permissions:\s*\n\s+contents: read/);
  assert.match(source, /node scripts\/generate-public-pages\.mjs --check/);
  assert.match(source, /git diff --exit-code -- p/);
  assert.match(source, /git status --porcelain -- p/);
});

const REQUIRED_CHECK_JOBS = { 'publication-gate.yml': 'publication-gate', 'web1-file-dropzone.yml': 'dropzone' };
const NO_EDITED = ['publication-gate.yml', 'web1-file-dropzone.yml', 'publication-auto-merge.yml', 'loader-cache-check.yml', 'browser-storage-audit.yml'];

const jobBlocks = source => {
  const jobs = source.slice(source.indexOf('\njobs:\n'));
  return Object.fromEntries([...jobs.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|(?![\s\S]))/gm)].map(match => [match[1], match[2]]));
};

test('publication and gate-input workflows do not listen to PR edits', () => {
  for (const name of NO_EDITED) {
    const source = workflow(name);
    assert.doesNotMatch(source, /\bedited\b|changes\.base|github\.event\.action/, name);
  }
  for (const name of ['publication-gate.yml', 'web1-file-dropzone.yml', 'publication-auto-merge.yml']) {
    assert.match(workflow(name), /^    types: \[opened, synchronize, reopened\]$/m, name);
  }
});

test('required check jobs have no event-based skip and come from one workflow each', () => {
  for (const [name, job] of Object.entries(REQUIRED_CHECK_JOBS)) {
    const source = workflow(name);
    assert.doesNotMatch(source, /^\s+(paths|paths-ignore|branches-ignore):/m, name);
    const block = jobBlocks(source)[job];
    assert.ok(block, `${name} defines ${job}`);
    const condition = block.match(/^    if: (.+)$/m)?.[1];
    if (job === 'publication-gate') assert.equal(condition, 'always()');
    else assert.equal(condition, undefined, `${job} must not be conditional`);
  }
  assert.match(workflow('publication-gate.yml'), /^  classify:\n    runs-on:/m);
  for (const name of readdirSync(workflowsDir).filter(name => /\.ya?ml$/.test(name))) {
    const declared = Object.keys(jobBlocks(workflow(name))).filter(job => Object.values(REQUIRED_CHECK_JOBS).includes(job));
    assert.deepEqual(declared, REQUIRED_CHECK_JOBS[name] ? [REQUIRED_CHECK_JOBS[name]] : [], name);
  }
});

test('checks awaited by the publication gate run on every main PR open, push and reopen', () => {
  const policy = readFileSync(new URL('../../scripts/publication-pr-policy.mjs', import.meta.url), 'utf8');
  assert.match(policy, /\['loader-cache', 'audit'\] : \['loader-cache'\]/);
  for (const [name, job] of [['loader-cache-check.yml', 'loader-cache'], ['browser-storage-audit.yml', 'audit']]) {
    const source = workflow(name);
    assert.match(source, /pull_request:\n    branches: \[main\]\n(?!    types:)/, name);
    assert.doesNotMatch(source, /pull_request_target/, name);
    assert.doesNotMatch(jobBlocks(source)[job], /^    if:/m, name);
  }
});

test('auto merge confirms the main ruleset by content and fails loudly when it is not ready', () => {
  const source = workflow('publication-auto-merge.yml');
  assert.doesNotMatch(source, /Main PR gate|\.name ==/);
  const step = source.match(/- name: Require a main ruleset[\s\S]*?(?=\n      - name:)/)?.[0] ?? '';
  assert.match(step, /if: steps\.classify\.outputs\.auto_eligible == 'true'/);
  assert.match(step, /run: node scripts\/publication-pr-policy\.mjs ruleset-ready/);
  assert.doesNotMatch(step, /continue-on-error|\|\| true|exit 0/);
  assert.ok(source.indexOf('ruleset-ready') < source.indexOf('--auto --merge'));
  assert.match(source, /reserve:[\s\S]*?Check out trusted base policy only[\s\S]*?ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  const required = JSON.parse(readFileSync(new URL('../../docs/main-pr-gate-ruleset.json', import.meta.url), 'utf8'))
    .rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks.map(check => check.context);
  assert.deepEqual(required, Object.values(REQUIRED_CHECK_JOBS));
});

test('auto merge only reserves on main PR open, push and reopen', () => {
  const source = workflow('publication-auto-merge.yml');
  assert.match(source, /pull_request_target:\n    branches: \[main\]\n    types: \[opened, synchronize, reopened\]/);
  assert.match(source, /group: publication-auto-merge-\$\{\{ github\.event\.pull_request\.number \}\}\n/);
  assert.match(source, /reserve:\n    if: github\.event\.pull_request\.base\.ref == 'main'\n/);
  assert.doesNotMatch(source, /cancel-departed-main/);
  assert.match(source, /Remove an old reservation when scope expands[\s\S]*?--disable-auto/);
  assert.match(source, /PR head or base changed; no reservation made/);
  assert.match(source, /--match-head-commit/);
});

test('Actions policy 6065 workflow paths keep their names', () => {
  const names = readdirSync(workflowsDir);
  assert.ok(names.includes('publication-gate.yml'));
  assert.ok(names.includes('publication-auto-merge.yml'));
});

test('auto merge publishes through the Actions Pages workflow, not the legacy Pages build API', () => {
  const source = workflow('publication-auto-merge.yml');
  const jobs = jobBlocks(source);
  assert.deepEqual(Object.keys(jobs), ['reserve', 'deploy-pages']);
  assert.doesNotMatch(source, /pages\/builds|pages:\s*write|build-pages/);
  // Only the reservation job may write contents; only the deploy job may dispatch workflows.
  assert.match(jobs.reserve, /permissions:\n      contents: write\n      pull-requests: write\n    outputs:/);
  assert.doesNotMatch(jobs.reserve, /actions:/);
  const deploy = jobs['deploy-pages'];
  assert.match(deploy, /permissions:\n      contents: read\n      pull-requests: read\n      actions: write\n    steps:/);
  assert.match(deploy, /^    needs: reserve\n    if: needs\.reserve\.outputs\.armed == 'true'\n/m);
  assert.ok(deploy.indexOf('Wait for this exact PR head to merge') < deploy.indexOf('/dispatches'));
  assert.match(deploy, /gh api -X POST "repos\/\$GITHUB_REPOSITORY\/actions\/workflows\/pages-deploy\.yml\/dispatches" -f ref=main\n/);
  assert.doesNotMatch(deploy, /skip_deploy|continue-on-error|\|\| true/);
  assert.match(deploy, /compare\/\$MERGE_SHA\.\.\.\$run_sha/);
  assert.match(deploy, /map\(\{\(\.name\): \.conclusion\}\) \| add \| \.deploy \/\/ empty/);
  assert.match(deploy, /"\$conclusion" == success && "\$deploy" == success/);
  const pages = workflow('pages-deploy.yml');
  assert.match(pages, /^  workflow_dispatch:\n/m);
  assert.match(pages, /^  deploy:\n/m);
});

test('browser-e2e reports on every main PR and decides from the change scope', () => {
  const source = workflow('app-e2e-check.yml');
  const on = source.slice(0, source.indexOf('\npermissions:'));
  const pullRequest = on.match(/^  pull_request:\n([\s\S]*?)(?=^  \S)/m)?.[1] ?? '';
  assert.match(pullRequest, /^    branches:\n      - main\n/);
  assert.doesNotMatch(pullRequest, /paths|types:/);
  assert.doesNotMatch(source, /pull_request_target|paths-ignore/);
  assert.match(on, /^  push:\n    branches:\n      - main\n    paths:\n/m);
  assert.match(on, /^  schedule:\n/m);
  assert.match(on, /^  workflow_dispatch:\n/m);

  const jobs = jobBlocks(source);
  assert.deepEqual(Object.keys(jobs), ['changes', 'browser-e2e-shard', 'browser-e2e']);
  const decide = jobs.changes;
  assert.doesNotMatch(decide, /^    if:/m);
  assert.match(decide, /if \[ "\$EVENT_NAME" != "pull_request" \]; then[\s\S]*?e2e=true/);
  assert.match(decide, /git diff --no-renames --name-only -z "\$BASE_SHA\.\.\.\$HEAD_SHA"/);
  assert.match(decide, /\^\(app\/\|p\/\|tests\/app-e2e\/\|\\\.github\/workflows\/app-e2e-check\\\.yml\$\)/);
  for (const use of decide.matchAll(/uses: (\S+)/g)) assert.match(use[1], /@[0-9a-f]{40}$/);
  assert.equal([...decide.matchAll(/uses: /g)].length, 1, 'only checkout');

  assert.match(jobs['browser-e2e-shard'], /^    needs: changes\n    if: needs\.changes\.outputs\.e2e == 'true'\n/m);

  const aggregate = jobs['browser-e2e'];
  assert.match(aggregate, /^    if: always\(\)\n    needs: \[changes, browser-e2e-shard\]\n/m);
  const order = ['"$CHANGES_RESULT" != "success"', '"$E2E_NEEDED" = "false"', '"$E2E_NEEDED" != "true"', 'test "$SHARD_RESULT" = "success"'];
  const positions = order.map(text => aggregate.indexOf(text));
  assert.ok(positions.every(position => position >= 0), 'aggregate checks decision, need and shard result');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.doesNotMatch(aggregate, /continue-on-error|\|\| true/);

  for (const name of readdirSync(workflowsDir).filter(name => /\.ya?ml$/.test(name))) {
    const declared = Object.keys(jobBlocks(workflow(name))).includes('browser-e2e');
    assert.equal(declared, name === 'app-e2e-check.yml', name);
    assert.doesNotMatch(workflow(name), /^    name: browser-e2e\s*$/m, name);
  }
});

// A tag push (for example basket-pc-v1.2.3) must start only the workflows meant for tags.
// `on.push` without branches, tags or tags-ignore also fires for every tag, so it is not allowed.
const pushBlock = source => {
  const on = source.match(/^on:\n((?:[ \t]+.*\n|[ \t]*\n|[ \t]*#.*\n)*)/m);
  if (!on) return null;
  const push = on[1].match(/^  push:[ \t]*\n((?:    .*\n|[ \t]*\n)*)/m);
  return push ? push[1] : null;
};

test('only the intended workflows start on a tag push', () => {
  const TAG_WORKFLOWS = ['basket-pc-release.yml'];
  const startsOnTag = [];
  for (const name of readdirSync(workflowsDir).filter(name => /\.ya?ml$/.test(name)).sort()) {
    const source = workflow(name);
    assert.doesNotMatch(source, /^on:[ \t]*\[?[^\n]*\bpush\b/m, `${name}: use the block form of on.push`);
    const push = pushBlock(source);
    if (push === null) continue;
    const hasTags = /^    tags:/m.test(push);
    const ignoresTags = /^    tags-ignore:\n      - '\*\*'\n/m.test(push);
    const hasBranches = /^    branches(:|-ignore:)/m.test(push);
    // a push filter with branches (and no tags) never matches a tag push
    if (hasTags || (!hasBranches && !ignoresTags)) startsOnTag.push(name);
  }
  assert.deepEqual(startsOnTag, TAG_WORKFLOWS);
});

test('workflows that ignore tag pushes still run on branch pushes', () => {
  for (const name of ['authz-security-check.yml', 'build-android-app.yml', 'package-pyhwp.yml', 'runtime-recovery-e2e.yml']) {
    const push = pushBlock(workflow(name));
    assert.match(push, /^    tags-ignore:\n      - '\*\*'\n    paths:/m, name);
    assert.doesNotMatch(push, /branches/, name);
  }
});
