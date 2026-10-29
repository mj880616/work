import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSummary, warnText, summaryLine, detailRows, barRatio, periodOf, titleText, monthEnd } from '../app/ai-usage-model.mjs';
import { summarizeAiUsage } from '../supabase/functions/drive-summary/ai-usage.mjs';

// AI-사용량줄: 홈 'AI 사용량' 줄의 글 만들기. 화면은 보기만 하고(쓰기 없음) 기기에 저장하지 않는다.
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
test('맨 위 기간·요약·월말 예상(시안 문구), 줄마다 추정 없음, 잔액·청구 줄 없음', () => {
  assert.equal(titleText(s, NOW), 'AI 사용량 · 10월 1일~28일 (이번 달, 추정)');
  assert.equal(monthEnd(s, NOW), 440); // 393 ÷ 28일 × 31일 = 435 → 10원 단위
  assert.equal(summaryLine(s, NOW), 'OpenAI 393원 · Gemini 0원 · 이 속도면 월말 약 440원');
  assert.equal(barRatio({ ...s, openai: { ...s.openai, assist_krw: 8400 } }), 0.56);
  const html = detailRows(s);
  assert.match(html, /Web2 AI 기능<\/span><span class="aiu-value">156원 \/ 한 달 상한 15,000원/);
  assert.match(html, /텔레그램·통화 판정<\/span><span class="aiu-value">237원 \/ 한 달 상한 6,000원/);
  assert.match(html, /전사·분석\(Gemini\)<\/span><span class="aiu-value">0원/);
  assert.doesNotMatch(html, /추정|보정|실제|잔액|충전|청구|수집/);
  assert.equal((html.match(/<li /g) || []).length, 3);
});
test('기간: 서울 날짜 기준, 매달 1일부터 다시 셈', () => {
  // 서울 11/1 00:30(UTC 10/31 15:30)은 11월 첫날
  assert.deepEqual(periodOf('2026-11', at('2026-10-31T15:30:00Z')), { month: 11, end: 1, days: 30, current: true });
  assert.equal(titleText({ ...s, month: '2026-11' }, at('2026-10-31T15:30:00Z')), 'AI 사용량 · 11월 1일 (이번 달, 추정)');
  // 서울 10/31 23:59(UTC 14:59)는 아직 10월 31일
  assert.deepEqual(periodOf('2026-10', at('2026-10-31T14:59:00Z')), { month: 10, end: 31, days: 31, current: true });
  // 지난 달 답(달이 바뀐 직후 옛 답)이면 그 달 전체, 월말 예상은 빼고 '이번 달'도 뺀다
  assert.equal(titleText(s, at('2026-11-02T01:00:00Z')), 'AI 사용량 · 10월 1일~31일 (추정)');
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
  assert.match(warnText({ ...s, warn: ['openai_limit'] }), /^Web2 AI 이번 달 상한 80% 넘음/);
  assert.equal(warnText({ ...s, warn: ['openai_balance'] }), '');
  assert.match(warnText({ ...s, warn: ['openai_balance', 'feed_limit'] }), /^텔레그램·통화 판정 상한 80% 넘음 \(237원 \/ 6,000원\)$/);
  assert.equal(warnText({ ...s, warn: ['openai_limit', 'gemini_balance', 'feed_limit'] }).endsWith(' 외 1건'), true);
});
test('화면 파일은 기기 저장·충전/청구 쓰기를 하지 않는다', () => {
  const src = readFileSync(new URL('../app/ai-usage-line.js', import.meta.url), 'utf8') + readFileSync(new URL('../app/ai-usage-model.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, new RegExp(['local', 'session'].map(w => w + 'Storage').concat(['indexed' + 'DB']).join('|')));
  assert.doesNotMatch(src, /\/rest\/v1\/app_ai_cost_entries|method:\s*'(POST|DELETE)'|충전 금액 넣기|실제 청구 넣기|<form|<input/);
});

test('줄 붙이기: 상태 답의 ai_usage로 그리고, 칸이 없으면 숨김(실제 mount·refresh 실행)', async () => {
  const { mountAiUsageLine } = await import('../app/ai-usage-line.js');
  const { resetCollectionCache } = await import('../app/collection-status.js');
  const mk = () => ({ hidden: false, innerHTML: '', addEventListener() {}, removeEventListener() {}, querySelector: () => null, contains: () => false });
  const rtWith = data => {
    const calls = [];
    const ctx = { user: { id: 'u' }, workspace: { id: 'ws', slug: 'kptu-work' }, membership: { role: 'owner' } };
    return { calls, context: { read: () => ctx }, session: { read: () => ({ access_token: 't', user: { id: 'u' } }) }, api: async path => { calls.push(path); return data; } };
  };
  resetCollectionCache();
  const rt = rtWith({ ok: true, ai_usage: s });
  const host = mk(), m = mountAiUsageLine(host, { rt, now: () => NOW });
  await m.refresh();
  assert.equal(host.hidden, false);
  assert.match(host.innerHTML, /AI 사용량 · 10월 1일~28일 \(이번 달, 추정\)/);
  assert.match(host.innerHTML, /이 속도면 월말 약 440원/);
  assert.doesNotMatch(host.innerHTML, /충전|청구|잔액/);
  assert.deepEqual(rt.calls, ['/functions/v1/drive-summary?action=status']);
  m.destroy();
  resetCollectionCache();
  const old = rtWith({ ok: true }), host2 = mk(), m2 = mountAiUsageLine(host2, { rt: old });
  await m2.refresh();
  assert.equal(host2.hidden, true);
  m2.destroy(); resetCollectionCache();
});
