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
  // MTG-3단고치기: PC는 고른 차수의 결과가 오른쪽 칸 자리에 바로 붙는다(창 없음). 머리가 보일 때까지 기다린다.
  await selectMeetingRound(page,id);
  await expect(page.locator('#mcolResult #mrdMeta')).toBeVisible();
}
// 첫 회의 결과를 연다: 폰은 맨 위 줄, PC는 처음 열면 오른쪽 칸에 붙어 있는 가장 최근 차수.
export async function openFirstMeetingResult(page){
  const row=page.locator('#meetingList [data-mrd-meeting]').first(),slot=page.locator('#mcolResult #mrdMeta');
  await expect(row.or(slot).first()).toBeVisible();
  if(await row.count()){await row.click();return}
}
// 폰은 창을 닫고, PC는 오른쪽 칸에 붙어 있어 닫을 것이 없다(고치던 중이면 [취소]).
export async function closeMeetingResult(page){
  const close=page.locator('#mrdClose');
  if(await close.isVisible()){await close.click();return}
  const cancel=page.locator('#mrdCancelEdit');
  if(await cancel.isVisible())await cancel.click();
}
// MTG-보고창정리: 사업 보고 상세의 [수정]·[칸 바꾸기]·[삭제]는 제목 줄 오른쪽 ⋯ 메뉴 안에 있다. 사람이 하듯 ⋯를 누르고 항목을 누른다.
export async function mrdMenu(page,action){
  await page.locator('#mrdMore').click();
  await page.locator(`#mrdMoreMenu [data-mrd-more="${action}"]`).click();
}
