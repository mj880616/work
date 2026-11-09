// BIZ-주간칸밀림(사용자 결정 11/09 10:27): 사업 보고를 열 때 위 '이번 주 주간보고' 칸이 늦게 커져 아래 목록이 한꺼번에 밀려 내려가지 않는다.
// - 칸은 표가 그려지기 전에도 표 모양 자리(기다림 회색 줄)를 처음부터 차지한다. 접힌 한 줄(전체 기간)은 한 줄 그대로라 밀림 없음.
// - 위치는 화면 그리기 때마다(requestAnimationFrame) 아래 목록(#meetingList)의 위쪽 y를 적어 두고, 표가 다 그려진 뒤 evaluate 한 번으로 같은 순간에 읽어 처음 보인 y와 비교한다(대기 늘리기·재시도 없음).
// 서버는 가짜, 이름·글은 모두 합성 값. 시계 2026-11-09(월) 09:30(서울).
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',NOW='2026-11-09T00:30:00Z',MAX_SHIFT=24,MAX_STRUCT=8;

async function open(page,width,prefs=null){
  await page.setViewportSize({width,height:900});
  if(prefs)await installViewPrefsServer(page,prefs);
  await page.clock.setFixedTime(new Date(NOW));
  await mockApp(page,baseState());
  await page.route(`${SB}/rest/v1/app_weekly_exec_requests**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await installBusinessNowServer(page,{});
  // 주간보고 칸이 보이고 아래 목록이 자리 잡은 첫 그림의 y와, 그 뒤 y가 바뀐 모든 순간을 적는다.
  await page.addInitScript(()=>{
    window.__ys=[];
    const tick=()=>{const list=document.querySelector('#meetingList'),box=document.querySelector('#bizWeekBox');
      if(list&&box&&!box.hidden&&list.offsetParent){const y=Math.round(list.getBoundingClientRect().top+scrollY),L=window.__ys;if(!L.length||L.at(-1)!==y)L.push(y)}
      requestAnimationFrame(tick)};
    requestAnimationFrame(tick);
  });
  await signIn(page,testOrigin+'/app/?view=reports');
  await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
}

for(const width of [390,884,1440])test(`${width}: 이번 주 주간보고 표가 다 그려져도 아래 목록 위치가 거의 변하지 않는다`,async({page})=>{
  await open(page,width);
  await expect(page.locator('#bizWeekBox .biz-sum-table')).toBeVisible();
  // 표 모양 자리가 맞추는 것은 구조(머리글·제목·줄 수·누름 자리 50px)다. 칸 안 글(사업영역·세부 과제 이름)이 폰 폭에서 줄바꿈해 진짜 줄이 50px보다 높아진 만큼은 자료를 읽기 전에는 알 수 없으므로 밀림에서 뺀다(그 외 밀림은 8px 이하).
  const r=await page.evaluate(()=>({first:window.__ys[0],now:Math.round(document.querySelector('#meetingList').getBoundingClientRect().top+scrollY),all:window.__ys,wrap:[...document.querySelectorAll('#bizWeekBox .biz-sum-table tbody tr')].reduce((n,tr)=>n+Math.max(0,Math.round(tr.getBoundingClientRect().height)-50),0)}));
  expect(Math.abs(r.now-r.first-r.wrap),`목록 y 변화 ${JSON.stringify(r.all)}, 칸 글 줄바꿈으로 늘어난 높이 ${r.wrap}`).toBeLessThanOrEqual(MAX_STRUCT);
  expect(r.all.length).toBeLessThanOrEqual(2);
});

for(const width of [390,884,1440])test(`${width}: 전체 기간(접힌 한 줄)이면 한 줄 그대로라 밀림이 없다`,async({page})=>{
  await open(page,width,{report_period:{mode:'all'}});
  const fold=page.locator('#bizWeekBox .biz-week-title [data-bw-fold]');
  await expect(fold).toHaveAttribute('aria-expanded','false');
  const r=await page.evaluate(()=>({first:window.__ys[0],now:Math.round(document.querySelector('#meetingList').getBoundingClientRect().top+scrollY),all:window.__ys,h:Math.round(document.querySelector('#bizWeekBox').getBoundingClientRect().height)}));
  expect(Math.abs(r.now-r.first),`목록 y 변화 ${JSON.stringify(r.all)}`).toBeLessThanOrEqual(MAX_SHIFT);
  expect(r.h).toBeLessThanOrEqual(48); // 접힌 한 줄 높이
});
