import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
// UI-상단줄(2026-10-22 요청함 07:53·07:54): PC(≥1024) 모든 화면 위 얇은 줄
// [사이드바 숨김] [←][→] [지금 위치] [검색칸 자리] [+ 추가] [계정 ▾]. 사이드바를 숨기면 본문이 넓어지고 이 기기에 기억한다.
// ←→는 앱 안 이동 기록(좌우 화면에서 고른 항목 포함)이며 브라우저 기록을 움직이지 않는다. 폰·중간 폭은 그대로. 이름은 모두 합성 값.
const line=page=>page.locator('[data-app-topline]');
const toggle=page=>page.locator('[data-nav-toggle]');
const back=page=>page.locator('[data-trail="back"]'),forward=page=>page.locator('[data-trail="forward"]');
const where=page=>page.locator('[data-topline-where]');
// Move with the menu and wait for the screen (views load on first use).
async function show(page,view){await clickView(page,view);await expect(page.locator(`#${view}View`)).toBeVisible()}
// With the sidebar hidden the menu is not there: move through the router, as any in-app link does.
async function go(page,view){await page.evaluate(v=>window.KPTURouter.go(v,{source:'delegated'}),view);await expect(page.locator(`#${view}View`)).toBeVisible()}
const width=(page,sel)=>page.locator(sel).evaluate(el=>Math.round(el.getBoundingClientRect().width));

test('PC: the top line sits above every screen in order, the account moved there, the search slot holds the search field',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 await expect(line(page)).toBeVisible();
 const order=await line(page).evaluate(el=>[...el.children].map(c=>c.dataset.navToggle!==undefined?'nav':c.dataset.trail||(c.matches('.topline-where')?'where':c.dataset.searchSlot!==undefined?'search':c.dataset.quickAdd!==undefined?'add':c.dataset.toplineAccount!==undefined?'account':'?')));
 expect(order).toEqual(['nav','back','forward','where','search','add','account']);
 // SEARCH-전체검색: the slot (owned here) now holds only the search field mounted by global-search.js.
 await expect(page.locator('[data-search-slot] input[type="search"]')).toBeVisible();
 await expect(page.locator('[data-search-slot]>*')).toHaveCount(1);
 // The account trigger is in the top line (right end), not the sidebar.
 await expect(page.locator('#appView>.app-nav [data-account-open]')).toHaveCount(0);
 const account=page.locator('[data-topline-account] [data-account-open]');
 await expect(account).toBeVisible();
 const box=await account.boundingBox(),vw=page.viewportSize().width;
 expect(box.x+box.width).toBeGreaterThan(vw-80);expect(box.y).toBeLessThan(60);
 await account.click();
 const panel=page.locator('#sidebarAccountPanel');await expect(panel).toBeVisible();
 const pbox=await panel.boundingBox();expect(pbox.y).toBeGreaterThan(box.y);expect(pbox.x+pbox.width).toBeLessThanOrEqual(vw);
 await expect(panel.locator('[data-kptu-logout]')).toBeVisible();
 await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(account).toBeFocused();
 // Small buttons (UI-버튼기준): 32px visible height.
 for(const sel of ['[data-nav-toggle]','[data-trail="back"]','[data-quick-add]'])expect(Math.round((await page.locator(sel).boundingBox()).height)).toBe(32);
 for(const view of ['basket','calendar','tasks','journal','diary','projects','library','meetings','pages','team','hwp']){
  await show(page,view);await expect(line(page)).toBeVisible();
  const [l,v]=await Promise.all([line(page).boundingBox(),page.locator(`#${view}View`).boundingBox()]);
  expect(l.y+l.height).toBeLessThanOrEqual(v.y+1);
 }
 expect(errors).toEqual([]);
});

test('PC: hiding the sidebar widens the body and is remembered on the server',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 const prefs=await installViewPrefsServer(page);
 await openHome(page);
 await show(page,'journal');
 const before=await width(page,'#journalView');
 await expect(toggle(page)).toHaveAttribute('aria-expanded','true');
 await toggle(page).focus();await page.keyboard.press('Enter');
 await expect(page.locator('#appView>.app-nav')).toBeHidden();
 await expect(toggle(page)).toHaveAttribute('aria-expanded','false');await expect(toggle(page)).toHaveAttribute('aria-label','메뉴 보이기');
 await expect(toggle(page)).toBeFocused();
 const after=await width(page,'#journalView');
 expect(after).toBeGreaterThan(before+140);
 await expect.poll(()=>prefs.value?.nav_collapsed).toBe(true);
 await page.reload();
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
 await expect(page.locator('#appView>.app-nav')).toBeHidden();
 await toggle(page).click();
 await expect(page.locator('#appView>.app-nav')).toBeVisible();
 await expect.poll(()=>prefs.value?.nav_collapsed??null).toBeNull();
});

test('PC: an unreadable or unsaveable server value keeps the sidebar shown and the toggle still works',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 await installViewPrefsServer(page,{nav_collapsed:true},{failRead:true,failWrite:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 await expect(page.locator('#appView>.app-nav')).toBeVisible();
 await toggle(page).click();await expect(page.locator('#appView>.app-nav')).toBeHidden();
 await toggle(page).click();await expect(page.locator('#appView>.app-nav')).toBeVisible();
 expect(errors).toEqual([]);
});

test('PC: ← → walk the screens moved through, dim at the ends, and leave browser history alone',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 await openHome(page);
 await expect(back(page)).toBeDisabled();await expect(forward(page)).toBeDisabled();
 await show(page,'library');await show(page,'tasks');
 await expect(where(page)).toHaveText(/일정\s*›?\s*할 일/);
 const historyLength=await page.evaluate(()=>history.length);
 await back(page).click();
 await expect(page).toHaveURL(/view=library/);await expect(page.locator('#libraryView')).toBeVisible();
 await expect(forward(page)).toBeEnabled();
 await back(page).click();
 await expect(page.locator('#homeView')).toBeVisible();await expect(back(page)).toBeDisabled();
 await forward(page).click();await expect(page.locator('#libraryView')).toBeVisible();
 await forward(page).click();await expect(page.locator('#tasksView')).toBeVisible();await expect(forward(page)).toBeDisabled();
 // A move made by a menu after stepping back drops the forward part, as a browser would.
 await back(page).click();await expect(page.locator('#libraryView')).toBeVisible();
 await show(page,'meetings');await expect(forward(page)).toBeDisabled();
 // The router still owns history: the browser's back goes through its own entries (the trail steps added router entries like menu clicks).
 expect(await page.evaluate(()=>history.length)).toBeGreaterThanOrEqual(historyLength);
 await page.goBack();await expect(page.locator('#libraryView')).toBeVisible();
 // The browser's back is a move like any other: the record now ends 자료실 → 회의 → 자료실, so ← (Enter on it) goes to 회의.
 await back(page).focus();await page.keyboard.press('Enter');
 await expect(page.locator('#meetingsView')).toBeVisible();await expect(back(page)).toBeFocused();
});

test('PC: ← → bring back the project chosen on the left/right projects screen',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 await openHome(page);
 await show(page,'projects');
 const row=id=>page.locator(`#projectGrid .ps3-plist [data-ps3-project="${id}"]`),first=row('p');
 await expect(first).toHaveAttribute('aria-current','true');
 await row('child').click();
 await expect(row('child')).toHaveAttribute('aria-current','true');
 await back(page).click();
 await expect(first).toHaveAttribute('aria-current','true');await expect(page.locator('#projectsView')).toBeVisible();
 await forward(page).click();
 await expect(row('child')).toHaveAttribute('aria-current','true');
 // MTG-프로젝트합치기 3단계: 사업영역 관리(projects)는 사업 보고 ⋯ 안에서 열어(show → clickView) 그 앞에 사업 보고 화면이 한 칸 더 있다.
 await back(page).click();await back(page).click();
 await expect(page.locator('#meetingsView')).toBeVisible();
 await back(page).click();
 await expect(page.locator('#homeView')).toBeVisible();
});

test('PC: where shows group › screen and the group word opens the group',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 await openHome(page);
 await expect(where(page)).toHaveText('홈');
 // 홈 날짜는 PC에서 상단 줄 위치 옆(본문 맨 위 날짜 제목은 숨김). 다른 화면에서는 날짜를 보이지 않는다.
 const date=line(page).locator('[data-topline-date]');
 await expect(date).toBeVisible();await expect(date).toHaveText(/\d+월 \d+일 [일월화수목금토]요일/);
 await expect(page.locator('#homeView>h2[data-home-date]')).toBeHidden();
 await show(page,'diary');
 await expect(date).toBeHidden();
 await expect(where(page).locator('[aria-current="page"]')).toHaveText('일기');
 await where(page).getByRole('button',{name:'일정'}).click();
 await expect(page.locator('#calendarView')).toBeVisible();
 await expect(where(page).locator('[aria-current="page"]')).toHaveText('달력');
 // MTG-프로젝트합치기 ①: 사업영역 관리는 사업 보고 위 창이다. 위쪽 줄은 밑의 화면(사업 보고)을 가리키고, 창의 ✕로 사업 보고에 돌아온다.
 await show(page,'projects');
 await expect(page.locator('#areaWindow')).toBeVisible();await expect(where(page).locator('[aria-current="page"]')).toHaveText('사업 보고');
 await page.locator('#areaWindow .area-window-close').click();await expect(page.locator('#areaWindow')).toBeHidden();
 await expect(page.locator('#meetingsView')).toBeVisible();
 await page.locator('#appView>.app-nav [data-basket-kind-nav="note"]').click();
 await expect(where(page).locator('li')).toHaveText(['노트']);
 await page.locator('#appView>.app-nav .nav-btn[data-view="basket"]').click();
 await expect(where(page).locator('li')).toHaveText(['정리함']);
});

test('PC: [+ 추가] opens the existing windows for 업데이트·할 일·노트·일정',async({page})=>{
 await page.setViewportSize({width:1280,height:800});
 await openHome(page);
 const add=page.locator('[data-quick-add]'),menu=page.locator('#toplineAddMenu');
 await add.click();await expect(menu).toBeVisible();
 await expect(menu.locator('button')).toHaveText(['업데이트','할 일','노트','일정','일기','공유 페이지','사업 보고']);
 await expect(menu.locator('button').first()).toBeFocused();
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(add).toBeFocused();
 // 업데이트 (ED③ 업데이트): the update's new big window (기록할 곳 line with 바구니(미분류), new editor, no [업데이트|노트] switch).
 // 노트 (ED③ 노트): the note's new big window (title row, new editor, no [업데이트|노트] switch).
 {
  await add.click();await menu.getByRole('button',{name:'업데이트'}).click();
  const editor=page.locator('#edWindow');await expect(editor).toBeVisible();
  await expect(editor.locator('[data-edw-place]')).toContainText('정리함(미분류)');
  await expect(editor.locator('.ed-window-body .ProseMirror')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#edWindow')).toHaveCount(0);
 }
 {
  await add.click();await menu.getByRole('button',{name:'노트'}).click();
  const win=page.locator('#edWindow');await expect(win).toBeVisible();await expect(win).toHaveAccessibleName('새 노트');
  await expect(win.locator('[data-edw-title]')).toBeVisible();await expect(win.locator('.ed-window-body .ProseMirror')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#edWindow')).toHaveCount(0);
 }
 // 일정 / 할 일: the existing event window, on its own side.
 for(const [name,mode] of [['일정','event'],['할 일','task']]){
  await add.click();await menu.getByRole('button',{name}).click();
  const modal=page.locator('#eventModal');await expect(modal).toBeVisible();
  await expect(modal.locator(`[data-event-mode="${mode}"]`)).toHaveAttribute('aria-pressed','true');
  await modal.locator('[data-close="eventModal"]').click();await expect(modal).toBeHidden();
 }
});

test('phone and mid width keep their own shell: no top line, the sidebar toggle does nothing there',async({page})=>{
 await page.setViewportSize({width:390,height:800});
 await installViewPrefsServer(page,{nav_collapsed:true});
 await openHome(page);
 await expect(line(page)).toBeHidden();
 await expect(page.locator('.mobile-tabs')).toBeVisible();
 await page.setViewportSize({width:900,height:800});
 await expect(line(page)).toBeHidden();
 await expect(page.locator('#appView>.app-nav')).toBeVisible();
 await expect(page.locator('#mobileMenuOpen')).toBeVisible();
});

// Representative widths: with the sidebar hidden each PC layout widens and keeps its own shape.
for(const vw of [1280,1440,1920]){
 test(`PC ${vw}: hidden sidebar widens split, 3-column, calendar week, journal and basket screens`,async({page})=>{
  await page.setViewportSize({width:vw,height:900});
  await openHome(page);
  const measure=async(view,sel)=>{await go(page,view);await expect(page.locator(sel).first()).toBeVisible();return width(page,sel)};
  const cases=[['projects','#projectGrid'],['team','#soTeamSection'],['tasks','#gtTaskSection'],['meetings','#meetingList'],['calendar','#calendarCard'],['journal','#journalRoot'],['basket','#basketView']];
  const shown={};for(const [v,s] of cases)shown[v]=await measure(v,s);
  await toggle(page).click();
  for(const [v,s] of cases){
   const w=await measure(v,s);
   // basket keeps its reading width limit (1100px), the rest grow by the sidebar's width.
   if(v==='basket')expect(w).toBeGreaterThanOrEqual(shown[v]);else expect(w,v).toBeGreaterThan(shown[v]+120);
  }
  // Split screens keep list 1/3 : detail 2/3.
  await go(page,'projects');
  await expect(page.locator('#ps3DetailPane')).toBeVisible();await expect(page.locator('#projectGrid .ps3-plist')).toBeVisible();
  // STAB-분할시험: 두 칸을 화면 안에서 한 번에 잰다. 프로젝트 목록은 첫 항목을 열 때 한 번 더 교체되므로(renderGrid), locator.boundingBox()로
  // 요소를 찾은 뒤 따로 자리를 물으면 그 사이에 사라져 null이 된다. 오른쪽 상세 칸도 다 그려진 뒤에 잰다.
  await expect(page.locator('#ps3DetailPane #ps3DetailModal')).toBeVisible();
  const {list,detail}=await page.evaluate(()=>{const w=s=>document.querySelector(s).getBoundingClientRect().width;return {list:{width:w('#projectGrid .ps3-plist')},detail:{width:w('#ps3DetailPane')}}});
  expect(detail.width/list.width).toBeGreaterThan(1.6);expect(detail.width/list.width).toBeLessThan(2.4);
  // Basket stays left-aligned next to where the sidebar was.
  await go(page,'basket');
  const [b,l]=await Promise.all([page.locator('#basketView').boundingBox(),line(page).boundingBox()]);
  expect(Math.abs(b.x-l.x)).toBeLessThanOrEqual(1);
  // Nothing overflows the page sideways.
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}
