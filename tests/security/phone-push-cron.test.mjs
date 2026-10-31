// APP-폰알림 N3: 예약 스크립트(scripts/ops/phone-push.mjs)와 예약 workflow(.github/workflows/phone-push-schedule.yml). 지어낸 응답만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPush, pickSlot, PushFailure, FUNCTION_BASE, SCHEDULE_SLOTS, SLOTS } from '../../scripts/ops/phone-push.mjs';

const workflow = readFileSync(new URL('../../.github/workflows/phone-push-schedule.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const script = readFileSync(new URL('../../scripts/ops/phone-push.mjs', import.meta.url), 'utf8');
const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const noSleep = async () => {};
const ok = slot => reply(200, { ok: true, slot, workspaces: 1, sent: 0, pruned: 0 });

test('missing secret or slot fails before any request', async () => {
  for (const secret of [undefined, '', '  ']) {
    let n = 0;
    await assert.rejects(runPush({ secret, input: 'quarter', fetcher: async () => { n++; return ok('quarter'); } }), /비밀값 미등록/);
    assert.equal(n, 0);
  }
  let n = 0;
  await assert.rejects(runPush({ secret: 's', fetcher: async () => { n++; return ok('quarter'); } }), /slot 입력이 없습니다/);
  await assert.rejects(runPush({ secret: 's', schedule: '0 0 * * *', fetcher: async () => { n++; return ok('quarter'); } }), /알 수 없는 예약 시각/);
  assert.equal(n, 0);
});

test('slot from the cron string (schedule wins over input); one POST with cron header only and body {}', async () => {
  assert.equal(pickSlot({ schedule: '3 23 * * *', input: 'friday' }), 'morning');
  assert.equal(pickSlot({ input: 'evening' }), 'evening');
  const seen = [];
  const r = await runPush({ secret: 'mock', schedule: '23 6 * * 5', sleep: noSleep, fetcher: async (url, init) => { seen.push({ url, init }); return ok('friday'); } });
  assert.equal(FUNCTION_BASE, 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/phone-push');
  assert.deepEqual(seen.map(s => [s.url.replace(FUNCTION_BASE, ''), s.init.body]), [['?action=run&slot=friday', '{}']]);
  assert.ok(seen.every(s => s.init.method === 'POST' && s.init.headers['x-phone-push-cron-secret'] === 'mock' && !('Authorization' in s.init.headers)));
  assert.deepEqual(r, { slot: 'friday', workspaces: 1, sent: 0, pruned: 0 });
});

test('401 stops at once; 5xx retried once; odd replies refused without echoing text', async () => {
  let n = 0;
  await assert.rejects(runPush({ secret: 's', input: 'quarter', sleep: noSleep, fetcher: async () => { n++; return reply(401, { ok: false, error: 'UNAUTHORIZED' }); } }), /비밀값 불일치/);
  assert.equal(n, 1);
  n = 0;
  const r = await runPush({ secret: 's', input: 'quarter', sleep: noSleep, fetcher: async () => (++n === 1 ? reply(503, { ok: false, error: 'STORE_UNAVAILABLE' }) : ok('quarter')) });
  assert.equal(n, 2); assert.equal(r.slot, 'quarter');
  await assert.rejects(runPush({ secret: 's', input: 'quarter', sleep: noSleep, fetcher: async () => ok('morning') }), /모양이 다릅니다/);
  await assert.rejects(runPush({ secret: 's', input: 'quarter', sleep: noSleep, fetcher: async () => reply(400, { ok: false, error: 'private <text>' }) }),
    err => err instanceof PushFailure && err.message === '폰 알림 예약 실패(quarter): HTTP 400');
});

test('the script never prints the secret, tokens or titles', () => {
  assert.doesNotMatch(script, /console\.\w+\([^)]*secret/i);
  for (const line of script.split('\n').filter(l => /console\.log/.test(l))) assert.doesNotMatch(line, /\.(title|token|fcm_token|body)\b/, line);
  assert.match(script, /process\.exitCode = 1/);
});

test('schedule workflow: four schedules match the script table, read-only, only its own cron secret, switch variable, pinned actions', () => {
  const crons = [...workflow.matchAll(/^    - cron: '([^']+)'$/gm)].map(m => m[1]);
  assert.deepEqual(crons, Object.keys(SCHEDULE_SLOTS));
  assert.deepEqual([...new Set(Object.values(SCHEDULE_SLOTS))].sort(), [...SLOTS].sort());
  assert.match(workflow, /\npermissions:\n  contents: read\n/);
  assert.doesNotMatch(workflow, /pull_request|^  push:/m);
  assert.doesNotMatch(workflow, /contents:\s*write|environment:|production-edge|SUPABASE_ACCESS_TOKEN|SERVICE_ROLE|FCM_SERVICE_ACCOUNT_JSON|OPENAI/);
  const exprs = [...workflow.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map(m => m[1]);
  assert.deepEqual(exprs, ['secrets.PHONE_PUSH_CRON_SECRET', 'github.event.schedule', 'inputs.slot']);
  assert.match(workflow, /if: github\.repository == 'mj880616\/work' && vars\.PHONE_PUSH_ENABLED == 'true'\n/);
  assert.match(workflow, /run: node scripts\/ops\/phone-push\.mjs\n/);
  assert.doesNotMatch(workflow, /continue-on-error|\|\| true|echo|set -x/);
  for (const use of workflow.matchAll(/uses:\s*(\S+)/g)) assert.match(use[1], /@[0-9a-f]{40}$/, use[1]);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /concurrency:\n  group: phone-push\n  cancel-in-progress: false/);
});
