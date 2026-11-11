import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,menuButton,folderMenuItem,press} from './helpers/library-folder-server.mjs';
// S55-15 LIB-두칸보기 남은 것(11/09 결정 '빈 자리 우클릭 [새 폴더][자료 등록]은 그 칸의 지금 폴더'): 빈 자리 우클릭·맨 위 [＋]로 연 [자료 등록] 창은
// 연 자리의 폴더(두 칸이면 그 칸의 지금 폴더, 한 칸이면 들어가 있는 폴더)로 넣는다. 창에 '‘폴더’ 폴더에 넣어요'가 보이고, [등록]한 자료는 그 폴더에 들어간다
// (자료 연결 표 한 줄, 끌어다 놓아 올리기와 같은 쓰기). 맨 위(자료실 전체)에서 열면 지금처럼 폴더 밖. 가짜 서버만 쓴다. 이름은 지어낸 것.
const FOLDERS=[
  libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),
  libFolder('fn',null,{name:'가상 N',sort_order:2048})
];
const ITEMS=[{document_id:'n-1',folder_id:'fa'}];
const pane=i=>`#documentList [data-lu-pane-i="${i}"]`;
const folderLabel=page=>page.locator('#documentModal #libraryUploadFolder');
const rightClick=(page,sel)=>page.evaluate(sel=>{const el=document.querySelector(sel),r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.bottom-6}))},sel);
async function upload(page,name){
  await page.locator('#libraryFileInput').setInputFiles({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF synthetic')});
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toBeHidden();
}

test.describe('PC 1440 두 칸',()=>{
  test.use({hasTouch:false});
  test('오른쪽 칸 폴더 안 빈 자리 우클릭 → [자료 등록] → 올린 자료가 그 폴더에, 맨 위 칸에서 열면 폴더 밖',async({page})=>{
    const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:null}});
    await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
    // S56-40: 두 칸 폴더 줄 누르기는 펼치기 — 들어가기는 우클릭 [이 폴더로 들어가기].
    await page.locator(`${pane(1)} [data-lu-nav="fa"]`).click({button:'right'});await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
    await expect(page.locator(`${pane(1)} .lu-pane-here`)).toHaveText('가상 A');
    await rightClick(page,pane(1));
    await expect(page.locator('#luAreaMenu button')).toHaveText(['새 폴더','자료 등록']);
    await page.locator('#luAreaMenu').getByRole('button',{name:'자료 등록',exact:true}).click();
    await expect(page.locator('#documentModal')).toBeVisible();
    await expect(folderLabel(page)).toHaveText('‘가상 A’ 폴더에 넣어요');
    await upload(page,'오른쪽-칸.pdf');
    expect(s.uploads.map(u=>u.id)).toEqual(['upload-1']);
    await expect.poll(()=>s.items.find(x=>x.document_id==='upload-1')?.folder_id).toBe('fa');
    await expect(page.locator(`${pane(1)} [data-lu-document="upload-1"]`)).toBeVisible();
    // 왼쪽 칸은 맨 위(자료실): 같은 메뉴로 열면 폴더 칸이 없고, 올린 자료는 폴더 밖.
    await rightClick(page,pane(0));
    await page.locator('#luAreaMenu').getByRole('button',{name:'자료 등록',exact:true}).click();
    await expect(page.locator('#documentModal')).toBeVisible();
    await expect(folderLabel(page)).toHaveCount(0);
    await upload(page,'맨-위.pdf');
    await expect.poll(()=>s.uploads.length).toBe(2);
    expect(s.items.some(x=>x.document_id==='upload-2')).toBe(false);
    expect(errors).toEqual([]);
  });
});

test.describe('PC 1440 한 칸',()=>{
  test.use({hasTouch:false});
  test('[▥ 두 칸] 끈 한 칸: 들어간 폴더에서 맨 위 [＋]로 열면 그 폴더로',async({page})=>{
    const {s,errors}=await bootLibrary(page,1440,{folders:FOLDERS,items:ITEMS,group:'폴더',init:{viewPrefs:{library_two:false}}});
    await expect(page.locator('#documentList [data-lu-two]')).toHaveCount(0);
    await page.locator('#libraryFolderNav [data-lu-nav="fn"]').click({button:'right'});await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click(); // UI-폴더누르기한규칙: 나무 줄 누르기 = 펼침만
    await page.locator('#newDocumentBtn').click();
    await expect(page.locator('#documentModal')).toBeVisible();
    await expect(folderLabel(page)).toHaveText('‘가상 N’ 폴더에 넣어요');
    await upload(page,'한-칸.pdf');
    await expect.poll(()=>s.items.find(x=>x.document_id==='upload-1')?.folder_id).toBe('fn');
    expect(errors).toEqual([]);
  });
});

test.describe('폰 390',()=>{
  test.use({hasTouch:true});
  test('들어간 폴더에서 [＋]로 열면 그 폴더로, 자료실 맨 위에서는 지금처럼 폴더 밖',async({page})=>{
    const {s,errors}=await bootLibrary(page,390,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    await press(page,page.locator('#newDocumentBtn'),390);
    await expect(page.locator('#documentModal')).toBeVisible();
    await expect(folderLabel(page)).toHaveCount(0);
    await page.locator('#documentModal [data-close],#documentModal .modal-close').first().tap();
    await expect(page.locator('#documentModal')).toBeHidden();
    await press(page,menuButton(page,'f:fa'),390);await press(page,folderMenuItem(page,'이 폴더로 들어가기'),390);
    await expect(page.locator('#libraryPath')).toHaveText('‹자료실›'); // 폰 위치 줄은 위 단계만(지금 폴더는 바로 아래 머리 줄)
    await expect(page.locator('#documentList details[data-lu-node]').first()).toHaveAttribute('data-lu-node','f:fa');
    await press(page,page.locator('#newDocumentBtn'),390);
    await expect(folderLabel(page)).toHaveText('‘가상 A’ 폴더에 넣어요');
    await page.locator('#libraryFileInput').setInputFiles({name:'폰.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF synthetic')});
    await press(page,page.locator('#saveDocumentBtn'),390);
    await expect(page.locator('#documentModal')).toBeHidden();
    await expect.poll(()=>s.items.find(x=>x.document_id==='upload-1')?.folder_id).toBe('fa');
    expect(errors).toEqual([]);
  });
});
