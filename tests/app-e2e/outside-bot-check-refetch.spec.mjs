import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S68-49(사용자 11/23 12:43 "업데이트 됐는데도 여전히 못 읽음"): 사회운동 글 원문이 봇 확인(bot_check)으로 막혀 '사이트가 자동 읽기를 막아 둠'인데
// [원문 다시 가져오기]가 없고, 요약 칸에 빨간 '상세를 만들지 못함 · HTTP 422'가 보였다.
// ① 봇 확인 글에도 [원문 다시 가져오기] → 누르면 outside-feed reread(글 id만) 한 번 → 읽히면 본문·요약.
// ② 요약 서버의 운영 답 모양({error:'no_material', message:'AI 요청을 처리하지 못했어요.'})이면 빨간 오류 대신 회색 '원문을 가져오면 요약해요'.
// ③ 다시 읽어도 막히면 단추를 거두고 '원래 사이트에서 열기 ↗' + [본문 붙여 넣기] → outside-feed hand_body(글 id·본문만) → 본문·요약.
// 서버는 흉내 낸다. 글은 모두 가상.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const P1 = 'a1000000-0000-4000-8000-000000000049';
const POST = { id: P1, source_key: 'ws', kind: 'article', lang: 'ko', title: '가상 봇 확인 글', title_ko: null, url: 'https://ws.or.kr/article/49', published_at: '2026-11-19T09:58:00Z', fetched_at: '2026-11-19T10:00:00Z', summary_ko: null, key_sentences: [], has_body: false, author: null };
const DETAIL = { level: 'full', summary: '가상 본문 요약.', key_sentences: [], relevance: null, implications: { kptu: '가상 시사점.', labor: '' }, related: [], generated_at: '2026-11-23T04:00:00Z', context_at: null };
// 운영 ai-assist 422 답 그대로(error 칸에 이름, message는 일반 글).
const NO_MATERIAL = { ok: false, error: 'no_material', message: 'AI 요청을 처리하지 못했어요.' };

async function server(page, { reread = 'ok' } = {}) {
  const s = { body: { state: 'failed', reason: 'bot_check', rule: null, blocks: [] }, rereads: [], hands: [] };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === '/functions/v1/outside-feed') {
      const action = u.searchParams.get('action');
      if (action === 'reread') {
        s.rereads.push(req.postDataJSON?.());
        if (reread === 'ok') { s.body = { state: 'ok', reason: null, rule: 'ws@1', blocks: [{ t: 'p', text: '가상 다시 읽은 본문 문단.' }] }; return ok({ ok: true, status: 'ok' }); }
        return ok({ ok: true, status: 'bot_check' });
      }
      if (action === 'hand_body') {
        const b = req.postDataJSON?.();
        s.hands.push(b);
        s.body = { state: 'ok', reason: null, rule: 'manual@1', blocks: b.body.split(/\n\s*\n/).map(text => ({ t: 'p', text: text.trim() })) };
        return ok({ ok: true, status: 'filled' });
      }
      return ok({ ok: true, sources: [{ key: 'ws', name: '노동자 연대', group: 'movement', lang: 'ko' }] });
    }
    if (p === '/functions/v1/news-feed') return ok({ ok: true, sources: [], limits: {} });
    if (p === '/functions/v1/ai-assist') {
      const b = req.postDataJSON?.();
      if (b?.kind !== 'now_detail') return ok({ ok: true, ran: false, added: 0 });
      if (s.body.state !== 'ok') return ok(NO_MATERIAL, 422);
      return ok({ ok: true, kind: 'now_detail', detail: DETAIL, stale: false });
    }
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table === 'app_outside_articles') return ok([POST]);
    if (table === 'app_outside_article_bodies') return ok([s.body]);
    if (table === 'app_outside_reads' || table === 'app_news_reads') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    if (table === 'app_outside_sources') return ok([{ source_key: 'ws', enabled: true, last_ok_at: '2026-11-23T00:07:00Z', last_error: null }]);
    if (table === 'app_outside_seen') return ok([{ seen_at: '2026-11-23T00:00:00Z' }]);
    if (table === 'app_now_signals') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    if (table.startsWith('app_now_') || table.startsWith('app_news_') || table.startsWith('app_outside_') || table === 'app_notes') return ok([]);
    return route.fallback();
  });
  return s;
}
async function start(page, width, opts) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const s = await server(page, opts);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '읽을 거리' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '읽을 거리', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await page.locator('#outsideRoot').getByRole('tab', { name: '사회운동' }).click();
  await expect(page.locator('#outsideRoot [data-os-list] [data-nw-key]')).toHaveCount(1);
  await page.locator(`#outsideRoot [data-os-list] [data-nw-key="outside:${P1}"] .now-open`).click();
  return { errors, s, d: page.locator('#outsideRoot [data-now-detail] .nd') };
}

for (const width of [412, 1280]) {
  test(`사회운동 봇 확인 글 ${width}: 요약 칸 회색 안내(빨간 422 없음) → [원문 다시 가져오기] → 본문·요약`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors, s, d } = await start(page, width);
    const why = d.locator('[data-nd-body] [data-nd-why]');
    await expect(why).toContainText('사이트가 자동 읽기를 막아 둠');
    const unread = d.locator('[data-nd-summary] [data-nd-unread]');
    await expect(unread).toContainText('원문을 가져오면 요약해요');
    await expect(d.locator('[data-nd-summary]')).not.toContainText('HTTP 422');
    await expect(d.locator('[data-nd-summary]')).not.toContainText('상세를 만들지 못함');
    const btn = why.getByRole('button', { name: '원문 다시 가져오기' });
    await expect(btn).toBeVisible();
    await btn.click();
    await expect.poll(() => s.rereads.length).toBe(1);
    expect(s.rereads[0]).toEqual({ id: P1 });
    await expect(d.locator('[data-nd-prose] p')).toHaveText(['가상 다시 읽은 본문 문단.']);
    await expect(d.locator('.nd-sum')).toHaveText('가상 본문 요약.');
    await expect(unread).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors.filter(e => !/422/.test(e))).toEqual([]);
  });
}

test('사회운동 봇 확인 글: 다시 읽어도 막힘 → 까닭 한 줄·단추는 그대로(S69-02)·원래 사이트에서 열기 + [본문 붙여 넣기] → 저장 → 본문·요약', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, s, d } = await start(page, 412, { reread: 'blocked' });
  const why = d.locator('[data-nd-body] [data-nd-why]');
  await why.getByRole('button', { name: '원문 다시 가져오기' }).click();
  await expect.poll(() => s.rereads.length).toBe(1);
  await expect(why.locator('[data-nd-refetch-note]')).toHaveText('다시 읽어도 사이트가 본문을 주지 않아요');
  await expect(why.getByRole('button', { name: '원문 다시 가져오기' })).toBeVisible();
  await expect(why.locator('[data-nd-link]')).toHaveText('원래 사이트에서 열기 ↗');
  await expect(why.locator('[data-nd-link]')).toHaveAttribute('href', POST.url);
  await why.getByRole('button', { name: '본문 붙여 넣기' }).click();
  const form = d.locator('[data-nd-hand-form]');
  await expect(form).toHaveAttribute('aria-label', '본문 붙여 넣기');
  await expect(form.locator('[data-nd-hand-in="title"]')).toHaveCount(0);
  // 빈 본문은 보내지 않는다.
  await form.getByRole('button', { name: '저장' }).click();
  await expect(form.locator('[data-nd-hand-note]')).toHaveText('본문을 넣어 주세요');
  expect(s.hands.length).toBe(0);
  await form.locator('[data-nd-hand-in="body"]').fill('가상 붙여 넣은 첫 문단.\n\n가상 둘째 문단.');
  await form.getByRole('button', { name: '저장' }).click();
  await expect.poll(() => s.hands.length).toBe(1);
  expect(s.hands[0]).toEqual({ id: P1, body: '가상 붙여 넣은 첫 문단.\n\n가상 둘째 문단.' });
  await expect(d.locator('[data-nd-prose] p')).toHaveText(['가상 붙여 넣은 첫 문단.', '가상 둘째 문단.']);
  await expect(d.locator('.nd-sum')).toHaveText('가상 본문 요약.');
  expect(s.rereads.length).toBe(1, '같은 글을 다시 읽지 않음');
  expect(errors.filter(e => !/422/.test(e))).toEqual([]);
});
