import { test, expect } from '@playwright/test';

test('library upload timeout stays isolated in the upload form',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/library-upload-failure-fixture.html');
  await expect(page.locator('#libraryFileInput')).toBeAttached({timeout:3000});
  await page.locator('#libraryFileInput').setInputFiles({name:'test.txt',mimeType:'text/plain',buffer:Buffer.from('test')});
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentStatus')).toContainText('요청 시간이 초과되었습니다. 다시 시도해 주세요.',{timeout:3000});
  await expect(page.locator('#documentModal')).toBeVisible();
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(0);
});
