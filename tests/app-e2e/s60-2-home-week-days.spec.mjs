import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// HOME-날짜줄고른날(S60-2, 시안 #2431): 홈 [하루] 주 날짜 줄. 요일 위·날짜 아래 두 줄(폰·폴드·PC), 고른 날 = 채운 동그라미·흰 숫자,
// 오늘 = 동그라미 선, 오늘을 고르면 채운 동그라미 하나, 일요일 빨강·한 줄 쓴 날 점은 그대로. 시계는 2026-10-06(화) 10:00 KST.
const WIDTHS = [[1280, 900], [884, 1104], [412, 915]];
const date = (page, day) => page.locator(`#journalRoot [data-journal-date="${day}"]`);
const num = (page, day) => date(page, day).locator('.journal-num');
const css = (loc, prop) => loc.evaluate((el, p) => getComputedStyle(el)[p], prop);

for (const [width, height] of WIDTHS) {
  test(`${width}: 날짜 줄 — 요일 위·날짜 아래, 고른 날 채운 동그라미, 오늘 동그라미 선`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openHome(page);
    const today = '2026-10-06', other = '2026-10-08';
    // 두 줄: 요일이 날짜 위에 있다.
    const wd = await date(page, today).locator('.journal-weekday').boundingBox(), nm = await num(page, today).boundingBox();
    expect(wd.y + wd.height).toBeLessThanOrEqual(nm.y + 1);
    // 오늘 고름: 채운 동그라미 하나, 칸 네모 선 없음.
    expect(await css(num(page, today), 'backgroundColor')).not.toBe('rgba(0, 0, 0, 0)');
    expect(await css(num(page, today), 'borderTopLeftRadius')).not.toBe('0px');
    expect(await date(page, today).evaluate(el => getComputedStyle(el, '::before').display)).toBe('none');
    expect(await css(date(page, today), 'backgroundColor')).toBe('rgba(0, 0, 0, 0)');
    const filled = await css(num(page, today), 'backgroundColor');
    await page.screenshot({ path: test.info().outputPath(`today-selected-${width}.png`), clip: { x: 0, y: 0, width, height: 260 } });
    // 다른 날 누름: 그 날이 채운 동그라미, 오늘은 선만.
    await date(page, other).click();
    await expect(date(page, other)).toHaveAttribute('aria-pressed', 'true');
    expect(await css(num(page, other), 'backgroundColor')).toBe(filled);
    expect(await css(num(page, other), 'color')).toBe('rgb(255, 255, 255)');
    expect(await css(num(page, today), 'backgroundColor')).toBe('rgba(0, 0, 0, 0)');
    expect(await css(num(page, today), 'borderTopColor')).not.toBe('rgba(0, 0, 0, 0)');
    // 칸 높이: 두 줄이어도 한 줄 때 32px 그대로.
    const h = (await date(page, other).boundingBox()).height;
    expect(h).toBeLessThanOrEqual(32.5);
    // 일요일 빨강 유지.
    expect(await css(date(page, '2026-10-11').locator('.journal-weekday'), 'color')).toBe(await page.evaluate(() => { const e = document.createElement('i'); e.style.color = 'var(--kptu-danger)'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; }));
    await page.screenshot({ path: test.info().outputPath(`other-selected-${width}.png`), clip: { x: 0, y: 0, width, height: 260 } });
  });
}
