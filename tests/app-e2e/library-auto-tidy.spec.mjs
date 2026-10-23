// LIB-자동정리 (docs/design/library-ai-fill.md 6절): opening the library quietly asks the server to tidy the not-yet-tidy
// fields of old documents — no button, no progress text, no AI marker — and never waits for it before showing the list.
// The mock ai-assist applies the server rules (only untidy, non-user fields; tried documents skipped). No real Supabase/Drive/OpenAI.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { expandLibraryTree } from './helpers/library-tree.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();
const DOC_ID=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const CATS=['교섭','투쟁','교육','선전','정책','회의','기타'];
const WS_ID='b0000000-0000-4000-8000-000000000001';
const OLD='2026-09-01T00:00:00Z';

function makeDocs(count,over={}){
  return Array.from({length:count},(_,i)=>({id:DOC_ID(i+1),workspace_id:WS_ID,project_id:null,title:`2026_요구안_${i+1}`,category:'기타',source:null,
    document_date:null,file_name:`2026_요구안_${i+1}.hwp`,tags:[],created_at:OLD,updated_at:OLD,field_origin:{},extraction_status:'ready',...(over[i+1]||{})}));
}
function baseState(docs,{aiMode='ok',attemptsMode='ok',tried=[]}={}){
  return {
    user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'자료실 관리자'}},
    workspace:{id:WS_ID,slug:'team',name:'웹2'},
    docs,aiMode,attemptsMode,tried:new Set(tried),aiCalls:[],texts:[],patches:[],otherWrites:[],held:[],
  };
}
const AI_TITLE=n=>`2026년 임금교섭 요구안 ${n}`;

async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:state.user});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/document-actions'){state.texts.push(body);const d=state.docs.find(x=>x.id===body?.document_id);if(d)d.extraction_status='ready';return ok({ok:true,status:'ready',reason:'ok'})}
    if(path==='/functions/v1/ai-assist'){
      // Other screens (home) call ai-assist for their own kinds; only the library tidy is counted here.
      if(body?.kind!=='library_fill'||body?.mode!=='tidy')return ok({ok:false,error:'unsupported_kind',message:'x'},400);
      state.aiCalls.push(body);
      if(state.aiMode==='hold'){state.held.push(route);return}
      if(state.aiMode==='limit')return ok({ok:false,error:'daily_limit',message:'x'},429);
      if(state.aiMode==='missing')return route.fulfill({status:404,contentType:'application/json',body:'{}'});
      let updated=0;
      for(const id of body.document_ids){
        const doc=state.docs.find(d=>d.id===id);if(!doc||state.tried.has(id))continue;
        state.tried.add(id);
        const n=Number(id.slice(-12));let changed=false;
        const want={title:AI_TITLE(n),category:'교섭',source:'공공운수노조',document_date:'2026-10-20'};
        for(const [f,v] of Object.entries(want)){
          if(doc.field_origin[f]==='user')continue;
          if(f==='title'&&doc.title&&!doc.title.startsWith('2026_요구안'))continue;
          if(f==='category'&&doc.category&&doc.category!=='기타'&&CATS.includes(doc.category))continue;
          if((f==='source'||f==='document_date')&&doc[f])continue;
          doc[f]=v;doc.field_origin={...doc.field_origin,[f]:'ai'};changed=true;
        }
        if(changed){doc.updated_at=now();updated++}
      }
      return ok({ok:true,kind:'library_fill',mode:'tidy',updated,fields:updated*4,skipped:body.document_ids.length-updated});
    }
    if(path.startsWith('/functions/v1/')){if(method!=='GET'&&method!=='OPTIONS')state.otherWrites.push(path);return ok({})}
    if(path==='/rest/v1/app_library_tidy_attempts'){
      if(state.attemptsMode==='missing')return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'PGRST205'})});
      return ok([...state.tried].map(id=>({document_id:id})));
    }
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:WS_ID,user_id:state.user.id,role:'owner',workspace:state.workspace,created_at:now()}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'자료실 관리자',document_categories:CATS}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_meetings')return ok([]);
    if(path==='/rest/v1/app_documents'){
      if(method==='GET')return ok(url.searchParams.has('or')?state.docs.filter(x=>!['ready','error'].includes(x.extraction_status)):state.docs);
      state.patches.push({method,body});return ok([]);
    }
    if(path.startsWith('/rest/v1/')){if(method!=='GET')state.otherWrites.push(`${method} ${path}`);return ok([])}
    return ok({});
  });
}

async function boot(page,state,{width=390}={}){
  await page.setViewportSize({width,height:900});
  await mockApp(page,state);
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);await signInWithSession(page,'owner@example.org');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  // LIB-토글트리: 들어올 때 맨 위 단만 보이므로(결정 D13) 줄은 그려졌는지(attached)만 보고, 줄을 보는 시험처럼 [모두 펴기]로 연다.
  await expect(page.locator('[data-lu-document]').first()).toBeAttached();
  await expandLibraryTree(page);
  await expect(page.locator('[data-lu-document]').first()).toBeVisible();
}
// LIB-토글트리: 한 토글은 20개까지 그리고 나머지는 [N건 더]로 그린다(설계 5절). 모든 줄 수를 셀 때는 [N건 더]를 모두 누른다.
async function showAllRows(page){
  for(let more=page.locator('#documentList [data-lu-more]');await more.count();)await more.first().click();
}
async function leave(page){
  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'tidy-test'}));
  await expect(page.locator('#calendarView')).toBeVisible();
}
async function reopen(page){
  await page.evaluate(()=>window.KPTURouter.go('library',{source:'tidy-test'}));
  await expect(page.locator('#libraryView')).toBeVisible();
  await expect(page.locator('[data-lu-document]').first()).toBeAttached();
  await expandLibraryTree(page);
  await expect(page.locator('[data-lu-document]').first()).toBeVisible();
}
// No AI marker, progress or notice anywhere on the library (사용자 결정 ③).
async function expectQuiet(page){
  const text=await page.locator('#libraryView').innerText();
  expect(text).not.toMatch(/AI|자동 ?정리|정리 중|정리 제안|찾는 중|이어서 찾기|✨/);
  expect(await page.locator('#libraryTidy, #libraryTidyBtn, .lt-row, [data-ai], [data-field-origin]').count()).toBe(0);
}

for(const width of [390,1440]){
  test(`opening the library quietly tidies untidy old documents with no button or marker (${width})`,async({page})=>{
    const state=baseState(makeDocs(3,{3:{title:'정리된 제목',category:'정책',source:'국토교통부',document_date:'2026-01-02'}}));
    await boot(page,state,{width});
    // Document 3 is already tidy and is not sent; 1 and 2 go in one request with ids only.
    await expect.poll(()=>state.aiCalls.length).toBe(1);
    expect(state.aiCalls[0]).toEqual({kind:'library_fill',mode:'tidy',document_ids:[DOC_ID(1),DOC_ID(2)]});
    // Text is already stored for these documents: no document-text call.
    expect(state.texts).toEqual([]);
    // The list refreshes by itself; the screen never writes the documents itself.
    await expect(page.locator('.lu-row-title',{hasText:AI_TITLE(1)})).toHaveCount(1);
    expect(state.patches).toEqual([]);expect(state.otherWrites).toEqual([]);
    await expectQuiet(page);
    // The 자료 분류 수정 window no longer has the proposal list.
    await page.locator('#manageLibraryBtn').click();
    await expect(page.locator('#libraryManageModal')).toBeVisible();
    expect(await page.locator('#libraryManageModal').innerText()).not.toMatch(/정리 제안|이어서 찾기/);
  });
}

test('user fields and tried documents are not sent; reopening does not call AI for the same documents again',async({page})=>{
  const state=baseState(makeDocs(4,{2:{field_origin:{title:'user',category:'user',source:'user',document_date:'user'}},3:{classification_note:'사용자 수정'}}),{tried:[DOC_ID(4)]});
  await boot(page,state);
  await expect.poll(()=>state.aiCalls.length).toBe(1);
  expect(state.aiCalls[0].document_ids).toEqual([DOC_ID(1)]);
  await expect(page.locator('.lu-row-title',{hasText:AI_TITLE(1)})).toHaveCount(1);
  // Leave and come back: the same documents are not sent again.
  await leave(page);await reopen(page);
  await page.waitForTimeout(400);
  expect(state.aiCalls.length).toBe(1);
});

test('documents without stored text are read first (3 at a time), at most 3 requests of 10 per opening',async({page})=>{
  const docs=makeDocs(35).map((d,i)=>i<4?{...d,extraction_status:'pending'}:d);
  const state=baseState(docs);
  await boot(page,state);
  await expect.poll(()=>state.aiCalls.length).toBe(3);
  expect(state.aiCalls.map(c=>c.document_ids.length)).toEqual([10,10,10]);
  expect(state.texts.map(t=>t.document_id)).toEqual(docs.slice(0,4).map(d=>d.id));
  await page.waitForTimeout(300);
  expect(state.aiCalls.length).toBe(3);
});

test('the list shows without waiting for AI; leaving the library stops further requests',async({page})=>{
  const state=baseState(makeDocs(25),{aiMode:'hold'});
  await boot(page,state);
  await expect.poll(()=>state.aiCalls.length).toBe(1);
  // List is visible and usable while the AI answer is pending.
  await showAllRows(page);
  await expect(page.locator('[data-lu-document]')).toHaveCount(25);
  await expectQuiet(page);
  await leave(page);
  for(const r of state.held)await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,kind:'library_fill',mode:'tidy',updated:0,fields:0,skipped:10})});
  await page.waitForTimeout(400);
  expect(state.aiCalls.length).toBe(1);
});

test('browser storage is the same before and after a tidy run (the tidy record lives on the server only)',async({page})=>{
  const state=baseState(makeDocs(3),{aiMode:'hold'});
  await boot(page,state);
  await expect.poll(()=>state.aiCalls.length).toBe(1);
  const snapshot=async()=>JSON.stringify(await page.context().storageState());
  const before=await snapshot();
  // The server tidies documents 1–3, then the screen reloads the list.
  for(const d of state.docs){d.title=AI_TITLE(Number(d.id.slice(-12)));d.field_origin={title:'ai'};d.updated_at=now()}
  for(const r of state.held)await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,kind:'library_fill',mode:'tidy',updated:3,fields:3,skipped:0})});
  await expect(page.locator('.lu-row-title',{hasText:AI_TITLE(1)})).toHaveCount(1);
  expect(await snapshot()).toBe(before);
});

test('limit reached or server not ready: stops quietly, the library keeps working, no retry in this session',async({page})=>{
  {const state=baseState(makeDocs(25),{aiMode:'limit'});
   await boot(page,state);
   await expect.poll(()=>state.aiCalls.length).toBe(1);
   await expectQuiet(page);
   await leave(page);await reopen(page);
   await page.waitForTimeout(400);
   expect(state.aiCalls.length).toBe(1);
   await showAllRows(page);
   await expect(page.locator('[data-lu-document]')).toHaveCount(25);}
});

test('before the DB is applied (no attempts table) nothing is sent to AI',async({page})=>{
  const state=baseState(makeDocs(5),{attemptsMode:'missing'});
  await boot(page,state);
  await page.waitForTimeout(600);
  expect(state.aiCalls).toEqual([]);
  await expectQuiet(page);
});

// SEARCH-전체검색 ② 기존 자료 글자 채우기: 자료실을 열 때 아직 안 읽은 자료를 한 번에 5개씩만, 화면 표시 없이 읽는다.
test('opening the library reads at most 5 unread documents at a time, quietly, and not again for the same ones',async({page})=>{
  const docs=makeDocs(12,{}).map(d=>({...d,title:'정리된 제목 '+d.id,category:'정책',source:'국토교통부',document_date:'2026-01-02',extraction_status:'pending'}));
  const state=baseState(docs);
  await boot(page,state);
  await expect.poll(()=>state.texts.length).toBe(5);
  expect(state.texts.map(t=>t.document_id)).toEqual(docs.slice(0,5).map(d=>d.id));
  await page.waitForTimeout(300);
  expect(state.texts.length).toBe(5);
  await expectQuiet(page);
  await leave(page);await reopen(page);
  await expect.poll(()=>state.texts.length).toBe(10);
  await page.waitForTimeout(300);
  expect(state.texts.length).toBe(10);
  expect(state.otherWrites).toEqual([]);
});
