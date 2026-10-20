import {expect} from '@playwright/test';
// UI-노트메뉴정리: the open note's [수정]·[연결하기]·[바구니로 돌리기]·[삭제]·[고정] live in its ⋯ menu (#noteDocMenu, aria-label
// "이 노트 메뉴"), which opens under the ⋯ in the head line. Opens the menu like a person (tap on a phone, click on PC) and presses the item.
export async function noteMenuAction(page,attr,{width=1280}={}){
 const press=async l=>{await expect(l).toBeVisible();if(width<761){await l.scrollIntoViewIfNeeded();const b=await l.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await l.click();};
 const more=page.locator('[data-note-detail] [data-note-more]'),item=page.locator('#noteDocMenu ['+attr+']');
 if(await more.getAttribute('aria-expanded')!=='true')await press(more);
 await press(item);
}
