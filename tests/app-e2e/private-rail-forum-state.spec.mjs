import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SESSION_KEY='kptu_collab_session_v1';
const user={id:'forum-state-user',email:'forum@example.org',user_metadata:{display_name:'Forum QA'}};
const workspaceId='11111111-1111-4111-8111-111111111111';

async function seedSession(page){
  await page.addInitScript(({key,userId})=>{
    localStorage.setItem(key,JSON.stringify({
      access_token:'forum-access',
      refresh_token:'forum-refresh',
      expires_at:Math.floor(Date.now()/1000)+3600,
      user:{id:userId}
    }));
  },{key:SESSION_KEY,userId:user.id});
}

function json(route,data,status=200){
  return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
}

test('9.29 forum checklist loads and saves shared state through authenticated server persistence',async({page})=>{
  await seedSession(page);
  const writes=[];
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    if(path==='/auth/v1/user')return json(route,user);
    if(path==='/auth/v1/token')return json(route,{access_token:'forum-access-2',refresh_token:'forum-refresh-2',expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/rest/v1/app_workspace_members')return json(route,[{workspace_id:workspaceId,user_id:user.id,role:'editor'}]);
    if(path==='/rest/v1/app_internal_checklist_items'&&req.method()==='GET')return json(route,[
      {workspace_id:workspaceId,checklist:'private-rail-forum-0929',item_key:'field-seohae',checked:true,memo:'서버에서 불러온 메모'}
    ]);
    if(path==='/rest/v1/app_internal_checklist_items'&&req.method()==='POST'){
      writes.push(req.postDataJSON());
      return route.fulfill({status:201,contentType:'application/json',body:'[]'});
    }
    if(path==='/rest/v1/app_internal_checklist_items'&&req.method()==='DELETE')return route.fulfill({status:204,body:''});
    return json(route,[]);
  });

  await page.goto('http://127.0.0.1:8123/private-rail/forum-0929/');

  const row=page.locator('[data-key="field-seohae"]');
  await expect(row.locator('input[type="checkbox"]')).toBeChecked({timeout:10000});
  await expect(row.locator('.memo')).toHaveValue('서버에서 불러온 메모');
  await expect(page.locator('#stateStatus')).toContainText('서버에 저장');

  const target=page.locator('[data-key="field-shinbundang"]');
  await target.locator('input[type="checkbox"]').check();
  await target.locator('.memo').fill('신분당선 서버 저장 메모');
  await target.locator('.memo').blur();

  await expect.poll(()=>writes.length,{timeout:10000}).toBeGreaterThanOrEqual(2);
  const flattened=writes.flatMap(x=>Array.isArray(x)?x:[x]);
  expect(flattened).toEqual(expect.arrayContaining([
    expect.objectContaining({workspace_id:workspaceId,checklist:'private-rail-forum-0929',item_key:'field-shinbundang',checked:true})
  ]));
  expect(flattened.some(x=>x.item_key==='field-shinbundang'&&x.memo==='신분당선 서버 저장 메모')).toBeTruthy();
});

test('9.29 forum checklist does not allow editing without a Web2 authenticated session',async({page})=>{
  let stateWrites=0;
  await page.route(`${SB}/**`,async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/rest/v1/app_internal_checklist_items')stateWrites++;
    return json(route,[],401);
  });

  await page.goto('http://127.0.0.1:8123/private-rail/forum-0929/');
  await expect(page.locator('#stateStatus')).toContainText('Web2 로그인', {timeout:10000});
  await expect(page.locator('.item input[type="checkbox"]').first()).toBeDisabled();
  await expect(page.locator('.item .memo').first()).toBeDisabled();
  expect(stateWrites).toBe(0);
});
