import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../../supabase/functions/drive-summary/core.mjs';
import { parseAiUsageReport, summarizeAiUsage, openAiPrice, readStart } from '../../supabase/functions/drive-summary/ai-usage.mjs';
import * as model from '../../supabase/functions/_shared/ai-model.ts';
import * as assist from '../../supabase/functions/ai-assist/handler.ts';
import * as feed from '../../supabase/functions/collector-feed/handler.ts';

// AI-사용량줄: POST ?action=ai_usage(수집 비밀값만, 숫자 보고 넣기만) / GET ?action=ai_usage(소유자 JWT, 소유자 토큰으로 읽기).
const now = new Date('2026-10-28T05:00:00Z'); // 10/28 14:00 KST
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', COLLECTOR_HEARTBEAT_SECRET: 'beat-secret', DRIVE_SUMMARY_CRON_SECRET: 'cron' };
function harness(data = {}) {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    const url = new URL(input), method = init.method || 'GET';
    calls.push({ url, method, init });
    if (url.pathname === '/auth/v1/user') return init.headers.Authorization === 'Bearer owner-jwt' ? Response.json({ id: 'owner' }) : Response.json({}, { status: 401 });
    const table = url.pathname.split('/').at(-1);
    if (table === 'app_workspaces') return Response.json([{ id: 'ws' }]);
    if (table === 'app_workspace_members') return Response.json(url.searchParams.get('user_id') === 'eq.owner' ? [{ user_id: 'owner', role: 'owner' }] : []);
    if (method === 'POST') return new Response(null, { status: data.writeStatus || 201 });
    if (data.missing === table) return Response.json({ code: '42P01' }, { status: 404 });
    return Response.json(data[table] || []);
  };
  const handler = createHandler({ env, fetcher, now: () => now });
  const post = (headers, body) => handler(new Request('https://edge.test/drive-summary?action=ai_usage', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  const get = headers => handler(new Request('https://edge.test/drive-summary?action=ai_usage', { headers }));
  return { calls, post, get };
}
const report = { ref: 'gm-20261028-0001', source: 'transcript', model: 'models/gemini-2.5-flash', calls: 1, input_tokens: 12000, audio_tokens: 10000, output_tokens: 3000 };

test('단가·상한은 ai-model.ts 한 곳: ai-assist·collector-feed 상한과 같다', () => {
  assert.equal(model.AI_MONTHLY_LIMIT_ASSIST_KRW, assist.MONTHLY_LIMIT_KRW);
  assert.equal(model.AI_MONTHLY_LIMIT_FEED_KRW, feed.MONTHLY_LIMIT_KRW);
  assert.equal(model.geminiPrice('gemini-2.5-flash-lite-001').prefix, 'gemini-2.5-flash-lite');
  assert.equal(model.geminiPrice('gemini-2.5-flash').prefix, 'gemini-2.5-flash');
  assert.equal(model.geminiPrice('gemini-9-ultra'), null);
  // 2,000 글 + 10,000 음성 입력, 3,000 출력(flash): (2000*420 + 10000*1400 + 3000*3500) / 1e6
  assert.equal(Math.round(model.geminiKrw('gemini-2.5-flash', 12000, 10000, 3000) * 1000) / 1000, 25.34);
  assert.deepEqual(openAiPrice({}), { input: model.DEFAULT_PRICE_IN_KRW_PER_MTOK, output: model.DEFAULT_PRICE_OUT_KRW_PER_MTOK });
  assert.deepEqual(openAiPrice({ WEB2_AI_PRICE_IN_KRW_PER_MTOK: '200', WEB2_AI_PRICE_OUT_KRW_PER_MTOK: 'x' }), { input: 200, output: model.DEFAULT_PRICE_OUT_KRW_PER_MTOK });
});

test('보고 몸통: 정해진 칸·숫자만, 글·모르는 칸·음성>입력·1KB 넘음은 거절', () => {
  assert.equal(parseAiUsageReport(JSON.stringify(report)).model, 'gemini-2.5-flash');
  for (const bad of [{ ...report, text: '전사 글' }, { ...report, ref: 'short' }, { ...report, source: 'chat' }, { ...report, provider: 'openai' },
    { ...report, audio_tokens: 20000 }, { ...report, input_tokens: -1 }, { ...report, model: 'Gemini Flash!' }, { ...report, calls: 1.5 }]) {
    assert.equal(parseAiUsageReport(JSON.stringify(bad)), null, JSON.stringify(bad));
  }
  assert.equal(parseAiUsageReport('{' + ' '.repeat(2000) + '}'), null);
  assert.equal(parseAiUsageReport('[]'), null);
});

test('POST: 비밀값 없음·틀림·JWT·cron은 쓰기 전에 거절', async () => {
  for (const headers of [{}, { 'x-collector-heartbeat-secret': 'wrong' }, { Authorization: 'Bearer owner-jwt' },
    { 'x-collector-heartbeat-secret': 'beat-secret', Authorization: 'Bearer owner-jwt' }, { 'x-collector-heartbeat-secret': 'beat-secret', 'x-drive-summary-cron-secret': 'cron' }]) {
    const h = harness();
    const r = await h.post(headers, report);
    assert.equal(r.status, 401, JSON.stringify(headers));
    assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
  }
  const h = harness();
  assert.equal((await h.post({ 'x-collector-heartbeat-secret': 'beat-secret' }, { ...report, text: 'x' })).status, 400);
  assert.equal(h.calls.length, 0);
});

test('POST: 보고 한 행만 넣기(같은 ref는 무시), 서버 키, 서울 날짜', async () => {
  const h = harness();
  const r = await h.post({ 'x-collector-heartbeat-secret': 'beat-secret' }, report);
  assert.equal(r.status, 200);
  const writes = h.calls.filter(c => c.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url.pathname, '/rest/v1/app_ai_external_usage');
  assert.equal(writes[0].url.searchParams.get('on_conflict'), 'workspace_id,ref');
  assert.equal(writes[0].init.method, 'POST');
  assert.match(writes[0].init.headers.Prefer, /resolution=ignore-duplicates/);
  const body = JSON.parse(writes[0].init.body);
  assert.deepEqual(Object.keys(body).sort(), ['audio_tokens', 'calls', 'day', 'input_tokens', 'model', 'output_tokens', 'provider', 'ref', 'source', 'workspace_id']);
  assert.equal(body.day, '2026-10-28'); assert.equal(body.workspace_id, 'ws');
  assert.ok(!h.calls.some(c => c.url.hostname.includes('googleapis')), 'Drive를 건드리지 않음');
  const missing = harness({ writeStatus: 404 });
  assert.equal((await (await missing.post({ 'x-collector-heartbeat-secret': 'beat-secret' }, report)).json()).error, 'AI_USAGE_TABLE_MISSING');
});

test('GET: 소유자 JWT만, 읽기는 소유자 토큰 + anon 키(서버 키로 표를 읽지 않음), 쓰기 없음', async () => {
  for (const headers of [{}, { Authorization: 'Bearer nobody' }, { 'x-drive-summary-cron-secret': 'cron' }, { Authorization: 'Bearer owner-jwt', 'x-collector-heartbeat-secret': 'beat-secret' }]) {
    const r = await harness().get(headers);
    assert.equal(r.status, 401, JSON.stringify(headers));
  }
  const h = harness({
    app_ai_daily_usage: [{ day: '2026-10-02', requests: 3, input_tokens: 10_000_000, output_tokens: 10_000_000 }],
    app_feed_days: [{ day: '2026-10-28', source: 'telegram', ai_requests: 5, ai_input_tokens: 1_000_000, ai_output_tokens: 1_000_000 }],
    app_ai_external_usage: [{ day: '2026-10-28', source: 'transcript', model: 'gemini-2.5-flash', calls: 2, input_tokens: 1_000_000, audio_tokens: 1_000_000, output_tokens: 0 }],
  });
  const r = await h.get({ Authorization: 'Bearer owner-jwt' });
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.equal(s.month, '2026-10');
  assert.equal(s.openai.assist_krw, 8400); assert.equal(s.openai.telegram_krw, 840); assert.equal(s.openai.krw, 9240);
  assert.equal(s.gemini.krw, 1400); assert.equal(s.gemini.transcript_krw, 1400); assert.equal(s.gemini.calls, 2);
  assert.deepEqual(s.warn, []);
  const reads = h.calls.filter(c => c.url.pathname.startsWith('/rest/v1/app_ai') || c.url.pathname.endsWith('app_feed_days'));
  assert.equal(reads.length, 4);
  for (const c of reads) { assert.equal(c.method, 'GET'); assert.equal(c.init.headers.Authorization, 'Bearer owner-jwt'); assert.equal(c.init.headers.apikey, 'anon'); }
  assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
  assert.equal((await harness({ missing: 'app_ai_cost_entries' }).get({ Authorization: 'Bearer owner-jwt' })).status, 404);
});

test('계산: 80% 경고, 잔액(충전일부터 쓴 만큼 빼기), 실제 청구 보정 비율', () => {
  const price = { input: 140, output: 700 };
  const rows = {
    assist: [{ day: '2026-10-05', input_tokens: 0, output_tokens: 18_000_000 }, { day: '2026-09-10', input_tokens: 0, output_tokens: 5_000_000 }],
    feed: [], external: [],
    entries: [
      { id: 'a', provider: 'openai', kind: 'topup', amount_krw: 20000, month: null, created_at: '2026-10-04T03:00:00Z' },
      { id: 'b', provider: 'openai', kind: 'bill', amount_krw: 7000, month: '2026-09-01', created_at: '2026-10-01T03:00:00Z' },
    ],
  };
  assert.equal(readStart(rows.entries, '2026-10-28'), '2026-09-01');
  const s = summarizeAiUsage(rows, now, price);
  // 9월 추정 3,500원, 청구 7,000원 → 비율 2. 10월 추정 12,600원(상한 15,000의 84% → 경고), 보정 25,200원.
  assert.equal(s.openai.estimate_krw, 12600); assert.equal(s.openai.ratio, 2); assert.equal(s.openai.krw, 25200);
  assert.deepEqual(s.openai.last_bill, { month: '2026-09', krw: 7000 });
  // 충전 20,000원(10/4) − 10/5 사용 12,600×2 → -5,200원(1만 원 아래 경고)
  assert.equal(s.openai.balance.left_krw, -5200); assert.equal(s.openai.balance.topup_on, '2026-10-04');
  assert.deepEqual(s.warn, ['openai_limit', 'openai_balance']);
  assert.equal(s.entries.length, 2); assert.equal(s.entries[0].id, 'a');
  // 이번 달 청구가 있으면 그 숫자(실제)
  const actual = summarizeAiUsage({ ...rows, entries: [...rows.entries, { id: 'c', provider: 'openai', kind: 'bill', amount_krw: 9999, month: '2026-10-01', created_at: '2026-10-28T01:00:00Z' }] }, now, price);
  assert.equal(actual.openai.krw, 9999); assert.equal(actual.openai.actual, true);
  // 단가 모르는 Gemini 모델은 비싼 단가로 세고 이름을 알림
  const g = summarizeAiUsage({ assist: [], feed: [], entries: [], external: [{ day: '2026-10-28', source: 'analysis', model: 'gemini-9-ultra', calls: 1, input_tokens: 1_000_000, audio_tokens: 0, output_tokens: 0 }] }, now, price);
  assert.equal(g.gemini.krw, 2800); assert.deepEqual(g.gemini.unknown_models, ['gemini-9-ultra']);
});
