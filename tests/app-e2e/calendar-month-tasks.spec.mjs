import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';
test.use({timezoneId:'Asia/Seoul'});
for(const width of [360,1280]){
  test(`month task counts and day route (${width}px)`,async({page})=>{
    await page.setViewportSize({width,height:844});
    await openEmphasisFixture(page);
    await expect(page.locator('#calendarGrid [data-calendar-task]')).toHaveCount(0);
    const badge=date=>page.locator(`.cal-cell[data-date="${date}"] .cmv-task-count`);
    await expect(badge('2026-10-20')).toHaveText('✓1');
    await expect(badge('2026-10-21')).toHaveText('✓17');
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
}

for(const width of [360,1280]){
  test(`schedule-only lanes, counts and nonoverlapping task target (${width}px)`,async({page})=>{
    await page.setViewportSize({width,height:844});
    const events=Array.from({length:24},(_,i)=>({id:'density-'+i,calendarId:'qa-cal',title:'QA schedule '+i,start:'2026-10-20',end:'2026-10-21',allDay:true,color:'#4285f4'}));
    await openEmphasisFixture(page,{events:[{...events[0],id:'blue-0'},...events.slice(1)]});
    const week=page.locator('.cmv-week').filter({has:page.locator('.cal-cell[data-date="2026-10-20"]')});
    await expect(week).toHaveAttribute('data-lane-count','24');
    const cap=Number(await week.getAttribute('data-lane-cap'));
    if(width<1024){await expect(week.locator('.kptu-day-more')).toHaveText('+'+(24-cap));}
    else await expect(week.locator('.kptu-day-more')).toHaveCount(0);
    // Mobile has one date-row target; desktop has an independent 44px task target.
    const marker=page.locator('.cal-cell[data-date="2026-10-10"] .cmv-task-count');
    const target=width<=760?marker.locator('..'):marker;
    await target.scrollIntoViewIfNeeded();
    const geometry=await target.evaluate(el=>{
      const r=el.getBoundingClientRect(),cell=el.closest('.cal-cell'),week=el.closest('.cmv-week'),c=cell.getBoundingClientRect();
      const others=[...week.querySelectorAll('.cmv-event,.kptu-day-more')];
      return {width:r.width,height:r.height,within:r.left>=c.left&&r.right<=c.right&&r.bottom<=c.bottom,
        overlaps:others.map(x=>{const b=x.getBoundingClientRect();return {name:x.className,overlap:r.left<b.right-.1&&r.right>b.left+.1&&r.top<b.bottom-.1&&r.bottom>b.top+.1}}),
        hit:el.contains(document.elementFromPoint(r.right-2,r.top+2))};
    });
    expect(geometry.height).toBe(44);expect(geometry.width).toBeGreaterThanOrEqual(44);
    expect(geometry.within).toBe(true);expect(geometry.overlaps.filter(x=>x.overlap)).toEqual([]);expect(geometry.hit).toBe(true);
    console.log('task target',width,JSON.stringify(geometry));
    if(width<1024){
      await week.locator('.kptu-day-more').click();
      await expect(page.locator('#calendarDayEvents .cal-event')).toHaveCount(24);
      await expect(page.locator('#calendarDayTasks .cal-event')).toHaveCount(2);
    }
    await page.evaluate(()=>KPTUCalendarMonthView.setTasks([{id:'done-only',title:'QA',date:'2026-10-20',done:true,overdue:true}]));
    await expect(page.locator('.cmv-task-count')).toHaveCount(0);
    await expect(week).toHaveAttribute('data-lane-count','24');
  });
}

test('supplied done and overdue flags control the marker across themes',async({page})=>{
  await page.setViewportSize({width:360,height:844});await openEmphasisFixture(page);
  await page.evaluate(()=>KPTUCalendarMonthView.setTasks([
    {id:'a',title:'QA',date:'2026-10-20',done:false,overdue:true},
    {id:'b',title:'QA',date:'2026-10-20',done:true,overdue:true},
    {id:'c',title:'QA',date:'2026-10-20',done:false,overdue:false}
  ]));
  const marker=page.locator('.cmv-task-count');
  await expect(marker).toHaveText('✓2');await expect(marker).toHaveAccessibleName('할 일 2개, 기한 지남 포함');
  for(const theme of ['olive','navy','terracotta','sand']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    expect(await marker.evaluate(el=>getComputedStyle(el).color)).toBe(await page.evaluate(()=>{
      const sample=document.createElement('span');sample.style.color='var(--kptu-danger)';document.body.append(sample);const color=getComputedStyle(sample).color;sample.remove();return color;
    }));
  }
  await page.evaluate(()=>KPTUCalendarMonthView.setTasks([{id:'c',title:'QA',date:'2026-10-20',done:false,overdue:false}]));
  await expect(marker).toHaveAccessibleName('할 일 1개');
  expect(await marker.evaluate(el=>getComputedStyle(el).color)).toBe(await page.evaluate(()=>{
    const sample=document.createElement('span');sample.style.color='var(--kptu-muted)';document.body.append(sample);const color=getComputedStyle(sample).color;sample.remove();return color;
  }));
});
