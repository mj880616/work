import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-PC손맛묶음 둘째 PR(요청 11/10 11:23 "6. PC 손맛 묶음"): ⑤ 브라우저 탭 제목 = 화면 이름, 왼쪽 메뉴는 진짜 링크(Ctrl+누르기·가운데 누르기 = 새 탭),
// ② 키보드 — 전체 검색 단축키(Ctrl+K, /), 메뉴 건너 본문으로 가기, 목록 ↑↓·Enter. 규칙은 app-router.js(leaveToBrowser)·topbar-actions.js(paintWhere)·keyboard-keys.js.
const nav=page=>page.locator('#appView>.app-nav');
async function open(page,width=1280){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);return errors;
}

test('⑤ PC 1280: 브라우저 탭 제목은 지금 화면 이름',async({page})=>{
 const errors=await open(page);
 await expect(page).toHaveTitle('홈 · 노동조합+');
 await nav(page).getByRole('link',{name:'사업 보고',exact:true}).click();await expect(page.locator('#meetingsView')).toBeVisible();
 await expect(page).toHaveTitle('사업 보고 · 노동조합+');
 await nav(page).getByRole('link',{name:'할 일',exact:true}).click();await expect(page.locator('#tasksView')).toBeVisible();
 await expect(page).toHaveTitle('할 일 · 노동조합+');
 await page.goBack();await expect(page.locator('#meetingsView')).toBeVisible();await expect(page).toHaveTitle('사업 보고 · 노동조합+');
 expect(errors).toEqual([]);
});

test('⑤ PC 1280: 왼쪽 메뉴 줄은 화면 주소 링크 — 그냥 누르면 이 탭, Ctrl+누르기·가운데 누르기는 새 탭(이 탭은 그대로)',async({page,context})=>{
 const errors=await open(page);
 const hrefs=await nav(page).locator(':is(.nav-btn,.nav-sub-btn):not([data-quick-links])').evaluateAll(els=>els.map(el=>[el.tagName,el.getAttribute('href')]));
 expect(hrefs.length).toBeGreaterThan(10);
 for(const [tag,href] of hrefs){expect(tag).toBe('A');expect(href).toMatch(/^\.\/(\?view=[a-z]+(&pane=note)?)?$/);}
 await expect(nav(page).getByRole('link',{name:'사업 보고',exact:true})).toHaveAttribute('href','./?view=reports');
 await expect(nav(page).getByRole('link',{name:'노트',exact:true})).toHaveAttribute('href','./?view=basket&pane=note');
 // 그냥 누르기: 같은 탭에서 화면만 바뀐다(페이지를 새로 읽지 않음).
 await page.evaluate(()=>{window.__samePage=1});
 await nav(page).getByRole('link',{name:'자료실',exact:true}).click();
 await expect(page.locator('#libraryView')).toBeVisible();await expect(page).toHaveURL(/view=library/);
 expect(await page.evaluate(()=>window.__samePage)).toBe(1);
 // Ctrl+누르기: 새 탭에 그 화면 주소, 이 탭은 자료실 그대로.
 const [tab]=await Promise.all([context.waitForEvent('page'),nav(page).getByRole('link',{name:'사업 보고',exact:true}).click({modifiers:['ControlOrMeta']})]);
 await expect.poll(()=>tab.url()).toMatch(/view=reports/);
 await tab.close();
 await expect(page.locator('#libraryView')).toBeVisible();await expect(page).toHaveURL(/view=library/);
 // 가운데 누르기도 새 탭.
 const [tab2]=await Promise.all([context.waitForEvent('page'),nav(page).getByRole('link',{name:'파일',exact:true}).click({button:'middle'})]);
 await expect.poll(()=>tab2.url(),{timeout:15000}).toMatch(/view=files/);
 await tab2.close();
 await expect(page.locator('#libraryView')).toBeVisible();
 expect(await page.evaluate(()=>window.__samePage)).toBe(1);
 expect(errors).toEqual([]);
});

test('② PC 1280: Ctrl+K와 / 는 상단 줄 검색칸으로, 글 쓰는 칸 안의 / 는 그대로 글자',async({page})=>{
 const errors=await open(page);
 const input=page.locator('#gsTopInput');await expect(input).toBeVisible();
 await page.locator('body').click({position:{x:640,y:880}});
 await page.keyboard.press('ControlOrMeta+k');
 await expect(input).toBeFocused();await expect(input).toHaveAttribute('aria-keyshortcuts',/Control\+K/);
 await input.blur();
 await page.keyboard.press('/');await expect(input).toBeFocused();await expect(input).toHaveValue('');
 // 검색칸 안에서 / 는 글자.
 await page.keyboard.type('a/b');await expect(input).toHaveValue('a/b');
 expect(errors).toEqual([]);
});

test('② PC 1280: 첫 Tab은 [본문으로 가기], Enter면 지금 화면으로 커서',async({page})=>{
 const errors=await open(page);
 await nav(page).getByRole('link',{name:'자료실',exact:true}).click();await expect(page.locator('#libraryView')).toBeVisible();
 const skip=page.locator('[data-skip-main]');
 // 문서에서 맨 처음 누를 수 있는 것이 [본문으로 가기]다(첫 Tab).
 expect(await page.evaluate(()=>document.querySelector('body a[href],body button,body input,body [tabindex]')?.hasAttribute('data-skip-main'))).toBe(true);
 await skip.focus();
 await expect(skip).toBeFocused();await expect(skip).toHaveText('본문으로 가기');
 const box=await skip.boundingBox();expect(box.y).toBeGreaterThanOrEqual(0);
 await page.keyboard.press('Enter');
 await expect(page.locator('#libraryView')).toBeFocused();
 // 커서가 없을 때는 화면 밖(보이지 않음).
 await page.locator('#libraryView').blur();
 const hidden=await skip.boundingBox();expect(hidden.y+hidden.height).toBeLessThanOrEqual(0);
 expect(errors).toEqual([]);
});

test('② PC 1280: 목록 ↑↓는 위·아래 줄로, role="button" 줄의 Enter는 그 줄을 연다; 옆으로 놓인 단추는 ↑↓로 옮기지 않는다',async({page})=>{
 const errors=await open(page);
 // 왼쪽 메뉴도 목록이다.
 const lib=nav(page).getByRole('link',{name:'자료실',exact:true});
 await lib.focus();await page.keyboard.press('ArrowDown');
 await expect(nav(page).getByRole('link',{name:'파일',exact:true})).toBeFocused();
 await page.keyboard.press('ArrowUp');await expect(lib).toBeFocused();
 // 화면 안 목록(누를 수 있는 줄, 줄 안 단추)과 옆으로 놓인 단추 한 줄.
 await page.evaluate(()=>{
  const host=document.createElement('div');host.id='kbFixture';
  host.innerHTML='<div class="kb-list">'+[1,2,3].map(n=>`<article class="kb-row" role="button" tabindex="0" data-n="${n}"><b>줄 ${n}</b><button type="button" class="kb-more" aria-label="더 보기 ${n}">⋯</button></article>`).join('')+'</div>'
   +'<div class="kb-bar"><button type="button" class="kb-side">왼쪽</button><button type="button" class="kb-side">오른쪽</button></div>';
  document.querySelector('#appView>.view-panel:not(.hidden)').prepend(host);
  window.__opened=[];host.addEventListener('click',e=>{const row=e.target.closest('.kb-row');if(row&&!e.target.closest('.kb-more'))window.__opened.push(row.dataset.n)});
 });
 const row=n=>page.locator(`.kb-row[data-n="${n}"]`);
 await row(1).focus();await page.keyboard.press('ArrowDown');await expect(row(2)).toBeFocused();
 await page.keyboard.press('ArrowDown');await expect(row(3)).toBeFocused();
 await page.keyboard.press('ArrowDown');await expect(row(3)).toBeFocused(); // 마지막 줄에서 멈춤
 await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.__opened)).toEqual(['3']);
 // 줄 안 ⋯에서 ↑ 는 윗줄의 ⋯로.
 await page.getByRole('button',{name:'더 보기 3',exact:true}).focus();await page.keyboard.press('ArrowUp');
 await expect(page.getByRole('button',{name:'더 보기 2',exact:true})).toBeFocused();
 // 옆으로 놓인 단추: ↓ 해도 커서 그대로.
 const left=page.locator('.kb-side').first();await left.focus();await page.keyboard.press('ArrowDown');await expect(left).toBeFocused();
 expect(errors).toEqual([]);
});

test('폰 412: 탭 제목만 바뀌고 하단 탭·메뉴 판은 단추 그대로',async({page})=>{
 const errors=await open(page,412);
 await expect(page).toHaveTitle('홈 · 노동조합+');
 await expect(page.locator('.mobile-tabs button[data-view="meetings"]')).toBeVisible();
 await expect(page.locator('[data-skip-main]')).not.toBeInViewport();
 expect(errors).toEqual([]);
});

test('⑨ PC 1280: 조직 보고 [연도별 타임라인] 제목은 다른 칸 제목처럼 왼쪽',async({page})=>{
 const errors=await open(page);
 await page.evaluate(()=>window.KPTURouter.go('team'));await expect(page.locator('#teamView')).toBeVisible();
 const time=page.locator('#wdTime > summary h3'),log=page.locator('#wdLog .wd-head h3');
 await expect(time).toBeVisible();await expect(log).toBeVisible();
 const [t,l]=[await time.boundingBox(),await log.boundingBox()];
 // 꺾쇠(글자 1개 폭) 하나만큼만 들여 쓰고, 칸 오른쪽 끝으로 밀리지 않는다.
 expect(t.x-l.x).toBeGreaterThanOrEqual(0);expect(t.x-l.x).toBeLessThan(30);
 expect(errors).toEqual([]);
});
