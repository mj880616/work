import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {openBasketMore} from './helpers/basket-more.mjs';
// UI-디자인기준 1/3 보완(8-9c2): 홈·바구니 버튼 높이 하나(홈 빠른 입력 [추가] 높이), 버튼 4종,
// 홈 빠른 입력 탭 종류 색, "오늘 할 일" 제목, 바구니 AI 버튼 [⋯ 더보기], 다크 모드 끔.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00.123456+00:00';
const n='10000000-0000-4000-8000-000000000002';
const look=locator=>locator.evaluate(el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return {height:b.height,fontSize:s.fontSize,fontWeight:s.fontWeight,radius:s.borderRadius,bg:s.backgroundColor,fg:s.color,border:s.borderTopColor,shadow:s.boxShadow,image:s.backgroundImage};});
const token=(page,name)=>page.evaluate(name=>{const e=document.createElement('span');e.style.color=`var(${name})`;document.querySelector('#appView').append(e);const c=getComputedStyle(e).color;e.remove();return c;},name);
async function open(page,width,dark=false){
 await page.setViewportSize({width,height:width<761?844:900});
 if(dark)await page.emulateMedia({colorScheme:'dark'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 await openHome(page);
 const note={id:n,workspace_id:'w',occurred_at:stamp,updated_at:stamp,raw_text:'10/20 기자회견 자료',ai_export_allowed:true,archived_at:null,attachments:[{drive_file_id:'drive-a',file_name:'안내문.pdf',mime_type:'application/pdf',size_bytes:4096},{drive_file_id:'drive-h',file_name:'양식.hwp',mime_type:'application/x-hwp',size_bytes:8192}],metadata:{}};
 for(const t of ['app_suborganizations','app_suborganization_assignees','app_spaces','app_record_links'])await page.route(SB+'/rest/v1/'+t+'?**',r=>r.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_notes?**',r=>{const q=new URL(r.request().url()).searchParams;if(r.request().method()!=='GET')return r.fulfill({status:500,json:{}});if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:[note].slice(Number(q.get('offset')||0))});});
 await page.waitForFunction(()=>window.KPTUHome?.metrics.readyAt>0);
 return errors;
}
// Every visible button-shaped control in a region: the same height, 13px, 500, 8px corners, no shadow or gradient.
async function sameButtons(region,height){
 const all=await region.locator('button:visible,[data-basket-attachments] a:visible,[data-basket-more] > summary:visible').all();
 const shaped=[];
 for(const control of all){
  // 8-9e-2: the basket [⋯] is a small icon on phones and its menu rows are not button-shaped.
  // UI-디자인손질 6: the note's "‹ 바구니" (title-position back link) and its [⋯] icon are not button-shaped either.
  if(await control.evaluate(el=>el.matches('.basket-row,.basket-clip,.icon-btn,.quick-text-link,.home-basket-link,.md-body *,.basket-more-menu *,.basket-back,[data-basket-note-more]')||el.matches('.basket-more-trigger')&&innerWidth<761))continue;
  const s=await look(control);shaped.push(s);
  expect(Math.abs(s.height-height),await control.textContent()).toBeLessThanOrEqual(0.5);
  // HOME-빠른입력정리: [업데이트]와 ▾는 한 칸에 붙은 두 버튼이라 바깥쪽 모서리만 8px.
  const split=await control.evaluate(el=>el.closest('.home-quick-update-split')?(el.matches('[data-quick-org]')?'0px 8px 8px 0px':'8px 0px 0px 8px'):'8px');
  expect(s.fontSize).toBe('13px');expect(s.fontWeight).toBe('500');expect(s.radius).toBe(split);expect(s.shadow).toBe('none');expect(s.image).toBe('none');
 }
 return shaped;
}

for(const width of [390,1280])test(`home and basket buttons share the [추가] height and four kinds ${width}`,async({page})=>{
 const errors=await open(page,width);
 const quick=page.locator('#homeView .home-quick'),save=quick.locator('[data-quick-save]');
 const height=(await look(save)).height;
 expect(height).toBe(46);expect(height).toBe(parseFloat(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--ds-control-height'))));
 const primary=await token(page,'--kptu-primary'),onPrimary=await token(page,'--kptu-on-primary');
 // Home tabs: one height; the selected tab is mint whichever it is (UI-선택표시통일), the others white.
 const kinds={basket:'--ds-kind-task',task:'--ds-kind-task',update:'--ds-kind-task'};
 for(const [mode,kind] of Object.entries(kinds)){
  const tab=quick.locator(`[data-quick-mode="${mode}"]`);
  if(width<761)await tab.tap();else await tab.click();
  await expect(tab).toHaveAttribute('aria-pressed','true');
  const s=await look(tab);expect(s.bg).toBe(await token(page,kind+'-soft'));expect(s.fg).toBe(await token(page,kind+'-ink'));
  for(const other of Object.keys(kinds).filter(m=>m!==mode))expect((await look(quick.locator(`[data-quick-mode="${other}"]`))).bg).toBe(await token(page,'--kptu-surface'));
  const filled=await look(save);expect(filled.height).toBe(height);expect(filled.bg).toBe(primary);expect(filled.fg).toBe(onPrimary);
  if(mode!=='update')expect((await quick.locator('[data-quick-input]').boundingBox()).height).toBe(height);
  await sameButtons(quick.locator('.home-quick-modes'),height);
 }
 await quick.locator('[data-quick-mode="basket"]').click();
 // 이름만 바꿈: 밀린 할 일도 그대로 보인다.
 const tasks=page.locator('#homeView [data-home-card="tasks"]');
 await expect(tasks.locator('h3')).toContainText('오늘 할 일');await expect(tasks.locator('h3')).not.toContainText('밀린');
 await expect(tasks).toContainText('지연 항목');await expect(tasks).toContainText('오늘 항목');

 // Basket list: filters, [추가] and [⋯ 더보기]; the AI buttons are folded away until it opens.
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-row]')).toHaveCount(1);
 const basket=page.locator('#basketView'),more=basket.locator('[data-basket-more]');
 // 8-9e-2: [⋯] is a button (aria-label 더보기) that opens a small menu under itself.
 await expect(more).toHaveJSProperty('tagName','BUTTON');await expect(more).toHaveAttribute('aria-label','더보기');await expect(more).toHaveAttribute('aria-expanded','false');
 for(const name of ['AI 분류 요청','분류 결과 입력','GPT 답변 가져오기'])await expect(basket.getByRole('button',{name,exact:true})).toHaveCount(0);
 await sameButtons(basket,height);
 const filled=[];for(const c of await basket.locator('button:visible').all())if((await look(c)).bg===primary)filled.push(await c.textContent());
 expect(filled).toEqual(['추가']);
 expect((await look(basket.locator('[data-basket-filter="unclassified"]'))).bg).toBe(await token(page,'--ds-kind-task-soft'));
 // Keyboard opens and closes the menu; it does not push the list.
 const listTop=(await basket.locator('[data-basket-filter="unclassified"]').boundingBox()).y;
 await more.focus();await page.keyboard.press('Enter');await expect(more).toHaveAttribute('aria-expanded','true');
 await expect(page.locator('#basketMoreMenu').getByRole('button')).toHaveText(['AI 분류 요청','GPT 답변 가져오기']);
 expect((await basket.locator('[data-basket-filter="unclassified"]').boundingBox()).y).toBe(listTop);
 await sameButtons(basket,height);
 await page.keyboard.press('Escape');await expect(more).toHaveAttribute('aria-expanded','false');await expect(more).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

 // Read view: actions and attachment controls share the height; 연결하기 filled, 할 일 만들기 task kind (UI-디자인손질 6),
 // 삭제 is a red item in the note's [⋯] menu.
 const row=page.locator(`[data-basket-row="${n}"]`);if(width<761)await row.tap();else await row.click();
 await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 const detail=basket.locator('[data-basket-detail]');
 await expect(detail.locator('[data-basket-attachments] a')).toHaveCount(2);await expect(detail.locator('[data-basket-library-send]')).toHaveCount(2);await expect(detail.locator('[data-basket-hwp-edit]')).toHaveCount(1);
 await sameButtons(detail,height);
 const link=await look(detail.locator('[data-basket-link-open]')),task=await look(detail.locator('[data-basket-task-open]'));
 expect(link.bg).toBe(primary);expect(link.fg).toBe(onPrimary);
 expect(task.bg).toBe(await token(page,'--ds-kind-task-soft'));expect(task.fg).toBe(await token(page,'--ds-kind-task-ink'));
 await detail.locator('[data-basket-note-more]').click();
 const del=await look(detail.locator('[data-basket-delete]'));expect(del.fg).toBe(await token(page,'--kptu-danger'));
 // Edit view: [수정 저장] is the one filled button.
 await detail.locator('[data-basket-edit]').click();await expect(detail.locator('[data-basket-save]')).toBeVisible();
 await sameButtons(detail,height);
 const editFilled=[];for(const c of await detail.locator('button:visible').all())if((await look(c)).bg===primary)editFilled.push(await c.textContent());
 expect(editFilled).toEqual(['수정 저장']);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});

test('dark mode follows the device on home and basket (3/3 8-9e-3 turned it on for the whole app)',async({page})=>{
 const errors=await open(page,390,true);
 expect(await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
 const dark={bg:'rgb(22, 22, 19)',surface:'rgb(31, 31, 27)'};
 const colors=()=>page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return {scheme:s.colorScheme,bg:getComputedStyle(document.body).backgroundColor,surface:getComputedStyle(document.querySelector('#homeView .home-quick')).backgroundColor};});
 const home=await colors();expect(home.bg).toBe(dark.bg);expect(home.surface).toBe(dark.surface);expect(home.scheme).toContain('dark');
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-row]')).toHaveCount(1);
 expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe(dark.bg);
 await openBasketMore(page);
 expect(errors).toEqual([]);
});
