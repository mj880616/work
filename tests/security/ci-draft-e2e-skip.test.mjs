// S54-01 CI-초안줄서기: 줄 뒤에 선 PR은 초안(draft)으로 두고, 초안일 때는 화면 시험(Playwright E2E) job만 건너뛴다.
// 초안을 풀면(ready_for_review) 다시 돌아 전체 검사가 된다. 빠른 검사(보안·lint·node 시험·build 등)는 초안이어도 돈다.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const workflowsDir = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
const workflow = name => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const workflowNames = readdirSync(workflowsDir).filter(name => /\.ya?ml$/.test(name)).sort();

const DRAFT = "github.event_name != 'pull_request' || github.event.pull_request.draft == false";
const TYPES = '    types: [opened, synchronize, reopened, ready_for_review]';

// 화면 시험 workflow와 초안이면 건너뛰는 job(job 이름은 바꾸지 않는다).
const E2E_JOBS = {
  'app-e2e-check.yml': ['browser-e2e-shard', 'startup-benchmark', 'browser-e2e'],
  'arsenal-archive-check.yml': ['archive'],
  'calendar-edit-move-e2e.yml': ['calendar-edit-move'],
  'profile-single-render-check.yml': ['browser'],
  'public-workspace-auth-e2e.yml': ['anonymous-auth-gate'],
  'router-ready-e2e.yml': ['router-ready'],
  'runtime-recovery-e2e.yml': ['runtime-recovery'],
  'suborganization-filters-e2e.yml': ['assigned-organizations'],
  'team-member-overview-e2e.yml': ['e2e'],
};
// 브라우저를 쓰지만 초안이어도 도는 PR 검사: Pages 빌드 검사(빌드 결과 확인이 주 목적인 한 job).
const KEEP_ON_DRAFT = { 'pages-build-check.yml': ['build-output'] };

const jobBlocks = source => {
  const jobs = source.slice(source.indexOf('\njobs:\n'));
  return Object.fromEntries([...jobs.matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|(?![\s\S]))/gm)].map(match => [match[1], match[2]]));
};
const onBlock = source => source.slice(0, source.indexOf('\njobs:\n'));
const pullRequestBlock = source => onBlock(source).match(/^  pull_request:\n([\s\S]*?)(?=^  \S|^\S|(?![\s\S]))/m)?.[1];
const usesBrowser = block => /setup-playwright|npx playwright/.test(block);
const jobIf = block => block.match(/^    if: (.+)$/m)?.[1];

test('every PR job that runs a browser is either skipped on draft or listed as kept on draft', () => {
  for (const name of workflowNames) {
    const source = workflow(name);
    if (pullRequestBlock(source) === undefined) continue;
    const browserJobs = Object.entries(jobBlocks(source)).filter(([, block]) => usesBrowser(block)).map(([job]) => job);
    const listed = [...(E2E_JOBS[name] ?? []).filter(job => usesBrowser(jobBlocks(source)[job] ?? '')), ...(KEEP_ON_DRAFT[name] ?? [])];
    assert.deepEqual(browserJobs.sort(), [...new Set(listed)].sort(), `${name}: 브라우저 job 목록`);
  }
});

test('E2E workflows listen to ready_for_review and skip their browser jobs on draft PRs', () => {
  for (const [name, jobs] of Object.entries(E2E_JOBS)) {
    const source = workflow(name);
    const pullRequest = pullRequestBlock(source);
    assert.ok(pullRequest !== undefined, `${name}: pull_request trigger`);
    assert.ok(pullRequest.split('\n').includes(TYPES), `${name}: pull_request types`);
    assert.doesNotMatch(source, /pull_request_target/, name);
    const blocks = jobBlocks(source);
    for (const job of jobs) {
      assert.ok(blocks[job], `${name} keeps job ${job}`);
      const condition = jobIf(blocks[job]);
      assert.ok(condition, `${name}/${job} has a job condition`);
      assert.ok(condition === DRAFT || condition.endsWith(` && (${DRAFT})`), `${name}/${job}: ${condition}`);
    }
    // 같은 PR의 옛 실행 취소 설정은 그대로 둔다.
    assert.match(source, /^concurrency:\n  group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: /m, name);
  }
});

test('app-e2e-check still decides on draft PRs and only skips the shards and the aggregate', () => {
  const blocks = jobBlocks(workflow('app-e2e-check.yml'));
  assert.deepEqual(Object.keys(blocks), ['changes', 'browser-e2e-shard', 'startup-benchmark', 'browser-e2e']);
  assert.equal(jobIf(blocks.changes), undefined);
  assert.equal(jobIf(blocks['browser-e2e-shard']), `needs.changes.outputs.e2e == 'true' && (${DRAFT})`);
  // OPS-작업속도: 시작 시간 측정은 shard 1에서 떼어 따로 돌지만, 판정 job이 결과를 함께 본다.
  assert.equal(jobIf(blocks['startup-benchmark']), `needs.changes.outputs.e2e == 'true' && (${DRAFT})`);
  assert.match(blocks['browser-e2e'], /needs: \[changes, browser-e2e-shard, startup-benchmark\]/);
  assert.match(blocks['browser-e2e'], /test "\$BENCHMARK_RESULT" = "success"/);
  assert.equal(jobIf(blocks['browser-e2e']), `always() && (${DRAFT})`);
});

test('fast checks are not skipped on draft PRs', () => {
  for (const name of workflowNames) {
    const source = workflow(name);
    const skippedJobs = E2E_JOBS[name] ?? [];
    for (const [job, block] of Object.entries(jobBlocks(source))) {
      if (skippedJobs.includes(job)) continue;
      assert.doesNotMatch(block, /pull_request\.draft/, `${name}/${job} must run on draft PRs`);
    }
    if (!E2E_JOBS[name]) assert.doesNotMatch(onBlock(source), /ready_for_review/, `${name}: only E2E workflows add ready_for_review`);
  }
  assert.equal(jobIf(jobBlocks(workflow('profile-single-render-check.yml')).structure), undefined);
});
