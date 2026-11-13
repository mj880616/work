import {test,expect} from '@playwright/test';
import {openHome, OPERATOR_MENU_FEATURES} from './helpers/home-entry.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';
// MULTI-처음쓰는사람 ④(docs/design/new-user-start.md 2-1): 메뉴는 서버 운영자 기능 답(app_my_features)에 따라 목록에서 뺀다(숨김이 아니라 빼기).
// - 새 계정(기능 없음): 통화·텔레그램 소식·파일·아스날·News가 PC 왼쪽 메뉴·폰 [메뉴] 창·메뉴 편집 어디에도 없다.
// - 운영자 계정(명진): 지금 메뉴 그대로(원장만 빠짐).
// - 원장은 모든 계정 메뉴에서 빠지지만, 화면은 그대로 열린다(다른 화면에서 여는 길).
// - 답을 못 받으면(서버 오류) 아무것도 빼지 않는다(운영자 메뉴가 잠깐 사라지지 않게).
const OP=['calls','telegram','files','arsenal','outside'];
const placed=page=>page.evaluate(()=>{
  const view=el=>el.dataset.view||el.dataset.basketKindNav||'';
  const sheet=document.querySelector('#mobileMenu nav[aria-label="더 보기"]'),nav=document.querySelector('#appNav'),tabs=document.querySelector('#appView .mobile-tabs');
  return {
    sheet:[...sheet.querySelectorAll('button')].map(view),
    pc:[...nav.querySelectorAll('.nav-btn[data-view],.nav-btn[data-basket-kind-nav]')].map(view),
    bar:[...tabs.querySelectorAll('button[data-view],button[data-basket-kind-nav]')].map(view),
  };
});
const settle=async page=>{await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});await page.waitForTimeout(400);};

for(const width of [1280,760,412]){
  test(`새 계정 (${width}px): 운영자 메뉴·원장은 메뉴 목록에 없고, 메뉴 편집에도 없다`,async({page})=>{
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await openHome(page,{features:[]});await settle(page);
    await expect.poll(async()=>{const p=await placed(page);return [...p.sheet,...p.pc].filter(v=>OP.includes(v)||v==='ledger')}).toEqual([]);
    const p=await placed(page);
    expect(p.sheet).toEqual(['note','library','hwp','pages','photos']);
    expect(p.bar).toEqual(['home','basket','calendar','meetings','team']);
    expect(page.locator('#mobileMenu [data-menu-tail-line]')).toHaveCount(0);
    // 메뉴 편집 창: 뺀 메뉴는 칸에도 미리보기에도 없다.
    await accountButton(page).click();
    const panel=page.locator(width<=760?'#mobileMenu':'#sidebarAccountPanel');
    await panel.locator('[data-menu-edit-open]').click();
    const modal=page.locator('#menuEditModal');
    await expect(modal).toBeVisible();
    const rows=await modal.locator('[data-reorder-id]').evaluateAll(r=>r.map(x=>x.dataset.reorderId));
    expect(rows.filter(v=>OP.includes(v)||v==='ledger')).toEqual([]);
    await expect(modal.locator('[data-menu-edit-preview]')).not.toContainText('통화');
    await expect(modal.locator('[data-menu-edit-preview]')).not.toContainText('원장');
    await page.screenshot({path:`docs/design/screens/s61-41/menu-new-${width}.png`});
    expect(errors).toEqual([]);
  });
  test(`운영자 계정 (${width}px): 메뉴는 지금 그대로(원장만 빠짐)`,async({page})=>{
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await openHome(page,{features:OPERATOR_MENU_FEATURES});await settle(page);
    const p=await placed(page);
    expect(p.sheet).toEqual(['note','library','files','hwp','pages','photos','outside','calls','telegram','arsenal']);
    expect(p.pc).toEqual(['home','basket','calendar','note','meetings','library','files','pages','team','hwp','photos','outside','calls','telegram','arsenal']);
    expect(p.bar).toEqual(['home','basket','calendar','meetings','team']);
    await page.screenshot({path:`docs/design/screens/s61-41/menu-operator-${width}.png`});
    expect(errors).toEqual([]);
  });
}
test('원장 화면은 메뉴에 없어도 그대로 열린다',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await openHome(page,{features:[]});await settle(page);
  await page.evaluate(()=>window.KPTURouter.go('ledger'));
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter.current)).toBe('ledger');
  await expect(page.locator('#ledgerView')).toBeVisible();
});
test('운영자 기능 답을 못 받으면 메뉴를 빼지 않는다',async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await openHome(page,{fail:'app_my_features'});await settle(page);
  const p=await placed(page);
  for(const id of OP)expect(p.pc,id).toContain(id);
});
