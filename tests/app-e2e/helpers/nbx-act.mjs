// UI-잊지말기줄단추(요청함 11/10 11:23): 잊지 말기 줄 버튼 누르기. 줄에 보이면(PC·opacity만 0인 것 포함) 그 버튼,
// 폰처럼 접혀 있으면(.nbx-fold) 그 줄 ⋯ 메뉴의 같은 이름 항목 — 업데이트 줄은 basket.js 줄 메뉴(×·[이미 함] 자리는 [보류로]).
const BASKET = {task: 'task', event: 'event', note: 'to-note', org: 'org', area: 'area', done: 'hold', dismissed: 'hold'};
export async function pressRowAct(page, row, act) {
  const button = row.locator(`[data-nbx-act="${act}"]`);
  if (await button.isVisible()) { await button.click(); return; }
  await row.locator('.nbx-more').click();
  const update = String(await row.getAttribute('data-nbx-row')).startsWith('u:');
  await page.locator(update ? `#basketRowMenu [data-basket-row-act="${BASKET[act]}"]` : `#forgetRowMenu [data-nbx-menu-act="${act}"]`).click();
}
