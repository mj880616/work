import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// HOME-빠른입력정리 + UI-선택표시통일: 할 일 옵션 줄은 모드 버튼 줄 위, 안내 화살표 글자 없음,
// 조직 고르기는 [업데이트] 오른쪽 ▾(누르는 범위 44px, 키보드로 열림), 고른 조직은 입력칸 안내 글자.
// 고른 모드는 어느 것이든 민트(--ds-kind-task), 안 고른 쪽은 흰 바탕. 라이트·다크 모두.
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
async function mint(page){return {bg:await token(page,'--ds-kind-task-soft','backgroundColor'),fg:await token(page,'--ds-kind-task-ink')};}
const shot=(info,name)=>process.env.KPTU_SHOT_DIR?`${process.env.KPTU_SHOT_DIR}/${name}.png`:info.outputPath(`${name}.png`);

for(const [width,dark] of [[390,false],[390,true],[1280,false]])test(`빠른 입력 배치와 고른 쪽 민트 ${width}${dark?' 다크':''}`,async({page},info)=>{
 const errors=await open(page,width,dark),box=q(page),selected=await mint(page),white=await token(page,'--kptu-surface','backgroundColor');
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
 for(const other of ['basket','update'])expect((await look(box.locator(`[data-quick-mode="${other}"]`))).bg).toBe(white);
 expect((await look(org)).bg).toBe(white);
 await input.fill('합성 할 일');
 await page.screenshot({path:shot(info,`home-quick-task-${width}-${dark?'dark':'light'}`)});
 await input.fill('');

 // [업데이트 ▾]: 조직 줄 없이 [업데이트] 바로 오른쪽 ▾, 둘이 함께 민트. ▾ 누르는 범위 44px 이상.
 await update.click();await expect(box).toHaveAttribute('data-mode','update');
 await expect(options).toBeHidden();await expect(box.locator('[data-quick-options]')).toBeHidden();
 await expect(box).not.toContainText('담당조직 기록');
 await expect(update).toHaveText('업데이트');await expect(org).toHaveText('▾');await expect(org).toHaveAccessibleName('조직 선택');
 await expect(input).toHaveAttribute('placeholder','담당조직 기록을 입력하세요');
 const u=await update.boundingBox(),g=await org.boundingBox();
 expect(Math.abs(g.x-(u.x+u.width))).toBeLessThanOrEqual(1);expect(Math.abs(g.y-u.y)).toBeLessThanOrEqual(1);
 expect(g.width).toBeGreaterThanOrEqual(44);expect(g.height).toBeGreaterThanOrEqual(44);
 expect(await look(update)).toEqual(selected);expect(await look(org)).toEqual(selected);
 for(const other of ['basket','task'])expect((await look(box.locator(`[data-quick-mode="${other}"]`))).bg).toBe(white);

 // 키보드: [업데이트]에서 Tab → ▾, Enter → 기존 조직 선택 창. 고른 조직은 안내 글자로.
 await update.focus();await page.keyboard.press('Tab');await expect(org).toBeFocused();
 await page.keyboard.press('Enter');const sheet=page.getByRole('dialog');await expect(sheet).toBeVisible();await expect(sheet).toContainText('조직 선택');
 await sheet.getByRole('button',{name:'서해선지부',exact:true}).first().click();await expect(sheet).toBeHidden();
 await expect(input).toHaveAttribute('placeholder','서해선지부 기록을 입력하세요');
 await expect(org).toHaveAccessibleName('조직 선택: 서해선지부');await expect(update).toHaveText('업데이트');await expect(org).toBeFocused();
 await page.screenshot({path:shot(info,`home-quick-update-${width}-${dark?'dark':'light'}`)});

 // 다른 모드에서 ▾를 누르면 [업데이트]로 바뀐 뒤 창이 열린다.
 await box.locator('[data-quick-mode="basket"]').click();await expect(org).toHaveAttribute('aria-expanded','false');
 await org.click();await expect(box).toHaveAttribute('data-mode','update');await expect(sheet).toBeVisible();
 await page.keyboard.press('Escape');await expect(sheet).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});
