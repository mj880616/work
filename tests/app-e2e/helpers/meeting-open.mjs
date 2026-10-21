import {expect} from '@playwright/test';
// MEET-결과3단(2026-10-21): PC(≥1024) 회의 결과는 3단(왼쪽 회의 종류 / 가운데 차수 / 오른쪽 읽기용 결과)이고, 회의 결과 창(#meetingRoundDetailModal)은
// 오른쪽 머리 ⋯ → [수정]으로 연다. 폰·중간 폭은 지금처럼 목록 줄([data-mrd-meeting])을 누르면 창이 열린다.
// 사람이 하듯 연다: 폰 줄이 있으면 그 줄을 누르고, PC면 그 회의가 든 종류를 고른 뒤 가운데 차수 줄을 누르고 ⋯ → [수정].
export async function selectMeetingRound(page,id){
  const round=page.locator(`#meetingList [data-meeting-round="${id}"]`);
  await expect(page.locator('#meetingList [data-meeting-kind]').first()).toBeVisible();
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
  await expect(row.or(page.locator('#meetingList [data-meeting-kind]')).first()).toBeVisible();
  if(await row.count()){await row.click();return}
  await selectMeetingRound(page,id);
  await page.locator('#meetingList [data-meeting-more]').click();
  await page.locator('#mcolMenu [data-meeting-menu="edit"]').click();
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
}
// 첫 회의 결과 창을 연다: 폰은 맨 위 줄, PC는 처음 열면 오른쪽에 보이는 가장 최근 차수의 ⋯ → [수정].
export async function openFirstMeetingResult(page){
  const row=page.locator('#meetingList [data-mrd-meeting]').first(),more=page.locator('#meetingList [data-meeting-more]');
  await expect(row.or(more).first()).toBeVisible();
  if(await row.count()){await row.click();return}
  await more.click();
  await page.locator('#mcolMenu [data-meeting-menu="edit"]').click();
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
}
