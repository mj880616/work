import {test,expect} from '@playwright/test';
import {fillDateTime} from './helpers/date-time.mjs';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

// ORG-사본자동갱신: 사본에 들어가는 것을 저장하면 3분 묶어 drive-summary를 한 번만 부른다. 화면 표시는 없다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const WAIT=3*60*1000;
const success={ok:true,updated_at:'2026-10-21T04:17:00Z',documents:{org:'https://docs.google.com/document/d/mock-org/edit',project:'https://docs.google.com/document/d/mock-project/edit'}};

async function fixture(page,{role='owner',summaryStatus=200,saveStatus=200}={}){
  const calls=[],errors=[];
  page.on('console',msg=>{if(msg.type()==='error'&&!msg.text().startsWith('Failed to load resource:'))errors.push(msg.text())});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(`${SB}/**`,route=>{
    const req=route.request();
    if(new URL(req.url()).pathname==='/functions/v1/drive-summary'){
      calls.push({method:req.method(),body:req.postData(),auth:req.headers().authorization});
      return route.fulfill({status:summaryStatus,contentType:'application/json',body:JSON.stringify(summaryStatus===200?success:{ok:false,error:'DRIVE_UPLOAD_FAILED'})});
    }
    return route.fulfill({status:saveStatus,contentType:'application/json',body:JSON.stringify(saveStatus===200?[{id:'mock-row'}]:{message:'mock save failed'})});
  });
  await page.clock.install();
  await page.goto(`${testOrigin}/tests/app-e2e/drive-summary-refresh-fixture.html`);
  await page.waitForFunction(()=>!!window.KPTUDriveSummary);
  await page.evaluate(role=>{
    const user={id:'mock-owner'};
    window.KPTURuntime.session.write({user,access_token:'mock-access',expires_at:Math.floor(Date.now()/1000)+3600});
    window.KPTURuntime.context.set({user,workspace:{id:'mock-workspace',slug:'kptu-work'},membership:{role,workspace_id:'mock-workspace'}});
  },role);
  return {calls,errors};
}
const save=(page,table='app_suborganization_updates',body={raw_text:'mock record'},method='POST')=>page.evaluate(({table,body,method})=>window.KPTURuntime.api('/rest/v1/'+table,{method,body}),{table,body,method});

test('one save calls drive-summary once, three minutes later, with no body',async({page})=>{
  const {calls,errors}=await fixture(page);
  await save(page);
  await page.clock.fastForward(WAIT-1000);expect(calls).toHaveLength(0);
  await page.clock.fastForward(1000);await expect.poll(()=>calls.length).toBe(1);
  expect(calls[0]).toEqual({method:'POST',body:null,auth:'Bearer mock-access'});
  await page.clock.fastForward(WAIT*4);expect(calls).toHaveLength(1);
  await expect(page.locator('body')).toHaveText('');expect(errors).toEqual([]);
});
test('several saves within a few minutes become one call',async({page})=>{
  const {calls}=await fixture(page);
  await save(page);await page.clock.fastForward(60000);
  await save(page,'app_project_progress_updates',{summary:'mock progress'});await page.clock.fastForward(60000);
  await save(page,'app_meetings',{title:'mock meeting'},'PATCH');await page.clock.fastForward(WAIT-1000);
  expect(calls).toHaveLength(0);
  await page.clock.fastForward(1000);await expect.poll(()=>calls.length).toBe(1);
  await page.clock.fastForward(WAIT*4);expect(calls).toHaveLength(1);
});
test('leaving the page sends the waiting refresh at once',async({page})=>{
  const {calls}=await fixture(page);
  await save(page);await page.clock.fastForward(10000);expect(calls).toHaveLength(0);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'))});
  await expect.poll(()=>calls.length).toBe(1);expect(calls[0].auth).toBe('Bearer mock-access');
  await page.clock.fastForward(WAIT*4);expect(calls).toHaveLength(1);
});
for(const status of [401,502])test(`refresh failure ${status} stays silent and keeps the session`,async({page})=>{
  const {calls,errors}=await fixture(page,{summaryStatus:status});
  await save(page);await page.clock.fastForward(WAIT);await expect.poll(()=>calls.length).toBe(1);
  expect(await page.evaluate(()=>!!window.KPTURuntime.session.read())).toBe(true);
  await expect(page.locator('body')).toHaveText('');expect(errors).toEqual([]);
});
for(const role of ['admin','viewer'])test(`non-owner ${role} save makes no call`,async({page})=>{
  const {calls}=await fixture(page,{role});await save(page);await page.clock.fastForward(WAIT*4);expect(calls).toHaveLength(0);
});
test('failed save and unrelated save make no call',async({page})=>{
  const {calls}=await fixture(page,{saveStatus:403});
  await save(page).catch(()=>{});await page.clock.fastForward(WAIT*2);expect(calls).toHaveLength(0);
  await page.unroute(`${SB}/**`);
  await page.route(`${SB}/**`,route=>{if(new URL(route.request().url()).pathname==='/functions/v1/drive-summary')calls.push(1);return route.fulfill({status:200,contentType:'application/json',body:'[{"id":"x"}]'})});
  await save(page,'app_profiles',{display_name:'mock'},'PATCH');await save(page,'app_suborganizations',{year_summary:'mock'},'PATCH');
  await page.clock.fastForward(WAIT*2);expect(calls).toHaveLength(0);
});
test('logout before the wait ends drops the refresh',async({page})=>{
  const {calls}=await fixture(page);
  await save(page);await page.evaluate(()=>window.KPTURuntime.session.write(null));
  await page.clock.fastForward(WAIT*2);expect(calls).toHaveLength(0);
});

// 실제 앱: 회의를 저장하면 몇 분 뒤 한 번만 부르고, 화면 어디에도 사본 표시가 생기지 않는다.
const user={id:'refresh-owner',email:'refresh-owner@example.org',user_metadata:{display_name:'Refresh QA'}};
const workspace={id:'refresh-workspace',slug:'kptu-work',name:'웹2'};
for(const [name,width] of [['PC',1280],['phone',390]])test(`app meeting save refreshes the Drive copy once after a few minutes (${name})`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:900});
  let calls=0;const meetings=[];
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/functions/v1/drive-summary'){calls++;return ok(success)}
    if(path==='/auth/v1/token')return ok({access_token:'refresh-access',refresh_token:'refresh-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:'all',tasks:[],links:[]});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_meetings'){if(req.method()==='POST'){meetings.push({...req.postDataJSON(),id:'mock-meeting'});return ok([meetings.at(-1)])}return ok(meetings)}
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
  await page.clock.install();
  await page.goto(testOrigin+'/app/?view=meetings');
  await enterLogin(page);
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await expect(page.locator('#meetingsView')).toBeVisible({timeout:15000});
  await page.locator('#newMeetingBtn').click();
  if(await page.locator('#meetingNameSelect').isVisible())await page.locator('#meetingNameSelect').selectOption('__other__');
  await page.locator('#meetingTitle').fill('Mock meeting');
  await fillDateTime(page,'#meetingAt','2026-10-21T12:30');
  await page.locator('#meetingTranscript').fill('Mock transcript');
  await page.locator('#saveMeetingBtn').click();
  await expect(page.locator('#toast')).toContainText('회의 결과를 저장했습니다.');
  await page.clock.fastForward(WAIT-5000);expect(calls).toBe(0);
  await page.clock.fastForward(5000);await expect.poll(()=>calls).toBe(1);
  await page.clock.fastForward(WAIT*4);expect(calls).toBe(1);
  await expect(page.locator('[data-drive-summary-refresh],[data-drive-summary-status],[data-account-drive-slot],.drive-summary-time,.drive-summary-links')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('사본');
});
