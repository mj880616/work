// BASKET-정리함이름: [노트] is its own menu item. On a PC (≥761px) it is a row of the sidebar; on a phone it is a row of the [메뉴] sheet
// (the bottom tab [메뉴] opens it). [정리함] is the sidebar row or the bottom tab. The screen draws no [업데이트 | 노트] switch any more.
export function basketKindButton(page, kind) {
  return kind === 'note'
    ? page.locator('#appView > .app-nav [data-basket-kind-nav="note"]:visible, #mobileMenu:not([hidden]) [data-basket-kind-nav="note"]:visible').first()
    : page.locator('#appView > .app-nav [data-view="basket"]:visible, .mobile-tabs [data-view="basket"]:visible').first();
}
// On a phone the [노트] row is inside the [메뉴] sheet: open the sheet first (a no-op when the sidebar row is on screen).
export async function openKindMenu(page, kind) {
  if (kind !== 'note') return;
  if (await page.locator('#appView > .app-nav [data-basket-kind-nav="note"]:visible').count()) return;
  if (await page.locator('#mobileMenu:not([hidden])').count()) return;
  await page.locator('#mobileMenuTab:visible').first().click();
  await page.locator('#mobileMenu:not([hidden]) [data-basket-kind-nav="note"]').waitFor();
}
// BASKET-정리함한화면 → S52-20: the 정리함 is one screen with one list (no '챙길 것'·'업데이트' boxes). Both old box titles now point at the
// list's one view button [처리 전 ▾] (PC and phone).
export const basketPaneButton = (page, pane) => page.locator('#basketView [data-forget-view-open]');
export async function chooseBasketKind(page, kind) {
  await openKindMenu(page, kind);
  await basketKindButton(page, kind).click();
}
