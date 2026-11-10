// S56-13 BIZ-주간보고접힘기억(요청함 11/10 10:00 "이번주 주간보고, 어느페이지에서든 펼침, 접힘 기억" → "기기별로 기억").
// - 손으로 접으면 서버 view_prefs.biz_week_open.<기기>에 기억 → 다른 종류·다른 기간·다시 들어와도·새로 고침 뒤에도 접힌 채.
// - 폰은 폰대로 따로(pc 칸에 접힘이 있어도 폰은 기본 펼침).
// - 보고를 열면 자동으로 접히고(기억은 안 바뀜), 닫으면 기억한 상태로.
// - DB 적용 전(서버가 biz_week_open을 거절)이면 이번 접속만 기억.
// 서버는 가짜, 글은 합성 값. 시계 2026-11-10(화) 서울.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
import {reportPeriodSelect} from './helpers/report-week.mjs';
import {selectMeetingRound} from './helpers/meeting-open.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',NOW='2026-11-10T00:30:00Z';
function state(){
  const s=baseState();
  const row=(id,title,at)=>({id,workspace_id:s.workspace.id,title,series_name:title,round_no:1,meeting_at:at,transcript_text:`${title} 합성 결과 글`,activity_kind:'meeting',business_area_id:'child-a1',next_plan:'',created_by:s.user.id,created_at:at,updated_at:at,notes:'',decisions:''});
  s.meetings=[row('m-a','합성 가 간담회','2026-11-09T01:00:00Z'),row('m-b','합성 나 회의','2026-11-10T00:00:00Z')];
  return s;
}
async function open(page,width,{prefs=null,deny=false}={}){
  await page.setViewportSize({width,height:900});
  const server=await installViewPrefsServer(page,prefs,{denyKeys:deny?['biz_week_open']:[]});
  await page.clock.setFixedTime(new Date(NOW));
  await mockApp(page,state());
  await page.route(`${SB}/rest/v1/app_weekly_exec_requests**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await installBusinessNowServer(page,{});
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  const box=page.locator('#meetingsView #bizWeekBox');
  await expect(box).toBeVisible();
  return {box,server};
}
const fold=box=>box.locator('.biz-week-title [data-bw-fold]');
const expectOpen=async(box,open)=>{await expect(fold(box)).toHaveAttribute('aria-expanded',String(open));if(open)await expect(box.locator('.biz-sum-table')).toBeVisible();else await expect(box.locator('[data-bw-body]')).toBeHidden()};

test('PC 1280: 접으면 기억 — 다른 기간·다시 들어와도·새로 고침 뒤에도 접힘, 보고를 열고 닫아도 기억 그대로',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const {box,server}=await open(page,1280);
  await expectOpen(box,true);
  await fold(box).click();await expectOpen(box,false);
  await expect.poll(()=>server.value?.biz_week_open).toEqual({pc:false});
  // 다른 기간(전체 기간)·다시 주 단위로 와도 접힌 채.
  await reportPeriodSelect(page).selectOption('all');await expectOpen(box,false);
  await reportPeriodSelect(page).selectOption('week');await expectOpen(box,false);
  // 다른 화면에 갔다 와도 접힌 채.
  await page.evaluate(()=>window.KPTURouter.go('home',{source:'delegated'}));await expect(page.locator('#meetingsView')).toBeHidden();
  await page.evaluate(()=>window.KPTURouter.go('meetings',{source:'delegated'}));await expectOpen(box,false);
  // 손으로 펴면 펼침을 기억하고, 보고를 열면 자동으로 접히지만 기억은 바뀌지 않는다.
  await fold(box).click();await expectOpen(box,true);
  await expect.poll(()=>server.value?.biz_week_open).toEqual({pc:true});
  const writes=server.patches.length;
  await selectMeetingRound(page,'m-a');await expectOpen(box,false);
  expect(server.patches.length).toBe(writes);expect(server.value.biz_week_open).toEqual({pc:true});
  // 새로 고침 뒤에도 기억(펼침).
  await page.reload();await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expectOpen(box,true);
  expect(errors).toEqual([]);
});

test('폰 390: PC에서 접어 둔 것(pc 칸)과 따로 — 폰은 기본 펼침, 폰에서 접으면 phone 칸에만, 창을 닫으면 기억한 상태로',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const {box,server}=await open(page,390,{prefs:{biz_week_open:{pc:false}}});
  await expectOpen(box,true);
  await fold(box).click();await expectOpen(box,false);
  await expect.poll(()=>server.value?.biz_week_open).toEqual({pc:false,phone:false});
  // 줄을 눌러 창이 열려도 접힌 채, 창을 닫아도 기억한 접힘 그대로.
  await page.locator('#meetingList [data-mrd-meeting="m-a"]').click();
  const modal=page.locator('#meetingRoundDetailModal');await expect(modal).toBeVisible();
  await expect(fold(box)).toHaveAttribute('aria-expanded','false');
  await modal.locator('#mrdClose').click();await expect(modal).toBeHidden();
  await expectOpen(box,false);
  expect(errors).toEqual([]);
});

test('PC 1280: DB 적용 전(서버가 거절)이면 이번 접속 동안만 기억',async({page})=>{
  const {box,server}=await open(page,1280,{deny:true});
  await fold(box).click();await expectOpen(box,false);
  await reportPeriodSelect(page).selectOption('all');await expectOpen(box,false);
  await reportPeriodSelect(page).selectOption('week');await expectOpen(box,false);
  expect(server.value?.biz_week_open).toBeUndefined();
});
