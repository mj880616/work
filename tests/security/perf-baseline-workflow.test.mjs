// PERF-첫로딩 P1: 측정 workflow는 수동 실행·읽기 권한·비밀값 없음·결과로 막지 않음을 지킨다. 요약 계산(흩어짐 10%)도 본다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse, group, render } from '../../scripts/perf/summarize.mjs';

const source = readFileSync(new URL('../../.github/workflows/perf-baseline.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('perf baseline workflow is manual-only, read-only and secret-free', () => {
  assert.match(source, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(source, /pull_request|push:|schedule:|workflow_run|workflow_call/);
  assert.match(source, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(source, /write/);
  assert.doesNotMatch(source, /secrets\.|environment:|SUPABASE|CLOUDFLARE|production/i);
  assert.match(source, /persist-credentials: false/);
  for (const use of source.matchAll(/uses:\s*(\S+)/g)) if (!use[1].startsWith('./')) assert.match(use[1], /@[0-9a-f]{40}$/, use[1]);
  // 측정 단계는 실패해도 요약·올리기를 막지 않는다. 입력은 env로만 읽는다.
  assert.match(source, /- name: Measure\n        continue-on-error: true\n/);
  assert.deepEqual([...source.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map(m => m[1]), ['github.ref', 'inputs.rounds']);
});

test('summary groups rounds, takes the median and flags spread over 10%', () => {
  const text = [
    'PERF_SHELL {"round":"1","profile":"local","view":"login","shownMs":100,"jsFiles":15,"jsKB":66}',
    'PERF_SHELL {"round":"2","profile":"local","view":"login","shownMs":105,"jsFiles":15,"jsKB":66}',
    'PERF_SHELL {"round":"3","profile":"local","view":"login","shownMs":200,"jsFiles":15,"jsKB":66}',
    'noise PERF {"round":"1","profile":"phone","view":"home","ready":8000,"jsBeforeReady":194}',
    'PERF_SWITCH {broken',
  ].join('\n');
  const rows = parse(text);
  assert.equal(rows.shell.length, 3);
  assert.equal(rows.load.length, 1);
  assert.equal(rows.switch.length, 0);
  const [g] = group(rows.shell, r => r.profile, ['shownMs', 'jsFiles']);
  assert.equal(g.metrics.shownMs.median, 105);
  assert.ok(Math.abs(g.metrics.shownMs.spread - 100 / 105) < 1e-9);
  assert.equal(g.metrics.jsFiles.spread, 0);
  const { markdown, over } = render(rows);
  assert.equal(over.length, 1);
  assert.match(markdown, /105 \(100\/105\/200, ±95%\) ⚠/);
  // 시간 칸은 차이가 50ms 안이면 10%를 넘어도 한도 안이다(숫자 칸은 그대로 10%).
  const small = parse(['PERF_SWITCH {"profile":"local","step":1,"view":"tasks","shownMs":26,"newJsKB":100}', 'PERF_SWITCH {"profile":"local","step":1,"view":"tasks","shownMs":51,"newJsKB":120}'].join('\n'));
  const [s] = group(small.switch, r => r.view, ['shownMs', 'newJsKB']);
  assert.equal(s.metrics.shownMs.over, false);
  assert.equal(s.metrics.newJsKB.over, true);
});
