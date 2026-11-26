import {expect} from '@playwright/test';
import {openReportBoxes,closeReportBoxes} from './report-boxes.mjs';
// MTG-프로젝트합치기 3단계: 사업 보고 [목록] 보기는 한 주(서울 월~일)씩 보인다. 여러 주에 걸친 가짜 보고를 한꺼번에 보는 시험은
// 사람이 하듯 둘째 줄(종류·사업영역 옆, BIZ-위쪽정돈 11/09)의 [이번 주 ▾] 상자에서 '전체 기간'을 고른다(이미 전체면 그대로, S52-22 TEAM-맨위한줄). 보고가 1건 이상이고 [목록] 보기일 때만 줄이 있다.
// BIZ-머리한줄(S71-23): ‹ ›는 '주간 보고' 상자 제목 줄(#bizWeekBox), 정한 기간 ×는 첫 줄 건수 칸(#reportCount), 기간 창 단추는 첫 줄 아래 칸(#reportWeekFilter).
export const reportWeekButton=(page,to)=>page.locator(`:is(#reportWeekFilter,#bizWeekBox,#reportCount) [data-report-week="${to}"]`);
export const reportPeriodSelect=page=>page.locator('#reportPeriodPick [data-report-period]');
export async function showAllReportWeeks(page){
  const pick=reportPeriodSelect(page);
  await openReportBoxes(page,pick); // S67-75: 폰 폭이면 칩을 눌러 상자 창을 연다(S68-47: 칩/네 개가 정해진 뒤 기간 상자가 보일 때까지)
  if(await pick.inputValue()!=='all')await pick.selectOption('all');else await closeReportBoxes(page);
  await expect(pick).toHaveValue('all');
}
