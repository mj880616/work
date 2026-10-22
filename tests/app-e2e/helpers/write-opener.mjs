// UI-쓰기메뉴삭제: the menu has no [쓰기] any more. The same write window (write-window.js) opens from
// the PC top line [+ 추가] → [업데이트], and below 1024px from the basket [노트] input's ⤢ (a draft window like the old menu one,
// with [노트] preselected) after the basket's [노트] side is shown.
export async function openWriteFromEntry(page,width){
  if(width>=1024){
    await page.locator('#appView>.app-topline [data-quick-add]').evaluate(b=>b.click());// no scroll-into-view: callers may test the scroll position
    await page.locator('#toplineAddMenu [data-topline-add="update"]').evaluate(b=>b.click());
    return;
  }
  if(await page.evaluate(()=>window.KPTURouter.current)!=='basket')await page.evaluate(()=>window.KPTURouter.go('basket'));
  const note=page.locator('#basketView [data-basket-kind="note"]:visible');
  // The [메모 | 노트] switch is hidden while a note's detail is open; then the note side is already showing.
  const switchShown=await note.first().waitFor({timeout:3000}).then(()=>true,()=>false);
  if(switchShown&&await note.first().getAttribute('aria-pressed')!=='true')await note.first().click();
  await page.locator('#basketView [data-note-list] [data-quick-big]:visible').first().click();
  // The old menu window started on [업데이트]; this one starts on [노트], so put it on [업데이트] too.
  await page.locator('#mdEditor [data-md-kind="update"]').click();
  await page.locator('#mdEditor .md-editor-text').focus();
}
