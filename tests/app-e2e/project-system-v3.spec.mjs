import {openLegacyBoard} from './helpers/legacy-board.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { watchRetiredCollaboration } from './helpers/retired-collaboration.mjs';
watchRetiredCollaboration(test);
import { enterLogin } from './helpers/login-entry.mjs';
import { calendarToday, addCalendarDays } from './helpers/calendar-today.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import {closeProjectDetail,expectProjectDetail,projectDetailDocked} from './helpers/project-detail.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';

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
    // Supabase token responses carry the signed-in user; the runtime binds its boot context to that owner.
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(await page.evaluate(()=>Date.now())/1000)+3600,user:state.user});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar'){
      state.googleEvents??=[];
      const calendarEvent=(calendarId,id)=>state.googleEvents.find(e=>e.calendarId===calendarId&&e.id===id)||(()=>{const m=state.milestones.find(m=>m.google_calendar_id===calendarId&&m.google_event_id===id);return m?{id,calendarId,title:m.title,description:m.notes||'',start:m.start_at,end:m.end_at||new Date(Date.parse(m.start_at)+3600000).toISOString(),allDay:false,location:'원래 장소',colorId:'4',organizationIds:['기존 조직'],recurring:false,source:'google'}:null})();
      const action=url.searchParams.get('action')||body?.action||'status';
      if(method==='POST'){
        state.googleCalls=state.googleCalls||[];
        state.callOrder=state.callOrder||[];
        state.googleCalls.push(body||{});
        state.callOrder.push('google:'+action);
        const failure=forcedFailure(state.googleFailures,action);
        if(failure)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:failure})});
        if(action==='delete-event'){state.googleEvents=state.googleEvents.filter(e=>e.id!==body.event_id||e.calendarId!==body.calendar_id);return ok({ok:true})}
        const id=action==='update-event'?(body?.event_id||'google-updated'):`google-${state.googleCalls.filter(x=>x.action==='create-event').length}`;
        const calendarId=body?.calendar_id||'primary',event={...(calendarEvent(calendarId,id)||{}),id,calendarId,title:body.title,description:body.memo||'',allDay:!!body.all_day,start:body.all_day?body.start_date:body.start_iso,end:body.all_day?new Date(Date.parse(body.end_date)+86400000).toISOString().slice(0,10):body.end_iso,source:'google'};for(const key of ['location','color_hex','organization_ids'])if(Object.hasOwn(body,key))event[key]=body[key];state.googleEvents=state.googleEvents.filter(e=>e.id!==id||e.calendarId!==calendarId);state.googleEvents.push(event);return ok({ok:true,event});
      }
      if(action==='event'){const event=calendarEvent(url.searchParams.get('calendarId'),url.searchParams.get('eventId'));return event?ok({event,eventColors:{}}):route.fulfill({status:400,json:{error:'exact event not found'}})}
      if(action==='events')return ok({events:state.googleEvents,colors:state.googleStatus?.colors||{},eventColors:{}});
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
    // TRASH-삭제휴지통 2단계: state.trash가 있으면 휴지통 함수(app_trash_*)와 [삭제]의 휴지통 이동을 흉내 낸다.
    // state.trash.missing이면 함수가 아직 없는 운영(404 PGRST202)을 흉내 낸다.
    if(path.startsWith('/rest/v1/rpc/app_trash_')&&state.trash){
      const t=state.trash;t.calls??=[];t.calls.push({fn:path.split('/').pop(),body});
      if(t.missing)return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'PGRST202',message:'Could not find the function '+path.split('/').pop()+' in the schema cache'})});
      const fail=message=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'P0001',message})});
      t.items??=[];
      // TRASH-화면2: 담당조직·사업 보고 종류. t.oldFunction이면 DB 적용 전의 옛 함수(프로젝트만 알고 다른 종류는 TRASH_KIND_UNKNOWN으로 거절)를 흉내 낸다.
      const otherKind=body?.p_kind&&body.p_kind!=='project'?body.p_kind:'';
      if(otherKind){
        if(t.oldFunction)return fail('TRASH_KIND_UNKNOWN');
        t.others??={organization:[],report:[]};t.others[otherKind]??=[];const list=t.others[otherKind];
        if(path.endsWith('app_trash_list'))return ok(list.map(x=>({kind:otherKind,...x})));
        const hit=list.find(x=>x.id===body?.p_id);
        if(!hit)return fail('TRASH_NOT_FOUND');
        t.others[otherKind]=list.filter(x=>x.id!==hit.id);
        t.done??=[];t.done.push({fn:path.split('/').pop(),kind:otherKind,id:hit.id});
        return ok({ok:true,kind:otherKind,id:hit.id});
      }
      if(path.endsWith('app_trash_list'))return ok(t.items.filter(x=>x.deleted_root_id===x.id).map(x=>({kind:'project',id:x.id,workspace_id:x.workspace_id,name:x.name,parent_id:x.parent_id,deleted_at:x.deleted_at,child_count:t.items.filter(c=>c.deleted_root_id===x.id&&c.id!==x.id).length,parent_in_trash:t.items.some(p=>p.id===x.parent_id)})));
      const root=t.items.find(x=>x.id===body?.p_id&&x.deleted_root_id===x.id);
      if(!root)return fail('TRASH_NOT_FOUND');
      if(path.endsWith('app_trash_restore')){
        if(t.items.some(p=>p.id===root.parent_id))return fail('TRASH_PARENT_IN_TRASH');
        const back=t.items.filter(x=>x.deleted_root_id===root.id);t.items=t.items.filter(x=>x.deleted_root_id!==root.id);
        for(const x of back){const {deleted_at,deleted_root_id,...row}=x;state.spaces.push(row)}
        return ok({ok:true,kind:'project',id:root.id,restored:back.length});
      }
      if(path.endsWith('app_trash_purge')){t.items=t.items.filter(x=>x.deleted_root_id!==root.id);return ok({ok:true,kind:'project',id:root.id})}
    }
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner',created_at:now()}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'프로젝트 관리자'}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);

    if(path==='/rest/v1/app_spaces'){
      if(method==='GET'){
        const id=url.searchParams.get('id')?.startsWith('eq.')?eq(url,'id'):'',owner=eq(url,'owner_id');let rows=id?state.spaces.filter(x=>x.id===id):state.spaces;rows=rows.filter(x=>!owner||x.owner_id===owner);
        if(url.searchParams.get('select')?.includes('milestones:')){
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
      if(method==='PATCH'){const id=eq(url,'id'),row=state.spaces.find(x=>x.id===id);if(row)Object.assign(row,body||{});return ok(req.headers()['prefer']?.includes('return=representation')?(row?[row]:[]):[])}
      if(method==='DELETE'){
        const id=eq(url,'id');
        if(state.trash&&!state.trash.missing){
          const ids=new Set([id]);for(let n=0;n<10;n++)for(const x of state.spaces)if(ids.has(x.parent_id))ids.add(x.id);
          state.trash.items??=[];const at=now();
          for(const x of state.spaces.filter(x=>ids.has(x.id)))state.trash.items.push({...x,deleted_at:at,deleted_root_id:id});
          state.spaces=state.spaces.filter(x=>!ids.has(x.id));return ok([]);
        }
        state.spaces=state.spaces.filter(x=>x.id!==id&&x.parent_id!==id);return ok([])
      }
    }
    const table=(name,arr,key='project_id')=>{
      if(path!==`/rest/v1/${name}`)return false;
      state.restCalls=state.restCalls||[];state.callOrder=state.callOrder||[];
      state.restCalls.push({name,method,body:body?structuredClone(body):body});
      state.callOrder.push(name+':'+method);
      const failure=forcedFailure(state.restFailures,name+':'+method);
      if(failure){route.fulfill({status:state.restFailureStatuses?.[name+':'+method]||500,contentType:'application/json',body:JSON.stringify({error:failure})});return true}
      const raw=String(url.searchParams.get(key)||''),inList=raw.startsWith('in.(')?raw.slice(4,-1).split(',').map(decodeURIComponent):null,pid=inList?'':eq(url,key),id=eq(url,'id');
      if(method==='GET'){const scopes=['workspace_id','owner_id','author_id','created_by','workstream_id'].filter(field=>url.searchParams.get(field)?.startsWith('eq.'));const rows=arr.filter(x=>(!pid||x[key]===pid)&&(!inList||inList.includes(x[key]))&&(!id||x.id===id)&&scopes.every(field=>String(x[field]??'')===eq(url,field)));if(name==='app_project_progress_updates')rows.sort((a,b)=>String(b.effective_on||'').localeCompare(String(a.effective_on||''))||String(b.created_at||'').localeCompare(String(a.created_at||'')));return ok(rows)}
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
  await signInWithSession(page,'owner@example.org');
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
  await page.goto(testOrigin+'/app/');
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
    // UI-PC프로젝트좌우: PC(≥1024) has no empty head bar above the split (its buttons live in the list head); the list column fills the screen.
    if(width>=1024)expect(layout.title,`no empty project head at ${width}px`).toBe(0);
    else expect(layout.title,`project heading at ${width}px`).toBeGreaterThan(100);
    expect(layout.card,`project card at ${width}px`).toBeGreaterThan(200);
    expect(layout.overflow,`horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }
});


test('project owner UI stays inside 360 390 412 and 430px viewports',async({page})=>{
  const state=baseState();state.workstreams.push({id:'ws-2',project_id:'main-1',title:'현장 조직 대응',description:null,phase:'preparation',sort_order:20});await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);await clickView(page,'projects');
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
    await page.locator('[data-ps3-record="ws-2"] [data-ps3-record-menu]').click();await page.locator('#ps3RecordMenu').getByRole('button',{name:'수정',exact:true}).click();
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
  await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);await clickView(page,'projects');
  await expect(page.locator('#projectGrid')).toContainText('민자철도 정책·조직사업');
  await expect(page.locator('#projectGrid')).not.toContainText('B 사용자 프로젝트');
  state.user={id:'user-2',email:'b@example.org',user_metadata:{display_name:'B 사용자'}};
  await page.evaluate(user=>{window.KPTURuntime.session.write({...window.KPTURuntime.session.read(),user});},state.user);
  await expect(page.locator('#projectGrid')).toContainText('B 사용자 프로젝트');
  await expect(page.locator('#projectGrid')).not.toContainText('민자철도 정책·조직사업');
});

test('project detail omits removed content, linked-post and collaboration features',async({page})=>{
  const state=baseState();
  state.sections=[{id:'section-legacy',project_id:'main-1',title:'기존 사업 콘텐츠',sort_order:10}];
  state.blocks=[{id:'block-legacy',project_id:'main-1',section_id:'section-legacy',block_type:'text',title:'기존 내용',content:{text:'남겨진 데이터'},sort_order:10}];
  state.pages=[{id:'page-legacy',space_id:'main-1',title:'기존 연결 게시글',slug:'legacy',summary:'기존 페이지',status:'draft',visibility:'private',metadata:{},updated_at:now()}];
  state.comments=[{id:'comment-legacy',project_id:'main-1',author_id:'user-1',body:'기존 협업 메모',created_at:now()}];
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3-content')).toHaveCount(0);
  await expect(page.locator('#ps3-pages')).toHaveCount(0);
  await expect(page.locator('#ps3-collaboration')).toHaveCount(0);
  await expect(page.locator('#ps3-overview')).toHaveCount(0);
  await expect(page.locator('#ps3-decisions')).toHaveCount(0);
  await expect(page.locator('.ps3-nav,[data-ps3-nav]')).toHaveCount(0);
  await expect(page.locator('#ps3Body')).not.toContainText('사업 콘텐츠·현황');
  await expect(page.locator('#ps3Body')).not.toContainText('기존 연결 게시글');
  // UI-프로젝트화면정리: the folded memo box is gone; stored project comments are kept (no delete) and not shown.
  await expect(page.locator('#ps3-memos,#ps3MemoBody')).toHaveCount(0);
  await expect(page.locator('#ps3Body')).not.toContainText('기존 협업 메모');
  expect(state.comments.map(x=>x.id)).toEqual(['comment-legacy']);
});

// UI-프로젝트화면정리: notes live in the basket's [노트]; the project detail no longer has a memo box and neither reads nor
// writes project comments (the stored rows stay).
test('project detail has no memo box and does not read or write project comments',async({page})=>{
  const state=baseState();state.comments=[{id:'comment-kept',project_id:'main-1',author_id:'user-1',body:'남겨 둔 메모',created_at:now()}];
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3-progress')).toBeVisible();
  await expect(page.locator('#ps3-memos,.ps3-memo-form,[data-ps3-memo-save]')).toHaveCount(0);
  await expect(page.locator('#ps3Body')).not.toContainText('메모');
  await expect(page.locator('#ps3-progress [data-ps3-record-input] input')).toHaveAttribute('placeholder','진행상황 기록');
  expect(state.restCalls.filter(x=>x.name==='app_project_comments')).toEqual([]);
  expect(state.comments.map(x=>x.id)).toEqual(['comment-kept']);
});


test('project creation omits type and visibility controls and starts with zero progress items',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.goto(testOrigin+'/app/');
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
  await page.goto(testOrigin+'/app/?project=main-1');
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
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
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
  await page.goto(testOrigin+'/app/?project=main-1');
  await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await expect(page.locator('#ps3MilestoneGoogle')).toBeEnabled();
  await expect(page.locator('#ps3MilestoneGoogle')).toHaveValue('team-cal');
  await expect(page.locator('#ps3MilestoneGoogle option[value="read-only"]')).toHaveCount(0);
  await page.locator('#ps3MilestoneGoogle').selectOption('owner@example.org');
  await page.locator('#ps3MilestoneTitle').fill('Google 세부 캘린더 지정 일정');
  await fillDateTime(page,'#ps3MilestoneAt','2026-10-02T15:00');
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
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await page.locator('#ps3MilestoneTitle').fill('실패 일정');
  await fillDateTime(page,'#ps3MilestoneAt','2026-10-02T15:00');
  await page.locator('#ps3MilestoneSave').click();
  await expect(page.locator('#ps3MilestoneState')).toContainText('Google create failed');
  expect(state.milestones.filter(x=>x.title==='실패 일정')).toHaveLength(0);
  expect(state.events.filter(x=>x.title==='실패 일정')).toHaveLength(0);
  expect(state.callOrder).not.toContain('app_events:POST');
});

test('local milestone failure rolls back the newly created Google event',async({page})=>{
  const state=baseState();
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  state.restFailures['app_project_milestones:POST']=1;state.restFailureStatuses={'app_project_milestones:POST':403};
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await page.locator('#ps3MilestoneTitle').fill('롤백 일정');
  await fillDateTime(page,'#ps3MilestoneAt','2026-10-02T15:00');
  await page.locator('#ps3MilestoneSave').click();
  await expect(page.locator('#ps3MilestoneState')).toContainText('되돌렸습니다');
  expect(state.milestones.filter(x=>x.title==='롤백 일정')).toHaveLength(0);
  expect(state.events.filter(x=>x.title==='롤백 일정')).toHaveLength(0);
  expect(state.googleCalls.map(x=>x.action)).toEqual(expect.arrayContaining(['create-event','delete-event']));
});

test('child project milestone uses the exact current child project id',async({page})=>{
  const state=baseState();
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=child-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await page.locator('#ps3MilestoneTitle').fill('하위 프로젝트 일정');
  await fillDateTime(page,'#ps3MilestoneAt','2026-10-03T09:00');
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
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
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
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-edit-milestone="mile-1"]').click();
  await expect(page.locator('#ps3MilestoneGoogle')).toHaveValue('primary');
  await page.locator('#ps3MilestoneTitle').fill('연동 일정 수정');
  await fillDateTime(page,'#ps3MilestoneAt','2026-09-30T16:00');
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
  state.restFailures['app_project_milestones:PATCH']=1;state.restFailureStatuses={'app_project_milestones:PATCH':403};
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
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
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
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
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
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
  state.restFailures['app_project_milestones:POST']=1;state.restFailureStatuses={'app_project_milestones:POST':403};
  state.googleFailures['delete-event']='forced Google rollback failure';
  const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await page.locator('#ps3MilestoneTitle').fill('rollback 실패 일정');
  await fillDateTime(page,'#ps3MilestoneAt','2026-10-02T15:00');
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
    await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
    await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
    await page.locator('#ps3MilestoneTitle').fill('한국시간 검증 일정');
    await fillDateTime(page,'#ps3MilestoneAt','2026-10-02T15:00');
    await page.locator('#ps3MilestoneSave').click();
    const create=state.googleCalls.find(x=>x.action==='create-event');
    expect(create.start_iso).toBe('2026-10-02T06:00:00.000Z');
    expect(create.end_iso).toBe('2026-10-02T07:00:00.000Z');
  });
});

test('PRJ-기록입력 old progress items stay in the one record list and item creation is gone',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.goto(testOrigin+'/app/?project=main-1');
  await signIn(page);
  const record=page.locator('#ps3-progress [data-ps3-record="pr-1"]');
  await expect(record.locator('.ps3-rec-from')).toHaveText('정책·제도 대응');
  await expect(record.locator('.ps3-rec-summary')).toHaveText('국토부 후속협의 준비');
  await expect(record.locator('.ps3-rec-next')).toHaveText('다음: 9.29 토론회');
  // Stored status labels and phases stay in the data but are not shown; there is no way to add an item.
  await expect(page.locator('#ps3-progress')).not.toContainText('진행 ·');
  await expect(page.locator('#ps3Body [data-ps3-add-ws],#ps3Body [data-ps3-edit-ws],#ps3Body [data-ps3-progress-ws],#ps3Body .ps3-phase,#ps3ProgressModal')).toHaveCount(0);
  expect(state.workstreams).toHaveLength(1);expect(state.progress[0]).toMatchObject({status_label:'진행',workstream_id:'ws-1'});
});

test('PRJ-기록입력 an old item without records is a line of its own and can be deleted',async({page})=>{
  const state=baseState();state.workstreams.push({id:'ws-2',project_id:'main-1',title:'현장 조직 대응',description:null,phase:'preparation',sort_order:20,created_at:'2026-09-01T01:00:00Z'});await mockApp(page,state);
  await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  const row=page.locator('#ps3-progress [data-ps3-record="ws-2"]');
  await expect(row).toHaveAttribute('data-ps3-record-kind','item');await expect(row.locator('.ps3-rec-text')).toHaveText('현장 조직 대응');await expect(row.locator('time')).toHaveText('9.1');
  await expect(page.locator('#ps3-progress [data-ps3-records] > *')).toHaveCount(2);await expect(page.locator('#ps3-progress [data-ps3-record-count]')).toHaveText('2');
  page.once('dialog',d=>d.dismiss());await recordAction(page,row,'삭제');await expect(row).toBeVisible();
  expect(state.restCalls.filter(x=>x.name==='app_project_workstreams'&&x.method==='DELETE')).toHaveLength(0);
  page.once('dialog',d=>d.accept());await recordAction(page,row,'삭제');
  await expect(row).toHaveCount(0);await expect.poll(()=>state.workstreams.map(x=>x.id)).toEqual(['ws-1']);
  await expect(page.locator('#ps3-progress [data-ps3-record-count]')).toHaveText('1');
});

test('PRJ-기록입력 an old item edits its title once and keeps its stored phase',async({page})=>{
  const state=baseState();state.workstreams.push({id:'ws-2',project_id:'main-1',title:'현장 조직 대응',description:null,phase:'preparation',sort_order:20});await mockApp(page,state);
  const probe=await saveProbe(page,'app_project_workstreams','PATCH');
  await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  const row=page.locator('[data-ps3-record="ws-2"]');
  await recordAction(page,row,'수정');
  await expect(page.locator('#ps3WorkstreamModal')).toBeVisible();
  await expect(page.locator('#ps3WorkstreamHeading')).toHaveText('진행상황 수정');
  await expect(page.locator('#ps3WsPhase')).toBeHidden();await expect(page.locator('#ps3WsPhase')).toHaveValue('preparation');
  await page.locator('#ps3WsTitle').fill('수정한 진행상황');
  const button=page.locator('#ps3WsSave');
  await button.click();await expect.poll(()=>probe.count).toBe(1);
  await expect(button).toBeDisabled();await button.dispatchEvent('click');
  await page.waitForTimeout(150);expect(probe.count).toBe(1);
  probe.release();
  await expect(page.locator('#ps3WorkstreamModal')).toBeHidden();
  await expect(row.locator('.ps3-rec-text')).toHaveText('수정한 진행상황');
  expect(state.restCalls.filter(x=>x.name==='app_project_workstreams'&&x.method==='PATCH')).toEqual([
    expect.objectContaining({body:{title:'수정한 진행상황',phase:'preparation'}})
  ]);
});

test('PRJ-기록입력 record list shows every record newest first with its date and the top input stays',async({page})=>{
  const state=baseState();
  state.progress.unshift({
    id:'pr-2',project_id:'main-1',workstream_id:null,
    summary:'국토부 회신을 반영해 토론회 쟁점을 다시 정리함',
    next_step:null,status_label:null,effective_on:'2026-09-20',created_at:now()
  });
  state.workstreams.push({id:'ws-2',project_id:'main-1',title:'현장 조직 대응',description:null,phase:'preparation',sort_order:20,created_at:'2026-09-01T01:00:00Z'});
  await mockApp(page,state);
  await page.goto(testOrigin+'/app/?project=main-1');
  await signIn(page);
  const list=page.locator('#ps3-progress [data-ps3-records]');
  await expect(page.locator('#ps3-progress [data-ps3-record-count]')).toHaveText('3');
  await expect(list.locator(':scope > [data-ps3-record]')).toHaveCount(3);
  expect(await list.locator(':scope > [data-ps3-record]').evaluateAll(xs=>xs.map(x=>x.dataset.ps3Record))).toEqual(['pr-2','pr-1','ws-2']);
  await expect(list.locator('[data-ps3-record="pr-2"] time')).toHaveText('9.20');
  await expect(list.locator('[data-ps3-record="pr-2"] .ps3-rec-summary')).toHaveText('국토부 회신을 반영해 토론회 쟁점을 다시 정리함');
  await expect(list.locator('details')).toHaveCount(0);
  await expect(page.locator('#ps3-progress .ps3-rec-empty,#ps3Body .ps3-empty')).toHaveCount(0);
  const quick=page.locator('#ps3-progress [data-ps3-record-input] input');
  await expect(quick).toBeVisible();await quick.fill('상시 입력칸 기록');await quick.press('Enter');
  await expect(page.locator('#ps3-progress [data-ps3-record-count]')).toHaveText('4');
  await expect(list.locator(':scope > [data-ps3-record]').first().locator('.ps3-rec-summary')).toHaveText('상시 입력칸 기록');
  await expect(quick).toBeVisible();await expect(quick).toHaveValue('');
});

test('PRJ-기록입력 the top input saves a project record through the existing progress path',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.goto(testOrigin+'/app/?project=main-1');
  await signIn(page);
  const form=page.locator('#ps3-progress [data-ps3-record-input]');
  await form.locator('button[type="submit"]').click();
  expect(state.progress).toHaveLength(1);
  await form.locator('input').fill('산하조직 의견 1차 취합');
  await form.locator('input').press('Enter');
  await expect.poll(()=>state.progress.find(x=>x.summary==='산하조직 의견 1차 취합')?.id).toBeTruthy();
  const saved=state.progress.find(x=>x.summary==='산하조직 의견 1차 취합');
  expect(saved).toMatchObject({project_id:'main-1',workstream_id:null,author_id:'user-1',status_label:null,next_step:null,metadata:{}});
  expect(saved.effective_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(state.restCalls.filter(x=>x.name==='app_project_workstreams'&&x.method!=='GET')).toHaveLength(0);
  await expect(page.locator(`[data-ps3-record="${saved.id}"] .ps3-rec-summary`)).toHaveText('산하조직 의견 1차 취합');
  await expect(page.locator(`[data-ps3-record="${saved.id}"] .ps3-rec-from`)).toHaveCount(0);
  await expect(form.locator('input')).toBeVisible();
});

test('project detail keeps one summary-first column at desktop and phone widths',async({page})=>{
  const state=baseState();
  state.workstreams.push({id:'ws-2',project_id:'main-1',title:'현장 조직 대응과 매우 긴 진행상황 제목이 한 줄을 넘는 경우',description:null,phase:'consultation',sort_order:20});
  state.progress.push({...state.progress[0],id:'layout-second'});
  state.progress[0].summary='국토부 후속협의 준비와 운영기준 쟁점 정리를 동시에 진행하고 있으며 현장 의견을 반영 중인 매우 긴 기록';
  state.spaces[0].metadata.objective='민자철도 안전·인력 제도개선을 위한 정책·조직사업의 목표 설명이 길어져도 머리줄에는 보이지 않는다';
  await mockApp(page,state);
  await page.setViewportSize({width:1280,height:900});
  await page.goto(testOrigin+'/app/?project=main-1');
  await signIn(page);
  await expect(page.locator('#ps3-progress')).toBeVisible();
  const order=await page.locator('#ps3Body').evaluate(body=>[...body.children].map(x=>x.id||x.className));
  // PRJ-회의표시: the 회의 section follows 자료.
  expect(order).toEqual(['ps3-progress','ps3-children','ps3-tasks','ps3-documents','ps3-meetings','ps3-milestones']);
  // PRJ-기록입력: the header shows one summary line instead of the stored objective text.
  await expect(page.locator('#ps3Summary')).toHaveText('하위 1 · 할 일 0');await expect(page.locator('.ps3-modal-head')).not.toContainText('목표 설명');
  await expect(page.locator('#ps3-milestones')).not.toHaveAttribute('open','');
  await expect(page.locator('#ps3-memos')).toHaveCount(0);
  await expect(page.locator('#ps3Body .ps3-section-head p,#ps3Body .ps3-empty,#ps3Body .ps3-detail-head')).toHaveCount(0);
  await expect(page.locator('#ps3-tasks .ps3-section-actions [data-ps3-global="task"]')).toHaveAccessibleName('할 일 추가');
  await expect(page.locator('#ps3-documents .ps3-section-actions [data-ps3-global="document"]')).toHaveAccessibleName('자료 올리기');
  for(const width of [1280,360,390,412,430]){
    await page.setViewportSize({width,height:844});
    // UI-PC프로젝트좌우: crossing 1024px moves the detail between the PC pane and the dialog; measure once it is shown again.
    await expect(page.locator('#ps3Summary')).toBeVisible();
    const layout=await page.evaluate(()=>{
      const r=el=>el.getBoundingClientRect();
      const list=document.querySelector('#ps3-progress [data-ps3-records]');
      const objective=document.querySelector('#ps3Summary');
      const summary=document.querySelector('[data-ps3-record="layout-second"] .ps3-rec-summary');
      return {
        overflow:document.documentElement.scrollWidth-window.innerWidth,
        list:r(list).width,
        items:[...list.children].map(x=>({width:r(x).width,overflow:x.scrollWidth-x.clientWidth})),
        objectiveLines:Math.round(r(objective).height/parseFloat(getComputedStyle(objective).lineHeight)),
        summaryTall:r(summary).height>parseFloat(getComputedStyle(summary).lineHeight)*1.5,
        sections:[...document.querySelectorAll('#ps3Body>section,#ps3Body>details')].map(x=>Math.round(r(x).width))
      };
    });
    expect(layout.overflow,`page overflow at ${width}px`).toBeLessThanOrEqual(1);
    expect(layout.objectiveLines,`objective lines at ${width}px`).toBe(1);
    expect(layout.summaryTall,`short record stays on one line at ${width}px`).toBe(false);
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
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
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
  await page.goto(testOrigin+'/app/?project=main-1');
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
  await page.goto(testOrigin+'/app/');
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
  await expectProjectTitle(page,'QA 자동검사 프로젝트');
  const width=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(width).toBeLessThanOrEqual(1);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await expect(page.locator('#ps3MilestoneModal')).toBeVisible();
  await page.locator('#ps3MilestoneTitle').fill('모바일 QA 일정');
  await fillDateTime(page,'#ps3MilestoneAt','2026-09-29T10:00');
  await page.locator('#ps3MilestoneSave').click();
  await expect.poll(()=>state.milestones.some(x=>x.title==='모바일 QA 일정')).toBe(true);
  await expect(page.locator('#ps3Body')).toContainText('모바일 QA 일정');
  const quick=page.locator('#ps3-progress [data-ps3-record-input]');
  await quick.locator('input').fill('모바일 QA 현재 상황');
  await quick.locator('button[type="submit"]').click();
  await expect.poll(()=>state.progress.some(x=>x.summary==='모바일 QA 현재 상황'&&x.project_id===created.id&&x.workstream_id===null)).toBe(true);
  await expect(page.locator('#ps3-progress [data-ps3-record] .ps3-rec-summary')).toHaveText('모바일 QA 현재 상황');
  await openFold(page,'ps3-milestones');
  // UI-프로젝트화면정리: without the memo box a new project's detail is shorter; a shorter phone still has to scroll the card.
  await page.setViewportSize({width:390,height:600});
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
  await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);await clickView(page,'projects');
  await expect(page.locator('[data-ps3-project="main-1"]')).toBeVisible();
  // No legacy project cards (the detail body #ps3Body, in the PC pane, carries its own data-project).
  await expect(page.locator('#projectGrid [data-project]:not(#ps3Body)')).toHaveCount(0);
  await page.locator('#projectGrid .ps3-plist [data-ps3-project="main-1"]').click();
  await expectProjectDetail(page,'main-1');
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
  await expectProjectTitle(page,'9.29 민자철도 국회토론회');
  // PRJ-3단: a second-level project keeps the child list with its + (a third level can be made there), and has no child yet.
  await expect(page.locator('#ps3-children [data-ps3-child]')).toBeVisible();await expect(page.locator('#ps3-children .ps3-child-link')).toHaveCount(0);
  await expect(page.locator('.ps3-parent-link')).toContainText('민자철도 정책·조직사업');
  await page.locator('.ps3-parent-link').click();
  await expectProjectTitle(page,'민자철도 정책·조직사업');
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
  await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);await clickView(page,'projects');
  const list=page.locator('#projectGrid .ps3-plist'),main=list.locator('[data-ps3-project="main-1"]'),child=list.locator('[data-ps3-project="child-1"]');
  await expect(list.locator('.add-list-head h2')).toHaveCount(0);
  await expect(list.locator('[data-ps3-total]')).toHaveText('프로젝트 2개');
  await expect(list.locator('[data-ps3-total]')).toHaveCSS('font-size','12px');
  await expect(page.locator('#ps3ArchiveBtn')).toHaveText('보관 1');
  await expect(page.locator('#ps3ArchiveBtn')).toHaveCSS('font-size','12px');
  await expect(page.locator('#newProjectBtn')).toHaveText('+ 프로젝트');
  await expect(list.locator('[data-ps3-kids-toggle]')).toHaveCount(0);
  await expect(child).toBeVisible();await expect(list.locator('[data-ps3-child]')).toHaveCount(0);
  // UI-디자인기준 2/3(8-9d): 오른쪽 끝 알약은 다음 주요 일정 D-day(3일 이내 빨강), 읽은 뒤 없으면 흐린 "최근 기록 날짜"(PRJ-화면다듬기), 기록도 없으면 빈칸.
  // UI-디자인기준 3/3(8-9e-1): 목록 오른쪽은 D-day 알약 하나만(밀린 할 일 수·마지막 기록 날짜는 상세에만).
  await expect(main.locator('.ps3-prow-meta')).toHaveText('D-day');
  await expect(child.locator('.ps3-prow-meta')).toHaveText('D-2');
  await expect(list.locator('.kptu-list-task-count,.ps3-prow-meta time,.ps3-prow-meta svg')).toHaveCount(0);
  await expect(list.locator('[data-ps3-project="main-2"] .ps3-prow-meta')).toHaveText('');await expect(list).not.toContainText('일정 없음');
  await expect(main.locator('.ps3-dday')).toHaveClass(/ps3-dday-soon/);await expect(main.locator('.ps3-dday')).toHaveAttribute('aria-label','다음 주요 일정 오늘');
  await expect(child.locator('.ps3-dday')).toHaveClass(/ps3-dday-soon/);await expect(child.locator('.ps3-dday')).toHaveAttribute('aria-label','다음 주요 일정 2일 후');
  await expect(list.locator('[data-ps3-project="main-2"] .ps3-dday')).toHaveCount(0);
  for(const pill of await list.locator('.ps3-dday').all())expect(await pill.evaluate(e=>e===e.parentElement.lastElementChild)).toBe(true);
  // 위계: 메인 13px·500, 하위 13px·400, 하위 앞 가지 선.
  await expect(main.locator('.ps3-prow-name')).toHaveCSS('font-weight','500');await expect(child.locator('.ps3-prow-name')).toHaveCSS('font-weight','400');
  for(const row of [main,child])await expect(row.locator('.ps3-prow-name')).toHaveCSS('font-size','13px');
  expect(await child.evaluate(e=>{const b=getComputedStyle(e,'::before'),a=getComputedStyle(e,'::after');return [b.content!=='none',b.borderLeftWidth,a.borderTopWidth]})).toEqual([true,'1px','1px']);
  await expect(list).not.toContainText('자료');await expect(list).not.toContainText('할 일 0');
  for(const row of [main,child]){
    const geometry=await row.evaluate(e=>({height:e.getBoundingClientRect().height,padding:getComputedStyle(e).paddingLeft,font:getComputedStyle(e.querySelector('.ps3-prow-meta')).fontSize}));
    expect(geometry.height).toBeGreaterThanOrEqual(40);expect(geometry.font).toBe('12px');expect(parseInt(geometry.padding)).toBe(row===main?16:44);
  }
  const clipped=await list.locator('[data-ps3-project="main-2"] .ps3-prow-name').evaluate(e=>({clipped:e.scrollWidth>e.clientWidth,ellipsis:getComputedStyle(e).textOverflow}));expect(clipped).toEqual({clipped:true,ellipsis:'ellipsis'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(state.summaryQueries).toHaveLength(1);expect(state.summaryQueries[0]['milestones.limit']).toBe('1');expect(state.summaryQueries[0]['progress.limit']).toBe('1');expect(state.summaryQueries[0].select).toBe('id,milestones:app_project_milestones!project_id(start_at),progress:app_project_progress_updates!project_id(effective_on)');
  await child.press('Enter');await expectProjectTitle(page,'9.29 민자철도 국회토론회');await closeProjectDetail(page);
  await main.click();await expectProjectTitle(page,'민자철도 정책·조직사업');await closeProjectDetail(page);
  await page.locator('#ps3ArchiveBtn').click();await expect(page.locator('#ps3ArchiveModal')).toBeVisible();await expect(page.locator('[data-ps3-restore="arch-1"]')).toBeVisible();
});

for(const extra of [0,200])test(`D-project requests stay constant with ${extra} extra projects`,async({page})=>{
 const state=baseState();state.sessionUser=true;state.gtasks=[{id:'pending',status:'needsAction'}];state.links=[{google_task_id:'pending',project_id:'main-1',status:'confirmed'}];
 state.spaces.push(...Array.from({length:extra},(_,i)=>({...state.spaces[0],id:'extra-'+i,name:'추가 '+i})));
 await mockApp(page,state);await page.goto(testOrigin+'/app/?view=projects');await signIn(page);await expect(page.locator('#projectsView')).toBeVisible();
 // UI-디자인기준 3/3(8-9e-1): the list reads only the D-day (one batched read); it no longer reads Google tasks for counts.
 await expect(page.locator('[data-ps3-project="main-1"] .ps3-dday')).toHaveCount(1);
 await expect.poll(()=>state.summaryQueries?.length).toBe(1);
 await expect(page.locator('#projectGrid .kptu-list-task-count')).toHaveCount(0);
 expect(state.gtCalls.filter(x=>x.action==='overview').length).toBeLessThanOrEqual(1);
 expect(state.restCalls.filter(x=>x.name==='app_record_links')).toHaveLength(0);
 expect(state.restCalls.filter(x=>x.name==='app_documents'||x.name==='app_project_progress_updates'||x.name==='app_project_milestones')).toHaveLength(0);
 await expect(page.locator('#ps3ArchiveBtn')).toBeHidden();
 await expect(page.locator('[data-ps3-total]')).toHaveText(`프로젝트 ${extra+1}개`);
});
test('D-project names appear before optional reads and survive failed metadata',async({page})=>{
 const state=baseState();state.summaryFail=true;let release;state.summaryDelay=new Promise(r=>release=r);
 await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);await clickView(page,'projects');
 await expect(page.locator('#projectGrid .ps3-plist [data-ps3-project]')).toHaveCount(2);await expect(page.locator('[data-ps3-total]')).toHaveText('프로젝트 1개');
 release();await expect.poll(()=>state.summaryQueries?.length).toBe(1);
 await page.locator('#projectGrid .ps3-plist [data-ps3-project="main-1"]').click();await expectProjectTitle(page,'민자철도 정책·조직사업');
});

for(const failure of ['tasks','dates','both'])test(`D-project ${failure} failure preserves names and other metadata`,async({page})=>{
 const state=baseState();state.sessionUser=true;state.summaryFail=failure!=='tasks';state.gtOverviewFail=failure!=='dates';
 state.gtasks=[{id:'pending',status:'needsAction'}];state.links=[{google_task_id:'pending',project_id:'main-1',status:'confirmed'}];
 await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);await clickView(page,'projects');
 const main=page.locator('#projectGrid .ps3-plist [data-ps3-project="main-1"]');
 if(failure==='tasks')await expect(main.locator('.ps3-dday')).toHaveCount(1);
 // UI-디자인기준 3/3: the list no longer reads tasks for counts; a failed date read leaves the right side empty.
 // UI-PC프로젝트좌우: on a PC the first project opens in the pane and its own detail read fills its D-day; the other row shows the failed list read.
 if(failure!=='tasks'){await expect.poll(()=>state.summaryQueries?.length).toBe(1);const listOnly=(await projectDetailDocked(page))?page.locator('#projectGrid .ps3-plist [data-ps3-project="child-1"]'):main;await expect(listOnly.locator('.ps3-prow-meta')).toBeEmpty();}
 await expect(page.locator('#projectGrid .ps3-plist [data-ps3-project]')).toHaveCount(2);
 await main.click();await expectProjectTitle(page,'민자철도 정책·조직사업');
});

for(const width of [390,1280])test(`V3 generated dialogs expose consistent accessibility semantics ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const state=baseState();await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);await clickView(page,'projects');
  // UI-PC프로젝트좌우: on a PC the detail is the right pane — a labelled region, not a modal dialog.
  if(width>=1024)await expectProjectDetail(page,'main-1');
  for(const id of ['ps3DetailModal','ps3CreateModal','ps3WorkstreamModal','ps3MilestoneModal','ps3DeleteModal','ps3ArchiveModal']){
    const modal=page.locator('#'+id);
    if(id==='ps3DetailModal'&&width>=1024){await expect(modal).toHaveAttribute('role','region');await expect(modal).not.toHaveAttribute('aria-modal',/.*/);await expect(page.locator('#ps3DetailPane')).toHaveAttribute('aria-label','프로젝트 상세')}
    else{await expect(modal).toHaveAttribute('role','dialog');
    await expect(modal).toHaveAttribute('aria-modal','true');}
    if(id==='ps3DetailModal'&&width>=1024){
      // UI-중복제목삭제: 붙은 상세는 제목 줄(#ps3Title)이 없고 상단 줄이 이름을 보이므로 이름은 aria-label로 둔다.
      await expect(modal).toHaveAttribute('aria-label',/.+/);await expect(modal).not.toHaveAttribute('aria-labelledby',/.*/);await expect(page.locator('#ps3Title')).toHaveCount(0);
    }else{
    const labelledby=await modal.getAttribute('aria-labelledby');
    expect(labelledby,id).toBeTruthy();
    await expect(page.locator('#'+labelledby)).toHaveCount(1);
    }
    await expect(modal.locator('[data-ps3-close]').first()).toHaveAttribute('aria-label','닫기');
  }
});

for(const width of [390,1280])test(`V3 detail and edit dialogs manage focus, Escape, and trigger restoration ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const state=baseState();await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);await clickView(page,'projects');
  const card=page.locator('#projectGrid .ps3-plist [data-ps3-project="main-1"]');
  if(width>=1024){
    // UI-PC프로젝트좌우: the PC pane is not a dialog — choosing a row keeps focus on that row and Escape leaves the pane shown.
    await expectProjectDetail(page,'main-1');
    await card.focus();await card.click();await expect(card).toBeFocused();await expect(card).toHaveAttribute('aria-current','true');
    await page.keyboard.press('Escape');await expect(page.locator('#ps3DetailModal')).toBeVisible();await expect(card).toBeFocused();
  }else{
  await card.focus();await card.click();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await expect(page.locator('#ps3DetailModal .ps3-modal-head [data-ps3-close]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ps3DetailModal')).toHaveClass(/hidden/);
  await expect(card).toBeFocused();

  await card.click();
  }
  const childTrigger=page.locator('#ps3-children [data-ps3-child]');
  await childTrigger.focus();await childTrigger.click();
  await expect(page.locator('#ps3CreateName')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ps3CreateModal')).toHaveClass(/hidden/);
  await expect(childTrigger).toBeFocused();

  await openFold(page,'ps3-milestones');
  const milestoneTrigger=page.locator('[data-ps3-add-milestone]');
  await milestoneTrigger.focus();await milestoneTrigger.click();
  await expect(page.locator('#ps3MilestoneTitle')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ps3MilestoneModal')).toHaveClass(/hidden/);
  await expect(milestoneTrigger).toBeFocused();
});

test('V3 more menu and progress items use native keyboard disclosure behavior',async({page})=>{
  const state=baseState();state.progress.push({...state.progress[0],id:'keyboard-second'});await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);await clickView(page,'projects');
  await page.locator('[data-ps3-project="main-1"]').first().click();
  const menu=page.locator('#ps3Menu .ps3-more'),summary=menu.locator(':scope > summary');
  await expect(summary).toHaveAttribute('aria-label','프로젝트 관리 메뉴');
  await expect(menu.locator('[data-ps3-toggle-done]')).toBeHidden();
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('open','');
  await expect(menu.locator('.ps3-more-panel button')).toHaveText(['완료','수정','아래로 접기','보관','삭제']);
  await page.keyboard.press('Tab');
  await expect(menu.locator('[data-ps3-toggle-done]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).not.toHaveAttribute('open','');
  await expect(summary).toBeFocused();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await summary.click();
  await expect(menu).toHaveAttribute('open','');
  await page.locator('#ps3Title,#ps3Summary').first().click();
  await expect(menu).not.toHaveAttribute('open','');
  // PRJ-기록입력: each record line is one keyboard button that opens 수정·삭제.
  const input=page.locator('#ps3-progress [data-ps3-record-input] input');
  // UI-크게첨부: input → [크게] → [기록] → the first record line.
  await input.focus();await page.keyboard.press('Tab');await expect(page.locator('#ps3-progress [data-ps3-record-big]')).toBeFocused();await page.keyboard.press('Tab');await page.keyboard.press('Tab');
  await expect(page.locator('[data-ps3-record-menu="pr-1"]')).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('[data-ps3-record-menu="keyboard-second"]')).toBeFocused();
  await page.keyboard.press('Enter');await expect(page.locator('#ps3RecordMenu button').first()).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('#ps3RecordMenu button').last()).toBeFocused();

});

test('V3 creates and edits a project with the same final renderer',async({page})=>{
  // 기본 시작일은 오늘이다(앱은 UTC 날짜를 쓰지만 정오 시계에서는 한국 날짜와 같다). 종료일을 고정 날짜로 두면 그 날짜가 지난 뒤 시작일보다 앞서게 된다.
  const today=await calendarToday(page);
  const state=baseState();await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);await clickView(page,'projects');
  await page.locator('#newProjectBtn').click();await expect(page.locator('#ps3CreateModal')).toBeVisible();
  await page.locator('#ps3CreateName').fill('인력확충 투쟁');await page.locator('#ps3CreateObjective').fill('안전·공공서비스 인력확충');await page.locator('#ps3CreateSave').click();
  await expect.poll(()=>state.spaces.some(x=>x.name==='인력확충 투쟁')).toBeTruthy();
  const made=state.spaces.find(x=>x.name==='인력확충 투쟁');
  expect(made.visibility).toBe('private');
  expect(state.workstreams.filter(x=>x.project_id===made.id)).toHaveLength(0);
  // UI-PC프로젝트좌우: on a PC the pane already shows the first project; wait until the new one replaces it.
  await expectProjectDetail(page,made.id);
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
  await expectProjectTitle(page,'인력확충 공동투쟁');
});

test('V3 edits and deletes a key schedule and shows the five most recent documents',async({page})=>{
  const state=baseState();
  state.docs.push(
    {id:'doc-2',project_id:'main-1',title:'토론회 발제문',category:'정책자료',document_date:'2026-09-13'},
    {id:'doc-3',project_id:'main-1',title:'현장 설문 결과',category:'현장자료',document_date:'2026-09-12'},
    {id:'doc-4',project_id:'main-1',title:'지난 회의록',category:'회의',document_date:'2026-09-01'}
  );
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3DetailModal')).toBeVisible({timeout:10000});
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-edit-milestone="mile-1"]').click();await expect(page.locator('#ps3MilestoneModal')).toBeVisible();
  await page.locator('#ps3MilestoneTitle').fill('9.29 민자철도 국회토론회 확정');await page.locator('#ps3MilestoneSave').click();
  await expect.poll(()=>state.milestones[0].title).toBe('9.29 민자철도 국회토론회 확정');
  await expect(page.locator('#ps3-milestones')).toHaveAttribute('open','');
  await page.locator('[data-ps3-edit-milestone="mile-1"]').click();page.once('dialog',d=>d.accept());await page.locator('#ps3MilestoneDelete').click();
  await expect.poll(()=>state.milestones.length).toBe(0);
  const docs=page.locator('#ps3-documents');
  await expect(docs.locator('.ps3-section-head .ps3-count')).toHaveText('4');
  // UI-바구니첨부메모: 최근 5개 + "전체 N개 보기 ›", 줄마다 분류 꼬리표(저장 값은 그대로).
  await expect(docs.locator('.ps3-doc-row')).toHaveCount(4);
  await expect(docs).toContainText('민자철도 국토부 요구자료 답변');
  await expect(docs.locator('.doc-category-tag').nth(1)).toHaveText('정책');
  await expect(docs.getByRole('button',{name:'전체 4개 보기'})).toBeVisible();
  await expect(docs.locator('#ps3DocSearch,[data-ps3-doc-filter]')).toHaveCount(0);
  await expect(docs.locator('a.ps3-line-main[href="https://example.org/doc"]')).toContainText('민자철도 국토부 요구자료 답변');
  await expect(docs.locator('a[href="https://example.org/doc"]')).toHaveAttribute('target','_blank');
  const more=docs.locator('[data-ps3-edit-doc="doc-1"]').locator('xpath=ancestor::details[1]');
  await expect(more.locator('[data-ps3-edit-doc="doc-1"]')).toBeHidden();await more.locator(':scope > summary').click();await expect(more.locator('[data-ps3-edit-doc="doc-1"]')).toBeVisible();await page.keyboard.press('Escape');
  await docs.locator('[data-ps3-library]').click();
  await expect(page.locator('#ps3DetailModal')).toBeHidden();
  await expect(page.locator('#libraryView')).toBeVisible();
});

test('V3 archives and restores without returning to a legacy project screen',async({page})=>{
  const state=baseState();await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
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
  const state=baseState();await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3DetailModal')).toBeVisible({timeout:10000});
  await openMenu(page);
  await expect(page.locator('[data-ps3-delete-project]')).toBeVisible();
  await page.locator('[data-ps3-delete-project]').click();await expect(page.locator('#ps3DeleteModal')).toBeVisible();
  await page.locator('#ps3DeleteConfirm').click();await expect.poll(()=>state.spaces.some(x=>x.id==='main-1')).toBeFalsy();
  await expect(page.locator('#ps3DetailModal')).toBeHidden();
});

const UNLINK_TABLES=['app_meetings','app_documents','app_pages'];
async function deleteMain(page){
  await openMenu(page);await page.locator('[data-ps3-delete-project]').click();
  await expect(page.locator('#ps3DeleteModal')).toBeVisible();
}

test('TRASH 2단계: 휴지통을 쓸 수 있으면 삭제는 휴지통 이동이고 연결 끊기 요청이 없으며 [되돌리기]로 돌아온다',async({page})=>{
  const state=baseState();state.trash={items:[]};await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3DetailModal')).toBeVisible({timeout:10000});
  await deleteMain(page);
  const message=page.locator('#ps3DeleteMessage');
  await expect(message).toContainText('휴지통으로 옮깁니다');await expect(message).toContainText('하위 프로젝트 1개도 함께 옮겨지고');
  await expect(message).toContainText('연결된 기록은 그대로 남습니다');await expect(message).toContainText('휴지통에서 되돌릴 수 있습니다');
  await expect(page.locator('[data-ps3-delete-note]')).toBeHidden();
  await page.locator('#ps3DeleteConfirm').click();
  await expect.poll(()=>state.spaces.some(x=>x.id==='main-1'||x.id==='child-1')).toBeFalsy();
  expect(state.trash.items.map(x=>x.id).sort()).toEqual(['child-1','main-1']);
  expect(state.restCalls.filter(c=>UNLINK_TABLES.includes(c.name)&&c.method==='PATCH')).toEqual([]);
  const notice=page.locator('[data-undo-notice]');
  await expect(notice).toContainText('휴지통으로 옮겼습니다');
  await notice.locator('[data-undo-action]').click();
  await expect.poll(()=>state.spaces.map(x=>x.id).sort().join()).toBe('child-1,main-1');
  expect(state.trash.items).toEqual([]);
});

test('TRASH 2단계: 휴지통 탭에서 되돌리고, ⋯ 안 영구 삭제는 확인창을 거치며, 상위가 휴지통이면 먼저 되돌리라고 안내한다',async({page})=>{
  const state=baseState();
  const at='2026-10-24T03:00:00Z',main=state.spaces.find(x=>x.id==='main-1'),child=state.spaces.find(x=>x.id==='child-1');
  const child2={...child,id:'child-2',name:'함께 지워진 하위',sort_order:20};
  const extra={...main,id:'solo-1',name:'합성 단독 사업',parent_id:null,sort_order:50};
  // main-1은 child-2와 함께 지워져(하위 1개) 맨 위로 휴지통에 있고, solo-1도 각자 맨 위다.
  // child-1은 main-1보다 먼저 따로 지워졌으므로 main-1의 하위 개수에 안 세지고, 상위가 휴지통인 줄이다.
  state.spaces=[];
  state.trash={items:[{...main,deleted_at:at,deleted_root_id:'main-1'},{...child2,deleted_at:at,deleted_root_id:'main-1'},{...child,deleted_at:'2026-10-24T02:00:00Z',deleted_root_id:'child-1'},{...extra,deleted_at:'2026-10-24T01:00:00Z',deleted_root_id:'solo-1'}]};
  await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);
  await clickView(page,'projects');
  const button=page.locator('#ps3ArchiveBtn');
  await expect(button).toHaveText('휴지통 3');
  await button.click();
  await expect(page.locator('#ps3ArchiveModal')).toBeVisible();
  await expect(page.locator('#ps3ArchiveHeading')).toHaveText('휴지통');
  const rows=page.locator('[data-ps3-trash-row]');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('민자철도 정책·조직사업');await expect(rows.first()).toContainText('하위 1개');
  const orphan=page.locator('[data-ps3-trash-row="child-1"]');
  await expect(orphan).toContainText('상위 프로젝트를 먼저 되돌려 주세요');
  await expect(orphan.locator('[data-ps3-trash-restore]')).toBeDisabled();
  // 영구 삭제: 확인창을 거치고, 취소하면 그대로다.
  const solo=page.locator('[data-ps3-trash-row="solo-1"]');
  await solo.locator('summary').click();
  let asked='';page.once('dialog',d=>{asked=d.message();d.dismiss()});
  await solo.locator('[data-ps3-trash-purge]').click();
  await expect.poll(()=>asked).toContain('영구 삭제할까요');
  expect(asked).toContain('프로젝트 연결만 풀립니다');expect(asked).toContain('되돌릴 수 없습니다');
  expect(state.trash.items.some(x=>x.id==='solo-1')).toBe(true);
  await solo.locator('summary').click();
  page.once('dialog',d=>d.accept());await solo.locator('[data-ps3-trash-purge]').click();
  await expect.poll(()=>state.trash.items.some(x=>x.id==='solo-1')).toBe(false);
  expect(state.spaces.some(x=>x.id==='solo-1')).toBe(false);
  await expect(rows).toHaveCount(2);
  // 되돌리기: 상위가 먼저 돌아오면 아래 줄도 풀린다.
  await page.locator('[data-ps3-trash-restore="main-1"]').click();
  await expect.poll(()=>state.spaces.some(x=>x.id==='main-1')).toBe(true);
  await expect(page.locator('[data-ps3-trash-restore="child-1"]')).toBeEnabled();
  await page.locator('[data-ps3-trash-restore="child-1"]').click();
  await expect.poll(()=>state.spaces.some(x=>x.id==='child-1')).toBe(true);
  await expect(page.locator('#ps3ArchiveList')).toContainText('휴지통이 비어 있습니다');
  expect(state.trash.calls.map(c=>c.fn)).toContain('app_trash_purge');
});

test('TRASH-화면2: 휴지통 탭에 담당조직·사업 보고가 함께 보이고, 되돌리기·영구 삭제(확인창)가 종류에 맞게 간다',async({page})=>{
  const state=baseState();
  state.trash={items:[],others:{
    organization:[{id:'org-t1',workspace_id:state.workspace.id,name:'합성 휴지통 조직',deleted_at:'2026-10-25T03:00:00Z'}],
    report:[{id:'rep-t1',workspace_id:state.workspace.id,title:'합성 보고',series_name:'합성 정례회의',round_no:4,meeting_at:'2026-10-20T01:00:00Z',activity_kind:'meeting',deleted_at:'2026-10-25T02:00:00Z'}],
  }};
  await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);
  await clickView(page,'projects');
  const button=page.locator('#ps3ArchiveBtn');
  await expect(button).toHaveText('휴지통 2');
  await button.click();
  await expect(page.locator('#ps3ArchiveHeading')).toHaveText('휴지통');
  const org=page.locator('[data-ps3-trash-row="org-t1"]'),rep=page.locator('[data-ps3-trash-row="rep-t1"]');
  await expect(org).toContainText('합성 휴지통 조직');await expect(org).toContainText('담당조직');
  await expect(rep).toContainText('합성 정례회의 4회');await expect(rep).toContainText('사업 보고');
  // 영구 삭제: 종류에 맞는 확인창, 취소하면 그대로, 확인하면 그 종류로 간다.
  await rep.locator('summary').click();
  let asked='';page.once('dialog',d=>{asked=d.message();d.dismiss()});
  await rep.locator('[data-ps3-trash-purge]').click();
  await expect.poll(()=>asked).toContain('사업 보고를 영구 삭제할까요');
  expect(state.trash.others.report.length).toBe(1);
  await rep.locator('summary').click();
  page.once('dialog',d=>d.accept());await rep.locator('[data-ps3-trash-purge]').click();
  await expect.poll(()=>state.trash.others.report.length).toBe(0);
  await org.locator('[data-ps3-trash-restore]').click();
  await expect.poll(()=>state.trash.others.organization.length).toBe(0);
  expect(state.trash.done).toEqual([{fn:'app_trash_purge',kind:'report',id:'rep-t1'},{fn:'app_trash_restore',kind:'organization',id:'org-t1'}]);
  await expect(page.locator('#ps3ArchiveList')).toContainText('휴지통이 비어 있습니다');
});

test('TRASH-다른삭제 3단계: 휴지통 탭에 자료실 폴더가 프로젝트 이름·아래 폴더·자료 수와 함께 보이고, 되돌리기·영구 삭제(한 단 위로 안내)가 그 종류로 간다',async({page})=>{
  const state=baseState();
  state.trash={items:[],others:{
    library_folder:[
      {id:'lf-t1',workspace_id:state.workspace.id,name:'합성 폴더',project_id:'main-1',project_name:'합성 사업',parent_id:null,child_count:2,file_count:5,parent_in_trash:false,deleted_at:'2026-10-25T05:00:00Z'},
      {id:'lf-t2',workspace_id:state.workspace.id,name:'합성 아래 폴더',project_id:null,project_name:'',parent_id:'lf-up',child_count:0,file_count:0,parent_in_trash:true,deleted_at:'2026-10-25T04:00:00Z'},
    ],
  }};
  await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);
  await clickView(page,'projects');
  const button=page.locator('#ps3ArchiveBtn');
  await expect(button).toHaveText('휴지통 2');
  await button.click();
  await expect(page.locator('#ps3ArchiveHeading')).toHaveText('휴지통');
  await expect(page.locator('[data-ps3-archive-hint]')).toContainText('자료실 폴더');
  const first=page.locator('[data-ps3-trash-row="lf-t1"]'),second=page.locator('[data-ps3-trash-row="lf-t2"]');
  await expect(first).toContainText('합성 폴더');await expect(first).toContainText('자료실 폴더');await expect(first).toContainText('합성 사업');await expect(first).toContainText('하위 2개');await expect(first).toContainText('자료 5개');
  await expect(second).toContainText('프로젝트 없음');
  // 위 폴더가 아직 휴지통이면 먼저 되돌리라고 안내하고 [되돌리기]는 막힌다.
  await expect(second).toContainText('상위 폴더를 먼저 되돌려 주세요');await expect(second.locator('[data-ps3-trash-restore]')).toBeDisabled();
  // 영구 삭제: 폴더만 지워지고 안의 것은 한 단 위로 올라간다고 알리는 확인창. 취소하면 그대로.
  await first.locator('summary').click();
  let asked='';page.once('dialog',d=>{asked=d.message();d.dismiss()});
  await first.locator('[data-ps3-trash-purge]').click();
  await expect.poll(()=>asked).toContain('“합성 폴더” 폴더를 영구 삭제할까요');
  expect(asked).toContain('아래 폴더 2개·자료 5개는 한 단 위로 올라갑니다');expect(asked).toContain('Drive 파일은 지우지 않으며');
  expect(state.trash.others.library_folder.length).toBe(2);
  await first.locator('summary').click();
  // 되돌리기는 그 종류로 가고, 이미 열려 있는 자료실에는 폴더 표를 다시 읽으라고 알린다.
  const told=await page.evaluate(()=>{window.__folderEvents=0;window.addEventListener('kptu:library-folders-changed',()=>{window.__folderEvents++});return true});expect(told).toBe(true);
  await first.locator('[data-ps3-trash-restore]').click();
  await expect.poll(()=>state.trash.others.library_folder.map(x=>x.id)).toEqual(['lf-t2']);
  await expect.poll(()=>page.evaluate(()=>window.__folderEvents)).toBe(1);
  expect(state.trash.done).toEqual([{fn:'app_trash_restore',kind:'library_folder',id:'lf-t1'}]);
});

test('TRASH-다른삭제 5단계: 휴지통에 노트·업데이트가 종류·첨부·연결과 함께 보이고, 되돌리면 정리함에 다시 읽으라고 알리며, 영구 삭제 확인은 Drive 파일이 남는다고 알린다',async({page})=>{
  const state=baseState();
  state.trash={items:[],others:{note:[
    {id:'nt-1',workspace_id:state.workspace.id,note_kind:'basket',title:'',preview:'합성 교섭 결과 공유',occurred_at:'2026-10-20T01:00:00Z',deleted_at:'2026-10-26T05:00:00Z',file_count:1,link_count:2},
    {id:'nt-2',workspace_id:state.workspace.id,note_kind:'note',title:'합성 정리 노트',preview:'본문',occurred_at:'2026-10-20T01:00:00Z',deleted_at:'2026-10-26T04:00:00Z',file_count:0,link_count:0},
  ]}};
  await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);
  await clickView(page,'projects');
  const button=page.locator('#ps3ArchiveBtn');
  await expect(button).toHaveText('휴지통 2');
  await button.click();
  await expect(page.locator('[data-ps3-archive-hint]')).toContainText('노트·업데이트');
  const first=page.locator('[data-ps3-trash-row="nt-1"]'),second=page.locator('[data-ps3-trash-row="nt-2"]');
  await expect(first).toContainText('합성 교섭 결과 공유');await expect(first).toContainText('업데이트');await expect(first).toContainText('첨부 1개');await expect(first).toContainText('연결 2곳');
  await expect(second).toContainText('합성 정리 노트');await expect(second).toContainText('노트');await expect(second.locator('[data-ps3-trash-restore]')).toBeEnabled();
  // 영구 삭제: 연결이 함께 지워지고 Drive 파일은 그대로라고 알리는 확인창. 취소하면 그대로.
  await first.locator('summary').click();
  let asked='';page.once('dialog',d=>{asked=d.message();d.dismiss()});
  await first.locator('[data-ps3-trash-purge]').click();
  await expect.poll(()=>asked).toContain('“합성 교섭 결과 공유” 업데이트를 영구 삭제할까요');
  expect(asked).toContain('연결 2곳도 함께 지워지고');expect(asked).toContain('첨부 파일 1개는 Drive에 그대로 남습니다');
  expect(state.trash.others.note.length).toBe(2);
  await first.locator('summary').click();
  // 되돌리기는 그 종류로 가고, 열려 있는 정리함에는 목록을 다시 읽으라고 알린다.
  await page.evaluate(()=>{window.__noteEvents=0;window.addEventListener('kptu:basket-notes-restored',()=>{window.__noteEvents++})});
  await first.locator('[data-ps3-trash-restore]').click();
  await expect.poll(()=>state.trash.others.note.map(x=>x.id)).toEqual(['nt-2']);
  await expect.poll(()=>page.evaluate(()=>window.__noteEvents)).toBe(1);
  expect(state.trash.done).toEqual([{fn:'app_trash_restore',kind:'note',id:'nt-1'}]);
});

test('TRASH-화면2: 프로젝트 휴지통만 준비되고 담당조직·사업 보고는 아직이면(DB 적용 전) 나머지 종류만 준비 중이라고 알린다',async({page})=>{
  const state=baseState();
  const main=state.spaces.find(x=>x.id==='main-1');
  state.spaces=state.spaces.filter(x=>x.id!=='main-1'&&x.id!=='child-1');
  state.trash={oldFunction:true,items:[{...main,deleted_at:'2026-10-24T03:00:00Z',deleted_root_id:'main-1'}]};
  await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);
  await clickView(page,'projects');
  await page.locator('#ps3ArchiveBtn').click();
  await expect(page.locator('[data-ps3-trash-row="main-1"]')).toBeVisible();
  await expect(page.locator('[data-ps3-trash-pending]')).toHaveText('담당조직·사업 보고·자료실 폴더·노트·업데이트 휴지통은 준비 중입니다.');
});

test('TRASH 2단계: 휴지통 함수가 아직 없으면 삭제는 지금 문구로 바로 지워지고 휴지통 자리에는 준비 중만 보인다',async({page})=>{
  const state=baseState();state.trash={missing:true};
  state.spaces.push({...state.spaces[0],id:'arch-1',name:'합성 보관 사업',parent_id:null,status:'archived',sort_order:60});
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3DetailModal')).toBeVisible({timeout:10000});
  await deleteMain(page);
  const message=page.locator('#ps3DeleteMessage');
  await expect(message).toContainText('삭제합니다');await expect(message).toContainText('하위 프로젝트 1개도 함께 삭제됩니다');
  await expect(page.locator('#ps3DeleteModal')).not.toContainText('휴지통');
  await expect(page.locator('[data-ps3-delete-note]')).toContainText('프로젝트 연결만 해제함');
  await expect(page.locator('#ps3DeleteConfirm')).toHaveText('삭제');
  await page.locator('#ps3DeleteConfirm').click();
  await expect.poll(()=>state.spaces.some(x=>x.id==='main-1')).toBeFalsy();
  await expect(page.locator('#toast')).toHaveText('프로젝트를 삭제했습니다.');
  await expect(page.locator('[data-undo-notice]')).toHaveCount(0);
  await clickView(page,'projects');
  const button=page.locator('#ps3ArchiveBtn');
  await expect(button).toHaveText('보관 1');
  await button.click();
  await expect(page.locator('#ps3ArchiveModal')).toBeVisible();
  await expect(page.locator('[data-ps3-restore="arch-1"]')).toBeVisible();
  await page.locator('[data-ps3-archive-tab="trash"]').click();
  await expect(page.locator('#ps3ArchiveList')).toHaveText('휴지통은 준비 중입니다.');
  await expect(page.locator('[data-ps3-trash-row]')).toHaveCount(0);
  await page.locator('[data-ps3-archive-tab="archive"]').click();
  await expect(page.locator('[data-ps3-restore="arch-1"]')).toBeVisible();
});

test('V3 includes legacy child work areas under a V3 parent without changing their IDs',async({page})=>{
  const state=baseState();state.sessionUser=true;state.spaces.push({id:'legacy-child',workspace_id:'workspace-1',parent_id:'main-1',name:'국회토론회 준비',slug:'old-child',owner_id:'user-1',status:'active',visibility:'team',metadata:{legacy_snapshot:true}});
  state.gtasks.push({id:'legacy-g',title:'발제 원고 취합',status:'needsAction',due:null,taskListId:'@default',taskListTitle:'내 할 일',source:'google-task'});
  state.links.push({google_task_id:'legacy-g',project_id:'legacy-child',status:'confirmed',task_completed:false});
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  await expect(page.locator('#ps3-children [data-ps3-project="legacy-child"]')).toBeVisible();
  await page.locator('#ps3-children [data-ps3-project="legacy-child"]').click();
  await expectProjectTitle(page,'국회토론회 준비');
  await expect(page.locator('#ps3-tasks')).toContainText('발제 원고 취합');
});


test('V3 project list only shows projects owned by the signed-in user',async({page})=>{
  const state=baseState();
  state.spaces.push({id:'other-owner',workspace_id:'workspace-1',name:'다른 사용자 프로젝트',parent_id:null,status:'active',visibility:'public',owner_id:'user-2',sort_order:30,metadata:{project_system:'v2',management_version:2}});
  await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);await clickView(page,'projects');
  await expect(page.locator('#projectGrid')).toContainText('민자철도 정책·조직사업');
  await expect(page.locator('#projectGrid')).not.toContainText('다른 사용자 프로젝트');
});

test('V3 keeps an owned legacy child visible even when its parent is not returned',async({page})=>{
  const state=baseState();
  state.spaces=[{id:'legacy-child-owned',workspace_id:'workspace-1',parent_id:'hidden-parent',name:'소유한 기존 하위 프로젝트',owner_id:'user-1',status:'active',visibility:'team',metadata:{project_system:'v2',management_version:2}}];
  await mockApp(page,state);await page.goto(testOrigin+'/app/');await signIn(page);await clickView(page,'projects');
  await expect(page.locator('#projectGrid')).toContainText('소유한 기존 하위 프로젝트');
  await expect(page.locator('[data-ps3-project="legacy-child-owned"]')).toBeVisible();
});

test('V3 project detail stays separate from the Web1-backed board',async({page})=>{
  const state=baseState();
  state.spaces[1].metadata.source_draft_id='page-child';
  state.pages=[{id:'page-notice',space_id:'main-1',title:'독립 현장 공지',slug:'standalone-notice',summary:'독립 공지 요약',body:'독립 공지 본문',status:'published',visibility:'public',updated_at:'2026-09-18T10:00:00Z',metadata:{}}];
  await mockApp(page,state);
  await page.goto(testOrigin+'/app/?project=main-1');
  await signIn(page);
  await expect(page.locator('#ps3-children [data-ps3-project="child-1"]')).toBeVisible();
  await expect(page.locator('#ps3-pages')).toHaveCount(0);
  await expect(page.locator('#ps3Body')).not.toContainText('독립 현장 공지');
  await closeProjectDetail(page);
  await clickView(page,'pages');await openLegacyBoard(page);
  await expect(page.locator('#web1BoardActive')).toContainText('위험업무 2인1조 법제화');
  await expect(page.locator('#web1BoardActive')).not.toContainText('독립 현장 공지');
});

test('Web1-backed board stays compact and excludes dedicated library and press sections',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.setViewportSize({width:1440,height:900});
  await page.goto(testOrigin+'/app/');await signIn(page);
  await clickView(page,'pages');await openLegacyBoard(page);
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
  const state=baseState();await mockApp(page,state);await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  const control=page.locator('[data-ps3-toggle-done]');
  await openMenu(page);await expect(control).toHaveText('완료');
  await control.click();
  await expect.poll(()=>state.spaces.find(x=>x.id==='main-1')?.status).toBe('done');
  await expectProjectTitle(page,'민자철도 정책·조직사업');
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
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=child-1');await signIn(page);
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
  // TASK-바로처리통일: [연결 해제] is in the row's ⋯ (the shared task line).
  await panel.locator('[data-gt-linked-more="g1"]').click();
  await expect(page.locator('#gtLinkedMenu').getByRole('button')).toHaveText(['다시 할 일로','고치기','연결 해제']);
  await page.locator('#gtLinkedMenu').getByRole('button',{name:'연결 해제'}).click();
  await expect.poll(()=>state.gtCalls.find(x=>x.action==='unlink')?.body).toEqual(expect.objectContaining({task_id:'g1',links:[{project_id:'child-1'}]}));
  await expect(panel).toContainText('연결된 Google 할 일이 없습니다.');
  expect(state.tasks).toEqual([]);
});

test('V3 project task section rolls back a failed completion',async({page})=>{
  const state=baseState();state.sessionUser=true;state.gtToggleFail=true;
  state.gtasks.push({id:'g1',title:'자료 정리',due:null,status:'needsAction',taskListId:'@default',taskListTitle:'내 할 일',source:'google-task'});
  state.links.push({google_task_id:'g1',project_id:'child-1',status:'confirmed',task_completed:false});
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=child-1');await signIn(page);
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
  await mockApp(page,state);await page.goto(testOrigin+'/app/?project=child-1');await signIn(page);
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
    if(method==='write'?!['POST','PATCH'].includes(route.request().method()):route.request().method()!==method)return route.fallback();
    probe.count++;
    if(probe.hold)await new Promise(resolve=>probe.waiters.push(resolve));
    if(probe.fail){probe.fail=false;return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'임시 저장 실패'})})}
    return route.fallback();
  });
  return probe;
}

test('saveWs edits an old item once during repeated clicks and retries after failure',async({page})=>{
  const state=baseState();state.workstreams.push({id:'ws-2',project_id:'main-1',title:'현장 조직 대응',description:null,phase:'preparation',sort_order:20});await mockApp(page,state);
  const probe=await saveProbe(page,'app_project_workstreams','write');
  await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  const row=page.locator('[data-ps3-record="ws-2"]');
  await recordAction(page,row,'수정');
  await page.locator('#ps3WsTitle').fill('저장 잠금 영역');
  const button=page.locator('#ps3WsSave');
  await button.click();await expect.poll(()=>probe.count).toBe(1);
  await expect(button).toBeDisabled();await button.dispatchEvent('click');
  await page.waitForTimeout(150);expect(probe.count).toBe(1);
  probe.release();await expect(page.locator('#ps3WorkstreamModal')).toBeHidden();
  await recordAction(page,row,'수정');
  await page.locator('#ps3WsTitle').fill('다시 시도 영역');
  probe.fail=true;await button.click();
  await expect(page.locator('#ps3WsState')).toContainText('임시 저장 실패');
  await expect(button).toBeEnabled();await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await expect(page.locator('#ps3WsState')).toContainText('입력을 확인');await button.click();
  await expect.poll(()=>probe.count).toBe(3);await expect(page.locator('#ps3WorkstreamModal')).toBeHidden();
  expect(state.workstreams.map(x=>x.title)).toEqual(['정책·제도 대응','다시 시도 영역']);
});

test('saveRecordInput creates once during repeated submits and retries after failure',async({page})=>{
  const state=baseState();await mockApp(page,state);
  const probe=await saveProbe(page,'app_project_progress_updates','write');
  await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  const form=page.locator('#ps3-progress [data-ps3-record-input]'),button=form.locator('button[type=submit]');
  await form.locator('input').fill('잠금 검증 기록');await button.click();await expect.poll(()=>probe.count).toBe(1);
  await expect(button).toBeDisabled();await form.dispatchEvent('submit');
  expect(probe.count).toBe(1);probe.release();await expect(page.locator('#toast')).toHaveText('기록했습니다.');await expect(button).toBeEnabled();await expect(form.locator('input')).toHaveValue('');
  await form.locator('input').fill('다시 시도 기록');probe.fail=true;await button.click();
  await expect(page.locator('#toast')).toContainText('저장 실패');await expect(button).toBeEnabled();await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await page.getByRole('button',{name:'잠금 검증 기록 · 이 항목 사용',exact:true}).click();await expect(form.locator('input')).toHaveValue('다시 시도 기록');await button.click();
  await expect.poll(()=>probe.count).toBe(3);await expect(form.locator('input')).toHaveValue('');
  expect(state.progress.filter(x=>x.summary==='다시 시도 기록')).toHaveLength(1);expect(state.progress).toHaveLength(2);
  // The recovery read asks for records without a progress item, not for a literal "null" item.
  expect(state.progress.find(x=>x.summary==='다시 시도 기록').workstream_id).toBeNull();
});

test('saveMilestone creates one Google request during repeated clicks and retries after failure',async({page})=>{
  const state=baseState();
  state.googleStatus={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner'}],events:[],eventColors:{}};
  await mockApp(page,state);
  const probe={count:0,hold:true,fail:false,waiters:[]};
  probe.release=()=>{probe.hold=false;probe.waiters.splice(0).forEach(resolve=>resolve())};
  await page.route(`${SB}/functions/v1/google-calendar**`,async route=>{
    const body=route.request().postDataJSON?.();
    if(route.request().method()!=='POST'||!['create-event','update-event'].includes(body?.action))return route.fallback();
    probe.count++;
    if(probe.hold)await new Promise(resolve=>probe.waiters.push(resolve));
    if(probe.fail){probe.fail=false;return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'임시 저장 실패'})})}
    return route.fallback();
  });
  await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  await openFold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();
  await expect(page.locator('#ps3MilestoneSave')).toBeEnabled();
  await page.locator('#ps3MilestoneTitle').fill('잠금 검증 일정');
  await fillDateTime(page,'#ps3MilestoneAt','2026-10-02T10:00');
  const button=page.locator('#ps3MilestoneSave');
  await button.click();await expect.poll(()=>probe.count).toBe(1);
  await expect(button).toBeDisabled();await button.dispatchEvent('click');
  await page.waitForTimeout(150);expect(probe.count).toBe(1);
  probe.release();await expect(page.locator('#ps3MilestoneModal')).toBeHidden();
  await page.locator('[data-ps3-add-milestone]').click();
  await page.locator('#ps3MilestoneTitle').fill('다시 시도 일정');
  await fillDateTime(page,'#ps3MilestoneAt','2026-10-03T10:00');
  await expect(button).toBeEnabled();
  probe.fail=true;await button.click();
  await expect(page.locator('#ps3MilestoneState')).toContainText('임시 저장 실패');
  await expect(button).toBeEnabled();await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await page.getByRole('button',{name:'Google 일정에서 확인',exact:true}).click();await page.getByRole('button',{name:'잠금 검증 일정 · 이 항목 사용',exact:true}).click();await expect(page.locator('#ps3MilestoneState')).toContainText('선택한 기존 Google');await button.click();
  await expect.poll(()=>probe.count).toBe(3);expect(state.googleCalls.filter(c=>c.action==='create-event')).toHaveLength(1);
});

// PRJ-progress: real UI with REST mocked at the network boundary.
async function openRecords(page,state){
  await mockApp(page,state);
  await page.setViewportSize({width:390,height:844});
  await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  // PRJ-기록입력: the record section (top input + one list) replaces the per-item blocks.
  const item=page.locator('#ps3-progress');
  await expect(item.locator('[data-ps3-record-input] input')).toBeVisible();
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
    expect(layout.buttons).toHaveLength(1);for(const b of layout.buttons){expect(b.h).toBeGreaterThanOrEqual(44);expect(b.w).toBeGreaterThan(width>500?300:250)}
  }
  const input=item.locator('[data-ps3-record-input] input');await input.fill('추가 기록');await input.press('Enter');
  await expect(item.locator('[data-ps3-record-count]')).toHaveText('2');await expect(input).toBeVisible();
  await expect(item.locator('[data-ps3-record]')).toHaveCount(2);
});
// STAB-project-system-v3-1287: a late background refresh (tasks/meetings changed) must not rebuild the body and erase text typed in the quick record input.
test('PRJ background refresh keeps text typed in the quick record input',async({page})=>{
  const state=baseState(),item=await openRecords(page,state),input=item.locator('[data-ps3-record-input] input');
  await input.fill('쓰던 기록');
  await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('kptu:tasks-changed'));window.dispatchEvent(new CustomEvent('kptu:meetings-changed'))});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(input).toHaveValue('쓰던 기록');
  await input.press('Enter');
  await expect(item.locator('[data-ps3-record-count]')).toHaveText('2');await expect(input).toHaveValue('');
});
test('PRJ record edit cancels or saves only summary and preserves date and other fields',async({page})=>{
  const state=baseState(),before=structuredClone(state.progress[0]),item=await openRecords(page,state),record=item.locator('[data-ps3-record="pr-1"]');
  await recordAction(page,record,'수정');
  const form=record.locator('form[data-ps3-edit-record]');await expect(form.locator('input')).toHaveValue(before.summary);
  await form.locator('input').fill('취소할 글');await form.getByRole('button',{name:'취소',exact:true}).click();
  await expect(record.locator('.ps3-rec-summary')).toHaveText(before.summary);
  await recordAction(page,record,'수정');await form.locator('input').fill('수정한 기록');
  const request=page.waitForRequest(r=>r.method()==='PATCH'&&r.url().includes('app_project_progress_updates'));
  await form.getByRole('button',{name:'저장',exact:true}).click();const req=await request;
  expect(new URL(req.url()).searchParams.get('id')).toBe('eq.pr-1');expect(req.postDataJSON()).toEqual({summary:'수정한 기록'});expect(req.headers().prefer).toBe('return=representation');
  await expect(record.locator('.ps3-rec-summary')).toHaveText('수정한 기록');await expect(item.locator('[data-ps3-record]')).toBeVisible();
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
  await expect(record).toHaveCount(0);await expect(item.locator('[data-ps3-record]')).toHaveCount(1);
  await expect(item.locator('[data-ps3-record] .ps3-rec-summary').first()).toHaveText('국토부 후속협의 준비');
});
for(const method of ['PATCH','DELETE'])for(const status of [403,200])test(`PRJ ${method} ${status===403?'permission denied':'zero rows'} preserves the draft or restores a deleted record`,async({page})=>{
  const state=baseState(),item=await openRecords(page,state),record=item.locator('[data-ps3-record="pr-1"]');
  await page.route(`${SB}/rest/v1/app_project_progress_updates?**`,async route=>{
    if(route.request().method()!==method)return route.fallback();
    return route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===403?{message:'forbidden'}:[])});
  });
  if(method==='PATCH'){
    await recordAction(page,record,'수정');await record.locator('input').fill('저장 실패 글');await record.getByRole('button',{name:'저장',exact:true}).click();
  }else{page.once('dialog',d=>d.accept());await recordAction(page,record,'삭제')}
  await expect(page.locator('#toast')).toHaveText(method==='PATCH'?'수정 실패':'삭제 실패');
  if(method==='PATCH'){await expect(record.locator('input')).toHaveValue('저장 실패 글');await expect(record.getByRole('button',{name:'저장',exact:true})).toBeEnabled();if(status===200)await expect(record.getByRole('button',{name:'저장 결과 확인',exact:true})).toBeVisible()}else{await expect(record.locator('form[data-ps3-edit-record]')).toHaveCount(0);await expect(record.locator('.ps3-rec-summary')).toHaveText('국토부 후속협의 준비');await expect(record.locator('[data-ps3-record-menu]')).toBeEnabled()};await expect(item.locator('[data-ps3-record]')).toHaveCount(1);
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
  const quick=item.locator('[data-ps3-record-input]');await quick.locator('input').fill('동시에 추가 기록');await quick.locator('button[type=submit]').click();
  await expect(page.locator('#toast')).toHaveText('기록했습니다.');await expect(quick.locator('button[type=submit]')).toBeEnabled();
  await expect(quick.locator('input')).toHaveValue('');await expect(record.locator('input')).toHaveValue('수정 초안');
  await record.getByRole('button',{name:'취소',exact:true}).click();
  // A subsequent normal save refreshes all records without losing or duplicating the earlier save.
  await quick.locator('input').fill('다음 기록');await quick.locator('button[type=submit]').click();await expect(item.locator('[data-ps3-record-count]')).toHaveText('3');
  expect(state.progress.filter(x=>x.summary==='동시에 추가 기록')).toHaveLength(1);
});
test('PRJ last record deletion leaves quick input visible',async({page})=>{
  const state=baseState(),item=await openRecords(page,state);page.once('dialog',d=>d.accept());
  await recordAction(page,item,'삭제');await expect(item.locator('[data-ps3-record="ws-1"]')).toHaveAttribute('data-ps3-record-kind','item');await expect(item.locator('[data-ps3-record]:not([data-ps3-record-kind="item"])')).toHaveCount(0);
  await expect(item.locator('details')).toHaveCount(0);await expect(item.locator('[data-ps3-record-input] input')).toBeVisible();
});

test('PRJ pending delete cannot be displaced by a task refresh',async({page})=>{
  const state=baseState(),item=await openRecords(page,state),probe=await saveProbe(page,'app_project_progress_updates','DELETE');
  page.once('dialog',d=>d.accept());await recordAction(page,item,'삭제');await expect.poll(()=>probe.count).toBe(1);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:tasks-changed')));
  const quick=item.locator('[data-ps3-record-input]');await quick.locator('input').fill('삭제 대기 중 기록');await quick.locator('button[type=submit]').click();
  // Success toast is emitted only after refreshDetail resolves; it is the ordering barrier.
  await expect(page.locator('#toast')).toHaveText('기록했습니다.');
  await expect(item.locator('[data-ps3-record="pr-1"] [data-ps3-record-menu]')).toBeDisabled();
  probe.release();await expect(item.locator('[data-ps3-record="pr-1"]')).toHaveCount(0);await expect(item.locator('[data-ps3-record]:not([data-ps3-record-kind="item"])')).toHaveCount(1);await expect(item.locator('[data-ps3-record="ws-1"]')).toHaveAttribute('data-ps3-record-kind','item');await expect(item.locator('[data-ps3-record-input] input')).toBeVisible();
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
  await page.locator('#ps3-children [data-ps3-child]').click();await expect(page.locator('#ps3CreateModal')).toBeVisible();
  await page.goBack();await expect(page.locator('#ps3CreateModal')).toBeHidden();
  const quick=item.locator('[data-ps3-record-input]');await quick.locator('input').fill('뒤로가기 경합 기록');await quick.locator('button[type=submit]').click();
  await expect(page.locator('#toast')).toHaveText('기록했습니다.');
  await expect(item.locator('[data-ps3-record="pr-1"] [data-ps3-record-menu]')).toBeDisabled();probe.release();
  await expect(item.locator('[data-ps3-record="pr-1"]')).toHaveCount(0);await expect(item.locator('[data-ps3-record]:not([data-ps3-record-kind="item"])')).toHaveCount(1);await expect(item.locator('[data-ps3-record="ws-1"]')).toHaveAttribute('data-ps3-record-kind','item');
});

for(const width of [390,1440])for(const fallback of [false,true])test(`D-3e record menu dismissal and targets ${width} fallback=${fallback}`,async({page})=>{
  if(fallback)await page.addInitScript(()=>{HTMLElement.prototype.showPopover=undefined;HTMLElement.prototype.hidePopover=undefined});
  await page.setViewportSize({width,height:900});const state=baseState();state.progress.push({...state.progress[0],id:'pr-2'});
  const item=await openRecords(page,state);await page.setViewportSize({width,height:900});const trigger=item.locator('[data-ps3-record-menu="pr-1"]'),panel=page.locator('#ps3RecordMenu');
  await expect(trigger).toBeVisible();
  // PRJ-기록입력: the whole record line is the menu button (full list width, at least 44px tall).
  const geometry=await trigger.evaluate(b=>{const r=b.getBoundingClientRect(),list=b.closest('[data-ps3-records]').getBoundingClientRect();return {w:Math.round(r.width),list:Math.round(list.width),h:r.height}});
  expect(page.viewportSize().width).toBe(width);expect(geometry.w).toBe(geometry.list);expect(geometry.h).toBeGreaterThanOrEqual(44);
  const r=await trigger.boundingBox();await page.mouse.click(r.x+r.width-4,r.y+4);await expect(panel).toBeVisible();
  await expect(panel.locator('button')).toHaveText(['수정','삭제']);
  for(const button of await panel.locator('button').all())expect((await button.boundingBox()).height).toBe(44);
  const rect=await panel.boundingBox();expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(trigger).toBeFocused();await expect(page.locator('#ps3DetailModal')).toBeVisible();
  await trigger.click();await page.locator('#ps3Title,#ps3Summary').first().click();await expect(panel).toBeHidden();
  await trigger.click();await item.locator('[data-ps3-record-menu="pr-2"]').click({position:{x:8,y:8}});await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(panel).toBeVisible();
  await page.goBack();await expect(panel).toBeHidden();await expect(page.locator('#ps3DetailModal')).toBeVisible();
});

async function recordAction(page,row,name){await row.locator('[data-ps3-record-menu]').first().click();await page.locator('#ps3RecordMenu').getByRole('button',{name,exact:true}).click();}

for(const width of [390,1440])for(const [phase,label] of [['done','종료'],['follow_up','후속조치']])test(`PRJ-기록입력 long old item title wraps inside the line without a kind label ${width} ${phase}`,async({page})=>{
  const state=baseState();state.progress.push({...state.progress[0],id:'phase-second'});state.workstreams[0].phase=phase;state.workstreams[0].title='긴 제목 확인용 항목 '.repeat(12);
  expect(state.workstreams[0].title.length).toBeGreaterThanOrEqual(40);
  const item=await openRecords(page,state);await page.setViewportSize({width,height:900});
  await expect(item.locator('.ps3-phase')).toHaveCount(0);await expect(item).not.toContainText(label);
  const metrics=await item.locator('[data-ps3-record="pr-1"]').evaluate(row=>{const r=row.getBoundingClientRect(),from=row.querySelector('.ps3-rec-from');return {row:Math.round(r.width),scroll:row.scrollWidth-row.clientWidth,from:from.getBoundingClientRect().height,line:parseFloat(getComputedStyle(from).lineHeight),page:document.documentElement.scrollWidth-innerWidth}});
  expect(metrics.scroll).toBeLessThanOrEqual(1);expect(metrics.page).toBeLessThanOrEqual(1);expect(metrics.from).toBeGreaterThan(metrics.line);
});

for(const width of [390,1280])test(`D-4c single progress record has no duplicate summary at ${width}`,async({page})=>{
  const state=baseState();await mockApp(page,state);await page.setViewportSize({width,height:844});
  await page.goto(testOrigin+'/app/?project=main-1');await signIn(page);
  const item=page.locator('#ps3-progress');
  await expect(item.locator('[data-ps3-record]')).toHaveCount(1);
  await expect(item.locator('[data-ps3-record] .ps3-rec-summary')).toHaveText('국토부 후속협의 준비');
  await expect(item.locator('[data-ps3-record-menu]')).toBeVisible();
  await item.locator('[data-ps3-record-input] input').fill('두 번째 기록');
  await item.locator('[data-ps3-record-input] button[type=submit]').click();
  await expect(item.locator('[data-ps3-record-count]')).toHaveText('2');
  await expect(item.locator('[data-ps3-record] .ps3-rec-summary')).toHaveText(['두 번째 기록','국토부 후속협의 준비']);
  page.once('dialog',d=>d.accept());await recordAction(page,item.locator('[data-ps3-record]').first(),'삭제');
  await expect(item.locator('[data-ps3-record]')).toHaveCount(1);await expect(item.locator('[data-ps3-record] .ps3-rec-summary')).toHaveText('국토부 후속협의 준비');
});
