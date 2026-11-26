import {test,expect} from '@playwright/test';
import {bootLibrary,libDoc,libFolder,press} from './helpers/library-folder-server.mjs';
// S70-73 LIB-드라이브자동등록(사용자 11/26 "자동으로 들어오게해야지 메뉴 없애고"): 자료실 ⋯에 [드라이브에서 가져오기]가 없고,
// 자료실을 열면 서버에 자동 등록 부탁(library-files {action:'drive-auto'})을 한 번 보낸다. 새 자료가 들어오면 목록에 보이고 한 줄('새 자료 n개').
// 들어온 게 없으면 아무 글도 없다. 가짜 서버·지어낸 이름만.
const RECV='5f730000-0000-4000-8000-000000000001';
for(const width of [390,1280])test.describe(`${width}`,()=>{
  test.use({hasTouch:width<761});
  test(`${width}: 자료실 ⋯에 [드라이브에서 가져오기] 없음 · 열면 자동 등록 부탁 한 번 · 새 자료 한 줄`,async({page})=>{
    const added=[libDoc('auto-1',null,{title:'가상 드라이브 새 자료',file_name:'auto-1.pdf'})];
    const {s,errors}=await bootLibrary(page,width,{folders:[libFolder(RECV,null,{name:'잡동사니'})],items:[],docs:[libDoc('a-1',null)],group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV,autoAdded:added}});
    await expect.poll(()=>(s.autoCalls||[]).length).toBe(1);
    expect(s.autoCalls[0]).toEqual({action:'drive-auto'}); // 화면은 action 하나만(작업공간·폴더 값 없음)
    await expect(page.locator('#libraryFolderStatusLine')).toHaveText('드라이브 자료실 폴더에서 새 자료 1개가 들어왔어요');
    await expect(page.locator('#documentList [data-lu-document="auto-1"]')).toHaveCount(1);
    await press(page,page.locator('#libraryTopMenuBtn'),width);
    await expect(page.locator('#luTopMenu')).toBeVisible();
    await expect(page.locator('#luTopMenu [data-lu-top="drive-import"]')).toHaveCount(0);
    await expect(page.locator('#luTopMenu')).not.toContainText('드라이브에서 가져오기');
    await expect(page.locator('#libraryDriveImportModal')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
test('새 자료가 없으면 한 줄도 없음',async({page})=>{
  const {s,errors}=await bootLibrary(page,1280,{folders:[],items:[],docs:[libDoc('a-1',null)],group:'폴더',init:{viewPrefs:{library_two:false}}});
  await expect.poll(()=>(s.autoCalls||[]).length).toBe(1);
  await page.waitForTimeout(300);
  await expect(page.locator('#libraryFolderStatusLine')).toBeHidden();
  expect(errors).toEqual([]);
});
