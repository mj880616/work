import {expect} from '@playwright/test';
// MTG-더하기늘고르기(11/14 명진 '거르기 상관 없이 늘 고르기 창'): 사업 보고 [+]는 거르기와 상관없이 늘 '어느 칸에 남길까요?' 창을 연다.
// 시험은 사람처럼 [+]를 누르고 그 창에서 종류를 골라 쓰기 창을 연다. kind: 종류 값('meeting'·'press' …).
export async function addReport(page,kind='meeting'){
  await page.locator('#newMeetingBtn').click();
  const sheet=page.locator('#reportKindSheet');await expect(sheet).toBeVisible();
  await sheet.locator(`[data-sheet-value="${kind}"]`).click();
  await expect(sheet).toBeHidden();await expect(page.locator('#meetingModal')).toBeVisible();
}
