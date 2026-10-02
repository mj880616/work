import {test,expect} from '@playwright/test';
import {calendarToday} from './helpers/calendar-today.mjs';

test.use({timezoneId:'Asia/Seoul'});

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const owner='selection-user',workspace='selection-workspace';
const spaces=[
  {id:'legacy',name:'이전 공간',owner_id:owner,status:'active',parent_id:null,metadata:{},sort_order:1},
  {id:'root',name:'정상 상위',owner_id:owner,status:'active',parent_id:null,metadata:{project_system:'v2'},sort_order:2},
  {id:'child',name:'정상 하위',owner_id:owner,status:'active',parent_id:'root',metadata:{},sort_order:3},
  {id:'archived',name:'보관 프로젝트',owner_id:owner,status:'archived',parent_id:null,metadata:{management_version:2},sort_order:4},
  {id:'hidden-child',name:'보관 상위의 하위',owner_id:owner,status:'active',parent_id:'archived',metadata:{},sort_order:5},
  {id:'other-owner',name:'다른 소유자 공간',owner_id:'another-user',status:'active',parent_id:null,metadata:{project_system:'v2'},sort_order:6}
].map(row=>({...row,workspace_id:workspace}));
const meeting={id:'selection-meeting',workspace_id:workspace,project_id:'legacy',title:'테스트 회의',series_name:'테스트 회의',meeting_at:'2026-09-29T01:00:00Z',transcript_text:'테스트 원문',created_by:owner};
// 한국 시간 오늘 13~14시. 월말 밤에도 다음 달로 넘어가지 않는다(시계는 calendarToday가 오늘 정오로 맞춘다).
const eventOn=today=>({id:'selection-event',workspace_id:workspace,project_id:'legacy',title:'테스트 일정',start_at:new Date(`${today}T13:00:00+09:00`).toISOString(),end_at:new Date(`${today}T14:00:00+09:00`).toISOString(),calendar_scope:'team',created_by:owner});

async function signIn(page,view,writes){
  const event=eventOn(await calendarToday(page));
  await page.route(`${SB}/**`,async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'selection-access',refresh_token:'selection-refresh',expires_in:3600,expires_at:Math.floor(await page.evaluate(()=>Date.now())/1000)+3600,user:{id:owner}});
    if(path==='/auth/v1/user')return ok({id:owner,email:'selection@example.org'});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace,user_id:owner,role:'owner',workspace:{id:workspace,name:'Test Workspace'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:workspace,name:'Test Workspace'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:owner,display_name:'Test Owner'}]);
    if(path==='/rest/v1/app_spaces')return ok(url.searchParams.has('owner_id')?spaces.filter(row=>row.owner_id===owner):spaces);
    if(path==='/rest/v1/app_meetings'){
      if(method==='PATCH'){writes.meeting=request.postDataJSON();return ok([{id:meeting.id}])}
      return ok([meeting]);
    }
    if(path==='/rest/v1/app_events'){
      writes.eventReads=(writes.eventReads||0)+1;
      if(method==='PATCH'){writes.event=request.postDataJSON();return ok([])}
      return ok([event]);
    }
    if(path==='/rest/v1/app_tasks'||path==='/rest/v1/app_documents')return ok([]);
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
  const returnTo=`${BASE}/app/?view=${view}`;
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(returnTo)}`);
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('selection@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await expect(page.locator(`#${view}View`)).toBeVisible();
}

async function expectCanonical(select){
  await expect(select.locator('option')).toHaveCount(3);
  await expect(select.locator('option')).toHaveText(['프로젝트 없음','정상 상위','　↳ 정상 하위']);
  await expect(select.locator('option[value="root"]')).not.toHaveAttribute('disabled','');
  await expect(select.locator('option[value="child"]')).not.toHaveAttribute('disabled','');
  for(const id of ['legacy','archived','hidden-child','other-owner'])await expect(select.locator(`option[value="${id}"]`)).toHaveCount(0);
}

test('new meeting uses the project catalog tree while calendar has no project selector',async({page})=>{
  await signIn(page,'meetings',{});
  await page.locator('#newMeetingBtn').click();
  await expectCanonical(page.locator('#meetingProject'));
  await page.locator('#meetingModal [data-close]').click();
  await page.locator('[data-view="calendar"]').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await page.locator('#newEventBtn').click();
  await expect(page.locator('#eventProject')).toHaveCount(0);
});

test('meeting edit retains an excluded project unless changed',async({page})=>{
  const writes={};await signIn(page,'meetings',writes);
  await page.locator('[data-mrd-meeting="selection-meeting"]').click();
  await page.locator('#mrdEdit').click();
  const select=page.locator('#mrdEditProject');
  await expect(select).toHaveValue('legacy');
  await expect(select.locator('option[value="legacy"]')).toHaveAttribute('disabled','');
  await expect(select.locator('option[value="legacy"]')).toContainText('이전 공간');
  for(const id of ['archived','hidden-child','other-owner'])await expect(select.locator(`option[value="${id}"]`)).toHaveCount(0);
  await page.locator('#mrdSaveEdit').click();
  await expect.poll(()=>writes.meeting?.project_id).toBe('legacy');
});

test('calendar never reads Web2 events or opens its edit dialog',async({page})=>{
  const writes={};await signIn(page,'calendar',writes);
  await expect(page.locator('.cm-app,#ciAppModal')).toHaveCount(0);
  expect(writes.eventReads||0).toBe(0);
  expect(writes.event).toBeUndefined();
});
