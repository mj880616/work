import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { toggleKeys } from './helpers/area-org-picker.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// QUICK-입력정리(2026-11-28): 홈 빠른 입력 막대는 지웠다(그 시험도 지움). 남은 두 시험은 막대와 같은 저장 길을 쓰던 다른 화면(조직 상세·할 일 창)을 본다.
test('organization detail retains the existing shared inbox save payload and failure draft',async({page})=>{
 await openHome(page);await page.evaluate(async()=>{await KPTUViewLoader.load('team');await KPTUWorkplace.open('o');});await expect(page.locator('#wdModal')).toBeVisible();
 const bodies=[];let fail=true;await page.route(SB+'/rest/v1/app_suborganization_updates',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({status:fail?500:200,json:fail?{message:'QA error'}:[]});});
 await page.locator('#wdInboxText').fill('첫 줄\n둘째 줄');await page.locator('#wdInboxSave').click();await expect(page.locator('#wdInboxState')).toContainText('QA error');await expect(page.locator('#wdInboxText')).toHaveValue('첫 줄\n둘째 줄');
 fail=false;await page.locator('#wdInboxSave').click();await expect(page.locator('#wdInboxText')).toHaveValue('');expect(bodies[1]).toEqual({organization_id:'o',raw_text:'첫 줄\n둘째 줄',created_by:'home-test'});
});
test('task screen saveEditor retains shared create title notes due and links',async({page})=>{
 await openHome(page);const bodies=[];await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{const body=r.request().postDataJSON();bodies.push(body);return r.fulfill({json:{ok:true,task:{id:'new',title:body.title,notes:body.notes,due:body.due,taskListId:'@default',status:'needsAction'},links:body.links.map(t=>({...t,google_task_id:'new',status:'confirmed'})),meeting_links:[]}});});
 await page.locator('#homeView [data-journal-tasks-open]').click();await expect(page.locator('#gtTaskSection')).toBeVisible();await page.waitForFunction(()=>window.KPTUGoogleTasks?.openEditor);await page.evaluate(()=>window.KPTUGoogleTasks.openEditor());await expect(page.locator('#gtTaskModal')).toBeVisible();
 await page.locator('#gtEditTitle').fill('QA');await page.locator('#gtEditNotes').fill('QA notes');await page.locator('#gtEditDue').fill('2026-10-09');await toggleKeys(page,'#gtEditLinkBody','area',['p:child']);await page.locator('#gtSaveBtn').click();
 await expect(page.locator('#gtTaskModal')).toBeHidden();expect(bodies[0]).toMatchObject({title:'QA',notes:'QA notes',due:'2026-10-09',links:[{project_id:'child'}]});
});
