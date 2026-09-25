import { test, expect } from '@playwright/test';

const FIXTURE='http://127.0.0.1:8123/tests/app-e2e/library-upload-failure-fixture.html';
const file=(name,body='data')=>({name,mimeType:'application/pdf',buffer:Buffer.from(body)});

async function openFixture(page,plan={}){
  await page.goto(FIXTURE);
  await expect(page.locator('#libraryFileInput')).toBeAttached({timeout:3000});
  await page.evaluate(plan=>{window.__libraryUploadPlan=plan},plan);
}

async function expectFailureSettled(page,{selected=1}={}){
  const save=page.locator('#saveDocumentBtn');
  await expect(save).toBeEnabled();
  await expect(save).not.toHaveAttribute('aria-busy','true');
  await expect(page.locator('#documentStatus')).toHaveAttribute('role','alert');
  await expect(page.locator('#documentModal')).toBeVisible();
  await expect(page.locator('#documentModal')).not.toHaveClass(/hidden/);
  await expect(page.locator('[data-lu-upload-file]')).toHaveCount(selected);
}

const states=page=>page.locator('[data-lu-upload-state]').allTextContents();
const calls=page=>page.evaluate(()=>window.__libraryUploadCalls);

test('library upload timeout is an unknown outcome, releases busy state and never retries blindly',async({page})=>{
  await page.goto(FIXTURE);
  await expect(page.locator('#libraryFileInput')).toBeAttached({timeout:3000});
  await page.locator('#libraryFileInput').setInputFiles({name:'test.txt',mimeType:'text/plain',buffer:Buffer.from('test')});
  const save=page.locator('#saveDocumentBtn');
  await save.click();
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute('aria-busy','true');
  await expect(page.locator('#documentStatus')).toHaveAttribute('role','status');
  await expect(page.locator('#documentStatus')).toHaveAttribute('aria-live','polite');
  await save.evaluate(button=>button.onclick());
  await page.evaluate(()=>window.__releaseLibraryUpload?.());
  await expect(page.locator('#documentStatus')).toContainText('업로드 시간이 오래 걸려 결과를 확인하지 못했습니다',{timeout:3000});
  await expect(page.locator('#documentStatus')).not.toContainText('요청 시간이 초과되었습니다');
  await expectFailureSettled(page);
  expect(await states(page)).toEqual(['결과 확인 필요']);
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(0);
  await page.waitForTimeout(300);
  expect(await calls(page)).toEqual(['test.txt']);

  const dialogs=[];
  page.once('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss()});
  await save.click();
  await expect.poll(()=>dialogs.length).toBe(1);
  expect(dialogs[0]).toContain('중복 등록');
  await expect(page.locator('#documentStatus')).toContainText('결과를 확인하지 못한 파일은 다시 업로드하지 않았습니다');
  expect(await calls(page)).toEqual(['test.txt']);
  await expectFailureSettled(page);

  await page.evaluate(()=>{window.__libraryUploadMode='success'});
  page.once('dialog',dialog=>dialog.accept());
  await save.click();
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  expect(await calls(page)).toEqual(['test.txt','test.txt']);
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(1);
});

test('library upload uses its own size-scaled timeout instead of the 15 second runtime default',async({page})=>{
  await openFixture(page,{'small.pdf':[{ok:true}],'large.pdf':[{ok:true}]});
  await page.locator('#libraryFileInput').setInputFiles([file('small.pdf','x'),file('large.pdf','x'.repeat(3*1024*1024))]);
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  const opts=await page.evaluate(()=>window.__libraryUploadOpts.map(o=>o.timeoutMs));
  expect(opts).toEqual([94000,102000]);
  expect(opts.every(ms=>ms>15000&&ms<=600000)).toBe(true);
});

test('single file success closes the modal, clears selection and announces the change once',async({page})=>{
  await openFixture(page,{'ok.pdf':[{ok:true}]});
  await page.locator('#libraryFileInput').setInputFiles(file('ok.pdf'));
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  await expect(page.locator('#documentStatus')).toHaveAttribute('role','status');
  await expect(page.locator('[data-lu-upload-file]')).toHaveCount(0);
  await expect(page.locator('#saveDocumentBtn')).toBeEnabled();
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(1);
});

const SINGLE_FAILURES=[
  ['network failure',{code:'network_error',message:'네트워크 연결을 확인한 뒤 다시 시도해 주세요.'},'네트워크 연결이 끊겨 업로드 결과를 확인하지 못했습니다. 네트워크 연결을 확인하고 자료실 목록에서 등록 여부를 확인한 뒤 다시 시도해 주세요.','결과 확인 필요'],
  ['gateway timeout',{status:504,message:'upstream request timeout'},'업로드 시간이 오래 걸려 결과를 확인하지 못했습니다. 자료실 목록에서 등록 여부를 확인한 뒤 다시 시도해 주세요.','결과 확인 필요'],
  ['session expiry',{status:401,code:'session_required',message:'로그인이 필요합니다.'},'로그인 세션이 만료됐습니다. 다시 로그인한 뒤 업로드해 주세요.','실패 · 다시 시도'],
  ['file too large',{status:413,message:'현재 자료실 파일은 100MB까지 지원합니다.'},'현재 자료실은 파일당 100MB까지 지원합니다.','100MB 초과'],
  ['generic 4xx',{status:400,message:'raw server detail'},'파일을 업로드하지 못했습니다. 파일과 입력값을 확인한 뒤 다시 시도해 주세요.','실패 · 다시 시도'],
  ['retryable 5xx',{status:503,retryable:true,message:'raw server detail'},'파일을 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.','실패 · 다시 시도'],
  ['unexpected 500',{status:500,retryable:true,message:'duplicate key value violates constraint'},'파일을 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.','실패 · 다시 시도']
];
for(const [name,error,message,label] of SINGLE_FAILURES){
  test(`single file ${name} shows a normalized message and keeps the form recoverable`,async({page})=>{
    await openFixture(page,{'one.pdf':[error]});
    await page.locator('#libraryFileInput').setInputFiles(file('one.pdf'));
    await page.locator('#saveDocumentBtn').click();
    await expect(page.locator('#documentStatus')).toHaveText(message);
    await expect(page.locator('#documentStatus')).not.toContainText(/raw server detail|duplicate key|upstream request/);
    await expectFailureSettled(page);
    expect(await states(page)).toEqual([label]);
    expect(await page.evaluate(()=>window.__documentsChanged)).toBe(0);
    await page.waitForTimeout(200);
    expect(await calls(page)).toEqual(['one.pdf']);
  });
}

test('non-retryable size failures and empty files are not sent again',async({page})=>{
  await openFixture(page,{'big.pdf':[{status:413}]});
  await page.locator('#libraryFileInput').setInputFiles([file('big.pdf'),{name:'empty.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(0)}]);
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentStatus')).toContainText('0개 완료 · 2개 미완료');
  await expectFailureSettled(page,{selected:2});
  expect(await states(page)).toEqual(['100MB 초과','빈 파일']);
  expect(await calls(page)).toEqual(['big.pdf']);
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentStatus')).toHaveText('다시 업로드할 수 있는 파일이 없습니다. 파일을 다시 선택해 주세요.');
  expect(await calls(page)).toEqual(['big.pdf']);
});

test('expired Drive connection keeps completed files, marks untried files as waiting and resumes only unfinished ones',async({page})=>{
  await openFixture(page,{
    'a.pdf':[{ok:true}],
    'b.pdf':[{status:424,message:'Google Drive 토큰 갱신에 실패했습니다.'},{ok:true}],
    'c.pdf':[{ok:true}]
  });
  const dialogs=[];
  page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss()});
  await page.locator('#libraryFileInput').setInputFiles([file('a.pdf'),file('b.pdf'),file('c.pdf')]);
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentStatus')).toContainText('1개 완료 · 2개 미완료. Google Drive 연결이 만료됐습니다. 다시 연결한 뒤 시도해 주세요.');
  await expectFailureSettled(page,{selected:3});
  expect(dialogs[0]).toContain('Google Drive 연결이 만료됐습니다');
  expect(await page.evaluate(()=>window.__driveReconnectCalls.length)).toBe(0);
  expect(await states(page)).toEqual(['완료','실패 · 다시 시도','대기 · 업로드 전']);
  expect(await calls(page)).toEqual(['a.pdf','b.pdf']);
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(1);

  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  expect(await calls(page)).toEqual(['a.pdf','b.pdf','b.pdf','c.pdf']);
});

test('drive auth failure starts the existing reconnect flow when the owner accepts',async({page})=>{
  await openFixture(page,{'a.pdf':[{status:424,message:'Google Drive 토큰 갱신에 실패했습니다.'}]});
  page.on('dialog',dialog=>dialog.accept());
  await page.locator('#libraryFileInput').setInputFiles(file('a.pdf'));
  await page.locator('#saveDocumentBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__driveReconnectCalls.at(-1))).toEqual({action:'drive-start'});
  await expect(page).toHaveURL(/#drive-auth$/);
});

test('partial success retries only the failed file and never re-uploads completed files',async({page})=>{
  await openFixture(page,{'a.pdf':[{ok:true}],'b.pdf':[{status:503,retryable:true},{ok:true}],'c.pdf':[{ok:true}]});
  await page.locator('#libraryFileInput').setInputFiles([file('a.pdf'),file('b.pdf'),file('c.pdf')]);
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentStatus')).toContainText('2개 완료 · 1개 미완료. 파일을 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요. 다시 저장하면 완료되지 않은 파일만 업로드합니다.');
  await expectFailureSettled(page,{selected:3});
  expect(await states(page)).toEqual(['완료','실패 · 다시 시도','완료']);
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(1);

  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  await expect(page.locator('#documentStatus')).toContainText('3개 파일 등록 완료');
  expect(await calls(page)).toEqual(['a.pdf','b.pdf','c.pdf','b.pdf']);
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(2);
});

test('timeout in a multi-file batch stops before untried files and keeps the unknown file out of blind retry',async({page})=>{
  await openFixture(page,{'a.pdf':[{ok:true}],'b.pdf':[{code:'timeout'}],'c.pdf':[{ok:true}]});
  await page.locator('#libraryFileInput').setInputFiles([file('a.pdf'),file('b.pdf'),file('c.pdf')]);
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentStatus')).toContainText('1개 완료 · 2개 미완료. 업로드 시간이 오래 걸려 결과를 확인하지 못했습니다');
  await expect(page.locator('#documentStatus')).not.toContainText('다시 저장하면');
  await expectFailureSettled(page,{selected:3});
  expect(await states(page)).toEqual(['완료','결과 확인 필요','대기 · 업로드 전']);
  expect(await calls(page)).toEqual(['a.pdf','b.pdf']);

  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentStatus')).toContainText('2개 완료 · 1개 미완료. 업로드 시간이 오래 걸려');
  expect(await calls(page)).toEqual(['a.pdf','b.pdf','c.pdf']);
  expect(await states(page)).toEqual(['완료','결과 확인 필요','완료']);
  await expect(page.locator('#documentModal')).toBeVisible();
});

test('long failure text wraps inside the upload modal on narrow phones',async({page})=>{
  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:800});
    await openFixture(page,{'a.pdf':[{ok:true}],'b.pdf':[{code:'network_error'}]});
    await page.locator('#libraryFileInput').setInputFiles([file('a.pdf'),file('b-'+'매우긴파일명'.repeat(12)+'.pdf')]);
    await page.evaluate(()=>{window.__libraryUploadPlan[document.querySelector('#libraryFileInput').files[1].name]=[{code:'network_error'}]});
    await page.locator('#saveDocumentBtn').click();
    await expect(page.locator('#documentStatus')).toContainText('네트워크 연결이 끊겨');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow,`horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    await expect(page.locator('#saveDocumentBtn')).toBeEnabled();
  }
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
