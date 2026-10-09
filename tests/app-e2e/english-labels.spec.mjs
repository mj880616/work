import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const labels={library:['newDocumentBtn','+ 자료','+ 자료 등록'],meetings:['newMeetingBtn','+ 회의','+ 회의 결과'],projects:['newProjectBtn','+ 프로젝트','+ 프로젝트']};
async function boot(page,view){
  await page.route('**/*',route=>{
    const u=new URL(route.request().url()),p=u.pathname;
    if(u.origin===BASE)return route.continue();
    if(u.hostname!=='xmlkxfjeagycwttklxjw.supabase.co')return route.abort();
    const user={id:'label-user',email:'labels@example.invalid',user_metadata:{display_name:'QA'}};
    const workspace={id:'label-workspace',name:'QA'};
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(p==='/auth/v1/token')return ok({access_token:'fixture',refresh_token:'fixture',expires_at:4102444800,user});
    if(p==='/auth/v1/user')return ok(user);
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',workspace}]);
    if(p==='/rest/v1/app_workspaces')return ok([workspace]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'QA'}]);
    if(p==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,events:[],calendars:[]});
    if(p==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,tasks:[],pending_scope:'all'});
    if(p.startsWith('/rest/v1/rpc/'))return ok(null);
    return ok([]);
  });
  await page.goto(loginEntry(`${BASE}/app/?view=${view}`));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('labels@example.invalid');
  await page.locator('#authPassword').fill('fixture-password');
  await page.locator('#authSubmit').click();
  await ready(page,view);
}
async function ready(page,view){
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(page.locator(`#${view}View`)).toBeVisible();
  await expect.poll(()=>page.evaluate(v=>window.KPTUViewLoader.isLoaded(v),view)).toBe(true);
}
async function checkLabels(page,width){
  for(const [id,short,long] of Object.values(labels))await expect(page.locator('#'+id)).toHaveText(width<=760?short:long);
  // Retired controls stay absent, including on the Web1-backed board.
  for(const id of ['newPageBtn','inviteBtn','newGroupBtn'])await expect(page.locator('#'+id)).toHaveCount(0);
}
for(const width of [390,760,761,1280])for(const view of ['library','meetings','pages','projects'])test(`labels depend only on width ${width}, direct/refresh/calendar/home -> ${view}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await boot(page,view);await checkLabels(page,width);
  await page.reload();await ready(page,view);await checkLabels(page,width);
  for(const via of ['calendar','home']){
    await clickView(page,via);await ready(page,via);
    await clickView(page,view);await ready(page,view);await checkLabels(page,width);
  }
  for(const resized of [width<=760?1280:390,width]){
    await page.setViewportSize({width:resized,height:900});await checkLabels(page,resized);
  }
});
for(const width of [390,1280])test(`active modal titles survive eyebrow removal at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await boot(page,'library');
  await page.evaluate(()=>window.KPTUDeferredFeatures.load());
  for(const [id,title] of [
    ['documentModal','자료 등록'],['meetingModal','회의 결과'],
    ['libraryManageModal','자료 분류 수정'],['libraryEditModal','자료 정보 수정'],
    ['meetingRoundDetailModal','회의 결과'],['ps3CreateModal','프로젝트 만들기'],
    ['ps3DeleteModal','프로젝트 삭제'],['ps3ArchiveModal','보관한 프로젝트'],
    ['soEditModal','담당조직 추가'],['soAssignModal','담당자 지정'],['wdAffModal','협의회·사업단 소속']
  ]){
    const modal=page.locator('#'+id);
    await expect(modal.locator('.eyebrow')).toHaveCount(0);
    await expect(modal.locator('h2').first()).toHaveText(title);
    expect(await modal.locator('.modal-head>div').first().evaluate(el=>el.firstElementChild.tagName)).toBe('H2');
  }
  await page.locator('#newDocumentBtn').click();await expect(page.locator('#documentModal')).toBeVisible();
  await page.locator('#documentModal [data-close]').click();
  await clickView(page,'meetings');await ready(page,'meetings');
  await page.locator('#newMeetingBtn').click();await expect(page.locator('#meetingModal')).toBeVisible();
  expect(await page.locator('#appView,.modal').evaluateAll(nodes=>nodes.flatMap(n=>[...n.querySelectorAll('.eyebrow')].map(e=>e.textContent)).filter(t=>/[A-Z]{2}/.test(t)))).toEqual([]);
});

test("login has its title without an English eyebrow",async({page})=>{
  await page.goto(BASE+"/app/login/");
  await expect(page.locator(".auth-card .eyebrow")).toHaveCount(0);
  await expect(page.locator(".auth-card h1")).toHaveText("Workspace 로그인");
});

test('all remaining label entries use the same width rule when their controls exist',async({page})=>{
  const entries=Object.values(labels);
  await page.route(BASE+'/label-fixture',route=>route.fulfill({contentType:'text/html',body:entries.map(([id])=>`<button id="${id}">fixture</button>`).join('')}));
  await page.setViewportSize({width:390,height:900});await page.goto(BASE+'/label-fixture');
  await page.evaluate(()=>import('/app/action-labels.js?v=2'));
  for(const width of [390,760,761,1280,390]){
    await page.setViewportSize({width,height:900});
    for(const [id,short,long] of entries)await expect(page.locator('#'+id)).toHaveText(width<=760?short:long);
  }
});
