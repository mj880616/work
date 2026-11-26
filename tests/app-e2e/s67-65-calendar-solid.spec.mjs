import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
import {server,installServer} from './helpers/report-plan-marks-server.mjs';
import {expectGoogleDisplay} from './helpers/calendar-google-display.mjs';
import {toneColor,eventInk} from '../../app/event-color.mjs';

// S67-65 CAL-꽉찬색(사용자 11/21 시안 E1): 구글 일정 칩은 꽉 찬 색 바탕 + 대비 글자.
// S68-03 G2(사용자 11/22): 색은 구글보다 한 톤만 차분한 밝은 색, 글자는 흰색 기본(흰 2.7:1 이상, 밝은 노랑만 진한 글자).
// 월·주(시간표 칸·종일 띠)·하루 목록은 꽉 찬 칩, 목록 보기·홈 '그날 일정'은 같은 색의 띠. 모두 같은 색 함수(event-color.mjs)를 쓴다.
// 서버는 흉내(가짜 일정·가짜 이름, helpers/report-plan-marks-server.mjs).
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
test.use({timezoneId:'Asia/Seoul'});
const rgbOf=hex=>`rgb(${hex.slice(1).match(/../g).map(x=>parseInt(x,16)).join(', ')})`;
// 토마토(흰 글자)·바나나(진한 글자)·블루베리·바질, 색 없는 일정은 캘린더 기본색.
const COLORS={done1:'#dc2127',todo2:'#fbd75b',off1:'#5484ed',day1:'#51b749'};
function coloredServer(){
  const state=server({tasks:false});
  for(const ev of state.events)if(COLORS[ev.id])ev.color=COLORS[ev.id];
  return state;
}
async function open(page,{width,view='month',target='calendar',dark=false}){
  await page.setViewportSize({width,height:width<=760?900:844});
  if(dark)await page.emulateMedia({colorScheme:'dark'});
  await page.clock.setFixedTime(new Date('2026-11-10T00:00:00Z'));
  await installViewPrefsServer(page,{calendar_view:view});
  await installServer(page,coloredServer(),{base:BASE});
  await page.goto(loginEntry(BASE+'/app/?view='+target));
  await signInWithSession(page,'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
}
const chip=(page,root,id)=>page.locator(`${root} [data-google-event="${id}"]`).first();
async function expectSolid(page,root,id,raw){
  const c=chip(page,root,id);await expect(c).toBeVisible();
  // S68-57: 자료가 다 와서 마지막으로 그린 칩의 칠을 기다린 뒤(다시 그릴 때마다 새 요소) 대비를 본다.
  await expect(c).toHaveCSS('background-color',rgbOf(toneColor(raw)));
  await expect(c).toHaveCSS('color',rgbOf(eventInk(toneColor(raw))));
  const {background,foreground}=await expectGoogleDisplay(c);
  expect(`rgb(${background.map(Math.round).join(', ')})`).toBe(rgbOf(toneColor(raw)));
  expect(`rgb(${foreground.map(Math.round).join(', ')})`).toBe(rgbOf(eventInk(toneColor(raw))));
}

for(const width of [412,1280])for(const dark of [false,true])test(`${width}${dark?' 다크':''} 월 보기: 일정 칩은 꽉 찬 색 + 대비 글자(밝은 노랑은 진한 글자)`,async({page})=>{
  await open(page,{width,dark});
  for(const [id,raw] of Object.entries(COLORS))await expectSolid(page,'#calendarGrid',id,raw);
  await expectSolid(page,'#calendarGrid','none1','#336699'); // 색 없는 일정 = 캘린더 기본색의 톤
  expect(eventInk(toneColor('#fbd75b'))).toBe('#2a2410');
  expect(eventInk(toneColor('#dc2127'))).toBe('#ffffff');
  expect(toneColor('#dc2127')).toBe('#d8503c'); // G2 토마토
  expect(toneColor('#fbd75b')).toBe('#eebe4e'); // G2 바나나
});

// 주 보기는 넓은 화면에만 있다(폰은 목록 보기).
for(const width of [1024,1280])test(`${width} 주 보기: 시간표 칸·종일 띠 모두 꽉 찬 색`,async({page})=>{
  await open(page,{width,view:'week'});
  await expectSolid(page,'#calendarWeek .cwv-items','done1',COLORS.done1);
  await expectSolid(page,'#calendarWeek .cwv-items','todo2',COLORS.todo2);
  await expectSolid(page,'#calendarWeek','day1',COLORS.day1);
});

test('하루 목록 창: 일정 줄도 꽉 찬 색',async({page})=>{
  await open(page,{width:412});
  await page.locator('.cal-cell[data-date="2026-11-10"] .cal-day').first().click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expectSolid(page,'#calendarDayList','done1',COLORS.done1);
  await expectSolid(page,'#calendarDayList','todo2',COLORS.todo2);
});

test('목록 보기: 색 띠는 같은 톤 낮춘 색',async({page})=>{
  await open(page,{width:412,view:'list'});
  const stripe=page.locator('#calendarList [data-google-event="done1"] .clv-color').first();
  await expect(stripe).toHaveCSS('background-color',rgbOf(toneColor(COLORS.done1)));
});

test('홈 그날 일정: 색 띠는 같은 톤 낮춘 색',async({page})=>{
  await open(page,{width:412,target:'home'});
  const bar=page.locator('[data-journal-schedule] .journal-event').filter({hasText:'주간 점검 회의'}).locator('.journal-event-bar');
  await expect(bar).toHaveCSS('background-color',rgbOf(toneColor(COLORS.done1)));
  const bright=page.locator('[data-journal-schedule] .journal-event').filter({hasText:'분기 계획 모임'}).locator('.journal-event-bar');
  await expect(bright).toHaveCSS('background-color',rgbOf(toneColor(COLORS.todo2)));
});
