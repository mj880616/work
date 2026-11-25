// QA-멈춘일자동점검(S70-50): 실행 로그·main 대조로 (a) apply 기록 없는 migration (b) 배포 뒤 바뀐 Edge 함수 (c) 7일 넘게 멈춘 열린 PR.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {
  parseDbLog, parseEdgeLog, appliedVersions, pendingMigrations, lastDeploys,
  functionSources, changedFunctions, stalePrs, alertItems, shouldNotify, renderReport,
} from '../scripts/ops/stalled-scan.mjs';

const NOW = '2026-11-25T00:00:00Z';

test('parseDbLog: 시각 머리가 붙은 env 줄에서 첫 DB_MODE·DB_VERSION(14자리로)', () => {
  const log = [
    '2026-11-25T05:57:03.7844706Z ##[group]Run node scripts/ops/db-workflow.mjs plan',
    '2026-11-25T05:57:03.7844706Z   DB_MODE: apply',
    '2026-11-25T05:57:03.7845611Z   DB_VERSION: 20261125120000_todo_tg_auto_done.sql',
    '2026-11-25T05:57:16.1815545Z   DB_MODE: dry-run',
  ].join('\n');
  assert.deepEqual(parseDbLog(log), {mode: 'apply', version: '20261125120000'});
  assert.deepEqual(parseDbLog('   DB_MODE: check\n  DB_VERSION: \n'), {mode: 'check', version: null});
  assert.deepEqual(parseDbLog('  DB_MODE: apply\n  DB_VERSION: 20261101010000\n'), {mode: 'apply', version: '20261101010000'});
});

test('parseEdgeLog: FUNCTION_NAME과 checkout이 꺼낸 커밋(git log -1 --format=%H 다음 줄)', () => {
  const sha = 'a316475a920438dfbdb9e376af6635e9aaaef61e';
  const log = [
    '2026-11-25T09:09:38.7962329Z   ref: main',
    '2026-11-25T09:09:38.7973181Z   FUNCTION_NAME: news-feed',
    '2026-11-25T09:09:56.7202392Z HEAD is now at a316475a9 무언가',
    '2026-11-25T09:09:56.7293249Z [command]/usr/bin/git log -1 --format=%H',
    `2026-11-25T09:09:56.7315071Z ${sha}`,
  ].join('\n');
  assert.deepEqual(parseEdgeLog(log), {fn: 'news-feed', sha});
  assert.deepEqual(parseEdgeLog('  FUNCTION_NAME: x\n'), {fn: 'x', sha: null});
});

// 가짜 실행 목록: 성공한 apply만 '적용'으로 센다. dry-run·실패·check는 세지 않는다.
const dbRuns = [
  {id: 1, conclusion: 'success', mode: 'dry-run', version: '20261101000000'},
  {id: 2, conclusion: 'failure', mode: 'apply', version: '20261101000000'},
  {id: 3, conclusion: 'success', mode: 'apply', version: '20261102000000'},
  {id: 4, conclusion: 'success', mode: 'check', version: null},
  {id: 5, conclusion: 'cancelled', mode: 'apply', version: '20261103000000'},
];

test('(a) appliedVersions + pendingMigrations: apply 성공 기록 없는 파일만, 옛 파일·제외 목록은 빼고, 하루 안 된 것은 표시', () => {
  const applied = appliedVersions(dbRuns);
  assert.deepEqual([...applied], ['20261102000000']);
  const files = [
    {name: '20261001000000_old.sql', version: '20261001000000', added_at: '2026-10-01T00:00:00Z'},
    {name: '20261101000000_dry_only.sql', version: '20261101000000', added_at: '2026-11-01T00:00:00Z'},
    {name: '20261102000000_done.sql', version: '20261102000000', added_at: '2026-11-02T00:00:00Z'},
    {name: '20261103000000_cancelled.sql', version: '20261103000000', added_at: '2026-11-03T00:00:00Z'},
    {name: '20261104000000_skip.sql', version: '20261104000000', added_at: '2026-11-04T00:00:00Z'},
    {name: '20261124230000_new.sql', version: '20261124230000', added_at: '2026-11-24T12:00:00Z'},
  ];
  const out = pendingMigrations(files, applied, {ignore: {'20261104000000': '적용 안 함(대체)'}, now: NOW});
  assert.deepEqual(out.map(m => [m.name, m.days, m.fresh]), [
    ['20261101000000_dry_only.sql', 24, false],
    ['20261103000000_cancelled.sql', 22, false],
    ['20261124230000_new.sql', 0, true],
  ]);
});

test('functionSources: 함수 폴더 + 상대 import로 닿는 _shared(이어지는 것까지), 다른 함수는 안 섞음', () => {
  const files = new Map([
    ['supabase/functions/a/index.ts', "import {x} from '../_shared/x.ts';\nimport './local.ts';"],
    ['supabase/functions/a/local.ts', "export const l = await import('../_shared/y.mjs');"],
    ['supabase/functions/_shared/x.ts', "export * from './z.ts';"],
    ['supabase/functions/_shared/y.mjs', 'export const y = 1;'],
    ['supabase/functions/_shared/z.ts', "import 'jsr:@std/x';"],
    ['supabase/functions/_shared/unused.ts', ''],
    ['supabase/functions/b/index.ts', "import '../_shared/unused.ts';"],
  ]);
  assert.deepEqual(functionSources('a', files), [
    'supabase/functions/_shared/x.ts', 'supabase/functions/_shared/y.mjs', 'supabase/functions/_shared/z.ts',
    'supabase/functions/a/index.ts', 'supabase/functions/a/local.ts',
  ]);
});

test('(b) lastDeploys + changedFunctions: 마지막 성공 배포(되돌리기 포함) 뒤 바뀐 함수, 기록 없음·ref 모름은 따로', () => {
  const edgeRuns = [
    {id: 10, conclusion: 'success', created_at: '2026-11-20T00:00:00Z', fn: 'a', sha: 'a'.repeat(40)},
    {id: 11, conclusion: 'success', created_at: '2026-11-22T00:00:00Z', fn: 'a', sha: 'b'.repeat(40)},
    {id: 12, conclusion: 'failure', created_at: '2026-11-23T00:00:00Z', fn: 'a', sha: 'c'.repeat(40)},
    {id: 13, conclusion: 'success', created_at: '2026-11-21T00:00:00Z', fn: 'b', sha: 'd'.repeat(40)},
    {id: 14, conclusion: 'success', created_at: '2026-11-21T00:00:00Z', fn: 'gone', sha: 'e'.repeat(40)},
    {id: 15, conclusion: 'success', created_at: '2026-11-21T00:00:00Z', fn: 'fresh', sha: 'f'.repeat(40)},
  ];
  const deploys = lastDeploys(edgeRuns);
  assert.equal(deploys.get('a').sha, 'b'.repeat(40));
  const diffs = {
    ['b'.repeat(40)]: {changed: ['supabase/functions/_shared/x.ts'], first_at: '2026-11-23T00:00:00Z'},
    ['d'.repeat(40)]: {changed: []},
    ['e'.repeat(40)]: null,
    ['f'.repeat(40)]: {changed: ['supabase/functions/fresh/index.ts'], first_at: '2026-11-24T18:00:00Z'},
  };
  const result = changedFunctions(['b', 'a', 'gone', 'never', 'fresh', 'skip'], deploys, () => [], sha => diffs[sha], {ignore: {skip: '운영에서 지움'}, now: NOW});
  assert.deepEqual(result.changed.map(f => [f.fn, f.files, f.shared, f.days, f.fresh]), [['a', 1, true, 2, false], ['fresh', 1, false, 0, true]]);
  assert.deepEqual(result.never, [{fn: 'never'}]);
  assert.deepEqual(result.unknown.map(f => f.fn), ['gone']);
});

test('(c) stalePrs: 마지막 커밋 뒤 7일 넘은 열린 PR만, 오래된 순', () => {
  const prs = [
    {number: 1, draft: false, last_commit_at: '2026-11-24T00:00:00Z'},
    {number: 2, draft: true, last_commit_at: '2026-11-10T00:00:00Z'},
    {number: 3, draft: false, last_commit_at: '2026-11-18T00:00:00Z'},
    {number: 4, draft: false, last_commit_at: '2026-11-19T00:00:00Z'},
  ];
  assert.deepEqual(stalePrs(prs, NOW), [{number: 2, draft: true, days: 15}, {number: 3, draft: false, days: 7}]);
});

test('alertItems + renderReport: 하루 안 된 것은 알림에서 빼고, 로그를 다 못 읽었으면 (a)(b)는 판정 보류', () => {
  const base = {
    now: NOW, main: '0123456789abcdef', prDays: 7, counts: {db: 3, edge: 2}, backlog: 0,
    migrations: [{name: '20261101000000_x.sql', version: '20261101000000', days: 24, fresh: false}, {name: '20261124230000_y.sql', version: '20261124230000', days: 0, fresh: true}],
    edge: {changed: [{fn: 'a', sha: 'b'.repeat(40), files: 1, shared: true, days: 2, fresh: false}], never: [{fn: 'old'}], unknown: []},
    prs: [{number: 2, draft: false, days: 15}],
  };
  assert.deepEqual(alertItems(base), ['migration 20261101000000_x.sql', 'edge a', 'PR #2']);
  assert.deepEqual(alertItems({...base, backlog: 5}), ['PR #2']);
  const text = renderReport(base);
  assert.match(text, /\(a\) apply 성공 기록이 없는 migration: 2개/);
  assert.match(text, /\| `20261124230000_y.sql` \| 0일 \| 하루 안 됨\(알림 안 함\) \|/);
  assert.match(text, /\| `a` \| `bbbbbbbb` \| 1 \| 포함 \| 2일 \|/);
  assert.match(text, /workflow 배포 기록이 없는 함수: `old`/);
  assert.match(text, /#2\(15일\)/);
  assert.match(renderReport({...base, backlog: 5}), /아직 읽지 못한 실행 로그 5개/);
});

test('shouldNotify: 항목이 없으면 안 알림, 바뀌었거나 7일 지났을 때만 다시 알림', () => {
  assert.equal(shouldNotify([], null, NOW), false);
  assert.equal(shouldNotify(['PR #2'], null, NOW), true);
  assert.equal(shouldNotify(['PR #2'], {alerts: ['PR #2'], at: '2026-11-24T00:00:00Z'}, NOW), false);
  assert.equal(shouldNotify(['PR #2', 'edge a'], {alerts: ['PR #2'], at: '2026-11-24T00:00:00Z'}, NOW), true);
  assert.equal(shouldNotify(['PR #2'], {alerts: ['PR #2'], at: '2026-11-18T00:00:00Z'}, NOW), true);
});

test('stalled-scan.yml: 매일 KST 07:10 + 수동, 권한은 읽기 + issues: write뿐, 비밀값 없음, 고정 SHA', () => {
  const src = readFileSync(new URL('../.github/workflows/stalled-scan.yml', import.meta.url), 'utf8');
  assert.match(src, /cron: '10 22 \* \* \*'/);
  assert.match(src, /workflow_dispatch:/);
  const on = src.slice(src.indexOf('\non:\n'), src.indexOf('\npermissions:'));
  assert.doesNotMatch(on, /pull_request|push:|workflow_run/);
  assert.doesNotMatch(src, /secrets\./);
  const perms = [...src.matchAll(/^\s+(contents|actions|issues|pull-requests|id-token|checks|statuses|deployments|packages|pages):\s*(\w+)\s*$/gm)].map(m => `${m[1]}:${m[2]}`);
  assert.deepEqual(perms.filter(p => p.endsWith(':write')), ['issues:write']);
  for (const use of src.matchAll(/uses:\s*(\S+)/g)) assert.match(use[1], /@[0-9a-f]{40}$/, use[1]);
  assert.match(src, /node scripts\/ops\/stalled-scan\.mjs/);
  assert.match(src, /CC 멈춘 일 자동 점검/);
});
