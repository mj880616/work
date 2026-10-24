import {test,expect} from '@playwright/test';
import {openHome,createdTaskReply} from './helpers/home-entry.mjs';
// UI-할일입력(2026-10-18 사용자 결정): 일정 [할 일] 화면은 공용 [+] 대신 늘 보이는 입력 칸 + [추가].
// 바구니 메모 입력과 같은 공용 빠른 입력(home-quick.js)을 쓰고, 추가한 할 일은 오늘 날짜로 [오늘] 묶음에 바로 보인다.
// 저장은 기존 Google 할 일 생성(google-tasks create) 한 번. 빈 글은 보내지 않고, 실패하면 글을 남기고 안내한다.
// 폰(≤760): 입력 칸은 아래 전환 줄 바로 위, 자판이 뜨면 아래 탭·전환 줄은 숨고 입력 칸은 자판 바로 위. [달력]·[일기]의 [+]는 그대로.
// 시계는 2026-10-06 KST(openHome). 캡처: UI_REVIEW_DIR=<폴더>가 있으면 390·1280 라이트·다크를 남긴다(docs/review/ui-task-quick-input/).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const REVIEW=process.env.UI_REVIEW_DIR||'';
test.use({hasTouch:true});

async function fixture(page,{width=390,height=844,scheme='light'}={}){
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await page.emulateMedia({colorScheme:scheme});
 await page.setViewportSize({width,height});
 const home=await openHome(page);
 const creates=[];
 // Count every create; the home fixture answers it (and adds the task to its list).
 await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{creates.push(r.request().postDataJSON());return r.fallback();});
 return {...home,errors,creates};
}
const go=async(page,view)=>{await page.evaluate(v=>window.KPTURouter.go(v),view);await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe(view);};
const quick=page=>page.locator('#tasksView .home-quick[data-home-quick]');
const keyboard=(page,open)=>page.evaluate(open=>{if(open)Object.defineProperty(window.visualViewport,'height',{configurable:true,value:444});else delete window.visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));},open);
// UI-PC할일: PC(≥1024)는 기한별 열이라 [오늘] 묶음이 "지남·오늘" 열 안의 같은 오늘 칸(data-gt-today)이다. 고리 하나로 두 배치를 함께 본다.
const todayGroup=page=>page.locator('#gtTaskBody [data-gt-today]');

for(const width of [390,1280]){
 test(`입력 → [추가] → 오늘 날짜로 [오늘]에 보임, 빈 글 무시, [할 일]엔 [+] 없음 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  await go(page,'tasks');
  const q=quick(page),input=q.locator('[data-quick-input]'),add=q.locator('[data-quick-save]');
  await expect(input).toBeVisible();await expect(add).toHaveText('추가');
  await expect(input).toHaveAttribute('placeholder','할 일을 입력하세요');await expect(input).toHaveAttribute('aria-label','오늘 할 일 입력');
  // The same shared box as the basket memo input, without the mode buttons, project·date row or basket link.
  // TASK-추가창파일(2026-10-22): the clip shows too once the task-file table answers (this fixture answers [] for it).
  await expect(q.locator('.home-quick-modes,[data-goto="basket"]')).toHaveCount(0);
  await expect(q.locator('[data-quick-options]')).toBeHidden();await expect(q.locator('[data-quick-file-picker]')).toBeVisible();
  expect(await page.locator('#tasksView .home-quick').count()).toBe(1);
  // No [+] on [할 일].
  await expect(page.locator('#newTaskBtn')).toHaveCount(0);
  // UI-PC버튼36: PC(≥1024) input and [추가] are the input height 36px (touch area 44px), phone keeps 46px.
  const h=width>=1024?36:46;expect((await input.boundingBox()).height).toBe(h);expect((await add.boundingBox()).height).toBe(36);/* UI-버튼줄이기: 폰도 [추가] 36px */
  // Empty or blank text sends nothing.
  await add.click();await input.fill('   ');await add.click();await input.press('Enter');
  await expect(todayGroup(page)).toContainText('오늘 항목');
  expect(f.creates).toEqual([]);
  // Add → one create due today (KST), then it shows under [오늘].
  await input.fill('보도자료 초안 보내기');await add.click();
  await expect.poll(()=>f.creates.length).toBe(1);
  expect(f.creates[0]).toMatchObject({action:'create',title:'보도자료 초안 보내기',due:'2026-10-06',links:[]});
  await expect(input).toHaveValue('');
  await expect(todayGroup(page).locator('.gt-row',{hasText:'보도자료 초안 보내기'})).toBeVisible();
  await expect(page.locator('#toast')).toContainText('할 일을 추가했습니다');
  // Enter adds too (the same path).
  await input.fill('회의 자료 출력');await input.press('Enter');
  await expect.poll(()=>f.creates.length).toBe(2);expect(f.creates[1].due).toBe('2026-10-06');
  await expect(todayGroup(page).locator('.gt-row',{hasText:'회의 자료 출력'})).toBeVisible();
  expect(f.errors).toEqual([]);
 });

 test(`저장 실패: 글은 남고 안내, 다시 [추가]로 새로 만들지 않음 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{f.creates.push(r.request().postDataJSON());return r.fulfill({status:500,json:{message:'QA error'}});});
  await go(page,'tasks');
  const q=quick(page),input=q.locator('[data-quick-input]');
  await input.fill('실패하는 할 일');await q.locator('[data-quick-save]').click();
  await expect(q.locator('[data-quick-status]')).toContainText('QA error');
  await expect(input).toHaveValue('실패하는 할 일');await expect(input).toBeEnabled();
  await expect(q.getByRole('button',{name:'할 일 목록에서 확인',exact:true})).toBeVisible();
  // A second [추가] does not create a duplicate before the earlier result is checked.
  const sent=f.creates.length;await q.locator('[data-quick-save]').click();
  await expect(q.locator('[data-quick-status]')).toContainText('앞선 저장 결과를 먼저 확인해 주세요');
  expect(f.creates.length).toBe(sent);
  await expect(todayGroup(page)).not.toContainText('실패하는 할 일');
 });
}

test('[달력]·[일기]는 [+] 그대로, [할 일]만 입력 칸(폰 390)',async({page})=>{
 const f=await fixture(page);
 await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
 await expect(page.locator('#calendarView .calendar-toolbar #newEventBtn')).toBeVisible();
 await page.locator('#calendarView .schedule-switch [data-view="tasks"]').tap();
 await expect(quick(page)).toBeVisible();await expect(page.locator('#newTaskBtn')).toHaveCount(0);
 await page.locator('#tasksView .schedule-switch [data-view="diary"]').tap();
 await expect(page.locator('#diaryRoot #newDiaryBtn')).toBeVisible();await expect(quick(page)).toBeHidden();
 await page.locator('#diaryView .schedule-switch [data-view="calendar"]').tap();
 await expect(page.locator('#calendarView .calendar-toolbar #newEventBtn')).toBeVisible();
 expect(f.errors).toEqual([]);
});

test('폰 390: 입력 칸은 전환 줄 바로 위, 자판이 뜨면 탭·전환 줄은 숨고 입력 칸은 자판 바로 위, 내려가면 복귀',async({page})=>{
 const f=await fixture(page);
 await go(page,'tasks');
 const tabs=page.locator('#appView > .mobile-tabs'),sw=page.locator('#tasksView .schedule-switch'),q=quick(page),input=q.locator('[data-quick-input]');
 await expect(sw).toBeVisible();await expect(q).toBeVisible();
 const t=await tabs.boundingBox(),qb=await q.boundingBox();
 // Tabs, then the 44px switch row (--kptu-switch-dock), then the input box right on top of it, full width.
 expect(Math.round(qb.y+qb.height)).toBe(Math.round(t.y-44));expect(Math.round(qb.x)).toBe(0);expect(Math.round(qb.width)).toBe(390);
 expect(await q.evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
 // The last row of the list is not hidden behind it: the list ends above the box when scrolled to the bottom.
 const pad=await page.locator('#tasksView').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom));
 expect(pad).toBeGreaterThanOrEqual(qb.height+44);
 // Keyboard: tabs and switch row hide, the box sits right on the keyboard.
 await input.focus();await keyboard(page,true);
 await expect(page.locator('body')).toHaveClass(/kptu-mobile-keyboard/);
 await expect(tabs).toBeHidden();await expect(sw).toBeHidden();await expect(q).toBeVisible();
 await expect.poll(async()=>{const b=await q.boundingBox();return Math.round(b.y+b.height);}).toBe(444);
 await keyboard(page,false);
 await expect(tabs).toBeVisible();await expect(sw).toBeVisible();
 await expect.poll(async()=>{const b=await q.boundingBox();return Math.round(b.y+b.height);}).toBe(Math.round(t.y-44));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.errors).toEqual([]);
});

test('PC 1280: 입력 칸은 목록 위(정리함 PC와 같은 자리), 고정 아님',async({page})=>{
 const f=await fixture(page,{width:1280,height:900});
 await go(page,'tasks');
 const q=quick(page);await expect(q).toBeVisible();
 expect(await q.evaluate(el=>getComputedStyle(el).position)).not.toBe('fixed');
 const b=await q.boundingBox(),list=await page.locator('#gtTaskSection').boundingBox();
 expect(b.y+b.height).toBeLessThanOrEqual(list.y);
 await expect(page.locator('#tasksView .schedule-switch')).toBeHidden();
 expect(f.errors).toEqual([]);
});

if(REVIEW){
 for(const scheme of ['light','dark'])for(const width of [390,1280]){
  test(`캡처 ${width} ${scheme}`,async({page})=>{
   await fixture(page,{width,scheme});
   await go(page,'tasks');await expect(todayGroup(page)).toBeVisible();
   await page.screenshot({path:`${REVIEW}/tasks-${width}-${scheme}.png`});
   const input=quick(page).locator('[data-quick-input]');await input.fill('보도자료 초안 보내기');await quick(page).locator('[data-quick-save]').click();
   await expect(todayGroup(page).locator('.gt-row',{hasText:'보도자료 초안 보내기'})).toBeVisible();
   await page.screenshot({path:`${REVIEW}/tasks-added-${width}-${scheme}.png`});
   if(width<761){await input.focus();await keyboard(page,true);await expect(page.locator('#appView > .mobile-tabs')).toBeHidden();await page.screenshot({path:`${REVIEW}/tasks-keyboard-${width}-${scheme}.png`});}
  });
 }
}
