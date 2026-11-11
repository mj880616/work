import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
import {server,installServer} from './helpers/report-plan-marks-server.mjs';

// S58-4 BIZ-보고할일정 PR B(설계 docs/design/biz-report-plan-link.md 4-1 · 6절 B, 시안 docs/design/mockups/biz-report-plan-link.html ①).
// 일정 달력(월·주·목록·그날 창)과 홈 그날 일정 줄에서 보고할 일정 앞에 □, 그 일정에 이어 보고를 썼으면 ✓.
// ✓를 누르면 그 보고가 열리고, □를 누르면 그 일정이 채워진 사업 보고 쓰기 창이 열린다([결과 남기기]와 같은 길).
// 표시는 서버 값으로 그린다(새로 고쳐도 유지). 표·칸이 없는 서버(적용 전·되돌린 뒤)에서는 표시 없이 예전 그대로.
// 서버는 흉내(시험 쪽 메모리), 일정·이름은 모두 가짜다(helpers/report-plan-marks-server.mjs).
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
test.use({timezoneId:'Asia/Seoul'});
const sizeOf=width=>({width,height:width<=760?900:844});
async function open(page,state,{width=1280,view='month',target='calendar'}={}){
  await page.setViewportSize(sizeOf(width));
  await page.clock.setFixedTime(new Date('2026-11-10T00:00:00Z'));
  await installViewPrefsServer(page,{calendar_view:view});
  await installServer(page,state,{base:BASE});
  await page.goto(loginEntry(BASE+'/app/?view='+target));
  await signInWithSession(page,'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  return state;
}
const ROOT={month:'#calendarGrid',week:'#calendarWeek',list:'#calendarList',day:'#calendarDayList',home:'[data-journal-schedule]'};
const row=(page,where,id)=>page.locator(`${ROOT[where]} [data-google-event="${id}"]`).first();
const mark=(page,where,id)=>row(page,where,id).locator('.rp-mark');
// 표시 하나: 종류·읽기 이름·글자 없음(제목 글자는 그대로)·줄 안에 들어 있음.
async function expectMark(page,where,id,kind){
  const m=mark(page,where,id);
  await expect(m).toHaveCount(1);
  await expect(m).toHaveClass(new RegExp(`rp-mark-${kind}`));
  await expect(m).toHaveAttribute('aria-label',kind==='done'?'보고 씀':'보고할 일정');
  await expect(m).toHaveText('');
  // 달력은 일정·할 일을 받는 대로 다시 그린다 → 줄과 표시의 자리는 한 번에(같은 그림에서) 잰다.
  await expect.poll(()=>page.evaluate(([root,eventId])=>{
    const host=document.querySelector(`${root} [data-google-event="${eventId}"]`),m=host?.querySelector('.rp-mark');if(!host||!m)return 'none';
    const a=m.getBoundingClientRect(),b=host.getBoundingClientRect();
    if(a.width<=5||a.height<=5)return `small ${a.width}x${a.height}`;
    return a.left>=b.left-0.5&&a.right<=b.right+0.5&&a.top>=b.top-0.5&&a.bottom<=b.bottom+0.5?'inside':`outside ${[a.left,a.right,a.top,a.bottom,b.left,b.right,b.top,b.bottom].map(Math.round)}`;
  },[ROOT[where],id])).toBe('inside');
}
const noMark=(page,where,id)=>expect(mark(page,where,id)).toHaveCount(0);
// 홈 그날 일정 줄은 일정 id를 줄에 두지 않는다 → 제목으로 찾는다.
const homeRow=(page,title)=>page.locator('[data-journal-schedule] .journal-event').filter({hasText:title});
const detail=page=>page.locator('#meetingRoundDetailModal');
const kindSheet=page=>page.locator('#reportKindSheet');
async function expectWriteWindow(page,title){
  await expect(kindSheet(page)).toBeVisible();
  await kindSheet(page).locator('[data-sheet-value="press"]').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingTitle')).toHaveValue(title);
  // 일정 창은 거쳐 갈 뿐 남지 않는다([결과 남기기]와 같은 길).
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
}

for(const width of [412,1280])test(`${width} 월 보기: 보고 쓴 일정 ✓ · 보고할 일정 □(같은 이름 기억·종일·여러 날 띠 포함), 새로 고쳐도 유지, 할 일 네모와 다른 자리`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await open(page,server(),{width});
  await expect(row(page,'month','done1')).toBeVisible();
  const check=async()=>{
    await expectMark(page,'month','done1','done');   // 일정에 이어 쓴 보고가 있다
    await expectMark(page,'month','todo2','todo');   // 보고할 일정으로 켜 둠
    await expectMark(page,'month','todo1','todo');   // 같은 이름으로 보고를 쓴 적이 있다(줄 없이도)
    await expectMark(page,'month','day1','todo');    // 종일 일정
    await expectMark(page,'month','trip1','done');   // 여러 날 띠
    await noMark(page,'month','off1');               // 끔
    await noMark(page,'month','none1');              // 그냥 일정
    await noMark(page,'month','ref1');
  };
  await check();
  // 표시는 막대 맨 앞, 제목 글자는 그대로, 읽기 이름에 상태가 붙는다.
  expect(await row(page,'month','done1').evaluate(b=>b.firstElementChild.classList.contains('rp-mark'))).toBe(true);
  await expect(row(page,'month','done1').locator('.cmv-event-title')).toHaveText('주간 점검 회의');
  await expect(row(page,'month','done1')).toHaveAttribute('aria-label',/주간 점검 회의, 보고 씀$/);
  await expect(row(page,'month','todo2')).toHaveAttribute('aria-label',/분기 계획 모임, 보고할 일정$/);
  await expect(row(page,'month','off1')).toHaveAttribute('aria-label',/자료 정리$/);
  // 할 일의 네모(배경 없는 줄)와 일정의 □(색 막대 안): 다른 부품·다른 자리.
  const task=page.locator('#calendarGrid .cmv-cell-task').first();
  await expect(task).toBeVisible();
  await expect(task.locator('.rp-mark')).toHaveCount(0);
  const paint=await page.evaluate(()=>{
    const bg=el=>getComputedStyle(el).backgroundColor,clear=v=>v==='rgba(0, 0, 0, 0)'||v==='transparent';
    const bar=document.querySelector('#calendarGrid [data-google-event="todo2"]'),cellTask=document.querySelector('#calendarGrid .cmv-cell-task');
    return {barFilled:!clear(bg(bar)),taskFilled:!clear(bg(cellTask)),markColor:getComputedStyle(bar.querySelector('.rp-mark')).color,barColor:getComputedStyle(bar).color};
  });
  expect(paint.barFilled).toBe(true);expect(paint.taskFilled).toBe(false);
  expect(paint.markColor).toBe(paint.barColor);
  // 그리기만으로는 아무것도 저장하지 않는다.
  expect(state.planWrites).toHaveLength(0);
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(row(page,'month','done1')).toBeVisible();
  await check();
  expect(state.planWrites).toHaveLength(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

for(const width of [412,1280])test(`${width} 월 보기: □를 누르면 그 일정으로 보고 쓰기 창 → 저장하면 ✓ → ✓를 누르면 그 보고`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await open(page,server(),{width});
  await expectMark(page,'month','todo2','todo');
  await mark(page,'month','todo2').click();
  await expectWriteWindow(page,'분기 계획 모임');
  await page.locator('#meetingTranscript').fill('가짜 결과 내용');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  expect(state.reportPosts).toHaveLength(1);
  expect(state.reportPosts[0]).toMatchObject({workspace_id:'rp-ws',series_name:'분기 계획 모임',google_event_id:'todo2',google_calendar_id:'own'});
  // 보고를 쓰면 그 자리의 □가 ✓로 바뀐다(달력이 다시 그린다 — 새로 고침 없이).
  await expectMark(page,'month','todo2','done');
  await mark(page,'month','todo2').click();
  await expect(detail(page)).toBeVisible();
  await expect(detail(page)).toContainText('분기 계획 모임');
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  // 막대의 다른 곳을 누르면 예전처럼 일정 창.
  await page.keyboard.press('Escape');await expect(detail(page)).toBeHidden();
  await row(page,'month','todo2').locator('.cmv-event-title').click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  expect(errors).toEqual([]);
});

test('1280 주 보기: 시간표 칸·종일 띠에 ✓·□, 말풍선 글자는 그대로, ✓를 누르면 그 보고',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,server(),{width:1280,view:'week'});
  await expect(row(page,'week','done1')).toBeVisible();
  await expectMark(page,'week','done1','done');
  await expectMark(page,'week','todo2','todo');
  await expectMark(page,'week','day1','todo');   // 종일 띠(월 보기와 같은 부품)
  await noMark(page,'week','off1');
  await noMark(page,'week','none1');
  await expect(row(page,'week','done1').locator('.clv-title')).toHaveText('주간 점검 회의');
  await expect(row(page,'week','done1').locator('.cwv-tip')).toHaveText('10:00 주간 점검 회의');
  await mark(page,'week','done1').click();
  await expect(detail(page)).toBeVisible();
  await expect(detail(page)).toContainText('주간 점검 회의');
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  expect(errors).toEqual([]);
});

for(const width of [412,1280])test(`${width} 목록 보기: 줄 제목 앞 ✓·□, □를 누르면 그 일정으로 보고 쓰기 창`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await open(page,server(),{width,view:'list'});
  await expect(row(page,'list','done1')).toBeVisible();
  await expectMark(page,'list','done1','done');
  await expectMark(page,'list','todo2','todo');
  await expectMark(page,'list','day1','todo');
  await expectMark(page,'list','todo1','todo');
  await noMark(page,'list','off1');
  await noMark(page,'list','none1');
  await expect(row(page,'list','todo2').locator('.clv-title')).toHaveText('분기 계획 모임');
  // 같은 이름 기억으로 □가 된 일정(줄 없음)도 같은 길로 쓰기 창이 열린다.
  await mark(page,'list','todo1').click();
  await expectWriteWindow(page,'주간 점검 회의');
  expect(state.planWrites).toHaveLength(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

for(const width of [412,1280])test(`${width} 그날 창: 일정 줄에 ✓·□(할 일 줄에는 없음), ✓를 누르면 그날 창이 닫히고 그 보고, □는 쓰기 창`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,server(),{width});
  await expectMark(page,'month','done1','done');
  const dayModal=page.locator('#calendarDayModal');
  const openDay=async()=>{await page.locator('#calendarGrid .cmv-date-list[data-date="2026-11-10"]').click();await expect(dayModal).toBeVisible()};
  await expect(page.locator('#calendarGrid .cmv-cell-task').first()).toBeVisible();
  await openDay();
  await expectMark(page,'day','done1','done');
  await expectMark(page,'day','todo2','todo');
  await noMark(page,'day','off1');
  await expect(row(page,'day','done1').locator('.cmv-day-title')).toHaveText('주간 점검 회의');
  await expect(row(page,'day','done1')).toHaveAttribute('aria-label','10:00 주간 점검 회의, 보고 씀');
  await expect(page.locator('#calendarDayTasks .cal-event').first()).toBeVisible();
  await expect(page.locator('#calendarDayTasks .rp-mark')).toHaveCount(0);
  await mark(page,'day','done1').click();
  await expect(detail(page)).toBeVisible();
  await expect(detail(page)).toContainText('주간 점검 회의');
  await expect(dayModal).toBeHidden();
  await page.keyboard.press('Escape');await expect(detail(page)).toBeHidden();
  await openDay();
  await mark(page,'day','todo2').click();
  await expectWriteWindow(page,'분기 계획 모임');
  await expect(dayModal).toBeHidden();
  expect(errors).toEqual([]);
});

for(const width of [412,1280])test(`${width} 홈 그날 일정 줄: ✓·□, 누르면 보고 열기·쓰기 창, 줄을 누르면 예전처럼 일정 창`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await open(page,server(),{width,target:'home'});
  const done=homeRow(page,'주간 점검 회의'),todo=homeRow(page,'분기 계획 모임'),off=homeRow(page,'자료 정리');
  await expect(done).toBeVisible();
  await expect(done.locator('.rp-mark')).toHaveClass(/rp-mark-done/);
  await expect(todo.locator('.rp-mark')).toHaveClass(/rp-mark-todo/);
  await expect(off.locator('.rp-mark')).toHaveCount(0);
  await expect(done.locator('.journal-event-title')).toHaveText('주간 점검 회의');
  await expect(done.locator('button')).toHaveAttribute('aria-label','10:00 주간 점검 회의, 보고 씀 (일정 열기)');
  await expect(off.locator('button')).toHaveAttribute('aria-label','16:00 자료 정리 (일정 열기)');
  // 할 일 칸에는 표시가 없다.
  await expect(page.locator('[data-journal-tasks] .rp-mark')).toHaveCount(0);
  await done.locator('.rp-mark').click();
  await expect(detail(page)).toBeVisible();
  await expect(detail(page)).toContainText('주간 점검 회의');
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  await page.keyboard.press('Escape');await expect(detail(page)).toBeHidden();
  await todo.locator('.rp-mark').click();
  await expectWriteWindow(page,'분기 계획 모임');
  await page.locator('#meetingModal [data-close="meetingModal"]').first().click();
  await expect(page.locator('#meetingModal')).toBeHidden();
  // 표시가 아닌 곳(제목)을 누르면 예전처럼 그 일정 창.
  await off.locator('.journal-event-title').click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

for(const width of [412,1280])test(`${width} 표·칸이 없는 서버(적용 전·되돌린 뒤): 달력·그날 창·홈에 표시 없이 예전 그대로`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await open(page,server({store:false}),{width});
  await expect(row(page,'month','done1')).toBeVisible();
  await expect(page.locator('#calendarGrid .cmv-cell-task').first()).toBeVisible();
  // 읽기가 '없음'으로 끝난 뒤에도 표시가 없다.
  await expect.poll(()=>page.evaluate(()=>window.KPTUCalendarEvents?.planOf?.('todo2','own')??null)).toBe(null);
  await expect(page.locator('.rp-mark')).toHaveCount(0);
  await expect(row(page,'month','done1')).toHaveAttribute('aria-label',/주간 점검 회의$/);
  await page.locator('#calendarGrid .cmv-date-list[data-date="2026-11-10"]').click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(row(page,'day','done1')).toHaveAttribute('aria-label','10:00 주간 점검 회의');
  await expect(page.locator('.rp-mark')).toHaveCount(0);
  // 줄을 누르면 예전처럼 일정 창.
  await row(page,'day','done1').click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await page.locator('#ciGoogleClose').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();
  // 목록 보기·홈도 같다.
  await page.locator('[data-calendar-view="list"]').click();
  await expect(row(page,'list','done1')).toBeVisible();
  await expect(page.locator('.rp-mark')).toHaveCount(0);
  await page.goto(BASE+'/app/?view=home');
  await expect(homeRow(page,'주간 점검 회의')).toBeVisible();
  await expect(homeRow(page,'주간 점검 회의').locator('button')).toHaveAttribute('aria-label','10:00 주간 점검 회의 (일정 열기)');
  await expect(page.locator('.rp-mark')).toHaveCount(0);
  expect(state.planWrites).toHaveLength(0);
  expect(errors).toEqual([]);
});
