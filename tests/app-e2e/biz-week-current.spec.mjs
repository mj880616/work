// S54-34 ① BIZ-주간표이번주(★급★) + BIZ-주간표스크롤(요청함 11/09 07:46~07:54).
// - 사업 보고를 열면 주는 늘 이번 주(오늘이 든 월~일). 월요일처럼 이번 주 보고가 0건이어도 지난주로 가지 않고 '0건', '이번 주 주간보고' 칸에 [쓰기].
// - ‹로 지난주에 가면 그때 글(전환 주 앞은 읽기 전용) 그대로, 다시 ›로 이번 주.
// - [전체 기간]이면 주간보고 칸은 늘 이번 주이고 접힌 한 줄('이번 주 주간보고 11.9~11.15 ⌄'), 누르면 펼침. 손으로 접고 편 것은 기억(BIZ-주간보고접힘기억 S56-13) — 기억이 없을 때만 주 단위 펼침·여러 주 접힘.
// - 표 칸은 따로 스크롤하는 칸이 아니다: 표 위에서 밀어도 화면 전체가 위아래로 움직이고, 화면 끝에서 표 끝이 아래 [목록|달력|사진]에 가리지 않는다.
// 서버는 가짜, 이름·글은 모두 합성 값. 시계 2026-11-09(월) 09:30(서울).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';
import {editCell,cellMenu,holdCell,cellAct} from './helpers/cell-menu.mjs';
import {reportPeriodSelect} from './helpers/report-week.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
import {openReportBoxes} from './helpers/report-boxes.mjs'; // S67-75: 폰 폭이면 고르기 상자는 칩이 여는 창 안

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
const label=page=>page.locator('#bizWeekBox .biz-week-nav .report-week-label');

for(const width of [390,884,1280])test(`${width}: 월요일에 열면 이번 주(0건)이고 주간보고 칸에 [쓰기] — 지난주는 읽기만, [전체 기간]은 이번 주 접힌 한 줄`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const box=await open(page,width);
  // ① 이번 주(오늘이 든 월~일), 보고 0건이어도 지난주로 가지 않는다.
  await expect(label(page)).toHaveText('11.9~11.15');
  await expect(page.locator('#reportCount .report-week-count')).toHaveText('0건');
  // ② 이번 주 주간보고: 펼친 칸, 칸마다 쓸 수 있음(WEEKLY-화면정돈 ② STD C10: 빈 칸은 '—', 우클릭·꾹 누르기 [수정]). BIZ-주간보고접기(11/09): 주 단위에서도 제목 줄이 접고 펴는 버튼(처음엔 펼침).
  await expect(box.locator('.biz-week-title [data-bw-fold]')).toHaveText('이번 주 주간 보고');
  await expect(box.locator('.biz-week-title [data-bw-fold]')).toHaveAttribute('aria-expanded','true');
  await expect(box.locator('.biz-sum-table')).toBeVisible();
  const write=box.locator('[data-bp-cell="progress"]').first();
  await expect(write).toHaveText('—');
  await editCell(page,write);
  await expect(box.locator('textarea[data-bp-field]')).toBeFocused();
  await box.locator('[data-bp-edit-cancel]').click();
  // ③ ‹ 지난주(전환 주 앞)는 그때 글을 읽기만.
  await page.locator('#bizWeekBox [data-report-week="prev"]').click();
  await expect(label(page)).toHaveText('11.2~11.8');
  await expect(box.locator('.biz-week-title [data-bw-fold]')).toHaveText('주간 보고');
  await expect(box.locator('[data-bp-status]')).toHaveText('옛 보고라 수정할 수 없어요.');
  await expect(box.locator('[data-bp-cell]')).toHaveCount(0);
  // ⑤⑥ [전체 기간]: 주간보고 칸은 이번 주, 접힌 한 줄. 누르면 펼침.
  const pick=reportPeriodSelect(page);
  await openReportBoxes(page);await pick.selectOption('all');
  const fold=box.locator('.biz-week-title [data-bw-fold]');
  await expect(fold).toHaveAttribute('aria-expanded','false');
  await expect(fold).toHaveText(/이번 주 주간 보고\s*11\.9~11\.15/);
  await expect(fold.locator('.kptu-chev')).toHaveCount(1);
  await expect(box.locator('[data-bw-body]')).toBeHidden();
  const titleBox=await fold.boundingBox();
  expect(titleBox.height).toBeLessThanOrEqual(36); // 한 줄
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded','true');
  await expect(box.locator('.biz-sum-table')).toBeVisible();
  await expect(box.locator('[data-bp-cell="progress"]').first()).toHaveText('—'); // 이번 주라 쓸 수 있는 칸(고칠 칸 표시)
  await fold.click();
  await expect(box.locator('[data-bw-body]')).toBeHidden();
  // S56-13 BIZ-주간보고접힘기억(요청함 11/10, 앞 규칙 '기간 보기를 바꾸면 잊음'을 바꿈): 손으로 접은 것은 기억해 주 단위로 돌아와도 접힌 채.
  await openReportBoxes(page);await pick.selectOption('week');
  await expect(label(page)).toHaveText('11.9~11.15');
  await expect(box.locator('.biz-week-title [data-bw-fold]')).toHaveAttribute('aria-expanded','false');
  await expect(box.locator('[data-bw-body]')).toBeHidden();
  // 손으로 펴면 그 값도 기억해 [전체 기간]으로 가도·다시 와도 펼친 채.
  await fold.click();await expect(fold).toHaveAttribute('aria-expanded','true');
  await expect(box.locator('.biz-week-title [data-bw-fold]')).toHaveText('이번 주 주간 보고');
  await expect(box.locator('.biz-sum-table')).toBeVisible();
  await openReportBoxes(page);await pick.selectOption('all');await expect(fold).toHaveAttribute('aria-expanded','true');
  await openReportBoxes(page);await pick.selectOption('week');await openReportBoxes(page);await pick.selectOption('all');
  await expect(box.locator('.biz-week-title [data-bw-fold]')).toHaveAttribute('aria-expanded','true');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=1)).toBe(true);
  expect(errors).toEqual([]);
});

test('390: 저장된 보기가 [전체 기간]이어도 열면 주간보고 칸은 이번 주 접힌 한 줄', async({page})=>{
  const box=await open(page,390,900,{report_period:{mode:'all'}});
  await expect(reportPeriodSelect(page)).toHaveValue('all');
  const fold=box.locator('.biz-week-title [data-bw-fold]');
  await expect(fold).toHaveAttribute('aria-expanded','false');
  await expect(fold).toHaveText(/이번 주 주간 보고\s*11\.9~11\.15/);
  await expect(box.locator('[data-bw-body]')).toBeHidden();
});

test.describe('터치 화면',()=>{
test.use({hasTouch:true});
for(const width of [390,884])test(`${width}: 표 위에서 밀어도 화면 전체가 위아래로 스크롤되고, 표 칸은 따로 스크롤하지 않는다`,async({page})=>{
  const box=await open(page,width,520);
  await expect(box.locator('.biz-sum-table')).toBeVisible();
  await expect(box.locator('[data-bp-cell="progress"]').first()).toBeVisible(); // 표 모양 자리가 아니라 다 그린 표
  // 표 칸은 스크롤 칸이 아니다(가로·세로 넘침 없음, 높이 제한 없음).
  const body=await box.locator('[data-bw-body]').evaluate(el=>{const cs=getComputedStyle(el);return {ox:cs.overflowX,oy:cs.overflowY,max:cs.maxHeight,extra:el.scrollHeight-el.clientHeight,wide:el.scrollWidth-el.clientWidth}});
  expect(body).toMatchObject({ox:'visible',oy:'visible',max:'none'});
  expect(body.wide).toBeLessThanOrEqual(1);
  // 폰 폭에 맞춰 줄바꿈하되 낱말은 글자 사이에서 꺾이지 않는다('사업영역' 머리·빈 칸 '—'이 한 줄).
  const lines=await box.locator('.biz-sum-table').evaluate(t=>{const n=el=>{const r=document.createRange();r.selectNodeContents(el);return new Set([...r.getClientRects()].map(x=>Math.round(x.top))).size};return {head:n(t.querySelector('thead th')),owner:n(t.querySelector('[data-bp-cell="owner"]')),progress:n(t.querySelector('[data-bp-cell="progress"]'))}});
  expect(lines.head).toBe(1);expect(lines.progress).toBe(1);expect(lines.owner).toBeLessThanOrEqual(1); // 빈 담당 칸은 글이 없다(전에는 [쓰기] 단추)
  // 표 위에서 손가락으로 위로 밀면(터치 스크롤) 화면이 내려간다.
  const t=await box.locator('.biz-sum-table tbody td').first().boundingBox();
  const cdp=await page.context().newCDPSession(page);
  const before=await page.evaluate(()=>scrollY),x=Math.round(t.x+t.width/2),y=Math.round(t.y+Math.min(t.height/2,20));
  const room=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight-scrollY);
  expect(room).toBeGreaterThan(10);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=15;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*10}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  // 칸 [쓰기] 단추가 없어져(WEEKLY-화면정돈 ② STD C10) 화면이 짧아질 수 있다 — 끝까지 50px이 안 남으면 끝까지 내려갔는지 본다.
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(before+Math.min(50,room-2));
  // 화면 끝까지 내리면 표 끝이 아래 탭에 가리지 않는다(UI-보기탭드롭다운 11/10: 아래 떠 있던 [목록|달력|사진] 줄은 없앰).
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
  const end=await box.locator('.biz-sum-table').evaluate(el=>el.getBoundingClientRect().bottom);
  const dock=await page.locator('.mobile-tabs').evaluate(el=>getComputedStyle(el).display!=='none'?el.getBoundingClientRect().top:Infinity);
  expect(end).toBeLessThanOrEqual(dock);
});
});
