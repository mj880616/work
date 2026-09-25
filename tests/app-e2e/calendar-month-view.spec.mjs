import {test,expect} from '@playwright/test';

const url='http://127.0.0.1:8123/tests/app-e2e/calendar-month-view-fixture.html';

test('five-week month uses 35 dense date cells with adjacent-month dates',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  await expect(page.locator('.cal-cell')).toHaveCount(35);
  await expect(page.locator('.cmv-week')).toHaveCount(5);
  await expect(page.locator('.cal-cell.other')).not.toHaveCount(0);
  await expect(page.locator('.cal-head')).toHaveCount(7);
});

test('six-week month expands to 42 cells without a separate renderer',async({page})=>{
  await page.goto(url);
  await page.evaluate(()=>window.renderMonth(2026,7));
  await expect(page.locator('.cmv-week')).toHaveCount(6);
  await expect(page.locator('.cal-cell')).toHaveCount(42);
});

test('Web2 and Google schedules share the same month renderer and preserve colors',async({page})=>{
  await page.goto(url);
  await expect(page.locator('.cm-app[data-app-event="app-1"]')).toHaveCount(1);
  await expect(page.locator('.cp-event[data-google-event="recurring"]')).toHaveCount(1);
  expect(await page.locator('.cm-app[data-app-event="app-1"]').evaluate(el=>el.style.background)).not.toBe('');
  expect(await page.locator('.cp-event[data-google-event="recurring"]').evaluate(el=>el.style.background)).not.toBe('');
});

test('multi-day schedule renders as continuous weekly segments across a week boundary',async({page})=>{
  await page.goto(url);
  const multi=page.locator('[data-google-event="multi"]');
  await expect(multi).toHaveCount(2);
  await expect(multi.first()).toHaveClass(/cmv-continues-right/);
  await expect(multi.nth(1)).toHaveClass(/cmv-continues-left/);
  expect(await multi.first().evaluate(el=>el.style.gridColumn)).toContain('span 2');
});

test('overflow indicator opens the full day schedule instead of growing the date cell',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  const more=page.locator('.kptu-day-more').first();
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayList .cal-event')).toHaveCount(8);
});

test('empty date space opens the existing create flow with the clicked date',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  const cell=page.locator('.cal-cell[data-date="2026-09-25"]');
  await cell.click({position:{x:10,y:55}});
  await expect(page.locator('#eventModal')).toBeVisible();
  await expect(page.locator('#eventStartDate')).toHaveValue('2026-09-25');
  await expect(page.locator('#eventEndDate')).toHaveValue('2026-09-25');
  await expect(page.locator('#eventStartTime')).toHaveValue('09:00');
  await expect(page.locator('#eventEndTime')).toHaveValue('10:00');
});

test('adjacent-month cells pass their actual data-date into the create flow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  await page.locator('.cal-cell[data-date="2026-08-30"]').click({position:{x:10,y:45}});
  await expect(page.locator('#eventModal')).toBeVisible();
  await expect(page.locator('#eventStartDate')).toHaveValue('2026-08-30');
  await expect(page.locator('#eventEndDate')).toHaveValue('2026-08-30');
});

test('event bars and overflow never fall through to blank-cell creation',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);

  await page.locator('.cm-app[data-app-event="app-1"]').click();
  await expect(page.locator('#ciAppModal')).toBeVisible();
  await expect(page.locator('#eventModal')).toBeHidden();
  await page.locator('#ciAppClose').click();

  await page.locator('[data-google-event="multi"]').first().click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await expect(page.locator('#eventModal')).toBeHidden();
  await page.locator('#ciGoogleClose').click();

  const more=page.locator('.kptu-day-more').first();
  await more.click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#eventModal')).toBeHidden();
});

test('Android-style tap creates an event while swipe and scroll gestures suppress the following click',async({browser})=>{
  const context=await browser.newContext({
    viewport:{width:390,height:844},
    isMobile:true,
    hasTouch:true,
    userAgent:'Mozilla/5.0 (Linux; Android 16; Mobile) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36'
  });
  const page=await context.newPage();
  await page.goto(url);

  const tapCell=page.locator('.cal-cell[data-date="2026-09-06"]');
  await tapCell.tap({position:{x:12,y:50}});
  await expect(page.locator('#eventModal')).toBeVisible();
  await expect(page.locator('#eventStartDate')).toHaveValue('2026-09-06');

  await page.evaluate(()=>{const m=document.querySelector('#eventModal');m.classList.add('hidden');m.setAttribute('aria-hidden','true')});
  await page.locator('#calendarGrid').evaluate(el=>{
    const fire=(type,x,y,key='touches')=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,key,{value:[{clientX:x,clientY:y}]});el.dispatchEvent(e)};
    fire('touchstart',330,360);fire('touchend',90,365,'changedTouches');
  });
  await page.locator('.cal-cell[data-date="2026-09-06"]').dispatchEvent('click');
  await expect(page.locator('#eventModal')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.__navDelta)).toBe(1);

  await page.waitForTimeout(400);
  await page.locator('#calendarGrid').evaluate(el=>{
    const cell=el.querySelector('.cal-cell[data-date="2026-09-06"]');
    const fire=(type,x,y,key='touches')=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,key,{value:[{clientX:x,clientY:y}]});cell.dispatchEvent(e)};
    fire('touchstart',180,280);fire('touchend',182,345,'changedTouches');
  });
  await page.locator('.cal-cell[data-date="2026-09-06"]').dispatchEvent('click');
  await expect(page.locator('#eventModal')).toBeHidden();

  await context.close();
});

test('plus button still opens the same creation UI',async({page})=>{
  await page.goto(url);
  await page.locator('#newEventBtn').click();
  await expect(page.locator('#eventModal')).toBeVisible();
});

test('horizontal swipe changes month while vertical movement does not',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  await page.locator('#calendarGrid').evaluate(el=>{
    const fire=(type,x,y,key='touches')=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,key,{value:[{clientX:x,clientY:y}]});el.dispatchEvent(e)};
    fire('touchstart',330,360);fire('touchend',90,365,'changedTouches');
  });
  await expect.poll(()=>page.evaluate(()=>window.__navDelta)).toBe(1);
  await page.evaluate(()=>window.__navDelta=0);
  await page.locator('#calendarGrid').evaluate(el=>{
    const fire=(type,x,y,key='touches')=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,key,{value:[{clientX:x,clientY:y}]});el.dispatchEvent(e)};
    fire('touchstart',220,250);fire('touchend',210,430,'changedTouches');
  });
  expect(await page.evaluate(()=>window.__navDelta)).toBe(0);
});

test('month view fills the remaining viewport at supported mobile widths',async({page})=>{
  await page.goto(url);
  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:844});
    await expect(page.locator('.cal-cell')).toHaveCount(35);
    const size=await page.locator('#calendarGrid').evaluate(el=>{
      const box=el.getBoundingClientRect(),vv=window.visualViewport;
      return {right:box.right,left:box.left,bottom:box.bottom,viewport:innerWidth,viewportBottom:(vv?.offsetTop||0)+(vv?.height||innerHeight),scroll:document.documentElement.scrollWidth};
    });
    expect(size.left).toBeGreaterThanOrEqual(-13);
    expect(size.right).toBeLessThanOrEqual(size.viewport+13);
    expect(size.scroll).toBeLessThanOrEqual(size.viewport+1);
    expect(Math.abs(size.viewportBottom-size.bottom)).toBeLessThanOrEqual(2);
  }
});

test('today is indicated on the date number instead of filling the whole cell',async({page})=>{
  await page.goto(url);
  const today=page.locator('.cal-cell.today');
  if(await today.count()){
    await expect(today.locator('.cal-day')).toBeVisible();
    const radius=await today.locator('.cal-day').evaluate(el=>getComputedStyle(el).borderRadius);
    expect(radius).not.toBe('0px');
  }
});


test('five and six week months divide the same available height naturally',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  const five=await page.locator('.cmv-week').first().evaluate(el=>el.getBoundingClientRect().height);
  const fiveGrid=await page.locator('#calendarGrid').evaluate(el=>el.getBoundingClientRect().height);
  await page.evaluate(()=>window.renderMonth(2026,7));
  await expect(page.locator('.cmv-week')).toHaveCount(6);
  const six=await page.locator('.cmv-week').first().evaluate(el=>el.getBoundingClientRect().height);
  const sixGrid=await page.locator('#calendarGrid').evaluate(el=>el.getBoundingClientRect().height);
  expect(five).toBeGreaterThan(six+10);
  expect(Math.abs(fiveGrid-sixGrid)).toBeLessThanOrEqual(2);
});

test('date headers and event lanes stay pinned to the top when week rows grow',async({page})=>{
  const measure=async()=>page.evaluate(()=>{
    const cell=document.querySelector('.cal-cell[data-date="2026-09-03"]');
    const week=cell?.closest('.cmv-week');
    const day=cell?.querySelector('.cal-day');
    const layer=week?.querySelector('.cmv-week-events');
    const event=week?.querySelector('.cmv-event');
    const grid=document.querySelector('#calendarGrid');
    if(!cell||!week||!day||!layer||!event||!grid)return null;
    const cb=cell.getBoundingClientRect(),wb=week.getBoundingClientRect(),db=day.getBoundingClientRect(),lb=layer.getBoundingClientRect(),eb=event.getBoundingClientRect();
    return {weekHeight:wb.height,dayTop:db.top-cb.top,dayBottom:db.bottom-wb.top,layerTop:lb.top-wb.top,eventTop:eb.top-wb.top,dateHeaderHeight:parseFloat(getComputedStyle(grid).getPropertyValue('--cmv-date-header-height'))||0};
  });

  await page.setViewportSize({width:390,height:640});
  await page.goto(url);
  const short=await measure();
  expect(short).not.toBeNull();
  expect(short.dayTop).toBeLessThanOrEqual(4);
  expect(short.layerTop).toBeGreaterThanOrEqual(short.dayBottom-1);
  expect(Math.abs(short.layerTop-short.dateHeaderHeight)).toBeLessThanOrEqual(2);
  expect(Math.abs(short.eventTop-short.layerTop)).toBeLessThanOrEqual(1);

  await page.setViewportSize({width:390,height:844});
  await expect.poll(async()=>Number(await page.locator('#calendarGrid').getAttribute('data-cmv-viewport-height'))).toBeGreaterThan(400);
  const tall=await measure();
  expect(tall.weekHeight).toBeGreaterThan(short.weekHeight+20);
  expect(Math.abs(tall.dayTop-short.dayTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(tall.layerTop-short.layerTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(tall.eventTop-short.eventTop)).toBeLessThanOrEqual(1);
});

test('five and six week months keep date headers above the shared event area',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  for(const [year,month,weeks] of [[2026,8,5],[2026,7,6]]){
    await page.evaluate(([y,m])=>window.renderMonth(y,m),[year,month]);
    await expect(page.locator('.cmv-week')).toHaveCount(weeks);
    const metrics=await page.evaluate(()=>[...document.querySelectorAll('.cmv-week')].map(week=>{
      const wb=week.getBoundingClientRect(),layer=week.querySelector('.cmv-week-events'),lb=layer.getBoundingClientRect();
      const dayOffsets=[...week.querySelectorAll('.cal-cell')].map(cell=>{
        const cb=cell.getBoundingClientRect(),db=cell.querySelector('.cal-day').getBoundingClientRect();
        return {top:db.top-cb.top,bottom:db.bottom-wb.top};
      });
      return {layerTop:lb.top-wb.top,dayOffsets};
    }));
    for(const row of metrics){
      expect(Math.max(...row.dayOffsets.map(x=>x.top))).toBeLessThanOrEqual(4);
      expect(row.layerTop).toBeGreaterThanOrEqual(Math.max(...row.dayOffsets.map(x=>x.bottom))-1);
    }
  }
});

test('taller viewport exposes more schedules before overflow',async({page})=>{
  await page.setViewportSize({width:390,height:640});
  await page.goto(url);
  const busyWeek=page.locator('.cmv-week').first();
  const shortVisible=await busyWeek.locator('.cmv-event').count();
  const shortMore=Number((await busyWeek.locator('.kptu-day-more').first().textContent()).replace('+',''));
  const shortHeight=Number(await page.locator('#calendarGrid').getAttribute('data-cmv-viewport-height'));

  await page.setViewportSize({width:390,height:844});
  await expect.poll(async()=>Number(await page.locator('#calendarGrid').getAttribute('data-cmv-viewport-height'))).toBeGreaterThan(shortHeight);
  const tallVisible=await page.locator('.cmv-week').first().locator('.cmv-event').count();
  const tallMore=Number((await page.locator('.cmv-week').first().locator('.kptu-day-more').first().textContent()).replace('+',''));
  expect(tallVisible).toBeGreaterThan(shortVisible);
  expect(tallMore).toBeLessThan(shortMore);
});

test('empty month remains clean and long titles keep ellipsis behavior',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  const title=page.locator('.cm-app[data-app-event="app-1"] .cmv-event-title');
  await expect(title).toBeVisible();
  const style=await title.evaluate(el=>({overflow:getComputedStyle(el).overflow,textOverflow:getComputedStyle(el).textOverflow,whiteSpace:getComputedStyle(el).whiteSpace}));
  expect(style.overflow).toBe('hidden');
  expect(style.textOverflow).toBe('ellipsis');
  expect(style.whiteSpace).toBe('nowrap');

  await page.evaluate(()=>window.KPTUCalendarMonthView.render({year:2026,month:8,appEvents:[],googleEvents:[],googleState:{}}));
  await expect(page.locator('.cmv-event')).toHaveCount(0);
  await expect(page.locator('.kptu-day-more')).toHaveCount(0);
});

test('desktop month view keeps a viewport-sized minimum without imposing a maximum height',async({page})=>{
  await page.setViewportSize({width:1280,height:600});
  await page.goto(url);
  await page.evaluate(()=>window.renderDensityFixture({dateCounts:{}}));
  const quietHeight=await page.locator('#calendarGrid').evaluate(el=>el.getBoundingClientRect().height);
  await page.evaluate(()=>window.renderDensityFixture({dateCounts:{
    '2026-09-10':1,
    '2026-09-17':3,
    '2026-09-24':7,
    '2026-09-30':12
  }}));
  const metrics=await page.evaluate(()=>{
    const grid=document.querySelector('#calendarGrid'),weeks=[...document.querySelectorAll('.cmv-week')];
    return {
      gridHeight:grid.getBoundingClientRect().height,
      quietHeight:0,
      viewportHeight:innerHeight,
      documentHeight:document.documentElement.scrollHeight,
      gridOverflow:getComputedStyle(grid).overflowY,
      weekMetrics:weeks.map(week=>{
        const box=week.getBoundingClientRect(),events=[...week.querySelectorAll('.cmv-event')],cells=[...week.querySelectorAll('.cal-cell')];
        return {
          height:box.height,
          laneCount:Number(week.dataset.laneCount),
          visibleEvents:events.length,
          more:week.querySelectorAll('.kptu-day-more').length,
          lastBottom:events.length?events.at(-1).getBoundingClientRect().bottom:null,
          bottom:box.bottom,
          cellHeights:cells.map(cell=>cell.getBoundingClientRect().height),
          overflow:getComputedStyle(week).overflowY
        };
      })
    };
  });
  metrics.quietHeight=quietHeight;
  expect(metrics.weekMetrics.map(row=>row.laneCount)).toEqual([0,1,3,7,12]);
  expect(metrics.weekMetrics.map(row=>row.visibleEvents)).toEqual([0,1,3,7,12]);
  expect(metrics.weekMetrics.every(row=>row.more===0)).toBe(true);
  expect(metrics.weekMetrics.every(row=>Math.max(...row.cellHeights)-Math.min(...row.cellHeights)<=1)).toBe(true);
  expect(metrics.weekMetrics.filter(row=>row.lastBottom!==null).every(row=>row.lastBottom<=row.bottom+1)).toBe(true);
  expect(metrics.weekMetrics[4].height).toBeGreaterThan(metrics.weekMetrics[3].height);
  expect(metrics.weekMetrics[3].height).toBeGreaterThan(metrics.weekMetrics[1].height);
  expect(metrics.gridHeight).toBeGreaterThan(metrics.quietHeight);
  expect(metrics.documentHeight).toBeGreaterThan(metrics.viewportHeight);
  expect(metrics.gridOverflow).not.toBe('auto');
  expect(metrics.gridOverflow).not.toBe('scroll');
  expect(metrics.weekMetrics.every(row=>row.overflow!=='auto'&&row.overflow!=='scroll')).toBe(true);
});

test('desktop renders every lane at 1280, 1440 and 1920 pixels without nested scrolling',async({page})=>{
  for(const width of [1280,1440,1920]){
    await page.setViewportSize({width,height:800});
    await page.goto(url);
    await page.evaluate(()=>window.renderDensityFixture({dateCounts:{'2026-09-03':12}}));
    const metrics=await page.locator('.cmv-week').first().evaluate(week=>{
      const box=week.getBoundingClientRect(),events=[...week.querySelectorAll('.cmv-event')],grid=document.querySelector('#calendarGrid');
      return {
        laneCount:Number(week.dataset.laneCount),
        visibleEvents:events.length,
        more:week.querySelectorAll('.kptu-day-more').length,
        lastBottom:events.at(-1).getBoundingClientRect().bottom,
        weekBottom:box.bottom,
        documentHeight:document.documentElement.scrollHeight,
        viewportHeight:innerHeight,
        gridScrollHeight:grid.scrollHeight,
        gridClientHeight:grid.clientHeight
      };
    });
    expect(metrics.laneCount).toBe(12);
    expect(metrics.visibleEvents).toBe(12);
    expect(metrics.more).toBe(0);
    expect(metrics.lastBottom).toBeLessThanOrEqual(metrics.weekBottom+1);
    expect(metrics.documentHeight).toBeGreaterThan(metrics.viewportHeight);
    expect(metrics.gridScrollHeight).toBeLessThanOrEqual(metrics.gridClientHeight+1);
  }
});

test('desktop dense rows work in five-week and six-week months',async({page})=>{
  await page.setViewportSize({width:1440,height:800});
  await page.goto(url);
  for(const scenario of [
    {year:2026,month:8,date:'2026-09-03',weeks:5},
    {year:2026,month:7,date:'2026-08-13',weeks:6}
  ]){
    await page.evaluate(value=>window.renderDensityFixture({year:value.year,month:value.month,dateCounts:{[value.date]:12}}),scenario);
    await expect(page.locator('.cmv-week')).toHaveCount(scenario.weeks);
    await expect(page.locator('.cmv-event')).toHaveCount(12);
    await expect(page.locator('.kptu-day-more')).toHaveCount(0);
    const contained=await page.locator('.cmv-event').last().evaluate(event=>event.getBoundingClientRect().bottom<=event.closest('.cmv-week').getBoundingClientRect().bottom+1);
    expect(contained).toBe(true);
  }
});

test('desktop mixed multi-day and single-day events preserve spans, lanes and hit areas',async({page})=>{
  await page.setViewportSize({width:1440,height:800});
  await page.goto(url);
  await page.evaluate(()=>window.renderDensityFixture({
    dateCounts:{'2026-09-09':10},
    googleEvents:[
      {id:'span-a',source:'google',calendarId:'cal-a',title:'월-목',start:'2026-09-07',end:'2026-09-11',allDay:true,color:null},
      {id:'span-b',source:'google',calendarId:'cal-b',title:'화-금',start:'2026-09-08',end:'2026-09-12',allDay:true,color:null},
      {id:'boundary',source:'google',calendarId:'cal-a',title:'주 경계',start:'2026-09-12',end:'2026-09-15',allDay:true,color:null}
    ]
  }));
  const boundary=page.locator('[data-google-event="boundary"]');
  await expect(boundary).toHaveCount(2);
  await expect(boundary.first()).toHaveClass(/cmv-continues-right/);
  await expect(boundary.nth(1)).toHaveClass(/cmv-continues-left/);
  expect(await page.locator('[data-google-event="span-a"]').evaluate(event=>event.style.gridColumn)).toContain('span 4');
  expect(await page.locator('[data-google-event="span-b"]').evaluate(event=>event.style.gridColumn)).toContain('span 4');
  const metrics=await page.locator('.cmv-week').nth(1).evaluate(week=>{
    const events=[...week.querySelectorAll('.cmv-event')],box=week.getBoundingClientRect();
    const overlap=events.some((left,index)=>events.slice(index+1).some(right=>{
      const a=left.getBoundingClientRect(),b=right.getBoundingClientRect();
      return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    }));
    return {
      laneCount:Number(week.dataset.laneCount),
      visibleEvents:events.length,
      allInside:events.every(event=>event.getBoundingClientRect().bottom<=box.bottom+1),
      allClickable:events.every(event=>getComputedStyle(event).pointerEvents==='auto'),
      overlap
    };
  });
  expect(metrics.visibleEvents).toBe(metrics.laneCount+1);
  expect(metrics.allInside).toBe(true);
  expect(metrics.allClickable).toBe(true);
  expect(metrics.overlap).toBe(false);

  await page.locator('.cmv-week').nth(1).locator('.cm-app').last().click();
  await expect(page.locator('#ciAppModal')).toBeVisible();
  await expect(page.locator('#eventModal')).toBeHidden();
  await page.locator('#ciAppClose').click();

  await page.locator('[data-google-event="span-b"]').click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await expect(page.locator('#eventModal')).toBeHidden();
  await page.locator('#ciGoogleClose').click();

  await page.locator('.cal-cell[data-date="2026-09-13"]').click({position:{x:20,y:70}});
  await expect(page.locator('#eventModal')).toBeVisible();
  await expect(page.locator('#eventStartDate')).toHaveValue('2026-09-13');
});

test('desktop month view enlarges typography, bars and lane capacity across supported widths',async({page})=>{
  for(const viewport of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080}]){
    await page.setViewportSize(viewport);
    await page.goto(url);
    await page.evaluate(()=>window.renderMonth());
    const metrics=await page.locator('#calendarGrid').evaluate(el=>{
      const event=el.querySelector('.cmv-event'),day=el.querySelector('.cal-day'),head=el.querySelector('.cal-head'),time=el.querySelector('.cmv-event-time');
      const css=getComputedStyle(el),eb=getComputedStyle(event),db=getComputedStyle(day),hb=getComputedStyle(head),tb=getComputedStyle(time);
      return {
        width:el.getBoundingClientRect().width,
        head:parseFloat(hb.fontSize),day:parseFloat(db.fontSize),event:parseFloat(eb.fontSize),time:parseFloat(tb.fontSize),
        bar:event.getBoundingClientRect().height,
        weekHeight:el.querySelector('.cmv-week').getBoundingClientRect().height,
        slots:Number(el.dataset.cmvLaneSlots)
      };
    });
    expect(metrics.width).toBeGreaterThan(viewport.width*.9);
    expect(metrics.head).toBeGreaterThanOrEqual(12);
    expect(metrics.day).toBeGreaterThanOrEqual(12);
    expect(metrics.event).toBeGreaterThanOrEqual(10.5);
    expect(metrics.time).toBeGreaterThanOrEqual(9);
    expect(metrics.bar).toBeGreaterThanOrEqual(18);
    expect(metrics.weekHeight).toBeGreaterThanOrEqual(88);
    expect(metrics.slots).toBeGreaterThanOrEqual(3);
  }
});

test('mobile month density remains unchanged at 360, 390, 412 and 430 pixels',async({page})=>{
  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:844});
    await page.goto(url);
    const metrics=await page.locator('#calendarGrid').evaluate(el=>{
      const event=el.querySelector('.cmv-event'),day=el.querySelector('.cal-day'),time=el.querySelector('.cmv-event-time'),css=getComputedStyle(el);
      return {laneStep:parseFloat(css.getPropertyValue('--cmv-lane-step')),bar:event.getBoundingClientRect().height,day:parseFloat(getComputedStyle(day).fontSize),event:parseFloat(getComputedStyle(event).fontSize),time:parseFloat(getComputedStyle(time).fontSize)};
    });
    expect(metrics.laneStep).toBe(14);
    expect(metrics.bar).toBeLessThanOrEqual(13.5);
    expect(metrics.day).toBeLessThanOrEqual(10);
    expect(metrics.event).toBeLessThanOrEqual(8.5);
    expect(metrics.time).toBeLessThanOrEqual(7.5);
  }
});

test('event color presets use Google event colorIds and remain keyboard-focusable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  await page.evaluate(()=>{
    window.__KPTU_GOOGLE_STATE__={eventColors:{
      '1':{background:'#a4bdfc',foreground:'#1d1d1d'},
      '2':{background:'#7ae7bf',foreground:'#1d1d1d'},
      '11':{background:'#dc2127',foreground:'#ffffff'}
    }};
    const box=document.createElement('div');box.id='presetFixture';document.body.appendChild(box);
    window.KPTUCalendarColors.render(box,{value:'#dc2127',colorId:'11',touched:false,label:'테스트 일정 색상'});
  });
  const swatches=page.locator('#presetFixture .calendar-color-swatch');
  await expect(swatches).toHaveCount(3);
  await expect(swatches.nth(2)).toHaveAttribute('aria-checked','true');
  await expect(swatches.nth(2)).toHaveAttribute('data-color-id','11');
  await swatches.first().focus();
  await swatches.first().press('ArrowRight');
  const selected=await page.evaluate(()=>window.KPTUCalendarColors.value('#presetFixture'));
  expect(selected.touched).toBe(true);
  expect(selected.id).toBe('2');
  expect(selected.hex).toBe('#7ae7bf');
  const touchSize=await swatches.first().evaluate(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height}));
  expect(touchSize.w).toBeGreaterThanOrEqual(40);
  expect(touchSize.h).toBeGreaterThanOrEqual(40);
});
