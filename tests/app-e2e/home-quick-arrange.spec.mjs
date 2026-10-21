import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// HOME-빠른입력정리 + UI-선택표시통일: 할 일 옵션 줄은 모드 버튼 줄 위, 안내 화살표 글자 없음,
// 조직 고르기는 [업데이트] 오른쪽 ▾(누르는 범위 44px, 키보드로 열림), 고른 조직은 입력칸 안내 글자.
// BASKET-업데이트통합 PR 1: 탭은 [업데이트 ▾][할 일] 둘. 고른 곳이 없으면 바구니(data-mode=basket), 고르면 그 기록(update).
// 고른 모드는 어느 것이든 회색(--ds-kind-other, 사용자 결정 B), 안 고른 쪽은 흰 바탕. 라이트·다크 모두.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const names=['전국철도노동조합','서해선지부','신분당선지부'];
const q=page=>page.locator('#homeView [data-home-quick]');
const look=locator=>locator.evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,fg:s.color};});
const token=(page,name,prop='color')=>page.evaluate(([name,prop])=>{const e=document.createElement('span');e.style[prop]=`var(${name})`;document.querySelector('#appView').append(e);const c=getComputedStyle(e)[prop];e.remove();return c;},[name,prop]);
async function open(page,width,dark){
 await page.setViewportSize({width,height:width<761?844:900});
 if(dark)await page.emulateMedia({colorScheme:'dark'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:names.map((name,i)=>({id:String(i),name,active:true}))}));
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:names.map((_,i)=>({organization_id:String(i)}))}));
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',r=>r.fulfill({json:[]}));
 await page.reload();await page.waitForFunction(()=>window.KPTUHome?.metrics.readyAt>0);
 return errors;
}
async function gray(page){return {bg:await token(page,'--ds-select-bg','backgroundColor'),fg:await token(page,'--ds-select-ink')};}
const shot=(info,name)=>process.env.KPTU_SHOT_DIR?`${process.env.KPTU_SHOT_DIR}/${name}.png`:info.outputPath(`${name}.png`);

for(const [width,dark] of [[390,false],[390,true],[1280,false]])test(`빠른 입력 배치와 고른 쪽 테마 주 색 ${width}${dark?' 다크':''}`,async({page},info)=>{
 const errors=await open(page,width,dark),box=q(page),selected=await gray(page),white=await token(page,'--kptu-surface','backgroundColor');
 const modes=box.locator('.home-quick-modes'),update=box.locator('[data-quick-mode="update"]'),org=box.locator('[data-quick-org]'),input=box.locator('[data-quick-input]');
 // 안내 화살표 글자는 어느 모드에서도 없다.
 await expect(box.locator('[data-quick-destination],[data-quick-update-options]')).toHaveCount(0);

 // [할 일]: 프로젝트·기한 줄이 모드 버튼 줄 위에 나온다.
 await box.locator('[data-quick-mode="task"]').click();await input.click();
 const options=box.locator('[data-quick-task-options]');await expect(options).toBeVisible();
 await expect(box).not.toContainText('Google 할 일');await expect(box).not.toContainText('→');
 const o=await options.boundingBox(),m=await modes.boundingBox(),e=await input.boundingBox();
 expect(o.y+o.height).toBeLessThanOrEqual(m.y);expect(m.y+m.height).toBeLessThanOrEqual(e.y);
 expect(await look(box.locator('[data-quick-mode="task"]'))).toEqual(selected);
 expect((await look(update)).bg).toBe(white);
 expect((await look(org)).bg).toBe(white);
 await input.fill('합성 할 일');
 await page.screenshot({path:shot(info,`home-quick-task-${width}-${dark?'dark':'light'}`)});
 await input.fill('');

 // [업데이트 ▾]: 조직 줄 없이 [업데이트] 바로 오른쪽 ▾, 둘이 함께 테마 주 색. ▾ 누르는 범위 44px 이상.
 await update.click();await expect(box).toHaveAttribute('data-mode','basket');
 await expect(options).toBeHidden();await expect(box.locator('[data-quick-options]')).toBeHidden();
 await expect(box).not.toContainText('담당조직 기록');
 await expect(update).toHaveText('업데이트');await expect(org).toHaveText('▾');await expect(org).toHaveAccessibleName('기록할 곳 선택');
 await expect(input).toHaveAttribute('placeholder','업데이트 입력(바구니에 저장)');
 const u=await update.boundingBox(),g=await org.boundingBox();
 expect(Math.abs(g.x-(u.x+u.width))).toBeLessThanOrEqual(1);expect(Math.abs(g.y-u.y)).toBeLessThanOrEqual(1);
 // UI-버튼크기: ▾는 작은 세그먼트 칸(보이는 높이 32px 이하)이고, 누르는 범위(::after)는 위아래·오른쪽으로 늘려 44×44px.
 expect(g.height).toBeLessThanOrEqual(32);
 const reach=await org.evaluate(el=>{const r=el.getBoundingClientRect(),p=getComputedStyle(el,'::after');const w=parseFloat(p.width),h=parseFloat(p.height),left=r.left+parseFloat(p.left),top=r.top+parseFloat(p.top);return {w,h,hits:[[left+w-1,top+h/2],[left+w/2,top+1],[left+w/2,top+h-1]].map(([x,y])=>document.elementFromPoint(x,y)?.closest('button')===el)};});
 expect(reach.w).toBeGreaterThanOrEqual(44);expect(reach.h).toBeGreaterThanOrEqual(44);expect(reach.hits).toEqual([true,true,true]);
 expect(await look(update)).toEqual(selected);expect(await look(org)).toEqual(selected);
 expect((await look(box.locator('[data-quick-mode="task"]'))).bg).toBe(white);

 // 키보드: [업데이트]에서 Tab → ▾, Enter → 기존 조직 선택 창. 고른 조직은 안내 글자로.
 await update.focus();await page.keyboard.press('Tab');await expect(org).toBeFocused();
 await page.keyboard.press('Enter');const sheet=page.getByRole('dialog');await expect(sheet).toBeVisible();await expect(sheet).toContainText('기록할 곳 선택');
 await sheet.getByRole('button',{name:'서해선지부',exact:true}).first().click();await expect(sheet).toBeHidden();
 await expect(input).toHaveAttribute('placeholder','서해선지부 기록을 입력하세요');
 await expect(org).toHaveAccessibleName('기록할 곳 선택: 서해선지부');await expect(box).toHaveAttribute('data-mode','update');await expect(update).toHaveText('업데이트');await expect(org).toBeFocused();
 await page.screenshot({path:shot(info,`home-quick-update-${width}-${dark?'dark':'light'}`)});

 // 다른 모드에서 ▾를 누르면 [업데이트]로 바뀐 뒤 창이 열린다.
 await box.locator('[data-quick-mode="task"]').click();await expect(org).toHaveAttribute('aria-expanded','false');
 await org.click();await expect(box).toHaveAttribute('data-mode','update');await expect(sheet).toBeVisible();
 await page.keyboard.press('Escape');await expect(sheet).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});

// UI-버튼크기 추가(2026-10-17): 세 모드 모두 입력칸은 한 줄(46px, [추가]와 같은 높이·같은 위치)에서 시작해
// 글에 맞춰 늘고 5줄(130px)에서 멈춘 뒤 칸 안에서 스크롤한다. [업데이트]도 처음부터 여러 줄 높이가 아니다.
for(const width of [390,1280])test(`빠른 입력칸: 한 줄에서 시작해 5줄까지 늘고 그 뒤 스크롤 ${width}`,async({page})=>{
 const errors=await open(page,width,false),box=q(page),input=box.locator('[data-quick-input]'),save=box.locator('[data-quick-save]');
 const measure=()=>page.evaluate(()=>{const b=document.querySelector('#homeView [data-home-quick]'),i=b.querySelector('[data-quick-input]'),s=b.querySelector('[data-quick-save]').getBoundingClientRect(),r=i.getBoundingClientRect();return {h:r.height,scroll:i.scrollHeight>i.clientHeight,saveTop:s.top-r.top,saveH:s.height};});
 for(const [tab,mode] of [['update','basket'],['task','task']]){
  await box.locator(`[data-quick-mode="${tab}"]`).click();await expect(box).toHaveAttribute('data-mode',mode);
  // UI-PC버튼36: PC(≥1024) starts at the input height 36px (padding 7/6px), so 3 lines are 78px and 5 lines 120px; phone keeps 46/88/130.
  const [one,three,five]=width>=1024?[36,78,120]:[46,88,130];
  await input.fill('');expect(await measure(),mode+' empty').toEqual({h:one,scroll:false,saveTop:0,saveH:one});
  await input.fill('첫 줄\n둘째 줄\n셋째 줄');expect(await measure(),mode+' 3 lines').toEqual({h:three,scroll:false,saveTop:0,saveH:one});
  await input.fill('1\n2\n3\n4\n5\n6\n7');expect(await measure(),mode+' 7 lines').toEqual({h:five,scroll:true,saveTop:0,saveH:one});
  await input.fill('');expect((await measure()).h,mode+' cleared').toBe(one);
 }
 expect(errors).toEqual([]);
});

// UI-버튼크기 추가: 전환·필터를 누르는 순간 기기 기본 탭 하이라이트(폰에서 민트·파란 빛)가 없고, 누르는 동안은 고른 쪽과 같은 회색.
for(const dark of [false,true])test(`눌림 색: 탭 하이라이트 없음, :active는 회색${dark?' 다크':''}`,async({page})=>{
 const errors=await open(page,390,dark),box=q(page),g=await gray(page);
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const pressed=async selector=>{
  const {root}=await cdp.send('DOM.getDocument',{depth:-1});const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
  await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:['active','focus']});
  const v=await page.locator(selector).evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,fg:s.color,tap:s.webkitTapHighlightColor};});
  await cdp.send('CSS.forcePseudoState',{nodeId,forcedPseudoClasses:[]});return v;
 };
 await box.locator('[data-quick-mode="update"]').click();
 expect(await pressed('#homeView [data-quick-mode="task"]')).toEqual({...g,tap:'rgba(0, 0, 0, 0)'});
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('#basketView [data-basket-filter="classified"]')).toBeVisible();
 expect(await pressed('#basketView [data-basket-kind="note"]')).toEqual({...g,tap:'rgba(0, 0, 0, 0)'});
 expect(await pressed('#basketView [data-basket-filter="classified"]')).toEqual({...g,tap:'rgba(0, 0, 0, 0)'});
 expect(errors).toEqual([]);
});
