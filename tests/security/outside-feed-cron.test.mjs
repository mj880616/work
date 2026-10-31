// OUTSIDE-바깥성명 ③: 예약 스크립트(scripts/ops/outside-feed.mjs)와 예약 workflow. 지어낸 응답만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runFeed, FeedFailure, FUNCTION_BASE } from '../../scripts/ops/outside-feed.mjs';

const workflow = readFileSync(new URL('../../.github/workflows/outside-feed.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const script = readFileSync(new URL('../../scripts/ops/outside-feed.mjs', import.meta.url), 'utf8');
const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ran = (source, extra = {}) => ({ ok: true, source, status: 'ok', workspaces: 1, listed: 3, fresh: 2, inserted: 2, skipped: 0, deferred: 0, ...extra });
const noSleep = async () => {};

test('missing secret fails before any request', async () => {
  for (const secret of [undefined, '', '  ']) {
    let n = 0;
    await assert.rejects(runFeed({ secret, fetcher: async () => { n++; return reply(200, {}); } }), /비밀값 미등록/);
    assert.equal(n, 0);
  }
});

test('run_plan then one run per enabled source key, cron header only, body = {} / {source}', async () => {
  const seen = [];
  const t = await runFeed({ secret: 'mock', sleep: noSleep, fetcher: async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith('?action=run_plan')) return reply(200, { ok: true, sources: ['kctu', 'jacobin', 'BAD KEY', 7], pruned: 3 });
    return reply(200, ran(JSON.parse(init.body).source));
  } });
  assert.equal(FUNCTION_BASE, 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/outside-feed');
  assert.deepEqual(seen.map(s => [s.url.replace(FUNCTION_BASE, ''), s.init.body]), [['?action=run_plan', '{}'], ['?action=run', '{"source":"kctu"}'], ['?action=run', '{"source":"jacobin"}']]);
  assert.ok(seen.every(s => s.init.method === 'POST' && s.init.headers['x-outside-feed-cron-secret'] === 'mock' && !('Authorization' in s.init.headers)));
  assert.equal(t.pruned, 3);
  assert.deepEqual(t.results.map(r => [r.source, r.status, r.inserted]), [['kctu', 'ok', 2], ['jacobin', 'ok', 2]]);
});

test('401 stops at once (secret mismatch); one failing source does not stop the others; 5xx retried once', async () => {
  let n = 0;
  await assert.rejects(runFeed({ secret: 's', sleep: noSleep, fetcher: async () => { n++; return reply(401, { ok: false, error: 'UNAUTHORIZED' }); } }), /비밀값 불일치/);
  assert.equal(n, 1);
  const calls = [];
  const t = await runFeed({ secret: 's', sleep: noSleep, fetcher: async (url, init) => {
    calls.push(url);
    if (url.endsWith('run_plan')) return reply(200, { ok: true, sources: ['kctu', 'kptu'], pruned: 0 });
    const source = JSON.parse(init.body).source;
    return source === 'kctu' ? reply(503, { ok: false, error: 'STORE_UNAVAILABLE' }) : reply(200, ran('kptu', { status: 'robots', listed: 0, fresh: 0, inserted: 0 }));
  } });
  assert.deepEqual(t.results.map(r => [r.source, r.status]), [['kctu', 'call_failed'], ['kptu', 'robots']]);
  assert.equal(calls.length, 4, 'kctu retried once');
  await assert.rejects(runFeed({ secret: 's', sleep: noSleep, fetcher: async () => reply(200, { ok: true }) }), /모양이 다릅니다/);
  await assert.rejects(runFeed({ secret: 's', sleep: noSleep, fetcher: async () => reply(400, { ok: false, error: 'private <text>' }) }), err => err instanceof FeedFailure && err.message === '바깥 성명 수집 실패(run_plan): HTTP 400');
});

test('the script never prints the secret or post contents', () => {
  assert.doesNotMatch(script, /console\.\w+\([^)]*secret/i);
  for (const line of script.split('\n').filter(l => /console\.log/.test(l))) assert.doesNotMatch(line, /\.(title|url|summary|text|body)\b/, line);
  assert.match(script, /process\.exitCode = 1/);
});

test('schedule workflow: 08·13·18 KST, read-only, only its own cron secret via env, pinned actions, no deploy access', () => {
  assert.match(workflow, /^on:\n  schedule:\n    - cron: '7 23,4,9 \* \* \*'\n  workflow_dispatch:\n\npermissions:\n  contents: read\n/m);
  assert.doesNotMatch(workflow, /pull_request|^  push:/m);
  assert.doesNotMatch(workflow, /contents:\s*write|environment:|production-edge|SUPABASE_ACCESS_TOKEN|SERVICE_ROLE|OPENAI/);
  const exprs = [...workflow.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map(m => m[1]);
  assert.deepEqual(exprs, ['secrets.OUTSIDE_FEED_CRON_SECRET']);
  assert.match(workflow, /run: node scripts\/ops\/outside-feed\.mjs\n/);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true|echo|set -x/);
  for (const use of workflow.matchAll(/uses:\s*(\S+)/g)) assert.match(use[1], /@[0-9a-f]{40}$/, use[1]);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /concurrency:\n  group: outside-feed\n  cancel-in-progress: false/);
  assert.match(workflow, /if: github\.repository == 'mj880616\/work'/);
});
