import {testOrigin} from './helpers/test-origin.mjs';
import {serveBuiltShell} from './helpers/built-shell.mjs';
import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
const app=testOrigin+'/app/';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// 8-9e-2: 폰 하단 탭 6칸 중 화면 탭 다섯(메뉴 탭은 메뉴 창을 연다). 할 일은 [일정] 탭의 [할 일] 쪽.
// MTG-프로젝트합치기 3단계: 4번째 칸은 [사업 보고](사업영역 관리는 그 화면 ⋯ 안에서 연다).
const tabs=['home','basket','calendar','meetings','team'];
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
for(const width of [390,760,761,1024,1440])test(`home and navigation at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  const requests=[];page.on('request',r=>{if(r.url().startsWith(SB))requests.push(r.url())});
  await open(page);
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('[data-home-card="calendar"]')).toContainText('Google 캘린더 연결');
  await expect(page.locator('[data-home-date]').first()).toHaveText(/\d+월 \d+일 [일월화수목금토]요일/);
  expect(requests.some(u=>/app_tasks/.test(u))).toBe(false);
  const mobile=width<=760;
  await expect(page.locator('.mobile-tabs')).toBeVisible({visible:mobile});
  await expect(page.locator('#mobileMenuOpen')).toHaveCount(0);
  await expect(page.locator('#mobileMenuTab')).toBeVisible({visible:mobile});
  await expect(page.locator('#appView>.app-nav')).toBeVisible({visible:!mobile});
  if(mobile){
    expect(await page.locator('.mobile-tabs [data-view]').evaluateAll(ns=>ns.map(n=>n.dataset.view))).toEqual(tabs);
    const box=await page.locator('.mobile-tabs').boundingBox();expect(box.y+box.height).toBe(844);expect(box.height).toBe(56);
    for(const view of tabs){
      const tab=page.locator(`.mobile-tabs [data-view="${view}"]`),r=await tab.boundingBox();expect(r.width).toBeGreaterThanOrEqual(44);expect(r.height).toBeGreaterThanOrEqual(44);
      await tab.click();await expect(page.locator('#'+view+'View')).toBeVisible();await expect(tab).toHaveAttribute('aria-current','page');
    }
  }else if(width<1024)expect(await page.locator('.app-nav .nav-btn:visible').first().getAttribute('data-view')).toBe('home');
  else{
    // UI-PC사이드바: the top line (icon + 홈) is the home menu and carries its selection; the separate [홈] row is gone.
    const brand=page.locator('#appView>.app-nav .sidebar-brand');
    await expect(brand).toHaveText('홈');await expect(brand).toHaveClass(/active/);await expect(brand).toHaveAttribute('aria-current','page');
    await expect(page.locator('#appView>.app-nav .nav-btn[data-view="home"]')).toBeHidden();
    expect(await page.locator('.app-nav .nav-btn:visible').first().getAttribute('data-view')).toBe('basket');
  }
});
test('drawer consumes history before navigation, theme and logout',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  const drawer=page.locator('#mobileMenu'),trigger=page.locator('#mobileMenuTab');
  for(const close of ['outside','escape','back']){
    await trigger.click();await expect(drawer).toBeVisible();
    if(close==='outside')await drawer.click({position:{x:10,y:400}});
    if(close==='escape')await page.keyboard.press('Escape');
    if(close==='back')await page.goBack();
    await expect(drawer).toBeHidden();await expect(page.locator('#homeView')).toBeVisible();
  }
  // 사업 보고는 하단바로 옮겨 메뉴 창에 없으므로 메뉴 창의 자료실로 본다.
  await trigger.click();await page.locator('#mobileMenu [data-view="library"]').click();await expect(page.locator('#libraryView')).toBeVisible();
  await page.goBack();await expect(page.locator('#homeView')).toBeVisible();await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();await page.locator('#mobileMenu [data-theme-open]').click();await expect(page.locator('#themeModal')).toBeVisible();
  await page.locator('[data-theme-choice="navy"]').click();await expect(page.locator('html')).toHaveAttribute('data-theme','navy');
  await page.goBack();await expect(page.locator('#themeModal')).toBeHidden();await expect(drawer).toBeHidden();
  await trigger.click();await page.locator('#mobileMenu [data-kptu-logout]').click();await expect(page).toHaveURL(/\/app\/login\//);
});
test('default is home; explicit calendar, explicit home, retired routes, project and reload preserve addresses',async({page})=>{
  await open(page,app);await expect(page.locator('#homeView')).toBeVisible();
  await page.goto(app+'?view=calendar');await expect(page.locator('#calendarView')).toBeVisible();await expect(page).toHaveURL(/view=calendar/);
  for(const view of ['home','team-ai']){ // PHOTO-사진메뉴: 'photos'는 이제 새 사진 메뉴라 옛 주소 목록에서 뺐다
    await page.goto(app+'?view='+view);await expect(page.locator('#homeView')).toBeVisible();await expect.poll(()=>new URL(page.url()).searchParams.get('view')).toBe(view==='home'?'home':null);
  }
  await page.goto(app+'?project=missing');await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});await expect(page.locator('#projectsView')).toBeVisible();await expect(page).toHaveURL(/project=missing/);
  await page.locator('.sidebar-brand').click();await expect(page.locator('#homeView')).toBeVisible();await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});await expect(page.locator('#homeView')).toBeVisible();
  await page.goto(app);await expect(page.locator('#homeView')).toBeVisible();
});
test('mobile safe area, notices, toast, modal and keyboard keep controls reachable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  // Chromium 140 cannot set safe-area insets through CDP; substitute only the
  // environment value in the served CSS while exercising the actual declarations.
  // 쉬는 틈 미리 받기(UI-기다림표시통일)가 시험이 끝날 때 아직 받는 중일 수 있다: 닫힌 화면의 요청은 조용히 끊는다.
  await page.route(/\.css(?:\?|$)/,async route=>{let r,body;try{r=await route.fetch();body=await r.text()}catch{await route.abort().catch(()=>{});return}await route.fulfill({response:r,body:body.replaceAll('env(safe-area-inset-bottom)','20px')}).catch(()=>{})});
  await serveBuiltShell(page,testOrigin);
  await open(page,app);
  await expect(page.locator('.mobile-tabs')).toHaveCSS('height','76px');
  const tabs=await page.locator('.mobile-tabs').boundingBox();expect(tabs.y+tabs.height).toBe(844);
  await page.route('**/app/index.html',r=>r.fulfill({contentType:'text/html',body:'<script src="./app.js?v=999999"></script>'}));
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#versionNotice')).toBeVisible();
  await page.evaluate(()=>{const t=document.querySelector('#toast');t.textContent='QA';t.classList.remove('hidden')});
  const notice=await page.locator('#versionNotice').boundingBox(),toast=await page.locator('#toast').boundingBox();
  // HOME-모바일정리①: 알림은 화면 맨 위 한 줄, 토스트는 아래 그대로라 겹치지 않는다.
  expect(notice.y).toBe(0);expect(notice.height).toBeLessThanOrEqual(34);expect(toast.y).toBeGreaterThan(notice.y+notice.height);
  await page.locator('[data-version-dismiss]').click();
  await page.locator('.mobile-tabs [data-view="calendar"]').click();await page.locator('#newEventBtn').click();await expect(page.locator('#eventModal')).toBeVisible();
  const stacking=await page.evaluate(()=>({modal:+getComputedStyle(document.querySelector('#eventModal')).zIndex,tabs:+getComputedStyle(document.querySelector('.mobile-tabs')).zIndex}));expect(stacking.modal).toBeGreaterThan(stacking.tabs);
  await page.locator('#eventTitle').focus();
  await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>400});visualViewport.dispatchEvent(new Event('resize'))});
  await expect(page.locator('.mobile-tabs')).toBeHidden();
  await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>844});visualViewport.dispatchEvent(new Event('resize'))});
  await expect(page.locator('.mobile-tabs')).toBeVisible();
  await page.evaluate(()=>{Object.defineProperty(window,'innerHeight',{configurable:true,get:()=>400});Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>400});window.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('resize'))});
  await expect(page.locator('.mobile-tabs')).toBeHidden();
  await page.evaluate(()=>{Object.defineProperty(window,'visualViewport',{configurable:true,value:null});document.querySelector('#eventTitle').blur();document.querySelector('#eventTitle').focus()});
  await expect(page.locator('.mobile-tabs')).toBeHidden();
});
test('KST date crosses the day boundary independently of the browser timezone',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-10-05T16:00:00Z'));await open(page);
  await expect(page.locator('#homeView [data-home-date]')).toHaveText('10월 6일 화요일');
});
test('drawer library item opens once and the account box has no copy-refresh row',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  // The retired 성명·보도자료 item is gone from the drawer; 자료실 opens with one header name.
  await page.locator('#mobileMenuTab').click();await expect(page.locator('#mobileMenu [data-mobile-press]')).toHaveCount(0);
  await expect(page.locator('#mobileMenu [data-view="media"]')).toHaveCount(0);
  await page.locator('#mobileMenu [data-view="library"]').click();
  await expect(page.locator('#libraryView')).toBeVisible();await expect(page.locator('[data-mobile-view-name]')).toHaveText('자료실');
  await page.goBack();await expect(page.locator('#homeView')).toBeVisible();
  let posts=0;await page.route(`${SB}/functions/v1/drive-summary`,r=>{posts++;return r.fulfill({contentType:'application/json',body:'{}'})});
  await page.locator('#mobileMenuTab').click();await expect(page.locator('#mobileMenu [data-drive-summary-refresh]')).toHaveCount(0);
  await expect(page.locator('#mobileMenu [data-account-drive-slot]')).toHaveCount(0);
  await expect(page.locator('#mobileAccountGroup button')).toHaveText(['내 프로필','메뉴 편집','화면 색','로그아웃']);
  await page.keyboard.press('Escape');await expect(page.locator('#mobileMenu')).toBeHidden();
  await page.setViewportSize({width:1440,height:844});await page.setViewportSize({width:390,height:844});
  await page.locator('#mobileMenuTab').click();await expect(page.locator('#mobileAccountGroup button')).toHaveText(['내 프로필','메뉴 편집','화면 색','로그아웃']);
  expect(posts).toBe(0);
});
test('native final return and browser default both open home',async({page})=>{
  await open(page,app);
  await page.evaluate(async()=>{
    Object.defineProperty(navigator,'userAgent',{configurable:true,get:()=> 'KPTUAndroid QA'});
    delete window.__KPTU_NATIVE_BACK_GUARD__;window.KPTUNativeBack={handle:()=>false};
    await import('/app/native-back-guard.js?qa-native-home');
    window.KPTUNativeBack.handle();
  });
  await expect(page.locator('#homeView')).toBeVisible();await expect.poll(()=>new URL(page.url()).searchParams.get('view')).toBe(null);
  await page.goto(app);await expect(page.locator('#homeView')).toBeVisible();
});
test('horizontal swipes never change the tab; the bottom tabs do',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  const swipe=async direction=>{
    const view=await page.evaluate(()=>KPTURouter.current);
    await page.locator('#'+view+'View').evaluate((el,direction)=>{
      const r=el.getBoundingClientRect(),y=r.top+Math.min(r.height/2,80),start=direction==='left'?300:90,end=direction==='left'?90:300;
      for(const [type,x] of [['touchstart',start],['touchmove',(start+end)/2],['touchend',end]]){
        const e=new Event(type,{bubbles:true,cancelable:true}),points=[{clientX:x,clientY:y}];
        Object.defineProperty(e,'touches',{value:type==='touchend'?[]:points});Object.defineProperty(e,'changedTouches',{value:points});el.dispatchEvent(e);
      }
    },direction);
    await page.waitForTimeout(300);
  };
  // UI-밀기탭이동삭제: 어느 탭에서 어느 쪽으로 밀어도 화면은 그대로다.
  for(const view of tabs){
    await page.locator('.mobile-tabs [data-view="'+view+'"]').first().click();
    await expect(page.locator('#'+view+'View')).toBeVisible();
    await swipe('left');await swipe('right');
    expect(await page.evaluate(()=>KPTURouter.current)).toBe(view);
    await expect(page.locator('#'+view+'View')).toBeVisible();
  }
});

 test('mobile current view label and drawer close painted and touch sizes',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page,app);
  await expect(page.locator('[data-mobile-view-name]')).toBeHidden();
  await page.locator('.mobile-tabs [data-view="calendar"]').click();
  await expect(page.locator('[data-mobile-view-name]')).toHaveText('일정');
  // UI-디자인기준 2/3(8-9d): 일정 화면 머리줄 이름은 화면 제목 18px·중간 굵기(500).
  await expect(page.locator('[data-mobile-view-name]')).toHaveCSS('font-size','18px');
  await expect(page.locator('[data-mobile-view-name]')).toHaveCSS('font-weight','500');
  await page.locator('#mobileMenuTab').click();
  // UI-디자인손질 4: on a phone the close control is the sheet's full-width grip (32px, 44px to touch with its ::after).
  const close=page.locator('[data-mobile-menu-close]');await expect(close).toHaveAccessibleName('메뉴 닫기');
  const size=await close.evaluate(el=>{const r=el.getBoundingClientRect(),panel=el.closest('.mobile-menu-panel').getBoundingClientRect(),pseudo=getComputedStyle(el,'::after');return {full:r.width>=panel.width-40,h:r.height,top:pseudo.top,bottom:pseudo.bottom}});
  expect(size).toEqual({full:true,h:32,top:'-6px',bottom:'-6px'});
  // 폰 창은 아래에서 올라오는 동안(ds-sheet-up .2s) 손잡이 자리가 움직인다. 올라온 뒤 자리가 안정되고 누를 자리에서 손잡이가 눌리는 것을
  // 확인한 다음 누른다(locator.click). 움직이는 중에 잰 좌표를 누르면 눌림·뗌 자리가 달라져 닫히지 않는다.
  await page.locator('#mobileMenu .mobile-menu-panel').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
  await close.click();
  await expect(page.locator('#mobileMenu')).toBeHidden();
 });
