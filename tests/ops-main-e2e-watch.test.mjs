// OPS-main깨짐감시(2026-11-27): main 전체 화면 시험이 깨지면 'main 시험 깨짐' 이슈로 바로 알린다(scripts/ops/main-e2e-watch.mjs).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {decide, failedSpecsFromLog, failureBody, greenBody, TITLE} from '../scripts/ops/main-e2e-watch.mjs';

const run = (over = {}) => ({id: 10, run_number: 7, head_branch: 'main', event: 'push', conclusion: 'failure', head_sha: 'abcdef1234567890', html_url: 'https://github.com/o/r/actions/runs/10', ...over});

test('결정: 가장 최근에 끝난 main 실행만 상태를 바꾼다', () => {
  assert.equal(decide({run: run(), latest: run(), openIssue: 0}), 'open');
  assert.equal(decide({run: run(), latest: run(), openIssue: 5}), 'comment');
  assert.equal(decide({run: run({conclusion: 'success'}), latest: run(), openIssue: 5}), 'close');
  assert.equal(decide({run: run({conclusion: 'success'}), latest: run(), openIssue: 0}), 'skip');
  // 밤 정기 실행도 main 상태다.
  assert.equal(decide({run: run({event: 'schedule'}), latest: run(), openIssue: 0}), 'open');
  // 늦게 끝난 옛 실행은 더 새 실행의 판정을 뒤집지 않는다.
  assert.equal(decide({run: run(), latest: run({id: 11, conclusion: 'success'}), openIssue: 0}), 'skip');
  // PR·다른 가지·취소는 건드리지 않는다.
  assert.equal(decide({run: run({event: 'pull_request'}), latest: run(), openIssue: 0}), 'skip');
  assert.equal(decide({run: run({head_branch: 'feature'}), latest: run(), openIssue: 0}), 'skip');
  assert.equal(decide({run: run({conclusion: 'cancelled'}), latest: run(), openIssue: 5}), 'skip');
});

test('로그: 끝 요약의 failed 아래 시험 파일:줄만, flaky는 뺀다', () => {
  const log = [
    '2026-11-27T02:20:25.8Z \x1b[1A\x1b[2K[278/278] [chromium] › tests/app-e2e/a.spec.mjs:5:1 › 제목',
    '2026-11-27T02:20:26.9Z \x1b[1A\x1b[2K  2 failed',
    '2026-11-27T02:20:26.9Z     [chromium] › tests/app-e2e/report-photo-row.spec.mjs:183:3 › 사진 제목',
    '2026-11-27T02:20:26.9Z     [chromium] › tests/app-e2e/b.spec.mjs:9:1 › 다른 제목',
    '2026-11-27T02:20:26.9Z   1 flaky',
    '2026-11-27T02:20:26.9Z     [chromium] › tests/app-e2e/c.spec.mjs:1:1 › 흔들림',
    '##[notice]  1 failed',
    '    [chromium] › tests/app-e2e/b.spec.mjs:9:1 › 다른 제목',
  ].join('\n');
  assert.deepEqual(failedSpecsFromLog(log), ['b.spec.mjs:9', 'report-photo-row.spec.mjs:183']);
  assert.deepEqual(failedSpecsFromLog('all passed'), []);
});

test('이슈 글: 실행 번호·SHA·시험 파일:줄만(시험 제목 없음)', () => {
  const body = failureBody({run: run(), specs: ['report-photo-row.spec.mjs:183']});
  assert.match(body, /#7/);
  assert.match(body, /abcdef123456/);
  assert.match(body, /`report-photo-row\.spec\.mjs:183`/);
  assert.doesNotMatch(body, /사진 제목/);
  assert.match(failureBody({run: run(), specs: []}), /읽지 못함/);
  assert.match(greenBody({run: run({conclusion: 'success'})}), /다시 통과/);
  assert.equal(TITLE, 'main 시험 깨짐');
});

test('main-e2e-watch.yml: App browser E2E check 끝남(main)만, 권한은 읽기 + issues: write뿐, 비밀값 없음, 고정 SHA', () => {
  const src = readFileSync(new URL('../.github/workflows/main-e2e-watch.yml', import.meta.url), 'utf8');
  const on = src.slice(src.indexOf('\non:\n'), src.indexOf('\npermissions:'));
  assert.match(on, /workflow_run:\n    workflows: \['App browser E2E check'\]\n    types: \[completed\]\n    branches: \[main\]/);
  assert.doesNotMatch(on, /pull_request|push:|schedule:/);
  assert.doesNotMatch(src, /secrets\./);
  const perms = [...src.matchAll(/^\s+(contents|actions|issues|pull-requests|id-token|checks|statuses|deployments|packages|pages):\s*(\w+)\s*$/gm)].map(m => `${m[1]}:${m[2]}`);
  assert.deepEqual(perms, ['contents:read', 'actions:read', 'issues:write']);
  for (const use of src.matchAll(/uses:\s*(\S+)/g)) assert.match(use[1], /@[0-9a-f]{40}$/, use[1]);
  // main 코드만 받는다(실행한 PR의 코드를 받지 않음), 받은 값은 환경 변수로만.
  assert.match(src, /ref: main\n/);
  assert.doesNotMatch(src, /workflow_run\.head_sha|head_commit/);
  assert.equal([...src.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map(m => m[1]).join(','), 'github.token,github.event.workflow_run.id || inputs.run_id');
  assert.match(src, /node scripts\/ops\/main-e2e-watch\.mjs --run "\$RUN_ID"/);
  // 'App browser E2E check'의 이름이 바뀌면 이 감시가 멈춘다 — 이름을 같이 본다.
  assert.match(readFileSync(new URL('../.github/workflows/app-e2e-check.yml', import.meta.url), 'utf8'), /^name: App browser E2E check$/m);
});
