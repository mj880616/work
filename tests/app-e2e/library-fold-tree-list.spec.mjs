import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder} from './helpers/library-folder-server.mjs';
// S51-20 FILES-폴드나무목록 ⑦(시안 docs/design/mockups/files-fold-tree-list.html '같은 종류'): 자료실 폴더 묶기도 펼친 폴드·PC(600px~)에서
// 왼쪽 폴더 나무 | 오른쪽 목록. 나무 줄을 누르면 그 폴더로 들어가고(위치 줄·주소 같은 길), 나무는 그대로 남는다. 폰(412)은 지금처럼 나무 칸 없음. 이름은 지어낸 것.
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),libFolder('fc','child-a1',{name:'가상 C',parent_id:'fa',sort_order:0}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const ITEMS=[{document_id:'a-1',folder_id:'fc'},{document_id:'n-1',folder_id:'fa'}];
const radio=(page,name)=>page.locator('#libraryGroupBy').getByRole('radio',{name});
const nav=page=>page.locator('#libraryFolderNav');
const tops=page=>page.locator('#documentList > details').evaluateAll(xs=>xs.map(x=>x.dataset.luNode));

for(const width of [700,884,1280])test(`자료실 ${width}: 폴더 묶기 = 왼쪽 폴더 나무 | 오른쪽 목록, 나무에서 폴더로 들어가도 나무가 남는다`,async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS});
  await radio(page,'폴더').click();
  await expect(nav(page)).toBeVisible();
  const n=await nav(page).boundingBox(),l=await page.locator('#documentList').boundingBox();
  expect(l.x).toBeGreaterThanOrEqual(n.x+n.width-1);
  expect(n.width).toBeLessThan(l.width);
  await expect(nav(page).locator('[data-lu-nav=""]')).toHaveAttribute('aria-current','true');
  await expect(nav(page).locator('[data-lu-nav="fa"] .ft-name')).toHaveText('가상 A');
  await expect(nav(page).locator('[data-lu-nav="fc"]')).toHaveCount(0); // 접힘(들어간 길만 펼침)
  await nav(page).locator('[data-lu-nav="fa"]').click();
  await expect(nav(page).locator('[data-lu-nav="fa"]')).toHaveAttribute('aria-current','true');
  await expect(nav(page).locator('[data-lu-nav="fc"]')).toBeVisible();
  await expect.poll(()=>tops(page)).toEqual(['f:fa']);
  await expect(page.locator('#libraryPath')).toBeVisible();
  await nav(page).locator('[data-lu-nav="fc"]').click();
  await expect.poll(()=>tops(page)).toEqual(['f:fc']);
  await expect(nav(page)).toBeVisible();
  await expect.poll(()=>new URL(page.url()).searchParams.get('folder')).toBe('fc');
  await page.screenshot({path:`test-results/library-fold-${width}.png`});
  // '자료실 전체' = 맨 위로.
  await nav(page).locator('[data-lu-nav=""]').click();
  await expect.poll(()=>tops(page)).toEqual(['x:out','f:fa','f:fn']);
  expect(s.writes).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  // 다른 묶기에서는 나무 칸이 없다.
  await radio(page,'사업영역').click();
  await expect(nav(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('자료실 폰 412: 폴더 묶기도 지금처럼 목록 안 나무 하나(왼쪽 나무 칸 없음)',async({page})=>{
  test.setTimeout(60000);
  const {errors}=await bootLibrary(page,412,{folders:FOLDERS,items:ITEMS});
  await radio(page,'폴더').click();
  await expect.poll(()=>tops(page)).toEqual(['x:out','f:fa','f:fn']);
  await expect(nav(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
