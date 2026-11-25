import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
// S70-09 LIB-PC우클릭(2026-11-25 명진 "이런데가 딱 새 폴더 만들기 이런걸 우클릭해서 하고싶은 곳인데 작동안험"): PC(마우스) 자료실 오른쪽 클릭은
// 윈도우 탐색기처럼 앱 메뉴 — 빈 곳(목록 상자 아래 남는 자리 포함) = [새 폴더][파일 올리기]…[모두 선택](지금 폴더), 파일 줄 = 그 줄 ⋯ 메뉴,
// 여러 개 고른 뒤 고른 줄 = 고른 것 전체 메뉴, 왼쪽 나무 폴더 줄 = 그 폴더 ⋯ 메뉴. 글 입력칸 위는 크롬 메뉴 그대로(앱 메뉴 없음·막지 않음).
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),libFolder('fc','child-a1',{name:'가상 C',parent_id:'fa',sort_order:0}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const DOCS=[0,1,2,3].map(i=>libDoc('d'+i,'top-a'));
const ITEMS=DOCS.map(d=>({document_id:d.id,folder_id:'fa'}));
const areaMenu=page=>page.locator('#luAreaMenu');
const texts=loc=>loc.evaluateAll(xs=>xs.filter(x=>x.checkVisibility()).map(x=>x.innerText.replace(/\s+/g,' ').trim()).filter(Boolean));
// 오른쪽 클릭 한 번이 브라우저 메뉴를 막았는지(앱 메뉴를 열었는지) 적어 둔다.
const watch=page=>page.evaluate(()=>{window.__ctx=null;window.addEventListener('contextmenu',e=>{window.__ctx={prevented:e.defaultPrevented}})});
const lastCtx=page=>page.evaluate(()=>window.__ctx);

test.describe('자료실 PC 오른쪽 클릭 1280',()=>{
  test.use({hasTouch:false});
  test('목록 아래 빈 곳 = [새 폴더][파일 올리기][모두 선택], [새 폴더]는 지금 폴더 안',async({page},info)=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더'});
    await page.locator('#libraryFolderNav [data-lu-nav="fa"]').click();
    await expect(page.locator('#documentList [data-lu-document]')).toHaveCount(4);
    await page.screenshot({path:info.outputPath('library-pc-before-right-click.png')});
    await watch(page);
    // 목록 상자 아래 남는 자리(목록이 짧은 폴더): 전에는 크롬 기본 메뉴가 떴다.
    const card=await page.locator('#libraryListCard').boundingBox(),list=await page.locator('#documentList').boundingBox();
    const at={x:list.x+list.width/2,y:card.y+card.height+60};
    expect(at.y).toBeLessThan(880);
    await page.mouse.click(at.x,at.y,{button:'right'});
    await expect(areaMenu(page)).toBeVisible();
    expect((await lastCtx(page)).prevented).toBe(true);
    const items=await texts(areaMenu(page).locator('button'));
    expect(items).toEqual(expect.arrayContaining(['새 폴더','파일 올리기','모두 선택']));
    expect(items[0]).toBe('새 폴더');expect(items[1]).toBe('파일 올리기');
    await page.screenshot({path:info.outputPath('library-pc-after-right-click.png')});
    await areaMenu(page).getByRole('button',{name:'새 폴더',exact:true}).click();
    await expect(page.locator('#libraryFolderTitle')).toHaveText('안에 폴더 만들기');
    await page.locator('#libraryFolderName').fill('가상 새것');await page.locator('#libraryFolderSave').click();
    await expect.poll(()=>s.folders.find(f=>f.name==='가상 새것')?.parent_id).toBe('fa');
    // 목록 상자 안 빈 자리(마지막 줄 아래)도 같은 메뉴, [모두 선택] = 지금 폴더 파일 모두.
    const lb=await page.locator('#documentList').boundingBox(),cb=await page.locator('#libraryListCard').boundingBox();
    expect(cb.y+cb.height-6).toBeGreaterThan(lb.y+lb.height);
    await page.mouse.click(lb.x+lb.width-60,cb.y+cb.height-6,{button:'right'});
    await expect(areaMenu(page)).toBeVisible();
    await areaMenu(page).getByRole('button',{name:'모두 선택',exact:true}).click();
    await expect(page.locator('#documentList .lu-row input.lu-pick:checked')).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  test('파일 줄 = 그 줄 ⋯ 메뉴, 여러 개 고른 뒤 고른 줄 = 고른 것 전체 메뉴',async({page})=>{
    const {errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더'});
    await page.locator('#libraryFolderNav [data-lu-nav="fa"]').click();
    const row=id=>page.locator(`#documentList [data-lu-document="${id}"]`);
    await row('d1').locator('[data-lu-menu]').click();
    await expect(page.locator('#luMorePanel')).toBeVisible();
    const viaMore=await texts(page.locator('#luMorePanel button'));
    expect(viaMore.length).toBeGreaterThan(2);
    await page.keyboard.press('Escape');await expect(page.locator('#luMorePanel')).toBeHidden();
    await row('d1').locator('.lu-row-title').click({button:'right'});
    await expect(page.locator('#luMorePanel')).toBeVisible();
    expect(await texts(page.locator('#luMorePanel button'))).toEqual(viaMore);
    await expect(areaMenu(page)).toBeHidden();
    await page.keyboard.press('Escape');await expect(page.locator('#luMorePanel')).toBeHidden();
    // Ctrl+누르기로 3개 고른 뒤 고른 줄 오른쪽 클릭 = 고른 3개 전체 메뉴(고르기 막대와 같은 일괄 동작).
    await page.keyboard.down('Control');
    for(const id of ['d0','d1','d2'])await row(id).locator('.lu-row-title').click();
    await page.keyboard.up('Control');
    await expect(page.locator('#documentList .lu-row input.lu-pick:checked')).toHaveCount(3);
    await row('d2').locator('.lu-row-title').click({button:'right'});
    await expect(page.locator('#luMorePanel')).toBeVisible();
    await expect(page.locator('#luMorePanel')).toContainText('3개 선택됨');
    await expect(page.locator('#luMorePanel')).toContainText('선택한 3개 폴더로 옮기기');
    await expect(page.locator('#luMorePanel')).toContainText('3개 삭제');
    expect(errors).toEqual([]);
  });

  test('왼쪽 나무 폴더 줄 = 그 폴더 ⋯ 메뉴, 검색 입력칸 위는 앱 메뉴 없음',async({page})=>{
    const {errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더'});
    const navRow=page.locator('#libraryFolderNav [data-lu-nav="fn"]').locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ft-row ")][1]');
    await navRow.hover();
    await navRow.locator('[data-lu-nav-more]').click();
    await expect(page.locator('#luFolderMenu')).toBeVisible();
    const viaMore=await texts(page.locator('#luFolderMenu button'));
    expect(viaMore[0]).toContain('이 폴더로 들어가기');
    await page.keyboard.press('Escape');await expect(page.locator('#luFolderMenu')).toBeHidden();
    await page.locator('#libraryFolderNav [data-lu-nav="fn"]').click({button:'right'});
    await expect(page.locator('#luFolderMenu')).toBeVisible();
    expect(await texts(page.locator('#luFolderMenu button'))).toEqual(viaMore);
    await page.keyboard.press('Escape');await expect(page.locator('#luFolderMenu')).toBeHidden();
    // 검색 입력칸: 복사·붙여넣기용 크롬 메뉴 그대로 — 앱 메뉴가 뜨지 않고 기본 동작도 막지 않는다.
    await watch(page);
    const search=page.locator('#libraryView input[type="search"], #libraryView input[placeholder*="검색"]').first();
    await expect(search).toBeVisible();
    await search.click({button:'right'});
    await page.waitForTimeout(200);
    expect((await lastCtx(page)).prevented).toBe(false);
    for(const id of ['#luAreaMenu','#luMorePanel','#luFolderMenu','#luTopMenu'])await expect(page.locator(id)).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('두 칸: 목록 상자 아래 빈 곳 = 누른 칸의 지금 폴더 메뉴',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더'});
    await page.getByRole('button',{name:'두 칸'}).click();
    await expect(page.locator('#documentList [data-lu-pane-i]')).toHaveCount(2);
    const pane=await page.locator('#documentList [data-lu-pane-i="1"]').boundingBox(),card=await page.locator('#libraryListCard').boundingBox();
    await watch(page);
    await page.mouse.click(pane.x+pane.width/2,card.y+card.height+40,{button:'right'});
    await expect(areaMenu(page)).toBeVisible();
    expect((await lastCtx(page)).prevented).toBe(true);
    await areaMenu(page).getByRole('button',{name:'새 폴더',exact:true}).click();
    await page.locator('#libraryFolderName').fill('가상 두칸');await page.locator('#libraryFolderSave').click();
    await expect.poll(()=>s.folders.some(f=>f.name==='가상 두칸')).toBe(true);
    expect(errors).toEqual([]);
  });
});
