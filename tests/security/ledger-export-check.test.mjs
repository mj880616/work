// AI-서버연동 S7-d: 매주 원장 내보내기 점검 스크립트·workflow. HTTP는 모의 응답만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runCheck, judge, CheckFailure, STATUS_URL, STALE_DAYS } from '../../scripts/ops/ledger-export-check.mjs';

const workflow = readFileSync(new URL('../../.github/workflows/ledger-export-check.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const script = readFileSync(new URL('../../scripts/ops/ledger-export-check.mjs', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-26T22:43:00Z');
const reply = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const ledger = over => ({ ok: true, checked_at: '2026-10-26T22:43:01.000Z', ledger: { state: 'found', last_success_at: '2026-10-21T00:00:00.000Z', last_failure_at: null, last_failure_code: null, ...over } });
const run = (fetcher, extra = {}) => runCheck({ secret: 's', fetcher, sleep: async () => {}, now: () => NOW, ...extra });

test('missing secret fails before any request', async () => {
  let n = 0;
  await assert.rejects(runCheck({ secret: ' ', fetcher: async () => { n++; } }), /비밀값 미등록/);
  assert.equal(n, 0);
});

test('reads ledger_status by GET with only the cron header; recent success passes', async () => {
  const seen = [];
  const at = await run(async (url, init) => { seen.push({ url, init }); return reply(200, ledger())(); });
  assert.equal(at, '2026-10-21T00:00:00.000Z');
  assert.equal(seen[0].url, STATUS_URL);
  assert.match(STATUS_URL, /\?action=ledger_status$/);
  assert.equal(seen[0].init.method, 'GET');
  assert.deepEqual(seen[0].init.headers, { 'x-drive-summary-cron-secret': 's' });
});

test('stale, never, newer failure, malformed and not-deployed all fail', async () => {
  await assert.rejects(run(reply(200, ledger({ last_success_at: new Date(NOW - (STALE_DAYS + 1) * 86400000).toISOString() }))), /9일 동안 없었습니다/);
  await assert.rejects(run(reply(200, ledger({ last_success_at: null }))), /기록 없음/);
  await assert.rejects(run(reply(200, ledger({ state: 'none', last_success_at: null }))), /기록 없음/);
  await assert.rejects(run(reply(200, ledger({ last_failure_at: '2026-10-22T00:00:00.000Z', last_failure_code: 'LEDGER_NOT_READY' }))), /최근 실패: 단계 LEDGER_NOT_READY/);
  await assert.rejects(run(reply(200, ledger({ last_failure_at: '2026-10-22T00:00:00.000Z', last_failure_code: '<b>x' }))), err => !/<b>/.test(err.message));
  await assert.rejects(run(reply(200, { ok: true })), /모양이 맞지 않습니다/);
  await assert.rejects(run(reply(405, { ok: false, error: 'METHOD_NOT_ALLOWED' })), /아직 배포되지 않았습니다/);
  await assert.rejects(run(reply(401, { ok: false })), /비밀값 불일치/);
  assert.equal(judge({ state: 'found', last_success_at: '2026-10-21T00:00:00.000Z', last_failure_at: '2026-10-20T00:00:00.000Z' }, NOW), '2026-10-21T00:00:00.000Z');
});

test('network failure or 5xx retries once', async () => {
  let n = 0;
  await assert.rejects(run(async () => { n++; throw new TypeError('x'); }), CheckFailure);
  assert.equal(n, 2);
  n = 0;
  assert.ok(await run(async () => (++n === 1 ? reply(503, {})() : reply(200, ledger())())));
  assert.equal(n, 2);
});

test('script never prints the secret', () => {
  assert.doesNotMatch(script, /console\.\w+\([^)]*secret/i);
  assert.match(script, /process\.exitCode = 1/);
});

test('workflow: weekly off the hour, read-only, one secret, pinned actions, no deploy access', () => {
  assert.match(workflow, /^on:\n  schedule:\n    - cron: '43 22 \* \* 0'\n  workflow_dispatch:\n\npermissions:\n  contents: read\n/m);
  assert.doesNotMatch(workflow, /pull_request|^  push:/m);
  assert.doesNotMatch(workflow, /contents:\s*write|environment:|production-edge|SUPABASE_ACCESS_TOKEN|SERVICE_ROLE/);
  assert.deepEqual([...workflow.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map(m => m[1]), ['secrets.DRIVE_SUMMARY_CRON_SECRET']);
  assert.match(workflow, /run: node scripts\/ops\/ledger-export-check\.mjs\n/);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true/);
  for (const use of workflow.matchAll(/uses:\s*(\S+)/g)) assert.match(use[1], /@[0-9a-f]{40}$/, use[1]);
  assert.match(workflow, /persist-credentials: false/);
});
