// ORG-기록수정삭제 + UI-모바일업데이트겹쳐보기 (synthetic data only, basket-link-detail-fixture.html).
// A: a record written in organization detail has one ⋯ (no tall red 삭제 button) holding [수정]·[삭제]; [수정] edits in place
//    (Enter = new line, Ctrl+Enter or [저장] saves with an owner-RLS PATCH limited to the row and organization), [삭제] asks once more.
// B: UI-기록줄높이통일(S70-66, 명진 2026-11-26 '두 줄'): a tapped linked record opens in place under its line (no card, no leaving) on
//    every width; the full open (basket view) is the ⋯ [업데이트 열기]. (Before: a card over the detail on a phone — UI-모바일업데이트겹쳐보기.)
import {test,expect} from '@playwright/test';
import {testOrigin} from './helpers/test-origin.mjs';
import {answerAsk} from './helpers/small-notice.mjs';
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
  await more.click();await expect(menu(page).locator('button')).toHaveText(['수정','날짜 수정','메모','삭제']);await shot(page,`org-record-menu-${label}`);
  await menu(page).getByRole('button',{name:'수정',exact:true}).click();
  const input=row.locator('[data-wd-up-input]');await expect(input).toBeFocused();await expect(input).toHaveValue('기존 조직 기록');
  await input.press('End');await input.press('Enter');await input.pressSequentially('둘째 줄');
  await expect(input).toHaveValue('기존 조직 기록\n둘째 줄');
  expect(await page.evaluate(()=>(window.__detailState.patches||[]).length)).toBe(0);
  await shot(page,`org-record-edit-${label}`);
  await input.press('Control+Enter');
  await expect(row.locator('[data-wd-up-edit]')).toHaveCount(0);
  await expect(row.locator('.wd-log-main .rec-fold-full')).toHaveText('기존 조직 기록\n둘째 줄');
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

for(const width of [390,1280])test(`linked record ${width}: a tap opens it in place (no card, no leaving); ⋯ [업데이트 열기] is the full open`,async({page})=>{
 await page.setViewportSize({width,height:900});await ready(page,'?history=1');await openOrg(page);
 const modal=page.locator('#wdModal'),row=page.locator('#wdUpdates [data-basket-link]').first(),line=row.locator('[data-rec-fold-toggle]');
 await line.click();await expect(line).toHaveAttribute('aria-expanded','true');await expect(row.locator('[data-rec-fold-body]')).toContainText('보관 원문 <script> 합성 내용');
 await expect(page.locator('#kptuRecordSheet')).toHaveCount(0);await expect(modal).toBeVisible();expect(await page.evaluate(()=>window.__went)).toEqual([]);
 await line.click();await expect(line).toHaveAttribute('aria-expanded','false');await expect(row.locator('[data-rec-fold-body]')).toBeHidden();
 await row.locator('[data-basket-link-menu]').click();await page.locator('#basketLinkMenu').getByRole('button',{name:'업데이트 열기'}).click();
 await expect.poll(()=>page.evaluate(()=>window.__went)).toEqual(['basket']);await expect(modal).toBeHidden();
 await ready(page,'?history=1');await openProject(page);
 const prow=page.locator('#ps3-progress [data-basket-link]').first(),pline=prow.locator('[data-rec-fold-toggle]');
 await pline.click();await expect(pline).toHaveAttribute('aria-expanded','true');await expect(prow.locator('[data-rec-fold-body]')).toContainText('보관 원문 <script> 합성 내용');
 await expect(page.locator('#kptuRecordSheet')).toHaveCount(0);await expect(page.locator('#ps3DetailModal')).toBeVisible();expect(await page.evaluate(()=>window.__went)).toEqual([]);
 await prow.locator('[data-ps3-record-menu]').click();await page.locator('#ps3RecordMenu [data-ps3-record-action="open-note"]').click();
 await expect.poll(()=>page.evaluate(()=>window.__went)).toEqual(['basket']);
});
