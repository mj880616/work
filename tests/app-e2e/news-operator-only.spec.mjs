import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// NEWS-운영자만(S63-03, 명진 11/16 "명진 외 나머지 가입자에게는 메뉴 숨기고"): S62-12g에서 모두에게 열었던 News를 다시 운영자 기능 키 'outside'로.
// - 새 계정(기능 없음): [메뉴] 창·PC 왼쪽 메뉴·하단바 어디에도 News가 없다.
// - 같은 새 계정이 주소 ?view=news·옛 ?view=outside·?view=now를 직접 열어도 News 화면이 생기지 않고 홈이 열린다(주소도 홈으로).
// - 운영자(기본 OPERATOR_MENU_FEATURES, 'outside' 있음)는 그대로 ?view=news가 열린다.
// - 기능 답을 못 읽으면(null) 막지 않는다 — menu-features.spec(답 실패 시 아무것도 안 뺌)과 같은 규칙.
const menuViews = page => page.evaluate(() => {
  const view = el => el.dataset.view || el.dataset.basketKindNav || '';
  return {
    sheet: [...document.querySelectorAll('#mobileMenu nav[aria-label="더 보기"] button')].map(view),
    pc: [...document.querySelectorAll('#appNav .nav-btn[data-view]')].map(view),
    bar: [...document.querySelectorAll('#appView .mobile-tabs [data-view]')].map(view),
  };
});

for (const width of [412, 1280]) {
  test(`NEWS-운영자만 새 계정 ${width}px: News 입구가 없다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openHome(page, { features: [], menuLayout: null });
    await expect.poll(async () => (await menuViews(page)).sheet).toEqual(['basket', 'reading', 'team', 'meetings', 'files', 'brief']); // S71-61: HWP 편집은 메뉴가 아님
    const v = await menuViews(page);
    expect([...v.sheet, ...v.pc, ...v.bar]).not.toContain('outside');
    for (const where of ['#appNav', '#mobileMenu']) await expect(page.locator(where)).not.toContainText('읽을 거리');
    // 화면 사진(가짜 자료만): CI 묶음 ui-audit-*에 남는다. 폰은 [메뉴] 창을 연 모습, PC는 왼쪽 메뉴.
    if (width <= 760) { await page.locator('#mobileMenuTab').click(); await expect(page.locator('#mobileMenu')).toBeVisible(); await page.waitForTimeout(400); }
    await page.screenshot({ path: `test-results/ui-audit/s63-03-news-operator-only-${width}.png` });
    expect(errors).toEqual([]);
  });
}

for (const name of ['news', 'outside', 'now']) {
  test(`NEWS-운영자만 새 계정: ?view=${name}로 열어도 홈`, async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openHome(page, { features: [], menuLayout: null, query: `?view=${name}`, quickRest: true });
    await expect(page.locator('#homeView')).toBeVisible();
    await expect(page.locator('#outsideView')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe(null);
    expect(errors).toEqual([]);
  });
}

test('NEWS-운영자만 운영자: ?view=news는 그대로 열린다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHome(page, { query: '?view=news', quickRest: true });
  await expect(page.locator('#outsideView')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('news');
});
