import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';
// MENU-숨김(2026-11-03 요청): 메뉴 편집에서 [숨기기]한 메뉴는 폰 [메뉴] 창 위쪽·PC 왼쪽 메뉴 줄에서 빠지고, 접힌 '숨긴 메뉴 n' 안에서만 열린다.
// 기능·주소는 그대로. 서버 저장 모양은 {bar, rest}뿐이고 숨긴 메뉴는 rest 안 'hidden' 표시 뒤(DB 검사가 받는 모양 그대로, DB 변경 없음).
const modal=page=>page.locator('#menuEditModal');
const list=(page,name)=>modal(page).locator(`[data-reorder-list="${name}"]`);
const ids=(page,name)=>list(page,name).locator('[data-reorder-id]').evaluateAll(rows=>rows.map(row=>row.dataset.reorderId));
async function openEdit(page,width){
  await accountButton(page).click();
  const panel=page.locator(width<=760?'#mobileMenu':'#sidebarAccountPanel');
  await expect(panel).toBeVisible();
  await panel.locator('[data-menu-edit-open]').click();
  await expect(modal(page)).toBeVisible();
}
// 보이는 줄(접힌 칸 밖)에 있는 메뉴 이름과 접힌 칸 안의 이름. 화면 폭과 관계없이 같은 저장값으로 그려진다.
const placed=page=>page.evaluate(()=>{
  const view=el=>el.dataset.view||el.dataset.basketKindNav||'';
  const sheet=document.querySelector('#mobileMenu nav[aria-label="더 보기"]'),nav=document.querySelector('#appNav');
  return {
    sheetShown:[...sheet.querySelectorAll('button')].filter(b=>!b.closest('[data-menu-hidden-group]')).map(view),
    sheetHidden:[...sheet.querySelectorAll('[data-menu-hidden-group] button')].map(view),
    sheetCount:sheet.querySelector('[data-menu-hidden-group] summary')?.textContent||'',
    pcShown:[...nav.querySelectorAll('.nav-btn[data-view]')].filter(b=>!b.closest('.nav-hidden-group')).map(view),
    pcHidden:[...nav.querySelectorAll('.nav-hidden-group .nav-btn')].map(view),
    pcCount:nav.querySelector('.nav-hidden-group>summary')?.textContent||''
  };
});

for(const width of [1440,412]){
  test(`메뉴 숨기기 (${width}px): 원장·공유 페이지를 숨기고 새로고침에도 그대로, 다시 꺼내기, 홈은 못 숨김`,async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const {prefs}=await openHome(page);
    let now=await placed(page);
    expect(now.sheetHidden).toEqual([]);expect(now.pcHidden).toEqual([]);
    expect(now.sheetShown).toEqual(expect.arrayContaining(['ledger','pages']));

    await openEdit(page,width);
    await expect(modal(page).locator('.me-group h3')).toHaveText([/^폰 하단바/,/^위 메뉴/,/^아래 붙는 메뉴/,/^숨긴 메뉴/]);
    await expect(modal(page).locator('[data-reorder-id="home"] [data-menu-edit-hide]')).toHaveCount(0);
    await modal(page).locator('[data-reorder-id="ledger"] [data-menu-edit-hide]').click();
    await modal(page).locator('[data-reorder-id="pages"] [data-menu-edit-hide]').click();
    await expect.poll(()=>ids(page,'hidden')).toEqual(['ledger','pages']);
    expect(await ids(page,'rest')).not.toContain('ledger');
    await expect(modal(page).locator('.me-pv-hidden')).toHaveText('숨긴 메뉴 2 ▸');

    // 서버 저장: {bar, rest}뿐, 숨긴 메뉴는 'hidden' 표시 뒤.
    await expect.poll(()=>prefs.value?.menu_layout?.rest?.slice(-3)).toEqual(['hidden','ledger','pages']);
    expect(Object.keys(prefs.value.menu_layout).sort()).toEqual(['bar','rest']);
    await modal(page).locator('[data-close="menuEditModal"]').click();
    await expect(modal(page)).toBeHidden();

    const check=async()=>{
      await expect.poll(async()=>{const p=await placed(page);return JSON.stringify([p.sheetShown.filter(v=>v==='ledger'||v==='pages'),p.sheetHidden,p.sheetCount,p.pcShown.filter(v=>v==='ledger'||v==='pages'),p.pcHidden,p.pcCount])}).toBe(JSON.stringify([[],['ledger','pages'],'숨긴 메뉴 2',[],['ledger','pages'],'숨긴 메뉴 2']));
    };
    await check();
    if(width>=1024){
      // PC: 접힌 '숨긴 메뉴 2'를 열면 원장 버튼이 보인다(기능·주소는 그대로).
      const group=page.locator('#appNav .nav-hidden-group');
      await expect(group.locator('summary')).toBeVisible();
      await group.locator('summary').click();
      await expect(group.locator('.nav-btn[data-view="ledger"]')).toBeVisible();
    }
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
    await check();

    // 다시 꺼내기: 숨긴 칸이 비면 접힌 칸도 없고 서버 칸에 'hidden' 표시가 남지 않는다.
    await openEdit(page,width);
    await modal(page).locator('[data-reorder-id="ledger"] [data-menu-edit-show]').click();
    await modal(page).locator('[data-reorder-id="pages"] [data-menu-edit-show]').click();
    await expect.poll(()=>ids(page,'hidden')).toEqual([]);
    await expect.poll(()=>prefs.value?.menu_layout?.rest?.includes('hidden')).toBe(false);
    await modal(page).locator('[data-close="menuEditModal"]').click();
    await expect.poll(async()=>{const p=await placed(page);return JSON.stringify([p.sheetHidden,p.pcHidden,p.sheetCount,p.pcCount])}).toBe(JSON.stringify([[],[],'','']));
    expect(errors).toEqual([]);
  });
}
