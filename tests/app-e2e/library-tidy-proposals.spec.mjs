// LIB-정리제안화면: the 자료 분류 수정 window lists tidy proposals from ai-assist (mode propose) — view only.
// No apply button, no checkbox, and not a single save request (app_documents PATCH 0). ai-assist is a mock; no real Supabase/Drive/OpenAI.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();
const DOC_ID=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const CATS=['교섭','투쟁','교육','선전','정책','회의','기타'];

function makeDocs(count){
  return Array.from({length:count},(_,i)=>({id:DOC_ID(i+1),workspace_id:'workspace-1',project_id:null,title:`2026 임단협 요구안 ${i+1}`,category:'기타',source:'출처',
    document_date:'2026-09-01',file_name:`2026_임단협_요구안_${i+1}.hwp`,tags:[],created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z',field_origin:{}}));
}

// proposals: doc number -> list of {field,from,to}. limitAfter: ai-assist answers daily_limit from this call number on.
function baseState(count,{proposals={},limitAfter=0,mode='ok'}={}){
  return {
    user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'자료실 관리자'}},
    workspace:{id:'workspace-1',slug:'team',name:'웹2'},
    docs:makeDocs(count),proposals,limitAfter,mode,aiCalls:[],texts:[],patches:[],otherWrites:[],
  };
}

async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:state.user});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/document-actions'){state.texts.push(body);return ok({ok:true,status:'ready',reason:'ok'})}
    if(path==='/functions/v1/ai-assist'){
      state.aiCalls.push(body);
      if(state.mode==='missing')return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'not_found'})});
      if(state.mode==='fail')return ok({ok:false,error:'ai_busy',message:'x'},503);
      if(state.limitAfter&&state.aiCalls.length>state.limitAfter)return ok({ok:false,error:'daily_limit',message:'x'},429);
      const out=[];
      for(const id of body.document_ids){const n=Number(id.slice(-12));for(const p of state.proposals[n]||[])out.push({document_id:id,...p})}
      return ok({ok:true,kind:'library_fill',mode:'propose',proposals:out});
    }
    if(path.startsWith('/functions/v1/')){if(method!=='GET'&&method!=='OPTIONS')state.otherWrites.push(path);return ok({})}
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'workspace-1',user_id:state.user.id,role:'owner',workspace:state.workspace,created_at:now()}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'자료실 관리자',document_categories:CATS}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_meetings')return ok([]);
    if(path==='/rest/v1/app_documents'){
      if(method==='GET')return ok(state.docs);
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
  await expect(page.locator('[data-lu-document]').first()).toBeVisible();
  await page.locator('#manageLibraryBtn').click();
  await expect(page.locator('#libraryManageModal')).toBeVisible();
}
async function expectNoOverflow(page){
  const o=await page.evaluate(()=>{
    const card=document.querySelector('#libraryManageModal .modal-card'),doc=document.documentElement;
    const r=card.getBoundingClientRect();
    const wide=[...card.querySelectorAll('#libraryTidy *')].filter(el=>el.getBoundingClientRect().right>r.right+1).length;
    return {card:card.scrollWidth-card.clientWidth,page:doc.scrollWidth-doc.clientWidth,wide,right:r.right,vw:window.innerWidth,bottom:r.bottom,vh:window.innerHeight};
  });
  expect(o.card).toBeLessThanOrEqual(1);expect(o.page).toBeLessThanOrEqual(1);expect(o.wide).toBe(0);
  expect(o.right).toBeLessThanOrEqual(o.vw+1);
  // the window stays inside the screen (scrolls itself), so the bottom bar never hides its end
  expect(o.bottom).toBeLessThanOrEqual(o.vh+1);
}

const PROPOSALS={
  1:[{field:'title',from:'2026 임단협 요구안 1',to:'2026년 임단협 요구안'},{field:'document_date',from:null,to:'2026-03-14'}],
  2:[{field:'category',from:'기타',to:'회의'}],
};

for(const width of [390,1440]){
  test(`proposal list: row always visible, fields fold open, display texts, view only (${width})`,async({page})=>{
    const state=baseState(3,{proposals:PROPOSALS});
    await boot(page,state,{width});
    const btn=page.locator('#libraryTidyBtn');
    await expect(btn).toHaveText('정리 제안 찾기');
    await expect(page.locator('#libraryTidyStatus')).toHaveText('자료 3개');
    await btn.click();
    await expect(page.locator('#libraryTidyStatus')).toHaveText('자료 3개 중 3곳 제안');
    await expect(page.locator('.lt-row')).toHaveCount(2);
    const first=page.locator('.lt-row').first();
    await expect(first.locator('summary')).toContainText('2026_임단협_요구안_1.hwp');
    await expect(first.locator('summary')).toContainText('제안 2');
    // folded by default: field lines hidden, opening shows from -> to
    await expect(first.locator('.lt-item').first()).toBeHidden();
    await first.locator('summary').click();
    const items=first.locator('.lt-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveText(/제목\s*\(파일 이름 그대로\)\s*→\s*2026년 임단협 요구안/);
    await expect(items.nth(1)).toHaveText(/날짜\s*\(빈 칸\)\s*→\s*2026\.03\.14/);
    await expectNoOverflow(page);
    await first.locator('summary').click();
    await expect(items.first()).toBeHidden();
    await page.locator('.lt-row').nth(1).locator('summary').click();
    await expect(page.locator('.lt-row').nth(1).locator('.lt-item')).toHaveText(/분류\s*기타\s*→\s*회의/);
    // done: no more button, no apply / checkbox anywhere in the window
    await expect(btn).toBeHidden();
    await expect(page.locator('#libraryTidy input, #libraryTidy [type=checkbox]')).toHaveCount(0);
    expect(await page.locator('#libraryTidy').innerText()).not.toMatch(/적용|저장|AI/);
    // the request was a propose with only ids; nothing was saved
    expect(state.aiCalls).toEqual([{kind:'library_fill',mode:'propose',document_ids:[DOC_ID(1),DOC_ID(2),DOC_ID(3)]}]);
    expect(state.patches).toEqual([]);expect(state.otherWrites).toEqual([]);
  });
}

test('a proposed value is drawn as plain text (escaped), never as markup',async({page})=>{
  const state=baseState(1,{proposals:{1:[{field:'title',from:'<b>x</b>',to:'<img src=x onerror="window.__tidyXss=1"><script>window.__tidyXss=2</script>'},{field:'source',from:null,to:'"><svg onload=window.__tidyXss=3>'}]}});
  await boot(page,state);
  await page.locator('#libraryTidyBtn').click();
  await page.locator('.lt-row summary').first().click();
  await expect(page.locator('.lt-to').first()).toContainText('<img src=x onerror=');
  expect(await page.locator('#libraryTidyList img, #libraryTidyList script, #libraryTidyList svg').count()).toBe(0);
  expect(await page.evaluate(()=>window.__tidyXss)).toBeUndefined();
  expect(state.patches).toEqual([]);
});

test('progress line, daily limit stops with what was received, then 이어서 찾기 continues only the rest',async({page})=>{
  const props={};for(let n=1;n<=25;n++)props[n]=[{field:'source',from:null,to:`출처 ${n}`}];
  const state=baseState(25,{proposals:props,limitAfter:2});
  await boot(page,state);
  await page.locator('#libraryTidyBtn').click();
  // batches of 10: two answered, the third is refused by the daily limit
  await expect(page.locator('#libraryTidyStatus')).toContainText('자료 25개 중 20개 확인 · 20곳 제안');
  await expect(page.locator('#libraryTidyStatus')).toContainText('오늘 쓸 수 있는 횟수를 다 썼어요');
  await expect(page.locator('.lt-row')).toHaveCount(20);
  await expectNoOverflow(page);
  expect(state.aiCalls.map(b=>b.document_ids.length)).toEqual([10,10,5]);
  const btn=page.locator('#libraryTidyBtn');
  await expect(btn).toHaveText('이어서 찾기');
  // the limit is lifted (a new day): continue sends only the 5 not yet seen and keeps the 20 already shown
  state.limitAfter=0;
  await btn.click();
  await expect(page.locator('#libraryTidyStatus')).toHaveText('자료 25개 중 25곳 제안');
  await expect(page.locator('.lt-row')).toHaveCount(25);
  expect(state.aiCalls.at(-1).document_ids).toEqual(Array.from({length:5},(_,i)=>DOC_ID(21+i)));
  await expect(btn).toBeHidden();
  expect(state.patches).toEqual([]);expect(state.otherWrites).toEqual([]);
});

test('progress is shown as 찾는 중 n/전체 while searching',async({page})=>{
  const props={};for(let n=1;n<=12;n++)props[n]=[{field:'source',from:null,to:'x'}];
  const state=baseState(12,{proposals:props});
  await boot(page,state);
  let release;const gate=new Promise(r=>{release=r});
  let held=0;
  await page.route(`${SB}/functions/v1/ai-assist`,async route=>{
    held++;
    if(held===2)await gate;
    await route.fallback();
  });
  await page.locator('#libraryTidyBtn').click();
  await expect(page.locator('#libraryTidyStatus')).toHaveText('찾는 중 10/12');
  await expect(page.locator('#libraryTidyBtn')).toBeHidden();
  release();
  await expect(page.locator('#libraryTidyStatus')).toHaveText('자료 12개 중 12곳 제안');
});

test('failure shows one line, keeps nothing wrong, and not-deployed ends quietly with no retry button',async({page})=>{
  const state=baseState(3,{proposals:PROPOSALS,mode:'fail'});
  await boot(page,state);
  await page.locator('#libraryTidyBtn').click();
  await expect(page.locator('#libraryTidyStatus')).toContainText('지금 많이 바빠요');
  await expect(page.locator('#libraryTidyBtn')).toHaveText('이어서 찾기');
  await expect(page.locator('.lt-row')).toHaveCount(0);
  // service recovers: results arrive, then a later failure keeps what was received
  state.mode='ok';
  await page.locator('#libraryTidyBtn').click();
  await expect(page.locator('#libraryTidyStatus')).toHaveText('자료 3개 중 3곳 제안');
  // a fresh window against a server that does not know the function yet
  const second=baseState(3,{proposals:PROPOSALS,mode:'missing'});
  await page.unroute(`${SB}/**`);await mockApp(page,second);
  await page.locator('#libraryManageClose').click();
  await page.locator('#manageLibraryBtn').click();
  await page.locator('#libraryTidyBtn').click();
  await expect(page.locator('#libraryTidyStatus')).toContainText('아직 쓸 수 없어요');
  await expect(page.locator('#libraryTidyBtn')).toBeHidden();
  expect(second.patches).toEqual([]);
});

test('no browser storage is written by the tidy flow and the results vanish when the window is reopened',async({page})=>{
  const state=baseState(3,{proposals:PROPOSALS});
  await boot(page,state);
  const before=await page.evaluate(()=>JSON.stringify({l:{...localStorage},s:{...sessionStorage}}));
  await page.locator('#libraryTidyBtn').click();
  await expect(page.locator('.lt-row')).toHaveCount(2);
  const after=await page.evaluate(()=>JSON.stringify({l:{...localStorage},s:{...sessionStorage}}));
  expect(after).toBe(before);
  await page.locator('#libraryManageClose').click();
  await page.locator('#manageLibraryBtn').click();
  await expect(page.locator('.lt-row')).toHaveCount(0);
  await expect(page.locator('#libraryTidyBtn')).toHaveText('정리 제안 찾기');
});
