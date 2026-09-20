import { test, expect } from '@playwright/test';

test('page delete mode selects cards without injected controls',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/page-management-fixture.html');
  await expect(page.locator('#pageDeleteModeBtn')).toBeVisible();
  await page.locator('#pageDeleteModeBtn').click();
  await expect(page.locator('#pagesView')).toHaveClass(/page-delete-mode/);
  await expect(page.locator('#pageDeleteSaveBtn')).toBeVisible();
  const card=page.locator('.page-card').first();
  await card.click();
  await expect(card).toHaveClass(/page-delete-pending/);
  await expect(page.locator('#pageDeleteSaveBtn')).toBeEnabled();
  await page.locator('#pageDeleteModeBtn').click();
  await expect(page.locator('#pagesView')).not.toHaveClass(/page-delete-mode/);
  await expect(card).not.toHaveClass(/page-delete-pending/);
});
