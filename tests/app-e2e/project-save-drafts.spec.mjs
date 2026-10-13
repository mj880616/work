import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';

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
      if(table==='app_spaces'&&url.searchParams.get('select')?.includes('progress:'))result=result.map(row=>({id:row.id,progress:state.tables.app_project_progress_updates.filter(p=>p.project_id===row.id).slice(0,1),milestones:[]}));
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
  await page.locator(`#projectGrid [data-ps3-project="${id}"]`).click();
  await expect(page.locator('#ps3Body')).toHaveAttribute('data-project',id);
}
async function editProject(page,id='p'){
  await openProject(page,id);await page.locator('#ps3Menu summary').click();await page.locator('[data-ps3-edit-project]').click();
  await expect(page.locator('#ps3CreateModal')).toBeVisible();
}
async function closeEditAndDetail(page){
  await page.locator('[data-ps3-close="ps3CreateModal"]').click();await page.locator('[data-ps3-close="ps3DetailModal"]').click();
}
async function fold(page,id){const box=page.locator('#'+id);if(await box.getAttribute('open')===null)await box.locator(':scope > summary').click();}
async function editRecord(page){
  const row=page.locator('[data-ps3-record="record-a"]');await row.locator('[data-ps3-record-menu]').click();await page.locator('#ps3RecordMenu').getByRole('button',{name:'수정',exact:true}).click();return row;
}
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
  await expect(page.locator('#ps3CreateModal')).toBeHidden();await expect(page.locator('#ps3Title')).toHaveText('정상 수정');
  expect(state.tables.app_spaces[0].metadata.business).toEqual({keep:'exact'});expect(state.calls('app_spaces','PATCH')).toHaveLength(1);
});
test('normal fixture: exact author/project filters return only the requested existing memo',async({page})=>{
  const state=await fixture(page);await openProject(page);await fold(page,'ps3-memos');
  const rows=await page.evaluate(async()=>window.KPTURuntime.api('/rest/v1/app_project_comments?id=eq.memo-a&project_id=eq.p&author_id=eq.home-test&select=*',{singleFlight:false}));
  expect(rows.map(row=>row.id)).toEqual(['memo-a']);
  const query=state.calls('app_project_comments','GET').at(-1).query;expect(query).toMatchObject({id:'eq.memo-a',project_id:'eq.p',author_id:'eq.home-test'});
});
test('normal adjacent draft: saving a memo preserves a different dirty progress record',async({page})=>{
  const state=await fixture(page);await openProject(page);const row=await editRecord(page);await row.locator('input').fill('別の 수정 초안');await fold(page,'ps3-memos');
  await page.locator('#ps3MemoBody').fill('추가 메모');await page.locator('[data-ps3-memo-save]').click();await expect(page.locator('#toast')).toContainText('메모를 저장');
  await expect(row.locator('input')).toHaveValue('別の 수정 초안');expect(state.calls('app_project_comments','POST')).toHaveLength(1);
});

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
test('a previous WS finally cannot release the next editor request',async({page})=>{
  const state=await fixture(page);await openProject(page);await page.locator('[data-ps3-edit-ws="ws-a"]').click();const first=state.next('app_project_workstreams','PATCH',{hold:true});
  await page.locator('#ps3WsTitle').fill('A 제출');await page.locator('#ps3WsSave').click();await expect.poll(()=>first.claimed).toBe(true);await page.locator('[data-ps3-close="ps3WorkstreamModal"]').click();await page.locator('[data-ps3-edit-ws="ws-b"]').click();const second=state.next('app_project_workstreams','PATCH',{hold:true});
  try{await page.locator('#ps3WsTitle').fill('B 제출');await expect(page.locator('#ps3WsSave')).toBeEnabled();await page.locator('#ps3WsSave').click();await expect.poll(()=>second.claimed).toBe(true);first.release();await expect.poll(()=>first.done).toBe(true);await expect(page.locator('#ps3WsSave')).toBeDisabled();await expect(page.locator('#ps3WsTitle')).toHaveValue('B 제출');
  }finally{first.release();second.release();observation('WS A/B request ownership',state);}
});
test('delegated source path: progress POST followed by failed phase update retries no record POST',async({page})=>{
  const state=await fixture(page);await openProject(page);
  // The compact renderer does not currently offer this modal trigger. This is
  // a source-path probe of its existing delegated handler, not a claim that a
  // phone user can open this form from the current compact screen.
  // Open the existing dialog through its documented delegated action, without
  // invoking a saver or modifying a product function/global.
  await page.evaluate(()=>{const b=document.createElement('button');b.dataset.ps3ProgressWs='ws-a';document.querySelector('#ps3Body').append(b);b.click();b.remove();});
  await expect(page.locator('#ps3ProgressModal')).toBeVisible();await page.locator('#ps3ProgressSummary').fill('기록은 저장됨');await page.locator('#ps3ProgressPhase').selectOption('done');state.next('app_project_workstreams','PATCH',{status:503,apply:false,response:{message:'phase response unknown'}});
  await page.locator('#ps3ProgressSave').click();await expect(page.locator('#ps3ProgressState')).toContainText('phase response unknown');await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await expect(page.locator('#ps3ProgressState')).toContainText('입력을 확인');await page.locator('#ps3ProgressSave').click();await expect(page.locator('#ps3ProgressModal')).toBeHidden();
  observation('progress persisted then phase failed',state);expect(state.calls('app_project_progress_updates','POST')).toHaveLength(1);
});
for(const width of [390,1280])test(`failed inline record PATCH keeps the exact draft ${width}`,async({page})=>{
  const state=await fixture(page,width);await openProject(page);const row=await editRecord(page);state.next('app_project_progress_updates','PATCH',{status:403,apply:false,response:{message:'record forbidden'}});await row.locator('input').fill('未保存 수정 글');await row.getByRole('button',{name:'저장',exact:true}).click();
  await expect(page.locator('#toast')).toContainText('수정 실패');await expect(row.locator('input')).toHaveValue('未保存 수정 글');expect(state.tables.app_project_progress_updates[0].summary).toBe('서버 진행 기록');
});
test('memo input added during its confirmed save remains a separate draft',async({page})=>{
  const state=await fixture(page);await openProject(page);await fold(page,'ps3-memos');const first=state.next('app_project_comments','POST',{hold:true});await page.locator('#ps3MemoBody').fill('메모 제출');await page.locator('[data-ps3-memo-save]').click();await expect.poll(()=>first.claimed).toBe(true);await page.locator('#ps3MemoBody').fill('후속 未送信 메모');first.release();
  await expect(page.locator('#toast')).toContainText('메모를 저장');observation('submitted memo versus later draft',state);await expect(page.locator('#ps3MemoBody')).toHaveValue('후속 未送信 메모');expect(state.calls('app_project_comments','POST')[0].body.body).toBe('메모 제출');
});
for(const mismatch of ['project_id','author_id'])test(`memo creation cannot confirm a returned row with mismatched ${mismatch}`,async({page})=>{
  const state=await fixture(page);await openProject(page);await fold(page,'ps3-memos');await page.locator('#ps3MemoBody').fill('scope 확인할 메모');
  const result={id:'returned-memo',project_id:'p',author_id:owner,body:'scope 확인할 메모',[mismatch]:'other-scope'};
  const write=state.next('app_project_comments','POST',{response:[result]});await page.locator('[data-ps3-memo-save]').click();await expect.poll(()=>write.done).toBe(true);
  observation('memo returned row '+mismatch+' mismatch',state);await expect(page.locator('#ps3MemoState')).toContainText('확인');await expect(page.locator('#ps3MemoBody')).toHaveValue('scope 확인할 메모');expect(state.calls('app_project_comments','POST')).toHaveLength(1);
});
test('unknown memo confirmation uses frozen scopes and rejects a returned wrong author',async({page})=>{
  const state=await fixture(page);await openProject(page);await fold(page,'ps3-memos');await page.locator('#ps3MemoBody').fill('unknown 메모 초안');state.next('app_project_comments','POST',{status:503,apply:false,response:{message:'memo response lost'}});await page.locator('[data-ps3-memo-save]').click();await expect(page.locator('#ps3MemoState')).toContainText('memo response lost');
  await expect(page.getByRole('button',{name:'저장 결과 확인',exact:true})).toBeVisible();await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();
  state.next('app_project_comments','GET',{when:r=>r.query.id==='eq.memo-a',response:[{...state.tables.app_project_comments[0],author_id:'other-owner'}]});
  await page.getByRole('button',{name:'서버 메모 · 이 항목 사용',exact:true}).click();
  await expect.poll(()=>state.calls('app_project_comments','GET').some(r=>r.query.id==='eq.memo-a')).toBe(true);
  const exact=state.calls('app_project_comments','GET').find(r=>r.query.id==='eq.memo-a');expect(exact.query).toMatchObject({project_id:'eq.p',author_id:'eq.home-test',id:'eq.memo-a'});
  await expect(page.locator('#ps3MemoBody')).toHaveValue('unknown 메모 초안');expect(state.calls('app_project_comments','POST')).toHaveLength(1);await expect(page.locator('#ps3MemoState')).toContainText('확인');
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
test('same-ID WS close-reopen keeps the first request locked until result confirmation',async({page})=>{
  const state=await fixture(page);await openProject(page);await page.locator('[data-ps3-edit-ws="ws-a"]').click();const first=state.next('app_project_workstreams','PATCH',{hold:true});try{await page.locator('#ps3WsSave').click();await expect.poll(()=>first.claimed).toBe(true);await page.locator('[data-ps3-close="ps3WorkstreamModal"]').click();await page.locator('[data-ps3-edit-ws="ws-a"]').click();await expect(page.locator('#ps3WsSave')).toBeDisabled();first.release();await expect(page.locator('#ps3WsSave')).toBeEnabled();await expect(page.locator('#ps3WorkstreamModal')).toBeVisible();await expect(page.getByRole('button',{name:'저장 결과 확인',exact:true})).toBeVisible();expect(state.calls('app_project_workstreams','PATCH')).toHaveLength(1)}finally{first.release()}
});
test('unknown quick record blocks a changed title and a different workstream after a negative GET',async({page})=>{
  const state=await fixture(page);await openProject(page);const first=page.locator('[data-ps3-quick-progress="ws-a"]'),next=page.locator('[data-ps3-quick-progress="ws-b"]');state.next('app_project_progress_updates','POST',{status:503,apply:false,response:{message:'unknown quick'}});await first.locator('input').fill('불명 기록');await first.locator('button').click();await expect(page.locator('#toast')).toContainText('unknown quick');state.next('app_project_progress_updates','GET',{when:r=>r.query.author_id==='eq.home-test',response:[]});await page.getByRole('button',{name:'저장 결과 확인',exact:true}).click();await expect(page.locator('#ps3Body')).toContainText('목록에서 결과를 찾지 못했습니다');await first.locator('input').fill('새 제목');await first.locator('button').click();await next.locator('input').fill('다른 항목 우회');await next.locator('button').click();expect(state.calls('app_project_progress_updates','POST')).toHaveLength(1);await expect(first.locator('input')).toHaveValue('새 제목');
});
test('unknown memo survives closing and a new title without a second POST',async({page})=>{
  const state=await fixture(page);await openProject(page);await fold(page,'ps3-memos');state.next('app_project_comments','POST',{status:503,apply:false,response:{message:'unknown memo'}});await page.locator('#ps3MemoBody').fill('응답 불명 메모');await page.locator('[data-ps3-memo-save]').click();await expect(page.locator('#ps3MemoState')).toContainText('unknown memo');page.once('dialog',d=>d.accept());await page.locator('[data-ps3-close="ps3DetailModal"]').click();await openProject(page);await fold(page,'ps3-memos');await page.locator('#ps3MemoBody').fill('새 제목 메모');await page.locator('[data-ps3-memo-save]').click();expect(state.calls('app_project_comments','POST')).toHaveLength(1);await expect(page.getByRole('button',{name:'저장 결과 확인',exact:true})).toBeVisible();
});
for(const width of [390,1280])test(`Project footer stays reachable by touch and keyboard ${width}`,async({page})=>{
  await fixture(page,width);await editProject(page);const footer=page.locator('#ps3CreateModal .modal-action-footer'),button=page.locator('#ps3CreateSave');await expect(footer).toBeVisible();const box=await button.boundingBox();expect(await button.evaluate(b=>parseFloat(getComputedStyle(b,'::after').minHeight))).toBeGreaterThanOrEqual(44);expect(await button.evaluate((b,box)=>document.elementFromPoint(box.x+box.width/2,box.y+box.height+2)?.closest('button')===b,box)).toBe(true);expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);await page.locator('[data-ps3-close="ps3CreateModal"]').focus();await page.keyboard.press('Shift+Tab');await expect(button).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('#ps3CreateModal')).toBeHidden();
});
