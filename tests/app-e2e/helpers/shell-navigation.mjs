// Click the actual navigation at this width; also supports historical baseline pages.
export function navigationButton(page,view){
  return page.locator(`.app-nav [data-view="${view}"]:visible,.mobile-tabs [data-view="${view}"]:visible`);
}
// The menu opener at this width: the account trigger (PC), ☰ (761~1023px) or the [메뉴] tab (phone, 8-9e-2).
export function accountButton(page){
  return page.locator('#appView>.app-nav [data-account-open]:visible,#mobileMenuOpen:visible,#mobileMenuTab:visible');
}
export async function clickView(page,view){
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
  if(view==='media'&&!await drawerButton.count()){
    await page.locator('#mobileMenu [data-mobile-press="statement"]').click();
    await page.locator('#mediaView [data-press-type="all"]').click();
  }else await drawerButton.click();
}
