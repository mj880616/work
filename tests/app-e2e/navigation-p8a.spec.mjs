import { appOrigin } from './helpers/test-origin.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const app=`${appOrigin}/app/`;
const views=['home','basket','calendar','tasks','journal','diary','projects','meetings','library','pages','team','hwp','ledger','photos','calls','telegram','arsenal'];
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
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
}

test('top-level V3 navigation opens the library and keeps removed controls absent',async({page})=>{
  test.setTimeout(60000);
  await mockApp(page);
  await signIn(page);
  // UI-디자인손질 8: the sidebar has no [쓰기] any more (UI-쓰기메뉴삭제).
  // UI-PC일정묶음: 할 일·업무일지·일기 are sub rows under [일정]; the order of the views is unchanged.
  const nav=page.locator('.app-nav :is(.nav-btn,.nav-sub-btn)[data-view]');
  await expect(nav).toHaveCount(views.length);await expect(page.locator('.app-nav [data-menu-write]')).toHaveCount(0);
  expect(await nav.evaluateAll(nodes=>nodes.map(node=>node.dataset.view))).toEqual(views);
  await expect(page.locator('#userBadge,#teamManageTop,#ccMessageTop,#pagesMediaEntry')).toHaveCount(0);
  await page.locator('#appView>.app-topline [data-account-open]').click();
  await expect(page.locator('#sidebarLogoutBtn')).toBeVisible();

  await clickView(page,'library');
  await expect(page.locator('#libraryView')).toBeVisible();
  await expect(page.locator('.app-nav [data-view="library"]')).toHaveAttribute('aria-current','page');
  await expect(page.locator('.app-nav [data-view="media"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#libraryView')).toBeVisible({timeout:20000});
  await expect(page.locator('.app-nav [data-view="library"]')).toHaveAttribute('aria-current','page');
  await clickView(page,'pages');
  await expect(page.locator('#pagesView')).toBeVisible();
  await expect(page.locator('#pagesMediaEntry')).toHaveCount(0);
  await page.locator('#appView>.app-topline [data-account-open]').click();
  await page.locator('#sidebarLogoutBtn').click();
  await expect(page).toHaveURL(/\/app\/login\//,{timeout:20000});
  await expect(page.locator('.login-shell')).toBeVisible();
  await expect(page.locator('#appView')).toHaveCount(0);
});

test('removed personal deep links return to home, the retired media link opens the library, and ?view=photos is the new photo menu',async({page})=>{
  test.setTimeout(60000);
  await mockApp(page);
  await signIn(page);
  for(const view of ['messages','myspace']){
    await page.goto(app+'?view='+view);
    await expect(page.locator('#homeView')).toBeVisible({timeout:20000});
    await expect(page.locator('#'+view+'View')).toHaveCount(0);
  }
  await page.goto(app+'?view=media');
  await expect(page.locator('#libraryView')).toBeVisible({timeout:20000});
  await expect(page.locator('#mediaView')).toHaveCount(0);
  await expect.poll(()=>new URL(page.url()).searchParams.get('view')).toBe('library');
  // PHOTO-사진메뉴: ?view=photos는 이제 새 '사진' 메뉴(원드라이브 갤러리)다. 옛 포토룸의 일정 사진 기록 칸은 돌아오지 않는다.
  await page.goto(app+'?view=photos');
  await expect(page.locator('#photosView')).toBeVisible({timeout:20000});
  await expect.poll(()=>new URL(page.url()).searchParams.get('view')).toBe('photos');
  await expect(page.locator('#eventRecordSection,#eventRecordList')).toHaveCount(0);
});

for(const width of [390,360]){
  test(`mobile ${width}px keeps V3 tabs navigable without horizontal page overflow`,async({page})=>{
    test.setTimeout(60000);
    await page.setViewportSize({width,height:844});
    await mockApp(page);
    await signIn(page);
    await expect(page.locator('.app-nav :is(.nav-btn,.nav-sub-btn)[data-view]')).toHaveCount(views.length);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await clickView(page,'library');
    await expect(page.locator('#libraryView')).toBeVisible();
    await expect(page.locator('.app-nav')).toBeHidden();
    await expect(page.locator('.mobile-tabs')).toBeVisible();
  });
}
