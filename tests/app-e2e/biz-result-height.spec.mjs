// S56-13 BIZ-결과칸작음(요청함 11/10 10:00): PC 사업 보고 오른쪽 회의 결과 칸이 낮게 잘려 작은 칸 안에서만 스크롤하던 문제.
// 원인: 결과 칸 최대 높이(--follow-max, follow-pane.js)를 화면 스크롤·창 크기 바뀔 때만 다시 쟀다. 보고를 열면 위쪽 '이번 주 주간보고'가
// 자동으로 접혀(BIZ-주간보고접기) 칸이 위로 올라오는데, 표가 펼쳐 있을 때 잰 작은 값이 그대로 남았다.
// 지금: 붙인 칸이 든 화면 묶음의 크기 변화도 보고 다시 잰다 → 결과가 길면 칸이 화면 아래 끝까지(12px 띄움), 접고 펼 때마다 바로 맞음.
// 서버는 가짜, 이름·글은 모두 합성 값. 시계 2026-11-10(화) 10:00(서울).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',NOW='2026-11-10T01:00:00Z';
const LONG=Array.from({length:120},(_,i)=>`합성 결과 줄 ${i+1}`).join('\n');

function state(){
  const s=baseState();
  const row=(id,title,round,at,text='합성 결과 글')=>({id,workspace_id:s.workspace.id,title,series_name:title,round_no:round,meeting_at:at,transcript_text:text,activity_kind:'meeting',business_area_id:'child-a1',next_plan:'',created_by:s.user.id,created_at:at,updated_at:at,notes:'',decisions:''});
  s.meetings=[row('m-a','합성 상집',46,'2026-11-10T00:00:00Z',LONG),row('m-b','합성 집행위',12,'2026-11-09T05:00:00Z'),row('m-c','합성 상집',45,'2026-11-03T00:00:00Z')];
  return s;
}
async function open(page,width=1280,height=900){
  await page.setViewportSize({width,height});
  await page.clock.setFixedTime(new Date(NOW));
  await mockApp(page,state());
  await page.route(`${SB}/rest/v1/app_weekly_exec_requests**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await installBusinessNowServer(page,{});
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  const box=page.locator('#meetingsView #bizWeekBox');
  await expect(box).toBeVisible();
  return box;
}
// 결과 칸 최대 높이가 지금 자리 기준 '화면 아래 끝까지'(followMax와 같은 식)인지: 다르면 몇 px 어긋났는지.
const off=page=>page.locator('#meetingList .mcol-result').evaluate(e=>{const top=e.getBoundingClientRect().top,want=Math.max(160,Math.floor(innerHeight-Math.max(12,top)-12));return Math.abs(parseFloat(e.style.getPropertyValue('--follow-max'))-want)});

test('PC 1280: 보고를 열면 주간보고가 접히고 결과 칸은 화면 아래 끝까지, 접고 펼 때마다 칸 높이가 바로 맞는다',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const box=await open(page);
  const fold=box.locator('.biz-week-title [data-bw-fold]');
  await expect(fold).toHaveAttribute('aria-expanded','true');
  await page.locator('#meetingList .mcol-kinds [data-meeting-kind]').filter({hasText:'합성 상집'}).click();
  await page.locator('#meetingList [data-meeting-round="m-a"]').click();
  const pane=page.locator('#meetingList .mcol-result');
  await expect(pane.locator('#meetingRoundDetailModal.mrd-docked')).toBeVisible();
  // 보고를 열면 주간보고가 접힌다(BIZ-주간보고접기) → 결과 칸이 위로 올라오고 최대 높이도 그 자리에 맞는다(스크롤 안 해도).
  await expect(fold).toHaveAttribute('aria-expanded','false');
  await expect.poll(()=>off(page)).toBeLessThanOrEqual(1);
  // 결과가 길어 칸이 화면 아래 끝(12px 띄움)까지 차고, 그 안에서만 넘어간다.
  await expect.poll(()=>pane.evaluate(e=>Math.round(innerHeight-12-e.getBoundingClientRect().bottom))).toBeLessThanOrEqual(2);
  expect(await pane.evaluate(e=>e.scrollHeight-e.clientHeight)).toBeGreaterThan(300);
  // 펼치면 칸이 아래로 내려가고 높이도 그 자리에 바로 맞는다. 다시 접으면 다시 화면 아래 끝까지.
  await fold.click();await expect(fold).toHaveAttribute('aria-expanded','true');
  await expect.poll(()=>off(page)).toBeLessThanOrEqual(1);
  await fold.click();await expect(fold).toHaveAttribute('aria-expanded','false');
  await expect.poll(()=>off(page)).toBeLessThanOrEqual(1);
  await expect.poll(()=>pane.evaluate(e=>Math.round(innerHeight-12-e.getBoundingClientRect().bottom))).toBeLessThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('PC 1280: 결과가 짧으면 칸도 짧다(빈 칸으로 화면 끝까지 늘이지 않음)',async({page})=>{
  await open(page);
  await page.locator('#meetingList .mcol-kinds [data-meeting-kind]').filter({hasText:'합성 집행위'}).click();
  await page.locator('#meetingList [data-meeting-round="m-b"]').click();
  const pane=page.locator('#meetingList .mcol-result');
  await expect(pane.locator('#meetingRoundDetailModal.mrd-docked')).toBeVisible();
  await expect.poll(()=>off(page)).toBeLessThanOrEqual(1);
  const m=await pane.evaluate(e=>({gap:innerHeight-12-e.getBoundingClientRect().bottom,over:e.scrollHeight-e.clientHeight}));
  expect(m.over).toBeLessThanOrEqual(1);expect(m.gap).toBeGreaterThan(40);
});
