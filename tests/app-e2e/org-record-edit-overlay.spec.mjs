// ORG-기록수정삭제 + UI-모바일업데이트겹쳐보기 (synthetic data only, basket-link-detail-fixture.html).
// A: a record written in organization detail has one ⋯ (no tall red 삭제 button) holding [수정]·[삭제]; [수정] edits in place
//    (Enter = new line, Ctrl+Enter or [저장] saves with an owner-RLS PATCH limited to the row and organization), [삭제] asks once more.
// B: on a phone a tapped linked record comes up as a card over project/organization detail; ✕, swipe down and back close it,
//    and the detail stays open where it was. A wide screen keeps the full open (basket view).
import {test,expect} from '@playwright/test';
import {testOrigin} from './helpers/test-origin.mjs';
const fixture=testOrigin+'/tests/app-e2e/basket-link-detail-fixture.html';
const shots=process.env.KPTU_SHOT_DIR||'';
async function ready(page,query=''){await page.goto(fixture+query);await expect.poll(()=>page.evaluate(()=>window.__detailReady===true)).toBe(true);await page.evaluate(()=>{window.__went=[];window.KPTURouter.go=(view,o)=>window.__went.push(view)})}
async function openOrg(page){await page.evaluate(()=>window.KPTUWorkplace.open(window.__detailState.ids.org));await expect(page.locator('#wdUpdates [data-wd-up]')).toHaveCount(1)}
async function openProject(page){await page.evaluate(()=>{const s=window.__detailState;for(const row of s.links){row.project_id=s.ids.project;row.organization_id=null}return window.KPTUProjects.open(s.ids.project)});await expect(page.locator('#ps3-progress [data-basket-link]')).toHaveCount(2)}
const menu=page=>page.locator('#wdUpMenu');
const shot=async(page,name)=>{if(shots)await page.screenshot({path:`${shots}/${name}.png`})};

for(const [label,width] of [['pc',1280],['phone',390]]){
 test(`organization record: ⋯ holds 수정·삭제 and edits in place with Enter newline and Ctrl+Enter save (${label})`,async({page})=>{
  await page.setViewportSize({width,height:900});await ready(page);await openOrg(page);
  const row=page.locator('#wdUpdates [data-wd-up="old-log"]');
  await expect(row.locator('[data-wd-up-del],.wd-danger')).toHaveCount(0);
  const more=row.locator('[data-wd-up-menu]');await expect(more).toHaveAccessibleName('기록 메뉴');
  const mb=await more.boundingBox(),rb=await row.boundingBox();expect(mb.height).toBeLessThanOrEqual(48);expect(mb.x+mb.width).toBeGreaterThan(rb.x+rb.width-60);expect(mb.y).toBeLessThan(rb.y+30);
  await more.click();await expect(menu(page).locator('button')).toHaveText(['수정','삭제']);await shot(page,`org-record-menu-${label}`);
  await menu(page).getByRole('button',{name:'수정',exact:true}).click();
  const input=row.locator('[data-wd-up-input]');await expect(input).toBeFocused();await expect(input).toHaveValue('기존 조직 기록');
  await input.press('End');await input.press('Enter');await input.pressSequentially('둘째 줄');
  await expect(input).toHaveValue('기존 조직 기록\n둘째 줄');
  expect(await page.evaluate(()=>(window.__detailState.patches||[]).length)).toBe(0);
  await shot(page,`org-record-edit-${label}`);
  await input.press('Control+Enter');
  await expect(row.locator('[data-wd-up-edit]')).toHaveCount(0);
  await expect(row.locator('.wd-log-main p').first()).toHaveText('기존 조직 기록\n둘째 줄');
  const patches=await page.evaluate(()=>window.__detailState.patches);expect(patches).toHaveLength(1);
  expect(patches[0].body).toEqual({raw_text:'기존 조직 기록\n둘째 줄'});expect(patches[0].path).toContain('id=eq.old-log');expect(patches[0].path).toContain('organization_id=eq.'+await page.evaluate(()=>window.__detailState.ids.org));
  await expect(row.locator('[data-wd-up-menu]')).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}

test('organization record edit: 취소 keeps the text, [저장] saves, a failed save keeps the draft',async({page})=>{
 await ready(page);await openOrg(page);const row=page.locator('#wdUpdates [data-wd-up="old-log"]');
 await row.locator('[data-wd-up-menu]').click();await menu(page).getByRole('button',{name:'수정'}).click();
 await row.locator('[data-wd-up-input]').fill('버릴 글');await row.getByRole('button',{name:'취소'}).click();
 await expect(row).toContainText('기존 조직 기록');expect(await page.evaluate(()=>(window.__detailState.patches||[]).length)).toBe(0);
 await row.locator('[data-wd-up-menu]').click();await menu(page).getByRole('button',{name:'수정'}).click();
 await page.evaluate(()=>{window.__detailState.failPatch=403});await row.locator('[data-wd-up-input]').fill('고친 기록');await row.getByRole('button',{name:'저장'}).click();
 await expect(row.locator('[data-wd-up-state]')).toContainText('기록을 고치지 못했습니다');await expect(row.locator('[data-wd-up-input]')).toHaveValue('고친 기록');
 await page.evaluate(()=>{window.__detailState.failPatch=0});await row.getByRole('button',{name:'저장'}).click();
 await expect(row.locator('[data-wd-up-edit]')).toHaveCount(0);await expect(row).toContainText('고친 기록');
 expect(await page.evaluate(()=>window.__detailState.updates[0].raw_text)).toBe('고친 기록');
});

test('organization record edit: an empty text is not saved and leaving with an unsaved edit asks first',async({page})=>{
 await ready(page);await openOrg(page);const row=page.locator('#wdUpdates [data-wd-up="old-log"]');
 await row.locator('[data-wd-up-menu]').click();await menu(page).getByRole('button',{name:'수정'}).click();
 await row.locator('[data-wd-up-input]').fill('   ');await row.locator('[data-wd-up-input]').press('Control+Enter');
 await expect(row.locator('[data-wd-up-state]')).toHaveText('내용을 입력해 주세요.');expect(await page.evaluate(()=>(window.__detailState.patches||[]).length)).toBe(0);
 await row.locator('[data-wd-up-input]').fill('저장 안 한 수정');
 let asked='';page.once('dialog',d=>{asked=d.message();d.dismiss()});
 await page.evaluate(()=>window.KPTUWorkplace.open(window.__detailState.ids.otherOrg));
 await expect.poll(()=>asked).toContain('저장하지 않은 기록 수정');await expect(row.locator('[data-wd-up-input]')).toHaveValue('저장 안 한 수정');
});

test('organization record delete asks once more and only deletes after yes',async({page})=>{
 await ready(page);await openOrg(page);const row=page.locator('#wdUpdates [data-wd-up="old-log"]');
 let message='';page.once('dialog',d=>{message=d.message();d.dismiss()});
 await row.locator('[data-wd-up-menu]').click();await menu(page).getByRole('button',{name:'삭제'}).click();
 await expect.poll(()=>message).toBe('이 기록을 삭제할까요?');await expect(row).toBeVisible();
 expect(await page.evaluate(()=>window.__detailState.calls.filter(c=>c.method==='DELETE').length)).toBe(0);
 page.once('dialog',d=>d.accept());
 await row.locator('[data-wd-up-menu]').click();await menu(page).getByRole('button',{name:'삭제'}).click();
 await expect(page.locator('#wdUpdates [data-wd-up]')).toHaveCount(0);
 const del=await page.evaluate(()=>window.__detailState.calls.filter(c=>c.method==='DELETE').map(c=>c.path));expect(del).toHaveLength(1);expect(del[0]).toContain('app_suborganization_updates?id=eq.old-log');
});

test('phone: organization linked record opens as a card over the detail; ✕, back and swipe close it in place',async({page})=>{
 await page.setViewportSize({width:390,height:844});await ready(page,'?history=1');await openOrg(page);
 await expect(page.locator('#wdModal')).toHaveAttribute('data-kptu-history-open','1');
 const modal=page.locator('#wdModal');await modal.evaluate(el=>{el.scrollTop=Math.min(120,el.scrollHeight)});const before=await modal.evaluate(el=>el.scrollTop);
 const line=page.locator('#wdUpdates [data-basket-link] a[data-basket-link-open]').first();
 const sheet=page.locator('#kptuRecordSheet');
 await line.click();await expect(sheet).toBeVisible();await expect(modal).toBeVisible();
 await expect(sheet.locator('[data-record-sheet-text]')).toHaveText('보관 원문 <script> 합성 내용');
 await expect(sheet).toContainText('합성 담당조직');await expect(sheet.getByRole('button',{name:'바구니에서 열기'})).toBeVisible();
 expect(await page.evaluate(()=>window.__went)).toEqual([]);
 const box=await sheet.locator('[data-record-sheet-card]').boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(844+1);expect(box.width).toBeGreaterThan(380);
 await shot(page,'org-record-sheet-phone');
 await sheet.getByRole('button',{name:'닫기'}).click();await expect(sheet).toBeHidden();await expect(modal).toBeVisible();await expect(line).toBeFocused();
 expect(await modal.evaluate(el=>el.scrollTop)).toBe(before);
 await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('wdModal');
 // Phone back closes the card first; the detail and its history entry stay.
 await line.click();await expect(sheet).toBeVisible();await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('kptuRecordSheet');
 await page.evaluate(()=>history.back());await expect(sheet).toBeHidden();await expect(modal).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('wdModal');
 // Swipe the card's top down: a short pull snaps back, a long one closes.
 await line.click();await expect(sheet).toBeVisible();const grab=await sheet.locator('[data-record-sheet-grab]').boundingBox();
 const x=grab.x+40,y=grab.y+12;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+30,{steps:4});await page.mouse.up();await expect(sheet).toBeVisible();
 const head=sheet.locator('[data-record-sheet-grab]');await expect.poll(async()=>Math.round((await head.boundingBox()).y)).toBe(Math.round(grab.y));
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+160,{steps:8});await page.mouse.up();
 await expect(sheet).toBeHidden();await expect(modal).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('wdModal');
 expect(await page.evaluate(()=>window.__went)).toEqual([]);
 // [바구니에서 열기] hands over to the existing full open once the card is gone.
 await line.click();await sheet.getByRole('button',{name:'바구니에서 열기'}).click();
 await expect(sheet).toBeHidden();await expect(modal).toBeHidden();await expect.poll(()=>page.evaluate(()=>window.__went)).toEqual(['basket']);
});

test('phone: project linked record opens as a card over project detail and Esc closes it',async({page})=>{
 await page.setViewportSize({width:390,height:844});await ready(page,'?history=1');await openProject(page);
 const modal=page.locator('#ps3DetailModal'),sheet=page.locator('#kptuRecordSheet');
 const line=page.locator('#ps3-progress [data-ps3-basket-note]').first();
 await line.click();await expect(sheet).toBeVisible();await expect(modal).toBeVisible();await expect(sheet).toContainText('합성 프로젝트');
 await expect(sheet.locator('[data-record-sheet-text]')).toHaveText('보관 원문 <script> 합성 내용');
 expect(await page.evaluate(()=>window.__went)).toEqual([]);
 await shot(page,'project-record-sheet-phone');
 await page.keyboard.press('Escape');await expect(sheet).toBeHidden();await expect(modal).toBeVisible();await expect(line).toBeFocused();
 await line.click();await expect(sheet).toBeVisible();await page.evaluate(()=>history.back());await expect(sheet).toBeHidden();await expect(modal).toBeVisible();
 await line.click();await sheet.getByRole('button',{name:'바구니에서 열기'}).click();await expect.poll(()=>page.evaluate(()=>window.__went)).toEqual(['basket']);await expect(modal).toBeHidden();
});

test('wide screen keeps the full open for a linked record (no card)',async({page})=>{
 await page.setViewportSize({width:1280,height:900});await ready(page);await openOrg(page);
 await page.locator('#wdUpdates [data-basket-link] a[data-basket-link-open]').first().click();
 await expect.poll(()=>page.evaluate(()=>window.__went)).toEqual(['basket']);await expect(page.locator('#kptuRecordSheet')).toHaveCount(0);
 await ready(page);await openProject(page);await page.locator('#ps3-progress [data-ps3-basket-note]').first().click();
 await expect.poll(()=>page.evaluate(()=>window.__went)).toEqual(['basket']);await expect(page.locator('#kptuRecordSheet')).toHaveCount(0);
});
