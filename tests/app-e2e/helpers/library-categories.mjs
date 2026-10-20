import {expect} from '@playwright/test';
// UI-PC자료실 C: 자료실 분류 칩(여러 개 켜고 끄는 토글)을 names만 켜진 상태로 맞춘다. [전체]는 건드리지 않는다.
export async function onlyLibraryCategories(page,names,{tap=false}={}){
  const chips=page.locator('#libraryCategoryFilter [data-lu-category]:not([data-lu-category="all"])');
  for(const chip of await chips.all()){
    const want=names.includes((await chip.textContent()).trim());
    if((await chip.getAttribute('aria-pressed')==='true')!==want){await chip.scrollIntoViewIfNeeded();if(tap)await chip.tap();else await chip.click()}
  }
}

// 자료실 분류 칩을 모두 켠다(기본은 [회의]가 꺼져 있어 회의자료 분류 자료가 목록에 없다). 칩이 다 그려진 뒤에 부른다.
export async function showAllLibraryCategories(page){
  const chips=page.locator('#libraryCategoryFilter [data-lu-category]:not([data-lu-category="all"])');
  await expect(chips).not.toHaveCount(0);
  for(const chip of await chips.all())if(await chip.getAttribute('aria-pressed')!=='true'){await chip.scrollIntoViewIfNeeded();await chip.click()}
  await expect(page.locator('#libraryCategoryFilter [data-lu-category]:not([data-lu-category="all"])[aria-pressed="false"]')).toHaveCount(0);
}
