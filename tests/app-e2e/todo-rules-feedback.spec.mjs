// TODO-이미함·환류 4.3·5절: 내 프로필 '챙길 것 기준'의 거르기 규칙(확정·후보 [ㅇ][×][고쳐서 확정]·뺀 것 [다시 후보로])과
// [규칙 후보 보기](ai-assist kind=todo_rules_review, {kind}만 보냄), 지난주 비율 한 줄. 서버는 모두 가짜. 가상 문장만.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { signInWithSession } from './helpers/session-login.mjs';

const origin=appOrigin;
const R=n=>`d0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function boot(page){
  const state={rules:[{id:R(1),text:'가상 공지는 올리지 않음.',state:'confirmed',created_at:'2026-10-20T00:00:00Z',decided_at:'2026-10-20T00:00:00Z'},
    {id:R(2),text:'가상 단체방 안내는 올리지 않음.',state:'candidate',created_at:'2026-10-21T00:00:00Z',decided_at:null},
    {id:R(3),text:'가상 마감 요청은 놓치지 않음.',state:'candidate',created_at:'2026-10-22T00:00:00Z',decided_at:null}],patches:[],ai:[]};
  const user={id:'todo-rules-user',email:'todo-rules@example.org'},workspace={id:'todo-rules-workspace',name:'QA',slug:'qa'};
  const lastWeek=new Date(Date.now()-7*86400000).toISOString();
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();let data=[];
    if(path==='/auth/v1/token')data={access_token:'qa',refresh_token:'qa-refresh',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,user};
    else if(path==='/auth/v1/user')data=user;
    else if(path==='/rest/v1/app_workspace_members')data=[{workspace_id:workspace.id,user_id:user.id,role:'owner'}];
    else if(path==='/rest/v1/app_workspaces')data=[workspace];
    else if(path==='/rest/v1/app_profiles')data=[{user_id:user.id,display_name:'QA'}];
    else if(path==='/rest/v1/app_todo_feedback')data=[{outcome:'done',summary:'가상',edited:null,created_at:lastWeek}];
    else if(path==='/rest/v1/app_todo_rules'&&method==='GET')data=state.rules;
    else if(path==='/rest/v1/app_todo_rules'&&method==='PATCH'){
      const body=req.postDataJSON(),id=url.searchParams.get('id').slice(3),from=url.searchParams.get('state').slice(3);state.patches.push({id,from,body});
      const r=state.rules.find(x=>x.id===id&&x.state===from);if(r)Object.assign(r,body);data=r?[{id:r.id,state:r.state}]:[];
    }
    else if(path==='/functions/v1/ai-assist'){
      const body=JSON.parse(req.postData()||'{}');state.ai.push(body);
      if(body.kind==='todo_rules_review'){state.rules.push({id:R(9),text:'가상 새 후보.',state:'candidate',created_at:'2026-10-23T00:00:00Z',decided_at:null});data={ok:true,kind:'todo_rules_review',added:1};}
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
const panel=page=>page.locator('#psTodoRulesPanel');

for(const width of [1440,412])test(`거르기 규칙: 확정·후보 [ㅇ][×][고쳐서 확정], 뺀 것 [다시 후보로], [규칙 후보 보기], 지난주 비율 한 줄 (${width}px)`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const state=await boot(page);
  await expect(panel(page).locator('[data-ps-rules-confirmed] .ps-todo-room-name')).toHaveText(['가상 공지는 올리지 않음.'],{timeout:15000});
  await expect(panel(page).locator('[data-ps-rules-waiting] .ps-todo-room-name')).toHaveText(['가상 단체방 안내는 올리지 않음.','가상 마감 요청은 놓치지 않음.']);
  await expect(panel(page).locator('[data-ps-todo-week]')).toContainText(/^지난주 챙길 것 1건 · 이미 함 100%/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  // [ㅇ] → 확정
  await panel(page).getByRole('button',{name:'가상 단체방 안내는 올리지 않음. 확정'}).click();
  await expect(panel(page).locator('[data-ps-rule-note]')).toHaveText('확정했어요. 다음 찾기부터 써요.');
  expect(state.patches[0]).toMatchObject({id:R(2),from:'candidate',body:{state:'confirmed'}});
  // [고쳐서 확정]
  await panel(page).locator(`[data-ps-rule-edit="${R(3)}"]`).click();
  const input=panel(page).locator('[data-ps-rule-draft]');
  await input.fill('가상 마감 요청은 꼭 올림.');
  await panel(page).locator(`[data-ps-rule-save="${R(3)}"]`).click();
  await expect(panel(page).locator('[data-ps-rules-confirmed] .ps-todo-room-name')).toHaveText(['가상 공지는 올리지 않음.','가상 단체방 안내는 올리지 않음.','가상 마감 요청은 꼭 올림.']);
  expect(state.patches[1]).toMatchObject({id:R(3),from:'candidate',body:{state:'confirmed',text:'가상 마감 요청은 꼭 올림.'}});
  // 확정 [빼기] → 뺀 규칙 접힘 → [다시 후보로]
  await panel(page).getByRole('button',{name:'가상 공지는 올리지 않음. 빼기'}).click();
  await panel(page).locator('.ps-todo-rules-retired > summary').click();
  await panel(page).locator(`[data-ps-rule-back="${R(1)}"]`).click();
  await expect(panel(page).locator('[data-ps-rules-waiting] .ps-todo-room-name')).toHaveText(['가상 공지는 올리지 않음.']);
  // [규칙 후보 보기]: {kind}만 보낸다
  await panel(page).locator('[data-ps-rule-review]').click();
  await expect(panel(page).locator('[data-ps-rule-note]')).toHaveText('새 후보 1개를 만들었어요.');
  expect(state.ai.filter(b=>b.kind==='todo_rules_review')).toEqual([{kind:'todo_rules_review'}]);
  await expect(panel(page).locator('[data-ps-rules-waiting] .ps-todo-room-name')).toHaveText(['가상 공지는 올리지 않음.','가상 새 후보.']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
