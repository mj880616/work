import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

// CAL-주간시간표 + CAL-주간고정: PC 주간 보기는 시간 일정 카드를 실제 시각 높이에 놓는 시간표다(1시간 48px, 0~24시 항상 펼침).
// 날짜 줄·종일 띠는 시간표를 내려도 고정이고, 처음에는 7시부터 보이며 0~7시는 위로 올려서 본다.
test.use({timezoneId:'Asia/Seoul'});
const HOUR=48;
const ev=(id,start,end,extra={})=>({id,title:'QA 시간표 '+id,calendarId:'qa-cal',start,end,allDay:false,color:'#4285f4',...extra});
async function open(page,width,events,now){
  await page.setViewportSize({width,height:900});
  await openEmphasisFixture(page,{view:'week',events,...(now?{now}:{})});
  await expect(page.locator('#calendarWeek')).toBeVisible();
}
// 한 번의 페이지 작업에서 칸 위치를 모두 읽는다(늦게 온 할 일 목록으로 다시 그려져도 값이 섞이지 않게).
const geometry=page=>page.evaluate(()=>{
  const r=el=>el.getBoundingClientRect();
  const lines=[...document.querySelectorAll('#calendarWeek .cwv-timeline')].map(t=>({date:t.closest('.cwv-day').dataset.date,top:r(t).top+t.clientTop,left:r(t).left,width:r(t).width,height:t.clientHeight}));
  const cards=Object.fromEntries([...document.querySelectorAll('#calendarWeek .cwv-items [data-google-event]')].map(el=>[el.dataset.googleEvent,{date:el.closest('.cwv-day').dataset.date,top:r(el).top,height:r(el).height,left:r(el).left,width:r(el).width}]));
  const ticks=[...document.querySelectorAll('#calendarWeek .cwv-tick')].map(t=>({text:t.textContent,top:r(t).top}));
  const now=document.querySelector('#calendarWeek .cwv-now');
  return {lines,cards,ticks,now:now?{date:now.closest('.cwv-day').dataset.date,top:r(now).top+r(now).height/2,color:getComputedStyle(now).backgroundColor}:null,scroll:document.documentElement.scrollWidth};
});
const lineOf=(g,date)=>g.lines.find(l=>l.date===date);

for(const width of [1280,1440,1920])test(`timetable places cards by time and length, opens at 7시 and draws the now line at ${width}`,async({page})=>{
  await open(page,width,[
    ev('nine','2026-10-15T09:00:00+09:00','2026-10-15T10:30:00+09:00'),
    ev('two-pm','2026-10-13T14:00:00+09:00','2026-10-13T15:00:00+09:00'),
    ev('half','2026-10-16T18:30:00+09:00','2026-10-16T19:00:00+09:00'),
    ev('allday','2026-10-14','2026-10-15',true),
    ev('span','2026-10-15','2026-10-17',true)
  ]);
  let g=await geometry(page);
  expect(g.scroll).toBe(width);
  // 0~24시를 모두 펼치고 1시간 48px, 처음에는 맨 위 눈금이 7시.
  expect(g.ticks[0].text).toBe('0시');expect(g.ticks.at(-1).text).toBe('23시');
  await page.evaluate(()=>{document.querySelector('#calendarWeek').scrollTop=0});g=await geometry(page);
  const thu=lineOf(g,'2026-10-15');expect(thu.height).toBeCloseTo(24*HOUR,0);
  const nine=g.cards.nine;expect(nine.date).toBe('2026-10-15');
  expect(nine.top-thu.top).toBeCloseTo(9*HOUR,0);expect(nine.height).toBeCloseTo(1.5*HOUR,0);
  const tue=lineOf(g,'2026-10-13');expect(g.cards['two-pm'].top-tue.top).toBeCloseTo(14*HOUR,0);expect(g.cards['two-pm'].height).toBeCloseTo(HOUR,0);
  const fri=lineOf(g,'2026-10-16');expect(g.cards.half.top-fri.top).toBeCloseTo(18.5*HOUR,0);expect(g.cards.half.height).toBeCloseTo(HOUR/2,0);
  // 시간 눈금 9시는 9시 카드 윗변과 같은 높이에 있다(가로 보조선과 정렬).
  const tick9=g.ticks.find(t=>t.text==='9시');expect(Math.abs(tick9.top-2-nine.top)).toBeLessThanOrEqual(2);
  // 지금 선: 고정 시각 2026-10-15 12:00 KST, 오늘(목) 칸에만.
  expect(g.now?.date).toBe('2026-10-15');expect(g.now.color).toBe('rgb(180, 35, 24)');
  expect(g.now.top-thu.top).toBeCloseTo(12*HOUR,0);
  await expect(page.locator('#calendarWeek .cwv-now')).toHaveCount(1);
  // 종일·여러 날 일정은 위쪽 띠 그대로, 시간표에는 없다.
  await expect(page.locator('#calendarWeek .cwv-bands [data-google-event="span"]')).toHaveCSS('grid-column','4 / span 2');
  await expect(page.locator('#calendarWeek .cwv-bands [data-google-event="allday"]')).toHaveCSS('grid-column','3 / span 1');
  await expect(page.locator('#calendarWeek .cwv-items [data-google-event="span"],#calendarWeek .cwv-items [data-google-event="allday"]')).toHaveCount(0);
  const band=await page.locator('#calendarWeek .cwv-bands [data-google-event="span"]').boundingBox();
  expect(band.y+band.height).toBeLessThanOrEqual(thu.top+1);
  // 누르면 수정 창(시간 카드·띠 모두).
  await page.locator('#calendarWeek .cwv-items [data-google-event="nine"]').click();await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await page.locator('#ciGoogleClose').first().click();await expect(page.locator('#ciGoogleModal')).toBeHidden();
  await page.locator('#calendarWeek .cwv-bands [data-google-event="span"]').click();await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await page.locator('#ciGoogleClose').first().click();
  // 빈 칸을 누르면 새 일정 창(그날 날짜).
  const sat=page.locator('.cwv-day[data-date="2026-10-17"]');
  await expect(async()=>{
    const create=await sat.locator('.cwv-create').boundingBox(),tl=await sat.locator('.cwv-timeline').boundingBox();
    await sat.locator('.cwv-create').click({position:{x:10,y:tl.y-create.y+10*HOUR},timeout:2000});
  }).toPass({timeout:10000});
  await expect(page.locator('#eventModal')).toBeVisible();await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-17');
});

// 시간표 칸(.cwv-timeline)·날짜 줄·종일 띠·눈금의 현재 화면 위치를 한 번에 읽는다.
const frame=page=>page.evaluate(()=>{
  const r=el=>el.getBoundingClientRect(),box=document.querySelector('#calendarWeek'),b=r(box);
  const day=document.querySelector('.cwv-day');
  const band=document.querySelector('#calendarWeek .cwv-bands [data-google-event]');
  const ticks=[...document.querySelectorAll('#calendarWeek .cwv-tick')].map(t=>({text:t.textContent,top:r(t).top})).filter(t=>t.top>=b.top);
  const capBottom=r(day.querySelector('.cwv-cap')).bottom;
  const visibleTicks=ticks.filter(t=>t.top>=capBottom-0.5);
  return {scrollTop:box.scrollTop,max:box.scrollHeight-box.clientHeight,boxTop:b.top,head:r(day.querySelector('.cwv-header')).top,date:r(day.querySelector('.cwv-date')).top,band:band?r(band).top:null,
    tl:r(day.querySelector('.cwv-timeline')).top,capBottom,firstTick:visibleTicks[0]?.text,boxBottom:b.bottom,viewport:innerHeight};
});

for(const width of [1280,1440])test(`date row and all-day band stay put while the timetable scrolls, and it opens at 7시 at ${width}`,async({page})=>{
  await open(page,width,[
    ev('nine','2026-10-15T09:00:00+09:00','2026-10-15T10:30:00+09:00'),
    ev('span','2026-10-14','2026-10-17',true)
  ]);
  await expect.poll(()=>frame(page).then(f=>f.scrollTop)).toBeCloseTo(7*HOUR,0);
  const first=await frame(page);
  expect(first.firstTick).toBe('7시');
  expect(first.max).toBeGreaterThan(7*HOUR);
  // 시간표 윗변은 7시 높이만큼 위로 올라가 있다.
  await page.evaluate(()=>{document.querySelector('#calendarWeek').scrollTop=600});
  const moved=await frame(page);
  expect(moved.tl).toBeLessThan(first.tl-200);
  expect(Math.abs(moved.head-first.head)).toBeLessThanOrEqual(1);expect(Math.abs(moved.date-first.date)).toBeLessThanOrEqual(1);expect(Math.abs(moved.band-first.band)).toBeLessThanOrEqual(1);
  // 맨 아래까지 내려도 같다.
  await page.evaluate(()=>{const b=document.querySelector('#calendarWeek');b.scrollTop=b.scrollHeight});
  const bottom=await frame(page);
  expect(Math.abs(bottom.head-first.head)).toBeLessThanOrEqual(1);expect(Math.abs(bottom.band-first.band)).toBeLessThanOrEqual(1);
  expect(bottom.boxBottom).toBeLessThanOrEqual(bottom.viewport);// 주간 칸이 화면 안에 들어와 시간표만 안에서 스크롤
  // 고정 줄 밑으로 지나가는 일정 카드는 눌러지지 않는다(띠 영역은 가려진다).
  const hit=await page.evaluate(()=>{const b=document.querySelector('#calendarWeek .cwv-bands [data-google-event]').getBoundingClientRect();return document.elementFromPoint(b.left+b.width/2,b.top+b.height/2).closest('[data-google-event]')?.dataset.googleEvent});
  expect(hit).toBe('span');
  // 다시 맨 위로 올리면 0시 눈금.
  await page.evaluate(()=>{document.querySelector('#calendarWeek').scrollTop=0});
  expect((await frame(page)).firstTick).toBe('0시');
});

test('week change opens at 7시 again, and the same week keeps its scroll when redrawn',async({page})=>{
  await open(page,1440,[ev('nine','2026-10-15T09:00:00+09:00','2026-10-15T10:30:00+09:00'),ev('next','2026-10-22T09:00:00+09:00','2026-10-22T10:00:00+09:00')]);
  await expect.poll(()=>frame(page).then(f=>f.scrollTop)).toBeCloseTo(7*HOUR,0);
  await page.evaluate(()=>{document.querySelector('#calendarWeek').scrollTop=100});
  await page.locator('#nextMonthBtn').click();await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-19');
  await expect.poll(()=>frame(page).then(f=>f.scrollTop)).toBeCloseTo(7*HOUR,0);
  await page.locator('#prevMonthBtn').click();await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-12');
  await expect.poll(()=>frame(page).then(f=>f.scrollTop)).toBeCloseTo(7*HOUR,0);
});

test('no dawn badge, and a night event reaches the bottom of its column',async({page})=>{
  await open(page,1280,[
    ev('dawn','2026-10-14T05:30:00+09:00','2026-10-14T06:30:00+09:00'),
    ev('zero','2026-10-16T00:30:00+09:00','2026-10-16T01:00:00+09:00'),
    ev('night','2026-10-16T22:00:00+09:00','2026-10-17T00:00:00+09:00')
  ]);
  await expect(page.locator('#calendarWeek .cwv-early')).toHaveCount(0);
  await expect(page.locator('#calendarWeek')).not.toContainText('새벽 일정');
  const g=await geometry(page),fri=lineOf(g,'2026-10-16');
  expect(g.cards.night.top+g.cards.night.height).toBeCloseTo(fri.top+fri.height,0);
});

// CAL-주간고정보완: 7시 선이 고정 줄 바로 밑에 붙는다(빈 띠 없음). 열 때·주 이동·'오늘'에만 맞추고, 그 밖에는 사용자가 놓은 자리를 둔다.
const edge=page=>page.evaluate(()=>{
  const r=el=>el.getBoundingClientRect(),box=document.querySelector('#calendarWeek');
  const day=document.querySelector('.cwv-day[data-date="2026-10-15"]');
  const card=day.querySelector('.cwv-items [data-google-event]'),c=r(card),x=c.left+c.width/2;
  const stickBottom=Math.max(r(day.querySelector('.cwv-header')).bottom,r(day.querySelector('.cwv-cap')).bottom);
  let clip=null;for(let y=r(day.querySelector('.cwv-header')).top;y<c.bottom;y+=0.5){if(document.elementFromPoint(x,y)?.closest('.cwv-items [data-google-event]')){clip=y;break}}
  const tl=r(day.querySelector('.cwv-timeline'));
  return {scrollTop:box.scrollTop,stickBottom,clip,seven:tl.top+tl.height/24*7};
});
for(const [width,extra] of [[1280,[]],[1440,[ev('span','2026-10-14','2026-10-17',{allDay:true})]],[1920,[ev('span','2026-10-14','2026-10-17',{allDay:true}),ev('span2','2026-10-13','2026-10-15',{allDay:true})]]])
test(`7시 line sits flush under the sticky rows and cards are clipped exactly there at ${width}${extra.length?' with '+extra.length+' all-day lane(s)':''}`,async({page})=>{
  await open(page,width,[ev('long','2026-10-15T05:00:00+09:00','2026-10-15T20:00:00+09:00',{title:'Arsenal (2-2)'}),...extra]);
  await expect.poll(()=>edge(page).then(f=>f.scrollTop)).toBe(7*HOUR);
  let f=await edge(page);
  expect(Math.abs(f.seven-f.stickBottom)).toBeLessThanOrEqual(1);// 7시 선 = 고정 줄 아래 끝
  expect(f.clip).toBeCloseTo(f.stickBottom,0);// 카드가 가려지기 시작하는 곳 = 고정 줄 아래 끝(빈 띠 없음)
  await page.evaluate(()=>{document.querySelector('#calendarWeek').scrollTop=300});
  f=await edge(page);expect(f.clip).toBeCloseTo(f.stickBottom,0);
});

test('opens at 7시 on first open, next week and 오늘, and leaves the scroll alone otherwise',async({page})=>{
  await open(page,1280,[ev('nine','2026-10-15T09:00:00+09:00','2026-10-15T10:30:00+09:00')]);
  const top=()=>page.evaluate(()=>document.querySelector('#calendarWeek').scrollTop);
  await expect.poll(top).toBe(7*HOUR);
  // 사용자가 올려 본 자리는 그대로(같은 주를 다시 그려도).
  await page.evaluate(()=>{document.querySelector('#calendarWeek').scrollTop=100});
  await page.evaluate(()=>window.__KPTU_RENDER_CALENDAR__());
  expect(await top()).toBe(100);
  await page.locator('#nextMonthBtn').click();await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-19');
  await expect.poll(top).toBe(7*HOUR);
  await page.evaluate(()=>{document.querySelector('#calendarWeek').scrollTop=500});
  await page.locator('#calendarTodayBtn').click();await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-12');
  await expect.poll(top).toBe(7*HOUR);
  // 같은 주에서 위로 올린 뒤 '오늘'을 눌러도 7시로 돌아온다.
  await page.evaluate(()=>{document.querySelector('#calendarWeek').scrollTop=20});
  await page.locator('#calendarTodayBtn').click();
  await expect.poll(top).toBe(7*HOUR);
});

test('opens at 7시 when the calendar is first shown from another screen',async({page})=>{
  await open(page,1280,[ev('nine','2026-10-15T09:00:00+09:00','2026-10-15T10:30:00+09:00')]);
  await page.locator('nav >> text=홈').first().click();
  await expect(page.locator('#calendarWeek')).toBeHidden();
  await page.locator('nav >> text=달력').first().click();
  await expect(page.locator('#calendarWeek')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#calendarWeek').scrollTop)).toBe(7*HOUR);
});

test('midnight event is placed from 0시',async({page})=>{
  await open(page,1280,[ev('zero','2026-10-13T00:30:00+09:00','2026-10-13T02:00:00+09:00')]);
  const g=await geometry(page);
  expect(g.ticks[0].text).toBe('0시');
  const tue=lineOf(g,'2026-10-13');expect(g.cards.zero.top-tue.top).toBeCloseTo(0.5*HOUR,0);expect(tue.height).toBeCloseTo(24*HOUR,0);
});

// ③ 종일·여러 날 줄: 제목이 잘리면 마우스·키보드 포커스로 전체 제목 말풍선.
test('clipped all-day band title shows a tooltip on hover and focus, short ones do not',async({page})=>{
  const long='아주 긴 종일 일정 제목입니다 '.repeat(5).trim();
  await open(page,1280,[ev('long','2026-10-14','2026-10-15',{title:long,allDay:true}),ev('short','2026-10-15','2026-10-16',{title:'짧은 종일',allDay:true})]);
  const l=page.locator('#calendarWeek .cwv-bands [data-google-event="long"]'),sh=page.locator('#calendarWeek .cwv-bands [data-google-event="short"]');
  await expect(l.locator('.cwv-tip')).toBeHidden();
  await page.evaluate(()=>{document.querySelector('#calendarWeek').scrollTop=500});
  await l.hover();await expect(l.locator('.cwv-tip')).toBeVisible();await expect(l.locator('.cwv-tip')).toHaveText(long);
  await page.mouse.move(0,0);await expect(l.locator('.cwv-tip')).toBeHidden();
  await l.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  await expect(l).toBeFocused();await expect(l.locator('.cwv-tip')).toBeVisible();
  await expect(l).toHaveAccessibleName(new RegExp(long.slice(0,8)));
  await sh.hover();await expect(sh.locator('.cwv-tip')).toBeHidden();
});

for(const width of [1280,1440,1920])test(`overlapping events sit side by side at ${width}`,async({page})=>{
  await open(page,width,[
    ev('a','2026-10-15T09:00:00+09:00','2026-10-15T11:00:00+09:00'),
    ev('b','2026-10-15T10:00:00+09:00','2026-10-15T12:00:00+09:00'),
    ev('c','2026-10-15T11:00:00+09:00','2026-10-15T11:30:00+09:00'),
    ev('solo','2026-10-15T14:00:00+09:00','2026-10-15T15:00:00+09:00')
  ]);
  const g=await geometry(page),thu=lineOf(g,'2026-10-15'),{a,b,c,solo}=g.cards;
  expect(a.width).toBeLessThan(thu.width/2+1);expect(b.width).toBeLessThan(thu.width/2+1);
  expect(b.left).toBeGreaterThanOrEqual(a.left+a.width-1);
  expect(Math.abs(c.left-a.left)).toBeLessThanOrEqual(1);
  expect(b.left+b.width).toBeLessThanOrEqual(thu.left+thu.width+1);
  expect(solo.width).toBeGreaterThan(thu.width*0.9);
  // 나란히 놓인 카드도 누르면 각자 수정 창.
  await page.locator('#calendarWeek [data-google-event="b"]').click();await expect(page.locator('#ciGoogleModal')).toBeVisible();
});

test('timetable keeps color stripe, 2-line title and tooltip, and widens with the hidden sidebar',async({page})=>{
  const long='아주 긴 일정 제목입니다 '.repeat(6).trim();
  await open(page,1440,[ev('long','2026-10-15T13:00:00+09:00','2026-10-15T14:00:00+09:00',{title:long,color:'#dc2127'})]);
  const card=page.locator('#calendarWeek .cwv-items [data-google-event="long"]');
  await expect(card).toHaveCSS('border-left-color','rgb(220, 33, 39)');await expect(card).toHaveCSS('border-left-width','4px');
  const lines=await card.evaluate(el=>{const t=el.querySelector('.clv-title'),tm=el.querySelector('.clv-time');return {lines:Math.round(t.getBoundingClientRect().height/parseFloat(getComputedStyle(t).lineHeight)),below:t.getBoundingClientRect().top>=tm.getBoundingClientRect().bottom-1}});
  expect(lines).toEqual({lines:2,below:true});
  await card.hover();await expect(card.locator('.cwv-tip')).toBeVisible();await expect(card.locator('.cwv-tip')).toHaveText('13:00 '+long);
  const before=(await page.locator('.cwv-day[data-date="2026-10-15"]').boundingBox()).width;
  await page.locator('[data-app-topline] [data-nav-toggle]').click();
  await expect(page.locator('#appView')).toHaveClass(/nav-collapsed/);
  await expect.poll(async()=>(await page.locator('.cwv-day[data-date="2026-10-15"]').boundingBox()).width).toBeGreaterThan(before+10);
  const g=await geometry(page),thu=lineOf(g,'2026-10-15');
  expect(g.cards.long.top-thu.top).toBeCloseTo(13*HOUR,0);expect(g.cards.long.width).toBeGreaterThan(before*0.9);expect(g.scroll).toBe(1440);
});

test('phone keeps the list view without the timetable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await openEmphasisFixture(page,{view:'week',events:[ev('nine','2026-10-15T09:00:00+09:00','2026-10-15T10:30:00+09:00')]});
  await expect(page.locator('#calendarList')).toBeVisible();await expect(page.locator('#calendarWeek')).toBeHidden();
  await expect(page.locator('#calendarList .cwv-timeline,#calendarList .cwv-now')).toHaveCount(0);
});
