import { appOrigin } from './helpers/test-origin.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

// TASK-포토룸삭제 1단계: the photo room screen and code are gone. Stored photos and DB rows are untouched here.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const app=`${appOrigin}/app/`;
const user={id:'photo-removed-user',email:'photo-removed@example.org',user_metadata:{display_name:'포토룸 삭제 QA'}};
const workspace={id:'photo-removed-workspace',name:'QA Workspace'};
const event={id:'photo-removed-event',workspace_id:workspace.id,title:'현장 일정',start_at:'2026-09-18T09:00:00+09:00',event_type:'meeting',location:'현장'};
const PHOTO_ASSET=/\/app\/photo-room\.(js|css)$/;

async function mockApp(page){
  const seen={photoAssets:[],eventMedia:0};
  page.on('request',req=>{if(PHOTO_ASSET.test(new URL(req.url()).pathname))seen.photoAssets.push(req.url())});
  await page.route(`${SB}/**`,route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'photo-removed-access',refresh_token:'photo-removed-refresh',expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'포토룸 삭제 QA'}]);
    if(path==='/rest/v1/app_events')return ok([event]);
    if(path==='/functions/v1/event-media'){seen.eventMedia++;return ok({photos:[]})}
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
  return seen;
}

function watchErrors(page){
  const errors=[];
  page.on('console',msg=>{if(msg.type()==='error')errors.push('console: '+msg.text())});
  page.on('pageerror',err=>errors.push('pageerror: '+err.message));
  return errors;
}

async function signIn(page){
  await page.goto(loginEntry(app+'?view=calendar'));
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
}

// The removed loader used to fetch the photo room in an idle callback (timeout 1200ms) after the calendar loaded.
async function settleAfterCalendar(page){
  await expect(page.locator('#calendarView')).toBeVisible({timeout:20000});
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
}

// PHOTO-사진메뉴(2026-10-28): ?view=photos is now the new 사진 menu (OneDrive gallery, app/photos.js), not the retired photo room.
test('?view=photos opens the new photo menu and never the retired photo room',async({page})=>{
  test.setTimeout(60000);
  const errors=watchErrors(page);
  const seen=await mockApp(page);
  await signIn(page);
  await page.waitForLoadState('networkidle');
  await page.goto(app+'?view=photos');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
  await expect(page.locator('#photosView')).toBeVisible({timeout:20000});
  await expect(page.locator('#photosView [data-photos-tab]')).toHaveText(['사진','달력','폴더','앨범','휴지통']);
  await page.waitForLoadState('networkidle');
  expect(seen.photoAssets).toEqual([]);
  expect(seen.eventMedia).toBe(0);
  expect(errors).toEqual([]);
});

test('entering the calendar requests no photo room files',async({page})=>{
  test.setTimeout(60000);
  const errors=watchErrors(page);
  const seen=await mockApp(page);
  await signIn(page);
  await settleAfterCalendar(page);
  await clickView(page,'tasks');
  await clickView(page,'calendar');
  await settleAfterCalendar(page);
  expect(seen.photoAssets).toEqual([]);
  expect(seen.eventMedia).toBe(0);
  expect(await page.evaluate(()=>window.KPTUViewLoader.normalize('photos'))).toBe('photos');
  expect(errors).toEqual([]);
});

test('no photo room screen, link, or button remains (the new 사진 menu button is separate)',async({page})=>{
  test.setTimeout(60000);
  const errors=watchErrors(page);
  await mockApp(page);
  await signIn(page);
  await settleAfterCalendar(page);
  for(const selector of [
    '#photosCalendarEntry','#photoUploadOpen','#photoUploadModal','#eventDetailModal',
    '#photoGrid','#eventPhotoStrip','[data-goto="photos"]','[data-photo-event]',
    '[data-photo-close]','a[href*="view=photos"]'
  ])await expect(page.locator(selector),selector).toHaveCount(0);
  await expect(page.getByText('포토룸')).toHaveCount(0);
  expect(await page.evaluate(()=>'__KPTU_PHOTO_ROOM_READY__' in window)).toBe(false);
  expect(errors).toEqual([]);
});
