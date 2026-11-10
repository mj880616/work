// BIZ-주간보고접기(요청함 11/09 18:16): 사업 보고 '이번 주 주간보고' 칸 — 처음 들어오면 펼침, 보고 하나를 직접 열면 자동으로 접힌 한 줄,
// 창을 닫으면 다시 펼침(폰), 제목 줄로 언제든 손으로 접고 펴기(보고를 연 동안 손으로 고른 것이 자동보다 우선, 손으로 고른 값은 기기별로 기억 — S56-13),
// 위 띠 '사업영역 안 단 보고 n건'도 같이 접힘, 접힌 동안은 표를 그리지 않음. 서버는 가짜, 글은 합성 값. 시계 2026-11-10(화) 서울.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';
import {selectMeetingRound} from './helpers/meeting-open.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',NOW='2026-11-10T00:30:00Z';
function state(){
  const s=baseState();
  const row=(id,title,at,area)=>({id,workspace_id:s.workspace.id,title,series_name:title,round_no:1,meeting_at:at,transcript_text:`${title} 합성 결과 글`,activity_kind:'meeting',business_area_id:area,next_plan:'',created_by:s.user.id,created_at:at,updated_at:at,notes:'',decisions:''});
  // 이번 주(11.9~11.15) 보고 셋 — 하나는 사업영역을 안 달아 위 띠 '사업영역 안 단 보고 1건'이 보인다.
  s.meetings=[row('m-a','합성 가 간담회','2026-11-09T01:00:00Z','child-a1'),row('m-b','합성 나 회의','2026-11-10T00:00:00Z','child-a1'),row('m-c','합성 다 모임','2026-11-09T05:00:00Z',null)];
  return s;
}
async function open(page,width){
  await page.setViewportSize({width,height:900});
  await page.clock.setFixedTime(new Date(NOW));
  await mockApp(page,state());
  await page.route(`${SB}/rest/v1/app_weekly_exec_requests**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await installBusinessNowServer(page,{});
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  const box=page.locator('#meetingsView #bizWeekBox');
  await expect(box).toBeVisible();
  return box;
}
const foldBtn=box=>box.locator('.biz-week-title [data-bw-fold]');
async function expectOpen(page,box,open){
  await expect(foldBtn(box)).toHaveAttribute('aria-expanded',String(open));
  if(open){await expect(box.locator('.biz-sum-table')).toBeVisible();await expect(page.locator('#areaUntaggedLine')).toBeVisible()}
  else{await expect(box.locator('[data-bw-body]')).toBeHidden();await expect(page.locator('#areaUntaggedLine')).toBeHidden();await expect(foldBtn(box)).toHaveText(/이번 주 주간보고\s*11\.9~11\.15/)}
}

for(const width of [884,1440])test(`PC ${width}: 처음 펼침 → 보고 하나 열면 접힘 → 제목으로 손으로 펴면 다른 보고를 열어도 펼침 → 손으로 접은 것은 다시 들어와도 접힘(기억)`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const box=await open(page,width);
  await expectOpen(page,box,true);
  // 왼쪽 종류·가운데 줄에서 보고 하나를 직접 고른다 → 칸이 접힌 한 줄, 결과가 위로 올라온다.
  await selectMeetingRound(page,'m-a');
  await expectOpen(page,box,false);
  const head=await box.boundingBox();expect(head.height).toBeLessThanOrEqual(44);
  // 접힌 동안 다른 보고를 골라도 접힌 채.
  await selectMeetingRound(page,'m-b');
  await expectOpen(page,box,false);
  // 손으로 펴면 보고를 바꿔 열어도 펼친 채(손으로 고른 것이 자동보다 우선).
  await foldBtn(box).click();
  await expectOpen(page,box,true);
  await selectMeetingRound(page,'m-a');
  await expectOpen(page,box,true);
  // 손으로 접기도 된다.
  await foldBtn(box).click();
  await expectOpen(page,box,false);
  // S56-13 BIZ-주간보고접힘기억: 손으로 접은 것은 기억 — 다른 화면에 갔다 와도 접힌 채(앞 규칙 '다시 들어오면 펼침'을 바꿈).
  await page.evaluate(()=>window.KPTURouter.go('home',{source:'delegated'}));
  await expect(page.locator('#meetingsView')).toBeHidden();
  await page.evaluate(()=>window.KPTURouter.go('meetings',{source:'delegated'}));
  await expectOpen(page,box,false);
  // 손으로 펴면 다시 들어와도 펼친 채.
  await foldBtn(box).click();await expectOpen(page,box,true);
  await page.evaluate(()=>window.KPTURouter.go('home',{source:'delegated'}));await expect(page.locator('#meetingsView')).toBeHidden();
  await page.evaluate(()=>window.KPTURouter.go('meetings',{source:'delegated'}));
  await expectOpen(page,box,true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=1)).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('폰',()=>{
test.use({hasTouch:true});
test('폰 390: 줄을 눌러 창이 열리면 접힘, 창을 닫으면 다시 펼침',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const box=await open(page,390);
  await expectOpen(page,box,true);
  await page.locator('#meetingList [data-mrd-meeting="m-a"]').click();
  const modal=page.locator('#meetingRoundDetailModal');await expect(modal).toBeVisible();
  await expect(foldBtn(box)).toHaveAttribute('aria-expanded','false');
  await modal.locator('#mrdClose').click();await expect(modal).toBeHidden();
  await expectOpen(page,box,true);
  expect(errors).toEqual([]);
});
});
