import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { watchRetiredCollaboration } from './helpers/retired-collaboration.mjs';
watchRetiredCollaboration(test);
import { enterLogin } from './helpers/login-entry.mjs';
import { calendarToday, addCalendarDays } from './helpers/calendar-today.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();
const eq=(url,key)=>String(url.searchParams.get(key)||'').replace(/^eq\./,'');

async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    const forcedFailure=(bucket,key)=>{
      const value=bucket?.[key];
      if(!value)return null;
      if(typeof value==='number'){if(value<=0)return null;bucket[key]=value-1;return key+' forced failure'}
      return typeof value==='string'?value:key+' forced failure'
    };
    // sessionUser: the token carries the user like a real Supabase response; Google task code reads the owner from the session.
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(await page.evaluate(()=>Date.now())/1000)+3600,...(state.sessionUser?{user:state.user}:{})});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar'){
      const action=url.searchParams.get('action')||body?.action||'status';
      if(method==='POST'){
        state.googleCalls=state.googleCalls||[];
        state.callOrder=state.callOrder||[];
        state.googleCalls.push(body||{});
        state.callOrder.push('google:'+action);
        const failure=forcedFailure(state.googleFailures,action);
        if(failure)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:failure})});
        if(action==='delete-event')return ok({ok:true});
        const id=action==='update-event'?(body?.event_id||'google-updated'):`google-${state.googleCalls.filter(x=>x.action==='create-event').length}`;
        return ok({ok:true,event:{id,calendarId:body?.calendar_id||'primary'}});
      }
      if(action==='events')return ok({events:[],colors:state.googleStatus?.colors||{},eventColors:{}});
      return ok(state.googleStatus||{connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    }
    if(path==='/functions/v1/google-tasks'){
      const action=url.searchParams.get('action')||body?.action,taskId=body?.task_id||url.searchParams.get('task_id');
      state.gtCalls.push({action,body:body?structuredClone(body):null,query:Object.fromEntries(url.searchParams)});
      if(action==='overview'&&state.gtOverviewFail)return route.fulfill({status:500,contentType:'application/json',body:'{}'});
      const linkRow=(id,t)=>({google_task_id:id,project_id:t.project_id||null,organization_id:t.organization_id||null,status:'confirmed',task_completed:state.gtasks.find(x=>x.id===id)?.status==='completed'});
      const linksOf=id=>state.links.filter(x=>x.google_task_id===id).map(x=>({project_id:x.project_id||null,organization_id:x.organization_id||null,status:x.status||'confirmed',report_kind:null}));
      if(action==='linked'){const pid=url.searchParams.get('project_id'),ids=new Set(state.links.filter(x=>x.project_id===pid).map(x=>x.google_task_id));return ok({tasks:state.gtasks.filter(t=>ids.has(t.id)),removed:0})}
      if(action==='unlinked'){const linked=new Set(state.links.map(x=>x.google_task_id));return ok({tasks:state.gtasks.filter(t=>t.status!=='completed'&&!linked.has(t.id))})}
      if(action==='links')return ok({links:linksOf(taskId)});
      if(action==='link'){for(const t of body.links||[])state.links.push(linkRow(taskId,t));return ok({ok:true,links:linksOf(taskId)})}
      if(action==='unlink'){for(const t of body.links||[])state.links=state.links.filter(x=>!(x.google_task_id===taskId&&(t.project_id?x.project_id===t.project_id:x.organization_id===t.organization_id)));return ok({ok:true,links:linksOf(taskId)})}
      if(action==='create'){const task={id:'g-new-'+(state.gtasks.length+1),title:body.title,notes:body.notes||'',due:null,status:'needsAction',taskListId:'@default',taskListTitle:'내 할 일',source:'google-task'};state.gtasks.push(task);for(const t of body.links||[])state.links.push(linkRow(task.id,t));return ok({ok:true,task,links:linksOf(task.id)})}
      if(action==='toggle'){const task=state.gtasks.find(x=>x.id===taskId);if(state.gtToggleFail)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Google Tasks 요청 실패'})});Object.assign(task,{status:body.completed?'completed':'needsAction',completed:body.completed?now():null});return ok({ok:true,task})}
      if(action==='update'){const task=state.gtasks.find(x=>x.id===taskId);Object.assign(task,{title:body.title,notes:body.notes});return ok({ok:true,task})}
      return ok({connected:true,authorized:true,needs_reconnect:false,tasks:state.gtasks,pending_scope:'all'});
    }
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner',created_at:now()}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'프로젝트 관리자'}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);

    if(path==='/rest/v1/app_spaces'){
      if(method==='GET'){
        const id=url.searchParams.get('id')?.startsWith('eq.')?eq(url,'id'):'',owner=eq(url,'owner_id');let rows=id?state.spaces.filter(x=>x.id===id):state.spaces;rows=rows.filter(x=>!owner||x.owner_id===owner);
        if(url.searchParams.get('select')?.includes('progress:')){
          state.summaryQueries??=[];state.summaryQueries.push(Object.fromEntries(url.searchParams));
          if(state.summaryDelay)await state.summaryDelay;
          if(state.summaryFail)return route.fulfill({status:500,contentType:'application/json',body:'{}'});
          const ids=url.searchParams.get('id').slice(4,-1).split(',');
          return ok(rows.filter(x=>ids.includes(x.id)).map(x=>({id:x.id,
            progress:state.progress.filter(u=>u.project_id===x.id).sort((a,b)=>String(b.effective_on).localeCompare(String(a.effective_on))||String(b.created_at).localeCompare(String(a.created_at))).slice(0,1),
            milestones:state.milestones.filter(m=>m.project_id===x.id&&m.start_at>=url.searchParams.get('milestones.start_at').slice(4)&&!['done','completed','cancelled','canceled'].includes(m.status)).sort((a,b)=>a.start_at.localeCompare(b.start_at)).slice(0,1)})));
        }
        return ok(rows)
      }
      if(method==='POST'){const row={...(body||{}),id:`project-${state.spaces.length+1}`,created_at:now(),updated_at:now()};state.spaces.push(row);return ok([row])}
      if(method==='PATCH'){const id=eq(url,'id'),row=state.spaces.find(x=>x.id===id);if(row)Object.assign(row,body||{});return ok([])}
      if(method==='DELETE'){const id=eq(url,'id');state.spaces=state.spaces.filter(x=>x.id!==id&&x.parent_id!==id);return ok([])}
    }
    const table=(name,arr,key='project_id')=>{
      if(path!==`/rest/v1/${name}`)return false;
      state.restCalls=state.restCalls||[];state.callOrder=state.callOrder||[];
      state.restCalls.push({name,method,body:body?structuredClone(body):body});
      state.callOrder.push(name+':'+method);
      const failure=forcedFailure(state.restFailures,name+':'+method);
      if(failure){route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:failure})});return true}
      const raw=String(url.searchParams.get(key)||''),inList=raw.startsWith('in.(')?raw.slice(4,-1).split(',').map(decodeURIComponent):null,pid=inList?'':eq(url,key),id=eq(url,'id');
      if(method==='GET'){const rows=arr.filter(x=>(!pid||x[key]===pid)&&(!inList||inList.includes(x[key]))&&(!id||x.id===id));if(name==='app_project_progress_updates')rows.sort((a,b)=>String(b.effective_on||'').localeCompare(String(a.effective_on||''))||String(b.created_at||'').localeCompare(String(a.created_at||'')));return ok(rows)}
      if(method==='POST'){const rows=(Array.isArray(body)?body:[body]).map((x,i)=>({...x,id:x.id||`${name}-${arr.length+i+1}`,created_at:now(),updated_at:now()}));for(const row of rows){const existing=url.searchParams.get('on_conflict')==='id'?arr.find(x=>x.id===row.id):null;if(existing)Object.assign(existing,row);else arr.push(row)}return ok(rows)}
      if(method==='PATCH'){const targets=id?arr.filter(x=>x.id===id):arr.filter(x=>!pid||x[key]===pid);targets.forEach(x=>Object.assign(x,body||{}));return ok(req.headers()['prefer']?.includes('return=representation')?targets:[])}
      if(method==='DELETE'){const removed=[];if(id){const i=arr.findIndex(x=>x.id===id);if(i>=0)removed.push(...arr.splice(i,1))}return ok(req.headers()['prefer']?.includes('return=representation')?removed:[])}
      return ok([]);
    };
    if(table('app_project_templates',state.projectTypes||[],'workspace_id'))return;
    if(table('app_project_modules',state.modules))return;
    if(table('app_project_sections',state.sections||[]))return;
    if(table('app_project_blocks',state.blocks||[]))return;
    if(table('app_project_workstreams',state.workstreams))return;
    if(table('app_project_progress_updates',state.progress))return;
    if(table('app_project_milestones',state.milestones))return;
    if(table('app_project_decisions',state.decisions))return;
    if(table('app_project_comments',state.comments))return;
    if(table('app_tasks',state.tasks))return;
    // Project task counts read the completion copy of linked Google tasks (TASK-구현 PR 4).
    if(table('app_record_links',state.links.filter(x=>url.searchParams.get('task_completed')!=='eq.false'||x.task_completed===false)))return;
    if(table('app_events',state.events))return;
    if(table('app_meetings',state.meetings))return;
    if(table('app_documents',state.docs))return;
    if(table('app_pages',state.pages,'space_id'))return;
    if(path==='/rest/v1/app_groups'||path==='/rest/v1/app_notifications')return ok([]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await enterLogin(page);
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('owner@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}
async function openFold(page,id){
  const fold=page.locator('#'+id);
  await expect(fold).toBeVisible();
  if(await fold.getAttribute('open')===null)await fold.locator(':scope > summary').click();
  await expect(fold).toHaveAttribute('open','');
}
async function openMenu(page){
  const menu=page.locator('#ps3Menu .ps3-more');
  if(await menu.getAttribute('open')===null)await menu.locator(':scope > summary').click();
  await expect(menu).toHaveAttribute('open','');
}
function baseState(){return{
  user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'프로젝트 관리자'}},workspace:{id:'workspace-1',slug:'team',name:'웹2'},
  projectTypes:[
    {id:'type-ongoing',workspace_id:null,template_key:'ongoing',name:'상시사업·산업관리형',description:null,config:{suggested_workstreams:['정책·제도','조직·현장','교섭·투쟁','대외대응']},is_system:true,created_by:null,created_at:now()},
    {id:'type-campaign',workspace_id:null,template_key:'campaign',name:'쟁점·캠페인형',description:null,config:{suggested_workstreams:['정부대응','국회대응','현장조직화','공동행동','성과·후속']},is_system:true,created_by:null,created_at:now()},
    {id:'type-event',workspace_id:null,template_key:'event',name:'행사·집중사업형',description:null,config:{suggested_workstreams:['기획','섭외·참여','자료·선전','당일진행','결과·후속']},is_system:true,created_by:null,created_at:now()},
    {id:'type-knowledge',workspace_id:null,template_key:'knowledge',name:'자료·지식형',description:null,config:{suggested_workstreams:['정부자료','국회·법령','정책검토','현장자료']},is_system:true,created_by:null,created_at:now()},
    {id:'type-blank',workspace_id:null,template_key:'blank',name:'빈 프로젝트',description:null,config:{suggested_workstreams:[]},is_system:true,created_by:null,created_at:now()}
  ],
  spaces:[
    {id:'main-1',workspace_id:'workspace-1',name:'민자철도 정책·조직사업',description:'민자철도 사업',parent_id:null,status:'active',visibility:'public',owner_id:'user-1',sort_order:10,metadata:{project_system:'v2',management_version:2,project_type:'ongoing',objective:'민자철도 안전·인력 제도개선',start_on:'2026-09-01'}},
    {id:'child-1',workspace_id:'workspace-1',name:'9.29 민자철도 국회토론회',description:'국회토론회',parent_id:'main-1',status:'active',visibility:'restricted',owner_id:'user-1',sort_order:20,metadata:{project_system:'v2',management_version:2,project_type:'event',objective:'국회 공론화',start_on:'2026-09-29'}}
  ],
  modules:[...['overview','progress','milestones','tasks','documents','decisions','pages','collaboration'].map((module_key,i)=>({id:`m-${i}`,project_id:'main-1',module_key,title:{overview:'개요',progress:'진행상황',milestones:'주요 일정',tasks:'할 일',documents:'자료',decisions:'회의·결정',pages:'게시',collaboration:'협업'}[module_key],enabled:true,sort_order:(i+1)*10})),...['overview','progress','milestones','tasks','documents','decisions','pages','collaboration'].map((module_key,i)=>({id:`cm-${i}`,project_id:'child-1',module_key,title:{overview:'개요',progress:'진행상황',milestones:'주요 일정',tasks:'할 일',documents:'자료',decisions:'회의·결정',pages:'게시',collaboration:'협업'}[module_key],enabled:true,sort_order:(i+1)*10}))],
  workstreams:[{id:'ws-1',project_id:'main-1',title:'정책·제도 대응',description:'운영기준 대응',phase:'in_progress',sort_order:10}],
  progress:[{id:'pr-1',project_id:'main-1',workstream_id:'ws-1',summary:'국토부 후속협의 준비',next_step:'9.29 토론회',status_label:'진행',effective_on:'2026-09-15',created_at:now()}],
  milestones:[{id:'mile-1',project_id:'main-1',workstream_id:'ws-1',title:'9.29 국회토론회',milestone_type:'policy',status:'planned',start_at:'2026-09-29T05:00:00Z',notes:'국토부·TS 참석'}],
  docs:[{id:'doc-1',project_id:'main-1',title:'민자철도 국토부 요구자료 답변',category:'정부자료',source:'국토교통부',document_date:'2026-09-14',tags:['민자철도','운영기준'],description:'인청 요구자료',drive_url:'https://example.org/doc'}],
  decisions:[],comments:[],tasks:[],gtasks:[],links:[],gtCalls:[],sessionUser:false,events:[],meetings:[],pages:[],sections:[],blocks:[],
  googleStatus:{connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}},googleCalls:[],googleFailures:{},restFailures:{},restCalls:[],callOrder:[]
}}

test('project list loads and its heading uses available width at desktop, tablet and phone sizes',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
  await clickView(page,'projects');
  await expect(page.locator('#projectsView')).toBeVisible();
  await expect(page.locator('#projectGrid[data-ps3-ready="1"] .ps3-prow')).toHaveCount(1);
  for(const width of [1440,768,390,360]){
    await page.setViewportSize({width,height:900});
    const layout=await page.evaluate(()=>{
      const head=document.querySelector('#projectsView .section-head');
      const title=head.firstElementChild;
      const grid=document.querySelector('#projectGrid');
      const card=grid.querySelector('.ps3-prow');
      const rect=element=>element.getBoundingClientRect();
      return {title:rect(title).width,card:rect(card).width,overflow:document.documentElement.scrollWidth-window.innerWidth,ready:grid.dataset.ps3Ready};
    });
    expect(layout.ready).toBe('1');
    expect(layout.title,`project heading at ${width}px`).toBeGreaterThan(100);
    expect(layout.card,`project card at ${width}px`).toBeGreaterThan(200);
    expect(layout.overflow,`horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});


test('project owner UI stays inside 360 390 412 and 430px viewports',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await clickView(page,'projects');
  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:844});
    await page.locator('#newProjectBtn').click();
    await expect(page.locator('#ps3CreateModal')).toBeVisible();
    let overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow,`create modal at ${width}px`).toBeLessThanOrEqual(1);
    await page.locator('[data-ps3-close="ps3CreateModal"]').click();
    await page.locator('[data-ps3-project="main-1"]').first().click();
    await expect(page.locator('#ps3DetailModal')).toBeVisible();
    overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow,`detail at ${width}px`).toBeLessThanOrEqual(1);
    await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
    await expect(page.locator('#ps3MilestoneModal')).toBeVisible();
    overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow,`milestone modal at ${width}px`).toBeLessThanOrEqual(1);
    await expect(page.locator('#ps3MilestoneGoogle')).toBeVisible();
    await page.locator('[data-ps3-close="ps3MilestoneModal"]').click();
    await page.locator('[data-ps3-add-ws]').click();
    await expect(page.locator('#ps3WorkstreamModal')).toBeVisible();
    overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow,`progress modal at ${width}px`).toBeLessThanOrEqual(1);
    await page.locator('[data-ps3-close="ps3WorkstreamModal"]').click();
    await page.locator('[data-ps3-close="ps3DetailModal"]').click();
  }
});

test('project renderer clears user A data before rendering user B projects',async({page})=>{
  const state=baseState();
  state.spaces.push({id:'user-2-project',workspace_id:'workspace-1',name:'B 사용자 프로젝트',description:'B 전용',parent_id:null,status:'active',visibility:'public',owner_id:'user-2',sort_order:40,metadata:{project_system:'v2',management_version:2}});
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await clickView(page,'projects');
  await expect(page.locator('#projectGrid')).toContainText('민자철도 정책·조직사업');
  await expect(page.locator('#projectGrid')).not.toContainText('B 사용자 프로젝트');
  state.user={id:'user-2',email:'b@example.org',user_metadata:{display_name:'B 사용자'}};
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:session-changed')));
  await expect(page.locator('#projectGrid')).toContainText('B 사용자 프로젝트');
  await expect(page.locator('#projectGrid')).not.toContainText('민자철도 정책·조직사업');
});

test('project detail omits removed content, linked-post and collaboration features',async({page})=>{
  const state=baseState();
  state.sections=[{id:'section-legacy',project_id:'main-1',title:'기존 사업 콘텐츠',sort_order:10}];
  state.blocks=[{id:'block-legacy',project_id:'main-1',section_id:'section-legacy',block_type:'text',title:'기존 내용',content:{text:'남겨진 데이터'},sort_order:10}];
  state.pages=[{id:'page-legacy',space_id:'main-1',title:'기존 연결 게시글',slug:'legacy',summary:'기존 페이지',status:'draft',visibility:'private',metadata:{},updated_at:now()}];
  state.comments=[{id:'comment-legacy',project_id:'main-1',author_id:'user-1',body:'기존 협업 메모',created_at:now()}];
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3-content')).toHaveCount(0);
  await expect(page.locator('#ps3-pages')).toHaveCount(0);
  await expect(page.locator('#ps3-collaboration')).toHaveCount(0);
  await expect(page.locator('#ps3-overview')).toHaveCount(0);
  await expect(page.locator('#ps3-decisions')).toHaveCount(0);
  await expect(page.locator('.ps3-nav,[data-ps3-nav]')).toHaveCount(0);
  await expect(page.locator('#ps3Body')).not.toContainText('사업 콘텐츠·현황');
  await expect(page.locator('#ps3Body')).not.toContainText('기존 연결 게시글');
  await expect(page.locator('#ps3-memos')).toContainText('기존 협업 메모');
});

test('project memo supports add edit and delete',async({page})=>{
  const state=baseState();
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3-overview,#ps3-decisions')).toHaveCount(0);
  await expect(page.locator('#ps3-memos')).toBeVisible();
  await expect(page.locator('#ps3-memos')).not.toHaveAttribute('open','');
  await openFold(page,'ps3-memos');
  await page.locator('#ps3MemoBody').fill('첫 메모');
  await page.locator('[data-ps3-memo-save]').click();
  await expect.poll(()=>state.comments.some(x=>x.body==='첫 메모')).toBe(true);
  const memo=state.comments.find(x=>x.body==='첫 메모');
  await page.locator(`[data-ps3-edit-memo="${memo.id}"]`).click();
  await page.locator('#ps3MemoBody').fill('수정 메모');
  await page.locator('[data-ps3-memo-save]').click();
  await expect.poll(()=>state.comments.find(x=>x.id===memo.id)?.body).toBe('수정 메모');
  await expect(page.locator('#ps3-memos')).toHaveAttribute('open','');
  page.once('dialog',d=>d.accept());
  await page.locator(`[data-ps3-delete-memo="${memo.id}"]`).click();
  await expect.poll(()=>state.comments.some(x=>x.id===memo.id)).toBe(false);
});


test('project creation omits type and visibility controls and starts with zero progress items',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
  await clickView(page,'projects');
  await page.locator('#newProjectBtn').click();
  await expect(page.locator('#ps3CreateModal')).toBeVisible();
  await expect(page.locator('#ps3CreateType,#ps3ManageTypes,#ps3CreateVisibility,#ps3TypeModal,#ps3AccessModal')).toHaveCount(0);
  await page.locator('#ps3CreateName').fill('소유자 전용 프로젝트');
  await page.locator('#ps3CreateSave').click();
  await expect.poll(()=>state.spaces.some(x=>x.name==='소유자 전용 프로젝트')).toBe(true);
  const created=state.spaces.find(x=>x.name==='소유자 전용 프로젝트');
  expect(created.owner_id).toBe('user-1');
  expect(created.visibility).toBe('private');
  expect(created.metadata.project_system).toBe('v2');
  expect(created.metadata.project_type).toBeUndefined();
  expect(state.workstreams.filter(x=>x.project_id===created.id)).toHaveLength(0);
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await expect(page.locator('[data-ps3-access],[data-ps3-publish-project],#ps3-public')).toHaveCount(0);
});


test('new project milestone UI has only title time Google calendar and memo, and blocks save without Google',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');
  await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await expect(page.locator('#ps3MilestoneModal')).toBeVisible();
  await expect(page.locator('#ps3MilestoneModal label')).toHaveCount(4);
  await expect(page.locator('#ps3MilestoneTitle,#ps3MilestoneAt,#ps3MilestoneGoogle,#ps3MilestoneNotes')).toHaveCount(4);
  await expect(page.locator('#ps3MilestoneType,#ps3MilestoneStatusValue,#ps3MilestoneWs')).toHaveCount(0);
  await expect(page.locator('#ps3MilestoneModal')).not.toContainText('Web2에만 저장');
  await expect(page.locator('#ps3MilestoneGoogleHint')).toContainText('Google Calendar 연결');
  await expect(page.locator('#ps3MilestoneSave')).toBeDisabled();
  expect(state.milestones).toHaveLength(1);
  expect(state.events).toHaveLength(0);
  expect(state.googleCalls).toHaveLength(0);
});

test('new project milestone distinguishes Google reconnect requirement',async({page})=>{
  const state=baseState();
  state.googleStatus={connected:false,calendars:[],warning:'Google 재인증이 필요합니다.'};
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await expect(page.locator('#ps3MilestoneGoogle')).toContainText('재연결 필요');
  await expect(page.locator('#ps3MilestoneGoogleHint')).toContainText('재연결이 필요');
  await expect(page.locator('#ps3MilestoneSave')).toBeDisabled();
});

test('new project milestone creates Google first, stores linkage, and excludes read-only calendars',async({page})=>{
  const state=baseState();
  state.googleStatus={
    connected:true,enabled:true,selected:['owner@example.org'],colors:{},eventColors:{},
    calendars:[
      {id:'owner@example.org',summary:'개인 일정',primary:true,accessRole:'owner',backgroundColor:'#4285f4'},
      {id:'team-cal',summary:'공공운수노조',primary:false,accessRole:'writer',backgroundColor:'#336699'},
      {id:'read-only',summary:'읽기 전용',primary:false,accessRole:'reader',backgroundColor:'#999999'}
    ]
  };
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');
  await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await expect(page.locator('#ps3MilestoneGoogle')).toBeEnabled();
  await expect(page.locator('#ps3MilestoneGoogle')).toHaveValue('team-cal');
  await expect(page.locator('#ps3MilestoneGoogle option[value="read-only"]')).toHaveCount(0);
  await page.locator('#ps3MilestoneGoogle').selectOption('owner@example.org');
  await page.locator('#ps3MilestoneTitle').fill('Google 세부 캘린더 지정 일정');
  await page.locator('#ps3MilestoneAt').fill('2026-10-02T15:00');
  await page.locator('#ps3MilestoneNotes').fill('선택 캘린더 전달 검증');
  await page.locator('#ps3MilestoneSave').click();

  await expect.poll(()=>state.milestones.some(x=>x.title==='Google 세부 캘린더 지정 일정')).toBe(true);
  const milestone=state.milestones.find(x=>x.title==='Google 세부 캘린더 지정 일정');
  expect(milestone.google_calendar_id).toBe('owner@example.org');
  expect(milestone.google_event_id).toBeTruthy();
  expect(milestone.project_id).toBe('main-1');
  expect(milestone.milestone_type).toBe('action');
  expect(milestone.status).toBe('planned');
  expect(milestone.event_id).toBeNull();
  expect(state.restCalls.filter(x=>x.name==='app_events')).toHaveLength(0);
  await expect(page.locator('#ps3Body')).toContainText('Google 세부 캘린더 지정 일정');
  const googleCreate=state.googleCalls.find(x=>x.action==='create-event');
  expect(googleCreate).toMatchObject({calendar_id:'owner@example.org',title:'Google 세부 캘린더 지정 일정',memo:'선택 캘린더 전달 검증'});
  expect(new Date(googleCreate.end_iso).getTime()-new Date(googleCreate.start_iso).getTime()).toBe(60*60*1000);
  expect(state.callOrder.indexOf('google:create-event')).toBeLessThan(state.callOrder.indexOf('app_project_milestones:POST'));
});

test('Google create failure leaves no Web2-only project milestone',async({page})=>{
  const state=baseState();
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  state.googleFailures['create-event']='Google create failed';
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await page.locator('#ps3MilestoneTitle').fill('실패 일정');
  await page.locator('#ps3MilestoneAt').fill('2026-10-02T15:00');
  await page.locator('#ps3MilestoneSave').click();
  await expect(page.locator('#ps3MilestoneState')).toContainText('Google create failed');
  expect(state.milestones.filter(x=>x.title==='실패 일정')).toHaveLength(0);
  expect(state.events.filter(x=>x.title==='실패 일정')).toHaveLength(0);
  expect(state.callOrder).not.toContain('app_events:POST');
});

test('local milestone failure rolls back the newly created Google event',async({page})=>{
  const state=baseState();
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  state.restFailures['app_project_milestones:POST']=1;
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await page.locator('#ps3MilestoneTitle').fill('롤백 일정');
  await page.locator('#ps3MilestoneAt').fill('2026-10-02T15:00');
  await page.locator('#ps3MilestoneSave').click();
  await expect(page.locator('#ps3MilestoneState')).toContainText('되돌렸습니다');
  expect(state.milestones.filter(x=>x.title==='롤백 일정')).toHaveLength(0);
  expect(state.events.filter(x=>x.title==='롤백 일정')).toHaveLength(0);
  expect(state.googleCalls.map(x=>x.action)).toEqual(expect.arrayContaining(['create-event','delete-event']));
});

test('child project milestone uses the exact current child project id',async({page})=>{
  const state=baseState();
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=child-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await page.locator('#ps3MilestoneTitle').fill('하위 프로젝트 일정');
  await page.locator('#ps3MilestoneAt').fill('2026-10-03T09:00');
  await page.locator('#ps3MilestoneSave').click();
  await expect.poll(()=>state.milestones.some(x=>x.title==='하위 프로젝트 일정')).toBe(true);
  const milestone=state.milestones.find(x=>x.title==='하위 프로젝트 일정');
  expect(milestone.project_id).toBe('child-1');
  expect(milestone.event_id).toBeNull();
  expect(state.restCalls.filter(x=>x.name==='app_events')).toHaveLength(0);
});

test('legacy unlinked milestone edit preserves hidden fields and does not create a Google event',async({page})=>{
  const state=baseState();
  state.milestones[0].event_id='legacy-event';
  state.events.push({id:'legacy-event',workspace_id:'workspace-1',project_id:'main-1',workstream_id:'ws-1',title:'9.29 국회토론회',event_type:'other',start_at:'2026-09-29T05:00:00Z',end_at:null,calendar_scope:'personal'});
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-edit-milestone="mile-1"]').click();
  await expect(page.locator('#ps3MilestoneGoogleHint')).toContainText('기존 미연동');
  await page.locator('#ps3MilestoneTitle').fill('레거시 일정 제목 수정');
  await page.locator('#ps3MilestoneSave').click();
  await expect.poll(()=>state.milestones[0].title).toBe('레거시 일정 제목 수정');
  expect(state.milestones[0].milestone_type).toBe('policy');
  expect(state.milestones[0].status).toBe('planned');
  expect(state.milestones[0].workstream_id).toBe('ws-1');
  expect(state.googleCalls).toHaveLength(0);
});

test('linked milestone update uses stored Google ids without writing Web2 events',async({page})=>{
  const state=baseState();
  Object.assign(state.milestones[0],{event_id:'local-event',google_calendar_id:'primary',google_event_id:'google-existing'});
  state.events.push({id:'local-event',workspace_id:'workspace-1',project_id:'main-1',workstream_id:'ws-1',title:'9.29 국회토론회',description:'국토부·TS 참석',event_type:'other',start_at:'2026-09-29T05:00:00Z',end_at:null,calendar_scope:'personal'});
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-edit-milestone="mile-1"]').click();
  await expect(page.locator('#ps3MilestoneGoogle')).toHaveValue('primary');
  await page.locator('#ps3MilestoneTitle').fill('연동 일정 수정');
  await page.locator('#ps3MilestoneAt').fill('2026-09-30T16:00');
  await page.locator('#ps3MilestoneNotes').fill('수정 메모');
  await page.locator('#ps3MilestoneSave').click();
  await expect.poll(()=>state.milestones[0].title).toBe('연동 일정 수정');
  expect(state.googleCalls[0]).toMatchObject({action:'update-event',calendar_id:'primary',event_id:'google-existing',title:'연동 일정 수정',memo:'수정 메모'});
  expect(state.restCalls.filter(x=>x.name==='app_events')).toHaveLength(0);
  expect(state.milestones[0].milestone_type).toBe('policy');
  expect(state.milestones[0].workstream_id).toBe('ws-1');
});

test('linked milestone local update failure restores Google and local state',async({page})=>{
  const state=baseState();
  Object.assign(state.milestones[0],{event_id:'local-event',google_calendar_id:'primary',google_event_id:'google-existing'});
  state.events.push({id:'local-event',workspace_id:'workspace-1',project_id:'main-1',workstream_id:'ws-1',title:'9.29 국회토론회',description:'국토부·TS 참석',event_type:'other',start_at:'2026-09-29T05:00:00Z',end_at:null,calendar_scope:'personal'});
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  state.restFailures['app_project_milestones:PATCH']=1;
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-edit-milestone="mile-1"]').click();
  await page.locator('#ps3MilestoneTitle').fill('저장 실패 수정안');
  await page.locator('#ps3MilestoneSave').click();
  await expect(page.locator('#ps3MilestoneState')).toContainText('되돌렸습니다');
  expect(state.milestones[0].title).toBe('9.29 국회토론회');
  expect(state.restCalls.filter(x=>x.name==='app_events')).toHaveLength(0);
  expect(state.googleCalls.filter(x=>x.action==='update-event')).toHaveLength(2);
  expect(state.googleCalls.at(-1)).toMatchObject({event_id:'google-existing',title:'9.29 국회토론회'});
});

test('linked milestone delete uses stored Google ids without writing Web2 events',async({page})=>{
  const state=baseState();
  Object.assign(state.milestones[0],{event_id:'local-event',google_calendar_id:'primary',google_event_id:'google-existing'});
  state.events.push({id:'local-event',workspace_id:'workspace-1',project_id:'main-1',workstream_id:'ws-1',title:'9.29 국회토론회',event_type:'other',start_at:'2026-09-29T05:00:00Z',end_at:null,calendar_scope:'personal'});
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-edit-milestone="mile-1"]').click();
  page.once('dialog',d=>d.accept());
  await page.locator('#ps3MilestoneDelete').click();
  await expect.poll(()=>state.milestones.some(x=>x.id==='mile-1')).toBe(false);
  expect(state.restCalls.filter(x=>x.name==='app_events')).toHaveLength(0);
  expect(state.googleCalls.find(x=>x.action==='delete-event')).toMatchObject({calendar_id:'primary',event_id:'google-existing'});
});

test('linked milestone local delete failure restores Google linkage and milestone',async({page})=>{
  const state=baseState();
  Object.assign(state.milestones[0],{event_id:'local-event',google_calendar_id:'primary',google_event_id:'google-existing'});
  state.events.push({id:'local-event',workspace_id:'workspace-1',project_id:'main-1',workstream_id:'ws-1',title:'9.29 국회토론회',description:'국토부·TS 참석',event_type:'other',start_at:'2026-09-29T05:00:00Z',end_at:null,calendar_scope:'personal'});
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  state.restFailures['app_project_milestones:DELETE']=1;
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-edit-milestone="mile-1"]').click();
  page.once('dialog',d=>d.accept());
  await page.locator('#ps3MilestoneDelete').click();
  await expect(page.locator('#ps3MilestoneState')).toContainText('복원했습니다');
  const restored=state.milestones.find(x=>x.id==='mile-1');
  expect(restored).toBeTruthy();
  expect(restored.google_calendar_id).toBe('primary');
  expect(restored.google_event_id).not.toBe('google-existing');
  expect(state.restCalls.filter(x=>x.name==='app_events')).toHaveLength(0);
  expect(state.googleCalls.map(x=>x.action)).toEqual(expect.arrayContaining(['delete-event','create-event']));
});

test('rollback failure reports possible Google and Web2 inconsistency with the Google event id in console data',async({page})=>{
  const state=baseState();
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  state.restFailures['app_project_milestones:POST']=1;
  state.googleFailures['delete-event']='forced Google rollback failure';
  const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await page.locator('#ps3MilestoneTitle').fill('rollback 실패 일정');
  await page.locator('#ps3MilestoneAt').fill('2026-10-02T15:00');
  await page.locator('#ps3MilestoneSave').click();
  await expect(page.locator('#ps3MilestoneState')).toContainText('불일치');
  await expect.poll(()=>errors.some(x=>x.includes('project milestone rollback failed'))).toBe(true);
  expect(state.milestones.filter(x=>x.title==='rollback 실패 일정')).toHaveLength(0);
  expect(state.events.filter(x=>x.title==='rollback 실패 일정')).toHaveLength(0);
  expect(state.googleCalls.find(x=>x.action==='create-event')?.calendar_id).toBe('primary');
});

test.describe('project milestone Korea timezone',()=>{
  test.use({timezoneId:'Asia/Seoul'});
  test('datetime-local is sent to Google as the matching UTC instant with one-hour duration',async({page})=>{
    const state=baseState();
    state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
    await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
    await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
    await page.locator('#ps3MilestoneTitle').fill('한국시간 검증 일정');
    await page.locator('#ps3MilestoneAt').fill('2026-10-02T15:00');
    await page.locator('#ps3MilestoneSave').click();
    const create=state.googleCalls.find(x=>x.action==='create-event');
    expect(create.start_iso).toBe('2026-10-02T06:00:00.000Z');
    expect(create.end_iso).toBe('2026-10-02T07:00:00.000Z');
  });
});

test('progress items are added directly by title and existing progress data stays usable',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');
  await signIn(page);
  await expect(page.locator('#ps3-progress')).toContainText('정책·제도 대응');
  await page.locator('[data-ps3-add-ws]').click();
  await expect(page.locator('#ps3WorkstreamModal')).toBeVisible();
  await expect(page.locator('#ps3WorkstreamHeading')).toHaveText('진행상황 추가');
  await expect(page.locator('#ps3WsPhase')).toHaveValue('in_progress');
  await page.locator('#ps3WsTitle').fill('국토부 후속협의');
  await page.locator('#ps3WsSave').click();
  await expect.poll(()=>state.workstreams.some(x=>x.title==='국토부 후속협의')).toBe(true);
  await expect(page.locator('#ps3-progress')).toContainText('국토부 후속협의');
  const row=state.workstreams.find(x=>x.title==='국토부 후속협의');
  expect(row.description).toBeNull();
  expect(row.phase).toBe('in_progress');
});

test('new progress item saves the selected phase and updates its chip',async({page})=>{
  const state=baseState();await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('[data-ps3-add-ws]').click();
  await page.locator('#ps3WsTitle').fill('선택 단계 확인');
  await expect(page.locator('#ps3WsPhase option')).toHaveText(['준비','진행','협의','실행','후속조치','종료']);
  await page.locator('#ps3WsPhase').selectOption('consultation');
  await page.locator('#ps3WsSave').click();
  await expect.poll(()=>state.workstreams.find(x=>x.title==='선택 단계 확인')?.phase).toBe('consultation');
  const saved=state.workstreams.find(x=>x.title==='선택 단계 확인');
  await expect(page.locator(`[data-ps3-progress-item="${saved.id}"] .ps3-phase`)).toHaveText('협의');
});

test('recorded progress item has a visible edit action that saves title and phase once',async({page})=>{
  const state=baseState();state.workstreams[0].phase='preparation';await mockApp(page,state);
  const probe=await saveProbe(page,'app_project_workstreams','PATCH');
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  const item=page.locator('[data-ps3-progress-item="ws-1"]');
  const edit=item.locator('[data-ps3-edit-ws]');
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.locator('#ps3WorkstreamModal')).toBeVisible();
  await expect(item.locator('details')).toHaveCount(0);await expect(item.locator('.ps3-pg-summary')).toHaveCount(0);await expect(item.locator('.ps3-pg-record')).toHaveCount(1);
  await expect(page.locator('#ps3WsPhase')).toHaveValue('preparation');
  await page.locator('#ps3WsTitle').fill('수정한 진행상황');
  await page.locator('#ps3WsPhase').selectOption('execution');
  const button=page.locator('#ps3WsSave');
  await button.click();await expect.poll(()=>probe.count).toBe(1);
  await expect(button).toBeDisabled();await button.dispatchEvent('click');
  await page.waitForTimeout(150);expect(probe.count).toBe(1);
  probe.release();
  await expect(page.locator('#ps3WorkstreamModal')).toBeHidden();
  await expect(item.locator('.ps3-pg-title')).toHaveText('수정한 진행상황');
  await expect(item.locator('.ps3-phase')).toHaveText('실행');
  expect(state.restCalls.filter(x=>x.name==='app_project_workstreams'&&x.method==='PATCH')).toEqual([
    expect.objectContaining({body:{title:'수정한 진행상황',phase:'execution'}})
  ]);
});

test('progress list shows status and title, then the latest record and date on one line',async({page})=>{
  const state=baseState();
  state.progress.unshift({
    id:'pr-2',project_id:'main-1',workstream_id:'ws-1',
    summary:'국토부 회신을 반영해 토론회 쟁점을 다시 정리함',
    next_step:'현장 조직 의견을 취합해 최종 요구안을 확정',
    status_label:'진행',effective_on:'2026-09-20',created_at:now()
  });
  state.workstreams.push({id:'ws-2',project_id:'main-1',title:'현장 조직 대응',description:null,phase:'preparation',sort_order:20});
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');
  await signIn(page);

  const item=page.locator('[data-ps3-progress-item="ws-1"]');
  await expect(item.locator('.ps3-pg-line1 .ps3-phase')).toHaveText('진행');
  await expect(item.locator('.ps3-pg-title')).toHaveText('정책·제도 대응');
  await expect(item.locator('.ps3-pg-count')).toHaveText('2');
  await expect(item.locator('.ps3-pg-summary')).toHaveText('국토부 회신을 반영해 토론회 쟁점을 다시 정리함');
  await expect(item.locator('.ps3-pg-line2 time')).toHaveText('9.20');
  await expect(item.locator('details')).not.toHaveAttribute('open','');
  await expect(page.locator('#ps3-progress .ps3-progress-empty,#ps3Body .ps3-empty')).toHaveCount(0);
  await expect(page.locator('#ps3-progress .ps3-section-head [data-ps3-add-ws]')).toHaveText('+ 추가');

  await item.locator('details > summary').click();
  await expect(item.locator('details')).toHaveAttribute('open','');
  await expect(item.locator('.ps3-pg-record')).toHaveCount(2);
  await expect(item.locator('.ps3-pg-history')).toContainText('국토부 후속협의 준비');
  await expect(item.locator('.ps3-pg-history')).toContainText('다음: 현장 조직 의견을 취합해 최종 요구안을 확정');
  await expect(item.locator('[data-ps3-edit-ws]')).toHaveText('수정');
  await expect(item.locator('[data-ps3-progress-ws]')).toHaveCount(0);
  const quick=item.locator('[data-ps3-quick-progress] input');
  await expect(quick).toBeVisible();await quick.fill('상시 입력칸 기록');await quick.press('Enter');
  await expect(item.locator('.ps3-pg-count')).toHaveText('3');
  await expect(item.locator('details')).toHaveAttribute('open','');
  await expect(quick).toBeVisible();

  const empty=page.locator('[data-ps3-progress-item="ws-2"]');
  await expect(empty.locator('.ps3-phase')).toHaveText('준비');
  await expect(empty.locator('[data-ps3-quick-progress="ws-2"] input')).toBeVisible();
  await expect(empty.locator('[data-ps3-progress-ws]')).toHaveCount(0);
});

test('first progress record is saved inline through the existing progress path',async({page})=>{
  const state=baseState();
  state.workstreams.push({id:'ws-2',project_id:'main-1',title:'현장 조직 대응',description:null,phase:'preparation',sort_order:20});
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');
  await signIn(page);
  const form=page.locator('[data-ps3-quick-progress="ws-2"]');
  await form.locator('button[type="submit"]').click();
  expect(state.progress.filter(x=>x.workstream_id==='ws-2')).toHaveLength(0);
  await form.locator('input').fill('산하조직 의견 1차 취합');
  await form.locator('input').press('Enter');
  await expect.poll(()=>state.progress.find(x=>x.workstream_id==='ws-2')?.summary).toBe('산하조직 의견 1차 취합');
  const saved=state.progress.find(x=>x.workstream_id==='ws-2');
  expect(saved).toMatchObject({project_id:'main-1',author_id:'user-1',status_label:'준비',next_step:null,metadata:{}});
  expect(saved.effective_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(state.restCalls.filter(x=>x.name==='app_project_workstreams'&&x.method==='PATCH')).toHaveLength(0);
  const item=page.locator('[data-ps3-progress-item="ws-2"]');
  await expect(item.locator('.ps3-pg-record p').first()).toHaveText('산하조직 의견 1차 취합');
  await expect(page.locator('[data-ps3-quick-progress="ws-2"] input')).toBeVisible();
});

test('project detail keeps one summary-first column at desktop and phone widths',async({page})=>{
  const state=baseState();
  state.workstreams.push({id:'ws-2',project_id:'main-1',title:'현장 조직 대응과 매우 긴 진행상황 제목이 한 줄을 넘는 경우',description:null,phase:'consultation',sort_order:20});
  state.progress.push({...state.progress[0],id:'layout-second'});
  state.progress[0].summary='국토부 후속협의 준비와 운영기준 쟁점 정리를 동시에 진행하고 있으며 현장 의견을 반영 중인 매우 긴 기록';
  state.spaces[0].metadata.objective='민자철도 안전·인력 제도개선을 위한 정책·조직사업의 목표 설명이 길어져도 한 줄로 줄여 보여 준다';
  await mockApp(page,state);
  await page.setViewportSize({width:1280,height:900});
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');
  await signIn(page);
  await expect(page.locator('#ps3-progress')).toBeVisible();
  const order=await page.locator('#ps3Body').evaluate(body=>[...body.children].map(x=>x.id||x.className));
  expect(order).toEqual(['ps3-children','ps3-progress','ps3-tasks','ps3-documents','ps3-milestones','ps3-memos']);
  await expect(page.locator('#ps3-milestones')).not.toHaveAttribute('open','');
  await expect(page.locator('#ps3-memos')).not.toHaveAttribute('open','');
  await expect(page.locator('#ps3Body .ps3-section-head p,#ps3Body .ps3-empty,#ps3Body .ps3-detail-head')).toHaveCount(0);
  await expect(page.locator('#ps3-tasks .ps3-section-actions [data-ps3-global="task"]')).toHaveText('할 일 추가');
  await expect(page.locator('#ps3-documents .ps3-section-actions [data-ps3-global="document"]')).toHaveText('자료 올리기');
  for(const width of [1280,360,390,412,430]){
    await page.setViewportSize({width,height:844});
    const layout=await page.evaluate(()=>{
      const r=el=>el.getBoundingClientRect();
      const list=document.querySelector('#ps3-progress .ps3-pg-list');
      const objective=document.querySelector('#ps3Objective');
      const summary=document.querySelector('[data-ps3-progress-item="ws-1"] .ps3-pg-summary');
      return {
        overflow:document.documentElement.scrollWidth-window.innerWidth,
        list:r(list).width,
        items:[...list.children].map(x=>({width:r(x).width,overflow:x.scrollWidth-x.clientWidth})),
        objectiveLines:Math.round(r(objective).height/parseFloat(getComputedStyle(objective).lineHeight)),
        summaryTall:r(summary).height>parseFloat(getComputedStyle(summary).fontSize)*2,
        sections:[...document.querySelectorAll('#ps3Body>section,#ps3Body>details')].map(x=>Math.round(r(x).width))
      };
    });
    expect(layout.overflow,`page overflow at ${width}px`).toBeLessThanOrEqual(1);
    expect(layout.objectiveLines,`objective lines at ${width}px`).toBe(1);
    expect(layout.summaryTall,`latest record wraps at ${width}px`).toBe(false);
    for(const item of layout.items){
      expect(item.width,`progress item width at ${width}px`).toBeGreaterThan(layout.list*.95);
      expect(item.overflow,`progress item overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
    expect(new Set(layout.sections).size,`single column at ${width}px`).toBe(1);
  }
});

test('key schedule status is shown in Korean inside the collapsed bottom section',async({page})=>{
  const state=baseState();
  state.milestones.push({id:'mile-2',project_id:'main-1',title:'완료된 일정',milestone_type:'action',status:'done',start_at:'2026-09-10T05:00:00Z'});
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3-milestones > summary')).toContainText('주요 일정');
  await expect(page.locator('#ps3-milestones > summary .ps3-count')).toHaveText('2');
  await openFold(page,'ps3-milestones');
  await expect(page.locator('#ps3-milestones')).toContainText('예정');
  await expect(page.locator('#ps3-milestones')).toContainText('완료');
  await expect(page.locator('#ps3-milestones')).not.toContainText('planned');
  await expect(page.locator('#ps3-milestones')).not.toContainText('done');
});

test('top-level project creates a task directly on the current project',async({page})=>{
  const state=baseState();state.sessionUser=true;
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');
  await signIn(page);
  await page.locator('[data-ps3-global="task"]').click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtTaskModal [data-gt-list-note]')).toContainText('내 할 일');
  await expect(page.locator('#gtEditList')).toHaveCount(0);
  await expect(page.locator('#gtEditLinkBody input[value="p:main-1"]')).toBeChecked();
  await expect(page.locator('#gtEditLinkBody input[value="p:child-1"]')).not.toBeChecked();
  await page.locator('#gtEditTitle').fill('상위 프로젝트 직접 연결 업무');
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>state.gtCalls.find(x=>x.action==='create')?.body).toEqual(expect.objectContaining({title:'상위 프로젝트 직접 연결 업무',links:[{project_id:'main-1'}]}));
  await expect(page.locator('#gtTaskModal')).toBeHidden();
  await expect(page.locator('#ps3-tasks [data-ps3-gtasks]')).toContainText('상위 프로젝트 직접 연결 업무');
  await expect(page.locator('#ps3-tasks [data-ps3-task-count]')).toHaveText('1');
  expect(state.tasks).toEqual([]);
});

test('V3 mobile project creation, detail scrolling and linked document remain usable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const state=baseState();
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
  await clickView(page,'projects');
  await page.locator('#newProjectBtn').click();
  await expect(page.locator('#ps3CreateModal')).toBeVisible();
  await page.locator('#ps3CreateName').fill('QA 자동검사 프로젝트');
  await page.locator('#ps3CreateObjective').fill('모바일 사업현황 검사');
  await page.locator('#ps3CreateSave').click();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await expect.poll(()=>state.spaces.find(x=>x.name==='QA 자동검사 프로젝트')?.id).toBeTruthy();
  const created=state.spaces.find(x=>x.name==='QA 자동검사 프로젝트');
  expect(created?.metadata?.project_system).toBe('v2');
  await expect(page.locator('#ps3Title')).toHaveText('QA 자동검사 프로젝트');
  const width=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(width).toBeLessThanOrEqual(1);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await expect(page.locator('#ps3MilestoneModal')).toBeVisible();
  await page.locator('#ps3MilestoneTitle').fill('모바일 QA 일정');
  await page.locator('#ps3MilestoneAt').fill('2026-09-29T10:00');
  await page.locator('#ps3MilestoneSave').click();
  await expect.poll(()=>state.milestones.some(x=>x.title==='모바일 QA 일정')).toBe(true);
  await expect(page.locator('#ps3Body')).toContainText('모바일 QA 일정');
  await page.locator('[data-ps3-add-ws]').click();
  await expect(page.locator('#ps3WorkstreamModal')).toBeVisible();
  await page.locator('#ps3WsTitle').fill('모바일 QA 진행상황');
  await page.locator('#ps3WsSave').click();
  await expect.poll(()=>state.workstreams.some(x=>x.title==='모바일 QA 진행상황')).toBe(true);
  const mobileProgress=state.workstreams.find(x=>x.title==='모바일 QA 진행상황');
  const quick=page.locator(`[data-ps3-quick-progress="${mobileProgress.id}"]`);
  await quick.locator('input').fill('모바일 QA 현재 상황');
  await quick.locator('button[type="submit"]').click();
  await expect.poll(()=>state.progress.some(x=>x.summary==='모바일 QA 현재 상황'&&x.workstream_id===mobileProgress.id)).toBe(true);
  await expect(page.locator(`[data-ps3-progress-item="${mobileProgress.id}"] .ps3-pg-record p`)).toHaveText('모바일 QA 현재 상황');
  await openFold(page,'ps3-milestones');
  await openFold(page,'ps3-memos');
  const scroll=await page.locator('#ps3DetailModal .ps3-detail-card').evaluate(el=>{
    el.scrollTop=el.scrollHeight;
    return {top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight};
  });
  expect(scroll.total).toBeGreaterThan(scroll.height);
  expect(scroll.top).toBeGreaterThan(0);
  await page.locator('[data-ps3-global="document"]').click();
  await expect(page.locator('#documentModal')).toBeVisible();
  await expect(page.locator('#docProject')).toHaveValue(created.id);
  await page.locator('[data-close="documentModal"]').first().click();
  await expect(page.locator('[data-ps3-global="page"]')).toHaveCount(0);
  await expect(page.locator('#ps3Hierarchy')).toBeEmpty();
  await page.locator('#ps3-children [data-ps3-child]').click();
  await expect(page.locator('#ps3CreateModal')).toBeVisible();
  await expect(page.locator('#ps3CreateParent')).toHaveValue(created.id);
  await page.locator('[data-ps3-close="ps3CreateModal"]').click();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('V3 lists child projects with counts in the body and child returns to parent',async({page})=>{
  const state=baseState();
  state.links.push(
    {google_task_id:'g-child-open',project_id:'child-1',status:'confirmed',task_completed:false},
    {google_task_id:'g-child-done',project_id:'child-1',status:'confirmed',task_completed:true}
  );
  // A Web2 task no longer counts.
  state.tasks.push({id:'child-task-open',project_id:'child-1',title:'발제 취합',status:'todo',assignee_id:'user-1'});
  state.docs.push({id:'child-doc',project_id:'child-1',title:'토론회 자료집',category:'정책자료'});
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await clickView(page,'projects');
  await expect(page.locator('[data-ps3-project="main-1"]')).toBeVisible();
  await expect(page.locator('#projectGrid [data-project]')).toHaveCount(0);
  await page.locator('[data-ps3-project="main-1"]').first().click();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await expect(page.locator('#ps3Kicker,#ps3Body .ps3-detail-meta,.ps3-child-menu')).toHaveCount(0);
  await expect(page.locator('#ps3DetailModal .ps3-modal-head')).not.toContainText('상시사업·산업관리');
  await expect(page.locator('#ps3DetailModal .ps3-modal-head')).not.toContainText('PROJECT');
  await expect(page.locator('#ps3Hierarchy')).toBeEmpty();
  const children=page.locator('#ps3-children');
  await expect(children.locator('.ps3-section-head')).toContainText('하위 프로젝트 1');
  const row=children.locator('[data-ps3-project="child-1"]');
  await expect(row).toContainText('9.29 민자철도 국회토론회');
  await expect(row).toContainText('할 일 1 · 자료 1');
  await expect(children.locator('[data-ps3-edit-project],[data-ps3-archive-project],[data-ps3-delete-project]')).toHaveCount(0);
  expect(state.restCalls.some(x=>x.name==='app_record_links'&&x.method==='GET')).toBeTruthy();
  expect(state.restCalls.some(x=>x.name==='app_tasks')).toBeFalsy();
  await row.click();
  await expect(page.locator('#ps3Title')).toHaveText('9.29 민자철도 국회토론회');
  await expect(page.locator('#ps3-children')).toHaveCount(0);
  await expect(page.locator('.ps3-parent-link')).toContainText('민자철도 정책·조직사업');
  await page.locator('.ps3-parent-link').click();
  await expect(page.locator('#ps3Title')).toHaveText('민자철도 정책·조직사업');
});

for(const width of [360,390,1280])test(`D-project list header, hierarchy, metadata and navigation ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.clock.install({time:new Date('2026-10-09T03:00:00Z')});
  const state=baseState();state.sessionUser=true;
  state.spaces.push({...state.spaces[0],id:'main-2',name:'아주 긴 프로젝트 이름 '.repeat(30)}, {...state.spaces[0],id:'arch-1',name:'지난 캠페인',status:'archived'});
  state.gtasks=[{id:'g-main',title:'밀린 할 일',status:'needsAction',due:'2026-10-08T00:00:00Z'},{id:'g-child',title:'오늘 할 일',status:'needsAction',due:'2026-10-09T00:00:00Z'},{id:'g-done',status:'completed'}];
  state.links=[{google_task_id:'g-main',project_id:'main-1',status:'confirmed'}, {google_task_id:'g-main',project_id:'main-1',status:'confirmed'}, {google_task_id:'g-child',project_id:'child-1',status:'confirmed'}, {google_task_id:'g-done',project_id:'main-2',status:'confirmed'}, {google_task_id:'g-child',project_id:'main-2',status:'suggested'}];
  state.milestones=[{id:'today',project_id:'main-1',title:'오늘',start_at:'2026-10-08T15:00:00Z',status:'planned'},{id:'future',project_id:'child-1',title:'다음',start_at:'2026-10-11T03:00:00Z',status:'planned'},{id:'done',project_id:'child-1',start_at:'2026-10-09T03:00:00Z',status:'done'},{id:'canceled',project_id:'child-1',start_at:'2026-10-09T03:00:00Z',status:'cancelled'},{id:'past',project_id:'main-2',start_at:'2026-10-08T03:00:00Z',status:'planned'}];
  state.progress=[{project_id:'main-1',effective_on:'2026-10-08',created_at:now()},...Array.from({length:1200},(_,i)=>({project_id:'main-1',effective_on:'2026-10-07',created_at:String(i)})),{project_id:'child-1',effective_on:'2025-01-01',created_at:now()}];
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await clickView(page,'projects');
  const list=page.locator('#projectGrid .ps3-plist'),main=list.locator('[data-ps3-project="main-1"]'),child=list.locator('[data-ps3-project="child-1"]');
  await expect(list.locator('.add-list-head h2')).toHaveCount(0);
  await expect(list.locator('[data-ps3-total]')).toHaveText('프로젝트 2개');
  await expect(list.locator('[data-ps3-total]')).toHaveCSS('font-size','12px');
  await expect(page.locator('#ps3ArchiveBtn')).toHaveText('보관 1');
  await expect(page.locator('#ps3ArchiveBtn')).toHaveCSS('font-size','12px');
  await expect(page.locator('#newProjectBtn')).toHaveText('+ 프로젝트');
  await expect(list.locator('[data-ps3-kids-toggle]')).toHaveCount(0);
  await expect(child).toBeVisible();await expect(list.locator('[data-ps3-child]')).toHaveCount(0);
  await expect(main.locator('.ps3-prow-meta')).toHaveText('D-day110.8');
  await expect(child.locator('.ps3-prow-meta')).toHaveText('D-211.1');
  await expect(list.locator('[data-ps3-project="main-2"] .ps3-prow-meta')).toBeEmpty();
  await expect(main.locator('.kptu-list-task-count')).toHaveAttribute('aria-label','미완료 할 일 1개, 기한 지남 포함');
  await expect(child.locator('.kptu-list-task-count')).not.toHaveClass(/kptu-list-overdue/);
  await expect(main.locator('svg path')).toHaveAttribute('d','m5 12 4 4L19 6');
  await expect(list).not.toContainText('자료');await expect(list).not.toContainText('할 일 0');
  for(const row of [main,child]){
    const geometry=await row.evaluate(e=>({height:e.getBoundingClientRect().height,padding:getComputedStyle(e).paddingLeft,font:getComputedStyle(e.querySelector('.ps3-prow-meta')).fontSize}));
    expect(geometry.height).toBeGreaterThanOrEqual(44);expect(geometry.font).toBe('12px');expect(parseInt(geometry.padding)).toBe(row===main?16:32);
  }
  const clipped=await list.locator('[data-ps3-project="main-2"] .ps3-prow-name').evaluate(e=>({clipped:e.scrollWidth>e.clientWidth,ellipsis:getComputedStyle(e).textOverflow}));expect(clipped).toEqual({clipped:true,ellipsis:'ellipsis'});
  const danger=await main.locator('.kptu-list-task-count').evaluate(e=>getComputedStyle(e).color);
  expect(danger).toBe(await page.evaluate(()=>{const e=document.createElement('span');e.style.color='var(--kptu-danger)';document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c}));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(state.summaryQueries).toHaveLength(1);expect(state.summaryQueries[0]['progress.limit']).toBe('1');expect(state.summaryQueries[0]['milestones.limit']).toBe('1');expect(state.summaryQueries[0]['progress.order']).toBe('effective_on.desc,created_at.desc');
  await child.press('Enter');await expect(page.locator('#ps3Title')).toHaveText('9.29 민자철도 국회토론회');await page.locator('[data-ps3-close="ps3DetailModal"]').click();
  await main.click();await expect(page.locator('#ps3Title')).toHaveText('민자철도 정책·조직사업');await page.locator('[data-ps3-close="ps3DetailModal"]').click();
  await page.locator('#ps3ArchiveBtn').click();await expect(page.locator('#ps3ArchiveModal')).toBeVisible();await expect(page.locator('[data-ps3-restore="arch-1"]')).toBeVisible();
});

for(const extra of [0,200])test(`D-project requests stay constant with ${extra} extra projects`,async({page})=>{
 const state=baseState();state.sessionUser=true;state.gtasks=[{id:'pending',status:'needsAction'}];state.links=[{google_task_id:'pending',project_id:'main-1',status:'confirmed'}];
 state.spaces.push(...Array.from({length:extra},(_,i)=>({...state.spaces[0],id:'extra-'+i,name:'추가 '+i})));
 await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?view=projects');await signIn(page);await expect(page.locator('#projectsView')).toBeVisible();
 await expect(page.locator('[data-ps3-project="main-1"] .kptu-list-task-count')).toHaveText('1');
 await expect.poll(()=>state.summaryQueries?.length).toBe(1);
 expect(state.gtCalls.filter(x=>x.action==='overview')).toHaveLength(1);
 expect(state.restCalls.filter(x=>x.name==='app_record_links')).toHaveLength(1);
 expect(state.restCalls.filter(x=>x.name==='app_documents'||x.name==='app_project_progress_updates'||x.name==='app_project_milestones')).toHaveLength(0);
 await expect(page.locator('#ps3ArchiveBtn')).toBeHidden();
 await expect(page.locator('[data-ps3-total]')).toHaveText(`프로젝트 ${extra+1}개`);
});
test('D-project names appear before optional reads and survive failed metadata',async({page})=>{
 const state=baseState();state.summaryFail=true;let release;state.summaryDelay=new Promise(r=>release=r);
 await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await clickView(page,'projects');
 await expect(page.locator('#projectGrid [data-ps3-project]')).toHaveCount(2);await expect(page.locator('[data-ps3-total]')).toHaveText('프로젝트 1개');
 release();await expect.poll(()=>state.summaryQueries?.length).toBe(1);
 await page.locator('#projectGrid [data-ps3-project="main-1"]').click();await expect(page.locator('#ps3Title')).toHaveText('민자철도 정책·조직사업');
});

for(const failure of ['tasks','dates','both'])test(`D-project ${failure} failure preserves names and other metadata`,async({page})=>{
 const state=baseState();state.sessionUser=true;state.summaryFail=failure!=='tasks';state.gtOverviewFail=failure!=='dates';
 state.gtasks=[{id:'pending',status:'needsAction'}];state.links=[{google_task_id:'pending',project_id:'main-1',status:'confirmed'}];
 await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await clickView(page,'projects');
 const main=page.locator('#projectGrid [data-ps3-project="main-1"]');
 if(failure==='tasks')await expect(main.locator('time')).toHaveText('9.15');
 if(failure==='dates')await expect(main.locator('.kptu-list-task-count')).toHaveText('1');
 await expect(page.locator('#projectGrid [data-ps3-project]')).toHaveCount(2);
 await main.click();await expect(page.locator('#ps3Title')).toHaveText('민자철도 정책·조직사업');
});

test('V3 generated dialogs expose consistent accessibility semantics',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await clickView(page,'projects');
  for(const id of ['ps3DetailModal','ps3CreateModal','ps3WorkstreamModal','ps3ProgressModal','ps3MilestoneModal','ps3DeleteModal','ps3ArchiveModal']){
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
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await clickView(page,'projects');
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

  await openFold(page,'ps3-milestones');
  const milestoneTrigger=page.locator('[data-ps3-add-milestone]');
  await milestoneTrigger.focus();await milestoneTrigger.click();
  await expect(page.locator('#ps3MilestoneTitle')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ps3MilestoneModal')).toHaveClass(/hidden/);
  await expect(milestoneTrigger).toBeFocused();
});

test('V3 more menu and progress items use native keyboard disclosure behavior',async({page})=>{
  const state=baseState();state.progress.push({...state.progress[0],id:'keyboard-second'});await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await clickView(page,'projects');
  await page.locator('[data-ps3-project="main-1"]').first().click();
  const menu=page.locator('#ps3Menu .ps3-more'),summary=menu.locator(':scope > summary');
  await expect(summary).toHaveAttribute('aria-label','프로젝트 관리 메뉴');
  await expect(menu.locator('[data-ps3-toggle-done]')).toBeHidden();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('open','');
  await expect(menu.locator('.ps3-more-panel button')).toHaveText(['완료','수정','보관','삭제']);
  await page.keyboard.press('Tab');
  await expect(menu.locator('[data-ps3-toggle-done]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open','');
  await expect(summary).toBeFocused();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await summary.click();
  await expect(menu).toHaveAttribute('open','');
  await page.locator('#ps3Title').click();
  await expect(menu).not.toHaveAttribute('open','');
  const item=page.locator('[data-ps3-progress-item="ws-1"]'),itemSummary=item.locator('details > summary');
  await itemSummary.focus();await page.keyboard.press('Enter');
  await expect(item.locator('details')).toHaveAttribute('open','');
  await page.keyboard.press('Tab');await expect(item.locator('[data-ps3-record-menu="pr-1"]')).toBeFocused();
  await page.keyboard.press('Enter');await expect(page.locator('#ps3RecordMenu button').first()).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('#ps3RecordMenu button').last()).toBeFocused();

});

test('V3 creates and edits a project with the same final renderer',async({page})=>{
  // 기본 시작일은 오늘이다(앱은 UTC 날짜를 쓰지만 정오 시계에서는 한국 날짜와 같다). 종료일을 고정 날짜로 두면 그 날짜가 지난 뒤 시작일보다 앞서게 된다.
  const today=await calendarToday(page);
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await clickView(page,'projects');
  await page.locator('#newProjectBtn').click();await expect(page.locator('#ps3CreateModal')).toBeVisible();
  await page.locator('#ps3CreateName').fill('인력확충 투쟁');await page.locator('#ps3CreateObjective').fill('안전·공공서비스 인력확충');await page.locator('#ps3CreateSave').click();
  await expect.poll(()=>state.spaces.some(x=>x.name==='인력확충 투쟁')).toBeTruthy();
  const made=state.spaces.find(x=>x.name==='인력확충 투쟁');
  expect(made.visibility).toBe('private');
  expect(state.workstreams.filter(x=>x.project_id===made.id)).toHaveLength(0);
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await openMenu(page);
  await page.locator('[data-ps3-edit-project]').click();
  await expect(page.locator('#ps3CreateHeading')).toHaveText('프로젝트 수정');
  await page.locator('#ps3CreateName').fill('인력확충 공동투쟁');
  const end=addCalendarDays(today,23);
  await page.locator('#ps3CreateEnd').fill(end);
  await page.locator('#ps3CreateSave').click();
  await expect.poll(()=>state.spaces.find(x=>x.id===made.id)?.name).toBe('인력확충 공동투쟁');
  const saved=state.spaces.find(x=>x.id===made.id).metadata;
  expect(saved.start_on).toBe(today);
  expect(saved.end_on).toBe(end);
  await expect(page.locator('#ps3Title')).toHaveText('인력확충 공동투쟁');
});

test('V3 edits and deletes a key schedule and shows the three most recent documents',async({page})=>{
  const state=baseState();
  state.docs.push(
    {id:'doc-2',project_id:'main-1',title:'토론회 발제문',category:'정책자료',document_date:'2026-09-13'},
    {id:'doc-3',project_id:'main-1',title:'현장 설문 결과',category:'현장자료',document_date:'2026-09-12'},
    {id:'doc-4',project_id:'main-1',title:'지난 회의록',category:'회의',document_date:'2026-09-01'}
  );
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3DetailModal')).toBeVisible({timeout:10000});
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-edit-milestone="mile-1"]').click();await expect(page.locator('#ps3MilestoneModal')).toBeVisible();
  await page.locator('#ps3MilestoneTitle').fill('9.29 민자철도 국회토론회 확정');await page.locator('#ps3MilestoneSave').click();
  await expect.poll(()=>state.milestones[0].title).toBe('9.29 민자철도 국회토론회 확정');
  await expect(page.locator('#ps3-milestones')).toHaveAttribute('open','');
  await page.locator('[data-ps3-edit-milestone="mile-1"]').click();page.once('dialog',d=>d.accept());await page.locator('#ps3MilestoneDelete').click();
  await expect.poll(()=>state.milestones.length).toBe(0);
  const docs=page.locator('#ps3-documents');
  await expect(docs.locator('.ps3-section-head .ps3-count')).toHaveText('4');
  await expect(docs.locator('.ps3-doc-row')).toHaveCount(3);
  await expect(docs).toContainText('민자철도 국토부 요구자료 답변');
  await expect(docs).not.toContainText('지난 회의록');
  await expect(docs.locator('#ps3DocSearch,[data-ps3-doc-filter]')).toHaveCount(0);
  await expect(docs.locator('a[href="https://example.org/doc"]')).toHaveText('열기');
  await docs.locator('[data-ps3-library]').click();
  await expect(page.locator('#ps3DetailModal')).toBeHidden();
  await expect(page.locator('#libraryView')).toBeVisible();
});

test('V3 archives and restores without returning to a legacy project screen',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3DetailModal')).toBeVisible({timeout:10000});
  await openMenu(page);
  page.once('dialog',d=>d.accept());await page.locator('[data-ps3-archive-project]').click();
  await expect.poll(()=>state.spaces.find(x=>x.id==='main-1')?.status).toBe('archived');
  await expect(page.locator('#ps3DetailModal')).toBeHidden();
  await clickView(page,'projects');
  await page.locator('#ps3ArchiveBtn').click();
  await expect(page.locator('#ps3ArchiveModal')).toBeVisible();
  await expect(page.locator('[data-ps3-restore="main-1"]')).toBeVisible();
  await page.locator('[data-ps3-restore="main-1"]').click();
  await expect.poll(()=>state.spaces.find(x=>x.id==='main-1')?.status).toBe('active');
});

test('V3 exposes project delete in final renderer',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3DetailModal')).toBeVisible({timeout:10000});
  await openMenu(page);
  await expect(page.locator('[data-ps3-delete-project]')).toBeVisible();
  await page.locator('[data-ps3-delete-project]').click();await expect(page.locator('#ps3DeleteModal')).toBeVisible();
  await page.locator('#ps3DeleteConfirm').click();await expect.poll(()=>state.spaces.some(x=>x.id==='main-1')).toBeFalsy();
  await expect(page.locator('#ps3DetailModal')).toBeHidden();
});

test('V3 includes legacy child work areas under a V3 parent without changing their IDs',async({page})=>{
  const state=baseState();state.sessionUser=true;state.spaces.push({id:'legacy-child',workspace_id:'workspace-1',parent_id:'main-1',name:'국회토론회 준비',slug:'old-child',owner_id:'user-1',status:'active',visibility:'team',metadata:{legacy_snapshot:true}});
  state.gtasks.push({id:'legacy-g',title:'발제 원고 취합',status:'needsAction',due:null,taskListId:'@default',taskListTitle:'내 할 일',source:'google-task'});
  state.links.push({google_task_id:'legacy-g',project_id:'legacy-child',status:'confirmed',task_completed:false});
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3-children [data-ps3-project="legacy-child"]')).toBeVisible();
  await page.locator('#ps3-children [data-ps3-project="legacy-child"]').click();
  await expect(page.locator('#ps3Title')).toHaveText('국회토론회 준비');
  await expect(page.locator('#ps3-tasks')).toContainText('발제 원고 취합');
});


test('V3 project list only shows projects owned by the signed-in user',async({page})=>{
  const state=baseState();
  state.spaces.push({id:'other-owner',workspace_id:'workspace-1',name:'다른 사용자 프로젝트',parent_id:null,status:'active',visibility:'public',owner_id:'user-2',sort_order:30,metadata:{project_system:'v2',management_version:2}});
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await clickView(page,'projects');
  await expect(page.locator('#projectGrid')).toContainText('민자철도 정책·조직사업');
  await expect(page.locator('#projectGrid')).not.toContainText('다른 사용자 프로젝트');
});

test('V3 keeps an owned legacy child visible even when its parent is not returned',async({page})=>{
  const state=baseState();
  state.spaces=[{id:'legacy-child-owned',workspace_id:'workspace-1',parent_id:'hidden-parent',name:'소유한 기존 하위 프로젝트',owner_id:'user-1',status:'active',visibility:'team',metadata:{project_system:'v2',management_version:2}}];
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await clickView(page,'projects');
  await expect(page.locator('#projectGrid')).toContainText('소유한 기존 하위 프로젝트');
  await expect(page.locator('[data-ps3-project="legacy-child-owned"]')).toBeVisible();
});

test('V3 project detail stays separate from the Web1-backed board',async({page})=>{
  const state=baseState();
  state.spaces[1].metadata.source_draft_id='page-child';
  state.pages=[{id:'page-notice',space_id:'main-1',title:'독립 현장 공지',slug:'standalone-notice',summary:'독립 공지 요약',body:'독립 공지 본문',status:'published',visibility:'public',updated_at:'2026-09-18T10:00:00Z',metadata:{}}];
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');
  await signIn(page);
  await expect(page.locator('#ps3-children [data-ps3-project="child-1"]')).toBeVisible();
  await expect(page.locator('#ps3-pages')).toHaveCount(0);
  await expect(page.locator('#ps3Body')).not.toContainText('독립 현장 공지');
  await page.locator('[data-ps3-close="ps3DetailModal"]').click();
  await clickView(page,'pages');
  await expect(page.locator('#web1BoardActive')).toContainText('위험업무 2인1조 법제화');
  await expect(page.locator('#web1BoardActive')).not.toContainText('독립 현장 공지');
});

test('Web1-backed board stays compact and excludes dedicated library and press sections',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:8123/app/');await signIn(page);
  await clickView(page,'pages');
  await expect(page.locator('#web1BoardActive .w1b-card')).toHaveCount(5);
  await expect(page.locator('#web1BoardActive')).toContainText('민자철도 사업 현황');
  await expect(page.locator('#web1BoardActive')).not.toContainText('성명·보도자료');
  await expect(page.locator('#web1BoardActive')).not.toContainText('자료실');
  for(const width of [1440,768,390,360]){
    await page.setViewportSize({width,height:900});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
  await expect(page.locator('#web1BoardActive .w1b-card').first()).toHaveAttribute('data-web1-board-href',/^https:\/\/work\.bokdoong\.com\//);
});

test('V3 completion changes status without deleting the project',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  const control=page.locator('[data-ps3-toggle-done]');
  await openMenu(page);await expect(control).toHaveText('완료');
  await control.click();
  await expect.poll(()=>state.spaces.find(x=>x.id==='main-1')?.status).toBe('done');
  await expect(page.locator('#ps3Title')).toHaveText('민자철도 정책·조직사업');
  // Wait for the detail re-render that follows the status change before reopening its menu.
  await expect(control).toHaveText('완료 취소');
  await expect(page.locator('#ps3Menu .ps3-more')).not.toHaveAttribute('open','');
  await openMenu(page);
  await control.click();
  await expect.poll(()=>state.spaces.find(x=>x.id==='main-1')?.status).toBe('active');
});

test('V3 project task section completes, edits and unlinks linked Google tasks',async({page})=>{
  const state=baseState();state.sessionUser=true;
  state.gtasks.push({id:'g1',title:'자료 정리',notes:'공유 전 확인',due:null,status:'needsAction',taskListId:'@default',taskListTitle:'내 할 일',source:'google-task'});
  state.links.push({google_task_id:'g1',project_id:'child-1',status:'confirmed',task_completed:false});
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=child-1');await signIn(page);
  const panel=page.locator('#ps3-tasks [data-ps3-gtasks]');
  await expect(panel.locator('[data-google-task="g1"]')).toContainText('자료 정리');
  await expect(page.locator('#ps3-tasks [data-ps3-task-count]')).toHaveText('1');
  expect(state.gtCalls.filter(x=>x.action==='linked').map(x=>x.query.project_id)).toEqual(['child-1']);
  await panel.locator('[data-gt-linked-toggle="g1"]').click();
  await expect(panel.locator('[data-google-task="g1"]')).toHaveClass(/completed/);
  await expect.poll(()=>state.gtCalls.find(x=>x.action==='toggle')?.body?.completed).toBe(true);
  await expect(page.locator('#ps3-tasks [data-ps3-task-count]')).toHaveText('0');
  await panel.locator('[data-gt-linked-edit="g1"]').click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtEditTitle')).toHaveValue('자료 정리');
  await expect(page.locator('#gtEditNotes')).toHaveValue('공유 전 확인');
  await expect(page.locator('#gtEditLinkBody input[value="p:child-1"]')).toBeChecked();
  await page.locator('#gtTaskModal [data-gt-close]').click();
  await expect(page.locator('#gtTaskModal')).toBeHidden();
  await panel.locator('[data-gt-linked-unlink="g1"]').click();
  await expect.poll(()=>state.gtCalls.find(x=>x.action==='unlink')?.body).toEqual(expect.objectContaining({task_id:'g1',links:[{project_id:'child-1'}]}));
  await expect(panel).toContainText('연결된 Google 할 일이 없습니다.');
  expect(state.tasks).toEqual([]);
});

test('V3 project task section rolls back a failed completion',async({page})=>{
  const state=baseState();state.sessionUser=true;state.gtToggleFail=true;
  state.gtasks.push({id:'g1',title:'자료 정리',due:null,status:'needsAction',taskListId:'@default',taskListTitle:'내 할 일',source:'google-task'});
  state.links.push({google_task_id:'g1',project_id:'child-1',status:'confirmed',task_completed:false});
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=child-1');await signIn(page);
  const panel=page.locator('#ps3-tasks [data-ps3-gtasks]');
  await panel.locator('[data-gt-linked-toggle="g1"]').click();
  await expect(panel.locator('[data-gt-linked-msg]')).toContainText('완료를 저장하지 못해 되돌렸습니다');
  await expect(panel.locator('[data-google-task="g1"]')).toHaveClass(/pending/);
});

test('V3 project links an existing unlinked Google task',async({page})=>{
  const state=baseState();state.sessionUser=true;
  state.gtasks.push(
    {id:'g-free',title:'연결 안 된 할 일',due:null,status:'needsAction',taskListId:'@default',taskListTitle:'내 할 일',source:'google-task'},
    {id:'g-other',title:'다른 프로젝트 할 일',due:null,status:'needsAction',taskListId:'@default',taskListTitle:'내 할 일',source:'google-task'}
  );
  state.links.push({google_task_id:'g-other',project_id:'main-1',status:'confirmed',task_completed:false});
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=child-1');await signIn(page);
  const panel=page.locator('#ps3-tasks [data-ps3-gtasks]');
  await expect(panel).toContainText('연결된 Google 할 일이 없습니다.');
  await page.locator('[data-ps3-gtask-link]').click();
  const picker=page.locator('#gtPickModal');
  await expect(picker).toBeVisible();
  await expect(picker.locator('[data-gt-pick]')).toHaveCount(1);
  await picker.locator('[data-gt-pick="g-free"]').click();
  await expect.poll(()=>state.gtCalls.find(x=>x.action==='link')?.body).toEqual(expect.objectContaining({task_id:'g-free',links:[{project_id:'child-1'}]}));
  await expect(picker.locator('[data-gt-pick="g-free"]')).toHaveText('연결됨');
  await expect(panel).toContainText('연결 안 된 할 일');
  await picker.locator('[data-gt-pick-close]').click();
  await expect(picker).toBeHidden();
  for(const width of [360,1280]){
    await page.setViewportSize({width,height:800});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  }
});

async function saveProbe(page,table,method='POST'){
  const probe={count:0,hold:true,fail:false,waiters:[]};
  probe.release=()=>{probe.hold=false;probe.waiters.splice(0).forEach(resolve=>resolve())};
  await page.route(`${SB}/rest/v1/${table}**`,async route=>{
    if(route.request().method()!==method)return route.fallback();
    probe.count++;
    if(probe.hold)await new Promise(resolve=>probe.waiters.push(resolve));
    if(probe.fail){probe.fail=false;return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'임시 저장 실패'})})}
    return route.fallback();
  });
  return probe;
}

test('saveWs creates once during repeated clicks and retries after failure',async({page})=>{
  const state=baseState();await mockApp(page,state);
  const probe=await saveProbe(page,'app_project_workstreams');
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('[data-ps3-add-ws]').click();
  await page.locator('#ps3WsTitle').fill('저장 잠금 영역');
  const button=page.locator('#ps3WsSave');
  await button.click();await expect.poll(()=>probe.count).toBe(1);
  await expect(button).toBeDisabled();await button.dispatchEvent('click');
  await page.waitForTimeout(150);expect(probe.count).toBe(1);
  probe.release();await expect(page.locator('#ps3WorkstreamModal')).toBeHidden();
  await page.locator('[data-ps3-add-ws]').click();
  await page.locator('#ps3WsTitle').fill('다시 시도 영역');
  probe.fail=true;await button.click();
  await expect(page.locator('#ps3WsState')).toContainText('임시 저장 실패');
  await expect(button).toBeEnabled();await button.click();
  await expect.poll(()=>probe.count).toBe(3);
  expect(state.workstreams.filter(x=>x.title==='저장 잠금 영역')).toHaveLength(1);
});

test('saveQuickProgress creates once during repeated submits and retries after failure',async({page})=>{
  const state=baseState();await mockApp(page,state);
  const probe=await saveProbe(page,'app_project_progress_updates');
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  const form=page.locator('[data-ps3-quick-progress="ws-1"]'),button=form.locator('button');
  await form.locator('input').fill('잠금 검증 기록');await button.click();await expect.poll(()=>probe.count).toBe(1);
  await expect(button).toBeDisabled();await form.dispatchEvent('submit');
  expect(probe.count).toBe(1);probe.release();await expect(page.locator('#toast')).toHaveText('진행상황을 기록했습니다.');await expect(button).toBeEnabled();await expect(form.locator('input')).toHaveValue('');
  await form.locator('input').fill('다시 시도 기록');probe.fail=true;await button.click();
  await expect(page.locator('#toast')).toContainText('저장 실패');await expect(button).toBeEnabled();await button.click();
  await expect.poll(()=>probe.count).toBe(3);await expect(form.locator('input')).toHaveValue('');
  expect(state.progress.filter(x=>x.summary==='잠금 검증 기록')).toHaveLength(1);
});

test('saveMemo creates once during repeated clicks and retries after failure',async({page})=>{
  const state=baseState();await mockApp(page,state);
  const probe=await saveProbe(page,'app_project_comments');
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-memos');await page.locator('#ps3MemoBody').fill('잠금 검증');
  const button=page.locator('[data-ps3-memo-save]');
  await button.click();await expect.poll(()=>probe.count).toBe(1);
  await expect(button).toBeDisabled();await button.dispatchEvent('click');
  await page.waitForTimeout(150);expect(probe.count).toBe(1);
  probe.release();await expect.poll(()=>state.comments.filter(x=>x.body==='잠금 검증').length).toBe(1);
  await page.locator('#ps3MemoBody').fill('다시 시도');
  probe.fail=true;await button.click();
  await expect(page.locator('#ps3MemoState')).toContainText('임시 저장 실패');
  await expect(button).toBeEnabled();await button.click();
  await expect.poll(()=>probe.count).toBe(3);
});

test('saveMilestone creates one Google request during repeated clicks and retries after failure',async({page})=>{
  const state=baseState();
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  await mockApp(page,state);
  const probe={count:0,hold:true,fail:false,waiters:[]};
  probe.release=()=>{probe.hold=false;probe.waiters.splice(0).forEach(resolve=>resolve())};
  await page.route(`${SB}/functions/v1/google-calendar**`,async route=>{
    const body=route.request().postDataJSON?.();
    if(route.request().method()!=='POST'||body?.action!=='create-event')return route.fallback();
    probe.count++;
    if(probe.hold)await new Promise(resolve=>probe.waiters.push(resolve));
    if(probe.fail){probe.fail=false;return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'임시 저장 실패'})})}
    return route.fallback();
  });
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await expect(page.locator('#ps3MilestoneSave')).toBeEnabled();
  await page.locator('#ps3MilestoneTitle').fill('잠금 검증 일정');
  await page.locator('#ps3MilestoneAt').fill('2026-10-02T10:00');
  const button=page.locator('#ps3MilestoneSave');
  await button.click();await expect.poll(()=>probe.count).toBe(1);
  await expect(button).toBeDisabled();await button.dispatchEvent('click');
  await page.waitForTimeout(150);expect(probe.count).toBe(1);
  probe.release();await expect(page.locator('#ps3MilestoneModal')).toBeHidden();
  await page.locator('[data-ps3-add-milestone]').click();
  await page.locator('#ps3MilestoneTitle').fill('다시 시도 일정');
  await page.locator('#ps3MilestoneAt').fill('2026-10-03T10:00');
  await expect(button).toBeEnabled();
  probe.fail=true;await button.click();
  await expect(page.locator('#ps3MilestoneState')).toContainText('임시 저장 실패');
  await expect(button).toBeEnabled();await button.click();
  await expect.poll(()=>probe.count).toBe(3);
});

// PRJ-progress: real UI with REST mocked at the network boundary.
async function openRecords(page,state){
  await mockApp(page,state);
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  const item=page.locator('[data-ps3-progress-item="ws-1"]');
  await expect(item.locator('[data-ps3-quick-progress] input')).toBeVisible();
  if(await item.locator('summary').count())await item.locator('summary').click();
  return item;
}
test('PRJ records stay editable while quick input stays visible and touch targets fit 390px',async({page})=>{
  const state=baseState(),item=await openRecords(page,state);
  const record=item.locator('[data-ps3-record="pr-1"]');
  await expect(record.locator('[data-ps3-record-menu]')).toBeVisible();
  await expect(item.locator('[data-ps3-progress-ws]')).toHaveCount(0);
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:844});
    const layout=await record.evaluate(el=>({buttons:[...el.querySelectorAll('button')].map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height})),overflow:document.documentElement.scrollWidth-innerWidth}));
    expect(layout.overflow).toBeLessThanOrEqual(1);
    for(const b of layout.buttons){expect(b.w).toBe(32);expect(b.h).toBe(32)}
  }
  const input=item.locator('[data-ps3-quick-progress] input');await input.fill('추가 기록');await input.press('Enter');
  await expect(item.locator('.ps3-pg-count')).toHaveText('2');await expect(input).toBeVisible();
  await expect(item.locator('.ps3-pg-record')).toHaveCount(2);
});
test('PRJ record edit cancels or saves only summary and preserves date and other fields',async({page})=>{
  const state=baseState(),before=structuredClone(state.progress[0]),item=await openRecords(page,state),record=item.locator('[data-ps3-record="pr-1"]');
  await recordAction(page,record,'수정');
  const form=record.locator('form[data-ps3-edit-record]');await expect(form.locator('input')).toHaveValue(before.summary);
  await form.locator('input').fill('취소할 글');await form.getByRole('button',{name:'취소',exact:true}).click();
  await expect(record.locator('p').first()).toHaveText(before.summary);
  await recordAction(page,record,'수정');await form.locator('input').fill('수정한 기록');
  const request=page.waitForRequest(r=>r.method()==='PATCH'&&r.url().includes('app_project_progress_updates'));
  await form.getByRole('button',{name:'저장',exact:true}).click();const req=await request;
  expect(new URL(req.url()).searchParams.get('id')).toBe('eq.pr-1');expect(req.postDataJSON()).toEqual({summary:'수정한 기록'});expect(req.headers().prefer).toBe('return=representation');
  await expect(record.locator('p').first()).toHaveText('수정한 기록');await expect(item.locator('.ps3-pg-summary')).toHaveCount(0);await expect(item.locator('.ps3-pg-record')).toBeVisible();
  expect(state.progress[0]).toEqual({...before,summary:'수정한 기록'});
});
test('PRJ record deletion confirms once, cancel sends nothing, success removes row and count',async({page})=>{
  const state=baseState();state.progress.unshift({...state.progress[0],id:'pr-2',summary:'최근 기록',effective_on:'2026-10-01'});
  const item=await openRecords(page,state),record=item.locator('[data-ps3-record="pr-2"]');
  page.once('dialog',d=>d.dismiss());await recordAction(page,record,'삭제');
  await expect(record).toBeVisible();expect(state.restCalls.filter(x=>x.name==='app_project_progress_updates'&&x.method==='DELETE')).toHaveLength(0);
  page.once('dialog',d=>d.accept());const request=page.waitForRequest(r=>r.method()==='DELETE'&&r.url().includes('app_project_progress_updates'));
  await recordAction(page,record,'삭제');const req=await request;
  expect(new URL(req.url()).searchParams.get('id')).toBe('eq.pr-2');expect(req.headers().prefer).toBe('return=representation');
  await expect(record).toHaveCount(0);await expect(item.locator('.ps3-pg-summary')).toHaveCount(0);await expect(item.locator('.ps3-pg-record')).toHaveCount(1);
  await expect(item.locator('.ps3-pg-record p').first()).toHaveText('국토부 후속협의 준비');
});
for(const method of ['PATCH','DELETE'])for(const status of [403,200])test(`PRJ ${method} ${status===403?'permission denied':'zero rows'} restores original record`,async({page})=>{
  const state=baseState(),item=await openRecords(page,state),record=item.locator('[data-ps3-record="pr-1"]');
  await page.route(`${SB}/rest/v1/app_project_progress_updates?**`,async route=>{
    if(route.request().method()!==method)return route.fallback();
    return route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===403?{message:'forbidden'}:[])});
  });
  if(method==='PATCH'){
    await recordAction(page,record,'수정');await record.locator('input').fill('저장 실패 글');await record.getByRole('button',{name:'저장',exact:true}).click();
  }else{page.once('dialog',d=>d.accept());await recordAction(page,record,'삭제')}
  await expect(page.locator('#toast')).toHaveText(method==='PATCH'?'수정 실패':'삭제 실패');
  await expect(record.locator('form[data-ps3-edit-record]')).toHaveCount(0);await expect(record.locator('p').first()).toHaveText('국토부 후속협의 준비');
  await expect(record.locator('[data-ps3-record-menu]')).toBeEnabled();await expect(item.locator('.ps3-pg-summary')).toHaveCount(0);await expect(item.locator('.ps3-pg-record')).toHaveCount(1);
});
test('PRJ dirty record asks before closing project and keeps draft when discard is cancelled',async({page})=>{
  const item=await openRecords(page,baseState()),record=item.locator('[data-ps3-record="pr-1"]');
  await recordAction(page,record,'수정');await record.locator('input').fill('未保存');
  let message='';page.once('dialog',async d=>{message=d.message();await d.dismiss()});await page.locator('[data-ps3-close="ps3DetailModal"]').click();
  expect(message).toContain('저장하지 않은 프로젝트 내용');await expect(record.locator('input')).toHaveValue('未保存');
  page.once('dialog',d=>d.accept());await page.locator('[data-ps3-close="ps3DetailModal"]').click();await expect(page.locator('#ps3DetailModal')).toBeHidden();
});

test('PRJ quick save unlocks while another record draft is dirty and preserves that draft',async({page})=>{
  const state=baseState(),item=await openRecords(page,state),record=item.locator('[data-ps3-record="pr-1"]');
  await recordAction(page,record,'수정');await record.locator('input').fill('수정 초안');
  const quick=item.locator('[data-ps3-quick-progress]');await quick.locator('input').fill('동시에 추가 기록');await quick.locator('button').click();
  await expect(page.locator('#toast')).toHaveText('진행상황을 기록했습니다.');await expect(quick.locator('button')).toBeEnabled();
  await expect(quick.locator('input')).toHaveValue('');await expect(record.locator('input')).toHaveValue('수정 초안');
  await record.getByRole('button',{name:'취소',exact:true}).click();
  // A subsequent normal save refreshes all records without losing or duplicating the earlier save.
  await quick.locator('input').fill('다음 기록');await quick.locator('button').click();await expect(item.locator('.ps3-pg-count')).toHaveText('3');
  expect(state.progress.filter(x=>x.summary==='동시에 추가 기록')).toHaveLength(1);
});
test('PRJ last record deletion leaves quick input visible',async({page})=>{
  const state=baseState(),item=await openRecords(page,state);page.once('dialog',d=>d.accept());
  await recordAction(page,item,'삭제');await expect(item.locator('.ps3-pg-record')).toHaveCount(0);
  await expect(item.locator('details')).toHaveCount(0);await expect(item.locator('[data-ps3-quick-progress] input')).toBeVisible();
});

test('PRJ pending delete cannot be displaced by a task refresh',async({page})=>{
  const state=baseState(),item=await openRecords(page,state),probe=await saveProbe(page,'app_project_progress_updates','DELETE');
  page.once('dialog',d=>d.accept());await recordAction(page,item,'삭제');await expect.poll(()=>probe.count).toBe(1);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:tasks-changed')));
  const quick=item.locator('[data-ps3-quick-progress]');await quick.locator('input').fill('삭제 대기 중 기록');await quick.locator('button').click();
  // Success toast is emitted only after refreshDetail resolves; it is the ordering barrier.
  await expect(page.locator('#toast')).toHaveText('진행상황을 기록했습니다.');
  await expect(item.locator('[data-ps3-record="pr-1"] [data-ps3-record-menu]')).toBeDisabled();
  probe.release();await expect(item.locator('[data-ps3-record="pr-1"]')).toHaveCount(0);await expect(item.locator('.ps3-pg-summary')).toHaveCount(0);await expect(item.locator('.ps3-pg-record')).toHaveCount(1);await expect(item.locator('[data-ps3-quick-progress] input')).toBeVisible();
});
for(const destination of ['library','back'])test(`PRJ dirty record confirms before ${destination} navigation`,async({page})=>{
  const item=await openRecords(page,baseState()),record=item.locator('[data-ps3-record="pr-1"]');
  await recordAction(page,record,'수정');await record.locator('input').fill('이동 전 초안');
  let message='';page.once('dialog',async d=>{message=d.message();await d.dismiss()});
  if(destination==='library'){await page.locator('[data-ps3-library]').click()}
  else{await page.evaluate(()=>{history.replaceState({},'', '/app/');history.pushState({project:'main-1'},'', '/app/?project=main-1')});await page.goBack()}
  await expect(page.locator('#ps3DetailModal')).toBeVisible();expect(message).toContain('저장하지 않은 프로젝트 내용');await expect(record.locator('input')).toHaveValue('이동 전 초안');
});

test('PRJ nested modal back preserves a pending delete result',async({page})=>{
  const state=baseState(),item=await openRecords(page,state),probe=await saveProbe(page,'app_project_progress_updates','DELETE');
  page.once('dialog',d=>d.accept());await recordAction(page,item,'삭제');await expect.poll(()=>probe.count).toBe(1);
  await item.locator('[data-ps3-edit-ws]').click();await expect(page.locator('#ps3WorkstreamModal')).toBeVisible();
  await page.goBack();await expect(page.locator('#ps3WorkstreamModal')).toBeHidden();
  const quick=item.locator('[data-ps3-quick-progress]');await quick.locator('input').fill('뒤로가기 경합 기록');await quick.locator('button').click();
  await expect(page.locator('#toast')).toHaveText('진행상황을 기록했습니다.');
  await expect(item.locator('[data-ps3-record="pr-1"] [data-ps3-record-menu]')).toBeDisabled();probe.release();
  await expect(item.locator('[data-ps3-record="pr-1"]')).toHaveCount(0);await expect(item.locator('.ps3-pg-summary')).toHaveCount(0);await expect(item.locator('.ps3-pg-record')).toHaveCount(1);
});

for(const width of [390,1440])for(const fallback of [false,true])test(`D-3e record menu dismissal and targets ${width} fallback=${fallback}`,async({page})=>{
  if(fallback)await page.addInitScript(()=>{HTMLElement.prototype.showPopover=undefined;HTMLElement.prototype.hidePopover=undefined});
  await page.setViewportSize({width,height:900});const state=baseState();state.progress.push({...state.progress[0],id:'pr-2'});
  const item=await openRecords(page,state);await page.setViewportSize({width,height:900});const trigger=item.locator('[data-ps3-record-menu="pr-1"]'),panel=page.locator('#ps3RecordMenu');
  await expect(trigger).toBeVisible();
  const geometry=await trigger.evaluate(b=>{const r=b.getBoundingClientRect(),p=getComputedStyle(b,'::after');return {w:r.width,h:r.height,inset:p.top,minW:p.minWidth,minH:p.minHeight}});
  expect(page.viewportSize().width).toBe(width);expect(geometry).toEqual({w:32,h:32,inset:'-6px',minW:'44px',minH:'44px'});
  const r=await trigger.boundingBox();await page.mouse.click(r.x+r.width/2,r.y-5);await expect(panel).toBeVisible();
  await expect(panel.locator('button')).toHaveText(['수정','삭제']);
  for(const button of await panel.locator('button').all())expect((await button.boundingBox()).height).toBe(44);
  const rect=await panel.boundingBox();expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(trigger).toBeFocused();await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await trigger.click();await page.locator('#ps3Title').click();await expect(panel).toBeHidden();
  await trigger.click();await item.locator('[data-ps3-record-menu="pr-2"]').click();await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(panel).toBeVisible();
  await page.goBack();await expect(panel).toBeHidden();await expect(page.locator('#ps3DetailModal')).toBeVisible();
});

async function recordAction(page,row,name){await row.locator('[data-ps3-record-menu]').first().click();await page.locator('#ps3RecordMenu').getByRole('button',{name,exact:true}).click();}

for(const width of [390,1440])for(const [phase,label] of [['done','종료'],['follow_up','후속조치']])test(`D-3e follow-up long progress title keeps phase single line ${width} ${phase}`,async({page})=>{
  const state=baseState();state.progress.push({...state.progress[0],id:'phase-second'});state.workstreams[0].phase=phase;state.workstreams[0].title='긴 제목 확인용 항목 '.repeat(12);
  expect(state.workstreams[0].title.length).toBeGreaterThanOrEqual(40);
  const item=await openRecords(page,state);await page.setViewportSize({width,height:900});
  const badge=item.locator('.ps3-phase'),title=item.locator('.ps3-pg-title');await expect(badge).toHaveText(label);
  const metrics=await item.evaluate(row=>{
    const badge=row.querySelector('.ps3-phase'),title=row.querySelector('.ps3-pg-title'),s=getComputedStyle(badge),t=getComputedStyle(title);
    const probe=document.createElement('span');probe.style.color='var(--kptu-info)';row.append(probe);const info=getComputedStyle(probe).color;probe.style.color='var(--kptu-muted)';const muted=getComputedStyle(probe).color;probe.remove();
    return {height:badge.getBoundingClientRect().height,size:s.fontSize,nowrap:s.whiteSpace,flex:s.flex,color:s.color,info,countColor:getComputedStyle(row.querySelector('.ps3-pg-count')).color,muted,title:{width:title.clientWidth,scroll:title.scrollWidth,min:t.minWidth,overflow:t.overflow,ellipsis:t.textOverflow,nowrap:t.whiteSpace}};
  });
  expect(metrics.height).toBeGreaterThanOrEqual(21);expect(metrics.height).toBeLessThanOrEqual(24);
  expect(metrics.size).toBe('12px');expect(metrics.nowrap).toBe('nowrap');expect(metrics.flex).toBe('0 0 auto');expect(metrics.color).toBe(metrics.info);expect(metrics.countColor).toBe(metrics.muted);
  expect(metrics.title).toMatchObject({min:'0px',overflow:'hidden',ellipsis:'ellipsis',nowrap:'nowrap'});expect(metrics.title.scroll).toBeGreaterThan(metrics.title.width);
});

for(const width of [390,1280])test(`D-4c single progress record has no duplicate summary at ${width}`,async({page})=>{
  const state=baseState();await mockApp(page,state);await page.setViewportSize({width,height:844});
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  const item=page.locator('[data-ps3-progress-item="ws-1"]');
  await expect(item.locator('.ps3-pg-summary')).toHaveCount(0);
  await expect(item.locator('.ps3-pg-record')).toHaveCount(1);
  await expect(item.locator('.ps3-pg-record')).toBeVisible();
  await expect(item.locator('.ps3-pg-record p').first()).toHaveText('국토부 후속협의 준비');
  await expect(item.locator('[data-ps3-record-menu]')).toBeVisible();
  await item.locator('[data-ps3-quick-progress] input').fill('두 번째 기록');
  await item.locator('[data-ps3-quick-progress] button').click();
  await expect(item.locator('.ps3-pg-summary')).toHaveText('두 번째 기록');
  await expect(item.locator('.ps3-pg-count')).toHaveText('2');
  await item.locator('summary').click();await expect(item.locator('.ps3-pg-record')).toHaveCount(2);
  page.once('dialog',d=>d.accept());await recordAction(page,item.locator('.ps3-pg-record').first(),'삭제');
  await expect(item.locator('.ps3-pg-summary')).toHaveCount(0);
  await expect(item.locator('.ps3-pg-record')).toHaveCount(1);await expect(item.locator('.ps3-pg-record')).toBeVisible();
});
