import { appOrigin } from './helpers/test-origin.mjs';
import {expandLibraryTree,revealLibraryRow} from './helpers/library-tree.mjs';
import { test, expect } from '@playwright/test';
import {answerAsk} from './helpers/small-notice.mjs';

const FIXTURE=`${appOrigin}/tests/app-e2e/library-upload-failure-fixture.html`;
const file=(name,body='data')=>({name,mimeType:'application/pdf',buffer:Buffer.from(body)});

async function openFixture(page,plan={}){
  await page.goto(FIXTURE);
  await expect(page.locator('#libraryFileInput')).toBeAttached({timeout:3000});
  await page.evaluate(plan=>{window.__libraryUploadPlan=plan},plan);
}

// UX-먼저묻고뒤에처리 3차(S57-1): [저장]하면 등록 창은 바로 닫히고 비워진다(올리는 동안 잠기지 않는다). 올리기는 뒤 줄에서,
// 못 올린 것은 공용 작은 알림(#kptuNotice, role=alert)에 예전 창 상태 줄과 같은 글로 알리고 다시 올릴 수 있으면 [다시]가 붙는다.
const noticeLine=page=>page.locator('#kptuNotice:not([hidden]) .kptu-notice-text');
const retryButton=page=>page.locator('#kptuNotice:not([hidden]) .kptu-notice-action',{hasText:'다시'});
async function expectFailureSettled(page,{retry=true}={}){
  const save=page.locator('#saveDocumentBtn');
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  await expect(page.locator('[data-lu-upload-file]')).toHaveCount(0);
  await expect(save).toBeEnabled();
  await expect(save).not.toHaveAttribute('aria-busy','true');
  await expect(page.locator('#newDocumentBtn')).toBeEnabled();
  await expect(page.locator('#libraryFileInput')).toBeEnabled();
  await expect(page.locator('#kptuNotice:not([hidden])')).toHaveAttribute('role','alert');
  await expect(retryButton(page)).toHaveCount(retry?1:0);
}

const states=page=>page.locator('[data-lu-upload-state]').allTextContents();
const calls=page=>page.evaluate(()=>window.__libraryUploadCalls);

test('library upload timeout is an unknown outcome, never locks the window and never retries blindly',async({page})=>{
  await page.goto(FIXTURE);
  await expect(page.locator('#libraryFileInput')).toBeAttached({timeout:3000});
  await page.locator('#libraryFileInput').setInputFiles({name:'test.txt',mimeType:'text/plain',buffer:Buffer.from('test')});
  const save=page.locator('#saveDocumentBtn');
  await save.click();
  // 창은 바로 닫히고 잠기지 않는다. 올리는 중은 자료실 화면 목록 위 공용 올리는 줄에 그 파일이 보인다.
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  await expect(save).toBeEnabled();
  await expect(save).not.toHaveAttribute('aria-busy','true');
  await expect(page.locator('#newDocumentBtn')).toBeEnabled();
  await expect(page.locator('#libraryView .up-rows .up-row')).toContainText('test.txt');
  await save.evaluate(button=>button.onclick()); // 닫힌 창의 [저장]을 또 눌러도 같은 파일을 두 번 보내지 않는다
  // The upload request is sent after the session check and file copy, so release the held request only once it has
  // actually arrived; releasing earlier is a no-op and the request hangs.
  await expect.poll(()=>page.evaluate(()=>typeof window.__releaseLibraryUpload)).toBe('function');
  await page.evaluate(()=>window.__releaseLibraryUpload());
  await expect(noticeLine(page)).toContainText('업로드 시간이 오래 걸려 결과를 확인하지 못했어요',{timeout:3000});
  await expect(noticeLine(page)).not.toContainText('요청 시간이 초과되었습니다');
  await expectFailureSettled(page);
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(0);
  await page.waitForTimeout(300);
  expect(await calls(page)).toEqual(['test.txt']);

  // [다시]는 결과를 확인하지 못한 파일을 저절로 보내지 않는다: 먼저 '중복 등록' 확인을 받는다.
  await retryButton(page).click();
  await expect(page.locator('.kptu-ask .kptu-ask-note')).toContainText('중복 등록');
  expect(await answerAsk(page,false)).toContain('업로드 결과를 확인하지 못한 파일 1개');
  await expect(noticeLine(page)).toContainText('결과를 확인하지 못한 파일은 다시 업로드하지 않았어요');
  expect(await calls(page)).toEqual(['test.txt']);
  await expectFailureSettled(page);

  await page.evaluate(()=>{window.__libraryUploadMode='success'});
  await retryButton(page).click();
  await answerAsk(page,true);
  await expect.poll(()=>calls(page)).toEqual(['test.txt','test.txt']);
  await expect(noticeLine(page)).toHaveText('test.txt 올렸어요');
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(1);
});

test('library upload uses its own size-scaled timeout instead of the 15 second runtime default',async({page})=>{
  await openFixture(page,{'small.pdf':[{ok:true}],'large.pdf':[{ok:true}]});
  await page.locator('#libraryFileInput').setInputFiles([file('small.pdf','x'),file('large.pdf','x'.repeat(3*1024*1024))]);
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  await expect(noticeLine(page)).toHaveText('2개 올렸어요');
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
  await expect(noticeLine(page)).toHaveText('ok.pdf 올렸어요');
  await expect(page.locator('#kptuNotice:not([hidden])')).toHaveAttribute('role','status');
  await expect(retryButton(page)).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(await calls(page)).toEqual(['ok.pdf']);
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(1);
});

const SINGLE_FAILURES=[
  ['network failure',{code:'network_error',message:'네트워크 연결을 확인한 뒤 다시 시도해 주세요.'},'네트워크 연결이 끊겨 업로드 결과를 확인하지 못했어요. 네트워크 연결을 확인하고 자료실 목록에서 등록 여부를 확인한 뒤 다시 시도해 주세요.','결과 확인 필요'],
  ['gateway timeout',{status:504,message:'upstream request timeout'},'업로드 시간이 오래 걸려 결과를 확인하지 못했어요. 자료실 목록에서 등록 여부를 확인한 뒤 다시 시도해 주세요.','결과 확인 필요'],
  ['session expiry',{status:401,code:'session_required',message:'로그인이 필요합니다.'},'로그인 세션이 만료됐습니다. 다시 로그인한 뒤 업로드해 주세요.','실패 · 다시 시도'],
  ['file too large',{status:413,message:'현재 자료실 파일은 100MB까지 지원합니다.'},'현재 자료실은 파일당 100MB까지 지원합니다.','100MB 초과'],
  ['generic 4xx',{status:400,message:'raw server detail'},'파일을 업로드하지 못했어요. 파일과 입력값을 확인한 뒤 다시 시도해 주세요.','실패 · 다시 시도'],
  ['retryable 5xx',{status:503,retryable:true,message:'raw server detail'},'파일을 업로드하지 못했어요. 잠시 후 다시 시도해 주세요.','실패 · 다시 시도'],
  ['unexpected 500',{status:500,retryable:true,message:'duplicate key value violates constraint'},'파일을 업로드하지 못했어요. 잠시 후 다시 시도해 주세요.','실패 · 다시 시도'],
  // LIB-자료등록실패: 서버가 실어 보낸 멈춘 단계(고정 글자)는 짧은 이름으로 붙고, 모르는 값은 붙지 않는다.
  ['5xx with server stage',{status:503,retryable:true,stage:'drive_token',message:'raw server detail'},'파일을 업로드하지 못했어요 (멈춘 곳: Drive 연결 확인). 잠시 후 다시 시도해 주세요.','실패 · 다시 시도'],
  ['5xx with record stage',{status:500,retryable:true,stage:'db_insert',message:'duplicate key value violates constraint'},'파일을 업로드하지 못했어요 (멈춘 곳: 자료 기록). 잠시 후 다시 시도해 주세요.','실패 · 다시 시도'],
  ['5xx with unknown stage',{status:500,retryable:true,stage:'<b>x</b>',message:'raw server detail'},'파일을 업로드하지 못했어요. 잠시 후 다시 시도해 주세요.','실패 · 다시 시도']
];
for(const [name,error,message,label] of SINGLE_FAILURES){
  test(`single file ${name} shows a normalized message and keeps the upload recoverable`,async({page})=>{
    await openFixture(page,{'one.pdf':[error]});
    await page.locator('#libraryFileInput').setInputFiles(file('one.pdf'));
    await page.locator('#saveDocumentBtn').click();
    await expect(noticeLine(page)).toHaveText(message);
    await expect(noticeLine(page)).not.toContainText(/raw server detail|duplicate key|upstream request/);
    // 예전 창의 파일 줄 상태 글자(label)가 가르던 것을 [다시]의 동작으로 본다:
    // '100MB 초과' = 다시 보낼 수 없음([다시] 없음) / '결과 확인 필요' = [다시]가 먼저 중복 확인을 물음 / '실패 · 다시 시도' = [다시]가 그 파일을 바로 다시 보냄.
    await expectFailureSettled(page,{retry:label!=='100MB 초과'});
    expect(await page.evaluate(()=>window.__documentsChanged)).toBe(0);
    await page.waitForTimeout(200);
    expect(await calls(page)).toEqual(['one.pdf']);
    if(label==='결과 확인 필요'){
      await retryButton(page).click();
      expect(await answerAsk(page,false)).toContain('업로드 결과를 확인하지 못한 파일 1개');
      await page.waitForTimeout(200);
      expect(await calls(page)).toEqual(['one.pdf']);
    }else if(label==='실패 · 다시 시도'){
      await retryButton(page).click();
      await expect.poll(()=>calls(page)).toEqual(['one.pdf','one.pdf']);
      await expect(page.locator('.kptu-ask')).toHaveCount(0);
    }else expect(label).toBe('100MB 초과');
  });
}

test('empty files are flagged before the window closes; non-retryable size failures are not sent again',async({page})=>{
  await openFixture(page,{'big.pdf':[{status:413}]});
  await page.locator('#libraryFileInput').setInputFiles([file('big.pdf'),{name:'empty.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(0)}]);
  const save=page.locator('#saveDocumentBtn');
  // 빈 파일은 창에서 바로 알 수 있다 → 닫지 않고 그 줄에 표시, 아무것도 보내지 않는다.
  await save.click();
  await expect(page.locator('#documentStatus')).toContainText('빈 파일은 업로드할 수 없어요.');
  await expect(page.locator('#documentStatus')).toHaveAttribute('role','alert');
  await expect(page.locator('#documentModal')).not.toHaveClass(/hidden/);
  await expect(page.locator('[data-lu-upload-file]')).toHaveCount(2);
  expect(await states(page)).toEqual(['선택됨','빈 파일']);
  await save.click();
  await page.waitForTimeout(200);
  expect(await calls(page)).toEqual([]);
  // 빈 파일을 빼고 저장 → 창이 닫히고 올린다. 서버가 413(100MB 초과)으로 거절한 파일은 [다시]가 없다(다시 보내지 않음).
  await page.locator('[data-lu-remove-file]').nth(1).click();
  await expect(page.locator('[data-lu-upload-file]')).toHaveCount(1);
  await save.click();
  await expect(noticeLine(page)).toHaveText('현재 자료실은 파일당 100MB까지 지원합니다.');
  await expectFailureSettled(page,{retry:false});
  await page.waitForTimeout(300);
  expect(await calls(page)).toEqual(['big.pdf']);
});

test('expired Drive connection keeps completed files, stops before untried files and resumes only unfinished ones',async({page})=>{
  await openFixture(page,{
    'a.pdf':[{ok:true}],
    'b.pdf':[{status:424,message:'Google Drive 토큰 갱신에 실패했습니다.'},{ok:true}],
    'c.pdf':[{ok:true}]
  });
  await page.locator('#libraryFileInput').setInputFiles([file('a.pdf'),file('b.pdf'),file('c.pdf')]);
  await page.locator('#saveDocumentBtn').click();
  expect(await answerAsk(page,false)).toContain('Google Drive 연결이 만료됐습니다');
  await expect(noticeLine(page)).toHaveText('1개 완료 · 2개 미완료. Google Drive 연결이 만료됐습니다. 다시 연결한 뒤 시도해 주세요.');
  await expectFailureSettled(page);
  expect(await page.evaluate(()=>window.__driveReconnectCalls.length)).toBe(0);
  expect(await calls(page)).toEqual(['a.pdf','b.pdf']);
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(1);

  await retryButton(page).click();
  await expect.poll(()=>calls(page)).toEqual(['a.pdf','b.pdf','b.pdf','c.pdf']);
  await expect(noticeLine(page)).toHaveText('2개 올렸어요');
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  expect(await calls(page)).toEqual(['a.pdf','b.pdf','b.pdf','c.pdf']);
});

test('drive auth failure starts the existing reconnect flow when the owner accepts',async({page})=>{
  await openFixture(page,{'a.pdf':[{status:424,message:'Google Drive 토큰 갱신에 실패했습니다.'}]});
  await page.locator('#libraryFileInput').setInputFiles(file('a.pdf'));
  await page.locator('#saveDocumentBtn').click();
  await answerAsk(page,true);
  await expect.poll(()=>page.evaluate(()=>window.__driveReconnectCalls.at(-1))).toEqual({action:'drive-start'});
  await expect(page).toHaveURL(/#drive-auth$/);
});


test('partial success retries only the failed file and never re-uploads completed files',async({page})=>{
  await openFixture(page,{'a.pdf':[{ok:true}],'b.pdf':[{status:503,retryable:true},{ok:true}],'c.pdf':[{ok:true}]});
  await page.locator('#libraryFileInput').setInputFiles([file('a.pdf'),file('b.pdf'),file('c.pdf')]);
  await page.locator('#saveDocumentBtn').click();
  await expect(noticeLine(page)).toHaveText('2개 완료 · 1개 미완료. 파일을 업로드하지 못했어요. 잠시 후 다시 시도해 주세요.');
  await expectFailureSettled(page);
  expect(await calls(page)).toEqual(['a.pdf','b.pdf','c.pdf']);
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(1);

  await retryButton(page).click();
  await expect(noticeLine(page)).toHaveText('b.pdf 올렸어요');
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
  expect(await calls(page)).toEqual(['a.pdf','b.pdf','c.pdf','b.pdf']);
  expect(await page.evaluate(()=>window.__documentsChanged)).toBe(2);
});

test('timeout in a multi-file batch stops before untried files and keeps the unknown file out of blind retry',async({page})=>{
  await openFixture(page,{'a.pdf':[{ok:true}],'b.pdf':[{code:'timeout'}],'c.pdf':[{ok:true}]});
  await page.locator('#libraryFileInput').setInputFiles([file('a.pdf'),file('b.pdf'),file('c.pdf')]);
  await page.locator('#saveDocumentBtn').click();
  await expect(noticeLine(page)).toContainText('1개 완료 · 2개 미완료. 업로드 시간이 오래 걸려 결과를 확인하지 못했어요');
  await expectFailureSettled(page);
  expect(await calls(page)).toEqual(['a.pdf','b.pdf']);

  // [다시] → 중복 확인에 [취소]: 결과를 모르는 b는 보내지 않고, 아직 보내지 않은 c만 올린다.
  await retryButton(page).click();
  await answerAsk(page,false);
  await expect(noticeLine(page)).toHaveText('c.pdf 올렸어요');
  expect(await calls(page)).toEqual(['a.pdf','b.pdf','c.pdf']);
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/);
});

test('long failure text wraps inside the small notice on narrow phones',async({page})=>{
  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:800});
    const longName='b-'+'매우긴파일명'.repeat(12)+'.pdf';
    await openFixture(page,{'a.pdf':[{ok:true}],[longName]:[{code:'network_error'}]});
    await page.locator('#libraryFileInput').setInputFiles([file('a.pdf'),file(longName)]);
    await page.locator('#saveDocumentBtn').click();
    await expect(noticeLine(page)).toContainText('네트워크 연결이 끊겨');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow,`horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    const box=await page.locator('#kptuNotice:not([hidden])').boundingBox();
    expect(box.x,`notice left edge at ${width}px`).toBeGreaterThanOrEqual(0);
    expect(box.x+box.width,`notice right edge at ${width}px`).toBeLessThanOrEqual(width);
    await expect(page.locator('#saveDocumentBtn')).toBeEnabled();
  }
});

test('library cards expose no public or workspace visibility control',async({page})=>{
  await page.goto(`${appOrigin}/tests/app-e2e/library-upload-failure-fixture.html`);
  const card=await revealLibraryRow(page,'doc-1');
  await expect(card.locator('[data-lu-toggle-public],[data-lu-set-visibility]')).toHaveCount(0);
  await expect(card).not.toContainText(/외부 공개|팀 내부|나만 보기/);
});

test('library secondary action does not open its card, while card body opens the document',async({page})=>{
  await page.goto(`${appOrigin}/tests/app-e2e/library-upload-failure-fixture.html`);
  const card=await revealLibraryRow(page,'doc-1');
  await expect(card).toHaveAttribute('role','button');
  await card.locator('[data-lu-menu]').click();
  await page.locator('[data-lu-edit="doc-1"]').click();
  await expect(page.locator('#libraryEditModal')).toBeVisible();
  await expect(page).toHaveURL(/library-upload-failure-fixture\.html$/);
  await page.locator('#libraryEditClose').click();
  // FILE-누르면동작: 파일 없이 주소만 있는 자료는 새 탭으로 연다(같은 탭을 떠나지 않는다).
  const [tab]=await Promise.all([page.waitForEvent('popup'),card.locator('h3').click()]);
  await expect(tab).toHaveURL(`${appOrigin}/tests/app-e2e/library-open-fixture.html`);
  await tab.close();
  await expect(page).toHaveURL(/library-upload-failure-fixture\.html$/);
});

test('revoked Google Drive token starts reconnect through the canonical function entry and keeps the record',async({page})=>{
  await page.goto(`${appOrigin}/tests/app-e2e/library-upload-failure-fixture.html`);
  await page.evaluate(()=>{window.__documentActionError='Token has been expired or revoked.'});
  const dialogs=[];
  page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept()});
  await revealLibraryRow(page,'doc-1');await page.locator('[data-lu-menu="doc-1"]').click();
  await page.locator('[data-lu-delete="doc-1"]').click();
  // LIB-바로지우기: 묻지 않고 줄이 빠지고 '지웠어요 · 되돌리기'. 창을 숨기면(자료실을 떠나는 것과 같은 길) 기다리지 않고 보낸다.
  await expect(page.locator('[data-lu-document="doc-1"]')).toHaveCount(0);
  expect(dialogs).toEqual([]);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden});
  // 서버가 Drive 만료로 거절 → 줄을 되살리고 작은 알림, 그다음 Drive 다시 연결을 한 번 묻는다(같은 공용 입구).
  // 다시 연결은 공용 작은 확인창으로 묻는다(브라우저 기본 창은 끝까지 없음).
  expect(await answerAsk(page,true)).toContain('Google Drive 연결이 만료됐습니다');
  expect(dialogs).toEqual([]);
  await expect.poll(()=>page.evaluate(()=>window.__driveReconnectCalls.at(-1))).toEqual({action:'drive-start'});
  await expect(page).toHaveURL(/#drive-auth$/);
  await expect(page.locator('[data-lu-document="doc-1"]')).toBeVisible();
  await expect(page.locator('#kptuNotice.error .kptu-notice-text')).toHaveText('삭제하지 못해 목록에 되살렸어요.');
});


test('mobile library upload opens the native file picker from the visible tap target',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${appOrigin}/tests/app-e2e/library-upload-failure-fixture.html`);
  // UI-회의결과창정리: 큰 점선 상자 대신 [📎 파일 고르기] 작은 버튼 한 줄 + 짧은 안내(폰은 끌어다 놓기 안내 없음).
  const zone=page.locator('#libraryDropzone');
  await expect(zone).toBeVisible();
  await expect(zone).toHaveText(/파일 선택/);
  expect((await zone.boundingBox()).height).toBeLessThanOrEqual(34);
  await expect(page.locator('.library-picker-hint')).toContainText('여러 개 · 파일당 100MB');
  await expect(page.locator('.library-drop-hint')).toBeHidden();
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
  await page.goto(`${appOrigin}/tests/app-e2e/library-upload-failure-fixture.html`);
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
  await page.goto(`${appOrigin}/tests/app-e2e/library-upload-failure-fixture.html`);
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

// UI-회의결과창정리: PC는 창 전체가 끌어다 놓는 자리이고, 파일을 끌고 들어올 때만 테두리를 보인다.
test('desktop library window accepts files dropped anywhere and outlines only while dragging',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await page.goto(`${appOrigin}/tests/app-e2e/library-upload-failure-fixture.html`);
  await expect(page.locator('.library-drop-hint')).toBeVisible();
  const card=page.locator('#documentModal .modal-card');
  await expect(card).not.toHaveClass(/drop-active/);
  await card.evaluate(el=>{const data=new DataTransfer();data.items.add(new File(['x'],'drag.pdf',{type:'application/pdf'}));el.querySelector('#docTitle').dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:data}))});
  await expect(card).toHaveClass(/drop-active/);
  await card.evaluate(el=>{const data=new DataTransfer();data.items.add(new File(['one'],'anywhere.hwp'));el.querySelector('#docTitle').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}))});
  await expect(card).not.toHaveClass(/drop-active/);
  const selected=page.locator('[data-lu-upload-file]');
  await expect(selected).toHaveCount(1);
  await expect(selected.first().locator('.file-kind')).toHaveText('HWP');
  await expect(selected.first()).toContainText('anywhere.hwp');
  await expect(selected.first().locator('[data-lu-remove-file]')).toBeVisible();
});

test('multi-file upload reuses library-files sequentially and keeps per-file failure state for the retry',async({page})=>{
  await page.goto(`${appOrigin}/tests/app-e2e/library-upload-failure-fixture.html`);
  await page.evaluate(()=>{window.__libraryUploadMode='partial'});
  await page.locator('#libraryFileInput').setInputFiles([
    {name:'ok.pdf',mimeType:'application/pdf',buffer:Buffer.from('ok')},
    {name:'fail.pdf',mimeType:'application/pdf',buffer:Buffer.from('fail')}
  ]);
  await page.locator('#saveDocumentBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.__libraryUploadCalls)).toEqual(['ok.pdf','fail.pdf']);
  await expect(noticeLine(page)).toHaveText('1개 완료 · 1개 미완료. 파일을 업로드하지 못했어요. 잠시 후 다시 시도해 주세요.');
  await expectFailureSettled(page);
  expect(await page.evaluate(()=>window.__documentsChanged)).toBeGreaterThan(0);
  // [다시]는 못 올린 그 파일만 다시 보낸다(올라간 ok.pdf는 다시 보내지 않음).
  await retryButton(page).click();
  await expect.poll(()=>page.evaluate(()=>window.__libraryUploadCalls)).toEqual(['ok.pdf','fail.pdf','fail.pdf']);
});
