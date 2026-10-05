import {test,expect} from '@playwright/test';

test.use({timezoneId:'UTC'});

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const success={ok:true,updated_at:'2026-10-03T04:06:00Z',documents:{org:'https://docs.google.com/document/d/mock-org/edit',project:'https://docs.google.com/document/d/mock-project/edit'}};

async function setup(page,{role='owner',reply=success,status=200,hold=false,saveStatus=200}={}){
  const calls=[],errors=[];let release;
  const gate=new Promise(resolve=>release=resolve);
  page.on('console',msg=>{if(msg.type()==='error'&&!msg.text().startsWith('Failed to load resource:'))errors.push(msg.text())});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(`${SB}/**`,async route=>{
    if(new URL(route.request().url()).pathname==='/functions/v1/drive-summary'){
      calls.push({method:route.request().method(),body:route.request().postData(),auth:route.request().headers().authorization});
      if(hold&&calls.length===1)await gate;
      return route.fulfill({status,contentType:'application/json',body:JSON.stringify(reply)});
    }
    return route.fulfill({status:saveStatus,contentType:'application/json',body:JSON.stringify(saveStatus===200?[{id:'mock-row'}]:{message:'mock save failed'})});
  });
  await page.goto(`${BASE}/tests/app-e2e/drive-summary-fixture.html`);
  await page.evaluate(role=>{
    const user={id:'mock-owner'};
    window.KPTURuntime.session.write({user,access_token:'mock-access',expires_at:Math.floor(Date.now()/1000)+3600});
    window.KPTURuntime.context.set({user,workspace:{id:'mock-workspace',slug:'kptu-work'},membership:{role,workspace_id:'mock-workspace'}});
    window.dispatchEvent(new CustomEvent('kptu:team-ready',{detail:{state:'workspace'}}));
  },role);
  await page.clock.install();
  return {calls,errors,release};
}
async function save(page,table='app_suborganization_updates',body={raw_text:'mock record'},method='POST'){
  return page.evaluate(async({table,body,method})=>{
    await window.KPTURuntime.api('/rest/v1/'+table,{method,body});
    document.querySelector('#saveStatus').textContent='저장했습니다.';
  },{table,body,method});
}
async function expectSingleLine(locator){
  // Refresh replaces the timestamp; resolve the locator again on every attempt.
  await expect(async()=>{
    await expect(locator).toBeVisible();
    const layout=await locator.evaluate(el=>{
      const parentElement=el.parentElement;
      if(!el.isConnected||!parentElement)return null;
      const range=document.createRange();range.selectNodeContents(el);
      const lines=[...range.getClientRects()].filter(rect=>rect.width>0);
      const box=el.getBoundingClientRect(),parent=parentElement.getBoundingClientRect();
      return {lines:lines.length,left:Math.min(...lines.map(rect=>rect.left)),right:Math.max(...lines.map(rect=>rect.right)),boxLeft:box.left,boxRight:box.right,parentLeft:parent.left,parentRight:parent.right};
    });
    expect(layout,'the measured element must still be attached').not.toBeNull();
    expect(layout.lines).toBe(1);expect(layout.left).toBeGreaterThanOrEqual(layout.boxLeft);expect(layout.right).toBeLessThanOrEqual(layout.boxRight);
    expect(layout.left).toBeGreaterThanOrEqual(layout.parentLeft);expect(layout.right).toBeLessThanOrEqual(layout.parentRight);
  }).toPass({timeout:5000});
}

for(const [updated_at,expected] of [
  ['2026-01-01T15:05:09Z','갱신 1/2 00:05'],
  ['2026-10-03T14:59:59Z','갱신 10/3 23:59'],
  ['2026-10-03T15:00:00Z','갱신 10/4 00:00']
])test(`timestamp uses Seoul date and 24-hour time for ${updated_at}`,async({page})=>{
  await setup(page,{reply:{...success,updated_at}});await manual(page);
  await expect(page.locator('.drive-summary-time')).toHaveText(expected);
});

async function manual(page){if(!await page.locator('.account-panel').evaluate(el=>el.matches(':popover-open')))await page.locator('[data-account-open]').click();await page.getByRole('button',{name:'Drive 사본 지금 갱신'}).click()}

test('one successful save waits four seconds and posts without a body',async({page})=>{
  const {calls}=await setup(page);await save(page);await page.clock.fastForward(3999);expect(calls).toHaveLength(0);
  await page.clock.fastForward(1);await expect.poll(()=>calls.length).toBe(1);
  expect(calls[0]).toEqual({method:'POST',body:null,auth:'Bearer mock-access'});
});
test('a burst of successful saves is debounced into one call',async({page})=>{
  const {calls}=await setup(page);await save(page);await page.clock.fastForward(3000);await save(page,'app_project_workstreams',{phase:'done'});
  await page.clock.fastForward(3000);expect(calls).toHaveLength(0);await save(page,'app_meetings',{title:'mock meeting'});
  await page.clock.fastForward(4000);await expect.poll(()=>calls.length).toBe(1);await page.clock.fastForward(5000);expect(calls).toHaveLength(1);
});
test('saves during a request queue exactly one subsequent call',async({page})=>{
  const {calls,release}=await setup(page,{hold:true});await save(page);await page.clock.fastForward(4000);await expect.poll(()=>calls.length).toBe(1);
  await save(page);await save(page);await page.clock.fastForward(6000);expect(calls).toHaveLength(1);release();
  await expect.poll(()=>calls.length).toBe(2);await expect(page.locator('[data-drive-summary-status]').first()).toContainText('갱신 10/3 13:06');
  await page.clock.fastForward(5000);expect(calls).toHaveLength(2);
});
for(const status of [401,403,502])test(`summary failure ${status} preserves save success and session without console errors`,async({page})=>{
  const {calls,errors}=await setup(page,{status,reply:{ok:false,error:'DRIVE_UPLOAD_FAILED'}});await save(page);await page.clock.fastForward(4000);
  await expect.poll(()=>calls.length).toBe(1);await expect(page.locator('[data-drive-summary-refresh]').first()).toBeEnabled();
  await expect(page.locator('#saveStatus')).toHaveText('저장했습니다.');expect(await page.evaluate(()=>!!window.KPTURuntime.session.read())).toBe(true);expect(errors).toEqual([]);
  await expect(page.locator('[data-drive-summary-status]').first()).toBeEmpty();
});
for(const role of ['admin','viewer',null])test(`non-owner ${role} has no automatic calls or button`,async({page})=>{
  const {calls}=await setup(page,{role});await save(page);await page.clock.fastForward(5000);expect(calls).toHaveLength(0);
  await expect(page.getByRole('button',{name:'Drive 사본 지금 갱신',includeHidden:true})).toHaveCount(0);
});
test('manual refresh locks repeated clicks and shows timestamp and two links',async({page})=>{
  const {calls,release}=await setup(page,{hold:true});await manual(page);await expect.poll(()=>calls.length).toBe(1);
  const button=page.getByRole('button',{name:'Drive 사본 지금 갱신'});await expect(button).toHaveText('갱신 중…');await expect(button).toBeDisabled();await button.evaluate(el=>el.click());expect(calls).toHaveLength(1);release();
  await expect(page.locator('[data-drive-summary-status]')).toContainText('갱신 10/3 13:06');await expect(page.locator('[data-drive-summary-status]')).toHaveText('갱신 10/3 13:06조직 · 프로젝트');
  await expect(page.getByRole('link',{name:'조직'})).toHaveAttribute('href',success.documents.org);
  await expect(page.getByRole('link',{name:'프로젝트'})).toHaveAttribute('href',success.documents.project);
});
test('manual failure displays only the safe stage code',async({page})=>{
  await setup(page,{status:502,reply:{ok:false,error:'DRIVE_PERMISSION_CHECK_FAILED',documents:success.documents,private_detail:'never render'}});await manual(page);
  await expect(page.locator('[data-drive-summary-status]')).toHaveText('DRIVE_PERMISSION_CHECK_FAILED');await expect(page.getByRole('link')).toHaveCount(0);
});
test('manual refresh replaces a pending automatic refresh',async({page})=>{
  const {calls}=await setup(page);await save(page);await manual(page);await expect(page.locator('[data-drive-summary-status]')).toContainText('갱신 10/3 13:06');
  await page.clock.fastForward(5000);expect(calls).toHaveLength(1);
});
test('failed source save never schedules a refresh',async({page})=>{
  const {calls}=await setup(page,{saveStatus:403});await save(page).catch(()=>{});await page.clock.fastForward(5000);expect(calls).toHaveLength(0);
});
test('logout drops pending automatic refresh and prevents stale response rendering',async({page})=>{
  const {calls,release}=await setup(page,{hold:true});await manual(page);await expect.poll(()=>calls.length).toBe(1);await save(page);
  await page.evaluate(()=>window.KPTURuntime.session.write(null));release();await page.clock.fastForward(5000);
  expect(calls).toHaveLength(1);await expect(page.locator('[data-drive-summary-status]')).toHaveCount(0);
});
const excluded=[['app_project_comments',{body:'mock memo'}],['app_suborganization_timeline',{title:'mock history'}],['app_suborganizations',{year_summary:'mock year'}],['app_meetings',{transcript_text:'mock transcript',notes:'mock notes'}],['app_profiles',{display_name:'mock profile'}],['app_project_blocks',{content:{text:'mock block'}}]];
for(const [table,body] of excluded)test(`unrelated ${table} save makes no call`,async({page})=>{
  const {calls}=await setup(page);await save(page,table,body,'PATCH');await page.clock.fastForward(5000);expect(calls).toHaveLength(0);
});
const included=[['app_suborganization_updates',null,'DELETE'],['app_suborganizations',{recent_month_summary:'mock summary'},'PATCH'],['app_spaces',{status:'done'},'PATCH'],['app_project_progress_updates',{summary:'mock progress'},'POST'],['app_project_milestones',{title:'mock milestone',start_at:'2026-10-04'},'PATCH'],['app_meetings',{round_no:2,project_id:null},'PATCH'],['app_record_links',{project_id:'mock-project',task_completed:false,status:'confirmed'},'POST'],['app_documents',{project_id:'mock-project'},'PATCH']];
for(const [table,body,method] of included)test(`summary-changing ${table} ${method} refreshes`,async({page})=>{
  const {calls}=await setup(page);await save(page,table,body,method);await page.clock.fastForward(4000);await expect.poll(()=>calls.length).toBe(1);
});
for(const [action,linked,expected] of [['create',true,1],['create',false,0],['link',true,1],['unlink',true,1],['unlink',false,0],['toggle',false,1],['delete',false,1],['update',false,1]])test(`Google task ${action} with project links ${linked} makes ${expected} refresh`,async({page})=>{
  const {calls}=await setup(page);
  await page.evaluate(async({action,linked})=>window.KPTURuntime.api('/functions/v1/google-tasks?action='+action,{method:'POST',body:{action,links:linked?[{project_id:'mock-project'}]:[]}}),{action,linked});
  await page.clock.fastForward(4000);if(expected)await expect.poll(()=>calls.length).toBe(expected);else expect(calls).toHaveLength(0);
});
for(const linked of [true,false])test(`file upload with project ${linked} makes ${linked?1:0} refresh`,async({page})=>{
  const {calls}=await setup(page);
  await page.evaluate(async linked=>{const body=new FormData();body.append('file',new Blob(['mock file']),'mock.txt');if(linked)body.append('project_id','mock-project');await window.KPTURuntime.api('/functions/v1/library-files',{method:'POST',body})},linked);
  await page.clock.fastForward(4000);if(linked)await expect.poll(()=>calls.length).toBe(1);else expect(calls).toHaveLength(0);
});
test('project document deletion event refreshes, unrelated document deletion does not',async({page})=>{
  const {calls}=await setup(page);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:null}})));await page.clock.fastForward(4000);expect(calls).toHaveLength(0);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:documents-changed',{detail:{project_id:'mock-project'}})));await page.clock.fastForward(4000);await expect.poll(()=>calls.length).toBe(1);
});
test('untrusted failure text and invalid document URLs are never shown',async({page})=>{
  await setup(page,{status:502,reply:{error:'mock private upstream detail'}});await manual(page);await expect(page.locator('[data-drive-summary-status]')).toHaveText('SUMMARY_FAILED');
});
test('invalid successful document URLs display no links',async({page})=>{
  await setup(page,{reply:{...success,documents:{org:'javascript:alert(1)',project:success.documents.project}}});await manual(page);await expect(page.locator('[data-drive-summary-status]')).toHaveText('SUMMARY_FAILED');await expect(page.getByRole('link')).toHaveCount(0);
});
test('unlinked URL document creation does not refresh',async({page})=>{
  const {calls}=await setup(page);await save(page,'app_documents',{title:'mock document',project_id:null});await page.clock.fastForward(4000);await expect(page.locator('[data-drive-summary-refresh]')).toHaveAttribute('aria-busy','false');expect(calls).toHaveLength(0);
});
test('a summary response delayed beyond fifteen seconds remains locked and succeeds',async({page})=>{
  const {calls,release}=await setup(page,{hold:true});await manual(page);await expect.poll(()=>calls.length).toBe(1);await page.clock.fastForward(20000);
  const button=page.getByRole('button',{name:'Drive 사본 지금 갱신'});await expect(button).toHaveText('갱신 중…');await expect(button).toBeDisabled();expect(calls).toHaveLength(1);release();await expect(page.locator('[data-drive-summary-status]')).toContainText('갱신 10/3 13:06');
});
test('meeting attachment inherits its project from the successful server response',async({page})=>{
  const {calls}=await setup(page);
  await page.route(`${SB}/functions/v1/meeting-files`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({document:{id:'mock-document',project_id:'mock-project'}})}));
  await page.evaluate(async()=>{const body=new FormData();body.append('file',new Blob(['mock file']),'mock.txt');body.append('meeting_id','mock-meeting');await window.KPTURuntime.api('/functions/v1/meeting-files',{method:'POST',body})});
  await page.clock.fastForward(4000);await expect.poll(()=>calls.length).toBe(1);
});
for(const [width,height,lateUpload] of [[1280,900,false],[390,844,false],[1280,900,true]])test(`actual app meeting save and account menu work at ${width}px with late attachment ${lateUpload}`,async({page})=>{
  await page.setViewportSize({width,height});let calls=0;const meetings=[];
  let releaseUpload,uploadStarted=false;const uploadGate=new Promise(resolve=>releaseUpload=resolve);
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(path==='/functions/v1/drive-summary'){calls++;return ok(success)}
    if(path==='/functions/v1/meeting-files'){uploadStarted=true;await uploadGate;return ok({document:{id:'mock-document',project_id:'mock-project'}})}
    if(path==='/auth/v1/user')return ok({id:'mock-owner'});
    if(path==='/rest/v1/app_workspace_members')return ok([{user_id:'mock-owner',role:'owner',workspace_id:'mock-workspace',workspace:{id:'mock-workspace',slug:'kptu-work',name:'Mock workspace'}}]);
    if(path==='/rest/v1/app_meetings'){
      if(req.method()==='POST'){meetings.push({...req.postDataJSON(),id:'mock-meeting'});return ok([meetings.at(-1)])}return ok(meetings);
    }
    if(path==='/rest/v1/app_spaces')return ok([{id:'mock-project',workspace_id:'mock-workspace',owner_id:'mock-owner',name:'Mock project',status:'active',metadata:{project_system:'v2',management_version:2}}]);
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],links:[],connected:true});
    return ok([]);
  });
  await page.goto(`${BASE}/tests/app-e2e/runtime-client-fixture.html`);
  await page.evaluate(()=>window.KPTURuntime.session.write({user:{id:'mock-owner'},access_token:'mock-access',expires_at:Math.floor(Date.now()/1000)+3600}));
  await page.goto(`${BASE}/app/?view=meetings`);await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await page.clock.install();await page.locator('#newMeetingBtn').click();
  if(await page.locator('#meetingNameSelect').isVisible())await page.locator('#meetingNameSelect').selectOption('__other__');await page.locator('#meetingTitle').fill('Mock meeting');
  await page.locator('#meetingAt').fill('2026-10-03T12:30');await page.locator('#meetingTranscript').fill('Mock transcript');
  if(lateUpload){await page.locator('#meetingProject').selectOption('mock-project');await page.locator('#meetingFiles').setInputFiles({name:'mock.txt',mimeType:'text/plain',buffer:Buffer.from('mock file')})}
  await page.locator('#saveMeetingBtn').click();
  if(lateUpload){await expect.poll(()=>uploadStarted).toBe(true);await page.clock.fastForward(4000);await expect.poll(()=>calls).toBe(1);await expect(page.locator('[data-drive-summary-refresh]').first()).toBeEnabled();releaseUpload()}
  await expect(page.locator('#toast')).toContainText(lateUpload?'회의 결과와 자료 1개를 저장했습니다.':'회의 결과를 저장했습니다.');await page.clock.fastForward(4000);await expect.poll(()=>calls).toBe(lateUpload?2:1);
  const menu=page.locator('#sidebarAccountPanel');
  await page.locator('#appView>.app-nav [data-account-open]').click();const button=menu.locator('[data-drive-summary-refresh]');await expect(button).toBeVisible();
  const box=await button.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
  expect(await menu.locator('button').allTextContents()).toEqual(['화면 색','사본 갱신','로그아웃']);
  await expect(button).toHaveText('사본 갱신');
  await expect(button).toHaveAttribute('aria-label','Drive 사본 지금 갱신');
  await expect(button).toHaveAttribute('title','Drive 사본 지금 갱신');
  await expectSingleLine(button);
  await button.click();await expect(menu.locator('[data-drive-summary-status]')).toContainText('갱신 10/3 13:06');expect(calls).toBe(lateUpload?3:2);
  await expectSingleLine(menu.locator('.drive-summary-time'));
  await expect.poll(()=>menu.evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight-11)).toBe(true);
  const links=menu.getByRole('link');await expect(links).toHaveCount(2);
  for(const [i,kind] of ['org','project'].entries()){
    await expect(links.nth(i)).toHaveAttribute('href',success.documents[kind]);
    await expect(links.nth(i)).toHaveAttribute('target','_blank');
    await expect(links.nth(i)).toHaveAttribute('rel','noopener noreferrer');
  }
  const orgBox=await links.nth(0).boundingBox(),projectBox=await links.nth(1).boundingBox();
  expect(orgBox.y).toBe(projectBox.y);expect(projectBox.x).toBeGreaterThan(orgBox.x+orgBox.width);
  await page.route(`${SB}/functions/v1/drive-summary`,route=>route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'DRIVE_PERMISSION_CHECK_FAILED'})}));
  await button.click();const status=menu.locator('[data-drive-summary-status]');
  await expect(status).toHaveText('DRIVE_PERMISSION_CHECK_FAILED');
  const layout=await status.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,wordBreak:getComputedStyle(el).wordBreak}));
  expect(layout.wordBreak).toBe('keep-all');expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
});
