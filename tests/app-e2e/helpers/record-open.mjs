// UI-기록줄높이통일(S70-66): 조직·사업 기록 줄을 누르면 그 자리에서 펼친다. 원래 업데이트·노트를 여는 길은 줄 끝 ⋯ 메뉴의
// [업데이트 열기]/[노트 열기] 하나 — 시험은 이 도우미로 연다. more = 그 줄의 ⋯ 버튼(aria-controls가 메뉴 id).
export async function openRecordOriginal(page, more) {
  await more.click();
  const menu = await more.getAttribute('aria-controls');
  await page.locator(`#${menu} :is([data-ps3-record-action="open-note"],[data-basket-link-action="open"])`).click();
}
