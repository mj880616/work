import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder} from './helpers/library-folder-server.mjs';
import {treeEnter} from './helpers/tree-enter.mjs';
// S51-20 FILES-폴드나무목록 ⑦(시안 docs/design/mockups/files-fold-tree-list.html '같은 종류'): 자료실 폴더 묶기도 펼친 폴드·PC(600px~)에서
// 왼쪽 폴더 나무 | 오른쪽 목록. UI-폴더누르기한규칙(S57-5): 나무 줄을 누르면 들어가지 않고 그 자리에서 펼침·접힘, 그 폴더로 들어가기(위치 줄·주소)는 우클릭 [이 폴더로 들어가기]. 나무는 그대로 남는다. 폰(412)은 지금처럼 나무 칸 없음. 이름은 지어낸 것.
// 들어가기: PC(761px~)는 우클릭 메뉴, 폴드(600~760px)는 두 손가락 벌리기.
const enter=async(page,id,width=1280)=>{if(width>=761){await nav(page).locator(`[data-lu-nav="${id}"]`).click({button:'right'});await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click()}else{await nav(page).locator(`[data-lu-nav="${id}"]`).locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," ft-row ")][1]').locator('.ft-dots').first().click();await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click()}};
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),libFolder('fc','child-a1',{name:'가상 C',parent_id:'fa',sort_order:0}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const ITEMS=[{document_id:'a-1',folder_id:'fc'},{document_id:'n-1',folder_id:'fa'}];
// LIB-위쪽한줄: 묶기는 고르기 상자 [폴더 ▾](#libraryGroupBy, select) 하나.
const pickGroup=(page,label)=>page.locator('#libraryGroupBy').selectOption({label});
const groupNow=page=>page.locator('#libraryGroupBy option:checked');
const nav=page=>page.locator('#libraryFolderNav');
const tops=page=>page.locator('#documentList > details').evaluateAll(xs=>xs.map(x=>x.dataset.luNode));

// S69-28 LIB-한칸탐색기(명진 11/24 '폴더를 누르면 오른쪽엔 파일 / 윈도우 탐색기처럼'): 나무 이름 누르기 = 그 폴더를 오른쪽에 연다(그 폴더까지 펼침·강조),
// 펼치기·접기는 줄 앞 폴더 그림. 오른쪽은 그 자리 바로 안 하위 폴더 줄(누르면 들어감) + 자료 줄. 우클릭 [이 폴더로 들어가기]·두 손가락도 같은 곳.
const rows=page=>page.locator('#documentList > [data-lu-document], #documentList > article').evaluateAll(xs=>xs.map(x=>x.dataset.luDocument).filter(Boolean));
for(const width of [700,884,1280])test.describe(`자료실 ${width} 나무`,()=>{test.use({hasTouch:width<761});test(`자료실 ${width}: 폴더 묶기 = 왼쪽 폴더 나무 | 오른쪽 그 폴더 내용, 이름 누르기 = 열기 · 그림 = 펼침 · 우클릭·두 손가락으로 들어가도 나무가 남는다`,async({page})=>{
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
  await expect.poll(()=>tops(page)).toEqual(['f:fa','f:fn']); // 맨 위 = 맨 위 폴더들 + 폴더 밖 자료
  expect((await rows(page)).sort()).toEqual(['a-2','a1-1']);
  await nav(page).locator('[data-lu-nav-tog="fa"]').click(); // 그림 = 그 자리 펼침(들어가지 않음)
  await expect(nav(page).locator('[data-lu-nav="fc"]')).toBeVisible();
  await expect(nav(page).locator('[data-lu-nav=""]')).toHaveAttribute('aria-current','true');
  await expect.poll(()=>tops(page)).toEqual(['f:fa','f:fn']); // 오른쪽 목록·주소 그대로
  expect(new URL(page.url()).searchParams.get('folder')).toBeNull();
  await nav(page).locator('[data-lu-nav="fa"]').click(); // 이미 펼친 폴더 이름 = 그 폴더 열기, 펼침 그대로(TREE-펼치기먼저 S70-81)
  await expect(nav(page).locator('[data-lu-nav="fa"]')).toHaveAttribute('aria-current','true');
  await expect(nav(page).locator('[data-lu-nav="fc"]')).toBeVisible();
  await nav(page).locator('[data-lu-nav="fa"]').click(); // 지금 폴더 이름을 또 눌러도 접지 않음(접기는 그림·←)
  await expect(nav(page).locator('[data-lu-nav="fc"]')).toBeVisible();
  await expect.poll(()=>tops(page)).toEqual(['f:fc']);expect(await rows(page)).toEqual(['n-1']);
  await expect(page.locator('#libraryPath')).toBeVisible();
  await treeEnter(nav(page).locator('[data-lu-nav="fc"]')); // 하위 없는 폴더 = 골라짐 → 다시 눌러 열기
  await expect.poll(()=>tops(page)).toEqual([]);expect(await rows(page)).toEqual(['a-1']);
  await nav(page).locator('[data-lu-nav=""]').click();
  await expect.poll(()=>tops(page)).toEqual(['f:fa','f:fn']);
  await enter(page,'fc',width); // 우클릭·두 손가락으로 들어가기도 그대로
  await expect.poll(()=>rows(page)).toEqual(['a-1']);
  await expect(nav(page)).toBeVisible();
  await expect.poll(()=>new URL(page.url()).searchParams.get('folder')).toBe('fc');
  await page.screenshot({path:`test-results/library-fold-${width}.png`});
  // '자료실 전체' = 맨 위로.
  await nav(page).locator('[data-lu-nav=""]').click();
  await expect.poll(()=>tops(page)).toEqual(['f:fa','f:fn']);
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
  if(process.env.LIB_TREE_FOLD_SHOTS)await page.screenshot({path:`${process.env.LIB_TREE_FOLD_SHOTS}/phone-412.png`}); // 폰 나무: 그림 누르기 = 펼치기·접기, 이름 누르기 = 그 폴더 내용(S69-28)
  expect(errors).toEqual([]);
});

// S69-28 LIB-한칸탐색기: 이름 누르기 = 그 폴더 열기(오른쪽 내용·위치 줄이 바뀜), 펼치기·접기는 폴더 그림·←/→. Enter = 이름 누르기(열기).
for(const width of [1280])test(`자료실 ${width}: 폴더 이름 누르기 = 열기, 그림·←/→ = 펼침·접기, Enter = 열기`,async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS});
  await pickGroup(page,'폴더');
  const a=nav(page).locator('[data-lu-nav="fa"]'),child=nav(page).locator('[data-lu-nav="fc"]'),tog=nav(page).locator('[data-lu-nav-tog="fa"]');
  const top=()=>expect.poll(()=>tops(page)).toEqual(['f:fa','f:fn']);
  await tog.click();
  await expect(child).toBeVisible();
  await expect(tog).toHaveAttribute('aria-expanded','true');
  await expect(a).not.toHaveAttribute('aria-current','true'); // 그림은 들어가지 않는다
  await top();
  await tog.click(); // 다시 = 접기
  await expect(child).toHaveCount(0);
  await expect(tog).toHaveAttribute('aria-expanded','false');
  await top();
  // 키보드: → 펼치기, ← 접기(초점은 이름에 남는다)
  await a.focus();await page.keyboard.press('ArrowRight');
  await expect(child).toBeVisible();await expect(a).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(child).toHaveCount(0);await expect(a).toBeFocused();
  await top();
  // TREE-펼치기먼저(S70-81): 닫힌 폴더 Enter·이름 누르기 첫 번째 = 펼치기만(오른쪽 그대로), 두 번째 = 그 폴더 열기(펼침·강조, 초점은 그 이름)
  await page.keyboard.press('Enter');
  await expect(child).toBeVisible();await expect(a).not.toHaveAttribute('aria-current','true');await top();
  await page.keyboard.press('Enter');
  await expect(a).toHaveAttribute('aria-current','true');await expect(child).toBeVisible();
  await expect.poll(()=>tops(page)).toEqual(['f:fc']);await expect(a).toBeFocused();
  if(process.env.LIB_TREE_FOLD_SHOTS)await page.screenshot({path:`${process.env.LIB_TREE_FOLD_SHOTS}/pc-${width}-1-open.png`});
  await treeEnter(child);
  await expect.poll(()=>tops(page)).toEqual([]);await expect(child).toHaveAttribute('aria-current','true');
  await nav(page).locator('[data-lu-nav=""]').click();
  await top();
  await enter(page,'fc');
  await expect(child).toHaveAttribute('aria-current','true');
  expect(s.writes).toEqual([]);
  expect(errors).toEqual([]);
});
