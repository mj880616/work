import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test.use({timezoneId:'Asia/Seoul'});
const url='http://127.0.0.1:8123/tests/app-e2e/calendar-month-view-fixture.html';
const event=(id,start,end,extra={})=>({id,calendarId:'cal-a',title:id,start,end,allDay:true,...extra});
const trip=[
  event('Sirmione','2026-10-05','2026-10-07'),
  event('Como Alpina Dolomites','2026-10-06','2026-10-09'),
  event('Dobiacco','2026-10-08','2026-10-11')
];
async function render(page,events){
  await page.evaluate(googleEvents=>KPTUCalendarMonthView.render({year:2026,month:9,googleEvents,googleState:window.__googleState}),events);
}
const bar=(page,id)=>page.locator(`#calendarGrid [data-google-event="${id}"]`);
async function geometry(locator){
  return locator.evaluateAll(es=>es.map(el=>({week:el.closest('.cmv-week').dataset.weekStart,row:el.style.gridRow,column:el.style.gridColumn})));
}
for(const width of [390,1280]){
  test.describe(`${width}px weekly lanes`,()=>{
    let errors;
    test.beforeEach(async({page})=>{
      errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
      await page.setViewportSize({width,height:844});
      await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
      await page.clock.setFixedTime(new Date('2026-10-11T03:00:00Z'));
      await page.goto(url);
    });
    test.afterEach(()=>expect(errors).toEqual([]));
    test('reported trip stays in one continuous bar per event',async({page})=>{
      await render(page,trip);
      if(process.env.CAL_CAPTURE_LABEL){
        await mkdir('docs/cal-multiday-lane',{recursive:true});
        await page.screenshot({path:`docs/cal-multiday-lane/${process.env.CAL_CAPTURE_LABEL}-${width}.png`,fullPage:true});
      }
      await expect(bar(page,'Como Alpina Dolomites')).toHaveCount(1);
      await expect(bar(page,'Dobiacco')).toHaveCount(1);
      expect(await geometry(bar(page,'Sirmione'))).toEqual([{week:'2026-10-04',row:'1',column:'2 / span 2'}]);
      expect(await geometry(bar(page,'Como Alpina Dolomites'))).toEqual([{week:'2026-10-04',row:'2',column:'3 / span 3'}]);
      expect(await geometry(bar(page,'Dobiacco'))).toEqual([{week:'2026-10-04',row:'1',column:'5 / span 3'}]);
      expect(await bar(page,'Como Alpina Dolomites').evaluate(el=>[el.style.background,el.style.getPropertyValue('--cmv-google-source')])).toEqual(['rgb(66, 133, 244)','#4285f4']);
    });
    test('each week clips a continuing timed event once',async({page})=>{
      await render(page,[...trip,event('timed','2026-10-09T09:00:00+09:00','2026-10-13T12:00:00+09:00',{allDay:false})]);
      expect(await geometry(bar(page,'timed'))).toEqual([
        {week:'2026-10-04',row:'2',column:'6 / span 2'},
        {week:'2026-10-11',row:'1',column:'1 / span 3'}
      ]);
      await expect(bar(page,'timed').first()).toHaveClass(/cmv-continues-right/);
      await expect(bar(page,'timed').last()).toHaveClass(/cmv-continues-left/);
    });
    test('multi-day start day then longest duration precede old tie breakers; singles fill gaps',async({page})=>{
      await render(page,[
        event('A short','2026-10-05','2026-10-07'),
        event('Z long','2026-10-05','2026-10-09'),
        event('earlier timed','2026-10-04T09:00:00+09:00','2026-10-06T12:00:00+09:00',{allDay:false}),
        event('single','2026-10-08','2026-10-09')
      ]);
      expect(await geometry(bar(page,'earlier timed'))).toEqual([{week:'2026-10-04',row:'1',column:'1 / span 3'}]);
      expect(await geometry(bar(page,'Z long'))).toEqual([{week:'2026-10-04',row:'2',column:'2 / span 4'}]);
      expect(await geometry(bar(page,'A short'))).toEqual([{week:'2026-10-04',row:'3',column:'2 / span 2'}]);
      expect(await geometry(bar(page,'single'))).toEqual([{week:'2026-10-04',row:'1',column:'5 / span 1'}]);
    });
    test('a sparse high lane counts one hidden event without moving it into a gap',async({page})=>{
      await page.setViewportSize({width,height:640});
      const slots=Number(await page.locator('#calendarGrid').getAttribute('data-cmv-lane-slots'));
      await render(page,[...Array.from({length:slots},(_,i)=>event('early-'+i,'2026-10-04','2026-10-07')),
        event('late long','2026-10-05','2026-10-11')]);
      if(width===390){
        const more=page.locator('.kptu-day-more[data-date="2026-10-08"]');
        await expect(more).toHaveText('+1');
        expect(await more.evaluate(el=>el.getBoundingClientRect().bottom<=el.closest('.cmv-week').getBoundingClientRect().bottom)).toBe(true);
        await expect(bar(page,'late long')).toHaveCount(0);
        await more.click();await expect(page.locator('#calendarDayList .cal-event')).toHaveCount(1);
        await expect(page.locator('#calendarDayList [data-google-event="late long"]')).toHaveCount(1);
      }else{
        expect(await geometry(bar(page,'late long'))).toEqual([{week:'2026-10-04',row:String(slots+1),column:'2 / span 6'}]);
        await expect(page.locator('.kptu-day-more')).toHaveCount(0);
      }
    });
    test('daily overflow counts every hidden event and opens the complete date',async({page})=>{
      await render(page,[...trip,...Array.from({length:12},(_,i)=>event('busy-'+i,'2026-10-06','2026-10-07'))]);
      const week=page.locator('.cmv-week[data-week-start="2026-10-04"]');
      const visible=await week.locator('.cmv-event').evaluateAll(es=>es.filter(el=>{const start=Number(el.style.gridColumnStart)-1,span=Number(el.style.gridColumnEnd.replace('span ',''));return start<=2&&start+span>2}).length);
      const more=week.locator('.kptu-day-more[data-date="2026-10-06"]');
      if(width===390){
        await expect(more).toHaveText('+'+(14-visible));await more.click();
        await expect(page.locator('#calendarDayList .cal-event')).toHaveCount(14);
      }else{expect(visible).toBe(14);await expect(more).toHaveCount(0)}
      await expect(bar(page,'Como Alpina Dolomites')).toHaveCount(1);
      await expect(bar(page,'Dobiacco')).toHaveCount(1);
    });
  });
}
