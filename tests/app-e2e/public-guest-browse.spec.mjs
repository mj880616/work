import {test,expect} from '@playwright/test';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
async function mock(page){
  const base={workspace:{id:'w1',slug:'kptu-work',name:'공공운수노조 업무 협업'},events:[{id:'e1',title:'공동 일정',event_type:'meeting',start_at:new Date(Date.now()+86400000).toISOString(),location:'서울',calendar_scope:'team'}],tasks:[{id:'t1',title:'공개 할 일',status:'todo',priority:'normal',assignee_name:'김명진'}],meetings:[{id:'m1',title:'회의 결과',meeting_at:new Date().toISOString(),notes:'논의',decisions:'결정',result_status:'final'}],documents:[{id:'d1',title:'정책자료',category:'정책',source:'공공운수노조'}],pages:[{id:'p1',title:'공개 페이지',summary:'요약',body:'본문',status:'published'}],suborganizations:[{id:'o1',name:'철도노조',active:true,default_assignee_name:'김명진',organization_type:'철도·도시철도'}],suborganization_updates:[]};
  const projects={spaces:[{id:'s1',name:'인력확충 투쟁',description:'사업 설명',status:'active'}],project_updates:[{id:'u1',project_id:'s1',body:'진행 상황',kind:'update',created_at:new Date().toISOString()}],milestones:[]};
  const facets={assignees:[{organization_id:'o1',name:'김명진'}],affiliations:[{organization_id:'o1',kind:'council',name:'철도지하철협의회'}]};
  await page.route(`${SB}/**`,async route=>{const p=new URL(route.request().url()).pathname;const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});if(p.endsWith('/rpc/app_public_workspace_snapshot'))return ok(base);if(p.endsWith('/rpc/app_public_projects_snapshot'))return ok(projects);if(p.endsWith('/rpc/app_public_suborganization_facets'))return ok(facets);if(p==='/auth/v1/user')return route.fulfill({status:401,contentType:'application/json',body:'{}'});return ok([])});
}
test('비로그인 사용자는 업무를 열람하고 작성 버튼에서 로그인으로 이동한다',async({page})=>{
  await page.setViewportSize({width:390,height:844});await mock(page);await page.goto('http://127.0.0.1:8123/app/');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});await expect(page.locator('#userBadge')).toContainText('게스트');
  await expect(page.locator('#projectGrid')).toContainText('인력확충 투쟁');await expect(page.locator('#meetingList')).toContainText('회의 결과');
  await page.locator('.app-nav [data-view="team"]').click();await expect(page.locator('#guestOrgGrid')).toContainText('철도노조');await expect(page.locator('#guestOrgCouncil')).toContainText('철도지하철협의회');
  await page.locator('.app-nav [data-view="calendar"]').click();await page.locator('#newEventBtn').click();await expect(page.locator('#authView')).toBeVisible();await expect(page.locator('#guestBackBtn')).toBeVisible();
});