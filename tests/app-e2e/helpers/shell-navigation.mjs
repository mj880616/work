// Click the actual navigation at this width; also supports historical baseline pages.
// UI-PC사이드바: on the PC sidebar (761px~) the home menu is the top line (icon + 홈), not a [data-view="home"] row.
export function navigationButton(page,view){
  const home=view==='home'?',#appView>.app-nav .sidebar-brand:visible':'';
  return page.locator(`.app-nav [data-view="${view}"]:visible,.mobile-tabs [data-view="${view}"]:visible${home}`);
}
// The menu opener at this width: the account trigger (PC frame 761px~, top line right end since UI-상단줄) or the [메뉴] tab (phone, 8-9e-2).
export function accountButton(page){
  return page.locator('#appView>.app-topline [data-account-open]:visible,#mobileMenuTab:visible');
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
  // UI-폴드PC틀: at 761~1023px the left menu is a narrow picture column; the [일정] sub rows (할 일·업무일지·일기) show after the
  // top line's menu button spreads the names out, as a person would do.
  if(await page.locator(`#appView>.app-nav .nav-sub [data-view="${view}"]`).count()&&!await navigationButton(page,view).count()
    &&await page.evaluate(()=>matchMedia('(min-width:761px) and (max-width:1023px)').matches)){
    await page.locator('#appView>.app-topline [data-nav-toggle]').click();
    await page.locator(`#appView.nav-open>.app-nav .nav-sub [data-view="${view}"]`).waitFor();
  }
  const direct=navigationButton(page,view);
  if(await direct.count()){
    await direct.click();
    return;
  }
  // MTG-프로젝트합치기 3단계: [프로젝트] 메뉴가 없다. 사업영역 관리(라우터 이름 projects)는 사람처럼 사업 보고 ⋯ → [사업영역 관리]로 연다.
  if(view==='projects'){
    // MTG-프로젝트합치기 ①: 사업영역 관리는 사업 보고 위 창. 이미 떠 있으면(새로고침으로 다시 뜬 창 등) 그대로 둔다.
    if(await page.locator('#areaWindow:not(.hidden)').count())return;
    await clickView(page,'meetings');
    // ⋯ 안 [사업영역 관리]의 처리기는 사업 보고 화면 모듈(team.js)이 붙이므로, 그 화면이 다 뜬 뒤에 누른다.
    await page.waitForFunction(()=>!document.querySelector('#meetingsView')?.classList.contains('hidden')&&window.KPTUViewLoader?.isLoaded?.('meetings')!==false);
    await page.locator('#meetingsView #reportMore:visible').click();
    await page.locator('#reportMoreMenu [data-report-areas]:visible').click();
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
