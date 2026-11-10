// OPS-작업속도: 일마다 걸린 시간 가운데 값과 멈춘 세션(PR 없이 30분) 계산.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {median, stageMinutes, summarize, stalledBranches, renderReport} from '../scripts/ops/work-timing.mjs';

test('median: 홀수·짝수·빈 목록', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([null, 5]), 5);
});

test('stageMinutes: 열림 → 시험 끝 → merge → 배포, 시험이 merge 뒤 끝난 것은 기다림에서 뺀다', () => {
  const row = stageMinutes({number: 1, created_at: '2026-11-10T10:00:00Z', e2e_done_at: '2026-11-10T10:15:00Z', merged_at: '2026-11-10T10:25:00Z', deploy_done_at: '2026-11-10T10:27:00Z'});
  assert.deepEqual(row, {number: 1, open_to_e2e: 15, e2e_to_merge: 10, open_to_merge: 25, merge_to_deploy: 2, open_to_deploy: 27});
  const late = stageMinutes({number: 2, created_at: '2026-11-10T10:00:00Z', e2e_done_at: '2026-11-10T10:30:00Z', merged_at: '2026-11-10T10:20:00Z', deploy_done_at: null});
  assert.equal(late.e2e_to_merge, null);
  assert.equal(late.open_to_deploy, null);
});

test('summarize + renderReport: 가운데·최대·표본 수', () => {
  const prs = [10, 20, 60].map((m, i) => ({number: i, created_at: '2026-11-10T10:00:00Z', e2e_done_at: null, merged_at: new Date(Date.parse('2026-11-10T10:00:00Z') + m * 60000).toISOString(), deploy_done_at: null}));
  const result = summarize(prs);
  assert.deepEqual(result.summary.open_to_merge, {median: 20, max: 60, n: 3});
  assert.equal(result.summary.open_to_e2e.n, 0);
  const text = renderReport(result, []);
  assert.match(text, /\| PR 열림 → merge \| 20분 \| 60분 \| 3 \|/);
  assert.match(text, /멈춘 세션 의심 없음/);
});

test('stalledBranches: PR 없는 브랜치 중 마지막 commit 뒤 30분~6시간만, 오래 멈춘 순', () => {
  const now = '2026-11-10T12:00:00Z';
  const branches = [
    {name: 'main', last_commit_at: '2026-11-10T10:00:00Z'},
    {name: 'has-pr', last_commit_at: '2026-11-10T10:00:00Z'},
    {name: 'fresh', last_commit_at: '2026-11-10T11:45:00Z'},
    {name: 'stuck-40', last_commit_at: '2026-11-10T11:20:00Z'},
    {name: 'stuck-90', last_commit_at: '2026-11-10T10:30:00Z'},
    {name: 'old', last_commit_at: '2026-11-09T12:00:00Z'},
  ];
  const out = stalledBranches(branches, new Set(['has-pr']), {now});
  assert.deepEqual(out.map(b => [b.name, b.idle_min]), [['stuck-90', 90], ['stuck-40', 40]]);
  assert.match(renderReport(summarize([]), out), /- stuck-90: 마지막 commit 뒤 90분/);
});
