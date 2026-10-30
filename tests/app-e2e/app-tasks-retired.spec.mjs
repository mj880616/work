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
    if(view==='home'){
      await page.waitForFunction(()=>!!window.KPTUJournal&&!!document.querySelector('#homeView .home-quick[data-home-quick]'));
      // HOME-업무일지홈: 홈 = 업무일지. 옛 홈 '이번 주 업데이트'·'연결 안 된 할 일' 칸은 없고, 할 일은 홈 할 일 칸에 있다.
      // (업무일지는 그날 주간보고 재료로 조직 기록을 읽는다 — 옛 홈의 '조직 기록을 읽지 않음' 조건은 이 화면에 해당하지 않는다.)
      await expect(page.locator('[data-home-card],[data-home-unlinked]')).toHaveCount(0);
      await expect(page.locator('#homeView [data-journal-group="todo"]')).toContainText('오늘 항목');
    }
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
