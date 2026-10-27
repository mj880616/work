// LIB-글자채우기야간: the nightly script (scripts/ops/library-text-nightly.mjs) and its schedule workflow. Mock responses only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runNightly, NightlyFailure, FUNCTION_URL, MAX_CALLS } from '../../scripts/ops/library-text-nightly.mjs';

const workflow = readFileSync(new URL('../../.github/workflows/library-text-nightly.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const script = readFileSync(new URL('../../scripts/ops/library-text-nightly.mjs', import.meta.url), 'utf8');
const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const batch = (asked, remaining, extra = {}) => ({ ok: true, asked, ready: asked, error: 0, gave_up: 0, skipped: 0, remaining, stop: null, done_at: null, ...extra });
const noSleep = async () => {};

test('missing secret fails before any request', async () => {
  for (const secret of [undefined, '', '  ']) {
    let n = 0;
    await assert.rejects(runNightly({ secret, fetcher: async () => { n++; return reply(200, batch(0, 0)); } }), /비밀값 미등록/);
    assert.equal(n, 0);
  }
});

test('calls the text_backfill action with only the cron header, at most MAX_CALLS times, and stops when nothing is left', async () => {
  const seen = [];
  const answers = [batch(5, 12), batch(5, 7), batch(5, 2), batch(2, 0, { done_at: '2026-10-23T18:25:00.000Z' })];
  const t = await runNightly({ secret: 'mock', fetcher: async (url, init) => { seen.push({ url, init }); return reply(200, answers[seen.length - 1]); } });
  assert.equal(MAX_CALLS, 4);
  assert.equal(seen.length, 4);
  assert.ok(seen.every(s => s.url === FUNCTION_URL && s.init.method === 'POST' && s.init.body === undefined));
  assert.deepEqual(seen[0].init.headers, { 'x-drive-summary-cron-secret': 'mock' });
  assert.match(FUNCTION_URL, /\/functions\/v1\/drive-summary\?action=text_backfill$/);
  assert.equal(t.ready, 17); assert.equal(t.remaining, 0); assert.equal(t.doneAt, '2026-10-23T18:25:00.000Z');

  let n = 0;
  const capped = await runNightly({ secret: 'mock', fetcher: async () => { n++; return reply(200, batch(5, 100)); } });
  assert.equal(n, MAX_CALLS, 'a few per night, never more'); assert.equal(capped.remaining, 100);

  n = 0;
  await runNightly({ secret: 'mock', fetcher: async () => { n++; return reply(200, batch(0, 3)); } });
  assert.equal(n, 1, 'nothing readable now (e.g. another call is reading) → stop');
});

test('401 is a secret mismatch and not retried; old function (no counts) fails clearly; stage codes only', async () => {
  let n = 0;
  await assert.rejects(runNightly({ secret: 's', sleep: noSleep, fetcher: async () => { n++; return reply(401, { ok: false, error: 'UNAUTHORIZED' }); } }), /비밀값 불일치/);
  assert.equal(n, 1);
  await assert.rejects(runNightly({ secret: 's', sleep: noSleep, fetcher: async () => reply(200, { ok: true, updated_at: 'x', documents: {} }) }), /건수가 없습니다/);
  await assert.rejects(runNightly({ secret: 's', sleep: noSleep, fetcher: async () => reply(400, { ok: false, error: 'private <text>' }) }), err => err.message === '글자 읽기 실패: HTTP 400');
  await assert.rejects(runNightly({ secret: 's', sleep: noSleep, fetcher: async () => reply(502, { ok: false, error: 'SERVER_CONFIG_MISSING' }) }), /단계 SERVER_CONFIG_MISSING/);
});

test('network failure or 5xx is retried once, then fails', async () => {
  let n = 0, slept = 0;
  await assert.rejects(runNightly({ secret: 's', sleep: async () => { slept++; }, fetcher: async () => { n++; throw new TypeError('fetch failed'); } }), NightlyFailure);
  assert.equal(n, 2); assert.equal(slept, 1);
  n = 0;
  const t = await runNightly({ secret: 's', sleep: noSleep, fetcher: async () => (++n === 1 ? reply(503, {}) : reply(200, batch(1, 0))) });
  assert.equal(t.ready, 1); assert.equal(n, 2);
});

test('the script never prints the secret', () => {
  assert.doesNotMatch(script, /console\.\w+\([^)]*secret/i);
  assert.match(script, /process\.exitCode = 1/);
});

test('schedule workflow: nightly, read-only, the existing cron secret via env only, pinned actions, no deploy access', () => {
  assert.match(workflow, /^on:\n  schedule:\n    - cron: '23 18 \* \* \*'\n  workflow_dispatch:\n\npermissions:\n  contents: read\n/m);
  assert.doesNotMatch(workflow, /pull_request|^  push:/m);
  assert.doesNotMatch(workflow, /contents:\s*write|environment:|production-edge|SUPABASE_ACCESS_TOKEN|SERVICE_ROLE/);
  const exprs = [...workflow.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map(m => m[1]);
  assert.deepEqual(exprs, ['secrets.DRIVE_SUMMARY_CRON_SECRET']);
  assert.match(workflow, /run: node scripts\/ops\/library-text-nightly\.mjs\n/);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true/);
  for (const use of workflow.matchAll(/uses:\s*(\S+)/g)) assert.match(use[1], /@[0-9a-f]{40}$/, use[1]);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /concurrency:\n  group: library-text-nightly\n  cancel-in-progress: false/);
});
