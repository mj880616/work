import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const app='http://127.0.0.1:8123/app/';
const views=['home','calendar','tasks','projects','library','meetings','pages'];
const user={id:'p8a-user',email:'p8a@example.org',user_metadata:{display_name:'내비게이션 QA'}};
const event={id:'p8a-event',title:'현장 일정',start_at:'2026-09-18T09:00:00+09:00',event_type:'meeting',location:'현장'};

async function mockApp(page){
  const messages={unread:0,myspaceAllowed:false};
  await page.route(`${SB}/**`,route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'p8a-access',refresh_token:'p8a-refresh',expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members'){
      const members=[{workspace_id:'p8a-workspace',user_id:user.id,role:'owner',email:user.email},{workspace_id:'p8a-workspace',user_id:'p8a-peer',role:'author',email:'peer@example.org'}];
      return ok(url.searchParams.has('user_id')?members.filter(m=>m.user_id===url.searchParams.get('user_id').replace(/^eq\./,'')):members);
    }
    if(path==='/rest/v1/app_workspaces')return ok([{id:'p8a-workspace',name:'QA Workspace'}]);
    if(path==='/rest/v1/app_profiles'){
      const profiles=[{user_id:user.id,display_name:'내비게이션 QA',job_title:'담당자'},{user_id:'p8a-peer',display_name:'동료 QA'}];
      return ok(url.searchParams.has('user_id')?profiles.filter(p=>p.user_id===url.searchParams.get('user_id').replace(/^eq\./,'')):profiles);
    }
    if(path==='/rest/v1/app_events')return ok([event]);
    if(path==='/rest/v1/app_private_feature_access')return ok(messages.myspaceAllowed?[{feature_key:'myspace'}]:[]);
    if(path==='/rest/v1/app_direct_messages'){
      if(route.request().method()==='PATCH'){messages.unread=0;return ok([])}
      if(url.searchParams.has('read_at'))return ok(Array.from({length:messages.unread},(_,i)=>({id:`unread-${i}`})));
      return ok(messages.unread?[{id:'inbound',sender_id:'p8a-peer',recipient_id:user.id,body:'확인 부탁드립니다',created_at:'2026-09-18T09:00:00+09:00'}]:[]);
    }
    if(path==='/rest/v1/app_pages')return ok([{id:'media-case',slug:'media-20260918-case',title:'[언론대응] 현장 사건',summary:'검토 중',visibility:'workspace',status:'draft',owner_id:user.id,updated_at:'2026-09-18T00:00:00Z'}]);
    if(path==='/functions/v1/event-media')return ok({photos:[]});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
  return messages;
}

async function signIn(page){
  await page.goto(loginEntry(app));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
}

test('seven core tabs own navigation and secondary features stay reachable',async({page})=>{
  test.setTimeout(60000);
  await mockApp(page);
  await signIn(page);
  await expect(page.locator('.app-nav .nav-btn')).toHaveCount(7,{timeout:20000});
  expect(await page.locator('.app-nav .nav-btn').evaluateAll(nodes=>nodes.map(n=>n.dataset.view))).toEqual(views);
  await expect(page.locator('#ccMobileDock')).toHaveCount(0);

  await page.locator('#userBadge').click();
  await expect(page.locator('#profileView')).toBeVisible();
  await expect(page.locator('#psName')).toHaveValue('내비게이션 QA');
  await expect(page.locator('#psTitle')).toHaveValue('담당자');
  await expect(page.locator('#psLogout')).toBeVisible();

  await page.locator('#teamManageTop').click();
  await expect(page.locator('#teamView')).toBeVisible();
  await expect(page.locator('#memberList')).toBeVisible();
  await expect(page.locator('.app-nav .nav-btn')).toHaveCount(7);
  await page.locator('[data-tpv-open="p8a-peer"]').click();
  await page.locator('#tpvMessage').click();
  await expect(page.locator('#messagesView')).toBeVisible();
  await expect(page.locator('[data-cc-peer="p8a-peer"]')).toHaveClass(/active/);

  await page.locator('.app-nav [data-view="pages"]').click();
  await page.locator('#pagesMediaEntry').click();
  await expect(page.locator('#mediaView')).toBeVisible();
  await expect(page.locator('#mediaCaseList')).toContainText('현장 사건');
  await page.reload();
  await expect(page.locator('#mediaView')).toBeVisible({timeout:20000});
  await expect(page.locator('.app-nav [data-view="pages"]')).toHaveAttribute('aria-current','page');

  await page.goto(app+'?view=profile');
  await expect(page.locator('#profileView')).toBeVisible({timeout:20000});
  await page.goto(app+'?view=messages');
  await expect(page.locator('#messagesView')).toBeVisible({timeout:20000});
  await page.goto(app+'?view=photos');
  await expect(page.locator('#photosView')).toBeVisible({timeout:20000});
  await page.reload();
  await expect(page.locator('#photosView')).toBeVisible({timeout:20000});
  await page.locator('#photosCalendarEntry').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await expect(page.locator('#eventRecordList [data-event-detail]')).toHaveCount(1);
  await page.locator('#eventRecordList [data-event-detail]').click();
  await expect(page.locator('#eventPhotoStrip')).toBeVisible();
  await expect(page.locator('#eventComments')).toBeVisible();
  await expect(page.locator('#eventDocuments')).toBeVisible();
  await page.locator('[data-photo-close="eventDetailModal"]').click();
  await page.locator('#userBadge').click();
  await page.locator('#psLogout').click();
  await expect(page.locator('#publicLoginBtn')).toBeVisible({timeout:20000});
  await expect(page.locator('#userBadge')).toContainText('공개 열람');
});

test('incoming messages keep an unread indicator and refresh the open conversation',async({page})=>{
  test.setTimeout(60000);
  const messages=await mockApp(page);
  await signIn(page);
  await expect(page.locator('#ccMessageTop')).toBeVisible({timeout:20000});
  messages.unread=1;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#ccMessageBadge')).toHaveText('1');
  await page.locator('#ccMessageTop').click();
  await expect(page.locator('#messagesView')).toBeVisible();
  await page.locator('[data-cc-peer="p8a-peer"]').click();
  await expect(page.locator('#ccMessageList')).toContainText('확인 부탁드립니다');
  await expect(page.locator('#ccMessageBadge')).toBeHidden();
});

test('private My Space stays available only through the allowed profile entry',async({page})=>{
  test.setTimeout(60000);
  const state=await mockApp(page);
  state.myspaceAllowed=true;
  await signIn(page);
  await page.locator('#userBadge').click();
  await expect(page.locator('#psMySpaceEntry')).toBeVisible();
  await page.locator('#psMySpaceEntry').click();
  await expect(page.locator('#myspaceView')).toBeVisible();
  await expect(page.locator('.app-nav .nav-btn')).toHaveCount(7);
  state.myspaceAllowed=false;
  await page.goto(app+'?view=myspace');
  await expect(page.locator('#homeView')).toBeVisible({timeout:20000});
  await page.locator('#userBadge').click();
  await expect(page.locator('#psMySpaceEntry')).toBeHidden();
});

test('mobile uses the same seven tabs and scrolls the active tab into view',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:390,height:844});
  await mockApp(page);
  await signIn(page);
  await expect(page.locator('#ccMobileDock')).toHaveCount(0);
  await expect(page.locator('.app-nav .nav-btn')).toHaveCount(7,{timeout:20000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('.app-nav [data-view="pages"]').click();
  await expect(page.locator('#pagesView')).toBeVisible();
  await expect.poll(()=>page.locator('.app-nav').evaluate(nav=>{
    const b=nav.querySelector('[data-view="pages"]'),n=nav.getBoundingClientRect(),r=b.getBoundingClientRect();
    return r.left>=n.left-1&&r.right<=n.right+1;
  })).toBe(true);
  await expect(page.locator('#userBadge')).toBeVisible();
});

test('user badge opens settings when tapped before the home renderer finishes',async({page})=>{
  test.setTimeout(30000);
  await page.route('**/home-dashboard-v2.js*',async route=>{
    await new Promise(resolve=>setTimeout(resolve,1200));
    await route.continue();
  });
  await mockApp(page);
  await page.goto(loginEntry(app));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#userBadge')).toBeVisible({timeout:10000});
  await page.locator('#userBadge').click();
  await expect(page.locator('#profileView')).toBeVisible({timeout:20000});
});
