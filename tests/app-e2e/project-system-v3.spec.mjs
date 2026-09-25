import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';

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
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
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
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path==='/rest/v1/rpc/app_project_publication_state')return ok(state.publication?.[body?.p_project]||{published:false,public_summary:null,blocks:[]});
    if(path==='/rest/v1/rpc/app_set_project_block_publication'){
      const row=state.blocks.find(x=>x.id===body?.p_block);if(!row||body.p_publish&&!body.p_confirm)return ok(false);
      const pub=state.publication[row.project_id]||={published:false,public_summary:null,blocks:[]};
      const entry=pub.blocks.find(x=>x.id===row.id);
      if(entry)Object.assign(entry,{published:body.p_publish,public_order:body.p_order??entry.public_order});
      else pub.blocks.push({id:row.id,published:body.p_publish,public_order:body.p_order??row.sort_order});
      return ok(true);
    }
    if(path==='/rest/v1/rpc/app_set_project_publication'){
      const pub=state.publication[body?.p_project]||={published:false,public_summary:null,blocks:[]};
      if(body.p_publish&&!pub.published&&!body.p_confirm)return ok(false);
      pub.published=body.p_publish;pub.public_summary=body.p_summary;return ok(true);
    }
    if(path==='/rest/v1/rpc/app_move_project_public_block'){
      const pub=Object.values(state.publication).find(x=>x.blocks.some(b=>b.id===body?.p_block));if(!pub)return ok(false);
      const rows=pub.blocks.filter(x=>x.published).sort((a,b)=>a.public_order-b.public_order),index=rows.findIndex(x=>x.id===body.p_block),target=rows[index+body.p_direction];
      if(!target)return ok(false);[rows[index].public_order,target.public_order]=[target.public_order,rows[index].public_order];return ok(true);
    }
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
      if(method==='GET'){const id=eq(url,'id'),owner=eq(url,'owner_id');let rows=id?state.spaces.filter(x=>x.id===id):state.spaces;rows=rows.filter(x=>!owner||x.owner_id===owner);return ok(rows)}
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
      const pid=eq(url,key),id=eq(url,'id');
      if(method==='GET')return ok(arr.filter(x=>(!pid||x[key]===pid)&&(!id||x.id===id)));
      if(method==='POST'){const rows=(Array.isArray(body)?body:[body]).map((x,i)=>({...x,id:x.id||`${name}-${arr.length+i+1}`,created_at:now(),updated_at:now()}));arr.push(...rows);return ok(rows)}
      if(method==='PATCH'){const targets=id?arr.filter(x=>x.id===id):arr.filter(x=>!pid||x[key]===pid);targets.forEach(x=>Object.assign(x,body||{}));return ok([])}
      if(method==='DELETE'){if(id){const i=arr.findIndex(x=>x.id===id);if(i>=0)arr.splice(i,1)}return ok([])}
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
  await enterLogin(page);
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('owner@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}
function baseState(){return{
  user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'프로젝트 관리자'}},workspace:{id:'workspace-1',slug:'team',name:'공공기관사업팀 Workspace'},
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
  decisions:[],comments:[],tasks:[],events:[],meetings:[],pages:[],spaceMembers:[],sections:[],blocks:[],publication:{},
  googleStatus:{connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}},googleCalls:[],googleFailures:{},restFailures:{},restCalls:[],callOrder:[]
}}

test('project list loads and its heading uses available width at desktop, tablet and phone sizes',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
  await page.locator('[data-view="projects"]').click();
  await expect(page.locator('#projectsView')).toBeVisible();
  await expect(page.locator('#projectGrid[data-ps3-ready="1"] .ps3-project-card')).toHaveCount(1);
  for(const width of [1440,768,390,360]){
    await page.setViewportSize({width,height:900});
    const layout=await page.evaluate(()=>{
      const head=document.querySelector('#projectsView .section-head');
      const title=head.firstElementChild;
      const grid=document.querySelector('#projectGrid');
      const card=grid.querySelector('.ps3-project-card');
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
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await page.locator('[data-view="projects"]').click();
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
    await page.locator('[data-ps3-add-milestone]').click();
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
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await page.locator('[data-view="projects"]').click();
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
  await expect(page.locator('[data-ps3-nav="ps3-content"],[data-ps3-nav="ps3-pages"],[data-ps3-nav="ps3-collaboration"],[data-ps3-nav="ps3-overview"],[data-ps3-nav="ps3-decisions"]')).toHaveCount(0);
  await expect(page.locator('#ps3Body')).not.toContainText('사업 콘텐츠·현황');
  await expect(page.locator('#ps3Body')).not.toContainText('기존 연결 게시글');
  await expect(page.locator('#ps3-memos')).toContainText('기존 협업 메모');
});

test('project memo supports add edit and delete',async({page})=>{
  const state=baseState();
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3-overview,#ps3-decisions')).toHaveCount(0);
  await expect(page.locator('#ps3-memos')).toBeVisible();
  await page.locator('#ps3MemoBody').fill('첫 메모');
  await page.locator('[data-ps3-memo-save]').click();
  await expect.poll(()=>state.comments.some(x=>x.body==='첫 메모')).toBe(true);
  const memo=state.comments.find(x=>x.body==='첫 메모');
  await page.locator(`[data-ps3-edit-memo="${memo.id}"]`).click();
  await page.locator('#ps3MemoBody').fill('수정 메모');
  await page.locator('[data-ps3-memo-save]').click();
  await expect.poll(()=>state.comments.find(x=>x.id===memo.id)?.body).toBe('수정 메모');
  page.once('dialog',d=>d.accept());
  await page.locator(`[data-ps3-delete-memo="${memo.id}"]`).click();
  await expect.poll(()=>state.comments.some(x=>x.id===memo.id)).toBe(false);
});


test('project creation omits type and visibility controls and starts with zero progress items',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
  await page.locator('[data-view="projects"]').click();
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
  await page.locator('[data-ps3-add-milestone]').click();
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
  await page.locator('[data-ps3-add-milestone]').click();
  await expect(page.locator('#ps3MilestoneGoogle')).toContainText('재연결 필요');
  await expect(page.locator('#ps3MilestoneGoogleHint')).toContainText('재연결이 필요');
  await expect(page.locator('#ps3MilestoneSave')).toBeDisabled();
});

test('new project milestone creates Google first, stores linkage, and excludes read-only calendars',async({page})=>{
  const state=baseState();
  state.googleStatus={
    connected:true,enabled:true,selected:['team-cal'],colors:{},eventColors:{},
    calendars:[
      {id:'owner@example.org',summary:'개인 일정',primary:true,accessRole:'owner',backgroundColor:'#4285f4'},
      {id:'team-cal',summary:'공공기관사업팀',primary:false,accessRole:'writer',backgroundColor:'#336699'},
      {id:'read-only',summary:'읽기 전용',primary:false,accessRole:'reader',backgroundColor:'#999999'}
    ]
  };
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');
  await signIn(page);
  await page.locator('[data-ps3-add-milestone]').click();
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
  const event=state.events.find(x=>x.id===milestone.event_id);
  expect(event?.project_id).toBe('main-1');
  const googleCreate=state.googleCalls.find(x=>x.action==='create-event');
  expect(googleCreate).toMatchObject({calendar_id:'owner@example.org',title:'Google 세부 캘린더 지정 일정',memo:'선택 캘린더 전달 검증'});
  expect(new Date(googleCreate.end_iso).getTime()-new Date(googleCreate.start_iso).getTime()).toBe(60*60*1000);
  expect(state.callOrder.indexOf('google:create-event')).toBeLessThan(state.callOrder.indexOf('app_events:POST'));
  expect(state.callOrder.indexOf('app_events:POST')).toBeLessThan(state.callOrder.indexOf('app_project_milestones:POST'));
});

test('Google create failure leaves no Web2-only project milestone',async({page})=>{
  const state=baseState();
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  state.googleFailures['create-event']='Google create failed';
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('[data-ps3-add-milestone]').click();
  await page.locator('#ps3MilestoneTitle').fill('실패 일정');
  await page.locator('#ps3MilestoneAt').fill('2026-10-02T15:00');
  await page.locator('#ps3MilestoneSave').click();
  await expect(page.locator('#ps3MilestoneState')).toContainText('Google create failed');
  expect(state.milestones.filter(x=>x.title==='실패 일정')).toHaveLength(0);
  expect(state.events.filter(x=>x.title==='실패 일정')).toHaveLength(0);
  expect(state.callOrder).not.toContain('app_events:POST');
});

test('local milestone failure rolls back the local event and newly created Google event',async({page})=>{
  const state=baseState();
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  state.restFailures['app_project_milestones:POST']=1;
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('[data-ps3-add-milestone]').click();
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
  await page.locator('[data-ps3-add-milestone]').click();
  await page.locator('#ps3MilestoneTitle').fill('하위 프로젝트 일정');
  await page.locator('#ps3MilestoneAt').fill('2026-10-03T09:00');
  await page.locator('#ps3MilestoneSave').click();
  await expect.poll(()=>state.milestones.some(x=>x.title==='하위 프로젝트 일정')).toBe(true);
  const milestone=state.milestones.find(x=>x.title==='하위 프로젝트 일정');
  expect(milestone.project_id).toBe('child-1');
  expect(state.events.find(x=>x.id===milestone.event_id)?.project_id).toBe('child-1');
});

test('legacy unlinked milestone edit preserves hidden fields and does not create a Google event',async({page})=>{
  const state=baseState();
  state.milestones[0].event_id='legacy-event';
  state.events.push({id:'legacy-event',workspace_id:'workspace-1',project_id:'main-1',workstream_id:'ws-1',title:'9.29 국회토론회',event_type:'other',start_at:'2026-09-29T05:00:00Z',end_at:null,calendar_scope:'personal'});
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('[data-ps3-edit-milestone="mile-1"]').click();
  await expect(page.locator('#ps3MilestoneGoogleHint')).toContainText('기존 미연동');
  await page.locator('#ps3MilestoneTitle').fill('레거시 일정 제목 수정');
  await page.locator('#ps3MilestoneSave').click();
  await expect.poll(()=>state.milestones[0].title).toBe('레거시 일정 제목 수정');
  expect(state.milestones[0].milestone_type).toBe('policy');
  expect(state.milestones[0].status).toBe('planned');
  expect(state.milestones[0].workstream_id).toBe('ws-1');
  expect(state.googleCalls).toHaveLength(0);
});

test('linked milestone update uses stored Google ids and keeps Web2 event in sync',async({page})=>{
  const state=baseState();
  Object.assign(state.milestones[0],{event_id:'local-event',google_calendar_id:'primary',google_event_id:'google-existing'});
  state.events.push({id:'local-event',workspace_id:'workspace-1',project_id:'main-1',workstream_id:'ws-1',title:'9.29 국회토론회',description:'국토부·TS 참석',event_type:'other',start_at:'2026-09-29T05:00:00Z',end_at:null,calendar_scope:'personal'});
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('[data-ps3-edit-milestone="mile-1"]').click();
  await expect(page.locator('#ps3MilestoneGoogle')).toHaveValue('primary');
  await page.locator('#ps3MilestoneTitle').fill('연동 일정 수정');
  await page.locator('#ps3MilestoneAt').fill('2026-09-30T16:00');
  await page.locator('#ps3MilestoneNotes').fill('수정 메모');
  await page.locator('#ps3MilestoneSave').click();
  await expect.poll(()=>state.milestones[0].title).toBe('연동 일정 수정');
  expect(state.googleCalls[0]).toMatchObject({action:'update-event',calendar_id:'primary',event_id:'google-existing',title:'연동 일정 수정',memo:'수정 메모'});
  expect(state.events.find(x=>x.id==='local-event')?.title).toBe('연동 일정 수정');
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
  await page.locator('[data-ps3-edit-milestone="mile-1"]').click();
  await page.locator('#ps3MilestoneTitle').fill('저장 실패 수정안');
  await page.locator('#ps3MilestoneSave').click();
  await expect(page.locator('#ps3MilestoneState')).toContainText('되돌렸습니다');
  expect(state.milestones[0].title).toBe('9.29 국회토론회');
  expect(state.events[0].title).toBe('9.29 국회토론회');
  expect(state.googleCalls.filter(x=>x.action==='update-event')).toHaveLength(2);
  expect(state.googleCalls.at(-1)).toMatchObject({event_id:'google-existing',title:'9.29 국회토론회'});
});

test('linked milestone delete uses stored Google ids and removes both local records',async({page})=>{
  const state=baseState();
  Object.assign(state.milestones[0],{event_id:'local-event',google_calendar_id:'primary',google_event_id:'google-existing'});
  state.events.push({id:'local-event',workspace_id:'workspace-1',project_id:'main-1',workstream_id:'ws-1',title:'9.29 국회토론회',event_type:'other',start_at:'2026-09-29T05:00:00Z',end_at:null,calendar_scope:'personal'});
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('[data-ps3-edit-milestone="mile-1"]').click();
  page.once('dialog',d=>d.accept());
  await page.locator('#ps3MilestoneDelete').click();
  await expect.poll(()=>state.milestones.some(x=>x.id==='mile-1')).toBe(false);
  expect(state.events.some(x=>x.id==='local-event')).toBe(false);
  expect(state.googleCalls.find(x=>x.action==='delete-event')).toMatchObject({calendar_id:'primary',event_id:'google-existing'});
});

test('linked milestone local delete failure restores Google linkage and milestone',async({page})=>{
  const state=baseState();
  Object.assign(state.milestones[0],{event_id:'local-event',google_calendar_id:'primary',google_event_id:'google-existing'});
  state.events.push({id:'local-event',workspace_id:'workspace-1',project_id:'main-1',workstream_id:'ws-1',title:'9.29 국회토론회',description:'국토부·TS 참석',event_type:'other',start_at:'2026-09-29T05:00:00Z',end_at:null,calendar_scope:'personal'});
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  state.restFailures['app_events:DELETE']=1;
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('[data-ps3-edit-milestone="mile-1"]').click();
  page.once('dialog',d=>d.accept());
  await page.locator('#ps3MilestoneDelete').click();
  await expect(page.locator('#ps3MilestoneState')).toContainText('복원했습니다');
  const restored=state.milestones.find(x=>x.id==='mile-1');
  expect(restored).toBeTruthy();
  expect(restored.google_calendar_id).toBe('primary');
  expect(restored.google_event_id).not.toBe('google-existing');
  expect(state.events.some(x=>x.id==='local-event')).toBe(true);
  expect(state.googleCalls.map(x=>x.action)).toEqual(expect.arrayContaining(['delete-event','create-event']));
});

test('rollback failure reports possible Google and Web2 inconsistency with the Google event id in console data',async({page})=>{
  const state=baseState();
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  state.restFailures['app_project_milestones:POST']=1;
  state.googleFailures['delete-event']='forced Google rollback failure';
  const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('[data-ps3-add-milestone]').click();
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
    await page.locator('[data-ps3-add-milestone]').click();
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
  await page.locator('#ps3WsTitle').fill('국토부 후속협의');
  await page.locator('#ps3WsSave').click();
  await expect.poll(()=>state.workstreams.some(x=>x.title==='국토부 후속협의')).toBe(true);
  await expect(page.locator('#ps3-progress')).toContainText('국토부 후속협의');
  const row=state.workstreams.find(x=>x.title==='국토부 후속협의');
  expect(row.description).toBeNull();
  expect(row.phase).toBe('in_progress');
});

test('progress cards prioritize title status latest update next step and record count',async({page})=>{
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

  const card=page.locator('[data-ps3-progress-card="ws-1"]');
  await expect(card.locator('h4')).toHaveText('정책·제도 대응');
  await expect(card.locator('.ps3-progress-count')).toHaveText('기록 2');
  await expect(card.locator('.ps3-progress-meta')).toContainText('진행');
  await expect(card.locator('.ps3-progress-meta')).toContainText('최근');
  await expect(card.locator('.ps3-progress-current')).toContainText('국토부 회신을 반영해 토론회 쟁점을 다시 정리함');
  await expect(card.locator('.ps3-progress-next')).toContainText('현장 조직 의견을 취합해 최종 요구안을 확정');
  await expect(card.locator('[data-ps3-edit-ws]')).toHaveText('항목 수정');
  await expect(card.locator('[data-ps3-progress-ws]')).toHaveText('진행상황 업데이트');

  const emptyCard=page.locator('[data-ps3-progress-card="ws-2"]');
  await expect(emptyCard.locator('.ps3-progress-count')).toHaveText('기록 0');
  await expect(emptyCard.locator('.ps3-progress-empty')).toContainText('아직 기록이 없습니다.');
  await expect(emptyCard.locator('[data-ps3-progress-ws]')).toBeVisible();
});

test('progress cards keep a two-column desktop layout and a readable single-column mobile layout',async({page})=>{
  const state=baseState();
  state.workstreams.push({id:'ws-2',project_id:'main-1',title:'현장 조직 대응과 매우 긴 진행상황 제목',description:'산하조직별 의견과 현장 조건을 함께 확인하는 중',phase:'consultation',sort_order:20});
  state.progress[0].summary='국토부 후속협의 준비와 운영기준 쟁점 정리를 동시에 진행하고 있으며 현장 의견을 반영 중';
  state.progress[0].next_step='토론회 전까지 산하조직 의견을 취합하고 최종 질의와 요구안을 확정';
  await mockApp(page,state);
  await page.setViewportSize({width:1280,height:900});
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');
  await signIn(page);
  await expect(page.locator('#ps3-progress')).toBeVisible();

  const desktop=await page.evaluate(()=>{
    const grid=document.querySelector('#ps3-progress .ps3-ws-grid');
    const cards=[...grid.querySelectorAll('.ps3-progress-card')];
    const r=el=>el.getBoundingClientRect();
    return {grid:r(grid).width,cards:cards.map(x=>r(x).width),columns:getComputedStyle(grid).gridTemplateColumns};
  });
  expect(desktop.cards).toHaveLength(2);
  expect(desktop.cards[0]).toBeLessThan(desktop.grid*.7);
  expect(desktop.columns.split(' ').length).toBe(2);

  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:844});
    const mobile=await page.evaluate(()=>{
      const grid=document.querySelector('#ps3-progress .ps3-ws-grid');
      const cards=[...grid.querySelectorAll('.ps3-progress-card')];
      const r=el=>el.getBoundingClientRect();
      return {
        overflow:document.documentElement.scrollWidth-window.innerWidth,
        grid:r(grid).width,
        cards:cards.map(x=>({width:r(x).width,overflow:x.scrollWidth-x.clientWidth})),
        columns:getComputedStyle(grid).gridTemplateColumns
      };
    });
    expect(mobile.overflow,`page overflow at ${width}px`).toBeLessThanOrEqual(1);
    expect(mobile.columns.split(' ').length,`columns at ${width}px`).toBe(1);
    for(const card of mobile.cards){
      expect(card.width,`card width at ${width}px`).toBeGreaterThan(mobile.grid*.95);
      expect(card.overflow,`card overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
  }
});

test('top-level project creates a task directly on the current project',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');
  await signIn(page);
  await page.locator('[data-ps3-global="task"]').click();
  await expect(page.locator('#taskModal')).toBeVisible();
  await expect(page.locator('#taskProject')).toHaveValue('main-1');
  const values=await page.locator('#taskProject option').evaluateAll(options=>options.map(o=>o.value));
  expect(values).toEqual(expect.arrayContaining(['','main-1','child-1']));
  await page.locator('#taskTitle').fill('상위 프로젝트 직접 연결 업무');
  await page.locator('#saveTaskBtn').click();
  await expect.poll(()=>state.tasks.some(x=>x.title==='상위 프로젝트 직접 연결 업무'&&x.project_id==='main-1')).toBe(true);
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
  await page.locator('[data-view="projects"]').click();
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
  const scroll=await page.locator('#ps3DetailModal .ps3-detail-card').evaluate(el=>{
    el.scrollTop=el.scrollHeight;
    return {top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight};
  });
  expect(scroll.total).toBeGreaterThan(scroll.height);
  expect(scroll.top).toBeGreaterThan(0);
  const width=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(width).toBeLessThanOrEqual(1);
  await page.locator('[data-ps3-add-milestone]').click();
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
  await page.locator(`[data-ps3-progress-ws="${mobileProgress.id}"]`).click();
  await expect(page.locator('#ps3ProgressModal')).toBeVisible();
  await page.locator('#ps3ProgressSummary').fill('모바일 QA 현재 상황');
  await page.locator('#ps3ProgressNext').fill('다음 현장 확인');
  await page.locator('#ps3ProgressSave').click();
  await expect.poll(()=>state.progress.some(x=>x.summary==='모바일 QA 현재 상황')).toBe(true);
  await page.locator('[data-ps3-global="document"]').click();
  await expect(page.locator('#documentModal')).toBeVisible();
  await expect(page.locator('#docProject')).toHaveValue(created.id);
  await page.locator('[data-close="documentModal"]').first().click();
  await expect(page.locator('[data-ps3-global="page"]')).toHaveCount(0);
  await page.locator('#ps3Hierarchy .ps3-child-menu summary').click();
  await page.locator('[data-ps3-child]').click();
  await expect(page.locator('#ps3CreateModal')).toBeVisible();
  await expect(page.locator('#ps3CreateParent')).toHaveValue(created.id);
  await page.locator('[data-ps3-close="ps3CreateModal"]').click();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('V3 uses a compact child-project menu and child returns to parent',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await page.locator('[data-view="projects"]').click();
  await expect(page.locator('[data-ps3-project="main-1"]')).toBeVisible();
  await expect(page.locator('#projectGrid [data-project]')).toHaveCount(0);
  await page.locator('[data-ps3-project="main-1"]').first().click();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await expect(page.locator('#ps3Kicker,#ps3Body .ps3-detail-meta')).toHaveCount(0);
  await expect(page.locator('#ps3DetailModal .ps3-modal-head')).not.toContainText('상시사업·산업관리');
  await expect(page.locator('#ps3DetailModal .ps3-modal-head')).not.toContainText('PROJECT');
  await expect(page.locator('#ps3Body .ps3-detail-head')).not.toContainText('기간 ·');
  await expect(page.locator('#ps3Body .ps3-detail-head')).not.toContainText('진행 영역 ·');
  await expect(page.locator('#ps3Hierarchy .ps3-child-menu')).toBeVisible();
  await expect(page.locator('.ps3-actions .ps3-child-menu')).toHaveCount(0);
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
  await page.locator('#ps3CreateName').fill('인력확충 투쟁');await page.locator('#ps3CreateObjective').fill('안전·공공서비스 인력확충');await page.locator('#ps3CreateSave').click();
  await expect.poll(()=>state.spaces.some(x=>x.name==='인력확충 투쟁')).toBeTruthy();
  const made=state.spaces.find(x=>x.name==='인력확충 투쟁');
  expect(made.visibility).toBe('private');
  expect(state.workstreams.filter(x=>x.project_id===made.id)).toHaveLength(0);
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
  await page.locator('.app-nav [data-view="projects"]').click();
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

test('V3 includes legacy child work areas under a V3 parent without changing their IDs',async({page})=>{
  const state=baseState();state.spaces.push({id:'legacy-child',workspace_id:'workspace-1',parent_id:'main-1',name:'국회토론회 준비',slug:'old-child',owner_id:'user-1',status:'active',visibility:'team',metadata:{legacy_snapshot:true}});
  state.tasks.push({id:'legacy-task',project_id:'legacy-child',title:'발제 원고 취합',status:'todo'});
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('.ps3-child-menu summary').click();
  await expect(page.locator('.ps3-child-menu [data-ps3-project="legacy-child"]')).toBeVisible();
  await page.locator('.ps3-child-menu [data-ps3-project="legacy-child"]').click();
  await expect(page.locator('#ps3Title')).toHaveText('국회토론회 준비');
  await expect(page.locator('#ps3-tasks')).toContainText('발제 원고 취합');
});


test('V3 project list only shows projects owned by the signed-in user',async({page})=>{
  const state=baseState();
  state.spaces.push({id:'other-owner',workspace_id:'workspace-1',name:'다른 사용자 프로젝트',parent_id:null,status:'active',visibility:'public',owner_id:'user-2',sort_order:30,metadata:{project_system:'v2',management_version:2}});
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await page.locator('[data-view="projects"]').click();
  await expect(page.locator('#projectGrid')).toContainText('민자철도 정책·조직사업');
  await expect(page.locator('#projectGrid')).not.toContainText('다른 사용자 프로젝트');
});

test('V3 keeps an owned legacy child visible even when its parent is not returned',async({page})=>{
  const state=baseState();
  state.spaces=[{id:'legacy-child-owned',workspace_id:'workspace-1',parent_id:'hidden-parent',name:'소유한 기존 하위 프로젝트',owner_id:'user-1',status:'active',visibility:'team',metadata:{project_system:'v2',management_version:2}}];
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);await page.locator('[data-view="projects"]').click();
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
  await page.locator('.ps3-child-menu summary').click();
  await expect(page.locator('.ps3-child-menu [data-ps3-project="child-1"]')).toBeVisible();
  await expect(page.locator('#ps3-pages')).toHaveCount(0);
  await expect(page.locator('#ps3Body')).not.toContainText('독립 현장 공지');
  await page.locator('[data-ps3-close="ps3DetailModal"]').click();
  await page.locator('[data-view="pages"]').click();
  await expect(page.locator('#web1BoardActive')).toContainText('위험업무 2인1조 법제화');
  await expect(page.locator('#web1BoardActive')).not.toContainText('독립 현장 공지');
});

test('Web1-backed board stays compact and excludes dedicated library and press sections',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:8123/app/');await signIn(page);
  await page.locator('[data-view="pages"]').click();
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
  const control=page.locator('[data-ps3-toggle-done]');await expect(control).toHaveText('완료');
  await control.click();
  await expect.poll(()=>state.spaces.find(x=>x.id==='main-1')?.status).toBe('done');
  await expect(page.locator('#ps3Title')).toHaveText('민자철도 정책·조직사업');
  await expect(control).toHaveText('완료 취소');
  await control.click();
  await expect.poll(()=>state.spaces.find(x=>x.id==='main-1')?.status).toBe('active');
});

test('V3 project task opens the shared task editor with its note',async({page})=>{
  const state=baseState();state.tasks.push({id:'task-1',workspace_id:'workspace-1',project_id:'child-1',title:'자료 정리',description:'초안 작성',note:'공유 전 확인',assignee_id:'user-1',created_by:'user-1',status:'todo',priority:'normal',source_type:'manual'});
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=child-1');await signIn(page);
  await page.locator('[data-ps3-task="task-1"]').click();
  await expect(page.locator('#taskModal')).toBeVisible();
  await expect(page.locator('#taskTitle')).toHaveValue('자료 정리');
  await expect(page.locator('#taskNote')).toHaveValue('공유 전 확인');
  await page.locator('#taskModalToggle').click();
  await expect.poll(()=>state.tasks.find(x=>x.id==='task-1')?.status).toBe('done');
});
