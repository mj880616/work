import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'a11y-user',email:'a11y@example.org',user_metadata:{display_name:'접근성 QA'}};
const workspace={id:'a11y-workspace',slug:'a11y',name:'공공기관사업팀 Workspace'};
const tasks=[{id:'a11y-task-1',workspace_id:workspace.id,title:'접근성 점검 할 일',assignee_id:user.id,created_by:user.id,status:'todo',assignment_status:'accepted',priority:'normal',project_id:null,due_at:null,created_at:'2026-09-17T00:00:00Z'}];
const orgs=[{id:'a11y-org-1',workspace_id:workspace.id,name:'철도노조',aliases:['철도'],description:'철도 산하조직',organization_type:'철도·도시철도',default_assignee_name:null,active:true,created_by:user.id}];

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}

async function mockApp(page,{eventSaveGate=null,failEventSave=false,profileSaveGate=null}={}){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request();
    const url=new URL(req.url());
    const path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'a11y-access',refresh_token:'a11y-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar'){
      const action=url.searchParams.get('action'),body=(()=>{try{return req.postDataJSON()}catch{return {}}})();
      if(req.method()==='POST'&&body?.action==='create-event'){if(eventSaveGate)await eventSaveGate;if(failEventSave)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'일정 저장 실패'})});return ok({ok:true,event:{id:'g-new',title:body.title}})}
      if(action==='events')return ok({events:[],eventColors:{}});
      return ok({connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner',backgroundColor:'#4285f4'}],colors:{},events:[],eventColors:{}});
    }
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles'&&req.method()==='PATCH'){
      if(profileSaveGate)await profileSaveGate;
      return ok([]);
    }
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'접근성 QA',job_title:'국장'}]);
    if(path==='/rest/v1/app_tasks')return ok(tasks);
    if(path==='/rest/v1/app_suborganizations')return req.method()==='GET'?ok(orgs):ok([]);
    if(path==='/rest/v1/app_suborganization_assignees')return ok([{organization_id:'a11y-org-1',user_id:user.id,assigned_by:user.id,created_at:'2026-09-17T00:00:00Z'}]);
    if(path==='/rest/v1/app_events'&&req.method()==='POST'){
      if(eventSaveGate)await eventSaveGate;
      if(failEventSave)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'일정 저장 실패'})});
      return ok([{id:'a11y-event-new',workspace_id:workspace.id,title:'접근성 일정',created_by:user.id}]);
    }
    if(path==='/rest/v1/app_spaces')return ok([]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await page.goto(loginEntry(page.url()));
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
}

async function boot(page,viewport,options={}){
  await page.setViewportSize(viewport);
  await mockApp(page,options);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
}

test('active navigation exposes aria-current',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('.app-nav [data-view="tasks"]').click();
  await expect(page.locator('.app-nav [data-view="tasks"]')).toHaveAttribute('aria-current','page');
  await expect(page.locator('.app-nav [data-view="calendar"]')).not.toHaveAttribute('aria-current');
});

test('task grouping, month controls, and destructive task actions expose clear names',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('.app-nav [data-view="tasks"]').click();
  await expect(page.locator('#taskScope')).toHaveCount(0);
  await expect(page.locator('#taskStatus')).toHaveCount(0);
  await expect(page.locator('#taskList [data-tl-section="mine"] .tl-section-head h3')).toHaveText('내 할 일');
  await expect(page.locator('[data-tl-delete="a11y-task-1"]')).toHaveAttribute('aria-label','접근성 점검 할 일 삭제');
  await page.locator('.app-nav [data-view="calendar"]').click();
  await expect(page.locator('.calendar-toolbar')).toHaveAttribute('role','group');
  await expect(page.locator('.calendar-toolbar')).toHaveAttribute('aria-labelledby','monthTitle');
});

test('library toolbar and Web1 board expose accessible navigation',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('.app-nav [data-view="library"]').click();
  await expect(page.locator('label[for="documentSearch"]')).toHaveCount(1);
  await expect(page.locator('label[for="documentProject"]')).toHaveCount(1);
  await page.locator('.app-nav [data-view="pages"]').click();
  await expect(page.locator('#web1BoardActive .w1b-card')).toHaveCount(5);
  await expect(page.locator('#web1BoardActive .w1b-card').first()).toHaveAttribute('data-web1-board-href',/^https:\/\/work\.bokdoong\.com\//);
});

test('project creation dialog exposes semantics, keyboard close, and trigger restore',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('.app-nav [data-view="projects"]').click();
  const trigger=page.locator('#newProjectBtn');
  await trigger.focus();
  await trigger.click();
  const modal=page.locator('#ps3CreateModal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('role','dialog');
  await expect(modal).toHaveAttribute('aria-modal','true');
  const labelledby=await modal.getAttribute('aria-labelledby');
  expect(labelledby).toBeTruthy();
  await expect(page.locator('#'+labelledby)).toBeVisible();
  await expect(page.locator('#ps3CreateName')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveClass(/hidden/);
  await expect(trigger).toBeFocused();
});

test('task dialog exposes semantics, closes on Escape, and restores trigger focus',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('.app-nav [data-view="tasks"]').click();
  const trigger=page.locator('#newTaskBtn');
  await trigger.focus();
  await trigger.click();
  const modal=page.locator('#taskModal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('role','dialog');
  await expect(modal).toHaveAttribute('aria-modal','true');
  const labelledby=await modal.getAttribute('aria-labelledby');
  expect(labelledby).toBeTruthy();
  await expect(page.locator('#'+labelledby)).toBeVisible();
  await expect(page.locator('#taskTitle')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveClass(/hidden/);
  await expect(trigger).toBeFocused();
});

test('task dialog wraps keyboard focus within the dialog',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('.app-nav [data-view="tasks"]').click();
  await page.locator('#newTaskBtn').click();
  const modal=page.locator('#taskModal');
  const first=modal.locator('[data-close="taskModal"]');
  const last=page.locator('#saveTaskBtn');
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
});

test('task detail stays inside a 390px mobile viewport',async({page})=>{
  await boot(page,{width:390,height:844});
  await page.locator('.app-nav [data-view="tasks"]').click();
  await page.locator('[data-tl-task-row="a11y-task-1"] .tl-task-main').click();
  const modal=page.locator('#taskModal');
  await expect(modal).toBeVisible();
  const bounds=await modal.locator('.modal-card').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,scrollWidth:document.documentElement.scrollWidth}});
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth+1);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight+1);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.viewportWidth+1);
});

for(const c of [
  {name:'event',view:'calendar',trigger:'#newEventBtn',modal:'#eventModal',initial:'#eventTitle'},
  {name:'document',view:'library',trigger:'#newDocumentBtn',modal:'#documentModal',initial:'#docTitle'},
  {name:'meeting',view:'meetings',trigger:'#newMeetingBtn',modal:'#meetingModal',initial:'#meetingTitle'}
]){
  test(`${c.name} dialog focuses its first field and restores its trigger`,async({page})=>{
    await boot(page,{width:1024,height:768});
    await page.locator(c.view==='team'?'#teamManageTop':`.app-nav [data-view="${c.view}"]`).click();
    const trigger=page.locator(c.trigger);
    await trigger.focus();
    await trigger.click();
    await expect(page.locator(c.modal)).toBeVisible();
    await expect(page.locator(c.initial)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator(c.modal)).toHaveClass(/hidden/);
    await expect(trigger).toBeFocused();
  });
}

test('saving exposes busy and polite status semantics, then releases them on success',async({page})=>{
  const gate=deferred();
  await boot(page,{width:1024,height:768},{eventSaveGate:gate.promise});
  await page.locator('.app-nav [data-view="calendar"]').click();
  await page.locator('#newEventBtn').click();
  await page.locator('#eventTitle').fill('접근성 일정');
  await page.locator('#eventStartDate').fill('2026-09-18');
  await page.locator('#eventStartTime').fill('10:00');
  await page.locator('#eventEndDate').fill('2026-09-18');
  await page.locator('#eventEndTime').fill('11:00');
  const save=page.locator('#saveEventBtn');
  await save.click();
  try{
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute('aria-busy','true');
    await expect(page.locator('#eventStatus')).toHaveAttribute('role','status');
    await expect(page.locator('#eventStatus')).toHaveAttribute('aria-live','polite');
  }finally{
    gate.resolve();
  }
  await expect(page.locator('#eventModal')).toHaveClass(/hidden/);
  await expect(save).toBeEnabled();
  await expect(save).not.toHaveAttribute('aria-busy','true');
});

test('failed save releases busy state and announces the error',async({page})=>{
  const gate=deferred();
  await boot(page,{width:1024,height:768},{eventSaveGate:gate.promise,failEventSave:true});
  await page.locator('.app-nav [data-view="calendar"]').click();
  await page.locator('#newEventBtn').click();
  await page.locator('#eventTitle').fill('실패 일정');
  await page.locator('#eventStartDate').fill('2026-09-18');
  await page.locator('#eventStartTime').fill('11:00');
  await page.locator('#eventEndDate').fill('2026-09-18');
  await page.locator('#eventEndTime').fill('12:00');
  const save=page.locator('#saveEventBtn');
  await save.click();
  try{
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute('aria-busy','true');
  }finally{
    gate.resolve();
  }
  await expect(page.locator('#eventStatus')).toContainText('일정 저장 실패');
  await expect(page.locator('#eventStatus')).toHaveAttribute('role','alert');
  await expect(save).toBeEnabled();
  await expect(save).not.toHaveAttribute('aria-busy','true');
});

test('assigned organization list and compact rows expose clear names without retired filters',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('.app-nav [data-view="team"]').click();
  await expect(page.locator('#sofToolbar,#sofSearch,#sofCouncil,#sofType,#sofAssignee,#sofMine,#sofUnassigned')).toHaveCount(0);
  await expect(page.locator('#soOrgCount')).toContainText('담당조직');
  const row=page.locator('[data-so-org="a11y-org-1"]');
  await expect(row).toHaveAttribute('aria-label','철도노조 상세 열기');
  await expect(row).toHaveAttribute('role','button');
  await expect(row.locator('[data-so-delete],[data-so-edit],[data-so-assign]')).toHaveCount(0);
});

test('suborganization edit dialog exposes semantics, Escape close, and trigger restore',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('.app-nav [data-view="team"]').click();
  const trigger=page.locator('#soAddOrg');
  await trigger.focus();
  await trigger.click();
  const modal=page.locator('#soEditModal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('role','dialog');
  await expect(modal).toHaveAttribute('aria-modal','true');
  await expect(modal).toHaveAttribute('aria-labelledby','soEditHeading');
  await expect(page.locator('[data-so-close="soEditModal"]')).toHaveAttribute('aria-label','닫기');
  await expect(page.locator('#soEditName')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveClass(/hidden/);
  await expect(trigger).toBeFocused();
});

test('solo shell keeps logout accessible without a personal profile entry',async({page})=>{
  await boot(page,{width:1024,height:768});
  await expect(page.locator('#userBadge,#teamManageTop,#ccMessageTop')).toHaveCount(0);
  await expect(page.locator('#sidebarLogoutBtn')).toBeVisible();
  await expect(page.locator('#sidebarLogoutBtn')).toHaveAccessibleName('로그아웃');
});

test('symbol-only controls have accessible names',async({page})=>{
  await boot(page,{width:1024,height:768});
  await expect(page.locator('#prevMonthBtn')).toHaveAttribute('aria-label','이전 달');
  await expect(page.locator('#nextMonthBtn')).toHaveAttribute('aria-label','다음 달');
  await expect(page.locator('#taskModal [data-close="taskModal"]')).toHaveAttribute('aria-label','닫기');
});

for(const viewport of [
  {width:360,height:800},
  {width:768,height:1024},
  {width:1024,height:768},
  {width:1440,height:900}
]){
  test(`core views do not overflow at ${viewport.width}`,async({page})=>{
    await boot(page,viewport);
    for(const view of ['calendar','tasks','projects','library','meetings','media','pages','team']){
      await page.locator(`.app-nav [data-view="${view}"]`).click();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      expect(overflow,view).toBeLessThanOrEqual(1);
    }
  });
}
