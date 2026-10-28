import {expect} from '@playwright/test';
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
