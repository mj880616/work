import {expect} from '@playwright/test';
import {showAllReportWeeks} from './report-week.mjs';
// BIZ-주간표이번주(2026-11-09): 사업 보고 목록은 늘 이번 주(오늘이 든 월~일)로 연다. 가짜 보고가 모두 지난 주에 있으면 이번 주 목록은 비므로,
// 사람이 하듯 [전체 기간]으로 바꿔 보고를 찾는다(이번 주에 보고가 보이면 그대로 둔다).
export async function showReportsOf(page){
  // MULTI-사업보고빈화면: 사업영역이 없는 계정은 빈 목록 '없음' 대신 위 '이번 주 주간보고' 칸의 안내 한 줄이 빈 자리를 맡는다.
  const list=page.locator('#meetingList'),any=list.locator('[data-mrd-meeting],[data-meeting-kind],[data-meeting-round]').first(),empty=list.locator('[data-wait-empty]').first().or(page.locator('#bizWeekBox .biz-week-none')).first();
  await expect(any.or(empty).first()).toBeVisible();
  if(await any.isVisible())return;
  await showAllReportWeeks(page);
}
// MEET-결과3단(2026-10-21): PC(≥761) 회의 결과는 3단(왼쪽 회의 종류 / 가운데 차수 / 오른쪽 읽기용 결과)이고, 회의 결과 창(#meetingRoundDetailModal)은
// 오른쪽 머리 ⋯ → [수정]으로 연다. 폰·중간 폭은 지금처럼 목록 줄([data-mrd-meeting])을 누르면 창이 열린다.
// 사람이 하듯 연다: 폰 줄이 있으면 그 줄을 누르고, PC면 그 회의가 든 종류를 고른 뒤 가운데 차수 줄을 누르고 ⋯ → [수정].
// FOLD-넓은화면 2차(S59-19): 세 칸(종류 | 차수 | 결과)은 PC 1200px~이고, 폴드 펼침(600~1199px)은 '날짜·이름 목록 | 결과' 두 칸이라 목록 줄을 바로 누른다.
export async function selectMeetingRound(page,id){
  const round=page.locator(`#meetingList [data-meeting-round="${id}"]`);
  await showReportsOf(page);
  await expect(page.locator('#meetingList :is([data-meeting-kind],[data-meeting-round])').first()).toBeVisible();
  if(!(await round.count())){
    for(const kind of await page.locator('#meetingList [data-meeting-kind]').all()){
      await kind.click();
      if(await round.count())break;
    }
  }
  await round.click();
  await expect(page.locator('#meetingList #mcolResult')).toHaveAttribute('data-meeting-result',String(id));
}
export async function openMeetingResult(page,id){
  const row=page.locator(`#meetingList [data-mrd-meeting="${id}"]`);
  await showReportsOf(page);
  await expect(row.or(page.locator('#meetingList :is([data-meeting-kind],[data-meeting-round])')).first()).toBeVisible();
  if(await row.count()){await row.click();return}
  // MTG-3단고치기: PC는 고른 차수의 결과가 오른쪽 칸 자리에 바로 붙는다(창 없음). 머리가 보일 때까지 기다린다.
  await selectMeetingRound(page,id);
  await expect(page.locator('#mcolResult #mrdMeta')).toBeVisible();
}
// 첫 회의 결과를 연다: 폰은 맨 위 줄, PC는 처음 열면 오른쪽 칸에 붙어 있는 가장 최근 차수.
export async function openFirstMeetingResult(page){
  const row=page.locator('#meetingList [data-mrd-meeting]').first(),slot=page.locator('#mcolResult #mrdMeta');
  await showReportsOf(page);
  await expect(row.or(slot).first()).toBeVisible();
  if(await row.count()){await row.click();return}
}
// 폰은 창을 닫고, PC는 오른쪽 칸에 붙어 있어 닫을 것이 없다(고치던 중이면 [취소]).
export async function closeMeetingResult(page){
  const close=page.locator('#mrdClose');
  if(await close.isVisible()){await close.click();return}
  const cancel=page.locator('#mrdCancelEdit');
  if(await cancel.isVisible())await cancel.click({timeout:2000}).catch(()=>{});// 저장이 막 끝나 고치는 화면이 닫히는 중일 수 있다
}
// MTG-보고창정리: 사업 보고 상세의 [수정]·[종류 바꾸기]·[삭제]는 제목 줄 오른쪽 ⋯ 메뉴 안에 있다. 사람이 하듯 ⋯를 누르고 항목을 누른다.
// STAB-E2E간헐1104: ⋯를 누른 직후 화면이 다시 그려지면(결과 읽기·저장 끝 정리) 열린 메뉴가 닫혀 항목이 30초 동안 안 보였다(Europe/Rome 시험 간헐 실패).
// 사람이 하듯 항목이 보일 때까지 보고, 안 열려 있으면 ⋯를 다시 누른다(열려 있으면 누르지 않아 닫지 않는다).
export async function mrdMenu(page,action){
  const item=page.locator(`#mrdMoreMenu [data-mrd-more="${action}"]`);
  await expect(async()=>{
    if(!(await item.isVisible()))await page.locator('#mrdMore').click({timeout:3000});
    await expect(item).toBeVisible({timeout:3000});
  }).toPass({timeout:25000});
  await item.click();
}
