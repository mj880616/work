import {expect} from '@playwright/test';
// UI-PC자료실 C: 자료실 분류 칩(여러 개 켜고 끄는 토글)을 names만 켜진 상태로 맞춘다. [전체]는 건드리지 않는다.
// S51-28 LIB-화면정리: 폰·폴드(1199px까지)는 칩 줄 대신 위 한 줄 [분류 ▾] 창(체크 = 보일 분류, 아무것도 안 고르면 전체)에서 고르고 [적용].
// 칩 줄은 숨어 있어도 같은 상태(aria-pressed)를 그리므로 상태 확인은 지금처럼 칩으로 한다.
const chipsOf=page=>page.locator('#libraryCategoryFilter [data-lu-category]:not([data-lu-category="all"])');
export const narrowLibrary=page=>page.locator('#libraryCategoryPick').isVisible();
// [분류 ▾] 창에서 on(보일 큰 분류 이름들)만 체크하고 [적용]. on이 비면 [전체].
export async function pickLibraryCategories(page,on,{tap=false}={}){
  const press=async l=>{if(tap)await l.tap();else await l.click()};
  const sheet=page.locator('#libraryCategorySheet');
  await press(page.locator('#libraryCategoryPick'));await expect(sheet).toBeVisible();
  await press(sheet.locator('[data-lu-cat-clear]'));
  for(const name of on){const row=sheet.locator(`[data-sheet-value="${name}"]`);await row.scrollIntoViewIfNeeded();await press(row)}
  await press(sheet.locator('[data-sheet-save]'));await expect(sheet).toBeHidden();
}
// 지금 꺼진 큰 분류 이름들(칩 상태).
export async function offLibraryCategories(page){
  const out=[];for(const chip of await chipsOf(page).all())if(await chip.getAttribute('aria-pressed')==='false')out.push((await chip.textContent()).trim());
  return out;
}
export async function onlyLibraryCategories(page,names,{tap=false}={}){
  if(await narrowLibrary(page)){
    const all=(await chipsOf(page).allTextContents()).map(s=>s.trim());
    await pickLibraryCategories(page,names.length===all.length?[]:names,{tap});return;
  }
  for(const chip of await chipsOf(page).all()){
    const want=names.includes((await chip.textContent()).trim());
    if((await chip.getAttribute('aria-pressed')==='true')!==want){await chip.scrollIntoViewIfNeeded();if(tap)await chip.tap();else await chip.click()}
  }
}
// 칩 하나를 누른 것과 같은 결과(그 분류만 켬↔끔). 폰·폴드는 [분류 ▾] 창으로 같은 상태를 만든다(모두 끄기는 창에서 만들 수 없음).
export async function toggleLibraryCategory(page,name,{tap=false}={}){
  if(!(await narrowLibrary(page))){const chip=page.locator(`#libraryCategoryFilter [data-lu-category="${name}"]`);await chip.scrollIntoViewIfNeeded();if(tap)await chip.tap();else await chip.click();return;}
  const all=(await chipsOf(page).allTextContents()).map(s=>s.trim()),off=new Set(await offLibraryCategories(page));
  if(off.has(name))off.delete(name);else off.add(name);
  const on=all.filter(n=>!off.has(n));
  if(!on.length)throw new Error('폰·폴드 [분류 ▾] 창으로는 모든 분류를 끌 수 없다');
  await pickLibraryCategories(page,on.length===all.length?[]:on,{tap});
}

// 자료실 분류 칩을 모두 켠다(기본은 [회의]가 꺼져 있어 회의자료 분류 자료가 목록에 없다). 칩이 다 그려진 뒤에 부른다.
export async function showAllLibraryCategories(page){
  const chips=chipsOf(page);
  await expect(chips).not.toHaveCount(0);
  if(await narrowLibrary(page)){if(await page.locator('#libraryCategoryFilter [data-lu-category]:not([data-lu-category="all"])[aria-pressed="false"]').count())await pickLibraryCategories(page,[]);}
  else for(const chip of await chips.all())if(await chip.getAttribute('aria-pressed')!=='true'){await chip.scrollIntoViewIfNeeded();await chip.click()}
  await expect(page.locator('#libraryCategoryFilter [data-lu-category]:not([data-lu-category="all"])[aria-pressed="false"]')).toHaveCount(0);
}
