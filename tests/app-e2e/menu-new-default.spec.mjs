import {test,expect} from '@playwright/test';
import {openHome, OPERATOR_MENU_FEATURES} from './helpers/home-entry.mjs';
// MULTI-하단바기본노트(명진 결정 11/13 15:24, 설계 docs/design/new-user-start.md 2-1): 메뉴를 한 번도 바꾸지 않은 새 계정은
// 폰 하단바 '홈·노트·일정·조직 보고·사업 보고·메뉴', 잊지 말기는 [메뉴] 창 맨 앞, PC 왼쪽 메뉴도 같은 순서.
// 메뉴 순서를 저장해 둔 사람(운영자 시험 고정값 OPERATOR_MENU_LAYOUT = 11/13까지의 기본 모양)은 그대로.
// 화면 사진: SHOT_DIR=docs/design/screens/s62-04a 로 돌릴 때만 남긴다. 합성 값만 쓴다.
const tabLabels=page=>page.locator('#appView .mobile-tabs > button').evaluateAll(list=>list.map(b=>b.textContent.trim()));
const sheetIds=page=>page.evaluate(()=>[...document.querySelector('#mobileMenu nav[aria-label="더 보기"]').children]
  .map(el=>el.matches('[data-menu-tail-line]')?'LINE':el.dataset.view||el.dataset.basketKindNav||''));
const pcMain=page=>page.evaluate(()=>{
  const root=document.querySelector('#appNav'),spacer=root.querySelector('.sidebar-spacer');
  return [...root.querySelectorAll('.nav-btn')].filter(el=>el.getClientRects().length&&!(spacer.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))
    .map(el=>el.dataset.basketKindNav||el.dataset.view);
});
const shot=async(page,name)=>{if(process.env.SHOT_DIR)await page.screenshot({path:`${process.env.SHOT_DIR}/${name}.png`})};

for(const width of [360,412]){
  test(`새 계정 폰 하단바 (${width}px): 홈·노트·일정·조직 보고·사업 보고·메뉴, 잊지 말기는 [메뉴] 창 맨 앞`,async({page})=>{
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await openHome(page,{features:[],menuLayout:null});
    await expect.poll(()=>tabLabels(page)).toEqual(['홈','노트','일정','조직 보고','사업 보고','메뉴']);
    await shot(page,`${width}-1-bar`);
    // [노트] 칸을 누르면 노트가 열리고 그 칸이 켜진다.
    await page.locator('.mobile-tabs [data-basket-kind-nav="note"]').click();
    await expect(page.locator('.mobile-tabs [data-basket-kind-nav="note"]')).toHaveAttribute('aria-current','page');
    await expect(page.locator('#basketView')).toBeVisible();
    // [메뉴] 창: 잊지 말기가 맨 앞, 노트는 없다(하단바에 있음). 운영자 기능이 없는 계정이라 통화·텔레그램 소식·아스날·파일·News는 없다.
    await page.locator('#mobileMenuTab').click();
    await expect(page.locator('#mobileMenu')).toBeVisible();
    await expect.poll(()=>sheetIds(page)).toEqual(['basket','library','brief','hwp','pages','photos']);
    await page.waitForTimeout(400);
    await shot(page,`${width}-2-menu`);
    await page.locator('#mobileMenu [data-view="basket"]').click();
    await expect(page.locator('#basketView')).toBeVisible();
    await expect(page.locator('.mobile-tabs [aria-current="page"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for(const width of [840,1280]){
  test(`새 계정 PC 왼쪽 메뉴(${width}px, 폴드 펼침·PC): 하단바 기본과 같은 순서 — 노트·일정·조직 보고·사업 보고 뒤 잊지 말기`,async({page})=>{
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await openHome(page,{features:[],menuLayout:null});
    // 홈은 왼쪽 메뉴 맨 위 이름 줄(홈 줄은 폭에 따라 숨음)이라 비교에서 뺀다.
    await expect.poll(async()=>(await pcMain(page)).filter(id=>id!=='home')).toEqual(['note','calendar','team','meetings','basket','library','brief','hwp','pages','photos']);
    await shot(page,`${width}-1-side`);
    expect(errors).toEqual([]);
  });
}

test('메뉴 순서를 저장해 둔 사람(운영자)은 그대로: 하단바 홈·잊지 말기·일정·사업 보고·조직 보고',async({page})=>{
  await page.setViewportSize({width:412,height:900});
  const {prefs}=await openHome(page,{features:OPERATOR_MENU_FEATURES});
  await expect.poll(()=>tabLabels(page)).toEqual(['홈','잊지 말기','일정','사업 보고','조직 보고','메뉴']);
  await page.locator('#mobileMenuTab').click();
  await expect.poll(()=>sheetIds(page)).toEqual(['note','library','files','brief','hwp','pages','photos','outside','LINE','calls','telegram','arsenal']);
  await shot(page,'412-3-saved-operator');
  expect(prefs.patches).toEqual([]);
});
