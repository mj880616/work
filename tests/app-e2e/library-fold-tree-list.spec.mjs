import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder} from './helpers/library-folder-server.mjs';
import {pinch} from './helpers/pinch.mjs';
// S51-20 FILES-폴드나무목록 ⑦(시안 docs/design/mockups/files-fold-tree-list.html '같은 종류'): 자료실 폴더 묶기도 펼친 폴드·PC(600px~)에서
// 왼쪽 폴더 나무 | 오른쪽 목록. UI-폴더누르기한규칙(S57-5): 나무 줄을 누르면 들어가지 않고 그 자리에서 펼침·접힘, 그 폴더로 들어가기(위치 줄·주소)는 우클릭 [이 폴더로 들어가기]. 나무는 그대로 남는다. 폰(412)은 지금처럼 나무 칸 없음. 이름은 지어낸 것.
// 들어가기: PC(761px~)는 우클릭 메뉴, 폴드(600~760px)는 두 손가락 벌리기.
const enter=async(page,id,width=1280)=>{if(width>=761){await nav(page).locator(`[data-lu-nav="${id}"]`).click({button:'right'});await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click()}else await pinch(page,nav(page).locator(`[data-lu-nav="${id}"]`),'out')};
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),libFolder('fc','child-a1',{name:'가상 C',parent_id:'fa',sort_order:0}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const ITEMS=[{document_id:'a-1',folder_id:'fc'},{document_id:'n-1',folder_id:'fa'}];
// LIB-위쪽한줄: 묶기는 고르기 상자 [폴더 ▾](#libraryGroupBy, select) 하나.
const pickGroup=(page,label)=>page.locator('#libraryGroupBy').selectOption({label});
const groupNow=page=>page.locator('#libraryGroupBy option:checked');
const nav=page=>page.locator('#libraryFolderNav');
const tops=page=>page.locator('#documentList > details').evaluateAll(xs=>xs.map(x=>x.dataset.luNode));

for(const width of [700,884,1280])test.describe(`자료실 ${width} 나무`,()=>{test.use({hasTouch:width<761});test(`자료실 ${width}: 폴더 묶기 = 왼쪽 폴더 나무 | 오른쪽 목록, 나무 누르기는 펼침만 · 우클릭·두 손가락으로 들어가도 나무가 남는다`,async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS});
  await pickGroup(page,'폴더');
  await expect(nav(page)).toBeVisible();
  const n=await nav(page).boundingBox(),l=await page.locator('#documentList').boundingBox();
  expect(l.x).toBeGreaterThanOrEqual(n.x+n.width-1);
  expect(n.width).toBeLessThan(l.width);
  await expect(nav(page).locator('[data-lu-nav=""]')).toHaveAttribute('aria-current','true');
  await expect(nav(page).locator('[data-lu-nav="fa"] .ft-name')).toHaveText('가상 A');
  await expect(nav(page).locator('[data-lu-nav="fc"]')).toHaveCount(0); // 접힘(들어간 길만 펼침)
  await nav(page).locator('[data-lu-nav="fa"]').click(); // 누르기 = 그 자리 펼침(들어가지 않음)
  await expect(nav(page).locator('[data-lu-nav="fc"]')).toBeVisible();
  await expect(nav(page).locator('[data-lu-nav=""]')).toHaveAttribute('aria-current','true');
  await expect.poll(()=>tops(page)).toEqual(['x:out','f:fa','f:fn']); // 오른쪽 목록·주소 그대로
  expect(new URL(page.url()).searchParams.get('folder')).toBeNull();
  await enter(page,'fa',width); // 우클릭 [이 폴더로 들어가기] · 폴드는 두 손가락 벌리기
  await expect(nav(page).locator('[data-lu-nav="fa"]')).toHaveAttribute('aria-current','true');
  await expect(nav(page).locator('[data-lu-nav="fc"]')).toBeVisible();
  await expect.poll(()=>tops(page)).toEqual(['f:fa']);
  await expect(page.locator('#libraryPath')).toBeVisible();
  await nav(page).locator('[data-lu-nav="fc"]').click(); // 하위 폴더 누르기도 들어가지 않는다(펼칠 것이 없어 그대로)
  await expect.poll(()=>tops(page)).toEqual(['f:fa']);
  await enter(page,'fc',width);
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
  await pickGroup(page,'사업영역');
  await expect(nav(page)).toHaveCount(0);
  expect(errors).toEqual([]);
})});

test('자료실 폰 412: 폴더 묶기도 지금처럼 목록 안 나무 하나(왼쪽 나무 칸 없음)',async({page})=>{
  test.setTimeout(60000);
  const {errors}=await bootLibrary(page,412,{folders:FOLDERS,items:ITEMS});
  await pickGroup(page,'폴더');
  await expect.poll(()=>tops(page)).toEqual(['x:out','f:fa','f:fn']);
  await expect(nav(page)).toHaveCount(0);
  if(process.env.LIB_TREE_FOLD_SHOTS)await page.screenshot({path:`${process.env.LIB_TREE_FOLD_SHOTS}/phone-412.png`}); // 폰 나무는 그대로(줄 누르기 = 그 자리 펼치기·접기)
  expect(errors).toEqual([]);
});

// UI-폴더누르기한규칙(S57-5): 이름 한 번 = 펼침, 다시 = 접기(오른쪽·위치 줄 그대로), 아이콘·키보드(←/→·Enter)도 같은 규칙. 들어가기는 우클릭·두 손가락.
for(const width of [1280])test(`자료실 ${width}: 폴더 이름 누르기 = 펼침·접기(들어가지 않음), ←/→·Enter·아이콘도 같은 규칙`,async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS});
  await pickGroup(page,'폴더');
  const a=nav(page).locator('[data-lu-nav="fa"]'),child=nav(page).locator('[data-lu-nav="fc"]'),tog=nav(page).locator('[data-lu-nav-tog="fa"]');
  const rightSame=()=>expect.poll(()=>tops(page)).toEqual(['x:out','f:fa','f:fn']);
  await a.click();
  await expect(child).toBeVisible();
  await expect(tog).toHaveAttribute('aria-expanded','true');
  await expect(a).not.toHaveAttribute('aria-current','true'); // 들어가지 않았다
  await rightSame();
  if(process.env.LIB_TREE_FOLD_SHOTS)await page.screenshot({path:`${process.env.LIB_TREE_FOLD_SHOTS}/pc-${width}-1-open.png`});
  await a.click(); // 다시 = 접기
  await expect(child).toHaveCount(0);
  await expect(tog).toHaveAttribute('aria-expanded','false');
  await rightSame();
  await expect(a).toBeFocused();
  if(process.env.LIB_TREE_FOLD_SHOTS)await page.screenshot({path:`${process.env.LIB_TREE_FOLD_SHOTS}/pc-${width}-2-folded.png`});
  await a.click(); // 또 = 펼침
  await expect(child).toBeVisible();
  // 키보드: ← 접기, → 펼치기, Enter = 누르기와 같음(초점은 이름에 남는다)
  await a.focus();await page.keyboard.press('ArrowLeft');
  await expect(child).toHaveCount(0);await expect(a).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(child).toBeVisible();await expect(a).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(child).toHaveCount(0);await expect(a).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(child).toBeVisible();
  // 아이콘도 같은 접기·펼치기
  await tog.click();await expect(child).toHaveCount(0);
  await tog.click();await expect(child).toBeVisible();
  await rightSame();
  // 펼칠 것이 없는 폴더 누르기 = 아무 일 없음(들어가지 않는다). 들어가기는 우클릭 메뉴
  await child.click();
  await rightSame();
  await enter(page,'fc');
  await expect.poll(()=>tops(page)).toEqual(['f:fc']);
  await expect(child).toBeVisible();
  expect(s.writes).toEqual([]);
  expect(errors).toEqual([]);
});
