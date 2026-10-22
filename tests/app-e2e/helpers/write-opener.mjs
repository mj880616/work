// UI-쓰기메뉴삭제: the menu has no [쓰기] any more. The same write window (write-window.js) opens from
// the PC top line [+ 추가] → [업데이트], or below 1024px from a visible input's ⤢ (home, else the home screen is opened first).
export async function openWriteFromEntry(page,width){
  if(width>=1024){
    await page.locator('#appView>.app-topline [data-quick-add]').click();
    await page.locator('#toplineAddMenu [data-topline-add="update"]').click();
    return;
  }
  const big=page.locator('[data-quick-big]:visible').first();
  if(!await big.count())await page.evaluate(()=>window.KPTURouter.go('home'));
  await big.click();
}
