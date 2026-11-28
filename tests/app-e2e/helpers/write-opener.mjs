// ED③ 업데이트: the update's big window (#edWindow, app/update-window.js). QUICK-입력정리(2026-11-28): [+ 추가] no longer lists it, and
// SHARE-노트로(2026-11-28) removed the phone widget [업데이트] cell; the window still opens through window.KPTUQuickWrite.open('update').
// - openWriteFromEntry: that same entrance (nothing else is faked) and waits for the new editor.
export async function openWriteFromEntry(page,width){
  // Below 761px the old way went through the basket screen first, and callers expect to start from there.
  if(width<761&&await page.evaluate(()=>window.KPTURouter.current)!=='basket'){await page.evaluate(()=>window.KPTURouter.go('basket'));await page.locator('#basketView [data-basket-list]').waitFor();}
  // The old ⤢ press scrolled the page to the input (callers that scrolled first relied on that); the menu press does not, so go to the top.
  if(width<761)await page.evaluate(()=>window.scrollTo(0,0));
  await page.evaluate(()=>window.KPTUQuickWrite.open('update'));// no scroll-into-view: callers may test the scroll position
  await page.locator('#edWindow .ed-window-body .ProseMirror').waitFor();
}
