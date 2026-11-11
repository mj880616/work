// LIB-다시그리기메뉴닫힘: 자료실이 뒤에서 다시 그려져도(저장 뒤 다시 읽기·AI 빈 칸 채우기 끝·폴더 바뀜 등) 사용자가 연 ⋯ 메뉴는 그대로다.
// 같은 줄이 새 목록에 있으면 메뉴가 그 줄의 새 ⋯에 붙어 자리·항목 실행이 그대로이고, 그 줄이 사라졌을 때만 닫힌다. 자료 줄 메뉴와 폴더 메뉴 둘 다.
// 가짜 서버만(helpers/library-folder-server.mjs). 폰 412·PC 1280. 사진: LIB_MENU_KEEP_SHOTS 폴더가 있으면 남긴다.
import {test,expect} from '@playwright/test';
import {expandLibraryTree} from './helpers/library-tree.mjs';
import {bootLibrary,libFolder,menuButton,press} from './helpers/library-folder-server.mjs';

const SHOTS=process.env.LIB_MENU_KEEP_SHOTS||'';
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A'})];
const ITEMS=[{document_id:'n-1',folder_id:'fa'}];
const docMenu=(page,id)=>page.locator(`#documentList [data-lu-menu="${id}"]`);
// 지금 그 줄을 표시해 두고 알림으로 자료실을 다시 그린 뒤, 표시가 없는 새 줄이 그려질 때까지 기다린다(정말 다시 그려졌는지).
async function redraw(page,selector,event){
  await page.locator(selector).evaluate(el=>{el.dataset.oldDraw='1'});
  await page.evaluate(name=>window.dispatchEvent(new CustomEvent(name)),event);
  await expect(page.locator(selector)).not.toHaveAttribute('data-old-draw','1');
}
// 메뉴 상자가 그 칸 바로 옆(위·아래 몇 px 안)에 있는지.
async function nextTo(panel,trigger){
  const p=await panel.boundingBox(),t=await trigger.boundingBox();
  return Math.min(Math.abs(p.y-(t.y+t.height)),Math.abs(p.y+p.height-t.y))<24;
}

for(const width of [412,1280])test.describe(`다시 그려도 메뉴 유지 ${width}`,()=>{
  test.use({hasTouch:width<761});

  test('자료 ⋯: 다시 그려도 열린 채 새 줄에 붙고 항목이 실행된다 · 그 줄이 사라지면 닫힌다',async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS});
    await expandLibraryTree(page);
    const panel=page.locator('#luMorePanel');
    await press(page,docMenu(page,'a-1'),width);await expect(panel).toBeVisible();
    // 서버 쪽 자료가 바뀌었다(다른 화면 저장·AI 빈 칸 채우기) → 자료실이 다시 읽고 다시 그린다.
    s.docs.find(d=>d.id==='a-1').title='자료 a-1 (AI 채움)';
    await redraw(page,'#documentList [data-lu-menu="a-1"]','kptu:documents-changed');
    await expect(page.locator('#documentList [data-lu-document="a-1"] .lu-row-title')).toHaveText('자료 a-1 (AI 채움)');
    await expect(panel).toBeVisible();
    await expect(docMenu(page,'a-1')).toHaveAttribute('aria-expanded','true');
    expect(await nextTo(panel,docMenu(page,'a-1'))).toBe(true);
    if(SHOTS)await page.screenshot({path:`${SHOTS}/${width<761?'phone':'pc'}-${width}-library-menu-kept.png`});
    // 다시 그린 뒤에도 항목이 그 자료에 대해 실행된다.
    await press(page,panel.locator('[data-lu-edit]'),width);
    await expect(page.locator('#libraryEditModal')).toBeVisible();await expect(page.locator('#libraryEditTitle')).toHaveValue('자료 a-1 (AI 채움)');
    await page.keyboard.press('Escape');await expect(page.locator('#libraryEditModal')).toBeHidden();
    // 그 줄이 사라지면(다른 곳에서 지움) 메뉴는 닫힌다.
    await press(page,docMenu(page,'a-2'),width);await expect(panel).toBeVisible();
    s.docs=s.docs.filter(d=>d.id!=='a-2');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:documents-changed')));
    await expect(page.locator('#documentList [data-lu-document="a-2"]')).toHaveCount(0);
    await expect(panel).toBeHidden();
    expect(await page.evaluate(()=>history.state?.kptuLibraryMenu??null)).toBe(null);
    expect(errors).toEqual([]);
  });

  test('폴더 ⋯: 다시 그려도 열린 채 새 머리 줄에 붙고 항목이 실행된다',async({page})=>{
    const {errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS});
    await expandLibraryTree(page);
    const panel=page.locator('#luFolderMenu');
    await press(page,menuButton(page,'f:fa'),width);await expect(panel).toBeVisible();
    await redraw(page,'#documentList details[data-lu-node="f:fa"] > summary [data-lu-node-menu]','kptu:library-folders-changed');
    await expect(panel).toBeVisible();
    await expect(menuButton(page,'f:fa')).toHaveAttribute('aria-expanded','true');
    expect(await nextTo(panel,menuButton(page,'f:fa'))).toBe(true);
    if(SHOTS)await page.screenshot({path:`${SHOTS}/${width<761?'phone':'pc'}-${width}-library-folder-menu-kept.png`});
    await press(page,panel.locator('button',{hasText:'이름 바꾸기'}),width);
    await expect(page.locator('#documentList details[data-lu-node="f:fa"] > summary input')).toBeFocused();
    expect(errors).toEqual([]);
  });

  if(width>=761)test('PC 우클릭으로 연 자료 메뉴: 다시 그려도 누른 자리에 그대로',async({page})=>{
    const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS});
    await expandLibraryTree(page);
    const row=page.locator('#documentList [data-lu-document="a-1"] .lu-row-title'),panel=page.locator('#luMorePanel');
    const box=await row.boundingBox(),x=Math.round(box.x+20),y=Math.round(box.y+box.height/2);
    await page.mouse.click(x,y,{button:'right'});await expect(panel).toBeVisible();
    const before=await panel.boundingBox();
    s.docs.find(d=>d.id==='a-1').title='자료 a-1 바뀜';
    await redraw(page,'#documentList [data-lu-menu="a-1"]','kptu:documents-changed');
    await expect(panel).toBeVisible();
    await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
    const after=await panel.boundingBox();
    expect(Math.abs(after.x-before.x)).toBeLessThan(2);expect(Math.abs(after.y-before.y)).toBeLessThan(2);
    // 메뉴를 닫으면 ⋯는 제 자리 크기로 돌아간다(누른 자리 고정이 풀림).
    await page.keyboard.press('Escape');await expect(panel).toBeHidden();
    const real=await docMenu(page,'a-1').evaluate(el=>Object.prototype.hasOwnProperty.call(el,'getBoundingClientRect'));
    expect(real).toBe(false);
    expect(errors).toEqual([]);
  });
});
