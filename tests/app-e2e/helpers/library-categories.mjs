// UI-PC자료실 C: 자료실 분류 칩(여러 개 켜고 끄는 토글)을 names만 켜진 상태로 맞춘다. [전체]는 건드리지 않는다.
export async function onlyLibraryCategories(page,names,{tap=false}={}){
  const chips=page.locator('#libraryCategoryFilter [data-lu-category]:not([data-lu-category="all"])');
  for(const chip of await chips.all()){
    const want=names.includes((await chip.textContent()).trim());
    if((await chip.getAttribute('aria-pressed')==='true')!==want){await chip.scrollIntoViewIfNeeded();if(tap)await chip.tap();else await chip.click()}
  }
}
