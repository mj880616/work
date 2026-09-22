import { test, expect } from '@playwright/test';

test('library upload timeout stays isolated in the upload form and releases busy state',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/library-upload-failure-fixture.html');
  await expect(page.locator('#libraryFileInput')).toBeAttached({timeout:3000});
  await page.locator('#libraryFileInput').setInputFiles({name:'test.txt',mimeType:'text/plain',buffer:Buffer.from('test')});
  const save=page.locator('#saveDocumentBtn');
  await save.click();
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute('aria-busy','true');
  await expect(page.locator('#documentStatus')).toHaveAttribute('role','status');
  await expect(page.locator('#documentStatus')).toHaveAttribute('aria-live','polite');
  await page.evaluate(()=>window.__releaseLibraryUpload?.());
  await expect(page.locator('#documentStatus')).toContainText('요청 시간이 초과되었습니다. 다시 시도해 주세요.',{timeout:3000});
  await expect(page.locator('#documentStatus')).toHaveAttribute('role','alert');
  await expect(save).toBeEnabled();
  await expect(save).not.toHaveAttribute('aria-busy','true');
  await expect(page.locator('#documentModal')).toBeVisible();
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(0);
});


test('library visibility toggle uses the canonical visibility action',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/library-upload-failure-fixture.html');
  const card=page.locator('[data-lu-document="doc-1"]');
  await expect(card).toContainText('팀 내부',{timeout:3000});
  await expect(card.locator('[data-lu-toggle-public]')).toHaveText('외부 공개');
  page.once('dialog',dialog=>dialog.accept());
  await card.locator('[data-lu-toggle-public]').click();
  await expect(card).toContainText('외부 공개');
  await expect.poll(()=>page.evaluate(()=>window.__visibilityCalls.at(-1))).toEqual({action:'set-visibility',document_id:'doc-1',visibility:'public'});
});

test('library secondary action does not open its card, while card body opens the document',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/library-upload-failure-fixture.html');
  const card=page.locator('[data-lu-document="doc-1"]');
  await expect(card).toHaveAttribute('role','button');
  await card.locator('[data-lu-edit]').click();
  await expect(page.locator('#libraryEditModal')).toBeVisible();
  await expect(page).toHaveURL(/library-upload-failure-fixture\.html$/);
  await page.locator('#libraryEditClose').click();
  await card.locator('h3').click();
  await expect(page).toHaveURL('http://127.0.0.1:8123/tests/app-e2e/library-open-fixture.html');
});

test('revoked Google Drive token starts reconnect through the canonical function entry and keeps the record',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/library-upload-failure-fixture.html');
  await page.evaluate(()=>{window.__documentActionError='Token has been expired or revoked.'});
  const dialogs=[];
  page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept()});
  await page.locator('[data-lu-delete="doc-1"]').click();
  await expect.poll(()=>dialogs.length).toBe(2);
  expect(dialogs[1]).toContain('Google Drive 연결이 만료됐습니다');
  await expect.poll(()=>page.evaluate(()=>window.__driveReconnectCalls.at(-1))).toEqual({action:'drive-start'});
  await expect(page).toHaveURL(/#drive-auth$/);
  await expect(page.locator('[data-lu-document="doc-1"]')).toBeVisible();
});


test('mobile library upload opens the native file picker from the visible tap target',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/library-upload-failure-fixture.html');
  const zone=page.locator('#libraryDropzone');
  await expect(zone).toBeVisible();
  await expect(zone.locator('.library-picker-mobile')).toBeVisible();
  await expect(zone.locator('.library-picker-desktop')).toBeHidden();
  const chooser=page.waitForEvent('filechooser');
  await zone.click();
  const fileChooser=await chooser;
  await fileChooser.setFiles({name:'mobile-upload.pdf',mimeType:'application/pdf',buffer:Buffer.from('pdf')});
  await expect(page.locator('#librarySelectedFile')).toHaveText('mobile-upload.pdf');
});
