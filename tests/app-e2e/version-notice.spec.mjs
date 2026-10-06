import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const origin='http://127.0.0.1:8123';
const html=readFileSync('app/index.html','utf8');
const current=Number(html.match(/src="\.\/app\.js\?v=(\d+)"/)[1]);
async function boot(page,{connected=false}={}){
  const user={id:'version-user',email:'version@example.org'},workspace={id:'version-workspace',name:'QA',slug:'qa'};
  let streamTitle='QA stream';
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**',route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    let data=[];
    if(path==='/auth/v1/user')data=user;
    else if(path==='/rest/v1/app_workspace_members')data=[{workspace_id:workspace.id,user_id:user.id,role:'owner'}];
    else if(path==='/rest/v1/app_workspaces')data=[workspace];
    else if(path==='/rest/v1/app_profiles')data=[{user_id:user.id,display_name:'QA'}];
    else if(path==='/rest/v1/app_spaces')data=[{id:'version-project',workspace_id:workspace.id,name:'QA project',status:'active',owner_id:user.id,metadata:{project_system:'v2',management_version:2}}];
    else if(path==='/rest/v1/app_project_modules')data=[{project_id:'version-project',module_key:'progress',enabled:true,sort_order:10}];
    else if(path==='/rest/v1/app_project_workstreams'){
      if(route.request().method()==='PATCH')streamTitle=route.request().postDataJSON().title||streamTitle;
      data=[{id:'version-stream',project_id:'version-project',title:streamTitle,phase:'in_progress',sort_order:10}];
    }
    else if(path==='/functions/v1/google-calendar')data={connected,enabled:connected,selected:connected?['primary']:[],calendars:connected?[{id:'primary',summary:'QA',primary:true}]:[],events:[],colors:{event:{'1':{background:'#a4bdfc'},'2':{background:'#7ae7bf'}}}};
    else if(path.startsWith('/functions/'))data={connected:false,enabled:false,tasks:[],events:[],calendars:[]};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.addInitScript(({user})=>{
    if(window!==window.top)return;
    localStorage.setItem('kptu_collab_session_v1',JSON.stringify({access_token:'qa',refresh_token:'qa-refresh',expires_at:Math.floor(Date.now()/1000)+86400,user}));
  },{user});
  await page.goto(origin+'/app/');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
}
async function visible(page){
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
}
async function response(page,version){
  await page.route(origin+'/app/index.html',route=>route.fulfill({contentType:'text/html',body:version===null?'bad html':`<script src="./app.js?v=${version}" defer></script>`}));
}
const notice=page=>page.locator('#versionNotice');
test('equal version has no notice; newer version appears after visibility change',async({page})=>{
  await boot(page);await response(page,current);const checked=page.waitForResponse(origin+'/app/index.html');await visible(page);await checked;
  await expect(notice(page)).toHaveCount(0);
  await page.clock.install();await page.clock.runFor(1001);
  await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();
});
test('dismissed deployment stays dismissed in this tab; later deployment appears',async({page})=>{
  await boot(page);await page.clock.install();await response(page,current+1);await visible(page);
  await expect(notice(page)).toBeVisible();await notice(page).getByRole('button',{name:'닫기',exact:true}).click();
  await page.clock.runFor(1001);const next=page.waitForResponse(origin+'/app/index.html');await visible(page);await next;
  await expect(notice(page)).toHaveCount(0);
  await page.clock.runFor(1001);await response(page,current+2);await visible(page);await expect(notice(page)).toBeVisible();
});
test('reload without draft navigates; changed calendar input confirms first and cancel keeps draft',async({page})=>{
  await boot(page);await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();
  await page.locator('#newEventBtn').click();
  const field=page.locator('#eventTitle');await expect(field).toBeVisible();await field.fill('Unsaved QA');
  const dialogs=[];page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss()});
  let navigations=0;page.on('framenavigated',f=>{if(f===page.mainFrame())navigations++});
  await notice(page).getByRole('button',{name:'새로고침',exact:true}).click();
  expect(dialogs).toHaveLength(1);expect(navigations).toBe(0);await expect(field).toHaveValue('Unsaved QA');
  await field.fill('');
  const reloaded=page.waitForEvent('framenavigated',f=>f===page.mainFrame());
  await notice(page).getByRole('button',{name:'새로고침',exact:true}).click();await reloaded;
  expect(dialogs).toHaveLength(1);
});
for(const mode of ['failure','malformed'])test(`${mode} index response is silent`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await boot(page);
  await page.route(origin+'/app/index.html',r=>mode==='failure'?r.fulfill({status:503,body:''}):r.fulfill({body:'<script src="./other.js?v=999"></script>'}));
  const done=page.waitForResponse(origin+'/app/index.html');await visible(page);await done;
  await expect(notice(page)).toHaveCount(0);expect(errors).toEqual([]);
});
test('no-store and simultaneous visible/focus events use one request, including after completion',async({page})=>{
  await boot(page);
  await page.evaluate(()=>{const original=window.fetch;window.versionCaches=[];window.fetch=(url,opts)=>{if(String(url).includes('index.html'))window.versionCaches.push(opts?.cache);return original(url,opts)}});
  let count=0,release;const gate=new Promise(r=>release=r);
  await page.route(origin+'/app/index.html',async r=>{count++;await gate;await r.fulfill({body:`<script src="./app.js?v=${current+1}"></script>`})});
  await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('focus'))});
  await expect.poll(()=>count).toBe(1);release();await expect(notice(page)).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  expect(count).toBe(1);expect(await page.evaluate(()=>window.versionCaches)).toEqual(['no-store']);
});
test('ten minute clock checks only while visible, and offline checks are ignored',async({page})=>{
  const time=new Date('2026-10-06T00:00:00Z');await page.clock.install({time});await page.clock.pauseAt(time);await boot(page);let count=0;
  await page.route(origin+'/app/index.html',r=>{count++;return r.fulfill({body:`<script src="./app.js?v=${current}"></script>`})});
  await page.clock.runFor(599999);expect(count).toBe(0);
  await page.clock.runFor(1);await expect.poll(()=>count).toBe(1);
  await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'}));
  await page.clock.runFor(600000);expect(count).toBe(1);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});Object.defineProperty(navigator,'onLine',{configurable:true,value:false})});
  await visible(page);await page.clock.runFor(600000);expect(count).toBe(1);
});
for(const width of [390,1440])test(`notice does not overlap calendar add or toast at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});await boot(page);await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();
  await page.locator('#toast').evaluate(el=>{el.textContent='QA toast';el.classList.remove('hidden')});
  const geometry=await page.evaluate(()=>{
    const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};
    const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    const n=box('versionNotice');return {overlapAdd:overlaps(n,box('newEventBtn')),overlapToast:overlaps(n,box('toast')),overflow:document.documentElement.scrollWidth>innerWidth,hit:[...document.querySelectorAll('#versionNotice button')].map(b=>({w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}))};
  });
  expect(geometry).toMatchObject({overlapAdd:false,overlapToast:false,overflow:false});for(const b of geometry.hit){expect(b.w).toBeGreaterThanOrEqual(44);expect(b.h).toBeGreaterThanOrEqual(44)}
  await page.screenshot({path:`test-results/version-notice-${width}.png`});
});
test('login does not load version checker',async({page})=>{
  const requests=[];page.on('request',r=>requests.push(r.url()));await page.goto(origin+'/app/login/');await visible(page);
  expect(requests.some(u=>u.includes('version-notice.js')||u===origin+'/app/index.html')).toBe(false);await expect(notice(page)).toHaveCount(0);
});

test('project draft uses existing confirmDiscard; accepting reloads',async({page})=>{
  await boot(page);await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();
  await page.locator('[data-view="projects"]').click();
  await page.locator('[data-ps3-project="version-project"]').first().click();
  const field=page.locator('[data-ps3-quick-progress] input').first();await expect(field).toBeVisible();await field.fill('QA draft');
  let message='';page.once('dialog',async d=>{message=d.message();await d.dismiss()});
  await notice(page).getByRole('button',{name:'새로고침',exact:true}).click();
  expect(message).toBe('저장하지 않은 프로젝트 내용이 있습니다. 이동하면서 버릴까요?');await expect(field).toHaveValue('QA draft');
  page.once('dialog',d=>d.accept());const reloaded=page.waitForEvent('framenavigated',f=>f===page.mainFrame());
  await notice(page).getByRole('button',{name:'새로고침',exact:true}).click();await reloaded;
});

test('running script version stays fixed even if the script tag is changed',async({page})=>{
  await boot(page);await page.evaluate(()=>document.querySelector('script[src*="app.js?v="]').setAttribute('src','./app.js?v=999999'));
  await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();
});

test('network abort is silent and a later focus check recovers',async({page})=>{
  await page.clock.install();await boot(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(origin+'/app/index.html',r=>r.abort());const failed=page.waitForEvent('requestfailed',r=>r.url()===origin+'/app/index.html');await visible(page);await failed;
  await expect(notice(page)).toHaveCount(0);expect(errors).toEqual([]);
  await page.clock.runFor(1001);await response(page,current+1);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(notice(page)).toBeVisible();
});

test('session loss removes notice and stops checks',async({page})=>{
  await page.clock.install();await boot(page);await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();
  // Loader redirects on real session loss; cancel navigation so the cleanup itself can be inspected.
  await page.route(origin+'/app/login/**',r=>r.abort());
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:null}})));
  await expect(notice(page)).toHaveCount(0);
  let count=0;await page.route(origin+'/app/index.html',r=>{count++;return r.fulfill({body:'bad'})});
  await visible(page);await page.clock.runFor(600000);expect(count).toBe(0);
});

test('same owner token refresh keeps deployment checks alive',async({page})=>{
  await page.clock.install();await boot(page);await response(page,current+1);
  await page.evaluate(()=>{const s=window.KPTURuntime.session.read();window.KPTURuntime.session.write({...s,access_token:'qa-refreshed'})});
  await visible(page);await expect(notice(page)).toBeVisible();
  await notice(page).getByRole('button',{name:'닫기',exact:true}).click();
  await page.clock.runFor(1001);await response(page,current+2);await visible(page);await expect(notice(page)).toBeVisible();
});

async function openProject(page){
  await page.locator('[data-view="projects"]').click();await page.locator('[data-ps3-project="version-project"]').first().click();
  await expect(page.locator('#ps3DetailModal')).toBeVisible();
}
test('folded project memo still confirms before reload',async({page})=>{
  await boot(page);await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();await openProject(page);
  const section=page.locator('#ps3-memos');await section.locator('summary').click();await page.locator('#ps3MemoBody').fill('QA memo');await section.locator('summary').click();
  const dialog=page.waitForEvent('dialog');const click=notice(page).getByRole('button',{name:'새로고침',exact:true}).click();
  const d=await dialog;expect(d.message()).toContain('저장하지 않은 프로젝트 내용');await d.dismiss();await click;
  expect(await page.locator('#ps3MemoBody').inputValue()).toBe('QA memo');
});
test('saved workstream reopened without edits reloads without confirmation',async({page})=>{
  await boot(page);await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();await openProject(page);
  await page.locator('[data-ps3-edit-ws="version-stream"]').click();await page.locator('#ps3WsTitle').fill('Saved stream');await page.locator('#ps3WsSave').click();
  await expect(page.locator('#ps3WorkstreamModal')).toBeHidden();await expect(page.locator('[data-ps3-edit-ws="version-stream"]')).toHaveAttribute('aria-label',/수정/);
  await page.locator('[data-ps3-edit-ws="version-stream"]').click();await expect(page.locator('#ps3WsTitle')).toHaveValue('Saved stream');
  const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());return d.dismiss()});const reload=page.waitForEvent('framenavigated',f=>f===page.mainFrame());
  await notice(page).getByRole('button',{name:'새로고침',exact:true}).click();await reload;expect(dialogs).toEqual([]);
});
test('calendar color-only draft confirms before reload',async({page})=>{
  await boot(page,{connected:true});await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();await page.locator('#newEventBtn').click();
  const colors=page.locator('#eventGoogleColor [role="radio"]');await expect(colors.nth(1)).toBeVisible();await colors.nth(1).click();
  const dialog=page.waitForEvent('dialog');const click=notice(page).getByRole('button',{name:'새로고침',exact:true}).click();const d=await dialog;
  expect(d.message()).toContain('저장하지 않은 내용');await d.dismiss();await click;await expect(colors.nth(1)).toHaveAttribute('aria-checked','true');
});
test('file dropped into library upload confirms before reload',async({page})=>{
  await boot(page);await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();await page.locator('[data-view="library"]').click();await page.locator('#newDocumentBtn').click();
  await page.locator('#libraryDropzone').evaluate(el=>{const data=new DataTransfer();data.items.add(new File(['QA'],'qa.txt',{type:'text/plain'}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}))});
  const dialog=page.waitForEvent('dialog');const click=notice(page).getByRole('button',{name:'새로고침',exact:true}).click();const d=await dialog;
  expect(d.message()).toContain('저장하지 않은 내용');await d.dismiss();await click;
});

test('notice participates in an open modal keyboard focus cycle',async({page})=>{
  await boot(page);await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();await page.locator('#newEventBtn').click();
  const modal=page.locator('#eventModal');await expect(notice(page)).toBeVisible();
  const dismiss=notice(page).locator('[data-version-dismiss]');await dismiss.focus();await dismiss.press('Tab');await expect(modal.locator('[data-close="eventModal"]')).toBeFocused();
  await modal.locator('[data-close="eventModal"]').press('Shift+Tab');await expect(dismiss).toBeFocused();
});

test('connected calendar initializes without becoming an unsaved draft',async({page})=>{
  await boot(page,{connected:true});await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();await page.locator('#newEventBtn').click();
  await expect(page.locator('#eventGoogleColor [role="radio"]').nth(1)).toBeVisible();
  const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());return d.dismiss()});const reload=page.waitForEvent('framenavigated',f=>f===page.mainFrame());
  await notice(page).getByRole('button',{name:'새로고침',exact:true}).click();await reload;expect(dialogs).toEqual([]);
});

test('restoring original calendar color removes the unsaved draft',async({page})=>{
  await boot(page,{connected:true});await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();await page.locator('#newEventBtn').click();
  const colors=page.locator('#eventGoogleColor [role="radio"]');await expect(colors.nth(1)).toBeVisible();const original=await colors.evaluateAll(nodes=>nodes.findIndex(n=>n.getAttribute('aria-checked')==='true'));
  await colors.nth((original+1)%await colors.count()).click();await colors.nth(original).click();
  const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());return d.dismiss()});const reload=page.waitForEvent('framenavigated',f=>f===page.mainFrame());
  await notice(page).getByRole('button',{name:'새로고침',exact:true}).click();await reload;expect(dialogs).toEqual([]);
});

test('late-created task modal connects its last control to the notice in both directions',async({page})=>{
  await boot(page);await response(page,current+1);await visible(page);await expect(notice(page)).toBeVisible();
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/google-tasks**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({connected:true,authorized:true,pending_scope:'all',tasks:[],links:[]})}));
  await page.locator('[data-view="tasks"]').click();await page.locator('#newTaskBtn').click();const last=page.locator('#gtSaveBtn');await expect(last).toBeEnabled();
  await page.locator('#gtTaskModal').evaluate(el=>document.body.appendChild(el));
  await last.focus();await last.press('Tab');await expect(notice(page).locator('[data-version-reload]')).toBeFocused();
  await notice(page).locator('[data-version-reload]').press('Shift+Tab');await expect(last).toBeFocused();
});
