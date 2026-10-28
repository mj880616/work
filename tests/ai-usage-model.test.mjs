import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSummary, warnText, summaryLine, detailRows, entryRows, parseEntry, lastMonth, barRatio } from '../app/ai-usage-model.mjs';

// AI-사용량줄: 홈 'AI 사용량' 줄의 글 만들기와 입력 검사. 화면은 기기에 저장하지 않는다.
const s = {
  ok: true, month: '2026-10', warn: [],
  openai: { krw: 9240, estimate_krw: 9240, ratio: null, actual: false, assist_krw: 8400, telegram_krw: 840, call_krw: 0, limit_assist_krw: 15000, limit_feed_krw: 6000,
    balance: { topup_krw: 30000, topup_on: '2026-10-04', left_krw: 20760 }, last_bill: null },
  gemini: { krw: 1400, estimate_krw: 1400, ratio: null, actual: false, transcript_krw: 1400, analysis_krw: 0, calls: 2, unknown_models: [], balance: null, last_bill: null },
  entries: [{ id: '00000000-0000-4000-8000-000000000001', provider: 'openai', kind: 'topup', amount_krw: 30000, month: null, created_at: '2026-10-04T03:00:00Z' }],
};
test('모양이 틀린 답은 숨김(null)', () => {
  assert.equal(readSummary(null), null); assert.equal(readSummary({ ok: false }), null); assert.equal(readSummary({ ok: true, month: '10월' }), null);
  assert.equal(readSummary(s), s);
});
test('한 줄 요약·막대·자세히', () => {
  assert.equal(summaryLine(s), 'OpenAI 9,240원 · Gemini 1,400원 · 잔액 20,760원');
  assert.equal(barRatio(s), 0.56);
  const html = detailRows(s);
  assert.match(html, /Web2 AI\(OpenAI\)/); assert.match(html, /8,400원 \/ 15,000원/); assert.match(html, /텔레그램·통화 판정/); assert.match(html, /전사·분석\(Gemini\)/);
  assert.match(html, /width:56%/); assert.match(html, /10\/04 30,000원 충전 뒤/);
  assert.match(entryRows(s), /data-aiu-delete="00000000-0000-4000-8000-000000000001"/);
});
test('경고 문장: 상한 80%·잔액', () => {
  assert.equal(warnText(s), '');
  assert.match(warnText({ ...s, warn: ['openai_limit'] }), /^Web2 AI 이번 달 상한 80% 넘음/);
  assert.equal(warnText({ ...s, warn: ['openai_balance', 'feed_limit'] }), 'OpenAI 잔액 20,760원 — 충전 필요 외 1건');
});
test('입력 검사', () => {
  assert.deepEqual(parseEntry({ provider: 'openai', kind: 'topup', amount: '30,000원' }), { provider: 'openai', kind: 'topup', amount_krw: 30000, month: null });
  assert.deepEqual(parseEntry({ provider: 'gemini', kind: 'bill', amount: '1200', month: '2026-09' }), { provider: 'gemini', kind: 'bill', amount_krw: 1200, month: '2026-09-01' });
  for (const bad of [{ provider: 'x', kind: 'topup', amount: '1' }, { provider: 'openai', kind: 'topup', amount: '1.5' }, { provider: 'openai', kind: 'bill', amount: '1', month: '2025-12' }, { provider: 'openai', kind: 'topup', amount: '-3' }])
    assert.equal(parseEntry(bad), null, JSON.stringify(bad));
  assert.equal(lastMonth(Date.parse('2026-10-28T05:00:00Z')), '2026-09');
  assert.equal(lastMonth(Date.parse('2027-01-05T05:00:00Z')), '2026-12');
});
test('화면 파일은 기기 저장을 쓰지 않고, 금액은 서버 표에만 쓴다', () => {
  const src = readFileSync(new URL('../app/ai-usage-line.js', import.meta.url), 'utf8') + readFileSync(new URL('../app/ai-usage-model.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, new RegExp(['local', 'session'].map(w => w + 'Storage').concat(['indexed' + 'DB']).join('|')));
  assert.match(src, /\/rest\/v1\/app_ai_cost_entries/);
  assert.match(src, /drive-summary\?action=ai_usage/);
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
  const host = mk(), m = mountAiUsageLine(host, { rt });
  await m.refresh();
  assert.equal(host.hidden, false);
  assert.match(host.innerHTML, /AI 사용량\(10월, 추정\)/);
  assert.deepEqual(rt.calls, ['/functions/v1/drive-summary?action=status']);
  m.destroy();
  resetCollectionCache();
  const old = rtWith({ ok: true }), host2 = mk(), m2 = mountAiUsageLine(host2, { rt: old });
  await m2.refresh();
  assert.equal(host2.hidden, true);
  m2.destroy(); resetCollectionCache();
});
