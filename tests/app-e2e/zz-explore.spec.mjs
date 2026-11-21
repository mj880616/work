import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'u1',email:'qa@example.org',user_metadata:{display_name:'QA'}};
const workspace={id:'w1',slug:'w',name:'웹2'};
async function mockApp(page){
  await page.route(`${SB}/**`,async route=>{
    const url=new URL(route.request().url());const path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'a',refresh_token:'r',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'QA'}]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}
const W=Number(process.env.SHOTW||390);
for(const v of ['home','meetings','team','calendar','note']){
 test('shot '+v,async({page})=>{
  await page.setViewportSize({width:W,height:800}); if(process.env.DARK)await page.emulateMedia({colorScheme:'dark'});
  await installViewPrefsServer(page,null);
  await mockApp(page);
  const q=v==='note'?'view=basket&pane=note':'view='+v;
  await page.goto(`${appOrigin}/app/?${q}`);
  await enterLogin(page);
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  await page.waitForTimeout(1200);
  const info=await page.evaluate(()=>{const out=[];const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<140&&r.bottom>0&&getComputedStyle(e).visibility!=='hidden'};
   for(const e of document.querySelectorAll('#appView *')){if(!vis(e))continue;const r=e.getBoundingClientRect();if(e.children.length&&e.tagName!=='BUTTON'&&e.tagName!=='SELECT'&&e.tagName!=='A'&&!e.matches('.mobile-shell-header,.report-top,.report-top-line,.report-kind-bar,[data-journal-head],header'))continue;out.push(`${e.tagName.toLowerCase()}#${e.id}.${String(e.className).slice(0,40)} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}] ${(e.textContent||'').trim().slice(0,20)}`)}return out.join('\n')});
  console.log('=== '+v+'\n'+info);
  await page.screenshot({path:`/tmp/claude-0/shots/${process.env.TAG||'before'}-${W}-${v}.png`});
 });
}
