import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

test.use({timezoneId:'Asia/Seoul'});
async function open(page,width=1280,view='default',events){
  await page.setViewportSize({width,height:844});
  const result=await openEmphasisFixture(page,{view,...(events?{events}:{})});
  await page.evaluate(()=>window.__KPTU_CALENDAR_PERSISTENCE_READY__);
  return result;
}
test('PC default week has Monday through Sunday and one KST seven-day request',async({page})=>{
  const {calls}=await open(page);
  await expect(page.locator('#calendarWeek')).toBeVisible();
  await expect(page.locator('.cwv-day')).toHaveCount(7);
  expect(await page.locator('.cwv-date').allTextContents()).toEqual(['월 12','화 13','수 14','목 15','금 16','토 17','일 18']);
  await expect(page.locator('#monthTitle .calendar-title-full')).toHaveText('10월 12일 – 18일');
  await expect.poll(()=>calls.filter(c=>c.action==='events').length).toBe(1);
  const request=calls.find(c=>c.action==='events');
  expect(request.min).toBe('2026-10-11T15:00:00.000Z');
  expect(request.max).toBe('2026-10-18T15:00:00.000Z');
  await expect(page.locator('#calendarListMore')).not.toBeVisible();
  const current=page.locator('.cwv-day[data-date="2026-10-15"]');
  await expect(current).toHaveClass(/cwv-today/);
  await expect(current.locator('.cwv-create')).toBeVisible();
  const colors=await page.evaluate(()=>{const el=document.querySelector('.cwv-day[data-date="2026-10-15"]');return {background:getComputedStyle(el).backgroundColor,weight:getComputedStyle(el.querySelector('.cwv-date')).fontWeight}});
  expect(colors.weight).toBe('700');
  expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
  const columns=await page.locator('.cwv-day').evaluateAll(ds=>ds.map(d=>d.getBoundingClientRect().toJSON()));
  expect(new Set(columns.map(d=>d.top)).size).toBe(1);
  for(let i=1;i<7;i++)expect(columns[i].left).toBeGreaterThan(columns[i-1].left);
});
for(const width of [360,390,686,1023])for(const view of ['default','week'])test(`narrow ${width} saved ${view} shows list without overwriting preference`,async({page})=>{
  await open(page,width,view);
  await expect(page.locator('#calendarList')).toBeVisible();
  await expect(page.locator('[data-calendar-view]:visible')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'주간 보기',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('kptu-calendar-view'))).toBe(view==='week'?'week':null);
  await page.reload();await expect(page.locator('#calendarList')).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('kptu-calendar-view'))).toBe(view==='week'?'week':null);
  await page.getByRole('button',{name:'목록 보기',exact:true}).click();
  expect(await page.evaluate(()=>localStorage.getItem('kptu-calendar-view'))).toBe('list');
  await page.getByRole('button',{name:'월간 보기',exact:true}).click();
  expect(await page.evaluate(()=>localStorage.getItem('kptu-calendar-view'))).toBe('month');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
});
for(const width of [1024,1280,1440])test(`PC ${width} has three buttons and seven vertical columns`,async({page})=>{
  await open(page,width);await expect(page.locator('#calendarWeek')).toBeVisible();
  await expect(page.locator('[data-calendar-view]:visible')).toHaveCount(3);
  const columns=await page.locator('.cwv-day').evaluateAll(ds=>ds.map(d=>d.getBoundingClientRect().toJSON()));
  expect(columns).toHaveLength(7);expect(new Set(columns.map(d=>d.top)).size).toBe(1);
  for(let i=1;i<7;i++)expect(columns[i].left).toBeGreaterThanOrEqual(columns[i-1].right-1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
});
for(const [width,view,expected] of [[1280,'week','Week'],[360,'month','Grid'],[1280,'invalid','Week'],[360,'invalid','List'],[760,'default','List'],[761,'default','List']]){
  test(`saved ${view} at ${width} opens ${expected}`,async({page})=>{
    await open(page,width,view);await expect(page.locator('#calendar'+expected)).toBeVisible();
  });
}
test('1023 ↔ 1024 restores week, recalculates defaults and respects explicit choices',async({page})=>{
  await open(page,1024,'week');await page.locator('#nextMonthBtn').click();
  await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-19');
  await page.setViewportSize({width:1023,height:844});await expect(page.locator('#calendarList')).toBeVisible();
  await expect(page.locator('[data-calendar-view]:visible')).toHaveCount(2);
  expect(await page.evaluate(()=>localStorage.getItem('kptu-calendar-view'))).toBe('week');
  await page.evaluate(()=>window.KPTUCalendarTasks.refresh());
  await page.setViewportSize({width:1024,height:844});await expect(page.locator('#calendarWeek')).toBeVisible();
  await expect(page.locator('[data-calendar-view]:visible')).toHaveCount(3);
  await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-19');
  await page.setViewportSize({width:1023,height:844});await page.getByRole('button',{name:'목록 보기',exact:true}).click();
  await page.setViewportSize({width:1024,height:844});await expect(page.locator('#calendarList')).toBeVisible();
  await page.setViewportSize({width:1023,height:844});await page.getByRole('button',{name:'월간 보기',exact:true}).click();
  await page.setViewportSize({width:1024,height:844});await expect(page.locator('#calendarGrid')).toBeVisible();
});
test('unsaved default responds to boundary changes without writing storage',async({page})=>{
  await open(page,1023);await page.setViewportSize({width:1024,height:844});await expect(page.locator('#calendarWeek')).toBeVisible();
  await page.setViewportSize({width:1023,height:844});await expect(page.locator('#calendarList')).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('kptu-calendar-view'))).toBe(null);
});
test('week arrows move seven days, titles truncate across months and today resets to this week',async({page})=>{
  const {calls}=await open(page,1280,'week');
  await page.locator('#nextMonthBtn').click();
  await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-19');
  await expect.poll(()=>calls.filter(c=>c.action==='events').length).toBe(2);
  for(let i=0;i<3;i++)await page.locator('#prevMonthBtn').click();
  await expect(page.locator('#monthTitle .calendar-title-full')).toHaveText('9월 28일 – 10월 4일');
  await expect(page.locator('#monthTitle')).toHaveAccessibleName('2026년 9월 28일 – 2026년 10월 4일');
  const title=await page.locator('#monthTitle').evaluate(el=>({height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight),space:getComputedStyle(el).whiteSpace,overflow:getComputedStyle(el).textOverflow}));
  expect(title.height).toBeLessThanOrEqual(title.line+0.5);expect(title.space).toBe('nowrap');expect(title.overflow).toBe('ellipsis');
  await page.locator('#calendarTodayBtn').click();
  await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-12');
});
for(const width of [1024,1280,1440])test(`week bands, timed order, tasks and dialogs at ${width}`,async({page})=>{
  const ev=(id,start,end,allDay=false)=>({id,title:'QA event',calendarId:'qa-cal',start,end,allDay,color:'#4285f4'});
  await open(page,width,'week',[
    ev('late','2026-10-15T11:00:00+09:00','2026-10-15T12:00:00+09:00'),
    ev('early','2026-10-15T09:00:00+09:00','2026-10-16T00:00:00+09:00'),
    ev('span','2026-10-15','2026-10-17',true),
    ...Array.from({length:16},(_,i)=>ev('dense-'+i,'2026-10-20','2026-10-21',true))
  ]);
  const day=page.locator('.cwv-day[data-date="2026-10-15"]');
  await expect(day.locator('[data-google-event]')).toHaveCount(2);
  expect(await day.locator('[data-google-event]').evaluateAll(rows=>rows.map(r=>r.dataset.googleEvent))).toEqual(['early','late']);
  const span=page.locator('#calendarWeek .cwv-bands [data-google-event="span"]');
  await expect(span).toHaveCount(1);await expect(span).toHaveCSS('grid-column','4 / span 2');
  const {band,first,last}=await page.evaluate(()=>{const r=sel=>document.querySelector(sel).getBoundingClientRect().toJSON();return {band:r('#calendarWeek .cwv-bands [data-google-event="span"]'),first:r('.cwv-day[data-date="2026-10-15"]'),last:r('.cwv-day[data-date="2026-10-16"]')}});
  expect(band.width).toBeGreaterThan(first.width*1.8);expect(band.x).toBeGreaterThanOrEqual(first.x);expect(band.x+band.width).toBeLessThanOrEqual(last.x+last.width);
  const geometry=await page.evaluate(()=>{const el=document.querySelector('.cwv-day[data-date="2026-10-15"] .clv-event');return {height:el.getBoundingClientRect().height,title:getComputedStyle(el.querySelector('.clv-title')).fontSize,time:getComputedStyle(el.querySelector('.clv-time')).fontSize,ellipsis:getComputedStyle(el.querySelector('.clv-title')).textOverflow}});
  expect(geometry.height).toBeGreaterThanOrEqual(44);expect(parseFloat(geometry.title)).toBeGreaterThanOrEqual(12);expect(parseFloat(geometry.time)).toBeGreaterThanOrEqual(12);expect(geometry.ellipsis).toBe('ellipsis');
  await day.locator('[data-google-event="early"]').click();await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await page.locator('#ciGoogleClose').first().click();
  await span.click();await expect(page.locator('#ciGoogleModal')).toBeVisible();await page.locator('#ciGoogleClose').first().click();
  // CAL-주간시간표: 09:00~24:00 일정이 칸 아래를 채우므로 빈 곳은 0~7시(위로 스크롤)를 누른다.
  await page.evaluate(()=>{document.querySelector('#calendarWeek').scrollTop=0});
  await expect(async()=>{
    const blank=day.locator('.cwv-create'),blankRect=await blank.boundingBox(),fold=await day.locator('.cwv-timeline').boundingBox();
    await blank.click({position:{x:10,y:fold.y-blankRect.y+3*48},timeout:2000});
  }).toPass({timeout:10000});await expect(page.locator('#eventModal')).toBeVisible();await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-15');
  await page.locator('#eventModal [data-close="eventModal"]').click();
  await page.locator('#nextMonthBtn').click();
  await expect(page.locator('#calendarWeek .cwv-bands [data-google-event]')).toHaveCount(16);
  await expect(page.locator('.cwv-day[data-date="2026-10-20"] .cmv-task-count')).toHaveText('1');
  const count=page.locator('.cwv-day[data-date="2026-10-21"] .cmv-task-count');
  await expect(count).toHaveText('17');await expect(count.locator('svg')).toHaveCount(1);
  const rect=await count.boundingBox();expect(rect.width).toBeGreaterThanOrEqual(44);expect(rect.height).toBeGreaterThanOrEqual(44);
  await count.click();await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayTasks [data-calendar-task]')).toHaveCount(18);
});
test('KST week start agrees with home on an overseas device',async({browser})=>{
  const context=await browser.newContext({timezoneId:'America/Los_Angeles',viewport:{width:1280,height:844}}),page=await context.newPage();
  try{const {calls}=await openEmphasisFixture(page,{view:'week'});await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-12');expect(calls.find(c=>c.action==='events').min).toBe('2026-10-11T15:00:00.000Z')}finally{await context.close()}
});

test('week keeps keyboard focus during task refresh',async({page})=>{
  await open(page,1280,'week');await page.locator('#nextMonthBtn').click();
  const link=page.locator('.cwv-day[data-date="2026-10-20"] .cmv-task-count');
  await expect(link).toBeVisible();await link.focus();
  await page.evaluate(()=>window.KPTUCalendarTasks.refresh());
  await expect(link).toBeFocused();
});
test('late previous-week response cannot replace the latest week',async({page})=>{
  await open(page,1280,'week');
  let release,count=0;const hold=new Promise(r=>release=r);
  await page.route('**/functions/v1/google-calendar?action=events*',async route=>{
    const old=++count===1;if(old)await hold;
    const date=old?'2026-10-20':'2026-10-27';
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({events:[{id:old?'old-week':'latest-week',calendarId:'qa-cal',title:'QA event',start:date,end:old?'2026-10-21':'2026-10-28',allDay:true}]})});
  });
  await page.locator('#nextMonthBtn').click();await expect.poll(()=>count).toBe(1);
  await page.locator('#nextMonthBtn').click();
  await expect(page.locator('#calendarWeek [data-google-event="latest-week"]')).toBeVisible();
  const oldResponse=page.waitForResponse(response=>response.url().includes('action=events')&&new URL(response.url()).searchParams.get('timeMin')==='2026-10-18T15:00:00.000Z');
  release();await (await oldResponse).finished();
  await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-26');
  await expect(page.locator('#calendarWeek [data-google-event="latest-week"]')).toHaveCount(1);
  await expect(page.locator('#calendarWeek [data-google-event="old-week"]')).toHaveCount(0);
});
test('phone swipe with saved week keeps fallback list dates while navigating the bottom tabs',async({page})=>{
  await open(page,360,'week');
  await expect.poll(()=>page.evaluate(()=>!!window.__KPTU_MOBILE_SWIPE_NAV__)).toBe(true);
  const before=await page.locator('#monthTitle').textContent();
  await page.locator('.clv-day').first().evaluate(el=>{
    const r=el.getBoundingClientRect(),y=r.top+r.height/2;
    for(const [type,x] of [['touchstart',280],['touchmove',180],['touchend',100]]){
      const event=new Event(type,{bubbles:true,cancelable:true}),point={clientX:x,clientY:y};
      Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[point]});
      Object.defineProperty(event,'changedTouches',{value:[point]});el.dispatchEvent(event);
    }
  });
  await expect(page.locator('#projectsView')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'test'}));
  await expect(page.locator('#monthTitle')).toHaveText(before);
});

test('overseas device keeps KST single-day events in columns and clips multi-day bands at exclusive midnight',async({browser})=>{
  const context=await browser.newContext({timezoneId:'America/Los_Angeles',viewport:{width:1280,height:844}}),page=await context.newPage();
  const ev=(id,start,end)=>({id,calendarId:'qa-cal',title:'QA '+id,start,end,color:'#4285f4'});
  try{
    await openEmphasisFixture(page,{view:'week',events:[
      ev('single','2026-10-15T15:00:00+09:00','2026-10-15T17:00:00+09:00'),
      ev('midnight','2026-10-15T09:00:00+09:00','2026-10-16T00:00:00+09:00'),
      ev('multi','2026-10-14T15:00:00+09:00','2026-10-16T00:00:00+09:00')
    ]});
    await expect(page.locator('.cwv-day[data-date="2026-10-15"] [data-google-event="single"]')).toBeVisible();
    await expect(page.locator('.cwv-day[data-date="2026-10-15"] [data-google-event="midnight"]')).toBeVisible();
    await expect(page.locator('.cwv-bands [data-google-event="single"],.cwv-bands [data-google-event="midnight"]')).toHaveCount(0);
    await expect(page.locator('.cwv-bands [data-google-event="multi"]')).toHaveCSS('grid-column','3 / span 2');
  }finally{await context.close()}
});
// BUG-일정색표시: 주간 시간 일정 칸도 종일 띠와 같은 일정별 색(왼쪽 색 띠·연한 배경)을 쓴다.
for(const width of [1024,1440])test(`week timed rows show their own event color like the bands at ${width}`,async({page})=>{
  const ev=(id,start,end,color,allDay=false)=>({id,title:'QA 색 '+id,calendarId:'qa-cal',start,end,allDay,color});
  await open(page,width,'week',[
    ev('red','2026-10-15T09:00:00+09:00','2026-10-15T10:00:00+09:00','#dc2127'),
    ev('green','2026-10-15T11:00:00+09:00','2026-10-15T12:00:00+09:00','#51b749'),
    ev('band','2026-10-15','2026-10-17','#dc2127',true)
  ]);
  // Read every row in one page task: the week owner may legitimately re-render (late task list) between separate reads.
  const {red,green,band}=await page.evaluate(()=>{const paint=sel=>{const s=getComputedStyle(document.querySelector(sel));return {stripe:s.borderLeftColor,width:s.borderLeftWidth,background:s.backgroundColor}};
    return {red:paint('#calendarWeek .cwv-items [data-google-event="red"]'),green:paint('#calendarWeek .cwv-items [data-google-event="green"]'),band:paint('#calendarWeek .cwv-bands [data-google-event="band"]')}});
  expect(red.stripe).toBe('rgb(220, 33, 39)');expect(green.stripe).toBe('rgb(81, 183, 73)');expect(red.width).toBe('4px');
  expect(red.stripe).toBe(band.stripe);expect(red.background).toBe(band.background);expect(red.background).not.toBe(green.background);expect(red.background).not.toBe('rgba(0, 0, 0, 0)');
  await expect(page.locator('#calendarWeek .cwv-items [data-google-event="red"] .clv-color')).toBeHidden();
  await page.getByRole('button',{name:'목록 보기',exact:true}).click();await expect(page.locator('#calendarList')).toBeVisible();
  // The list re-renders while its events reload; a web-first assertion re-finds the current row.
  await expect(page.locator('#calendarList [data-google-event="red"] .clv-color')).toHaveCSS('background-color','rgb(220, 33, 39)');
});
test('phone list keeps the small color bar and no week stripe rule',async({page})=>{
  const ev={id:'red',title:'QA 색 red',calendarId:'qa-cal',start:'2026-10-15T09:00:00+09:00',end:'2026-10-15T10:00:00+09:00',allDay:false,color:'#dc2127'};
  await open(page,390,'list',[ev]);await expect(page.locator('#calendarList')).toBeVisible();
  const row=page.locator('#calendarList [data-google-event="red"]');
  await expect(row.locator('.clv-color')).toHaveCSS('background-color','rgb(220, 33, 39)');
  await expect(row).toHaveCSS('border-left-width','0px');
});
// CAL-주간제목: 주간 일정 칸은 시간을 윗줄, 제목을 아랫줄(최대 2줄)에 두고 넘치면 말풍선(시간+전체 제목)을 보인다.
test('PC week event shows time above a 2-line title and a tooltip only when clipped (hover and focus)',async({page})=>{
  const long='아주 긴 일정 제목입니다 아주 긴 일정 제목입니다 아주 긴 일정 제목입니다 아주 긴 일정 제목입니다 아주 긴 일정 제목입니다';
  const ev=(id,title,start,end)=>({id,title,calendarId:'qa-cal',start,end,allDay:false,color:'#4285f4'});
  await open(page,1280,'week',[
    ev('short','짧은 제목','2026-10-15T09:00:00+09:00','2026-10-15T10:00:00+09:00'),
    ev('two','두 줄 제목 두 줄 제목 두 줄','2026-10-15T10:30:00+09:00','2026-10-15T11:30:00+09:00'),
    ev('long',long,'2026-10-15T12:00:00+09:00','2026-10-15T13:00:00+09:00')
  ]);
  const day=page.locator('.cwv-day[data-date="2026-10-15"]');
  const g=await day.locator('[data-google-event="long"]').evaluate(el=>{const t=el.querySelector('.clv-time').getBoundingClientRect(),h=el.querySelector('.clv-title'),hr=h.getBoundingClientRect(),cs=getComputedStyle(h);return {timeBottom:t.bottom,titleTop:hr.top,lines:Math.round(hr.height/parseFloat(cs.lineHeight)),clip:el.classList.contains('cwv-clipped'),width:el.getBoundingClientRect().width}});
  expect(g.titleTop).toBeGreaterThanOrEqual(g.timeBottom-1);expect(g.lines).toBe(2);expect(g.clip).toBe(true);
  const colWidth=(await day.boundingBox()).width;expect(g.width).toBeLessThanOrEqual(colWidth);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(1280);
  const long1=day.locator('[data-google-event="long"]'),tip=long1.locator('.cwv-tip');
  await expect(tip).toBeHidden();
  await long1.hover();await expect(tip).toBeVisible();
  await expect(tip).toHaveText('12:00 '+long);
  await page.mouse.move(0,0);await expect(tip).toBeHidden();
  await long1.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  await expect(long1).toBeFocused();await expect(tip).toBeVisible();
  await expect(long1).toHaveAccessibleName(new RegExp(long.slice(0,10)));
  for(const id of ['short','two']){
    const row=day.locator(`[data-google-event="${id}"]`);
    await row.hover();await expect(row.locator('.cwv-tip')).toBeHidden();
  }
});
test('phone list rows keep time and title on one line without tooltip',async({page})=>{
  const ev={id:'long',title:'아주 긴 일정 제목 '.repeat(8),calendarId:'qa-cal',start:'2026-10-15T09:00:00+09:00',end:'2026-10-15T10:00:00+09:00',allDay:false,color:'#dc2127'};
  await open(page,390,'list',[ev]);
  const row=page.locator('#calendarList [data-google-event="long"]');await expect(row).toBeVisible();
  await expect(row).toHaveCSS('flex-direction','row');await expect(row.locator('.cwv-tip')).toHaveCount(0);
  await expect(row.locator('.clv-title')).toHaveCSS('white-space','nowrap');
});
