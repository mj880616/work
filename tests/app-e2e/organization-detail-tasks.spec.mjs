import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

// TASK-조직상세 and TASK-조직순서 in the whole app: the organization detail shows the Google tasks linked to the organization,
// adds a task already linked to it and links an existing one; the list and the editor follow the shared order.
const TEST_ORIGIN=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}};
const kstDateKey=(offset=0)=>new Date(Date.now()+9*60*60*1000+offset*24*60*60*1000).toISOString().slice(0,10);
const gt=(id,due,extra={})=>({id,title:id,taskListId:'@default',taskListTitle:'내 할 일',due:due===null?null:`${kstDateKey(due)}T00:00:00.000Z`,status:'needsAction',source:'google-task',...extra});
const NAMES=['공항철도지부','용인경전철지부','서울교통공사9호선지부','인천교통공사노동조합','신분당선지부','전국철도노동조합','메트로9호선노동조합','부산지하철노동조합','김포도시철도지부','서해선지부','대구교통공사노동조합','지티엑스에이운영지부','서울교통공사노동조합','국민연금지부'];
const orgs=NAMES.map((name,i)=>({id:'o'+i,workspace_id:'qa-ws',name,organization_type:'미분류',default_assignee_name:null,created_by:'qa-user',active:true,aliases:[]}));
const RAIL='o5';
const ORDERED=['전국철도노동조합','|','서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합','인천교통공사노동조합','|','서해선지부','신분당선지부','지티엑스에이운영지부','공항철도지부','|','메트로9호선노동조합','서울교통공사9호선지부','|','김포도시철도지부','용인경전철지부','|','국민연금지부'];

async function mock(page,calls){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,q=u.search;
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    if(p==='/auth/v1/token')return ok({access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user});
    if(p==='/auth/v1/user')return ok(user);
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'qa-ws',user_id:'qa-user',role:'owner',workspace:{id:'qa-ws',slug:'qa',name:'웹2'}}]);
    if(p==='/rest/v1/app_workspaces')return ok([{id:'qa-ws',name:'웹2'}]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:'qa-user',display_name:'QA'}]);
    if(p==='/rest/v1/app_spaces')return ok([{id:'p1',workspace_id:'qa-ws',owner_id:'qa-user',name:'민자철도',parent_id:null,status:'active',sort_order:1,metadata:{project_system:'v2'}}]);
    if(p==='/rest/v1/app_suborganizations'){
      const id=u.searchParams.get('id')?.replace(/^eq\./,'');
      return ok(id?orgs.filter(o=>o.id===id):orgs);
    }
    if(p==='/rest/v1/app_suborganization_assignees'){
      if(u.searchParams.get('organization_id'))return ok([{user_id:'qa-user'}]);
      if(u.searchParams.get('user_id'))return ok(orgs.map(o=>({organization_id:o.id})));
      return ok(orgs.map(o=>({organization_id:o.id,user_id:'qa-user',assigned_by:'qa-user',created_at:'2026-09-15T00:00:00Z'})));
    }
    if(p==='/functions/v1/google-tasks'){
      const action=u.searchParams.get('action'),body=req.method()==='GET'?{}:JSON.parse(req.postData()||'{}');
      calls.push({action,query:Object.fromEntries(u.searchParams),body});
      if(action==='linked')return ok({tasks:[gt('org-pending',2),gt('org-undated',null),gt('org-done',0,{status:'completed',completed:new Date().toISOString()})]});
      if(action==='links')return ok({links:[],meeting_links:[]});
      if(action==='unlinked')return ok({tasks:[gt('free-1',3)]});
      if(action==='create')return ok({ok:true,task:gt('new-1',1)});
      if(action==='link')return ok({ok:true});
      return ok({connected:true,authorized:true,needs_reconnect:false,pending_scope:'all',tasks:[]});
    }
    if(p==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,calendars:[],events:[]});
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
}

async function openTeam(page,calls){
  await mock(page,calls);
  await page.goto(loginEntry(`${TEST_ORIGIN}/app/`));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
  await page.locator('.app-nav [data-view="team"]').click();
  await expect(page.locator('#soOrganizationList .so-card')).toHaveCount(orgs.length,{timeout:10000});
}
const sequence=(locator,item)=>locator.evaluate((box,item)=>[...box.children].map(el=>el.classList.contains('so-org-sep')||el.classList.contains('gt-org-sep')?'|':el.querySelector(item)?.firstChild?.textContent?.trim()),item);

test('담당조직 상세에서 연결된 할 일을 보고, 이 조직으로 할 일을 추가하고, 기존 할 일을 연결한다',async({page})=>{
  const calls=[];
  await openTeam(page,calls);
  expect(await sequence(page.locator('#soOrganizationList'),'h4')).toEqual(ORDERED);
  await page.locator(`[data-so-org="${RAIL}"]`).click();
  await expect(page.locator('#wdModal')).toBeVisible();
  const body=page.locator('#wdTaskBody');
  await expect(body.locator('[data-google-task]')).toHaveCount(3);
  await expect(page.locator('#wdTasks h3')).toHaveText('할 일 2');
  expect(calls.filter(c=>c.action==='linked').map(c=>c.query.organization_id)).toEqual([RAIL]);
  // Completed in the last 3 days shows dimmed in the same list; undated pending is shown (decision 3).
  await expect(body.locator('[data-google-task="org-done"]')).toHaveClass(/completed/);
  await expect(body.locator('[data-google-task="org-undated"]')).toContainText('기한 미정');

  await page.locator('#wdTaskAdd').click();
  const editor=page.locator('#gtTaskModal');
  await expect(editor).toBeVisible();
  // The editor opens above the organization detail.
  expect(await editor.locator('#gtEditTitle').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})).toBe(true);
  await expect(page.locator('#gtEditTitle')).toBeFocused();
  const orgGroup=page.locator('#gtEditLinkBody [role="group"][aria-label="조직"]');
  expect(await sequence(orgGroup,'span').then(x=>x.slice(1))).toEqual(ORDERED);
  await expect(orgGroup.locator(`input[value="o:${RAIL}"]`)).toBeChecked();
  await page.locator('#gtEditTitle').fill('조직에서 만든 할 일');
  await page.locator('#gtSaveBtn').click();
  await expect(editor).toBeHidden();
  expect(calls.find(c=>c.action==='create')?.body).toEqual(expect.objectContaining({title:'조직에서 만든 할 일',links:[{organization_id:RAIL}]}));
  // Saving refreshes the open organization list.
  await expect.poll(()=>calls.filter(c=>c.action==='linked').length).toBe(2);
  await expect(page.locator('#wdTaskAdd')).toBeFocused();

  await page.locator('#wdTaskLink').click();
  const picker=page.locator('#gtPickModal');
  await expect(picker).toBeVisible();
  await picker.locator('[data-gt-pick="free-1"]').click();
  await expect(picker.locator('[data-gt-pick="free-1"]')).toHaveText('연결됨');
  expect(calls.find(c=>c.action==='link')?.body).toEqual(expect.objectContaining({task_id:'free-1',links:[{organization_id:RAIL}]}));
  await picker.locator('[data-gt-pick-close]').click();
  await expect(picker).toBeHidden();

  // Closed: the box is emptied, so a later change elsewhere does not ask Google for this organization again.
  await page.locator('[data-wd-close="wdModal"]').click();
  await expect(page.locator('#wdModal')).toBeHidden();
  await expect(page.locator('#wdTaskBody')).toBeEmpty();
});

test('담당조직 목록·상세·편집창은 412px와 1280px에서 가로로 넘치지 않는다',async({page})=>{
  const calls=[];
  for(const width of [412,1280]){
    await page.setViewportSize({width,height:900});
    if(!calls.length)await openTeam(page,calls);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),`list at ${width}px`).toBeLessThanOrEqual(1);
    await page.locator(`[data-so-org="${RAIL}"]`).click();
    await expect(page.locator('#wdTaskBody [data-google-task]')).toHaveCount(3);
    const fits=await page.locator('#wdTasks').evaluate(sec=>{const s=sec.getBoundingClientRect();return [...sec.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return r.width===0||(r.left>=s.left-1&&r.right<=s.right+1)})});
    expect(fits,`task section buttons at ${width}px`).toBe(true);
    await page.locator('#wdTaskAdd').click();
    await expect(page.locator('#gtTaskModal')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth),`editor at ${width}px`).toBeLessThanOrEqual(1);
    await page.locator('#gtTaskModal [data-gt-close]').click();
    await page.locator('[data-wd-close="wdModal"]').click();
  }
});
