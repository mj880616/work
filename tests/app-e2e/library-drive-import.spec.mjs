import {test,expect} from '@playwright/test';
import {bootLibrary,libDoc,libFolder,press,SB} from './helpers/library-folder-server.mjs';
// S69-25 LIB-드라이브에서가져오기: 자료실 맨 위 ⋯ [드라이브에서 가져오기] → 드라이브에만 있는 파일이 폴더 경로별로 → 개인 서류·사진은 기본 해제
// → [‘잡동사니’로 가져오기 n] → 서버에 같은 드라이브 id만 보냄(파일 몸통 없음) → 결과 줄 → 권한이 없으면 [Drive 다시 연결] 안내. 가짜 서버·지어낸 이름만.
// S69-25b: 창 맨 위 [드라이브 폴더] 고르기 — 고른 폴더 id로만 목록·가져오기를 묻고, 고른 폴더는 서버 화면 기억(view_prefs.drive_import_folder)에 남는다.
const u=n=>`5f250000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const RECV=u(1);
const FOLDERS=[{id:'driveFolderAA01',name:'가상 노조 폴더'},{id:'driveFolderAA02',name:'가상 개인 폴더'}];
const ITEMS=[
  {id:'driveFileAAAA01',name:'가상 교섭 요구안.hwp',path:'가상 노조 폴더 › 가상 업무',kind:'file',size:20480,modified:'2026-11-01',personal:false,media:false},
  {id:'driveFileAAAA02',name:'가상 회의 메모',path:'가상 노조 폴더 › 가상 업무',kind:'link',size:null,modified:'2026-11-02',personal:false,media:false},
  {id:'driveFileAAAA03',name:'가상 여권 사본.pdf',path:'가상 노조 폴더',kind:'file',size:1024,modified:'2026-10-01',personal:true,media:false},
  {id:'driveFileAAAA04',name:'가상 사진.jpg',path:'가상 노조 폴더',kind:'file',size:4096,modified:'2026-10-02',personal:false,media:true},
];
const OTHER_ITEMS=[{id:'driveFileBBBB01',name:'가상 개인 메모.txt',path:'가상 개인 폴더',kind:'file',size:10,modified:'2026-09-01',personal:false,media:false}];
async function mockImport(page,{scope=true}={}){
  const calls=[];
  await page.route(`${SB}/functions/v1/library-files`,async route=>{
    const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204,body:''});
    const body=req.postDataJSON();calls.push(body);
    if(body.action==='drive-import-folders')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(scope?{ok:true,folders:FOLDERS}:{ok:false,code:'scope_missing'})});
    if(body.action==='drive-import-list'){const items=body.folder_id==='driveFolderAA01'?ITEMS:OTHER_ITEMS;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,folder:FOLDERS.find(f=>f.id===body.folder_id),items,total:items.length,more:false,partial:false,skipped:{registered:7,app:2,not_file:1,empty:0}})})}
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
    const {s,errors}=await bootLibrary(page,width,{folders:[libFolder(RECV,null,{name:'잡동사니'})],items:[],docs:[libDoc(u(9),null,{title:'이미 있는 자료'})],group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    const calls=await mockImport(page);
    await openImport(page,width);
    // 처음에는 고른 폴더가 없어 목록을 묻지 않는다(드라이브 전체를 훑지 않음).
    const pick=modal(page).locator('[data-di-folder]');
    await expect(pick.locator('option')).toHaveText(['폴더 선택','가상 노조 폴더','가상 개인 폴더']);
    await expect(modal(page).locator('.lu-di-group')).toHaveCount(0);
    expect(calls.map(c=>c.action)).toEqual(['drive-import-folders']);
    await pick.selectOption('driveFolderAA02');
    await expect(modal(page).locator('[data-di-pick="driveFileBBBB01"]')).toBeVisible();
    await pick.selectOption('driveFolderAA01');
    await expect(modal(page).locator('.lu-di-group')).toHaveCount(2);
    await expect(modal(page).locator('[data-di-pick="driveFileBBBB01"]')).toHaveCount(0);
    if(process.env.DI_SHOTS)await page.screenshot({path:`${process.env.DI_SHOTS}/di-${width}.png`});
    await expect(modal(page).locator('.lu-di-path')).toHaveText(['가상 노조 폴더 › 가상 업무','가상 노조 폴더']);
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
    expect(adds).toEqual([{action:'drive-import-add',folder_id:'driveFolderAA01',file_ids:['driveFileAAAA01','driveFileAAAA03']}]);
    expect(calls.filter(c=>c.action==='drive-import-list').map(c=>c.folder_id)).toEqual(['driveFolderAA02','driveFolderAA01']);
    await expect.poll(()=>s.viewPrefs?.drive_import_folder).toBe('driveFolderAA01'); // 고른 폴더는 서버 화면 기억에
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
  expect(calls.map(c=>c.action)).toEqual(['drive-import-folders']);
});
test('기억한 드라이브 폴더가 있으면 그 폴더 안을 바로 읽는다(목록에 없는 폴더면 고르기 비움)',async({page})=>{
  await bootLibrary(page,1280,{folders:[],items:[],group:'폴더',init:{viewPrefs:{library_two:false,drive_import_folder:'driveFolderAA01'}}});
  const calls=await mockImport(page);
  await openImport(page,1280);
  await expect(modal(page).locator('[data-di-folder]')).toHaveValue('driveFolderAA01');
  await expect(modal(page).locator('.lu-di-group')).toHaveCount(2);
  expect(calls.map(c=>[c.action,c.folder_id||null])).toEqual([['drive-import-folders',null],['drive-import-list','driveFolderAA01']]);
});
