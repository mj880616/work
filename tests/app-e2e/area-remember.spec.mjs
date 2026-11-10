// S56-13 BIZ-사업영역기억(요청함 11/10 11:20 → 11:22 'ㅇ'): 같은 회의명은 한 번 정한 사업영역·[없음]을 기억한다.
// 지난주 집행위를 [없음], 상집을 사업영역으로 저장해 둔 상태 → 이번 주 같은 이름 보고는 '안 단 보고'에 안 뜨고 그 값이 기존 PATCH 길로 붙는다.
// 처음 보는 이름은 여전히 묻는다. 모든 이름·글은 합성 값.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {openMeetingResult} from './helpers/meeting-open.mjs';

test.use({timezoneId:'Asia/Seoul'});

function state(){
  const s=baseState();s.meetingWrites=[];
  const row=(id,title,at,extra={})=>({id,workspace_id:s.workspace.id,title,series_name:title,round_no:1,meeting_at:at,transcript_text:'합성 결과 글',activity_kind:'meeting',business_area_id:null,business_area_none:false,next_plan:null,created_by:s.user.id,created_at:at,updated_at:at,...extra});
  s.meetings=[
    row('w1-exec','합성 집행위','2026-11-03T01:00:00Z',{business_area_none:true,updated_at:'2026-11-03T05:00:00Z'}),
    row('w1-board','합성 상집','2026-11-03T02:00:00Z',{business_area_id:'top-a',updated_at:'2026-11-03T05:00:00Z'}),
    row('w2-exec','합성 집행위','2026-11-10T01:00:00Z'),
    row('w2-board','합성  상집','2026-11-10T02:00:00Z'),
    row('w2-new','합성 처음 회의','2026-11-10T03:00:00Z')
  ];
  return s;
}
async function open(page,s,width){
  await page.clock.setFixedTime(new Date('2026-11-10T06:00:00Z'));
  await page.setViewportSize({width,height:900});await mockApp(page,s);
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();
}

for(const width of [390,884,1280])test(`${width}: 같은 회의명은 지난번 사업영역·[없음]이 붙어 '안 단 보고'에 안 뜨고, 처음 이름만 묻는다`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,width);
  const line=page.locator('#areaUntaggedLine');
  await expect(line).toContainText('사업영역 안 단 보고 1건');
  // 기존 저장 길(app_meetings PATCH)로 사업영역·[없음]·updated_at만 — 같은 이름 두 건만.
  await expect.poll(()=>s.meetingWrites.length).toBe(2);
  const exec=s.meetings.find(m=>m.id==='w2-exec'),board=s.meetings.find(m=>m.id==='w2-board');
  expect(exec).toMatchObject({business_area_id:null,business_area_none:true});
  expect(board).toMatchObject({business_area_id:'top-a',business_area_none:false});
  for(const w of s.meetingWrites)expect(Object.keys(w).sort()).toEqual(['business_area_id','business_area_none','updated_at']);
  expect(s.meetings.find(m=>m.id==='w2-new').business_area_id).toBeNull();
  // [달기] 창에는 처음 보는 이름 하나만.
  await line.locator('[data-area-untagged]').click();
  const sheet=page.locator('#reportAreaTagSheet');await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-area-tag-row]')).toHaveCount(1);
  await expect(sheet.locator('[data-area-tag-row="w2-new"]')).toBeVisible();
  await page.keyboard.press('Escape');await expect(sheet).toBeHidden();
  // 이번 주 집행위는 '사업영역 없음'으로 들어가 있다.
  await openMeetingResult(page,'w2-exec');
  await expect(page.locator('[data-biz-area-line]:visible')).toHaveText('사업영역 없음');
  expect(errors).toEqual([]);
});
