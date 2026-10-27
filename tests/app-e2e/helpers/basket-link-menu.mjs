import {expect} from '@playwright/test';
// BUG-바구니연결해제: an organization-detail 🧺 record keeps its actions ([메모 열기]·[연결 해제]·[요약 수정]·[원문 삭제])
// in the ⋯ at the end of its line. Open it like a person, then press the item.
export async function linkAction(row,name,{tap=false}={}){
 const page=row.page(),more=row.getByRole('button',{name:'정리함 기록 메뉴'}),item=page.locator('#basketLinkMenu').getByRole('button',{name,exact:true});
 if(tap)await more.tap();else await more.click();
 await expect(item).toBeVisible();
 if(tap)await item.tap();else await item.click();
}
