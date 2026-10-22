import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

// CAL-주간시간표: PC 주간 보기는 시간 일정 카드를 실제 시각 높이에 놓는 시간표다(1시간 48px, 0~7시는 비면 접힘).
test.use({timezoneId:'Asia/Seoul'});
const HOUR=48,FOLD=24;
const ev=(id,start,end,extra={})=>({id,title:'QA 시간표 '+id,calendarId:'qa-cal',start,end,allDay:false,color:'#4285f4',...extra});
async function open(page,width,events,now){
  await page.setViewportSize({width,height:900});
  await openEmphasisFixture(page,{view:'week',events,...(now?{now}:{})});
  await page.evaluate(()=>window.__KPTU_CALENDAR_PERSISTENCE_READY__);
  await expect(page.locator('#calendarWeek')).toBeVisible();
}
// 한 번의 페이지 작업에서 칸 위치를 모두 읽는다(늦게 온 할 일 목록으로 다시 그려져도 값이 섞이지 않게).
const geometry=page=>page.evaluate(()=>{
  const r=el=>el.getBoundingClientRect();
  const lines=[...document.querySelectorAll('#calendarWeek .cwv-timeline')].map(t=>({date:t.closest('.cwv-day').dataset.date,top:r(t).top+t.clientTop,left:r(t).left,width:r(t).width,height:t.clientHeight}));
  const cards=Object.fromEntries([...document.querySelectorAll('#calendarWeek .cwv-items [data-google-event]')].map(el=>[el.dataset.googleEvent,{date:el.closest('.cwv-day').dataset.date,top:r(el).top,height:r(el).height,left:r(el).left,width:r(el).width}]));
  const ticks=[...document.querySelectorAll('#calendarWeek .cwv-tick')].map(t=>({text:t.textContent,top:r(t).top}));
  const fold=document.querySelector('#calendarWeek .cwv-fold');
  const now=document.querySelector('#calendarWeek .cwv-now');
  return {lines,cards,ticks,fold:fold?{text:fold.textContent,height:r(fold).height}:null,now:now?{date:now.closest('.cwv-day').dataset.date,top:r(now).top+r(now).height/2,color:getComputedStyle(now).backgroundColor}:null,scroll:document.documentElement.scrollWidth};
});
const lineOf=(g,date)=>g.lines.find(l=>l.date===date);

for(const width of [1280,1440,1920])test(`timetable places cards by time and length, folds 0~7시 and draws the now line at ${width}`,async({page})=>{
  await open(page,width,[
    ev('nine','2026-10-15T09:00:00+09:00','2026-10-15T10:30:00+09:00'),
    ev('two-pm','2026-10-13T14:00:00+09:00','2026-10-13T15:00:00+09:00'),
    ev('half','2026-10-16T18:30:00+09:00','2026-10-16T19:00:00+09:00'),
    ev('allday','2026-10-14','2026-10-15',true),
    ev('span','2026-10-15','2026-10-17',true)
  ]);
  const g=await geometry(page);
  expect(g.scroll).toBe(width);
  // 0~7시는 접힌 한 줄, 7시부터 1시간 48px.
  expect(g.fold?.text).toBe('0–7시');expect(g.fold.height).toBeCloseTo(FOLD,0);
  expect(g.ticks[0].text).toBe('7시');expect(g.ticks.at(-1).text).toBe('23시');
  const thu=lineOf(g,'2026-10-15');expect(thu.height).toBeCloseTo(FOLD+17*HOUR,0);
  const nine=g.cards.nine;expect(nine.date).toBe('2026-10-15');
  expect(nine.top-thu.top).toBeCloseTo(FOLD+2*HOUR,0);expect(nine.height).toBeCloseTo(1.5*HOUR,0);
  const tue=lineOf(g,'2026-10-13');expect(g.cards['two-pm'].top-tue.top).toBeCloseTo(FOLD+7*HOUR,0);expect(g.cards['two-pm'].height).toBeCloseTo(HOUR,0);
  const fri=lineOf(g,'2026-10-16');expect(g.cards.half.top-fri.top).toBeCloseTo(FOLD+11.5*HOUR,0);expect(g.cards.half.height).toBeCloseTo(HOUR/2,0);
  // 시간 눈금 9시는 9시 카드 윗변과 같은 높이에 있다(가로 보조선과 정렬).
  const tick9=g.ticks.find(t=>t.text==='9시');expect(Math.abs(tick9.top+7-nine.top)).toBeLessThanOrEqual(2);
  // 지금 선: 고정 시각 2026-10-15 12:00 KST, 오늘(목) 칸에만.
  expect(g.now?.date).toBe('2026-10-15');expect(g.now.color).toBe('rgb(180, 35, 24)');
  expect(g.now.top-thu.top).toBeCloseTo(FOLD+5*HOUR,0);
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
  const sat=page.locator('.cwv-day[data-date="2026-10-17"]'),create=await sat.locator('.cwv-create').boundingBox(),satLine=lineOf(g,'2026-10-17');
  await sat.locator('.cwv-create').click({position:{x:10,y:satLine.top-create.y+FOLD+3*HOUR}});
  await expect(page.locator('#eventModal')).toBeVisible();await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-17');
});

test('early and late-night events unfold only the needed early hours',async({page})=>{
  await open(page,1440,[
    ev('dawn','2026-10-14T05:30:00+09:00','2026-10-14T06:30:00+09:00'),
    ev('night','2026-10-16T22:00:00+09:00','2026-10-17T00:00:00+09:00')
  ]);
  const g=await geometry(page);
  expect(g.fold?.text).toBe('0–5시');expect(g.ticks[0].text).toBe('5시');
  const wed=lineOf(g,'2026-10-14');expect(g.cards.dawn.top-wed.top).toBeCloseTo(FOLD+0.5*HOUR,0);expect(g.cards.dawn.height).toBeCloseTo(HOUR,0);
  expect(wed.height).toBeCloseTo(FOLD+19*HOUR,0);
  const fri=lineOf(g,'2026-10-16');expect(g.cards.night.top+g.cards.night.height).toBeCloseTo(fri.top+fri.height,0);
  // 다음 주에는 새벽 일정이 없으므로 다시 접힌다.
  await page.locator('#nextMonthBtn').click();await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-19');
  await expect(page.locator('#calendarWeek .cwv-fold')).toHaveText('0–7시');
});

test('midnight event fully unfolds without the folded row',async({page})=>{
  await open(page,1280,[ev('zero','2026-10-13T00:30:00+09:00','2026-10-13T02:00:00+09:00')]);
  const g=await geometry(page);
  expect(g.fold).toBe(null);expect(g.ticks[0].text).toBe('0시');
  const tue=lineOf(g,'2026-10-13');expect(g.cards.zero.top-tue.top).toBeCloseTo(0.5*HOUR,0);expect(tue.height).toBeCloseTo(24*HOUR,0);
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
  expect(g.cards.long.top-thu.top).toBeCloseTo(FOLD+6*HOUR,0);expect(g.cards.long.width).toBeGreaterThan(before*0.9);expect(g.scroll).toBe(1440);
});

test('phone keeps the list view without the timetable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await openEmphasisFixture(page,{view:'week',events:[ev('nine','2026-10-15T09:00:00+09:00','2026-10-15T10:30:00+09:00')]});
  await expect(page.locator('#calendarList')).toBeVisible();await expect(page.locator('#calendarWeek')).toBeHidden();
  await expect(page.locator('#calendarList .cwv-timeline,#calendarList .cwv-now')).toHaveCount(0);
});
