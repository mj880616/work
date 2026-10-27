// MTG-고치기바로(명진 2026-10-27): PC 세 번째 칸에서 ⋯ → [수정]이 그 칸을 그 자리에서 고치는 화면으로 바꾼다(팝업 없음).
// 폰은 같은 창이 고치는 화면으로 바뀐다. 고친 내용이 있는데 다른 곳을 누르면 그 자리에 한 줄('고친 내용을 저장할까요? [저장] [버리기]'). 합성 자료만 쓴다.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {selectMeetingRound,openMeetingResult,mrdMenu} from './helpers/meeting-open.mjs';

test.use({timezoneId:'Asia/Seoul'});

function state(){
  const s=baseState();s.meetingWrites=[];
  const row=(id,round,at)=>({id,workspace_id:s.workspace.id,title:'궤도협의회',series_name:'궤도협의회',round_no:round,meeting_at:at,transcript_text:`가상 원문 ${id}`,created_by:s.user.id});
  s.meetings=[row('rail-1',1,'2026-09-01T01:00:00Z'),row('rail-2',2,'2026-09-08T01:00:00Z'),row('rail-3',3,'2026-09-15T01:00:00Z')];
  return s;
}
async function open(page,s,width,height=900){
  await page.setViewportSize({width,height});await mockApp(page,s);
  await signIn(page,testOrigin+'/app/?view=meetings');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
}
const result=page=>page.locator('#meetingList #mcolResult');
const round=(page,id)=>page.locator(`#meetingList [data-meeting-round="${id}"]`);
const outsidePopup=page=>page.locator('body>#meetingRoundDetailModal');

test('PC 1280: ⋯ → [수정]은 세 번째 칸이 그 자리에서 고치는 화면이 되고, 맨 위 오른쪽 [취소][저장], 저장하면 보는 화면',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,1280);
  await expect(result(page).locator('#mrdMeta')).toBeVisible();await expect(outsidePopup(page)).toHaveCount(0);
  await mrdMenu(page,'edit');
  await expect(result(page).locator('#mrdEditor')).toBeVisible();await expect(result(page).locator('#mrdView')).toBeHidden();
  await expect(outsidePopup(page)).toHaveCount(0);
  // 칸 배치: 제목 / 차수 | 짧은 이름 / 일시 / 연결할 곳.
  const box=async sel=>result(page).locator(sel).first().boundingBox();
  const t=await box('#mrdEditTitle'),r=await box('#mrdEditRound'),n=await box('#mrdEditShortName'),p=await box('#mrdEditPlaces');
  expect(r.y).toBeGreaterThan(t.y);expect(Math.abs(r.y-n.y)).toBeLessThanOrEqual(2);expect(n.x).toBeGreaterThan(r.x);
  expect(p.y).toBeGreaterThan(r.y);
  // 맨 위 오른쪽 작은 [취소][저장]: 칸 안쪽 오른쪽 끝, 머리 줄 안.
  const col=await result(page).boundingBox(),save=await result(page).locator('#mrdSaveEdit').boundingBox(),cancel=await result(page).locator('#mrdCancelEdit').boundingBox();
  await expect(result(page).locator('.modal-head #mrdSaveEdit')).toHaveText('저장');await expect(result(page).locator('.modal-head #mrdCancelEdit')).toHaveText('취소');
  expect(cancel.x).toBeLessThan(save.x);expect(save.x+save.width).toBeGreaterThan(col.x+col.width-48);expect(save.y-col.y).toBeLessThan(80);expect(save.height).toBeLessThanOrEqual(36);
  await result(page).locator('#mrdEditShortName').fill('고친 이름');await result(page).locator('#mrdSaveEdit').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.title).toBe('고친 이름');
  await expect(result(page).locator('#mrdEditor')).toBeHidden();await expect(result(page).locator('#mrdView')).toBeVisible();await expect(outsidePopup(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('PC 1280: 고친 내용이 있는데 다른 차수를 누르면 그 자리 한 줄 — [버리기]/[저장]',async({page})=>{
  const s=state();await open(page,s,1280);
  await expect(result(page)).toHaveAttribute('data-meeting-result','rail-3');
  await mrdMenu(page,'edit');await result(page).locator('#mrdEditNotes').fill('고친 특이사항');
  await round(page,'rail-2').click();
  const line=result(page).locator('#mrdLeave');await expect(line).toBeVisible();await expect(line).toContainText('고친 내용을 저장할까요?');
  await expect(line.locator('button')).toHaveText(['저장','버리기']);
  // 고르기는 아직 안 넘어간다.
  await expect(result(page)).toHaveAttribute('data-meeting-result','rail-3');await expect(result(page).locator('#mrdEditNotes')).toHaveValue('고친 특이사항');
  await line.getByRole('button',{name:'버리기'}).click();
  await expect(result(page)).toHaveAttribute('data-meeting-result','rail-2');await expect(result(page).locator('#mrdEditor')).toBeHidden();expect(s.meetingWrites).toHaveLength(0);
  // 저장을 고르면 저장한 뒤 넘어간다.
  await mrdMenu(page,'edit');await result(page).locator('#mrdEditNotes').fill('저장할 특이사항');
  await round(page,'rail-1').click();await expect(result(page).locator('#mrdLeave')).toBeVisible();
  await result(page).locator('#mrdLeaveSave').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.notes).toBe('저장할 특이사항');
  await expect(result(page)).toHaveAttribute('data-meeting-result','rail-1');await expect(result(page).locator('#mrdEditor')).toBeHidden();
  // 고치지 않았으면 묻지 않고 바로 넘어간다.
  await mrdMenu(page,'edit');await round(page,'rail-3').click();await expect(result(page)).toHaveAttribute('data-meeting-result','rail-3');await expect(result(page).locator('#mrdLeave')).toBeHidden();
});

test('PC 1280: ⋯ [칸 바꾸기]·[삭제]도 팝업을 거치지 않는다',async({page})=>{
  const s=state();await open(page,s,1280);
  await mrdMenu(page,'kind');
  const sheet=page.locator('#reportKindSheet');await expect(sheet).toBeVisible();await expect(outsidePopup(page)).toHaveCount(0);
  await sheet.locator('[data-sheet-value="struggle"]').click();
  await expect.poll(()=>s.meetingWrites.at(-1)?.activity_kind).toBe('struggle');
  await expect(outsidePopup(page)).toHaveCount(0);
  await page.locator('#mrdMore').click();await expect(page.locator('#mrdMoreMenu [data-mrd-more="delete"]')).toBeVisible();await expect(outsidePopup(page)).toHaveCount(0);
});

test('폰 390: 줄을 누르면 창, ⋯ → [수정]은 같은 창이 고치는 화면이 되고(두 번째 창 없음), 뒤로가기는 고치는 화면 → 보는 화면 → 닫힘',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,390,844);
  await page.locator('#meetingList [data-mrd-meeting="rail-3"]').click();
  const modal=page.locator('#meetingRoundDetailModal');await expect(modal).toBeVisible();await expect(modal).toHaveAttribute('role','dialog');
  await mrdMenu(page,'edit');
  await expect(modal.locator('#mrdEditor')).toBeVisible();await expect(modal.locator('#mrdView')).toBeHidden();
  await expect(page.locator('.modal:not(.hidden)')).toHaveCount(1);
  await page.goBack();
  await expect(modal.locator('#mrdEditor')).toBeHidden();await expect(modal.locator('#mrdView')).toBeVisible();await expect(modal).toBeVisible();
  await page.goBack();
  await expect(modal).toBeHidden();
  expect(errors).toEqual([]);
});
