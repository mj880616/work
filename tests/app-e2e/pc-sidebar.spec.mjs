import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
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
 await nav(page).locator('.nav-btn[data-view="projects"]').click();await expect(page.locator('#projectsView')).toBeVisible();
 await brand.focus();await page.keyboard.press('Enter');await expect(page.locator('#homeView')).toBeVisible();
 expect(errors).toEqual([]);
});

test('PC 1280: [바구니] 아래 [업데이트]·[노트]가 항상 보이고 그쪽을 연다',async({page})=>{
 const errors=await open(page,1280),sub=nav(page).locator('.nav-sub');
 await expect(sub).toBeVisible();await expect(sub.getByRole('button')).toHaveText(['업데이트','노트']);
 const basket=await nav(page).locator('.nav-btn[data-view="basket"]').boundingBox(),first=await sub.getByRole('button').first().boundingBox();
 expect(first.y).toBeGreaterThan(basket.y);expect(first.x).toBeGreaterThan(basket.x);
 await sub.getByRole('button',{name:'노트',exact:true}).click();
 await expect(page.locator('#basketView')).toBeVisible();
 await expect(page.locator('[data-basket-kind="note"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-note-host]')).toBeVisible();
 await expect(sub.getByRole('button',{name:'노트',exact:true})).toHaveAttribute('aria-current','true');
 await expect(sub.getByRole('button',{name:'업데이트',exact:true})).not.toHaveAttribute('aria-current','true');
 await expect(nav(page).locator('.nav-btn[data-view="basket"]')).toHaveAttribute('aria-current','page');
 await sub.getByRole('button',{name:'업데이트',exact:true}).click();
 await expect(page.locator('[data-basket-kind="memo"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-basket-list]')).toBeVisible();
 await expect(sub.getByRole('button',{name:'업데이트',exact:true})).toHaveAttribute('aria-current','true');
 // The basket screen's own switch keeps the sidebar in step.
 await page.locator('[data-basket-kind="note"]').click();await expect(sub.getByRole('button',{name:'노트',exact:true})).toHaveAttribute('aria-current','true');
 // Leaving the basket clears the sub mark.
 await nav(page).locator('.nav-btn[data-view="calendar"]').click();await expect(page.locator('#calendarView')).toBeVisible();
 await expect(sub.locator('[aria-current]')).toHaveCount(0);
 // From another screen, [노트] opens the basket on the note side.
 await sub.getByRole('button',{name:'노트',exact:true}).click();await expect(page.locator('#basketView')).toBeVisible();
 await expect(page.locator('[data-basket-kind="note"]')).toHaveAttribute('aria-pressed','true');
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
 await expect(nav(page).locator('.nav-sub')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});
