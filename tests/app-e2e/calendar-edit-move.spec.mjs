import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const calendars=[{id:'source',summary:'기존 캘린더',accessRole:'owner',backgroundColor:'#336699'},{id:'target',summary:'새 캘린더',accessRole:'writer',backgroundColor:'#aa5533'},{id:'read-only',summary:'읽기 전용',accessRole:'reader'},{id:'unknown',summary:'권한 미확인'}];
test.use({timezoneId:'Asia/Seoul',viewport:{width:360,height:844}});
async function open(page,{view='list',recurring=false,partial=false}={}){
  const state={writes:[],reads:0,event:{id:'move-event',title:'합성 이동 시험',calendarId:'source',start:'2026-10-20',end:'2026-10-21',allDay:true,color:null,colorId:null,organizationIds:['org-a'],recurring,source:'google'}};
  await page.clock.setFixedTime(new Date('2026-10-20T03:00:00Z'));
  await page.addInitScript(view=>localStorage.setItem('kptu-calendar-view',view),view);
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===BASE)return route.continue();
    if(url.origin!==SB)return route.abort();
    const ok=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    const user={id:'move-user',email:'qa@example.org',user_metadata:{display_name:'QA'}};
    if(url.pathname==='/auth/v1/token')return ok({access_token:'synthetic',refresh_token:'synthetic',expires_at:4102444800,user});
    if(url.pathname==='/auth/v1/user')return ok(user);
    if(url.pathname==='/rest/v1/app_workspace_members')return ok([{workspace_id:'move-ws',user_id:user.id,role:'owner'}]);
    if(url.pathname==='/rest/v1/app_workspaces')return ok([{id:'move-ws',name:'QA'}]);
    if(url.pathname==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'QA'}]);
    if(url.pathname==='/functions/v1/google-calendar'){
      const action=url.searchParams.get('action');
      if(req.method()==='POST'){
        const body=req.postDataJSON();state.writes.push(body);
        if(body.action==='update-event'){
          state.event.calendarId=body.target_calendar_id||body.calendar_id;
          if(!partial)state.event.title=body.title;
          return ok(partial?{ok:false,moved:true,partial_failure:true,failed_stage:'contents',message:'캘린더는 옮겨졌지만 일부 내용 저장에 실패했습니다.',event:state.event}:{ok:true,moved:!!body.target_calendar_id,event:state.event});
        }
      }
      if(action==='event'){state.reads++;if(state.readGate)await state.readGate;if(state.readFail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'합성 조회 실패'})});return ok({event:state.event,eventColors:{}})}
      return ok({connected:true,enabled:true,selected:['source','target'],calendars,events:[state.event],colors:{},eventColors:{}});
    }
    if(url.pathname==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,tasks:[],links:[],meeting_links:[]});
    return ok([]);
  });
  await page.goto(loginEntry(BASE+'/app/?view=calendar'));
  await page.locator('#emailAuthToggle').click();await page.locator('#authEmail').fill('qa@example.org');await page.locator('#authPassword').fill('password123');await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(page.locator('[data-google-event="move-event"]').first()).toBeVisible();
  return state;
}
async function edit(page){await page.locator('[data-google-event="move-event"]').first().click();await expect(page.locator('#ciGoogleModal')).toBeVisible();await expect(page.locator('#ciGoogleSave')).toBeEnabled()}
test('current calendar is selected; only writable choices; unchanged save omits target',async({page})=>{
  const state=await open(page);await edit(page);
  await expect(page.locator('#ciGoogleCalendar')).toHaveValue('source');
  expect(await page.locator('#ciGoogleCalendar option').evaluateAll(rows=>rows.map(r=>r.value))).toEqual(['source','target']);
  await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();
  expect(state.writes[0]).not.toHaveProperty('target_calendar_id');expect(state.writes[0].organization_ids).toEqual(['org-a']);
});
for(const view of ['list','week','month'])test('move persists destination color and editor across '+view,async({page})=>{
  const state=await open(page,{view});await edit(page);await page.locator('#ciGoogleCalendar').selectOption('target');await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();
  expect(state.writes[0]).toMatchObject({calendar_id:'source',event_id:'move-event',target_calendar_id:'target'});
  const root=view==='month'?'#calendarGrid':view==='week'?'#calendarWeek':'#calendarList';
  const moved=page.locator(root+' [data-google-event="move-event"]');await expect(moved.first()).toHaveAttribute('data-google-calendar','target');
  const color=await moved.first().evaluate(el=>{const dot=el.querySelector('.clv-color');if(dot)return getComputedStyle(dot).backgroundColor;const probe=document.createElement('i');probe.style.backgroundColor=getComputedStyle(el).getPropertyValue('--cmv-google-source');el.append(probe);const color=getComputedStyle(probe).backgroundColor;probe.remove();return color});
  expect(color).toBe('rgb(170, 85, 51)');
  await edit(page);await expect(page.locator('#ciGoogleCalendar')).toHaveValue('target');
});
test('date dialog uses same editor and selection',async({page})=>{
  await open(page,{view:'month'});await page.locator('.cal-cell[data-date="2026-10-20"] .cmv-date-list').click();await expect(page.locator('#calendarDayModal')).toBeVisible();
  await page.locator('#calendarDayModal [data-google-event="move-event"]').click();await expect(page.locator('#ciGoogleCalendar')).toHaveValue('source');
});
test('recurring event locks calendar but keeps existing edits',async({page})=>{
  const state=await open(page,{recurring:true});await edit(page);await expect(page.locator('#ciGoogleCalendar')).toBeDisabled();await expect(page.locator('#ciGoogleCalendarHint')).toHaveText('반복 일정은 Google 캘린더에서 옮겨 주세요');
  await page.locator('#ciGoogleSave').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();expect(state.writes[0]).not.toHaveProperty('target_calendar_id');
});
test('partial save reads actual destination and preserves warning for retry',async({page})=>{
  const state=await open(page,{partial:true});await edit(page);await page.locator('#ciGoogleCalendar').selectOption('target');await page.locator('#ciGoogleTitle').fill('합성 수정 입력');await page.locator('#ciGoogleSave').click();
  await expect(page.locator('#ciGoogleStatus')).toContainText('캘린더는 옮겨졌지만 일부 내용 저장에 실패했습니다');await expect(page.locator('#ciGoogleCalendar')).toHaveValue('target');await expect(page.locator('#ciGoogleTitle')).toHaveValue('합성 이동 시험');expect(state.reads).toBeGreaterThan(0);
  await page.locator('#ciGoogleSave').click();await expect.poll(()=>state.writes.length).toBe(2);expect(state.writes[1].calendar_id).toBe('target');expect(state.writes[1]).not.toHaveProperty('target_calendar_id');
});
test('failed reread retains server-confirmed destination and allows a correct retry',async({page})=>{
  const state=await open(page,{partial:true});await edit(page);state.readFail=true;
  await page.locator('#ciGoogleCalendar').selectOption('target');await page.locator('#ciGoogleSave').click();
  await expect(page.locator('#ciGoogleStatus')).toContainText('최신 조회도 실패');await expect(page.locator('#ciGoogleCalendar')).toHaveValue('target');await expect(page.locator('#ciGoogleSave')).toBeEnabled();
  await page.locator('#ciGoogleSave').click();await expect.poll(()=>state.writes.length).toBe(2);expect(state.writes[1].calendar_id).toBe('target');
});
test('late partial reread cannot overwrite another event editor',async({page})=>{
  const state=await open(page,{partial:true});await edit(page);let release;state.readGate=new Promise(resolve=>release=resolve);
  await page.locator('#ciGoogleCalendar').selectOption('target');await page.locator('#ciGoogleSave').click();await expect.poll(()=>state.reads).toBe(1);
  await page.locator('#ciGoogleClose').click();
  await page.evaluate(()=>{const event={...window.__KPTU_GOOGLE_EVENTS__[0],id:'other-event',title:'합성 다른 일정',calendarId:'source'};window.__KPTU_GOOGLE_EVENTS__.push(event);const item=document.querySelector('[data-google-event="move-event"]');item.dataset.googleEvent=event.id;item.click()});
  await expect(page.locator('#ciGoogleTitle')).toHaveValue('합성 다른 일정');release();
  await expect(page.locator('#ciGoogleSave')).toBeEnabled();await expect(page.locator('#ciGoogleStatus')).toBeEmpty();await expect(page.locator('#ciGoogleTitle')).toHaveValue('합성 다른 일정');await expect(page.locator('#ciGoogleCalendar')).toHaveValue('source');
});
test('desktop uses the same keyboard-accessible calendar selector',async({page})=>{
  await page.setViewportSize({width:1280,height:900});await open(page);await edit(page);
  await expect(page.getByLabel('캘린더',{exact:true})).toHaveValue('source');await page.locator('#ciGoogleCalendar').focus();await page.keyboard.press('ArrowDown');await expect(page.locator('#ciGoogleCalendar')).toHaveValue('target');
});
test('primary alias selects the named current calendar without a duplicate destination',async({page})=>{
  await open(page);await page.evaluate(()=>{window.__KPTU_GOOGLE_EVENTS__[0].calendarId='primary';window.__KPTU_GOOGLE_STATE__.calendars[0].primary=true;document.querySelector('[data-google-event="move-event"]').dataset.googleCalendar='primary'});await edit(page);
  await expect(page.locator('#ciGoogleCalendar')).toHaveValue('primary');expect(await page.locator('#ciGoogleCalendar option').evaluateAll(rows=>rows.map(r=>({value:r.value,disabled:r.disabled,label:r.textContent})))).toEqual([{value:'primary',disabled:false,label:'기존 캘린더 (기본)'},{value:'target',disabled:false,label:'새 캘린더'}]);
});
