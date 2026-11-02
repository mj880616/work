import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAiUsageMeter, recordAiDailyUsage, seoulDay } from '../../supabase/functions/_shared/ai-daily-usage.mjs';

// S48-15(빠짐31): library-files·meeting-ai-ingest·document-ai-index가 부른 AI 토큰을 홈 'AI 사용량' 줄의 기존 표
// (app_ai_daily_usage, 작업공간·사용자·서울 날짜 1행)에 더한다. 새 표·새 권한 없음, 기록 실패는 본 작업을 막지 않는다.

const read = p => readFileSync(new URL(`../../supabase/functions/${p}`, import.meta.url), 'utf8');

function fakeAdmin({ old = null, readError = null, writeError = null, throwOn = null } = {}) {
  const calls = { reads: [], writes: [] };
  const admin = {
    from(table) {
      if (throwOn === 'from') throw new Error('boom');
      const filters = [];
      const b = {
        select: cols => { calls.reads.push({ table, cols, filters }); return b; },
        eq: (k, v) => { filters.push([k, v]); return b; },
        maybeSingle: async () => ({ data: old, error: readError }),
        upsert: async (row, opts) => { calls.writes.push({ table, row, opts }); return { error: writeError }; },
      };
      return b;
    },
  };
  return { admin, calls };
}

test('meter counts every AI call and only safe token numbers', () => {
  const m = createAiUsageMeter();
  m.add({ usage: { input_tokens: 100, output_tokens: 20 } });
  m.add({ usage: { input_tokens: -5, output_tokens: 1.5 } });
  m.add(null);
  assert.deepEqual([m.calls, m.input, m.output], [3, 100, 20]);
});

test('seoul day matches ai-assist (UTC+9)', () => {
  assert.equal(seoulDay(Date.UTC(2026, 10, 1, 15, 30)), '2026-11-02');
  assert.equal(seoulDay(Date.UTC(2026, 10, 1, 14, 59)), '2026-11-01');
});

test('adds to the existing day row of the same workspace and user, keeping requests and advanced_requests (tokens only, so the ai-assist daily request limit is not used up)', async () => {
  const { admin, calls } = fakeAdmin({ old: { requests: 4, advanced_requests: 2, input_tokens: 1000, output_tokens: 50 } });
  const meter = createAiUsageMeter();
  meter.add({ usage: { input_tokens: 300, output_tokens: 7 } });
  meter.add({ usage: { input_tokens: 200, output_tokens: 3 } });
  const nowMs = Date.UTC(2026, 10, 1, 16, 0);
  assert.equal(await recordAiDailyUsage(admin, { workspaceId: 'ws-1', userId: 'u-1', meter, nowMs }), 'recorded');
  assert.deepEqual(calls.reads[0].filters, [['workspace_id', 'ws-1'], ['user_id', 'u-1'], ['day', '2026-11-02']]);
  assert.equal(calls.writes.length, 1);
  const { table, row, opts } = calls.writes[0];
  assert.equal(table, 'app_ai_daily_usage');
  assert.equal(opts.onConflict, 'workspace_id,user_id,day');
  assert.deepEqual(row, {
    workspace_id: 'ws-1', user_id: 'u-1', day: '2026-11-02',
    requests: 4, advanced_requests: 2, input_tokens: 1500, output_tokens: 60,
    updated_at: new Date(nowMs).toISOString(),
  });
});

test('no AI call → no read, no write', async () => {
  const { admin, calls } = fakeAdmin();
  assert.equal(await recordAiDailyUsage(admin, { workspaceId: 'ws-1', userId: 'u-1', meter: createAiUsageMeter() }), 'skipped');
  assert.equal(calls.reads.length + calls.writes.length, 0);
});

test('never throws: read error, write error, client crash, missing owner all return failed and log only a code', async () => {
  const meter = createAiUsageMeter();
  meter.add({ usage: { input_tokens: 1, output_tokens: 1 } });
  const logs = [];
  const log = (msg, detail) => logs.push([msg, detail]);
  for (const opts of [{ readError: { code: 'PGRST301', message: 'secret detail' } }, { writeError: { code: '42501', message: 'secret detail' } }, { throwOn: 'from' }]) {
    const { admin } = fakeAdmin(opts);
    assert.equal(await recordAiDailyUsage(admin, { workspaceId: 'ws-1', userId: 'u-1', meter, log }), 'failed');
  }
  const { admin, calls } = fakeAdmin();
  assert.equal(await recordAiDailyUsage(admin, { workspaceId: '', userId: 'u-1', meter, log }), 'failed');
  assert.equal(calls.writes.length, 0);
  assert.equal(logs.length, 4);
  assert.doesNotMatch(JSON.stringify(logs), /secret detail/);
  assert.equal(await recordAiDailyUsage(admin, { workspaceId: 'ws-1', userId: 'u-1', meter, log: () => { throw new Error('x'); } }), 'recorded');
});

// 세 함수의 모든 OpenAI 호출이 미터를 거치고, 요청 끝에 서버가 확인한 작업공간·로그인 사용자로 한 번 기록한다.
for (const [fn, recordCall] of [
  ['library-files/index.ts', "await recordAiDailyUsage(admin,{workspaceId:wm.workspace_id,userId:user.id,meter});"],
  ['meeting-ai-ingest/index.ts', "}finally{await recordAiDailyUsage(admin,{workspaceId,userId:user.id,meter})}"],
  ['document-ai-index/index.ts', "}finally{await recordAiDailyUsage(admin,{workspaceId,userId:user.id,meter})}"],
]) {
  test(`${fn} meters every OpenAI call and records usage once per request`, () => {
    const src = read(fn);
    assert.match(src, /import \{ createAiUsageMeter, recordAiDailyUsage \} from '\.\.\/_shared\/ai-daily-usage\.mjs';/);
    const fetches = src.match(/fetch\('https:\/\/api\.openai\.com\/v1\/responses'/g) || [];
    assert.equal(fetches.length, 1, 'one OpenAI fetch site');
    assert.equal((src.match(/meter\.add\(d\)/g) || []).length, 1, 'the fetch site adds the response usage');
    assert.equal((src.match(/createAiUsageMeter\(\)/g) || []).length, 1);
    assert.ok(src.includes(recordCall), 'records with server-checked workspace and signed-in user');
    assert.doesNotMatch(src, /recordAiDailyUsage\([^)]*\b(b|form|body)\./, 'never trusts client ids');
  });
}

test('the shared writer only touches app_ai_daily_usage (no new table, no other write)', () => {
  const src = read('_shared/ai-daily-usage.mjs');
  assert.deepEqual([...new Set(src.match(/from\('([a-z_]+)'\)/g))], ["from('app_ai_daily_usage')"]);
  assert.doesNotMatch(src, /\.(insert|delete|update|rpc)\(/);
});
