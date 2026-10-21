import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

// AI-서버연동 S7-d: [원장] 화면의 Drive 내보내기 칸(app/ledger-export.js, #ledgerExportRoot). drive-summary는 시험 응답으로 대신한다.
// 상태(GET ?action=ledger_status) → 마지막 내보내기 표시 → [지금 Drive로 내보내기](POST ?action=ledger_export, 본문 없음) → 결과·문서 링크.
// 옛 함수(배포 전)는 상태 읽기가 405 → 칸이 숨는다. 시작 직후에는 상태를 묻지 않는다(2분 뒤 자동 점검).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'ledger-e-user',email:'ledger-e@example.org',user_metadata:{display_name:'Ledger QA'}};
const workspace={id:'ledger-e-workspace',slug:'kptu-work',name:'웹2'};
const DOC='https://docs.google.com/document/d/virtual-ledger-doc/edit';

async function mockApp(page,{deployed=true,exportFail=false}={}){
 const calls=[];
 let ledger={state:'found',last_success_at:'2026-10-20T00:00:00.000Z',last_failure_at:null,last_failure_code:null};
 await page.route(`${SB}/**`,async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
  const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
  if(path==='/auth/v1/token')return ok({access_token:'ledger-e-access',refresh_token:'ledger-e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
  if(path==='/auth/v1/user')return ok(user);
  if(path==='/functions/v1/drive-summary'){
   calls.push({method,action:url.searchParams.get('action'),body:request.postData()});
   if(!deployed)return method==='GET'?ok({ok:false,error:'METHOD_NOT_ALLOWED'},405):ok({ok:true,updated_at:'2026-10-21T00:00:00.000Z',documents:{}});
   if(method==='GET'&&url.searchParams.get('action')==='ledger_status')return ok({ok:true,checked_at:new Date().toISOString(),ledger});
   if(method==='POST'&&url.searchParams.get('action')==='ledger_export'){
    if(exportFail){ledger={...ledger,last_failure_at:new Date().toISOString(),last_failure_code:'DRIVE_PUBLIC_SHARING_FOUND'};return ok({ok:false,error:'DRIVE_PUBLIC_SHARING_FOUND',exported_at:null,failure_recorded:true},403);}
    const at=new Date().toISOString();ledger={...ledger,last_success_at:at};
    return ok({ok:true,exported_at:at,counts:{app_ledger_records:4},keep:8,trim_failed:0,documents:{ledger:DOC}});
   }
   return ok({ok:false},405);
  }
  if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
  if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:'all',tasks:[]});
  if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
  if(path.startsWith('/functions/v1/'))return ok({});
  if(path.startsWith('/rest/v1/rpc/'))return ok(null);
  if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email,workspace}]);
  if(path==='/rest/v1/app_workspaces')return ok([workspace]);
  if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'Ledger QA',job_title:''}]);
  if(path.startsWith('/rest/v1/'))return ok([]);
  return ok({});
 });
 return calls;
}
async function signIn(page){
 await page.goto(testOrigin+'/app/?view=ledger');
 await enterLogin(page);
 await expect(page.locator('#googleLoginBtn')).toBeVisible({timeout:10000});
 await signInWithSession(page,user.email);
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
 await expect(page.locator('#ledgerView')).toBeVisible({timeout:15000});
}
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);

for(const [name,width] of [['PC',1440],['phone',390]]){
 test(`원장 Drive 내보내기: 마지막 시각 → [지금 Drive로 내보내기] → 결과·문서 링크 (${name} ${width}px)`,async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:900});
  const calls=await mockApp(page);
  await signIn(page);
  const box=page.locator('#ledgerExportRoot');
  await expect(box).toBeVisible({timeout:15000});
  await expect(box.locator('[data-le-last]')).toContainText('마지막 내보내기');
  const button=box.locator('[data-le-action="export"]');
  await expect(button).toHaveText('지금 Drive로 내보내기');
  await button.click();
  await expect(box.locator('[data-le-message]')).toContainText('원장 기록 4건',{timeout:10000});
  await expect(box.locator('[data-le-message] a')).toHaveAttribute('href',DOC);
  const posts=calls.filter(c=>c.method==='POST');
  expect(posts).toHaveLength(1);
  expect(posts[0].action).toBe('ledger_export');
  expect(posts[0].body).toBeNull();
  expect(calls.filter(c=>c.method==='POST'&&c.action!=='ledger_export')).toHaveLength(0);
  expect(await noSideScroll(page)).toBe(true);
 });
}

test('원장 Drive 내보내기: 실패는 단계별 안내, 옛 함수(배포 전)면 칸이 숨고 자동 내보내기도 없음',async({page})=>{
 test.setTimeout(60000);
 const calls=await mockApp(page,{exportFail:true});
 await signIn(page);
 const box=page.locator('#ledgerExportRoot');
 await expect(box).toBeVisible({timeout:15000});
 await box.locator('[data-le-action="export"]').click();
 await expect(box.locator('[data-le-message]')).toContainText('공개 공유',{timeout:10000});
 await expect(box.locator('[data-le-last]')).toContainText('최근 실패');
 expect(calls.filter(c=>c.method==='POST')).toHaveLength(1);
});

test('원장 Drive 내보내기: 배포 전 함수면 칸을 숨기고 POST를 보내지 않음',async({page})=>{
 test.setTimeout(60000);
 const calls=await mockApp(page,{deployed:false});
 await signIn(page);
 await expect(page.locator('#ledgerRoot')).toBeVisible();
 await expect.poll(()=>calls.filter(c=>c.action==='ledger_status').length,{timeout:10000}).toBeGreaterThan(0);
 await expect(page.locator('#ledgerExportRoot')).toBeHidden();
 expect(calls.filter(c=>c.method==='POST')).toHaveLength(0);
});
