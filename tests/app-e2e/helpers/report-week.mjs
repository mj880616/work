import {expect} from '@playwright/test';
// MTG-프로젝트합치기 3단계: 사업 보고 [목록] 보기는 한 주(서울 월~일)씩 보인다. 여러 주에 걸친 가짜 보고를 한꺼번에 보는 시험은
// 사람이 하듯 주 줄의 [전체]를 눌러 모든 주를 보이게 한다(이미 켜져 있으면 그대로). 보고가 1건 이상이고 [목록] 보기일 때만 줄이 있다.
export const reportWeekButton=(page,to)=>page.locator(`#reportWeekFilter [data-report-week="${to}"]`);
export async function showAllReportWeeks(page){
  const all=reportWeekButton(page,'all');
  await expect(all).toBeVisible();
  if(await all.getAttribute('aria-pressed')!=='true')await all.click();
  await expect(all).toHaveAttribute('aria-pressed','true');
}
