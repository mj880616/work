import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
import { screenFind, screenTools } from './helpers/screen-find.mjs';
// S70-40a ① READ-찾기줄높이(docs/design/reading-screens.md 3절 B1·4절 3) → S70-54 UI-검색창하나로(docs/design/one-search-bar.md):
// 옛 [읽을 거리] 위 찾기 줄은 없고, 찾기는 맨 위 칸, [매체 ▾]·⋯는 단추 자리(.sf-tools — 폰 머리 줄, PC는 S71-59부터 화면 안 탭 줄 끝)다.
// [매체 ▾]·⋯는 공용 작은 높이(--ds-compact-height)로 같고, 폰은 찾기 돋보기, PC는 탭 줄과 세로 가운데가 1px 안에 맞아야 한다. 서버는 흉내, 기사는 가짜.
const box = loc => loc.evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, mid: (r.top + r.bottom) / 2 }; });

for (const width of [390, 1280]) {
  test(`맨 위 줄 칸 높이 같음 ${width}: 매체·⋯의 높이가 같고 찾기 칸과 가운데가 1px 안`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors } = await start(page, width);
    await openNews(page, width);
    await expect(page.locator('#outsideRoot [data-nw-top]')).toHaveCount(0);
    const tools = screenTools(page);
    await expect(tools.locator('[data-nw-media]')).toBeVisible();
    // S71-59 UI-화면메뉴안으로: PC 틀은 [매체 ▾]·⋯가 화면 안 탭 줄 오른쪽 끝 — 그 줄(탭)과 가운데를 맞춘다.
    const anchor = width > 760 ? page.locator('#outsideRoot > .os-tabs') : page.locator('.mobile-shell-header .sf-open');
    const [find, media, more] = await Promise.all([box(anchor), box(tools.locator('[data-nw-media]')), box(tools.locator('[data-os-more]'))]);
    const want = await tools.evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--ds-compact-height').trim()) || 32);
    for (const b of [media, more]) {
      expect(Math.abs(b.height - want)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.mid - find.mid)).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
  });
}
