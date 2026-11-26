import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';
test.use({timezoneId:'Asia/Seoul'});
// S69-21 CAL-말풍선통일(사용자 11/24 "달력 할일에 커서 대면 이런식임"): 월 보기 칸 안 할 일 줄에 마우스를 올리면 브라우저 기본 표시
// ('할 일: 제목' 작은 상자)가 칸 안에 끼어 보이던 것을, 일정 막대와 같은 공용 말풍선(calendar-tip.js, .cwv-tip)으로 바꾼다.
// 잘린 제목만 띄우고, 화면 기준으로 떠서 칸 높이·다른 줄 위치가 그대로이며, 화면 가장자리 안에 들어온다.
const LONG='아주 긴 할 일 제목입니다 다음 주 회의 자료 정리와 보내기까지 끝내기';
const LONG_EVENT='아주 긴 일정 제목입니다 다음 주 회의 장소 확인과 자료 준비까지';
const task=(id,title,date,list='QA')=>({id,title,taskListId:'@default',taskListTitle:list,due:date+'T00:00:00.000Z',notes:'',status:'needsAction',source:'google-task'});
const TASKS=[task('long',LONG,'2026-10-20'),task('short','짧은 일','2026-10-21'),task('edge',LONG,'2026-10-24','다른 목록')];
const EVENTS=[
  {id:'blue-0',calendarId:'qa-cal',source:'google',title:'파란 일정 시험 1',start:'2026-10-20',end:'2026-10-21',allDay:true,color:'#4285f4'},
  {id:'long-ev',calendarId:'qa-cal',source:'google',title:LONG_EVENT,start:'2026-10-22',end:'2026-10-23',allDay:true,color:'#4285f4'}
];
const SHOT=process.env.CAL_TIP_SHOT||'';

test('PC 1440 month: a clipped task line shows the same floating tip as event bars without moving the cell (S69-21)',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await openEmphasisFixture(page,{tasks:TASKS,events:EVENTS});
  const grid=page.locator('#calendarGrid');
  const line=grid.locator('.cmv-cell-task[data-calendar-task="long"]');
  await expect(line).toBeVisible();
  // 브라우저 기본 표시(title)는 쓰지 않는다. 읽기 이름은 그대로.
  await expect(line).not.toHaveAttribute('title',/.*/);
  await expect(line).toHaveAccessibleName('할 일: '+LONG);
  await expect(grid.locator('[data-google-event] [title], [data-google-event][title], .cmv-cell-task[title]')).toHaveCount(0);
  const before=await page.evaluate(()=>{
    const cell=document.querySelector('.cal-cell[data-date="2026-10-20"]').getBoundingClientRect();
    const rows=[...document.querySelectorAll('.cmv-week')].map(w=>w.getBoundingClientRect().height);
    const ev=document.querySelector('#calendarGrid [data-google-event="blue-0"]').getBoundingClientRect();
    return {cell:cell.height,rows,evTop:ev.top};
  });
  await line.hover();
  const tip=line.locator('.cwv-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(LONG+' · QA');
  await expect(tip).toHaveAttribute('aria-hidden','true');
  const geo=await page.evaluate(()=>{
    const host=document.querySelector('.cmv-cell-task[data-calendar-task="long"]'),tip=host.querySelector('.cwv-tip');
    const h=host.getBoundingClientRect(),t=tip.getBoundingClientRect(),cs=getComputedStyle(tip);
    // 말풍선은 누름을 받지 않는다(pointer-events:none). 위에 그려지는지만 보려고 잠깐 켜서 그 자리 맨 위 요소를 본다.
    tip.style.pointerEvents='auto';const top=document.elementFromPoint(t.left+4,t.bottom-4);tip.style.pointerEvents='';
    const cell=document.querySelector('.cal-cell[data-date="2026-10-20"]').getBoundingClientRect();
    const rows=[...document.querySelectorAll('.cmv-week')].map(w=>w.getBoundingClientRect().height);
    const ev=document.querySelector('#calendarGrid [data-google-event="blue-0"]').getBoundingClientRect();
    return {position:cs.position,below:t.top>=h.bottom-.5,overCellBottom:t.bottom>h.bottom,cell:cell.height,rows,evTop:ev.top,left:t.left,right:t.right,vw:document.documentElement.clientWidth,hit:top===tip,events:cs.pointerEvents};
  });
  expect(geo.position).toBe('fixed');expect(geo.below).toBe(true);
  // 칸 높이·주 줄 높이·같은 칸 일정 막대 위치가 그대로(칸 흐름에 끼지 않음), 말풍선은 다른 줄 위에 그려진다.
  expect(geo.cell).toBe(before.cell);expect(geo.rows).toEqual(before.rows);expect(geo.evTop).toBe(before.evTop);
  expect(geo.hit).toBe(true);expect(geo.events).toBe('none');
  if(SHOT)await page.screenshot({path:SHOT+'-task.png'});
  // 일정 막대도 같은 부품·같은 클래스.
  const bar=grid.locator('[data-google-event="long-ev"]').first();
  await bar.hover();
  await expect(line.locator('.cwv-tip')).toHaveCount(0);
  await expect(bar.locator('.cwv-tip')).toBeVisible();await expect(bar.locator('.cwv-tip')).toHaveText(LONG_EVENT);
  const same=await page.evaluate(()=>{const a=document.querySelector('#calendarGrid [data-google-event="long-ev"] .cwv-tip');return {cls:a.className,pos:getComputedStyle(a).position}});
  expect(same).toEqual({cls:'cwv-tip',pos:'fixed'});
  if(SHOT)await page.screenshot({path:SHOT+'-event.png'});
  await page.mouse.move(5,5);
  await expect(page.locator('#calendarGrid .cwv-tip')).toHaveCount(0);
  // 다 보이는 짧은 제목은 띄우지 않는다(일정·할 일 같은 규칙).
  await grid.locator('.cmv-cell-task[data-calendar-task="short"]').hover();
  await expect(page.locator('#calendarGrid .cwv-tip')).toHaveCount(0);
  await grid.locator('[data-google-event="blue-0"]').first().hover();
  await expect(page.locator('#calendarGrid .cwv-tip')).toHaveCount(0);
  // 맨 오른쪽(토요일) 칸: 화면 밖으로 나가지 않는다.
  const edge=grid.locator('.cmv-cell-task[data-calendar-task="edge"]');
  await edge.hover();
  await expect(edge.locator('.cwv-tip')).toHaveText(LONG+' · 다른 목록');
  const r=await edge.locator('.cwv-tip').evaluate(el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,vw:document.documentElement.clientWidth}});
  expect(r.left).toBeGreaterThanOrEqual(8);expect(r.right).toBeLessThanOrEqual(r.vw-8+.5);
  // 누르면 지금처럼 할 일 열기(말풍선은 닫힘).
  await line.click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#calendarGrid .cwv-tip')).toHaveCount(0);
});

test('PC month: keyboard focus on a clipped task line shows the tip, phone touch never does (S69-21)',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await openEmphasisFixture(page,{tasks:TASKS,events:EVENTS});
  const line=page.locator('#calendarGrid .cmv-cell-task[data-calendar-task="long"]');
  await line.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  await expect(line).toBeFocused();
  await expect(line.locator('.cwv-tip')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(line.locator('.cwv-tip')).toHaveCount(0);
});

test('phone month: task lines have no hover tip and no native title (S69-21)',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await openEmphasisFixture(page,{tasks:TASKS,events:EVENTS});
  const line=page.locator('#calendarGrid .cmv-cell-task[data-calendar-task="long"]');
  await expect(line).toBeVisible();
  await expect(line).not.toHaveAttribute('title',/.*/);
  await expect(line).toHaveAttribute('data-cal-tip',LONG+' · QA');
  await expect(page.locator('#calendarGrid .cwv-tip')).toHaveCount(0);
});
