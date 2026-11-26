// MTG-비정기회의바로쓰기(A안, 11/24 사용자 "비정기 회의는 A안 좋아"): 회의 결과 보고 회의명 자리 맨 위 [정기 회의 | 비정기 회의].
// [비정기 회의] → 이름 칸 바로 + 한 줄 [조직 ▾]·[관련 사업 ▾] → 저장하면 회의명 정리에 '그 조직 아래 비정기', 연결 표(app_meeting_set_links)에 그 사업영역.
// 다음 보고에서는 정기 목록에 안 뜨고 찾기로만 나온다. [정기 회의]는 이전과 같다(고르기 목록 그대로). 폰 412·PC 1280. 이름·글은 모두 지어낸 값.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {addReport} from './helpers/report-add.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const key=s=>s.replace(/\s+/g,'').toLowerCase();
const G1='gaaaaaa1',NAME='가상지부 긴급 간담회';

function state(){
  const s=baseState();s.meetingWrites=[];s.linkCalls=[];
  const row=(id,title,at)=>({id,workspace_id:s.workspace.id,title,series_name:title,round_no:null,meeting_at:at,transcript_text:'합성 결과',activity_kind:'meeting',business_area_id:null,next_plan:'',created_by:s.user.id,updated_at:at,result_status:'final'});
  s.meetings=[row('m1','가상 정기 회의','2026-11-20T01:00:00Z'),row('m2','가상 운영 회의','2026-11-18T01:00:00Z')];
  s.meetingNameSorts={parents:[{id:G1,name:'가상협의회'}]};
  return s;
}
async function open(page,s,width){
  await page.setViewportSize({width,height:900});await mockApp(page,s);
  await page.route(`${SB}/rest/v1/rpc/app_meeting_set_links`,route=>{s.linkCalls.push(route.request().postDataJSON());return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,updated_at:'2026-11-24T01:00:00Z',created:1,removed:0})})});
  await signIn(page,testOrigin+'/app/?view=reports&chip=meeting');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();
}
const panel=page=>page.locator('#kptuNamePanel');
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [412,1280])test(`${width}: [비정기 회의] → 이름·조직·관련 사업 → 저장, 다음 보고에서는 정기 목록에 없고 찾기로만`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,width);
  await addReport(page);
  const mode=page.locator('#meetingNameMode');
  await expect(mode.locator('[data-name-mode]')).toHaveText(['정기 회의','비정기 회의']);
  await expect(mode.locator('[data-name-mode="regular"]')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#meetingNameAdhoc')).toBeHidden();
  await expect(page.locator('#meetingNameSelect')).toBeVisible();

  // [비정기 회의]: 고르기 상자 대신 이름 칸 바로 + 조직·관련 사업 한 줄 + 안내 한 줄.
  await mode.locator('[data-name-mode="adhoc"]').click();
  await expect(mode.locator('[data-name-mode="adhoc"]')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#meetingNameSelect')).toBeHidden();
  await expect(page.locator('#meetingTitle')).toBeVisible();
  await expect(page.locator('#meetingTitle')).toHaveValue('');
  await expect(page.locator('#meetingNameAdhoc')).toBeVisible();
  await expect(page.locator('#meetingNameAdhocNote')).toHaveText('비정기는 다음 회의 목록에 안 떠요 · 찾기로만');
  await expect(page.locator('#meetingNameOrg option')).toHaveText(['가상협의회','기타']);
  await page.locator('#meetingNameOrg').selectOption(G1);
  await page.locator('#meetingNameArea').selectOption('child-a2');
  // 관련 사업은 [연결할 곳]과 같은 연결이다.
  await expect(page.locator('#meetingPlaces')).toContainText('산자부 대응');
  await page.locator('#meetingTitle').fill(NAME);
  if(width<=412)expect(await noSideScroll(page)).toBe(true);
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  expect(s.meetingWrites.at(-1).series_name).toBe(NAME);
  await expect.poll(()=>s.linkCalls.length).toBe(1);
  expect(s.linkCalls[0].p_targets).toEqual([{kind:'project',target_id:'child-a2'}]);
  await expect.poll(()=>s.meetingNameSorts?.names?.[key(NAME)]).toBe(G1);

  // 다음 보고: 버튼은 다시 [정기 회의], 고르기 목록에 새 비정기 이름은 없고 찾기로만 나온다(꼬리표 '· 비정기 · 가상협의회').
  await addReport(page);
  await expect(mode.locator('[data-name-mode="regular"]')).toHaveAttribute('aria-checked','true');
  await expect(page.locator('#meetingNameAdhoc')).toBeHidden();
  // PC는 고른 회의 줄의 이름을 미리 채우지만 비정기 이름은 채우지 않는다.
  await expect(page.locator('#meetingTitle')).not.toHaveValue(NAME);
  await page.locator('#meetingNameSelect').click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.mnp-row:not(.mnp-sub) .mnp-name',{hasText:NAME})).toHaveCount(0);
  await expect(panel(page).locator(`[data-mnp-group="${G1}"]`)).toContainText('비정기 회의 1');
  await panel(page).locator('[data-mnp-find]').fill('긴급');
  await expect(panel(page).locator('.mnp-pick .mnp-name')).toHaveText([NAME]);
  await expect(panel(page).locator('.mnp-tag')).toHaveText('· 비정기 · 가상협의회');
  expect(errors).toEqual([]);
});

for(const width of [412,1280])test(`${width}: [정기 회의]는 이전과 같다 — 고르기 목록에서 고르고, 비정기로 갔다 돌아와도 고른 이름 그대로`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=state();await open(page,s,width);
  await addReport(page);
  await page.locator('#meetingNameSelect').click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.mnp-pick .mnp-name')).toHaveText(['가상 정기 회의','가상 운영 회의']);
  await panel(page).locator('[data-mnp-pick="가상 운영 회의"]').click();
  await expect(page.locator('#meetingNameSelect')).toHaveValue('가상 운영 회의');
  await expect(page.locator('#meetingTitle')).toBeHidden();
  // 비정기로 바꿨다가(이름 칸이 빈 채로 열림) 정기로 돌아오면 고르기 상자.
  const mode=page.locator('#meetingNameMode');
  await mode.locator('[data-name-mode="adhoc"]').click();
  await expect(page.locator('#meetingTitle')).toHaveValue('');
  await mode.locator('[data-name-mode="regular"]').click();
  await expect(page.locator('#meetingNameSelect')).toBeVisible();
  await expect(page.locator('#meetingNameAdhoc')).toBeHidden();
  // 정기로 저장하면 회의명 정리는 건드리지 않는다.
  await page.locator('#meetingNameSelect').click();
  await panel(page).locator('[data-mnp-pick="가상 정기 회의"]').click();
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  expect(s.meetingWrites.at(-1).series_name).toBe('가상 정기 회의');
  expect(s.meetingNameSorts).toEqual({parents:[{id:G1,name:'가상협의회'}]});
  expect(errors).toEqual([]);
});
