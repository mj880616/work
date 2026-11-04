// S49-32 FILES-통합 2-②b: 예약 스크립트(scripts/ops/cloud-files-cron.mjs)와 예약 workflow(.github/workflows/cloud-files-jobs-cron.yml). 지어낸 응답만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSweep, SweepFailure, FUNCTION_URL } from '../../scripts/ops/cloud-files-cron.mjs';

const workflow = readFileSync(new URL('../../.github/workflows/cloud-files-jobs-cron.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const script = readFileSync(new URL('../../scripts/ops/cloud-files-cron.mjs', import.meta.url), 'utf8');
const handler = readFileSync(new URL('../../supabase/functions/cloud-files/handler.ts', import.meta.url), 'utf8');
const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const noSleep = async () => {};

test('missing secrets fail before any request', async () => {
  let n = 0;
  const fetcher = async () => { n++; return reply(200, { ok: true, active: 0, kicked: false }); };
  for (const secret of [undefined, '', '  ']) await assert.rejects(runSweep({ secret, gateway: 'g', fetcher }), /CLOUD_FILES_CRON_SECRET/);
  for (const gateway of [undefined, '', ' ']) await assert.rejects(runSweep({ secret: 's', gateway, fetcher }), /CLOUD_FILES_GATEWAY_KEY/);
  assert.equal(n, 0);
});

test('one POST: gateway key in Authorization/apikey, cron secret header, body {}', async () => {
  const seen = [];
  const r = await runSweep({ secret: 'mock-secret', gateway: 'mock-gateway', sleep: noSleep, fetcher: async (url, init) => { seen.push({ url, init }); return reply(200, { ok: true, active: 2, kicked: true }); } });
  assert.equal(FUNCTION_URL, 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/cloud-files');
  assert.equal(seen.length, 1);
  const { url, init } = seen[0];
  assert.equal(url, FUNCTION_URL);assert.equal(init.method, 'POST');assert.equal(init.body, '{}');
  assert.equal(init.headers.Authorization, 'Bearer mock-gateway');assert.equal(init.headers.apikey, 'mock-gateway');
  assert.equal(init.headers['x-cloud-files-cron-secret'], 'mock-secret');
  assert.deepEqual(r, { active: 2, kicked: true });
});

test('401 stops at once; 5xx and network retried once; odd replies refused', async () => {
  let n = 0;
  await assert.rejects(runSweep({ secret: 's', gateway: 'g', sleep: noSleep, fetcher: async () => { n++; return reply(401, { ok: false }); } }), /열쇠 불일치/);
  assert.equal(n, 1);
  n = 0;
  const r = await runSweep({ secret: 's', gateway: 'g', sleep: noSleep, fetcher: async () => (++n === 1 ? reply(503, { ok: false, error: 'not_ready' }) : reply(200, { ok: true, active: 0, kicked: false })) });
  assert.equal(n, 2);assert.deepEqual(r, { active: 0, kicked: false });
  n = 0;
  await assert.rejects(runSweep({ secret: 's', gateway: 'g', sleep: noSleep, fetcher: async () => { n++; throw new Error('down'); } }), SweepFailure);
  assert.equal(n, 2);
  for (const body of [{ ok: true }, { ok: true, active: -1, kicked: false }, { ok: true, active: 1, kicked: 'yes' }, 'not json'])
    await assert.rejects(runSweep({ secret: 's', gateway: 'g', sleep: noSleep, fetcher: async () => reply(200, body) }), SweepFailure);
  await assert.rejects(runSweep({ secret: 's', gateway: 'g', sleep: noSleep, fetcher: async () => reply(400, { ok: false, error: 'body_invalid' }) }), /HTTP 400, 단계 body_invalid/);
});

test('script never prints secrets; workflow is guarded, pinned, every 5 minutes, and passes secrets only by env', () => {
  assert.doesNotMatch(script, /console\.log\([^)]*(secret|gateway)\b/i);
  assert.match(workflow, /if: github\.repository == 'mj880616\/work' && vars\.CLOUD_FILES_CRON_ENABLED == 'true'/);
  assert.match(workflow, /- cron: '2,7,12,17,22,27,32,37,42,47,52,57 \* \* \* \*'/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /CLOUD_FILES_CRON_SECRET: \$\{\{ secrets\.CLOUD_FILES_CRON_SECRET \}\}/);
  assert.match(workflow, /CLOUD_FILES_GATEWAY_KEY: \$\{\{ secrets\.CLOUD_FILES_GATEWAY_KEY \}\}/);
  assert.equal((workflow.match(/\$\{\{ secrets\./g) || []).length, 2);
  for (const line of workflow.split('\n').filter((l) => /uses: /.test(l))) assert.match(line, /@[0-9a-f]{40} #/, line);
  assert.doesNotMatch(workflow, /run: .*secrets\./);
});

test('server entry: cron header handled before the user gate and the tick; only the job sweep is reachable', () => {
  const entry = handler.slice(handler.indexOf('return async (req: Request): Promise<Response> => {'));
  const cron = entry.indexOf('if (req.headers.has(CRON_HEADER)) return await cronSweep(req);');
  assert.ok(cron > 0 && cron < entry.indexOf('if (req.headers.has(TICK_HEADER))') && cron < entry.indexOf('authorize('));
  const sweep = handler.slice(handler.indexOf('async function cronSweep('), handler.indexOf('function jobsIn('));
  // 예약 입구가 부르는 것: 기능 작업공간 확인, 작업표 읽기, runJobs뿐(쓰기 action·다른 표 없음).
  assert.deepEqual([...sweep.matchAll(/(?:db|rows)\("([a-z_]+)"/g)].map((m) => m[1]), ['cron_feature', 'cron_active']);
  assert.match(sweep, /origin=eq\.cloud&status=in\.\(\$\{JOB_ACTIVE\.join\(","\)\}\)/);
  assert.match(sweep, /background\(runJobs\(ws\)/);
  assert.doesNotMatch(sweep, /actions\[|kickTick|PATCH|DELETE|method: "POST", body: JSON\.stringify\(\{ (?!p_feature)/);
});
