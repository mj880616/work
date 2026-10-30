import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';
// MENU-세칸(2026-10-30 요청): 메뉴 편집 창은 화면 모양 그대로 세 칸(폰 하단바 / 위 메뉴 / 아래 붙는 메뉴)이고, 어떤 메뉴든 칸 사이를 끌어 옮긴다.
// 아래 붙는 메뉴 칸은 PC 왼쪽 맨 아래 묶음과 폰 [메뉴] 창 맨 아래(선 아래)를 함께 정한다. 저장은 서버(view_prefs.menu_layout, 흉내 낸 서버)뿐.
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
// 폰 [메뉴] 창 안 순서(선은 LINE)와 PC 왼쪽 메뉴의 위 줄·맨 아래 묶음. 화면 폭과 관계없이 둘 다 같은 저장값으로 그려진다.
const sheetOrder=page=>page.evaluate(()=>[...document.querySelector('#mobileMenu nav[aria-label="더 보기"]').children]
  .map(el=>el.matches('[data-menu-tail-line]')?'LINE':el.dataset.view||el.dataset.basketKindNav||''));
const pcSide=page=>page.evaluate(()=>{
  const nav=document.querySelector('#appNav'),spacer=nav.querySelector('.sidebar-spacer');
  const below=id=>!!(spacer.compareDocumentPosition(nav.querySelector(`.nav-btn[data-view="${id}"]`))&Node.DOCUMENT_POSITION_FOLLOWING);
  const feed=[...nav.querySelectorAll('.nav-btn.nav-feed')].map(el=>el.dataset.view);
  return {photos:below('photos'),calls:below('calls'),feed,first:nav.querySelector('.nav-feed-first')?.dataset.view||''};
});

for(const width of [1440,884,412]){
  test(`메뉴 편집 세 칸 (${width}px): 사진을 아래 칸으로 끌고 통화를 위 메뉴로, 새로고침에도 그대로, [처음대로]`,async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const {prefs}=await openHome(page);
    // 처음 모양: 폰 [메뉴] 창도 선 아래에 통화·텔레그램 소식·아스날.
    expect((await sheetOrder(page)).slice(-4)).toEqual(['LINE','calls','telegram','arsenal']);
    await openEdit(page,width);
    await expect(modal(page).locator('.me-group h3')).toHaveText([/^폰 하단바/,/^위 메뉴/,/^아래 붙는 메뉴/]);
    expect(await ids(page,'tail')).toEqual(['calls','telegram','arsenal']);
    await expect(modal(page).locator('.me-pv-tail li')).toHaveText(['통화','텔레그램 소식','아스날']);

    // 끌기: 위 메뉴 맨 아래 [사진]의 ⠿을 잡아 아래 칸 맨 위로.
    const handle=list(page,'rest').locator('[data-reorder-id="photos"] [data-reorder-handle]');
    await handle.scrollIntoViewIfNeeded();
    const from=await handle.boundingBox(),to=await list(page,'tail').locator('[data-reorder-id]').first().boundingBox();
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2+10,{steps:3});
    await page.mouse.move(from.x+from.width/2,to.y+3,{steps:6});await page.mouse.up();
    await expect.poll(()=>ids(page,'tail')).toEqual(['photos','calls','telegram','arsenal']);
    await expect(modal(page).locator('.me-pv-tail li').first()).toHaveText('사진');

    // 키보드: [통화] ⠿에서 위 화살표 두 번 = 아래 칸 맨 위를 넘어 위 메뉴 맨 아래로.
    const calls=list(page,'tail').locator('[data-reorder-id="calls"] [data-reorder-handle]');
    await calls.focus();await page.keyboard.press('ArrowUp');
    await expect.poll(()=>ids(page,'tail')).toEqual(['calls','photos','telegram','arsenal']);
    await page.keyboard.press('ArrowUp');
    await expect.poll(()=>ids(page,'tail')).toEqual(['photos','telegram','arsenal']);
    expect((await ids(page,'rest')).at(-1)).toBe('calls');
    await expect(modal(page).locator('.me-pv-main li').last()).toHaveText('통화');

    // 서버 저장 모양은 {bar, rest}뿐이고 아래 칸은 rest 안 'bottom' 표시 뒤(DB 검사가 받는 모양 그대로).
    const saved=['note','library','hwp','pages','ledger','calls','bottom','photos','telegram','arsenal'];
    await expect.poll(()=>prefs.value?.menu_layout?.rest).toEqual(saved);
    expect(Object.keys(prefs.value.menu_layout).sort()).toEqual(['bar','rest']);
    await modal(page).locator('[data-close="menuEditModal"]').click();
    await expect(modal(page)).toBeHidden();

    const check=async()=>{
      await expect.poll(()=>sheetOrder(page)).toEqual(['note','library','hwp','pages','ledger','calls','LINE','photos','telegram','arsenal']);
      await expect.poll(()=>pcSide(page)).toEqual({photos:true,calls:false,feed:['photos','telegram','arsenal'],first:'photos'});
    };
    await check();
    // 새로고침(다른 기기와 같은 길: 서버에서 다시 읽음)해도 그대로.
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
    await check();

    // [처음대로]: 하단바 기본 + 위 메뉴 기본 + 아래 칸 통화·텔레그램 소식·아스날, 서버 칸은 비운다.
    await openEdit(page,width);
    await modal(page).locator('[data-menu-edit-reset]').click();
    await expect.poll(()=>ids(page,'tail')).toEqual(['calls','telegram','arsenal']);
    expect(await ids(page,'rest')).toEqual(['note','library','hwp','pages','ledger','photos']);
    await expect.poll(()=>prefs.value?.menu_layout??null).toBeNull();
    await modal(page).locator('[data-close="menuEditModal"]').click();
    await expect.poll(()=>pcSide(page)).toEqual({photos:false,calls:true,feed:['calls','telegram','arsenal'],first:'calls'});
    expect((await sheetOrder(page)).slice(-4)).toEqual(['LINE','calls','telegram','arsenal']);
    expect(errors).toEqual([]);
  });
}
