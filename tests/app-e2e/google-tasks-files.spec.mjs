import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { answerAsk } from './helpers/small-notice.mjs';

// TASK-파일붙이기: ⋯ → 파일 붙이기 on the task screen. File names sit small under the task and open Drive; the dialog attaches
// one file per request and detaches without touching Drive. Without the table (migration not applied) all of it stays hidden.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const APP_ORIGIN=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const NOW='2026-10-21T03:00:00.000Z';
const task=(id,extra={})=>({id,title:id==='a'?'회의 자료 준비':id,taskListId:'@default',taskListTitle:'내 할 일',due:'2026-10-21T00:00:00.000Z',status:'needsAction',completed:null,notes:'원래 메모',source:'google-task',...extra});
const ok=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
const row=(page,id)=>page.locator(`#gtTaskBody [data-google-task="${id}"]`);
const line=(id,name)=>`첨부: ${name} https://drive.google.com/file/d/${id}/view`;

async function openTasks(browser,{viewport={width:900,height:800},supported=true,files=[],notes='원래 메모',drive='trashed'}={}){
  const context=await browser.newContext({timezoneId:'Asia/Seoul',viewport,hasTouch:viewport.width<600,isMobile:viewport.width<600});
  const page=await context.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  const google={a:task('a',{notes}),b:task('b')};
  const state={files:files.map(f=>({...f})),calls:{files:[],attach:[],detach:[],updates:[],reattach:[],trash:[]},next:1,trashed:new Map(),drive};
  const notesOf=(id,drop=[])=>{const own=state.files.filter(f=>f.google_task_id===id);const kept=String(google[id].notes||'').split('\n').filter(l=>![...own.map(f=>f.drive_file_id),...drop].some(fid=>l.includes('/file/d/'+fid+'/view'))).join('\n');return [kept,...own.map(f=>line(f.drive_file_id,f.file_name))].filter(Boolean).join('\n')};
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
      if(state.hold)await state.hold; // UX-먼저묻고뒤에처리 시험: 올리는 중에 창 닫기·화면 옮기기
      const f={google_task_id:taskId,drive_file_id:'drv'+state.next++,file_name:name,mime_type:'text/plain',size_bytes:3};
      state.files.push(f);google[taskId].notes=notesOf(taskId);
      return ok(route,{ok:true,file:f,files:state.files.filter(x=>x.google_task_id===taskId),task:{...google[taskId]},notes_synced:true});
    }
    if(p==='/functions/v1/google-tasks'&&action==='detach'){
      const b=JSON.parse(req.postData()||'{}');state.calls.detach.push(b);
      state.files=state.files.filter(f=>!(f.google_task_id===b.task_id&&f.drive_file_id===b.drive_file_id));google[b.task_id].notes=notesOf(b.task_id,[b.drive_file_id]);
      return ok(route,{ok:true,files:state.files.filter(x=>x.google_task_id===b.task_id),task:{...google[b.task_id]},notes_synced:true});
    }
    // FILE-첨부삭제 ②: [되돌리기]는 Drive에 있는 그 파일을 다시 붙인다(올리기 없음).
    if(p==='/functions/v1/google-tasks'&&action==='reattach'){
      const b=JSON.parse(req.postData()||'{}');state.calls.reattach.push(b);
      const f=state.trashed.get(b.drive_file_id);state.files.push(f);google[b.task_id].notes=notesOf(b.task_id);
      return ok(route,{ok:true,file:f,files:state.files.filter(x=>x.google_task_id===b.task_id),task:{...google[b.task_id]},notes_synced:true});
    }
    if(p==='/functions/v1/document-actions'){
      const b=JSON.parse(req.postData()||'{}');state.calls.trash.push(b);
      if(b.action==='trash-file'){const f=state.files.find(x=>x.google_task_id===b.id&&x.drive_file_id===b.drive_file_id);state.trashed.set(b.drive_file_id,{...f});return ok(route,{ok:true,detached:false,drive:state.drive,target:'task',id:b.id,drive_file_id:b.drive_file_id})}
      return ok(route,{ok:true,restored:true,target:'task',id:b.id,drive_file_id:b.drive_file_id});
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
// FILE-첨부삭제 결정 2(S56-57): 파일 붙이기 창 줄은 ⋯ 하나(공용 row-more) — 열고 항목을 누른다.
const fileMenu=async(dialog,id,label)=>{await dialog.locator(`[data-gt-file-more="${id}"] > summary`).click();await dialog.locator(`[data-gt-file-more="${id}"] .row-more-menu`).getByRole('button',{name:label,exact:true}).click();};

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

  await fileMenu(dialog,'old1','빼기');
  await expect(dialog.locator('[data-gt-files-status]')).toContainText('Drive 파일은 남아 있습니다');
  expect(state.calls.detach).toEqual([{action:'detach',task_id:'a',drive_file_id:'old1'}]);
  await dialog.locator('[data-gt-files-close]').click();
  await expect(dialog).toBeHidden();
  await expect(row(page,'a').locator('.gt-files a.gt-file')).toHaveText(['회의록.txt','사진.png']);
  expect(google.a.notes).toBe(['원래 메모',line('drv1','회의록.txt'),line('drv2','사진.png')].join('\n'));
  await context.close();
});

// UX-먼저묻고뒤에처리(요청함 11/09 18:04): 고른 파일은 창을 닫고 다른 화면으로 옮겨도 끝까지 붙고, 끝은 작은 알림으로.
test('파일 붙이기: 올리는 중에 창을 닫고 다른 화면으로 옮겨도 남은 파일까지 붙고 끝을 알린다',async({browser})=>{
  const {context,page,state}=await openTasks(browser,{viewport:{width:390,height:844}});
  let release;state.hold=new Promise(r=>{release=r});
  await openMenu(page,'a');
  await page.locator('#gtTaskMenu [data-gt-menu-action="files"]').click();
  const dialog=page.locator('#gtFilesModal');
  await dialog.locator('[data-gt-files-input]').setInputFiles([{name:'가.txt',mimeType:'text/plain',buffer:Buffer.from('abc')},{name:'나.txt',mimeType:'text/plain',buffer:Buffer.from('abc')}]);
  await expect.poll(()=>state.calls.attach.length).toBe(1);
  await dialog.locator('[data-gt-files-close]').click();
  await expect(dialog).toBeHidden();
  await page.evaluate(()=>window.KPTURouter.go('library',{source:'qa'}));
  state.hold=null;release();
  await expect.poll(()=>state.calls.attach.map(c=>c.name)).toEqual(['가.txt','나.txt']);
  await expect(page.locator('#kptuNotice')).toContainText('2개 붙였습니다');
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(row(page,'a').locator('.gt-files a.gt-file')).toHaveText(['가.txt','나.txt']);
  await context.close();
});

// UX-먼저묻고뒤에처리 3차: 올리는 중에도 [파일 선택]이 잠기지 않고, 더 고른 파일은 줄 뒤에 서서 이어서 붙는다.
test('파일 붙이기: 올리는 중에 더 고르면 거절하지 않고 줄 세워 이어서 붙인다',async({browser})=>{
  const {context,page,state}=await openTasks(browser,{viewport:{width:412,height:915}});
  let release;state.hold=new Promise(r=>{release=r});
  await openMenu(page,'a');
  await page.locator('#gtTaskMenu [data-gt-menu-action="files"]').click();
  const dialog=page.locator('#gtFilesModal');
  await dialog.locator('[data-gt-files-input]').setInputFiles([{name:'가.txt',mimeType:'text/plain',buffer:Buffer.from('abc')}]);
  await expect.poll(()=>state.calls.attach.length).toBe(1);
  await expect(dialog.locator('[data-gt-files-pick]')).toBeEnabled();
  await expect(dialog.locator('[data-gt-file-detach]')).toHaveCount(0);
  await dialog.locator('[data-gt-files-input]').setInputFiles([{name:'나.txt',mimeType:'text/plain',buffer:Buffer.from('abc')}]);
  await expect(dialog.locator('[data-gt-files-status]')).toContainText('1개 대기 중');
  state.hold=null;release();
  await expect.poll(()=>state.calls.attach.map(c=>c.name)).toEqual(['가.txt','나.txt']);
  await expect(dialog.locator('[data-gt-files-status]')).toContainText('2개 붙였습니다');
  await expect(dialog.locator('.gt-file')).toHaveText(['가.txt','나.txt']);
  await expect(dialog.locator('[data-gt-file-detach]').first()).toBeEnabled();
  await context.close();
});

test('PC: names sit under the card, the menu lists 수정·파일 붙이기·삭제, and an editor save keeps the link line on the server',async({browser})=>{
  const {context,page,state,google}=await openTasks(browser,{viewport:{width:1280,height:900},files:[{google_task_id:'a',drive_file_id:'old1',file_name:'기존 자료.pdf',size_bytes:9}]});
  await expect(page.locator('#gtTaskSection')).toHaveClass(/gt-pc/);
  const card=row(page,'a');
  await expect(card.locator('.gt-files a.gt-file')).toHaveText('기존 자료.pdf');
  const title=await card.locator('.gt-main').boundingBox(),name=await card.locator('.gt-files').boundingBox();
  expect(name.y).toBeGreaterThanOrEqual(title.y+title.height-8);
  expect(await noSideScroll(page)).toBe(true);
  await openMenu(page,'a');
  await expect(page.locator('#gtTaskMenu button')).toHaveText(['수정','파일 붙이기','삭제']);
  await page.keyboard.press('Escape');
  // The editor sends whatever the notes box holds; the server answer (with the link line kept) is what the list shows.
  await card.locator('.gt-main').click();
  const notes=page.locator('#gtEditNotes');
  await expect(notes).toHaveValue('원래 메모');
  await notes.fill('수정한 메모');
  // S51-13: PC 오른쪽 칸은 [저장] 없이 바로 저장 — 메모는 칸을 떠나면 저장된다.
  await notes.blur();
  await expect.poll(()=>state.calls.updates.length).toBe(1);
  expect(state.calls.updates[0].notes).toBe('수정한 메모');
  // The server (google-tasks Edge, notesForUpdate) adds the file line back; the editor keeps what was typed.
  await expect.poll(()=>google.a.notes).toBe('수정한 메모\n'+line('old1','기존 자료.pdf'));
  await expect(card.locator('.gt-files a.gt-file')).toHaveText('기존 자료.pdf');
  await context.close();
});

// TASK-첨부열기: 첨부 row in the edit window, memo box without the link lines, open/download through the shared Drive paths.
async function watchDrive(context){
  const urls=[];
  await context.route('https://drive.google.com/**',route=>{urls.push(route.request().url());return route.fulfill({status:200,contentType:'text/html',body:'<title>drive</title>'})});
  return urls;
}
const withLines=['내 메모',line('n1','회의록 최종.pdf'),line('n2','자료 모음.xlsx')].join('\n');

test('phone: edit window shows 첨부 under 할 일, the memo box holds only the memo, 열기 and 내려받기 use Drive',async({browser})=>{
  const {context,page,state,google}=await openTasks(browser,{viewport:{width:390,height:844},notes:withLines,files:[{google_task_id:'a',drive_file_id:'n1',file_name:'회의록 최종.pdf',size_bytes:9}]});
  const urls=await watchDrive(context);
  await row(page,'a').locator('[data-gt-edit]').click();
  const att=page.locator('#gtEditAttach');
  await expect(att).toBeVisible();
  await expect(page.locator('#gtEditNotes')).toHaveValue('내 메모');
  await expect(att.locator('.gt-att-name')).toHaveText(['회의록 최종.pdf','자료 모음.xlsx']);
  // Right under the 할 일 box, above the 기한 row.
  const t=await page.locator('#gtEditTitle').boundingBox(),a=await att.boundingBox(),d=await page.locator('#gtEditDue').boundingBox();
  expect(a.y).toBeGreaterThanOrEqual(t.y+t.height-1);expect(a.y+a.height).toBeLessThanOrEqual(d.y+1);
  const button=att.locator('.gt-att-btn').first();
  expect((await button.boundingBox()).height).toBeLessThanOrEqual(30);
  expect(await noSideScroll(page)).toBe(true);
  await att.locator('.gt-att-row').nth(1).locator('[data-fa-menu="open"]').click();
  await expect.poll(()=>urls.at(-1)).toBe('https://drive.google.com/file/d/n2/view');
  await att.locator('.gt-att-row').nth(1).locator('[data-fa-menu="download"]').click();
  await expect.poll(()=>urls.at(-1)).toContain('uc?export=download&id=n2');
  // Nothing was saved or changed by opening them.
  expect(state.calls.updates).toEqual([]);
  expect(google.a.notes).toBe(withLines);
  await context.close();
});

test('saving puts the memo and the attachment lines back together once, and keeps lines that only the notes hold',async({browser})=>{
  const {context,page,state,google}=await openTasks(browser,{viewport:{width:390,height:844},notes:withLines,files:[{google_task_id:'a',drive_file_id:'n1',file_name:'회의록 최종.pdf',size_bytes:9}]});
  await row(page,'a').locator('[data-gt-edit]').click();
  await page.locator('#gtEditNotes').fill('수정한 메모');
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>state.calls.updates.length).toBe(1);
  expect(state.calls.updates[0].notes).toBe(['수정한 메모',line('n1','회의록 최종.pdf'),line('n2','자료 모음.xlsx')].join('\n'));
  await expect.poll(()=>google.a.notes).toBe(['수정한 메모',line('n2','자료 모음.xlsx'),line('n1','회의록 최종.pdf')].join('\n'));
  expect((google.a.notes.match(/첨부: /g)||[]).length).toBe(2);
  // Reopen: still two rows, memo box without lines.
  await page.waitForTimeout(300);
  await row(page,'a').locator('[data-gt-edit]').click();
  await expect(page.locator('#gtEditNotes')).toHaveValue('수정한 메모');
  await expect(page.locator('#gtEditAttach .gt-att-row')).toHaveCount(2);
  await context.close();
});

test('card: a long file name stays on one line with an ellipsis; tapping it opens the file, not the editor',async({browser})=>{
  const long='아주 긴 파일 이름 '.repeat(12)+'.pdf';
  const {context,page}=await openTasks(browser,{viewport:{width:390,height:844},files:[{google_task_id:'a',drive_file_id:'old1',file_name:long,size_bytes:9}]});
  const urls=await watchDrive(context);
  const name=row(page,'a').locator('.gt-files a.gt-file');
  const fits=await name.evaluate(el=>({over:el.scrollWidth>el.clientWidth,right:el.getBoundingClientRect().right,card:el.closest('.gt-row').getBoundingClientRect().right,height:el.getBoundingClientRect().height,ellipsis:getComputedStyle(el).textOverflow}));
  expect(fits.over).toBe(true);expect(fits.ellipsis).toBe('ellipsis');expect(fits.right).toBeLessThanOrEqual(fits.card+1);expect(fits.height).toBeLessThan(40);
  expect(await noSideScroll(page)).toBe(true);
  await name.click();
  await expect.poll(()=>urls.length).toBeGreaterThan(0);
  await expect(page.locator('#gtTaskModal')).toBeHidden();
  await context.close();
});

// TASK-첨부교체: the edit window's 첨부 rows offer [교체] [빼기] and [파일 붙이기]; nothing is sent until [저장], closing forgets it,
// and the old Drive file is only taken off the task (detach), never deleted.
const txt=name=>({name,mimeType:'text/plain',buffer:Buffer.from('abc')});
// S51-13 TODO-폴드목록상세: PC·폴드 펼침 오른쪽 칸은 바꾸면 잠시 뒤 바로 저장된다(아래 'PC 오른쪽 칸' 시험). 이 시험은 [저장]이 있는 폰 창.
for(const viewport of [{width:412,height:915}]){
  test(`${viewport.width}px: 교체 → 저장 puts the new file in the list and the window; 빼기·파일 붙이기 too; closing forgets held changes`,async({browser})=>{
    const {context,page,state,google}=await openTasks(browser,{viewport,files:[{google_task_id:'a',drive_file_id:'old1',file_name:'기존 자료.pdf',size_bytes:9}]});
    const open=async()=>{await row(page,'a').locator('[data-gt-edit]').click();await expect(page.locator('#gtEditAttach')).toBeVisible()};
    const att=page.locator('#gtEditAttach');
    await open();
    // ATT-이름고치기: the file name now carries a small ✎ (rename in place) before the row buttons.
    await expect(att.locator('.gt-att-row').first().locator('button')).toHaveText(['✎','열기','내려받기','교체','빼기']);
    // Same small size on one line.
    const boxes=await att.locator('.gt-att-row').first().locator('button:not([data-fr-edit])').evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return {h:Math.round(r.height),y:Math.round(r.top)}}));
    expect(new Set(boxes.map(b=>b.h)).size).toBe(1);expect(new Set(boxes.map(b=>b.y)).size).toBe(1);expect(boxes[0].h).toBeLessThanOrEqual(30);
    expect(await noSideScroll(page)).toBe(true);

    // Held changes, then the window closes: nothing was sent, and the next open shows the saved file again.
    await att.locator('[data-gt-att-swap="old1"]').click();
    await att.locator('[data-gt-att-swap-input]').setInputFiles([txt('임시.txt')]);
    await expect(att.locator('.gt-att-row.is-changed .gt-att-name')).toHaveText('임시.txt');
    await att.locator('[data-gt-att-add-input]').setInputFiles([txt('더할 자료.txt')]);
    await expect(att.locator('.gt-att-row.is-new .gt-att-name')).toHaveText('더할 자료.txt');
    if(viewport.width<761){await page.locator('[data-gt-close]').click();await expect(page.locator('#gtTaskModal')).toBeHidden()}
    else{await row(page,'b').locator('[data-gt-edit]').click();await answerAsk(page,true);await expect(page.locator('#gtEditTitle')).toHaveValue('b')}
    await open();
    await expect(att.locator('.gt-att-row .gt-att-name')).toHaveText(['기존 자료.pdf']);
    await expect(att.locator('.is-changed,.is-new')).toHaveCount(0);
    expect(state.calls.attach).toEqual([]);expect(state.calls.detach).toEqual([]);

    // [교체] → [저장]: the new file goes up first, then the old one comes off the task. The list and the window show the new one.
    await att.locator('[data-gt-att-swap="old1"]').click();
    await att.locator('[data-gt-att-swap-input]').setInputFiles([txt('새 자료.txt')]);
    await expect(att.locator('.gt-att-hint')).toHaveText('저장하면 반영됩니다 · 원래 파일은 Drive에 남습니다');
    await page.locator('#gtSaveBtn').click();
    await expect.poll(()=>state.calls.detach.length).toBe(1);
    expect(state.calls.attach).toEqual([{taskId:'a',name:'새 자료.txt'}]);
    expect(state.calls.detach).toEqual([{action:'detach',task_id:'a',drive_file_id:'old1'}]);
    expect(state.calls.updates).toEqual([]);
    await expect(row(page,'a').locator('.gt-files a.gt-file')).toHaveText(['새 자료.txt']);
    expect(google.a.notes).toBe(['원래 메모',line('drv1','새 자료.txt')].join('\n'));
    await open(); // S49-35: 저장하면 PC 칸도 폰 창처럼 닫힌다 → 다시 연다
    await expect(att.locator('.gt-att-row .gt-att-name')).toHaveText(['새 자료.txt']);

    // [빼기] → [저장]: no file left; the row becomes 첨부 [파일 붙이기]. Then [파일 붙이기] → [저장] adds one.
    await att.locator('[data-gt-att-remove="drv1"]').click();
    await expect(att.locator('.gt-att-row.is-removed')).toHaveCount(1);
    await page.locator('#gtSaveBtn').click();
    await expect.poll(()=>state.calls.detach.length).toBe(2);
    await expect(row(page,'a').locator('.gt-files')).toHaveCount(0);
    await open(); // S49-35: 저장하면 PC 칸도 폰 창처럼 닫힌다 → 다시 연다
    await expect(att.locator('.gt-att-row')).toHaveCount(0);
    await expect(att.locator('[data-gt-att-add]')).toHaveText('파일 붙이기');
    await att.locator('[data-gt-att-add-input]').setInputFiles([txt('붙인 자료.txt')]);
    await page.locator('#gtSaveBtn').click();
    await expect.poll(()=>state.calls.attach.length).toBe(2);
    await expect(row(page,'a').locator('.gt-files a.gt-file')).toHaveText(['붙인 자료.txt']);
    expect(await noSideScroll(page)).toBe(true);
    await context.close();
  });
}

test('1440px PC 오른쪽 칸: 교체·빼기·파일 붙이기는 [저장] 없이 잠시 뒤 바로 저장되고, 칸은 열린 채 새 파일을 보인다',async({browser})=>{
  const {context,page,state,google}=await openTasks(browser,{viewport:{width:1440,height:900},files:[{google_task_id:'a',drive_file_id:'old1',file_name:'기존 자료.pdf',size_bytes:9}]});
  const att=page.locator('#gtEditAttach');
  await row(page,'a').locator('[data-gt-edit]').click();await expect(att).toBeVisible();
  await expect(page.locator('#gtSaveBtn')).toBeHidden();
  // [교체]: 안내는 '잠시 뒤 저장됩니다', 새 파일이 먼저 올라가고 원래 파일은 할 일에서만 빠진다.
  await att.locator('[data-gt-att-swap="old1"]').click();
  await att.locator('[data-gt-att-swap-input]').setInputFiles([txt('새 자료.txt')]);
  await expect(att.locator('.gt-att-hint')).toHaveText('잠시 뒤 저장됩니다 · 원래 파일은 Drive에 남습니다');
  await expect.poll(()=>state.calls.detach.length).toBe(1);
  expect(state.calls.attach).toEqual([{taskId:'a',name:'새 자료.txt'}]);
  expect(state.calls.detach).toEqual([{action:'detach',task_id:'a',drive_file_id:'old1'}]);
  await expect(row(page,'a').locator('.gt-files a.gt-file')).toHaveText(['새 자료.txt']);
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(att.locator('.gt-att-row .gt-att-name')).toHaveText(['새 자료.txt']);
  expect(google.a.notes).toBe(['원래 메모',line('drv1','새 자료.txt')].join('\n'));
  // [빼기] → 바로 저장, [파일 붙이기] → 바로 저장.
  await att.locator('[data-gt-att-remove="drv1"]').click();
  await expect.poll(()=>state.calls.detach.length).toBe(2);
  await expect(att.locator('.gt-att-row')).toHaveCount(0);
  await att.locator('[data-gt-att-add-input]').setInputFiles([txt('붙인 자료.txt')]);
  await expect.poll(()=>state.calls.attach.length).toBe(2);
  await expect(row(page,'a').locator('.gt-files a.gt-file')).toHaveText(['붙인 자료.txt']);
  expect(await noSideScroll(page)).toBe(true);
  await context.close();
});

test('a file known only from a notes line is taken off by the notes save; other lines stay',async({browser})=>{
  const {context,page,state}=await openTasks(browser,{viewport:{width:412,height:915},notes:withLines,files:[{google_task_id:'a',drive_file_id:'n1',file_name:'회의록 최종.pdf',size_bytes:9}]});
  await row(page,'a').locator('[data-gt-edit]').click();
  await page.locator('#gtEditAttach [data-gt-att-remove="n2"]').click();
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>state.calls.updates.length).toBe(1);
  expect(state.calls.detach).toEqual([]);
  expect(state.calls.updates[0].notes).toBe(['내 메모',line('n1','회의록 최종.pdf')].join('\n'));
  await context.close();
});

// FILE-첨부삭제 ②(S56-45): ⋯ → 파일 붙이기 창의 [삭제] — 한 번 묻고 → document-actions trash-file(붙어 있는지 확인·휴지통)
// → google-tasks detach(떼기·메모 줄) → '삭제했어요 · [되돌리기]' → reattach(다시 붙이기) → restore-file(휴지통에서 꺼내기).
for(const viewport of [{width:412,height:915},{width:1280,height:800}]){
  test(`${viewport.width}px: 파일 붙이기 창 [삭제] → 확인 → 떼고 휴지통, [되돌리기]로 다시 붙음; [빼기]는 그대로`,async({browser})=>{
    const files=[{google_task_id:'a',drive_file_id:'old1',file_name:'기존 자료.pdf',size_bytes:9},{google_task_id:'a',drive_file_id:'old2',file_name:'회의록.hwp',size_bytes:9}];
    const {context,page,state,google}=await openTasks(browser,{viewport,files});
    await openMenu(page,'a');
    await page.locator('#gtTaskMenu [data-gt-menu-action="files"]').click();
    const dialog=page.locator('#gtFilesModal');
    await expect(dialog.locator('.gt-files-list .gt-file')).toHaveText(['기존 자료.pdf','회의록.hwp']);
    // FILE-첨부삭제 결정 2: 줄 단추는 ⋯ 하나, 이름은 잘리지 않는다(폰 412 포함).
    await expect(dialog.locator('.gt-files-list li button:visible')).toHaveCount(0);
    for(const name of await dialog.locator('.gt-files-list .gt-file').all())expect(await name.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await dialog.locator('[data-gt-file-more="old1"] > summary').click();
    await expect(dialog.locator('[data-gt-file-more="old1"] .row-more-menu button')).toHaveText(['이름 수정','Drive에서 열기','내려받기','빼기','삭제']);
    if(process.env.CAPTURE_DIR)await page.screenshot({path:`${process.env.CAPTURE_DIR}/task-file-menu-${viewport.width}.png`});
    await page.keyboard.press('Escape');
    expect(await noSideScroll(page)).toBe(true);
    if(process.env.CAPTURE_DIR)await page.screenshot({path:`${process.env.CAPTURE_DIR}/task-file-dialog-${viewport.width}.png`});
    // 아니오: 아무 요청도 없음.
    await fileMenu(dialog,'old1','삭제');
    await answerAsk(page,false);
    expect(state.calls.trash).toEqual([]);expect(state.calls.detach).toEqual([]);
    await fileMenu(dialog,'old1','삭제');
    expect(await answerAsk(page,true)).toBe("'기존 자료.pdf' 파일을 삭제할까요?");
    await expect(dialog.locator('.gt-files-list .gt-file')).toHaveText(['회의록.hwp']);
    expect(state.calls.trash).toEqual([{action:'trash-file',target:'task',id:'a',drive_file_id:'old1'}]);
    expect(state.calls.detach).toEqual([{action:'detach',task_id:'a',drive_file_id:'old1'}]);
    const notice=page.locator('[data-undo-notice]');
    await expect(notice.locator('[data-undo-text]')).toHaveText('삭제했어요');
    if(process.env.CAPTURE_DIR)await page.screenshot({path:`${process.env.CAPTURE_DIR}/task-file-deleted-${viewport.width}.png`});
    expect(google.a.notes).toBe(['원래 메모',line('old2','회의록.hwp')].join('\n'));
    await notice.locator('[data-undo-action]').click();
    await expect(notice.locator('[data-undo-text]')).toHaveText('되돌렸어요');
    expect(state.calls.reattach).toEqual([{action:'reattach',task_id:'a',drive_file_id:'old1'}]);
    expect(state.calls.trash[1]).toEqual({action:'restore-file',target:'task',id:'a',drive_file_id:'old1'});
    await expect(dialog.locator('.gt-files-list .gt-file')).toHaveText(['회의록.hwp','기존 자료.pdf']);
    await dialog.locator('[data-gt-files-close]').click();
    await expect(row(page,'a').locator('.gt-files a.gt-file')).toHaveText(['회의록.hwp','기존 자료.pdf']);
    await context.close();
  });
}

test('다른 기록도 쓰는 파일은 [삭제]해도 Drive에 남기고 창에 한 줄, 되돌리기 없음',async({browser})=>{
  const {context,page,state}=await openTasks(browser,{viewport:{width:412,height:915},drive:'kept',files:[{google_task_id:'a',drive_file_id:'old1',file_name:'기존 자료.pdf',size_bytes:9}]});
  await openMenu(page,'a');
  await page.locator('#gtTaskMenu [data-gt-menu-action="files"]').click();
  const dialog=page.locator('#gtFilesModal');
  await fileMenu(dialog,'old1','삭제');
  await answerAsk(page,true);
  await expect(dialog.locator('[data-gt-files-status]')).toHaveText('빼기만 했어요. 다른 곳에서도 쓰는 파일이라 Drive에 남겨 뒀어요.');
  await expect(dialog.locator('.gt-files-list .gt-file')).toHaveCount(0);
  await expect(page.locator('[data-undo-notice]')).toHaveCount(0);
  expect(state.calls.detach).toEqual([{action:'detach',task_id:'a',drive_file_id:'old1'}]);
  await context.close();
});

// FILE-첨부삭제 결정 2(S56-57): ⋯ → [이름 수정]는 이름 칸을 그 자리 고치기 칸으로(✎와 같은 공용 길), 올리는 중에는 [이름 수정]·[빼기]·[삭제]가 잠긴다.
test('412px: 파일 붙이기 창 ⋯ [이름 수정]는 이름 칸을 그 자리에서 고치고, 올리는 중에는 고치기·빼기·삭제가 잠긴다',async({browser})=>{
  const {context,page,state}=await openTasks(browser,{viewport:{width:412,height:915},files:[{google_task_id:'a',drive_file_id:'old1',file_name:'아주 긴 합성 회의 자료 이름 두 번째 차수 정리본.pdf',size_bytes:9}]});
  await openMenu(page,'a');
  await page.locator('#gtTaskMenu [data-gt-menu-action="files"]').click();
  const dialog=page.locator('#gtFilesModal');
  const name=dialog.locator('.gt-files-list .gt-file');
  await expect(name).toHaveText('아주 긴 합성 회의 자료 이름 두 번째 차수 정리본.pdf');
  await fileMenu(dialog,'old1','이름 수정');
  await expect(dialog.locator('.fr-input')).toBeFocused();
  await expect(dialog.locator('.fr-input')).toHaveValue('아주 긴 합성 회의 자료 이름 두 번째 차수 정리본');
  await expect(dialog.locator('[data-gt-file-more="old1"]')).not.toHaveAttribute('open','');
  await dialog.locator('[data-fr-cancel]').click();
  await expect(name).toBeVisible();
  let release;state.hold=new Promise(r=>{release=r});
  await dialog.locator('[data-gt-files-input]').setInputFiles([{name:'가.txt',mimeType:'text/plain',buffer:Buffer.from('abc')}]);
  await expect.poll(()=>state.calls.attach.length).toBe(1);
  await dialog.locator('[data-gt-file-more="old1"] > summary').click();
  const menu=dialog.locator('[data-gt-file-more="old1"] .row-more-menu');
  for(const label of ['이름 수정','빼기','삭제'])await expect(menu.getByRole('button',{name:label,exact:true})).toBeDisabled();
  for(const label of ['Drive에서 열기','내려받기'])await expect(menu.getByRole('button',{name:label,exact:true})).toBeEnabled();
  state.hold=null;release();
  await expect(dialog.locator('[data-gt-files-status]')).toContainText('1개 붙였습니다');
  expect(await noSideScroll(page)).toBe(true);
  await context.close();
});
