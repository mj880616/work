import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-홈업데이트선택: [업데이트 ▾] picks one of 담당조직 or 프로젝트; each saves through its own existing path.
// BASKET-업데이트통합 PR 1: ▾ also offers [바구니(미분류)]; with no place chosen [업데이트] saves to the basket.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const quick=page=>page.locator('#homeView [data-home-quick]');
const dialog=page=>page.getByRole('dialog');
async function ready(page,width){
 await page.setViewportSize({width,height:844});
 const home=await openHome(page);const q=quick(page);
 await q.locator('[data-quick-mode="task"]').click();await q.locator('[data-quick-mode="update"]').click();
 await q.locator('[data-quick-input]').fill('기록 내용');
 return {...home,q};
}
test('sheet lists organizations and projects together and only one can be chosen',async({page})=>{
 const {q}=await ready(page,1280);
 await q.locator('[data-quick-org]').click();await expect(dialog(page)).toBeVisible();
 await expect(dialog(page).locator('[data-sheet-all] button')).not.toHaveCount(0);
 await expect(dialog(page).locator('[data-sheet-projects] button')).toHaveText(['테스트 프로젝트','자식 프로젝트']);
 await dialog(page).getByRole('button',{name:'테스트 조직',exact:true}).first().click();
 await expect(q.locator('[data-quick-input]')).toHaveAttribute('placeholder','테스트 조직 기록을 입력하세요');
 await q.locator('[data-quick-org]').click();
 await expect(dialog(page).locator('[data-sheet-projects] button[aria-pressed="true"]')).toHaveCount(0);
 await dialog(page).locator('[data-sheet-projects]').getByRole('button',{name:'자식 프로젝트',exact:true}).click();
 await expect(q.locator('[data-quick-input]')).toHaveAttribute('placeholder','자식 프로젝트 기록을 입력하세요');
 await expect(q.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택: 자식 프로젝트');
 await q.locator('[data-quick-org]').click();
 await expect(dialog(page).locator('[aria-pressed="true"]')).toHaveCount(1);
 await expect(dialog(page).locator('[data-sheet-all] [aria-pressed="true"]')).toHaveCount(0);
});
test('project choice saves through the project progress table and organization choice keeps the organization path',async({page})=>{
 const {q}=await ready(page,1280);
 const projectBodies=[],orgBodies=[];
 await page.route(SB+'/rest/v1/app_project_progress_updates',r=>{projectBodies.push(r.request().postDataJSON());return r.fulfill({json:[]});});
 await page.route(SB+'/rest/v1/app_suborganization_updates',r=>{orgBodies.push(r.request().postDataJSON());return r.fulfill({json:[]});});
 await q.locator('[data-quick-org]').click();
 await dialog(page).locator('[data-sheet-projects]').getByRole('button',{name:'테스트 프로젝트',exact:true}).click();
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(orgBodies).toHaveLength(0);expect(projectBodies).toHaveLength(1);
 expect(projectBodies[0]).toMatchObject({project_id:'p',workstream_id:null,author_id:'home-test',status_label:null,summary:'기록 내용',next_step:null,metadata:{}});
 expect(projectBodies[0].effective_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
 await q.locator('[data-quick-input]').fill('조직 기록');
 await q.locator('[data-quick-org]').click();
 await dialog(page).getByRole('button',{name:'테스트 조직',exact:true}).first().click();
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(projectBodies).toHaveLength(1);expect(orgBodies).toEqual([{organization_id:'o',raw_text:'조직 기록',created_by:'home-test'}]);
});
for(const width of [390,1280])test(`saving without a place puts the update in the basket; [바구니] in the sheet clears a chosen place ${width}`,async({page})=>{
 const {q}=await ready(page,width);
 const notes=[],orgBodies=[];
 await page.route(SB+'/rest/v1/app_notes**',r=>{if(r.request().method()!=='POST')return r.fallback();const body=r.request().postDataJSON();notes.push(body);return r.fulfill({json:[{id:'new-note',kind:'basket',occurred_at:'2026-10-06T01:00:00Z',...body}]});});
 await page.route(SB+'/rest/v1/app_suborganization_updates',r=>{orgBodies.push(r.request().postDataJSON());return r.fulfill({json:[]});});
 await expect(q).toHaveAttribute('data-mode','basket');await expect(q.locator('[data-quick-input]')).toHaveAttribute('placeholder','업데이트를 입력하세요(바구니에 저장)');
 await expect(q.locator('[data-quick-mode]')).toHaveText(['업데이트','할 일']);
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');await expect(dialog(page)).toBeHidden();
 await expect(page.locator('#toast')).toContainText('바구니에 저장했습니다.');
 expect(notes).toHaveLength(1);expect(notes[0]).toMatchObject({raw_text:'기록 내용'});expect(orgBodies).toHaveLength(0);
 await q.locator('[data-quick-input]').fill('다시 바구니로');
 await q.locator('[data-quick-org]').click();await dialog(page).getByRole('button',{name:'테스트 조직',exact:true}).first().click();await expect(q).toHaveAttribute('data-mode','update');
 await q.locator('[data-quick-org]').click();await expect(dialog(page).locator('[data-sheet-basket] button')).toHaveText('바구니(미분류)');
 await dialog(page).getByRole('button',{name:'바구니(미분류)',exact:true}).click();await expect(q).toHaveAttribute('data-mode','basket');
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(notes).toHaveLength(2);expect(orgBodies).toHaveLength(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('an old [바구니] tab memory opens as [업데이트]',async({page})=>{
 // Synthetic read stub (as in home-quick.spec.mjs): the remembered tab reads back as the old value 'basket'; nothing is stored.
 await page.addInitScript(()=>{const read=Storage.prototype.getItem;Storage.prototype.getItem=function(key){return key==='kptu-home-quick-mode'?'basket':read.call(this,key);};});
 await openHome(page);const q=quick(page);
 await expect(q).toHaveAttribute('data-mode','basket');await expect(q.locator('[data-quick-mode="update"]')).toHaveAttribute('aria-pressed','true');
 await expect(q.locator('[data-quick-mode="basket"]')).toHaveCount(0);
});
for(const width of [870,1280])test(`wide screen opens the sheet beside the button at ${width}`,async({page})=>{
 const {q}=await ready(page,width);const trigger=q.locator('[data-quick-org]');
 await trigger.click();await expect(dialog(page)).toBeVisible();await expect(dialog(page)).toHaveClass(/home-choice-anchored/);
 const t=await trigger.boundingBox(),d=await dialog(page).boundingBox();
 const gap=d.y>=t.y+t.height-1?d.y-(t.y+t.height):t.y-(d.y+d.height);
 expect(gap).toBeGreaterThanOrEqual(-1);expect(gap).toBeLessThanOrEqual(12);
 expect(d.x).toBeLessThanOrEqual(t.x+t.width);expect(d.x+d.width).toBeGreaterThanOrEqual(t.x);
 expect(d.width).toBeLessThanOrEqual(360);expect(d.x).toBeGreaterThanOrEqual(0);expect(d.x+d.width).toBeLessThanOrEqual(width);
 await page.keyboard.press('Escape');await expect(dialog(page)).toBeHidden();await expect(trigger).toBeFocused();
 await trigger.click();await expect(dialog(page)).toBeVisible();
 await page.mouse.click(2,2);await expect(dialog(page)).toBeHidden();
});
test('phone keeps the bottom sheet',async({page})=>{
 const {q}=await ready(page,412);
 await q.locator('[data-quick-org]').click();await expect(dialog(page)).toBeVisible();
 await expect(dialog(page)).not.toHaveClass(/home-choice-anchored/);
 const d=await dialog(page).boundingBox();expect(d.width).toBeGreaterThanOrEqual(400);expect(d.y+d.height).toBeGreaterThan(844-120);
});
test('other choice sheets stay bottom sheets on a wide screen',async({page})=>{
 const {q}=await ready(page,1280);
 await q.locator('[data-quick-mode="task"]').click();await q.locator('[data-quick-input]').focus();
 await q.locator('[data-quick-project]').click();await expect(dialog(page)).toBeVisible();
 await expect(dialog(page)).not.toHaveClass(/home-choice-anchored/);
 const d=await dialog(page).boundingBox();expect(d.y+d.height).toBeGreaterThan(844-20);
});
