import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

test.use({timezoneId:'Asia/Seoul'});
const sizes=[[360,640],[412,780],[686,820],[884,1000],[1280,820]];
const events=[1,2,3,24].flatMap((count,index)=>Array.from({length:count},(_,i)=>({
  id:`footer-${index}-${i}`,calendarId:'qa-cal',title:'QA',
  start:`2026-10-${19+index}`,end:`2026-10-${20+index}`,allDay:true,color:'#4285f4'
})));
async function render(page,withTasks=true){
  await page.evaluate(({events,withTasks})=>{
    KPTUCalendarMonthView.setTasks(withTasks?[
      ...[19,20,21].map(day=>({id:'qa-'+day,title:'QA',date:`2026-10-${day}`,done:false})),
      ...Array.from({length:17},(_,i)=>({id:'dense-task-'+i,title:'QA',date:'2026-10-22',done:false}))
    ]:[]);
    KPTUCalendarMonthView.render({year:2026,month:9,googleEvents:events});
  },{events,withTasks});
}
async function closeDay(page){
  await page.locator('[data-close="calendarDayModal"]').click();
  await expect(page.locator('#calendarDayModal')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBeUndefined();
}
for(const [width,height] of sizes){
  test(`month event footer preserves bars and day access (${width}x${height})`,async({page},info)=>{
    await page.setViewportSize({width,height});
    const {external}=await openEmphasisFixture(page);
    await render(page);
    const week=page.locator('.cmv-week').filter({has:page.locator('.cal-cell[data-date="2026-10-20"]')});
    const counts=await week.evaluate(el=>[1,2,3,24].map((total,index)=>({total,
      bars:el.querySelectorAll(`[data-google-event^="footer-${index}-"]`).length
    })));
    console.log('footer bars',width,height,JSON.stringify(counts),'slots',await page.locator('#calendarGrid').getAttribute('data-cmv-lane-slots'));
    for(const [index,{total,bars}] of counts.entries()){
      expect(bars).toBeGreaterThanOrEqual(1);
      const cell=page.locator(`.cal-cell[data-date="2026-10-${19+index}"]`);
      const more=cell.locator('.kptu-day-more');
      expect(bars+(await more.count()?Number((await more.textContent()).slice(1)):0)).toBe(total);
      if(await more.count()){
        await more.scrollIntoViewIfNeeded();
        const geometry=await more.evaluate(el=>{
          const r=el.getBoundingClientRect(),c=el.parentElement.getBoundingClientRect(),other=el.parentElement.querySelector('.cmv-task-count')?.getBoundingClientRect();
          const style=getComputedStyle(el.parentElement),innerWidth=c.width-parseFloat(style.borderLeftWidth)-parseFloat(style.borderRightWidth);
          return {width:r.width,height:r.height,cellWidth:innerWidth,within:r.left>=c.left&&r.right<=c.right&&r.top>=c.bottom-44-.1&&r.bottom<=c.bottom+.1,
            overlap:!!other&&r.right>other.left+.1&&r.left<other.right-.1,taskWidth:other?.width};
        });
        console.log('footer target',width,index,JSON.stringify(geometry));
        expect(geometry.height).toBe(44);expect(geometry.within).toBe(true);expect(geometry.overlap).toBe(false);
        expect(geometry.width).toBeCloseTo(geometry.taskWidth?geometry.cellWidth/2:geometry.cellWidth,1);
        await more.click();
        await expect(page.locator('#calendarDayModal')).toBeVisible();
        await expect(page.locator('#calendarDayEvents .cal-event')).toHaveCount(total);
        await closeDay(page);
      }
      const task=cell.locator('.cmv-task-count');
      if(await task.count()){
        await expect(task).toHaveCSS('height','44px');
        if(!await more.count())expect(await task.evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44);
        await task.click();await expect(page.locator('#calendarDayModal')).toBeVisible();
        await expect(page.locator('#calendarDayEvents .cal-event')).toHaveCount(total);
        await expect(page.locator('#calendarDayTasks .cal-event')).toHaveCount(index===3?17:1);
        await closeDay(page);
      }
    }
    const textOutside=await week.locator('.cmv-task-count span,.cmv-footer-more span').evaluateAll(spans=>spans.filter(span=>{
      const range=document.createRange();range.selectNodeContents(span);
      const text=range.getBoundingClientRect(),button=span.parentElement.getBoundingClientRect();
      return text.left<button.left-.1||text.right>button.right+.1||text.top<button.top-.1||text.bottom>button.bottom+.1;
    }).length);
    expect(textOutside).toBe(0);
    const clipped=await week.locator('.cmv-event').evaluateAll(elements=>elements.filter(el=>{
      const r=el.getBoundingClientRect(),w=el.closest('.cmv-week').getBoundingClientRect();
      return r.height<=0||r.top<w.top||r.bottom>w.bottom-44;
    }).length);
    expect(clipped).toBe(0);
    if(width===360||width===686){
      const photo=info.outputPath(`month-${width}x${height}.png`);
      await page.screenshot({path:photo,fullPage:true});await info.attach('month photo',{path:photo,contentType:'image/png'});
    }
    // Device report: just one pending task on 10/22 reserves the footer for the whole month.
    await page.evaluate(()=>KPTUCalendarMonthView.setTasks([{id:'only-one',title:'QA',date:'2026-10-22',done:false}]));
    await expect(page.locator('.cmv-task-count')).toHaveCount(1);
    for(let index=0;index<4;index++)await expect(week.locator(`[data-google-event^="footer-${index}-"]`).first()).toBeVisible();
    await render(page,false);
    await expect(page.locator('#calendarGrid')).not.toHaveClass(/cmv-has-tasks/);
    await expect(page.locator('.cmv-task-count,.cmv-footer-more')).toHaveCount(0);
    const slots=Number(await page.locator('#calendarGrid').getAttribute('data-cmv-lane-slots'));
    const cap=Number(await week.getAttribute('data-lane-cap'));
    expect(cap).toBe(width>=1024?24:24>slots?Math.max(0,slots-1):slots);
    if(width<1024)await expect(week.locator('.cmv-week-events > .kptu-day-more')).not.toHaveCount(0);
    expect(external).toEqual([]);
  });
}
