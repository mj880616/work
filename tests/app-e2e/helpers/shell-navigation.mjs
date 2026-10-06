// Click the actual navigation at this width; also supports historical baseline pages.
export function navigationButton(page,view){
  return page.locator(`.app-nav:visible [data-view="${view}"],.mobile-tabs:visible [data-view="${view}"]`);
}
export function accountButton(page){
  return page.locator('#appView>.app-nav:visible [data-account-open],#mobileMenuOpen:visible');
}
export async function clickView(page,view){
  await page.waitForFunction(()=>{
    if(!document.querySelector('#appView.kptu-ui-ready'))return false;
    const tabs=document.querySelector('.mobile-tabs');
    return !tabs||getComputedStyle(tabs).display===(innerWidth<=760?'grid':'none');
  });
  const direct=navigationButton(page,view);
  if(await direct.count()){await direct.click();return}
  await accountButton(page).click();
  if(view==='media'){
    await page.locator('#mobileMenu [data-mobile-press="statement"]').click();
    await page.locator('#mediaView [data-press-type="all"]').click();
  }else await page.locator(`#mobileMenu [data-view="${view}"]`).click();
}
