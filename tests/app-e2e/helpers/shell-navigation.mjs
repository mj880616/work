// Click the actual navigation at this width; also supports historical baseline pages.
// UI-PC사이드바: on the PC sidebar (1024px~) the home menu is the top line (icon + 홈), not a [data-view="home"] row.
export function navigationButton(page,view){
  const home=view==='home'?',#appView>.app-nav .sidebar-brand:visible':'';
  return page.locator(`.app-nav [data-view="${view}"]:visible,.mobile-tabs [data-view="${view}"]:visible${home}`);
}
// The menu opener at this width: the account trigger (PC, top line right end since UI-상단줄), ☰ (761~1023px) or the [메뉴] tab (phone, 8-9e-2).
export function accountButton(page){
  return page.locator('#appView>.app-topline [data-account-open]:visible,#mobileMenuOpen:visible,#mobileMenuTab:visible');
}
export async function clickView(page,view){
  // HWP-화면가득: 폰·폴드 폭의 HWP 편집은 화면 가득이라 아래 탭·메뉴가 그려지지 않는다. 사람처럼 [✕]로 먼저 이전 화면에 나온다.
  const hwpClose=page.locator('#hwpView:not(.hidden) #hwpLabClose:visible');
  if(view!=='hwp'&&await hwpClose.count()){
    await hwpClose.click();
    await page.waitForFunction(()=>document.querySelector('#hwpView')?.classList.contains('hidden'));
  }
  await page.waitForFunction(()=>{
    if(!document.querySelector('#appView.kptu-ui-ready'))return false;
    const tabs=document.querySelector('.mobile-tabs');
    return !tabs||getComputedStyle(tabs).display===(innerWidth<=760?'grid':'none');
  });
  const direct=navigationButton(page,view);
  if(await direct.count()){
    await direct.click();
    return;
  }
  // Phone (8-9e-2): the [일정] tab opens the side seen last; [달력 | 할 일] on top switches.
  const schedule=page.locator('.mobile-tabs [data-mobile-schedule-tab]:visible');
  if(['calendar','tasks'].includes(view)&&await schedule.count()){
    await schedule.click();
    await page.locator(`.schedule-switch [data-view="${view}"]:visible`).click();
    return;
  }
  await accountButton(page).click();
  const drawerButton=page.locator(`#mobileMenu [data-view="${view}"]:visible`);
  await drawerButton.click();
}
