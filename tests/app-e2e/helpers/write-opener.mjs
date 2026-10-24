// UI-쓰기메뉴삭제: the menu has no [쓰기] any more. The update write window (write-window.js) opens from the top line
// [+ 추가] → [업데이트].
export async function openWriteFromEntry(page,width){
  // ED③ 노트: the note input's ⤢ now opens the note's own new window, so the draft update window (menu [쓰기]'s) is opened from the
  // top line's [+ 추가] → [업데이트] action at every width (the top line is drawn on a phone too, only hidden there).
  // Below 1024px the old way went through the basket screen first, and callers expect to start from there.
  if(width<1024&&await page.evaluate(()=>window.KPTURouter.current)!=='basket'){await page.evaluate(()=>window.KPTURouter.go('basket'));await page.locator('#basketView [data-basket-list]').waitFor();}
  // The old ⤢ press scrolled the page to the input (callers that scrolled first relied on that); the menu press does not, so go to the top.
  if(width<1024)await page.evaluate(()=>window.scrollTo(0,0));
  await page.locator('#appView>.app-topline [data-quick-add]').evaluate(b=>b.click());// no scroll-into-view: callers may test the scroll position
  await page.locator('#toplineAddMenu [data-topline-add="update"]').evaluate(b=>b.click());
  await page.locator('#mdEditor .md-editor-text').waitFor();
}
