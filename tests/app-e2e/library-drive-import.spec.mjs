import {test,expect} from '@playwright/test';
import {bootLibrary,libDoc,libFolder,press,SB} from './helpers/library-folder-server.mjs';
// S69-25 LIB-드라이브에서가져오기: 자료실 맨 위 ⋯ [드라이브에서 가져오기] → 드라이브에만 있는 파일이 폴더 경로별로 → 개인 서류·사진은 기본 해제
// → [‘잡동사니’로 가져오기 n] → 서버에 같은 드라이브 id만 보냄(파일 몸통 없음) → 결과 줄 → 권한이 없으면 [Drive 다시 연결] 안내. 가짜 서버·지어낸 이름만.
const u=n=>`5f250000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const RECV=u(1);
const ITEMS=[
  {id:'driveFileAAAA01',name:'가상 교섭 요구안.hwp',path:'내 드라이브 › 가상 업무',kind:'file',size:20480,modified:'2026-11-01',personal:false,media:false},
  {id:'driveFileAAAA02',name:'가상 회의 메모',path:'내 드라이브 › 가상 업무',kind:'link',size:null,modified:'2026-11-02',personal:false,media:false},
  {id:'driveFileAAAA03',name:'가상 여권 사본.pdf',path:'내 드라이브',kind:'file',size:1024,modified:'2026-10-01',personal:true,media:false},
  {id:'driveFileAAAA04',name:'가상 사진.jpg',path:'내 드라이브',kind:'file',size:4096,modified:'2026-10-02',personal:false,media:true},
];
async function mockImport(page,{scope=true}={}){
  const calls=[];
  await page.route(`${SB}/functions/v1/library-files`,async route=>{
    const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204,body:''});
    const body=req.postDataJSON();calls.push(body);
    if(body.action==='drive-import-list')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(scope?{ok:true,items:ITEMS,total:ITEMS.length,more:false,partial:false,skipped:{registered:7,app:2,not_file:1,empty:0}}:{ok:false,code:'scope_missing'})});
    if(body.action==='drive-import-add')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,added:body.file_ids.length,exists:0,unreadable:0,failed:0})});
    return route.fulfill({status:400,body:'{}'});
  });
  return calls;
}
const modal=page=>page.locator('#libraryDriveImportModal');
async function openImport(page,width){
  await press(page,page.locator('#libraryTopMenuBtn'),width);
  await press(page,page.locator('#luTopMenu [data-lu-top="drive-import"]'),width);
  await expect(modal(page)).toBeVisible();
}
for(const width of [1280,390]){
 test.describe(`${width}`,()=>{
  test.use({hasTouch:width<761});
  test(`${width}: 드라이브에만 있는 파일 목록 → 잡동사니로 가져오기(같은 id만 보냄)`,async({page})=>{
    const {errors}=await bootLibrary(page,width,{folders:[libFolder(RECV,null,{name:'잡동사니'})],items:[],docs:[libDoc(u(9),null,{title:'이미 있는 자료'})],group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    const calls=await mockImport(page);
    await openImport(page,width);
    await expect(modal(page).locator('.lu-di-group')).toHaveCount(2);
    if(process.env.DI_SHOTS)await page.screenshot({path:`${process.env.DI_SHOTS}/di-${width}.png`});
    await expect(modal(page).locator('.lu-di-path')).toHaveText(['내 드라이브 › 가상 업무','내 드라이브']);
    await expect(modal(page).locator('[data-di-pick="driveFileAAAA03"]')).not.toBeChecked();
    await expect(modal(page).locator('[data-di-pick="driveFileAAAA04"]')).not.toBeChecked();
    await expect(modal(page).locator('.lu-di-note')).toHaveText('개인 서류로 보여 뺐어요');
    await expect(modal(page).locator('#libraryDriveImportSub')).toContainText('자료실에 없는 파일 4개 · 선택 2개');
    await expect(modal(page).locator('#libraryDriveImportSub')).toContainText('이미 자료실에 있음 7');
    await expect(modal(page).locator('[data-di-apply]')).toHaveText("'잡동사니'로 가져오기 2");
    // 묶음 체크 해제 → 그 묶음 모두 빠짐, 낱개 다시 켜기.
    await modal(page).locator('[data-di-group="0"]').uncheck();
    await expect(modal(page).locator('[data-di-apply]')).toBeDisabled();
    await modal(page).locator('[data-di-pick="driveFileAAAA01"]').check();
    await modal(page).locator('[data-di-pick="driveFileAAAA03"]').check();
    await expect(modal(page).locator('[data-di-apply]')).toHaveText("'잡동사니'로 가져오기 2");
    await modal(page).locator('[data-di-apply]').click();
    await expect(modal(page).locator('#libraryDriveImportStatus')).toHaveText('2개 가져옴');
    const adds=calls.filter(c=>c.action==='drive-import-add');
    expect(adds).toEqual([{action:'drive-import-add',file_ids:['driveFileAAAA01','driveFileAAAA03']}]);
    await expect(modal(page).locator('[data-di-pick="driveFileAAAA01"]')).toHaveCount(0);
    await modal(page).locator('[data-di-close]').first().click();
    await expect(modal(page)).toBeHidden();
    expect(errors).toEqual([]);
  });
 });
}
test('권한이 없으면 목록 대신 [Drive 다시 연결] 안내',async({page})=>{
  await bootLibrary(page,1280,{folders:[],items:[],group:'폴더',init:{viewPrefs:{library_two:false}}});
  const calls=await mockImport(page,{scope:false});
  await openImport(page,1280);
  await expect(modal(page).locator('[data-di-reconnect]')).toBeVisible();
  await expect(modal(page).locator('[data-di-apply]')).toBeDisabled();
  expect(calls.map(c=>c.action)).toEqual(['drive-import-list']);
});
