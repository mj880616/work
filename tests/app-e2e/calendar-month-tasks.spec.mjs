import {test,expect} from '@playwright/test';
import {THEMES} from './helpers/theme-list.mjs';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';
test.use({timezoneId:'Asia/Seoul'});
test('month task counts and day route (1280px)',async({page})=>{
  const width=1280;
  await page.setViewportSize({width,height:844});
  await openEmphasisFixture(page);
  await expect(page.locator('#calendarGrid [data-calendar-task]')).toHaveCount(0);
  const badge=date=>page.locator(`.cal-cell[data-date="${date}"] .cmv-task-count`);
  await expect(badge('2026-10-20')).toHaveText('1');
  await expect(badge('2026-10-21')).toHaveText('17');
  for(const date of ['2026-10-20','2026-10-21','2026-10-10']){await expect(badge(date).locator('svg')).toHaveCount(1);await expect(badge(date).locator('svg')).toHaveAttribute('aria-hidden','true');expect(await badge(date).locator('svg').evaluate(el=>getComputedStyle(el).stroke)).toBe(await badge(date).evaluate(el=>getComputedStyle(el).color));}
  await expect(badge('2026-10-20')).toHaveAccessibleName('할 일 1개');
  await expect(badge('2026-10-10')).toHaveAccessibleName('할 일 1개, 기한 지남 포함');
  await expect(badge('2026-10-10')).toHaveCSS('color','rgb(180, 35, 24)');
  await expect(badge('2026-10-20')).toHaveCSS('font-size','12px');
  await page.screenshot({path:`.qa-month-${width}.png`,fullPage:true});
  await badge('2026-10-20').click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayTasks [data-calendar-task]')).toHaveCount(2);
  await expect(page.locator('#eventModal')).toBeHidden();
});

// S48-6c(2026-11-02 명진 결정): 폰 월 보기는 ✓n 대신 기한이 그날인 할 일 제목을 칸 안 줄로 보인다. 일정 먼저·할 일 다음,
// 바탕색 없이 글자만(앞에 체크 네모), 완료한 할 일은 칸에 없음, 넘치면 일정과 합쳐 '+n', 밀어서 펼치면 다 보임, 누르면 할 일 상세.
test('phone cells show task titles after events, merge overflow into +n and open the task',async({page})=>{
  await page.setViewportSize({width:360,height:844});
  await openEmphasisFixture(page);
  await expect(page.locator('#calendarGrid .cmv-task-count')).toHaveCount(0);
  const cellTask=id=>page.locator(`#calendarGrid .cmv-cell-task[data-calendar-task="${id}"]`);
  // 10/20: 일정 1(파란 일정 시험 1) + 미완료 할 일 1. 완료 할 일은 칸에 없다.
  await expect(cellTask('pending')).toBeVisible();
  await expect(cellTask('pending')).toHaveText('미완료 시험 항목');
  await expect(cellTask('pending')).toHaveAccessibleName('할 일: 미완료 시험 항목');
  await expect(cellTask('done')).toHaveCount(0);
  const order=await cellTask('pending').evaluate(el=>{
    const event=el.parentElement.querySelector('[data-google-event="blue-0"]');
    const t=el.getBoundingClientRect(),e=event.getBoundingClientRect(),cs=getComputedStyle(el),box=el.querySelector('.cmv-cell-task-box');
    return {below:t.top>=e.bottom-.5,sameCol:Math.abs(t.left-e.left)<3,bg:cs.backgroundColor,box:!!box&&box.getBoundingClientRect().width>0,font:cs.fontSize,height:t.height};
  });
  expect(order.below).toBe(true);expect(order.sameCol).toBe(true);
  expect(order.bg).toBe('rgba(0, 0, 0, 0)');expect(order.box).toBe(true);expect(order.font).toBe('11px');expect(order.height).toBe(14);
  // 기한 지난 할 일은 경고색 글자.
  await expect(cellTask('overdue')).toHaveCSS('color','rgb(180, 35, 24)');
  // 10/21: 일정 1 + 할 일 17 → 칸에 들어가는 만큼만 보이고 나머지는 '+n'에 합산.
  const week=page.locator('.cmv-week').filter({has:page.locator('.cal-cell[data-date="2026-10-21"]')});
  const slots=Number(await page.locator('#calendarGrid').getAttribute('data-cmv-lane-slots'));
  const shown21=await week.locator('.cmv-cell-task').evaluateAll(els=>els.filter(el=>el.style.gridColumnStart==='4').length);
  expect(shown21).toBe(slots-2);
  const more=week.locator('.kptu-day-more[data-date="2026-10-21"]');
  await expect(more).toHaveText('+'+(18-(slots-1)));
  await expect(page.locator('#calendarGrid')).toHaveAttribute('data-cmv-expandable','1');
  // 펼치면 그날 할 일 17개 제목이 모두 칸 안에 보인다.
  await page.evaluate(()=>KPTUCalendarMonthView.setExpanded(true));
  await expect(page.locator('#calendarGrid')).toHaveAttribute('data-cmv-expanded','1');
  await expect(week.locator('.kptu-day-more')).toHaveCount(0);
  const all21=await week.locator('.cmv-cell-task').evaluateAll(els=>els.filter(el=>el.style.gridColumnStart==='4').map(el=>{const r=el.getBoundingClientRect(),w=el.closest('.cmv-week').getBoundingClientRect();return r.height>0&&r.bottom<=w.bottom+.5}));
  expect(all21).toEqual(Array(17).fill(true));
  await page.evaluate(()=>KPTUCalendarMonthView.setExpanded(false));
  await expect(page.locator('#calendarGrid')).toHaveAttribute('data-cmv-expanded','0');
  // '+n'은 그날 목록(일정 1 + 할 일 18, 완료 포함)을 연다.
  await week.locator('.kptu-day-more[data-date="2026-10-21"]').click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayTasks [data-calendar-task]')).toHaveCount(18);
  await page.locator('[data-close="calendarDayModal"]').click();
  await expect(page.locator('#calendarDayModal')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBeUndefined();
  // 할 일 줄을 누르면 그 할 일 상세 창(기존 할 일 편집 창)이 열리고 날짜 목록·새 일정 창은 열리지 않는다.
  await cellTask('pending').click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#calendarDayModal')).toBeHidden();
  await expect(page.locator('#eventModal')).toBeHidden();
});

for(const width of [360,1280]){
  test(`schedule-only lanes, counts and nonoverlapping task target (${width}px)`,async({page})=>{
    await page.setViewportSize({width,height:844});
    const events=Array.from({length:24},(_,i)=>({id:'density-'+i,calendarId:'qa-cal',title:'QA schedule '+i,start:'2026-10-20',end:'2026-10-21',allDay:true,color:'#4285f4'}));
    await openEmphasisFixture(page,{events:[{...events[0],id:'blue-0'},...events.slice(1)]});
    const week=page.locator('.cmv-week').filter({has:page.locator('.cal-cell[data-date="2026-10-20"]')});
    // S48-6c: 폰은 할 일도 칸 안 줄이라 10/20의 미완료 할 일 1이 일정 24 아래 한 줄을 더한다.
    await expect(week).toHaveAttribute('data-lane-count',width<761?'25':'24');
    const cap=Number(await week.getAttribute('data-lane-cap'));
    if(width<761){await expect(week.locator('.kptu-day-more[data-date="2026-10-20"]')).toHaveText('+'+(25-cap));}
    else await expect(week.locator('.kptu-day-more')).toHaveCount(0);
    // Mobile has one date-row target; desktop has an independent 44px task target.
    const target=width<=760?page.locator('.cmv-date-list[data-date="2026-10-10"]'):page.locator('.cal-cell[data-date="2026-10-10"] .cmv-task-count');
    await target.scrollIntoViewIfNeeded();
    const geometry=await target.evaluate(el=>{
      const r=el.getBoundingClientRect(),cell=el.closest('.cal-cell'),week=el.closest('.cmv-week'),c=cell.getBoundingClientRect();
      const others=[...week.querySelectorAll('.cmv-event,.kptu-day-more')];
      return {width:r.width,height:r.height,within:r.left>=c.left&&r.right<=c.right&&r.bottom<=c.bottom,
        overlaps:others.map(x=>{const b=x.getBoundingClientRect();return {name:x.className,overlap:r.left<b.right-.1&&r.right>b.left+.1&&r.top<b.bottom-.1&&r.bottom>b.top+.1}}),
        hit:el.contains(document.elementFromPoint(r.right-2,r.top+2))};
    });
    expect(geometry.height).toBe(width<=760?20:44);expect(geometry.width).toBeGreaterThanOrEqual(44); // S46-23: 폰 날짜 줄 20px(누르는 범위 ::after 44px)
    if(width<=760)expect(await target.evaluate(el=>parseFloat(getComputedStyle(el,'::after').height))).toBe(44);
    expect(geometry.within).toBe(true);expect(geometry.overlaps.filter(x=>x.overlap)).toEqual([]);expect(geometry.hit).toBe(true);
    console.log('task target',width,JSON.stringify(geometry));
    if(width<761){
      await week.locator('.kptu-day-more[data-date="2026-10-20"]').click();
      await expect(page.locator('#calendarDayEvents .cal-event')).toHaveCount(24);
      await expect(page.locator('#calendarDayTasks .cal-event')).toHaveCount(2);
    }
    await page.evaluate(()=>KPTUCalendarMonthView.setTasks([{id:'done-only',title:'QA',date:'2026-10-20',done:true,overdue:true}]));
    await expect(page.locator('.cmv-task-count,.cmv-cell-task')).toHaveCount(0);
    await expect(week).toHaveAttribute('data-lane-count','24');
  });
}

test('supplied done and overdue flags control the phone task lines across themes',async({page})=>{
  await page.setViewportSize({width:360,height:844});await openEmphasisFixture(page);
  await page.evaluate(()=>KPTUCalendarMonthView.setTasks([
    {id:'a',title:'QA',date:'2026-10-20',done:false,overdue:true},
    {id:'b',title:'QA',date:'2026-10-20',done:true,overdue:true},
    {id:'c',title:'QA',date:'2026-10-20',done:false,overdue:false}
  ]));
  const lines=page.locator('#calendarGrid .cmv-cell-task');
  await expect(lines).toHaveCount(2);
  await expect(page.locator('#calendarGrid .cmv-cell-task[data-calendar-task="b"]')).toHaveCount(0);
  const late=page.locator('#calendarGrid .cmv-cell-task[data-calendar-task="a"]'),plain=page.locator('#calendarGrid .cmv-cell-task[data-calendar-task="c"]');
  await expect(late).toHaveAccessibleName('할 일: QA, 기한 지남');
  const colorOf=v=>page.evaluate(v=>{const sample=document.createElement('span');sample.style.color=`var(${v})`;document.body.append(sample);const color=getComputedStyle(sample).color;sample.remove();return color},v);
  for(const theme of THEMES){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    expect(await late.evaluate(el=>getComputedStyle(el).color)).toBe(await colorOf('--kptu-danger'));
    expect(await plain.evaluate(el=>getComputedStyle(el).color)).toBe(await colorOf('--kptu-ink'));
  }
});
