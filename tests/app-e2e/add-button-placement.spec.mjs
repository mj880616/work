import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'placement-user',email:'placement@example.invalid',user_metadata:{display_name:'Placement QA'}};
const workspace={id:'placement-workspace',name:'Fixture workspace'};
const project={id:'placement-project',workspace_id:workspace.id,name:'Fixture project',description:'Fixture',parent_id:null,owner_id:user.id,created_by:user.id,status:'active',visibility:'private',sort_order:10,metadata:{project_system:'v2',management_version:2}};
const documentRow={id:'placement-document',workspace_id:workspace.id,project_id:project.id,title:'Fixture document',file_name:'fixture.pdf',category:'기타',source:'Fixture',document_date:'2026-09-28',created_at:'2026-09-28T00:00:00Z',uploaded_by:user.id};
const meeting={id:'placement-meeting',workspace_id:workspace.id,project_id:project.id,title:'Fixture meeting',meeting_at:'2026-09-28T09:00:00+09:00',created_by:user.id};
const event={id:'placement-event',workspace_id:workspace.id,project_id:project.id,title:'Fixture event',start_at:'2026-09-28T09:00:00+09:00',end_at:'2026-09-28T10:00:00+09:00',created_by:user.id};
const ok=(route,data)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
async function openApp(page,view,{entryView='calendar'}={}){
  await page.route(`${SB}/**`,async route=>{
    const u=new URL(route.request().url()),p=u.pathname,action=u.searchParams.get('action');
    if(p==='/auth/v1/token')return ok(route,{access_token:'fixture',refresh_token:'fixture',expires_in:3600,expires_at:4102444800,user});
    if(p==='/auth/v1/user')return ok(route,user);
    if(p==='/auth/v1/logout')return ok(route,{});
    if(p==='/rest/v1/app_workspace_members')return ok(route,[{workspace_id:workspace.id,user_id:user.id,role:'owner',workspace}]);
    if(p==='/rest/v1/app_workspaces')return ok(route,[workspace]);
    if(p==='/rest/v1/app_profiles')return ok(route,[{user_id:user.id,display_name:'Placement QA'}]);
    if(p==='/rest/v1/app_spaces')return ok(route,[project]);
    if(p==='/rest/v1/app_documents')return ok(route,[documentRow]);
    if(p==='/rest/v1/app_meetings')return ok(route,[meeting]);
    if(p==='/rest/v1/app_events')return ok(route,[event]);
    if(p==='/functions/v1/google-calendar')return ok(route,action==='events'?{events:[],colors:{},eventColors:{}}:{connected:false,enabled:false,selected:[],calendars:[]});
    if(p==='/functions/v1/google-tasks'){
      if(action==='overview')return ok(route,{connected:true,authorized:true,tasks:[]});
      if(action==='linked')return ok(route,{tasks:[],removed:0});
      if(action==='unlinked')return ok(route,{tasks:[]});
      return ok(route,{connected:true,authorized:true,tasks:[]});
    }
    if(p==='/functions/v1/event-media')return ok(route,{photos:[]});
    if(p.startsWith('/rest/v1/rpc/'))return ok(route,null);
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok(route,[]);
    return ok(route,{});
  });
  await page.goto(loginEntry(`${BASE}/app/?view=${entryView}`));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('fixture-password');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await page.evaluate(v=>window.KPTURouter.go(v,{source:'placement-test'}),view==='project_detail'?'projects':view);
  await expect(page.locator(`#${view==='project_detail'?'projects':view}View`)).toBeVisible({timeout:15000});
  if(view==='project_detail'){
    await page.locator('#projectGrid [data-ps3-project]').first().click();
    await expect(page.locator('#ps3DetailModal')).toBeVisible();
  }
}

async function assertInHeader(page,{card,head,button,title}){
  await expect(page.locator(`${card} ${head} ${button}`)).toHaveCount(1);
  const box=await page.locator(`${card} ${head} ${button}`).boundingBox();
  const cardBox=await page.locator(card).boundingBox();
  const headBox=await page.locator(`${card} ${head}`).boundingBox();
  expect(box).toBeTruthy();expect(cardBox).toBeTruthy();expect(headBox).toBeTruthy();
  expect(box.x).toBeGreaterThanOrEqual(cardBox.x-1);
  expect(box.x+box.width).toBeLessThanOrEqual(cardBox.x+cardBox.width+1);
  expect(box.y).toBeGreaterThanOrEqual(headBox.y-1);
  expect(box.y+box.height).toBeLessThanOrEqual(headBox.y+headBox.height+1);
  const titleBox=await page.locator(`${card} ${head} ${title}`).boundingBox();
  if(titleBox){
    const overlap=box.x<titleBox.x+titleBox.width&&box.x+box.width>titleBox.x&&box.y<titleBox.y+titleBox.height&&box.y+box.height>titleBox.y;
    expect(overlap).toBe(false);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
}

for(const width of [390,1440]){
  test.describe(`${width}px`,()=>{
    test.use({viewport:{width,height:width===390?844:900},timezoneId:'Asia/Seoul'});
    test('library list card keeps add action and opens the same form',async({page})=>{
      await openApp(page,'library');
      await assertInHeader(page,{card:'#libraryListCard',head:'.add-list-head',button:'#newDocumentBtn',title:'h2'});
      await expect(page.locator('#libraryListCard .add-list-head #manageLibraryBtn')).toBeVisible();
      await expect(page.locator('#libraryView>.section-head.actions-only')).toHaveCount(0);
      await page.locator('#newDocumentBtn').click();
      await expect(page.locator('#documentModal')).toBeVisible();
    });
    test('meeting list card keeps filter and opens the same form',async({page})=>{
      await openApp(page,'meetings');
      await assertInHeader(page,{card:'#meetingsListCard',head:'.add-list-head',button:'#newMeetingBtn',title:'h2'});
      await expect(page.locator('#meetingsView .meeting-toolbar #meetingTypeFilter')).toBeVisible();
      await page.locator('#newMeetingBtn').click();
      await expect(page.locator('#meetingModal')).toBeVisible();
    });
    test('calendar card has the right label, 44px target and same form',async({page})=>{
      await openApp(page,'calendar');
      await assertInHeader(page,{card:'#calendarCard',head:'.calendar-toolbar',button:'#newEventBtn',title:'#monthTitle'});
      const button=page.locator('#newEventBtn');
      await expect(button).toHaveAttribute('aria-label','일정 등록');
      expect((await button.innerText()).replace(/\s+/g,' ').trim()).toBe(width===390?'+':'+ 일정 등록');
      const box=await button.boundingBox();
      if(width===390){
        expect(box.width).toBeGreaterThanOrEqual(35);
        expect(box.width).toBeLessThanOrEqual(37);
      }
      expect(box.height).toBe(32);
      await button.click();
      await expect(page.locator('#eventModal')).toBeVisible();
    });
    test('project detail places both actions in their cards after redraw',async({page})=>{
      await openApp(page,'project_detail');
      const task={card:'#ps3-tasks',head:'.ps3-section-head',button:'[data-ps3-global="task"]',title:'h3'};
      const doc={card:'#ps3-documents',head:'.ps3-section-head',button:'[data-ps3-global="document"]',title:'h3'};
      await assertInHeader(page,task);await assertInHeader(page,doc);
      await expect(page.locator('#ps3Body .ps3-quick')).toHaveCount(0);
      await page.locator('#ps3-tasks h3').evaluate(el=>el.textContent='매우 긴 할 일 카드 제목을 반복해서 표시하는 화면 배치 확인용 제목');
      await page.locator('#ps3-documents h3').evaluate(el=>el.textContent='매우 긴 자료 카드 제목을 반복해서 표시하는 화면 배치 확인용 제목');
      await assertInHeader(page,task);await assertInHeader(page,doc);
      await page.evaluate(()=>{window.__oldPlacementTaskCard=document.querySelector('#ps3-tasks');window.dispatchEvent(new Event('kptu:tasks-changed'))});
      await expect.poll(()=>page.evaluate(()=>document.querySelector('#ps3-tasks')!==window.__oldPlacementTaskCard)).toBe(true);
      await assertInHeader(page,task);await assertInHeader(page,doc);
      await page.locator('#ps3-tasks [data-ps3-global="task"]').click();
      await expect(page.locator('#gtTaskModal')).toBeVisible();
      await page.locator('#gtTaskModal [data-gt-close]').first().click();
      await page.locator('#ps3-documents [data-ps3-global="document"]').click();
      await expect(page.locator('#documentModal')).toBeVisible();
    });
    test('task add label is canonical on direct entry and refresh without calendar',async({page})=>{
      const calendarUiRequests=[];
      page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/calendar-mobile-ui.js'))calendarUiRequests.push(request.url())});
      await openApp(page,'tasks',{entryView:'tasks'});
      await expect(page.locator('#newTaskBtn')).toHaveText('+ 할 일');
      expect(calendarUiRequests).toEqual([]);
      await page.reload();
      await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
      await expect(page.locator('#tasksView')).toBeVisible();
      await expect(page.locator('#newTaskBtn')).toHaveText('+ 할 일');
      expect(calendarUiRequests).toEqual([]);
    });
    test('Google task card keeps add action and editor',async({page})=>{
      await openApp(page,'tasks');
      await assertInHeader(page,{card:'#gtTaskSection',head:'.gt-head',button:'#newTaskBtn',title:'[data-gt-count]'});
      await expect(page.locator('#newTaskBtn')).toHaveText('+ 할 일');
      await page.locator('#newTaskBtn').click();
      await expect(page.locator('#gtTaskModal')).toBeVisible();
    });
    test('project list card keeps archive and add action after redraw',async({page})=>{
      await openApp(page,'projects');
      const card='#projectGrid .ps3-plist',head='.add-list-head',title='h2';
      const checkActions=async()=>{
        await assertInHeader(page,{card,head,button:'#ps3ArchiveBtn',title});
        await assertInHeader(page,{card,head,button:'#newProjectBtn',title});
        const actions=page.locator(`${card} ${head} .ps3-project-toolbar`);
        await expect(actions.locator('button')).toHaveCount(2);
        expect(await actions.locator('button').evaluateAll(buttons=>buttons.map(button=>button.id))).toEqual(['ps3ArchiveBtn','newProjectBtn']);
        const archive=await page.locator('#ps3ArchiveBtn').boundingBox();
        const add=await page.locator('#newProjectBtn').boundingBox();
        expect(archive.width).toBeGreaterThanOrEqual(44);
        expect(archive.height).toBe(36);
        expect(add.width).toBeGreaterThanOrEqual(44);
        expect(add.height).toBe(36);
        expect(archive.x+archive.width).toBeLessThanOrEqual(add.x+1);
        expect(Math.abs(archive.y-add.y)).toBeLessThanOrEqual(1);
      };
      await checkActions();
      await expect(page.locator('#ps3ArchiveBtn')).toHaveText('보관함');
      await expect(page.locator('#newProjectBtn')).toHaveText('+ 프로젝트');
      await page.locator(`${card} ${head} h2`).evaluate(el=>el.textContent='매우 긴 프로젝트 목록 카드 제목을 반복해서 표시하는 화면 배치 확인용 제목');
      await checkActions();
      await page.locator('#ps3ArchiveBtn').click();
      await expect(page.locator('#ps3ArchiveModal')).toBeVisible();
      await page.locator('[data-ps3-close="ps3ArchiveModal"]').click();
      await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'placement-test'}));
      await expect(page.locator('#calendarView')).toBeVisible();
      await page.evaluate(()=>window.KPTURouter.go('projects',{source:'placement-test'}));
      await expect(page.locator('#projectsView')).toBeVisible();
      await checkActions();
      await page.locator('#newProjectBtn').click();
      await expect(page.locator('#ps3CreateModal')).toBeVisible();
    });
  });
}
