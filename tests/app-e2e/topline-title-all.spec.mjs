import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// UI-상단줄제목 확장: every screen names its open item through the same kptu:where-item signal and the top line's one painter.
// 업무일지 = 홈(HOME-업무일지홈): the chosen day is the body head's title, so the top line says only '홈'; the other screens are checked on the shared path: a name belongs to its screen only,
// it is kept while another screen is shown and drawn again on return, and null drops it. Synthetic names only.
// The shared path is checked on screens that send no name of their own when shown (자료실, 공유 페이지 list): a screen that names its
// open item itself (프로젝트 opens the last project on PC) is the owner of its name, so a made-up name would only compete with it.
const where = page => page.locator('[data-topline-where]');
const send = (page, view, name, kind) => page.evaluate(([v, n, k]) => window.dispatchEvent(new CustomEvent('kptu:where-item', { detail: { view: v, name: n, kind: k } })), [view, name, kind]);
test('PC 1280: 홈(업무일지)은 상단 줄에 ‘홈’만(고른 날은 본문 제목), 화면별 이름은 그 화면에서만 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await page.evaluate(() => window.KPTURouter.go('journal'));
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(where(page).locator('li')).toHaveText(['홈']);
  await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText(/\d+월 \d+일.+요일/);
  await send(page, 'library', '합성 자료');
  await expect(where(page).locator('li')).toHaveText(['홈']);
  await page.evaluate(() => window.KPTURouter.go('library'));
  await expect(where(page).locator('li')).toHaveText(['자료실', '합성 자료']);
  await send(page, 'pages', '합성 공유 페이지');
  await expect(where(page).locator('li')).toHaveText(['자료실', '합성 자료']);
  await clickView(page, 'home');
  await expect(where(page).locator('li')).toHaveText(['홈']);
  await page.evaluate(() => window.KPTURouter.go('pages'));
  await expect(where(page).locator('li')).toHaveText(['공유 페이지', '합성 공유 페이지']);
  await send(page, 'pages', null);
  await expect(where(page).locator('li')).toHaveText(['공유 페이지']);
  expect(errors).toEqual([]);
});
