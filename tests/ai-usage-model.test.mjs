import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSummary, warnText, summaryLine, periodOf, titleText, monthEnd, providerMonthEnd, featureRows, featureTotal, featureSummary, limitLine, providerRows, parseAmount, changedEntries, savedAmounts } from '../app/ai-usage-model.mjs';
import { summarizeAiUsage } from '../supabase/functions/drive-summary/ai-usage.mjs';

// AI-비용보기 6단계: 프로필 'AI 비용' 줄의 글 만들기. 쓰기는 한도·자동 충전 금액(서버 표)뿐이고 기기에 저장하지 않는다.
const at = iso => Date.parse(iso);
const NOW = at('2026-10-28T05:00:00Z'); // 서울 10/28 14:00
const s = {
  ok: true, month: '2026-10', warn: [],
  openai: { krw: 393, estimate_krw: 393, ratio: null, actual: false, assist_krw: 156, telegram_krw: 237, call_krw: 0, limit_assist_krw: 15000, limit_feed_krw: 6000,
    balance: { topup_krw: 30000, topup_on: '2026-10-04', left_krw: 29607 }, last_bill: { month: '2026-09', krw: 7000 } },
  gemini: { krw: 0, estimate_krw: 0, ratio: null, actual: false, transcript_krw: 0, analysis_krw: 0, calls: 0, unknown_models: [], balance: null, last_bill: null },
  entries: [{ id: '00000000-0000-4000-8000-000000000001', provider: 'openai', kind: 'topup', amount_krw: 30000, month: null, created_at: '2026-10-04T03:00:00Z' }],
};
test('모양이 틀린 답은 숨김(null)', () => {
  assert.equal(readSummary(null), null); assert.equal(readSummary({ ok: false }), null); assert.equal(readSummary({ ok: true, month: '10월' }), null);
  assert.equal(readSummary(s), s);
});
test('맨 위 기간·요약·월말 예상(옛 서버 답: 단순 비례)', () => {
  assert.equal(titleText(s, NOW), 'AI 비용 · 10월 1일~28일 (이번 달, 추정)');
  assert.equal(monthEnd(s, NOW), 440); // 393 ÷ 28일 × 31일 = 435 → 10원 단위
  assert.equal(summaryLine(s, NOW), 'OpenAI 393원 · Gemini 0원 · 월말 약 440원');
});
test('기간: 서울 날짜 기준, 매달 1일부터 다시 셈', () => {
  // 서울 11/1 00:30(UTC 10/31 15:30)은 11월 첫날
  assert.deepEqual(periodOf('2026-11', at('2026-10-31T15:30:00Z')), { month: 11, end: 1, days: 30, current: true });
  assert.equal(titleText({ ...s, month: '2026-11' }, at('2026-10-31T15:30:00Z')), 'AI 비용 · 11월 1일 (이번 달, 추정)');
  // 서울 10/31 23:59(UTC 14:59)는 아직 10월 31일
  assert.deepEqual(periodOf('2026-10', at('2026-10-31T14:59:00Z')), { month: 10, end: 31, days: 31, current: true });
  // 지난 달 답(달이 바뀐 직후 옛 답)이면 그 달 전체, 월말 예상은 빼고 '이번 달'도 뺀다
  assert.equal(titleText(s, at('2026-11-02T01:00:00Z')), 'AI 비용 · 10월 1일~31일 (추정)');
  assert.equal(monthEnd(s, at('2026-11-02T01:00:00Z')), null);
  assert.equal(summaryLine(s, at('2026-11-02T01:00:00Z')), 'OpenAI 393원 · Gemini 0원');
  assert.equal(periodOf('2027-02', at('2027-02-10T00:00:00Z')).days, 28);
});
test('서버 셈도 서울 달 첫날부터 다시 0원(지난 달 사용은 더하지 않음)', () => {
  const price = { input: 1000, output: 1000 }; // 100만 토큰당 원
  const rows = { assist: [{ day: '2026-10-31', requests: 1, input_tokens: 1_000_000, output_tokens: 0 }, { day: '2026-11-01', requests: 1, input_tokens: 2_000_000, output_tokens: 0 }], feed: [], external: [], entries: [] };
  const oct = summarizeAiUsage(rows, new Date('2026-10-31T14:59:00Z'), price);
  const nov = summarizeAiUsage(rows, new Date('2026-10-31T15:00:00Z'), price);
  assert.equal(oct.month, '2026-10'); assert.equal(nov.month, '2026-11');
  assert.equal(oct.openai.assist_krw, 1000); assert.equal(nov.openai.assist_krw, 2000);
  const fresh = summarizeAiUsage({ ...rows, assist: rows.assist.slice(0, 1) }, new Date('2026-10-31T15:00:00Z'), price);
  assert.equal(fresh.openai.krw, 0);
});
test('경고 문장: 월 상한 80%만, 잔액 경고는 쓰지 않음', () => {
  assert.equal(warnText(s), '');
  assert.match(warnText({ ...s, warn: ['openai_limit'] }), /^WORK ON\+ AI 이번 달 상한 80% 넘음/);
  assert.equal(warnText({ ...s, warn: ['openai_balance'] }), '');
  assert.match(warnText({ ...s, warn: ['openai_balance', 'feed_limit'] }), /^텔레그램·통화 판정 상한 80% 넘음 \(237원 \/ 6,000원\)$/);
  assert.equal(warnText({ ...s, warn: ['openai_limit', 'gemini_balance', 'feed_limit'] }).endsWith(' 외 1건'), true);
});
test('화면 파일은 기기 저장을 하지 않고, 쓰기는 한도·자동 충전(cap·reload) 넣기 하나뿐', () => {
  const line = readFileSync(new URL('../app/ai-usage-line.js', import.meta.url), 'utf8'), mdl = readFileSync(new URL('../app/ai-usage-model.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(line + mdl, new RegExp(['local', 'session'].map(w => w + 'Storage').concat(['indexed' + 'DB']).join('|')));
  assert.equal((line.match(/rt\.api\(/g) || []).length, 1);
  assert.match(line, /rt\.api\('\/rest\/v1\/app_ai_cost_entries', \{method:'POST'/);
  assert.doesNotMatch(line + mdl, /method:\s*'(DELETE|PATCH)'|kind:\s*'(topup|bill)'/);
  assert.doesNotMatch(mdl, /rt\.api|fetch\(/);
});

// 월말 예상: 서버 forecast(14일 평균)가 있으면 그 값. 지금까지보다 작아지지 않는다.
const f = { ...s, month: '2026-11',
  openai: { ...s.openai, krw: 9100, estimate_krw: 9100, assist_krw: 5000, telegram_krw: 2000, call_krw: 100, news_krw: 1000, limit_news_krw: 5000,
    by_feature: { ledger: 2400, journal: 1500, telegram: 600, news: 300, mystery: 100 }, features_from: '2026-11-26' },
  gemini: { ...s.gemini, krw: 41600, estimate_krw: 41600, transcript_krw: 37500, analysis_krw: 4100,
    by_kind: { meeting: 6300, call_transcript: 31200, call_analysis: 4100, other_transcript: 0, other_analysis: 0 } },
  forecast: {
    openai: { daily_avg_krw: 700, month_end_krw: 22600, reload_krw: 20000, reloads_per_month: 1.1, suggest_reload_krw: 20000, suggest_threshold_krw: 3000 },
    gemini: { daily_avg_krw: 3000, month_end_krw: 104000, cap_krw: 80000, days_to_cap: 12, cap_day: '2026-11-24', suggest_cap_krw: 136000, raise_cap: true },
  },
  warn: ['gemini_cap', 'openai_limit'] };
const NOV12 = at('2026-11-12T05:00:00Z');
test('월말 예상 계산: 서버 forecast 우선, 공급자 합, 지금까지보다 작지 않음', () => {
  assert.equal(providerMonthEnd(f, 'openai', NOV12), 22600);
  assert.equal(providerMonthEnd(f, 'gemini', NOV12), 104000);
  assert.equal(monthEnd(f, NOV12), 126600);
  assert.equal(summaryLine(f, NOV12), 'OpenAI 9,100원 · Gemini 41,600원 · 월말 약 126,600원');
  const low = { ...f, forecast: { ...f.forecast, gemini: { ...f.forecast.gemini, month_end_krw: 10 } } };
  assert.equal(providerMonthEnd(low, 'gemini', NOV12), 41600);
  // forecast가 없는 공급자만 단순 비례: 41,600 ÷ 12 × 30 = 104,000
  const half = { ...f, forecast: { openai: f.forecast.openai } };
  assert.equal(providerMonthEnd(half, 'gemini', NOV12), 104000);
  // 지난 달 답이면 월말 예상 없음
  assert.equal(monthEnd(f, at('2026-12-02T01:00:00Z')), null);
});
test('기능별 합: 두 공급자 추정 합과 같고, 큰 순·0원 뺌·모르는 키는 그 밖·그 전 사용은 기능 구분 전', () => {
  const rows = featureRows(f);
  assert.equal(featureTotal(rows), 9100 + 41600);
  assert.deepEqual(rows.map(r => [r.label, r.krw]), [
    ['통화 전사', 31200], ['회의 녹음 전사', 6300], ['기능 구분 전(11월 26일 전)', 4200], ['통화 분석', 4100],
    ['원장 자동 기록', 2400], ['업무일지·정리', 1500], ['텔레그램·통화 판정', 600], ['뉴스·번역', 300], ['그 밖', 100],
  ]);
  assert.equal(featureSummary(rows), '기능별 9개 · 가장 큰 곳 통화 전사 31,200원');
  // 옛 서버(by_feature·by_kind 없음): OpenAI 세 줄 + Gemini 한 줄, 합은 같음
  const old = featureRows({ ...f, openai: { ...f.openai, by_feature: null }, gemini: { ...f.gemini, by_kind: undefined } });
  assert.equal(featureTotal(old), 5000 + 2100 + 1000 + 41600);
  assert.ok(old.some(r => /기능 구분 전/.test(r.label)));
  assert.equal(featureSummary([]), '기능별 · 아직 없음');
  assert.match(limitLine(f), /^서버 상한 · WORK ON\+ AI 5,000원\/15,000원 · 판정 2,100원\/6,000원 · 번역 1,000원\/5,000원$/);
});
test('공급자 줄·경고: 자동 충전 횟수, 한도 막대, 한도 도달일 경고가 먼저', () => {
  const html = providerRows(f, NOV12);
  assert.match(html, /자동 충전 20,000원씩 → 한 달 약 1.1번/);
  assert.match(html, /한도 80,000원 중 52%/);
  assert.match(html, /11월 24일 한도/);
  assert.match(html, /aria-label="Gemini 한도의 52%"/);
  assert.equal(warnText(f), '이 속도면 11월 24일에 Gemini 한도 — 회의·통화 전사가 멈춰요 외 1건');
  const none = { ...f, forecast: { openai: { ...f.forecast.openai, reload_krw: null }, gemini: { ...f.forecast.gemini, cap_krw: null, cap_day: null, raise_cap: false } } };
  const h2 = providerRows(none, NOV12);
  assert.match(h2, /권장 자동 충전 20,000원/);
  assert.doesNotMatch(h2, /aiu-bar/);
});
test('금액 입력: 쉼표·원 허용, 빈 칸은 안 바꿈, 바뀐 것만 cap·reload 행으로', () => {
  assert.equal(parseAmount('80,000'), 80000); assert.equal(parseAmount(' 20000원 '), 20000);
  assert.equal(parseAmount(''), undefined); assert.equal(parseAmount('-1'), null); assert.equal(parseAmount('1.5'), null); assert.equal(parseAmount('100000001'), null);
  assert.deepEqual(savedAmounts(f), { cap: 80000, reload: 20000 });
  assert.deepEqual(changedEntries(f, { cap: 80000, reload: 30000 }), [{ provider: 'openai', kind: 'reload', amount_krw: 30000 }]);
  assert.deepEqual(changedEntries(f, { cap: 140000, reload: undefined }), [{ provider: 'gemini', kind: 'cap', amount_krw: 140000 }]);
  assert.deepEqual(changedEntries(s, { cap: 0, reload: 0 }), []);
});

test('줄 붙이기: 상태 답의 ai_usage로 그리고, 칸이 없으면 숨김(실제 mount·refresh 실행)', async () => {
  const { mountAiUsageLine } = await import('../app/ai-usage-line.js');
  const { resetCollectionCache } = await import('../app/collection-status.js');
  const mk = () => ({ hidden: false, innerHTML: '', addEventListener() {}, removeEventListener() {}, querySelector: () => null, contains: () => false });
  const rtWith = data => {
    const calls = [];
    const ctx = { user: { id: 'u' }, workspace: { id: 'ws', slug: 'any-name' }, membership: { role: 'owner' } };
    return { calls, context: { read: () => ctx }, session: { read: () => ({ access_token: 't', user: { id: 'u' } }) }, api: async path => { if (path === '/rest/v1/rpc/app_my_features') return ['calls']; calls.push(path); return data; } };
  };
  resetCollectionCache();
  const rt = rtWith({ ok: true, ai_usage: s });
  const host = mk(), m = mountAiUsageLine(host, { rt, now: () => NOW });
  await m.refresh();
  assert.equal(host.hidden, false);
  assert.match(host.innerHTML, /AI 비용 · 10월 1일~28일 \(이번 달, 추정\)/);
  assert.match(host.innerHTML, /월말 약 440원/);
  assert.doesNotMatch(host.innerHTML, /잔액/);
  assert.deepEqual(rt.calls, ['/functions/v1/drive-summary?action=status']);
  m.destroy();
  resetCollectionCache();
  const old = rtWith({ ok: true }), host2 = mk(), m2 = mountAiUsageLine(host2, { rt: old });
  await m2.refresh();
  assert.equal(host2.hidden, true);
  m2.destroy(); resetCollectionCache();
});
