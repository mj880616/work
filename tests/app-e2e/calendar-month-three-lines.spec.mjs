import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';
test.use({timezoneId:'Asia/Seoul'});
const date='2026-10-20';
async function renderFour(page,count=4,withTasks=true){
  await page.evaluate(({count,withTasks})=>{
    KPTUCalendarMonthView.setTasks(withTasks?[
      {id:'pending',title:'QA',date:'2026-10-20',done:false},
      {id:'late',title:'QA',date:'2026-10-23',done:false,overdue:true},
      {id:'done',title:'QA',date:'2026-10-24',done:true,overdue:true}
    ]:[]);
    KPTUCalendarMonthView.render({year:2026,month:9,googleEvents:Array.from({length:count},(_,i)=>({
      id:'four-'+i,calendarId:'qa-cal',title:'QA schedule '+i,start:'2026-10-20',end:'2026-10-21',allDay:true
    }))});
  },{count,withTasks});
}
for(const [width,height] of [[360,640],[360,844],[390,640],[390,844],[686,820]]){
  test(`available schedules, overflow and task lines merged into +n (${width}x${height})`,async({page})=>{
    await page.setViewportSize({width,height});
    const {external}=await openEmphasisFixture(page);await renderFour(page,20);
    const cell=page.locator(`.cal-cell[data-date="${date}"]`),week=page.locator('.cmv-week').filter({has:cell});
    const number=cell.locator('.cmv-date-list');
    const slots=Number(await page.locator('#calendarGrid').getAttribute('data-cmv-lane-slots'));
    expect(slots).toBeGreaterThanOrEqual(4);
    await expect(week.locator('.cmv-event')).toHaveCount(slots-1);
    // S48-6c: 폰은 ✓n 대신 칸 안 할 일 줄. 10/20은 일정 20 + 할 일 1이라 할 일은 '+n'에 합산된다.
    await expect(week.locator('.kptu-day-more')).toHaveText('+'+(21-slots+1));
    await expect(page.locator('#calendarGrid .cmv-task-count')).toHaveCount(0);
    await expect(week.locator('.cmv-cell-task[data-calendar-task="pending"]')).toHaveCount(0);
    await expect(page.locator('#calendarGrid button button')).toHaveCount(0);
    await expect(page.locator('.cmv-footer-more,.cmv-footer-both')).toHaveCount(0);
    const metrics=await cell.evaluate(el=>{
      const w=el.closest('.cmv-week'),wb=w.getBoundingClientRect(),number=el.querySelector('.cmv-date-list'),nb=number.getBoundingClientRect();
      const bars=[...w.querySelectorAll('.cmv-event')].map(b=>({box:b.getBoundingClientRect(),font:getComputedStyle(b).fontSize,line:getComputedStyle(b).lineHeight}));
      const more=w.querySelector('.kptu-day-more').getBoundingClientRect();
      return {week:wb.height,slots:Number(document.querySelector("#calendarGrid").dataset.cmvLaneSlots),numberWidth:nb.width,numberHeight:nb.height,moreWidth:more.width,moreHeight:more.height,
        barsFit:bars.every(b=>b.box.top>=nb.bottom&&b.box.bottom<=more.top&&b.box.bottom<=wb.bottom),
        font:bars.map(b=>b.font),line:bars.map(b=>b.line),moreFits:more.bottom<=wb.bottom,
        scroll:document.documentElement.scrollWidth,viewport:innerWidth};
    });
    console.log('three lines',width,height,JSON.stringify(metrics));
    expect(metrics.numberWidth).toBeGreaterThanOrEqual(44);expect(metrics.numberHeight).toBe(20); // S46-23: 날짜 바로 아래 일정(누르는 범위는 ::after 44px)
    expect(await number.evaluate(el=>parseFloat(getComputedStyle(el,'::after').height))).toBe(44);
    expect(metrics.moreWidth).toBeGreaterThanOrEqual(44);expect(metrics.moreHeight).toBe(16);
    expect(metrics.barsFit).toBe(true);expect(metrics.moreFits).toBe(true);
    expect(metrics.font).toEqual(Array(slots-1).fill('11px'));expect(metrics.line).toEqual(Array(slots-1).fill('14px')); // S48-6: 폰 칸 글자 11px·막대 14px
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.viewport);
    const only=page.locator('.cal-cell[data-date="2026-10-23"]');
    const late=week.locator('.cmv-cell-task[data-calendar-task="late"]');
    await expect(late).toBeVisible();await expect(late).toHaveText('QA');
    await expect(late).toHaveCSS('color','rgb(180, 35, 24)');
    await expect(week.locator('.cmv-cell-task[data-calendar-task="done"]')).toHaveCount(0);
    await number.click();await expect(page.locator('#calendarDayModal')).toBeVisible();
    await expect(page.locator('#calendarDayEvents .cal-event')).toHaveCount(20);
    await expect(page.locator('#calendarDayTasks .cal-event')).toHaveCount(1);
    await expect(page.locator('#eventModal')).toBeHidden();
    await page.locator('[data-close="calendarDayModal"]').click();
    await expect(page.locator('#calendarDayModal')).toBeHidden();
    await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBeUndefined();
    await only.locator('.cmv-date-list').click();
    await expect(page.locator('#calendarDayModal')).toBeVisible();
    await expect(page.locator('#calendarDayEvents .cal-event')).toHaveCount(0);
    await expect(page.locator('#calendarDayTasks .cal-event')).toHaveCount(1);
    expect(external).toEqual([]);
  });
}
for(const width of [761,884,1280]){
  // S49-6: PC도 칸 위쪽(날짜 숫자·줄 사이)은 그 날 창, 아래 빈 곳은 일정 추가. 할 일은 ✓1 대신 칸 안 제목 줄.
  test(`desktop cell bottom creates and the top opens the day (${width}px)`,async({page})=>{
    await page.setViewportSize({width,height:844});await openEmphasisFixture(page);await renderFour(page);
    const cell=page.locator(`.cal-cell[data-date="${date}"]`);
    await expect(cell.locator('.cmv-task-count')).toHaveCount(0);
    await expect(page.locator('#calendarGrid .cmv-task-count')).toHaveCount(0);
    await cell.locator('.cmv-date-create').click();await expect(page.locator('#eventModal')).toBeVisible();
    await expect(page.locator('#eventStartDate')).toHaveValue(date);
    await page.locator('[data-close="eventModal"]').click();await expect(page.locator('#eventModal')).toBeHidden();
    await cell.locator('.cal-day').click();await expect(page.locator('#calendarDayModal')).toBeVisible();
    await expect(page.locator('#calendarDayEvents .cal-event')).toHaveCount(4);
    await expect(page.locator('#calendarDayTasks .cal-event')).toHaveCount(1);
    await expect(page.locator('#eventModal')).toBeHidden();
  });
}

test('phone fills each date even when a continuing event began in the fourth weekly lane',async({page})=>{
  await page.setViewportSize({width:390,height:640});await openEmphasisFixture(page);
  await page.evaluate(()=>{
    KPTUCalendarMonthView.setTasks([]);
    KPTUCalendarMonthView.render({year:2026,month:9,googleEvents:[21,22,23,25].map((end,i)=>({
      id:'span-'+i,calendarId:'qa-cal',title:String.fromCharCode(65+i),start:'2026-10-18',end:'2026-10-'+end,allDay:true
    }))});
  });
  const week=page.locator('.cmv-week').filter({has:page.locator('.cal-cell[data-date="2026-10-18"]')});
  const counts=await week.evaluate(el=>Array.from({length:7},(_,col)=>({
    bars:[...el.querySelectorAll('.cmv-event')].filter(b=>{const start=Number(b.style.gridColumnStart)-1,span=Number(b.style.gridColumnEnd.replace('span ',''));return col>=start&&col<start+span}).length,
    more:el.querySelector(`.kptu-day-more[data-date="2026-10-${18+col}"]`)?.textContent||null
  })));
  expect(counts).toEqual([{bars:4,more:null},{bars:4,more:null},{bars:4,more:null},{bars:3,more:null},{bars:2,more:null},{bars:1,more:null},{bars:1,more:null}]);
  await expect(week.locator('[data-google-event="span-3"]')).not.toHaveCount(0);
});

for(const width of [360,390]){
  test(`all month overflow uses one readable 12px style with and without tasks (${width}px)`,async({page})=>{
    await page.setViewportSize({width,height:640});await openEmphasisFixture(page);
    await page.evaluate(()=>{
      KPTUCalendarMonthView.setTasks([{id:'p',title:'QA',date:'2026-10-20',done:false}]);
      KPTUCalendarMonthView.render({year:2026,month:9,googleEvents:['2026-10-13','2026-10-20'].flatMap((date,j)=>Array.from({length:12},(_,i)=>({
        id:`font-${j}-${i}`,calendarId:'qa-cal',title:'QA',start:date,end:date,allDay:true
      })))});
    });
    // S48-6c: 폰은 할 일도 칸 안 줄이라 10/20의 '+n'에 할 일 1이 더해진다.
    await expect(page.locator('#calendarGrid .cmv-task-count')).toHaveCount(0);
    const linkColor=await page.evaluate(()=>{const el=document.createElement('span');el.style.color='var(--kptu-link)';document.body.append(el);const color=getComputedStyle(el).color;el.remove();return color});
    const markers=page.locator('.cmv-week-events .kptu-day-more');await expect(markers).toHaveCount(2);
    for(const more of await markers.all()){
      await more.scrollIntoViewIfNeeded();
      const slots=Number(await page.locator('#calendarGrid').getAttribute('data-cmv-lane-slots'));
      const extra=(await more.getAttribute('data-date'))==='2026-10-20'?1:0;
      await expect(more).toHaveText('+'+(12+extra-slots+1));await expect(more).toHaveCSS('font-size','12px');
      await expect(more).toHaveCSS('font-weight','800');await expect(more).toHaveCSS('color',linkColor);
      const geometry=await more.evaluate(el=>{
        const box=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const text=range.getBoundingClientRect();
        return {line:parseFloat(getComputedStyle(el).lineHeight),fits:text.left>=box.left&&text.right<=box.right&&text.top>=box.top&&text.bottom<=box.bottom,
          hit:el.contains(document.elementFromPoint(box.x+box.width/2,box.bottom-1))};
      });
      expect(geometry.line).toBeGreaterThanOrEqual(16);expect(geometry.fits).toBe(true);expect(geometry.hit).toBe(true);
    }
    expect(await markers.evaluateAll(es=>es.map(el=>getComputedStyle(el).fontSize))).toEqual(['12px','12px']);
  });
}

for(const [width,height] of [[360,640],[390,844],[686,820]]){
  test(`phone uses all slots before reserving overflow (${width}x${height})`,async({page})=>{
    await page.setViewportSize({width,height});await openEmphasisFixture(page);await renderFour(page,5,false); // 일정 줄 수만 보는 시험(폰 칸 할 일 줄은 calendar-month-tasks)
    const slots=Number(await page.locator('#calendarGrid').getAttribute('data-cmv-lane-slots'));
    const week=page.locator('.cmv-week').filter({has:page.locator(`.cal-cell[data-date="${date}"]`)});
    await expect(week.locator('.cmv-event')).toHaveCount(5<=slots?5:slots-1);
    await expect(week.locator('.kptu-day-more')).toHaveCount(5<=slots?0:1);
    if(width===390){expect(slots).toBeGreaterThanOrEqual(5);await expect(week.locator('.cmv-event')).toHaveCount(5)}
    if(height===640){expect(slots).toBe(4);expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeGreaterThan(height)}
    // One busier day must not remove the last available event from this date.
    await page.evaluate(({date,slots})=>KPTUCalendarMonthView.render({year:2026,month:9,googleEvents:[date,'2026-10-21'].flatMap((d,j)=>Array.from({length:j?slots+3:slots},(_,i)=>({id:`capacity-${j}-${i}`,calendarId:'qa-cal',title:'QA',start:d,end:d,allDay:true})))}),{date,slots});
    await expect(week.locator('[data-google-event^="capacity-0-"]')).toHaveCount(slots);
    await expect(week.locator(`.kptu-day-more[data-date="${date}"]`)).toHaveCount(0);
    const more=week.locator('.kptu-day-more[data-date="2026-10-21"]');await expect(more).toHaveText('+4');
    await more.scrollIntoViewIfNeeded();await more.click();await expect(page.locator('#calendarDayEvents .cal-event')).toHaveCount(slots+3);
    await page.locator('[data-close="calendarDayModal"]').click();await expect(page.locator('#calendarDayModal')).toBeHidden();
    await page.locator(`.cal-cell[data-date="${date}"] .cmv-date-list`).click();await expect(page.locator('#calendarDayEvents .cal-event')).toHaveCount(slots);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
