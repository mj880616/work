import {expect} from '@playwright/test';
import {pickBasketView,openBasketUpdate} from './forget-view.mjs';
// UI-디자인손질 6: 메모 읽기 화면의 [수정]·[원문 그대로 보기]·[보관]·[삭제]는 그 메모의 [⋯](aria-label "이 업데이트 메뉴") 안에 있다.
// 메뉴가 닫혀 있으면 사람처럼 [⋯]를 눌러 연 뒤 항목을 누른다.
export async function noteAction(page,selector,{press=null}={}){
 const item=page.locator('#basketNoteMenu '+selector),more=page.locator('[data-basket-detail] [data-basket-note-more]');
 if(await more.getAttribute('aria-expanded')!=='true'){if(press)await press(more);else await more.click();}
 await expect(item).toBeVisible();
 if(press)await press(item);else await item.click();
}
// S71-58 FORGET-처리전만: the list holds only 처리 전 (미분류) updates — no view menu. A handled update is opened with openBasketUpdate.
export async function showBasketRow(page,id){
 const row=page.locator(`[data-basket-row="${id}"]`);
 await pickBasketView(page,'unclassified');
 await expect(page.locator('[data-basket-list-status] [data-wait]')).toHaveCount(0);
 await expect(row).toBeVisible();
 return row;
}
// Open one update's detail: from its 처리 전 row when it is there, else (a handled update — linked, filed, held) by its address,
// as another screen does (S71-58). press(locator) taps on phones when given.
export async function openBasketNote(page,id,press=null){
 await pickBasketView(page,'unclassified');
 await expect(page.locator('[data-basket-list-status] [data-wait]')).toHaveCount(0);
 const row=page.locator(`[data-basket-row="${id}"]`);
 if(await row.count()){if(press)await press(row);else await row.click();}
 else await openBasketUpdate(page,id);
 await expect(page.locator('[data-basket-detail]')).toBeVisible();
}
