import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-홈업데이트선택: [업데이트 ▾] picks one of 담당조직 or 프로젝트; each saves through its own existing path
// (MTG-프로젝트합치기 3단계: 프로젝트 하나는 정리함 업데이트 + 연결).
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
// UPD-여러곳고르기: presses only mark; [저장] keeps the marks. Picking a project after an organization keeps both.
test('sheet lists organizations and projects together; a press marks and [저장] keeps',async({page})=>{
 const {q}=await ready(page,1280);
 await q.locator('[data-quick-org]').click();await expect(dialog(page)).toBeVisible();
 await expect(dialog(page).locator('[data-sheet-all] button')).not.toHaveCount(0);
 await expect(dialog(page).locator('[data-sheet-projects] button')).toHaveText(['테스트 프로젝트','자식 프로젝트']);
 await dialog(page).getByRole('button',{name:'테스트 조직',exact:true}).first().click();await dialog(page).getByRole('button',{name:'저장',exact:true}).click();
 await expect(q.locator('[data-quick-input]')).toHaveAttribute('placeholder','테스트 조직 기록을 입력하세요');
 await q.locator('[data-quick-org]').click();
 await expect(dialog(page).locator('[data-sheet-projects] button[aria-pressed="true"]')).toHaveCount(0);
 await dialog(page).locator('[data-sheet-all]').getByRole('button',{name:'테스트 조직',exact:true}).click();
 await dialog(page).locator('[data-sheet-projects]').getByRole('button',{name:'자식 프로젝트',exact:true}).click();await dialog(page).getByRole('button',{name:'저장',exact:true}).click();
 await expect(q.locator('[data-quick-input]')).toHaveAttribute('placeholder','자식 프로젝트 기록을 입력하세요');
 await expect(q.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택: 자식 프로젝트');
 await q.locator('[data-quick-org]').click();
 await expect(dialog(page).locator('[aria-pressed="true"]')).toHaveCount(1);
 await expect(dialog(page).locator('[data-sheet-all] [aria-pressed="true"]')).toHaveCount(0);
});
// MTG-프로젝트합치기 3단계: 프로젝트(사업영역) 하나를 고르면 진행 기록 표가 아니라 정리함 업데이트 1건 + 바구니 [연결하기]와 같은
// app_basket_confirm_links(reason '직접 연결')로 그 사업영역에 잇는다. 조직 하나는 지금처럼 그 조직 기록이다.
test('project choice saves a basket update linked to the project and organization choice keeps the organization path',async({page})=>{
 const {q}=await ready(page,1280);
 const projectBodies=[],orgBodies=[],notes=[],links=[];
 await page.route(SB+'/rest/v1/app_project_progress_updates',r=>{projectBodies.push(r.request().postDataJSON());return r.fulfill({json:[]});});
 await page.route(SB+'/rest/v1/app_suborganization_updates',r=>{orgBodies.push(r.request().postDataJSON());return r.fulfill({json:[]});});
 await page.route(SB+'/rest/v1/app_notes**',r=>{if(r.request().method()!=='POST')return r.fallback();const body=r.request().postDataJSON();notes.push(body);return r.fulfill({status:201,json:[{id:'new-note',kind:'basket',occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00.123456Z',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{},...body}]});});
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',r=>{links.push(r.request().postDataJSON());return r.fulfill({json:{ok:true,created:1,existing:0}});});
 await q.locator('[data-quick-org]').click();
 await dialog(page).locator('[data-sheet-projects]').getByRole('button',{name:'테스트 프로젝트',exact:true}).click();await dialog(page).getByRole('button',{name:'저장',exact:true}).click();
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 await expect(page.locator('#toast')).toContainText('기록을 저장했습니다.');
 expect(orgBodies).toHaveLength(0);expect(projectBodies).toHaveLength(0);
 expect(notes).toHaveLength(1);expect(notes[0]).toMatchObject({raw_text:'기록 내용'});
 expect(links).toEqual([{p_note_id:'new-note',p_note_updated_at:'2026-10-06T01:00:00.123456Z',p_targets:[{kind:'project',target_id:'p',reason:'직접 연결'}]}]);
 await q.locator('[data-quick-input]').fill('조직 기록');
 await q.locator('[data-quick-org]').click();
 await dialog(page).getByRole('button',{name:'테스트 조직',exact:true}).first().click();await dialog(page).getByRole('button',{name:'저장',exact:true}).click();
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(projectBodies).toHaveLength(0);expect(notes).toHaveLength(1);expect(links).toHaveLength(1);expect(orgBodies).toEqual([{organization_id:'o',raw_text:'조직 기록',created_by:'home-test'}]);
});
for(const width of [390,1280])test(`saving without a place puts the update in the basket; [정리함] in the sheet clears a chosen place ${width}`,async({page})=>{
 const {q}=await ready(page,width);
 const notes=[],orgBodies=[];
 await page.route(SB+'/rest/v1/app_notes**',r=>{if(r.request().method()!=='POST')return r.fallback();const body=r.request().postDataJSON();notes.push(body);return r.fulfill({json:[{id:'new-note',kind:'basket',occurred_at:'2026-10-06T01:00:00Z',...body}]});});
 await page.route(SB+'/rest/v1/app_suborganization_updates',r=>{orgBodies.push(r.request().postDataJSON());return r.fulfill({json:[]});});
 await expect(q).toHaveAttribute('data-mode','basket');await expect(q.locator('[data-quick-input]')).toHaveAttribute('placeholder','업데이트 입력(정리함에 저장)');
 await expect(q.locator('[data-quick-mode]')).toHaveText(['업데이트','할 일']);
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');await expect(dialog(page)).toBeHidden();
 await expect(page.locator('#toast')).toContainText('정리함에 저장했습니다.');
 expect(notes).toHaveLength(1);expect(notes[0]).toMatchObject({raw_text:'기록 내용'});expect(orgBodies).toHaveLength(0);
 await q.locator('[data-quick-input]').fill('다시 정리함으로');
 await q.locator('[data-quick-org]').click();await dialog(page).getByRole('button',{name:'테스트 조직',exact:true}).first().click();await dialog(page).getByRole('button',{name:'저장',exact:true}).click();await expect(q).toHaveAttribute('data-mode','update');
 await q.locator('[data-quick-org]').click();await expect(dialog(page).locator('[data-sheet-basket] button')).toHaveText('정리함(미분류)');
 await dialog(page).getByRole('button',{name:'정리함(미분류)',exact:true}).click();await dialog(page).getByRole('button',{name:'저장',exact:true}).click();await expect(q).toHaveAttribute('data-mode','basket');
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(notes).toHaveLength(2);expect(orgBodies).toHaveLength(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('an old [정리함] tab memory opens as [업데이트]',async({page})=>{
 // The server holds the old value 'basket' (no longer a valid mode): it is ignored and the box opens as [업데이트].
 await installViewPrefsServer(page,{home_quick_mode:'basket'});
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
 // Organization chips get the wider list (480px, UI-PC팝업위치) so fewer lines need scrolling; on a wide PC (1024px~) the
 // 기록할 곳 sheet is the split list (UI-기록할곳창PC, up to 880px) with organizations and projects side by side.
 if(width>=1024){await expect(dialog(page)).toHaveClass(/home-choice-split/);expect(d.width).toBeLessThanOrEqual(880);}
 else{await expect(dialog(page)).not.toHaveClass(/home-choice-split/);expect(d.width).toBeLessThanOrEqual(480);}expect(d.x).toBeGreaterThanOrEqual(0);expect(d.x+d.width).toBeLessThanOrEqual(width);
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
// UI-PC팝업위치: every choice sheet opens by its button on a wide screen, not only [업데이트 ▾].
test('other choice sheets also open beside their button on a wide screen',async({page})=>{
 const {q}=await ready(page,1280);
 await q.locator('[data-quick-mode="task"]').click();await q.locator('[data-quick-input]').focus();
 const trigger=q.locator('[data-quick-project]');
 await trigger.click();await expect(dialog(page)).toBeVisible();
 await expect(dialog(page)).toHaveClass(/home-choice-anchored/);
 const t=await trigger.boundingBox(),d=await dialog(page).boundingBox();
 const gap=d.y>=t.y+t.height-1?d.y-(t.y+t.height):t.y-(d.y+d.height);
 expect(gap).toBeGreaterThanOrEqual(-1);expect(gap).toBeLessThanOrEqual(12);expect(d.width).toBeLessThanOrEqual(360);
});
