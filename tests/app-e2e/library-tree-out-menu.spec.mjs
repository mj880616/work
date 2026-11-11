import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder} from './helpers/library-folder-server.mjs';
// S55-08 PR-2 (2026-11-09 명진 요청): LIB-나무폴더밖 · LIB-우클릭메뉴 · LIB-위쪽줄여백. 이름은 지어낸 것.
const FOLDERS=[
  libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),
  libFolder('fc','child-a1',{name:'가상 C',parent_id:'fa',sort_order:0}),
  libFolder('fn',null,{name:'가상 N',sort_order:2048})
];
const ITEMS=[{document_id:'a-1',folder_id:'fc'},{document_id:'n-1',folder_id:'fa'}];
const navRoot=page=>page.locator('#libraryFolderNav');
const nav=id=>`#libraryFolderNav [data-lu-nav="${id}"]`;
const enterNav=async(page,id)=>{await page.locator(nav(id)).click({button:'right'});await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click()}; // UI-폴더누르기한규칙: 나무 줄 누르기 = 펼침만, 들어가기 = 우클릭 [이 폴더로 들어가기]
const row=id=>`#documentList [data-lu-document="${id}"]`;
const tops=page=>page.locator('#documentList > details').evaluateAll(xs=>xs.map(x=>x.dataset.luNode));
const navNames=page=>page.locator('#libraryFolderNav .ft-main').evaluateAll(xs=>xs.map(x=>x.querySelector('.ft-name')?.textContent.trim()));
const outCount=page=>page.locator('#documentList details[data-lu-node="x:out"] > summary .lu-node-count').textContent();
const areaMenu=page=>page.locator('#luAreaMenu');
const folderMenu=page=>page.locator('#luFolderMenu');

for(const width of [1440,884])test.describe(`자료실 ${width}`,()=>{
  test.use({hasTouch:false});
  test('LIB-나무폴더밖: 나무 \'자료실 전체\' 바로 아래 \'폴더 밖 n\', 누르면 폴더 밖 자료만, 뒤로가기는 전체로, 끌어 놓으면 폴더 밖, 비면 줄 없음',async({page})=>{
    test.setTimeout(90000);
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    await expect(navRoot(page)).toBeVisible();
    expect((await navNames(page)).slice(0,3)).toEqual(['자료실 전체','폴더 밖','가상 A']);
    const n=(await outCount(page)).trim();
    await expect(page.locator(nav('x:out')+' .ft-num')).toHaveText(n);
    await expect(page.locator(nav('x:out')+' .ft-ico')).toHaveCount(1);
    // 누르면 오른쪽은 폴더 밖 자료만, 고른 줄 표시.
    await page.locator(nav('x:out')).click();
    await expect.poll(()=>tops(page)).toEqual(['x:out']);
    await expect(page.locator(nav('x:out'))).toHaveAttribute('aria-current','true');
    await expect(page.locator(nav(''))).not.toHaveAttribute('aria-current','true');
    await expect(page.locator(row('a-2'))).toBeVisible();
    // 뒤로가기 = 한 단계 위(자료실 전체).
    await page.goBack();
    await expect.poll(()=>tops(page)).toEqual(['x:out','f:fa','f:fn']);
    await expect(page.locator(nav(''))).toHaveAttribute('aria-current','true');
    // 폴더로 들어갔다가 '폴더 밖' 줄을 누르면 폴더에서 나와 폴더 밖만.
    await enterNav(page,'fa');await expect.poll(()=>tops(page)).toEqual(['f:fa']);
    await page.locator(nav('x:out')).click();await expect.poll(()=>tops(page)).toEqual(['x:out']);
    await page.locator(nav('')).click();await expect.poll(()=>tops(page)).toEqual(['x:out','f:fa','f:fn']);
    // 폴더 안 자료를 끌어 '폴더 밖' 줄에 놓으면 폴더 밖으로.
    await page.locator('#documentList details[data-lu-node="f:fa"]').evaluate(d=>{d.open=true});
    await page.locator(row('n-1')).dragTo(page.locator(nav('x:out')));
    await expect.poll(()=>s.items.some(x=>x.document_id==='n-1')).toBe(false);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('폴더 밖');
    // 폴더 밖 자료를 모두 폴더로 옮기면(0개) 오른쪽 목록과 같이 그 줄도 없다.
    for(const id of ['a-2','a1-1','n-1']){await page.locator('#documentList details[data-lu-node="x:out"]').evaluate(d=>{d.open=true});await page.locator(row(id)).dragTo(page.locator(nav('fn')));await expect.poll(()=>s.items.find(x=>x.document_id===id)?.folder_id).toBe('fn')}
    await expect(page.locator('#documentList details[data-lu-node="x:out"]')).toHaveCount(0);
    await expect(page.locator(nav('x:out'))).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('LIB-우클릭메뉴: 빈 자리 = [새 폴더][자료 등록](들어간 폴더 안에 새 폴더), 나무 폴더 줄 = 폴더 메뉴(이름 바꾸기 바로)',async({page})=>{
    test.setTimeout(90000);
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더'});
    const nb=await navRoot(page).boundingBox();
    // 왼쪽 나무 빈 곳(마지막 줄 아래).
    const blank={x:nb.x+30,y:nb.y+nb.height-20};
    await page.mouse.click(blank.x,blank.y,{button:'right'});
    await expect(areaMenu(page)).toBeVisible();await expect(areaMenu(page).locator('button')).toHaveText(['새 폴더','자료 등록']);
    const mb=await areaMenu(page).boundingBox();expect(Math.abs(mb.x-blank.x)).toBeLessThan(40);expect(Math.abs(mb.y-blank.y)).toBeLessThan(220);
    await areaMenu(page).getByRole('button',{name:'새 폴더'}).click();
    await expect(page.locator('#libraryFolderModal')).toBeVisible();await expect(page.locator('#libraryFolderTitle')).toHaveText('폴더 만들기');
    await page.locator('#libraryFolderName').fill('가상 새');await page.locator('#libraryFolderSave').click();
    await expect.poll(()=>{const f=s.folders.find(x=>x.name==='가상 새');return f?f.parent_id||null:'none'}).toBeNull();
    // 폴더에 들어가 있으면 그 안에.
    await enterNav(page,'fa');await expect.poll(()=>tops(page)).toEqual(['f:fa']);
    await page.mouse.click(blank.x,blank.y,{button:'right'});
    await areaMenu(page).getByRole('button',{name:'새 폴더'}).click();
    await expect(page.locator('#libraryFolderTitle')).toHaveText('안에 폴더 만들기');
    await page.locator('#libraryFolderName').fill('가상 안');await page.locator('#libraryFolderSave').click();
    await expect.poll(()=>s.folders.find(f=>f.name==='가상 안')?.parent_id).toBe('fa');
    // 오른쪽 목록 바탕(어느 폴더도 아님) = 같은 메뉴, [자료 등록] = 등록 창.
    await page.locator(nav('')).click();await expect.poll(async()=>(await tops(page)).length).toBe(4);
    await page.evaluate(()=>{const l=document.querySelector('#documentList'),r=l.getBoundingClientRect();l.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.right-40,clientY:r.bottom-6}))});
    await expect(areaMenu(page).locator('button')).toHaveText(['새 폴더','자료 등록']);
    await areaMenu(page).getByRole('button',{name:'자료 등록'}).click();
    await expect(page.locator('#documentModal')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.locator('#documentModal')).toBeHidden();
    // 나무 폴더 줄 우클릭 = 오른쪽 폴더 줄 ⋯와 같은 메뉴, [이름 바꾸기]는 그 나무 줄에서 바로.
    await page.locator(nav('fn')).click({button:'right'});
    await expect(folderMenu(page)).toBeVisible();await expect(folderMenu(page).locator('button').first()).toContainText('이름 바꾸기');
    await expect(areaMenu(page)).toBeHidden();
    await folderMenu(page).getByRole('button',{name:/이름 바꾸기/}).click();
    const input=page.locator('#libraryFolderNav input.lu-fnav-rename');await expect(input).toBeFocused();
    const ib=await input.boundingBox();await page.mouse.click(ib.x+3,ib.y+ib.height/2);await expect(input).toBeFocused();
    await input.press('End');await page.keyboard.type(' 2');await page.keyboard.press('Enter');
    await expect.poll(()=>s.folders.find(f=>f.id==='fn').name).toBe('가상 N 2');
    await expect(page.locator(nav('fn')+' .ft-name')).toHaveText('가상 N 2');
    // 자료 줄 우클릭은 지금처럼 자료 ⋯ 메뉴, 글자 칸은 브라우저 메뉴(앱 메뉴 없음).
    await page.locator('#documentList details[data-lu-node="x:out"]').evaluate(d=>{d.open=true});
    await page.locator(row('a-2')).click({button:'right'});
    await expect(page.locator('#luMorePanel')).toBeVisible();await expect(areaMenu(page)).toBeHidden();await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });
});

for(const width of [1440,884,412])test(`LIB-위쪽줄여백 ${width}: 위쪽 한 줄과 '최근 올린 파일' 상자 사이 = 도구 줄 공용 간격(8px)`,async({page})=>{
  test.setTimeout(60000);
  const {errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,group:'폴더'});
  await expect(page.locator('#libraryRecent')).toBeVisible();
  const gap=await page.evaluate(()=>{const a=document.querySelector('.library-filter-toolbar .lu-search-row').getBoundingClientRect(),b=document.querySelector('#libraryRecent').getBoundingClientRect(),space=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kptu-space-2'));return {gap:Math.round(b.top-a.bottom),space}});
  expect(gap.gap).toBe(gap.space);
  await page.screenshot({path:`test-results/library-top-gap-${width}.png`,clip:{x:0,y:0,width,height:360}});
  expect(errors).toEqual([]);
});
