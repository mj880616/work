import {clickView} from './helpers/shell-navigation.mjs';
import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
const app='http://127.0.0.1:8123/app/';
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
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
}
const order=['홈','일정','할 일','프로젝트','자료실','회의','성명·보도자료','게시판','담당조직'];
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
  await expect(page.getByRole('button',{name:'성명·보도자료',exact:true})).toHaveCount(1);
  expect(await page.locator('#mobileMenu nav button:visible').allTextContents()).toEqual(order.slice(labels.length));
  await expect(page.locator('#mobileMenu [data-theme-open]')).toBeVisible();await expect(page.locator('#mobileMenu [data-kptu-logout]')).toBeVisible();
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
  for(const label of order){
    let item=page.locator('.app-nav').getByRole('button',{name:label,exact:true});
    if(!await item.count()){await trigger.click();item=page.locator('#mobileMenu nav').getByRole('button',{name:label,exact:true})}
    await item.click();await expect(page.locator('#mobileMenu')).toBeHidden();
    const view=({'홈':'home','일정':'calendar','할 일':'tasks','프로젝트':'projects','자료실':'library','회의':'meetings','성명·보도자료':'media','게시판':'pages','담당조직':'team'})[label];
    await expect(page.locator('#'+view+'View')).toBeVisible();
    if(label==='성명·보도자료')await expect(page.locator('.app-nav [data-view="media"],#mobileMenu nav [data-view="media"]')).toHaveAttribute('aria-current','page');
  }
});
test('mid drawer close, back, focus trap, theme and current overflow location',async({page})=>{
  await page.setViewportSize({width:761,height:844});await open(page);
  await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='24px';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='inherit')});
  await expect.poll(()=>page.locator('.app-nav [data-view=team]').count()).toBe(0);
  const trigger=page.locator('#mobileMenuOpen'),drawer=page.locator('#mobileMenu');
  for(const close of ['close','outside','escape','back']){
    await trigger.focus();await page.keyboard.press('Enter');await expect(drawer).toBeVisible();await expect(page.locator('[data-mobile-menu-close]')).toBeFocused();
    await page.keyboard.press('Shift+Tab');await expect(page.locator('#mobileMenu [data-kptu-logout]')).toBeFocused();await page.keyboard.press('Tab');await expect(page.locator('[data-mobile-menu-close]')).toBeFocused();
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
  await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='')});await expect.poll(count).toBe(normal);
  await page.setViewportSize({width:760,height:844});await expect(page.locator('.app-nav')).toBeHidden();await expect(page.locator('.mobile-tabs')).toBeVisible();await page.locator('#mobileMenuOpen').click();
  expect(await page.locator('#mobileMenu nav button:visible').allTextContents()).toEqual(['회의','자료실','성명','보도자료','게시판']);await page.keyboard.press('Escape');
  await page.setViewportSize({width:1024,height:844});await expect(page.locator('#mobileMenuOpen')).toBeHidden();await expect(page.locator('.mobile-tabs')).toBeHidden();
  expect(await page.locator('.app-nav .nav-btn:not(#mobileMenuOpen)').allTextContents()).toEqual(['홈','일정','할 일','프로젝트','자료실','회의','성명·보도자료','게시판','담당조직']);await expect(page.locator('.app-nav [data-account-open]')).toBeVisible();
});

test('recalculation preserves keyboard focus and highlights the hidden combined media button',async({page})=>{
  await page.setViewportSize({width:820,height:844});await open(page);
  const home=page.locator('.app-nav [data-view="home"]');await home.focus();
  await page.setViewportSize({width:900,height:844});await expect(home).toBeFocused();
  const trigger=page.locator('#mobileMenuOpen');await trigger.focus();await page.setViewportSize({width:820,height:844});await expect(trigger).toBeFocused();
  await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='32px';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='inherit')});
  await expect.poll(()=>page.locator('.app-nav [data-view="media"]').count()).toBe(0);
  await trigger.click();await page.locator('#mobileMenu [data-view="media"]').click();
  await expect(page.locator('#mediaView')).toBeVisible();await expect(trigger).toHaveAttribute('aria-current','page');await trigger.click();
  await expect(page.locator('#mobileMenu [data-view="media"]')).toHaveAttribute('aria-current','page');for(const type of ['statement','release'])await expect(page.locator(`[data-mobile-press="${type}"]`)).not.toHaveAttribute('aria-current','page');
  await page.locator('#mobileMenu [data-view="media"]').focus();
  await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='')});
  await expect.poll(()=>page.locator('.app-nav [data-view="media"]').count()).toBe(1);await expect(page.locator('[data-mobile-menu-close]')).toBeFocused();
  await expect(trigger).not.toHaveAttribute('aria-current','page');await expect(page.locator('.app-nav [data-view="media"]')).toHaveAttribute('aria-current','page');
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
});

test('focused controls stay reachable when crossing the phone and PC boundaries',async({page})=>{
  await page.setViewportSize({width:1023,height:844});await open(page);
  const home=page.locator('.app-nav [data-view="home"]');await home.focus();await page.setViewportSize({width:1024,height:844});await expect(home).toBeFocused();
  await page.setViewportSize({width:761,height:844});await home.focus();await page.setViewportSize({width:760,height:844});await expect(page.locator('#mobileMenuOpen')).toBeFocused();
  await page.setViewportSize({width:761,height:844});await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='40px';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='inherit')});
  await expect.poll(()=>page.locator('.app-nav [data-view="team"]').count()).toBe(0);await page.locator('#mobileMenuOpen').click();await page.locator('#mobileMenu [data-view="team"]').focus();
  await page.setViewportSize({width:760,height:844});await expect(page.locator('[data-mobile-menu-close]')).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('#mobileMenuOpen')).toBeFocused();
});

test('shared navigation helper reaches media from the row and from the drawer',async({page})=>{
  await page.setViewportSize({width:820,height:844});await open(page);await clickView(page,'media');await expect(page.locator('#mediaView')).toBeVisible();await expect(page.locator('#mediaView [data-press-type="all"]')).toHaveClass(/active/);
  await clickView(page,'home');await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='40px';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='inherit')});
  await expect.poll(()=>page.locator('.app-nav [data-view="media"]').count()).toBe(0);await clickView(page,'media');await expect(page.locator('#mediaView')).toBeVisible();await expect(page.locator('#mediaView [data-press-type="all"]')).toHaveClass(/active/);await expect(page.locator('#mobileMenu')).toBeHidden();
});

test('phone breakpoint preserves focus when CSS hides the row before the layout handler',async({page})=>{
  // Chromium versions differ in when display:none clears activeElement.
  await page.addInitScript(()=>matchMedia('(max-width:760px)').addEventListener('change',event=>{
    if(event.matches&&document.activeElement?.closest('.app-nav'))document.activeElement.blur();
  }));
  await page.setViewportSize({width:820,height:844});await open(page);
  await page.locator('.app-nav [data-view="home"]').focus();await page.setViewportSize({width:760,height:844});await expect(page.locator('#mobileMenuOpen')).toBeFocused();
});

test('breakpoint recovery does not steal deliberate blur or content input focus',async({page})=>{
  await page.setViewportSize({width:820,height:844});await open(page);
  const home=page.locator('.app-nav [data-view="home"]'),trigger=page.locator('#mobileMenuOpen');
  await home.focus();await home.evaluate(button=>button.blur());await page.setViewportSize({width:760,height:844});await expect(trigger).not.toBeFocused();
  await page.setViewportSize({width:820,height:844});await expect(trigger).toBeVisible();await home.focus();const input=page.getByRole('textbox',{name:'빠른 입력'});await input.focus();await page.setViewportSize({width:760,height:844});await expect(input).toBeFocused();await expect(trigger).not.toBeFocused();
});

for(const width of [761,820,900,1023])test(`combined media current location at ${width}px in row and drawer`,async({page})=>{
  await page.setViewportSize({width,height:844});await open(page);await clickView(page,'media');
  const media=page.locator('.app-nav [data-view="media"]'),trigger=page.locator('#mobileMenuOpen');
  await expect(media).toHaveAttribute('aria-current','page');
  for(const type of ['release','statement','all']){
    await page.locator(`#mediaView [data-press-type="${type}"]`).click();await expect(media).toHaveAttribute('aria-current','page');
  }
  await page.locator('.app-nav').evaluate(nav=>{nav.style.fontSize='40px';document.querySelectorAll('.nav-btn').forEach(b=>b.style.fontSize='inherit')});
  await expect.poll(()=>media.count()).toBe(0);await expect(trigger).toHaveAttribute('aria-current','page');await trigger.click();
  await expect(page.locator('#mobileMenu [data-view="media"]')).toHaveAttribute('aria-current','page');
  await expect(page.locator('#mobileMenu [data-mobile-press]:visible')).toHaveCount(0);
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
});

for(const label of ['회의','자료실','성명','보도자료','게시판'])test(`phone drawer focus remains in the open drawer when ${label} is hidden at mid width`,async({page})=>{
  await page.setViewportSize({width:760,height:844});await open(page);
  await page.locator('#mobileMenuOpen').click();await page.locator('#mobileMenu nav').getByRole('button',{name:label,exact:true}).focus();
  await page.setViewportSize({width:820,height:844});await expect(page.locator('#mobileMenu')).toBeVisible();await expect(page.locator('[data-mobile-menu-close]')).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('#mobileMenuOpen')).toBeFocused();
});
