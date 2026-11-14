import {test,expect} from '@playwright/test';
import {openHome, OPERATOR_MENU_FEATURES} from './helpers/home-entry.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';
// MENU-숨김(2026-11-03 요청, 11-04 접힌 줄 없앰): 메뉴 편집에서 [숨기기]한 메뉴는 폰 [메뉴] 창·PC 왼쪽 메뉴 어디에도 없고('숨긴 메뉴 n' 줄도 없음), 메뉴 편집의 [꺼내기]로만 돌아온다.
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
// [메뉴] 창과 PC 왼쪽 메뉴에 그려진 메뉴 이름, 그리고 '숨긴 메뉴' 글자가 든 줄(있으면 안 됨).
const placed=page=>page.evaluate(()=>{
  const view=el=>el.dataset.view||el.dataset.basketKindNav||'';
  const sheet=document.querySelector('#mobileMenu nav[aria-label="더 보기"]'),nav=document.querySelector('#appNav');
  const rows=root=>[...root.querySelectorAll('details,summary')].filter(el=>/숨긴 메뉴/.test(el.textContent)).length;
  return {
    sheetShown:[...sheet.querySelectorAll('button')].map(view),
    pcShown:[...nav.querySelectorAll('.nav-btn[data-view]')].map(view),
    leftoverRows:rows(sheet)+rows(nav)+document.querySelectorAll('[data-menu-hidden-group],[data-nav-hidden-group],.nav-hidden-group,.mobile-menu-hidden').length
  };
});

for(const width of [1440,412]){
  test(`메뉴 숨기기 (${width}px): HWP 편집·공유 페이지를 숨기고 새로고침에도 그대로, 다시 꺼내기, 홈은 못 숨김`,async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const {prefs}=await openHome(page,{features:OPERATOR_MENU_FEATURES});
    let now=await placed(page);
    expect(now.leftoverRows).toBe(0);
    expect(now.sheetShown).toEqual(expect.arrayContaining(['hwp','pages']));

    await openEdit(page,width);
    // UI-줄버튼: 줄 안 [숨기기]는 테두리·바탕 없는 작은 회색 글자, 누르는 범위는 44px.
    const toggle=modal(page).locator('[data-reorder-id="hwp"] [data-menu-edit-hide]');
    const look=await toggle.evaluate(el=>{const cs=getComputedStyle(el),tag=getComputedStyle(document.querySelector('#menuEditModal .me-tag')),after=getComputedStyle(el,'::after');return {border:cs.borderTopWidth,bg:cs.backgroundColor,size:cs.fontSize,tagSize:tag.fontSize,hit:after.height,row:el.closest('.me-row').getBoundingClientRect().height}});
    expect(look.border).toBe('0px');expect(look.bg).toBe('rgba(0, 0, 0, 0)');expect(look.size).toBe(look.tagSize);expect(look.hit).toBe('44px');expect(look.row).toBeLessThanOrEqual(29);
    await modal(page).screenshot({path:`test-results/menu-edit-${width}.png`});
    await expect(modal(page).locator('.me-group h3')).toHaveText([/^폰 하단바/,/^위 메뉴/,/^아래 붙는 메뉴/,/^숨긴 메뉴/]);
    await expect(modal(page).locator('[data-reorder-id="home"] [data-menu-edit-hide]')).toHaveCount(0);
    await modal(page).locator('[data-reorder-id="hwp"] [data-menu-edit-hide]').click();
    await modal(page).locator('[data-reorder-id="pages"] [data-menu-edit-hide]').click();
    await expect.poll(()=>ids(page,'hidden')).toEqual(['hwp','pages']);
    expect(await ids(page,'rest')).not.toContain('hwp');
    await expect(modal(page).locator('.me-pv-hidden')).toHaveCount(0);

    // 서버 저장: {bar, rest}뿐, 숨긴 메뉴는 'hidden' 표시 뒤.
    await expect.poll(()=>prefs.value?.menu_layout?.rest?.slice(-3)).toEqual(['hidden','hwp','pages']);
    expect(Object.keys(prefs.value.menu_layout).sort()).toEqual(['bar','rest']);
    await modal(page).locator('[data-close="menuEditModal"]').click();
    await expect(modal(page)).toBeHidden();

    const check=async()=>{
      await expect.poll(async()=>{const p=await placed(page);return JSON.stringify([p.sheetShown.filter(v=>v==='hwp'||v==='pages'),p.pcShown.filter(v=>v==='hwp'||v==='pages'),p.leftoverRows])}).toBe(JSON.stringify([[],[],0]));
    };
    await check();
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
    await check();

    // 다시 꺼내기: 서버 칸에 'hidden' 표시가 남지 않는다.
    await openEdit(page,width);
    await modal(page).locator('[data-reorder-id="hwp"] [data-menu-edit-show]').click();
    await modal(page).locator('[data-reorder-id="pages"] [data-menu-edit-show]').click();
    await expect.poll(()=>ids(page,'hidden')).toEqual([]);
    await expect.poll(()=>prefs.value?.menu_layout?.rest?.includes('hidden')).toBe(false);
    await modal(page).locator('[data-close="menuEditModal"]').click();
    // 꺼내면 [메뉴] 창과 PC 왼쪽 메뉴에 다시 나타난다.
    await expect.poll(async()=>{const p=await placed(page);return JSON.stringify([p.sheetShown.includes('hwp')&&p.sheetShown.includes('pages'),p.pcShown.includes('hwp')&&p.pcShown.includes('pages'),p.leftoverRows])}).toBe(JSON.stringify([true,true,0]));
    expect(errors).toEqual([]);
  });
}
