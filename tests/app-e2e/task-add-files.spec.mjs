import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

// TASK-추가창파일: files can be chosen while a task is being added — in the task editor (Google 할 일 추가), the [할 일] screen's
// quick input (clip) and the 할 일 등록 window behind its [+]. Saving makes the task first, then each file goes up through the
// same google-tasks action=attach as ⋯ → 파일 붙이기. A failed upload keeps the task and says so (never silently).
// BIZ-저장먼저닫기 3차(S59-18): the window closes (the input frees) as soon as the task is saved; the files go up behind on the task's
// line, and the bottom line (#uploadDock) says how it went — a refused file stays there with [다시 올리기] (only that file, same task).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const APP_ORIGIN=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const NOW='2026-10-21T03:00:00.000Z';
const ok=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
const row=(page,title)=>page.locator('#gtTaskBody .gt-row',{hasText:title});
const txt=(name,body='abc')=>({name,mimeType:'text/plain',buffer:Buffer.from(body)});

async function openTasks(browser,{viewport={width:1280,height:900},supported=true,failAttach=()=>false}={}){
  const context=await browser.newContext({timezoneId:'Asia/Seoul',viewport,hasTouch:viewport.width<600,isMobile:viewport.width<600});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  const google={a:{id:'a',title:'기존 할 일',taskListId:'@default',taskListTitle:'내 할 일',due:'2026-10-21T00:00:00.000Z',status:'needsAction',completed:null,notes:'',source:'google-task'}};
  const state={files:[],calls:{creates:[],attach:[]},next:1};
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,action=u.searchParams.get('action');
    if(p==='/auth/v1/token')return ok(route,{access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user:{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}}});
    if(p==='/auth/v1/user')return ok(route,{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}});
    if(p==='/rest/v1/app_workspace_members')return ok(route,[{workspace_id:'qa-ws',user_id:'qa-user',role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok(route,[{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok(route,[{user_id:'qa-user',display_name:'QA'}]);
    if(p==='/functions/v1/google-calendar')return ok(route,{connected:false,enabled:false,calendars:[],events:[]});
    if(p==='/functions/v1/google-tasks'&&(action==='overview'||action==='tasks'))return ok(route,{connected:true,authorized:true,pending_scope:'all',tasks:Object.values(google).map(t=>({...t}))});
    if(p==='/functions/v1/google-tasks'&&action==='links')return ok(route,{links:[],meeting_links:[]});
    if(p==='/functions/v1/google-tasks'&&action==='create'){
      const b=JSON.parse(req.postData()||'{}');state.calls.creates.push(b);
      const id='new'+state.calls.creates.length;
      google[id]={id,title:b.title,taskListId:'@default',taskListTitle:'내 할 일',due:b.due?`${b.due}T00:00:00.000Z`:null,status:'needsAction',completed:null,notes:b.notes||'',source:'google-task'};
      return ok(route,{ok:true,task:{...google[id],due:b.due||null},links:(b.links||[]).map(l=>({...l,status:'confirmed'})),meeting_links:[]});
    }
    if(p==='/rest/v1/app_task_attachments'){
      if(!supported)return ok(route,{code:'PGRST205',message:'Could not find the table'},404);
      const ids=((u.searchParams.get('google_task_id')||'').match(/^in\.\((.*)\)$/)?.[1]||'').split(',');
      return ok(route,state.files.filter(f=>ids.includes(f.google_task_id)).map(({google_task_id,drive_file_id,file_name,size_bytes})=>({google_task_id,drive_file_id,file_name,size_bytes})));
    }
    if(p==='/functions/v1/google-tasks'&&action==='attach'){
      const body=req.postDataBuffer()?.toString('latin1')||'';
      const taskId=body.match(/name="task_id"\r\n\r\n([^\r]*)/)?.[1];
      const name=Buffer.from(body.match(/name="file"; filename="([^"]*)"/)?.[1]||'','latin1').toString('utf8');
      state.calls.attach.push({taskId,name});
      if(failAttach(name,state.calls.attach.filter(c=>c.name===name).length))return ok(route,{ok:false,code:'drive_failed',error:'Drive에 올리지 못했습니다.',message:'Drive에 올리지 못했습니다.'},502);
      const f={google_task_id:taskId,drive_file_id:'drv'+state.next++,file_name:name,size_bytes:3};
      state.files.push(f);
      return ok(route,{ok:true,file:f,files:state.files.filter(x=>x.google_task_id===taskId),task:{...google[taskId]},notes_synced:true});
    }
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok(route,[]);
    return ok(route,{});
  });
  await page.goto(loginEntry(`${APP_ORIGIN}/app/`));
  await signInWithSession(page,'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
  await expect.poll(()=>page.evaluate(()=>typeof window.KPTURouter?.go==='function'),{timeout:10000}).toBeTruthy();
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(row(page,'기존 할 일')).toBeVisible({timeout:10000});
  return {context,page,state,errors};
}
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1);
const quick=page=>page.locator('#tasksView .home-quick[data-home-quick]');
const dock=page=>page.locator('#uploadDock:not([hidden])');

for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
  test(`task editor (Google 할 일 추가): chosen files go up after the task is made and show under it ${viewport.width}`,async({browser})=>{
    const {context,page,state,errors}=await openTasks(browser,{viewport});
    await page.evaluate(()=>window.KPTUGoogleTasks.openEditor(null));
    const modal=page.locator('#gtTaskModal');
    await expect(page.locator('#gtTaskHeading')).toHaveText('Google 할 일 추가');
    const pick=modal.locator('#gtNewFiles');
    await expect(pick.locator('[data-gt-pick]')).toBeVisible();
    await expect(pick.locator('[data-gt-pick]')).toHaveText('파일 붙이기');
    await pick.locator('[data-gt-pick-input]').setInputFiles([txt('회의록.txt'),txt('사진.png')]);
    await expect(pick.locator('.gt-pick-name')).toHaveText(['회의록.txt','사진.png']);
    // × takes one back out before saving; nothing has been sent yet.
    await pick.getByRole('button',{name:'사진.png 선택 취소'}).click();
    await expect(pick.locator('.gt-pick-name')).toHaveText(['회의록.txt']);
    expect(state.calls.attach).toEqual([]);
    expect(await noSideScroll(page)).toBe(true);
    await page.locator('#gtEditTitle').fill('보고서 정리');
    await page.locator('#gtSaveBtn').click();
    await expect(modal).toBeHidden();
    expect(state.calls.creates.map(c=>c.title)).toEqual(['보고서 정리']);
    await expect.poll(()=>state.calls.attach).toEqual([{taskId:'new1',name:'회의록.txt'}]);
    await expect(dock(page)).toContainText('할 일에 파일 1개 올렸어요');
    const link=row(page,'보고서 정리').locator('.gt-files a.gt-file');
    await expect(link).toHaveText('회의록.txt');
    await expect(link).toHaveAttribute('href','https://drive.google.com/file/d/drv1/view');
    // Editing an existing task has no picker (that is ⋯ → 파일 붙이기).
    await page.evaluate(()=>{const t={id:'a',title:'기존 할 일',taskListId:'@default',status:'needsAction'};window.KPTUGoogleTasks.openEditor(t);});
    await expect(page.locator('#gtTaskHeading')).toHaveText('Google 할 일 수정');
    await expect(modal.locator('#gtNewFiles')).toBeHidden();
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`[할 일] quick input: clip → [추가] makes the task, then attaches; the name shows under it ${viewport.width}`,async({browser})=>{
    const {context,page,state,errors}=await openTasks(browser,{viewport});
    const q=quick(page),clip=q.locator('[data-basket-clip]');
    await expect(clip).toBeVisible();
    const cb=await clip.boundingBox();expect(Math.max(cb.width,cb.height)).toBeGreaterThanOrEqual(36);expect(cb.width).toBeGreaterThanOrEqual(44);
    // Phone: inside the input's left edge; PC: outside the input, just left of [추가].
    const ib=await q.locator('[data-quick-input]').boundingBox(),ab=await q.locator('[data-quick-save]').boundingBox();
    if(viewport.width<761){expect(cb.x).toBeGreaterThanOrEqual(ib.x-1);expect(cb.x+cb.width).toBeLessThan(ib.x+ib.width/2);}
    else{expect(cb.x).toBeGreaterThanOrEqual(ib.x+ib.width-1);expect(cb.x+cb.width).toBeLessThanOrEqual(ab.x+1);}
    await q.locator('input[type="file"]').setInputFiles([txt('안건.txt')]);
    await expect(q.locator('[data-basket-files] .library-selected-file b')).toHaveText(['안건.txt']);
    expect(await noSideScroll(page)).toBe(true);
    await q.locator('[data-quick-input]').fill('안건 보내기');
    await q.locator('[data-quick-save]').click();
    await expect(q.locator('[data-quick-input]')).toHaveValue('');
    expect(state.calls.creates.map(c=>c.title)).toEqual(['안건 보내기']);
    await expect.poll(()=>state.calls.attach).toEqual([{taskId:'new1',name:'안건.txt'}]);
    await expect(q.locator('[data-basket-files] .library-selected-file')).toHaveCount(0);
    await expect(row(page,'안건 보내기').locator('.gt-files a.gt-file')).toHaveText('안건.txt');
    // 알림은 하단바 위 한 줄 하나(위쪽 작은 알림 '할 일을 추가했습니다'와 겹치지 않음).
    await expect(dock(page)).toContainText('할 일에 파일 1개 올렸어요');
    await expect(page.locator('#toast')).not.toContainText('할 일을 추가했습니다');
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('upload failure in the 할 일 등록 window: the task stays, the window closes and the bottom line offers [다시 올리기] for that file only (phone)',async({browser})=>{
  const {context,page,state}=await openTasks(browser,{viewport:{width:390,height:844},failAttach:(name,tries)=>name==='큰 자료.txt'&&tries===1});
  const q=quick(page);
  await q.locator('[data-quick-input]').fill('자료 정리');
  await q.locator('[data-quick-detail]').click();
  const modal=page.locator('#eventModal');
  await expect(page.locator('#eventModalTitle')).toHaveText('할 일 등록');
  const pick=modal.locator('#eventTaskFiles');
  await expect(pick.locator('[data-gt-pick]')).toBeVisible();
  // The file row is laid out as the window opens (the answer is already known), so the fields above it do not jump afterwards
  // (on a phone the window sits on the bottom edge; a late row would push [프로젝트] up under a finger).
  const projectTop=()=>page.locator('#eventTaskProject').evaluate(el=>Math.round(el.getBoundingClientRect().top));
  const top=await projectTop();await page.waitForTimeout(300);expect(await projectTop()).toBe(top);
  await pick.locator('[data-gt-pick-input]').setInputFiles([txt('목차.txt'),txt('큰 자료.txt')]);
  await expect(pick.locator('.gt-pick-name')).toHaveText(['목차.txt','큰 자료.txt']);
  expect(await noSideScroll(page)).toBe(true);
  await page.locator('#saveEventBtn').click();
  // The task is saved, so the window closes at once; the files go up behind and the refused one waits in the bottom line.
  await expect(modal).toBeHidden();
  expect(state.calls.creates.map(c=>c.title)).toEqual(['자료 정리']);
  await expect.poll(()=>state.calls.attach).toEqual([{taskId:'new1',name:'목차.txt'},{taskId:'new1',name:'큰 자료.txt'}]);
  const line=dock(page);
  await expect(line).toContainText('할 일에 파일 1개 못 올렸어요');
  await expect(line.locator('.up-dock-note')).toContainText('파일 1개 올렸어요');
  await expect(line.locator('.up-dock-note')).toContainText('Drive에 올리지 못했습니다');
  const again=line.getByRole('button',{name:'못 올린 파일 다시 올리기'});
  await expect(again).toBeVisible();
  // The task list reloads on each visit to [할 일] (the 할 일 등록 window itself only marks the list stale).
  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'qa'}));
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  const r=row(page,'자료 정리');
  await expect(r.locator('.gt-files a.gt-file')).toHaveText('목차.txt');
  // [다시 올리기] sends only the refused file, to the same task (no second task).
  await again.click();
  await expect.poll(()=>state.calls.attach.map(c=>c.taskId+':'+c.name)).toEqual(['new1:목차.txt','new1:큰 자료.txt','new1:큰 자료.txt']);
  await expect(dock(page)).toContainText('할 일에 파일 1개 올렸어요');
  await expect(r.locator('.gt-files a.gt-file')).toHaveText(['목차.txt','큰 자료.txt']);
  expect(state.calls.creates.length).toBe(1);
  await context.close();
});

test('upload failure from the task editor keeps the task and says so in the bottom line (PC)',async({browser})=>{
  const {context,page,state}=await openTasks(browser,{failAttach:()=>true});
  await page.evaluate(()=>window.KPTUGoogleTasks.openEditor(null));
  await page.locator('#gtNewFiles [data-gt-pick-input]').setInputFiles([txt('보고.txt')]);
  await page.locator('#gtEditTitle').fill('실패 시험');
  await page.locator('#gtSaveBtn').click();
  await expect(page.locator('#gtTaskModal')).toBeHidden();
  await expect(dock(page)).toContainText('할 일에 파일 1개 못 올렸어요');
  await expect(dock(page).getByRole('button',{name:'못 올린 파일 다시 올리기'})).toBeVisible();
  // The task is kept (it sits in the folded 기한 없음 group of the list).
  await expect(row(page,'실패 시험')).toHaveCount(1);
  expect(state.calls.creates.length).toBe(1);
  expect(state.calls.attach).toEqual([{taskId:'new1',name:'보고.txt'}]);
  await context.close();
});

test('before the task-file table exists no add window shows a file picker',async({browser})=>{
  const {context,page}=await openTasks(browser,{supported:false,viewport:{width:390,height:844}});
  await expect(quick(page).locator('[data-quick-file-picker]')).toBeHidden();
  await page.evaluate(()=>window.KPTUGoogleTasks.openEditor(null));
  await expect(page.locator('#gtTaskHeading')).toHaveText('Google 할 일 추가');
  await page.waitForTimeout(300);
  await expect(page.locator('#gtNewFiles')).toBeHidden();
  await context.close();
});
