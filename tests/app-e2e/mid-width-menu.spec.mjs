import { appOrigin } from './helpers/test-origin.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
const app=`${appOrigin}/app/`;
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
async function open(page,url=app+'?view=home'){
  const user={id:'home-qa',email:'home-qa@example.org'};
  await page.route(`${SB}/**`,route=>{
    const p=new URL(route.request().url()).pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(p==='/auth/v1/token')return ok({access_token:'home-qa-access',refresh_token:'home-qa-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(p==='/auth/v1/user')return ok(user);
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'home-workspace',role:'owner',workspace:{id:'home-workspace',name:'QA',slug:'kptu-work'}}]);
    if(p==='/functions/v1/google-calendar')return ok({connected:false,calendars:[],events:[]});
    if(p==='/functions/v1/google-tasks')return ok({connected:false,tasks:[]});
    if(p.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
  await page.goto(loginEntry(url));
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
}
// BASKET-정리함한화면: 홈 / 정리함 / 일정(달력→일정, 할 일·업무일지·일기) / 노트 / 사업 보고 …(MTG-프로젝트합치기 3단계: [프로젝트] 줄은 없다)
const order=['홈','정리함','일정','할 일','업무일지','일기','노트','사업 보고','자료실','공유 페이지','담당조직','HWP 편집','원장','사진','통화','텔레그램 소식','아스날'];
for(const width of [761,820,900,1023])for(const fontSize of [null,24,40])test(`mid menu is a reachable ordered prefix at ${width}px, font ${fontSize||'default'}`,async({page})=>{
  await page.setViewportSize({width,height:844});await open(page);
  const trigger=page.locator('#mobileMenuOpen');await expect(trigger).toBeVisible();
  if(fontSize){
    await page.locator('.app-nav').evaluate((nav,size)=>{nav.style.fontSize=size+'px';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='inherit')},fontSize);
    await expect(page.locator('.app-nav [data-view=home]')).toHaveCSS('font-size',fontSize+'px');
    await expect.poll(()=>page.locator('.app-nav').evaluate(nav=>nav.scrollWidth-nav.clientWidth)).toBeLessThanOrEqual(1);
  }
  const direct=page.locator('.app-nav .nav-btn:not(#mobileMenuOpen):visible');
  const labels=await direct.allTextContents();if(width===761&&!fontSize)console.log('D5a 761px visible:',JSON.stringify(labels));expect(labels.length).toBeGreaterThan(0);expect(labels).toEqual(order.slice(0,labels.length));
  const layout=await page.locator('.app-nav').evaluate(nav=>{
    const items=[...nav.querySelectorAll('button')].filter(b=>b.getClientRects().length&&getComputedStyle(b).visibility!=='hidden');
    return {overflow:nav.scrollWidth-nav.clientWidth,documentOverflow:document.documentElement.scrollWidth-innerWidth,ys:items.map(b=>b.getBoundingClientRect().y),sizes:items.map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height})),last:items.at(-1).id};
  });
  expect(layout.overflow).toBeLessThanOrEqual(1);expect(layout.documentOverflow).toBeLessThanOrEqual(1);expect(new Set(layout.ys).size).toBe(1);expect(layout.last).toBe('mobileMenuOpen');
  for(const size of layout.sizes){expect(size.w).toBeGreaterThanOrEqual(44);expect(size.h).toBeGreaterThanOrEqual(44)}
  await expect(page.locator('.app-nav [data-mobile-press]:visible')).toHaveCount(0);
  await trigger.click();
  await expect(page.locator('#mobileMenu [data-mobile-press]:visible')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'공유 페이지',exact:true})).toHaveCount(1);await expect(page.getByRole('button',{name:'성명·보도자료',exact:true})).toHaveCount(0);
  // UI-디자인손질 4·8: the drawer holds the items that did not fit the row.
  expect(await page.locator('#mobileMenu nav button:visible').allTextContents()).toEqual(order.slice(labels.length));
  await expect(page.locator('#mobileMenu [data-theme-open]')).toBeVisible();await expect(page.locator('#mobileMenu [data-kptu-logout]')).toBeVisible();
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  for(const label of order){
    let item=page.locator('.app-nav').getByRole('button',{name:label,exact:true});
    if(!await item.count()){await trigger.click();item=page.locator('#mobileMenu nav').getByRole('button',{name:label,exact:true})}
    await item.click();await expect(page.locator('#mobileMenu')).toBeHidden();
    const view=({'홈':'home','정리함':'basket','업데이트':'basket','챙길 것':'basket','노트':'basket','일정':'calendar','할 일':'tasks','업무일지':'journal','일기':'diary','자료실':'library','사업 보고':'meetings','공유 페이지':'pages','담당조직':'team','HWP 편집':'hwp','원장':'ledger','사진':'photos','통화':'calls','텔레그램 소식':'telegram','아스날':'arsenal'})[label];
    await expect(page.locator('#'+view+'View')).toBeVisible();
    // HWP-화면가득: 폰·폴드 폭의 HWP 편집은 화면 가득이라 위 줄 메뉴가 가려진다. [✕]로 이전 화면에 돌아와 이어 간다.
    if(view==='hwp'){await page.locator('#hwpLabClose').click();await expect(page.locator('#hwpView')).toBeHidden();}
  }
});
test('mid drawer close, back, focus trap, theme and current overflow location',async({page})=>{
  await page.setViewportSize({width:761,height:844});await open(page);
  await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='24px';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='inherit')});
  await expect.poll(()=>page.locator('.app-nav [data-view=team]').count()).toBe(0);
  const trigger=page.locator('#mobileMenuOpen'),drawer=page.locator('#mobileMenu');
  for(const close of ['close','outside','escape','back']){
    await trigger.focus();await page.keyboard.press('Enter');await expect(drawer).toBeVisible();await expect(page.locator('[data-mobile-menu-close]')).toBeFocused();
    await page.keyboard.press('Shift+Tab');await expect(page.locator('#mobileMenu nav button:visible').last()).toBeFocused();await page.keyboard.press('Tab');await expect(page.locator('[data-mobile-menu-close]')).toBeFocused();
    if(close==='close')await page.locator('[data-mobile-menu-close]').click();
    if(close==='outside')await drawer.click({position:{x:10,y:400}});
    if(close==='escape')await page.keyboard.press('Escape');if(close==='back')await page.goBack();
    await expect(drawer).toBeHidden();await expect(trigger).toBeFocused();await expect(page.locator('#homeView')).toBeVisible();
  }
  await trigger.click();await drawer.getByRole('button',{name:'담당조직',exact:true}).click();await expect(page.locator('#teamView')).toBeVisible();await expect(trigger).toHaveAttribute('aria-current','page');
  await trigger.click();await expect(drawer.getByRole('button',{name:'담당조직',exact:true})).toHaveAttribute('aria-current','page');
  await page.goBack();await expect(trigger).toBeFocused();await expect(page.locator('#teamView')).toBeVisible();
  await page.goBack();await expect(page.locator('#homeView')).toBeVisible();await expect(trigger).not.toHaveAttribute('aria-current','page');
  await trigger.click();await drawer.locator('[data-theme-open]').click();await expect(page.locator('#themeModal')).toBeVisible();await page.goBack();await expect(page.locator('#themeModal')).toBeHidden();await expect(trigger).toBeFocused();
});
test('resize and font changes repartition; phone and PC return to their original menus',async({page})=>{
  await page.setViewportSize({width:820,height:844});await open(page);
  const count=()=>page.locator('.app-nav .nav-btn:not(#mobileMenuOpen):visible').count();const normal=await count();
  await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='24px';nav.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='inherit')});
  await expect.poll(count).toBeLessThan(normal);
  await expect.poll(()=>page.locator('.app-nav').evaluate(nav=>nav.scrollWidth-nav.clientWidth)).toBeLessThanOrEqual(1);
  const enlarged=await count();await page.setViewportSize({width:1023,height:844});await expect.poll(count).toBeGreaterThan(enlarged);
  await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='')});await expect.poll(count).toBeGreaterThanOrEqual(normal);await expect.poll(()=>page.locator('.app-nav').evaluate(nav=>nav.scrollWidth-nav.clientWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({width:760,height:844});await expect(page.locator('.app-nav')).toBeHidden();await expect(page.locator('.mobile-tabs')).toBeVisible();await page.locator('#mobileMenuTab').click();
  // 8-9e-2: [바구니]는 하단 탭으로 옮겨 메뉴 창에서 뺐다.
  expect(await page.locator('#mobileMenu nav button:visible').allTextContents()).toEqual(['노트','자료실','HWP 편집','공유 페이지','원장','사진','통화','텔레그램 소식','아스날']);await page.keyboard.press('Escape');
  await page.setViewportSize({width:1024,height:844});await expect(page.locator('#mobileMenuOpen')).toBeHidden();await expect(page.locator('.mobile-tabs')).toBeHidden();
  // UI-PC일정묶음: back on the PC sidebar, 할 일·업무일지·일기 are sub rows under [일정] again (with [달력] first).
  expect(await page.locator('.app-nav .nav-btn:not(#mobileMenuOpen)').allTextContents()).toEqual(['홈','정리함','일정','노트','사업 보고','자료실','공유 페이지','담당조직','HWP 편집','원장','사진','통화','텔레그램 소식','아스날','자주 가는 링크 ›']);
  expect(await page.locator('.app-nav .nav-sub[aria-label="정리함"]').count()).toBe(0);
  expect(await page.locator('.app-nav .nav-sub[aria-label="일정"] .nav-sub-btn:not(.nav-btn)').allTextContents()).toEqual(['달력','할 일','업무일지','일기']);
  expect(await page.locator('.app-nav :is(.nav-btn,.nav-sub-btn[data-view]):not(#mobileMenuOpen)').allTextContents()).toEqual(['홈','정리함','일정','할 일','업무일지','일기','노트','사업 보고','자료실','공유 페이지','담당조직','HWP 편집','원장','사진','통화','텔레그램 소식','아스날','자주 가는 링크 ›']);await expect(page.locator('.app-topline [data-account-open]')).toBeVisible();
});

// 1023px 이하 줄에는 뒤쪽 칸이 다 들어가지 않는다. 글자를 키워 줄에서 빠진 공유 페이지의 지금 위치는
// [메뉴] 버튼과 메뉴 창 안 항목에 표시된다(줄 쪽 표시는 위 "reachable ordered prefix" 시험이 줄/창 어느 쪽이든 검사한다).
test('recalculation preserves keyboard focus and highlights the hidden combined button',async({page})=>{
  await page.setViewportSize({width:900,height:844});await open(page);
  const home=page.locator('.app-nav [data-view="home"]');await home.focus();
  await page.setViewportSize({width:1000,height:844});await expect(home).toBeFocused();
  const trigger=page.locator('#mobileMenuOpen');await trigger.focus();await page.setViewportSize({width:900,height:844});await expect(trigger).toBeFocused();
  await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='40px';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='inherit')});
  await expect.poll(()=>page.locator('.app-nav [data-view="pages"]').count()).toBe(0);
  await trigger.click();await page.locator('#mobileMenu [data-view="pages"]:visible').click();
  await expect(page.locator('#pagesView')).toBeVisible();await expect(trigger).toHaveAttribute('aria-current','page');await trigger.click();
  await expect(page.locator('#mobileMenu [data-view="pages"]:visible')).toHaveAttribute('aria-current','page');
  await page.locator('#mobileMenu [data-view="pages"]:visible').focus();
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
});

test('focused controls stay reachable when crossing the phone and PC boundaries',async({page})=>{
  await page.setViewportSize({width:1023,height:844});await open(page);
  // UI-PC사이드바: at 1024px the [홈] row is hidden and the top line (icon + 홈) is the home menu; focus moves there.
  const home=page.locator('.app-nav [data-view="home"]');await home.focus();await page.setViewportSize({width:1024,height:844});await expect(page.locator('.app-nav .sidebar-brand')).toBeFocused();
  await page.setViewportSize({width:761,height:844});await home.focus();await page.setViewportSize({width:760,height:844});await expect(page.locator('#mobileMenuTab')).toBeFocused();
  await page.setViewportSize({width:761,height:844});await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='40px';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='inherit')});
  await expect.poll(()=>page.locator('.app-nav [data-view="team"]').count()).toBe(0);await page.locator('#mobileMenuOpen').click();await page.locator('#mobileMenu [data-view="team"]').focus();
  await page.setViewportSize({width:760,height:844});await expect(page.locator('[data-mobile-menu-close]')).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('#mobileMenuTab')).toBeFocused();
});

test('shared navigation helper reaches the pages view from the row and from the drawer',async({page})=>{
  await page.setViewportSize({width:820,height:844});await open(page);await clickView(page,'pages');await expect(page.locator('#pagesView')).toBeVisible();
  await clickView(page,'home');await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='40px';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='inherit')});
  await expect.poll(()=>page.locator('.app-nav [data-view="pages"]').count()).toBe(0);await clickView(page,'pages');await expect(page.locator('#pagesView')).toBeVisible();await expect(page.locator('#mobileMenu')).toBeHidden();
});

test('phone breakpoint preserves focus when CSS hides the row before the layout handler',async({page})=>{
  // Chromium versions differ in when display:none clears activeElement.
  await page.addInitScript(()=>matchMedia('(max-width:760px)').addEventListener('change',event=>{
    if(event.matches&&document.activeElement?.closest('.app-nav'))document.activeElement.blur();
  }));
  await page.setViewportSize({width:820,height:844});await open(page);
  await page.locator('.app-nav [data-view="home"]').focus();await page.setViewportSize({width:760,height:844});await expect(page.locator('#mobileMenuTab')).toBeFocused();
});

test('breakpoint recovery does not steal deliberate blur or content input focus',async({page})=>{
  await page.setViewportSize({width:820,height:844});await open(page);
  const home=page.locator('.app-nav [data-view="home"]'),trigger=page.locator('#mobileMenuOpen');
  await home.focus();await home.evaluate(button=>button.blur());await page.setViewportSize({width:760,height:844});await expect(trigger).not.toBeFocused();
  await page.setViewportSize({width:820,height:844});await expect(trigger).toBeVisible();await home.focus();const input=page.getByRole('textbox',{name:'빠른 입력'});await input.focus();await page.setViewportSize({width:760,height:844});await expect(input).toBeFocused();await expect(trigger).not.toBeFocused();
});

// JOURNAL-일기 1차 · BASKET-PC메뉴: 글자를 키워 줄에서 빠진 공유 페이지의 지금 위치는 [메뉴] 버튼과 메뉴 창 안 항목에 표시된다.
for(const width of [900,960,1023])test(`combined current location at ${width}px in the drawer`,async({page})=>{
  await page.setViewportSize({width,height:844});await open(page);await clickView(page,'pages');
  const pages=page.locator('.app-nav [data-view="pages"]'),trigger=page.locator('#mobileMenuOpen');
  await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='40px';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='inherit')});
  await expect.poll(()=>pages.count()).toBe(0);await expect(trigger).toHaveAttribute('aria-current','page');await trigger.click();
  await expect(page.locator('#mobileMenu [data-view="pages"]:visible')).toHaveAttribute('aria-current','page');
  await expect(page.locator('#mobileMenu [data-mobile-press]:visible')).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
});

// 8-9e-2: on phones [바구니] is a bottom tab (not in the drawer) and the drawer opens from the [메뉴] tab.
for(const label of ['자료실','공유 페이지','HWP 편집'])test(`phone drawer focus remains in the open drawer when ${label} is hidden at mid width`,async({page})=>{
  await page.setViewportSize({width:760,height:844});await open(page);
  await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu nav').getByRole('button',{name:label,exact:true}).focus();
  await page.setViewportSize({width:820,height:844});await expect(page.locator('#mobileMenu')).toBeVisible();await expect(page.locator('[data-mobile-menu-close]')).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('#mobileMenuOpen')).toBeFocused();
});
