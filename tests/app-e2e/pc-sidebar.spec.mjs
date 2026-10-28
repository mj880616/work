import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
// UI-PC사이드바 + UI-PC메모노트(BASKET-업데이트통합 PR 3): PC 사이드바 맨 위 아이콘+"홈" 줄이 홈 메뉴(고른 표시도 그 줄),
// 아래 따로 있던 [홈]은 PC 사이드바에서 없음. [바구니] 아래 하위 메뉴 [업데이트]·[노트](항상 펼침). "게시판" → "공유 페이지"(주소 그대로).
// 폰 하단 탭 [홈]·761~1023px 위쪽 한 줄 메뉴의 [홈]은 그대로.
const nav=page=>page.locator('#appView>.app-nav');
async function open(page,width){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);return errors;
}

test('PC 1280: 맨 위 "홈" 줄이 홈 메뉴이고 고른 표시를 가진다; 아래 [홈] 줄은 없다',async({page})=>{
 const errors=await open(page,1280),brand=nav(page).locator('.sidebar-brand');
 await expect(brand).toHaveText('홈');await expect(brand).toHaveAccessibleName('홈');
 await expect(brand).toHaveClass(/active/);await expect(brand).toHaveAttribute('aria-current','page');
 await expect(nav(page).locator('.nav-btn[data-view="home"]')).toBeHidden();
 const before=await brand.evaluate(el=>getComputedStyle(el).backgroundColor);
 await nav(page).locator('.nav-btn[data-view="calendar"]').click();await expect(page.locator('#calendarView')).toBeVisible();
 await expect(brand).not.toHaveClass(/active/);await expect(brand).not.toHaveAttribute('aria-current','page');
 expect(await brand.evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(before);
 await brand.click();await expect(page.locator('#homeView')).toBeVisible();
 await expect(brand).toHaveClass(/active/);
 const box=await brand.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);
 // 키보드로도 홈으로 간다.
 await nav(page).locator('.nav-btn[data-view="meetings"]').click();await expect(page.locator('#meetingsView')).toBeVisible();
 await brand.focus();await page.keyboard.press('Enter');await expect(page.locator('#homeView')).toBeVisible();
 expect(errors).toEqual([]);
});

test('PC 1280: [정리함]은 하위 줄 없는 한 줄, [노트]는 [일정] 다음 독립 줄, 누르면 노트 쪽을 연다',async({page})=>{
 const errors=await open(page,1280),basketRow=nav(page).locator('.nav-btn[data-view="basket"]'),noteRow=nav(page).locator('.nav-btn[data-basket-kind-nav="note"]');
 await expect(basketRow).toHaveText('정리함');await expect(nav(page).locator('.nav-sub[aria-label="정리함"]')).toHaveCount(0);
 await expect(nav(page).locator('.nav-sub[aria-label="일정"] .nav-sub-btn')).toHaveText(['달력','할 일','업무일지','일기']);
 await expect(noteRow).toBeVisible();await expect(noteRow).toHaveText('노트');
 // 순서: 정리함 / 일정 / 달력…일기 / 노트 / 사업 보고.
 const ys=[];for(const l of [basketRow,nav(page).locator('.nav-btn[data-view="calendar"]'),nav(page).locator('.nav-sub[aria-label="일정"] [data-goto="calendar"]'),noteRow,nav(page).locator('.nav-btn[data-view="meetings"]')])ys.push((await l.boundingBox()).y);
 expect([...ys].sort((a,b)=>a-b)).toEqual(ys);
 const n=await noteRow.boundingBox(),b=await basketRow.boundingBox();expect(Math.abs(n.x-b.x)).toBeLessThan(2);
 await noteRow.click();
 await expect(page.locator('#basketView')).toBeVisible();
 await expect(page.locator('#basketView')).toHaveAttribute('data-kind','note');await expect(page.locator('[data-note-host]')).toBeVisible();
 await expect(noteRow).toHaveAttribute('aria-current','page');await expect(basketRow).not.toHaveAttribute('aria-current','page');
 await basketRow.click();
 await expect(page.locator('#basketView')).toHaveAttribute('data-kind','memo');await expect(page.locator('[data-basket-list]')).toBeVisible();
 await expect(basketRow).toHaveAttribute('aria-current','page');await expect(noteRow).not.toHaveAttribute('aria-current','page');
 await chooseBasketKind(page,'note');await expect(noteRow).toHaveAttribute('aria-current','page');
 // Leaving the basket clears the mark.
 await nav(page).locator('.nav-btn[data-view="calendar"]').click();await expect(page.locator('#calendarView')).toBeVisible();
 await expect(noteRow).not.toHaveAttribute('aria-current','page');
 // From another screen, [노트] opens the basket on the note side.
 await noteRow.click();await expect(page.locator('#basketView')).toBeVisible();
 await expect(page.locator('#basketView')).toHaveAttribute('data-kind','note');
 expect(errors).toEqual([]);
});

test('PC 1280: 정리함 한 화면 — 맨 위 한 줄과 [다시 찾기], 위 챙길 것 칸·아래 업데이트 칸, 옛 ?pane=todo 주소는 챙길 것 칸으로',async({page})=>{
 const errors=await open(page,1280),basket=page.locator('#basketView');
 await nav(page).locator('.nav-btn[data-view="basket"]').click();await expect(basket).toBeVisible();
 await expect(basket.locator('[data-inbox-find]')).toBeVisible();await expect(basket.locator('[data-inbox-find]')).toHaveText('다시 찾기');
 await expect(basket.locator('[data-basket-more]')).toHaveCount(0);
 const todo=basket.locator('[data-inbox-todo-section]'),update=basket.locator('.basket-switch-row');
 await expect(todo).toBeVisible();await expect(update).toBeVisible();
 expect((await todo.boundingBox()).y).toBeLessThan((await update.boundingBox()).y);
 await expect(todo.locator('[data-inbox-chip]')).toHaveText(['처리 전','보냄','무시']);
 await expect(update.locator('h3')).toContainText('업데이트');
 await page.evaluate(()=>window.KPTURouter.go('basket',{sub:'todo'}));
 await expect(todo).toBeVisible();await expect(page).not.toHaveURL(/pane=/);
 expect(errors).toEqual([]);
});

test('"게시판" 이름은 "공유 페이지"(사이드바·폰 메뉴·화면 제목), 주소는 그대로',async({page})=>{
 const errors=await open(page,1280);
 await expect(nav(page).locator('.nav-btn[data-view="pages"]')).toHaveText('공유 페이지');
 await nav(page).locator('.nav-btn[data-view="pages"]').click();await expect(page.locator('#pagesView')).toBeVisible();await expect(page).toHaveURL(/view=pages/);
 await expect(page.locator('#web1BoardDetailTitle')).toHaveText('공유 페이지');
 await page.setViewportSize({width:390,height:844});
 await page.locator('#mobileMenuTab').click();await expect(page.locator('#mobileMenu [data-view="pages"]')).toHaveText('공유 페이지');
 await page.locator('#mobileMenu [data-view="pages"]').click();await expect(page.locator('[data-mobile-view-name]')).toHaveText('공유 페이지');
 await expect(page.locator('body')).not.toContainText('게시판');
 expect(errors).toEqual([]);
});

test('폰 390: 하단 탭 [홈] 그대로, 하위 메뉴는 없다; 870: 위쪽 한 줄 메뉴 [홈] 그대로',async({page})=>{
 const errors=await open(page,390);
 await expect(page.locator('.mobile-tabs [data-view="home"]')).toBeVisible();await expect(page.locator('.mobile-tabs [data-view="home"]')).toHaveAttribute('aria-current','page');
 await expect(nav(page)).toBeHidden();
 await page.setViewportSize({width:870,height:900});
 await expect(nav(page).locator('.nav-btn[data-view="home"]')).toBeVisible();await expect(nav(page).locator('.nav-btn[data-view="home"]')).toHaveAttribute('aria-current','page');
 for(const sub of await nav(page).locator('.nav-sub').all())await expect(sub).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});

// UI-PC일정묶음: [일정] 아래 하위 메뉴 [달력]·[할 일]·[업무일지]·[일기](바구니 하위 메뉴와 같은 모양·항상 펼침).
// 상위 [일정]은 달력, 현재 화면의 하위 줄이 고른 표시, 따로 있던 할 일·일지·일기 줄은 없다. "일지" → "업무일지"(주소·내부 이름 그대로).
test('PC 1280: [일정] 아래 [달력]·[할 일]·[업무일지]·[일기], 상위는 달력, 현재 화면의 하위 줄이 고른 표시',async({page})=>{
 const errors=await open(page,1280),head=nav(page).locator('.nav-btn[data-view="calendar"]'),sub=nav(page).locator('.nav-sub[aria-label="일정"]');
 await expect(head).toHaveText('일정');
 await expect(sub).toBeVisible();await expect(sub.getByRole('button')).toHaveText(['달력','할 일','업무일지','일기']);
 // 바로 아래, 들여 쓴 하위 메뉴.
 const shape=loc=>loc.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {h:Math.round(r.height),x:Math.round(r.x),font:s.fontSize,weight:s.fontWeight,color:s.color};});
 const hb=await head.boundingBox(),first=await sub.getByRole('button').first().boundingBox();
 expect(first.y).toBeGreaterThan(hb.y);expect(first.x).toBeGreaterThan(hb.x);
 // 따로 있던 줄은 없다(사이드바 전체에서 화면마다 줄 하나).
 for(const view of ['tasks','journal','diary'])await expect(nav(page).locator(`[data-view="${view}"]`)).toHaveCount(1);
 await expect(nav(page).locator('.nav-btn[data-view="tasks"],.nav-btn[data-view="journal"],.nav-btn[data-view="diary"]')).toHaveCount(0);
 // 상위 [일정] → 달력, [달력] 줄이 고른 표시.
 const item=name=>sub.getByRole('button',{name,exact:true});
 await head.click();await expect(page.locator('#calendarView')).toBeVisible();await expect(page).toHaveURL(/view=calendar/);
 await expect(head).toHaveAttribute('aria-current','page');await expect(head).toHaveClass(/active/);
 await expect(item('달력')).toHaveAttribute('aria-current','true');await expect(sub.locator('[aria-current]')).toHaveCount(1);
 for(const [name,view] of [['할 일','tasks'],['업무일지','journal'],['일기','diary'],['달력','calendar']]){
  await item(name).click();await expect(page.locator(`#${view}View`)).toBeVisible();await expect(page).toHaveURL(new RegExp(`view=${view}`));
  await expect(item(name)).toHaveAttribute('aria-current',view==='calendar'?'true':'page');await expect(item(name)).toHaveClass(/active/);
  await expect(sub.locator('[aria-current]')).toHaveCount(1);
  // 상위 [일정]은 네 화면 어디서든 고른 모양(현재 페이지 표시는 달력에서만).
  await expect(head).toHaveClass(/active/);
  if(view==='calendar')await expect(head).toHaveAttribute('aria-current','page');else await expect(head).not.toHaveAttribute('aria-current');
 }
 const look=await shape(item('달력'));expect(look.weight).toBe('500');
 expect(await shape(item('일기'))).toMatchObject({weight:'400'});
 // 다른 화면으로 가면 [일정] 묶음의 표시는 모두 꺼진다.
 await nav(page).locator('.nav-btn[data-view="meetings"]').click();await expect(page.locator('#meetingsView')).toBeVisible();
 await expect(head).not.toHaveClass(/active/);await expect(sub.locator('[aria-current],.active')).toHaveCount(0);
 // 키보드로도 연다.
 await item('업무일지').focus();await page.keyboard.press('Enter');await expect(page.locator('#journalView')).toBeVisible();
 expect(errors).toEqual([]);
});

for(const view of ['calendar','tasks','journal','diary'])test(`옛 주소 ?view=${view}: 그 화면이 열리고 [일정] 하위 줄이 고른 표시(PC 1280)`,async({page})=>{
 await page.setViewportSize({width:1280,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page,{query:`?view=${view}`});
 await expect(page.locator(`#${view}View`)).toBeVisible();await expect(page).toHaveURL(new RegExp(`view=${view}`));
 const sub=nav(page).locator('.nav-sub[aria-label="일정"]'),label={calendar:'달력',tasks:'할 일',journal:'업무일지',diary:'일기'}[view];
 await expect(sub.locator('[aria-current]')).toHaveText(label);
 await expect(nav(page).locator('.nav-btn[data-view="calendar"]')).toHaveClass(/active/);
 // 뒤로 가기·앞으로 가기에도 표시가 따라온다.
 await nav(page).locator('.nav-btn[data-view="meetings"]').click();await expect(page.locator('#meetingsView')).toBeVisible();
 await page.goBack();await expect(page.locator(`#${view}View`)).toBeVisible();await expect(sub.locator('[aria-current]')).toHaveText(label);
 expect(errors).toEqual([]);
});

test('"일지" → "업무일지": 사이드바·폰 전환 줄·화면, 주소(?view=journal)는 그대로; 폰 하단 탭·☰ 메뉴 구조는 그대로',async({page})=>{
 const errors=await open(page,1280);
 await nav(page).locator('.nav-sub[aria-label="일정"]').getByRole('button',{name:'업무일지',exact:true}).click();
 await expect(page.locator('#journalView')).toBeVisible();await expect(page).toHaveURL(/view=journal/);
 // 화면 어디에도 "일지"만 따로 쓰인 이름이 없다(업무일지·주간 업무일지는 괜찮다).
 const bare=()=>page.evaluate(()=>{const t=document.querySelector('#appView').innerText;return (t.match(/(^|[^무])일지/g)||[]).length;});
 expect(await bare()).toBe(0);
 await page.setViewportSize({width:870,height:900});await expect(page.locator('#journalView')).toBeVisible();
 expect(await bare()).toBe(0);
 await page.setViewportSize({width:390,height:844});await expect(page.locator('#journalView')).toBeVisible();
 await expect(page.locator('#journalView .schedule-switch').getByRole('button')).toHaveText(['달력','할 일','업무일지','일기']);
 expect(await bare()).toBe(0);
 // 폰: 하단 탭 6칸·메뉴 판 항목은 그대로.
 await expect(page.locator('.mobile-tabs > button')).toHaveText(['홈','정리함','일정','사업 보고','담당조직','메뉴']);
 await expect(page.locator('.mobile-tabs [data-mobile-schedule-tab]')).toHaveAttribute('aria-current','page');
 await page.locator('#mobileMenuTab').click();
 expect(await page.locator('#mobileMenu nav button:visible').allTextContents()).toEqual(['노트','자료실','HWP 편집','공유 페이지','원장','사진','통화','텔레그램 소식','아스날']);
 await expect(nav(page)).toBeHidden();
 expect(errors).toEqual([]);
});
