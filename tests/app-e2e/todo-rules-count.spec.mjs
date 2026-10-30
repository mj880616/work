// TODO-쌓인후보건수(요청함 10/30): 내 프로필 '챙길 것 기준'의 쌓인 후보 줄에 지금 대기 중 후보 건수.
// 'n건 [새 기준으로 다시 거르기]', 0건이면 '쌓인 후보 없음'(버튼 없음), 다시 거른 뒤 'n건 중 m건을 무시함으로 옮겼어요' 한 줄.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { signInWithSession } from './helpers/session-login.mjs';

const origin=appOrigin;
async function boot(page,{open=12,dismissed=3}={}){
  const state={open,recheck:0};
  const user={id:'todo-count-user',email:'todo-count@example.org'},workspace={id:'todo-count-workspace',name:'QA',slug:'qa'};
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;let data=[];
    if(path==='/auth/v1/token')data={access_token:'qa',refresh_token:'qa-refresh',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,user};
    else if(path==='/auth/v1/user')data=user;
    else if(path==='/rest/v1/app_workspace_members')data=[{workspace_id:workspace.id,user_id:user.id,role:'owner'}];
    else if(path==='/rest/v1/app_workspaces')data=[workspace];
    else if(path==='/rest/v1/app_profiles')data=[{user_id:user.id,display_name:'QA'}];
    else if(path==='/rest/v1/app_todo_candidates'&&url.searchParams.get('select')==='id'&&url.searchParams.get('status')==='eq.open')
      data=Array.from({length:state.open},(_,i)=>({id:`c${i}`}));
    else if(path==='/functions/v1/ai-assist'){
      const body=JSON.parse(req.postData()||'{}');
      if(body.kind==='todo_recheck'){state.recheck++;const checked=state.open;state.open-=dismissed;data={ok:true,kind:'todo_recheck',checked,dismissed,more:false}}
      else data={ok:false,error:'not_ready'};
    }
    else if(path==='/functions/v1/push-notifications')data={enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'};
    else if(path.startsWith('/functions/'))data={connected:false,enabled:false,tasks:[],events:[],calendars:[]};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(origin+'/app/login/?return='+encodeURIComponent(origin+'/app/?view=profile'));
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(page.locator('#profileView')).toBeVisible({timeout:15000});
  return state;
}
const row=page=>page.locator('#psTodoRulesPanel [data-ps-todo-open]');

for(const width of [1440,412])test(`쌓인 후보 건수와 다시 거른 결과 한 줄 (${width}px)`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const state=await boot(page,{open:12,dismissed:3});
  await expect(row(page)).toHaveText('쌓인 후보 12건',{timeout:15000});
  const button=page.locator('#psTodoRulesPanel [data-ps-todo-recheck]');
  await expect(button).toHaveText('새 기준으로 다시 거르기');
  // 건수와 버튼은 같은 한 줄
  const same=await page.evaluate(()=>{const a=document.querySelector('#psTodoRulesPanel [data-ps-todo-open]').getBoundingClientRect(),b=document.querySelector('#psTodoRulesPanel [data-ps-todo-recheck]').getBoundingClientRect();return Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)<=6});
  expect(same).toBe(true);
  await button.click();
  await expect(page.locator('#psTodoRulesPanel [data-ps-todo-result]')).toHaveText('12건 중 3건을 무시함으로 옮겼어요.');
  await expect(row(page)).toHaveText('쌓인 후보 9건');
  expect(state.recheck).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.locator('#psTodoRulesPanel').screenshot({path:`test-results/todo-rules-count-${width}.png`});
});

for(const width of [1440,412])test(`쌓인 후보가 없으면 '쌓인 후보 없음' 한 줄, 버튼 없음 (${width}px)`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await boot(page,{open:0});
  await expect(row(page)).toHaveText('쌓인 후보 없음',{timeout:15000});
  await expect(page.locator('#psTodoRulesPanel [data-ps-todo-recheck]')).toHaveCount(0);
  await expect(page.locator('#psTodoRulesPanel [data-ps-todo-result]')).toHaveCount(0);
});
