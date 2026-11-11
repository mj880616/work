import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {bootLibrary,libFolder,menuButton,folderMenuItem,press} from './helpers/library-folder-server.mjs';
import {answerAsk} from './helpers/small-notice.mjs';
// S59-11 LIB-받는폴더(시안 docs/design/mockups/lib-receive-folder.html #2396, 명진 11/11 "잡동사니 시안 ㄱ"):
// 폴더 우클릭(폰 ⋯) 메뉴 한 줄 [폴더 안 정한 자료 받기]로 켜고 끈다(켜면 ✓, 받는 폴더는 하나뿐). 켠 폴더 줄에 작은 '받는 폴더'.
// 켤 때 지금 '폴더 밖' 자료 개수를 보여 주고 물은 뒤 한 번에 옮긴다(되돌리기 있음). 설정은 서버 프로필 칸(가짜 서버 state.receiveFolder),
// 폴더를 정하지 않고 올린 자료를 받는 폴더에 넣는 일은 서버(DB 트리거 — 가짜 서버의 library-files가 흉내)가 한다.
// 가짜 서버·지어낸 이름만 쓴다. RECEIVE_SHOTS에 폴더 경로를 주면 PR 사진(docs/design/screens/s59-11/)을 남긴다.
const RECV='5e000000-0000-4000-8000-000000000001',FA='5e000000-0000-4000-8000-000000000002';
const FOLDERS=[libFolder(FA,null,{name:'가상 A',sort_order:1024}),libFolder(RECV,null,{name:'잡동사니',sort_order:2048})];
const ITEMS=[{document_id:'a-1',folder_id:FA}];
const SHOTS=process.env.RECEIVE_SHOTS||'';
const shot=async(page,name,info)=>{if(SHOTS){mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:`${SHOTS}/${name}`})}await page.screenshot({path:info.outputPath(name)})};
const head=(page,id)=>page.locator(`#documentList details[data-lu-node="f:${id}"] > summary`);
const outside=page=>page.locator('#documentList details[data-lu-node="x:out"]');
const receiveItem=page=>page.locator('#luFolderMenu [data-lu-folder-action="receive"]');
const folderLabel=page=>page.locator('#documentModal #libraryUploadFolder');
const itemWrites=s=>s.writes.filter(w=>w.table==='items');
async function upload(page,name){
  await page.locator('#libraryFileInput').setInputFiles({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF synthetic')});
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toBeHidden();
  await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText(name+' 올렸어요');
}
async function openFolderMenu(page,id,width){await press(page,menuButton(page,'f:'+id),width);await expect(page.locator('#luFolderMenu')).toBeVisible()}

test.describe('PC 1280 한 칸(왼쪽 나무 | 목록)',()=>{
  test.use({hasTouch:false});
  test('메뉴로 켜기 → 폴더 밖 3개 옮기기 물음 → 옮김·표시·되돌리기, 올린 자료는 받는 폴더로, 연 폴더는 그 폴더로, 다른 폴더로 옮기기·끄기',async({page},info)=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:null}});
    await expect(outside(page)).toBeVisible();
    await expect(page.locator('.lu-receive-mark,.ft-tag')).toHaveCount(0);
    // 메뉴 한 줄(꺼짐): 색 선택 아래, 폴더 삭제 위.
    await openFolderMenu(page,RECV,1280);
    await expect(receiveItem(page)).toHaveText('폴더 안 정한 자료 받기');
    await expect(receiveItem(page)).toHaveAttribute('aria-pressed','false');
    const names=await page.locator('#luFolderMenu button').allTextContents();
    expect(names.indexOf('폴더 안 정한 자료 받기')).toBe(names.indexOf('색 선택…')+1);
    expect(names.at(-1)).toBe('폴더 삭제');
    await receiveItem(page).click();
    const asked=await answerAsk(page,true);
    expect(asked).toBe('폴더 밖 자료 3개도 ‘잡동사니’ 폴더로 옮길까요?');
    expect(s.receivePatches).toEqual([RECV]);
    // 한 요청으로 3줄(100개씩 덩어리).
    await expect.poll(()=>itemWrites(s).length).toBe(1);
    expect(itemWrites(s)[0].method).toBe('POST');
    expect(itemWrites(s)[0].body.map(r=>r.document_id).sort()).toEqual(['a-2','a1-1','n-1']);
    expect(itemWrites(s)[0].body.every(r=>r.folder_id===RECV&&r.workspace_id==='workspace-1')).toBe(true);
    await expect(outside(page)).toHaveCount(0);
    await expect(head(page,RECV).locator('.lu-receive-mark')).toHaveText('받는 폴더');
    await expect(head(page,FA).locator('.lu-receive-mark')).toHaveCount(0);
    await expect(page.locator(`#libraryFolderNav [data-lu-nav="${RECV}"] .ft-tag`)).toHaveText('받는 폴더');
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('옮겼어요 3개 → 잡동사니 폴더');
    await shot(page,'pc-1280-mark.png',info);
    // 되돌리기: 이번에 넣은 연결만 지워 다시 폴더 밖으로(받는 폴더 설정은 그대로).
    await page.locator('#libraryFolderStatusLine .lu-undo').click();
    await expect(outside(page)).toBeVisible();
    expect(s.items.map(x=>x.document_id)).toEqual(['a-1']);
    expect(s.receiveFolder).toBe(RECV);
    // 켠 폴더의 메뉴: ✓.
    await openFolderMenu(page,RECV,1280);
    await expect(receiveItem(page)).toHaveText('✓ 폴더 안 정한 자료 받기');
    await expect(receiveItem(page)).toHaveAttribute('aria-pressed','true');
    await shot(page,'pc-1280-menu.png',info);
    await page.keyboard.press('Escape');
    // 폴더를 열지 않고 [자료 등록]: 창에 '‘잡동사니’ 폴더에 넣어요', 올린 자료는 서버가 받는 폴더에 넣고 화면은 따로 쓰지 않는다.
    await page.locator('#newDocumentBtn').click();
    await expect(folderLabel(page)).toHaveText('‘잡동사니’ 폴더에 넣어요');
    await shot(page,'pc-1280-upload-line.png',info);
    const before=itemWrites(s).length;
    await upload(page,'받는-폴더.pdf');
    await expect.poll(()=>s.items.find(x=>x.document_id==='upload-1')?.folder_id).toBe(RECV);
    expect(itemWrites(s).length).toBe(before);
    await expect(head(page,RECV)).toBeVisible();
    await expect(page.locator('#documentList details[data-lu-node="x:out"] [data-lu-document="upload-1"]')).toHaveCount(0);
    // 폴더를 열고 올리면 지금처럼 그 폴더(서버가 받는 폴더에 넣은 줄을 연 폴더로 고침).
    await page.locator(`#libraryFolderNav [data-lu-nav="${FA}"]`).click({button:'right'});await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
    await page.locator('#newDocumentBtn').click();
    await expect(folderLabel(page)).toHaveText('‘가상 A’ 폴더에 넣어요');
    await upload(page,'연-폴더.pdf');
    await expect.poll(()=>s.items.find(x=>x.document_id==='upload-2')?.folder_id).toBe(FA);
    expect(s.items.filter(x=>x.document_id==='upload-2').length).toBe(1);
    // 다른 폴더에서 켜면 그쪽으로(하나뿐). 물음에 [그대로 두기] → 설정만 바뀌고 폴더 밖 자료는 그대로.
    await page.locator('#libraryFolderNav [data-lu-nav=""]').click();
    await expect(outside(page)).toBeVisible();
    await openFolderMenu(page,FA,1280);
    await expect(receiveItem(page)).toHaveAttribute('aria-pressed','false');
    const writes=itemWrites(s).length;
    await receiveItem(page).click();
    expect(await answerAsk(page,false)).toBe('폴더 밖 자료 3개도 ‘가상 A’ 폴더로 옮길까요?');
    await expect(head(page,FA).locator('.lu-receive-mark')).toHaveText('받는 폴더');
    await expect(head(page,RECV).locator('.lu-receive-mark')).toHaveCount(0);
    expect(s.receiveFolder).toBe(FA);expect(itemWrites(s).length).toBe(writes);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('이제 폴더를 정하지 않은 자료는 ‘가상 A’ 폴더로 들어가요');
    // 끄기: 같은 줄을 다시 누르면 꺼지고 표시가 없어진다. 창에도 줄이 없다(지금처럼 폴더 밖).
    await openFolderMenu(page,FA,1280);
    await receiveItem(page).click();
    await expect(page.locator('.lu-receive-mark,#libraryFolderNav .ft-tag')).toHaveCount(0);
    expect(s.receiveFolder).toBe(null);expect(s.receivePatches).toEqual([RECV,FA,null]);
    await page.locator('#newDocumentBtn').click();
    await expect(page.locator('#documentModal')).toBeVisible();
    await expect(folderLabel(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('받는 폴더를 휴지통에 넣으면 받지 않고(창 줄·표시 없음, 올린 자료는 폴더 밖), 설정 저장 실패는 알리고 그대로',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    await expect(head(page,RECV).locator('.lu-receive-mark')).toHaveText('받는 폴더');
    await openFolderMenu(page,RECV,1280);
    await folderMenuItem(page,'폴더 삭제').click();
    await answerAsk(page,true);
    await expect(head(page,RECV)).toHaveCount(0);
    await expect(page.locator('.lu-receive-mark,#libraryFolderNav .ft-tag')).toHaveCount(0);
    await page.locator('#newDocumentBtn').click();
    await expect(page.locator('#documentModal')).toBeVisible();
    await expect(folderLabel(page)).toHaveCount(0);
    await upload(page,'휴지통-뒤.pdf');
    await expect.poll(()=>s.uploads.length).toBe(1);
    expect(s.items.some(x=>x.document_id==='upload-1')).toBe(false);
    // 저장 실패: 메뉴로 켜려다 서버가 실패하면 알리고 설정·자료는 그대로.
    s.receiveFolderFail=true;
    await openFolderMenu(page,FA,1280);
    await receiveItem(page).click();
    await expect(page.locator('#libraryFolderStatusLine')).toHaveText('받는 폴더를 켜지 못했어요. 잠시 뒤 다시 해 주세요.');
    await expect(page.locator('.kptu-ask')).toHaveCount(0);
    expect(itemWrites(s).filter(w=>w.method==='POST').length).toBe(0);
    expect(errors).toEqual([]);
  });

  test('폴더가 아닌 곳에 PC 파일을 끌어 놓으면 서버가 받는 폴더에 넣고 결과 줄에 그 이름',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    await page.evaluate(names=>{const dt=new DataTransfer();for(const n of names)dt.items.add(new File(['%PDF synthetic'],n,{type:'application/pdf'}));
      for(const type of ['dragenter','dragover','drop'])document.querySelector('#documentSearch').dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}))},['가-자료.pdf','나-자료.pdf']);
    await expect(page.locator('#uploadDock:not([hidden]) .up-dock-text')).toHaveText('잡동사니에 2개 올렸어요');
    await expect.poll(()=>s.items.filter(x=>x.folder_id===RECV).map(x=>x.document_id).sort()).toEqual(['upload-1','upload-2']);
    expect(itemWrites(s)).toEqual([]);
    await expect(head(page,RECV).locator('.lu-node-count')).toHaveText('2');
    expect(errors).toEqual([]);
  });

  test('DB 적용 전(서버에 칸이 없음): 메뉴 줄이 없고 창 줄도 없다 — 지금과 같음',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolderMissing:true}});
    await openFolderMenu(page,RECV,1280);
    await expect(folderMenuItem(page,'색 선택…')).toBeVisible();
    await expect(receiveItem(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('#newDocumentBtn').click();
    await expect(page.locator('#documentModal')).toBeVisible();
    await expect(folderLabel(page)).toHaveCount(0);
    expect(s.receivePatches||[]).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('PC 1280 두 칸',()=>{
  test.use({hasTouch:false});
  test('두 칸 폴더 줄에도 같은 표시, 우클릭 메뉴로 켜기',async({page},info)=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:null,receiveFolder:null}});
    await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
    const row=page.locator(`#documentList [data-lu-pane-i="0"] [data-lu-nav="${RECV}"]`);
    await row.click({button:'right'});
    await expect(receiveItem(page)).toHaveText('폴더 안 정한 자료 받기');
    await receiveItem(page).click();
    await answerAsk(page,true);
    await expect.poll(()=>s.items.length).toBe(4);
    await expect(row.locator('.ft-tag')).toHaveText('받는 폴더');
    await expect(page.locator(`#documentList [data-lu-pane-i="1"] [data-lu-nav="${RECV}"] .ft-tag`)).toHaveText('받는 폴더');
    await expect(page.locator(`#documentList [data-lu-pane-i="0"] [data-lu-nav="${FA}"] .ft-tag`)).toHaveCount(0);
    await shot(page,'pc-1280-two-pane-mark.png',info);
    expect(errors).toEqual([]);
  });
});

test.describe('폴드 884(펼침) 두 칸',()=>{
  test.use({hasTouch:true});
  test('켜 둔 받는 폴더: 두 칸 줄 표시, 등록 창 한 줄, 가로로 넘치지 않음',async({page},info)=>{
    const {errors}=await bootLibrary(page,884,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:null,receiveFolder:RECV}});
    await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
    await expect(page.locator(`#documentList [data-lu-pane-i="0"] [data-lu-nav="${RECV}"] .ft-tag`)).toHaveText('받는 폴더');
    await expect(page.locator(`#documentList [data-lu-pane-i="0"] [data-lu-nav="${FA}"] .ft-tag`)).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await shot(page,'fold-884-two-pane-mark.png',info);
    await press(page,page.locator('#newDocumentBtn'),884);
    await expect(folderLabel(page)).toHaveText('‘잡동사니’ 폴더에 넣어요');
    expect(errors).toEqual([]);
  });
});

test.describe('폰 412',()=>{
  test.use({hasTouch:true});
  test('⋯ 메뉴 한 줄로 켜고 옮기기, 표시, 등록 창 한 줄, 가로로 넘치지 않음',async({page},info)=>{
    const {s,errors}=await bootLibrary(page,412,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{receiveFolder:null}});
    await openFolderMenu(page,RECV,412);
    await expect(receiveItem(page)).toBeVisible();
    await shot(page,'phone-412-menu.png',info);
    await receiveItem(page).tap();
    await expect(page.locator('.kptu-ask')).toBeVisible();
    await expect(page.locator('.kptu-ask .kptu-ask-text')).toHaveText('폴더 밖 자료 3개도 ‘잡동사니’ 폴더로 옮길까요?');
    await shot(page,'phone-412-ask.png',info);
    await answerAsk(page,true);
    await expect(outside(page)).toHaveCount(0);
    await expect(head(page,RECV).locator('.lu-receive-mark')).toHaveText('받는 폴더');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await shot(page,'phone-412-mark.png',info);
    await press(page,page.locator('#newDocumentBtn'),412);
    await expect(folderLabel(page)).toHaveText('‘잡동사니’ 폴더에 넣어요');
    await shot(page,'phone-412-upload-line.png',info);
    await page.locator('#libraryFileInput').setInputFiles({name:'폰.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF synthetic')});
    await page.locator('#saveDocumentBtn').tap();
    await expect.poll(()=>s.items.find(x=>x.document_id==='upload-1')?.folder_id).toBe(RECV);
    expect(errors).toEqual([]);
  });
});
