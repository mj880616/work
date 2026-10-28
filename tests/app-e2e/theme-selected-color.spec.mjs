import {test,expect} from '@playwright/test';
import {THEMES} from './helpers/theme-list.mjs';
import {openHome} from './helpers/home-entry.mjs';
// UI-선택표시톤다운(2026-10-28, UI-테마선택색 2026-10-22를 바꿈): 전환·필터·메뉴의 고른 쪽 = 연한 바탕(--ds-select-bg) + 얇은 선 + 보통 글자,
// 꽉 칠한 주 색은 [추가] 같은 누르는 주 버튼에만. 폰 하단 탭·PC 사이드바는 지금 화면 하나만. 폰 메뉴 판 타일은 같은 모양. 테마 10종(THEMES)에서 글자 대비 4.5:1 이상.
const nav=page=>page.locator('#appView>.app-nav');
async function open(page,width,theme='olive'){
 await page.setViewportSize({width,height:width<761?844:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 await page.evaluate(t=>{document.documentElement.dataset.theme=t},theme);
 return errors;
}
const rgb=(page,expr)=>page.evaluate(v=>{const d=document.createElement('i');d.style.color=v;document.body.append(d);const c=getComputedStyle(d).color;d.remove();return c},expr);
const bg=loc=>loc.evaluate(el=>getComputedStyle(el).backgroundColor);
const fg=loc=>loc.evaluate(el=>getComputedStyle(el).color);
const lum=c=>{const [r,g,b]=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*b};
const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};

const shadow=loc=>loc.evaluate(el=>getComputedStyle(el).boxShadow);
// 가로 전환의 아래 얇은 선은 ::before 막대(버튼 자체 그림자는 없음).
const underline=loc=>loc.evaluate(el=>{const s=getComputedStyle(el,'::before');return s.content==='none'?'':s.backgroundColor});
for(const theme of THEMES){
 test(`${theme}: 고른 쪽은 연한 바탕 + 얇은 선, 꽉 칠한 색은 [추가]만, 글자 대비 4.5:1 이상`,async({page})=>{
  const errors=await open(page,1280,theme);
  const primary=await rgb(page,'var(--kptu-primary)'),on=await rgb(page,'var(--kptu-on-primary)');
  const soft=await rgb(page,'var(--ds-select-bg)'),ink=await rgb(page,'var(--ds-select-ink)'),line=await rgb(page,'var(--ds-select-line)');
  expect(ratio(primary,on)).toBeGreaterThanOrEqual(4.5);expect(ratio(soft,ink)).toBeGreaterThanOrEqual(4.5);
  expect(soft).not.toBe(primary);
  // 고른 [바구니|할 일|업데이트] 쪽: 연한 바탕 + 아래 얇은 선. 홈 빠른 입력 [추가]만 주 색으로 채운다.
  const modes=page.locator('#homeView .home-quick-modes [data-quick-mode][aria-pressed="true"]').first();
  await expect(modes).toBeVisible();
  expect(await bg(modes)).toBe(soft);expect(await fg(modes)).toBe(ink);expect(await underline(modes)).toBe(line);expect(await shadow(modes)).toBe('none');
  const save=page.locator('#homeView .home-quick button.home-quick-save').first();
  expect(await bg(save)).toBe(primary);
  const unsel=page.locator('#homeView .home-quick-modes [data-quick-mode][aria-pressed="false"]').first();
  expect(await bg(unsel)).not.toBe(soft);
  // 사이드바: 지금 화면 하나만 연한 바탕 + 왼쪽 얇은 선, 주 색으로 채운 항목은 없다.
  const filled=await nav(page).locator('button,a').evaluateAll(els=>els.filter(e=>e.getClientRects().length&&getComputedStyle(e).backgroundColor!=='rgba(0, 0, 0, 0)').map(e=>e.textContent.trim()));
  expect(filled).toEqual(['홈']);
  const home=nav(page).locator('.active:visible, [aria-current]:visible').first();
  expect(await bg(home)).toBe(soft);expect(await shadow(home)).toContain(line);
  expect(await nav(page).locator('button,a').evaluateAll((els,p)=>els.filter(e=>getComputedStyle(e).backgroundColor===p).length,primary)).toBe(0);
  expect(errors).toEqual([]);
 });
}

test('PC 1280: 이동 뒤에도 사이드바에 채워진 항목은 지금 화면 하나(이전 항목 표시가 남지 않음)',async({page})=>{
 const errors=await open(page,1280);
 const soft=await rgb(page,'var(--ds-select-bg)');
 const filledNames=()=>nav(page).locator('button,a').evaluateAll((els,p)=>els.filter(e=>e.getClientRects().length&&getComputedStyle(e).backgroundColor===p).map(e=>e.textContent.trim()),soft);
 const seen=async name=>{await expect.poll(filledNames).toEqual([name]);await expect(nav(page).locator('.active:visible, [aria-current]:visible')).not.toHaveCount(0)};
 // 자료실 → 공유 페이지: 포인터가 이전 항목(자료실) 위에 남아 있어도 표시는 한 곳.
 await nav(page).locator('.nav-btn[data-view="library"]').click();await expect(page.locator('#libraryView')).toBeVisible();await seen('자료실');
 await page.evaluate(()=>window.KPTURouter.go('pages'));await expect(page.locator('#pagesView')).toBeVisible();await seen('공유 페이지');
 await expect(nav(page).locator('[aria-current]')).toHaveCount(1);
 // 일정 → 사업 보고: [일정] 머리와 [달력]이 둘 다 채워지지 않는다(MTG-프로젝트합치기 3단계: [프로젝트] 줄은 없다).
 await nav(page).locator('.nav-btn[data-view="calendar"]').click();await expect(page.locator('#calendarView')).toBeVisible();await seen('달력');
 await nav(page).locator('.nav-btn[data-view="meetings"]').click();await expect(page.locator('#meetingsView')).toBeVisible();await seen('사업 보고');
 await expect(nav(page).locator('.nav-btn.active')).toHaveCount(1);
 // 사업영역 관리(라우터 이름 projects)는 사업 보고 아래 화면이라 [사업 보고] 줄 하나가 채워진다.
 await page.evaluate(()=>window.KPTURouter.go('projects'));await expect(page.locator('#projectsView')).toBeVisible();await seen('사업 보고');
 await expect(nav(page).locator('.nav-btn.active')).toHaveCount(1);
 // 바구니 [노트] → 다른 화면.
 await nav(page).locator('.nav-btn[data-basket-kind-nav="note"]').click();await expect(page.locator('#basketView')).toBeVisible();await seen('노트');
 await nav(page).locator('.nav-btn[data-view="team"]').click();await expect(page.locator('#teamView')).toBeVisible();await seen('담당조직');
 expect(errors).toEqual([]);
});

for(const theme of ['olive','sky','lemon']){
 test(`폰 390 ${theme}: 하단 탭 지금 화면은 연한 동그라미 + 강조색 아이콘, 메뉴 화면에서는 [메뉴]`,async({page})=>{
  const errors=await open(page,390,theme);
  // 글자로 쓰는 강조색은 --kptu-primary-text(레몬은 진한 노랑, 나머지는 주 버튼 색과 같거나 읽히는 변형). 동그라미 바탕은 연한 선택 바탕.
  const soft=await rgb(page,'var(--ds-select-bg)'),text=await rgb(page,'var(--kptu-primary-text)');
  const tabs=page.locator('#appView>.mobile-tabs');
  const cur=tabs.locator('[aria-current="page"]');
  await expect(cur).toHaveCount(1);await expect(cur).toContainText('홈');
  expect(await bg(cur.locator('svg'))).toBe(soft);expect(await fg(cur.locator('svg'))).toBe(text);expect(await fg(cur)).toBe(text);
  expect(await bg(tabs.locator('button:not([aria-current]) svg').first())).toBe('rgba(0, 0, 0, 0)');
  // 메뉴로 닿는 화면: [메뉴]만 지금 화면(MTG-프로젝트합치기 3단계: 사업 보고는 하단바 칸이라 여기서 빠진다).
  for(const view of ['library','hwp','pages']){
   await page.evaluate(v=>window.KPTURouter.go(v),view);await expect(page.locator(`#${view}View`)).toBeVisible();
   await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);await expect(tabs.locator('#mobileMenuTab')).toHaveAttribute('aria-current','page');
   expect(await bg(tabs.locator('#mobileMenuTab svg'))).toBe(soft);
  }
  // 사업 보고와 그 아래 사업영역 관리(라우터 이름 projects)는 하단바 [사업 보고] 칸.
  for(const view of ['meetings','projects']){
   await page.evaluate(v=>window.KPTURouter.go(v),view);await expect(page.locator(`#${view}View`)).toBeVisible();
   await expect(tabs.locator('#mobileMenuTab')).not.toHaveAttribute('aria-current','page');await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);await expect(tabs.locator('[aria-current="page"]')).toContainText('사업 보고');
  }
  expect(errors).toEqual([]);
 });
}

test('폰 390: 메뉴 판 타일 여덟이 같은 모양이고 낮다(CALL·TG: 통화·텔레그램 소식 추가, PRESS-자료실편입: 성명·보도자료 삭제, PHOTO-사진메뉴: 사진 추가, MTG-프로젝트합치기 3단계: 사업 보고는 하단바로)',async({page})=>{
 const errors=await open(page,390);
 await page.locator('#mobileMenuTab').click();await expect(page.locator('#mobileMenu .mobile-menu-panel')).toBeVisible();
 const tiles=page.locator('#mobileMenu .mobile-menu-panel nav button');await expect(tiles).toHaveCount(8);
 const look=await tiles.evaluateAll(els=>els.map(e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,color:s.color,border:s.borderTopColor,h:Math.round(e.getBoundingClientRect().height)}}));
 for(const t of look){expect(t).toEqual(look[0]);expect(t.h).toBeLessThanOrEqual(60);expect(t.h).toBeGreaterThanOrEqual(44)}
 expect(errors).toEqual([]);
});

test('폰 390: 일정 전환·자료실 칩의 고른 쪽이 연한 바탕 + 얇은 선',async({page})=>{
 const errors=await open(page,390,'navy');
 const primary=await rgb(page,'var(--ds-select-bg)'),on=await rgb(page,'var(--ds-select-ink)'),line=await rgb(page,'var(--ds-select-line)');
 await page.evaluate(()=>window.KPTURouter.go('calendar'));await expect(page.locator('#calendarView')).toBeVisible();
 const sw=page.locator('#appView .schedule-switch button[aria-pressed="true"]').first();await expect(sw).toBeVisible();
 expect(await bg(sw)).toBe(primary);expect(await fg(sw)).toBe(on);expect(await underline(sw)).toBe(line);
 await page.evaluate(()=>window.KPTURouter.go('library'));await expect(page.locator('#libraryView')).toBeVisible();
 const chip=page.locator('#libraryView .filter-chips button[aria-checked="true"], #libraryView #libraryCategoryFilter button[aria-pressed="true"]').first();
 if(await chip.count()){expect(await bg(chip)).toBe(primary);expect(await fg(chip)).toBe(on);expect(await chip.evaluate(el=>getComputedStyle(el).borderTopColor)).toBe(line)}
 expect(errors).toEqual([]);
});
