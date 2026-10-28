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
// UI-디자인손질 6: 메모 읽기 화면의 [수정]·[원문 그대로 보기]·[보관]·[삭제]는 그 메모의 [⋯](aria-label "이 업데이트 메뉴") 안에 있다.
// 메뉴가 닫혀 있으면 사람처럼 [⋯]를 눌러 연 뒤 항목을 누른다.
export async function noteAction(page,selector,{press=null}={}){
 const item=page.locator('#basketNoteMenu '+selector),more=page.locator('[data-basket-detail] [data-basket-note-more]');
 if(await more.getAttribute('aria-expanded')!=='true'){if(press)await press(more);else await more.click();}
 await expect(item).toBeVisible();
 if(press)await press(item);else await item.click();
}
// UI-바구니거르기: [전체] is gone; the list is [미분류 N]·[분류]·[보류]. Tests that only need a memo's row on screen
// pick the segment that holds it, as a person would (미분류 first, then 분류, then 보류).
export async function showBasketRow(page,id){
 const row=page.locator(`[data-basket-row="${id}"]`);
 for(const segment of ['unclassified','classified','archived']){
  const button=page.locator(`#basketView [data-basket-filter="${segment}"]`);
  await expect(button).toBeVisible();await button.click();await expect(button).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-basket-list-status] [data-wait]')).toHaveCount(0);
  if(await row.count())return row;
 }
 await expect(row).toBeVisible();
 return row;
}
