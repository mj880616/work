// S61-51a NEWS-밑줄모으기 남은 것: News [밑줄] 탭에서 텔레그램 원문 밑줄을 누르면 텔레그램 화면에서 그 방·날·소식 원문을 열고
// 그 밑줄 자리로 옮기고 잠깐 밝힌다(뉴스·사회운동 원문과 같은 revealMark). 6줄로 접힌 긴 글 안의 밑줄이면 그 줄을 펼친다.
// 뒤로가기 한 번이면 News [밑줄] 탭. 서버는 모두 흉내이고 방·사람·글은 지어낸 것이다.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noticeText } from './helpers/small-notice.mjs';
import { installTgServer, telegramRows, T } from './helpers/tg-room-day-server.mjs';
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const QUOTE = '다음 주 화요일 두 시로 잡혔어요';
// 긴 글(6줄 접힘) 맨 끝의 밑줄.
const LONG_TAIL = '마지막 줄에 남긴 가상 결정 사항';
const LONG = '10:00 A: ' + Array.from({ length: 12 }, (_, i) => `가상 회의 내용 ${i + 1}번째 문단입니다.`).join('\n') + '\n' + LONG_TAIL;
const LONG_ID = '70000000-0000-4000-8000-0000000000aa';
const hl = (n, o) => ({ id: `b4000000-0000-4000-8000-00000000000${n}`, source_type: 'telegram', quote_prefix: '', quote_suffix: '', memo: null, source_media: '텔레그램', source_url: '', created_at: `2026-10-06T0${n}:00:00Z`, updated_at: `2026-10-06T0${n}:00:00Z`, ...o });
const HLS = [
  hl(2, { source_id: LONG_ID, quote: LONG_TAIL, source_title: '가상지부 단톡', source_date: '2026-10-06T05:00:00Z' }),
  hl(1, { source_id: T.a1, quote: QUOTE, quote_prefix: '09:40 A (전달): ', source_title: '가상지부 단톡', source_date: '2026-10-06T00:31:00Z' }),
];

async function fixture(page, width) {
  await page.setViewportSize({ width, height: 760 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const items = telegramRows();
  items.push({ ...items[0], id: LONG_ID, occurred_at: '2026-10-06T05:00:00Z', title: '긴 회의', summary: '가상 긴 회의 정리.', raw_count: 13, raw_text: LONG });
  await openHome(page, { beforeLoad: async () => {
    await page.route(SB + '/**', route => {
      const u = new URL(route.request().url()), p = u.pathname;
      const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      if (p === '/functions/v1/outside-feed') return ok({ ok: true, sources: [] });
      if (p === '/functions/v1/news-feed') return ok({ ok: true, sources: [], limits: {} });
      const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
      if (table === 'app_news_highlights') return ok(HLS);
      if (table.startsWith('app_now_') || table.startsWith('app_news_') || table.startsWith('app_outside_') || table === 'app_feed_reads' || table === 'app_feed_bodies') return ok([]);
      return route.fallback();
    });
    for (const t of ['app_tg_senders', 'app_tg_day_senders']) await page.route(u => u.origin === SB && u.pathname === '/rest/v1/' + t, r => r.fulfill({ json: [] }));
    await installTgServer(page, { items });
  } });
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: 'News' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: 'News', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await page.locator('#outsideRoot').getByRole('tab', { name: '밑줄' }).click();
  await expect(page.locator('#outsideRoot [data-nh-row]')).toHaveCount(2);
  return errors;
}
const back = (page, width) => (width <= 760 ? page.evaluate(() => window.KPTURouter.back()) : page.goBack());
const row = (page, quote) => page.locator('#outsideRoot [data-nh-row]').filter({ hasText: quote }).locator('[data-nh-open]');

for (const width of [412, 1280]) {
  test(`${width}: [밑줄] 탭의 텔레그램 밑줄 → 그 소식 원문의 그 자리, 뒤로가기 한 번 → [밑줄] 탭`, async ({ page }) => {
    test.setTimeout(60000);
    const errors = await fixture(page, width);
    await row(page, QUOTE).click();
    await expect(page.locator('#telegramView')).toBeVisible();
    const item = page.locator(`#tgDetail [data-tg-di="${T.a1}"]`);
    await expect(item.locator('[data-tg-raw]')).toBeVisible();
    const mark = item.locator('[data-tg-raw] mark.hl-mark');
    await expect(mark).toHaveText(QUOTE);
    await expect(mark).toBeInViewport();
    await expect(mark).toBeFocused();
    // 잠깐 밝힘(공용 [data-journal-flash])은 끝나면 사라지고 노란 밑줄만 남는다.
    await expect(mark).not.toHaveAttribute('data-journal-flash', /.*/, { timeout: 5000 });
    await back(page, width);
    await expect(page.locator('#outsideView')).toBeVisible();
    await expect(page.locator('#outsideRoot').getByRole('tab', { name: '밑줄' })).toHaveAttribute('aria-selected', 'true');
    await expect(row(page, QUOTE)).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('412: 6줄로 접힌 긴 원문 끝의 밑줄이면 그 줄을 펼치고 그 자리로', async ({ page }) => {
  test.setTimeout(60000);
  const errors = await fixture(page, 412);
  await row(page, LONG_TAIL).click();
  const item = page.locator(`#tgDetail [data-tg-di="${LONG_ID}"]`);
  const mark = item.locator('[data-tg-raw] mark.hl-mark');
  await expect(mark).toHaveText(LONG_TAIL);
  await expect(item.locator('[data-tg-rt-more]')).toHaveAttribute('aria-expanded', 'true');
  await expect(mark).toBeInViewport();
  expect(errors).toEqual([]);
});

test('412: 원래 소식이 없어졌으면 알림만, 화면은 [밑줄] 탭 그대로', async ({ page }) => {
  const errors = await fixture(page, 412);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_feed_items', r => r.fulfill({ json: [] }));
  await row(page, QUOTE).click();
  await expect.poll(() => noticeText(page)).toContain('원래 글을 찾지 못했어요');
  await expect(page.locator('#outsideView')).toBeVisible();
  expect(errors).toEqual([]);
});
