// MTG-한줄업데이트(요청함 10/29 08:59, 명진 09:01 '추천대로'): 사업 보고 [전체] [+] 메뉴 맨 위 [✎ 한 줄 업데이트] → 창(사업영역·날짜·한 줄·
// + 다음 할 일) → 저장 본문(칸 oneline·꼬리표·다음 할 일)과 사업영역 연결 → 목록에 그 문장, [한 줄] 칩에서 [+]는 바로 창. 폰 412·884, PC 1440.
// 모든 이름·글은 합성 값.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {showAllReportWeeks} from './helpers/report-week.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const LINE='합성 안전 개정은 단기 접근이 어려워 연구·토론으로 요구안을 먼저 정돈하기로 함';
const PLAN='합성 토론회 날짜 잡기';

function state(){
  const s=baseState();s.meetingWrites=[];s.linkCalls=[];
  s.meetings=[{id:'m-1',workspace_id:s.workspace.id,title:'합성 정기 회의',series_name:'합성 정기 회의',round_no:1,meeting_at:'2026-10-08T01:00:00Z',transcript_text:'합성 결과',activity_kind:'meeting',business_area_id:null,next_plan:null,created_by:s.user.id,updated_at:'2026-10-08T01:00:00Z'}];
  return s;
}
async function open(page,s,width){
  await page.setViewportSize({width,height:900});await mockApp(page,s);
  // 연결 저장 함수(app_meeting_set_links): 받은 곳을 기록하고 성공으로 답한다.
  await page.route(`${SB}/rest/v1/rpc/app_meeting_set_links`,route=>{s.linkCalls.push(route.request().postDataJSON());return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,updated_at:'2026-10-29T01:00:00Z',created:1,removed:0})})});
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();
  await showAllReportWeeks(page);
}
const chip=(page,name)=>page.locator('#reportKindFilter').getByRole('radio',{name,exact:true});
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [412,884,1440])test(`${width}: [전체] [+] 맨 위 한 줄 업데이트 → 사업영역·날짜·한 줄·다음 할 일 저장 → 목록에 문장, [한 줄] 칩의 [+]는 바로 창`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,width);
  // [한 줄] 칩은 한 줄 업데이트가 생기기 전에는 없다.
  await expect(chip(page,'한 줄')).toHaveCount(0);
  await chip(page,'전체').click();
  await page.locator('#newMeetingBtn').click();
  const sheet=page.locator('#reportKindSheet');await expect(sheet).toBeVisible();
  const first=sheet.locator('[data-sheet-content] > button').first();
  await expect(first).toHaveAttribute('data-report-oneline','');await expect(first).toContainText('한 줄 업데이트');
  // 여덟 칸 고르기는 그대로(한 줄 줄은 칸 값이 아니다).
  await expect(sheet.locator('[data-sheet-value]')).toHaveCount(8);
  await first.click();
  await expect(sheet).toBeHidden();
  const dialog=page.locator('#reportOnelineDialog');await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-ol-day]')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(dialog.locator('[data-ol-plan]')).toBeHidden();
  if(width<=884)expect(await noSideScroll(page)).toBe(true);
  // 사업영역은 필수.
  await dialog.locator('[data-ol-text]').fill(LINE);
  await dialog.locator('[data-ol-save]').click();
  await expect(dialog.locator('[data-ol-status]')).toHaveText('사업영역을 골라 주세요.');
  expect(s.meetingWrites).toEqual([]);
  // 공용 사업영역 고르기 창에서 고른다.
  await dialog.locator('[data-ol-area]').click();
  const areas=page.locator('#reportAreaSheet');await expect(areas).toBeVisible();
  await areas.locator('[data-sheet-value="top-a"]').click();
  await expect(areas).toBeHidden();
  await expect(dialog.locator('[data-ol-area]')).toContainText('공공기관 기능개혁 대응');
  // 다음 할 일은 눌러야 펼쳐진다.
  await dialog.locator('[data-ol-plan-box] > summary').click();
  await dialog.locator('[data-ol-plan]').fill(PLAN);
  await dialog.locator('[data-ol-save]').click();
  await expect(dialog).toBeHidden();
  const day=await page.evaluate(()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10));
  expect(s.meetingWrites).toHaveLength(1);
  expect(s.meetingWrites[0]).toMatchObject({workspace_id:'workspace-1',activity_kind:'oneline',business_area_id:'top-a',title:LINE,series_name:LINE,next_plan:PLAN,
    meeting_at:new Date(`${day}T00:00:00+09:00`).toISOString(),transcript_text:'',notes:''});
  // 꼬리표 사업영역에 연결(사업영역 관리의 사업 보고 목록).
  expect(s.linkCalls).toHaveLength(1);
  expect(s.linkCalls[0].p_meeting_id).toBe('new-meeting');
  expect(JSON.stringify(s.linkCalls[0].p_targets)).toContain('top-a');
  // 목록에 그 문장, [한 줄] 칩이 생긴다.
  await expect(page.locator('#meetingList').getByText(LINE).first()).toBeVisible();
  await expect(chip(page,'한 줄')).toBeVisible();
  if(width<=884)expect(await noSideScroll(page)).toBe(true);
  // [한 줄] 칩: 그 칸만, [+]는 칸 고르기 없이 바로 한 줄 창. Esc로 닫힌다.
  await chip(page,'한 줄').click();
  await page.locator('#newMeetingBtn').click();
  await expect(dialog).toBeVisible();await expect(sheet).toBeHidden();
  await expect(dialog.locator('[data-ol-text]')).toHaveValue('');
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
  expect(s.meetingWrites).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('412: 칸 칩([회의])에서 [+]는 지금처럼 바로 쓰기 창(한 줄 줄 없음)',async({page})=>{
  const s=state();await open(page,s,412);
  await chip(page,'회의').click();
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#reportOnelineDialog')).toHaveCount(0);
});
