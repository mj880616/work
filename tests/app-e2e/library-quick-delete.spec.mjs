import {test,expect} from '@playwright/test';
import {setup,openLibrary} from './helpers/library-multi-delete-scenario.mjs';
// LIB-바로지우기 (2026-10-28 명진 요청 08:28 ①): 자료 하나 지우기 — 묻지 않고 줄이 바로 빠지고 '지웠어요 · 되돌리기'.
// 서버 요청(document-actions delete, 하나씩 삭제와 같은 길)은 알림이 사라진 뒤 한 번만. 실패하면 줄이 되살아나고 작은 알림.
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const rows=page=>page.locator('#documentList [data-lu-document]');
async function remove(page,id){await page.locator(`[data-lu-menu="${id}"]`).click();await page.locator(`[data-lu-delete="${id}"]`).click()}
for(const width of [390,1280]){
  test(`library quick delete: undo sends nothing ${width}px`,async({page})=>{
    test.setTimeout(60000);
    const state=await setup(page,width),dialogs=[];page.on('dialog',async d=>{dialogs.push(d.type());await d.dismiss()});
    await openLibrary(page,BASE);
    await expect(rows(page)).toHaveCount(5);
    await remove(page,'n1');
    await expect(rows(page)).toHaveCount(4);
    await expect(page.locator('#kptuNotice .kptu-notice-text')).toHaveText('지웠어요');
    await page.locator('#kptuNotice .kptu-notice-undo').click();
    await expect(rows(page)).toHaveCount(5);
    await page.waitForTimeout(7000);
    expect(state.deletes).toEqual([]);expect(dialogs).toEqual([]);expect(state.errors).toEqual([]);
  });
  test(`library quick delete: sends once after the notice and keeps the row gone ${width}px`,async({page})=>{
    test.setTimeout(60000);
    const state=await setup(page,width),dialogs=[];page.on('dialog',async d=>{dialogs.push(d.type());await d.dismiss()});
    await openLibrary(page,BASE);
    await remove(page,'n1');
    await expect(rows(page)).toHaveCount(4);
    expect(state.deletes).toEqual([]);
    await expect.poll(()=>state.deletes,{timeout:12000}).toEqual([{action:'delete',document_id:'n1'}]);
    await page.waitForTimeout(500);
    await expect(rows(page)).toHaveCount(4);
    expect(state.deletes).toHaveLength(1);expect(dialogs).toEqual([]);expect(state.errors).toEqual([]);
  });
  test(`library quick delete: server failure brings the row back with a small notice ${width}px`,async({page})=>{
    test.setTimeout(60000);
    const state=await setup(page,width,{failIds:['n1']}),dialogs=[];page.on('dialog',async d=>{dialogs.push(d.type());await d.dismiss()});
    await openLibrary(page,BASE);
    await remove(page,'n1');
    await expect(rows(page)).toHaveCount(4);
    await expect(page.locator('[data-lu-document="n1"]')).toHaveCount(1,{timeout:15000});
    await expect(page.locator('#kptuNotice.error .kptu-notice-text')).toHaveText('지우지 못해 목록에 되살렸어요.');
    expect(state.deletes).toEqual([{action:'delete',document_id:'n1'}]);expect(dialogs).toEqual([]);expect(state.errors).toEqual([]);
  });
  test(`library quick delete: leaving the library sends at once ${width}px`,async({page})=>{
    test.setTimeout(60000);
    const state=await setup(page,width);
    await openLibrary(page,BASE);
    await remove(page,'n2');
    await page.evaluate(()=>window.KPTURouter.go('home',{source:'quick-delete-test'}));
    await expect.poll(()=>state.deletes,{timeout:4000}).toEqual([{action:'delete',document_id:'n2'}]);
    expect(state.errors).toEqual([]);
  });
}
