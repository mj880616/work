// S52-20 HOME-잊지말기한목록: 정리함(잊지 말기) 목록 보기는 위 오른쪽 [처리 전 ▾] 하나(옛 [미분류][분류 완료][보류] 칩·[처리 전][보냄]… 칩 대신).
// 옛 업데이트 거르기 값으로 부르면 같은 보기를 고른다: unclassified = 처리 전, classified = 연결 완료, archived = 무시(보류한 업데이트).
import {expect} from '@playwright/test';
const LABEL = {unclassified: '처리 전', open: '처리 전', classified: '연결 완료', linked: '연결 완료', archived: '무시', dismissed: '무시', tasked: '보냄', done: '이미 함'};
const CURRENT = {unclassified: 'open', open: 'open', classified: 'linked', linked: 'linked', archived: 'dismissed', dismissed: 'dismissed', tasked: 'tasked', done: 'done'};
export const forgetViewButton = page => page.locator('#basketView [data-forget-view-open]');
export async function pickBasketView(page, view) {
  const button = forgetViewButton(page);
  await expect(button).toBeVisible();
  if (await button.getAttribute('data-forget-current') === CURRENT[view]) return;
  await button.click();
  await page.locator('#forgetViewMenu').getByRole('menuitemradio', {name: LABEL[view], exact: true}).click();
  await expect(button).toHaveAttribute('data-forget-current', CURRENT[view]);
}
export const expectBasketView = (page, view) => expect(forgetViewButton(page)).toHaveAttribute('data-forget-current', CURRENT[view]);
