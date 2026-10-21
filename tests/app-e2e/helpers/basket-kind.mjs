// BASKET-노트입력창: on a PC (≥1024px) the basket screen draws no [업데이트 | 노트] switch; the sidebar's [바구니] → [업데이트]·[노트]
// changes sides there. Below that (phone, mid width) the switch stays. This presses whichever one is on screen.
export function basketKindButton(page, kind) {
  return page.locator(`#basketView [data-basket-kind="${kind}"]:visible, #appView > .app-nav [data-basket-kind-nav="${kind}"]:visible`).first();
}
export async function chooseBasketKind(page, kind) {
  await basketKindButton(page, kind).click();
}
