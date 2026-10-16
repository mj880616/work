import {expect} from '@playwright/test';
// UI-디자인기준 3/3 2부(8-9e-2): 바구니 머리줄 [⋯](aria-label "더보기")를 누르면 그 아래 작은 메뉴
// ([분류 요청]·[GPT 답변 가져오기])가 열린다. 닫혀 있으면 사람처럼 눌러 연다.
export async function openBasketMore(page){
 const more=page.locator('#basketView [data-basket-more]');
 if(await more.getAttribute('aria-expanded')!=='true')await more.click();
 await expect(page.locator('#basketMoreMenu')).toBeVisible();
}
// [분류 결과 입력] 창은 따로 여는 버튼이 없다(#577): [분류 요청]이 요청문을 복사한 뒤 곧바로 연다.
export async function openClassification(page){
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await openBasketMore(page);
 await page.locator('#basketMoreMenu [data-handoff-copy]').click();
 await expect(page.locator('[data-classification-panel]')).toBeVisible();
 await expect(page.locator('[data-classification-input]')).toBeFocused();
}
// [⋯] 메뉴의 [분류 요청]을 누른다(복사가 되면 한 줄 알림과 함께 [분류 결과 입력] 창이 열린다).
export async function requestClassification(page,{keyboard=false}={}){
 await openBasketMore(page);
 const item=page.locator('#basketMoreMenu [data-handoff-copy]');
 if(keyboard){await item.focus();await page.keyboard.press('Enter');}else await item.click();
}
export const handoffLine=page=>page.locator('[data-basket-handoff-scope]');
