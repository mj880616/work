// ED③ 업데이트: the top line's [+ 추가] → [업데이트] opens the update's big window (#edWindow, app/update-window.js).
// - openWriteFromEntry: the real click path (nothing else is faked) and waits for the new editor.
export async function openWriteFromEntry(page,width){
  // Below 1024px the old way went through the basket screen first, and callers expect to start from there.
  if(width<1024&&await page.evaluate(()=>window.KPTURouter.current)!=='basket'){await page.evaluate(()=>window.KPTURouter.go('basket'));await page.locator('#basketView [data-basket-list]').waitFor();}
  // The old ⤢ press scrolled the page to the input (callers that scrolled first relied on that); the menu press does not, so go to the top.
  if(width<1024)await page.evaluate(()=>window.scrollTo(0,0));
  await page.locator('#appView>.app-topline [data-quick-add]').evaluate(b=>b.click());// no scroll-into-view: callers may test the scroll position
  await page.locator('#toplineAddMenu [data-topline-add="update"]').evaluate(b=>b.click());
  await page.locator('#edWindow .ed-window-body .ProseMirror').waitFor();
}
