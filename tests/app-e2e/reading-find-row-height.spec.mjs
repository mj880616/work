import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S70-40a ① READ-찾기줄높이(docs/design/reading-screens.md 3절 B1·4절 3): [읽을 거리] 위 찾기 줄의
// 찾기 칸(.nw-find)·[매체 ▾](.nw-dd)·⋯(.os-more)이 모두 공용 작은 높이(--ds-compact-height)로 같고 세로 가운데가 맞아야 한다.
// 모양은 app/now.css(.nw-top 줄)와 app/outside-statements.css(.os-more 바탕)가 정한다. 서버는 흉내, 기사는 가짜.
const box = (page, sel) => page.locator(`#outsideRoot [data-nw-top] ${sel}`).evaluate(el => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, height: r.height };
});

for (const width of [390, 1280]) {
  test(`찾기 줄 칸 높이 같음 ${width}: 찾기 칸·매체·⋯의 높이가 같고 위·아래 끝이 1px 안`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors } = await start(page, width);
    await openNews(page, width);
    await expect(page.locator('#outsideRoot [data-nw-top]')).toBeVisible();
    const [find, media, more] = await Promise.all([box(page, '[data-nw-find]'), box(page, '[data-nw-media]'), box(page, '[data-os-more]')]);
    const want = await page.locator('#outsideRoot [data-nw-find]').evaluate(el => {
      const v = getComputedStyle(el).getPropertyValue('--ds-compact-height').trim();
      return parseFloat(v) || 32;
    });
    for (const b of [find, media, more]) expect(Math.abs(b.height - want)).toBeLessThanOrEqual(1);
    for (const b of [media, more]) {
      expect(Math.abs(b.top - find.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.bottom - find.bottom)).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
  });
}
