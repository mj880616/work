// S52-01 UI-사업영역조직고르기창: 할 일 수정·새 할 일의 '사업영역'·'조직' 두 줄 + 누르면 그 줄 아래 작은 고르기 창.
// 평소 두 줄만(없으면 '없음'), [+ 고르기] → 찾기·자주 쓴 것·큰 묶음만(꺾쇠로 펼침)·여러 개 → [넣기], 바깥·Esc·뒤로 키 = 취소,
// 고른 것은 '상위 › 하위' 꼬리표(✕로 빼기). 저장 값(create links·link·unlink)은 전과 같다. 폰은 같은 창이 아래에서(아래 탭 위).
import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { SHEET, chosenKeys, openPicker, offeredKeys, pressRow, toggleKeys, removeKey } from './helpers/area-org-picker.mjs';
import { OPERATOR_ORG_ORDER } from '../org-order-fixture.mjs';
const TEST_ORIGIN=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const LINKS='#gtEditLinkBody';
const kstDateKey=(offset=0)=>new Date(Date.now()+9*60*60*1000+offset*24*60*60*1000).toISOString().slice(0,10);
const gt=(id,extra={})=>({id,title:id,taskListId:'@default',taskListTitle:'내 할 일',due:`${kstDateKey(0)}T00:00:00.000Z`,status:'needsAction',source:'google-task',...extra});

async function setup(page,{saved=new Map(),used=[]}={}){
  const calls=[];
  await page.route(`${SB}/**`,async route=>{
    const u=new URL(route.request().url()),p=u.pathname;
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    if(p==='/auth/v1/token')return ok({access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user:{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}}});
    if(p==='/auth/v1/user')return ok({id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}});
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'qa-ws',user_id:'qa-user',role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok([{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:'qa-user',display_name:'QA',view_prefs:{org_order:OPERATOR_ORG_ORDER}}]);
    if(p==='/rest/v1/app_spaces')return ok([
      {id:'p1',workspace_id:'qa-ws',owner_id:'qa-user',name:'철도지하철',parent_id:null,status:'active',sort_order:1,metadata:{project_system:'v2'}},
      {id:'p2',workspace_id:'qa-ws',owner_id:'qa-user',name:'민자철도 사업',parent_id:'p1',status:'active',sort_order:2,metadata:{project_system:'v2'}},
      {id:'p3',workspace_id:'qa-ws',owner_id:'qa-user',name:'궤도 공동투쟁',parent_id:'p1',status:'active',sort_order:3,metadata:{project_system:'v2'}},
      {id:'p4',workspace_id:'qa-ws',owner_id:'qa-user',name:'정책연구',parent_id:null,status:'active',sort_order:4,metadata:{project_system:'v2'}},
      {id:'p9',workspace_id:'qa-ws',owner_id:'qa-user',name:'지난 캠페인',parent_id:null,status:'archived',sort_order:9,metadata:{project_system:'v2'}}
    ]);
    if(p==='/rest/v1/app_suborganization_assignees')return ok([{organization_id:'o1'},{organization_id:'o2'},{organization_id:'o3'}]);
    if(p==='/rest/v1/app_suborganizations')return ok([{id:'o1',name:'서울교통공사노동조합'},{id:'o2',name:'전국철도노동조합'},{id:'o3',name:'서해선지부'},{id:'o0',name:'담당 아닌 조직'}]);
    if(p==='/rest/v1/app_record_links'){calls.push({action:'used',query:u.search});return ok(used)}
    if(p==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,calendars:[],events:[]});
    if(p==='/functions/v1/google-tasks'){
      const req=route.request(),action=u.searchParams.get('action'),body=req.method()==='GET'?{}:JSON.parse(req.postData()||'{}');calls.push({action,body});
      if(action==='overview')return ok({connected:true,authorized:true,needs_reconnect:false,pending_scope:'all',tasks:[gt('g1')]});
      if(action==='links')return ok({links:saved.get(u.searchParams.get('task_id'))||[],meeting_links:[]});
      if(action==='create')return ok({ok:true,task:gt('new1',{title:body.title}),links:body.links.map(x=>({...x,status:'confirmed'})),meeting_links:[]});
      if(action==='link')saved.set(body.task_id,[...(saved.get(body.task_id)||[]),...body.links.map(x=>({...x,status:'confirmed'}))]);
      if(action==='unlink')saved.set(body.task_id,(saved.get(body.task_id)||[]).filter(x=>!body.links.some(y=>x.project_id&&x.project_id===y.project_id||x.organization_id&&x.organization_id===y.organization_id)));
      return ok({ok:true,task:gt(body.task_id||'g1',{title:body.title}),links:saved.get(body.task_id)||[],meeting_links:[]});
    }
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
  await page.goto(loginEntry(`${TEST_ORIGIN}/app/?view=calendar`));
  await signInWithSession(page,'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await page.waitForFunction(()=>window.KPTUGoogleTasks?.openEditor);
  return calls;
}
const closedSettled=async page=>{await expect(page.locator('#gtTaskModal')).toBeHidden();await page.waitForFunction(()=>history.state?.kptuOverlay!=='gtTaskModal')};

test('폰: 두 줄만 → [+ 선택] 아래 창(찾기·자주 쓴 것·큰 묶음만·꺾쇠 펼침·여러 개) → [넣기] 꼬리표 → 새 할 일 저장 값 그대로',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const calls=await setup(page,{used:[{project_id:'p2'},{organization_id:'o3'},{project_id:'p2'},{project_id:'p4'},{project_id:'p9'},{organization_id:'o0'}]});
  await page.evaluate(()=>window.KPTUGoogleTasks.openEditor());
  const lines=page.locator(`${LINKS} .aop-row`);
  await expect(lines).toHaveCount(2);
  await expect(lines.locator('.aop-label')).toHaveText(['사업영역','조직']);
  await expect(lines.locator('[data-aop-none]')).toHaveText(['없음','없음']);
  await expect(page.locator(`${LINKS} [data-aop-add]`)).toHaveText(['+ 선택','+ 선택']);
  // 두 줄은 칸을 거의 차지하지 않는다(예전 체크 목록은 펼쳐져 칸을 다 차지).
  expect((await page.locator(LINKS).boundingBox()).height).toBeLessThan(100);
  await openPicker(page,LINKS,'area');
  const sheet=page.locator(SHEET);
  // 폰: 아래에서 올라오는 창, 찾기 칸 있음, 아래 탭에 가리지 않음.
  await expect(sheet).not.toHaveClass(/home-choice-anchored/);
  await expect(sheet.locator('[data-sheet-search]')).toBeVisible();
  await sheet.evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
  const sb=await sheet.boundingBox();expect(sb.y).toBeGreaterThan(200);
  if(await page.locator('.mobile-tabs').isVisible())expect(Math.round(sb.y+sb.height)).toBeLessThanOrEqual(Math.round((await page.locator('.mobile-tabs').boundingBox()).y));
  else expect(Math.round(sb.y+sb.height)).toBeLessThanOrEqual(844);
  // 자주 쓴 것: 저장된 연결에서 많이 쓴 순(보관·안 보이는 대상 제외).
  await expect(sheet.locator('.aop-recent [data-sheet-value]')).toHaveText(['민자철도 사업','정책연구']);
  // 큰 묶음만: 하위는 접혀 있다. 보관된 사업영역은 없다.
  expect(await offeredKeys(page)).toEqual(['p:p1','p:p2','p:p3','p:p4']);
  await expect(sheet.locator('.aop-list [data-sheet-value]:visible')).toHaveCount(2);
  await sheet.locator('.aop-list [data-aop-toggle]').first().click();
  await expect(sheet.locator('.aop-list [data-sheet-value]:visible')).toHaveCount(4);
  await sheet.locator('.aop-list [data-sheet-value="p:p2"]').click();
  await sheet.locator('.aop-list [data-sheet-value="p:p4"]').click();
  await expect(sheet.locator('.aop-recent [data-sheet-value="p:p2"]')).toHaveAttribute('aria-pressed','true');
  await expect(sheet.locator('[data-sheet-save]')).toHaveText('넣기');
  await sheet.locator('[data-sheet-save]').click();
  await expect(sheet).toBeHidden();
  await expect(page.locator(`${LINKS} [data-aop-line="area"] .aop-chip-text`)).toHaveText(['철도지하철 › 민자철도 사업','정책연구']);
  await expect(page.locator(`${LINKS} [data-aop-add="area"]`)).toHaveText('+');
  // 조직: 묶음(철도·지하철·민자철도)만 보이고 누르면 그 묶음 조직이 펼쳐진다.
  await openPicker(page,LINKS,'org');
  await expect(sheet.locator('.aop-group-name')).toHaveCount(3);
  await expect(sheet.locator('.aop-list [data-sheet-value]:visible')).toHaveCount(0);
  await pressRow(page,'o:o3');
  await sheet.locator('[data-sheet-save]').click();
  expect(await chosenKeys(page,LINKS)).toEqual(['p:p2','p:p4','o:o3']);
  await page.locator('#gtEditTitle').fill('새 할 일');
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>calls.find(x=>x.action==='create')?.body?.links).toEqual([{project_id:'p2'},{project_id:'p4'},{organization_id:'o3'}]);
});

test('PC: 그 줄 바로 아래 작은 창, 찾기가 접힌 하위도 찾음, 바깥·Esc·뒤로 키 = 취소, ✕로 빼기 = unlink',async({page})=>{
  await page.setViewportSize({width:1280,height:800});
  const saved=new Map([['g1',[{project_id:'p2',status:'confirmed'},{project_id:'p9',status:'confirmed'},{organization_id:'o1',status:'confirmed'}]]]);
  const calls=await setup(page,{saved});
  await page.evaluate(()=>window.KPTUGoogleTasks.openEditor({id:'g1',title:'g1',taskListId:'@default',taskListTitle:'내 할 일',status:'needsAction',source:'google-task'}));
  await expect(page.locator(`${LINKS} [data-aop-line="area"] .aop-chip-text`)).toHaveText(['철도지하철 › 민자철도 사업']);
  await expect(page.locator(`${LINKS} [data-aop-line="org"] .aop-chip-text`)).toHaveText(['서울교통공사노동조합']);
  const line=await page.locator(`${LINKS} [data-aop-line="area"]`).boundingBox();
  await openPicker(page,LINKS,'area');
  const sheet=page.locator(SHEET);
  await expect(sheet).toHaveClass(/home-choice-anchored/);
  // 그 줄 바로 아래(아래 자리가 모자라면 바로 위) — 줄에 붙어 뜬다.
  const box=await sheet.boundingBox();
  expect(Math.min(Math.abs(box.y-(line.y+line.height)),Math.abs(box.y+box.height-line.y))).toBeLessThan(12);
  expect(box.width).toBeLessThanOrEqual(400);
  // 고른 것이 든 묶음은 처음부터 펼쳐져 있다.
  await expect(sheet.locator('.aop-list [data-sheet-value="p:p2"]')).toBeVisible();
  await expect(sheet.locator('.aop-list [data-sheet-value="p:p2"]')).toHaveAttribute('aria-pressed','true');
  // 찾기: 접힌 하위도 찾고 꺾쇠는 감춘다.
  await sheet.locator('.aop-node.is-open > .aop-line [data-aop-toggle]').click();
  await sheet.locator('[data-sheet-search]').fill('궤도');
  await expect(sheet.locator('.aop-list [data-sheet-value]:visible')).toHaveText(['궤도 공동투쟁철도지하철']);
  await expect(sheet.locator('[data-aop-toggle]:visible')).toHaveCount(0);
  await sheet.locator('.aop-list [data-sheet-value="p:p3"]').click();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  expect(await chosenKeys(page,LINKS)).toEqual(['p:p2','o:o1']);
  // 바깥 누르기도 취소.
  await openPicker(page,LINKS,'area');await pressRow(page,'p:p4');
  await page.mouse.click(5,790);
  await expect(sheet).toBeHidden();
  expect(await chosenKeys(page,LINKS)).toEqual(['p:p2','o:o1']);
  // 뒤로 키도 취소(창만 닫히고 할 일 창은 그대로).
  await openPicker(page,LINKS,'org');await pressRow(page,'o:o2');
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  expect(await chosenKeys(page,LINKS)).toEqual(['p:p2','o:o1']);
  // ✕로 빼고, 다른 것을 넣고 저장: 보관된 사업영역 연결(p9)은 건드리지 않는다.
  await removeKey(page,LINKS,'p:p2');
  await expect(page.locator(`${LINKS} [data-aop-line="area"] [data-aop-none]`)).toHaveText('없음');
  await toggleKeys(page,LINKS,'org',['o:o2']);
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>calls.find(x=>x.action==='unlink')?.body?.links).toEqual([{project_id:'p2'}]);
  expect(calls.find(x=>x.action==='link')?.body?.links).toEqual([{organization_id:'o2'}]);
  expect(JSON.stringify(calls.filter(x=>x.action==='link'||x.action==='unlink'))).not.toContain('p9');
  await closedSettled(page);
});
