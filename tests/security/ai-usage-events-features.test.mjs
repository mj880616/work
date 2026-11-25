import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import {
  AI_FEATURES, AI_ASSIST_KIND_FEATURES, FUNCTION_FEATURES, featureOfKind, aiUsageEventRow, recordAiUsageEvent, usageModelName, insertWithClient,
} from '../../supabase/functions/_shared/ai-features.mjs';
import { createAiUsageMeter, recordAiDailyUsage, addAiRequest } from '../../supabase/functions/_shared/ai-daily-usage.mjs';
import { DAILY_LIMITS } from '../../supabase/functions/ai-assist/handler.ts';

// S70-55 I-3 AI-비용보기 5단계: 모든 AI 부르는 곳이 기능 키를 넘겨 app_ai_usage_events에 1행씩 넣는지(목록과 실제 호출 대조),
// 행에 내용 칸이 없는지, 기록이 실패해도 본 작업이 막히지 않는지.
const FN = new URL('../../supabase/functions/', import.meta.url);
const read = p => readFileSync(new URL(p, FN), 'utf8');
const MIGRATION = readFileSync(new URL('../../supabase/migrations/20261125235000_ai_usage_events.sql', import.meta.url), 'utf8');
const WS = 'a0000000-0000-4000-8000-000000000001';
const count = (src, re) => (src.match(re) || []).length;

function sourcesOf(dir) {
  const out = [];
  for (const name of readdirSync(new URL(dir, FN))) {
    const rel = `${dir}${name}`;
    if (statSync(new URL(rel, FN)).isDirectory()) out.push(...sourcesOf(`${rel}/`));
    else if (/\.(ts|mjs|js)$/.test(name) && !/\.test\./.test(name)) out.push(rel);
  }
  return out;
}

test('기능 키 목록 = DB check 제약 목록(한 곳)', () => {
  const m = /app_ai_usage_events_feature_check check \(feature in\s*\(([^)]*)\)\)/.exec(MIGRATION);
  assert.ok(m, 'migration feature check');
  const db = [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
  assert.deepEqual([...AI_FEATURES], db);
  for (const f of [...Object.values(AI_ASSIST_KIND_FEATURES), ...Object.values(FUNCTION_FEATURES)]) assert.ok(AI_FEATURES.includes(f), f);
});

test('ai-assist: 쓰임(DAILY_LIMITS) 전부가 기능 키 표에 있고, 표에 없는 쓰임은 없다', () => {
  assert.deepEqual(Object.keys(DAILY_LIMITS).sort(), Object.keys(AI_ASSIST_KIND_FEATURES).sort());
  assert.equal(featureOfKind('link_summary'), 'journal');
  assert.equal(featureOfKind('ask_web2'), 'ask');
  assert.equal(featureOfKind('toString'), 'other', 'prototype 이름은 기능 키가 아니다');
  assert.equal(featureOfKind(undefined), 'other');
});

test('ai-assist: AI를 부르는 쓰임마다 checkBudget(쓰임) → 부른 뒤 writeUsageAfterAi(기능별 1행)로 한 번씩', () => {
  const files = sourcesOf('ai-assist/');
  const all = files.map(f => [f, read(f)]);
  const handler = read('ai-assist/handler.ts');
  // 이 폴더에서 OpenAI를 직접 부르는 곳은 handler.ts의 callOpenAi 한 곳(공용 모듈)뿐이다.
  for (const [f, src] of all) {
    if (f === 'ai-assist/handler.ts') continue;
    assert.doesNotMatch(src, /api\.openai\.com|callSharedOpenAi|callOpenAi\(/, `${f}는 handler의 kit.ai만 쓴다`);
  }
  const budgets = count(handler, /\bcheckBudget\(ctx, /g) - 1; // 정의 한 줄 빼기
  const after = count(handler, /\bwriteUsageAfterAi\(ctx, /g) - 1;
  assert.ok(budgets >= 25, `checkBudget ${budgets}`);
  assert.equal(after, budgets, '한도 확인한 곳마다 부른 뒤 기능별 기록');
  assert.equal(count(handler, /writeUsage\(ctx, budget\.day, budget\.requests \+ 1, budget\.input \+ used\.input/g), 1,
    '부른 뒤 쓴 토큰을 더하는 곳은 writeUsageAfterAi 안 한 곳뿐(기능 키 없이 더하는 옛 길이 남지 않음)');
  for (const [, kind] of handler.matchAll(/checkBudget\(ctx, "([a-z_]+)"/g)) assert.ok(kind in AI_ASSIST_KIND_FEATURES, kind);
  // Now 상세(now-detail.ts)는 kit.usageAfterAi로 같은 길.
  const now = read('ai-assist/now-detail.ts');
  assert.equal(count(now, /kit\.usageAfterAi\(budget, \{ input, output, calls \}, config\.model\)/g), 1);
  assert.match(handler, /usageAfterAi: \(budget, used, model\) => writeUsageAfterAi\(ctx, budget, used, model, d\.now\(\)\)/);
  assert.match(handler, /feature: featureOfKind\(budget\.kind\)/);
});

// ai-assist 밖: OpenAI를 부르는 폴더 = FUNCTION_FEATURES 목록(빠짐도 남는 것도 없음). 폴더마다 실제 호출 수와 기록 수를 대조한다.
test('ai-assist 밖 AI 부르는 함수 목록 = FUNCTION_FEATURES, 폴더마다 기능 키를 넘긴다', () => {
  const callers = new Set();
  for (const dir of readdirSync(FN)) {
    if (dir.startsWith('_') || dir === 'ai-assist' || !statSync(new URL(dir, FN)).isDirectory()) continue;
    for (const f of sourcesOf(`${dir}/`)) {
      const src = read(f);
      if (/api\.openai\.com|\bcallOpenAi\(/.test(src)) callers.add(dir);
    }
  }
  // _shared 안에서 직접 OpenAI를 부르는 곳은 없다(부르는 쪽 함수의 askAi를 받아 쓴다).
  for (const f of sourcesOf('_shared/')) {
    if (f === '_shared/openai-responses.ts' || f === '_shared/ai-features.mjs') continue;
    assert.doesNotMatch(read(f), /api\.openai\.com|fetch\([^)]*openai/i, f);
  }
  assert.deepEqual([...callers].sort(), Object.keys(FUNCTION_FEATURES).sort());
  for (const dir of callers) {
    const src = sourcesOf(`${dir}/`).map(read).join('\n');
    assert.ok(src.includes(`FUNCTION_FEATURES['${dir}']`) || src.includes(`FUNCTION_FEATURES["${dir}"]`), `${dir}: 자기 이름으로 기능 키`);
  }
});

test('폴더별 호출 수 = 기능별 기록 수(목록과 실제 호출 대조)', () => {
  // 미터 길: 모든 fetch가 meter.add, 모든 recordAiDailyUsage가 feature:AI_FEATURE.
  for (const dir of ['library-files', 'meeting-ai-ingest', 'document-ai-index']) {
    const src = read(`${dir}/index.ts`);
    assert.match(src, new RegExp(`const AI_FEATURE=FUNCTION_FEATURES\\['${dir}'\\];`));
    const rec = count(src, /recordAiDailyUsage\(admin,\{/g);
    assert.ok(rec >= 1);
    assert.equal(count(src, /recordAiDailyUsage\(admin,\{[^}]*feature:AI_FEATURE,meter\}\)/g), rec, `${dir}: 기록마다 기능 키`);
    assert.equal(count(src, /fetch\('https:\/\/api\.openai\.com\/v1\/responses'/g), count(src, /meter\.add\(d\)/g));
  }
  // addAiRequest 길: 부른 뒤(usage를 넘기는) 기록은 모두 feature·model을 넘긴다.
  for (const f of ['meeting-ai-draft/index.ts', 'page-ai-draft/index.ts', 'meeting-transcribe/index.ts', 'library-files/index.ts']) {
    const src = read(f);
    for (const [call] of src.matchAll(/addAiRequest\(admin, ?\{[^}]*\}/g)) {
      if (/usage:/.test(call)) assert.match(call, /feature: ?AI_FEATURE,/, `${f}: ${call}`);
      if (/usage:/.test(call)) assert.match(call, /model:/, `${f}: ${call}`);
    }
  }
  for (const f of ['meeting-ai-draft/index.ts', 'page-ai-draft/index.ts']) {
    const src = read(f);
    assert.equal(count(src, /fetch\('https:\/\/api\.openai\.com\/v1\/responses'/g), 1);
    const uses = count(src, /recordUsage\([^)]*\)/g) - 1;
    assert.ok(uses >= 1);
    assert.equal(count(src, /recordUsage\([A-Za-z_.]+,user\.id,r\.usage,r\.model\)/g), uses, `${f}: 부른 뒤 기록마다 모델`);
  }
  {
    const src = read('meeting-transcribe/index.ts');
    assert.equal(count(src, /fetch\('https:\/\/api\.openai\.com\/v1\/responses'/g), 1);
    assert.equal(count(src, /usage: u, feature: AI_FEATURE, model: d\.model \}/g), 1);
  }
  // 공용 callOpenAi 길.
  {
    const src = read('collector-feed/handler.ts');
    assert.equal(count(src, /await callOpenAi\(/g), 2);
    assert.equal(count(src, /await recordAiEvent\(db, ws, today, config\.model, usage, deps\.log\);/g), 2);
  }
  {
    const src = read('document-actions/brief.ts');
    assert.equal(count(src, /await callOpenAi\(/g), 1);
    assert.equal(count(src, /await recordAiUsageEvent\(/g), 1);
    assert.match(src, /feature: FUNCTION_FEATURES\["document-actions"\]/);
  }
  {
    const src = read('news-feed/handler.ts');
    assert.equal(count(src, /await callOpenAi\(/g), 1, 'askAi 한 곳');
    const asks = count(src, /await askAi\(/g);
    const days = count(src, /addDay\([^;]*ai_requests: 1, ai_input_tokens/g);
    assert.equal(asks, 3); assert.equal(days, asks, 'AI 부른 곳마다 하루 숫자');
    assert.equal(count(src, /await recordAiEvent\(db, /g), asks, 'AI 부른 곳마다 기능별 1행');
  }
  {
    const src = read('outside-feed/handler.ts');
    assert.equal(count(src, /await callOpenAi\(/g), 1, 'askAi 한 곳');
    const names = [...src.matchAll(/await askAi\([^,]+, "([a-z_]+)"/g)].map(m => m[1]);
    // 예약 수집의 요약·소개(여러 작업공간 공용, 지금도 하루 숫자에 안 셈)는 기록하지 않는다 — PR '범위 밖 발견사항'.
    const NOT_RECORDED = ['outside_ko_summary', 'outside_ko_summary', 'outside_en_intro'];
    assert.deepEqual(names.filter(n => !['outside_translate', 'outside_expand'].includes(n)), NOT_RECORDED);
    assert.equal(count(src, /await recordAiEvent\(db, /g), 2, '[번역]·찾는 말 넓히기');
    assert.match(src, /"outside_expand", EXPAND_INSTRUCTIONS, query, EXPAND_SCHEMA, 200,\s*\{ onUsage:/);
  }
});

test('행에는 내용 칸이 없다: 넣는 칸 = migration의 넣기 grant 칸 8개', () => {
  const g = /grant insert \(([^)]*)\)\s*on table public\.app_ai_usage_events to service_role;/.exec(MIGRATION);
  assert.ok(g);
  const cols = g[1].split(',').map(s => s.trim());
  const row = aiUsageEventRow({
    workspaceId: WS.toUpperCase(), day: '2026-11-26', feature: 'meeting', model: 'GPT-6-Luna', calls: 2, input: 100, output: 20,
    text: '회의 원문', prompt: '지시문', fileName: '비밀.hwp', userId: 'u-1',
  });
  assert.deepEqual(Object.keys(row).sort(), [...cols].sort());
  assert.deepEqual(row, { workspace_id: WS, day: '2026-11-26', feature: 'meeting', provider: 'openai', model: 'gpt-6-luna', calls: 2, input_tokens: 100, output_tokens: 20 });
  assert.doesNotMatch(JSON.stringify(row), /회의|지시|비밀|u-1/);
  // 표에도 글 칸이 없다.
  const table = /create table public\.app_ai_usage_events \(([\s\S]*?)\n\);/.exec(MIGRATION)[1];
  assert.doesNotMatch(table, /\b(text|prompt|answer|content|title|file_name|user_id)\b\s+text/);
});

test('행 모양 검사: 잘못된 값은 넣지 않거나 안전한 값으로', () => {
  assert.equal(aiUsageEventRow({ workspaceId: 'ws-1', feature: 'ask', input: 1 }), null, '작업공간 id 모양이 아니면 넣지 않음');
  assert.equal(aiUsageEventRow({ workspaceId: WS, feature: 'ask', calls: 0 }), null, '부른 것도 토큰도 없으면 넣지 않음');
  const r = aiUsageEventRow({ workspaceId: WS, nowMs: Date.parse('2026-11-25T16:00:00Z'), feature: 'nope', model: 'bad model!', calls: -1, input: 1.5, output: 3 });
  assert.equal(r.day, '2026-11-26', '서울 날짜');
  assert.equal(r.feature, 'other');
  assert.equal(r.model, 'unknown');
  assert.deepEqual([r.calls, r.input_tokens, r.output_tokens], [0, 0, 3]);
  assert.equal(usageModelName('models/gemini-2.5-flash'), 'gemini-2.5-flash');
  assert.equal(usageModelName('x'.repeat(65)), 'unknown');
});

test('기록 실패는 던지지 않는다: insert가 던지거나 false·로그 함수가 던져도 failed만', async () => {
  const logs = [];
  const opts = { workspaceId: WS, feature: 'news', model: 'm', calls: 1, input: 5, output: 1 };
  assert.equal(await recordAiUsageEvent(async () => { throw new Error('secret db detail'); }, opts, (c, d) => logs.push([c, d])), 'failed');
  assert.equal(await recordAiUsageEvent(async () => false, opts, (c, d) => logs.push([c, d])), 'failed');
  assert.equal(await recordAiUsageEvent(async () => { throw new Error('x'); }, opts, () => { throw new Error('log down'); }), 'failed');
  assert.deepEqual(logs, [['ai_usage_event_failed', { feature: 'news' }], ['ai_usage_event_failed', { feature: 'news' }]]);
  const got = [];
  assert.equal(await recordAiUsageEvent(async row => { got.push(row); }, opts, () => {}), 'recorded');
  assert.equal(got.length, 1);
  const miss = [];
  assert.equal(await recordAiUsageEvent(async () => {}, { ...opts, feature: undefined }, c => miss.push(c)), 'recorded');
  assert.deepEqual(miss, ['ai_feature_missing'], '기능 키가 빠지면 other로 남기고 알림');
});

// supabase-js 흉내: from(table).insert / select…maybeSingle / upsert
function fakeAdmin({ eventError = null, eventThrow = false } = {}) {
  const calls = { events: [], upserts: [] };
  const admin = {
    from(table) {
      if (table === 'app_ai_usage_events') return {
        insert: async row => { if (eventThrow) throw new Error('network'); calls.events.push(row); return { error: eventError }; },
      };
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }),
        upsert: async row => { calls.upserts.push(row); return { error: null }; } };
      return q;
    },
  };
  return { admin, calls };
}

test('recordAiDailyUsage·addAiRequest: 하루 행과 기능별 1행을 따로 — 기능별 실패해도 하루 행은 recorded', async () => {
  const meter = createAiUsageMeter();
  meter.add({ model: 'gpt-6-luna-2026', usage: { input_tokens: 30, output_tokens: 7 } });
  meter.add({ usage: { input_tokens: 10, output_tokens: 3 } });
  assert.equal(meter.model, 'gpt-6-luna-2026');
  {
    const { admin, calls } = fakeAdmin();
    assert.equal(await recordAiDailyUsage(admin, { workspaceId: WS, userId: 'u-1', feature: 'library', meter, log: () => {} }), 'recorded');
    assert.equal(calls.upserts.length, 1);
    assert.deepEqual(calls.events.map(e => [e.feature, e.model, e.calls, e.input_tokens, e.output_tokens]), [['library', 'gpt-6-luna-2026', 2, 40, 10]]);
  }
  for (const o of [{ eventError: { code: '42501', message: 'secret' } }, { eventThrow: true }]) {
    const { admin, calls } = fakeAdmin(o);
    const logs = [];
    assert.equal(await recordAiDailyUsage(admin, { workspaceId: WS, userId: 'u-1', feature: 'library', meter, log: c => logs.push(c) }), 'recorded');
    assert.equal(calls.upserts.length, 1);
    assert.deepEqual(logs, ['ai_usage_event_failed']);
  }
  {
    const { admin, calls } = fakeAdmin();
    assert.equal(await addAiRequest(admin, { workspaceId: WS, userId: 'u-1', day: '2026-11-26', row: null, usage: { input_tokens: 9, output_tokens: 2 }, feature: 'meeting', model: 'gpt-6-luna' }), 'recorded');
    assert.deepEqual(calls.events, [{ workspace_id: WS, day: '2026-11-26', feature: 'meeting', provider: 'openai', model: 'gpt-6-luna', calls: 1, input_tokens: 9, output_tokens: 2 }]);
  }
  {
    // 부르기 전 횟수만 셀 때(usage 없음)는 기능별 행을 넣지 않는다.
    const { admin, calls } = fakeAdmin();
    await addAiRequest(admin, { workspaceId: WS, userId: 'u-1', day: '2026-11-26', row: null });
    assert.equal(calls.events.length, 0);
  }
  {
    const { admin } = fakeAdmin({ eventThrow: true });
    await assert.doesNotReject(insertWithClient(admin)({}).catch(() => {}));
  }
});

test('한도 판정은 그대로: 공용 기록 모듈은 기능별 표를 읽지 않는다', () => {
  const daily = read('_shared/ai-daily-usage.mjs');
  const feat = read('_shared/ai-features.mjs');
  assert.doesNotMatch(feat, /\.select\(|method: "GET"|\.rpc\(/);
  assert.doesNotMatch(daily, /app_ai_usage_events'\)\.select/);
  const handler = read('ai-assist/handler.ts');
  assert.doesNotMatch(handler, /app_ai_usage_events\?/, 'ai-assist는 기능별 표를 읽지 않는다(넣기만)');
  assert.ok(existsSync(new URL('_shared/ai-features.mjs', FN)));
});
