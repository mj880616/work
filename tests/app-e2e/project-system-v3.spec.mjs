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
  decisions:[],comments:[],tasks:[],events:[],meetings:[],pages:[],spaceMembers:[],sections:[],blocks:[],publication:{}
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

test('V3 selects canonical content, previews, publishes, copies and revokes a project URL',async({page,context})=>{
  const state=baseState();
  state.sections=[{id:'section-1',project_id:'main-1',title:'사업 현황',sort_order:10}];
  state.blocks=[
    {id:'block-1',project_id:'main-1',section_id:'section-1',block_type:'text',title:'공개 상황',content:{text:'외부 현황'},sort_order:10},
    {id:'block-2',project_id:'main-1',section_id:'section-1',block_type:'text',title:'교섭 전략',content:{text:'내부 전략'},sort_order:20}
  ];
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('[data-ps3-public-status]')).toContainText('내부');
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-ps3-publish-block="block-1"]').click();
  await expect.poll(()=>state.publication['main-1']?.blocks[0]?.published).toBe(true);
  await expect(page.locator('[data-ps3-block="block-1"] small')).toContainText('공개 선택');
  await page.locator('[data-ps3-public-summary]').fill('외부에서 읽을 짧은 소개');
  await page.locator('[data-ps3-save-summary]').click();
  await expect.poll(()=>state.publication['main-1']?.public_summary).toBe('외부에서 읽을 짧은 소개');
  await page.locator('[data-ps3-preview]').click();
  await expect(page.locator('[data-ps3-preview-panel]')).toContainText('외부에서 읽을 짧은 소개');
  await expect(page.locator('[data-ps3-preview-panel]')).toContainText('외부 현황');
  await expect(page.locator('[data-ps3-preview-panel]')).not.toContainText('내부 전략');
  page.once('dialog',dialog=>dialog.accept());await page.locator('[data-ps3-publish-project]').click();
  await expect.poll(()=>state.publication['main-1']?.published).toBe(true);
  await expect(page.locator('[data-ps3-public-status]')).toContainText('공개 중');
  await page.locator('[data-ps3-copy-public]').click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).toContain('/p/?slug=project-');
  await page.locator('[data-ps3-publish-project]').click();
  await expect.poll(()=>state.publication['main-1']?.published).toBe(false);
  await expect(page.locator('[data-ps3-public-status]')).toContainText('내부');
});

test('parent and child publication states are independent and public order differs from editing order',async({page})=>{
  const state=baseState();state.sections=[{id:'section-1',project_id:'main-1',title:'현황',sort_order:10}];
  state.blocks=[
    {id:'block-1',project_id:'main-1',section_id:'section-1',block_type:'text',title:'첫 항목',content:{text:'A'},sort_order:10},
    {id:'block-2',project_id:'main-1',section_id:'section-1',block_type:'text',title:'둘째 항목',content:{text:'B'},sort_order:20}
  ];
  state.publication['main-1']={published:false,public_summary:null,blocks:[{id:'block-1',published:true,public_order:10},{id:'block-2',published:true,public_order:20}]};
  state.publication['child-1']={published:true,public_summary:'하위 공개',blocks:[]};
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('[data-ps3-public-status]')).toContainText('내부');
  await page.locator('[data-ps3-public-down="block-1"]').click();
  await expect.poll(()=>state.publication['main-1'].blocks.find(x=>x.id==='block-1').public_order).toBe(20);
  await expect(page.locator('.ps3-content-section [data-ps3-block]').first()).toHaveAttribute('data-ps3-block','block-1');
  await page.locator('[data-ps3-preview]').click();
  const preview=page.locator('[data-ps3-preview-panel] .ps3-public-preview-block');
  await expect(preview.first()).toContainText('둘째 항목');
  await page.locator('.ps3-child-menu summary').click();await page.locator('.ps3-child-menu [data-ps3-project="child-1"]').click();
  await expect(page.locator('[data-ps3-public-status]')).toContainText('공개 중');
});

test('workspace role alone does not offer project publication or block edits',async({page})=>{
  const state=baseState();state.spaces[0].owner_id='other-user';
  state.sections=[{id:'section-1',project_id:'main-1',title:'현황',sort_order:10}];
  state.blocks=[{id:'block-1',project_id:'main-1',section_id:'section-1',block_type:'text',title:'내부 현황',content:{text:'비공개'},sort_order:10}];
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('[data-ps3-block="block-1"]')).toContainText('비공개');
  await expect(page.locator('[data-ps3-edit-block],[data-ps3-publish-block],[data-ps3-publish-project]')).toHaveCount(0);
});

test('V3 edits canonical project blocks without losing structured content and changes their order',async({page})=>{
  const state=baseState();
  state.sections=[{id:'section-1',project_id:'main-1',title:'산별전환 현황',sort_order:10},{id:'section-2',project_id:'main-1',title:'사업 과제',sort_order:20}];
  state.blocks=[
    {id:'block-1',project_id:'main-1',section_id:'section-1',block_type:'text',title:'현재 상황',content:{text:'전환 논의 진행 중'},sort_order:10},
    {id:'block-2',project_id:'main-1',section_id:'section-1',block_type:'table',title:'조직별 현황',content:{columns:['조직','상태'],rows:[['철도','논의'],['지하철','교육']]},sort_order:20}
  ];
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await expect(page.locator('[data-ps3-block="block-1"]')).toContainText('전환 논의 진행 중');
  await expect(page.locator('[data-ps3-block="block-2"]')).toContainText('지하철');
  await page.locator('[data-ps3-edit-block="block-1"]').click();
  await page.locator('[data-ps3-block-text]').fill('새 상황');
  await page.locator('[data-ps3-save-block]').click();
  await expect.poll(()=>state.blocks[0].content.text).toBe('새 상황');
  await page.locator('[data-ps3-edit-block="block-2"]').click();
  await page.locator('[data-ps3-block-title]').fill('조직 현황 변경');
  await page.locator('[data-ps3-save-block]').click();
  await expect.poll(()=>state.blocks[1].title).toBe('조직 현황 변경');
  expect(state.blocks[1].content).toEqual({columns:['조직','상태'],rows:[['철도','논의'],['지하철','교육']]});
  await page.locator('[data-ps3-block-down="block-1"]').click();
  await expect.poll(()=>state.blocks[0].sort_order>state.blocks[1].sort_order).toBe(true);
  await expect(page.locator('.ps3-content-section [data-ps3-block]').first()).toHaveAttribute('data-ps3-block','block-2');
});

test('V3 edits existing timeline and status items without flattening their JSON',async({page})=>{
  const state=baseState();state.sections=[{id:'section-1',project_id:'main-1',title:'산별전환',sort_order:10}];
  state.blocks=[
    {id:'timeline-1',project_id:'main-1',section_id:'section-1',block_type:'timeline',title:'추진 경과',content:{items:[{date:'5/18',title:'간담회',body:'의견 확인',source_id:'source-preserved'}]},sort_order:10},
    {id:'status-1',project_id:'main-1',section_id:'section-1',block_type:'status',title:'조직별 현황',content:{items:[{label:'철도',value:'토론 중',note:'교육',unknown:'keep'}]},sort_order:20}
  ];
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('[data-ps3-edit-block="timeline-1"]').click();
  await page.locator('[data-ps3-item="body"]').fill('현장 질문 반영');
  await page.locator('[data-ps3-save-block]').click();
  await expect.poll(()=>state.blocks[0].content.items[0].body).toBe('현장 질문 반영');
  expect(state.blocks[0].content.items[0].source_id).toBe('source-preserved');
  await expect(page.locator('[data-ps3-editing="timeline-1"]')).toHaveCount(0);
  await page.locator('[data-ps3-edit-block="status-1"]').click();
  await expect(page.locator('[data-ps3-editing="status-1"]')).toBeVisible();
  await page.locator('[data-ps3-item="value"]').fill('총투표 논의');
  await page.locator('[data-ps3-save-block]').click();
  await expect.poll(()=>state.blocks[1].content.items[0].value).toBe('총투표 논의');
  expect(state.blocks[1].content.items[0].unknown).toBe('keep');
});

test('V3 keeps unsaved project content in place after a failed save',async({page})=>{
  const state=baseState();state.sections=[{id:'section-1',project_id:'main-1',title:'현황',sort_order:10}];
  state.blocks=[{id:'block-1',project_id:'main-1',section_id:'section-1',block_type:'text',title:'메모',content:{text:'원문'},sort_order:10}];
  await mockApp(page,state);
  let fail=true;await page.route(`${SB}/rest/v1/app_project_blocks?*`,async route=>{
    if(fail&&route.request().method()==='PATCH'&&new URL(route.request().url()).searchParams.get('id')==='eq.block-1'){fail=false;return route.fulfill({status:503,contentType:'application/json',body:'{"message":"offline"}'})}
    return route.fallback();
  });
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('[data-ps3-edit-block="block-1"]').click();
  await page.locator('[data-ps3-block-text]').fill('잃어서는 안 되는 입력');
  await page.locator('[data-ps3-save-block]').click();
  await expect(page.locator('[data-ps3-block-state]')).toContainText('실패');
  await expect(page.locator('[data-ps3-block-text]')).toHaveValue('잃어서는 안 되는 입력');
  await page.locator('[data-ps3-save-block]').click();
  await expect.poll(()=>state.blocks[0].content.text).toBe('잃어서는 안 되는 입력');
});

test('V3 warns before leaving an unsaved block and ignores background refresh',async({page})=>{
  const state=baseState();state.sections=[{id:'section-1',project_id:'main-1',title:'현황',sort_order:10}];
  state.blocks=[{id:'block-1',project_id:'main-1',section_id:'section-1',block_type:'text',title:'메모',content:{text:'원문'},sort_order:10}];
  await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('[data-ps3-edit-block="block-1"]').click();
  await page.locator('[data-ps3-block-text]').fill('아직 저장하지 않음');
  await page.evaluate(()=>window.dispatchEvent(new Event('kptu:tasks-changed')));
  await expect(page.locator('[data-ps3-block-text]')).toHaveValue('아직 저장하지 않음');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('[data-ps3-close="ps3DetailModal"]').click();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await expect(page.locator('[data-ps3-block-text]')).toHaveValue('아직 저장하지 않음');
});

test('V3 adds a section and content in place with explicit save',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto('http://127.0.0.1:8123/app/?project=main-1');await signIn(page);
  await page.locator('[data-ps3-add-section]').click();
  await page.locator('[data-ps3-new-section] input').fill('새 사업 현황');
  await page.locator('[data-ps3-new-section] button[type="submit"]').click();
  await expect.poll(()=>state.sections.find(x=>x.title==='새 사업 현황')?.id).toBeTruthy();
  const section=state.sections.find(x=>x.title==='새 사업 현황');
  await page.locator(`[data-ps3-add-block="${section.id}"]`).click();
  await page.locator('[data-ps3-new-block] [data-ps3-block-title]').fill('이번 주 현황');
  await page.locator('[data-ps3-new-block] [data-ps3-block-text]').fill('내부 검토 중');
  await page.locator('[data-ps3-new-block] button[type="submit"]').click();
  await expect.poll(()=>state.blocks.find(x=>x.title==='이번 주 현황')?.content.text).toBe('내부 검토 중');
  await expect(page.locator(`[data-ps3-section="${section.id}"]`)).toContainText('내부 검토 중');
});

test('V3 mobile project creation, detail scrolling and linked document remain usable',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const state=baseState();
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
  await page.locator('#ps3CreateType').selectOption('campaign');
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
  await page.locator('#ps3WsTitle').fill('모바일 QA 진행 영역');
  await page.locator('#ps3WsSave').click();
  await expect.poll(()=>state.workstreams.some(x=>x.title==='모바일 QA 진행 영역')).toBe(true);
  await page.locator('[data-ps3-add-progress]').click();
  await expect(page.locator('#ps3ProgressModal')).toBeVisible();
  await page.locator('#ps3ProgressSummary').fill('모바일 QA 현재 상황');
  await page.locator('#ps3ProgressNext').fill('다음 현장 확인');
  await page.locator('#ps3ProgressSave').click();
  await expect.poll(()=>state.progress.some(x=>x.summary==='모바일 QA 현재 상황')).toBe(true);
  await page.locator('[data-ps3-global="document"]').click();
  await expect(page.locator('#documentModal')).toBeVisible();
  await expect(page.locator('#docProject')).toHaveValue(created.id);
  await page.locator('[data-close="documentModal"]').first().click();
  await page.locator('[data-ps3-global="meeting"]').click();
  await expect(page.locator('#meetingModal')).toBeVisible();
  await expect(page.locator('#meetingProject')).toHaveValue(created.id);
  await page.locator('#meetingModal [data-close]').first().click();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
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

test('V3 keeps the testimony child canonical and excludes private import snapshots from active lists',async({page})=>{
  const state=baseState();
  state.spaces[1].metadata.source_draft_id='page-child';
  state.pages=[
    {id:'page-child',space_id:'main-1',title:'국회토론회 현장증언을 찾습니다',slug:'web1-two-person-testimony-draft',summary:'증언 모집',body:'보존할 비공개 원문',status:'draft',visibility:'private',updated_at:'2026-09-20T10:00:00Z',metadata:{web1_trial_import:true,web1_source_id:'2in1/field-testimony-1002/index.html',web1_parent_source_id:'2in1/index.html'}},
    {id:'page-parent',space_id:'main-1',title:'위험업무 2인1조 법제화 사업 현황',slug:'web1-two-person-overview-draft',summary:'사업현황',body:'보존할 상위 원문',status:'draft',visibility:'private',updated_at:'2026-09-19T10:00:00Z',metadata:{web1_trial_import:true,web1_source_id:'2in1/index.html'}},
    {id:'page-notice',space_id:'main-1',title:'독립 현장 공지',slug:'standalone-notice',summary:'독립 공지 요약',body:'독립 공지 본문',status:'published',visibility:'public',updated_at:'2026-09-18T10:00:00Z',metadata:{}}
  ];
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/?project=main-1');
  await signIn(page);
  await page.locator('.ps3-child-menu summary').click();
  await expect(page.locator('.ps3-child-menu [data-ps3-project="child-1"]')).toBeVisible();
  const rows=page.locator('#ps3-pages .ps3-page-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('독립 현장 공지');
  await expect(page.locator('#ps3-pages [data-ps3-global="page"]')).toHaveCount(0);
  await page.locator('[data-ps3-close="ps3DetailModal"]').click();
  await page.locator('[data-view="pages"]').click();
  await expect(page.locator('#pageList .page-card')).toHaveCount(1);
  await expect(page.locator('#pageList')).toContainText('독립 현장 공지');
  await page.goto('http://127.0.0.1:8123/app/?view=pages&page=page-child');
  await expect(page.locator('#pageInlineViewer')).toBeVisible();
  await expect(page.locator('#pivSheet')).toContainText('보존할 비공개 원문');
});

test('board rows keep publication prominent and actions in a compact disclosure at four widths',async({page})=>{
  const state=baseState();
  state.pages=[{id:'page-notice',space_id:'main-1',title:'독립 현장 공지',slug:'standalone-notice',summary:'한 줄로 읽는 공지 요약',body:'공지 본문',status:'published',visibility:'public',updated_at:'2026-09-18T10:00:00Z',metadata:{}}];
  await mockApp(page,state);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:8123/app/');await signIn(page);
  await page.locator('[data-view="pages"]').click();
  const card=page.locator('#pageList .page-card').first();
  await expect(card).toBeVisible();
  await expect(card.locator('[data-page-visibility]')).toHaveText('공개');
  await expect(card.locator('.page-row-menu summary')).toBeVisible();
  await expect(card.locator('[data-edit-page]')).toBeHidden();
  for(const width of [1440,768,390,360]){
    await page.setViewportSize({width,height:900});
    const layout=await page.evaluate(()=>{
      const rect=selector=>document.querySelector(selector).getBoundingClientRect();
      return {cardHeight:rect('#pageList .page-card').height,searchY:rect('#pageSearch').y,filterY:rect('#pageFilter').y,overflow:document.documentElement.scrollWidth-window.innerWidth};
    });
    expect(layout.cardHeight).toBeLessThan(width<=650?110:85);
    if(width>=768)expect(Math.abs(layout.searchY-layout.filterY)).toBeLessThan(2);
    expect(layout.overflow).toBeLessThanOrEqual(1);
  }
  await card.locator('.page-row-menu summary').click();
  await expect(page.locator('#pageInlineViewer')).toBeHidden();
  await expect(card.locator('[data-edit-page]')).toBeVisible();
  await expect(card.locator('[data-page-select-delete]')).toBeVisible();
  await page.evaluate(()=>{window.__copiedPageUrl='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedPageUrl=value}}})});
  await card.locator('[data-copy-page]').click();
  await expect.poll(()=>page.evaluate(()=>window.__copiedPageUrl)).toContain('/p/?slug=standalone-notice');
  await card.locator('[data-page-visibility-action]').click();
  await expect(page.locator('#editorModal')).toBeVisible();
  await expect(page.locator('#pageVisibility')).toHaveValue('public');
  await page.locator('[data-close="editorModal"]').first().click();
  await card.locator('.page-row-menu summary').click();
  await card.locator('.page-row-menu summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pageInlineViewer')).toBeHidden();
  await page.keyboard.press('Enter');
  await card.locator('h3').click();
  await expect(page.locator('#pageInlineViewer')).toBeVisible();
  await expect(page.locator('#pivSheet')).toContainText('공지 본문');
  await page.locator('[data-piv-back]').click();
  await card.locator('.page-row-open').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pageInlineViewer')).toBeVisible();
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
