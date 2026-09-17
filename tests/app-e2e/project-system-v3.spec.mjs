import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();
const eq=(url,key)=>String(url.searchParams.get(key)||'').replace(/^eq\./,'');

async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner',created_at:now()}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'프로젝트 관리자'}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_space_members'){
      const pid=eq(url,'project_id');
      if(method==='GET')return ok(state.spaceMembers.filter(x=>!pid||x.project_id===pid));
      if(method==='DELETE'){state.spaceMembers=state.spaceMembers.filter(x=>x.project_id!==pid);return ok([])}
      if(method==='POST'){const rows=Array.isArray(body)?body:[body];state.spaceMembers.push(...rows);return ok(rows)}
    }
    if(path==='/rest/v1/app_spaces'){
      if(method==='GET'){const id=eq(url,'id');return ok(id?state.spaces.filter(x=>x.id===id):state.spaces)}
      if(method==='POST'){const row={...(body||{}),id:`project-${state.spaces.length+1}`,created_at:now(),updated_at:now()};state.spaces.push(row);return ok([row])}
      if(method==='PATCH'){const id=eq(url,'id'),row=state.spaces.find(x=>x.id===id);if(row)Object.assign(row,body||{});return ok([])}
      if(method==='DELETE'){const id=eq(url,'id');state.spaces=state.spaces.filter(x=>x.id!==id&&x.parent_id!==id);return ok([])}
    }
    const table=(name,arr,key='project_id')=>{
      if(path!==`/rest/v1/${name}`)return false;
      const pid=eq(url,key),id=eq(url,'id');
      if(method==='GET')return ok(arr.filter(x=>(!pid||x[key]===pid)&&(!id||x.id===id)));
      if(method==='POST'){const rows=(Array.isArray(body)?body:[body]).map((x,i)=>({...x,id:x.id||`${name}-${arr.length+i+1}`,created_at:now(),updated_at:now()}));arr.push(...rows);return ok(rows)}
      if(method==='PATCH'){const targets=id?arr.filter(x=>x.id===id):arr.filter(x=>!pid||x[key]===pid);targets.forEach(x=>Object.assign(x,body||{}));return ok([])}
      if(method==='DELETE'){if(id){const i=arr.findIndex(x=>x.id===id);if(i>=0)arr.splice(i,1)}return ok([])}
      return ok([]);
    };
    if(table('app_project_modules',state.modules))return;
    if(table('app_project_workstreams',state.workstreams))return;
    if(table('app_project_progress_updates',state.progress))return;
    if(table('app_project_milestones',state.milestones))return;
    if(table('app_project_decisions',state.decisions))return;
    if(table('app_project_comments',state.comments))return;
    if(table('app_tasks',state.tasks))return;
    if(table('app_events',state.events))return;
    if(table('app_meetings',state.meetings))return;
    if(table('app_documents',state.docs))return;
    if(table('app_pages',state.pages,'space_id'))return;
    if(path==='/rest/v1/app_event_attendees'||path==='/rest/v1/app_groups'||path==='/rest/v1/app_notifications')return ok([]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await page.goto(loginEntry(page.url()));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('owner@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}
function baseState(){return{
  user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'프로젝트 관리자'}},workspace:{id:'workspace-1',slug:'team',name:'공공기관사업팀 Workspace'},
  spaces:[
    {id:'main-1',workspace_id:'workspace-1',name:'민자철도 정책·조직사업',description:'민자철도 사업',parent_id:null,status:'active',visibility:'public',owner_id:'user-1',sort_order:10,metadata:{project_system:'v2',management_version:2,project_type:'ongoing',objective:'민자철도 안전·인력 제도개선',start_on:'2026-09-01'}},
    {id:'child-1',workspace_id:'workspace-1',name:'9.29 민자철도 국회토론회',description:'국회토론회',parent_id:'main-1',status:'active',visibility:'restricted',owner_id:'user-1',sort_order:20,metadata:{project_system:'v2',management_version:2,project_type:'event',objective:'국회 공론화',start_on:'2026-09-29'}}
  ],
  modules:[...['overview','progress','milestones','tasks','documents','decisions','pages','collaboration'].map((module_key,i)=>({id:`m-${i}`,project_id:'main-1',module_key,title:{overview:'개요',progress:'진행상황',milestones:'주요 일정',tasks:'할 일',documents:'자료',decisions:'회의·결정',pages:'게시',collaboration:'협업'}[module_key],enabled:true,sort_order:(i+1)*10})),...['overview','progress','milestones','tasks','documents','decisions','pages','collaboration'].map((module_key,i)=>({id:`cm-${i}`,project_id:'child-1',module_key,title:{overview:'개요',progress:'진행상황',milestones:'주요 일정',tasks:'할 일',documents:'자료',decisions:'회의·결정',pages:'게시',collaboration:'협업'}[module_key],enabled:true,sort_order:(i+1)*10}))],
  workstreams:[{id:'ws-1',project_id:'main-1',title:'정책·제도 대응',description:'운영기준 대응',phase:'in_progress',sort_order:10}],
  progress:[{id:'pr-1',project_id:'main-1',workstream_id:'ws-1',summary:'국토부 후속협의 준비',next_step:'9.29 토론회',status_label:'진행',effective_on:'2026-09-15',created_at:now()}],
  milestones:[{id:'mile-1',project_id:'main-1',workstream_id:'ws-1',title:'9.29 국회토론회',milestone_type:'policy',status:'planned',start_at:'2026-09-29T05:00:00Z',notes:'국토부·TS 참석'}],
  docs:[{id:'doc-1',project_id:'main-1',title:'민자철도 국토부 요구자료 답변',category:'정부자료',source:'국토교통부',document_date:'2026-09-14',tags:['민자철도','운영기준'],description:'인청 요구자료',drive_url:'https://example.org/doc'}],
  decisions:[],comments:[],tasks:[],events:[],meetings:[],pages:[],spaceMembers:[]
}}

test('V3 uses a compact child-project menu and child returns to parent',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await page.locator('[data-view="projects"]').click();
  await expect(page.locator('[data-ps3-project="main-1"]')).toBeVisible();
  await expect(page.locator('#projectGrid [data-project]')).toHaveCount(0);
  await page.locator('[data-ps3-project="main-1"]').first().click();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await expect(page.locator('.ps3-child-menu')).toBeVisible();
  await expect(page.locator('.ps3-child-section')).toHaveCount(0);
  await page.locator('.ps3-child-menu summary').click();
  await page.locator('.ps3-child-menu [data-ps3-project="child-1"]').click();
  await expect(page.locator('#ps3Hierarchy')).toContainText('하위 프로젝트');
  await expect(page.locator('.ps3-parent-link')).toContainText('민자철도 정책·조직사업');
  await page.locator('.ps3-parent-link').click();
  await expect(page.locator('#ps3Title')).toHaveText('민자철도 정책·조직사업');
});

test('V3 generated dialogs expose consistent accessibility semantics',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await page.locator('[data-view="projects"]').click();
  for(const id of ['ps3DetailModal','ps3CreateModal','ps3WorkstreamModal','ps3ProgressModal','ps3MilestoneModal','ps3DeleteModal','ps3AccessModal','ps3ArchiveModal']){
    const modal=page.locator('#'+id);
    await expect(modal).toHaveAttribute('role','dialog');
    await expect(modal).toHaveAttribute('aria-modal','true');
    const labelledby=await modal.getAttribute('aria-labelledby');
    expect(labelledby,id).toBeTruthy();
    await expect(page.locator('#'+labelledby)).toHaveCount(1);
    await expect(modal.locator('[data-ps3-close]').first()).toHaveAttribute('aria-label','닫기');
  }
});

test('V3 detail and edit dialogs manage focus, Escape, and trigger restoration',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await page.locator('[data-view="projects"]').click();
  const card=page.locator('[data-ps3-project="main-1"]').first();
  await card.focus();await card.click();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await expect(page.locator('#ps3DetailModal .ps3-modal-head [data-ps3-close]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ps3DetailModal')).toHaveClass(/hidden/);
  await expect(card).toBeFocused();

  await card.click();
  const wsTrigger=page.locator('[data-ps3-add-ws]');
  await wsTrigger.focus();await wsTrigger.click();
  await expect(page.locator('#ps3WsTitle')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ps3WorkstreamModal')).toHaveClass(/hidden/);
  await expect(wsTrigger).toBeFocused();

  const milestoneTrigger=page.locator('[data-ps3-add-milestone]');
  await milestoneTrigger.focus();await milestoneTrigger.click();
  await expect(page.locator('#ps3MilestoneTitle')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ps3MilestoneModal')).toHaveClass(/hidden/);
  await expect(milestoneTrigger).toBeFocused();
});

test('V3 child project details use native keyboard disclosure behavior',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await page.locator('[data-view="projects"]').click();
  await page.locator('[data-ps3-project="main-1"]').first().click();
  const details=page.locator('.ps3-child-menu'),summary=details.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open','');
  await page.keyboard.press('Tab');
  await expect(details.locator('[data-ps3-project="child-1"]')).toBeFocused();
});

test('V3 creates and edits a project with the same final renderer',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await page.locator('[data-view="projects"]').click();
  await page.locator('#newProjectBtn').click();await expect(page.locator('#ps3CreateModal')).toBeVisible();
  await page.locator('#ps3CreateType').selectOption('campaign');await page.locator('#ps3CreateName').fill('인력확충 투쟁');await page.locator('#ps3CreateObjective').fill('안전·공공서비스 인력확충');await page.locator('#ps3CreateSave').click();
  await expect.poll(()=>state.spaces.some(x=>x.name==='인력확충 투쟁')).toBeTruthy();
  const made=state.spaces.find(x=>x.name==='인력확충 투쟁');
  await expect.poll(()=>state.workstreams.filter(x=>x.project_id===made.id).length).toBe(5);
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await page.locator('[data-ps3-edit-project]').click();
  await expect(page.locator('#ps3CreateHeading')).toHaveText('프로젝트 수정');
  await page.locator('#ps3CreateName').fill('인력확충 공동투쟁');
  await page.locator('#ps3CreateEnd').fill('2026-10-24');
  await page.locator('#ps3CreateSave').click();
  await expect.poll(()=>state.spaces.find(x=>x.id===made.id)?.name).toBe('인력확충 공동투쟁');
  await expect(page.locator('#ps3Title')).toHaveText('인력확충 공동투쟁');
});

test('V3 edits and deletes a key schedule and filters project documents',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3DetailModal')).toBeVisible({timeout:10000});
  await page.locator('[data-ps3-edit-milestone="mile-1"]').click();await expect(page.locator('#ps3MilestoneModal')).toBeVisible();
  await page.locator('#ps3MilestoneTitle').fill('9.29 민자철도 국회토론회 확정');await page.locator('#ps3MilestoneSave').click();
  await expect.poll(()=>state.milestones[0].title).toBe('9.29 민자철도 국회토론회 확정');
  await page.locator('[data-ps3-edit-milestone="mile-1"]').click();page.once('dialog',d=>d.accept());await page.locator('#ps3MilestoneDelete').click();
  await expect.poll(()=>state.milestones.length).toBe(0);
  await expect(page.locator('#ps3-documents')).toContainText('민자철도 국토부 요구자료 답변');
  await page.locator('[data-ps3-doc-filter="정부자료"]').click();await expect(page.locator('.ps3-doc-card')).toHaveCount(1);
  await page.locator('#ps3DocSearch').fill('없는자료');await expect(page.locator('.ps3-doc-card')).toHaveCount(0);
});

test('V3 archives and restores without returning to a legacy project screen',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('[data-ps3-archive-project]')).toBeVisible({timeout:10000});
  page.once('dialog',d=>d.accept());await page.locator('[data-ps3-archive-project]').click();
  await expect.poll(()=>state.spaces.find(x=>x.id==='main-1')?.status).toBe('archived');
  await expect(page.locator('#ps3DetailModal')).toBeHidden();
  await page.locator('#ps3ArchiveBtn').click();
  await expect(page.locator('#ps3ArchiveModal')).toBeVisible();
  await expect(page.locator('[data-ps3-restore="main-1"]')).toBeVisible();
  await page.locator('[data-ps3-restore="main-1"]').click();
  await expect.poll(()=>state.spaces.find(x=>x.id==='main-1')?.status).toBe('active');
});

test('V3 exposes project delete in final renderer',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('[data-ps3-delete-project]')).toBeVisible({timeout:10000});
  await page.locator('[data-ps3-delete-project]').click();await expect(page.locator('#ps3DeleteModal')).toBeVisible();
  await page.locator('#ps3DeleteConfirm').click();await expect.poll(()=>state.spaces.some(x=>x.id==='main-1')).toBeFalsy();
  await expect(page.locator('#ps3DetailModal')).toBeHidden();
});
