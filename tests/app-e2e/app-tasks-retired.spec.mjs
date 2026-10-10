import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';

for(const width of [390,1280])for(const view of ['home','tasks','team']){
  test(`authenticated ${view} keeps its data without legacy task requests or console errors ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    const {requests}=await openHome(page,{query:`?view=${view}`});
    await expect(page.locator(`#${view}View`)).toBeVisible();
    if(view==='home')await expect(page.locator('[data-home-card="updates"]')).toContainText('이번 주 테스트 기록');
    if(view==='tasks')await expect(page.locator('#gtTaskBody')).toContainText('오늘 항목');
    if(view==='team')await expect(page.locator('#soOrganizationList')).toContainText('테스트 조직');
    // Exercise the retained full-data entry point as well as normal route loading.
    // This checks the Promise.all positions after the old task query is removed.
    const data=await page.evaluate(async()=>{
      await window.__KPTU_START_TEAM_DATA__();
      return {
        projects:window.KPTUTeamData.spaces().map(row=>row.id),
        meetings:window.KPTUTeamData.meetings().map(row=>row.id),
        documents:window.KPTUTeamData.documents()
      };
    });
    expect(data).toEqual({projects:['p','child'],meetings:['m'],documents:[]});
    expect(requests.filter(request=>request.path==='/rest/v1/app_tasks')).toEqual([]);
    expect(errors).toEqual([]);
  });
}
