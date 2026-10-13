import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const task=(id='saved')=>({id,title:'원래 할 일',notes:'서버 메모',due:null,status:'needsAction',taskListId:'@default',taskListTitle:'내 할 일'});
async function tasks(page,{newTask=false}={}){
  const home=await openHome(page);await page.route(SB+'/rest/v1/app_suborganizations**',r=>r.fulfill({json:[{id:'o',name:'전국철도노동조합',active:true}]}));await page.waitForFunction(()=>window.KPTUGoogleTasks);
  const state={setUserId:home.setUserId,calls:[],links:[],current:task(),fail:'',partial:false,gate:null,empty:false};
  await page.route(SB+'/functions/v1/google-tasks**',async r=>{
    const a=new URL(r.request().url()).searchParams.get('action'),b=r.request().method()==='POST'?r.request().postDataJSON():null;
    const ok=x=>r.fulfill({json:x});
    if(!b){if(a==='links'){if(state.readFail)return r.fulfill({status:503,json:{error:'연결 조회 실패'}});return ok({links:state.links,meeting_links:[]});}return ok({connected:true,authorized:true,pending_scope:'all',tasks:[state.current]});}
    state.calls.push({a,b});if(state.gate)await state.gate;
    if(a==='link'&&state.partialLink){state.partialLink=false;state.links.push({...b.links[0],status:'confirmed'});return r.fulfill({status:400,json:{error:'일부 연결 실패'}});}
    if(state.fail===a)return r.fulfill({status:403,json:{error:a==='update'?'TASKS_SCOPE_REQUIRED':'연결 저장 실패'}});
    if(state.empty)return ok({ok:true});
    if(a==='create'||a==='update'){state.current={...state.current,...b,id:a==='create'?'created':b.task_id};return ok({ok:true,task:state.current,links:[],meeting_links:[],...(state.partial?{link_error:'연결 실패'}:{})});}
    if(a==='link')state.links.push(...b.links.map(x=>({...x,status:'confirmed'})));
    if(a==='unlink')state.links=state.links.filter(x=>!b.links.some(y=>y.project_id===x.project_id));
    return ok({ok:true,links:state.links,meeting_links:[]});
  });
  await page.evaluate(()=>window.KPTURouter.go('tasks'));await expect(page.locator('#gtTaskSection')).toBeVisible();
  await page.evaluate(({newTask,t})=>window.KPTUGoogleTasks.openEditor(newTask?null:t),{newTask,t:state.current});
  await expect(page.locator('#gtEditLinkBody input[value="p:child"]')).toBeVisible();
  return state;
}
for(const width of [390,1280])test(`task permission failure keeps current draft ${width}`,async({page})=>{
  await page.setViewportSize({width,height:850});const s=await tasks(page);s.fail='update';await page.locator('#gtEditTitle').fill('수정 초안');await page.locator('#gtEditNotes').fill('보존 메모');await page.locator('#gtSaveBtn').click();
  await expect(page.locator('#gtEditStatus')).toContainText('권한');await expect(page.locator('#gtTaskModal')).toBeVisible();await expect(page.locator('#gtEditTitle')).toHaveValue('수정 초안');await expect(page.locator('#gtEditNotes')).toHaveValue('보존 메모');
});
test('known created task keeps draft and retries links without another create',async({page})=>{
  const s=await tasks(page,{newTask:true});s.partial=true;await page.locator('#gtEditTitle').fill('새 할 일');await page.locator('input[value="p:child"]').check();await page.locator('#gtSaveBtn').click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();await expect(page.locator('#gtEditStatus')).toContainText('연결');s.partial=false;await page.locator('#gtSaveBtn').click();await expect(page.locator('#gtTaskModal')).toBeHidden();
  expect(s.calls.filter(x=>x.a==='create')).toHaveLength(1);expect(s.calls.filter(x=>x.a==='link')[0].b.task_id).toBe('created');
});
test('successful add is not resent after unlink fails',async({page})=>{
  const s=await tasks(page);s.links=[{project_id:'p',status:'confirmed'}];await page.evaluate(()=>window.KPTUGoogleTasks.openEditor({id:'saved',title:'원래 할 일',notes:'서버 메모',taskListId:'@default'}));await expect(page.locator('input[value="p:p"]')).toBeChecked();
  await page.locator('input[value="p:p"]').uncheck();await page.locator('input[value="p:child"]').check();await page.locator('#gtEditTitle').fill('변경');s.fail='unlink';await page.locator('#gtSaveBtn').click();await expect(page.locator('#gtTaskModal')).toBeVisible();await expect(page.locator('#gtEditStatus')).toContainText('연결');s.fail='';await page.locator('#gtSaveBtn').click();await expect(page.locator('#gtTaskModal')).toBeHidden();expect(s.calls.filter(x=>x.a==='link')).toHaveLength(1);expect(s.calls.filter(x=>x.a==='update')).toHaveLength(1);
});
test('session change prevents later link writes from the previous save',async({page})=>{
  const s=await tasks(page);let release;s.gate=new Promise(r=>release=r);await page.locator('input[value="p:child"]').check();await page.locator('#gtEditTitle').fill('계정 A 초안');await page.locator('#gtSaveBtn').click();await expect.poll(()=>s.calls.length).toBe(1);
  await page.evaluate(()=>window.KPTURuntime.session.write({...window.KPTURuntime.session.read(),user:{id:'other-owner'}}));release();await expect.poll(()=>page.locator('#gtSaveBtn').isDisabled()).toBe(false);expect(s.calls.filter(x=>x.a==='link')).toHaveLength(0);
});
test('new text typed while task save is pending remains open after success',async({page})=>{
  const s=await tasks(page);let release;s.gate=new Promise(r=>release=r);await page.locator('#gtEditTitle').fill('제출 제목');await page.locator('#gtSaveBtn').click();await expect.poll(()=>s.calls.length).toBe(1);await page.locator('#gtEditNotes').fill('요청 이후 입력');release();await expect(page.locator('#gtSaveBtn')).toBeEnabled();await expect(page.locator('#gtTaskModal')).toBeVisible();await expect(page.locator('#gtEditNotes')).toHaveValue('요청 이후 입력');
});
test('unconfirmed create result blocks another create and offers explicit result selection',async({page})=>{
  const s=await tasks(page,{newTask:true});s.empty=true;await page.locator('#gtEditTitle').fill('불명 생성');await page.locator('#gtSaveBtn').click();await expect(page.locator('#gtTaskModal')).toBeVisible();await expect(page.locator('#gtEditStatus')).toContainText('확인');await page.locator('#gtSaveBtn').click();expect(s.calls.filter(x=>x.a==='create')).toHaveLength(1);await expect(page.getByRole('button',{name:'목록에서 저장 결과 확인',exact:true})).toBeVisible();
});
async function registration(page,{taskMode=false}={}){
  await openHome(page,{query:'?view=calendar'});await page.waitForFunction(()=>window.KPTUCalendarPlus&&window.KPTUCalendarTasks);await page.locator('#newEventBtn').click();if(taskMode)await page.locator('[data-event-mode="task"]').click();await page.locator('#eventTitle').fill('제출 제목');
}
for(const width of [390,1280])test(`late event create cannot close a reopened registration ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});await registration(page);let release,called=false;const gate=new Promise(r=>release=r);await page.route(SB+'/functions/v1/google-calendar',async r=>{called=true;await gate;return r.fulfill({json:{ok:true,event:{id:'created-event',calendarId:'c',location:r.request().postDataJSON().location||''}}});});await page.locator('#saveEventBtn').click();await expect.poll(()=>called).toBe(true);await page.locator('[data-close="eventModal"]').click();await expect(page.locator('#eventModal')).toBeHidden();await page.locator('#newEventBtn').click();await page.locator('#eventTitle').fill('새 창 초안');release();await expect(page.locator('#saveEventBtn')).toBeEnabled();await expect(page.locator('#eventModal')).toBeVisible();await expect(page.locator('#eventTitle')).toHaveValue('새 창 초안');
});
test('registration task partial create keeps known id for link-only retry',async({page})=>{
  await registration(page,{taskMode:true});const calls=[];let linked=false;await page.route(SB+'/functions/v1/google-tasks**',r=>{const a=new URL(r.request().url()).searchParams.get('action'),b=r.request().method()==='POST'?r.request().postDataJSON():null;if(b)calls.push({a,b});if(a==='link')linked=true;return r.fulfill({json:a==='create'?{ok:true,task:task('created'),links:[],meeting_links:[],link_error:'실패'}:{ok:true,links:linked?[{project_id:'child',status:'confirmed'}]:[],meeting_links:[]}});});await page.locator('#eventTaskProject').click();await page.getByRole('button',{name:'자식 프로젝트',exact:true}).click();await page.locator('#saveEventBtn').click();await expect(page.locator('#eventModal')).toBeVisible();await expect(page.locator('#eventStatus')).toContainText('연결');await page.locator('#saveEventBtn').click();await expect(page.locator('#eventModal')).toBeHidden();expect(calls.filter(x=>x.a==='create')).toHaveLength(1);expect(calls.find(x=>x.a==='link').b.task_id).toBe('created');
});

test('failed links reread prevents more writes until the result is known',async({page})=>{
 const s=await tasks(page);s.fail='link';s.readFail=true;await page.locator('input[value="p:child"]').check();await page.locator('#gtSaveBtn').click();await expect(page.locator('#gtEditStatus')).toContainText('연결');const count=s.calls.length;await page.locator('#gtSaveBtn').click();await expect(page.locator('#gtEditStatus')).toContainText('확인');expect(s.calls).toHaveLength(count);s.readFail=false;s.fail='';await page.locator('#gtSaveBtn').click();await expect(page.locator('#gtTaskModal')).toBeHidden();
});
test('partially successful link batch retries only missing targets',async({page})=>{
 const s=await tasks(page);s.partialLink=true;await page.locator('input[value="p:p"]').check();await page.locator('input[value="p:child"]').check();await page.locator('#gtSaveBtn').click();await expect(page.locator('#gtEditStatus')).toContainText('연결');await page.locator('#gtSaveBtn').click();await expect(page.locator('#gtTaskModal')).toBeHidden();const adds=s.calls.filter(x=>x.a==='link');expect(adds).toHaveLength(2);expect(adds[1].b.links).toEqual([{project_id:'child'}]);
});
test('unknown create adopts only the task explicitly selected from actual results',async({page})=>{
 const s=await tasks(page,{newTask:true});s.empty=true;await page.locator('#gtEditTitle').fill('불명 생성');await page.locator('#gtSaveBtn').click();await page.getByRole('button',{name:'목록에서 저장 결과 확인',exact:true}).click();await page.getByRole('button',{name:'원래 할 일 · 이 할 일에 이어서 저장',exact:true}).click();await expect(page.locator('#gtEditTitle')).toHaveValue('불명 생성');s.empty=false;await page.locator('#gtSaveBtn').click();await expect(page.locator('#gtTaskModal')).toBeHidden();expect(s.calls.filter(x=>x.a==='create')).toHaveLength(1);expect(s.calls.find(x=>x.a==='update').b.task_id).toBe('saved');
});
test('old task finally does not unlock another pending editor',async({page})=>{
 const s=await tasks(page);let first,second;s.gate=new Promise(r=>first=r);await page.locator('#gtEditTitle').fill('첫 저장');await page.locator('#gtSaveBtn').click();await expect.poll(()=>s.calls.length).toBe(1);await page.locator('[data-gt-close]').click();await page.evaluate(()=>window.KPTUGoogleTasks.openEditor({id:'other',title:'다른 항목',taskListId:'@default'}));await expect(page.locator('#gtSaveBtn')).toBeEnabled();s.gate=new Promise(r=>second=r);await page.locator('#gtEditTitle').fill('두 번째 저장');await page.locator('#gtSaveBtn').click();await expect.poll(()=>s.calls.length).toBe(2);first();await expect(page.locator('#gtSaveBtn')).toBeDisabled();await expect(page.locator('#gtEditTitle')).toHaveValue('두 번째 저장');second();await expect(page.locator('#gtTaskModal')).toBeHidden();
});
test('reopening the same task waits for its outstanding save',async({page})=>{
 const s=await tasks(page);let release;s.gate=new Promise(r=>release=r);await page.locator('#gtEditTitle').fill('첫 저장');await page.locator('#gtSaveBtn').click();await expect.poll(()=>s.calls.length).toBe(1);await page.locator('[data-gt-close]').click();await page.evaluate(()=>{void window.KPTUGoogleTasks.openEditor({id:'saved',title:'원래 할 일',notes:'서버 메모',taskListId:'@default'})});await expect(page.locator('#gtTaskModal')).toBeVisible();await expect(page.locator('#gtSaveBtn')).toBeDisabled();await page.locator('#gtEditTitle').fill('다시 연 입력');release();await expect(page.locator('#gtSaveBtn')).toBeEnabled();await expect(page.locator('#gtTaskModal')).toBeVisible();await expect(page.locator('#gtEditTitle')).toHaveValue('다시 연 입력');
});
test('token refresh keeps an editor opened from calendar before the task list loads',async({page})=>{
 await openHome(page,{query:'?view=calendar'});await page.waitForFunction(()=>window.KPTUGoogleTasks);await page.route(SB+'/functions/v1/google-tasks?action=links*',r=>r.fulfill({json:{links:[],meeting_links:[]}}));await page.evaluate(()=>window.KPTUGoogleTasks.openEditor({id:'saved',title:'원래 할 일',taskListId:'@default'}));await expect(page.locator('#gtEditLinkBody input')).not.toHaveCount(0);await page.locator('#gtEditTitle').fill('토큰 갱신 중 초안');await page.evaluate(()=>window.KPTURuntime.session.write({...window.KPTURuntime.session.read(),access_token:'refreshed-synthetic-token'}));await expect(page.locator('#gtTaskModal')).toBeVisible();await expect(page.locator('#gtEditTitle')).toHaveValue('토큰 갱신 중 초안');await expect(page.locator('#gtSaveBtn')).toBeEnabled();
});

test('logout and same-owner login use a fresh authenticated screen without old link callbacks',async({page})=>{
 const s=await tasks(page);let release;s.gate=new Promise(r=>release=r);await page.locator('input[value="p:child"]').check();await page.locator('#gtEditTitle').fill('이전 세션');await page.locator('#gtSaveBtn').click();await expect.poll(()=>s.calls.length).toBe(1);await page.evaluate(()=>window.KPTURuntime.session.write(null));await expect(page.locator('#emailAuthToggle')).toBeVisible();release();await page.locator('#emailAuthToggle').click();await page.locator('#authEmail').fill('home@example.org');await page.locator('#authPassword').fill('password123');await page.locator('#authSubmit').click();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);await expect(page.locator('#gtTaskModal')).toBeHidden();expect(s.calls.filter(x=>x.a==='link')).toHaveLength(0);
});
test.describe('normal keyboard and touch saves',()=>{
 test.use({hasTouch:true});
 for(const width of [390,1280])test(`task keyboard editing and touch save has no console errors ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text())});await tasks(page);await page.locator('#gtEditTitle').focus();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('키보드 저장');await page.locator('#gtEditNotes').fill('메모');await page.locator('#gtSaveBtn').tap();await expect(page.locator('#gtTaskModal')).toBeHidden();expect(errors).toEqual([]);
 });
 for(const width of [390,1280])test(`event keyboard editing and touch save has no console errors ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text())});await registration(page);await page.route(SB+'/functions/v1/google-calendar',r=>r.fulfill({json:{ok:true,event:{id:'created-event',calendarId:r.request().postDataJSON().calendar_id,location:r.request().postDataJSON().location||''}}}));await page.locator('#eventTitle').focus();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('키보드 일정');await page.locator('#saveEventBtn').tap();await expect(page.locator('#eventModal')).toBeHidden();expect(errors).toEqual([]);
 });
});
test('account change reloads its authenticated screen without replaying the old save',async({page})=>{
 const state=await tasks(page);const attempts=[];let release;const gate=new Promise(r=>release=r);
 await page.route(SB+'/auth/v1/token?grant_type=refresh_token',r=>r.fulfill({json:{access_token:'synthetic-other-refreshed',refresh_token:'synthetic-other-refresh',expires_at:4102444800,user:{id:'other-owner'}}}));
 await page.route(SB+'/functions/v1/google-tasks?action=update',async r=>{const b=r.request().postDataJSON();attempts.push({id:b.task_id,otherOwner:r.request().headers().authorization==='Bearer synthetic-other-refreshed'});if(attempts.length===1){await gate;return r.fulfill({status:401,json:{error:'로그인 필요'}})}return r.fulfill({json:{ok:true,task:{...task(),...b,id:'saved'}}});});
 await page.locator('#gtEditTitle').fill('이전 계정의 저장');await page.evaluate(()=>{window.__save401Finished=document.querySelector('#gtSaveBtn').onclick()});await expect.poll(()=>attempts.length).toBe(1);const reloaded=page.waitForEvent('framenavigated',{predicate:frame=>frame===page.mainFrame()});state.setUserId('other-owner');await page.evaluate(()=>window.KPTURuntime.session.write({access_token:'synthetic-other',refresh_token:'synthetic-other-refresh',expires_at:4102444800,user:{id:'other-owner'}}));release();await reloaded;await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);expect(await page.evaluate(()=>window.KPTURuntime.session.read()?.user?.id)).toBe('other-owner');await expect(page.locator('#gtTaskModal')).toBeHidden();expect(attempts).toHaveLength(1);expect(attempts.every(x=>!x.otherOwner)).toBe(true);
});

for(const [width,close] of [[390,'X'],[1280,'Escape'],[390,'Back']])test(`calendar registration uses the real closed-dialog lifecycle (${close}, ${width})`,async({page})=>{
 await page.setViewportSize({width,height:900});await registration(page);let release,called=false;const gate=new Promise(r=>release=r);await page.route(SB+'/functions/v1/google-calendar',async r=>{called=true;const body=r.request().postDataJSON();await gate;return r.fulfill({json:{ok:true,event:{id:'created-event',calendarId:body.calendar_id,location:body.location||''}}})});
 await page.evaluate(()=>{window.__eventClosed=0;window.addEventListener('kptu:dialog-closed',e=>{if(e.detail?.modal?.id==='eventModal')window.__eventClosed++})});await page.locator('#saveEventBtn').click();await expect.poll(()=>called).toBe(true);
 if(close==='X')await page.locator('[data-close="eventModal"]').click();else if(close==='Escape')await page.keyboard.press('Escape');else await page.goBack();
 await expect(page.locator('#eventModal')).toBeHidden();expect(await page.evaluate(()=>window.__eventClosed)).toBe(1);await expect(page.locator('#newEventBtn')).toBeFocused();if(width<=760)await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).not.toBe('eventModal');
 await page.locator('#newEventBtn').click();await page.locator('#eventTitle').fill('다시 연 입력');release();await expect(page.locator('#saveEventBtn')).toBeEnabled();await expect(page.locator('#saveEventBtn')).toHaveText('저장');await expect(page.locator('#saveEventBtn')).not.toHaveAttribute('aria-busy','true');await expect(page.locator('#eventModal')).toBeVisible();await expect(page.locator('#eventTitle')).toHaveValue('다시 연 입력');
});
test('calendar registration backdrop keeps its existing open-form behavior',async({page})=>{
 await page.setViewportSize({width:390,height:900});await registration(page);await page.locator('#eventModal').click({position:{x:2,y:2}});await expect(page.locator('#eventModal')).toBeVisible();await expect(page.locator('#eventTitle')).toHaveValue('제출 제목');
});
