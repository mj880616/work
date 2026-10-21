import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

// TASK-파일붙이기: ⋯ → 파일 붙이기 on the task screen. File names sit small under the task and open Drive; the dialog attaches
// one file per request and detaches without touching Drive. Without the table (migration not applied) all of it stays hidden.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const APP_ORIGIN=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const NOW='2026-10-21T03:00:00.000Z';
const task=(id,extra={})=>({id,title:id==='a'?'회의 자료 준비':id,taskListId:'@default',taskListTitle:'내 할 일',due:'2026-10-21T00:00:00.000Z',status:'needsAction',completed:null,notes:'원래 메모',source:'google-task',...extra});
const ok=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
const row=(page,id)=>page.locator(`#gtTaskBody [data-google-task="${id}"]`);
const line=(id,name)=>`첨부: ${name} https://drive.google.com/file/d/${id}/view`;

async function openTasks(browser,{viewport={width:900,height:800},supported=true,files=[]}={}){
  const context=await browser.newContext({timezoneId:'Asia/Seoul',viewport,hasTouch:viewport.width<600,isMobile:viewport.width<600});
  const page=await context.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  const google={a:task('a'),b:task('b')};
  const state={files:files.map(f=>({...f})),calls:{files:[],attach:[],detach:[],updates:[]},next:1};
  const notesOf=id=>{const own=state.files.filter(f=>f.google_task_id===id);const kept=String(google[id].notes||'').split('\n').filter(l=>!/^첨부: /.test(l)).join('\n');return [kept,...own.map(f=>line(f.drive_file_id,f.file_name))].filter(Boolean).join('\n')};
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,action=u.searchParams.get('action');
    if(p==='/auth/v1/token')return ok(route,{access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user:{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}}});
    if(p==='/auth/v1/user')return ok(route,{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}});
    if(p==='/rest/v1/app_workspace_members')return ok(route,[{workspace_id:'qa-ws',user_id:'qa-user',role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok(route,[{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok(route,[{user_id:'qa-user',display_name:'QA'}]);
    if(p==='/functions/v1/google-calendar')return ok(route,{connected:false,enabled:false,calendars:[],events:[]});
    if(p==='/functions/v1/google-tasks'&&action==='overview')return ok(route,{connected:true,authorized:true,tasks:Object.values(google).map(t=>({...t}))});
    if(p==='/rest/v1/app_task_attachments'){
      const q=u.searchParams.get('google_task_id')||'';state.calls.files.push(q);
      // Before the migration PostgREST has no such table.
      if(!supported)return ok(route,{code:'PGRST205',message:'Could not find the table'},404);
      const ids=(q.match(/^in\.\((.*)\)$/)?.[1]||'').split(',');
      return ok(route,state.files.filter(f=>ids.includes(f.google_task_id)).map(({google_task_id,drive_file_id,file_name,size_bytes})=>({google_task_id,drive_file_id,file_name,size_bytes})));
    }
    if(p==='/functions/v1/google-tasks'&&action==='attach'){
      const body=req.postDataBuffer()?.toString('latin1')||'';
      const taskId=body.match(/name="task_id"\r\n\r\n([^\r]*)/)?.[1];
      const name=Buffer.from(body.match(/name="file"; filename="([^"]*)"/)?.[1]||'','latin1').toString('utf8');
      state.calls.attach.push({taskId,name});
      const f={google_task_id:taskId,drive_file_id:'drv'+state.next++,file_name:name,mime_type:'text/plain',size_bytes:3};
      state.files.push(f);google[taskId].notes=notesOf(taskId);
      return ok(route,{ok:true,file:f,files:state.files.filter(x=>x.google_task_id===taskId),task:{...google[taskId]},notes_synced:true});
    }
    if(p==='/functions/v1/google-tasks'&&action==='detach'){
      const b=JSON.parse(req.postData()||'{}');state.calls.detach.push(b);
      state.files=state.files.filter(f=>!(f.google_task_id===b.task_id&&f.drive_file_id===b.drive_file_id));google[b.task_id].notes=notesOf(b.task_id);
      return ok(route,{ok:true,files:state.files.filter(x=>x.google_task_id===b.task_id),task:{...google[b.task_id]},notes_synced:true});
    }
    if(p==='/functions/v1/google-tasks'&&action==='update'){
      const b=JSON.parse(req.postData()||'{}');state.calls.updates.push(b);
      google[b.task_id]={...google[b.task_id],title:b.title,notes:b.notes};google[b.task_id].notes=notesOf(b.task_id);
      return ok(route,{ok:true,task:{...google[b.task_id]}});
    }
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok(route,[]);
    return ok(route,{});
  });
  await page.goto(loginEntry(`${APP_ORIGIN}/app/`));
  await signInWithSession(page,'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
  await expect.poll(()=>page.evaluate(()=>typeof window.KPTURouter?.go==='function'),{timeout:10000}).toBeTruthy();
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(row(page,'a')).toBeVisible({timeout:10000});
  await expect.poll(()=>state.calls.files.length,{timeout:10000}).toBeGreaterThan(0);
  return {context,page,google,state};
}
const openMenu=async(page,id)=>{await row(page,id).locator('[data-gt-menu]').click();await expect(page.locator('#gtTaskMenu')).toBeVisible();};
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1);

test('before the table exists there is no file menu item and no file names',async({browser})=>{
  const {context,page,state}=await openTasks(browser,{supported:false});
  expect(state.calls.files[0]).toMatch(/^in\.\((a,b|b,a)\)$/);
  await openMenu(page,'a');
  await expect(page.locator('#gtTaskMenu [data-gt-menu-action="edit"]')).toBeVisible();
  await expect(page.locator('#gtTaskMenu [data-gt-menu-action="files"]')).toHaveCount(0);
  await expect(page.locator('#gtTaskBody .gt-files')).toHaveCount(0);
  await context.close();
});

test('phone: saved file names sit under the task and open Drive; ⋯ → 파일 붙이기 attaches and detaches',async({browser})=>{
  const {context,page,state,google}=await openTasks(browser,{viewport:{width:390,height:844},files:[{google_task_id:'a',drive_file_id:'old1',file_name:'기존 자료.pdf',size_bytes:9}]});
  const link=row(page,'a').locator('.gt-files a.gt-file');
  await expect(link).toHaveText('기존 자료.pdf');
  await expect(link).toHaveAttribute('href','https://drive.google.com/file/d/old1/view');
  await expect(link).toHaveAttribute('target','_blank');
  await expect(row(page,'b').locator('.gt-files')).toHaveCount(0);
  const box=await link.boundingBox();expect(box.height).toBeGreaterThanOrEqual(24);
  expect(await noSideScroll(page)).toBe(true);

  await openMenu(page,'a');
  await page.locator('#gtTaskMenu [data-gt-menu-action="files"]').click();
  const dialog=page.locator('#gtFilesModal');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-gt-files-task]')).toHaveText('회의 자료 준비');
  await expect(dialog.locator('.gt-files-list .gt-file')).toHaveText(['기존 자료.pdf']);
  await dialog.locator('[data-gt-files-input]').setInputFiles([{name:'회의록.txt',mimeType:'text/plain',buffer:Buffer.from('abc')},{name:'사진.png',mimeType:'image/png',buffer:Buffer.from('png')}]);
  await expect(dialog.locator('[data-gt-files-status]')).toHaveText('2개 붙였습니다.');
  expect(state.calls.attach).toEqual([{taskId:'a',name:'회의록.txt'},{taskId:'a',name:'사진.png'}]);
  await expect(dialog.locator('.gt-files-list .gt-file')).toHaveText(['기존 자료.pdf','회의록.txt','사진.png']);
  expect(await noSideScroll(page)).toBe(true);

  await dialog.locator('[data-gt-file-detach="old1"]').click();
  await expect(dialog.locator('[data-gt-files-status]')).toContainText('Drive 파일은 남아 있습니다');
  expect(state.calls.detach).toEqual([{action:'detach',task_id:'a',drive_file_id:'old1'}]);
  await dialog.locator('[data-gt-files-close]').click();
  await expect(dialog).toBeHidden();
  await expect(row(page,'a').locator('.gt-files a.gt-file')).toHaveText(['회의록.txt','사진.png']);
  expect(google.a.notes).toBe(['원래 메모',line('drv1','회의록.txt'),line('drv2','사진.png')].join('\n'));
  await context.close();
});

test('PC: names sit under the card, the menu lists 편집·파일 붙이기·삭제, and an editor save keeps the link line on the server',async({browser})=>{
  const {context,page,state,google}=await openTasks(browser,{viewport:{width:1280,height:900},files:[{google_task_id:'a',drive_file_id:'old1',file_name:'기존 자료.pdf',size_bytes:9}]});
  await expect(page.locator('#gtTaskSection')).toHaveClass(/gt-pc/);
  const card=row(page,'a');
  await expect(card.locator('.gt-files a.gt-file')).toHaveText('기존 자료.pdf');
  const title=await card.locator('.gt-main').boundingBox(),name=await card.locator('.gt-files').boundingBox();
  expect(name.y).toBeGreaterThanOrEqual(title.y+title.height-8);
  expect(await noSideScroll(page)).toBe(true);
  await openMenu(page,'a');
  await expect(page.locator('#gtTaskMenu button')).toHaveText(['편집','파일 붙이기','삭제']);
  await page.keyboard.press('Escape');
  // The editor sends whatever the notes box holds; the server answer (with the link line kept) is what the list shows.
  await card.locator('.gt-main').click();
  const notes=page.locator('#gtEditNotes');
  await expect(notes).toHaveValue('원래 메모');
  await notes.fill('고친 메모');
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>state.calls.updates.length).toBe(1);
  expect(state.calls.updates[0].notes).toBe('고친 메모');
  // The server (google-tasks Edge, notesForUpdate) adds the file line back; the editor keeps what was typed.
  await expect.poll(()=>google.a.notes).toBe('고친 메모\n'+line('old1','기존 자료.pdf'));
  await expect(card.locator('.gt-files a.gt-file')).toHaveText('기존 자료.pdf');
  await context.close();
});
