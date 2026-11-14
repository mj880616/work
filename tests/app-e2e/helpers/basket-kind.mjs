// BASKET-정리함이름: [노트] is its own menu item. On a PC (≥761px) it is a row of the sidebar; on a phone it is a row of the [메뉴] sheet
// (the bottom tab [메뉴] opens it). [정리함] is the sidebar row or the bottom tab. The screen draws no [업데이트 | 노트] switch any more.
// MULTI-하단바기본노트: 폰에서 [노트]·[잊지 말기]는 메뉴 순서에 따라 하단바 칸이거나 [메뉴] 창 줄이다(새 계정은 노트가 하단바, 잊지 말기가 [메뉴] 창).
const kindSel = kind => kind === 'note' ? '[data-basket-kind-nav="note"]' : '[data-view="basket"]';
export function basketKindButton(page, kind) {
  const sel = kindSel(kind);
  return page.locator(`#appView > .app-nav ${sel}:visible, .mobile-tabs ${sel}:visible, #mobileMenu:not([hidden]) ${sel}:visible`).first();
}
// 왼쪽 메뉴 줄이나 하단바 칸이 화면에 있으면 그대로, 없으면 [메뉴] 창을 먼저 연다.
export async function openKindMenu(page, kind) {
  const sel = kindSel(kind);
  if (await page.locator(`#appView > .app-nav ${sel}:visible, .mobile-tabs ${sel}:visible`).count()) return;
  if (await page.locator('#mobileMenu:not([hidden])').count()) return;
  await page.locator('#mobileMenuTab:visible').first().click();
  await page.locator(`#mobileMenu:not([hidden]) ${sel}`).waitFor();
}
// BASKET-정리함한화면 → S52-20: the 정리함 is one screen with one list (no '챙길 것'·'업데이트' boxes). Both old box titles now point at the
// list's one view button [처리 전 ▾] (PC and phone).
export const basketPaneButton = (page, pane) => page.locator('#basketView [data-forget-view-open]');
export async function chooseBasketKind(page, kind) {
  await openKindMenu(page, kind);
  await basketKindButton(page, kind).click();
}
