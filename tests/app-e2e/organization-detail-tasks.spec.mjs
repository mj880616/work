import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

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
const ORDERED=['전국철도노동조합','|','서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합','인천교통공사노동조합','|','서해선지부','신분당선지부','지티엑스에이운영지부','공항철도지부','|','메트로9호선노동조합','서울교통공사9호선지부','김포도시철도지부','용인경전철지부','|','국민연금지부'];

async function mock(page,calls){
  const data=[...orgs,...Array.from({length:calls.extraOrganizations||0},(_,i)=>({...orgs[0],id:'extra-'+i,name:'기타 조직 '+i}))];
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,q=u.search;
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    const paged=rows=>{const offset=Number(u.searchParams.get('offset')||0),limit=u.searchParams.get('limit');return rows.slice(offset,limit===null?undefined:offset+Number(limit))};
    if(p==='/auth/v1/token')return ok({access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user});
    if(p==='/auth/v1/user')return ok(user);
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'qa-ws',user_id:'qa-user',role:'owner',workspace:{id:'qa-ws',slug:'qa',name:'웹2'}}]);
    if(p==='/rest/v1/app_workspaces')return ok([{id:'qa-ws',name:'웹2'}]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:'qa-user',display_name:'QA'}]);
    if(p==='/rest/v1/app_spaces')return ok([{id:'p1',workspace_id:'qa-ws',owner_id:'qa-user',name:'민자철도',parent_id:null,status:'active',sort_order:1,metadata:{project_system:'v2'}}]);
    if(p==='/rest/v1/app_suborganizations'){
      const id=u.searchParams.get('id')?.replace(/^eq\./,'');
      return ok(paged(id?data.filter(o=>o.id===id):data));
    }
    if(p==='/rest/v1/app_suborganization_assignees'){
      if(u.searchParams.get('organization_id'))return ok([{user_id:'qa-user'}]);
      if(u.searchParams.get('user_id'))return ok(paged(data.map(o=>({organization_id:o.id}))));
      return ok(paged(data.map(o=>({organization_id:o.id,user_id:'qa-user',assigned_by:'qa-user',created_at:'2026-09-15T00:00:00Z'}))));
    }
    if(calls.summary&&p==='/rest/v1/app_record_links'){calls.push({action:'record-links',query:Object.fromEntries(u.searchParams),noteWindow:u.searchParams.getAll('note.occurred_at')});return ok([{google_task_id:'summary-pending',organization_id:RAIL,status:'confirmed'},{google_task_id:'summary-done',organization_id:RAIL,status:'confirmed'}])}
    if(calls.summary&&p==='/rest/v1/app_suborganization_updates'){calls.push({action:'updates',query:Object.fromEntries(u.searchParams)});return ok([{organization_id:RAIL,occurred_at:'2026-01-09T00:00:00Z',raw_text:'old'}])}
    if(p==='/functions/v1/google-tasks'){
      const action=u.searchParams.get('action'),body=req.method()==='GET'?{}:JSON.parse(req.postData()||'{}');
      calls.push({action,query:Object.fromEntries(u.searchParams),body});
      if(calls.summary&&action==='overview')return ok({connected:true,authorized:true,pending_scope:'all',tasks:[gt('summary-pending',-1),gt('summary-done',0,{status:'completed',completed:new Date().toISOString()})]});
      if(action==='linked')return ok({tasks:[gt('org-pending',2),gt('org-undated',null),gt('org-done',0,{status:'completed',completed:new Date().toISOString()})]});
      if(action==='links')return ok({links:[],meeting_links:[]});
      if(action==='unlinked')return ok({tasks:[gt('free-1',3)]});
      if(action==='create')return ok({ok:true,task:gt('new-1',1),links:body.links.map(t=>({...t,google_task_id:'new-1',status:'confirmed'})),meeting_links:[]});
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
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
  await clickView(page,'team');
  await expect(page.locator('#soOrganizationList .so-card')).toHaveCount(orgs.length+(calls.extraOrganizations||0),{timeout:10000});
}
const sequence=(locator,item)=>locator.evaluate((box,item)=>[...box.querySelectorAll(':scope>.so-org-group,:scope>.gt-org-group')].flatMap((g,i)=>[...(i?['|']:[]),...[...g.querySelectorAll(item)].map(el=>el.firstChild?.textContent?.trim())]),item);

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
  expect(await sequence(orgGroup,'span')).toEqual(ORDERED);
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
  // ORG-PC좌우: at this PC width the detail is the right pane (no ×); leaving the 담당조직 screen closes it.
  await clickView(page,'home');
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
    // ORG-PC좌우: on a PC the detail is the right pane and has no ×.
    if(width<1024)await page.locator('[data-wd-close="wdModal"]').click();
  }
});

for(const extra of [0,100])test(`담당조직 ${14+extra}개도 Google·기록 요청은 일괄이며 실제 모듈로 숫자를 채운다`,async({page})=>{
  const calls=[];calls.summary=true;calls.extraOrganizations=extra;
  await openTeam(page,calls);
  const rail=page.locator(`[data-so-org="${RAIL}"]`);
  // UI-디자인기준 3/3(2026-10-16 사용자 결정): the list shows no task count; the dot keeps the latest record (KST 1.9).
  await expect(rail.locator('.so-task-count')).toHaveCount(0);
  await expect(rail.locator('[data-so-dot]')).toHaveAttribute('data-so-at',/./);
  expect(await rail.locator('[data-so-dot]').evaluate(t=>{const d=new Date(Date.parse(t.dataset.soAt)+9*3600000).toISOString();return Number(d.slice(5,7))+'.'+Number(d.slice(8,10))})).toBe('1.9');
  await page.waitForFunction(()=>window.KPTUHome?.metrics?.readyAt>0);
  // The list itself asks Google for no organization; on a PC (ORG-PC좌우) only the detail opened on the right (the first
  // organization in the list, 전국철도노동조합) asks for its own tasks.
  await expect.poll(()=>calls.filter(c=>c.action==='linked').map(c=>c.query.organization_id)).toEqual([RAIL]);
  // One home overview and one team overview; number of organizations does not change either bound.
  expect(calls.filter(c=>c.action==='overview').length).toBeLessThanOrEqual(2);
  // ORG-PC좌우: the detail opened on the right reads its own records (one organization, with text); the list reads stay batched.
  const isDetailRead=c=>c.query.organization_id===`in.(${RAIL})`&&/raw_text,kind,title/.test(c.query.select||'');
  expect(calls.filter(c=>c.action==='record-links'&&c.query.note_id==='not.is.null'&&isDetailRead(c)).length).toBeLessThanOrEqual(1);
  const noteReads=calls.filter(c=>c.action==='record-links'&&c.query.note_id==='not.is.null'&&!isDetailRead(c));
  const taskReads=calls.filter(c=>c.action==='record-links'&&c.query.note_id!=='not.is.null');
  expect(taskReads.length).toBeLessThanOrEqual(3);
  const ids=[...orgs.map(o=>o.id),...Array.from({length:extra},(_,i)=>'extra-'+i)];
  const batchCount=Math.ceil(ids.length/100);
  const homeProjection='id,workspace_id,summary,note_id,organization_id,project_id,status,note:app_notes!inner(id,workspace_id,occurred_at,raw_text)';
  const dateProjection='id,workspace_id,note_id,organization_id,project_id,status,note:app_notes!inner(id,workspace_id,occurred_at)';
  const homeReads=noteReads.filter(r=>r.query.select===homeProjection);
  const dateReads=noteReads.filter(r=>r.query.select===dateProjection);
  expect(noteReads).toHaveLength(batchCount);
  expect(homeReads).toHaveLength(0);
  expect(dateReads).toHaveLength(batchCount);
  const assertBatches=reads=>{
    const batches=reads.map(r=>r.query.organization_id.slice(4,-1).split(','));
    expect(batches.map(b=>b.length)).toEqual(Array.from({length:batchCount},(_,i)=>Math.min(100,ids.length-i*100)));
    expect(batches.flat()).toEqual(ids);
    for(const read of reads)expect(read.query.offset).toBe('0');
  };
  assertBatches(dateReads);
  for(const read of noteReads){
    expect(read.query).toEqual(expect.objectContaining({workspace_id:'eq.qa-ws',status:'eq.confirmed',note_id:'not.is.null',limit:'100'}));
    expect(read.query.organization_id).toMatch(/^in\./);
    expect(read.query['note.workspace_id']).toBe('eq.qa-ws');
  }
  for(const read of dateReads){expect(read.noteWindow).toEqual([]);expect(read.query.select).not.toMatch(/raw_text|summary/);}
  const reads=calls.filter(c=>c.action==='updates'&&c.query.select==='organization_id,occurred_at');
  expect(reads).toHaveLength(batchCount);assertBatches(reads);
  for(const read of reads)expect(read.query.limit).toBe('500');
});
