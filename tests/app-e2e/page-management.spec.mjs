import { test, expect } from '@playwright/test';

test('page cards align actions and delete only after save confirmation',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/page-management-fixture.html');

  await expect(page.locator('#pageDeleteModeBtn')).toBeVisible();
  await expect(page.locator('#pageDeleteModeBtn')).toHaveText('페이지 삭제');
  await expect(page.locator('#pageDeleteSaveBtn')).toBeHidden();
  await expect(page.locator('.page-delete-mark').first()).toBeHidden();

  const actionHeights=await page.locator('.page-card').first().locator('.card-actions .mini').evaluateAll(els=>els.map(el=>Math.round(el.getBoundingClientRect().height)));
  expect(new Set(actionHeights).size).toBe(1);
  await expect(page.locator('.page-card').first().locator('.card-actions a.mini')).toHaveCSS('text-decoration-line','none');

  await page.locator('#pageDeleteModeBtn').click();
  await expect(page.locator('.page-delete-mark').first()).toBeVisible();
  await expect(page.locator('#pageDeleteSaveBtn')).toBeVisible();
  await expect(page.locator('#pageDeleteSaveBtn')).toBeDisabled();

  await page.locator('.page-delete-mark').first().click();
  await expect(page.locator('.page-card').first()).toHaveClass(/page-delete-pending/);
  await expect(page.locator('#pageDeleteSaveBtn')).toBeEnabled();
  await expect(page.locator('#pageDeleteSaveBtn')).toHaveText('저장 (1)');
  expect(await page.evaluate(()=>window.__pageDeleteCall)).toBeNull();

  await page.locator('.page-delete-mark').first().click();
  await expect(page.locator('.page-card').first()).not.toHaveClass(/page-delete-pending/);
  await expect(page.locator('#pageDeleteSaveBtn')).toBeDisabled();

  await page.locator('.page-delete-mark').first().click();
  page.once('dialog',async dialog=>{
    expect(dialog.message()).toContain('정말 삭제하시겠습니까?');
    await dialog.accept();
  });
  await page.locator('#pageDeleteSaveBtn').click();
  await expect.poll(async()=>page.evaluate(()=>window.__pageDeleteCall)).not.toBeNull();
  const call=await page.evaluate(()=>window.__pageDeleteCall);
  expect(call.p_page_ids).toEqual(['11111111-1111-1111-1111-111111111111']);
});
