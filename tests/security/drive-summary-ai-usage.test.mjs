import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../../supabase/functions/drive-summary/core.mjs';
import { parseAiUsageReport, summarizeAiUsage, openAiPrice, readStart, readAiUsage, usageKind } from '../../supabase/functions/drive-summary/ai-usage.mjs';
import * as model from '../../supabase/functions/_shared/ai-model.ts';
import * as prices from '../../supabase/functions/_shared/ai-prices.mjs';
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

test('단가·상한: ai-prices.mjs 값이 ai-model.ts·ai-assist·collector-feed 값과 같다', () => {
  assert.equal(prices.AI_MONTHLY_LIMIT_ASSIST_KRW, assist.MONTHLY_LIMIT_KRW);
  assert.equal(prices.AI_MONTHLY_LIMIT_FEED_KRW, feed.MONTHLY_LIMIT_KRW);
  assert.equal(prices.OPENAI_DEFAULT_IN_KRW, model.DEFAULT_PRICE_IN_KRW_PER_MTOK);
  assert.equal(prices.OPENAI_DEFAULT_OUT_KRW, model.DEFAULT_PRICE_OUT_KRW_PER_MTOK);
  assert.equal(model.DEFAULT_PRICE_IN_KRW_PER_MTOK, assist.DEFAULT_PRICE_IN_KRW_PER_MTOK);
  assert.equal(prices.geminiPrice('gemini-2.5-flash-lite-001').prefix, 'gemini-2.5-flash-lite');
  assert.equal(prices.geminiPrice('gemini-2.5-flash').prefix, 'gemini-2.5-flash');
  assert.equal(prices.geminiPrice('gemini-9-ultra'), null);
  // 2,000 글 + 10,000 음성 입력, 3,000 출력(flash): (2000*420 + 10000*1400 + 3000*3500) / 1e6
  assert.equal(Math.round(prices.geminiKrw('gemini-2.5-flash', 12000, 10000, 3000) * 1000) / 1000, 25.34);
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
  const reads = h.calls.filter(c => c.url.pathname.startsWith('/rest/v1/app_ai') || c.url.pathname.endsWith('app_feed_days') || c.url.pathname.endsWith('app_news_days'));
  assert.equal(reads.length, 5);
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

test('GET ?action=status도 같은 요약을 ai_usage 칸에 싣고, 표가 없으면 null로 두며 상태 답은 그대로 성공', async () => {
  for (const [data, expectNull] of [[{}, false], [{ missing: 'app_ai_cost_entries' }, true]]) {
    const calls = [];
    const fetcher = async (input, init = {}) => {
      const url = new URL(input), method = init.method || 'GET';
      calls.push({ url, method, init });
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'drive-token' });
      if (url.hostname === 'www.googleapis.com') return Response.json({ files: [] });
      if (url.pathname === '/auth/v1/user') return Response.json({ id: 'owner' });
      const table = url.pathname.split('/').at(-1);
      if (table === 'app_workspaces') return Response.json([{ id: 'ws' }]);
      if (table === 'app_workspace_members') return Response.json([{ user_id: 'owner', role: 'owner' }]);
      if (table === 'public_policy_drive_config') return Response.json([{ id: 1, google_client_id: 'c', google_client_secret: 's', google_refresh_token: 'r' }]);
      if (data.missing === table) return Response.json({}, { status: 404 });
      return Response.json([]);
    };
    const handler = createHandler({ env, fetcher, now: () => now });
    const r = await handler(new Request('https://edge.test/drive-summary?action=status', { headers: { Authorization: 'Bearer owner-jwt' } }));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    if (expectNull) assert.equal(body.ai_usage, null);
    else { assert.equal(body.ai_usage.ok, true); assert.equal(body.ai_usage.month, '2026-10'); }
    assert.equal(calls.filter(c => c.method !== 'GET' && !c.url.hostname.includes('google')).length, 0);
    for (const c of calls.filter(c => /app_ai_|app_feed_days/.test(c.url.pathname))) assert.equal(c.init.headers.apikey, 'anon');
  }
});

// AI-비용보기 2단계: 통화 전사(call-)·통화 분석(calla-)을 회의 전사(mtg-)와 나눠 센다.
test('보고 번호 앞머리: 회의(mtg-·mtgfail-)는 수집 비밀값으로 못 넣고, call-은 전사·calla-는 분석만', () => {
  const ok = { ...report };
  assert.equal(parseAiUsageReport(JSON.stringify({ ...ok, ref: 'call-0123456789abcdef', source: 'transcript' })).ref, 'call-0123456789abcdef');
  assert.equal(parseAiUsageReport(JSON.stringify({ ...ok, ref: 'calla-0123456789abcdef', source: 'analysis' })).source, 'analysis');
  for (const bad of [
    { ref: 'mtg-job-123456', source: 'transcript' }, { ref: 'mtgfail-job-123456', source: 'transcript' },
    { ref: 'call-0123456789abcdef', source: 'analysis' }, { ref: 'calla-0123456789abcdef', source: 'transcript' },
  ]) assert.equal(parseAiUsageReport(JSON.stringify({ ...ok, ...bad })), null, JSON.stringify(bad));
  assert.equal(usageKind('mtg-a', 'transcript'), 'meeting');
  assert.equal(usageKind('mtgfail-a', 'transcript'), 'meeting');
  assert.equal(usageKind('call-a', 'transcript'), 'call_transcript');
  assert.equal(usageKind('calla-a', 'analysis'), 'call_analysis');
  assert.equal(usageKind('gm-a', 'analysis'), 'other_analysis');
  assert.equal(usageKind(undefined, 'transcript'), 'other_transcript');
});

test('요약: 회의 전사·통화 전사·통화 분석을 by_kind로 나누고, 옛 칸(transcript_krw·analysis_krw)은 합으로 그대로', () => {
  const row = (ref, source) => ({ day: '2026-10-28', ref, source, model: 'gemini-2.5-flash', calls: 1, input_tokens: 1_000_000, audio_tokens: 1_000_000, output_tokens: 0 });
  const s = summarizeAiUsage({ assist: [], feed: [], entries: [], external: [row('mtg-a-1', 'transcript'), row('mtgfail-a-2', 'transcript'), row('call-x1', 'transcript'), row('calla-x1', 'analysis'), row('gm-old', 'analysis')] }, now, openAiPrice({}));
  assert.deepEqual(s.gemini.by_kind, { meeting: 2800, call_transcript: 1400, call_analysis: 1400, other_transcript: 0, other_analysis: 1400 });
  assert.equal(s.gemini.transcript_krw, 4200);
  assert.equal(s.gemini.analysis_krw, 2800);
  assert.equal(s.gemini.krw, 7000);
});

test('외부 보고 읽기: 1000행이 넘으면 offset으로 다음 쪽을 읽고, ref 칸을 함께 읽는다', async () => {
  const urls = [];
  const many = Array.from({ length: 1000 }, (_, i) => ({ day: '2026-10-28', ref: `call-${String(i).padStart(8, '0')}`, source: 'transcript', model: 'gemini-2.5-flash', calls: 1, input_tokens: 0, audio_tokens: 0, output_tokens: 0 }));
  const fetcher = async input => {
    const url = new URL(input); urls.push(url);
    const table = url.pathname.split('/').at(-1);
    if (table !== 'app_ai_external_usage') return Response.json([]);
    return Response.json(url.searchParams.get('offset') === '0' ? many : many.slice(0, 5));
  };
  const rows = await readAiUsage({ fetcher, baseUrl: 'https://db.test', anonKey: 'anon', userAuthorization: 'Bearer owner-jwt', workspaceId: 'ws', now });
  assert.equal(rows.external.length, 1005);
  const ext = urls.filter(u => u.pathname.endsWith('app_ai_external_usage'));
  assert.deepEqual(ext.map(u => u.searchParams.get('offset')), ['0', '1000']);
  assert.match(ext[0].searchParams.get('select'), /(^|,)ref(,|$)/);
  // 20쪽을 모두 채우면 잘린 숫자 대신 실패
  const full = async input => Response.json(new URL(input).pathname.endsWith('app_ai_external_usage') ? many : []);
  await assert.rejects(readAiUsage({ fetcher: full, baseUrl: 'https://db.test', anonKey: 'anon', userAuthorization: 'Bearer owner-jwt', workspaceId: 'ws', now }), /AI_USAGE_READ_FAILED/);
});

// AI-비용보기 3단계: 뉴스·번역 합산과 '얼마를 언제 충전' 계산(설계 4절).
test('뉴스·사회운동 [번역](app_news_days)을 OpenAI에 더하고 news_krw·상한 80% 경고를 낸다', async () => {
  const price = { input: 140, output: 700 };
  const s = summarizeAiUsage({ assist: [], feed: [], external: [], entries: [], news: [{ day: '2026-10-28', ai_requests: 3, ai_input_tokens: 1_000_000, ai_output_tokens: 1_000_000 }] }, now, price);
  assert.equal(s.openai.news_krw, 840); assert.equal(s.openai.krw, 840); assert.equal(s.openai.requests, 3);
  assert.equal(s.openai.limit_news_krw, prices.AI_MONTHLY_LIMIT_NEWS_KRW);
  assert.deepEqual(s.warn, []);
  const w = summarizeAiUsage({ assist: [], feed: [], external: [], entries: [], news: [{ day: '2026-10-28', ai_requests: 1, ai_input_tokens: 0, ai_output_tokens: 6_000_000 }] }, now, price);
  assert.deepEqual(w.warn, ['news_limit']);
  // 읽기: 소유자 토큰으로 app_news_days 하루 줄만(숫자 칸만)
  const h = harness({ app_news_days: [{ day: '2026-10-28', ai_requests: 1, ai_input_tokens: 0, ai_output_tokens: 1_000_000 }] });
  const r = await (await h.get({ Authorization: 'Bearer owner-jwt' })).json();
  assert.equal(r.openai.news_krw, 700);
  const nr = h.calls.find(c => c.url.pathname.endsWith('app_news_days'));
  assert.equal(nr.init.headers.Authorization, 'Bearer owner-jwt');
  assert.equal(nr.url.searchParams.get('select'), 'day,ai_requests,ai_input_tokens,ai_output_tokens');
});

test('뉴스 월 상한 값은 _shared/news-days.ts MONTHLY_LIMIT_KRW와 같다', async () => {
  const news = await import('../../supabase/functions/_shared/news-days.ts');
  assert.equal(prices.AI_MONTHLY_LIMIT_NEWS_KRW, news.MONTHLY_LIMIT_KRW);
});

test('예측: 14일 평균·월말 예상·OpenAI 권장 자동 충전·잔액 기준·Gemini 한도 도달일·권장 한도·경고 순서', () => {
  const price = { input: 140, output: 700 };
  const assist = [];
  for (let d = 14; d <= 28; d++) assist.push({ day: `2026-10-${d}`, input_tokens: 0, output_tokens: 1_000_000 }); // 하루 700원
  const external = [{ day: '2026-10-20', ref: 'call-aaaaaaaa', source: 'transcript', model: 'gemini-2.5-flash', calls: 1, input_tokens: 1_000_000, audio_tokens: 1_000_000, output_tokens: 0 }]; // 1,400원
  const entries = [
    { id: 'r', provider: 'openai', kind: 'reload', amount_krw: 2000, month: null, created_at: '2026-10-01T00:00:00Z' },
    { id: 'c', provider: 'gemini', kind: 'cap', amount_krw: 1500, month: null, created_at: '2026-10-01T00:00:00Z' },
    { id: 'b', provider: 'gemini', kind: 'bill', amount_krw: 3000, month: '2026-09-01', created_at: '2026-10-01T00:00:00Z' },
  ];
  const s = summarizeAiUsage({ assist, feed: [], news: [], external, entries }, now, price);
  const o = s.forecast.openai, g = s.forecast.gemini;
  // 10/14~10/27(오늘 10/28 뺌) 14일 × 700 ÷ 14 = 700. 지금까지 15일 10,500 + 남은 3일 × 700 = 12,600.
  assert.deepEqual({ avg: o.daily_avg_krw, end: o.month_end_krw, rem: o.remaining_days }, { avg: 700, end: 12600, rem: 3 });
  assert.equal(o.suggest_reload_krw, 10000);   // 12,600 ÷ 2 = 6,300 → 1만 원 단위 올림
  assert.equal(o.suggest_threshold_krw, 3000); // 최근 7일 최대 700 × 3 = 2,100 → 1천 원 단위 올림
  assert.equal(o.reload_krw, 2000); assert.equal(o.reloads_per_month, 6.3);
  // Gemini: 평균 1,400 ÷ 14 = 100, 지금까지 1,400 → 한도 1,500까지 1일 → 10/29(이번 달 안)
  assert.deepEqual({ avg: g.daily_avg_krw, end: g.month_end_krw, days: g.days_to_cap, day: g.cap_day }, { avg: 100, end: 1700, days: 1, day: '2026-10-29' });
  assert.equal(g.suggest_cap_krw, 4000); // max(1,700×1.3, 9월 3,000×1.2=3,600) → 4,000
  assert.equal(g.raise_cap, true);
  assert.deepEqual(s.warn, ['gemini_cap', 'openai_reload_often']);
  // 한도·자동 충전 금액이 없으면(4단계 DB 전) 권장값만, 경고 없음
  const bare = summarizeAiUsage({ assist, feed: [], news: [], external, entries: [] }, now, price);
  assert.equal(bare.forecast.openai.reloads_per_month, null); assert.equal(bare.forecast.gemini.cap_day, null);
  assert.equal(bare.forecast.gemini.suggest_cap_krw, 3000); // 1,700 × 1.3 = 2,210 → 3,000
  assert.deepEqual(bare.warn, []);
});

test('예측: 달 초에는 지난달 끝을 이어 14일 평균, 읽기 시작일도 14일 전까지', () => {
  const early = new Date('2026-11-03T05:00:00Z');
  assert.equal(readStart([], '2026-11-03'), '2026-10-20');
  const s = summarizeAiUsage({ assist: [{ day: '2026-10-25', input_tokens: 0, output_tokens: 1_000_000 }, { day: '2026-10-10', input_tokens: 0, output_tokens: 9_000_000 }], feed: [], news: [], external: [], entries: [] }, early, { input: 140, output: 700 });
  assert.equal(s.forecast.openai.daily_avg_krw, 50); // 10/20~11/2 안의 700원만 ÷ 14
  assert.equal(s.forecast.openai.remaining_days, 27);
  assert.equal(s.forecast.openai.month_end_krw, 1350); // 이번 달 0 + 27 × 50
  assert.equal(s.openai.krw, 0);
});
