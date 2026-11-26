// ORG-기록수정삭제 + UI-모바일업데이트겹쳐보기 (synthetic data only, basket-link-detail-fixture.html).
// A: a record written in organization detail has one ⋯ (no tall red 삭제 button) holding [수정]·[삭제]; [수정] edits in place
//    (Enter = new line, Ctrl+Enter or [저장] saves with an owner-RLS PATCH limited to the row and organization), [삭제] asks once more.
// B: on a phone a tapped linked record comes up as a card over project/organization detail; ✕, swipe down and back close it,
//    and the detail stays open where it was. A wide screen keeps the full open (basket view).
//    S71-71 RECORD-기록하나로: 기록 줄은 어디서 왔든(노트에서 이은 줄도) 눌러도 아무 데도 가지 않는다. 기록 창(카드)은 ⋯ [메모]로 열리고
//    (기록 글 + 메모 칸, 원문·[노트 열기] 없음) ✕·뒤로가기·끌어 내리기·Esc로 그 자리에서 닫힌다.
import {test,expect} from '@playwright/test';
import {testOrigin} from './helpers/test-origin.mjs';
import {answerAsk} from './helpers/small-notice.mjs';
const fixture=testOrigin+'/tests/app-e2e/basket-link-detail-fixture.html';
const shots=process.env.KPTU_SHOT_DIR||'';
async function ready(page,query=''){await page.goto(fixture+query);await expect.poll(()=>page.evaluate(()=>window.__detailReady===true)).toBe(true);await page.evaluate(()=>{window.__went=[];window.KPTURouter.go=(view,o)=>window.__went.push(view)})}
const asNotes=page=>page.evaluate(()=>{for(const n of window.__detailState.notes)n.kind='note'});
async function openOrg(page){await page.evaluate(()=>window.KPTUWorkplace.open(window.__detailState.ids.org));await expect(page.locator('#wdUpdates [data-wd-up]')).toHaveCount(1)}
async function openProject(page){await page.evaluate(()=>{const s=window.__detailState;for(const row of s.links){row.project_id=s.ids.project;row.organization_id=null}return window.KPTUProjects.open(s.ids.project)});await expect(page.locator('#ps3-progress [data-basket-link]')).toHaveCount(2)}
const menu=page=>page.locator('#wdUpMenu');
const shot=async(page,name)=>{if(shots)await page.screenshot({path:`${shots}/${name}.png`})};

for(const [label,width] of [['pc',1280],['phone',390]]){
 test(`organization record: ⋯ holds 수정·메모·삭제 and edits in place with Enter newline and Ctrl+Enter save (${label})`,async({page})=>{
  await page.setViewportSize({width,height:900});await ready(page);await openOrg(page);
  const row=page.locator('#wdUpdates [data-wd-up="old-log"]');
  await expect(row.locator('[data-wd-up-del],.wd-danger')).toHaveCount(0);
  const more=row.locator('[data-wd-up-menu]');await expect(more).toHaveAccessibleName('기록 메뉴');
  const mb=await more.boundingBox(),rb=await row.boundingBox();expect(mb.height).toBeLessThanOrEqual(48);expect(mb.x+mb.width).toBeGreaterThan(rb.x+rb.width-60);expect(mb.y).toBeLessThan(rb.y+30);
  await more.click();await expect(menu(page).locator('button')).toHaveText(['수정','메모','삭제']); // S71-71: 날짜는 [수정] 칸 안await shot(page,`org-record-menu-${label}`);
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
 await row.locator('[data-wd-up-menu]').click();await menu(page).getByRole('button',{name:'수정',exact:true}).click();
 await row.locator('[data-wd-up-input]').fill('버릴 글');await row.getByRole('button',{name:'취소'}).click();
 await expect(row).toContainText('기존 조직 기록');expect(await page.evaluate(()=>(window.__detailState.patches||[]).length)).toBe(0);
 await row.locator('[data-wd-up-menu]').click();await menu(page).getByRole('button',{name:'수정',exact:true}).click();
 await page.evaluate(()=>{window.__detailState.failPatch=403});await row.locator('[data-wd-up-input]').fill('고친 기록');await row.getByRole('button',{name:'저장'}).click();
 await expect(row.locator('[data-wd-up-state]')).toContainText('기록을 수정하지 못했어요');await expect(row.locator('[data-wd-up-input]')).toHaveValue('고친 기록');
 await page.evaluate(()=>{window.__detailState.failPatch=0});await row.getByRole('button',{name:'저장'}).click();
 await expect(row.locator('[data-wd-up-edit]')).toHaveCount(0);await expect(row).toContainText('고친 기록');
 expect(await page.evaluate(()=>window.__detailState.updates[0].raw_text)).toBe('고친 기록');
});

test('organization record edit: an empty text is not saved and leaving with an unsaved edit asks first',async({page})=>{
 await ready(page);await openOrg(page);const row=page.locator('#wdUpdates [data-wd-up="old-log"]');
 await row.locator('[data-wd-up-menu]').click();await menu(page).getByRole('button',{name:'수정',exact:true}).click();
 await row.locator('[data-wd-up-input]').fill('   ');await row.locator('[data-wd-up-input]').press('Control+Enter');
 await expect(row.locator('[data-wd-up-state]')).toHaveText('내용을 입력해 주세요.');expect(await page.evaluate(()=>(window.__detailState.patches||[]).length)).toBe(0);
 await row.locator('[data-wd-up-input]').fill('저장 안 한 수정');
 let asked='';page.once('dialog',d=>{asked=d.message();d.dismiss()});
 await page.evaluate(()=>window.KPTUWorkplace.open(window.__detailState.ids.otherOrg));
 await expect.poll(()=>asked).toContain('저장하지 않은 기록 수정');await expect(row.locator('[data-wd-up-input]')).toHaveValue('저장 안 한 수정');
});

test('organization record delete asks once more and only deletes after yes',async({page})=>{
 await ready(page);await openOrg(page);const row=page.locator('#wdUpdates [data-wd-up="old-log"]');
 await row.locator('[data-wd-up-menu]').click();await menu(page).getByRole('button',{name:'삭제'}).click();
 expect(await answerAsk(page,false)).toBe('이 기록을 삭제할까요?');await expect(row).toBeVisible();
 expect(await page.evaluate(()=>window.__detailState.calls.filter(c=>c.method==='DELETE').length)).toBe(0);
 await row.locator('[data-wd-up-menu]').click();await menu(page).getByRole('button',{name:'삭제'}).click();
 await answerAsk(page,true);
 await expect(page.locator('#wdUpdates [data-wd-up]')).toHaveCount(0);
 const del=await page.evaluate(()=>window.__detailState.calls.filter(c=>c.method==='DELETE').map(c=>c.path));expect(del).toHaveLength(1);expect(del[0]).toContain('app_suborganization_updates?id=eq.old-log');
});

const memoItem=(page,menuId)=>page.locator(menuId).getByRole('button',{name:/^메모( \d+)?$/});
test('phone: organization linked record ⋯ [메모] opens the record card over the detail; ✕, back and swipe close it in place',async({page})=>{
 await page.setViewportSize({width:390,height:844});await ready(page,'?history=1');await asNotes(page);await openOrg(page);
 await expect(page.locator('#wdModal')).toHaveAttribute('data-kptu-history-open','1');
 const modal=page.locator('#wdModal');await modal.evaluate(el=>{el.scrollTop=Math.min(120,el.scrollHeight)});const before=await modal.evaluate(el=>el.scrollTop);
 const row=page.locator('#wdUpdates [data-basket-link]').first(),more=row.locator('[data-basket-link-menu]');
 const sheet=page.locator('#kptuRecordSheet');
 // 줄 글을 눌러도 카드·노트로 가지 않는다
 await expect(row.locator('a')).toHaveCount(0);await row.locator('[data-link-summary-text]').click();await page.waitForTimeout(150);
 await expect(sheet).toHaveCount(0);expect(await page.evaluate(()=>window.__went)).toEqual([]);
 const openCard=async()=>{await more.click();await memoItem(page,'#basketLinkMenu').click();await expect(sheet).toBeVisible();};
 await openCard();await expect(modal).toBeVisible();
 await expect(sheet).toContainText('합성 담당조직');await expect(sheet.getByRole('button',{name:'노트 열기'})).toHaveCount(0);
 await expect(sheet.locator('[data-record-sheet-memos]')).toHaveCount(1);
 const box=await sheet.locator('[data-record-sheet-card]').boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(844+1);expect(box.width).toBeGreaterThan(380);
 await shot(page,'org-record-sheet-phone');
 await sheet.getByRole('button',{name:'닫기'}).click();await expect(sheet).toBeHidden();await expect(modal).toBeVisible();await expect(more).toBeFocused();
 expect(await modal.evaluate(el=>el.scrollTop)).toBe(before);
 await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('wdModal');
 // Phone back closes the card first; the detail and its history entry stay.
 await openCard();await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('kptuRecordSheet');
 await page.evaluate(()=>history.back());await expect(sheet).toBeHidden();await expect(modal).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('wdModal');
 // Swipe the card's top down: a short pull snaps back, a long one closes.
 await openCard();const grab=await sheet.locator('[data-record-sheet-grab]').boundingBox();
 const x=grab.x+40,y=grab.y+12;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+30,{steps:4});await page.mouse.up();await expect(sheet).toBeVisible();
 const head=sheet.locator('[data-record-sheet-grab]');await expect.poll(async()=>Math.round((await head.boundingBox()).y)).toBe(Math.round(grab.y));
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+160,{steps:8});await page.mouse.up();
 await expect(sheet).toBeHidden();await expect(modal).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('wdModal');
 expect(await page.evaluate(()=>window.__went)).toEqual([]);
});

test('phone: project linked record ⋯ [메모] opens the record card over project detail and Esc closes it',async({page})=>{
 await page.setViewportSize({width:390,height:844});await ready(page,'?history=1');await asNotes(page);await openProject(page);
 const modal=page.locator('#ps3DetailModal'),sheet=page.locator('#kptuRecordSheet');
 const row=page.locator('#ps3-progress [data-ps3-records]>[data-basket-link]').first(),more=row.locator('[data-ps3-record-menu]');
 await row.locator('.ps3-rec-text').click();await page.waitForTimeout(150);await expect(sheet).toHaveCount(0);expect(await page.evaluate(()=>window.__went)).toEqual([]);
 await more.click();await memoItem(page,'#ps3RecordMenu').click();await expect(sheet).toBeVisible();await expect(modal).toBeVisible();await expect(sheet).toContainText('합성 프로젝트');
 await expect(sheet.getByRole('button',{name:'노트 열기'})).toHaveCount(0);
 await shot(page,'project-record-sheet-phone');
 await page.keyboard.press('Escape');await expect(sheet).toBeHidden();await expect(modal).toBeVisible();
 await more.click();await memoItem(page,'#ps3RecordMenu').click();await expect(sheet).toBeVisible();await page.evaluate(()=>history.back());await expect(sheet).toBeHidden();await expect(modal).toBeVisible();
 expect(await page.evaluate(()=>window.__went)).toEqual([]);
});

test('wide screen: tapping a linked record line goes nowhere (no card, no note)',async({page})=>{
 await page.setViewportSize({width:1280,height:900});await ready(page);await asNotes(page);await openOrg(page);
 await page.locator('#wdUpdates [data-basket-link] [data-link-summary-text]').first().click();await page.waitForTimeout(150);
 expect(await page.evaluate(()=>window.__went)).toEqual([]);await expect(page.locator('#kptuRecordSheet')).toHaveCount(0);
 await ready(page);await asNotes(page);await openProject(page);await page.locator('#ps3-progress [data-ps3-records]>[data-basket-link] .ps3-rec-text').first().click();await page.waitForTimeout(150);
 expect(await page.evaluate(()=>window.__went)).toEqual([]);await expect(page.locator('#kptuRecordSheet')).toHaveCount(0);
});
