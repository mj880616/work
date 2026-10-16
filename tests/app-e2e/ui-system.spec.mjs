import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const APP=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const user={id:'ui-system-user',email:'ui-system@example.org',user_metadata:{display_name:'UI QA'}};
const workspace={id:'ui-system-workspace',slug:'ui-system',name:'웹2'};
const tasks=Array.from({length:24},(_,i)=>({id:`ui-task-${i+1}`,title:`UI 점검 할 일 ${i+1}`,taskListId:'@default',taskListTitle:'내 할 일',status:'needsAction',due:new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10)+'T00:00:00.000Z'}));

async function mockApp(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request();
    const url=new URL(req.url());
    const path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'ui-access',refresh_token:'ui-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,tasks});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'UI QA'}]);
    if(path==='/rest/v1/app_spaces')return ok([]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await enterLogin(page);
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

async function buttonHeight(page,view,selector){
  await clickView(page,view);
  const button=page.locator(selector);
  await expect(button).toBeVisible({timeout:10000});
  return button.evaluate(el=>el.getBoundingClientRect().height);
}

test('calendar uses 32px and text actions use 36px with mobile content above the bottom tabs',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:390,height:844});
  await mockApp(page);
  await page.goto(`${APP}/app/`);
  await signIn(page);
  await expect(page.locator('#ccMobileDock')).toHaveCount(0);

  // UI-디자인기준 3/3 2부(8-9e-2): 폰의 일정·할 일·프로젝트·자료실 추가 버튼은 하단 탭 위 동그란 [+](보이는 36px)로 한 크기.
  const round=[];
  round.push(await buttonHeight(page,'calendar','#newEventBtn'));
  round.push(await buttonHeight(page,'tasks','#newTaskBtn'));
  round.push(await buttonHeight(page,'projects','#newProjectBtn'));
  round.push(await buttonHeight(page,'library','#newDocumentBtn'));
  for(const height of round)expect(height).toBeCloseTo(36,0);
  // 회의는 위쪽 버튼 그대로(--ds-control-height 46px).
  expect(await buttonHeight(page,'meetings','#newMeetingBtn')).toBeCloseTo(46,0);

  await clickView(page,'tasks');
  const rows=page.locator('#gtTaskBody .gt-row');
  await expect(rows).toHaveCount(24,{timeout:10000});
  await expect(rows.last().locator('.gt-unlinked-badge')).toHaveCount(0);
  await page.evaluate(()=>{
    const items=document.querySelectorAll('#gtTaskBody .gt-row');
    items[items.length-1]?.scrollIntoView({block:'end',behavior:'instant'});
  });
  await page.waitForTimeout(80);
  const clearance=await page.evaluate(()=>{
    const items=document.querySelectorAll('#gtTaskBody .gt-row');
    const item=items[items.length-1]?.getBoundingClientRect();
    return item?{itemBottom:item.bottom,tabsTop:document.querySelector(".mobile-tabs").getBoundingClientRect().top,scrollY:window.scrollY,docHeight:document.documentElement.scrollHeight}:null;
  });
  expect(clearance).not.toBeNull();
  expect(clearance.itemBottom).toBeLessThanOrEqual(clearance.tabsTop-4);
  expect(clearance.scrollY).toBeGreaterThan(0);
});
