import { test, expect } from '@playwright/test';
import { appOrigin } from './helpers/test-origin.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

// CAL-저장본먼저 (2026-10-22 user request): the calendar list and month, the home 오늘 일정 and the task list show this device's
// saved copy at once with a small "새로 불러오는 중" line, then replace it wholesale with Google's answer. Without a copy they say
// "불러오는 중" (never "일정 없음") until the first answer. A failed refresh keeps the copy and says
// "최신 아님 · 마지막 확인 HH:MM" with [다시 시도]. Sign-out clears the copies. Deleting in Web2 updates the copy at once, and an
// event opened from the copy that Google no longer has is shown as 삭제된 항목 and dropped.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const APP=`${appOrigin}/app/`;
const USER={id:'cache-user',email:'cache@example.org',user_metadata:{display_name:'캐시'}};
const COPY_KEY='kptu_owner_cache:calendar-events-v1:cache-user',HOME_KEY='kptu_owner_cache:home-read-v1:cache-user',TASK_KEY='kptu_owner_cache:google-tasks-v2:cache-user';
const DAY=86400000;
const kstKey=(offset=0)=>new Date(Date.now()+9*3600000+offset*DAY).toISOString().slice(0,10);
const at=(offset,hour)=>new Date(Date.parse(kstKey(offset)+'T00:00:00+09:00')+hour*3600000).toISOString();
const event=(id,title,offset=0,hour=10)=>({id,title,start:at(offset,hour),end:at(offset,hour+1),allDay:false,calendarId:'primary',source:'google',location:'',description:'메모',recurring:false,organizationIds:[]});
const task=(id,title)=>({id,title,taskListId:'l1',taskListTitle:'업무',due:kstKey(0)+'T00:00:00.000Z',notes:'',status:'needsAction',source:'google-task'});

function newState(){
  return {events:[event('keep','남는 일정'),event('gone','지울 일정',0,13)],tasks:[task('t-keep','남는 할 일'),task('t-gone','지울 할 일')],
    hold:false,waiters:[],failEvents:false,failTasks:false,eventCalls:0,deleted:[]};
}
const release=state=>{state.hold=false;state.waiters.splice(0).forEach(r=>r())};
async function mock(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=(d,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(d??null)});
    if(path==='/auth/v1/token')return ok({access_token:'cache-access',refresh_token:'cache-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:USER});
    if(path==='/auth/v1/user')return ok(USER);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar'){
      const action=url.searchParams.get('action')||(method==='POST'?body?.action:'status');
      if(action==='status')return ok({connected:true,enabled:true,selected:['primary'],colors:{},eventColors:{},calendars:[{id:'primary',summary:'내 캘린더',primary:true,backgroundColor:'#4285f4',accessRole:'owner'}]});
      if(action==='events'){
        state.eventCalls++;
        if(state.hold)await new Promise(r=>state.waiters.push(r));
        if(state.failEvents)return ok({error:'Google Calendar 요청 실패'},500);
        const min=Date.parse(url.searchParams.get('timeMin')),max=Date.parse(url.searchParams.get('timeMax'));
        return ok({events:state.events.filter(e=>Date.parse(e.start)<max&&Date.parse(e.end)>min),eventColors:{}});
      }
      if(action==='event'){
        const e=state.events.find(x=>x.id===url.searchParams.get('eventId'));
        return e?ok({event:e,eventColors:{}}):ok({error:'Not Found'},400);
      }
      if(action==='delete-event'){state.deleted.push(body.event_id);state.events=state.events.filter(e=>e.id!==body.event_id);return ok({ok:true})}
      return ok({});
    }
    if(path==='/functions/v1/google-tasks'){
      const action=url.searchParams.get('action');
      if(action==='overview'){
        if(state.hold)await new Promise(r=>state.waiters.push(r));
        if(state.failTasks)return ok({error:'Google Tasks 요청 실패'},500);
        return ok({connected:true,authorized:true,needs_reconnect:false,pending_scope:'all',tasks:state.tasks});
      }
      if(action==='links')return ok({links:[],meeting_links:[]});
      return ok({links:[],tasks:[]});
    }
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'ws-cache',user_id:USER.id,role:'owner'}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'ws-cache',slug:'public-institutions',name:'웹2'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:USER.id,display_name:'캐시'}]);
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}
async function signIn(page,view){
  await page.goto(`${APP}login/?return=${encodeURIComponent(APP+'?view='+view)}`);
  await signInWithSession(page,USER.email);
  await ready(page);
}
async function ready(page){
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
}
const copy=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null'),COPY_KEY).catch(()=>'navigating');
const copiedIds=async page=>{const v=await copy(page);return v&&v!=='navigating'?[...new Set(Object.values(v.ranges).flatMap(r=>r.events.map(e=>e.id)))].sort():v};
const listEvent=(page,id)=>page.locator(`#calendarList [data-google-event="${id}"]`);
const fresh=page=>page.locator('#calendarFreshness');

for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
  test.describe(`calendar list at ${viewport.width}px`,()=>{
    test.use({viewport});
    test.beforeEach(async({page})=>{await page.addInitScript(()=>{try{localStorage.setItem('kptu-calendar-view','list')}catch{}})});

    test('saved copy shows at once, then the fresh answer replaces it wholesale',async({page})=>{
      const state=newState();await mock(page,state);
      await signIn(page,'calendar');
      await expect(listEvent(page,'gone')).toBeVisible();
      await expect.poll(()=>copiedIds(page)).toEqual(['gone','keep']);
      await expect(fresh(page)).toBeHidden();
      expect(JSON.stringify(await copy(page))).not.toContain('메모');
      // Deleted elsewhere; the next visit's read is held so the copy is what the screen shows first.
      state.events=state.events.filter(e=>e.id!=='gone');state.hold=true;
      await page.reload();await ready(page);
      await expect(listEvent(page,'gone')).toBeVisible();
      await expect(listEvent(page,'keep')).toBeVisible();
      await expect(fresh(page)).toHaveText('새로 불러오는 중');
      await expect(page.locator('#calendarList .clv-day').first()).not.toContainText('불러오는 중');
      release(state);
      await expect(listEvent(page,'gone')).toHaveCount(0);
      await expect(listEvent(page,'keep')).toBeVisible();
      await expect(fresh(page)).toBeHidden();
      await expect.poll(()=>copiedIds(page)).toEqual(['keep']);
      const home=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null'),HOME_KEY);
      expect(home.cards.calendar.rows.map(r=>r.id)).toEqual(['keep']);
    });

    test('without a copy the list says 불러오는 중, never 일정 없음, until the first answer',async({page})=>{
      const state=newState();state.hold=true;await mock(page,state);
      await signIn(page,'calendar');
      await expect(fresh(page)).toHaveText('불러오는 중…');
      await expect(page.locator('#calendarList .clv-day').nth(3)).toContainText('불러오는 중…');
      await expect(page.locator('#calendarList')).not.toContainText('일정 없음');
      release(state);
      await expect(listEvent(page,'keep')).toBeVisible();
      await expect(page.locator('#calendarList .clv-day').nth(3)).toContainText('일정 없음');
      await expect(page.locator('#calendarList')).not.toContainText('불러오는 중…');
      await expect(fresh(page)).toBeHidden();
    });

    test('a failed refresh keeps the copy and says it is not the latest with a retry',async({page})=>{
      const state=newState();await mock(page,state);
      await signIn(page,'calendar');
      await expect(listEvent(page,'gone')).toBeVisible();
      const saved=await copy(page),savedAt=Math.min(...Object.values(saved.ranges).map(r=>r.at));
      const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(savedAt));
      state.failEvents=true;
      await page.reload();await ready(page);
      await expect(fresh(page)).toContainText(`최신 아님 · 마지막 확인 ${clock}`);
      await expect(listEvent(page,'gone')).toBeVisible();
      await expect.poll(()=>copiedIds(page)).toEqual(['gone','keep']);
      state.failEvents=false;state.events=state.events.filter(e=>e.id!=='gone');
      await fresh(page).getByRole('button',{name:'다시 시도'}).click();
      await expect(fresh(page)).toBeHidden();
      await expect(listEvent(page,'gone')).toHaveCount(0);
    });

    test('sign-out clears the calendar, home and task copies',async({page})=>{
      const state=newState();await mock(page,state);
      await signIn(page,'calendar');
      await expect(listEvent(page,'keep')).toBeVisible();
      await expect.poll(()=>copiedIds(page)).toEqual(['gone','keep']);
      await page.evaluate(()=>window.KPTURuntime.session.write(null));
      await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('kptu_owner_cache:'))).catch(()=>['navigating'])).toEqual([]);
    });
  });
}

test.describe('saved copy follow-ups',()=>{
  test.use({viewport:{width:390,height:844}});
  test.beforeEach(async({page})=>{await page.addInitScript(()=>{try{localStorage.setItem('kptu-calendar-view','list')}catch{}})});

  test('deleting an event in Web2 drops it from the copy at once',async({page})=>{
    const state=newState();await mock(page,state);
    await signIn(page,'calendar');
    await listEvent(page,'gone').click();
    await expect(page.locator('#ciGoogleDelete')).toBeEnabled();
    state.hold=true;
    page.once('dialog',d=>d.accept());
    await page.locator('#ciGoogleDelete').click();
    await expect.poll(()=>state.deleted).toEqual(['gone']);
    await expect.poll(()=>copiedIds(page)).toEqual(['keep']);
    const home=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null'),HOME_KEY);
    expect(home.cards.calendar.rows.map(r=>r.id)).toEqual(['keep']);
    release(state);
  });

  test('an event opened from the copy that Google no longer has shows 삭제된 항목 and is dropped',async({page})=>{
    const state=newState();await mock(page,state);
    await signIn(page,'calendar');
    await expect(listEvent(page,'gone')).toBeVisible();
    state.events=state.events.filter(e=>e.id!=='gone');state.hold=true;
    await page.reload();await ready(page);
    await expect(fresh(page)).toHaveText('새로 불러오는 중');
    await listEvent(page,'gone').click();
    await expect(page.locator('#ciGoogleStatus')).toContainText('삭제된 항목');
    await expect(page.locator('#ciGoogleSave')).toBeDisabled();
    await expect(listEvent(page,'gone')).toHaveCount(0);
    await expect.poll(()=>copiedIds(page)).toEqual(['keep']);
    release(state);
  });

  test('home 오늘 일정 and 오늘 할 일 show the copy first and keep it when the refresh fails',async({page})=>{
    const state=newState();await mock(page,state);
    await signIn(page,'home');
    const calendarCard=page.locator('[data-home-card="calendar"]'),taskCard=page.locator('[data-home-card="tasks"]');
    await expect(calendarCard).toContainText('지울 일정');
    await expect(taskCard).toContainText('지울 할 일');
    await expect(calendarCard.locator('[data-home-fresh]')).toBeHidden();
    await expect.poll(()=>page.evaluate(k=>!!localStorage.getItem(k),TASK_KEY)).toBe(true);
    // Next visit: reads held → copies with the refresh line.
    state.hold=true;
    await page.reload();await ready(page);
    await expect(calendarCard).toContainText('지울 일정');
    await expect(calendarCard.locator('[data-home-fresh]')).toHaveText('새로 불러오는 중');
    await expect(taskCard).toContainText('지울 할 일');
    await expect(taskCard.locator('[data-home-fresh]')).toHaveText('새로 불러오는 중');
    // The refresh fails: the copies stay with 최신 아님 and [다시 시도].
    state.failEvents=true;state.failTasks=true;release(state);
    await expect(calendarCard.locator('[data-home-fresh]')).toContainText('최신 아님 · 마지막 확인');
    await expect(calendarCard).toContainText('지울 일정');
    await expect(taskCard.locator('[data-home-fresh]')).toContainText('최신 아님 · 마지막 확인');
    await expect(taskCard).toContainText('지울 할 일');
    // Retry after the deletions elsewhere: replaced wholesale.
    state.failEvents=false;state.failTasks=false;state.events=state.events.filter(e=>e.id!=='gone');state.tasks=state.tasks.filter(t=>t.id!=='t-gone');
    await calendarCard.getByRole('button',{name:'다시 시도'}).click();
    await taskCard.getByRole('button',{name:'다시 시도'}).click();
    await expect(calendarCard).not.toContainText('지울 일정');
    await expect(calendarCard).toContainText('남는 일정');
    await expect(taskCard).not.toContainText('지울 할 일');
    await expect(calendarCard.locator('[data-home-fresh]')).toBeHidden();
    await expect(taskCard.locator('[data-home-fresh]')).toBeHidden();
  });

  test('task list shows the copy first, says when it is not the latest, and drops a task opened from the copy that is gone',async({page})=>{
    const state=newState();await mock(page,state);
    await signIn(page,'tasks');
    const body=page.locator('#gtTaskBody'),line=page.locator('#gtTaskSection [data-gt-fresh]');
    await expect(body).toContainText('지울 할 일');
    await expect.poll(()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null')?.tasks?.length,TASK_KEY)).toBe(2);
    state.tasks=state.tasks.filter(t=>t.id!=='t-gone');state.failTasks=true;
    await page.reload();await ready(page);
    await expect(body).toContainText('지울 할 일');
    await expect(line).toContainText('최신 아님 · 마지막 확인');
    await expect(line.getByRole('button',{name:'다시 시도'})).toBeVisible();
    // Opening the task that is gone checks Google's latest list (now answering) and drops it.
    state.failTasks=false;
    await page.locator('#gtTaskBody [data-gt-edit="t-gone"]').first().click();
    await expect(page.locator('#gtEditStatus')).toContainText('삭제된 항목');
    await expect(page.locator('#gtSaveBtn')).toBeDisabled();
    await expect.poll(()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'null')?.tasks?.map(t=>t.id),TASK_KEY)).toEqual(['t-keep']);
  });
});
