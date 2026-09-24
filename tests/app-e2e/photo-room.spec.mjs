import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'photo-user',email:'photo@example.org',user_metadata:{display_name:'포토 QA'}};
const workspace={id:'photo-workspace',slug:'photo-workspace',name:'공공기관사업팀 Workspace'};
const event={id:'event-1',workspace_id:workspace.id,title:'인력확충 기자회견',start_at:'2026-09-15T11:00:00+09:00',event_type:'press',location:'국회 앞',body:'',description:'',project_id:null};
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlKx8sAAAAASUVORK5CYII=';
let uploaded=false;
let uploadRequest=null;
let comments=[];
let documents=[];

async function mockApp(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request();
    const url=new URL(req.url());
    const path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});

    if(path==='/auth/v1/token')return ok({access_token:'photo-access',refresh_token:'photo-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/event-media'){
      const action=url.searchParams.get('action');
      if(action==='upload'&&req.method()==='POST'){
        uploadRequest={authorization:req.headers().authorization||'',contentType:req.headers()['content-type']||''};
        uploaded=true;
        return ok({ok:true});
      }
      if(action==='list'){
        return ok({photos:uploaded?[{id:'photo-1',event_id:event.id,caption:'현장 사진',tags:['기자회견'],taken_at:'2026-09-15T11:00:00+09:00',thumb_url:pixel,url:pixel,event:{title:event.title,start_at:event.start_at}}]:[]});
      }
      return ok({});
    }
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'포토 QA'}]);
    if(path==='/rest/v1/app_events')return ok([event]);
    if(path==='/rest/v1/app_event_comments'){
      if(req.method()==='POST')comments.push({...req.postDataJSON(),id:'comment-'+(comments.length+1),created_at:new Date().toISOString()});
      return ok(comments);
    }
    if(path==='/rest/v1/app_documents'){
      if(req.method()==='POST')documents.push({...req.postDataJSON(),id:'document-'+(documents.length+1)});
      return ok(documents);
    }
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
  await expect(page.locator('#appView')).toBeVisible({timeout:15000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
}

test('photo upload uses shared session without restoring calendar record cards',async({page})=>{
  test.setTimeout(60000);
  uploaded=false;uploadRequest=null;
  comments=[];documents=[];
  let appNavigations=0;
  page.on('framenavigated',frame=>{if(frame===page.mainFrame()&&new URL(frame.url()).pathname.endsWith('/app/'))appNavigations++});

  await mockApp(page);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);

  await page.locator('[data-view="calendar"]').click();
  await expect(page.locator('#eventRecordSection')).toHaveCount(0);
  await expect(page.locator('#eventRecordList')).toHaveCount(0);
  await expect(page.locator('#photosView')).toHaveCount(1);
  await page.locator('#photosView').evaluate(el=>el.classList.remove('hidden'));
  await expect(page.locator('#photosView')).toBeVisible();
  await page.locator('#photoUploadOpen').dispatchEvent('click');
  await expect(page.locator('#photoUploadModal')).toBeVisible();
  await expect(page.locator('#photoEvent')).toContainText('인력확충 기자회견');
  await page.locator('#photoCaption').fill('현장 사진');
  await page.locator('#photoTags').fill('기자회견');
  await page.locator('#photoFile').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from(pixel.split(',')[1],'base64')});
  const navigationBaseline=appNavigations;
  await page.locator('#photoUploadBtn').click();

  await expect(page.locator('#photoUploadModal')).toBeHidden({timeout:10000});
  await expect(page.locator('#toast')).toContainText('사진을 올렸습니다.');
  expect(appNavigations).toBe(navigationBaseline);
  const detailNavigationBaseline=appNavigations;
  await expect(page.locator('#photoGrid [data-photo-event]')).toHaveCount(1);
  await page.locator('#photoGrid [data-photo-event]').dispatchEvent('click');
  await expect(page.locator('#eventDetailModal')).toBeVisible();
  await expect(page.locator('#eventPhotoStrip')).toContainText('현장 사진',{timeout:10000});
  await page.locator('#eventCommentBody').fill('현장 기록 댓글');
  await page.locator('#addEventComment').click();
  await expect(page.locator('#eventComments')).toContainText('현장 기록 댓글');
  await page.locator('#eventDocTitle').fill('현장 자료');
  await page.locator('#eventDocUrl').fill('https://example.org/record');
  await page.locator('#addEventDocument').click();
  await expect(page.locator('#eventDocuments')).toContainText('현장 자료');
  await expect(page.locator('#eventDocuments a')).toHaveAttribute('href','https://example.org/record');
  expect(uploadRequest?.authorization).toBe('Bearer photo-access');
  expect(uploadRequest?.contentType).toContain('multipart/form-data');
  expect(appNavigations).toBe(detailNavigationBaseline);
});
