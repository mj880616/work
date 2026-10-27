import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runCron, CronFailure, FUNCTION_URL } from '../../scripts/ops/drive-summary-cron.mjs';

const workflow = readFileSync(new URL('../../.github/workflows/drive-summary-refresh.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const script = readFileSync(new URL('../../scripts/ops/drive-summary-cron.mjs', import.meta.url), 'utf8');

const reply = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = { ok: true, updated_at: '2026-10-21T21:17:05.000Z', documents: { org: 'https://docs.google.com/document/d/o/edit', project: 'https://docs.google.com/document/d/p/edit' } };
const noSleep = async () => {};

test('missing or blank GitHub secret fails with "비밀값 미등록" before any request', async () => {
  for (const secret of [undefined, '', '   ']) {
    let called = 0;
    await assert.rejects(runCron({ secret, fetcher: async () => { called++; return new Response('{}'); } }), err => err instanceof CronFailure && /비밀값 미등록/.test(err.message));
    assert.equal(called, 0);
  }
});

test('sends only the cron header by POST with no body and returns updated_at', async () => {
  const seen = [];
  const updated = await runCron({ secret: 'mock-secret', fetcher: async (url, init) => { seen.push({ url, init }); return reply(200, ok)(); } });
  assert.equal(updated, ok.updated_at);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, FUNCTION_URL);
  assert.equal(seen[0].init.method, 'POST');
  assert.deepEqual(seen[0].init.headers, { 'x-drive-summary-cron-secret': 'mock-secret' });
  assert.equal(seen[0].init.body, undefined);
  assert.ok(seen[0].init.signal, 'request has a timeout');
});

test('401 means the Supabase secret is missing or different, and is not retried', async () => {
  let n = 0;
  await assert.rejects(runCron({ secret: 'mock-secret', sleep: noSleep, fetcher: async () => { n++; return reply(401, { ok: false, error: 'UNAUTHORIZED' })(); } }), /비밀값 불일치/);
  assert.equal(n, 1);
});

test('controlled failure stage is reported; unsafe error text is not echoed', async () => {
  await assert.rejects(runCron({ secret: 's', sleep: noSleep, fetcher: reply(403, { ok: false, error: 'DRIVE_PUBLIC_SHARING_FOUND' }) }), /HTTP 403, 단계 DRIVE_PUBLIC_SHARING_FOUND/);
  await assert.rejects(runCron({ secret: 's', sleep: noSleep, fetcher: reply(400, { ok: false, error: 'mock private <detail> text' }) }), err => err.message === '사본 갱신 실패: HTTP 400');
  await assert.rejects(runCron({ secret: 's', sleep: noSleep, fetcher: reply(200, 'not json') }), /HTTP 200/);
  await assert.rejects(runCron({ secret: 's', sleep: noSleep, fetcher: reply(200, { ok: true }) }), /갱신 시각이 없습니다/);
  await assert.rejects(runCron({ secret: 's', sleep: noSleep, fetcher: reply(200, { ok: false, error: 'SUMMARY_FAILED' }) }), /단계 SUMMARY_FAILED/);
});

test('network failure or 5xx is retried exactly once, then fails', async () => {
  for (const make of [async () => { throw new TypeError('fetch failed'); }, reply(502, { ok: false, error: 'DRIVE_UPLOAD_FAILED' })]) {
    let n = 0, slept = 0;
    await assert.rejects(runCron({ secret: 's', sleep: async () => { slept++; }, fetcher: async (...a) => { n++; return make(...a); } }), CronFailure);
    assert.equal(n, 2); assert.equal(slept, 1);
  }
  let n = 0;
  const updated = await runCron({ secret: 's', sleep: noSleep, fetcher: async () => (++n === 1 ? reply(503, {})() : reply(200, ok)()) });
  assert.equal(updated, ok.updated_at); assert.equal(n, 2);
});

test('the script never prints the secret or the response documents', () => {
  assert.doesNotMatch(script, /console\.\w+\([^)]*secret/i);
  assert.doesNotMatch(script, /console\.\w+\([^)]*documents/);
  assert.match(script, /process\.exitCode = 1/);
});

test('schedule workflow: twice a day, read-only, one secret via env, pinned actions, no deploy access', () => {
  assert.match(workflow, /^on:\n  schedule:\n    - cron: '17 21 \* \* \*'\n    - cron: '17 4 \* \* \*'\n  workflow_dispatch:\n\npermissions:\n  contents: read\n/m);
  assert.doesNotMatch(workflow, /pull_request|^  push:/m);
  assert.doesNotMatch(workflow, /contents:\s*write|environment:|production-edge|SUPABASE_ACCESS_TOKEN|SERVICE_ROLE/);
  const exprs = [...workflow.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map(m => m[1]);
  assert.deepEqual(exprs, ['secrets.DRIVE_SUMMARY_CRON_SECRET']);
  assert.match(workflow, /env:\n          DRIVE_SUMMARY_CRON_SECRET: \$\{\{ secrets\.DRIVE_SUMMARY_CRON_SECRET \}\}\n        run: node scripts\/ops\/drive-summary-cron\.mjs\n/);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true/);
  for (const use of workflow.matchAll(/uses:\s*(\S+)/g)) assert.match(use[1], /@[0-9a-f]{40}$/, use[1]);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /concurrency:\n  group: drive-summary-refresh\n  cancel-in-progress: false/);
});
