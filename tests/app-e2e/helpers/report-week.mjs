import {expect} from '@playwright/test';
// MTG-프로젝트합치기 3단계: 사업 보고 [목록] 보기는 한 주(서울 월~일)씩 보인다. 여러 주에 걸친 가짜 보고를 한꺼번에 보는 시험은
// 사람이 하듯 둘째 줄(종류·사업영역 옆, BIZ-위쪽정돈 11/09)의 [이번 주 ▾] 상자에서 '전체 기간'을 고른다(이미 전체면 그대로, S52-22 TEAM-맨위한줄). 보고가 1건 이상이고 [목록] 보기일 때만 줄이 있다.
export const reportWeekButton=(page,to)=>page.locator(`#reportWeekFilter [data-report-week="${to}"]`);
export const reportPeriodSelect=page=>page.locator('#reportPeriodPick [data-report-period]');
export async function showAllReportWeeks(page){
  const pick=reportPeriodSelect(page);
  await expect(pick).toBeVisible();
  if(await pick.inputValue()!=='all')await pick.selectOption('all');
  await expect(pick).toHaveValue('all');
}
