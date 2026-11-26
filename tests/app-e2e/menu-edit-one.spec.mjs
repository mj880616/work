import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';
// S71-32 NAV-메뉴수정하나로(사용자 11/26 "폰 하단바랑 pc 왼쪽 메뉴 구분해둔 이유는? 하나로 통일 못하나" → "ㄱ"):
// 메뉴 수정 창은 폰 하단바와 위 메뉴를 목록 하나로 잇고, 하단바 마지막 줄 아래 가는 줄 + 작은 회색 글 '여기까지 폰 하단바'.
// 줄 위로 끌어 올리면 하단바에 들고 내리면 빠진다(5칸·홈 고정 그대로). 아래 붙는 메뉴·숨긴 메뉴는 같은 목록 모양에 머리 글자만 작게. PC 왼쪽 메뉴 미리보기 상자는 없다.
// 저장은 서버(view_prefs.menu_layout, 흉내 낸 서버)뿐이고 모양은 그대로 {bar, rest}.
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
async function dragTo(page,handle,y){
  await handle.scrollIntoViewIfNeeded();
  const from=await handle.boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2+(y>from.y?8:-8),{steps:3});
  await page.mouse.move(from.x+from.width/2,y,{steps:8});await page.mouse.up();
}
const bar=page=>page.locator('#appView .mobile-tabs').evaluate(nav=>[...nav.querySelectorAll('button[data-view],button[data-basket-kind-nav]')].map(b=>b.dataset.view||b.dataset.basketKindNav));

for(const width of [1280,390]){
  test(`메뉴 수정 (${width}px): 하단바·위 메뉴는 목록 하나 + '여기까지 폰 하단바' 줄, 미리보기 없음, 줄 위로 끌면 하단바에 들고 아래로 내리면 빠진다`,async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const {prefs}=await openHome(page,{menuLayout:null});
    await openEdit(page,width);
    // 목록 하나: 테두리 상자 하나 안에 하단바 → 가는 줄 → 위 메뉴 → (작은 머리) 아래 붙는 메뉴 → (작은 머리) 숨긴 메뉴. 옛 큰 머리 글자·미리보기 상자는 없다.
    const one=modal(page).locator('.me-one');
    await expect(one).toHaveCount(1);
    const order=await one.evaluate(box=>[...box.children].map(el=>el.dataset.reorderList||(el.matches('.me-bar-line')?'LINE':el.textContent.trim().replace(/\s+\d+개$/,''))));
    expect(order).toEqual(['bar','LINE','rest','아래 붙는 메뉴','tail','숨긴 메뉴','hidden']);
    const line=modal(page).locator('.me-bar-line');
    await expect(line).toHaveAttribute('role','separator');
    await expect(line).toContainText('여기까지 폰 하단바');
    await expect(line).toContainText('5/5칸');
    await expect(modal(page).locator('[data-menu-edit-preview], .me-preview, .me-pv-box, figure')).toHaveCount(0);
    await expect(modal(page)).not.toContainText('PC 왼쪽 메뉴');
    await expect(modal(page).locator('.me-group h3')).toHaveCount(0);
    // 줄은 작은 회색 글: 메뉴 줄 글자보다 작고 흐리다. 가는 줄 하나(1px).
    const look=await line.evaluate(el=>{const cs=getComputedStyle(el),row=getComputedStyle(document.querySelector('#menuEditModal .me-name'));return {size:parseFloat(cs.fontSize),rowSize:parseFloat(row.fontSize),border:cs.borderTopWidth,color:cs.color,ink:row.color,h:el.getBoundingClientRect().height}});
    expect(look.size).toBeLessThan(look.rowSize);expect(look.border).toBe('1px');expect(look.color).not.toBe(look.ink);expect(look.h).toBeLessThanOrEqual(20);
    expect(await ids(page,'bar')).toEqual(['home','note','calendar','library','photos']);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await modal(page).screenshot({path:`test-results/menu-edit-one-${width}.png`});

    // 하단바 마지막 줄 [사진]을 줄 아래(위 메뉴 맨 위)로 내리면 하단바에서 빠진다.
    const restTop=await list(page,'rest').locator('[data-reorder-id]').first().boundingBox();
    await dragTo(page,list(page,'bar').locator('[data-reorder-id="photos"] [data-reorder-handle]'),restTop.y+3);
    await expect.poll(()=>ids(page,'bar')).toEqual(['home','note','calendar','library']);
    expect((await ids(page,'rest'))[0]).toBe('photos');
    await expect(line).toContainText('4/5칸');
    // 위 메뉴 [조직 관리](team)를 줄 위(하단바 맨 끝)로 올리면 하단바에 든다.
    const barLast=await list(page,'bar').locator('[data-reorder-id]').last().boundingBox();
    await dragTo(page,list(page,'rest').locator('[data-reorder-id="team"] [data-reorder-handle]'),barLast.y+barLast.height-3);
    await expect.poll(()=>ids(page,'bar')).toEqual(['home','note','calendar','library','team']);
    await expect(line).toContainText('5/5칸');
    // 하단바가 5칸으로 가득하면 더 올리지 못하고 안내한다(칸 수 제한 그대로). 키보드: 위 메뉴 맨 위 [사진]에서 위 화살표.
    const photos=list(page,'rest').locator('[data-reorder-id="photos"] [data-reorder-handle]');
    await photos.focus();await page.keyboard.press('ArrowUp');
    await expect(modal(page).locator('.me-note')).toContainText('5칸까지');
    expect(await ids(page,'bar')).toEqual(['home','note','calendar','library','team']);
    // 홈은 맨 앞 고정(손잡이 없음).
    await expect(list(page,'bar').locator('[data-reorder-id="home"] [data-reorder-handle]')).toHaveCount(0);

    // 서버 저장 모양은 그대로 {bar, rest}, 폰 하단바도 그 순서로 바로 바뀐다.
    await expect.poll(()=>prefs.value?.menu_layout?.bar).toEqual(['home','note','calendar','library','team']);
    expect(Object.keys(prefs.value.menu_layout).sort()).toEqual(['bar','rest']);
    if(width<=760)await expect.poll(()=>bar(page)).toEqual(['home','note','calendar','library','team']);
    // [완료]는 창을 닫고(이름을 안 고쳤으면 다시 열지 않는다), [처음대로]는 기본 순서로.
    await modal(page).locator('[data-close="menuEditModal"]').click();
    await expect(modal(page)).toBeHidden();
    await openEdit(page,width);
    await modal(page).locator('[data-menu-edit-reset]').click();
    await expect.poll(()=>ids(page,'bar')).toEqual(['home','note','calendar','library','photos']);
    expect(errors).toEqual([]);
  });
}

test('메뉴 수정 (390px): 폰은 줄을 길게 눌러 줄 아래로 끌어 하단바에서 뺀다',async({browser})=>{
  test.setTimeout(60000);
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage();
  const {prefs}=await openHome(page,{menuLayout:null});
  await openEdit(page,390);
  const row=list(page,'bar').locator('[data-reorder-id="photos"]');
  const r=await row.boundingBox(),to=await list(page,'rest').locator('[data-reorder-id]').nth(1).boundingBox();
  const cdp=await context.newCDPSession(page);
  const point=(x,y)=>[{x,y,id:1}];
  const x=r.x+r.width/2-40,y=r.y+r.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:point(x,y)});
  await page.waitForTimeout(650);
  for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:point(x,y+(to.y+3-y)*i/8)});await page.waitForTimeout(30);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>ids(page,'bar')).toEqual(['home','note','calendar','library']);
  expect(await ids(page,'rest')).toContain('photos');
  await expect.poll(()=>prefs.value?.menu_layout?.bar).toEqual(['home','note','calendar','library']);
  await context.close();
});
