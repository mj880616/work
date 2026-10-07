import { test, expect } from '@playwright/test';

// Existing month-view regressions choose month explicitly.
test.beforeEach(async({page})=>{await page.addInitScript(()=>{try{localStorage.setItem('kptu-calendar-view','month')}catch{}})});
import { loginEntry } from './helpers/login-entry.mjs';

const ORIGIN=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const NOW='2026-10-15T03:00:00.000Z';
const gate=()=>{let release;const wait=new Promise(r=>{release=r});return {wait,release}};
test.use({timezoneId:'Asia/Seoul'});

// Exercise the real editor, renderer, history and toggle path; only remote APIs are synthetic.
async function fixture(page,{width=390,onToggle}={}){
  await page.setViewportSize({width,height:844});
  await page.clock.setFixedTime(new Date(NOW));
  const make=(id,date)=>({id,title:'QA task',notes:'QA note',due:date+'T00:00:00.000Z',status:'needsAction',completed:null,taskListId:'@default',taskListTitle:'QA',source:'google-task'});
  const tasks=[make('cell','2026-10-20'),make('overflow','2026-10-21'),...Array.from({length:18},(_,i)=>make('dense-'+i,'2026-10-21'))];
  const calls=[],external=[];
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),p=url.pathname;
    if(url.origin===ORIGIN)return route.continue();
    if(url.hostname!=='xmlkxfjeagycwttklxjw.supabase.co'){external.push(url.origin);return route.abort()}
    const ok=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    const user={id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}};
    if(p==='/auth/v1/token')return ok({access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user});
    if(p==='/auth/v1/user')return ok(user);
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'qa-ws',user_id:'qa-user',role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok([{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:'qa-user',display_name:'QA'}]);
    if(p==='/rest/v1/app_spaces')return ok([{id:'qa-project',workspace_id:'qa-ws',name:'QA project',status:'active',metadata:{project_system:'v2'},owner_id:'qa-user',visibility:'private'}]);
    if(p==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,calendars:[],events:[]});
    if(p==='/functions/v1/google-tasks'){
      const action=url.searchParams.get('action'),body=req.postDataJSON();calls.push({action,body});
      if(action==='links')return ok({links:[{project_id:'qa-project'}],meeting_links:[]});
      if(action==='toggle'){
        if(onToggle)await onToggle();
        if(onToggle?.fail)return ok({error:'QA save failure'},500);
        const i=tasks.findIndex(t=>t.id===body.task_id);
        tasks[i]={...tasks[i],status:body.completed?'completed':'needsAction',completed:body.completed?NOW:null};
        return ok({ok:true,task:tasks[i]});
      }
      return ok({connected:true,authorized:true,needs_reconnect:false,tasks,pending_scope:'all'});
    }
    return ok([]);
  });
  await page.goto(loginEntry(ORIGIN+'/app/?view=calendar'));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('qa@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(chip(page,'cell')).toBeVisible();
  return {calls,external};
}
const chip=(page,id,root='#calendarGrid')=>page.locator(`${root} [data-calendar-task="${id}"]`);
const toggles=calls=>calls.filter(c=>c.action==='toggle');
async function open(page,path){
  const id=path==='list'?'overflow':'cell';
  if(path==='list'){
    await page.getByRole('button',{name:/10월 21일 일정 \d+개 더 보기/}).click();
    await expect(page.locator('#calendarDayModal')).toBeVisible();
    await chip(page,id,'#calendarDayList').click();
    await expect(page.locator('#calendarDayModal')).toBeHidden();
  }else await chip(page,id).click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtEditLinkBody [data-gt-link]')).toHaveCount(1);
  await expect(page.locator('#gtToggleBtn')).toBeEnabled();
  return id;
}

for(const [path,width] of [['cell',1280],['cell',390],['list',390]]){
  test(`editor toggles both ways and refreshes calendar and task view (${path}, ${width}px)`,async({page})=>{
    const {calls,external}=await fixture(page,{width});
    const id=await open(page,path),button=page.locator('#gtToggleBtn');
    await expect(button).toHaveText('완료');
    const boxes=await page.locator('.gt-modal-actions button:not(.hidden)').evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}}));
    expect(boxes).toHaveLength(3);
    expect(Math.max(...boxes.map(b=>b.top))).toBeLessThan(Math.min(...boxes.map(b=>b.bottom)));
    expect(boxes.every(b=>b.left>=0&&b.right<=width)).toBe(true);
    await button.click();
    await expect(page.locator('#gtTaskModal')).toBeHidden();
    await expect(chip(page,id)).toHaveClass(/cmv-task-done/);
    if(width<=760)await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBeUndefined();
    await open(page,path);
    await expect(button).toHaveText('완료 취소');
    await button.click();
    await expect(page.locator('#gtTaskModal')).toBeHidden();
    await expect(chip(page,id)).not.toHaveClass(/cmv-task-done/);
    expect(toggles(calls).map(c=>c.body)).toEqual([
      {action:'toggle',task_id:id,task_list_id:'@default',task_list_title:'QA',completed:true},
      {action:'toggle',task_id:id,task_list_id:'@default',task_list_title:'QA',completed:false}
    ]);
    expect(calls.some(c=>['update','create','link','unlink'].includes(c.action))).toBe(false);
    await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
    await expect(page.locator(`#gtTaskBody [data-google-task="${id}"]`)).toHaveClass(/pending/);
    await page.locator(`[data-gt-edit="${id}"]`).click();
    await expect(button).toHaveText('완료');
    await button.click();
    await expect(page.locator('#gtTaskModal')).toBeHidden();
    await expect(page.locator(`#gtTaskBody [data-google-task="${id}"]`)).toHaveClass(/completed/);
    await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'qa'}));
    await expect(chip(page,id)).toHaveClass(/cmv-task-done/);
    expect(external).toEqual([]);
  });
}

for(const field of ['title','due','notes','links']){
  test(`unsaved ${field} blocks toggling without discarding or saving`,async({page})=>{
    const {calls}=await fixture(page);
    await open(page,'cell');
    const sel={title:'#gtEditTitle',due:'#gtEditDue',notes:'#gtEditNotes',links:'#gtEditLinkBody [data-gt-link]'}[field];
    const input=page.locator(sel),value={title:'QA changed',due:'2026-10-22',notes:'QA changed note'}[field];
    if(field==='links')await input.uncheck();else await input.fill(value);
    await page.locator('#gtToggleBtn').click();
    await expect(page.locator('#gtEditStatus')).toContainText('먼저 저장');
    await expect(page.locator('#gtTaskModal')).toBeVisible();
    if(field==='links')await expect(input).not.toBeChecked();else await expect(input).toHaveValue(value);
    await expect(chip(page,'cell')).not.toHaveClass(/cmv-task-done/);
    expect(calls.filter(c=>['toggle','update','create','link','unlink'].includes(c.action))).toEqual([]);
    // Restoring the original draft allows toggling again.
    if(field==='links')await input.check();else await input.fill({title:'QA task',due:'2026-10-20',notes:'QA note'}[field]);
    await page.locator('#gtToggleBtn').click();
    await expect(page.locator('#gtTaskModal')).toBeHidden();
    expect(toggles(calls)).toHaveLength(1);
  });
}

test('rapid double click sends one request and locks draft/actions until settled',async({page})=>{
  const hold=gate(),{calls}=await fixture(page,{onToggle:()=>hold.wait});
  await open(page,'list');
  await page.locator('#gtToggleBtn').evaluate(b=>{b.click();b.click()});
  await expect.poll(()=>toggles(calls).length).toBe(1);
  await expect(page.locator('#gtToggleBtn')).toBeDisabled();
  await expect(page.locator('#gtSaveBtn')).toBeDisabled();
  await expect(page.locator('#gtDeleteBtn')).toBeDisabled();
  await expect(page.locator('#gtEditTitle')).toBeDisabled();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  hold.release();
  await expect(page.locator('#gtTaskModal')).toBeHidden();
  await expect(chip(page,'overflow')).toHaveClass(/cmv-task-done/);
  expect(toggles(calls)).toHaveLength(1);
});

for(const completed of [false,true]){
  test(`failed toggle restores state, keeps editor and allows retry (completed=${completed})`,async({page})=>{
    const response=async()=>{};response.fail=false;
    const {calls}=await fixture(page,{onToggle:response});
    if(completed){await open(page,'cell');await page.locator('#gtToggleBtn').click();await expect(page.locator('#gtTaskModal')).toBeHidden();await expect(chip(page,'cell')).toHaveClass(/cmv-task-done/)}
    response.fail=true;
    await open(page,'cell');
    await page.locator('#gtToggleBtn').click();
    await expect(page.locator('#gtEditStatus')).toContainText('저장하지 못해 되돌렸습니다');
    await expect(page.locator('#gtTaskModal')).toBeVisible();
    await expect(page.locator('#gtToggleBtn')).toBeEnabled();
    await expect(page.locator('#gtToggleBtn')).toHaveText(completed?'완료 취소':'완료');
    if(completed)await expect(chip(page,'cell')).toHaveClass(/cmv-task-done/);else await expect(chip(page,'cell')).not.toHaveClass(/cmv-task-done/);
    await expect(page.locator('#gtEditTitle')).toHaveValue('QA task');
    response.fail=false;
    await page.locator('#gtToggleBtn').click();
    await expect(page.locator('#gtTaskModal')).toBeHidden();
    if(completed)await expect(chip(page,'cell')).not.toHaveClass(/cmv-task-done/);else await expect(chip(page,'cell')).toHaveClass(/cmv-task-done/);
    expect(toggles(calls)).toHaveLength(completed?3:2);
  });
}

test('new task editor has no toggle button',async({page})=>{
  const {calls}=await fixture(page);
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(page.locator('#gtTaskBody [data-google-task="cell"]')).toBeVisible();
  await page.locator('#newTaskBtn').click();
  await expect(page.locator('#gtTaskHeading')).toHaveText('Google 할 일 추가');
  await expect(page.locator('#gtToggleBtn')).toBeHidden();
  await expect(page.locator('#gtDeleteBtn')).toBeHidden();
  expect(toggles(calls)).toHaveLength(0);
});

for(const completed of [false,true]){
  test(`editor tracks rollback of a toggle started in task view (completed=${completed})`,async({page})=>{
    const hold=gate(),response=async()=>{await hold.wait};response.fail=true;
    const {calls}=await fixture(page,{onToggle:response});
    if(completed){
      response.fail=false;hold.release();await open(page,'cell');await page.locator('#gtToggleBtn').click();await expect(page.locator('#gtTaskModal')).toBeHidden();
      await expect(chip(page,'cell')).toHaveClass(/cmv-task-done/);
      response.fail=true;
    }
    const pending=gate();response.waiting=pending;
    // Keep the existing toggle method real; delay only its API response.
    await page.route('**/functions/v1/google-tasks?action=toggle',async route=>{await pending.wait;await route.fallback()});
    await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
    const row=page.locator('#gtTaskBody [data-google-task="cell"]');
    if(completed)await page.locator('#gtCompleted summary').click();
    await expect(row).toBeVisible();
    await row.locator('[data-gt-toggle]').click();
    await row.locator('[data-gt-edit]').click();
    await expect(page.locator('#gtTaskModal')).toBeVisible();
    await expect(page.locator('#gtToggleBtn')).toHaveText(completed?'완료':'완료 취소');
    await page.locator('#gtEditNotes').fill('QA unsaved note');
    hold.release();pending.release();
    await expect(page.locator('#gtTaskSection [data-gt-sync]')).toContainText('저장하지 못해 되돌렸습니다');
    await expect(page.locator('#gtToggleBtn')).toHaveText(completed?'완료 취소':'완료');
    await expect(page.locator('#gtEditNotes')).toHaveValue('QA unsaved note');
    await page.locator('#gtEditNotes').fill('QA note');response.fail=false;
    await page.locator('#gtToggleBtn').click();
    await expect(page.locator('#gtTaskModal')).toBeHidden();
    expect(toggles(calls).at(-1).body.completed).toBe(!completed);
  });
}

test('delete request locks the new toggle button',async({page})=>{
  const {calls}=await fixture(page),hold=gate();
  await page.route('**/functions/v1/google-tasks?action=delete',async route=>{await hold.wait;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'QA delete failure'})})});
  await open(page,'cell');page.once('dialog',d=>d.accept());
  await page.locator('#gtDeleteBtn').click();
  await expect(page.locator('#gtToggleBtn')).toBeDisabled();
  hold.release();
  await expect(page.locator('#gtEditStatus')).toContainText('QA delete failure');
  await expect(page.locator('#gtToggleBtn')).toBeEnabled();
  expect(toggles(calls)).toHaveLength(0);
});
