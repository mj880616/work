import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// UI-상단줄제목 확장: every screen names its open item through the same kptu:where-item signal and the top line's one painter.
// 업무일지 names the chosen day on its own; the other screens are checked on the shared path: a name belongs to its screen only,
// it is kept while another screen is shown and drawn again on return, and null drops it. Synthetic names only.
const where = page => page.locator('[data-topline-where]');
const send = (page, view, name, kind) => page.evaluate(([v, n, k]) => window.dispatchEvent(new CustomEvent('kptu:where-item', { detail: { view: v, name: n, kind: k } })), [view, name, kind]);
test('PC 1280: 업무일지는 고른 날을 상단 줄에 올리고, 화면별 이름은 그 화면에서만 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await page.evaluate(() => window.KPTURouter.go('journal'));
  await expect(where(page).locator('li')).toHaveCount(3);
  await expect(where(page).locator('li').nth(2)).toHaveText(/\d+월 \d+일.+요일/);
  await send(page, 'projects', '합성 프로젝트');
  await expect(where(page).locator('li')).toHaveCount(3);
  await page.evaluate(() => window.KPTURouter.go('projects'));
  await expect(where(page).locator('li')).toHaveText(['프로젝트', '합성 프로젝트']);
  await send(page, 'pages', '합성 공유 페이지');
  await expect(where(page).locator('li')).toHaveText(['프로젝트', '합성 프로젝트']);
  await clickView(page, 'home');
  await expect(where(page).locator('li')).toHaveText(['홈']);
  await page.evaluate(() => window.KPTURouter.go('pages'));
  await expect(where(page).locator('li')).toHaveText(['공유 페이지', '합성 공유 페이지']);
  await send(page, 'pages', null);
  await expect(where(page).locator('li')).toHaveText(['공유 페이지']);
  expect(errors).toEqual([]);
});
