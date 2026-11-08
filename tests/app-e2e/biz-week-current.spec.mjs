// S54-34 ① BIZ-주간표이번주(★급★) + BIZ-주간표스크롤(요청함 11/09 07:46~07:54).
// - 사업 보고를 열면 주는 늘 이번 주(오늘이 든 월~일). 월요일처럼 이번 주 보고가 0건이어도 지난주로 가지 않고 '· 0건', '이번 주 주간보고' 칸에 [쓰기].
// - ‹로 지난주에 가면 그때 글(전환 주 앞은 읽기 전용) 그대로, 다시 ›로 이번 주.
// - [전체 기간]이면 주간보고 칸은 늘 이번 주이고 접힌 한 줄('이번 주 주간보고 11.9~11.15 ⌄'), 누르면 펼침. 다시 [전체 기간]으로 들어오면 또 접힘. 주 단위는 늘 펼침.
// - 표 칸은 따로 스크롤하는 칸이 아니다: 표 위에서 밀어도 화면 전체가 위아래로 움직이고, 화면 끝에서 표 끝이 아래 [목록|달력|사진]에 가리지 않는다.
// 서버는 가짜, 이름·글은 모두 합성 값. 시계 2026-11-09(월) 09:30(서울).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';
import {reportPeriodSelect} from './helpers/report-week.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',NOW='2026-11-09T00:30:00Z';

function state(){
  const s=baseState();
  const row=(id,title,at,area)=>({id,workspace_id:s.workspace.id,title,series_name:title,round_no:1,meeting_at:at,transcript_text:'합성 결과 글',activity_kind:'meeting',business_area_id:area,next_plan:'',created_by:s.user.id,created_at:at,updated_at:at,notes:'',decisions:''});
  // 보고는 지난주(11.3)·그 앞 주(10.28)에만 있다 — 이번 주(11.9~11.15)는 0건.
  s.meetings=[row('m-last','합성 지난주 간담회','2026-11-03T01:00:00Z','child-a1'),row('m-older','합성 앞 주 간담회','2026-10-28T01:00:00Z','child-a1')];
  return s;
}
async function open(page,width,height=900,prefs=null){
  const s=state();
  await page.setViewportSize({width,height});
  if(prefs)await installViewPrefsServer(page,prefs);
  await page.clock.setFixedTime(new Date(NOW));
  await mockApp(page,s);
  await page.route(`${SB}/rest/v1/app_weekly_exec_requests**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await installBusinessNowServer(page,{});
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  const box=page.locator('#meetingsView #bizWeekBox');
  await expect(box).toBeVisible();
  return box;
}
const label=page=>page.locator('#reportWeekFilter .report-week-label');

for(const width of [390,884,1280])test(`${width}: 월요일에 열면 이번 주(0건)이고 주간보고 칸에 [쓰기] — 지난주는 읽기만, [전체 기간]은 이번 주 접힌 한 줄`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const box=await open(page,width);
  // ① 이번 주(오늘이 든 월~일), 보고 0건이어도 지난주로 가지 않는다.
  await expect(label(page)).toHaveText('11.9(월)~11.15(일)');
  await expect(page.locator('#reportWeekFilter .report-week-count')).toHaveText('· 0건');
  // ② 이번 주 주간보고: 펼친 칸, 칸마다 [쓰기].
  await expect(box.locator('.biz-week-title')).toHaveText('이번 주 주간보고');
  await expect(box.locator('[data-bw-fold]')).toHaveCount(0);
  await expect(box.locator('.biz-sum-table')).toBeVisible();
  const write=box.locator('[data-bp-cell="progress"]').first();
  await expect(write).toHaveText('쓰기');
  await write.click();
  await expect(box.locator('textarea[data-bp-field]')).toBeFocused();
  await box.locator('[data-bp-edit-cancel]').click();
  // ③ ‹ 지난주(전환 주 앞)는 그때 글을 읽기만.
  await page.locator('#reportWeekFilter [data-report-week="prev"]').click();
  await expect(label(page)).toHaveText('11.2(월)~11.8(일)');
  await expect(box.locator('.biz-week-title')).toHaveText('11.2~11.8 주간보고');
  await expect(box.locator('[data-bp-status]')).toHaveText('옛 보고라 수정할 수 없어요.');
  await expect(box.locator('[data-bp-cell]')).toHaveCount(0);
  // ⑤⑥ [전체 기간]: 주간보고 칸은 이번 주, 접힌 한 줄. 누르면 펼침.
  const pick=reportPeriodSelect(page);
  await pick.selectOption('all');
  const fold=box.locator('.biz-week-title [data-bw-fold]');
  await expect(fold).toHaveAttribute('aria-expanded','false');
  await expect(fold).toHaveText(/이번 주 주간보고\s*11\.9~11\.15/);
  await expect(fold.locator('.kptu-chev')).toHaveCount(1);
  await expect(box.locator('[data-bw-body]')).toBeHidden();
  const titleBox=await fold.boundingBox();
  expect(titleBox.height).toBeLessThanOrEqual(36); // 한 줄
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded','true');
  await expect(box.locator('.biz-sum-table')).toBeVisible();
  await expect(box.locator('[data-bp-cell="progress"]').first()).toHaveText('쓰기'); // 이번 주라 쓸 수 있다
  await fold.click();
  await expect(box.locator('[data-bw-body]')).toBeHidden();
  // 이번 주로 돌아오면 늘 펼침(꺾쇠 버튼 없음). 다시 [전체 기간]이면 또 접힘(기억하지 않음).
  await pick.selectOption('week');
  await expect(label(page)).toHaveText('11.9(월)~11.15(일)');
  await expect(box.locator('.biz-week-title')).toHaveText('이번 주 주간보고');
  await expect(box.locator('[data-bw-fold]')).toHaveCount(0);
  await expect(box.locator('.biz-sum-table')).toBeVisible();
  await pick.selectOption('all');
  await fold.click();await expect(fold).toHaveAttribute('aria-expanded','true');
  await pick.selectOption('week');await pick.selectOption('all');
  await expect(box.locator('.biz-week-title [data-bw-fold]')).toHaveAttribute('aria-expanded','false');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=1)).toBe(true);
  expect(errors).toEqual([]);
});

test('390: 저장된 보기가 [전체 기간]이어도 열면 주간보고 칸은 이번 주 접힌 한 줄', async({page})=>{
  const box=await open(page,390,900,{report_period:{mode:'all'}});
  await expect(reportPeriodSelect(page)).toHaveValue('all');
  const fold=box.locator('.biz-week-title [data-bw-fold]');
  await expect(fold).toHaveAttribute('aria-expanded','false');
  await expect(fold).toHaveText(/이번 주 주간보고\s*11\.9~11\.15/);
  await expect(box.locator('[data-bw-body]')).toBeHidden();
});

test.describe('터치 화면',()=>{
test.use({hasTouch:true});
for(const width of [390,884])test(`${width}: 표 위에서 밀어도 화면 전체가 위아래로 스크롤되고, 표 칸은 따로 스크롤하지 않는다`,async({page})=>{
  const box=await open(page,width,520);
  await expect(box.locator('.biz-sum-table')).toBeVisible();
  // 표 칸은 스크롤 칸이 아니다(가로·세로 넘침 없음, 높이 제한 없음).
  const body=await box.locator('[data-bw-body]').evaluate(el=>{const cs=getComputedStyle(el);return {ox:cs.overflowX,oy:cs.overflowY,max:cs.maxHeight,extra:el.scrollHeight-el.clientHeight,wide:el.scrollWidth-el.clientWidth}});
  expect(body).toMatchObject({ox:'visible',oy:'visible',max:'none'});
  expect(body.wide).toBeLessThanOrEqual(1);
  // 표 위에서 손가락으로 위로 밀면(터치 스크롤) 화면이 내려간다.
  const t=await box.locator('.biz-sum-table tbody td').first().boundingBox();
  const cdp=await page.context().newCDPSession(page);
  const before=await page.evaluate(()=>scrollY),x=Math.round(t.x+t.width/2),y=Math.round(t.y+Math.min(t.height/2,20));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=15;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*10}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(before+50);
  // 화면 끝까지 내리면 표 끝이 아래 [목록|달력|사진]에 가리지 않는다.
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
  const end=await box.locator('.biz-sum-table').evaluate(el=>el.getBoundingClientRect().bottom);
  const dock=await page.locator('#reportViewFilter').evaluate(el=>getComputedStyle(el).position==='fixed'?el.getBoundingClientRect().top:Infinity);
  expect(end).toBeLessThanOrEqual(dock);
});
});
