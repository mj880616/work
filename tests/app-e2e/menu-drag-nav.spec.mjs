import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';
// MENU-왼쪽메뉴바로끌기(요청함 11/10 23:29, 할 일 1~6 모두 승인): PC 왼쪽 메뉴 줄을 바로 끌어 순서를 바꾸고(위 줄 ↔ 맨 아래 묶음 포함), 폰 [메뉴] 창에서도 끌어 바꾼다.
// 저장은 메뉴 편집 창과 같은 view_prefs.menu_layout(흉내 낸 서버, 새 저장소 없음). 누르기는 화면 열기 그대로, 키보드는 Alt+↑·↓(메뉴 편집 창 화살표와 같은 규칙),
// 우클릭은 [숨기기]·[메뉴 수정](공용 줄 메뉴), 빈 곳 우클릭은 [메뉴 수정]. 합성 값만 쓴다.
const nav=page=>page.locator('#appNav');
const head=(page,id)=>nav(page).locator(`.nav-btn[data-reorder-id="${id}"]`);
// PC 왼쪽 메뉴의 위 줄·맨 아래 묶음(빈 공간 .sidebar-spacer 기준, 보이는 줄만).
const pcOrder=page=>page.evaluate(()=>{
  const root=document.querySelector('#appNav'),spacer=root.querySelector('.sidebar-spacer');
  const heads=[...root.querySelectorAll('.nav-btn[data-reorder-id]')].filter(el=>el.getClientRects().length);
  const below=el=>!!(spacer.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING);
  return {main:heads.filter(el=>!below(el)).map(el=>el.dataset.reorderId),tail:heads.filter(below).map(el=>el.dataset.reorderId)};
});
const sheetOrder=page=>page.evaluate(()=>[...document.querySelector('#mobileMenu nav[aria-label="더 보기"]').children]
  .map(el=>el.matches('[data-menu-tail-line]')?'LINE':el.dataset.view||el.dataset.basketKindNav||''));
const route=page=>page.evaluate(()=>window.KPTURouter?.current);
// 마우스로 끌기: 줄 가운데를 누르고 8px 움직여 끌기를 시작한 뒤 (x,y)에서 놓는다.
async function drag(page,from,x,y){
  await from.scrollIntoViewIfNeeded();
  const box=await from.boundingBox(),sx=box.x+box.width/2,sy=box.y+box.height/2;
  await page.mouse.move(sx,sy);await page.mouse.down();
  await page.mouse.move(sx,sy+(y>sy?8:-8),{steps:3});
  await page.mouse.move(x,y,{steps:8});
  await page.mouse.up();
}
const DEFAULT_MAIN=['basket','calendar','note','meetings','library','files','pages','team','hwp','ledger','photos','outside'];
const DEFAULT_TAIL=['calls','telegram','arsenal'];

for(const width of [1280,1440]){
  test(`PC 왼쪽 메뉴 끌기 (${width}px): 위 줄 안에서 옮기고 새로고침에도 그대로, 짧게 누르기는 화면 열기`,async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const {prefs}=await openHome(page);
    expect(await pcOrder(page)).toEqual({main:DEFAULT_MAIN,tail:DEFAULT_TAIL});

    // [사진]을 [자료실] 위쪽 반으로 끌어 놓는다: 위 메뉴 칸 안에서 자료실 앞(노트 뒤)으로 들어간다. 놓는 동안 놓일 자리 줄이 보인다.
    const photos=head(page,'photos'),library=head(page,'library');
    const from=await photos.boundingBox(),to=await library.boundingBox(),sx=from.x+from.width/2,sy=from.y+from.height/2;
    await page.mouse.move(sx,sy);await page.mouse.down();
    await page.mouse.move(sx,sy-8,{steps:3});
    await page.mouse.move(sx,to.y+2,{steps:8});
    await expect(library).toHaveClass(/re-drop-before/);
    await expect(photos).toHaveClass(/re-dragging/);
    // 놓일 자리 줄이 실제로 그려진다(다른 규칙이 줄 배경을 덮어 줄이 안 보이는 일 방지): 줄 안쪽 ::before 2px 막대.
    const line=await library.evaluate(el=>{const s=getComputedStyle(el,'::before');return {height:s.height,color:s.backgroundColor}});
    expect(line.height).toBe('2px');
    expect(line.color).not.toBe('rgba(0, 0, 0, 0)');
    await page.mouse.up();
    // 끌기 뒤 따라오는 클릭은 삼켜서 화면이 열리지 않는다.
    await page.waitForTimeout(250);
    expect(await route(page)).toBe('home');
    await expect(photos).not.toHaveClass(/re-dragging/);
    await expect(nav(page).locator('.re-drop-before,.re-drop-end')).toHaveCount(0);
    // 처음 한 번 바꾸면 PC 위 줄은 메뉴 편집 창 미리보기와 같은 규칙(하단바 칸 메뉴가 위, 위 메뉴가 그 아래)으로 읽힌다. 위 메뉴 안 순서는 끌어 놓은 대로.
    const main=['basket','calendar','meetings','team','note','photos','library','files','hwp','pages','ledger','outside'];
    await expect.poll(()=>pcOrder(page)).toEqual({main,tail:DEFAULT_TAIL});
    // 서버 저장 모양은 {bar, rest}뿐(DB 검사가 받는 모양 그대로)이고, 하단바 칸은 그대로다.
    await expect.poll(()=>prefs.value?.menu_layout?.rest).toEqual(['note','photos','library','files','hwp','pages','ledger','outside','bottom','calls','telegram','arsenal']);
    expect(prefs.value.menu_layout.bar).toEqual(['home','basket','calendar','meetings','team']);
    expect(Object.keys(prefs.value.menu_layout).sort()).toEqual(['bar','rest']);
    // 폰 [메뉴] 창에도 같은 순서(같은 저장값).
    await expect.poll(()=>sheetOrder(page)).toEqual(['note','photos','library','files','hwp','pages','ledger','outside','LINE','calls','telegram','arsenal']);

    // 새로고침(다른 기기와 같은 길: 서버에서 다시 읽음)해도 그대로.
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
    await expect.poll(()=>pcOrder(page)).toEqual({main,tail:DEFAULT_TAIL});

    // 4px도 안 움직이고 놓으면 끌기가 아니라 누르기다: 화면 열기 그대로.
    const basket=head(page,'basket'),box=await basket.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+2,box.y+box.height/2+1);await page.mouse.up();
    await expect.poll(()=>route(page)).toBe('basket');
    await expect(page.locator('#basketView')).toBeVisible();
    expect(errors).toEqual([]);

    // 메뉴 편집 창도 같은 순서를 보이고 그대로 쓸 수 있다(회귀 없음).
    await accountButton(page).click();
    await page.locator('#sidebarAccountPanel [data-menu-edit-open]').click();
    const modal=page.locator('#menuEditModal');
    await expect(modal).toBeVisible();
    await expect.poll(()=>modal.locator('[data-reorder-list="rest"] [data-reorder-id]').evaluateAll(rows=>rows.map(row=>row.dataset.reorderId)))
      .toEqual(['note','photos','library','files','hwp','pages','ledger','outside']);
    await modal.locator('[data-menu-edit-reset]').click();
    await expect.poll(()=>prefs.value?.menu_layout??null).toBeNull();
    await modal.locator('[data-close="menuEditModal"]').click();
    await expect.poll(()=>pcOrder(page)).toEqual({main:DEFAULT_MAIN,tail:DEFAULT_TAIL});
  });
}

test('PC 왼쪽 메뉴 끌기: 맨 아래 묶음으로 옮기고 다시 위 줄로, 일정은 달력·할 일·일기와 함께, 하단바 칸이 가득 차면 거절',async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:1280,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const {prefs}=await openHome(page);
  const spacer=nav(page).locator('.sidebar-spacer');
  // 빈 공간 아래쪽 반에 놓으면 맨 아래 묶음 맨 앞.
  const sb=await spacer.boundingBox();
  await drag(page,head(page,'photos'),sb.x+sb.width/2,sb.y+sb.height-2);
  await expect.poll(()=>pcOrder(page)).toEqual({main:['basket','calendar','meetings','team','note','library','files','hwp','pages','ledger','outside'],tail:['photos','calls','telegram','arsenal']});
  await expect(head(page,'photos')).toHaveClass(/nav-feed-first/);
  await expect.poll(()=>prefs.value?.menu_layout?.rest).toEqual(['note','library','files','hwp','pages','ledger','outside','bottom','photos','calls','telegram','arsenal']);
  // 맨 아래 묶음의 [통화]를 위 줄 [자료실] 위쪽으로: 위 메뉴로 들어가고 하단바 칸은 그대로(하단바 칸은 메뉴들 사이에 놓을 때만 바뀐다).
  const library=await head(page,'library').boundingBox();
  await drag(page,head(page,'calls'),library.x+library.width/2,library.y+2);
  await expect.poll(()=>pcOrder(page)).toEqual({main:['basket','calendar','meetings','team','note','calls','library','files','hwp','pages','ledger','outside'],tail:['photos','telegram','arsenal']});
  expect(prefs.value.menu_layout.bar).toEqual(['home','basket','calendar','meetings','team']);
  // 하단바 칸(홈 포함 5칸)이 가득 찬 채 하단바 칸 메뉴들 사이로 [자료실]을 끌면 옮기지 않고 한 줄로 알려 준다.
  const calendar=await head(page,'calendar').boundingBox();
  await drag(page,head(page,'library'),calendar.x+calendar.width/2,calendar.y+2);
  await expect(page.locator('#toast')).toContainText('하단바');
  expect((await pcOrder(page)).main).toEqual(['basket','calendar','meetings','team','note','calls','library','files','hwp','pages','ledger','outside']);
  // 옮기기가 거절돼 줄이 그대로여도, 끌었다 놓은 줄의 화면은 열리지 않는다(끌기 뒤 따라오는 클릭은 문서 위임 클릭보다 먼저 삼킨다).
  await page.waitForTimeout(250);
  expect(await route(page)).toBe('home');
  // 끌었다가 같은 자리에 놓아도(자리가 안 바뀜) 마찬가지.
  const note=await head(page,'note').boundingBox();
  await page.mouse.move(note.x+60,note.y+14);await page.mouse.down();
  await page.mouse.move(note.x+60,note.y+24,{steps:3});await page.mouse.move(note.x+60,note.y+15,{steps:3});
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect(await route(page)).toBe('home');
  expect((await pcOrder(page)).main).toEqual(['basket','calendar','meetings','team','note','calls','library','files','hwp','pages','ledger','outside']);
  // [일정]을 끌면 아래 달력·할 일·일기가 붙은 채 같이 움직인다(그 셋끼리 순서 바꾸기는 없다).
  const files=await head(page,'files').boundingBox();
  await drag(page,head(page,'calendar'),files.x+files.width/2,files.y+files.height-2);
  await expect.poll(()=>prefs.value?.menu_layout?.bar).toEqual(['home','basket','meetings','team']);
  const unit=await nav(page).evaluate(root=>{
    const h=root.querySelector('.nav-btn[data-reorder-id="calendar"]'),sub=h.nextElementSibling;
    return {sub:sub?.classList.contains('nav-sub'),labels:[...sub.querySelectorAll('a')].map(a=>a.textContent.trim())};
  });
  expect(unit.sub).toBe(true);expect(unit.labels).toEqual(['달력','할 일','일기']);
  // 홈 줄(맨 위)은 끌려 가지 않는다.
  const brand=nav(page).locator('.sidebar-brand'),bb=await brand.boundingBox(),before=JSON.stringify(prefs.value);
  await drag(page,brand,bb.x+bb.width/2,sb.y+sb.height-2);
  await page.waitForTimeout(250);
  expect(JSON.stringify(prefs.value)).toBe(before);
  expect(await route(page)).toBe('home');
  expect(errors).toEqual([]);
});

test('PC 왼쪽 메뉴: 키보드 Alt+↑·↓로 한 칸 옮기고 포커스는 그 줄에 남는다',async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:1280,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const {prefs}=await openHome(page);
  const files=head(page,'files');
  await files.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(()=>prefs.value?.menu_layout?.rest).toEqual(['note','library','hwp','files','pages','ledger','photos','outside','bottom','calls','telegram','arsenal']);
  await expect(files).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(()=>prefs.value?.menu_layout?.rest).toEqual(['note','files','library','hwp','pages','ledger','photos','outside','bottom','calls','telegram','arsenal']);
  await expect(files).toBeFocused();
  // 위 메뉴 맨 위 줄에서 위로 = 하단바 칸 끝으로 넘어가는데 하단바가 가득이라 옮기지 않고 한 줄로 알린다. 일반 화살표·다른 조합은 아무 일도 하지 않는다.
  const before=JSON.stringify(prefs.value);
  await head(page,'note').focus();await page.keyboard.press('Alt+ArrowUp');
  await expect(page.locator('#toast')).toContainText('하단바');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Shift+Alt+ArrowDown');
  expect(JSON.stringify(prefs.value)).toBe(before);
  expect(await route(page)).toBe('home');
  // 맨 아래 묶음 끝에서 아래로는 더 못 간다(칸 끝).
  await head(page,'arsenal').focus();await page.keyboard.press('Alt+ArrowDown');
  expect(JSON.stringify(prefs.value)).toBe(before);
  // 위 메뉴 끝 줄에서 아래로 = 맨 아래 묶음 맨 위, 맨 아래 묶음 첫 줄에서 위로 = 위 메뉴 맨 끝(메뉴 편집 창 화살표와 같은 규칙).
  await head(page,'outside').focus();await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(()=>pcOrder(page)).toMatchObject({tail:['outside','calls','telegram','arsenal']});
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(()=>pcOrder(page)).toMatchObject({tail:DEFAULT_TAIL});
  expect(errors).toEqual([]);
});

test('PC 왼쪽 메뉴: 우클릭 [숨기기]·[메뉴 수정], 빈 곳 우클릭은 [메뉴 수정]',async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:1280,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const {prefs}=await openHome(page);
  const menu=page.locator('#rowMenu');
  // 줄 우클릭 = 브라우저 기본 메뉴 대신 공용 줄 메뉴 [숨기기]·[메뉴 수정].
  await head(page,'ledger').click({button:'right'});
  await expect(menu).toBeVisible();
  await expect(menu.locator('button')).toHaveText(['숨기기','메뉴 수정']);
  await menu.getByRole('button',{name:'숨기기'}).click();
  await expect(head(page,'ledger')).toHaveCount(0); // 숨긴 메뉴는 왼쪽 메뉴에서 빠진다(접힌 줄도 없음)
  await expect.poll(()=>prefs.value?.menu_layout?.rest.slice(-2)).toEqual(['hidden','ledger']);
  // 빈 곳(빈 공간)·일정 아래 작은 메뉴·홈 줄 우클릭 = [메뉴 수정]만.
  for(const target of [nav(page).locator('.sidebar-spacer'),nav(page).locator('.nav-sub-btn[data-view="tasks"]'),nav(page).locator('.sidebar-brand')]){
    await target.click({button:'right',force:true});
    await expect(menu).toBeVisible();
    await expect(menu.locator('button')).toHaveText(['메뉴 수정']);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
  await nav(page).locator('.sidebar-spacer').click({button:'right',force:true});
  await menu.getByRole('button',{name:'메뉴 수정'}).click();
  await expect(page.locator('#menuEditModal')).toBeVisible();
  // 메뉴 편집 창에서 숨긴 메뉴 칸에 그대로 있다.
  await expect.poll(()=>page.locator('#menuEditModal [data-reorder-list="hidden"] [data-reorder-id]').evaluateAll(rows=>rows.map(row=>row.dataset.reorderId))).toEqual(['ledger']);
  expect(errors).toEqual([]);
});

test('폰 [메뉴] 창: 줄을 끌어 위 메뉴 순서를 바꾸고 아래 붙는 메뉴로 옮기며, 끌어도 화면이 열리지 않고 새로고침에도 그대로',async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:412,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const {prefs}=await openHome(page);
  const sheet=page.locator('#mobileMenu nav[aria-label="더 보기"]');
  const item=id=>sheet.locator(`button[data-reorder-id="${id}"]`);
  await accountButton(page).click();
  await expect(page.locator('#mobileMenu')).toBeVisible();
  expect(await sheetOrder(page)).toEqual(['note','library','files','hwp','pages','ledger','photos','outside','LINE','calls','telegram','arsenal']);
  // [사진]을 [자료실] 위쪽 반으로: 위 메뉴 안 순서만 바뀐다(하단바 칸·숨김 규칙 그대로).
  // 폰 [메뉴] 창은 두 칸 격자라 칸의 왼쪽 반에 놓으면 그 칸 앞에 들어간다.
  const library=await item('library').boundingBox();
  await drag(page,item('photos'),library.x+6,library.y+library.height/2);
  await expect.poll(()=>sheetOrder(page)).toEqual(['note','photos','library','files','hwp','pages','ledger','outside','LINE','calls','telegram','arsenal']);
  // 끌기를 마쳐도 창은 열려 있고 화면도 바뀌지 않는다(따라오는 클릭이 줄을 누른 게 아님).
  await page.waitForTimeout(250);
  await expect(page.locator('#mobileMenu')).toBeVisible();
  expect(await route(page)).toBe('home');
  await expect.poll(()=>prefs.value?.menu_layout?.rest).toEqual(['note','photos','library','files','hwp','pages','ledger','outside','bottom','calls','telegram','arsenal']);
  expect(prefs.value.menu_layout.bar).toEqual(['home','basket','calendar','meetings','team']);
  // 선 아래(아래 붙는 메뉴 첫 줄 자리)로 [원장]을 끌면 아래 붙는 메뉴로 옮겨진다.
  const calls=await item('calls').boundingBox();
  await drag(page,item('ledger'),calls.x+6,calls.y+calls.height/2);
  await expect.poll(()=>sheetOrder(page)).toEqual(['note','photos','library','files','hwp','pages','outside','LINE','ledger','calls','telegram','arsenal']);
  await expect.poll(()=>prefs.value?.menu_layout?.rest).toEqual(['note','photos','library','files','hwp','pages','outside','bottom','ledger','calls','telegram','arsenal']);
  // 새로고침(서버에서 다시 읽음) 뒤에도 같은 순서.
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
  await expect.poll(()=>sheetOrder(page)).toEqual(['note','photos','library','files','hwp','pages','outside','LINE','ledger','calls','telegram','arsenal']);
  expect(errors).toEqual([]);
  // 짧게 누르기는 그대로 화면 열기(창이 닫히고 그 화면으로).
  await accountButton(page).click();
  await item('note').click();
  await expect.poll(()=>route(page)).toBe('basket');
  await expect(page.locator('#mobileMenu')).toBeHidden();
});
