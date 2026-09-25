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


test('library cards expose no public or workspace visibility control',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/library-upload-failure-fixture.html');
  const card=page.locator('[data-lu-document="doc-1"]');
  await expect(card).toBeVisible({timeout:3000});
  await expect(card.locator('[data-lu-toggle-public],[data-lu-set-visibility]')).toHaveCount(0);
  await expect(card).not.toContainText(/외부 공개|팀 내부|나만 보기/);
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
  await expect(page.locator('#libraryFileInput')).toHaveJSProperty('multiple',true);
  const chooser=page.waitForEvent('filechooser');
  await zone.click();
  const fileChooser=await chooser;
  await fileChooser.setFiles({name:'mobile-upload.pdf',mimeType:'application/pdf',buffer:Buffer.from('pdf')});
  const selected=page.locator('[data-lu-upload-file]');
  await expect(selected).toHaveCount(1);
  await expect(selected.first()).toContainText('mobile-upload.pdf');
  await expect(selected.first().locator('[data-lu-upload-state]')).toHaveText('선택됨');
});


test('mobile library picker accepts multiple files and shows every selected filename',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/library-upload-failure-fixture.html');
  const chooser=page.waitForEvent('filechooser');
  await page.locator('#libraryDropzone').click();
  const fileChooser=await chooser;
  await fileChooser.setFiles([
    {name:'first-mobile.pdf',mimeType:'application/pdf',buffer:Buffer.from('first')},
    {name:'second-mobile.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from('second')}
  ]);
  const selected=page.locator('[data-lu-upload-file]');
  await expect(selected).toHaveCount(2);
  await expect(selected.nth(0)).toContainText('first-mobile.pdf');
  await expect(selected.nth(1)).toContainText('second-mobile.docx');
  await expect(selected.nth(0).locator('[data-lu-upload-state]')).toHaveText('선택됨');
  await expect(selected.nth(1).locator('[data-lu-upload-state]')).toHaveText('선택됨');
});

test('desktop drag and drop keeps all dropped files selected',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/library-upload-failure-fixture.html');
  await page.locator('#libraryDropzone').evaluate(zone=>{
    const data=new DataTransfer();
    data.items.add(new File(['one'],'desktop-one.pdf',{type:'application/pdf'}));
    data.items.add(new File(['two'],'desktop-two.pdf',{type:'application/pdf'}));
    zone.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
  });
  const selected=page.locator('[data-lu-upload-file]');
  await expect(selected).toHaveCount(2);
  await expect(selected.nth(0)).toContainText('desktop-one.pdf');
  await expect(selected.nth(1)).toContainText('desktop-two.pdf');
});

test('multi-file upload reuses library-files sequentially and preserves per-file failure state',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/library-upload-failure-fixture.html');
  await page.evaluate(()=>{window.__libraryUploadMode='partial'});
  await page.locator('#libraryFileInput').setInputFiles([
    {name:'ok.pdf',mimeType:'application/pdf',buffer:Buffer.from('ok')},
    {name:'fail.pdf',mimeType:'application/pdf',buffer:Buffer.from('fail')}
  ]);
  await page.locator('#saveDocumentBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__libraryUploadCalls)).toEqual(['ok.pdf','fail.pdf']);
  const selected=page.locator('[data-lu-upload-file]');
  await expect(selected).toHaveCount(2);
  await expect(selected.nth(0).locator('[data-lu-upload-state]')).toHaveText('완료');
  await expect(selected.nth(1).locator('[data-lu-upload-state]')).toHaveText('실패 · 다시 시도');
  await expect(page.locator('#documentStatus')).toContainText('1개 완료 · 1개 미완료');
  await expect(page.locator('#documentStatus')).toHaveAttribute('role','alert');
  await expect(page.locator('#documentModal')).toBeVisible();
  expect(await page.evaluate(()=>window.__documentsChanged)).toBeGreaterThan(0);
});
