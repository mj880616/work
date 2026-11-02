import {test,expect} from '@playwright/test';
import {expandLibraryTree,libraryTopMenu,libraryExpandItem} from './helpers/library-tree.mjs';
import {bootLibrary,libFolder,libDoc,press} from './helpers/library-folder-server.mjs';
// S48-10 빠짐9: 자료실 칸 맨 위 오른쪽 ⋯ 하나에 [새 폴더]·[여러 개 고르기]·[모두 펴기·접기](따로 뜬 '선택'·'모두 펴기' 글자 없음).
// 빠짐10: 같은 글 원본 두 개(웹 + PDF)는 한 줄(대표 = PDF) + [원본 2]로 펼치기, 접힌 줄을 고르면 둘 다, 고른 수에 '— 접힌 n개 포함'.
const FOLDERS=[libFolder('fa','top-a',{name:'가상 성명',sort_order:1024})];
const DOCS=[libDoc('w-1','top-a',{title:'가상 성명 하나',file_name:'one.html',mime_type:'text/html'}),libDoc('p-1','top-a',{title:'가상 성명 하나',file_name:'one.pdf'}),libDoc('a-2','top-a'),libDoc('n-1',null)];
const ITEMS=[{document_id:'w-1',folder_id:'fa'},{document_id:'p-1',folder_id:'fa'}];
const rowSel=id=>`#documentList [data-lu-document="${id}"]`;

for(const width of [390,1280])test.describe(`자료실 맨 위 ⋯ · 같은 글 한 줄 ${width}`,()=>{
  test.use({hasTouch:width<761});
  test(`맨 위 ⋯ 메뉴 하나로 새 폴더·여러 개 고르기·모두 펴기/접기 ${width}`,async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더'});
    await expect(page.locator('#libraryExpandAll,#librarySelectBtn')).toHaveCount(0);
    await expect(page.locator('#libraryListCard .lu-select-row')).toBeHidden();
    // 메뉴 항목과 차례.
    await press(page,page.locator('#libraryTopMenuBtn'),width);
    await expect(page.locator('#luTopMenu button')).toHaveText(['새 폴더','여러 개 고르기','모두 펴기']);
    await page.keyboard.press('Escape');await expect(page.locator('#luTopMenu')).toBeHidden();
    // 모두 펴기 ↔ 모두 접기.
    await libraryTopMenu(page,'expand',{tap:width<761});await expect(page.locator('#documentList details[data-lu-node]:not([open])')).toHaveCount(0);
    expect((await libraryExpandItem(page)).text).toBe('모두 접기');
    // 새 폴더: 폴더 밖(맨 위)에 만든다.
    await libraryTopMenu(page,'folder',{tap:width<761});
    await page.locator('#libraryFolderName').fill('가상 새 폴더');await page.keyboard.press('Enter');await expect(page.locator('#libraryFolderModal')).toBeHidden();
    expect(s.writes.at(-1)).toMatchObject({table:'folders',method:'POST',body:{parent_id:null,name:'가상 새 폴더'}});
    // 여러 개 고르기 → 선택 줄이 나타나고, 메뉴 글자는 [고르기 끝내기].
    await libraryTopMenu(page,'select',{tap:width<761});
    await expect(page.locator('#librarySelectBar')).toBeVisible();
    await libraryTopMenu(page,'select-stop',{tap:width<761});
    await expect(page.locator('#librarySelectBar')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test(`같은 글 원본 두 줄은 한 줄 + [원본 2], 펼치면 둘 다, 접힌 줄을 고르면 둘 다 ${width}`,async({page})=>{
    const {errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더'});
    await expandLibraryTree(page);
    // 대표는 PDF 줄, 웹 줄은 접혀 있다(자료 행은 그대로).
    await expect(page.locator(rowSel('p-1'))).toBeVisible();await expect(page.locator(rowSel('w-1'))).toHaveCount(0);
    const twin=page.locator('#documentList [data-lu-twin="p-1"]');
    await expect(twin).toHaveText('원본 2');await expect(twin).toHaveAttribute('aria-expanded','false');
    await press(page,twin,width);
    await expect(page.locator(rowSel('w-1'))).toBeVisible();await expect(page.locator(rowSel('w-1'))).toHaveClass(/lu-row-twin/);
    await expect(page.locator('#documentList [data-lu-twin="p-1"]')).toHaveAttribute('aria-expanded','true');
    // [원본 n]을 눌러도 자료가 열리지 않는다(화면 그대로).
    await expect(page.locator('#libraryView')).toBeVisible();
    await press(page,page.locator('#documentList [data-lu-twin="p-1"]'),width);await expect(page.locator(rowSel('w-1'))).toHaveCount(0);
    // 접힌 줄을 고르면 같은 글 둘 다 골라지고, 보이지 않는 것은 '접힌 n개 포함'.
    await libraryTopMenu(page,'select',{tap:width<761});
    await page.locator('[data-lu-pick="p-1"]').check();
    await expect(page.locator('#librarySelectCount')).toHaveText('2개 골랐음 — 접힌 1개 포함');
    await page.locator('[data-lu-pick="p-1"]').uncheck();
    await expect(page.locator('#librarySelectCount')).toHaveText('0개 골랐음');
    expect(errors).toEqual([]);
  });
});

test('PC 1280: 접힌 같은 글 줄을 끌어 다른 폴더로 옮기면 둘 다 함께 옮겨진다',async({page})=>{
  const folders=[...FOLDERS,libFolder('fb',null,{name:'가상 다른 폴더',sort_order:2048})];
  const {s,errors}=await bootLibrary(page,1280,{folders,items:ITEMS,docs:DOCS,group:'폴더'});
  await expandLibraryTree(page);
  await page.evaluate(()=>{
    const src=document.querySelector('#documentList [data-lu-document="p-1"]'),dst=document.querySelector('#documentList details[data-lu-node="f:fb"] > summary'),dt=new DataTransfer(),r=dst.getBoundingClientRect();
    const x=r.left+r.width/2,y=r.top+r.height/2;
    src.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    dst.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y}));
    dst.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x,clientY:y}));
    src.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
  });
  await expect.poll(()=>s.items.filter(x=>x.folder_id==='fb').map(x=>x.document_id).sort()).toEqual(['p-1','w-1']);
  expect(errors).toEqual([]);
});
