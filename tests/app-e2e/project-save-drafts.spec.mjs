import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import {closeProjectDetail} from './helpers/project-detail.mjs';
import {expectProjectTitle} from './helpers/screen-title.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const sourceHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const owner='home-test',workspace='w',stamp='2026-10-06T01:00:00Z';
// The real app, modal handlers and runtime run in Chromium. Only its network
// boundary is synthetic. These rows are not evidence of production DDL/defaults.
const project=(id,name)=>({id,name,workspace_id:workspace,owner_id:owner,created_by:owner,parent_id:null,status:'active',visibility:'private',sort_order:10,created_at:stamp,updated_at:stamp,metadata:{project_system:'v2',objective:'원래 설명',business:{keep:'exact'}}});
function matching(rows,query){
  return rows.filter(row=>[...query].every(([key,value])=>{
    if(value.startsWith('eq.'))return String(row[key]??'')===value.slice(3);
    if(value.startsWith('in.('))return value.slice(4,-1).split(',').includes(String(row[key]));
    return true;
  }));
}
async function fixture(page,width=390){
  await page.setViewportSize({width,height:900});
  await openHome(page);
  const state={requests:[],rules:[],serial:0,tables:{
    app_spaces:[project('p','프로젝트 A'),project('other','프로젝트 B')],
    app_project_modules:[],
    app_project_workstreams:[{id:'ws-a',project_id:'p',title:'진행 항목 A',phase:'in_progress',sort_order:10,created_by:owner},{id:'ws-b',project_id:'p',title:'진행 항목 B',phase:'preparation',sort_order:20,created_by:owner}],
    app_project_progress_updates:[{id:'record-a',project_id:'p',workstream_id:'ws-a',author_id:owner,summary:'서버 진행 기록',next_step:'다음 원문',status_label:'진행',effective_on:'2026-10-06',metadata:{keep:'exact'},created_at:stamp}],
    app_project_comments:[{id:'memo-a',project_id:'p',author_id:owner,body:'서버 메모',created_at:stamp,updated_at:stamp},{id:'memo-other-author',project_id:'p',author_id:'other-owner',body:'다른 작성자 메모',created_at:stamp,updated_at:stamp}],
    app_project_milestones:[],app_documents:[],app_record_links:[],app_suborganizations:[],app_suborganization_assignees:[],app_profiles:[{user_id:owner,display_name:'테스트 사용자'}],
  }};
  state.calls=(table,method)=>state.requests.filter(r=>r.table===table&&r.method===method);
  state.next=(table,method,{hold=false,status=200,response,apply=true,when=()=>true}={})=>{
    let release;const gate=hold?new Promise(resolve=>release=resolve):Promise.resolve();
    const rule={table,method,status,response,apply,when,gate,release:()=>release?.(),claimed:false,done:false};state.rules.push(rule);return rule;
  };
  await page.route(SB+'/rest/v1/**',async route=>{
    const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop(),method=req.method();
    if(!Object.hasOwn(state.tables,table))return route.fallback();
    const body=method==='GET'?null:req.postDataJSON();
    const request={table,method,query:Object.fromEntries(url.searchParams),body:structuredClone(body),prefer:req.headers().prefer||''};state.requests.push(request);
    const rule=state.rules.find(r=>!r.claimed&&r.table===table&&r.method===method&&r.when(request));if(rule){rule.claimed=true;await rule.gate;}
    const rows=state.tables[table];let result;
    if(method==='GET'){
      result=matching(rows,url.searchParams);
      if(table==='app_spaces'&&url.searchParams.get('select')?.includes('milestones:'))result=result.map(row=>({id:row.id,progress:state.tables.app_project_progress_updates.filter(p=>p.project_id===row.id).slice(0,1),milestones:[]}));
    }else if(method==='POST'){
      const created=(Array.isArray(body)?body:[body]).map(row=>({...row,id:row.id||'synthetic-row-'+(++state.serial),created_at:stamp,updated_at:stamp}));
      if(!rule||rule.apply)rows.push(...created);
      result=request.prefer.includes('return=representation')?created:null;
    }else if(method==='PATCH'){
      const targets=matching(rows,url.searchParams);if(!rule||rule.apply)targets.forEach(row=>Object.assign(row,body));
      result=request.prefer.includes('return=representation')?targets:null;
    }else throw new Error('Unexpected synthetic method: '+method);
    const payload=rule?.response===undefined?result:rule.response;
    await route.fulfill({status:rule?.status||200,json:payload});if(rule)rule.done=true;
  });
  await clickView(page,'projects');
  await page.evaluate(()=>window.__KPTU_PROJECT_V3_READY__);
  await expect(page.locator('#projectGrid[data-ps3-ready="1"]')).toBeVisible();
  return state;
}
async function openProject(page,id='p'){
  await page.locator(`#projectGrid .ps3-plist [data-ps3-project="${id}"]`).click();
  await expect(page.locator('#ps3Body')).toHaveAttribute('data-project',id);
}
async function editProject(page,id='p'){
  await openProject(page,id);await page.locator('#ps3Menu summary').click();await page.locator('[data-ps3-edit-project]').click();
  await expect(page.locator('#ps3CreateModal')).toBeVisible();
}
async function closeEditAndDetail(page){
  // UI-PC프로젝트좌우: on a PC the detail stays in the right pane; the next row click switches it.
  await page.locator('[data-ps3-close="ps3CreateModal"]').click();await closeProjectDetail(page);
}
async function fold(page,id){const box=page.locator('#'+id);if(await box.getAttribute('open')===null)await box.locator(':scope > summary').click();}
// MTG-프로젝트합치기 결정 ⑥: 옛 진행 기록·진행 항목 줄이 기록 목록에서 없어져(고치기 칸·진행 항목 창으로 가는 길이 없다) 그 줄을 열던
// editRecord·editItem 도우미와, 그것으로 진행 항목 창 저장 요청 소유('a previous WS finally cannot release the next editor request'·
// 'same-ID WS close-reopen keeps the first request locked…')와 기록 고치기 실패 초안('failed inline record PATCH keeps the exact draft')을
// 보던 시험을 지웠다. 그 줄이 그려지지 않고 두 표에 쓰지 않는 것은 project-system-v3·project-record-input 시험이 본다.
async function trackClickedSave(page,selector){
  // Test-only completion barrier: the actual click still invokes the original
  // production handler/body. Await it rather than sampling the UI before its
  // late catch/finally has run. No product module or auth state is replaced.
  await page.locator(selector).evaluate(button=>{
    window.__ps3TestSavePromises=[];const original=button.onclick;
    if(typeof original!=='function')throw new Error('Expected the existing onclick save handler');
    button.onclick=function(...args){const promise=Promise.resolve(original.apply(this,args));window.__ps3TestSavePromises.push(promise);return promise;};
  });
}
async function savedHandlerFinished(page,index=0){await page.evaluate(index=>window.__ps3TestSavePromises[index],index);}
function observation(label,state){console.info('Project RED source observation',JSON.stringify({head:sourceHead,label,requests:state.requests.filter(r=>r.method!=='GET')}));}

test('normal fixture: Project edit preserves metadata and uses the current renderer',async({page})=>{
  const state=await fixture(page);await editProject(page);await page.locator('#ps3CreateName').fill('정상 수정');await page.locator('#ps3CreateSave').click();
  await expect(page.locator('#ps3CreateModal')).toBeHidden();await expectProjectTitle(page,'정상 수정');
  expect(state.tables.app_spaces[0].metadata.business).toEqual({keep:'exact'});expect(state.calls('app_spaces','PATCH')).toHaveLength(1);
});
test('normal fixture: exact author/project filters return only the requested existing memo',async({page})=>{
  const state=await fixture(page);await openProject(page);
  const rows=await page.evaluate(async()=>window.KPTURuntime.api('/rest/v1/app_project_comments?id=eq.memo-a&project_id=eq.p&author_id=eq.home-test&select=*',{singleFlight:false}));
  expect(rows.map(row=>row.id)).toEqual(['memo-a']);
  const query=state.calls('app_project_comments','GET').at(-1).query;expect(query).toMatchObject({id:'eq.memo-a',project_id:'eq.p',author_id:'eq.home-test'});
});
// MTG-프로젝트합치기 3단계: 'normal adjacent draft: saving a top record preserves a different dirty progress record'는 상세 맨 위 입력칸 저장으로
// 다른 기록 초안이 지켜지는지 보던 시험이라, 입력칸(saveRecordInput)이 없어지며 함께 없앴다. (옛 기록 고치기 칸도 결정 ⑥으로 목록에서 없어졌다.)

for(const width of [390,1280])test(`Project PATCH failure keeps its current draft ${width}`,async({page})=>{
  const state=await fixture(page,width);await editProject(page);state.next('app_spaces','PATCH',{status:403,apply:false,response:{message:'synthetic permission denied'}});
  await page.locator('#ps3CreateName').fill('실패 수정 초안');await page.locator('#ps3CreateObjective').fill('줄1\n줄2');await page.locator('#ps3CreateSave').click();
  await expect(page.locator('#ps3CreateStatus')).toContainText('synthetic permission denied');await expect(page.locator('#ps3CreateModal')).toBeVisible();await expect(page.locator('#ps3CreateObjective')).toHaveValue('줄1\n줄2');
  expect(state.calls('app_spaces','PATCH')[0].query.id).toBe('eq.p');
});
for(const width of [390,1280])test(`late Project A success cannot close or repopulate Project B editor ${width}`,async({page})=>{
  const state=await fixture(page,width);await editProject(page);await trackClickedSave(page,'#ps3CreateSave');const first=state.next('app_spaces','PATCH',{hold:true});
  await page.locator('#ps3CreateName').fill('A 제출');await page.locator('#ps3CreateSave').click();await expect.poll(()=>first.claimed).toBe(true);await closeEditAndDetail(page);await editProject(page,'other');await page.locator('#ps3CreateName').fill('B 未送信 초안');
  first.release();await savedHandlerFinished(page);observation('late A success; B must stay open',state);
  await expect(page.locator('#ps3CreateModal')).toBeVisible();await expect(page.locator('#ps3CreateName')).toHaveValue('B 未送信 초안');expect(state.calls('app_spaces','PATCH')[0].query.id).toBe('eq.p');
});
test('late Project A failure cannot put its error in the Project B editor',async({page})=>{
  const state=await fixture(page);await editProject(page);await trackClickedSave(page,'#ps3CreateSave');const first=state.next('app_spaces','PATCH',{hold:true,status:403,apply:false,response:{message:'A-only failure'}});
  await page.locator('#ps3CreateSave').click();await expect.poll(()=>first.claimed).toBe(true);await closeEditAndDetail(page);await editProject(page,'other');await page.locator('#ps3CreateName').fill('B 초안');first.release();await savedHandlerFinished(page);
  await expect(page.locator('#ps3CreateStatus')).not.toContainText('A-only failure');await expect(page.locator('#ps3CreateName')).toHaveValue('B 초안');
});
test('Project same-ID close and reopen waits for the outstanding save',async({page})=>{
  const state=await fixture(page);await editProject(page);const first=state.next('app_spaces','PATCH',{hold:true});
  try{await page.locator('#ps3CreateSave').click();await expect.poll(()=>first.claimed).toBe(true);await closeEditAndDetail(page);await editProject(page);await page.locator('#ps3CreateName').fill('재열기 초안');
    observation('same ID reopened while PATCH pending',state);await expect(page.locator('#ps3CreateSave')).toBeDisabled();expect(state.calls('app_spaces','PATCH')).toHaveLength(1);
  }finally{first.release();}
});
test('a pending Project create cannot be bypassed by reopening with a different title',async({page})=>{
  const state=await fixture(page);await page.locator('#newProjectBtn').click();await trackClickedSave(page,'#ps3CreateSave');await page.locator('#ps3CreateName').fill('첫 생성');const first=state.next('app_spaces','POST',{hold:true});
  try{await page.locator('#ps3CreateSave').click();await expect.poll(()=>first.claimed).toBe(true);await page.locator('[data-ps3-close="ps3CreateModal"]').click();await page.locator('#newProjectBtn').click();await page.locator('#ps3CreateName').fill('새 제목 우회');await page.locator('#ps3CreateSave').dispatchEvent('click');
    await savedHandlerFinished(page,1);expect(state.calls('app_spaces','POST')).toHaveLength(1);await expect(page.locator('#ps3CreateStatus')).toContainText('앞선');
  }finally{first.release();await savedHandlerFinished(page);observation('pending create, changed title',state);}
});
test('unknown Project create retains its attempt across close and a new title',async({page})=>{
  const state=await fixture(page);await page.locator('#newProjectBtn').click();await trackClickedSave(page,'#ps3CreateSave');await page.locator('#ps3CreateName').fill('응답 유실 생성');state.next('app_spaces','POST',{status:503,apply:true,response:{message:'saved response lost'}});
  await page.locator('#ps3CreateSave').click();await expect(page.locator('#ps3CreateStatus')).toContainText('saved response lost');await page.locator('[data-ps3-close="ps3CreateModal"]').click();await page.locator('#newProjectBtn').click();await page.locator('#ps3CreateName').fill('새 제목');await page.locator('#ps3CreateSave').click();
  await savedHandlerFinished(page,1);observation('unknown create reopened with new title',state);expect(state.calls('app_spaces','POST')).toHaveLength(1);await expect(page.getByRole('button',{name:'저장 결과 확인',exact:true})).toBeVisible();
});
test('confirmed Project body is not created again when modules fail',async({page})=>{
  const state=await fixture(page);await page.locator('#newProjectBtn').click();await trackClickedSave(page,'#ps3CreateSave');await page.locator('#ps3CreateName').fill('본체만 저장');state.next('app_project_modules','POST',{status:503,apply:false,response:{message:'modules response unknown'}});
  await page.locator('#ps3CreateSave').click();await expect(page.locator('#ps3CreateStatus')).toContainText('modules response unknown');await page.locator('#ps3CreateSave').click();
  await savedHandlerFinished(page,1);observation('body confirmed; module response unknown',state);expect(state.calls('app_spaces','POST')).toHaveLength(1);expect(state.calls('app_project_modules','POST')).toHaveLength(1);
});
test('Project zero-row PATCH keeps the draft and offers result confirmation',async({page})=>{
  const state=await fixture(page);await editProject(page);await trackClickedSave(page,'#ps3CreateSave');state.next('app_spaces','PATCH',{apply:false,response:[]});await page.locator('#ps3CreateName').fill('행 확인 없는 초안');await page.locator('#ps3CreateSave').click();await savedHandlerFinished(page);
  await expect(page.locator('#ps3CreateModal')).toBeVisible();await expect(page.locator('#ps3CreateName')).toHaveValue('행 확인 없는 초안');await expect(page.getByRole('button',{name:'저장 결과 확인',exact:true})).toBeVisible();
});

test('unknown Project create uses an explicitly selected exact existing row without a second POST',async({page})=>{
  const state=await fixture(page);await page.locator('#newProjectBtn').click();await page.locator('#ps3CreateName').fill('응답만 유실');state.next('app_spaces','POST',{status:503,apply:true,response:{message:'lost reply'}});await page.locator('#ps3CreateSave').click();await expect(page.locator('#ps3CreateStatus')).toContainText('lost reply');
  await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await page.getByRole('button',{name:'응답만 유실 · 이 항목 사용',exact:true}).click();await expect(page.locator('#ps3CreateStatus')).toContainText('선택한 기존 항목');await page.locator('#ps3CreateName').fill('확인 후 수정');await page.locator('#ps3CreateSave').click();await expect(page.locator('#ps3CreateModal')).toBeHidden();
  expect(state.calls('app_spaces','POST')).toHaveLength(1);expect(state.calls('app_project_modules','POST')).toHaveLength(0);const id=state.tables.app_spaces.find(row=>row.name==='확인 후 수정').id;
  expect(state.calls('app_spaces','GET').find(r=>r.query.id==='eq.'+id).query).toMatchObject({workspace_id:'eq.w',owner_id:'eq.home-test'});expect(state.calls('app_spaces','PATCH').at(-1).query.id).toBe('eq.'+id);
});
test('negative module GET never authorizes another module or project POST',async({page})=>{
  const state=await fixture(page);await page.locator('#newProjectBtn').click();await page.locator('#ps3CreateName').fill('일부 확인');state.next('app_project_modules','POST',{status:503,apply:false,response:{message:'module reply lost'}});await page.locator('#ps3CreateSave').click();await expect(page.locator('#ps3CreateStatus')).toContainText('module reply lost');await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await expect(page.locator('#ps3CreateStatus')).toContainText('일부만 확인');await page.locator('#ps3CreateSave').click();
  expect(state.calls('app_spaces','POST')).toHaveLength(1);expect(state.calls('app_project_modules','POST')).toHaveLength(1);await expect(page.locator('#ps3CreateName')).toHaveValue('일부 확인');
});
test('positive module GET confirms a known project without reposting confirmed stages',async({page})=>{
  const state=await fixture(page);await page.locator('#newProjectBtn').click();await page.locator('#ps3CreateName').fill('모듈 응답 유실');state.next('app_project_modules','POST',{status:503,apply:true,response:{message:'module reply lost'}});await page.locator('#ps3CreateSave').click();await expect(page.locator('#ps3CreateStatus')).toContainText('module reply lost');await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await expect(page.locator('#ps3CreateStatus')).toContainText('입력을 확인');await page.locator('#ps3CreateSave').click();await expect(page.locator('#ps3CreateModal')).toBeHidden();
  expect(state.calls('app_spaces','POST')).toHaveLength(1);expect(state.calls('app_spaces','PATCH')).toHaveLength(0);expect(state.calls('app_project_modules','POST')).toHaveLength(1);
});
// MTG-프로젝트합치기 3단계: 'unknown top record blocks a changed title after a negative GET'는 맨 위 입력칸 저장의 결과 확인 흐름을 보던 시험이라
// 입력칸과 함께 없앴다(결과 확인 흐름 자체는 프로젝트·주요 일정 저장 시험이 계속 본다).
for(const width of [390,1280])test(`Project footer stays reachable by touch and keyboard ${width}`,async({page})=>{
  await fixture(page,width);await editProject(page);const footer=page.locator('#ps3CreateModal .modal-action-footer'),button=page.locator('#ps3CreateSave');await expect(footer).toBeVisible();const box=await button.boundingBox();expect(await button.evaluate(b=>parseFloat(getComputedStyle(b,'::after').minHeight))).toBeGreaterThanOrEqual(44);// UI-디자인기준 3/3 3부(8-9e-3): 창 버튼은 보이는 높이 자체가 46px(≥44px)이라 누르는 범위가 버튼 안에 있다. 위·아래 끝 2px 안을 눌러도 이 버튼.
expect(box.height).toBe(36);/* UI-버튼줄이기: 창 주 동작 36px, 누르는 범위 ::after 44px */for(const y of [box.y+2,box.y+box.height-2])expect(await button.evaluate((b,{x,y})=>document.elementFromPoint(x,y)?.closest('button')===b,{x:box.x+box.width/2,y})).toBe(true);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);await page.locator('[data-ps3-close="ps3CreateModal"]').focus();await page.keyboard.press('Shift+Tab');await expect(button).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('#ps3CreateModal')).toBeHidden();
});

async function milestoneFixture(page,width=390){
  const state=await fixture(page,width);state.googleCalls=[];state.googleRules=[];state.googleEvents=[];
  state.calendarState={connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',accessRole:'owner'},{id:'readonly',summary:'읽기 전용',accessRole:'reader'}]};
  for(const [id,eventId,title] of [['mile-a','g-a','주요 일정 A'],['mile-b','g-b','주요 일정 B']]){
    state.tables.app_project_milestones.push({id,project_id:'p',workstream_id:'ws-a',created_by:owner,title,start_at:'2026-10-06T01:00:00Z',end_at:'2026-10-06T03:00:00Z',notes:'원래 메모',milestone_type:'meeting',status:'planned',google_calendar_id:'primary',google_event_id:eventId});
    state.googleEvents.push({id:eventId,calendarId:'primary',title,start:'2026-10-06T01:00:00Z',end:'2026-10-06T03:00:00Z',description:'원래 메모',location:'원래 장소',colorId:'4',organizationIds:['기존 조직'],allDay:false,recurring:false,source:'google'});
  }
  state.nextGoogle=(action,{hold=false,status=200,response,apply=true}={})=>{let release;const gate=hold?new Promise(resolve=>release=resolve):Promise.resolve();const rule={action,gate,status,response,apply,claimed:false,done:false,release:()=>release?.()};state.googleRules.push(rule);return rule};
  await page.route(SB+'/functions/v1/google-calendar**',async route=>{
    const req=route.request(),url=new URL(req.url()),body=req.method()==='POST'?req.postDataJSON():null,action=body?.action||url.searchParams.get('action')||'status';state.googleCalls.push({action,method:req.method(),query:Object.fromEntries(url.searchParams),body:structuredClone(body)});const rule=state.googleRules.find(r=>!r.claimed&&r.action===action);if(rule){rule.claimed=true;await rule.gate}
    const id=body?.event_id||url.searchParams.get('eventId'),calendarId=body?.calendar_id||url.searchParams.get('calendarId');let result,status=rule?.status||200;
    if(action==='status')result=state.calendarState;
    else if(action==='events')result={events:state.googleEvents,eventColors:{}};
    else if(action==='event'){const event=state.googleEvents.find(x=>x.id===id&&x.calendarId===calendarId);result=event?{event,eventColors:{}}:{error:'exact event missing'};if(!event)status=400;}
    else if(action==='delete-event'){if(!rule||rule.apply)state.googleEvents=state.googleEvents.filter(x=>x.id!==id||x.calendarId!==calendarId);result={ok:true};}
    else if(action==='create-event'||action==='update-event'){
      const previous=state.googleEvents.find(x=>x.id===id&&x.calendarId===calendarId),event={...(previous||{}),id:action==='create-event'?'google-created-'+(++state.serial):id,calendarId,title:body.title,description:body.memo,allDay:!!body.all_day,start:body.all_day?body.start_date:body.start_iso,end:body.all_day?new Date(Date.parse(body.end_date)+86400000).toISOString().slice(0,10):body.end_iso,source:'google'};
      for(const [key,payloadKey] of [['location','location'],['organizationIds','organization_ids'],['colorId','color_hex']])if(Object.hasOwn(body,payloadKey))event[key]=body[payloadKey];
      if(!rule||rule.apply){if(previous)Object.assign(previous,event);else state.googleEvents.push(event)}result={ok:true,event};
    }else throw new Error('Unexpected synthetic calendar action: '+action);
    await route.fulfill({status,json:rule?.response===undefined?result:rule.response});if(rule)rule.done=true;
  });return state;
}
async function editMilestone(page,id='mile-a'){await openProject(page);await fold(page,'ps3-milestones');await page.locator(`[data-ps3-edit-milestone="${id}"]`).click();await expect(page.locator('#ps3MilestoneSave')).toBeEnabled()}
async function newMilestone(page){await openProject(page);await fold(page,'ps3-milestones');await page.locator('[data-ps3-add-milestone]').click();await expect(page.locator('#ps3MilestoneSave')).toBeEnabled();await page.locator('#ps3MilestoneTitle').fill('생성 일정');await fillDateTime(page,'#ps3MilestoneAt','2026-10-06T10:00')}

test('milestone late Google A result cannot PATCH local B or close its draft',async({page})=>{
  const state=await milestoneFixture(page);await editMilestone(page);await trackClickedSave(page,'#ps3MilestoneSave');const first=state.nextGoogle('update-event',{hold:true});await page.locator('#ps3MilestoneTitle').fill('A 제출');await page.locator('#ps3MilestoneSave').click();await expect.poll(()=>first.claimed).toBe(true);await page.locator('[data-ps3-close="ps3MilestoneModal"]').click();await page.locator('[data-ps3-edit-milestone="mile-b"]').click();await page.locator('#ps3MilestoneTitle').fill('B 초안');first.release();await savedHandlerFinished(page);await expect(page.locator('#ps3MilestoneModal')).toBeVisible();await expect(page.locator('#ps3MilestoneTitle')).toHaveValue('B 초안');expect(state.calls('app_project_milestones','PATCH')).toHaveLength(0);
});
test('known Google creation with unknown local reply never deletes or recreates confirmed work',async({page})=>{
  const state=await milestoneFixture(page);await newMilestone(page);state.next('app_project_milestones','POST',{status:503,apply:true,response:{message:'local reply lost'}});await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneState')).toContainText('local reply lost');await page.locator('#ps3MilestoneSave').click();expect(state.googleCalls.filter(x=>x.action==='create-event')).toHaveLength(1);expect(state.googleCalls.filter(x=>x.action==='delete-event')).toHaveLength(0);expect(state.calls('app_project_milestones','DELETE')).toHaveLength(0);expect(state.calls('app_project_milestones','POST')).toHaveLength(1);await expect(page.getByRole('button',{name:'저장 결과 확인',exact:true})).toBeVisible();
});
test('negative local milestone GET does not permit another POST or Google DELETE',async({page})=>{
  const state=await milestoneFixture(page);await newMilestone(page);state.next('app_project_milestones','POST',{status:503,apply:false,response:{message:'unknown local'}});await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneState')).toContainText('unknown local');await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await expect(page.locator('#ps3MilestoneState')).toContainText('확인');await page.locator('#ps3MilestoneSave').click();expect(state.calls('app_project_milestones','POST')).toHaveLength(1);expect(state.googleCalls.filter(x=>x.action==='delete-event')).toHaveLength(0);const write=state.calls('app_project_milestones','POST')[0];expect(state.calls('app_project_milestones','GET').some(r=>r.query.id==='eq.'+write.body.id&&r.query.project_id==='eq.p')).toBe(true);
});
test('milestone memo edit reads exact Google original and preserves duration location color and organization metadata',async({page})=>{
  const state=await milestoneFixture(page);await editMilestone(page);await page.locator('#ps3MilestoneNotes').fill('메모만 수정');await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneModal')).toBeHidden();const payload=state.googleCalls.find(x=>x.action==='update-event').body;expect(payload).toMatchObject({calendar_id:'primary',event_id:'g-a',start_iso:'2026-10-06T01:00:00Z',end_iso:'2026-10-06T03:00:00Z',memo:'메모만 수정'});for(const key of ['location','color_hex','organization_ids','target_calendar_id'])expect(Object.hasOwn(payload,key)).toBe(false);expect(state.googleCalls.some(x=>x.action==='event'&&x.query.calendarId==='primary'&&x.query.eventId==='g-a')).toBe(true);expect(state.googleEvents[0]).toMatchObject({location:'원래 장소',colorId:'4',organizationIds:['기존 조직']});expect(state.tables.app_project_milestones[0].end_at).toBe('2026-10-06T03:00:00Z');
});
test('same-ID milestone reopened during Google save waits and keeps the new editor',async({page})=>{
  const state=await milestoneFixture(page);await editMilestone(page);await trackClickedSave(page,'#ps3MilestoneSave');const first=state.nextGoogle('update-event',{hold:true});try{await page.locator('#ps3MilestoneSave').click();await expect.poll(()=>first.claimed).toBe(true);await page.locator('[data-ps3-close="ps3MilestoneModal"]').click();await page.locator('[data-ps3-edit-milestone="mile-a"]').click();await expect(page.locator('#ps3MilestoneSave')).toBeDisabled();first.release();await savedHandlerFinished(page);await expect(page.locator('#ps3MilestoneModal')).toBeVisible();expect(state.calls('app_project_milestones','PATCH')).toHaveLength(0)}finally{first.release()}
});
test('all-day milestone memo edit preserves the original all-day boundaries',async({page})=>{
  const state=await milestoneFixture(page);Object.assign(state.googleEvents[0],{allDay:true,start:'2026-10-06',end:'2026-10-08'});await editMilestone(page);await page.locator('#ps3MilestoneNotes').fill('종일 메모 수정');await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneModal')).toBeHidden();expect(state.googleCalls.find(x=>x.action==='update-event').body).toMatchObject({all_day:true,start_date:'2026-10-06',end_date:'2026-10-07'});
});
test('recurring milestone date conversion is held for confirmation without a write',async({page})=>{
  const state=await milestoneFixture(page);state.googleEvents[0].recurring=true;await editMilestone(page);await fillDateTime(page,'#ps3MilestoneAt','2026-10-07T11:00');await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneState')).toContainText('반복');expect(state.googleCalls.filter(x=>x.action==='update-event')).toHaveLength(0);expect(state.calls('app_project_milestones','PATCH')).toHaveLength(0);await expect(page.locator('#ps3MilestoneAt')).toHaveValue('2026-10-07T11:00');
});
test('milestone extra notes during confirmed save remain in the current draft',async({page})=>{
  const state=await milestoneFixture(page);await newMilestone(page);const first=state.nextGoogle('create-event',{hold:true});await page.locator('#ps3MilestoneNotes').fill('제출 메모');await page.locator('#ps3MilestoneSave').click();await expect.poll(()=>first.claimed).toBe(true);await page.locator('#ps3MilestoneNotes').fill('후속 메모');first.release();await expect.poll(()=>state.calls('app_project_milestones','POST').length).toBe(1);await expect(page.locator('#ps3MilestoneModal')).toBeVisible();await expect(page.locator('#ps3MilestoneNotes')).toHaveValue('후속 메모');expect(state.calls('app_project_milestones','POST')[0].body.notes).toBe('제출 메모');
});

test('positive local milestone confirmation completes saved stages without another create',async({page})=>{
  const state=await milestoneFixture(page);await newMilestone(page);state.next('app_project_milestones','POST',{status:503,apply:true,response:{message:'local lost'}});await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneState')).toContainText('local lost');await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await expect(page.locator('#ps3MilestoneState')).toContainText('선택한 기존 일정');await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneModal')).toBeHidden();expect(state.calls('app_project_milestones','POST')).toHaveLength(1);expect(state.calls('app_project_milestones','PATCH')).toHaveLength(0);expect(state.googleCalls.filter(c=>c.action==='create-event')).toHaveLength(1);
});
test('confirmed rejected milestone write compensates only its frozen Google address and does not restart creation',async({page})=>{
  const state=await milestoneFixture(page);await newMilestone(page);state.next('app_project_milestones','POST',{status:403,apply:false,response:{message:'confirmed denied'}});await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneState')).toContainText('되돌렸습니다');await page.locator('#ps3MilestoneSave').click();await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await expect(page.locator('#ps3MilestoneState')).toContainText('삭제 보상 응답');await expect(page.getByRole('button',{name:'Google 일정에서 확인',exact:true})).toBeVisible();expect(state.googleCalls.filter(c=>c.action==='create-event')).toHaveLength(1);expect(state.calls('app_project_milestones','DELETE')).toHaveLength(0);const deleted=state.googleCalls.find(c=>c.action==='delete-event');expect(state.googleCalls.some(c=>c.action==='event'&&c.query.eventId===deleted.body.event_id&&c.query.calendarId===deleted.body.calendar_id)).toBe(true);
});
test('unknown Google creation uses an exact selected existing event and never reposts create',async({page})=>{
  const state=await milestoneFixture(page);await newMilestone(page);state.nextGoogle('create-event',{status:503,apply:true,response:{message:'Google reply lost'}});await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneState')).toContainText('Google reply lost');await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await expect(page.locator('#ps3MilestoneState')).toContainText('생성 결과를 확인하지');await page.getByRole('button',{name:'Google 일정에서 확인',exact:true}).click();await page.getByRole('button',{name:'생성 일정 · 이 항목 사용',exact:true}).click();await expect(page.locator('#ps3MilestoneState')).toContainText('선택한 기존 Google');await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneModal')).toBeHidden();expect(state.googleCalls.filter(c=>c.action==='create-event')).toHaveLength(1);expect(state.googleCalls.filter(c=>c.action==='update-event')).toHaveLength(0);expect(state.calls('app_project_milestones','POST')).toHaveLength(1);
});
test('same-owner logout and login during Google save stop later local writes and compensation',async({page})=>{
  const state=await milestoneFixture(page);await newMilestone(page);const first=state.nextGoogle('create-event',{hold:true});await page.locator('#ps3MilestoneSave').click();await expect.poll(()=>first.claimed).toBe(true);await page.evaluate(()=>{const rt=window.KPTURuntime,s=rt.session.read(),c=rt.context.read();rt.session.write(null);rt.session.write(s);rt.context.set(c)});first.release();await expect.poll(()=>first.done).toBe(true);expect(state.calls('app_project_milestones','POST')).toHaveLength(0);expect(state.googleCalls.filter(c=>c.action==='delete-event')).toHaveLength(0);expect(state.googleEvents.filter(e=>e.title==='생성 일정')).toHaveLength(1);
});

test('a confirmed local rejection after Google recovery retains its known address for later explicit saves',async({page})=>{
  const state=await milestoneFixture(page);await newMilestone(page);for(let i=0;i<3;i++)state.next('app_project_milestones','POST',{status:403,apply:false,response:{message:'local permission denied'}});state.nextGoogle('delete-event',{status:503,apply:false,response:{message:'compensation reply lost'}});await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneState')).toContainText('되돌린 결과를 확인');await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await expect(page.locator('#ps3MilestoneState')).toContainText('입력을 확인');await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneState')).toContainText('local permission denied');await page.locator('#ps3MilestoneSave').click();await expect.poll(()=>state.calls('app_project_milestones','POST').length).toBe(3);expect(state.googleCalls.filter(c=>c.action==='create-event')).toHaveLength(1);expect(new Set(state.calls('app_project_milestones','POST').map(c=>c.body.id)).size).toBe(1);
});

test('a calendar selection changed during a new milestone save remains the current unsubmitted draft',async({page})=>{
  const state=await milestoneFixture(page);state.calendarState.calendars.push({id:'other-calendar',summary:'다른 캘린더',accessRole:'owner'});await newMilestone(page);await trackClickedSave(page,'#ps3MilestoneSave');const first=state.nextGoogle('create-event',{hold:true});await page.locator('#ps3MilestoneSave').click();await expect.poll(()=>first.claimed).toBe(true);await page.locator('#ps3MilestoneGoogle').selectOption('other-calendar');first.release();await savedHandlerFinished(page);await expect(page.locator('#ps3MilestoneModal')).toBeVisible();await expect(page.locator('#ps3MilestoneGoogle')).toHaveValue('other-calendar');expect(state.googleCalls.find(c=>c.action==='create-event').body.calendar_id).toBe('primary');expect(state.calls('app_project_milestones','POST')[0].body.google_calendar_id).toBe('primary');await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneState')).toContainText('현재 선택을 확인');expect(state.googleCalls.filter(c=>c.action==='create-event')).toHaveLength(1);expect(state.googleCalls.filter(c=>c.action==='update-event')).toHaveLength(0);expect(state.calls('app_project_milestones','PATCH')).toHaveLength(0);await page.locator('#ps3MilestoneGoogle').selectOption('primary');await page.locator('#ps3MilestoneNotes').fill('A의 후속 수정');await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneModal')).toBeHidden();expect(state.googleCalls.filter(c=>c.action==='create-event')).toHaveLength(1);expect(state.googleCalls.filter(c=>c.action==='update-event')[0].body.calendar_id).toBe('primary');expect(state.calls('app_project_milestones','PATCH')).toHaveLength(1);
});

test('reopened pending milestone restores the changed calendar draft and resumes only its known original address',async({page})=>{
  const state=await milestoneFixture(page);state.calendarState.calendars.push({id:'other-calendar',summary:'다른 캘린더',accessRole:'owner'});await newMilestone(page);await trackClickedSave(page,'#ps3MilestoneSave');const first=state.nextGoogle('create-event',{hold:true});await page.locator('#ps3MilestoneSave').click();await expect.poll(()=>first.claimed).toBe(true);await page.locator('#ps3MilestoneGoogle').selectOption('other-calendar');await page.locator('[data-ps3-close="ps3MilestoneModal"]').click();await page.locator('[data-ps3-add-milestone]').click();await expect(page.locator('#ps3MilestoneGoogle')).toHaveValue('other-calendar');await expect(page.locator('#ps3MilestoneSave')).toBeDisabled();first.release();await savedHandlerFinished(page);await expect(page.getByRole('button',{name:'저장 결과 확인',exact:true})).toBeVisible();await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await expect(page.locator('#ps3MilestoneState')).toContainText('입력을 확인');await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneState')).toContainText('현재 선택을 확인');expect(state.calls('app_project_milestones','POST')).toHaveLength(0);await page.locator('#ps3MilestoneGoogle').selectOption('primary');await page.locator('#ps3MilestoneSave').click();await expect(page.locator('#ps3MilestoneModal')).toBeHidden();expect(state.googleCalls.filter(c=>c.action==='create-event')).toHaveLength(1);expect(state.calls('app_project_milestones','POST')).toHaveLength(1);
});

