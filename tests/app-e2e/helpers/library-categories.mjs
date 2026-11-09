import {expect} from '@playwright/test';
// 자료실 분류 고르기 도우미.
// LIB-위쪽한줄(11/09 명진 B·가안): 자료실 분류는 폰·폴드·PC 모두 위 줄 [분류: … ▾] 하나다(분류 칩 줄·'✎ 분류 수정' 줄 끝 버튼은 없앴다).
// 창(공용 고르기 창 #libraryCategorySheet)에서 체크 = 보일 큰 분류(아무것도 안 고르면 전체), [적용]으로 건다. 상태 읽기도 같은 창에서 한다(열고 읽고 [취소]).
const sheetOf=page=>page.locator('#libraryCategorySheet');
const pickOf=page=>page.locator('#libraryCategoryPick');
const press=async(l,tap)=>{if(tap)await l.tap();else await l.click()};
// 단추 글자는 자료실이 분류 목록·기억을 읽고 처음 그린 뒤에 data-label이 생긴다(그 전 글자는 HTML 그대로). 그때까지 기다린다.
export const libraryCategoriesReady=page=>expect(pickOf(page)).toHaveAttribute('data-label',/^분류: /);
// 지금 상태를 창에서 읽는다. names = 큰 분류 이름(창 순서), on = 체크된 큰 분류(전체면 빈 목록).
export async function readLibraryCategories(page){
  const sheet=sheetOf(page);
  await libraryCategoriesReady(page);await pickOf(page).click();await expect(sheet).toBeVisible();
  const rows=await sheet.locator('[data-sheet-value][data-depth="0"]').evaluateAll(xs=>xs.map(x=>({value:x.dataset.sheetValue,name:x.querySelector('.home-choice-name')?.textContent.trim()||'',on:x.getAttribute('aria-pressed')==='true',count:x.querySelector('[data-lu-cat-count]')?.textContent??null})));
  await sheet.locator('[data-sheet-cancel]').click();await expect(sheet).toBeHidden();
  const all=rows.find(r=>r.value==='all'),top=rows.filter(r=>r.value!=='all');
  return {names:top.map(r=>r.name),on:top.filter(r=>r.on).map(r=>r.name),all:!!all?.on,rows};
}
// 창 줄 글자([전체] 포함, 자료 수 숫자 빼고) — 옛 칩 줄 글자 목록과 같은 모양.
export async function libraryCategoryNames(page){const s=await readLibraryCategories(page);return ['전체',...s.names]}
// [분류 ▾] 창에서 on(보일 큰 분류 이름들)만 체크하고 [적용]. on이 비면 [전체].
export async function pickLibraryCategories(page,on,{tap=false}={}){
  const sheet=sheetOf(page);
  await libraryCategoriesReady(page);await press(pickOf(page),tap);await expect(sheet).toBeVisible();
  await press(sheet.locator('[data-lu-cat-clear]'),tap);
  for(const name of on){const row=sheet.locator(`[data-sheet-value="${name}"]`);await row.scrollIntoViewIfNeeded();await press(row,tap)}
  await press(sheet.locator('[data-sheet-save]'),tap);await expect(sheet).toBeHidden();
}
// 지금 꺼진 큰 분류 이름들(전체면 빈 목록).
export async function offLibraryCategories(page){
  const s=await readLibraryCategories(page);
  return s.all||!s.on.length?[]:s.names.filter(n=>!s.on.includes(n));
}
export async function onlyLibraryCategories(page,names,{tap=false}={}){
  const {names:all}=await readLibraryCategories(page);
  await pickLibraryCategories(page,names.length===all.length?[]:names,{tap});
}
// 분류 하나를 켬↔끔(옛 칩 하나를 누른 것과 같은 결과). 창으로는 모두 끄기를 만들 수 없다.
export async function toggleLibraryCategory(page,name,{tap=false}={}){
  const {names:all}=await readLibraryCategories(page),off=new Set(await offLibraryCategories(page));
  expect(all).toContain(name);
  if(off.has(name))off.delete(name);else off.add(name);
  const on=all.filter(n=>!off.has(n));
  if(!on.length)throw new Error('[분류 ▾] 창으로는 모든 분류를 끌 수 없다');
  await pickLibraryCategories(page,on.length===all.length?[]:on,{tap});
}
// 자료실 분류를 모두 켠다(기본은 [회의]가 꺼져 있어 회의자료 분류 자료가 목록에 없다).
export async function showAllLibraryCategories(page){
  await libraryCategoriesReady(page);
  if((await pickOf(page).textContent()).trim()!=='분류: 전체')await pickLibraryCategories(page,[]);
  await expect(pickOf(page)).toHaveText('분류: 전체');
}
// 분류 수정 창 열기: 폰·폴드·PC 모두 [분류 ▾] 창 아래 '✎ 분류 수정'.
export async function openLibraryCategoryEditor(page,{tap=false}={}){
  await libraryCategoriesReady(page);await press(pickOf(page),tap);await press(sheetOf(page).locator('[data-lu-cat-edit]'),tap);
  await expect(page.locator('#libraryManageModal')).toBeVisible();
}
// 묶기 고르기 상자 [폴더 ▾]에서 이름(폴더·사업영역·담당조직·분류·월별)으로 고른다.
export async function pickLibraryGroup(page,label){await page.locator('#libraryGroupBy').selectOption({label})}
// 지금 고른 묶기 이름.
export const libraryGroupNow=page=>page.locator('#libraryGroupBy option:checked');
