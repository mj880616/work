import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
for (const width of [412, 880, 1280]) test(`shot ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 412 ? 915 : 900 });
  await openHome(page);
  await expect(page.locator('#journalRoot [data-journal-day]')).toBeVisible();
  await page.screenshot({ path: `docs/design/screens/s62-15/${width}-5-home-quick-kind.png` });
  const kind = page.locator('#homeView [data-home-quick] [data-quick-kind]');
  if (await kind.isVisible()) { await kind.click(); await page.waitForTimeout(400); await page.screenshot({ path: `docs/design/screens/s62-15/${width}-6-home-quick-kind-menu.png` }); }
});
