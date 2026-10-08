import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';
test.use({timezoneId:'Asia/Seoul'});
const date='2026-10-20';
async function renderFour(page){
  await page.evaluate(()=>{
    KPTUCalendarMonthView.setTasks([
      {id:'pending',title:'QA',date:'2026-10-20',done:false},
      {id:'late',title:'QA',date:'2026-10-23',done:false,overdue:true},
      {id:'done',title:'QA',date:'2026-10-24',done:true,overdue:true}
    ]);
    KPTUCalendarMonthView.render({year:2026,month:9,googleEvents:Array.from({length:4},(_,i)=>({
      id:'four-'+i,calendarId:'qa-cal',title:'QA schedule '+i,start:'2026-10-20',end:'2026-10-21',allDay:true
    }))});
  });
}
for(const [width,height] of [[360,640],[360,844],[390,640],[390,844],[686,820]]){
  test(`three schedules, +1 and inline ✓1 (${width}x${height})`,async({page})=>{
    await page.setViewportSize({width,height});
    const {external}=await openEmphasisFixture(page);await renderFour(page);
    const cell=page.locator(`.cal-cell[data-date="${date}"]`),week=page.locator('.cmv-week').filter({has:cell});
    const number=cell.locator('.cmv-date-list'),marker=number.locator('.cmv-task-count');
    await expect(week.locator('.cmv-event')).toHaveCount(3);
    await expect(week.locator('.kptu-day-more')).toHaveText('+1');
    await expect(marker).toHaveText('✓1');await expect(marker).toHaveAccessibleName('할 일 1개');
    await expect(marker).toHaveCSS('font-size','12px');expect(await marker.evaluate(el=>getComputedStyle(el).color)).toBe(await page.evaluate(()=>{const el=document.createElement('span');el.style.color='var(--kptu-muted)';document.body.append(el);const color=getComputedStyle(el).color;el.remove();return color}));
    await expect(cell.locator('button.cmv-task-count')).toHaveCount(0);
    await expect(page.locator('#calendarGrid button button')).toHaveCount(0);
    await expect(page.locator('.cmv-footer-more,.cmv-footer-both')).toHaveCount(0);
    const metrics=await cell.evaluate(el=>{
      const w=el.closest('.cmv-week'),wb=w.getBoundingClientRect(),number=el.querySelector('.cmv-date-list'),nb=number.getBoundingClientRect();
      const bars=[...w.querySelectorAll('.cmv-event')].map(b=>({box:b.getBoundingClientRect(),font:getComputedStyle(b).fontSize,line:getComputedStyle(b).lineHeight}));
      const more=w.querySelector('.kptu-day-more').getBoundingClientRect(),marker=el.querySelector('.cmv-task-count').getBoundingClientRect(),day=el.querySelector('.cal-day').getBoundingClientRect();
      return {week:wb.height,numberWidth:nb.width,numberHeight:nb.height,moreWidth:more.width,moreHeight:more.height,
        barsFit:bars.every(b=>b.box.top>=nb.bottom&&b.box.bottom<=more.top&&b.box.bottom<=wb.bottom),
        font:bars.map(b=>b.font),line:bars.map(b=>b.line),moreFits:more.bottom<=wb.bottom,
        markerRight:marker.right<=nb.right&&marker.left>=day.right,scroll:document.documentElement.scrollWidth,viewport:innerWidth};
    });
    console.log('three lines',width,height,JSON.stringify(metrics));
    expect(metrics.numberWidth).toBeGreaterThanOrEqual(44);expect(metrics.numberHeight).toBe(44);
    expect(metrics.moreWidth).toBeGreaterThanOrEqual(44);expect(metrics.moreHeight).toBe(44);
    expect(metrics.barsFit).toBe(true);expect(metrics.moreFits).toBe(true);expect(metrics.markerRight).toBe(true);
    expect(metrics.font).toEqual(['8px','8px','8px']);expect(metrics.line).toEqual(['13px','13px','13px']);
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.viewport);
    const only=page.locator('.cal-cell[data-date="2026-10-23"]');
    await expect(only.locator('.cmv-task-count')).toHaveText('✓1');
    await expect(only.locator('.cmv-task-count')).toHaveCSS('color','rgb(180, 35, 24)');
    await expect(page.locator('.cal-cell[data-date="2026-10-24"] .cmv-task-count')).toHaveCount(0);
    await number.click();await expect(page.locator('#calendarDayModal')).toBeVisible();
    await expect(page.locator('#calendarDayEvents .cal-event')).toHaveCount(4);
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
  test(`desktop cell creates and ✓1 opens the day (${width}px)`,async({page})=>{
    await page.setViewportSize({width,height:844});await openEmphasisFixture(page);await renderFour(page);
    const cell=page.locator(`.cal-cell[data-date="${date}"]`),marker=cell.locator('button.cmv-task-count');
    await expect(marker).toHaveText('✓1');await expect(marker).toHaveAccessibleName('할 일 1개');
    const box=await marker.boundingBox();expect(box.width).toBe(44);expect(box.height).toBe(44);
    await cell.locator('.cal-day').click();await expect(page.locator('#eventModal')).toBeVisible();
    await expect(page.locator('#eventStartDate')).toHaveValue(date);
    await page.locator('[data-close="eventModal"]').click();await expect(page.locator('#eventModal')).toBeHidden();
    await marker.click();await expect(page.locator('#calendarDayModal')).toBeVisible();
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
  expect(counts).toEqual([{bars:3,more:'+1'},{bars:3,more:'+1'},{bars:3,more:'+1'},{bars:3,more:null},{bars:2,more:null},{bars:1,more:null},{bars:1,more:null}]);
  await expect(week.locator('[data-google-event="span-3"]')).not.toHaveCount(0);
});

for(const width of [360,390]){
  test(`all month overflow uses one readable 12px style with and without tasks (${width}px)`,async({page})=>{
    await page.setViewportSize({width,height:640});await openEmphasisFixture(page);
    await page.evaluate(()=>{
      KPTUCalendarMonthView.setTasks([{id:'p',title:'QA',date:'2026-10-20',done:false}]);
      KPTUCalendarMonthView.render({year:2026,month:9,googleEvents:['2026-10-13','2026-10-20'].flatMap((date,j)=>Array.from({length:4},(_,i)=>({
        id:`font-${j}-${i}`,calendarId:'qa-cal',title:'QA',start:date,end:date,allDay:true
      })))});
    });
    await expect(page.locator('.cmv-week').filter({has:page.locator('.cal-cell[data-date="2026-10-13"]')}).locator('.cmv-task-count')).toHaveCount(0);
    await expect(page.locator('.cmv-week').filter({has:page.locator('.cal-cell[data-date="2026-10-20"]')}).locator('.cmv-task-count')).toHaveCount(1);
    const linkColor=await page.evaluate(()=>{const el=document.createElement('span');el.style.color='var(--kptu-link)';document.body.append(el);const color=getComputedStyle(el).color;el.remove();return color});
    const markers=page.locator('.cmv-week-events .kptu-day-more');await expect(markers).toHaveCount(2);
    for(const more of await markers.all()){
      await more.scrollIntoViewIfNeeded();
      await expect(more).toHaveText('+1');await expect(more).toHaveCSS('font-size','12px');
      await expect(more).toHaveCSS('font-weight','800');await expect(more).toHaveCSS('color',linkColor);
      const geometry=await more.evaluate(el=>{
        const box=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const text=range.getBoundingClientRect();
        return {line:parseFloat(getComputedStyle(el).lineHeight),fits:text.left>=box.left&&text.right<=box.right&&text.top>=box.top&&text.bottom<=box.bottom,
          hit:el.contains(document.elementFromPoint(box.x+box.width/2,box.bottom-1))};
      });
      expect(geometry.line).toBeGreaterThanOrEqual(17);expect(geometry.fits).toBe(true);expect(geometry.hit).toBe(true);
    }
    expect(await markers.evaluateAll(es=>es.map(el=>getComputedStyle(el).fontSize))).toEqual(['12px','12px']);
  });
}
