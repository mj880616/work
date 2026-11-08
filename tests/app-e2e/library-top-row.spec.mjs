import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
// S51-28 LIB-화면정리 ①(요청 11/06 01:26·01:45, 명진 'ㅇ', 시안 docs/design/mockups/library-phone-dropdown.html·library-fold.html):
// 폰·폴드(1199px까지) 자료실 위쪽은 한 줄 [찾기][분류: … ▾][⋯]. 큰 제목·'묶기'·'분류' 이름표 없음, 왼쪽 맞춤.
// [분류 ▾] = 공용 고르기 창(폰 아래에서 올라옴, 넓으면 단추 아래)에서 체크 여러 개·소분류 들여쓰기·[모두 풀기][편집][적용], 기억은 서버 library_view.
// 묶기는 화면 아래 알약(접은 폰 가운데, 펼친 폴드 오른쪽 아래), 폰 [+]는 그 위. PC(1200px~)는 칩 줄 그대로. 폴더 옆 종류 점 없음. 이름은 지어낸 것.
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A'}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const ITEMS=[{document_id:'a-1',folder_id:'fa'}];
const DOCS=[libDoc('a-1','top-a',{category:'정책'}),libDoc('a-2','top-a',{category:'투쟁'}),libDoc('m-1',null,{category:'회의'}),libDoc('n-1',null,{category:'교육'})];
const pick=page=>page.locator('#libraryCategoryPick');
const sheet=page=>page.locator('#libraryCategorySheet');
const row=(page,value)=>sheet(page).locator(`[data-sheet-value="${value}"]`);
const shownDocs=page=>page.locator('#documentList [data-lu-document]').evaluateAll(xs=>xs.map(x=>x.dataset.luDocument).sort());
const tap=async(_page,locator)=>locator.click();
const box=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}});

for(const width of [412,700,884])test(`자료실 ${width}: 위 한 줄 [찾기][분류 ▾][⋯] · 묶기는 아래 알약 · [분류 ▾] 창에서 선택하고 [적용]`,async({page})=>{
  test.setTimeout(90000);
  const {s,errors}=await bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS});
  // 큰 제목·이름표 없음, 분류 칩 줄·[편집]은 숨음.
  await expect(page.locator('#libraryView .lu-filter-label:visible')).toHaveCount(0);
  if(width<=760)await expect(page.locator('#appView > .mobile-shell-header')).toBeHidden();
  await expect(page.locator('#libraryCategoryFilter')).toBeHidden();
  await expect(page.locator('#manageLibraryBtn')).toBeHidden();
  // 위 한 줄: 찾기 칸과 [분류 ▾]가 같은 줄, 찾기 칸은 왼쪽 맞춤(목록 칸과 같은 왼쪽 끝).
  await expect(pick(page)).toBeVisible();await expect(pick(page)).toHaveText('분류: 회의 빼고');
  const search=await box(page.locator('#documentSearch')),p=await box(pick(page)),card=await box(page.locator('#libraryListCard'));
  expect(Math.abs((search.y+search.h/2)-(p.y+p.h/2))).toBeLessThan(4);
  expect(Math.abs(search.x-card.x)).toBeLessThan(2);
  // 묶기 = 화면 아래 알약(접은 폰 가운데, 펼친 폴드 오른쪽).
  const g=await box(page.locator('#libraryGroupBy'));
  expect(g.bottom).toBeLessThanOrEqual(900);expect(g.y).toBeGreaterThan(700);
  if(width<600)expect(Math.abs((g.x+g.w/2)-width/2)).toBeLessThan(3);else expect(width-g.right).toBeLessThan(20);
  if(width<=760){const fab=await box(page.locator('#newDocumentBtn'));expect(fab.bottom).toBeLessThanOrEqual(g.y);}
  // 폴더 묶기로 바꿔도 알약 그대로, 폴더 옆 점 없음.
  await tap(page,page.locator('#libraryGroupBy').getByRole('radio',{name:'폴더'}),width);
  await expect(page.locator('#libraryGroupBy [aria-checked="true"]')).toHaveText('폴더');
  await expect(page.locator('#libraryView :is(.lu-kdot,.lu-pdot)')).toHaveCount(0);
  await tap(page,page.locator('#libraryGroupBy').getByRole('radio',{name:'사업영역'}),width);
  await page.locator('#documentList details[data-lu-node]').evaluateAll(xs=>xs.forEach(x=>x.open=true));
  expect(await shownDocs(page)).toEqual(['a-1','a-2','n-1']);
  // [분류 ▾] → 창: 지금 켜진 분류가 체크, 회의는 빈 칸. [모두 풀기] → 정책·투쟁 → [적용].
  await tap(page,pick(page),width);
  await expect(sheet(page)).toBeVisible();
  await expect(row(page,'회의')).toHaveAttribute('aria-pressed','false');await expect(row(page,'정책')).toHaveAttribute('aria-pressed','true');
  await tap(page,sheet(page).locator('[data-lu-cat-clear]'),width);
  await expect(row(page,'all')).toHaveAttribute('aria-pressed','true');await expect(row(page,'정책')).toHaveAttribute('aria-pressed','false');
  await tap(page,row(page,'정책'),width);await tap(page,row(page,'투쟁'),width);
  await expect(sheet(page).locator('[data-sheet-count]')).toHaveText('2개 고름');
  // 창이 아래 탭에 가리지 않는다(폰).
  if(width<=760){const sb=await box(sheet(page)),tabs=await box(page.locator('.mobile-tabs'));expect(sb.bottom).toBeLessThanOrEqual(tabs.y+1);}
  await tap(page,sheet(page).locator('[data-sheet-save]'),width);
  await expect(sheet(page)).toBeHidden();
  await expect(pick(page)).toHaveText('분류: 투쟁 외 1');
  await page.locator('#documentList details[data-lu-node]').evaluateAll(xs=>xs.forEach(x=>x.open=true));
  expect(await shownDocs(page)).toEqual(['a-1','a-2']);
  await expect.poll(()=>s.libraryView?.categories_off?.length).toBeGreaterThan(0);
  expect(s.libraryView.categories_off).not.toContain('정책');expect(s.libraryView.categories_off).not.toContain('투쟁');expect(s.libraryView.categories_off).toContain('회의');
  // [취소]는 바꾸지 않는다. [전체] 줄 = 모두.
  await tap(page,pick(page),width);await tap(page,row(page,'all'),width);await tap(page,sheet(page).locator('[data-sheet-cancel]'),width);
  await expect(pick(page)).toHaveText('분류: 투쟁 외 1');
  await tap(page,pick(page),width);await tap(page,row(page,'all'),width);await tap(page,sheet(page).locator('[data-sheet-save]'),width);
  await expect(pick(page)).toHaveText('분류: 전체');
  await expect.poll(()=>s.libraryView?.categories_off).toEqual([]);
  // [편집] = 분류 고치기 창.
  await tap(page,pick(page),width);await tap(page,sheet(page).locator('[data-lu-cat-edit]'),width);
  await expect(sheet(page)).toBeHidden();await expect(page.locator('#libraryManageModal')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:`test-results/library-top-row-${width}.png`});
  expect(errors).toEqual([]);
});

test('자료실 PC 1280: 묶기 칩 줄·분류 칩 줄 + [수정] 그대로, [분류 ▾]는 없음, 이름표 없음',async({page})=>{
  test.setTimeout(60000);
  const {errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS});
  await expect(pick(page)).toBeHidden();
  await expect(page.locator('#libraryCategoryFilter')).toBeVisible();await expect(page.locator('#manageLibraryBtn')).toBeVisible();
  await expect(page.locator('#libraryView .lu-filter-label:visible')).toHaveCount(0);
  expect(await page.locator('#libraryGroupBy').evaluate(el=>getComputedStyle(el).position)).not.toBe('fixed');
  const g=await box(page.locator('#libraryGroupBy')),c=await box(page.locator('#libraryCategoryFilter')),s=await box(page.locator('#documentSearch'));
  expect(Math.abs(g.x-s.x)).toBeLessThan(2);expect(Math.abs(c.x-s.x)).toBeLessThan(2);
  expect(errors).toEqual([]);
});

test('자료실 폰 412: [분류 ▾] 창 소분류는 들여 쓴 줄, 선택하면 그 소분류만',async({page})=>{
  test.setTimeout(60000);
  const docs=[libDoc('w-1',null,{category:'주간보고›확정본'}),libDoc('w-2',null,{category:'주간보고›개인본'}),libDoc('p-1',null,{category:'정책'})];
  const {errors}=await bootLibrary(page,412,{docs});
  await page.evaluate(async()=>{const m=await import('./document-categories.js');m.setDocumentCategories(['교섭','투쟁','교육','선전','정책','회의','주간보고','주간보고›확정본','주간보고›개인본','기타'])});
  await pick(page).click();
  const sub=row(page,'sub:주간보고›확정본');await expect(sub).toBeVisible();await expect(sub).toHaveAttribute('data-depth','1');
  await sub.click();
  await expect(row(page,'주간보고')).toHaveAttribute('aria-pressed','true');await expect(row(page,'정책')).toHaveAttribute('aria-pressed','false');
  await sheet(page).locator('[data-sheet-save]').click();
  await expect(pick(page)).toHaveText('분류: 주간보고 › 확정본');
  await page.locator('#documentList details[data-lu-node]').evaluateAll(xs=>xs.forEach(x=>x.open=true));
  expect(await shownDocs(page)).toEqual(['w-1']);
  expect(errors).toEqual([]);
});
